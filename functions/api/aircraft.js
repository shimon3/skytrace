import {
  getDailyLimit,
  readStats,
  recordCacheHit,
  recordQuotaBlocked,
  recordUpstreamRequest,
  utcDay,
} from '../lib/stats.js';

const UPSTREAM_BASE = 'https://api.airplanes.live/v2/point';
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
  if (stats.requests >= dailyLimit) {
    context.waitUntil(recordQuotaBlocked(context.env, url.origin));
    return jsonResponse(
      { error: 'DATA_TEMPORARILY_UNAVAILABLE' },
      429,
      { 'retry-after': '3600' }
    );
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    context.waitUntil(recordUpstreamRequest(context.env, 599, url.origin));
    return jsonResponse(
      { error: timedOut ? 'DATA_TIMEOUT' : 'DATA_UNAVAILABLE' },
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  context.waitUntil(recordUpstreamRequest(context.env, upstream.status, url.origin));

  const body = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': `private, max-age=0`,
  });

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  const response = new Response(body, {
    status: upstream.status,
    headers,
  });

  if (upstream.ok) {
    const cacheResponse = new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    context.waitUntil(cache.put(cacheKey, cacheResponse));
  }

  return response;
}
