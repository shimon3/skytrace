const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map();

const copy = {
  fr: {
    title: 'INFORMATIONS DU VOL',
    source: 'Horaires AirLabs',
    loading: 'Recherche des horaires commerciaux…',
    unavailable: 'Horaires commerciaux indisponibles pour cet avion.',
    notConfigured: 'AirLabs doit être configuré dans Cloudflare.',
    route: 'Trajet',
    status: 'État',
    departureScheduled: 'Départ prévu',
    departureEstimated: 'Départ estimé',
    departureActual: 'Départ réel',
    departureDelay: 'Retard départ',
    arrivalScheduled: 'Arrivée prévue',
    arrivalEstimated: 'Arrivée estimée',
    arrivalActual: 'Arrivée réelle',
    arrivalDelay: 'Retard arrivée',
    terminalGate: 'Terminal / porte',
    punctuality: 'Ponctualité',
    onTime: 'À l’heure',
    delayed: (minutes) => `Retard de ${minutes} min`,
    noDelayData: 'Non communiqué',
    localTime: 'heure locale de l’aéroport',
    statuses: {
      scheduled: 'PRÉVU',
      active: 'EN VOL',
      'en-route': 'EN VOL',
      landed: 'ATTERRI',
      cancelled: 'ANNULÉ',
      diverted: 'DÉROUTÉ',
    },
  },
  en: {
    title: 'FLIGHT INFORMATION',
    source: 'AirLabs schedules',
    loading: 'Looking up commercial schedule…',
    unavailable: 'Commercial schedule unavailable for this aircraft.',
    notConfigured: 'AirLabs must be configured in Cloudflare.',
    route: 'Route',
    status: 'Status',
    departureScheduled: 'Scheduled departure',
    departureEstimated: 'Estimated departure',
    departureActual: 'Actual departure',
    departureDelay: 'Departure delay',
    arrivalScheduled: 'Scheduled arrival',
    arrivalEstimated: 'Estimated arrival',
    arrivalActual: 'Actual arrival',
    arrivalDelay: 'Arrival delay',
    terminalGate: 'Terminal / gate',
    punctuality: 'Punctuality',
    onTime: 'On time',
    delayed: (minutes) => `${minutes} min late`,
    noDelayData: 'Not reported',
    localTime: 'airport local time',
    statuses: {
      scheduled: 'SCHEDULED',
      active: 'IN FLIGHT',
      'en-route': 'IN FLIGHT',
      landed: 'LANDED',
      cancelled: 'CANCELLED',
      diverted: 'DIVERTED',
    },
  },
  he: {
    title: 'פרטי הטיסה',
    source: 'לוחות זמנים AirLabs',
    loading: 'מחפש לוח זמנים מסחרי…',
    unavailable: 'אין מידע מסחרי זמין עבור מטוס זה.',
    notConfigured: 'יש להגדיר את AirLabs ב-Cloudflare.',
    route: 'מסלול',
    status: 'מצב',
    departureScheduled: 'המראה מתוכננת',
    departureEstimated: 'המראה משוערת',
    departureActual: 'המראה בפועל',
    departureDelay: 'איחור בהמראה',
    arrivalScheduled: 'נחיתה מתוכננת',
    arrivalEstimated: 'נחיתה משוערת',
    arrivalActual: 'נחיתה בפועל',
    arrivalDelay: 'איחור בנחיתה',
    terminalGate: 'טרמינל / שער',
    punctuality: 'עמידה בזמנים',
    onTime: 'בזמן',
    delayed: (minutes) => `איחור של ${minutes} דקות`,
    noDelayData: 'לא דווח',
    localTime: 'זמן מקומי של שדה התעופה',
    statuses: {
      scheduled: 'מתוכננת',
      active: 'באוויר',
      'en-route': 'באוויר',
      landed: 'נחתה',
      cancelled: 'בוטלה',
      diverted: 'הוסטה',
    },
  },
};

function language() {
  const value = document.documentElement.lang;
  return copy[value] ? value : 'fr';
}

