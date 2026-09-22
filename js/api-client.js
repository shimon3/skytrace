import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = '/api/photo';
const RADIUS_NM = 250;
// 250 NM circular tiles can safely use up to ~5.89° center spacing at the equator
// without diagonal coverage gaps. 5.8° cuts redundant overlap while preserving coverage.
const GRID_STEP_LAT = 5.8;
const MAX_CONCURRENCY = 1;
const MIN_NETWORK_SPACING_MS = 1100;
// Positions do not need a full viewport rescan every few minutes. Keep populated
// tiles for 8–12 minutes depending on zoom; interpolation keeps movement smooth.
const DEFAULT_TILE_CACHE_MS = 720000;
const EMPTY_TILE_CACHE_MS = 120000;
const PERSISTED_TILE_MAX_AGE_MS = 900000;
const PERSISTED_TILE_PREFIX = 'skytrace_aircraft_tile_v1:';
// The backend can legitimately need time to skip a paused provider and try a fallback.
// Keep this comfortably above the backend's per-provider timeout.
const CLIENT_TILE_TIMEOUT_MS = 30000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function readPersistedTile(key) {
  try {
    const raw = sessionStorage.getItem(`${PERSISTED_TILE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Number.isFinite(parsed.at) ||
      !Array.isArray(parsed.aircraft) ||
      parsed.aircraft.length === 0 ||
      Date.now() - parsed.at > PERSISTED_TILE_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(`${PERSISTED_TILE_PREFIX}${key}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedTile(key, entry) {
  if (!entry?.aircraft?.length) return;
  try {
    sessionStorage.setItem(`${PERSISTED_TILE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Storage is only a refresh-resilience optimization. Ignore quota/privacy failures.
  }
}

function gridCenters(min, max, step) {
  const first = Math.floor(min / step) * step + step / 2;
  const last = Math.ceil(max / step) * step - step / 2;
  const values = [];

  if (last < first) return [(min + max) / 2];
  for (let value = first; value <= last + 0.0001; value += step) values.push(value);
  return values;
}

function closestLatitudeToEquator(south, north) {
  if (south <= 0 && north >= 0) return 0;
  return Math.abs(south) < Math.abs(north) ? south : north;
}

function pointDistanceSquared(a, b) {
  const dLat = a.lat - b.lat;
  const cosLat = Math.max(0.2, Math.cos((b.lat * Math.PI) / 180));
  const dLon = (a.lon - b.lon) * cosLat;
  return dLat * dLat + dLon * dLon;
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

  const safestLatitude = closestLatitudeToEquator(south, north);
  const cosLat = Math.max(0.25, Math.cos((safestLatitude * Math.PI) / 180));
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

  const center = {
    lat: Number(clamp(fallbackPoint.lat, -85, 85).toFixed(2)),
    lon: Number(wrapLongitude(fallbackPoint.lon).toFixed(2)),
  };
  const deduped = new Map([[`${center.lat}:${center.lon}`, center]]);
  for (const point of points) deduped.set(`${point.lat}:${point.lon}`, point);
  const ordered = [...deduped.values()].sort(
    (a, b) => pointDistanceSquared(a, center) - pointDistanceSquared(b, center)
  );

  // Every generated center represents part of the currently visible viewport.
  // Dropping centers here creates geographic holes. The grid itself bounds the
  // request count, so return the complete visible set.
  return ordered;
}

function cacheDurationForZoom(zoom) {
  if (zoom >= 8) return 480000;
  if (zoom >= 6) return 600000;
  return DEFAULT_TILE_CACHE_MS;
}

export class AircraftApiClient {
  #lastSuccessfulUpdate = null;
  #lastCoverageComplete = false;
  #backoffUntil = 0;
  #tileCache = new Map();
  #inFlight = new Map();
  #viewportGeneration = 0;
  #lastNetworkRequestAt = 0;

  get lastSuccessfulUpdate() {
    return this.#lastSuccessfulUpdate;
  }
  get lastCoverageComplete() {
    return this.#lastCoverageComplete;
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

  invalidateViewport() {
    // Make any viewport load already in progress obsolete. In-flight HTTP may
    // finish, but its result will no longer be merged and the tile loop stops.
    this.#viewportGeneration += 1;
    this.#lastCoverageComplete = false;
  }

  #tileKey(point) {
    return `${point.lat.toFixed(2)}:${point.lon.toFixed(2)}:${RADIUS_NM}`;
  }

  async #paceNetwork() {
    const delay = Math.max(0, this.#lastNetworkRequestAt + MIN_NETWORK_SPACING_MS - Date.now());
    if (delay) await wait(delay);
    this.#lastNetworkRequestAt = Date.now();
  }

  async #fetchTile(point, cacheDurationMs, detailed) {
    const key = this.#tileKey(point);
    const now = Date.now();
    let cached = this.#tileCache.get(key);
    if (!cached) {
      cached = readPersistedTile(key);
      if (cached) this.#tileCache.set(key, cached);
    }
    const effectiveCacheMs = cached?.aircraft?.length ? cacheDurationMs : EMPTY_TILE_CACHE_MS;

    if (cached && now - cached.at < effectiveCacheMs) return cached.aircraft;
    if (document.hidden) {
      if (cached) return cached.aircraft;
      throw new Error('PAGE_HIDDEN');
    }
    if (now < this.#backoffUntil) {
      if (cached) return cached.aircraft;
      throw new Error('BACKOFF_ACTIVE');
    }
    if (this.#inFlight.has(key)) return this.#inFlight.get(key);

    const request = (async () => {
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        radius: String(RADIUS_NM),
      });
      if (detailed) params.set('detail', '1');

      await this.#paceNetwork();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CLIENT_TILE_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(`${AIRCRAFT_API}?${params}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          if (cached) return cached.aircraft;
          throw new Error('AIRCRAFT_API_TIMEOUT');
        }
        if (cached) return cached.aircraft;
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (response.status === 429) {
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
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

      // A transient empty 200 response must not erase a recently successful viewport.
      if (
        aircraft.length === 0 &&
        cached?.aircraft?.length &&
        receivedAt - cached.at <= PERSISTED_TILE_MAX_AGE_MS
      ) {
        return cached.aircraft;
      }

      const entry = { at: receivedAt, aircraft };
      this.#tileCache.set(key, entry);
      if (aircraft.length > 0) writePersistedTile(key, entry);
      this.#lastSuccessfulUpdate = receivedAt;
      return aircraft;
    })().finally(() => this.#inFlight.delete(key));

    this.#inFlight.set(key, request);
    return request;
  }

  async fetchPoint(point, _radiusNm, { onPartial } = {}) {
    const generation = ++this.#viewportGeneration;
    const map = window.__skytraceMap;
    const zoom = map?.getZoom?.() ?? 6;
    const points = viewportPoints(map, point);
    const cacheDurationMs = cacheDurationForZoom(zoom);
    const detailed = zoom >= 7;
    const deduplicated = new Map();
    let completedTiles = 0;

    this.#lastCoverageComplete = false;

    const merge = (aircraftList) => {
      if (generation !== this.#viewportGeneration) return;
      for (const aircraft of aircraftList) {
        const existing = deduplicated.get(aircraft.id);
        if (!existing || aircraft.lastSeen >= existing.lastSeen)
          deduplicated.set(aircraft.id, aircraft);
      }
      if (typeof onPartial === 'function') onPartial([...deduplicated.values()]);
    };

    // Fetch the actual map center first. viewportPoints() is distance-sorted, but
    // relying on points[0] made coverage fragile when grid/deduping changed.
    const centerPoint = {
      lat: Number(clamp(point.lat, -85, 85).toFixed(2)),
      lon: Number(wrapLongitude(point.lon).toFixed(2)),
    };
    try {
      const centerAircraft = await this.#fetchTile(centerPoint, cacheDurationMs, detailed);
      if (generation !== this.#viewportGeneration) return [];
      completedTiles += 1;
      merge(centerAircraft);
    } catch (error) {
      console.error('Viewport center tile failed:', error);
    }

    const remaining = points.filter(
      (tilePoint) => tilePoint.lat !== centerPoint.lat || tilePoint.lon !== centerPoint.lon
    );

    const fillViewport = async () => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < remaining.length && generation === this.#viewportGeneration) {
          if (Date.now() < this.#backoffUntil) break;
          const tilePoint = remaining[cursor];
          cursor += 1;
          try {
            const aircraft = await this.#fetchTile(tilePoint, cacheDurationMs, detailed);
            if (generation !== this.#viewportGeneration) break;
            completedTiles += 1;
            merge(aircraft);
          } catch (error) {
            console.error('Viewport aircraft tile failed:', error);
            if (Date.now() < this.#backoffUntil) break;
          }
        }
      };

      const workers = Math.min(MAX_CONCURRENCY, remaining.length);
      await Promise.all(Array.from({ length: workers }, () => worker()));
      if (generation === this.#viewportGeneration) {
        this.#lastCoverageComplete = completedTiles === points.length;
      }
    };

    if (remaining.length) await fillViewport();
    else this.#lastCoverageComplete = completedTiles === points.length;

    if (generation !== this.#viewportGeneration) return [];
    if (completedTiles === 0) throw new Error('VIEWPORT_DATA_UNAVAILABLE');
    return [...deduplicated.values()];
  }
}

const photoCache = new Map();

export async function getAircraftPhoto(registration) {
  if (!registration) return null;
  if (photoCache.has(registration)) return photoCache.get(registration);
  try {
    const response = await fetch(`${PHOTO_API}?registration=${encodeURIComponent(registration)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const url = payload?.url || null;
    photoCache.set(registration, url);
    return url;
  } catch {
    photoCache.set(registration, null);
    return null;
  }
}
