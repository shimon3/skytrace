const PROVIDERS = [
  {
    name: 'adsb.fi',
    url: (lat, lon, radius) =>
      `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radius}`,
  },
  {
    name: 'adsb.lol',
    url: (lat, lon, radius) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`,
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function testProvider(provider, lat, lon, radius) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(provider.url(lat, lon, radius), {
      headers: { accept: 'application/json', 'user-agent': 'SkyTrace-Diagnostics/1.0' },
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const aircraft = Array.isArray(payload?.ac) ? payload.ac : [];
    return {
      provider: provider.name,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      aircraft: aircraft.length,
      retryAfter: response.headers.get('retry-after'),
      payloadValid: Array.isArray(payload?.ac),
    };
  } catch (error) {
    return {
      provider: provider.name,
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      aircraft: 0,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = Number(url.searchParams.get('lat') || 31.5);
  const lon = Number(url.searchParams.get('lon') || 34.8);
  const radius = Math.min(250, Math.max(1, Number(url.searchParams.get('radius') || 250)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) {
    return json({ error: 'INVALID_COORDINATES' }, 400);
  }

  const startedAt = Date.now();
  const providers = [];
  for (const provider of PROVIDERS) providers.push(await testProvider(provider, lat, lon, radius));

  let skytrace = null;
  try {
    const apiUrl = new URL('/api/aircraft', url.origin);
    apiUrl.searchParams.set('lat', String(lat));
    apiUrl.searchParams.set('lon', String(lon));
    apiUrl.searchParams.set('radius', String(radius));
    const response = await fetch(apiUrl.toString(), { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    skytrace = {
      ok: response.ok,
      status: response.status,
      aircraft: Array.isArray(payload?.ac) ? payload.ac.length : 0,
      cache: response.headers.get('x-skytrace-cache'),
      provider: response.headers.get('x-skytrace-provider'),
      payloadValid: Array.isArray(payload?.ac),
      error: response.ok ? null : payload?.error || payload?.message || null,
    };
  } catch (error) {
    skytrace = { ok: false, error: String(error?.message || error) };
  }

  return json({
    generatedAt: new Date().toISOString(),
    location: { lat, lon, radiusNm: radius },
    elapsedMs: Date.now() - startedAt,
    providers,
    skytrace,
  });
}
