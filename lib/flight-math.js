export const FEET_TO_METERS = 0.3048;
export const KNOTS_TO_METERS_PER_SECOND = 0.5144;
export const FEET_PER_MINUTE_TO_METERS_PER_SECOND = 0.00508;

export function feetToMeters(value) {
  return value == null ? null : value * FEET_TO_METERS;
}

export function knotsToMetersPerSecond(value) {
  return value == null ? null : value * KNOTS_TO_METERS_PER_SECOND;
}

export function feetPerMinuteToMetersPerSecond(value) {
  return value == null ? null : value * FEET_PER_MINUTE_TO_METERS_PER_SECOND;
}

export function projectPosition({ lat, lon, speed, heading, onGround, lastSeen }, nowMs, maxSeconds = 90) {
  if (lat == null || lon == null) return { lat, lon };
  if (speed == null || heading == null || onGround) return { lat, lon };

  const elapsedSeconds = Math.max(0, Math.min((nowMs - lastSeen) / 1000, maxSeconds));
  if (elapsedSeconds === 0) return { lat, lon };

  const earthRadiusMeters = 6_371_000;
  const distance = speed * elapsedSeconds;
  const angularDistance = distance / earthRadiusMeters;
  const bearing = (heading * Math.PI) / 180;
  const latitude1 = (lat * Math.PI) / 180;
  const longitude1 = (lon * Math.PI) / 180;

  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
    );

  return {
    lat: (latitude2 * 180) / Math.PI,
    lon: ((((longitude2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}
