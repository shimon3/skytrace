import { providerEnabled } from '../lib/provider-controls.js';
import {
  getDailyLimit,
  readStats,
  recordCacheHit,
  recordFallbackActivation,
  recordQuotaBlocked,
  recordRetryAttempt,
  recordRetryFailure,
  recordRetrySuccess,
  recordUpstreamRequest,
  utcDay,
} from '../lib/stats.js';

const AIRPLANES_LIVE_BASE = 'https://api.airplanes.live/v2/point';
const ADSB_LOL_BASE = 'https://api.adsb.lol/v2/point';
const BROAD_CACHE_TTL_SECONDS = 300;
const DETAIL_CACHE_TTL_SECONDS = 120;
const STALE_TTL_SECONDS = 1800;
const UPSTREAM_TIMEOUT_MS = 10000;
const COORDINATE_BUCKET_DEGREES = 0.5;
const RATE_LIMIT_PER_MINUTE = 60;

// Statuses worth a single retry: upstream/gateway hiccups (502/503/504) and
// our own timeout/network-failure sentinels (598/599, set below). Never
// retried: 4xx (bad request, auth, not found, our own 429) and quota blocks,
// since those won't succeed on a second attempt.
const RETRYABLE_STATUSES = new Set([502, 503, 504, 598, 599]);
const RETRY_BACKOFF_MS = 700;
const RETRY_BACKOFF_MAX_MS = 5000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(retryAfterHeader) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, RETRY_BACKOFF_MAX_MS);
  }
  return RETRY_BACKOFF_MS;
}

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

async function consumeRateLimit(request, origin) {
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request(
    `${origin}/__skytrace_rate_limit/${encodeURIComponent(clientIp)}/${minute}`,
    { method: 'GET' }
  );
  const cache = caches.default;
  const existing = await cache.match(key);
  let count = 0;

  if (existing) {
    const value = Number(await existing.text());
    count = Number.isFinite(value) ? value : 0;
  }

  if (count >= RATE_LIMIT_PER_MINUTE) return false;

  await cache.put(
    key,
    new Response(String(count + 1), {
      headers: { 'cache-control': 'public, max-age=70' },
    })
  );
  return true;
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
        provider,
      };
    }

    return { ok: true, status: response.status, payload, provider };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    context.waitUntil(recordUpstreamRequest(context.env, timedOut ? 598 : 599, origin, provider));
    return { ok: false, status: timedOut ? 598 : 599, provider };
  } finally {
    clearTimeout(timeout);
  }
}

