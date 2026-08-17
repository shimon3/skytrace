import { AIRPORTS } from './data/airports.js';
import { AircraftApiClient, getAircraftPhoto } from './js/api-client.js';
import { applyAircraftFilters, projectPosition } from './js/flight-utils.js';
import { applyLanguage, getLanguage, t } from './js/i18n.js';
import { createMapView } from './js/map-view.js';

const RADIUS_NM = 250;
const TICK_MS = 180000;
const STALE_MS = 600000;
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

// API health and usage are intentionally not exposed in the public interface.
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
let selectedId = null;
let renderedAircraft = [];
let followEnabled = false;
let routeVisible = false;
let animationFrame = null;
let lastFrameAt = 0;
let customCircle = null;
let trails = loadTrails();
let lastViewKey = '';

function loadTrails() {
  try {
    return JSON.parse(localStorage.getItem(TRAILS_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveTrails() {
  const limited = Object.fromEntries(Object.entries(trails).slice(-30));
  localStorage.setItem(TRAILS_STORAGE_KEY, JSON.stringify(limited));
}

function currentPoint() {
  const center = map.getCenter();
  return {
    name: 'Zone affichée',
    lat: Number(center.lat.toFixed(3)),
    lon: Number(center.lng.toFixed(3)),
  };
}

function updateZoneLabel() {
  const point = currentPoint();
  elements.zone.textContent = `${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}`;
}

function clearCurrentAircraft() {
  aircraftById.clear();
  renderedAircraft = [];
  planeLayer.setData([]);
  elements.count.textContent = '0';
  if (selectedId) closePanel();
}

async function fetchTick({ forceInitial = false } = {}) {
  const point = currentPoint();
  updateZoneLabel();

  try {
    const received = await api.fetchPoint(point, RADIUS_NM, { forceInitial });
    if (received == null) return;

    const now = Date.now();
    aircraftById.clear();
    for (const aircraft of received) aircraftById.set(aircraft.id, aircraft);
    for (const [id, aircraft] of aircraftById) {
      if (now - aircraft.lastSeen > STALE_MS) aircraftById.delete(id);
    }

    updateSelectedTrail();
    if (selectedId && aircraftById.has(selectedId)) updatePanel(aircraftById.get(selectedId));
    checkSharedPlane();
  } catch (error) {
    // Keep provider availability private; diagnostics remain in the browser console.
    console.error('Aircraft data refresh failed:', error);
  }
}

function updateSelectedTrail() {
  const aircraft = aircraftById.get(selectedId);
  if (!aircraft) return;
  const trail = (trails[selectedId] ||= []);
  const last = trail.at(-1);
  if (!last || last[0] !== aircraft.lat || last[1] !== aircraft.lon) {
    trail.push([aircraft.lat, aircraft.lon]);
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
    renderedAircraft = visible.map((aircraft) => ({
      ...aircraft,
      ...projectPosition(aircraft, Date.now()),
      selected: aircraft.id === selectedId,
    }));
    planeLayer.setData(renderedAircraft);
    elements.count.textContent = visible.length.toLocaleString(getLanguage());
    if (followEnabled && selectedId) {
      const aircraft = renderedAircraft.find((item) => item.id === selectedId);
      if (aircraft) map.panTo([aircraft.lat, aircraft.lon], { animate: false });
    }
  }
  animationFrame = requestAnimationFrame(render);
}

function selectAircraft(aircraft) {
  selectedId = aircraft.id;
  trails[selectedId] ||= [[aircraft.lat, aircraft.lon]];
  updatePanel(aircraft);
  updateRouteInfo(trails[selectedId].length);
}

async function updatePanel(aircraft) {
  elements.panel.classList.add('show');
  document.getElementById('p-callsign').textContent =
    aircraft.callsign || aircraft.id.toUpperCase();
  const badge = document.getElementById('p-type-badge');
  badge.textContent = aircraft.type || '';
  badge.style.display = aircraft.type ? 'inline-block' : 'none';
  elements.registration.textContent = aircraft.registration || '—';
  document.getElementById('p-alt').textContent =
    aircraft.alt == null ? '—' : `${Math.round(aircraft.alt)} m`;
  document.getElementById('p-speed').textContent =
    aircraft.speed == null ? '—' : `${Math.round(aircraft.speed * 3.6)} km/h`;
  document.getElementById('p-heading').textContent =
    aircraft.heading == null ? '—' : `${Math.round(aircraft.heading)}°`;
  document.getElementById('p-vrate').textContent =
    aircraft.vrate == null
      ? '—'
      : `${aircraft.vrate > 0 ? '+' : ''}${aircraft.vrate.toFixed(1)} m/s`;
  document.getElementById('p-squawk').textContent = aircraft.squawk || '—';
  document.getElementById('p-pos').textContent =
    `${aircraft.lat.toFixed(2)}, ${aircraft.lon.toFixed(2)}`;
  const requestedRegistration = aircraft.registration;
  const photo = await getAircraftPhoto(requestedRegistration);
  if (selectedId === aircraft.id && photo) {
    elements.photo.src = photo;
    elements.photo.style.display = 'block';
  } else {
    elements.photo.style.display = 'none';
  }
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

map.on('click', (event) => {
  const click = map.latLngToContainerPoint(event.latlng);
  let closest = null;
  let distance = Infinity;
  for (const aircraft of renderedAircraft) {
    const point = map.latLngToContainerPoint([aircraft.lat, aircraft.lon]);
    const current = Math.hypot(point.x - click.x, point.y - click.y);
    if (current < distance) {
      distance = current;
      closest = aircraft;
    }
  }
  if (closest && distance < 18) selectAircraft(closest);
  else setCustomPoint(event.latlng.lat, event.latlng.lng);
});

map.on('moveend', () => {
  updateZoneLabel();
  const point = currentPoint();
  const viewKey = `${point.lat.toFixed(1)}:${point.lon.toFixed(1)}`;
  if (viewKey !== lastViewKey) {
    lastViewKey = viewKey;
    clearCurrentAircraft();
  }
  fetchTick();
});

document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('btn-follow').addEventListener('click', (event) => {
  followEnabled = !followEnabled;
  event.currentTarget.classList.toggle('active', followEnabled);
});
document.getElementById('btn-route').addEventListener('click', (event) => {
  routeVisible = !routeVisible;
  event.currentTarget.classList.toggle('active', routeVisible);
  if (routeVisible) {
    routeLine.setLatLngs(trails[selectedId] || []);
    routeLine.addTo(map);
  } else if (map.hasLayer(routeLine)) {
    map.removeLayer(routeLine);
  }
});
document.getElementById('btn-share').addEventListener('click', async (event) => {
  const aircraft = aircraftById.get(selectedId);
  if (!aircraft) return;
  const url = new URL(location.href);
  url.searchParams.set('plane', aircraft.registration || aircraft.id);
  try {
    await navigator.clipboard.writeText(url);
    event.currentTarget.textContent = t('link_copied');
    setTimeout(() => {
      event.currentTarget.textContent = t('btn_share');
    }, 1500);
  } catch {
    window.prompt('Copie ce lien :', url);
  }
});

document.getElementById('zones-toggle').addEventListener('click', () => {
  document.getElementById('zones-panel').classList.toggle('show');
});
document.getElementById('filters-toggle').addEventListener('click', () => {
  document.getElementById('filters-panel').classList.toggle('show');
});
document.querySelectorAll('.zone-btn').forEach((button) =>
  button.addEventListener('click', () => {
    const view = CONTINENT_VIEWS[button.dataset.region];
    if (view) map.flyTo(view[0], view[1], { duration: 1 });
  })
);

document.getElementById('zone-clear').addEventListener('click', (event) => {
  if (customCircle) map.removeLayer(customCircle);
  customCircle = null;
  event.currentTarget.textContent = 'REVENIR À ISRAËL';
  map.flyTo([31.5, 34.8], 6, { duration: 1 });
});

function refreshFilters() {
  const min = document.getElementById('f-alt-min').value;
  const max = document.getElementById('f-alt-max').value;
  filters.altMin = min === '' ? null : Number(min);
  filters.altMax = max === '' ? null : Number(max);
  filters.hideGround = document.getElementById('f-hide-ground').checked;
}

['f-alt-min', 'f-alt-max'].forEach((id) => {
  document.getElementById(id).addEventListener('input', refreshFilters);
});
document.getElementById('f-hide-ground').addEventListener('change', refreshFilters);
document.getElementById('f-reset').addEventListener('click', () => {
  document.getElementById('f-alt-min').value = '';
  document.getElementById('f-alt-max').value = '';
  document.getElementById('f-hide-ground').checked = false;
  refreshFilters();
});

elements.search.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const query = event.currentTarget.value.trim().toUpperCase();
  if (!query) return;
  const airport = AIRPORTS[query];
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
  const aircraft = [...aircraftById.values()].find(
    (item) =>
      item.callsign.toUpperCase().includes(query) || item.registration.toUpperCase().includes(query)
  );
  if (aircraft) {
    selectAircraft(aircraft);
    map.flyTo([aircraft.lat, aircraft.lon], Math.max(map.getZoom(), 6));
  }
});

document.querySelectorAll('.lang-btn').forEach((button) => {
  button.addEventListener('click', () => applyLanguage(button.dataset.lang));
});
document.addEventListener('skytrace:languagechange', () => {
  updateRouteInfo(selectedId ? (trails[selectedId] || []).length : 0);
  const resetButton = document.getElementById('zone-clear');
  if (resetButton) resetButton.textContent = 'REVENIR À ISRAËL';
});

const sharedPlane = new URLSearchParams(location.search).get('plane')?.toUpperCase();
function checkSharedPlane() {
  if (!sharedPlane || selectedId) return;
  const aircraft = [...aircraftById.values()].find(
    (item) =>
      item.registration.toUpperCase() === sharedPlane || item.callsign.toUpperCase() === sharedPlane
  );
  if (aircraft) {
    selectAircraft(aircraft);
    map.flyTo([aircraft.lat, aircraft.lon], 7);
  }
}

applyLanguage(getLanguage());
const resetButton = document.getElementById('zone-clear');
if (resetButton) resetButton.textContent = 'REVENIR À ISRAËL';
updateZoneLabel();
lastViewKey = `${currentPoint().lat.toFixed(1)}:${currentPoint().lon.toFixed(1)}`;
fetchTick({ forceInitial: true });
setInterval(fetchTick, TICK_MS);
animationFrame = requestAnimationFrame(render);

if (window.L?.DomEvent) {
  L.DomEvent.disableClickPropagation(elements.panel);
  L.DomEvent.disableScrollPropagation(elements.panel);
}
elements.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
elements.panel.addEventListener('touchstart', (event) => event.stopPropagation(), {
  passive: true,
});
elements.panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });

const routeButton = document.getElementById('btn-route');
routeButton.setAttribute(
  'aria-pressed',
  routeButton.classList.contains('active') ? 'true' : 'false'
);
routeButton.addEventListener('click', () => {
  requestAnimationFrame(() => {
    routeButton.setAttribute(
      'aria-pressed',
      routeButton.classList.contains('active') ? 'true' : 'false'
    );
  });
});
window.addEventListener('beforeunload', () => cancelAnimationFrame(animationFrame));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => console.error('Service worker registration failed:', error));
  });
}
