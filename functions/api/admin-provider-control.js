import {
  isKnownProvider,
  readAllProviderControls,
  readProviderControl,
  writeProviderControl,
} from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

const POSITION_PROVIDERS = new Set(['adsb.fi', 'adsb.lol', 'airplanes.live']);
const TEST_TIMEOUT_MS = 8000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorized(context) {
  const configured = context.env?.ADMIN_STATS_TOKEN;
  if (!configured) return { ok: false, status: 503, error: 'ADMIN_NOT_CONFIGURED' };
  const auth = context.request.headers.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(supplied, configured))
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  return { ok: true };
}

function providerTestRequest(context, provider) {
  if (provider === 'adsb.fi') {
    return {
      url: 'https://opendata.adsb.fi/api/v3/lat/31.5/lon/34.8/dist/25',
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    };
  }
  if (provider === 'adsb.lol') {
    return {
      url: 'https://api.adsb.lol/v2/point/31.5/34.8/25',
      headers: { accept: 'application/json' },
    };
  }
  if (provider === 'airplanes.live') {
    if (String(context.env?.AIRPLANES_LIVE_ACCESS || '') !== '1') {
      return { error: 'NOT_CONFIGURED', status: 503 };
    }
    return {
      url: 'https://api.airplanes.live/v2/point/31.5/34.8/25',
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    };
  }
  if (provider === 'airlabs') {
    const apiKey = context.env?.AIRLABS_API_KEY;
    if (!apiKey) return { error: 'NOT_CONFIGURED', status: 503 };
    const url = new URL('https://airlabs.co/api/v9/flight');
    url.searchParams.set('flight_icao', 'ELY001');
    url.searchParams.set('api_key', apiKey);
    return { url: url.toString(), headers: { accept: 'application/json' } };
  }
  if (provider === 'planespotters.net') {
    return {
      url: 'https://api.planespotters.net/pub/photos/reg/N12345',
      headers: { accept: 'application/json' },
    };
  }
  return { error: 'UNKNOWN_PROVIDER', status: 400 };
}

async function safeRecordProviderRequest(context, status, origin, provider) {
  try {
    await recordProviderRequest(context.env, status, origin, provider);
  } catch (error) {
    console.error(
      `admin-provider-control: unable to record stats for ${provider}:`,
      error instanceof Error ? error.message : error
    );
  }
}

async function testProvider(context, provider, origin) {
  const request = providerTestRequest(context, provider);
  if (request.error) {
    return { ok: false, status: request.status, code: request.error };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(request.url, {
      headers: request.headers,
      signal: controller.signal,
    });
    await safeRecordProviderRequest(context, response.status, origin, provider);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      code: response.ok ? 'OK' : 'UPSTREAM_HTTP_ERROR',
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const status = timedOut ? 598 : 599;
    await safeRecordProviderRequest(context, status, origin, provider);
    return {
      ok: false,
      status,
      code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestPost(context) {
  const auth = authorized(context);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const origin = new URL(context.request.url).origin;
  const body = await context.request.json().catch(() => ({}));
  const provider = String(body.provider || '');
  const action = String(body.action || '');

  if (!isKnownProvider(provider)) return json({ error: 'UNKNOWN_PROVIDER' }, 400);

  if (action === 'test') {
    const result = await testProvider(context, provider, origin);
    return json({ provider, action, ...result }, 200);
  }

  if (action === 'enable') {
    const control = await writeProviderControl(
      context.env,
      provider,
      { enabled: true, pausedUntil: null, pauseReason: null },
      origin
    );
    return json({ provider, control });
  }

  if (action !== 'pause') return json({ error: 'INVALID_ACTION' }, 400);

  let pausedUntil = body.resumeAt ? new Date(body.resumeAt) : null;
  if (pausedUntil && Number.isNaN(pausedUntil.getTime()))
    return json({ error: 'INVALID_RESUME_AT' }, 400);
  if (pausedUntil && pausedUntil.getTime() <= Date.now())
    return json({ error: 'INVALID_RESUME_AT' }, 400);
  if (pausedUntil && pausedUntil.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000)
    return json({ error: 'RESUME_AT_TOO_FAR' }, 400);

  if (POSITION_PROVIDERS.has(provider)) {
    const controls = await readAllProviderControls(context.env, origin);
    const otherActive = controls.some(
      (item) => POSITION_PROVIDERS.has(item.provider) && item.provider !== provider && item.enabled
    );
    if (!otherActive) return json({ error: 'AT_LEAST_ONE_POSITION_PROVIDER_REQUIRED' }, 409);
  }

  const current = await readProviderControl(context.env, provider, origin);
  if (!pausedUntil && current.pausedUntil) pausedUntil = new Date(current.pausedUntil);

  const control = await writeProviderControl(
    context.env,
    provider,
    {
      enabled: false,
      pausedUntil: pausedUntil ? pausedUntil.toISOString() : null,
      pauseReason: 'MANUAL',
    },
    origin
  );
  return json({ provider, control });
}
