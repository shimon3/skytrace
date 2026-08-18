import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../functions/api/aircraft.js';
import { writeProviderControl } from '../functions/lib/provider-controls.js';
import { emptyStats, getDailyLimit, utcDay } from '../functions/lib/stats.js';
import { installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';
const ADSB_PAYLOAD = { ac: [{ hex: 'adsb1', lat: 32, lon: 35 }] };
const AIRPLANES_PAYLOAD = { ac: [{ hex: 'live1', lat: 32, lon: 35 }] };

function bucket(value) {
  return (Math.round(value / 0.5) * 0.5).toFixed(2);
}

function aircraftRequest({ lat = 32, lon = 35, radius = 250, prefer = 'adsb.lol', ip = '1.2.3.4' } = {}) {
  const url = new URL(`${ORIGIN}/api/aircraft`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('radius', String(radius));
  if (prefer) url.searchParams.set('prefer', prefer);
  return new Request(url, { headers: { 'cf-connecting-ip': ip } });
}

function staleCacheKey({ lat = 32, lon = 35, radius = 250 } = {}) {
  const url = new URL(`${ORIGIN}/api/aircraft-stale`);
  url.searchParams.set('lat', bucket(lat));
  url.searchParams.set('lon', bucket(lon));
  url.searchParams.set('radius', String(Math.round(radius)));
  url.searchParams.set('freshness', 'broad');
  return url.toString();
}

function rateLimitKey(ip) {
  const minute = Math.floor(Date.now() / 60000);
  return `${ORIGIN}/__skytrace_rate_limit/${encodeURIComponent(ip)}/${minute}`;
}

test('rejects an invalid query without calling any upstream provider', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called for an invalid query');
  });

  const context = makeContext({ request: aircraftRequest({ lat: 999 }), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 400);
});

test('serves the preferred provider (adsb.lol) on success and caches the response', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async (input) => {
    assert.match(String(input), /api\.adsb\.lol/);
    return new Response(JSON.stringify(ADSB_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-cache'), 'MISS');
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
  assert.deepEqual(await response.json(), ADSB_PAYLOAD);
});

test('a second request within the cache TTL is served from cache, not the network', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(ADSB_PAYLOAD), { status: 200 });
  });

  const context1 = makeContext({ request: aircraftRequest(), env: {} });
  await onRequestGet(context1);
  await context1.flush();

  const context2 = makeContext({ request: aircraftRequest(), env: {} });
  const response2 = await onRequestGet(context2);

  assert.equal(fetchCalls, 1);
  assert.equal(response2.headers.get('x-skytrace-cache'), 'HIT');
});

test('falls back to airplanes.live when adsb.lol fails and the daily quota is not exhausted', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('api.adsb.lol')) return new Response('server error', { status: 500 });
    if (url.includes('api.airplanes.live')) return new Response(JSON.stringify(AIRPLANES_PAYLOAD), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-provider'), 'airplanes.live');
  assert.deepEqual(await response.json(), AIRPLANES_PAYLOAD);
});

test('skips the airplanes.live fallback once the daily quota is exhausted', async (t) => {
  const { cache, restore } = installFakeCaches();
  t.after(restore);
  const day = utcDay();
  await cache.put(
    `${ORIGIN}/__private_stats/${day}`,
    new Response(JSON.stringify({ ...emptyStats(day), airplanesLiveRequests: getDailyLimit() }))
  );

  let airplanesLiveCalled = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('api.adsb.lol')) return new Response('server error', { status: 500 });
    if (url.includes('api.airplanes.live')) airplanesLiveCalled = true;
    return new Response('server error', { status: 500 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(airplanesLiveCalled, false);
  assert.equal(response.status, 502);
});

test('serves a stale cached response when every provider fails', async (t) => {
  const { cache, restore } = installFakeCaches();
  t.after(restore);
  await cache.put(staleCacheKey(), new Response(JSON.stringify(ADSB_PAYLOAD), { status: 200 }));

  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 500 }));

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-cache'), 'STALE');
  assert.deepEqual(await response.json(), ADSB_PAYLOAD);
});

test('returns 502 when every provider fails and there is no stale cache', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 500 }));

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'DATA_TEMPORARILY_UNAVAILABLE');
});

test('rate limits a client past 60 requests in the same minute', async (t) => {
  const { cache, restore } = installFakeCaches();
  t.after(restore);
  await cache.put(rateLimitKey('9.9.9.9'), new Response('60'));

  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called once rate limited');
  });

  const context = makeContext({ request: aircraftRequest({ ip: '9.9.9.9' }), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});

test('an admin-paused provider is skipped in favor of the fallback', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = {};
  await writeProviderControl(env, 'adsb.lol', { enabled: false, pausedUntil: null }, ORIGIN);

  let adsbLolCalled = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('api.adsb.lol')) adsbLolCalled = true;
    return new Response(JSON.stringify(AIRPLANES_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(adsbLolCalled, false);
  assert.equal(response.headers.get('x-skytrace-provider'), 'airplanes.live');
});
