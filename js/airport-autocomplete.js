import { AIRPORTS } from '../data/airports.js';

const HISTORY_KEY = 'skytrace_search_history_v1';
const MAX_SUGGESTIONS = 3;

const EXTRA_AIRPORTS = [
  { code: 'LYS', city: 'Lyon', name: 'Lyon Saint-Exupéry', lat: 45.7256, lon: 5.0811 },
  { code: 'LYN', city: 'Lyon', name: 'Lyon-Bron', lat: 45.7272, lon: 4.9443 },
  { code: 'NCE', city: 'Nice', name: 'Nice Côte d’Azur', lat: 43.6653, lon: 7.215 },
  { code: 'MRS', city: 'Marseille', name: 'Marseille Provence', lat: 43.4393, lon: 5.2214 },
  { code: 'TLS', city: 'Toulouse', name: 'Toulouse-Blagnac', lat: 43.6293, lon: 1.3638 },
  { code: 'BOD', city: 'Bordeaux', name: 'Bordeaux-Mérignac', lat: 44.8283, lon: -0.7156 },
  { code: 'NTE', city: 'Nantes', name: 'Nantes Atlantique', lat: 47.1532, lon: -1.6107 },
  { code: 'LIL', city: 'Lille', name: 'Lille-Lesquin', lat: 50.5633, lon: 3.0869 },
  { code: 'SXB', city: 'Strasbourg', name: 'Strasbourg', lat: 48.5383, lon: 7.6282 },
  { code: 'MPL', city: 'Montpellier', name: 'Montpellier-Méditerranée', lat: 43.5762, lon: 3.963 },
  { code: 'BVA', city: 'Paris', name: 'Paris-Beauvais', lat: 49.4544, lon: 2.1128 },
  { code: 'GVA', city: 'Genève', name: 'Genève', lat: 46.2381, lon: 6.1089 },
];

const catalog = [
  ...Object.entries(AIRPORTS).map(([code, airport]) => ({
    code,
    city: String(airport.name || '').split(/\s+/)[0],
    name: airport.name,
    lat: airport.lat,
    lon: airport.lon,
  })),
  ...EXTRA_AIRPORTS,
].filter((airport, index, all) => all.findIndex((item) => item.code === airport.code) === index);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function airportMatches(raw) {
  const query = normalize(raw);
  if (!query || /\d/.test(query)) return [];

  return catalog
    .map((airport) => {
      const code = normalize(airport.code);
      const city = normalize(airport.city);
      const name = normalize(airport.name);
      let score = 99;
      if (city.startsWith(query)) score = 0;
      else if (name.startsWith(query)) score = 1;
      else if (code.startsWith(query)) score = 2;
      else if (name.split(/\s|-/).some((word) => word.startsWith(query))) score = 3;
      else if (name.includes(query) || city.includes(query)) score = 4;
      return { airport, score };
    })
    .filter((item) => item.score < 99)
    .sort((a, b) => a.score - b.score || a.airport.city.localeCompare(b.airport.city) || a.airport.code.localeCompare(b.airport.code))
    .slice(0, MAX_SUGGESTIONS)
    .map((item) => item.airport);
}

function saveHistory(query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return;
  try {
    const previous = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const list = Array.isArray(previous) ? previous : [];
    localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...list.filter((item) => item !== q)].slice(0, 8)));
  } catch {
    // Ignore storage errors; autocomplete should still work.
  }
}

