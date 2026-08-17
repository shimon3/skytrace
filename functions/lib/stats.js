const DAILY_LIMIT = 500;
const FALLBACK_TTL_SECONDS = 172800;

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
    fallbackActivations: 0,
    lastProvider: null,
    lastRequestAt: null,
    lastStatus: null,
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

export async function readStats(env, day = utcDay(), origin) {
  const key = storageKey(day);

  if (env?.SKYTRACE_STATS?.get) {
    const stored = await env.SKYTRACE_STATS.get(key, { type: 'json' });
    return stored && typeof stored === 'object' ? { ...emptyStats(day), ...stored } : emptyStats(day);
  }

  const cached = await caches.default.match(fallbackRequest(day, origin));
  if (!cached) return emptyStats(day);
  try {
    const stored = await cached.json();
    return stored && typeof stored === 'object' ? { ...emptyStats(day), ...stored } : emptyStats(day);
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

export async function recordUpstreamRequest(env, status, origin, provider = 'unknown') {
  const stats = await readStats(env, utcDay(), origin);
  stats.requests += 1;

  if (provider === 'airplanes.live') stats.airplanesLiveRequests += 1;
  if (provider === 'adsb.lol') stats.adsbLolRequests += 1;

  if (status >= 200 && status < 300) stats.successes += 1;
  else stats.failures += 1;

  stats.lastProvider = provider;
  stats.lastRequestAt = new Date().toISOString();
  stats.lastStatus = status;
  await writeStats(env, stats, origin);
  return stats;
}
