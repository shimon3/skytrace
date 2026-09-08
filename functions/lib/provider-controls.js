const CONTROL_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROVIDERS = ['adsb.fi', 'adsb.lol', 'airplanes.live', 'airlabs', 'planespotters.net'];

// These are SkyTrace safety budgets, not claims about the providers' official quotas.
// They can all be overridden in Cloudflare Pages environment variables.
const DEFAULT_DAILY_BUDGETS = {
  'adsb.fi': 1000,
  'adsb.lol': 500,
  'airplanes.live': 500,
  airlabs: 100,
  'planespotters.net': 500,
};

const BUDGET_ENV_KEYS = {
  'adsb.fi': 'ADSB_FI_DAILY_BUDGET',
  'adsb.lol': 'ADSB_LOL_DAILY_BUDGET',
  'airplanes.live': 'AIRPLANES_LIVE_DAILY_BUDGET',
  airlabs: 'AIRLABS_DAILY_BUDGET',
  'planespotters.net': 'PLANESPOTTERS_DAILY_BUDGET',
};

function storageKey(provider) {
  return `provider-control:${provider}`;
}

function fallbackRequest(provider, origin = 'https://skytrace.internal') {
  return new Request(`${origin}/__private_provider_control/${encodeURIComponent(provider)}`);
}

function normalizeControl(provider, stored) {
  const base = {
    provider,
    enabled: true,
    pausedUntil: null,
    pauseReason: null,
    updatedAt: null,
  };
  if (!stored || typeof stored !== 'object') return base;

  const pausedUntil = stored.pausedUntil || null;
  const timedPauseActive = pausedUntil ? Date.parse(pausedUntil) > Date.now() : false;
  const paused = pausedUntil ? timedPauseActive : stored.enabled === false;

  return {
    ...base,
    ...stored,
    enabled: !paused,
    pausedUntil: paused ? pausedUntil : null,
    pauseReason: paused ? stored.pauseReason || null : null,
  };
}

function providerAccessAvailable(env, provider) {
  if (provider === 'airplanes.live') return String(env?.AIRPLANES_LIVE_ACCESS || '') === '1';
  if (provider === 'airlabs') return Boolean(String(env?.AIRLABS_API_KEY || '').trim());
  return true;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function getProviderDailyBudget(env, provider) {
  const fallback = DEFAULT_DAILY_BUDGETS[provider] || 500;
  const envKey = BUDGET_ENV_KEYS[provider];
  return positiveInteger(envKey ? env?.[envKey] : null, fallback);
}

export function getAutoPausePercent(env) {
  const value = Number(env?.PROVIDER_AUTO_PAUSE_PERCENT);
  if (!Number.isFinite(value)) return 80;
  return Math.max(50, Math.min(95, value));
}

export function providerUsagePercent(requests, budget) {
  if (!Number.isFinite(Number(budget)) || Number(budget) <= 0) return 0;
  return Math.round((Number(requests || 0) / Number(budget)) * 1000) / 10;
}

function nextUtcMidnightIso() {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

export function isKnownProvider(provider) {
  return PROVIDERS.includes(provider);
}

export async function readProviderControl(env, provider, origin) {
  if (!isKnownProvider(provider)) throw new Error('UNKNOWN_PROVIDER');
  let stored = null;
  if (env?.SKYTRACE_STATS?.get) {
    stored = await env.SKYTRACE_STATS.get(storageKey(provider), { type: 'json' });
  } else {
    const cached = await caches.default.match(fallbackRequest(provider, origin));
    if (cached) stored = await cached.json().catch(() => null);
  }

  const normalized = normalizeControl(provider, stored);
  if (stored && !normalized.pausedUntil && stored.pausedUntil) {
    await writeProviderControl(
      env,
      provider,
      { enabled: true, pausedUntil: null, pauseReason: null },
      origin
    );
  }

  const accessConfigured = providerAccessAvailable(env, provider);
  return {
    ...normalized,
    enabled: normalized.enabled && accessConfigured,
    accessConfigured,
  };
}

export async function readAllProviderControls(env, origin) {
  return Promise.all(PROVIDERS.map((provider) => readProviderControl(env, provider, origin)));
}

export async function writeProviderControl(env, provider, value, origin) {
  if (!isKnownProvider(provider)) throw new Error('UNKNOWN_PROVIDER');
  const control = {
    provider,
    enabled: value.enabled !== false,
    pausedUntil: value.pausedUntil || null,
    pauseReason: value.pauseReason || null,
    updatedAt: new Date().toISOString(),
  };

  if (env?.SKYTRACE_STATS?.put) {
    await env.SKYTRACE_STATS.put(storageKey(provider), JSON.stringify(control), {
      expirationTtl: CONTROL_TTL_SECONDS,
    });
  } else {
    await caches.default.put(
      fallbackRequest(provider, origin),
      new Response(JSON.stringify(control), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${CONTROL_TTL_SECONDS}`,
        },
      })
    );
  }
  return readProviderControl(env, provider, origin);
}

export async function autoPauseProvider(env, provider, origin, reason, options = {}) {
  if (!isKnownProvider(provider)) return null;
  const seconds = Number(options.seconds);
  const pausedUntil =
    Number.isFinite(seconds) && seconds > 0
      ? new Date(Date.now() + Math.min(seconds, 24 * 60 * 60) * 1000).toISOString()
      : nextUtcMidnightIso();

  return writeProviderControl(
    env,
    provider,
    { enabled: false, pausedUntil, pauseReason: reason || 'AUTO_PAUSE' },
    origin
  );
}

export async function providerEnabled(env, provider, origin) {
  return (await readProviderControl(env, provider, origin)).enabled;
}