function text() {
  return copy[language()];
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function formatAirportTime(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day, hour, minute] = match;
  const locale = language() === 'he' ? 'he-IL' : language() === 'en' ? 'en-GB' : 'fr-FR';
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

function formatDelay(minutes) {
  const labels = text();
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) {
    return labels.noDelayData;
  }
  const rounded = Math.max(0, Math.round(Number(minutes)));
  return rounded === 0 ? labels.onTime : labels.delayed(rounded);
}

function formatTerminalGate(terminal, gate) {
  const values = [];
  if (terminal) values.push(`T ${terminal}`);
  if (gate) values.push(`G ${gate}`);
  return values.length ? values.join(' · ') : '—';
}

function normalizedCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function createSection() {
  const section = document.createElement('section');
  section.id = 'flight-status-section';
  section.className = 'flight-status-section';
  section.hidden = true;
  section.innerHTML = `
    <div class="flight-status-heading">
      <span data-flight-label="title"></span>
      <span class="flight-status-source" data-flight-label="source"></span>
    </div>
    <div id="flight-status-message" class="flight-status-message"></div>
    <div id="flight-status-content" class="flight-status-content" hidden>
      <div class="flight-status-route">
        <strong id="fs-departure">—</strong><span>→</span><strong id="fs-arrival">—</strong>
      </div>
      <div class="flight-status-summary">
        <span id="fs-number">—</span><span id="fs-status" class="flight-status-badge">—</span>
      </div>
      <div class="flight-status-grid">
        <div><span data-flight-label="departureScheduled"></span><b id="fs-dep-scheduled">—</b></div>
        <div><span data-flight-label="departureEstimated"></span><b id="fs-dep-estimated">—</b></div>
        <div><span data-flight-label="departureActual"></span><b id="fs-dep-actual">—</b></div>
        <div><span data-flight-label="departureDelay"></span><b id="fs-dep-delay">—</b></div>
        <div><span data-flight-label="arrivalScheduled"></span><b id="fs-arr-scheduled">—</b></div>
        <div><span data-flight-label="arrivalEstimated"></span><b id="fs-arr-estimated">—</b></div>
        <div><span data-flight-label="arrivalActual"></span><b id="fs-arr-actual">—</b></div>
        <div><span data-flight-label="arrivalDelay"></span><b id="fs-arr-delay">—</b></div>
        <div><span data-flight-label="terminalGate"></span><b id="fs-dep-gate">—</b></div>
        <div><span data-flight-label="terminalGate"></span><b id="fs-arr-gate">—</b></div>
        <div class="flight-status-punctuality"><span data-flight-label="punctuality"></span><b id="fs-punctuality">—</b></div>
      </div>
      <div class="flight-status-time-note" data-flight-label="localTime"></div>
    </div>
  `;

  const actions = document.querySelector('#panel .panel-actions');
  actions?.before(section);
  return section;
}

const section = createSection();
const message = document.getElementById('flight-status-message');
const content = document.getElementById('flight-status-content');
const panel = document.getElementById('panel');
const callsignElement = document.getElementById('p-callsign');
const registrationElement = document.getElementById('p-registration');
let activeKey = '';
let requestSequence = 0;
let lastFlight = null;

function applyOwnTranslations() {
  const labels = text();
  section.querySelectorAll('[data-flight-label]').forEach((element) => {
    element.textContent = labels[element.dataset.flightLabel] || '';
  });
  if (lastFlight) renderFlight(lastFlight);
}

function showMessage(value, kind = '') {
  section.hidden = false;
  message.hidden = false;
  message.className = `flight-status-message ${kind}`.trim();
  message.textContent = value;
  content.hidden = true;
}

function statusLabel(status) {
  const value = String(status || '').toLowerCase();
  return text().statuses[value] || valueOrDash(status).toUpperCase();
}

