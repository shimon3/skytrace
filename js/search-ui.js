import { AIRPORTS } from '../data/airports.js';

const HISTORY_KEY = 'skytrace_search_history_v1';
const MAX_HISTORY = 8;
const search = document.getElementById('search');

if (search) {
  const host = document.createElement('div');
  host.id = 'search-ui-host';
  const row = document.createElement('div');
  row.id = 'search-ui-row';
  const submit = document.createElement('button');
  submit.id = 'search-submit';
  submit.type = 'button';
  submit.setAttribute('aria-label', 'Rechercher');
  submit.title = 'Rechercher';
  submit.textContent = '⌕';
  const popover = document.createElement('div');
  popover.id = 'search-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Recherche SkyTrace');

  search.parentNode.insertBefore(host, search);
  host.appendChild(row);
  row.appendChild(search);
  row.appendChild(submit);
  host.appendChild(popover);
  search.placeholder = 'Vol, indicatif, immatriculation, aéroport…';
  search.setAttribute('autocomplete', 'off');

  let bypassNative = false;
  let routeResults = [];

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.filter(Boolean).slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(query) {
    const q = String(query || '')
      .trim()
      .toUpperCase();
    if (!q) return;
    const items = [q, ...loadHistory().filter((item) => item !== q)].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function renderHome() {
    const history = loadHistory();
    popover.innerHTML = `
      <section class="search-section">
        <div class="search-section-title">
          <span>HISTORIQUE</span>
          ${history.length ? '<button class="search-clear" type="button">Effacer</button>' : ''}
        </div>
        <div class="search-history-list">
          ${history.length ? history.map((item) => `<button class="search-history-item" type="button" data-query="${esc(item)}"><span class="search-icon">⌕</span><span>${esc(item)}</span></button>`).join('') : '<div class="search-message">Aucune recherche récente.</div>'}
        </div>
      </section>
      <section class="search-section">
        <div class="search-section-title"><span>RECHERCHE PAR ITINÉRAIRE</span></div>
        <form class="search-route-form" id="search-route-form">
          <input id="route-from" maxlength="3" placeholder="Départ" aria-label="Aéroport de départ" />
          <span>→</span>
          <input id="route-to" maxlength="3" placeholder="Arrivée" aria-label="Aéroport d'arrivée" />
          <button class="search-route-go" type="submit">GO</button>
        </form>
      </section>
      <section class="search-section">
        <div class="search-section-title"><span>RACCOURCIS</span></div>
        <button class="search-shortcut" type="button" data-action="nearby"><span class="search-icon">◎</span><span>Autour de moi</span></button>
        <button class="search-shortcut" type="button" data-action="route"><span class="search-icon">↗</span><span>Vol par aéroport de départ et d’arrivée</span></button>
      </section>`;

    popover.querySelector('.search-clear')?.addEventListener('click', () => {
      localStorage.removeItem(HISTORY_KEY);
      renderHome();
    });
    popover
      .querySelectorAll('[data-query]')
      .forEach((button) =>
        button.addEventListener('click', () => executeSearch(button.dataset.query))
      );
    popover.querySelector('[data-action="nearby"]')?.addEventListener('click', locateNearby);
    popover.querySelector('[data-action="route"]')?.addEventListener('click', () => {
      popover.querySelector('#route-from')?.focus();
    });
    popover.querySelector('#search-route-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const from = popover.querySelector('#route-from')?.value || '';
      const to = popover.querySelector('#route-to')?.value || '';
      searchRoute(from, to);
    });
  }

  function showPopover() {
    renderHome();
    popover.classList.add('show');
  }

  function showMessage(message, { error = false, loading = false } = {}) {
    popover.classList.add('show');
    popover.innerHTML = `<div class="search-message${error ? ' error' : ''}">${loading ? '<span class="search-spinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>' : ''}${esc(message)}</div>`;
  }

  function nativeSearch(value) {
    search.value = value;
    bypassNative = true;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    bypassNative = false;
  }

  async function selectRemoteAircraft(aircraft, fallbackQuery) {
    const lat = Number(aircraft?.lat);
    const lon = Number(aircraft?.lon ?? aircraft?.lng);
    const map = window.__skytraceMap;
    if (Number.isFinite(lat) && Number.isFinite(lon) && map) {
      map.setView([lat, lon], Math.max(map.getZoom?.() || 6, 7), { animate: true });
      const identifier =
        aircraft.flight ||
        aircraft.callsign ||
        aircraft.registration ||
        aircraft.r ||
        fallbackQuery;
      setTimeout(() => nativeSearch(String(identifier || fallbackQuery).trim()), 1400);
      popover.classList.remove('show');
      return true;
    }
    return false;
  }

  async function lookupAircraft(query) {
    const response = await fetch(`/api/search-aircraft?q=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.aircraft || null;
  }

  async function lookupCommercialFlight(query) {
    const response = await fetch(`/api/flight-status?callsign=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.flight || null;
  }

  async function executeSearch(rawQuery) {
    const query = String(rawQuery ?? search.value)
      .trim()
      .toUpperCase();
    if (!query) return showPopover();
    search.value = query;
    saveHistory(query);

    const routeMatch = query.match(/^([A-Z]{3})\s*(?:-|→|>)\s*([A-Z]{3})$/);
    if (routeMatch) return searchRoute(routeMatch[1], routeMatch[2]);

    if (AIRPORTS[query]) {
      nativeSearch(query);
      popover.classList.remove('show');
      return;
    }

    showMessage(`Recherche de ${query}…`, { loading: true });
    try {
      let aircraft = await lookupAircraft(query);
      if (aircraft && (await selectRemoteAircraft(aircraft, query))) return;

      const flight = await lookupCommercialFlight(query);
      if (flight) {
        for (const candidate of [flight.flightIcao, flight.registration, flight.flightIata]) {
          if (!candidate) continue;
          aircraft = await lookupAircraft(candidate);
          if (aircraft && (await selectRemoteAircraft(aircraft, candidate))) return;
        }
        const dep = flight.departure?.iata;
        const arr = flight.arrival?.iata;
        if (dep && arr) {
          const matches = await fetchRoute(dep, arr);
          const exact = matches.find(
            (item) => item.flightIata === flight.flightIata || item.flightIcao === flight.flightIcao
          );
          if (exact && (await selectRemoteAircraft(exact, flight.flightIcao || query))) return;
        }
      }

      nativeSearch(query);
      showMessage(
        `Aucun avion actif trouvé mondialement pour ${query}. La recherche locale a aussi été lancée.`,
        { error: true }
      );
    } catch (error) {
      console.error('Global search failed:', error);
      nativeSearch(query);
      showMessage(
        'Recherche mondiale indisponible pour le moment. La recherche locale a été lancée.',
        { error: true }
      );
    }
  }

  async function fetchRoute(from, to) {
    const response = await fetch(
      `/api/route-flights?dep=${encodeURIComponent(from)}&arr=${encodeURIComponent(to)}`,
      {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }
    );
    if (!response.ok) throw new Error(`Route lookup HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.flights) ? payload.flights : [];
  }

  async function searchRoute(fromRaw, toRaw) {
    const from = String(fromRaw || '')
      .trim()
      .toUpperCase();
    const to = String(toRaw || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return showMessage('Entre deux codes aéroport IATA de 3 lettres, par exemple LYS → TLV.', {
        error: true,
      });
    }
    const query = `${from}-${to}`;
    search.value = query;
    saveHistory(query);
    showMessage(`Recherche des vols ${from} → ${to}…`, { loading: true });
    try {
      routeResults = await fetchRoute(from, to);
      if (!routeResults.length) {
        const depAirport = AIRPORTS[from];
        const arrAirport = AIRPORTS[to];
        const map = window.__skytraceMap;
        if (depAirport && arrAirport && map) {
          map.fitBounds(
            [
              [depAirport.lat, depAirport.lon],
              [arrAirport.lat, arrAirport.lon],
            ],
            { padding: [60, 60] }
          );
        }
        return showMessage(`Aucun vol en direct trouvé actuellement pour ${from} → ${to}.`);
      }
      popover.classList.add('show');
      popover.innerHTML = `
        <section class="search-section">
          <div class="search-section-title"><span>${esc(from)} → ${esc(to)} · ${routeResults.length} VOL(S)</span><button class="search-clear" id="route-back" type="button">Retour</button></div>
          <div class="search-results-list">
            ${routeResults.map((flight, index) => `<button class="search-result" type="button" data-route-index="${index}"><span class="search-icon">✈</span><span class="search-result-main"><span class="search-result-title">${esc(flight.flightIata || flight.flightIcao || flight.registration || 'Vol')}</span><span class="search-result-subtitle">${esc(flight.registration || '')}${flight.status ? ` · ${esc(flight.status)}` : ''}</span></span></button>`).join('')}
          </div>
        </section>`;
      popover.querySelector('#route-back')?.addEventListener('click', renderHome);
      popover.querySelectorAll('[data-route-index]').forEach((button) =>
        button.addEventListener('click', () => {
          const item = routeResults[Number(button.dataset.routeIndex)];
          selectRemoteAircraft(item, item?.flightIcao || item?.flightIata || query);
        })
      );
    } catch (error) {
      console.error('Route search failed:', error);
      showMessage('Impossible de récupérer les vols de cet itinéraire pour le moment.', {
        error: true,
      });
    }
  }

  function locateNearby() {
    if (!navigator.geolocation) {
      return showMessage('La géolocalisation n’est pas disponible dans ce navigateur.', {
        error: true,
      });
    }
    showMessage('Recherche de ta position…', { loading: true });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = window.__skytraceMap;
        if (!map) return showMessage('La carte n’est pas encore prête.', { error: true });
        const { latitude, longitude } = position.coords;
        map.setView([latitude, longitude], 9, { animate: true });
        saveHistory('AUTOUR DE MOI');
        popover.classList.remove('show');
      },
      () =>
        showMessage(
          'Position non disponible. Autorise la localisation du navigateur puis réessaie.',
          { error: true }
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  search.addEventListener('focus', showPopover);
  search.addEventListener(
    'keydown',
    (event) => {
      if (bypassNative || event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      executeSearch(search.value);
    },
    true
  );
  submit.addEventListener('click', () => executeSearch(search.value));
  document.addEventListener('pointerdown', (event) => {
    if (!host.contains(event.target)) popover.classList.remove('show');
  });
}
