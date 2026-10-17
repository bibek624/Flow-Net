// Impact zone: the area an alert should reach. Built from where reports came
// from, padded by a per-category buffer. Fire and smoke zones stretch downwind.

import { circle, convexHull, areaM2, offset, centroid } from './geo.js';
import { activeProfile, category } from './categories.js';
import { getWind } from './external.js';

export const popDensity = () => Number(process.env.POP_DENSITY_PER_KM2 || activeProfile().popDensityPerKm2);

export async function computeZone(incident, reports) {
  const pts = reports.filter((r) => r.lat != null).map((r) => [r.lat, r.lng]);
  if (!pts.length) return null;
  const cat = category(incident.category);
  const buffer = cat.bufferM;
  const fireLike = cat.family === 'fire' || cat.family === 'smoke' || cat.family === 'gas';

  let ring = pts.flatMap((p) => circle(p, buffer, 16));
  let wind = null;
  let stretchKm = 0;

  if (fireLike) {
    wind = await getWind(incident.lat, incident.lng);
    if (wind && wind.speed_kmh > 3) {
      const downwind = (wind.from_deg + 180) % 360;
      stretchKm = Math.min(4, 0.5 + wind.speed_kmh * (cat.family === 'gas' ? 0.06 : 0.12));
      // Smoke, embers and fumes travel with the wind, so the zone widens as it goes.
      const center = centroid(pts);
      for (const f of [0.35, 0.7, 1]) {
        ring = ring.concat(circle(offset(center, stretchKm * 1000 * f, downwind), buffer * (1 + f), 16));
      }
    }
  }

  const polygon = convexHull(ring);
  const area_km2 = areaM2(polygon) / 1e6;
  return {
    polygon,
    area_km2: Math.round(area_km2 * 100) / 100,
    residents_est: Math.max(100, Math.round((area_km2 * popDensity()) / 100) * 100),
    wind,
    basis:
      `Report spread plus ${buffer} m` +
      (stretchKm ? `, stretched ${stretchKm.toFixed(1)} km downwind` : '') +
      (fireLike && !wind ? ' (wind data unavailable)' : ''),
  };
}
