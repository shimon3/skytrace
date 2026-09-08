import { providerEnabled } from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

const PROVIDERS = {
  'adsb.lol': 'https://api.adsb.lol/v2',
  'airplanes.live': 'https://api.airplanes.live/v2',
};
const CACHE_SECONDS = 30;
const TIMEOUT_MS = 8000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
      'x-content-type-options': 'nosniff',
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

async function requestProvider(provider, kind, query, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${PROVIDERS[provider]}/${kind}/${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)' },
      signal: controller.signal,
    });
    context.waitUntil(recordProviderRequest(context.env, response.status, new URL(context.request.url).origin, provider));
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const aircraft = Array.isArray(payload?.ac) ? payload.ac.map(normalize).filter(Boolean) : [];
    return aircraft[0] || null;
  } catch (error) {
    const status = error instanceof Error && error.name === 'AbortError' ? 598 : 599;
    context.waitUntil(recordProviderRequest(context.env, status, new URL(context.request.url).origin, provider));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const query = sanitize(new URL(context.request.url).searchParams.get('q'));
  if (query.length < 3) return json({ error: 'INVALID_QUERY' }, 400);

  const enabled = [];
  for (const provider of Object.keys(PROVIDERS)) {
    if (await providerEnabled(context.env, provider, new URL(context.request.url).origin)) enabled.push(provider);
  }
  if (!enabled.length) return json({ error: 'NO_PROVIDER_AVAILABLE' }, 503);

  for (const provider of enabled) {
    for (const [kind, value] of candidates(query)) {
      const aircraft = await requestProvider(provider, kind, value, context);
      if (aircraft) return json({ aircraft, source: provider });
    }
  }
  return json({ error: 'AIRCRAFT_NOT_FOUND' }, 404);
}