// Exactly one retry, only for transient failures (never a loop). 4xx
// responses (bad request, auth, not found, our own 429) and quota blocks
// never reach here as retryable — quota is decided by the caller before
// fetchProvider ever runs, and 4xx statuses are simply absent from
// RETRYABLE_STATUSES.
async function fetchProviderWithRetry(provider, upstreamUrl, context, origin) {
  const initial = await fetchProvider(provider, upstreamUrl, context, origin);
  if (initial.ok || !RETRYABLE_STATUSES.has(initial.status)) return initial;

  // Awaited rather than handed to context.waitUntil: retries/retrySuccesses/
  // retryFailures share one read-modify-write record with every other stat
  // counter, so firing them off unsequenced (even via waitUntil) races with
  // the other provider's own retry bookkeeping and silently drops
  // increments. The retry backoff below already delays the response, so
  // awaiting this adds no meaningful extra latency.
  await recordRetryAttempt(context.env, origin);
  await wait(retryDelayMs(initial.retryAfter));

  const retry = await fetchProvider(provider, upstreamUrl, context, origin);
  await (retry.ok ? recordRetrySuccess(context.env, origin) : recordRetryFailure(context.env, origin));
  return retry;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseNumber(url.searchParams.get('lat'));
  const lon = parseNumber(url.searchParams.get('lon'));
  const radius = parseNumber(url.searchParams.get('radius'));
  const preferAdsbLol = url.searchParams.get('prefer') === 'adsb.lol';
  const detailed = url.searchParams.get('detail') === '1';

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
  const cacheTtlSeconds = detailed ? DETAIL_CACHE_TTL_SECONDS : BROAD_CACHE_TTL_SECONDS;

  const cacheKeyUrl = new URL(url.origin + '/api/aircraft');
  cacheKeyUrl.searchParams.set('lat', normalizedLat);
  cacheKeyUrl.searchParams.set('lon', normalizedLon);
  cacheKeyUrl.searchParams.set('radius', String(normalizedRadius));
  cacheKeyUrl.searchParams.set('freshness', detailed ? 'detail' : 'broad');

  const staleKeyUrl = new URL(cacheKeyUrl);
  staleKeyUrl.pathname = '/api/aircraft-stale';

  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const staleKey = new Request(staleKeyUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);

  if (cached) {
    context.waitUntil(recordCacheHit(context.env, url.origin));
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        'content-type': cached.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=0',
        'x-skytrace-cache': 'HIT',
      },
    });
  }

  if (!(await consumeRateLimit(context.request, url.origin))) {
    return jsonResponse({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' });
  }

  const stale = await cache.match(staleKey);
  const stats = await readStats(context.env, utcDay(), url.origin);
  const dailyLimit = getDailyLimit();
  const [adsbEnabled, airplanesEnabled] = await Promise.all([
    providerEnabled(context.env, 'adsb.lol', url.origin),
    providerEnabled(context.env, 'airplanes.live', url.origin),
  ]);
  const adsbUrl = `${ADSB_LOL_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;
  const airplanesUrl = `${AIRPLANES_LIVE_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;

  let result = null;
  let retryAfter = null;

  if (preferAdsbLol) {
    if (adsbEnabled) {
      const primary = await fetchProviderWithRetry('adsb.lol', adsbUrl, context, url.origin);
      if (primary.ok) result = primary;
    }
    if (!result && airplanesEnabled && stats.airplanesLiveRequests < dailyLimit) {
      // Awaited (not waitUntil): stats.js does an unlocked read-modify-write,
      // so an unsequenced write here can race the fallback attempt's own
      // retry bookkeeping below and silently drop one of the two increments.
      await recordFallbackActivation(context.env, url.origin);
      const fallback = await fetchProviderWithRetry(
        'airplanes.live',
        airplanesUrl,
        context,
        url.origin
      );
      retryAfter = fallback.retryAfter;
      if (fallback.ok) result = fallback;
    } else if (!result && airplanesEnabled && stats.airplanesLiveRequests >= dailyLimit) {
      await recordQuotaBlocked(context.env, url.origin);
    }
  } else {
    if (airplanesEnabled && stats.airplanesLiveRequests < dailyLimit) {
      const primary = await fetchProviderWithRetry(
        'airplanes.live',
        airplanesUrl,
        context,
        url.origin
      );
      retryAfter = primary.retryAfter;
      if (primary.ok) result = primary;
      else if (adsbEnabled) await recordFallbackActivation(context.env, url.origin);
    } else if (airplanesEnabled && stats.airplanesLiveRequests >= dailyLimit) {
      await recordQuotaBlocked(context.env, url.origin);
      if (adsbEnabled) await recordFallbackActivation(context.env, url.origin);
    }

    if (!result && adsbEnabled) {
      const fallback = await fetchProviderWithRetry('adsb.lol', adsbUrl, context, url.origin);
      if (fallback.ok) result = fallback;
    }
  }

  if (!result) {
    if (stale) {
      context.waitUntil(recordCacheHit(context.env, url.origin));
      return new Response(stale.body, {
        status: 200,
        headers: {
          'content-type': stale.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': 'private, max-age=0',
          'x-skytrace-cache': 'STALE',
          warning: '110 - "Response is stale"',
        },
      });
    }

    const headers = {};
    if (retryAfter) headers['retry-after'] = retryAfter;
    return jsonResponse({ error: 'DATA_TEMPORARILY_UNAVAILABLE' }, 502, headers);
  }

  const body = JSON.stringify(result.payload);
  const freshResponse = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${cacheTtlSeconds}`,
      'x-skytrace-provider': result.provider,
    },
  });
  const staleResponse = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${STALE_TTL_SECONDS}`,
      'x-skytrace-provider': result.provider,
    },
  });

  context.waitUntil(
    Promise.all([cache.put(cacheKey, freshResponse), cache.put(staleKey, staleResponse)])
  );

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0',
      'x-skytrace-cache': 'MISS',
      'x-skytrace-provider': result.provider,
    },
  });
}
