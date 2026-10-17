// Free outside data: wind from Open-Meteo, street names from OpenStreetMap
// Nominatim. Both are cached and time out fast; callers handle null.

const cache = new Map();

async function cachedFetch(key, ttlMs, url, headers = {}) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const value = await res.json();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`[external] ${new URL(url).host} failed: ${err.message}`);
    return null;
  }
}

// Returns { speed_kmh, from_deg } or null. from_deg is where the wind blows from.
export async function getWind(lat, lng) {
  const key = `wind:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=wind_speed_10m,wind_direction_10m`;
  const data = await cachedFetch(key, 10 * 60 * 1000, url);
  if (!data?.current) return null;
  return { speed_kmh: data.current.wind_speed_10m, from_deg: data.current.wind_direction_10m };
}

// Returns a short "Street & Cross St" style label, or null.
let lastGeocode = 0;
export async function reverseGeocode(lat, lng) {
  const key = `geo:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit.value?.label ?? null;
  // Nominatim asks for at most one request per second.
  const wait = lastGeocode + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocode = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`;
  const ua = `incident-reporting-hackathon/0.1 (${process.env.GEOCODE_CONTACT || 'demo'})`;
  const data = await cachedFetch(key, 24 * 3600 * 1000, url, { 'User-Agent': ua });
  if (!data?.address) return null;
  const a = data.address;
  const street = a.road || a.pedestrian || a.footway || a.path;
  const area = a.neighbourhood || a.suburb || a.city_district || a.city;
  const label = [a.house_number && street ? `${a.house_number} ${street}` : street, area].filter(Boolean).join(', ');
  cache.set(key, { at: Date.now(), value: { label } });
  return label || null;
}
