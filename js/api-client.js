import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = '/api/aircraft';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';
const MIN_REQUEST_INTERVAL_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  return payload.message || payload.error || fallback;
}

export class AircraftApiClient {
  #queue = Promise.resolve();
  #consecutiveFailures = 0;
  #backoffUntil = 0;
  #lastSuccessfulUpdate = null;
  #lastRequestAt = 0;

  get lastSuccessfulUpdate() {
    return this.#lastSuccessfulUpdate;
  }

  get backoffUntil() {
    return this.#backoffUntil;
  }

  async fetchPoint(point, radiusNm) {
    const task = async () => {
      const now = Date.now();
      if (now < this.#backoffUntil) {
        const waitSeconds = Math.ceil((this.#backoffUntil - now) / 1000);
        throw new Error(`API_BACKOFF:${waitSeconds}`);
      }

      const sinceLastRequest = now - this.#lastRequestAt;
      if (sinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
        await sleep(MIN_REQUEST_INTERVAL_MS - sinceLastRequest);
      }
      this.#lastRequestAt = Date.now();

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
            const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 120;
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
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('API_BACKOFF')) {
          this.#consecutiveFailures += 1;
          if (this.#consecutiveFailures >= 3 && Date.now() >= this.#backoffUntil) {
            const seconds = Math.min(15 * 2 ** (this.#consecutiveFailures - 3), 120);
            this.#backoffUntil = Date.now() + seconds * 1000;
          }
        }
        throw error;
      }
    };

    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => undefined);
    return result;
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
