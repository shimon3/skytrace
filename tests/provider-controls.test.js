import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isKnownProvider,
  providerEnabled,
  readAllProviderControls,
  readProviderControl,
  writeProviderControl,
} from '../functions/lib/provider-controls.js';
import { FakeKV, installFakeCaches } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';

test('isKnownProvider recognizes only the four supported providers', () => {
  assert.equal(isKnownProvider('adsb.lol'), true);
  assert.equal(isKnownProvider('airplanes.live'), true);
  assert.equal(isKnownProvider('airlabs'), true);
  assert.equal(isKnownProvider('planespotters.net'), true);
  assert.equal(isKnownProvider('unknown-provider'), false);
});

test('readProviderControl throws for an unknown provider', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  await assert.rejects(() => readProviderControl(env, 'not-a-provider', ORIGIN), /UNKNOWN_PROVIDER/);
});

test('a provider defaults to enabled when nothing has been stored', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  const control = await readProviderControl(env, 'adsb.lol', ORIGIN);
  assert.equal(control.enabled, true);
  assert.equal(control.pausedUntil, null);
  assert.equal(await providerEnabled(env, 'adsb.lol', ORIGIN), true);
});

test('pausing a provider with a future resume date disables it', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  const resumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await writeProviderControl(env, 'airlabs', { enabled: false, pausedUntil: resumeAt }, ORIGIN);
  const control = await readProviderControl(env, 'airlabs', ORIGIN);
  assert.equal(control.enabled, false);
  assert.equal(control.pausedUntil, resumeAt);
  assert.equal(await providerEnabled(env, 'airlabs', ORIGIN), false);
});

test('a pause automatically lapses and self-heals storage once pausedUntil is in the past', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  const pastResumeAt = new Date(Date.now() - 1000).toISOString();
  await writeProviderControl(env, 'airlabs', { enabled: false, pausedUntil: pastResumeAt }, ORIGIN);

  const control = await readProviderControl(env, 'airlabs', ORIGIN);
  assert.equal(control.enabled, true);
  assert.equal(control.pausedUntil, null);

  // The lapsed pause should have been rewritten to storage, not just
  // masked in the returned value.
  const rawStored = JSON.parse(await env.SKYTRACE_STATS.get('provider-control:airlabs'));
  assert.equal(rawStored.enabled, true);
  assert.equal(rawStored.pausedUntil, null);
});

test('re-enabling a paused provider clears pausedUntil', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  await writeProviderControl(
    env,
    'planespotters.net',
    { enabled: false, pausedUntil: new Date(Date.now() + 1000).toISOString() },
    ORIGIN
  );
  await writeProviderControl(env, 'planespotters.net', { enabled: true, pausedUntil: null }, ORIGIN);
  const control = await readProviderControl(env, 'planespotters.net', ORIGIN);
  assert.equal(control.enabled, true);
  assert.equal(control.pausedUntil, null);
});

test('readAllProviderControls returns one entry per known provider', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  const controls = await readAllProviderControls(env, ORIGIN);
  assert.equal(controls.length, 4);
  assert.deepEqual(
    controls.map((c) => c.provider).sort(),
    ['adsb.lol', 'airlabs', 'airplanes.live', 'planespotters.net']
  );
});

test('falls back to the Cache API when no KV binding is present', async () => {
  const { restore } = installFakeCaches();
  try {
    const env = {};
    await writeProviderControl(env, 'adsb.lol', { enabled: false, pausedUntil: null }, ORIGIN);
    const control = await readProviderControl(env, 'adsb.lol', ORIGIN);
    assert.equal(control.enabled, false);
  } finally {
    restore();
  }
});
