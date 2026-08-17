import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';
const MIN_REQUEST_INTERVAL_MS = 180000;

function getErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  return payload.message || payload.error || fallback;
}

export class AircraftApiClient {
  #consecutiveFailures = 0;
  #backoffUntil = 0;
  #lastSuccessfulUpdate = null;
  #lastRequestAt = 0;
  #requestInFlight = false;

  get lastSuccessfulUpdate() {
    return this.#lastSuccessfulUpdate;
  }

  get backoffUntil() {
    return this.#backoffUntil;
  }

  get nextRequestAt() {
    return Math.max(this.#lastRequestAt + MIN_REQUEST_INTERVAL_MS, this.#backoffUntil);
  }

  canRequestNow() {
    return !this.#requestInFlight && Date.now() >= this.nextRequestAt;
  }

  async fetchPoint(point, radiusNm, { forceInitial = false } = {}) {
    const now = Date.now();

    if (this.#requestInFlight) return null;
    if (!forceInitial && now < this.nextRequestAt) return null;
    if (now < this.#backoffUntil) return null;

    this.#requestInFlight = true;
    this.#lastRequestAt = now;

    try {
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        radius: String(radiusNm),
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
        const message = getErrorMessage(payload, `HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${message}`);
      }

      if (!payload || !Array.isArray(payload.ac)) {
        throw new Error('INVALID_AIRCRAFT_PAYLOAD');
      }

      const receivedAt = Date.now();
      this.#lastSuccessfulUpdate = receivedAt;
      this.#consecutiveFailures = 0;

      return payload.ac
        .filter((item) => item && item.hex && item.lat != null && item.lon != null)
        .map((item) => normalizeAircraft(item, receivedAt));
    } catch (error) {
      this.#consecutiveFailures += 1;
      if (this.#consecutiveFailures >= 3 && Date.now() >= this.#backoffUntil) {
        const seconds = Math.min(60 * 2 ** (this.#consecutiveFailures - 3), 300);
        this.#backoffUntil = Date.now() + seconds * 1000;
      }
      throw error;
    } finally {
      this.#requestInFlight = false;
    }
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
