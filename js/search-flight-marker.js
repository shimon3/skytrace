const searchInput = document.getElementById('search');
const callsignElement = document.getElementById('p-callsign');
const registrationElement = document.getElementById('p-registration');
const flightNumberElement = document.getElementById('fs-number');

const TRACK_INTERVAL_MS = 30000;
const FLIGHT_PATTERN = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/;

let marker = null;
let lastLookupKey = '';
let lookupSequence = 0;
let trackedFlight = '';
let trackedCandidates = [];
let trackerTimer = null;
let trackerPanel = null;

function normalize(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

function markerIcon(heading = 0) {
  const safeHeading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  return L.divIcon({
    className: 'skytrace-search-plane-marker',
    html: `<div style="transform:rotate(${safeHeading}deg);font-size:30px;line-height:30px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.75));">✈</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function popupHtml(aircraft) {
  const flight = aircraft.flight || aircraft.callsign || trackedFlight || 'Vol';
  const registration = aircraft.registration || '';
  const altitude = aircraft.altitude == null ? '' : `${Math.round(Number(aircraft.altitude))} ft`;
  return `<strong>${flight}</strong>${registration ? `<br>${registration}` : ''}${altitude ? `<br>${altitude}` : ''}`;
}

function ensureTrackerPanel() {
  if (trackerPanel) return trackerPanel;
  const panel = document.createElement('div');
  panel.id = 'flight-watch-panel';
  panel.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:52px',
    'z-index:1200',
    'min-width:220px',
    'max-width:320px',
    'padding:10px 12px',
    'border:1px solid rgba(47,230,168,.35)',
    'border-radius:10px',
    'background:rgba(13,17,25,.95)',
    'box-shadow:0 14px 34px rgba(0,0,0,.35)',
    'color:#e9f1ff',
    'font:12px/1.4 system-ui,sans-serif',
    'display:none',
  ].join(';');
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <strong id="flight-watch-title">Suivi du vol</strong>
      <button id="flight-watch-stop" type="button" style="border:0;background:transparent;color:#9fb1ca;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div id="flight-watch-status" style="margin-top:5px;color:#9fb1ca">En attente…</div>`;
  document.body.appendChild(panel);
  panel.querySelector('#flight-watch-stop')?.addEventListener('click', stopTracking);
  trackerPanel = panel;
  return panel;
}

function setTrackerStatus(message, active = true) {
  const panel = ensureTrackerPanel();
  panel.style.display = active ? 'block' : 'none';
  const title = panel.querySelector('#flight-watch-title');
  const status = panel.querySelector('#flight-watch-status');
  if (title) title.textContent = trackedFlight ? `Suivi ${trackedFlight}` : 'Suivi du vol';
  if (status) status.textContent = message;
}

function showAircraft(aircraft, { recenter = true } = {}) {
  const map = window.__skytraceMap;
  const lat = Number(aircraft?.lat);
  const lon = Number(aircraft?.lon ?? aircraft?.lng);
  if (!map || !window.L || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lon], {
    icon: markerIcon(aircraft.heading),
    zIndexOffset: 5000,
    keyboard: false,
  })
    .addTo(map)
    .bindPopup(popupHtml(aircraft), { closeButton: false, autoPan: false });

  if (recenter) map.setView([lat, lon], Math.max(map.getZoom?.() || 6, 7), { animate: true });
  marker.openPopup();
  return true;
}

async function lookup(query) {
  const q = normalize(query);
  if (q.length < 3) return null;
  try {
    const response = await fetch(`/api/search-aircraft?q=${encodeURIComponent(q)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.aircraft || null;
  } catch {
    return null;
  }
}

async function resolveCommercialCandidates(query) {
  const candidates = [normalize(query)];
  try {
    const response = await fetch(`/api/flight-status?callsign=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/json' },
    });
    if (response.ok) {
      const payload = await response.json();
      const flight = payload?.flight;
      for (const value of [flight?.flightIcao, flight?.flightIata, flight?.registration]) {
        const normalized = normalize(value);
        if (normalized) candidates.push(normalized);
      }
    }
  } catch {
    // ADS-B tracking can still continue with the original flight number.
  }
  return [...new Set(candidates)];
}

async function locateSelectedFlight() {
  const candidates = [
    normalize(callsignElement?.textContent),
    normalize(registrationElement?.textContent),
    normalize(flightNumberElement?.textContent),
    normalize(searchInput?.value),
  ].filter((value) => value && value !== '—');

  const unique = [...new Set(candidates)];
  const key = unique.join('|');
  if (!key || key === lastLookupKey) return;
  lastLookupKey = key;
  const sequence = ++lookupSequence;

  for (const candidate of unique) {
    const aircraft = await lookup(candidate);
    if (sequence !== lookupSequence) return;
    if (aircraft && showAircraft(aircraft)) return;
  }
}

async function pollTrackedFlight({ first = false } = {}) {
  if (!trackedFlight || document.hidden) return;
  const sequence = ++lookupSequence;
  setTrackerStatus(first ? 'Recherche de la position en direct…' : 'Actualisation de la position…');

  for (const candidate of trackedCandidates) {
    const aircraft = await lookup(candidate);
    if (sequence !== lookupSequence || !trackedFlight) return;
    if (aircraft) {
      showAircraft(aircraft, { recenter: first });
      const seen = Number(aircraft.seen);
      const freshness = Number.isFinite(seen)
        ? ` · vue il y a ${Math.max(0, Math.round(seen))} s`
        : '';
      setTrackerStatus(`Position ADS-B trouvée${freshness}. Actualisation toutes les 30 s.`);
      return;
    }
  }

  setTrackerStatus(
    'Vol connu, mais aucune position ADS-B disponible pour le moment. Nouvelle tentative dans 30 s.'
  );
}

async function startTracking(rawFlight) {
  const flight = normalize(rawFlight);
  if (!FLIGHT_PATTERN.test(flight)) return;

  stopTracking({ keepMarker: true, hidePanel: false });
  trackedFlight = flight;
  setTrackerStatus('Préparation du suivi…');
  trackedCandidates = await resolveCommercialCandidates(flight);
  if (!trackedFlight) return;

  await pollTrackedFlight({ first: true });
  trackerTimer = setInterval(() => void pollTrackedFlight(), TRACK_INTERVAL_MS);
}

function stopTracking({ keepMarker = false, hidePanel = true } = {}) {
  if (trackerTimer) clearInterval(trackerTimer);
  trackerTimer = null;
  trackedFlight = '';
  trackedCandidates = [];
  lookupSequence += 1;
  if (!keepMarker && marker && window.__skytraceMap) {
    window.__skytraceMap.removeLayer(marker);
    marker = null;
  }
  if (hidePanel && trackerPanel) trackerPanel.style.display = 'none';
}

function scheduleLocate() {
  setTimeout(locateSelectedFlight, 50);
}

const observer = new MutationObserver(scheduleLocate);
if (callsignElement) observer.observe(callsignElement, { childList: true, subtree: true });
if (registrationElement) observer.observe(registrationElement, { childList: true, subtree: true });

const observeFlightNumber = () => {
  const element = document.getElementById('fs-number');
  if (element) observer.observe(element, { childList: true, subtree: true });
};
observeFlightNumber();

function maybeTrackSearch() {
  const query = normalize(searchInput?.value);
  lastLookupKey = '';
  setTimeout(locateSelectedFlight, 250);
  if (FLIGHT_PATTERN.test(query)) void startTracking(query);
}

searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') maybeTrackSearch();
});

document.getElementById('search-submit')?.addEventListener('click', maybeTrackSearch);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && trackedFlight) void pollTrackedFlight();
});

window.addEventListener('beforeunload', () => stopTracking({ keepMarker: true }));
