import { AIRPORTS } from './data/airports.js';
import { AircraftApiClient, getAircraftPhoto } from './js/api-client.js';
import { applyAircraftFilters, projectPosition } from './js/flight-utils.js';
import { applyLanguage, getLanguage, t } from './js/i18n.js';
import { createMapView } from './js/map-view.js';

const RADIUS_NM = 250;
const TICK_MS = 1200;
const STALE_MS = 200000;
const TRAILS_STORAGE_KEY = 'skytrace_trails_v2';

const HUB_POINTS = [
  ['Israël / Levant', 31.5, 34.8, 'Moyen-Orient'],
  ['Europe de l’Ouest', 48.8, 2.3, 'Europe'],
  ['Europe Centrale', 50.1, 8.7, 'Europe'],
  ['Royaume-Uni', 51.5, -0.1, 'Europe'],
  ['Scandinavie', 59.3, 18.1, 'Europe'],
  ['Europe de l’Est', 52.2, 21, 'Europe'],
  ['Russie (Ouest)', 55.7, 37.6, 'Europe'],
  ['Turquie', 41, 28.9, 'Moyen-Orient'],
  ['Iran', 35.7, 51.4, 'Moyen-Orient'],
  ['Golfe Persique', 25.2, 55.3, 'Moyen-Orient'],
  ['Afrique du Nord', 30, 31.2, 'Afrique'],
  ['Afrique de l’Ouest', 6.5, 3.4, 'Afrique'],
  ['Afrique Centrale', -4.3, 15.3, 'Afrique'],
  ['Afrique de l’Est', -1.3, 36.8, 'Afrique'],
  ['Afrique du Sud', -26.2, 28, 'Afrique'],
  ['Asie Centrale', 43.2, 76.9, 'Asie'],
  ['Sibérie', 55, 83, 'Asie'],
  ['Pakistan', 24.9, 67, 'Asie'],
  ['Inde (Nord)', 28.6, 77.2, 'Asie'],
  ['Inde (Sud)', 19.1, 72.9, 'Asie'],
  ['Chine (Est)', 31.2, 121.5, 'Asie'],
  ['Chine (Nord)', 39.9, 116.4, 'Asie'],
  ['Mongolie', 47.9, 106.9, 'Asie'],
  ['Japon', 35.7, 139.7, 'Asie'],
  ['Corée du Sud', 37.6, 127, 'Asie'],
  ['Asie du Sud-Est', 1.35, 103.8, 'Asie'],
  ['Philippines', 14.6, 121, 'Asie'],
  ['Australie (Est)', -33.9, 151.2, 'Océanie'],
  ['Nouvelle-Zélande', -41.3, 174.8, 'Océanie'],
  ['Pacifique (Hawaï)', 21.3, -157.8, 'Océanie'],
  ['Pacifique (Guam)', 13.5, 144.8, 'Océanie'],
  ['USA (Est)', 40.7, -74, 'Amérique du Nord'],
  ['USA (Sud-Est)', 33.7, -84.4, 'Amérique du Nord'],
  ['USA (Centre)', 41.9, -87.6, 'Amérique du Nord'],
  ['USA (Sud)', 32.8, -96.8, 'Amérique du Nord'],
  ['USA (Ouest)', 34, -118.2, 'Amérique du Nord'],
  ['Canada (Est)', 43.7, -79.4, 'Amérique du Nord'],
  ['Canada (Ouest)', 49.2, -123.1, 'Amérique du Nord'],
  ['Alaska', 61.2, -149.9, 'Amérique du Nord'],
  ['Mexique', 19.4, -99.1, 'Amérique du Nord'],
  ['Atlantique Nord', 50, -30, 'Atlantique'],
  ['Colombie', 4.6, -74.1, 'Amérique du Sud'],
  ['Pérou', -12, -77, 'Amérique du Sud'],
  ['Brésil', -23.5, -46.6, 'Amérique du Sud'],
  ['Argentine', -34.6, -58.4, 'Amérique du Sud'],
  ['Chili', -33.4, -70.6, 'Amérique du Sud'],
].map(([name, lat, lon, region]) => ({ name, lat, lon, region }));

