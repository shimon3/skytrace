import {
  getDailyLimit,
  readStats,
  recordCacheHit,
  recordFallbackActivation,
  recordQuotaBlocked,
  recordUpstreamRequest,
  utcDay,
} from '../lib/stats.js';

const AIRPLANES_LIVE_BASE = 'https://api.airplanes.live/v2/point';
const ADSB_LOL_BASE = 'https://api.adsb.lol/v2/point';
const CACHE_TTL_SECONDS = 180;
const UPSTREAM_TIMEOUT_MS = 10000;
const COORDINATE_BUCKET_DEGREES = 0.25;

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bucketCoordinate(value) {
  return Math.round(value / COORDINATE_BUCKET_DEGREES) * COORDINATE_BUCKET_DEGREES;
}

function validAircraftPayload(payload) {
  return payload && typeof payload === 'object' && Array.isArray(payload.ac);
}

async function fetchProvider(provider, upstreamUrl, context, origin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    context.waitUntil(recordUpstreamRequest(context.env, response.status, origin, provider));

    if (!response.ok || !validAircraftPayload(payload)) {
      return {
        ok: false,
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
      };
    }

    return {
      ok: true,
      status: response.status,
      payload,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    context.waitUntil(recordUpstreamRequest(context.env, timedOut ? 598 : 599, origin, provider));
    return { ok: false, status: timedOut ? 598 : 599 };
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseNumber(url.searchParams.get('lat'));
  const lon = parseNumber(url.searchParams.get('lon'));
  const radius = parseNumber(url.searchParams.get('radius'));

  if (
    lat == null ||
    lon == null ||
    radius == null ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    radius <= 0 ||
    radius > 250
  ) {
    return jsonResponse({ error: 'INVALID_QUERY' }, 400);
  }

  const normalizedLat = bucketCoordinate(lat).toFixed(2);
  const normalizedLon = bucketCoordinate(lon).toFixed(2);
  const normalizedRadius = Math.round(radius);

  const cacheKeyUrl = new URL(url.origin + '/api/aircraft');
  cacheKeyUrl.searchParams.set('lat', normalizedLat);
  cacheKeyUrl.searchParams.set('lon', normalizedLon);
  cacheKeyUrl.searchParams.set('radius', String(normalizedRadius));

  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);

  if (cached) {
    context.waitUntil(recordCacheHit(context.env, url.origin));
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        'content-type': cached.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=0',
      },
    });
  }

  const stats = await readStats(context.env, utcDay(), url.origin);
  const dailyLimit = getDailyLimit();
  let result = null;
  let primaryRetryAfter = null;

  if (stats.airplanesLiveRequests < dailyLimit) {
    const primaryUrl = `${AIRPLANES_LIVE_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;
    const primary = await fetchProvider('airplanes.live', primaryUrl, context, url.origin);

    if (primary.ok) {
      result = primary;
    } else {
      primaryRetryAfter = primary.retryAfter;
      context.waitUntil(recordFallbackActivation(context.env, url.origin));
    }
  } else {
    context.waitUntil(recordQuotaBlocked(context.env, url.origin));
    context.waitUntil(recordFallbackActivation(context.env, url.origin));
  }

  if (!result) {
    const fallbackUrl = `${ADSB_LOL_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;
    result = await fetchProvider('adsb.lol', fallbackUrl, context, url.origin);
  }

  if (!result.ok) {
    const headers = {};
    if (primaryRetryAfter) headers['retry-after'] = primaryRetryAfter;
    return jsonResponse({ error: 'DATA_TEMPORARILY_UNAVAILABLE' }, 502, headers);
  }

  const body = JSON.stringify(result.payload);
  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0',
    },
  });

  const cacheResponse = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, cacheResponse));

  return response;
}
