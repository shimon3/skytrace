// ---------- Internationalization ----------
const translations = {
  fr: {
    search_placeholder: 'indicatif, immatriculation ou code aéroport…',
    status_connecting: 'CONNEXION…', status_updating: 'MISE À JOUR…',
    status_live: 'EN DIRECT', status_error: 'ERREUR API', status_not_tracked: 'PAS ENCORE SUIVI',
    zone_label: 'ZONE', zone_searching: 'RECHERCHE DE ',
    stat_tracked: 'VOLS SUIVIS', stat_cycles: 'ZONES EXPLORÉES',
    btn_zones: 'ZONES', btn_filters: 'FILTRES', btn_resume: 'REPRENDRE LA ROTATION MONDIALE',
    zones_title: 'Explorer un continent',
    cont_europe: 'Europe', cont_me: 'Moyen-Orient', cont_africa: 'Afrique', cont_asia: 'Asie',
    cont_oceania: 'Océanie', cont_na: 'Amérique du Nord', cont_sa: 'Amérique du Sud',
    filter_alt_min: 'Altitude min (m)', filter_alt_max: 'Altitude max (m)',
    filter_hide_ground: 'Masquer les avions au sol', btn_reset: 'RÉINITIALISER',
    lbl_reg: 'Immatriculation', lbl_alt: 'Altitude', lbl_speed: 'Vitesse', lbl_heading: 'Cap',
    lbl_vrate: 'Vitesse vert.', lbl_squawk: 'Transpondeur', lbl_pos: 'Position',
    btn_follow: 'SUIVRE', btn_route: 'ROUTE', btn_share: 'PARTAGER', link_copied: 'LIEN COPIÉ',
    legend_cruise: 'Croisière (&gt;8000m)', legend_mid: 'Moyenne altitude', legend_low: 'Décollage/atterrissage',
    attribution: 'Données: airplanes.live · Photos: planespotters.net · Fonds de carte: CARTO / Esri · Cliquez sur la carte pour explorer une zone',
    map_dark: 'Sombre', map_satellite: 'Satellite', map_colored: 'Coloré',
    route_points: (n) => `<b>${n}</b> point${n > 1 ? 's' : ''} de trajectoire enregistré${n > 1 ? 's' : ''}`,
  },
  en: {
    search_placeholder: 'callsign, registration or airport code…',
    status_connecting: 'CONNECTING…', status_updating: 'UPDATING…',
    status_live: 'LIVE', status_error: 'API ERROR', status_not_tracked: 'NOT TRACKED YET',
    zone_label: 'ZONE', zone_searching: 'SEARCHING FOR ',
    stat_tracked: 'FLIGHTS TRACKED', stat_cycles: 'ZONES SCANNED',
    btn_zones: 'ZONES', btn_filters: 'FILTERS', btn_resume: 'RESUME GLOBAL ROTATION',
    zones_title: 'Explore a continent',
    cont_europe: 'Europe', cont_me: 'Middle East', cont_africa: 'Africa', cont_asia: 'Asia',
    cont_oceania: 'Oceania', cont_na: 'North America', cont_sa: 'South America',
    filter_alt_min: 'Min altitude (m)', filter_alt_max: 'Max altitude (m)',
    filter_hide_ground: 'Hide aircraft on the ground', btn_reset: 'RESET',
    lbl_reg: 'Registration', lbl_alt: 'Altitude', lbl_speed: 'Speed', lbl_heading: 'Heading',
    lbl_vrate: 'Vert. speed', lbl_squawk: 'Squawk', lbl_pos: 'Position',
    btn_follow: 'FOLLOW', btn_route: 'ROUTE', btn_share: 'SHARE', link_copied: 'LINK COPIED',
    legend_cruise: 'Cruise (&gt;8000m)', legend_mid: 'Mid altitude', legend_low: 'Takeoff/landing',
    attribution: 'Data: airplanes.live · Photos: planespotters.net · Map tiles: CARTO / Esri · Click the map to explore a zone',
    map_dark: 'Dark', map_satellite: 'Satellite', map_colored: 'Colorful',
    route_points: (n) => `<b>${n}</b> trajectory point${n > 1 ? 's' : ''} recorded`,
  },
  he: {
    search_placeholder: 'סימן קריאה, מספר רישום או קוד שדה תעופה…',
    status_connecting: 'מתחבר…', status_updating: 'מתעדכן…',
    status_live: 'בשידור חי', status_error: 'שגיאת API', status_not_tracked: 'עדיין לא נמצא',
    zone_label: 'אזור', zone_searching: 'מחפש את ',
    stat_tracked: 'טיסות במעקב', stat_cycles: 'אזורים שנסרקו',
    btn_zones: 'אזורים', btn_filters: 'סינון', btn_resume: 'חזרה לסריקה עולמית',
    zones_title: 'חקור יבשת',
    cont_europe: 'אירופה', cont_me: 'המזרח התיכון', cont_africa: 'אפריקה', cont_asia: 'אסיה',
    cont_oceania: 'אוקיאניה', cont_na: 'צפון אמריקה', cont_sa: 'דרום אמריקה',
    filter_alt_min: 'גובה מינימלי (מ׳)', filter_alt_max: 'גובה מקסימלי (מ׳)',
    filter_hide_ground: 'הסתר מטוסים על הקרקע', btn_reset: 'איפוס',
    lbl_reg: 'מספר רישום', lbl_alt: 'גובה', lbl_speed: 'מהירות', lbl_heading: 'כיוון',
    lbl_vrate: 'קצב עלייה/ירידה', lbl_squawk: 'משיב מכ״ם', lbl_pos: 'מיקום',
    btn_follow: 'עקוב', btn_route: 'מסלול', btn_share: 'שיתוף', link_copied: 'הקישור הועתק',
    legend_cruise: 'טיסת שיוט (מעל 8000מ׳)', legend_mid: 'גובה בינוני', legend_low: 'המראה/נחיתה',
    attribution: 'נתונים: airplanes.live · תמונות: planespotters.net · מפה: CARTO / Esri · לחצו על המפה כדי לחקור אזור',
    map_dark: 'כהה', map_satellite: 'לוויין', map_colored: 'צבעוני',
    route_points: (n) => `<b>${n}</b> נקודות מסלול נרשמו`,
  },
};

