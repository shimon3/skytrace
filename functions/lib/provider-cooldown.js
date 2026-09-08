const COOLDOWN_PREFIX = '/__skytrace_provider_cooldown/';
const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;

function key(origin, provider) {
  return new Request(`${origin}${COOLDOWN_PREFIX}${encodeURIComponent(provider)}`, {
    method: 'GET',
  });
}

export async function providerCoolingDown(provider, origin) {
  const cached = await caches.default.match(key(origin, provider));
  return Boolean(cached);
}

export async function setProviderCooldown(provider, origin, seconds, context) {
  const ttl = Math.max(10, Math.min(Number(seconds) || 60, MAX_COOLDOWN_SECONDS));
  const response = new Response(String(Date.now() + ttl * 1000), {
    headers: { 'cache-control': `public, max-age=${ttl}` },
  });
  const put = caches.default.put(key(origin, provider), response);
  if (context?.waitUntil) context.waitUntil(put);
  else await put;
}

export function cooldownSecondsForStatus(status, retryAfter) {
  const retry = Number(retryAfter);
  if (Number.isFinite(retry) && retry > 0) return Math.min(retry, MAX_COOLDOWN_SECONDS);
  if (status === 403) return 6 * 60 * 60;
  if (status === 429) return 30 * 60;
  return 60;
}