function injectStyles() {
  if (document.getElementById('airport-autocomplete-styles')) return;
  const style = document.createElement('style');
  style.id = 'airport-autocomplete-styles';
  style.textContent = `
    .airport-suggestions { display:grid; gap:5px; }
    .airport-suggestion { width:100%; display:flex; align-items:center; gap:10px; padding:10px 11px; border:1px solid transparent; border-radius:8px; background:rgba(255,255,255,.035); color:var(--text); text-align:left; cursor:pointer; font-family:var(--sans); }
    .airport-suggestion:hover,.airport-suggestion.active { border-color:rgba(47,230,168,.45); background:rgba(47,230,168,.09); }
    .airport-code { min-width:42px; color:var(--accent2); font-family:var(--mono); font-weight:800; }
    .airport-main { display:flex; min-width:0; flex-direction:column; }
    .airport-name { font-size:13px; font-weight:700; color:var(--text); }
    .airport-city { margin-top:2px; font-size:11px; color:var(--text-dim); }
    .airport-inline-wrap { position:relative; }
    .airport-inline-suggestions { position:absolute; z-index:30; left:0; right:0; top:calc(100% + 4px); padding:6px; background:rgba(20,27,40,.99); border:1px solid var(--panel-border); border-radius:9px; box-shadow:0 12px 30px rgba(0,0,0,.45); }
    .airport-inline-suggestions .airport-suggestion { padding:8px; }
  `;
  document.head.appendChild(style);
}

function suggestionHtml(airport) {
  return `<button class="airport-suggestion" type="button" data-airport-code="${airport.code}"><span class="airport-code">${airport.code}</span><span class="airport-main"><span class="airport-name">${airport.name}</span><span class="airport-city">${airport.city}</span></span></button>`;
}

function chooseMainAirport(airport) {
  const search = document.getElementById('search');
  const popover = document.getElementById('search-popover');
  if (!search) return;
  search.value = airport.code;
  saveHistory(airport.code);
  const map = window.__skytraceMap;
  if (map && Number.isFinite(airport.lat) && Number.isFinite(airport.lon)) {
    map.setView([airport.lat, airport.lon], 9, { animate: true });
  }
  popover?.classList.remove('show');
}

function renderMainSuggestions(value) {
  const popover = document.getElementById('search-popover');
  if (!popover) return;
  const matches = airportMatches(value);
  if (!matches.length) return;
  popover.classList.add('show');
  popover.innerHTML = `<section class="search-section"><div class="search-section-title"><span>AÉROPORTS</span><span>${matches.length} suggestion${matches.length > 1 ? 's' : ''}</span></div><div class="airport-suggestions">${matches.map(suggestionHtml).join('')}</div></section>`;
  popover.querySelectorAll('[data-airport-code]').forEach((button) => {
    button.addEventListener('click', () => {
      const airport = catalog.find((item) => item.code === button.dataset.airportCode);
      if (airport) chooseMainAirport(airport);
    });
  });
}

function closeInlineSuggestions() {
  document.querySelectorAll('.airport-inline-suggestions').forEach((node) => node.remove());
}

function renderInlineSuggestions(input) {
  closeInlineSuggestions();
  const matches = airportMatches(input.value);
  if (!matches.length) return;
  const wrapper = input.parentElement;
  if (!wrapper) return;
  wrapper.classList.add('airport-inline-wrap');
  const box = document.createElement('div');
  box.className = 'airport-inline-suggestions';
  box.innerHTML = matches.map(suggestionHtml).join('');
  wrapper.appendChild(box);
  box.querySelectorAll('[data-airport-code]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.airportCode;
      closeInlineSuggestions();
      const otherId = input.id === 'route-from' ? 'route-to' : 'route-from';
      document.getElementById(otherId)?.focus();
    });
  });
}

injectStyles();

const search = document.getElementById('search');
search?.addEventListener('input', (event) => {
  const value = event.currentTarget.value;
  if (/^[A-Za-zÀ-ÿ]{1,}$/.test(value.trim())) renderMainSuggestions(value);
});

// Route fields are dynamically recreated by search-ui.js, so use event delegation.
document.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.id === 'route-from' || event.target.id === 'route-to') {
    event.target.value = event.target.value.toUpperCase();
    renderInlineSuggestions(event.target);
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.airport-inline-suggestions') && !event.target.closest('#route-from') && !event.target.closest('#route-to')) {
    closeInlineSuggestions();
  }
});