let currentLang = localStorage.getItem('skytrace_lang') || 'fr';

function t(key) {
  const dict = translations[currentLang] || translations.fr;
  return dict[key] !== undefined ? dict[key] : (translations.fr[key] || key);
}

function applyLanguage(lang) {
  currentLang = translations[lang] ? lang : 'fr';
  localStorage.setItem('skytrace_lang', currentLang);
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'he' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === currentLang);
  });

  // Refresh dynamic bits that aren't plain data-i18n text nodes
  if (typeof statusEl !== 'undefined' && statusEl) {
    if (statusEl.classList.contains('live')) statusEl.textContent = t('status_live');
    else if (statusEl.classList.contains('err')) statusEl.textContent = t('status_error');
    else if (statusEl.classList.contains('loading')) statusEl.textContent = t('status_updating');
  }
  if (typeof selectedId !== 'undefined' && selectedId && typeof trailsById !== 'undefined') {
    updateRouteInfo((trailsById[selectedId] || []).length);
  }
  if (typeof buildLayersControl === 'function') buildLayersControl();
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
});

// ---------- Map setup ----------
const map = L.map('map', {
  zoomControl: false,
  attributionControl: false,
  worldCopyJump: true,
  minZoom: 2,
  maxZoom: 11,
}).setView([30, 15], 3);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Esri',
});

const voyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
});

const labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  opacity: 0.7,
}).addTo(map);

let layersControl = null;
function buildLayersControl() {
  if (layersControl) map.removeControl(layersControl);
  layersControl = L.control.layers(
    { [t('map_dark')]: darkLayer, [t('map_satellite')]: satelliteLayer, [t('map_colored')]: voyagerLayer },
    null,
    { position: 'topright', collapsed: false }
  ).addTo(map);
}
buildLayersControl();

map.on('baselayerchange', function(e) {
  // Voyager already has its own baked-in labels; avoid doubling up text
  if (e.layer === voyagerLayer) {
    if (map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer);
  } else {
    if (!map.hasLayer(labelsLayer)) labelsLayer.addTo(map);
  }
});

// ---------- Canvas overlay layer for plane rendering ----------
// Rendering thousands of DOM markers is too slow, so planes are drawn
// directly on a canvas that sits on top of the Leaflet map pane.
const PlaneLayer = L.Layer.extend({
  onAdd: function(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'plane-canvas');
    const size = map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._canvas.style.position = 'absolute';
    this._canvas.style.zIndex = 450;
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize', this._reset, this);
    if (map.options.zoomAnimation) {
      map.on('zoomanim', this._animateZoom, this);
    }
    this._reset();
  },
  onRemove: function(map) {
    L.DomUtil.remove(this._canvas);
    map.off('moveend zoomend resize', this._reset, this);
    map.off('zoomanim', this._animateZoom, this);
  },
  _animateZoom: function(e) {
    // Scale the canvas in sync with Leaflet's zoom animation so plane
    // icons move/scale smoothly instead of appearing frozen until zoomend.
    const scale = this._map.getZoomScale(e.zoom);
    const offset = this._map._latLngToNewLayerPoint(
      this._map.getBounds().getNorthWest(), e.zoom, e.center
    );
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },
  _reset: function() {
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this.draw();
  },
  setData: function(planes) {
    this._planes = planes;
    this.draw();
  },
  draw: function() {
    if (!this._canvas) return;
    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    if (!this._planes) return;
    const bounds = this._map.getBounds().pad(0.15);
    const zoom = this._map.getZoom();
    // Below this zoom, planes are typically packed too densely for detailed
    // icons to read cleanly — fall back to small clean dots instead of a
    // blurry mass of overlapping shadows/gradients.
    const useDetailedIcons = zoom >= 7;
    for (const p of this._planes) {
      if (p.lat == null || p.lon == null) continue;
      if (!bounds.contains([p.lat, p.lon])) continue;
      const pt = this._map.latLngToContainerPoint([p.lat, p.lon]);
      const color = colorForAltitude(p.alt);
      if (useDetailedIcons || p.selected) {
        drawPlaneIcon(ctx, pt.x, pt.y, p.heading || 0, color, p.selected);
      } else {
        drawPlaneDot(ctx, pt.x, pt.y, color);
      }
    }
  }
});
const planeLayer = new PlaneLayer();
planeLayer.addTo(map);

function colorForAltitude(alt) {
  if (alt == null) return '#7c8aa3';
  if (alt < 1000) return '#ff4d6d';
  if (alt < 8000) return '#f5b942';
  return '#2fe6a8';
}

function drawPlaneDot(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + Math.round(255 * percent);
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * percent);
  let b = (num & 0x0000ff) + Math.round(255 * percent);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

