import { recordProviderRequest } from '../lib/stats.js';

const PHOTO_ENDPOINT = 'https://api.planespotters.net/pub/photos/reg';
const CACHE_SECONDS = 86400;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=3600, s-maxage=${CACHE_SECONDS}` : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function sanitizeRegistration(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 16);
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const registration = sanitizeRegistration(requestUrl.searchParams.get('registration'));
  if (!registration) return json({ error: 'INVALID_REGISTRATION' }, 400);

  const cacheKey = new Request(`${requestUrl.origin}/api/photo?registration=${encodeURIComponent(registration)}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch(`${PHOTO_ENDPOINT}/${encodeURIComponent(registration)}`, {
      headers: { accept: 'application/json' },
    });
    context.waitUntil(recordProviderRequest(context.env, upstream.status, requestUrl.origin, 'planespotters.net'));
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json({ error: 'PHOTO_PROVIDER_ERROR' }, upstream.status);

    const url = payload?.photos?.[0]?.thumbnail_large?.src || null;
    const response = json({ url });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    context.waitUntil(recordProviderRequest(context.env, 599, requestUrl.origin, 'planespotters.net'));
    return json({ error: 'PHOTO_PROVIDER_UNAVAILABLE' }, 502);
  }
}
