const CONTROL_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROVIDERS = ['adsb.lol', 'airplanes.live', 'airlabs', 'planespotters.net'];

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
    updatedAt: null,
  };
  if (!stored || typeof stored !== 'object') return base;
  const pausedUntil = stored.pausedUntil || null;
  const paused = pausedUntil ? Date.parse(pausedUntil) > Date.now() : stored.enabled === false;
  return {
    ...base,
    ...stored,
    enabled: !paused,
    pausedUntil: paused ? pausedUntil : null,
  };
}

function providerAccessAvailable(env, provider) {
  // Since August 2026 Airplanes.live's free API is restricted to approved feeder IPs.
  // Keep it disabled on generic Cloudflare egress unless the deployment owner explicitly
  // confirms feeder/developer access with AIRPLANES_LIVE_ACCESS=1.
  if (provider === 'airplanes.live') return String(env?.AIRPLANES_LIVE_ACCESS || '') === '1';
  return true;
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
    await writeProviderControl(env, provider, { enabled: true, pausedUntil: null }, origin);
  }
  return {
    ...normalized,
    enabled: normalized.enabled && providerAccessAvailable(env, provider),
    accessConfigured: providerAccessAvailable(env, provider),
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

export async function providerEnabled(env, provider, origin) {
  return (await readProviderControl(env, provider, origin)).enabled;
}