function drawPlaneIcon(ctx, x, y, headingDeg, color, selected) {
  const rad = (headingDeg * Math.PI) / 180;
  const s = selected ? 1.35 : 1; // slightly bigger when selected
  ctx.save();
  ctx.translate(x, y);

  // Cast shadow beneath the icon (offset opposite the "light" direction),
  // drawn before rotation so it stays screen-aligned like a real drop shadow.
  ctx.save();
  ctx.rotate(rad);
  ctx.scale(s, s);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000000';
  drawPlanePath(ctx, 0.6, 1.4);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  ctx.rotate(rad);
  ctx.scale(s, s);

  // Gradient fill (lighter "nose", darker "tail") for a subtle 3D feel
  const baseColor = selected ? '#ffffff' : color;
  const grad = ctx.createLinearGradient(0, -9, 0, 10);
  grad.addColorStop(0, shadeColor(baseColor, 0.35));
  grad.addColorStop(0.45, baseColor);
  grad.addColorStop(1, shadeColor(baseColor, -0.3));
  ctx.fillStyle = grad;
  ctx.shadowColor = color;
  ctx.shadowBlur = selected ? 12 : 3;
  drawPlanePath(ctx, 0, 0);
  ctx.fill();

  // Glossy highlight along the fuselage/nose
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = shadeColor(baseColor, 0.5);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, -8.5);
  ctx.lineTo(0.6, -1);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawPlanePath(ctx, ox, oy) {
  // Top-down airplane silhouette: nose points "up" (0°) before rotation.
  ctx.beginPath();
  ctx.moveTo(ox + 0, oy - 9);          // nose
  ctx.lineTo(ox + 1.3, oy - 5.5);
  ctx.lineTo(ox + 1.3, oy + 1);
  // main wing (right)
  ctx.lineTo(ox + 8, oy + 4.5);
  ctx.lineTo(ox + 8, oy + 6.2);
  ctx.lineTo(ox + 1.3, oy + 3.6);
  // tail section (right)
  ctx.lineTo(ox + 1.1, oy + 7.5);
  ctx.lineTo(ox + 3.2, oy + 9);
  ctx.lineTo(ox + 3.2, oy + 10);
  ctx.lineTo(ox + 0, oy + 9);
  // tail section (left, mirrored)
  ctx.lineTo(ox - 3.2, oy + 10);
  ctx.lineTo(ox - 3.2, oy + 9);
  ctx.lineTo(ox - 1.1, oy + 7.5);
  ctx.lineTo(ox - 1.3, oy + 3.6);
  // main wing (left)
  ctx.lineTo(ox - 8, oy + 6.2);
  ctx.lineTo(ox - 8, oy + 4.5);
  ctx.lineTo(ox - 1.3, oy + 1);
  ctx.lineTo(ox - 1.3, oy - 5.5);
  ctx.closePath();
}

// ---------- Data fetching ----------
// Airplanes.live has no single "whole world" endpoint — only point+radius
// (max 250 nautical miles). To approximate global coverage on a free,
// keyless, rate-limited (1 req/sec) API, we cycle through a grid of major
// aviation hub regions, merging each region's aircraft into a shared map
// keyed by hex. Planes not refreshed in a while are dropped (they've most
// likely moved out of coverage or landed).
let planes = [];        // normalized plane objects (rebuilt from planesById each tick)
let planesById = {};    // hex -> plane (persists across ticks, merged from all regions)
let selectedId = null;
const statusEl = document.getElementById('status');
const zoneEl = document.getElementById('zone-name');
const countEl = document.getElementById('stat-count');
const cyclesEl = document.getElementById('stat-cycles');

