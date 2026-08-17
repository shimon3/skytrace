import { t } from './i18n.js';

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

export function createMapView() {
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 11,
  }).setView([30, 15], 3);

  // The API client uses the live Leaflet bounds to request only aircraft
  // covering the region that is currently visible on screen.
  window.__skytraceMap = map;

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
  );
  const colored = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 19 }
  );
  const labels = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 19, opacity: 0.7 }
  ).addTo(map);
  let control;
  const rebuildLayers = () => {
    if (control) map.removeControl(control);
    control = L.control
      .layers(
        { [t('map_dark')]: dark, [t('map_satellite')]: satellite, [t('map_colored')]: colored },
        null,
        { position: 'topright', collapsed: innerWidth <= 600 }
      )
      .addTo(map);
  };
  rebuildLayers();
  document.addEventListener('skytrace:languagechange', rebuildLayers);
  map.on('baselayerchange', (event) => {
    if (event.layer === colored) {
      if (map.hasLayer(labels)) map.removeLayer(labels);
    } else if (!map.hasLayer(labels)) labels.addTo(map);
  });
  const planeLayer = new PlaneLayer().addTo(map);
  return { map, planeLayer };
}
