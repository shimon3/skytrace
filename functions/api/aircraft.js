const UPSTREAM_BASE = 'https://api.airplanes.live/v2/point';
const CACHE_TTL_SECONDS = 15;

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
    return jsonResponse({ error: 'INVALID_AIRCRAFT_QUERY' }, 400);
  }

  const normalizedLat = lat.toFixed(4);
  const normalizedLon = lon.toFixed(4);
  const normalizedRadius = Math.round(radius);
  const cacheKeyUrl = new URL(url.origin + '/api/aircraft');
  cacheKeyUrl.searchParams.set('lat', normalizedLat);
  cacheKeyUrl.searchParams.set('lon', normalizedLon);
  cacheKeyUrl.searchParams.set('radius', String(normalizedRadius));
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-skytrace-cache', 'HIT');
    return new Response(cached.body, {
      status: cached.status,
      headers,
    });
  }

  const upstreamUrl = `${UPSTREAM_BASE}/${normalizedLat}/${normalizedLon}/${normalizedRadius}`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/1.0 (+https://skytrace-83z.pages.dev)',
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'AIRCRAFT_UPSTREAM_UNREACHABLE',
        message: error instanceof Error ? error.message : String(error),
      },
      502
    );
  }

  const body = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`,
    'x-skytrace-cache': 'MISS',
    'x-skytrace-upstream-status': String(upstream.status),
  });

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  const response = new Response(body, {
    status: upstream.status,
    headers,
  });

  if (upstream.ok) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}
