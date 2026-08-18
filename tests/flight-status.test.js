import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../functions/api/flight-status.js';
import { writeProviderControl } from '../functions/lib/provider-controls.js';
import { installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';

function statusRequest({ callsign, registration } = {}) {
  const url = new URL(`${ORIGIN}/api/flight-status`);
  if (callsign) url.searchParams.set('callsign', callsign);
  if (registration) url.searchParams.set('registration', registration);
  return new Request(url);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test('is paused when the admin has disabled the airlabs provider', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  await writeProviderControl(env, 'airlabs', { enabled: false, pausedUntil: null }, ORIGIN);

  const context = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env });
  const response = await onRequestGet(context);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'PROVIDER_PAUSED');
});

test('reports AIRLABS_NOT_CONFIGURED when no API key is set', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const context = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AIRLABS_NOT_CONFIGURED');
});

test('rejects a callsign shorter than 3 characters', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  const context = makeContext({ request: statusRequest({ callsign: 'X1' }), env });
  const response = await onRequestGet(context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_CALLSIGN');
});

test('resolves a flight directly by ICAO callsign and normalizes the payload', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    fetchCalls += 1;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('flight_icao'), 'ELY001');
    return jsonResponse({
      response: {
        flight_iata: 'LY001',
        flight_icao: 'ELY001',
        dep_iata: 'TLV',
        arr_iata: 'JFK',
        status: 'active',
        reg_number: '4X-ABC',
      },
    });
  });

  const context = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env });
  const response = await onRequestGet(context);
  await context.flush();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.flight.flightIata, 'LY001');
  assert.equal(payload.flight.departure.iata, 'TLV');
  assert.equal(payload.flight.arrival.iata, 'JFK');
  assert.equal(fetchCalls, 1);
});

test('strips the operational suffix and retries when the full callsign is not found', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  const triedCodes = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    const code = url.searchParams.get('flight_icao');
    triedCodes.push(code);
    if (code === 'ELY001A') return jsonResponse({ response: null });
    return jsonResponse({ response: { flight_icao: 'ELY001', status: 'scheduled' } });
  });

  const context = makeContext({ request: statusRequest({ callsign: 'ELY001A' }), env });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.deepEqual(triedCodes, ['ELY001A', 'ELY001']);
});

test('falls back to a live registration lookup when no callsign match exists', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/flight')) return jsonResponse({ response: null });
    if (url.pathname.endsWith('/flights')) {
      assert.equal(url.searchParams.get('reg_number'), '4XABC');
      return jsonResponse({
        response: [
          { reg_number: '4XABC', flight_icao: 'ELY999', updated: 100 },
          { reg_number: 'OTHER', flight_icao: 'XX111', updated: 200 },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const context = makeContext({
    request: statusRequest({ callsign: 'ZZZ', registration: '4X-ABC' }),
    env,
  });
  const response = await onRequestGet(context);
  await context.flush();
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.flight.registration, '4XABC');
});

test('returns FLIGHT_NOT_FOUND when nothing matches', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({ response: null }));

  const context = makeContext({ request: statusRequest({ callsign: 'ZZZ' }), env });
  const response = await onRequestGet(context);
  await context.flush();
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'FLIGHT_NOT_FOUND');
});

test('flags FLIGHT_MISMATCH when the resolved flight belongs to a different aircraft', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  t.mock.method(globalThis, 'fetch', async () =>
    jsonResponse({ response: { flight_icao: 'ZZZ999', reg_number: 'OTHERREG' } })
  );

  const context = makeContext({
    request: statusRequest({ callsign: 'ELY001', registration: '4X-ABC' }),
    env,
  });
  const response = await onRequestGet(context);
  await context.flush();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'FLIGHT_MISMATCH');
});

test('surfaces upstream errors as AIRLABS_REQUEST_FAILED', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  t.mock.method(globalThis, 'fetch', async () => jsonResponse({ error: { message: 'boom' } }, 200));

  const context = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env });
  const response = await onRequestGet(context);
  await context.flush();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'AIRLABS_REQUEST_FAILED');
});

test('a second identical request is served from cache without another upstream call', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { AIRLABS_API_KEY: 'secret' };
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return jsonResponse({ response: { flight_icao: 'ELY001', status: 'active' } });
  });

  const first = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env });
  await onRequestGet(first);
  await first.flush();

  const second = makeContext({ request: statusRequest({ callsign: 'ELY001' }), env });
  const response = await onRequestGet(second);
  assert.equal(response.status, 200);
  assert.equal(fetchCalls, 1);
});
