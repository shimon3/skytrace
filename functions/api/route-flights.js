import { providerEnabled } from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

const AIRLABS_ENDPOINT = 'https://airlabs.co/api/v9/flights';
const CACHE_SECONDS = 60;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function airportCode(value) {
  const code = String(value || '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalize(item) {
  const lat = Number(item?.lat);
  const lon = Number(item?.lng ?? item?.lon);
  return {
    flightIata: item.flight_iata || null,
    flightIcao: item.flight_icao || null,
    registration: item.reg_number || null,
    hex: item.hex || null,
    status: item.status || null,
    departure: item.dep_iata || null,
    arrival: item.arr_iata || null,
    aircraftIcao: item.aircraft_icao || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    altitude: item.alt ?? null,
    speed: item.speed ?? null,
    heading: item.dir ?? null,
  };
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const dep = airportCode(requestUrl.searchParams.get('dep'));
  const arr = airportCode(requestUrl.searchParams.get('arr'));
  if (!dep || !arr || dep === arr) return json({ error: 'INVALID_ROUTE' }, 400);

  if (!(await providerEnabled(context.env, 'airlabs', requestUrl.origin))) {
    return json({ error: 'PROVIDER_PAUSED' }, 503);
  }
  const apiKey = context.env.AIRLABS_API_KEY;
  if (!apiKey) return json({ error: 'AIRLABS_NOT_CONFIGURED' }, 503);

  const upstream = new URL(AIRLABS_ENDPOINT);
  upstream.searchParams.set('dep_iata', dep);
  upstream.searchParams.set('arr_iata', arr);
  upstream.searchParams.set('_limit', '30');
  upstream.searchParams.set('api_key', apiKey);

  try {
    const response = await fetch(upstream, { headers: { accept: 'application/json' } });
    context.waitUntil(
      recordProviderRequest(context.env, response.status, requestUrl.origin, 'airlabs')
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      return json({ error: payload?.error?.message || `AirLabs HTTP ${response.status}` }, 502);
    }
    const flights = (Array.isArray(payload?.response) ? payload.response : [])
      .map(normalize)
      .filter((flight) => flight.departure === dep && flight.arrival === arr)
      .slice(0, 30);
    return json({ flights, source: 'AirLabs' });
  } catch (error) {
    context.waitUntil(recordProviderRequest(context.env, 599, requestUrl.origin, 'airlabs'));
    return json({ error: error instanceof Error ? error.message : 'AIRLABS_REQUEST_FAILED' }, 502);
  }
}
