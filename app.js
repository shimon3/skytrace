import { AIRPORTS } from './data/airports.js';
import { AircraftApiClient, getAircraftPhoto } from './js/api-client.js';
import { applyAircraftFilters, projectPosition } from './js/flight-utils.js';
import { applyLanguage, getLanguage, t } from './js/i18n.js';
import { createMapView } from './js/map-view.js';

const RADIUS_NM = 250;
const TICK_MS = 180000;
const STALE_MS = 600000;
const MOVE_DEBOUNCE_MS = 850;
const TRAILS_STORAGE_KEY = 'skytrace_trails_v2';

const CONTINENT_VIEWS = {
  Europe: [[50, 12], 5],
  'Moyen-Orient': [[31.5, 34.8], 6],
  Afrique: [[2, 20], 4],
  Asie: [[32, 90], 4],
  Océanie: [[-22, 150], 4],
  'Amérique du Nord': [[45, -100], 4],
  'Amérique du Sud': [[-15, -60], 4],
};

const elements = {
  status: document.getElementById('status'),
  zone: document.getElementById('zone-name'),
  count: document.getElementById('stat-count'),
  cycles: document.getElementById('stat-cycles'),
  panel: document.getElementById('panel'),
  registration: document.getElementById('p-registration'),
  search: document.getElementById('search'),
  photo: document.getElementById('p-photo'),
};
const api = new AircraftApiClient();
const { map, planeLayer } = createMapView();
map.setView([31.5, 34.8], 6, { animate: false });
if (elements.status) elements.status.style.display = 'none';
if (elements.cycles?.parentElement) elements.cycles.parentElement.style.display = 'none';
const routeLine = L.polyline([], {
  color: '#38bdf8',
  weight: 3.5,
  opacity: 0.95,
  dashArray: '1,7',
  lineCap: 'round',
  className: 'route-glow',
});
const aircraftById = new Map();
const filters = { altMin: null, altMax: null, hideGround: false };
let selectedId = null,
  renderedAircraft = [],
  followEnabled = false,
  routeVisible = false;
let animationFrame = null,
  lastFrameAt = 0,
  customCircle = null,
  moveRefreshTimer = null;
