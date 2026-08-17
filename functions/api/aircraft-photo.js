import { providerEnabled } from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=3600, s-maxage=86400' : 'no-store',
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

  if (!(await providerEnabled(context.env, 'planespotters.net', requestUrl.origin))) {
    return json({ error: 'PROVIDER_PAUSED' }, 503);
  }

  const cacheKey = new Request(
    `${requestUrl.origin}/api/aircraft-photo?registration=${registration}`
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch(
      `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
      { headers: { accept: 'application/json' } }
    );
    context.waitUntil(
      recordProviderRequest(context.env, upstream.status, requestUrl.origin, 'planespotters.net')
    );
    if (!upstream.ok) return json({ error: 'PHOTO_UPSTREAM_FAILED' }, upstream.status);

    const payload = await upstream.json().catch(() => ({}));
    const photo = payload.photos?.[0]?.thumbnail_large?.src || null;
    const response = json({ photo });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch {
    context.waitUntil(
      recordProviderRequest(context.env, 599, requestUrl.origin, 'planespotters.net')
    );
    return json({ error: 'PHOTO_UPSTREAM_FAILED' }, 502);
  }
}
