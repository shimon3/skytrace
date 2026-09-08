import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../functions/api/aircraft.js';
import { readProviderControl, writeProviderControl } from '../functions/lib/provider-controls.js';
import { readStats, utcDay } from '../functions/lib/stats.js';
import { installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';
const ADSB_FI_PAYLOAD = { ac: [{ hex: 'fi001', lat: 32, lon: 35 }] };
const ADSB_LOL_PAYLOAD = { ac: [{ hex: 'lol001', lat: 32, lon: 35 }] };

function bucket(value) {
  return Math.round(value).toFixed(2);
}

function aircraftRequest({ lat = 32, lon = 35, radius = 250, ip = '1.2.3.4' } = {}) {
  const url = new URL(`${ORIGIN}/api/aircraft`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('radius', String(radius));
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

test('serves ADSB.fi first on success and caches the response', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async (input) => {
    assert.match(String(input), /opendata\.adsb\.fi/);
    return new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-cache'), 'MISS');
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.fi');
  assert.deepEqual(await response.json(), ADSB_FI_PAYLOAD);
});

test('a second request within the cache TTL is served from cache', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 });
  });

  const context1 = makeContext({ request: aircraftRequest(), env: {} });
  await onRequestGet(context1);
  await context1.flush();

  const context2 = makeContext({ request: aircraftRequest(), env: {} });
  const response2 = await onRequestGet(context2);
  await context2.flush();

  assert.equal(fetchCalls, 1);
  assert.equal(response2.headers.get('x-skytrace-cache'), 'HIT');
});

test('falls back from ADSB.fi to adsb.lol', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('opendata.adsb.fi')) return new Response('server error', { status: 500 });
    if (url.includes('api.adsb.lol'))
      return new Response(JSON.stringify(ADSB_LOL_PAYLOAD), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
  assert.deepEqual(await response.json(), ADSB_LOL_PAYLOAD);
});

test('HTTP 403 pauses ADSB.fi and falls back to adsb.lol', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = {};
  let fiCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('opendata.adsb.fi')) {
      fiCalls += 1;
      return new Response('forbidden', { status: 403 });
    }
    return new Response(JSON.stringify(ADSB_LOL_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
  assert.equal(fiCalls, 1);
  const control = await readProviderControl(env, 'adsb.fi', ORIGIN);
  assert.equal(control.enabled, false);
  assert.equal(control.pauseReason, 'HTTP_403');
});

test('serves a stale cached response when every active provider fails', async (t) => {
  const { cache, restore } = installFakeCaches();
  t.after(restore);
  await cache.put(staleCacheKey(), new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 }));
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 500 }));

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-cache'), 'STALE');
  assert.deepEqual(await response.json(), ADSB_FI_PAYLOAD);
});

test('returns provider diagnostics when no live source and no stale cache are available', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => new Response('down', { status: 500 }));

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'DATA_TEMPORARILY_UNAVAILABLE');
  assert.ok(Array.isArray(payload.providers));
  assert.equal(payload.providers.some((p) => p.provider === 'adsb.fi'), true);
  assert.equal(payload.providers.some((p) => p.provider === 'adsb.lol'), true);
  assert.equal(payload.providers.some((p) => p.provider === 'adsb.one'), false);
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

test('an admin-paused ADSB.fi is skipped in favor of adsb.lol', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = {};
  await writeProviderControl(env, 'adsb.fi', { enabled: false, pausedUntil: null }, ORIGIN);

  let fiCalled = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('opendata.adsb.fi')) fiCalled = true;
    assert.match(url, /api\.adsb\.lol/);
    return new Response(JSON.stringify(ADSB_LOL_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(fiCalled, false);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
});

test('retries once on a 502 and serves the retry result on success', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    if (attempts === 1) return new Response('bad gateway', { status: 502 });
    return new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(attempts, 2);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.fi');

  const stats = await readStats(context.env, utcDay(), ORIGIN);
  assert.equal(stats.retries, 1);
  assert.equal(stats.retrySuccesses, 1);
});

test('each active provider gets at most one retry on retryable failures', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    return new Response('service unavailable', { status: 503 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(attempts, 4);
  assert.equal(response.status, 502);
  const stats = await readStats(context.env, utcDay(), ORIGIN);
  assert.equal(stats.retries, 2);
  assert.equal(stats.retryFailures, 2);
});

test('does not retry a 404 before falling back', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let fiAttempts = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('opendata.adsb.fi')) {
      fiAttempts += 1;
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(ADSB_LOL_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(fiAttempts, 1);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
  const stats = await readStats(context.env, utcDay(), ORIGIN);
  assert.equal(stats.retries, 0);
});

test('does not retry a 429 and automatically falls back', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = {};
  let fiAttempts = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('opendata.adsb.fi')) {
      fiAttempts += 1;
      return new Response('too many requests', { status: 429, headers: { 'retry-after': '30' } });
    }
    return new Response(JSON.stringify(ADSB_LOL_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(fiAttempts, 1);
  assert.equal(response.headers.get('x-skytrace-provider'), 'adsb.lol');
  const stats = await readStats(env, utcDay(), ORIGIN);
  assert.equal(stats.retries, 0);
  const control = await readProviderControl(env, 'adsb.fi', ORIGIN);
  assert.equal(control.pauseReason, 'HTTP_429');
});

test('retries a timeout once', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const response = await onRequestGet(context);
  await context.flush();

  assert.equal(attempts, 2);
  assert.equal(response.status, 200);
});

test('honors a short Retry-After header on retryable responses', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response('service unavailable', {
        status: 503,
        headers: { 'retry-after': '0.05' },
      });
    }
    return new Response(JSON.stringify(ADSB_FI_PAYLOAD), { status: 200 });
  });

  const context = makeContext({ request: aircraftRequest(), env: {} });
  const startedAt = Date.now();
  const response = await onRequestGet(context);
  const elapsedMs = Date.now() - startedAt;
  await context.flush();

  assert.equal(attempts, 2);
  assert.equal(response.status, 200);
  assert.ok(elapsedMs < 400, `expected the short Retry-After to be honored, took ${elapsedMs}ms`);
});