let trails = loadTrails();
function loadTrails() {
  try {
    return JSON.parse(localStorage.getItem(TRAILS_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveTrails() {
  localStorage.setItem(
    TRAILS_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(Object.entries(trails).slice(-30)))
  );
}
function currentPoint() {
  const c = map.getCenter();
  return { name: 'Zone affichée', lat: Number(c.lat.toFixed(3)), lon: Number(c.lng.toFixed(3)) };
}
function updateZoneLabel() {
  const p = currentPoint();
  elements.zone.textContent = `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
}
function mergeAircraft(received, { replace = false } = {}) {
  const now = Date.now();
  if (replace) aircraftById.clear();
  for (const a of received || []) aircraftById.set(a.id, a);
  for (const [id, a] of aircraftById) if (now - a.lastSeen > STALE_MS) aircraftById.delete(id);
  updateSelectedTrail();
  if (selectedId && aircraftById.has(selectedId)) updatePanel(aircraftById.get(selectedId));
  checkSharedPlane();
}
async function fetchTick() {
  const point = currentPoint();
  updateZoneLabel();
  try {
    const received = await api.fetchPoint(point, RADIUS_NM, {
      onPartial: (partial) => mergeAircraft(partial),
    });
    if (received != null) mergeAircraft(received, { replace: true });
  } catch (error) {
    console.error('Aircraft data refresh failed:', error);
  }
}
function scheduleViewportRefresh() {
  clearTimeout(moveRefreshTimer);
  moveRefreshTimer = setTimeout(() => {
    if (!document.hidden) fetchTick();
  }, MOVE_DEBOUNCE_MS);
}
function updateSelectedTrail() {
  const a = aircraftById.get(selectedId);
  if (!a) return;
  const trail = (trails[selectedId] ||= []);
  const last = trail.at(-1);
  if (!last || last[0] !== a.lat || last[1] !== a.lon) {
    trail.push([a.lat, a.lon]);
    if (trail.length > 60) trail.shift();
    saveTrails();
  }
  if (routeVisible) routeLine.setLatLngs(trail);
  updateRouteInfo(trail.length);
}
function render(now) {
  if (now - lastFrameAt >= 150) {
    lastFrameAt = now;
    const visible = applyAircraftFilters([...aircraftById.values()], filters);
    renderedAircraft = visible.map((a) => ({
      ...a,
      ...projectPosition(a, Date.now()),
      selected: a.id === selectedId,
    }));
    planeLayer.setData(renderedAircraft);
    elements.count.textContent = visible.length.toLocaleString(getLanguage());
    if (followEnabled && selectedId) {
      const a = renderedAircraft.find((i) => i.id === selectedId);
      if (a) map.panTo([a.lat, a.lon], { animate: false });
    }
  }
  animationFrame = requestAnimationFrame(render);
}
function selectAircraft(a) {
  selectedId = a.id;
  trails[selectedId] ||= [[a.lat, a.lon]];
  updatePanel(a);
  updateRouteInfo(trails[selectedId].length);
}
async function updatePanel(a) {
  elements.panel.classList.add('show');
  document.getElementById('p-callsign').textContent = a.callsign || a.id.toUpperCase();
  const badge = document.getElementById('p-type-badge');
  badge.textContent = a.type || '';
  badge.style.display = a.type ? 'inline-block' : 'none';
  elements.registration.textContent = a.registration || '—';
  document.getElementById('p-alt').textContent = a.alt == null ? '—' : `${Math.round(a.alt)} m`;
  document.getElementById('p-speed').textContent =
    a.speed == null ? '—' : `${Math.round(a.speed * 3.6)} km/h`;
  document.getElementById('p-heading').textContent =
    a.heading == null ? '—' : `${Math.round(a.heading)}°`;
  document.getElementById('p-vrate').textContent =
    a.vrate == null ? '—' : `${a.vrate > 0 ? '+' : ''}${a.vrate.toFixed(1)} m/s`;
  document.getElementById('p-squawk').textContent = a.squawk || '—';
  document.getElementById('p-pos').textContent = `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`;
  const photo = await getAircraftPhoto(a.registration);
  if (selectedId === a.id && photo) {
    elements.photo.src = photo;
    elements.photo.style.display = 'block';
  } else elements.photo.style.display = 'none';
}
function closePanel() {
  elements.panel.classList.remove('show');
  selectedId = null;
  followEnabled = false;
  routeVisible = false;
  document.getElementById('btn-follow').classList.remove('active');
  document.getElementById('btn-route').classList.remove('active');
  if (map.hasLayer(routeLine)) map.removeLayer(routeLine);
}
function updateRouteInfo(count) {
  document.getElementById('route-info').textContent = count ? t('route_points', count) : '';
}
function setCustomPoint(lat, lon) {
  if (customCircle) map.removeLayer(customCircle);
  customCircle = L.circle([lat, lon], {
    radius: RADIUS_NM * 1852,
    color: '#2fe6a8',
    weight: 1,
    fillOpacity: 0.03,
    dashArray: '4,6',
  }).addTo(map);
  map.panTo([lat, lon]);
}
map.on('click', (e) => {
  const click = map.latLngToContainerPoint(e.latlng);
  let closest = null,
    distance = Infinity;
  for (const a of renderedAircraft) {
    const p = map.latLngToContainerPoint([a.lat, a.lon]);
    const d = Math.hypot(p.x - click.x, p.y - click.y);
    if (d < distance) {
      distance = d;
      closest = a;
    }
  }
  if (closest && distance < 18) selectAircraft(closest);
  else setCustomPoint(e.latlng.lat, e.latlng.lng);
});
map.on('moveend', () => {
  updateZoneLabel();
  scheduleViewportRefresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleViewportRefresh();
});
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('btn-follow').addEventListener('click', (e) => {
  followEnabled = !followEnabled;
  e.currentTarget.classList.toggle('active', followEnabled);
});
document.getElementById('btn-route').addEventListener('click', (e) => {
  routeVisible = !routeVisible;
  e.currentTarget.classList.toggle('active', routeVisible);
  if (routeVisible) {
    routeLine.setLatLngs(trails[selectedId] || []);
    routeLine.addTo(map);
  } else if (map.hasLayer(routeLine)) map.removeLayer(routeLine);
});
document.getElementById('btn-share').addEventListener('click', async (e) => {
  const a = aircraftById.get(selectedId);
  if (!a) return;
  const url = new URL(location.href);
  url.searchParams.set('plane', a.registration || a.id);
  try {
    await navigator.clipboard.writeText(url);
    e.currentTarget.textContent = t('link_copied');
    setTimeout(() => (e.currentTarget.textContent = t('btn_share')), 1500);
  } catch {
    window.prompt('Copie ce lien :', url);
  }
});
document
  .getElementById('zones-toggle')
  .addEventListener('click', () => document.getElementById('zones-panel').classList.toggle('show'));
document
  .getElementById('filters-toggle')
  .addEventListener('click', () =>
    document.getElementById('filters-panel').classList.toggle('show')
  );
document.querySelectorAll('.zone-btn').forEach((b) =>
  b.addEventListener('click', () => {
    const v = CONTINENT_VIEWS[b.dataset.region];
    if (v) map.flyTo(v[0], v[1], { duration: 1 });
  })
);
document.getElementById('zone-clear').addEventListener('click', (e) => {
  if (customCircle) map.removeLayer(customCircle);
  customCircle = null;
  e.currentTarget.textContent = 'REVENIR À ISRAËL';
  map.flyTo([31.5, 34.8], 6, { duration: 1 });
});
function refreshFilters() {
  const min = document.getElementById('f-alt-min').value,
    max = document.getElementById('f-alt-max').value;
  filters.altMin = min === '' ? null : Number(min);
  filters.altMax = max === '' ? null : Number(max);
  filters.hideGround = document.getElementById('f-hide-ground').checked;
}
['f-alt-min', 'f-alt-max'].forEach((id) =>
  document.getElementById(id).addEventListener('input', refreshFilters)
);
document.getElementById('f-hide-ground').addEventListener('change', refreshFilters);
document.getElementById('f-reset').addEventListener('click', () => {
  document.getElementById('f-alt-min').value = '';
  document.getElementById('f-alt-max').value = '';
  document.getElementById('f-hide-ground').checked = false;
  refreshFilters();
});
elements.search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.currentTarget.value.trim().toUpperCase();
  if (!q) return;
  const airport = AIRPORTS[q];
  if (airport) {
    if (customCircle) map.removeLayer(customCircle);
    customCircle = L.circle([airport.lat, airport.lon], {
      radius: RADIUS_NM * 1852,
      color: '#2fe6a8',
      weight: 1,
      fillOpacity: 0.03,
      dashArray: '4,6',
    }).addTo(map);
    map.flyTo([airport.lat, airport.lon], 9);
    return;
  }
  const a = [...aircraftById.values()].find(
    (i) => i.callsign.toUpperCase().includes(q) || i.registration.toUpperCase().includes(q)
  );
  if (a) {
    selectAircraft(a);
    map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 6));
  }
});
document
  .querySelectorAll('.lang-btn')
  .forEach((b) => b.addEventListener('click', () => applyLanguage(b.dataset.lang)));
document.addEventListener('skytrace:languagechange', () => {
  updateRouteInfo(selectedId ? (trails[selectedId] || []).length : 0);
  const b = document.getElementById('zone-clear');
  if (b) b.textContent = 'REVENIR À ISRAËL';
});
const sharedPlane = new URLSearchParams(location.search).get('plane')?.toUpperCase();
function checkSharedPlane() {
  if (!sharedPlane || selectedId) return;
  const a = [...aircraftById.values()].find(
    (i) => i.registration.toUpperCase() === sharedPlane || i.callsign.toUpperCase() === sharedPlane
  );
  if (a) {
    selectAircraft(a);
    map.flyTo([a.lat, a.lon], 7);
  }
}
applyLanguage(getLanguage());
const resetButton = document.getElementById('zone-clear');
if (resetButton) resetButton.textContent = 'REVENIR À ISRAËL';
updateZoneLabel();
fetchTick();
setInterval(() => {
  if (!document.hidden) fetchTick();
}, TICK_MS);
animationFrame = requestAnimationFrame(render);
if (window.L?.DomEvent) {
  L.DomEvent.disableClickPropagation(elements.panel);
  L.DomEvent.disableScrollPropagation(elements.panel);
}
elements.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
elements.panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
elements.panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
const routeButton = document.getElementById('btn-route');
routeButton.setAttribute(
  'aria-pressed',
  routeButton.classList.contains('active') ? 'true' : 'false'
);
routeButton.addEventListener('click', () =>
  requestAnimationFrame(() =>
    routeButton.setAttribute(
      'aria-pressed',
      routeButton.classList.contains('active') ? 'true' : 'false'
    )
  )
);
window.addEventListener('beforeunload', () => {
  clearTimeout(moveRefreshTimer);
  cancelAnimationFrame(animationFrame);
});
if ('serviceWorker' in navigator)
  window.addEventListener('load', () =>
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => console.error('Service worker registration failed:', error))
  );
