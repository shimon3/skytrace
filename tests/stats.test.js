import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyStats,
  getDailyLimit,
  readStats,
  recordCacheHit,
  recordFallbackActivation,
  recordProviderRequest,
  recordQuotaBlocked,
  utcDay,
} from '../functions/lib/stats.js';
import { FakeKV, installFakeCaches } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';

test('emptyStats returns a zeroed shape for the given day', () => {
  const stats = emptyStats('2026-08-18');
  assert.equal(stats.day, '2026-08-18');
  assert.equal(stats.requests, 0);
  assert.deepEqual(stats.hourly, {});
  assert.deepEqual(stats.providers, {});
});

test('readStats returns empty stats when nothing has been recorded yet', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  const stats = await readStats(env, utcDay(), ORIGIN);
  assert.equal(stats.requests, 0);
  assert.equal(stats.airplanesLiveRequests, 0);
});

test('recordProviderRequest accumulates totals, per-provider and hourly buckets', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  await recordProviderRequest(env, 200, ORIGIN, 'adsb.lol');
  await recordProviderRequest(env, 500, ORIGIN, 'adsb.lol');
  await recordProviderRequest(env, 200, ORIGIN, 'airplanes.live');

  const stats = await readStats(env, utcDay(), ORIGIN);
  assert.equal(stats.requests, 3);
  assert.equal(stats.successes, 2);
  assert.equal(stats.failures, 1);
  assert.equal(stats.adsbLolRequests, 2);
  assert.equal(stats.airplanesLiveRequests, 1);
  assert.equal(stats.lastProvider, 'airplanes.live');
  assert.equal(stats.lastStatus, 200);

  assert.equal(stats.providers['adsb.lol'].requests, 2);
  assert.equal(stats.providers['adsb.lol'].successes, 1);
  assert.equal(stats.providers['adsb.lol'].failures, 1);
  assert.equal(stats.providers['airplanes.live'].requests, 1);

  const hour = String(new Date().getUTCHours()).padStart(2, '0');
  assert.equal(stats.hourly[hour].requests, 3);
});

test('recordCacheHit, recordQuotaBlocked and recordFallbackActivation each bump their own counter', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  await recordCacheHit(env, ORIGIN);
  await recordCacheHit(env, ORIGIN);
  await recordQuotaBlocked(env, ORIGIN);
  await recordFallbackActivation(env, ORIGIN);

  const stats = await readStats(env, utcDay(), ORIGIN);
  assert.equal(stats.cacheHits, 2);
  assert.equal(stats.quotaBlocked, 1);
  assert.equal(stats.fallbackActivations, 1);
});

test('stats for different days are stored independently', async () => {
  const env = { SKYTRACE_STATS: new FakeKV() };
  await recordProviderRequest(env, 200, ORIGIN, 'adsb.lol');
  const today = await readStats(env, utcDay(), ORIGIN);
  const otherDay = await readStats(env, '2000-01-01', ORIGIN);
  assert.equal(today.requests, 1);
  assert.equal(otherDay.requests, 0);
});

test('getDailyLimit returns a positive number used to gate the airplanes.live quota', () => {
  assert.ok(getDailyLimit() > 0);
});

test('falls back to the Cache API when no KV binding is present', async () => {
  const { restore } = installFakeCaches();
  try {
    const env = {};
    await recordProviderRequest(env, 200, ORIGIN, 'adsb.lol');
    const stats = await readStats(env, utcDay(), ORIGIN);
    assert.equal(stats.requests, 1);
  } finally {
    restore();
  }
});
