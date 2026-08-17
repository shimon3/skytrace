import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAircraftFilters,
  feetPerMinuteToMetersPerSecond,
  feetToMeters,
  knotsToMetersPerSecond,
  normalizeAircraft,
  projectPosition,
} from '../js/flight-utils.js';

test('converts aviation units to metric values', () => {
  assert.equal(feetToMeters(1000), 304.8);
  assert.equal(knotsToMetersPerSecond(100), 51.4444);
  assert.equal(feetPerMinuteToMetersPerSecond(1000), 5.08);
});

test('normalizeAircraft uses registration and normalizes API values', () => {
  const aircraft = normalizeAircraft(
    {
      hex: 'abc123',
      flight: ' SKY1 ',
      r: '4X-ABC',
      t: 'B738',
      lat: 32,
      lon: 34,
      alt_baro: 10000,
      gs: 400,
      track: 90,
      baro_rate: 500,
      squawk: '1234',
    },
    1000
  );

  assert.equal(aircraft.registration, '4X-ABC');
  assert.equal(Object.hasOwn(aircraft, 'country'), false);
  assert.equal(aircraft.callsign, 'SKY1');
  assert.equal(aircraft.alt, 3048);
  assert.equal(aircraft.lastSeen, 1000);
});

test('normalizeAircraft honors ADS-B seen_pos age', () => {
  const aircraft = normalizeAircraft(
    {
      hex: 'abc124',
      lat: 32,
      lon: 34,
      seen_pos: 12.5,
    },
    20000
  );

  assert.equal(aircraft.lastSeen, 7500);
});

test('projectPosition keeps aircraft on the ground at the received position', () => {
  const aircraft = { lat: 32, lon: 34, speed: 50, heading: 90, onGround: true, lastSeen: 0 };
  assert.deepEqual(projectPosition(aircraft, 90000), { lat: 32, lon: 34 });
});

test('projectPosition caps extrapolation at 90 seconds', () => {
  const aircraft = { lat: 0, lon: 0, speed: 200, heading: 90, onGround: false, lastSeen: 0 };
  assert.deepEqual(projectPosition(aircraft, 90000), projectPosition(aircraft, 180000));
});

test('projectPosition remains finite at high latitude', () => {
  const aircraft = { lat: 89, lon: 30, speed: 250, heading: 90, onGround: false, lastSeen: 0 };
  const projected = projectPosition(aircraft, 60000);
  assert.equal(Number.isFinite(projected.lat), true);
  assert.equal(Number.isFinite(projected.lon), true);
  assert.ok(projected.lon >= -180 && projected.lon < 180);
});

test('applyAircraftFilters combines altitude and ground filters', () => {
  const aircraft = [
    { id: 'ground', alt: 0, onGround: true },
    { id: 'low', alt: 900, onGround: false },
    { id: 'cruise', alt: 9000, onGround: false },
  ];
  const result = applyAircraftFilters(aircraft, { altMin: 1000, altMax: 10000, hideGround: true });
  assert.deepEqual(
    result.map((item) => item.id),
    ['cruise']
  );
});
