const AIRLABS_ENDPOINT = 'https://airlabs.co/api/v9/flight';
const AIRLABS_LIVE_ENDPOINT = 'https://airlabs.co/api/v9/flights';
const CACHE_SECONDS = 300;

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control':
        status === 200 ? `public, max-age=60, s-maxage=${CACHE_SECONDS}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function sanitizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function normalizeFlight(flight) {
  return {
    flightIata: flight.flight_iata || null,
    flightIcao: flight.flight_icao || null,
    flightNumber: flight.flight_number || null,
    airlineIata: flight.airline_iata || null,
    airlineIcao: flight.airline_icao || null,
    status: flight.status || null,
    registration: flight.reg_number || null,
    aircraftIcao: flight.aircraft_icao || null,
    model: flight.model || null,
    manufacturer: flight.manufacturer || null,
    departure: {
      iata: flight.dep_iata || null,
      icao: flight.dep_icao || null,
      terminal: flight.dep_terminal || null,
      gate: flight.dep_gate || null,
      scheduled: flight.dep_time || null,
      scheduledUtc: flight.dep_time_utc || null,
      estimated: flight.dep_estimated || null,
      estimatedUtc: flight.dep_estimated_utc || null,
      actual: flight.dep_actual || null,
      actualUtc: flight.dep_actual_utc || null,
      delayMinutes: Number.isFinite(Number(flight.dep_delayed)) ? Number(flight.dep_delayed) : null,
    },
    arrival: {
      iata: flight.arr_iata || null,
      icao: flight.arr_icao || null,
      terminal: flight.arr_terminal || null,
      gate: flight.arr_gate || null,
      baggage: flight.arr_baggage || null,
      scheduled: flight.arr_time || null,
      scheduledUtc: flight.arr_time_utc || null,
      estimated: flight.arr_estimated || null,
      estimatedUtc: flight.arr_estimated_utc || null,
      actual: flight.arr_actual || null,
      actualUtc: flight.arr_actual_utc || null,
      delayMinutes: Number.isFinite(Number(flight.arr_delayed)) ? Number(flight.arr_delayed) : null,
    },
    durationMinutes: Number.isFinite(Number(flight.duration)) ? Number(flight.duration) : null,
    updated: Number.isFinite(Number(flight.updated)) ? Number(flight.updated) : null,
  };
}

async function requestAirLabs(apiKey, parameter, code) {
  const upstream = new URL(AIRLABS_ENDPOINT);
  upstream.searchParams.set(parameter, code);
  upstream.searchParams.set('api_key', apiKey);

  const response = await fetch(upstream, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `AirLabs HTTP ${response.status}`;
    throw new Error(message);
  }

  if (payload?.error) {
    throw new Error(payload.error.message || 'AirLabs returned an error');
  }

  return payload?.response || null;
}

async function requestLiveFlightByRegistration(apiKey, registration) {
  if (!registration) return null;

  const upstream = new URL(AIRLABS_LIVE_ENDPOINT);
  upstream.searchParams.set('reg_number', registration);
  upstream.searchParams.set('api_key', apiKey);

  const response = await fetch(upstream, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `AirLabs HTTP ${response.status}`;
    throw new Error(message);
  }

  if (payload?.error) {
    throw new Error(payload.error.message || 'AirLabs returned an error');
  }

  const flights = Array.isArray(payload?.response) ? payload.response : [];
  const exact = flights.filter(
    (flight) => sanitizeCode(flight.reg_number) === registration
  );

  return exact.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0))[0] || null;
}

function callsignCandidates(callsign) {
  const candidates = [callsign];
  const withoutOperationalSuffix = callsign.match(/^([A-Z]{3}\d{1,4})[A-Z]$/)?.[1];
  if (withoutOperationalSuffix && withoutOperationalSuffix !== callsign) {
    candidates.push(withoutOperationalSuffix);
  }
  return [...new Set(candidates)];
}

async function resolveFlight(apiKey, callsign, registration) {
  for (const candidate of callsignCandidates(callsign)) {
    const flight = await requestAirLabs(apiKey, 'flight_icao', candidate);
    if (flight) return flight;
  }

  if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(callsign)) {
    const flight = await requestAirLabs(apiKey, 'flight_iata', callsign);
    if (flight) return flight;
  }

  const liveFlight = await requestLiveFlightByRegistration(apiKey, registration);
  if (!liveFlight) return null;

  if (liveFlight.flight_icao) {
    const detailed = await requestAirLabs(apiKey, 'flight_icao', liveFlight.flight_icao);
    if (detailed) return detailed;
  }

  if (liveFlight.flight_iata) {
    const detailed = await requestAirLabs(apiKey, 'flight_iata', liveFlight.flight_iata);
    if (detailed) return detailed;
  }

  return liveFlight;
}

export async function onRequestGet(context) {
  const apiKey = context.env.AIRLABS_API_KEY;
  if (!apiKey) {
    return json(
      {
        error: 'AirLabs is not configured on this deployment.',
        code: 'AIRLABS_NOT_CONFIGURED',
      },
      503
    );
  }

  const requestUrl = new URL(context.request.url);
  const callsign = sanitizeCode(requestUrl.searchParams.get('callsign'));
  const registration = sanitizeCode(requestUrl.searchParams.get('registration'));

  if (callsign.length < 3) {
    return json(
      {
        error: 'A valid flight callsign is required.',
        code: 'INVALID_CALLSIGN',
      },
      400
    );
  }

  const cacheUrl = new URL(requestUrl.origin + requestUrl.pathname);
  cacheUrl.searchParams.set('callsign', callsign);
  if (registration) cacheUrl.searchParams.set('registration', registration);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const flight = await resolveFlight(apiKey, callsign, registration);

    if (!flight) {
      return json(
        {
          error: 'No commercial schedule was found for this aircraft.',
          code: 'FLIGHT_NOT_FOUND',
        },
        404
      );
    }

    if (
      registration &&
      flight.reg_number &&
      sanitizeCode(flight.reg_number) !== registration &&
      !callsignCandidates(callsign).includes(sanitizeCode(flight.flight_icao))
    ) {
      return json(
        {
          error: 'The AirLabs flight does not match the selected aircraft.',
          code: 'FLIGHT_MISMATCH',
        },
        409
      );
    }

    const response = json({ flight: normalizeFlight(flight), source: 'AirLabs' });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Unable to contact AirLabs.',
        code: 'AIRLABS_REQUEST_FAILED',
      },
      502
    );
  }
}
