const searchInput = document.getElementById('search');
const callsignElement = document.getElementById('p-callsign');
const registrationElement = document.getElementById('p-registration');
const flightNumberElement = document.getElementById('fs-number');

let marker = null;
let lastLookupKey = '';
let lookupSequence = 0;

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
  const flight = aircraft.flight || aircraft.callsign || 'Vol';
  const registration = aircraft.registration || '';
  const altitude = aircraft.altitude == null ? '' : `${Math.round(Number(aircraft.altitude))} ft`;
  return `<strong>${flight}</strong>${registration ? `<br>${registration}` : ''}${altitude ? `<br>${altitude}` : ''}`;
}

function showAircraft(aircraft) {
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

  map.setView([lat, lon], Math.max(map.getZoom?.() || 6, 7), { animate: true });
  marker.openPopup();
  return true;
}

async function lookup(query) {
  const q = normalize(query);
  if (q.length < 3) return null;
  try {
    const response = await fetch(`/api/search-aircraft?q=${encodeURIComponent(q)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.aircraft || null;
  } catch {
    return null;
  }
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

function scheduleLocate() {
  setTimeout(locateSelectedFlight, 50);
}

const observer = new MutationObserver(scheduleLocate);
if (callsignElement) observer.observe(callsignElement, { childList: true, subtree: true });
if (registrationElement) observer.observe(registrationElement, { childList: true, subtree: true });

// fs-number is created by flight-status-integration.js before this module runs, but
// observe the document too so the helper remains robust if the panel is rebuilt later.
const observeFlightNumber = () => {
  const element = document.getElementById('fs-number');
  if (element) observer.observe(element, { childList: true, subtree: true });
};
observeFlightNumber();

searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    lastLookupKey = '';
    setTimeout(locateSelectedFlight, 250);
  }
});

document.getElementById('search-submit')?.addEventListener('click', () => {
  lastLookupKey = '';
  setTimeout(locateSelectedFlight, 250);
});
