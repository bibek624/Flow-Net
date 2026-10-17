// Basemap tiles for both pages. No API key needed for either source.
// First choice: Esri's Canvas gray maps (base plus labels). If those tiles
// keep failing, switch to OpenStreetMap so the map is never blank.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function esri(theme) {
  const style = theme === 'dark' ? 'World_Dark_Gray' : 'World_Light_Gray';
  const opts = { maxZoom: 16, maxNativeZoom: 16 };
  const base = L.tileLayer(`${ESRI}/${style}_Base/MapServer/tile/{z}/{y}/{x}`, { ...opts, attribution: ESRI_ATTR });
  const labels = L.tileLayer(`${ESRI}/${style}_Reference/MapServer/tile/{z}/{y}/{x}`, opts);
  return { group: L.layerGroup([base, labels]), base };
}

function osm(theme) {
  // OpenStreetMap has no dark style; a filter turns the light map dark.
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 16,
    attribution: OSM_ATTR,
    className: theme === 'dark' ? 'tiles-dark' : '',
  });
}

// Adds a basemap to the map. Returns an object with remove() for theme changes.
export function addBasemap(map, theme) {
  const { group, base } = esri(theme);
  let layer = group.addTo(map);
  let errors = 0;
  let loaded = 0;
  base.on('tileload', () => { loaded++; });
  base.on('tileerror', () => {
    errors++;
    if (errors >= 3 && loaded === 0 && map.hasLayer(layer)) {
      map.removeLayer(layer);
      layer = osm(theme).addTo(map);
    }
  });
  return { remove: () => map.removeLayer(layer) };
}