const CONTINENT_VIEWS = {
  Europe: [[50, 12], 5],
  'Moyen-Orient': [[30, 40], 5],
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
let gridIndex = 0;
let priorityPoints = null;
let priorityIndex = 0;
let cycleCount = 0;
let followEnabled = false;
let routeVisible = false;
let animationFrame = null;
let lastFrameAt = 0;
let customCircle = null;
let trails = loadTrails();

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

function nextPoint() {
  if (priorityPoints?.length && gridIndex % 2 === 0) {
    return priorityPoints[priorityIndex++ % priorityPoints.length];
  }
  const point = HUB_POINTS[gridIndex++ % HUB_POINTS.length];
  if (gridIndex % HUB_POINTS.length === 0) cycleCount += 1;
  return point;
}

function setStatus(kind, text) {
  elements.status.className = kind;
  elements.status.textContent = text;
}

function updateLastDataAge() {
  if (!api.lastSuccessfulUpdate || !elements.status.classList.contains('live')) return;
  const seconds = Math.max(0, Math.floor((Date.now() - api.lastSuccessfulUpdate) / 1000));
  const label = t('last_update', seconds);
  elements.status.textContent = t('status_age', seconds);
  elements.status.title = label;
  elements.status.setAttribute('aria-label', label);
}

async function fetchTick() {
  const point = nextPoint();
  elements.zone.textContent = point.name.toUpperCase();
  setStatus('loading', t('status_updating'));
  try {
    const received = await api.fetchPoint(point, RADIUS_NM);
    const now = Date.now();
    for (const aircraft of received) aircraftById.set(aircraft.id, aircraft);
    for (const [id, aircraft] of aircraftById) {
      if (now - aircraft.lastSeen > STALE_MS) aircraftById.delete(id);
    }
    updateSelectedTrail();
    elements.cycles.textContent = cycleCount.toLocaleString(getLanguage());
    setStatus('live', t('status_live'));
    updateLastDataAge();
    if (selectedId && aircraftById.has(selectedId)) updatePanel(aircraftById.get(selectedId));
    checkSharedPlane();
  } catch (error) {
    setStatus('err', t('status_error'));
    console.error('Aircraft update failed:', error);
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

function setCustomPoint(lat, lon, name = 'Zone sélectionnée') {
  priorityPoints = [{ name, lat, lon }];
  priorityIndex = 0;
  gridIndex = 0;
  if (customCircle) map.removeLayer(customCircle);
  customCircle = L.circle([lat, lon], {
    radius: RADIUS_NM * 1852,
    color: '#2fe6a8',
    weight: 1,
    fillOpacity: 0.03,
    dashArray: '4,6',
  }).addTo(map);
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
  else {
    setCustomPoint(event.latlng.lat, event.latlng.lng);
    fetchTick();
  }
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
    const region = button.dataset.region;
    priorityPoints = HUB_POINTS.filter((point) => point.region === region);
    priorityIndex = 0;
    gridIndex = 0;
    const view = CONTINENT_VIEWS[region];
    if (view) map.flyTo(view[0], view[1], { duration: 1 });
    fetchTick();
  })
);
document.getElementById('zone-clear').addEventListener('click', () => {
  priorityPoints = null;
  priorityIndex = 0;
  if (customCircle) map.removeLayer(customCircle);
  customCircle = null;
  map.flyTo([30, 15], 3);
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
    setCustomPoint(airport.lat, airport.lon, airport.name);
    map.flyTo([airport.lat, airport.lon], 9);
    fetchTick();
    return;
  }
  const aircraft = [...aircraftById.values()].find(
    (item) =>
      item.callsign.toUpperCase().includes(query) || item.registration.toUpperCase().includes(query)
  );
  if (aircraft) {
    selectAircraft(aircraft);
    map.flyTo([aircraft.lat, aircraft.lon], Math.max(map.getZoom(), 6));
  } else {
    setStatus('err', t('status_not_tracked'));
    setTimeout(() => {
      setStatus('live', t('status_live'));
      updateLastDataAge();
    }, 2000);
  }
});

document.querySelectorAll('.lang-btn').forEach((button) => {
  button.addEventListener('click', () => applyLanguage(button.dataset.lang));
});
document.addEventListener('skytrace:languagechange', () => {
  updateRouteInfo(selectedId ? (trails[selectedId] || []).length : 0);
  updateLastDataAge();
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
fetchTick();
setInterval(fetchTick, TICK_MS);
setInterval(updateLastDataAge, 1000);
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
