import { providerEnabled } from '../lib/provider-controls.js';
import {
  cooldownSecondsForStatus,
  providerCoolingDown,
  setProviderCooldown,
} from '../lib/provider-cooldown.js';
import { recordUpstreamRequest } from '../lib/stats.js';

const FRESH_TTL_SECONDS = 60;
const EMPTY_TTL_SECONDS = 10;
const STALE_TTL_SECONDS = 900;
const KV_TTL_SECONDS = 3600;
const UPSTREAM_TIMEOUT_MS = 8000;
const RATE_LIMIT_PER_MINUTE = 60;

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bucket(value) {
  return Math.round(value * 2) / 2;
}

function bboxForRadius(lat, lon, radiusNm) {
  const latDelta = radiusNm / 60;
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusNm / (60 * cos);
  return [
    clamp(lat - latDelta, -85, 85),
    clamp(lon - lonDelta, -180, 180),
    clamp(lat + latDelta, -85, 85),
    clamp(lon + lonDelta, -180, 180),
  ].map((value) => Number(value.toFixed(3)));
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeAdsbPayload(payload) {
  return payload && Array.isArray(payload.ac) ? { ac: payload.ac } : null;
}

function normalizeAirLabsPayload(payload, centerLat, centerLon, radiusNm) {
  if (!payload || !Array.isArray(payload.response)) return null;
  const nowSeconds = Date.now() / 1000;
  const ac = payload.response
    .filter((item) => {
      const lat = number(item?.lat);
      const lon = number(item?.lng);
      return (
        item?.hex &&
        lat != null &&
        lon != null &&
        haversineNm(centerLat, centerLon, lat, lon) <= radiusNm * 1.08
      );
    })
    .map((item) => {
      const updated = number(item.updated);
      const altitudeMeters = number(item.alt);
      const speedKmh = number(item.speed);
      return {
        hex: String(item.hex).toLowerCase(),
        flight: item.flight_iata || item.flight_icao || '',
        r: item.reg_number || '',
        t: item.aircraft_icao || '',
        lat: number(item.lat),
        lon: number(item.lng),
        alt_baro: altitudeMeters != null ? altitudeMeters / 0.3048 : null,
        gs: speedKmh != null ? speedKmh / 1.852 : null,
        track: number(item.dir),
        squawk: item.squawk || '',
        seen_pos: updated != null ? Math.max(0, nowSeconds - updated) : 0,
      };
    });
  return { ac };
}

function providerUrl(provider, lat, lon, radius, env) {
  if (provider === 'airlabs') {
    const key = String(env?.AIRLABS_API_KEY || '').trim();
    if (!key) return null;
    const bbox = bboxForRadius(lat, lon, radius).join(',');
    const params = new URLSearchParams({
      bbox,
      _fields: 'hex,reg_number,flight_iata,flight_icao,lat,lng,alt,dir,speed,squawk,aircraft_icao,updated',
      api_key: key,
    });
    return `https://airlabs.co/api/v9/flights?${params}`;
  }
  if (provider === 'adsb.fi') {
    return `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radius}`;
  }
  if (provider === 'adsb.lol') {
    return `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`;
  }
  if (provider === 'airplanes.live') {
    if (String(env?.AIRPLANES_LIVE_ACCESS || '') !== '1') return null;
    return `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}`;
  }
  return null;
}

async function fetchProvider(provider, lat, lon, radius, context, origin) {
  const upstreamUrl = providerUrl(provider, lat, lon, radius, context.env);
  if (!upstreamUrl) {
    return { ok: false, provider, status: null, reason: 'ACCESS_NOT_CONFIGURED' };
  }
  if (!(await providerEnabled(context.env, provider, origin))) {
    return { ok: false, provider, status: null, reason: 'DISABLED_OR_PAUSED' };
  }
  if (await providerCoolingDown(provider, origin)) {
    return { ok: false, provider, status: 503, reason: 'COOLDOWN' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'SkyTrace/2.0 (+https://skytrace-83z.pages.dev)',
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    context.waitUntil(recordUpstreamRequest(context.env, response.status, origin, provider));

    if (response.status === 403 || response.status === 429) {
      await setProviderCooldown(
        provider,
        origin,
        cooldownSecondsForStatus(response.status, response.headers.get('retry-after')),
        context
      );
    }

    if (!response.ok) {
      return {
        ok: false,
        provider,
        status: response.status,
        reason: 'UPSTREAM_HTTP',
        retryAfter: response.headers.get('retry-after'),
        elapsedMs: Date.now() - startedAt,
      };
    }

    const normalized =
      provider === 'airlabs'
        ? normalizeAirLabsPayload(payload, Number(lat), Number(lon), Number(radius))
        : normalizeAdsbPayload(payload);
    if (!normalized) {
      return {
        ok: false,
        provider,
        status: response.status,
        reason: 'INVALID_PAYLOAD',
        elapsedMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      provider,
      status: response.status,
      payload: normalized,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const status = timedOut ? 598 : 599;
    context.waitUntil(recordUpstreamRequest(context.env, status, origin, provider));
    return {
      ok: false,
      provider,
      status,
      reason: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function cacheKeys(origin, lat, lon, radius, detail) {
  const suffix = `${lat}:${lon}:${radius}:${detail ? 'detail' : 'broad'}`;
  return {
    fresh: new Request(`${origin}/__skytrace_aircraft_fresh/${suffix}`),
    stale: new Request(`${origin}/__skytrace_aircraft_stale/${suffix}`),
    kv: `aircraft-v2:${suffix}`,
  };
}

async function readKv(env, key) {
  if (!env?.SKYTRACE_STATS?.get) return null;
  try {
    return await env.SKYTRACE_STATS.get(key, { type: 'json' });
  } catch {
    return null;
  }
}

async function writeKv(env, key, body, provider) {
  if (!env?.SKYTRACE_STATS?.put) return;
  await env.SKYTRACE_STATS.put(
    key,
    JSON.stringify({ body, provider, savedAt: new Date().toISOString() }),
    { expirationTtl: KV_TTL_SECONDS }
  );
}

function cachedResponse(body, provider, cacheState) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=15, stale-while-revalidate=120',
      'x-skytrace-cache': cacheState,
      'x-skytrace-provider': provider || 'cache',
    },
  });
}

async function consumeClientRateLimit(request, origin) {
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request(`${origin}/__skytrace_rl/${encodeURIComponent(clientIp)}/${minute}`);
  const cache = caches.default;
  const existing = await cache.match(key);
  const count = existing ? Number(await existing.text()) || 0 : 0;
  if (count >= RATE_LIMIT_PER_MINUTE) return false;
  await cache.put(
    key,
    new Response(String(count + 1), { headers: { 'cache-control': 'public, max-age=70' } })
  );
  return true;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const latInput = number(url.searchParams.get('lat'));
  const lonInput = number(url.searchParams.get('lon'));
  const radiusInput = number(url.searchParams.get('radius'));
  const detail = url.searchParams.get('detail') === '1';

  if (
    latInput == null ||
    lonInput == null ||
    radiusInput == null ||
    latInput < -90 ||
    latInput > 90 ||
    lonInput < -180 ||
    lonInput > 180 ||
    radiusInput <= 0 ||
    radiusInput > 250
  ) {
    return json({ error: 'INVALID_QUERY' }, 400);
  }

  const lat = bucket(latInput).toFixed(2);
  const lon = bucket(lonInput).toFixed(2);
  const radius = Math.round(radiusInput);
  const keys = cacheKeys(url.origin, lat, lon, radius, detail);
  const cache = caches.default;

  const fresh = await cache.match(keys.fresh);
  if (fresh) {
    return cachedResponse(
      await fresh.text(),
      fresh.headers.get('x-skytrace-provider'),
      'HIT'
    );
  }

  const stale = await cache.match(keys.stale);
  const kvStale = stale ? null : await readKv(context.env, keys.kv);

  if (!(await consumeClientRateLimit(context.request, url.origin))) {
    if (stale) {
      return cachedResponse(await stale.text(), stale.headers.get('x-skytrace-provider'), 'STALE-RATE-LIMIT');
    }
    if (kvStale?.body) return cachedResponse(kvStale.body, kvStale.provider, 'KV-STALE-RATE-LIMIT');
    return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' });
  }

  const providerOrder = ['airlabs', 'adsb.fi', 'adsb.lol', 'airplanes.live'];
  const attempts = [];
  let emptyResult = null;
  let result = null;

  for (const provider of providerOrder) {
    const attempt = await fetchProvider(provider, lat, lon, radius, context, url.origin);
    attempts.push(attempt);
    if (!attempt.ok) continue;
    if (attempt.payload.ac.length > 0) {
      result = attempt;
      break;
    }
    if (!emptyResult) emptyResult = attempt;
  }

  result ||= emptyResult;

  if (!result) {
    if (stale) {
      return cachedResponse(await stale.text(), stale.headers.get('x-skytrace-provider'), 'STALE');
    }
    if (kvStale?.body) return cachedResponse(kvStale.body, kvStale.provider, 'KV-STALE');
    return json(
      {
        error: 'DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Aucun fournisseur de positions live n’est disponible pour le moment.',
        providers: attempts.map(({ provider, ok, status, reason, elapsedMs }) => ({
          provider,
          ok,
          status,
          reason,
          elapsedMs,
        })),
      },
      502
    );
  }

  const body = JSON.stringify(result.payload);
  const hasAircraft = result.payload.ac.length > 0;
  const freshTtl = hasAircraft ? FRESH_TTL_SECONDS : EMPTY_TTL_SECONDS;
  const freshResponse = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${freshTtl}`,
      'x-skytrace-provider': result.provider,
    },
  });

  const writes = [cache.put(keys.fresh, freshResponse)];
  if (hasAircraft) {
    writes.push(
      cache.put(
        keys.stale,
        new Response(body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${STALE_TTL_SECONDS}`,
            'x-skytrace-provider': result.provider,
          },
        })
      )
    );
    writes.push(writeKv(context.env, keys.kv, body, result.provider));
  }
  context.waitUntil(Promise.all(writes));

  return cachedResponse(body, result.provider, 'MISS');
}
