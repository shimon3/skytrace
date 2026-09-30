import { getLanguage, t } from './i18n.js';

function colorForAltitude(altitude) {
  if (altitude == null) return '#7c8aa3';
  if (altitude < 1000) return '#ff4d6d';
  if (altitude < 8000) return '#f5b942';
  return '#2fe6a8';
}

function drawPlane(ctx, x, y, heading, color, selected) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((heading || 0) * Math.PI) / 180);
  ctx.scale(selected ? 1.35 : 1, selected ? 1.35 : 1);
  ctx.fillStyle = selected ? '#fff' : color;
  ctx.shadowColor = color;
  ctx.shadowBlur = selected ? 12 : 3;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(1.3, 1);
  ctx.lineTo(8, 5);
  ctx.lineTo(8, 6.2);
  ctx.lineTo(1.3, 3.6);
  ctx.lineTo(1.1, 7.5);
  ctx.lineTo(3.2, 9);
  ctx.lineTo(0, 9);
  ctx.lineTo(-3.2, 9);
  ctx.lineTo(-1.1, 7.5);
  ctx.lineTo(-1.3, 3.6);
  ctx.lineTo(-8, 6.2);
  ctx.lineTo(-8, 5);
  ctx.lineTo(-1.3, 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const PlaneLayer = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'plane-canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.zIndex = 450;
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize viewreset', this._reset, this);
    this._reset();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('moveend zoomend resize viewreset', this._reset, this);
  },
  setData(items) {
    this._items = items;
    this.draw();
  },
  _reset() {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    this._topLeft = topLeft;
    L.DomUtil.setPosition(this._canvas, topLeft);
    const size = this._map.getSize();
    this._canvas.width = Math.max(1, Math.round(size.x));
    this._canvas.height = Math.max(1, Math.round(size.y));
    this.draw();
  },
  draw() {
    if (!this._canvas || !this._map) return;
    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    const bounds = this._map.getBounds().pad(0.15);
    const detailed = this._map.getZoom() >= 7;
    const topLeft = this._topLeft || this._map.containerPointToLayerPoint([0, 0]);

    for (const item of this._items || []) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
      if (!bounds.contains([item.lat, item.lon])) continue;

      const layerPoint = this._map.latLngToLayerPoint([item.lat, item.lon]);
      const point = layerPoint.subtract(topLeft);
      if (
        point.x < -20 ||
        point.y < -20 ||
        point.x > this._canvas.width + 20 ||
        point.y > this._canvas.height + 20
      ) {
        continue;
      }

      const color = colorForAltitude(item.alt);
      if (detailed || item.selected) {
        drawPlane(ctx, point.x, point.y, item.heading, color, item.selected);
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  },
});

export function createMapView({ mapTilerKey = '' } = {}) {
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 11,
  }).setView([30, 15], 3);

  // The API client uses the live Leaflet bounds to request only aircraft
  // covering the region that is currently visible on screen.
  window.__skytraceMap = map;

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // CARTO raster basemaps now require an API key. Use no-key providers
  // here so the map never displays the "API KEY REQUIRED" watermark.
  const esriAttribution = 'Tiles &copy; Esri';
  const osmAttribution = '&copy; OpenStreetMap contributors';

  const dark = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 16, attribution: esriAttribution }
  );

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: esriAttribution }
  );

  const languageForMap = () => {
    if (!L.maptiler?.Language) return null;
    if (getLanguage() === 'he') return L.maptiler.Language.HEBREW;
    if (getLanguage() === 'fr') return L.maptiler.Language.FRENCH;
    return L.maptiler.Language.ENGLISH;
  };

  // MapTiler vector labels can be forced to the UI language. If the key or
  // SDK is unavailable, retain the known-good OpenStreetMap raster fallback.
  const hasMapTiler = Boolean(mapTilerKey && L.maptiler?.maptilerLayer);
  const colored = hasMapTiler
    ? L.maptiler.maptilerLayer({
        apiKey: mapTilerKey,
        style: L.maptiler.MapStyle.STREETS,
        language: languageForMap(),
      })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: osmAttribution,
      });
  colored.addTo(map);

  const labels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 16, attribution: esriAttribution, opacity: 0.85 }
  );

  let control;
  const rebuildLayers = () => {
    if (control) map.removeControl(control);
    control = L.control
      .layers(
        { [t('map_colored')]: colored, [t('map_dark')]: dark, [t('map_satellite')]: satellite },
        null,
        { position: 'topright', collapsed: innerWidth <= 600 }
      )
      .addTo(map);
  };
  rebuildLayers();
  document.addEventListener('skytrace:languagechange', () => {
    if (hasMapTiler && typeof colored.setLanguage === 'function') {
      colored.setLanguage(languageForMap());
    }
    rebuildLayers();
  });
  map.on('baselayerchange', (event) => {
    if (event.layer === dark) {
      if (!map.hasLayer(labels)) labels.addTo(map);
    } else if (map.hasLayer(labels)) {
      map.removeLayer(labels);
    }
  });
  const planeLayer = new PlaneLayer().addTo(map);
  return { map, planeLayer };
}
