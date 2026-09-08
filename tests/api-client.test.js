import test from 'node:test';
import assert from 'node:assert/strict';

import { viewportPoints } from '../js/api-client.js';

function fakeMap({ south, north, west, east, zoom }) {
  const bounds = {
    getSouth: () => south,
    getNorth: () => north,
    getWest: () => west,
    getEast: () => east,
    pad: () => bounds,
  };

  return {
    getBounds: () => bounds,
    getZoom: () => zoom,
  };
}

test('country-level view keeps multiple generated coverage tiles', () => {
  const points = viewportPoints(fakeMap({ south: 27, north: 35, west: 29, east: 39, zoom: 6 }), {
    lat: 31.5,
    lon: 34.8,
  });

  assert.ok(points.length >= 4);
  assert.ok(points.length <= 6);
  assert.ok(points.some((point) => point.lat < 31));
  assert.ok(points.some((point) => point.lat > 31));
});

test('world view is capped aggressively without collapsing to a single point', () => {
  const points = viewportPoints(
    fakeMap({ south: -70, north: 70, west: -170, east: 170, zoom: 2 }),
    { lat: 0, lon: 0 }
  );

  assert.equal(points.length, 3);
  assert.equal(new Set(points.map((point) => `${point.lat}:${point.lon}`)).size, 3);
  assert.ok(points.some((point) => point.lat !== 0 || point.lon !== 0));
});

test('viewport points stay within valid geographic coordinates', () => {
  const points = viewportPoints(fakeMap({ south: 78, north: 88, west: 160, east: 200, zoom: 5 }), {
    lat: 82,
    lon: 180,
  });

  for (const point of points) {
    assert.ok(point.lat >= -85 && point.lat <= 85);
    assert.ok(point.lon >= -180 && point.lon <= 180);
  }
});
