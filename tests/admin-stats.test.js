import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../functions/api/admin-stats.js';
import { writeProviderControl } from '../functions/lib/provider-controls.js';
import { recordProviderRequest } from '../functions/lib/stats.js';
import { FakeKV, installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';
const TOKEN = 'super-secret-token';

function statsRequest(token = TOKEN) {
  return new Request(`${ORIGIN}/api/admin-stats`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function providerById(payload, id) {
  return payload.providers.find((p) => p.id === id);
}

test('rejects requests when no admin token is configured', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const context = makeContext({ request: statsRequest(), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 503);
});

test('rejects an incorrect admin token', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({ request: statsRequest('wrong'), env });
  const response = await onRequestGet(context);
  assert.equal(response.status, 401);
});

test('reports unconfigured optional providers and unknown unused providers', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({ request: statsRequest(), env });
  const response = await onRequestGet(context);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.providers.length, 5);
  assert.equal(providerById(payload, 'airlabs').health, 'not-configured');
  assert.equal(providerById(payload, 'airplanes.live').health, 'not-configured');
  assert.equal(providerById(payload, 'adsb.fi').health, 'unknown');
  assert.equal(providerById(payload, 'adsb.lol').health, 'unknown');
});

test('reflects recorded traffic and automatic pauses in provider health', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN, AIRLABS_API_KEY: 'secret' };
  await recordProviderRequest(env, 200, ORIGIN, 'adsb.lol');
  await recordProviderRequest(env, 500, ORIGIN, 'planespotters.net');
  await recordProviderRequest(env, 429, ORIGIN, 'airlabs');

  const context = makeContext({ request: statsRequest(), env });
  const payload = await (await onRequestGet(context)).json();

  assert.equal(payload.requests, 3);
  assert.equal(providerById(payload, 'adsb.lol').health, 'operational');
  assert.equal(providerById(payload, 'planespotters.net').health, 'unavailable');
  assert.equal(providerById(payload, 'airlabs').health, 'paused');
  assert.equal(providerById(payload, 'airlabs').pauseReason, 'HTTP_429');
});

test('a paused provider is reported as paused regardless of its last status', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  await recordProviderRequest(env, 200, ORIGIN, 'adsb.lol');
  await writeProviderControl(env, 'adsb.lol', { enabled: false, pausedUntil: null }, ORIGIN);

  const context = makeContext({ request: statsRequest(), env });
  const payload = await (await onRequestGet(context)).json();
  assert.equal(providerById(payload, 'adsb.lol').health, 'paused');
  assert.equal(providerById(payload, 'adsb.lol').enabled, false);
});

test('computes primary ADSB.fi remaining budget and percentage used', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  for (let i = 0; i < 5; i += 1) {
    await recordProviderRequest(env, 200, ORIGIN, 'adsb.fi');
  }

  const context = makeContext({ request: statsRequest(), env });
  const payload = await (await onRequestGet(context)).json();
  assert.equal(payload.dailyLimit, 1000);
  assert.equal(payload.remaining, 995);
  assert.equal(payload.percentUsed, 0.5);
});

test('reports storage as KV when a KV binding is present, cache-fallback otherwise', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);

  const withoutKv = makeContext({ request: statsRequest(), env: { ADMIN_STATS_TOKEN: TOKEN } });
  const withoutKvPayload = await (await onRequestGet(withoutKv)).json();
  assert.equal(withoutKvPayload.storage, 'cache-fallback');

  const withKv = makeContext({
    request: statsRequest(),
    env: { ADMIN_STATS_TOKEN: TOKEN, SKYTRACE_STATS: new FakeKV() },
  });
  const withKvPayload = await (await onRequestGet(withKv)).json();
  assert.equal(withKvPayload.storage, 'KV');
});
