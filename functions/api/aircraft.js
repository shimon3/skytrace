import { providerEnabled } from '../lib/provider-controls.js';
import {
  cooldownSecondsForStatus,
  providerCoolingDown,
  setProviderCooldown,
} from '../lib/provider-cooldown.js';
import {
  readStats,
  recordCacheHit,
  recordFallbackActivation,
  recordRetryAttempt,
  recordRetryFailure,
  recordRetrySuccess,
  recordUpstreamRequest,
  utcDay,
} from '../lib/stats.js';

const PROVIDERS = {
  'adsb.fi': {
    point(lat, lon, radius) {
      return `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radius}`;
    },
  },
  'adsb.lol': {
    point(lat, lon, radius) {
      return `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`;
    },
  },
  'airplanes.live': {
    point(lat, lon, radius) {
      return `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}`;
    },
  },
};

const PROVIDER_ORDER = ['adsb.fi', 'adsb.lol', 'airplanes.live'];
const BROAD_CACHE_TTL_SECONDS = 300;
const DETAIL_CACHE_TTL_SECONDS = 120;
const STALE_TTL_SECONDS = 1800;
const UPSTREAM_TIMEOUT_MS = 2800;
const COORDINATE_BUCKET_DEGREES = 1;
const RATE_LIMIT_PER_MINUTE = 60;
const RETRYABLE_STATUSES = new Set([502, 503, 504, 598, 599]);
const RETRY_BACKOFF_MS = 250;
const RETRY_BACKOFF_MAX_MS = 1200;

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
  if (await providerCoolingDown(provider, origin)) {
    return { ok: false, status: 503, provider, cooledDown: true, reason: 'COOLDOWN' };
  }

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

    if (response.status === 403 || response.status === 429) {
      await setProviderCooldown(
        provider,
        origin,
        cooldownSecondsForStatus(response.status, response.headers.get('retry-after')),
        context
      );
    }

    if (!response.ok || !validAircraftPayload(payload)) {
      return {
        ok: false,
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        provider,
        reason: !response.ok ? 'UPSTREAM_HTTP' : 'INVALID_PAYLOAD',
      };
    }

    return { ok: true, status: response.status, payload, provider };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const status = timedOut ? 598 : 599;
    context.waitUntil(recordUpstreamRequest(context.env, status, origin, provider));
    return { ok: false, status, provider, reason: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timeout);
  }
}

function staleResponse(stale, cacheState = 'STALE') {
  return new Response(stale.body, {
    status: 200,
    headers: {
      'content-type': stale.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=20, stale-while-revalidate=120',
      'x-skytrace-cache': cacheState,
      'x-skytrace-provider': stale.headers.get('x-skytrace-provider') || 'cache',
      warning: '110 - "Response is stale"',
    },
  });
}

async function getActiveProviders(context, origin) {
  const active = [];
  const diagnostics = [];
  for (const provider of PROVIDER_ORDER) {
    const enabled = await providerEnabled(context.env, provider, origin);
    if (!enabled) {
      diagnostics.push({ provider, attempted: false, reason: 'DISABLED_OR_PAUSED' });
      continue;
    }
    if (await providerCoolingDown(provider, origin)) {
      diagnostics.push({ provider, attempted: false, reason: 'COOLDOWN' });
      continue;
    }
    active.push(provider);
  }
  return { active, diagnostics };
}

async function firstPass(
  providers,
  normalizedLat,
  normalizedLon,
  normalizedRadius,
  context,
  origin
) {
  const attempts = [];
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    if (index > 0) await recordFallbackActivation(context.env, origin);
    const upstreamUrl = PROVIDERS[provider].point(normalizedLat, normalizedLon, normalizedRadius);
    const candidate = await fetchProvider(provider, upstreamUrl, context, origin);
    attempts.push(candidate);
    if (candidate.ok) return { result: candidate, attempts };
  }
  return { result: null, attempts };
}

async function retryFailedProviders(
  attempts,
  normalizedLat,
  normalizedLon,
  normalizedRadius,
  context,
  origin
) {
  for (const attempt of attempts) {
    if (attempt.ok || attempt.cooledDown || !RETRYABLE_STATUSES.has(attempt.status)) continue;
    if (await providerCoolingDown(attempt.provider, origin)) continue;

    await recordRetryAttempt(context.env, origin);
    await wait(retryDelayMs(attempt.retryAfter));
    const upstreamUrl = PROVIDERS[attempt.provider].point(
      normalizedLat,
      normalizedLon,
      normalizedRadius
    );
    const retry = await fetchProvider(attempt.provider, upstreamUrl, context, origin);
    if (retry.ok) {
      await recordRetrySuccess(context.env, origin);
      return retry;
    }
    await recordRetryFailure(context.env, origin);
  }
  return null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseNumber(url.searchParams.get('lat'));
  const lon = parseNumber(url.searchParams.get('lon'));
  const radius = parseNumber(url.searchParams.get('radius'));
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
        'cache-control': 'public, max-age=20, stale-while-revalidate=120',
        'x-skytrace-cache': 'HIT',
        'x-skytrace-provider': cached.headers.get('x-skytrace-provider') || 'cache',
      },
    });
  }

  const stale = await cache.match(staleKey);

  if (!(await consumeRateLimit(context.request, url.origin))) {
    if (stale) {
      context.waitUntil(recordCacheHit(context.env, url.origin));
      return staleResponse(stale, 'STALE-RATE-LIMIT');
    }
    return jsonResponse({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' });
  }

  await readStats(context.env, utcDay(), url.origin);

  const providerState = await getActiveProviders(context, url.origin);
  const liveAttempt = await firstPass(
    providerState.active,
    normalizedLat,
    normalizedLon,
    normalizedRadius,
    context,
    url.origin
  );

  let result = liveAttempt.result;
  if (!result && liveAttempt.attempts.length) {
    result = await retryFailedProviders(
      liveAttempt.attempts,
      normalizedLat,
      normalizedLon,
      normalizedRadius,
      context,
      url.origin
    );
  }

  if (!result) {
    if (stale) {
      context.waitUntil(recordCacheHit(context.env, url.origin));
      return staleResponse(stale);
    }

    const retryAfter = liveAttempt.attempts.map((item) => item.retryAfter).find(Boolean);
    const headers = {};
    if (retryAfter) headers['retry-after'] = retryAfter;
    return jsonResponse(
      {
        error: 'DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Aucun fournisseur de positions live n’est disponible pour le moment.',
        providers: [
          ...providerState.diagnostics,
          ...liveAttempt.attempts.map((item) => ({
            provider: item.provider,
            attempted: true,
            status: item.status,
            ok: item.ok,
            reason: item.reason || null,
          })),
        ],
      },
      502,
      headers
    );
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
  const stalePayloadResponse = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${STALE_TTL_SECONDS}`,
      'x-skytrace-provider': result.provider,
    },
  });

  context.waitUntil(
    Promise.all([cache.put(cacheKey, freshResponse), cache.put(staleKey, stalePayloadResponse)])
  );

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=20, stale-while-revalidate=120',
      'x-skytrace-cache': 'MISS',
      'x-skytrace-provider': result.provider,
    },
  });
}
