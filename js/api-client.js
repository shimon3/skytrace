import { normalizeAircraft } from './flight-utils.js';

const AIRCRAFT_API = 'https://api.airplanes.live/v2/point';
const PHOTO_API = 'https://api.planespotters.net/pub/photos/reg';

export class AircraftApiClient {
  #queue = Promise.resolve();
  #consecutiveFailures = 0;
  #backoffUntil = 0;
  #lastSuccessfulUpdate = null;

  get lastSuccessfulUpdate() { return this.#lastSuccessfulUpdate; }

  async fetchPoint(point, radiusNm) {
    const task = async () => {
      if (Date.now() < this.#backoffUntil) throw new Error('API_BACKOFF');
      try {
        const response = await fetch(`${AIRCRAFT_API}/${point.lat}/${point.lon}/${radiusNm}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const now = Date.now();
        this.#lastSuccessfulUpdate = now;
        this.#consecutiveFailures = 0;
        return (payload.ac || [])
          .filter(item => item.hex && item.lat != null && item.lon != null)
          .map(item => normalizeAircraft(item, now));
      } catch (error) {
        if (error.message !== 'API_BACKOFF') {
          this.#consecutiveFailures += 1;
          if (this.#consecutiveFailures >= 3) {
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
