import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/admin-provider-control.js';
import { readProviderControl } from '../functions/lib/provider-controls.js';
import { readStats, utcDay } from '../functions/lib/stats.js';
import { installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';
const TOKEN = 'super-secret-token';

function controlRequest(body, token = TOKEN) {
  return new Request(`${ORIGIN}/api/admin-provider-control`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects requests when no admin token is configured', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const context = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'enable' }),
    env: {},
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 503);
});

test('rejects an incorrect admin token', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'enable' }, 'wrong-token'),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 401);
});

test('rejects an unknown provider', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({
    request: controlRequest({ provider: 'not-a-provider', action: 'enable' }),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'UNKNOWN_PROVIDER');
});

test('rejects an unsupported action', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'explode' }),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_ACTION');
});

test('rejects a pause with a resumeAt date in the past', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({
    request: controlRequest({
      provider: 'planespotters.net',
      action: 'pause',
      resumeAt: new Date(Date.now() - 1000).toISOString(),
    }),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_RESUME_AT');
});

test('rejects a pause more than 7 days in the future', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const context = makeContext({
    request: controlRequest({
      provider: 'planespotters.net',
      action: 'pause',
      resumeAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'RESUME_AT_TOO_FAR');
});

test('pausing a position provider succeeds and the control is persisted', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const resumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const context = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'pause', resumeAt }),
    env,
  });
  const response = await onRequestPost(context);
  assert.equal(response.status, 200);
  const control = await readProviderControl(env, 'adsb.lol', ORIGIN);
  assert.equal(control.enabled, false);
});

test('refuses to pause the last remaining active position provider', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const resumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const first = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'pause', resumeAt }),
    env,
  });
  const firstResponse = await onRequestPost(first);
  assert.equal(firstResponse.status, 200);

  const second = makeContext({
    request: controlRequest({ provider: 'airplanes.live', action: 'pause', resumeAt }),
    env,
  });
  const secondResponse = await onRequestPost(second);
  assert.equal(secondResponse.status, 409);
  assert.equal((await secondResponse.json()).error, 'AT_LEAST_ONE_POSITION_PROVIDER_REQUIRED');
});

test('re-enabling a paused provider clears its pause state', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  const resumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await onRequestPost(
    makeContext({ request: controlRequest({ provider: 'airlabs', action: 'pause', resumeAt }), env })
  );
  const enableResponse = await onRequestPost(
    makeContext({ request: controlRequest({ provider: 'airlabs', action: 'enable' }), env })
  );
  assert.equal(enableResponse.status, 200);
  const control = await readProviderControl(env, 'airlabs', ORIGIN);
  assert.equal(control.enabled, true);
  assert.equal(control.pausedUntil, null);
});

test('a live provider test records a stats entry for that provider', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));

  const context = makeContext({
    request: controlRequest({ provider: 'adsb.lol', action: 'test' }),
    env,
  });
  const response = await onRequestPost(context);
  await context.flush();

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  const stats = await readStats(env, utcDay(), ORIGIN);
  assert.equal(stats.providers['adsb.lol'].requests, 1);
});

test('testing airlabs without a configured API key reports NOT_CONFIGURED and skips the network', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = { ADMIN_STATS_TOKEN: TOKEN };
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('should not call the network for an unconfigured provider');
  });

  const context = makeContext({
    request: controlRequest({ provider: 'airlabs', action: 'test' }),
    env,
  });
  const response = await onRequestPost(context);
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.code, 'NOT_CONFIGURED');
});
