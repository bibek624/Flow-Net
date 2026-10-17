// Small geometry helpers. Distances in meters, coordinates as [lat, lng].

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceM(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Point at a distance (m) and bearing (deg, 0 = north) from origin.
export function offset(origin, distM, bearingDeg) {
  const d = distM / R;
  const b = rad(bearingDeg);
  const lat1 = rad(origin[0]);
  const lng1 = rad(origin[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), deg(lng2)];
}

export function centroid(points) {
  const n = points.length;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

export function circle(center, radiusM, steps = 24) {
  const out = [];
  for (let i = 0; i < steps; i++) out.push(offset(center, radiusM, (360 * i) / steps));
  return out;
}

// Monotone chain convex hull on [lat, lng] points (treats lng as x).
export function convexHull(points) {
  const pts = points.map((p) => [p[1], p[0]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.map((p) => [p[1], p[0]]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper).map((p) => [p[1], p[0]]);
}

// Area in square meters using a local equirectangular projection.
export function areaM2(polygon) {
  if (polygon.length < 3) return 0;
  const lat0 = rad(centroid(polygon)[0]);
  const xy = polygon.map((p) => [rad(p[1]) * R * Math.cos(lat0), rad(p[0]) * R]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function pointInPolygon(pt, polygon) {
  let inside = false;
  const [y, x] = pt;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
