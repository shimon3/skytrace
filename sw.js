const SW_VERSION = '20260908-09';
const CACHE_NAME = `skytrace-static-${SW_VERSION}`;
const APP_SHELL_REQUEST = new Request('/');

const PRECACHE_URLS = [
  '/',
  `/style.css?v=${SW_VERSION}`,
  `/mobile.css?v=${SW_VERSION}`,
  `/flight-status.css?v=${SW_VERSION}`,
  `/panel-wide-layout.css?v=${SW_VERSION}`,
  `/app.js?v=${SW_VERSION}`,
  `/js/flight-status-integration.js?v=${SW_VERSION}`,
  '/js/api-client.js',
  '/js/flight-utils.js',
  '/js/i18n.js',
  '/js/map-view.js',
  '/js/search-ui.js',
  '/js/airport-autocomplete.js',
  '/js/search-flight-marker.js',
  '/data/airports.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_REQUEST, clone));
          }
          return response;
        })
        .catch(() => caches.match(APP_SHELL_REQUEST))
    );
    return;
  }

  if (!CACHEABLE_DESTINATIONS.has(request.destination)) return;

  if (request.destination === 'script') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
