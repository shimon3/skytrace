import {
  isKnownProvider,
  readAllProviderControls,
  readProviderControl,
  writeProviderControl,
} from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

const POSITION_PROVIDERS = new Set(['adsb.fi', 'adsb.one', 'adsb.lol', 'airplanes.live']);

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

async function testProvider(context, provider, origin) {
  let response;
  if (provider === 'adsb.fi') {
    response = await fetch('https://opendata.adsb.fi/api/v3/lat/31.5/lon/34.8/dist/25', {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    });
  } else if (provider === 'adsb.one') {
    response = await fetch('https://api.adsb.one/v2/point/31.5/34.8/25', {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    });
  } else if (provider === 'adsb.lol') {
    response = await fetch('https://api.adsb.lol/v2/point/31.5/34.8/25', {
      headers: { accept: 'application/json' },
    });
  } else if (provider === 'airplanes.live') {
    if (String(context.env?.AIRPLANES_LIVE_ACCESS || '') !== '1') {
      return { ok: false, status: 503, code: 'NOT_CONFIGURED' };
    }
    response = await fetch('https://api.airplanes.live/v2/point/31.5/34.8/25', {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    });
  } else if (provider === 'airlabs') {
    const apiKey = context.env?.AIRLABS_API_KEY;
    if (!apiKey) return { ok: false, status: 503, code: 'NOT_CONFIGURED' };
    const url = new URL('https://airlabs.co/api/v9/flight');
    url.searchParams.set('flight_icao', 'ELY001');
    url.searchParams.set('api_key', apiKey);
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } else if (provider === 'planespotters.net') {
    response = await fetch('https://api.planespotters.net/pub/photos/reg/N12345', {
      headers: { accept: 'application/json' },
    });
  }

  const status = response?.status ?? 599;
  await recordProviderRequest(context.env, status, origin, provider);
  return { ok: status >= 200 && status < 300, status };
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
    return json({ provider, action, ...result }, result.ok ? 200 : 502);
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
