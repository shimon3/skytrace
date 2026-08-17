import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';
const TILE_CACHE_MS = 300000;
const RADIUS_NM = 250;
const BASE_GRID_STEP_LAT = 5.5;
const MAX_CONCURRENCY = 3;

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

function snap(value, step) {
  return Math.round(value / step) * step;
}

function maxPointsForZoom(zoom) {
  if (zoom <= 3) return 6;
  if (zoom === 4) return 8;
  if (zoom === 5) return 10;
  if (zoom === 6) return 8;
  if (zoom === 7) return 6;
  if (zoom === 8) return 4;
  return 2;
}

function viewportPoints(map, fallbackPoint) {
  if (!map?.getBounds) return [fallbackPoint];

  const bounds = map.getBounds();
  const zoom = map.getZoom?.() ?? 6;
  const maxPoints = maxPointsForZoom(zoom);
  const south = clamp(bounds.getSouth(), -85, 85);
  const north = clamp(bounds.getNorth(), -85, 85);
  let west = bounds.getWest();
  let east = bounds.getEast();

  if (east < west) east += 360;

  const centerLat = (south + north) / 2;
  const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
  const latStep = BASE_GRID_STEP_LAT;
  const lonStep = BASE_GRID_STEP_LAT / cosLat;

  const startLat = snap(south, latStep);
  const endLat = snap(north, latStep);
  const startLon = snap(west, lonStep);
  const endLon = snap(east, lonStep);
  const candidates = [];

  for (let lat = startLat; lat <= endLat + latStep * 0.5; lat += latStep) {
    for (let lon = startLon; lon <= endLon + lonStep * 0.5; lon += lonStep) {
      candidates.push({
        lat: Number(clamp(lat, -85, 85).toFixed(2)),
        lon: Number(wrapLongitude(lon).toFixed(2)),
      });
    }
  }

  if (!candidates.length) {
    return [
      {
        lat: Number(snap(centerLat, latStep).toFixed(2)),
        lon: Number(wrapLongitude(snap((west + east) / 2, lonStep)).toFixed(2)),
      },
    ];
  }

  const centerLon = wrapLongitude((west + east) / 2);
  candidates.sort((a, b) => {
    const distanceA = Math.hypot(a.lat - centerLat, (a.lon - centerLon) * cosLat);
    const distanceB = Math.hypot(b.lat - centerLat, (b.lon - centerLon) * cosLat);
    return distanceA - distanceB;
  });

  return candidates.slice(0, maxPoints);
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

  async #fetchTile(point) {
    const key = this.#tileKey(point);
    const now = Date.now();
    const cached = this.#tileCache.get(key);

    if (cached && now - cached.at < TILE_CACHE_MS) return cached.aircraft;
    if (now < this.#backoffUntil || document.hidden) return cached?.aircraft || [];
    if (this.#inFlight.has(key)) return this.#inFlight.get(key);

    const request = (async () => {
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        radius: String(RADIUS_NM),
        prefer: 'adsb.lol',
      });

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
        throw new Error(`HTTP ${response.status}: ${getErrorMessage(payload, 'AIRCRAFT_API_ERROR')}`);
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
    const points = viewportPoints(map, point);
    const deduplicated = new Map();

    const merge = (aircraftList) => {
      for (const aircraft of aircraftList) {
        const existing = deduplicated.get(aircraft.id);
        if (!existing || aircraft.lastSeen >= existing.lastSeen) deduplicated.set(aircraft.id, aircraft);
      }
      if (typeof onPartial === 'function') onPartial([...deduplicated.values()]);
    };

    for (let index = 0; index < points.length; index += MAX_CONCURRENCY) {
      const batch = points.slice(index, index + MAX_CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map((tilePoint) => this.#fetchTile(tilePoint)));

      for (const result of batchResults) {
        if (result.status === 'fulfilled') merge(result.value);
        else console.error('Viewport aircraft tile failed:', result.reason);
      }
    }

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
