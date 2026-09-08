import { providerEnabled } from '../lib/provider-controls.js';
import {
  cooldownSecondsForStatus,
  providerCoolingDown,
  setProviderCooldown,
} from '../lib/provider-cooldown.js';
import { recordProviderRequest } from '../lib/stats.js';

const PROVIDERS = {
  'adsb.fi': {
    base: 'https://opendata.adsb.fi/api/v2',
    path(kind, query) {
      if (kind === 'hex') return `icao/${encodeURIComponent(query)}`;
      if (kind === 'reg') return `registration/${encodeURIComponent(query)}`;
      return `callsign/${encodeURIComponent(query)}`;
    },
  },
  'adsb.one': {
    base: 'https://api.adsb.one/v2',
    path(kind, query) {
      if (kind === 'hex') return `icao/${encodeURIComponent(query)}`;
      if (kind === 'reg') return `reg/${encodeURIComponent(query)}`;
      return `callsign/${encodeURIComponent(query)}`;
    },
  },
  'adsb.lol': {
    base: 'https://api.adsb.lol/v2',
    path(kind, query) {
      return `${kind}/${encodeURIComponent(query)}`;
    },
  },
  'airplanes.live': {
    base: 'https://api.airplanes.live/v2',
    path(kind, query) {
      return `${kind}/${encodeURIComponent(query)}`;
    },
  },
};

const PROVIDER_ORDER = ['adsb.fi', 'adsb.one', 'adsb.lol', 'airplanes.live'];
const CACHE_SECONDS = 30;
const NEGATIVE_CACHE_SECONDS = 15;
const TIMEOUT_MS = 5000;

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function sanitize(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 16);
}

function candidates(query) {
  const list = [
    ['callsign', query],
    ['reg', query],
  ];
  if (/^[0-9A-F]{6}$/.test(query)) list.unshift(['hex', query]);
  return list;
}

function normalize(item) {
  const lat = Number(item?.lat);
  const lon = Number(item?.lon ?? item?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    hex: item.hex || null,
    flight: String(item.flight || '').trim() || null,
    registration: item.r || item.reg_number || null,
    type: item.t || item.aircraft_icao || null,
    lat,
    lon,
    altitude: item.alt_baro ?? item.alt_geom ?? item.alt ?? null,
    speed: item.gs ?? item.speed ?? null,
    heading: item.track ?? item.dir ?? null,
    seen: item.seen ?? null,
  };
}

function cacheKey(origin, query) {
  return new Request(`${origin}/__skytrace_aircraft_search/${encodeURIComponent(query)}`, {
    method: 'GET',
  });
}

async function cacheResult(origin, query, payload, seconds, context) {
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${seconds}`,
    },
  });
  context.waitUntil(caches.default.put(cacheKey(origin, query), response));
}

async function requestProvider(provider, kind, query, context, origin) {
  if (await providerCoolingDown(provider, origin)) return null;

  const config = PROVIDERS[provider];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${config.base}/${config.path(kind, query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
      signal: controller.signal,
    });
    context.waitUntil(recordProviderRequest(context.env, response.status, origin, provider));

    if (response.status === 403 || response.status === 429) {
      await setProviderCooldown(
        provider,
        origin,
        cooldownSecondsForStatus(response.status, response.headers.get('retry-after')),
        context
      );
      return null;
    }

    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const aircraft = Array.isArray(payload?.ac) ? payload.ac.map(normalize).filter(Boolean) : [];
    return aircraft[0] || null;
  } catch (error) {
    const status = error instanceof Error && error.name === 'AbortError' ? 598 : 599;
    context.waitUntil(recordProviderRequest(context.env, status, origin, provider));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = url.origin;
  const query = sanitize(url.searchParams.get('q'));
  if (query.length < 3) return json({ error: 'INVALID_QUERY' }, 400);

  const cached = await caches.default.match(cacheKey(origin, query));
  if (cached) {
    const payload = await cached.json().catch(() => null);
    if (payload?.aircraft) return json(payload, 200, { 'x-skytrace-cache': 'HIT' });
    if (payload?.notFound)
      return json({ error: 'AIRCRAFT_NOT_FOUND' }, 404, { 'x-skytrace-cache': 'HIT' });
  }

  const enabled = [];
  for (const provider of PROVIDER_ORDER) {
    if (
      (await providerEnabled(context.env, provider, origin)) &&
      !(await providerCoolingDown(provider, origin))
    ) {
      enabled.push(provider);
    }
  }
  if (!enabled.length) return json({ error: 'NO_PROVIDER_AVAILABLE' }, 503);

  for (const provider of enabled) {
    for (const [kind, value] of candidates(query)) {
      const aircraft = await requestProvider(provider, kind, value, context, origin);
      if (aircraft) {
        const payload = { aircraft, source: provider };
        await cacheResult(origin, query, payload, CACHE_SECONDS, context);
        return json(payload, 200, { 'x-skytrace-cache': 'MISS' });
      }
      if (await providerCoolingDown(provider, origin)) break;
    }
  }

  await cacheResult(origin, query, { notFound: true }, NEGATIVE_CACHE_SECONDS, context);
  return json({ error: 'AIRCRAFT_NOT_FOUND' }, 404);
}
