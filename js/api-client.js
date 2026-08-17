import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';
const TILE_CACHE_MS = 180000;
const RADIUS_NM = 250;
const GRID_STEP_LAT = 5.5;
const MAX_VIEWPORT_POINTS = 30;
const MAX_CONCURRENCY = 4;

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

function viewportPoints(map, fallbackPoint) {
  if (!map?.getBounds) return [fallbackPoint];

  const bounds = map.getBounds();
  const south = clamp(bounds.getSouth(), -85, 85);
  const north = clamp(bounds.getNorth(), -85, 85);
  let west = bounds.getWest();
  let east = bounds.getEast();

  if (east < west) east += 360;

  const centerLat = (south + north) / 2;
  const cosLat = Math.max(0.25, Math.cos((centerLat * Math.PI) / 180));
  const lonStep = GRID_STEP_LAT / cosLat;

  const latSpan = Math.max(0.1, north - south);
  const lonSpan = Math.max(0.1, east - west);
  let rows = Math.max(1, Math.ceil(latSpan / GRID_STEP_LAT));
  let cols = Math.max(1, Math.ceil(lonSpan / lonStep));

  while (rows * cols > MAX_VIEWPORT_POINTS) {
    if (cols >= rows && cols > 1) cols -= 1;
    else if (rows > 1) rows -= 1;
    else break;
  }

  const points = [];
  for (let row = 0; row < rows; row += 1) {
    const lat = rows === 1 ? centerLat : south + ((row + 0.5) * latSpan) / rows;
    for (let col = 0; col < cols; col += 1) {
      const lon = cols === 1 ? (west + east) / 2 : west + ((col + 0.5) * lonSpan) / cols;
      points.push({
        lat: Number(lat.toFixed(2)),
        lon: Number(wrapLongitude(lon).toFixed(2)),
      });
    }
  }

  return points.length ? points : [fallbackPoint];
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

  async #fetchTile(point, { forceInitial = false } = {}) {
    const key = this.#tileKey(point);
    const now = Date.now();
    const cached = this.#tileCache.get(key);

    if (!forceInitial && cached && now - cached.at < TILE_CACHE_MS) return cached.aircraft;
    if (now < this.#backoffUntil) return cached?.aircraft || [];
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
        throw new Error(`HTTP ${response.status}: ${getErrorMessage(payload, 'AIRCRAFT_API_ERROR')}`);
      }

      if (!payload || !Array.isArray(payload.ac)) throw new Error('INVALID_AIRCRAFT_PAYLOAD');

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

  async fetchPoint(point, _radiusNm, { forceInitial = false } = {}) {
    const map = window.__skytraceMap;
    const points = viewportPoints(map, point);
    const results = [];

    for (let index = 0; index < points.length; index += MAX_CONCURRENCY) {
      const batch = points.slice(index, index + MAX_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((tilePoint) => this.#fetchTile(tilePoint, { forceInitial }))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') results.push(...result.value);
        else console.error('Viewport aircraft tile failed:', result.reason);
      }
    }

    const deduplicated = new Map();
    for (const aircraft of results) {
      const existing = deduplicated.get(aircraft.id);
      if (!existing || aircraft.lastSeen >= existing.lastSeen) deduplicated.set(aircraft.id, aircraft);
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