// A curated set of major airports for airport-code search. Not exhaustive —
// no free flight-plan data source exists to know which specific airport a
// given aircraft departed from/is headed to, so this instead lets you jump
// to an airport's location and see current traffic around it.
const AIRPORTS = {
  TLV: { name: 'Tel Aviv Ben Gourion', lat: 32.01, lon: 34.89 },
  SDV: { name: 'Tel Aviv Sde Dov', lat: 32.11, lon: 34.78 },
  ETM: { name: 'Eilat Ramon', lat: 29.72, lon: 35.01 },
  HFA: { name: 'Haïfa', lat: 32.81, lon: 35.04 },
  CDG: { name: 'Paris Charles de Gaulle', lat: 49.01, lon: 2.55 },
  ORY: { name: 'Paris Orly', lat: 48.73, lon: 2.36 },
  LHR: { name: 'Londres Heathrow', lat: 51.47, lon: -0.45 },
  LGW: { name: 'Londres Gatwick', lat: 51.15, lon: -0.19 },
  AMS: { name: 'Amsterdam Schiphol', lat: 52.31, lon: 4.76 },
  FRA: { name: 'Francfort', lat: 50.04, lon: 8.57 },
  MUC: { name: 'Munich', lat: 48.35, lon: 11.79 },
  MAD: { name: 'Madrid Barajas', lat: 40.47, lon: -3.56 },
  BCN: { name: 'Barcelone', lat: 41.30, lon: 2.08 },
  FCO: { name: 'Rome Fiumicino', lat: 41.80, lon: 12.24 },
  IST: { name: 'Istanbul', lat: 41.26, lon: 28.74 },
  SAW: { name: 'Istanbul Sabiha Gökçen', lat: 40.90, lon: 29.31 },
  ATH: { name: 'Athènes', lat: 37.94, lon: 23.95 },
  ZRH: { name: 'Zurich', lat: 47.46, lon: 8.55 },
  VIE: { name: 'Vienne', lat: 48.11, lon: 16.57 },
  DUB: { name: 'Dublin', lat: 53.42, lon: -6.27 },
  CPH: { name: 'Copenhague', lat: 55.62, lon: 12.65 },
  ARN: { name: 'Stockholm Arlanda', lat: 59.65, lon: 17.92 },
  WAW: { name: 'Varsovie', lat: 52.17, lon: 20.97 },
  SVO: { name: 'Moscou Sheremetyevo', lat: 55.97, lon: 37.41 },
  DXB: { name: 'Dubaï', lat: 25.25, lon: 55.36 },
  AUH: { name: 'Abu Dhabi', lat: 24.43, lon: 54.65 },
  DOH: { name: 'Doha', lat: 25.27, lon: 51.61 },
  CAI: { name: 'Le Caire', lat: 30.11, lon: 31.41 },
  AMM: { name: 'Amman', lat: 31.72, lon: 35.99 },
  BEY: { name: 'Beyrouth', lat: 33.82, lon: 35.49 },
  JFK: { name: 'New York JFK', lat: 40.64, lon: -73.78 },
  EWR: { name: 'Newark', lat: 40.69, lon: -74.17 },
  LAX: { name: 'Los Angeles', lat: 33.94, lon: -118.41 },
  ORD: { name: 'Chicago O\'Hare', lat: 41.98, lon: -87.90 },
  ATL: { name: 'Atlanta', lat: 33.64, lon: -84.43 },
  MIA: { name: 'Miami', lat: 25.80, lon: -80.29 },
  DFW: { name: 'Dallas Fort Worth', lat: 32.90, lon: -97.04 },
  SFO: { name: 'San Francisco', lat: 37.62, lon: -122.38 },
  YYZ: { name: 'Toronto', lat: 43.68, lon: -79.63 },
  MEX: { name: 'Mexico City', lat: 19.44, lon: -99.07 },
  GRU: { name: 'São Paulo Guarulhos', lat: -23.43, lon: -46.47 },
  EZE: { name: 'Buenos Aires Ezeiza', lat: -34.82, lon: -58.54 },
  DEL: { name: 'Delhi', lat: 28.56, lon: 77.10 },
  BOM: { name: 'Mumbai', lat: 19.09, lon: 72.87 },
  PEK: { name: 'Pékin', lat: 40.08, lon: 116.58 },
  PVG: { name: 'Shanghai Pudong', lat: 31.14, lon: 121.80 },
  HKG: { name: 'Hong Kong', lat: 22.31, lon: 113.91 },
  NRT: { name: 'Tokyo Narita', lat: 35.77, lon: 140.39 },
  HND: { name: 'Tokyo Haneda', lat: 35.55, lon: 139.78 },
  ICN: { name: 'Séoul Incheon', lat: 37.46, lon: 126.44 },
  SIN: { name: 'Singapour', lat: 1.36, lon: 103.99 },
  BKK: { name: 'Bangkok', lat: 13.69, lon: 100.75 },
  SYD: { name: 'Sydney', lat: -33.95, lon: 151.18 },
  JNB: { name: 'Johannesburg', lat: -26.13, lon: 28.24 },
};

const HUB_POINTS = [
  // Middle East / Europe
  { name: 'Israël / Levant', lat: 31.5, lon: 34.8, region: 'Moyen-Orient' },
  { name: 'Europe de l\'Ouest', lat: 48.8, lon: 2.3, region: 'Europe' },
  { name: 'Europe Centrale', lat: 50.1, lon: 8.7, region: 'Europe' },
  { name: 'Royaume-Uni', lat: 51.5, lon: -0.1, region: 'Europe' },
  { name: 'Scandinavie', lat: 59.3, lon: 18.1, region: 'Europe' },
  { name: 'Europe de l\'Est', lat: 52.2, lon: 21.0, region: 'Europe' },
  { name: 'Russie (Ouest)', lat: 55.7, lon: 37.6, region: 'Europe' },
  { name: 'Turquie', lat: 41.0, lon: 28.9, region: 'Moyen-Orient' },
  { name: 'Iran', lat: 35.7, lon: 51.4, region: 'Moyen-Orient' },
  { name: 'Golfe Persique', lat: 25.2, lon: 55.3, region: 'Moyen-Orient' },
  // Africa
  { name: 'Afrique du Nord', lat: 30.0, lon: 31.2, region: 'Afrique' },
  { name: 'Afrique de l\'Ouest', lat: 6.5, lon: 3.4, region: 'Afrique' },
  { name: 'Afrique Centrale', lat: -4.3, lon: 15.3, region: 'Afrique' },
  { name: 'Afrique de l\'Est', lat: -1.3, lon: 36.8, region: 'Afrique' },
  { name: 'Afrique du Sud', lat: -26.2, lon: 28.0, region: 'Afrique' },
  // Asia
  { name: 'Asie Centrale', lat: 43.2, lon: 76.9, region: 'Asie' },
  { name: 'Sibérie', lat: 55.0, lon: 83.0, region: 'Asie' },
  { name: 'Pakistan', lat: 24.9, lon: 67.0, region: 'Asie' },
  { name: 'Inde (Nord)', lat: 28.6, lon: 77.2, region: 'Asie' },
  { name: 'Inde (Sud)', lat: 19.1, lon: 72.9, region: 'Asie' },
  { name: 'Chine (Est)', lat: 31.2, lon: 121.5, region: 'Asie' },
  { name: 'Chine (Nord)', lat: 39.9, lon: 116.4, region: 'Asie' },
  { name: 'Mongolie', lat: 47.9, lon: 106.9, region: 'Asie' },
  { name: 'Japon', lat: 35.7, lon: 139.7, region: 'Asie' },
  { name: 'Corée du Sud', lat: 37.6, lon: 127.0, region: 'Asie' },
  { name: 'Asie du Sud-Est', lat: 1.35, lon: 103.8, region: 'Asie' },
  { name: 'Philippines', lat: 14.6, lon: 121.0, region: 'Asie' },
  // Oceania & Pacific
  { name: 'Australie (Est)', lat: -33.9, lon: 151.2, region: 'Océanie' },
  { name: 'Nouvelle-Zélande', lat: -41.3, lon: 174.8, region: 'Océanie' },
  { name: 'Pacifique (Hawaï)', lat: 21.3, lon: -157.8, region: 'Océanie' },
  { name: 'Pacifique (Guam)', lat: 13.5, lon: 144.8, region: 'Océanie' },
  // North America
  { name: 'USA (Est)', lat: 40.7, lon: -74.0, region: 'Amérique du Nord' },
  { name: 'USA (Sud-Est)', lat: 33.7, lon: -84.4, region: 'Amérique du Nord' },
  { name: 'USA (Centre)', lat: 41.9, lon: -87.6, region: 'Amérique du Nord' },
  { name: 'USA (Sud)', lat: 32.8, lon: -96.8, region: 'Amérique du Nord' },
  { name: 'USA (Ouest)', lat: 34.0, lon: -118.2, region: 'Amérique du Nord' },
  { name: 'Canada (Est)', lat: 43.7, lon: -79.4, region: 'Amérique du Nord' },
  { name: 'Canada (Ouest)', lat: 49.2, lon: -123.1, region: 'Amérique du Nord' },
  { name: 'Alaska', lat: 61.2, lon: -149.9, region: 'Amérique du Nord' },
  { name: 'Mexique', lat: 19.4, lon: -99.1, region: 'Amérique du Nord' },
  // Atlantic / South America
  { name: 'Atlantique Nord', lat: 50.0, lon: -30.0, region: 'Atlantique' },
  { name: 'Colombie', lat: 4.6, lon: -74.1, region: 'Amérique du Sud' },
  { name: 'Pérou', lat: -12.0, lon: -77.0, region: 'Amérique du Sud' },
  { name: 'Brésil', lat: -23.5, lon: -46.6, region: 'Amérique du Sud' },
  { name: 'Argentine', lat: -34.6, lon: -58.4, region: 'Amérique du Sud' },
  { name: 'Chili', lat: -33.4, lon: -70.6, region: 'Amérique du Sud' },
];

