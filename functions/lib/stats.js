import {
  autoPauseProvider,
  getAutoPausePercent,
  getProviderDailyBudget,
  providerUsagePercent,
} from './provider-controls.js';

const DAILY_LIMIT = 500;
const FALLBACK_TTL_SECONDS = 172800;
const HTTP_403_PAUSE_SECONDS = 6 * 60 * 60;
const HTTP_429_PAUSE_SECONDS = 30 * 60;

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcHour(date = new Date()) {
  return String(date.getUTCHours()).padStart(2, '0');
}

export function emptyStats(day = utcDay()) {
  return {
    day,
    requests: 0,
    successes: 0,
    failures: 0,
    cacheHits: 0,
    quotaBlocked: 0,
    airplanesLiveRequests: 0,
    adsbLolRequests: 0,
    adsbFiRequests: 0,
    fallbackActivations: 0,
    retries: 0,
    retrySuccesses: 0,
    retryFailures: 0,
    lastProvider: null,
    lastRequestAt: null,
    lastStatus: null,
    hourly: {},
    providers: {},
  };
}

export function getDailyLimit() {
  return DAILY_LIMIT;
}

function storageKey(day) {
  return `airplanes-live:${day}`;
}

function fallbackRequest(day, origin = 'https://skytrace.internal') {
  return new Request(`${origin}/__private_stats/${day}`);
}

function normalizeStats(stored, day) {
  const base = emptyStats(day);
  if (!stored || typeof stored !== 'object') return base;
  return {
    ...base,
    ...stored,
    hourly: stored.hourly && typeof stored.hourly === 'object' ? stored.hourly : {},
    providers: stored.providers && typeof stored.providers === 'object' ? stored.providers : {},
  };
}

export async function readStats(env, day = utcDay(), origin) {
  const key = storageKey(day);

  if (env?.SKYTRACE_STATS?.get) {
    const stored = await env.SKYTRACE_STATS.get(key, { type: 'json' });
    return normalizeStats(stored, day);
  }

  const cached = await caches.default.match(fallbackRequest(day, origin));
  if (!cached) return emptyStats(day);
  try {
    return normalizeStats(await cached.json(), day);
  } catch {
    return emptyStats(day);
  }
}

export async function writeStats(env, stats, origin) {
  const key = storageKey(stats.day);

  if (env?.SKYTRACE_STATS?.put) {
    await env.SKYTRACE_STATS.put(key, JSON.stringify(stats), {
      expirationTtl: FALLBACK_TTL_SECONDS,
    });
    return;
  }

  await caches.default.put(
    fallbackRequest(stats.day, origin),
    new Response(JSON.stringify(stats), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${FALLBACK_TTL_SECONDS}`,
      },
    })
  );
}

export async function recordCacheHit(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.cacheHits += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordQuotaBlocked(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.quotaBlocked += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordFallbackActivation(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.fallbackActivations += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordRetryAttempt(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.retries += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordRetrySuccess(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.retrySuccesses += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordRetryFailure(env, origin) {
  const stats = await readStats(env, utcDay(), origin);
  stats.retryFailures += 1;
  await writeStats(env, stats, origin);
  return stats;
}

export async function recordProviderRequest(env, status, origin, provider = 'unknown') {
  const now = new Date();
  const stats = await readStats(env, utcDay(now), origin);
  stats.requests += 1;

  if (provider === 'airplanes.live') stats.airplanesLiveRequests += 1;
  if (provider === 'adsb.lol') stats.adsbLolRequests += 1;
  if (provider === 'adsb.fi') stats.adsbFiRequests += 1;

  if (status >= 200 && status < 300) stats.successes += 1;
  else stats.failures += 1;

  const hour = utcHour(now);
  const bucket = stats.hourly[hour] || { requests: 0, successes: 0, failures: 0 };
  bucket.requests += 1;
  if (status >= 200 && status < 300) bucket.successes += 1;
  else bucket.failures += 1;
  stats.hourly[hour] = bucket;

  const providerStats = stats.providers[provider] || {
    requests: 0,
    successes: 0,
    failures: 0,
    lastStatus: null,
    lastRequestAt: null,
  };
  providerStats.requests += 1;
  if (status >= 200 && status < 300) providerStats.successes += 1;
  else providerStats.failures += 1;
  providerStats.lastStatus = status;
  providerStats.lastRequestAt = now.toISOString();
  stats.providers[provider] = providerStats;

  stats.lastProvider = provider;
  stats.lastRequestAt = now.toISOString();
  stats.lastStatus = status;
  await writeStats(env, stats, origin);

  if (status === 403) {
    await autoPauseProvider(env, provider, origin, 'HTTP_403', {
      seconds: HTTP_403_PAUSE_SECONDS,
    });
    return stats;
  }

  if (status === 429) {
    await autoPauseProvider(env, provider, origin, 'HTTP_429', {
      seconds: HTTP_429_PAUSE_SECONDS,
    });
    return stats;
  }

  if (provider !== 'unknown') {
    const budget = getProviderDailyBudget(env, provider);
    const percent = providerUsagePercent(providerStats.requests, budget);
    const threshold = getAutoPausePercent(env);

    // AirLabs is currently the only healthy live-position source in production.
    // Do not globally disable it merely because SkyTrace's conservative local
    // safety budget was reached. Real upstream 403/429 responses are still
    // handled above and will pause the provider normally.
    if (provider !== 'airlabs' && percent >= threshold) {
      await autoPauseProvider(env, provider, origin, 'SAFETY_BUDGET');
    }
  }

  return stats;
}

export const recordUpstreamRequest = recordProviderRequest;
