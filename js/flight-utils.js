export const feetToMeters = feet => feet * 0.3048;
export const knotsToMetersPerSecond = knots => knots * 0.514444;
export const feetPerMinuteToMetersPerSecond = value => value * 0.00508;

export function normalizeAircraft(raw, now = Date.now()) {
  const altitudeSource = raw.alt_baro !== 'ground' && raw.alt_baro != null ? raw.alt_baro : raw.alt_geom;
  return {
    id: raw.hex,
    callsign: (raw.flight || '').trim(),
    registration: raw.r || '',
    type: raw.t || '',
    lon: raw.lon,
    lat: raw.lat,
    alt: altitudeSource != null ? feetToMeters(altitudeSource) : null,
    onGround: raw.alt_baro === 'ground',
    speed: raw.gs != null ? knotsToMetersPerSecond(raw.gs) : null,
    heading: raw.track ?? null,
    vrate: raw.baro_rate != null ? feetPerMinuteToMetersPerSecond(raw.baro_rate) : null,
    squawk: raw.squawk || '',
    lastSeen: now,
  };
}

export function projectPosition(aircraft, now = Date.now(), maxSeconds = 90) {
  if (aircraft.speed == null || aircraft.heading == null || aircraft.onGround) {
    return { lat: aircraft.lat, lon: aircraft.lon };
  }

  const elapsedSeconds = Math.max(0, Math.min((now - aircraft.lastSeen) / 1000, maxSeconds));
  if (!elapsedSeconds) return { lat: aircraft.lat, lon: aircraft.lon };

  const distance = aircraft.speed * elapsedSeconds;
  const earthRadius = 6371008.8;
  const angularDistance = distance / earthRadius;
  const bearing = aircraft.heading * Math.PI / 180;
  const latitude = aircraft.lat * Math.PI / 180;
  const longitude = aircraft.lon * Math.PI / 180;

  const projectedLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const projectedLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(projectedLatitude),
  );

  return {
    lat: projectedLatitude * 180 / Math.PI,
    lon: ((projectedLongitude * 180 / Math.PI + 540) % 360) - 180,
  };
}

export function applyAircraftFilters(aircraft, filters) {
  return aircraft.filter(item => {
    if (filters.hideGround && item.onGround) return false;
    if (filters.altMin != null && (item.alt == null || item.alt < filters.altMin)) return false;
    if (filters.altMax != null && (item.alt == null || item.alt > filters.altMax)) return false;
    return true;
  });
}