const CONTINENT_VIEWS = {
  'Europe': { center: [50, 12], zoom: 5 },
  'Moyen-Orient': { center: [30, 40], zoom: 6 },
  'Afrique': { center: [2, 20], zoom: 4 },
  'Asie': { center: [32, 90], zoom: 4 },
  'Océanie': { center: [-22, 150], zoom: 4 },
  'Amérique du Nord': { center: [45, -100], zoom: 4 },
  'Amérique du Sud': { center: [-15, -60], zoom: 4 },
};
const WORLD_VIEW = { center: [30, 15], zoom: 3 };
const CONTINENT_GROUPS = {};
for (const p of HUB_POINTS) {
  if (!p.region) continue;
  (CONTINENT_GROUPS[p.region] = CONTINENT_GROUPS[p.region] || []).push(p);
}

const RADIUS_NM = 250;         // API max radius per query
const TICK_MS = 1200;          // 1 req/sec allowed; stay safely under that
const STALE_MS = 200000;       // drop a plane if not refreshed in ~200s (grid grew, give it margin)

let gridIndex = 0;
let priorityPoints = null;     // array of {name,lat,lon} — a clicked zone (1 point) or a whole continent (many)
let priorityIndex = 0;
let cycleCount = 0;
let customCircle = null;       // visual indicator for a single clicked zone

// ---------- Filters ----------
let filters = { altMin: null, altMax: null, hideGround: false };

function applyFilters(list) {
  return list.filter(p => {
    if (filters.hideGround && p.onGround) return false;
    if (filters.altMin != null && (p.alt == null || p.alt < filters.altMin)) return false;
    if (filters.altMax != null && (p.alt == null || p.alt > filters.altMax)) return false;
    return true;
  });
}

// ---------- Follow & Route ----------
let followEnabled = false;
let routeVisible = false;
let trailsById = {}; // planeId -> array of [lat, lon] positions
const routeLine = L.polyline([], { color: '#38bdf8', weight: 3.5, opacity: 0.95, dashArray: '1,7', lineCap: 'round', className: 'route-glow' });

