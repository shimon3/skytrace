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

test('country-level view keeps all generated coverage tiles', () => {
  const points = viewportPoints(fakeMap({ south: 27, north: 35, west: 29, east: 39, zoom: 6 }), {
    lat: 31.5,
    lon: 34.8,
  });

  assert.ok(points.length >= 4);
  assert.ok(points.length <= 12);
  assert.ok(points.some((point) => point.lat < 31));
  assert.ok(points.some((point) => point.lat > 31));
});

test('world view is capped without collapsing to the center', () => {
  const points = viewportPoints(
    fakeMap({ south: -70, north: 70, west: -170, east: 170, zoom: 2 }),
    { lat: 0, lon: 0 }
  );

  assert.equal(points.length, 8);
  const latitudeSpread =
    Math.max(...points.map((point) => point.lat)) - Math.min(...points.map((point) => point.lat));
  const longitudeSpread =
    Math.max(...points.map((point) => point.lon)) - Math.min(...points.map((point) => point.lon));
  assert.ok(latitudeSpread > 40);
  assert.ok(longitudeSpread > 100);
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