function renderFlight(flight) {
  lastFlight = flight;
  section.hidden = false;
  message.hidden = true;
  content.hidden = false;

  document.getElementById('fs-departure').textContent = valueOrDash(
    flight.departure.iata || flight.departure.icao
  );
  document.getElementById('fs-arrival').textContent = valueOrDash(
    flight.arrival.iata || flight.arrival.icao
  );
  document.getElementById('fs-number').textContent = valueOrDash(
    flight.flightIata || flight.flightIcao
  );
  document.getElementById('fs-status').textContent = statusLabel(flight.status);
  document.getElementById('fs-dep-scheduled').textContent = formatAirportTime(
    flight.departure.scheduled
  );
  document.getElementById('fs-dep-estimated').textContent = formatAirportTime(
    flight.departure.estimated
  );
  document.getElementById('fs-dep-actual').textContent = formatAirportTime(
    flight.departure.actual
  );
  document.getElementById('fs-dep-delay').textContent = formatDelay(
    flight.departure.delayMinutes
  );
  document.getElementById('fs-arr-scheduled').textContent = formatAirportTime(
    flight.arrival.scheduled
  );
  document.getElementById('fs-arr-estimated').textContent = formatAirportTime(
    flight.arrival.estimated
  );
  document.getElementById('fs-arr-actual').textContent = formatAirportTime(flight.arrival.actual);
  document.getElementById('fs-arr-delay').textContent = formatDelay(flight.arrival.delayMinutes);
  document.getElementById('fs-dep-gate').textContent = formatTerminalGate(
    flight.departure.terminal,
    flight.departure.gate
  );
  document.getElementById('fs-arr-gate').textContent = formatTerminalGate(
    flight.arrival.terminal,
    flight.arrival.gate
  );

  const effectiveDelay =
    flight.arrival.delayMinutes ?? flight.departure.delayMinutes ?? null;
  document.getElementById('fs-punctuality').textContent = formatDelay(effectiveDelay);
}

async function fetchFlightStatus(callsign, registration) {
  const cacheKey = `${callsign}|${registration}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) return cached.flight;

  const url = new URL('/api/flight-status', location.origin);
  url.searchParams.set('callsign', callsign);
  if (registration) url.searchParams.set('registration', registration);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.code = payload.code;
    throw error;
  }

  responseCache.set(cacheKey, { flight: payload.flight, storedAt: Date.now() });
  return payload.flight;
}

async function refreshSelectedFlight() {
  if (!panel?.classList.contains('show')) return;

  const callsign = normalizedCode(callsignElement?.textContent);
  const registration = normalizedCode(registrationElement?.textContent);
  if (!callsign || callsign === '—') {
    activeKey = '';
    lastFlight = null;
    showMessage(text().unavailable, 'muted');
    return;
  }

  const key = `${callsign}|${registration}`;
  if (key === activeKey && lastFlight) return;
  activeKey = key;
  lastFlight = null;
  const sequence = ++requestSequence;
  showMessage(text().loading, 'loading');

  try {
    const flight = await fetchFlightStatus(callsign, registration);
    if (sequence !== requestSequence || key !== activeKey) return;
    renderFlight(flight);
  } catch (error) {
    if (sequence !== requestSequence || key !== activeKey) return;
    const value = error.code === 'AIRLABS_NOT_CONFIGURED' ? text().notConfigured : text().unavailable;
    showMessage(value, error.code === 'AIRLABS_NOT_CONFIGURED' ? 'warning' : 'muted');
  }
}

const observer = new MutationObserver(() => {
  queueMicrotask(refreshSelectedFlight);
});

if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
if (callsignElement) observer.observe(callsignElement, { childList: true, subtree: true });
if (registrationElement) observer.observe(registrationElement, { childList: true, subtree: true });

document.addEventListener('skytrace:languagechange', applyOwnTranslations);
applyOwnTranslations();

const attribution = document.getElementById('attribution-note');
if (attribution && !attribution.dataset.airlabsSource) {
  attribution.dataset.airlabsSource = 'true';
  attribution.textContent += ' · Horaires: AirLabs';
}
