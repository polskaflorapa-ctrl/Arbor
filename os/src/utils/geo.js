/** Odległość Haversine (metry) między dwoma punktami WGS84. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if (![a1, o1, a2, o2].every((x) => Number.isFinite(x))) return null;
  const R = 6371000;
  const φ1 = (a1 * Math.PI) / 180;
  const φ2 = (a2 * Math.PI) / 180;
  const Δφ = ((a2 - a1) * Math.PI) / 180;
  const Δλ = ((o2 - o1) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

module.exports = { distanceMeters };