// Persist trails across page refreshes (this is a standalone local file the
// person runs in their own browser, not a hosted Claude artifact, so
// localStorage is appropriate here).
const TRAILS_STORAGE_KEY = 'skytrace_trails_v1';
function saveTrailsToStorage() {
  try {
    // Cap how many planes we keep to avoid unbounded storage growth
    const entries = Object.entries(trailsById).slice(-30);
    localStorage.setItem(TRAILS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (err) {
    console.error('Could not save trails to localStorage:', err);
  }
}
function loadTrailsFromStorage() {
  try {
    const raw = localStorage.getItem(TRAILS_STORAGE_KEY);
    if (raw) trailsById = JSON.parse(raw);
  } catch (err) {
    console.error('Could not load trails from localStorage:', err);
  }
}
loadTrailsFromStorage();
applyLanguage(currentLang); // apply saved/default language before first fetch

function nextQueryPoint() {
  // Alternate between the priority queue (a clicked zone, or a whole
  // continent's points, cycled for fast refresh) and the background grid
  // (slow global sweep), when a priority selection is active.
  if (priorityPoints && priorityPoints.length && gridIndex % 2 === 0) {
    const point = priorityPoints[priorityIndex % priorityPoints.length];
    priorityIndex++;
    return { ...point, isCustom: true };
  }
  const point = HUB_POINTS[gridIndex % HUB_POINTS.length];
  gridIndex++;
  if (gridIndex % HUB_POINTS.length === 0) cycleCount++;
  return point;
}

let backoffUntil = 0; // timestamp; while in the future, fetchTick skips (rate-limit cooldown)

async function fetchTick() {
  if (Date.now() < backoffUntil) {
    statusEl.className = 'err';
    statusEl.textContent = t('status_error');
    return; // still cooling down from a 429
  }
  const point = nextQueryPoint();
  zoneEl.textContent = point.name.toUpperCase();
  statusEl.className = 'loading';
  statusEl.textContent = t('status_updating');
  try {
    const url = `https://api.airplanes.live/v2/point/${point.lat}/${point.lon}/${RADIUS_NM}`;
    const res = await fetch(url);
    if (res.status === 429) {
      // Too many requests (often from multiple tabs/instances sharing the
      // same IP). Back off for a while instead of retrying every tick.
      backoffUntil = Date.now() + 15000;
      throw new Error('HTTP 429 — cooling down 15s');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const aircraft = data.ac || [];
    const now = Date.now();
    for (const a of aircraft) {
      if (a.lat == null || a.lon == null) continue;
      planesById[a.hex] = {
        id: a.hex,
        callsign: (a.flight || '').trim(),
        country: a.r || '',
        type: a.t || '',
        lon: a.lon,
        lat: a.lat,
        alt: a.alt_baro != null && a.alt_baro !== 'ground' ? a.alt_baro * 0.3048 : (a.alt_geom != null ? a.alt_geom * 0.3048 : null),
        onGround: a.alt_baro === 'ground',
        speed: a.gs != null ? a.gs * 0.5144 : null,
        heading: a.track,
        vrate: a.baro_rate != null ? a.baro_rate * 0.00508 : null,
        squawk: a.squawk,
        lastSeen: now,
      };
    }
    // Prune stale planes (out of coverage / not seen for a while)
    for (const id in planesById) {
      if (now - planesById[id].lastSeen > STALE_MS) delete planesById[id];
    }
    planes = Object.values(planesById);
    checkPendingSharedPlane();

    // Track a position trail for the selected plane (for the Route feature)
    if (selectedId && planesById[selectedId]) {
      const sp = planesById[selectedId];
      if (!trailsById[selectedId]) trailsById[selectedId] = [];
      const trail = trailsById[selectedId];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== sp.lat || last[1] !== sp.lon) {
        trail.push([sp.lat, sp.lon]);
        if (trail.length > 60) trail.shift();
        saveTrailsToStorage();
      }
      if (routeVisible) routeLine.setLatLngs(trail);
      updateRouteInfo(trail.length);
    }

    countEl.textContent = applyFilters(planes).length.toLocaleString('fr-FR');
    cyclesEl.textContent = cycleCount.toLocaleString('fr-FR');
    statusEl.className = 'live';
    statusEl.textContent = t('status_live');
    if (selectedId && planesById[selectedId]) {
      updatePanel(planesById[selectedId]);
    }
    // Rendering itself now happens continuously in the animation loop below,
    // which extrapolates each plane's position from its speed & heading —
    // this is what makes movement look smooth instead of jumping once per
    // grid cycle (~55s) when a plane's zone actually gets re-queried.
  } catch (err) {
    statusEl.className = 'err';
    statusEl.textContent = t('status_error');
    console.error('Airplanes.live fetch failed:', err);
  }
}

fetchTick();
setInterval(fetchTick, TICK_MS);

// ---------- Smooth motion: dead-reckoning animation loop ----------
// Positions from the API only refresh when a plane's region comes back
// around in the grid cycle. Between refreshes, we extrapolate each plane's
// position forward using its last known speed and heading (like real flight
// trackers do), and redraw at a steady frame rate so motion looks continuous.
let renderedPlanes = []; // last frame's projected list, used for click hit-testing

function projectPosition(p, nowMs) {
  if (p.speed == null || p.heading == null || p.onGround) return { lat: p.lat, lon: p.lon };
  const elapsedSec = Math.min((nowMs - p.lastSeen) / 1000, 90); // cap extrapolation
  if (elapsedSec <= 0) return { lat: p.lat, lon: p.lon };
  const distance = p.speed * elapsedSec; // meters
  const headingRad = (p.heading * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const deltaNorth = distance * Math.cos(headingRad);
  const deltaEast = distance * Math.sin(headingRad);
  return {
    lat: p.lat + deltaNorth / metersPerDegLat,
    lon: p.lon + deltaEast / metersPerDegLon,
  };
}

function renderFrame() {
  const now = Date.now();
  const visible = applyFilters(planes);
  countEl.textContent = visible.length.toLocaleString('fr-FR');
  renderedPlanes = visible.map(p => {
    const proj = projectPosition(p, now);
    return { ...p, lat: proj.lat, lon: proj.lon, selected: p.id === selectedId };
  });
  planeLayer.setData(renderedPlanes);
  if (followEnabled && selectedId) {
    const sp = renderedPlanes.find(p => p.id === selectedId);
    if (sp) map.panTo([sp.lat, sp.lon], { animate: false });
  }
}
setInterval(renderFrame, 150); // ~6-7 fps: smooth enough for map icons, cheap on CPU

function setCustomPoint(lat, lon) {
  document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
  priorityPoints = [{ name: 'Zone sélectionnée', lat, lon }];
  priorityIndex = 0;
  gridIndex = 0; // ensures the very next tick queries this point immediately
  if (customCircle) map.removeLayer(customCircle);
  customCircle = L.circle([lat, lon], {
    radius: RADIUS_NM * 1852, // nm -> meters
    color: '#2fe6a8',
    weight: 1,
    fillColor: '#2fe6a8',
    fillOpacity: 0.03,
    dashArray: '4,6',
  }).addTo(map);
}

function selectContinent(regionName) {
  const points = CONTINENT_GROUPS[regionName];
  if (!points || !points.length) return;
  priorityPoints = points;
  priorityIndex = 0;
  gridIndex = 0;
  if (customCircle) { map.removeLayer(customCircle); customCircle = null; }
  const view = CONTINENT_VIEWS[regionName];
  if (view) map.flyTo(view.center, view.zoom, { duration: 1 });
  fetchTick();
}

function clearPriority() {
  priorityPoints = null;
  priorityIndex = 0;
  if (customCircle) { map.removeLayer(customCircle); customCircle = null; }
  map.flyTo(WORLD_VIEW.center, WORLD_VIEW.zoom, { duration: 1 });
}

// ---------- Interaction: click nearest plane, or recenter search zone ----------
map.on('click', function(e) {
  const clickPt = map.latLngToContainerPoint(e.latlng);
  let closest = null;
  let closestDist = Infinity;
  for (const p of renderedPlanes) {
    const pt = map.latLngToContainerPoint([p.lat, p.lon]);
    const d = Math.hypot(pt.x - clickPt.x, pt.y - clickPt.y);
    if (d < closestDist) { closestDist = d; closest = p; }
  }
  if (closest && closestDist < 18) {
    selectPlane(closest);
  } else {
    // No plane nearby: treat the click as "explore this zone in priority"
    setCustomPoint(e.latlng.lat, e.latlng.lng);
    fetchTick();
  }
});

function selectPlane(p) {
  selectedId = p.id;
  const canonical = planesById[p.id] || p;
  updatePanel(canonical);
  trailsById[p.id] = trailsById[p.id] || [[canonical.lat, canonical.lon]];
  routeLine.setLatLngs(trailsById[p.id]);
  updateRouteInfo(trailsById[p.id].length);
}

function updateRouteInfo(count) {
  const el = document.getElementById('route-info');
  if (!el) return;
  el.innerHTML = count > 0 ? t('route_points')(count) : '';
}

const photoCache = {}; // registration -> photo URL (or null if none found), avoids refetching every render

function updatePanel(p) {
  document.getElementById('panel').classList.add('show');
  document.getElementById('p-callsign').textContent = p.callsign || p.id.toUpperCase();
  const typeBadge = document.getElementById('p-type-badge');
  if (p.type) { typeBadge.textContent = p.type; typeBadge.style.display = 'inline-block'; }
  else { typeBadge.style.display = 'none'; }
  document.getElementById('p-country').textContent = p.country || '—';

  const altEl = document.getElementById('p-alt');
  if (p.alt != null) {
    const cls = p.alt < 1000 ? 'badge-low' : (p.alt < 8000 ? 'badge-mid' : 'badge-cruise');
    altEl.innerHTML = `<span class="badge-alt ${cls}">${Math.round(p.alt)} m</span>`;
  } else altEl.textContent = '—';

  document.getElementById('p-speed').textContent = p.speed != null ? Math.round(p.speed * 3.6) + ' km/h' : '—';
  document.getElementById('p-heading').textContent = p.heading != null ? Math.round(p.heading) + '°' : '—';

  const vrateEl = document.getElementById('p-vrate');
  if (p.vrate != null) {
    const arrow = p.vrate > 0.5 ? '↗ ' : (p.vrate < -0.5 ? '↘ ' : '→ ');
    const color = p.vrate > 0.5 ? 'var(--accent)' : (p.vrate < -0.5 ? 'var(--high)' : 'var(--text)');
    vrateEl.innerHTML = `<span style="color:${color}">${arrow}${(p.vrate > 0 ? '+' : '') + p.vrate.toFixed(1)} m/s</span>`;
  } else vrateEl.textContent = '—';

  document.getElementById('p-squawk').textContent = p.squawk || '—';
  document.getElementById('p-pos').textContent = p.lat.toFixed(2) + ', ' + p.lon.toFixed(2);
  loadAircraftPhoto(p.country);
}

async function loadAircraftPhoto(registration) {
  const photoEl = document.getElementById('p-photo');
  if (!registration) { photoEl.style.display = 'none'; return; }
  if (registration in photoCache) {
    const cached = photoCache[registration];
    if (cached) { photoEl.src = cached; photoEl.style.display = 'block'; }
    else { photoEl.style.display = 'none'; }
    return;
  }
  photoEl.style.display = 'none';
  try {
    const res = await fetch(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const url = data.photos && data.photos[0] ? data.photos[0].thumbnail_large.src : null;
    photoCache[registration] = url;
    // Only apply if the panel is still showing this same registration
    if (document.getElementById('p-country').textContent === registration && url) {
      photoEl.src = url;
      photoEl.style.display = 'block';
    }
  } catch (err) {
    photoCache[registration] = null;
    console.error('Photo fetch failed:', err);
  }
}

function closePanel() {
  document.getElementById('panel').classList.remove('show');
  selectedId = null;
  followEnabled = false;
  routeVisible = false;
  document.getElementById('btn-follow').classList.remove('active');
  document.getElementById('btn-route').classList.remove('active');
  if (map.hasLayer(routeLine)) map.removeLayer(routeLine);
}

// Follow toggle: keep the map centered on the selected plane as it updates
document.getElementById('btn-follow').addEventListener('click', function() {
  followEnabled = !followEnabled;
  this.classList.toggle('active', followEnabled);
  if (followEnabled && selectedId && planesById[selectedId]) {
    const sp = planesById[selectedId];
    map.panTo([sp.lat, sp.lon], { animate: true, duration: 0.5 });
  }
});

// Route toggle: show/hide the recent trail of the selected plane
document.getElementById('btn-route').addEventListener('click', function() {
  routeVisible = !routeVisible;
  this.classList.toggle('active', routeVisible);
  if (routeVisible) {
    if (selectedId) routeLine.setLatLngs(trailsById[selectedId] || []);
    routeLine.addTo(map);
  } else {
    if (map.hasLayer(routeLine)) map.removeLayer(routeLine);
  }
});

// Share: put the selected plane's registration in the URL so the link can
// be reopened directly on this aircraft (the page auto-selects it once found)
document.getElementById('btn-share').addEventListener('click', async function() {
  if (!selectedId || !planesById[selectedId]) return;
  const reg = planesById[selectedId].country || selectedId;
  const url = new URL(window.location.href);
  url.searchParams.set('plane', reg);
  try {
    await navigator.clipboard.writeText(url.toString());
    const original = this.textContent;
    this.textContent = t('link_copied');
    setTimeout(() => { this.textContent = original; }, 1500);
  } catch (err) {
    // Clipboard API can fail on file:// or without HTTPS; fall back to a prompt
    window.prompt('Copie ce lien :', url.toString());
  }
});

// On load, check for a ?plane= param and auto-select it once it's been seen
const urlParams = new URLSearchParams(window.location.search);
const pendingSharedPlane = urlParams.get('plane');
if (pendingSharedPlane) {
  zoneEl.textContent = t('zone_searching') + pendingSharedPlane.toUpperCase();
}
function checkPendingSharedPlane() {
  if (!pendingSharedPlaneActive) return;
  const q = pendingSharedPlane.toUpperCase();
  const match = planes.find(p =>
    (p.callsign && p.callsign.toUpperCase() === q) ||
    (p.country && p.country.toUpperCase() === q)
  );
  if (match) {
    selectPlane(match);
    map.flyTo([match.lat, match.lon], Math.max(map.getZoom(), 6), { duration: 1 });
    pendingSharedPlaneActive = false;
  }
}
let pendingSharedPlaneActive = !!pendingSharedPlane;

// ---------- Zones panel ----------
const zonesToggleBtn = document.getElementById('zones-toggle');
const zonesPanel = document.getElementById('zones-panel');
zonesToggleBtn.addEventListener('click', function() {
  zonesPanel.classList.toggle('show');
  this.classList.toggle('active', zonesPanel.classList.contains('show'));
});
document.querySelectorAll('.zone-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    selectContinent(this.dataset.region);
  });
});
document.getElementById('zone-clear').addEventListener('click', function() {
  document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
  clearPriority();
});

// ---------- Filters panel ----------
const filtersToggleBtn = document.getElementById('filters-toggle');
const filtersPanel = document.getElementById('filters-panel');
filtersToggleBtn.addEventListener('click', function() {
  filtersPanel.classList.toggle('show');
  this.classList.toggle('active', filtersPanel.classList.contains('show'));
});

function refreshFiltersFromInputs() {
  const min = document.getElementById('f-alt-min').value;
  const max = document.getElementById('f-alt-max').value;
  filters.altMin = min !== '' ? Number(min) : null;
  filters.altMax = max !== '' ? Number(max) : null;
  filters.hideGround = document.getElementById('f-hide-ground').checked;
  // Render loop (every 150ms) will pick up the new filter state automatically
}

document.getElementById('f-alt-min').addEventListener('input', refreshFiltersFromInputs);
document.getElementById('f-alt-max').addEventListener('input', refreshFiltersFromInputs);
document.getElementById('f-hide-ground').addEventListener('change', refreshFiltersFromInputs);
document.getElementById('f-reset').addEventListener('click', function() {
  document.getElementById('f-alt-min').value = '';
  document.getElementById('f-alt-max').value = '';
  document.getElementById('f-hide-ground').checked = false;
  refreshFiltersFromInputs();
});

// ---------- Search by callsign, registration, or airport code ----------
document.getElementById('search').addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toUpperCase();
  if (!q) return;

  // Airport code takes priority if it matches our curated list
  if (AIRPORTS[q]) {
    const airport = AIRPORTS[q];
    document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
    priorityPoints = [{ name: airport.name, lat: airport.lat, lon: airport.lon }];
    priorityIndex = 0;
    gridIndex = 0;
    if (customCircle) { map.removeLayer(customCircle); customCircle = null; }
    map.flyTo([airport.lat, airport.lon], 9, { duration: 1 });
    fetchTick();
    statusEl.className = 'live';
    zoneEl.textContent = airport.name.toUpperCase();
    return;
  }

  const match = planes.find(p =>
    (p.callsign && p.callsign.toUpperCase().includes(q)) ||
    (p.country && p.country.toUpperCase().includes(q)) // "country" field holds registration
  );
  if (match) {
    selectPlane(match);
    map.flyTo([match.lat, match.lon], Math.max(map.getZoom(), 6), { duration: 1 });
  } else {
    statusEl.className = 'err';
    statusEl.textContent = t('status_not_tracked');
    setTimeout(() => { statusEl.className = 'live'; statusEl.textContent = t('status_live'); }, 2000);
  }
});