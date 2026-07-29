import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feetPerMinuteToMetersPerSecond,
  feetToMeters,
  knotsToMetersPerSecond,
  projectPosition,
} from '../lib/flight-math.js';

test('converts aviation units to metric values', () => {
  assert.equal(feetToMeters(1000), 304.8);
  assert.equal(knotsToMetersPerSecond(100), 51.44);
  assert.equal(feetPerMinuteToMetersPerSecond(1000), 5.08);
});

test('does not project an aircraft on the ground', () => {
  const aircraft = {
    lat: 32,
    lon: 34,
    speed: 200,
    heading: 90,
    onGround: true,
    lastSeen: 0,
  };

  assert.deepEqual(projectPosition(aircraft, 60_000), { lat: 32, lon: 34 });
});

test('caps extrapolation at the configured maximum duration', () => {
  const aircraft = {
    lat: 0,
    lon: 0,
    speed: 100,
    heading: 90,
    onGround: false,
    lastSeen: 0,
  };

  const atNinetySeconds = projectPosition(aircraft, 90_000);
  const afterFiveMinutes = projectPosition(aircraft, 300_000);

  assert.ok(Math.abs(atNinetySeconds.lat - afterFiveMinutes.lat) < 1e-10);
  assert.ok(Math.abs(atNinetySeconds.lon - afterFiveMinutes.lon) < 1e-10);
  assert.ok(afterFiveMinutes.lon > 0);
});
