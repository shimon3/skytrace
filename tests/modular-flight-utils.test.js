import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAircraft, projectPosition } from '../js/flight-utils.js';

test('normalizeAircraft stores the registration under registration, not country', () => {
  const aircraft = normalizeAircraft({
    hex: 'abc123', flight: ' SKY1 ', r: '4X-ABC', t: 'B738', lat: 32, lon: 34,
    alt_baro: 10000, gs: 400, track: 90, baro_rate: 500, squawk: '1234',
  }, 1000);
  assert.equal(aircraft.registration, '4X-ABC');
  assert.equal(Object.hasOwn(aircraft, 'country'), false);
  assert.equal(aircraft.callsign, 'SKY1');
});

test('projectPosition keeps aircraft on the ground at the received position', () => {
  const aircraft = { lat: 32, lon: 34, speed: 50, heading: 90, onGround: true, lastSeen: 0 };
  assert.deepEqual(projectPosition(aircraft, 90000), { lat: 32, lon: 34 });
});

test('projectPosition caps extrapolation at 90 seconds', () => {
  const aircraft = { lat: 0, lon: 0, speed: 200, heading: 90, onGround: false, lastSeen: 0 };
  assert.deepEqual(projectPosition(aircraft, 90000), projectPosition(aircraft, 180000));
});
