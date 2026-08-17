import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';
const RADIUS_NM = 250;
const GRID_STEP_LAT = 5.5;
const MAX_CONCURRENCY = 3;
const DEFAULT_TILE_CACHE_MS = 300000;

function getErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  return payload.message || payload.error || fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapLongitude(value) {
  let lon = value;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

function lowZoomLimit(zoom) {
  if (zoom <= 2) return 8;
  if (zoom === 3) return 12;
  if (zoom === 4) return 20;
  return Infinity;
}

function gridCenters(min, max, step) {
  const first = Math.floor(min / step) * step + step / 2;
  const last = Math.ceil(max / step) * step - step / 2;
  const values = [];

  if (last < first) return [(min + max) / 2];
  for (let value = first; value <= last + 0.0001; value += step) values.push(value);
  return values;
}

export function viewportPoints(map, fallbackPoint) {
  if (!map?.getBounds) return [fallbackPoint];

  const paddedBounds = map.getBounds().pad(0.08);
  const zoom = map.getZoom?.() ?? 6;
  const south = clamp(paddedBounds.getSouth(), -85, 85);
  const north = clamp(paddedBounds.getNorth(), -85, 85);
  let west = paddedBounds.getWest();
  let east = paddedBounds.getEast();

  if (east < west) east += 360;

  const centerLat = (south + north) / 2;
  const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
  const lonStep = GRID_STEP_LAT / cosLat;
  const latitudes = gridCenters(south, north, GRID_STEP_LAT);
  const longitudes = gridCenters(west, east, lonStep);
  const points = [];

  for (const lat of latitudes) {
    for (const lon of longitudes) {
      points.push({
        lat: Number(clamp(lat, -85, 85).toFixed(2)),
        lon: Number(wrapLongitude(lon).toFixed(2)),
      });
    }
  }

  if (!points.length) return [fallbackPoint];

  const limit = lowZoomLimit(zoom);
  if (points.length <= limit) return points;

  const selected = [];
  const stride = points.length / limit;
  for (let index = 0; index < limit; index += 1) {
    selected.push(points[Math.min(points.length - 1, Math.floor(index * stride + stride / 2))]);
  }
  return selected;
}

function cacheDurationForZoom(zoom) {
  if (zoom >= 8) return 120000;
  if (zoom >= 6) return 180000;
  return DEFAULT_TILE_CACHE_MS;
}

export class AircraftApiClient {
  #lastSuccessfulUpdate = null;
  #backoffUntil = 0;
  #tileCache = new Map();
  #inFlight = new Map();

  get lastSuccessfulUpdate() {
    return this.#lastSuccessfulUpdate;
  }

  get backoffUntil() {
    return this.#backoffUntil;
  }

  get nextRequestAt() {
    return this.#backoffUntil;
  }

  canRequestNow() {
    return Date.now() >= this.#backoffUntil;
  }

  #tileKey(point) {
    return `${point.lat.toFixed(2)}:${point.lon.toFixed(2)}:${RADIUS_NM}`;
  }

  async #fetchTile(point, cacheDurationMs, detailed) {
    const key = this.#tileKey(point);
    const now = Date.now();
    const cached = this.#tileCache.get(key);

    if (cached && now - cached.at < cacheDurationMs) return cached.aircraft;
    if (now < this.#backoffUntil || document.hidden) return cached?.aircraft || [];
    if (this.#inFlight.has(key)) return this.#inFlight.get(key);

    const request = (async () => {
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        radius: String(RADIUS_NM),
        prefer: 'adsb.lol',
      });
      if (detailed) params.set('detail', '1');

      const response = await fetch(`${AIRCRAFT_API}?${params}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (response.status === 429) {
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 180;
          this.#backoffUntil = Date.now() + seconds * 1000;
        }
        if (cached) return cached.aircraft;
        throw new Error(
          `HTTP ${response.status}: ${getErrorMessage(payload, 'AIRCRAFT_API_ERROR')}`
        );
      }

      if (!payload || !Array.isArray(payload.ac)) {
        if (cached) return cached.aircraft;
        throw new Error('INVALID_AIRCRAFT_PAYLOAD');
      }

      const receivedAt = Date.now();
      const aircraft = payload.ac
        .filter((item) => item && item.hex && item.lat != null && item.lon != null)
        .map((item) => normalizeAircraft(item, receivedAt));

      this.#tileCache.set(key, { at: receivedAt, aircraft });
      this.#lastSuccessfulUpdate = receivedAt;
      return aircraft;
    })().finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, request);
    return request;
  }

  async fetchPoint(point, _radiusNm, { onPartial } = {}) {
    const map = window.__skytraceMap;
    const zoom = map?.getZoom?.() ?? 6;
    const points = viewportPoints(map, point);
    const cacheDurationMs = cacheDurationForZoom(zoom);
    const detailed = zoom >= 7;
    const deduplicated = new Map();

    const merge = (aircraftList) => {
      for (const aircraft of aircraftList) {
        const existing = deduplicated.get(aircraft.id);
        if (!existing || aircraft.lastSeen >= existing.lastSeen) {
          deduplicated.set(aircraft.id, aircraft);
        }
      }
      if (typeof onPartial === 'function') onPartial([...deduplicated.values()]);
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < points.length) {
        const tilePoint = points[cursor];
        cursor += 1;
        try {
          merge(await this.#fetchTile(tilePoint, cacheDurationMs, detailed));
        } catch (error) {
          console.error('Viewport aircraft tile failed:', error);
        }
      }
    };

    const workers = Math.min(MAX_CONCURRENCY, points.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return [...deduplicated.values()];
  }
}

const photoCache = new Map();

export async function getAircraftPhoto(registration) {
  if (!registration) return null;
  if (photoCache.has(registration)) return photoCache.get(registration);
  try {
    const response = await fetch(`${PHOTO_API}/${encodeURIComponent(registration)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const url = payload.photos?.[0]?.thumbnail_large?.src || null;
    photoCache.set(registration, url);
    return url;
  } catch {
    photoCache.set(registration, null);
    return null;
  }
}
