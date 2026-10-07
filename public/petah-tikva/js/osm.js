// Loads real OpenStreetMap data (roads, buildings, parks, trees) for Petah Tikva
// tile by tile from the Overpass API, and converts it to local meter coordinates.

// Petah Tikva city centre (around Rothschild / Haim Ozer, near Kikar HaMeyasdim)
export const ORIGIN = { lat: 32.0889, lon: 34.8864 };

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

// ~1km x 1km tiles
export const TILE_DLAT = 0.009;
export const TILE_DLON = 0.0106;
export const TILE_W = TILE_DLON * M_PER_DEG_LON;
export const TILE_H = TILE_DLAT * M_PER_DEG_LAT;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// x = east, z = south (so "north" is -z, the default three.js forward)
export function project(lat, lon) {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, -(lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

export function tileOf(x, z) {
  return [Math.floor(x / TILE_W), Math.floor(z / TILE_H)];
}

function tileBBox(tx, tz) {
  // tz grows southwards
  const west = ORIGIN.lon + tx * TILE_DLON;
  const east = west + TILE_DLON;
  const north = ORIGIN.lat - tz * TILE_DLAT;
  const south = north - TILE_DLAT;
  return [south, west, north, east];
}

const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'road'
]);

function buildQuery(tx, tz) {
  const b = tileBBox(tx, tz).map(v => v.toFixed(6)).join(',');
  return `[out:json][timeout:60];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road|pedestrian)$"](${b});
way["building"](${b});
way["leisure"~"^(park|garden|pitch|playground|stadium)$"](${b});
way["landuse"~"^(grass|forest|recreation_ground|village_green|orchard|meadow|cemetery)$"](${b});
way["natural"~"^(wood|scrub|grassland|water)$"](${b});
way["water"](${b});
node["natural"="tree"](${b});
);out geom qt;`;
}

// --- tiny IndexedDB cache so repeat visits load instantly ---
let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('pt-drive-osm', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('tiles')) d.createObjectStore('tiles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}
async function cacheGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction('tiles').objectStore('tiles').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
async function cachePut(key, value) {
  const d = await db();
  if (!d) return;
  try { d.transaction('tiles', 'readwrite').objectStore('tiles').put(value, key); } catch (e) { /* ignore */ }
}

async function fetchOverpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.elements) throw new Error('bad response');
        return json;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw lastErr || new Error('overpass unavailable');
}

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

function roadWidth(type, tags) {
  const lanes = parseInt(tags.lanes, 10);
  const base = {
    motorway: 15, trunk: 13, primary: 12, secondary: 10, tertiary: 8.5,
    unclassified: 6.5, residential: 6.5, living_street: 5.5, service: 4.5, road: 6,
    pedestrian: 6
  }[type.replace('_link', '')] || 6;
  if (type.endsWith('_link')) return 6.5;
  if (lanes > 0 && type !== 'service') return Math.max(5.5, Math.min(22, lanes * 3.3 + 1));
  return base;
}

function buildingHeight(id, tags) {
  const h = parseFloat(tags.height);
  if (h > 0) return h;
  const lv = parseFloat(tags['building:levels']);
  if (lv > 0) return lv * 3.1 + 1;
  const t = tags.building;
  if (t === 'house' || t === 'detached' || t === 'garage' || t === 'shed' || t === 'roof' || t === 'kiosk') return 3.5 + hash(id) * 3;
  if (t === 'industrial' || t === 'warehouse' || t === 'retail' || t === 'supermarket') return 7 + hash(id) * 5;
  if (t === 'synagogue' || t === 'school') return 8 + hash(id) * 4;
  // typical Petah Tikva residential blocks: 3-8 floors
  return (3 + Math.floor(hash(id) * 6)) * 3.1 + 1;
}

function closeRing(pts) {
  if (pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) pts.pop();
  }
  return pts;
}

export function parseOverpass(json) {
  const roads = [], buildings = [], areas = [], trees = [];
  for (const el of json.elements) {
    const tags = el.tags || {};
    if (el.type === 'node') {
      if (tags.natural === 'tree') trees.push(project(el.lat, el.lon));
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const pts = el.geometry.filter(Boolean).map(g => project(g.lat, g.lon));
    if (pts.length < 2) continue;
    if (tags.highway) {
      if (tags.tunnel && tags.tunnel !== 'no') continue;
      if (tags.area === 'yes') continue;
      const type = tags.highway;
      roads.push({
        id: el.id,
        type,
        name: tags.name || tags['name:he'] || '',
        nameEn: tags['name:en'] || '',
        pts,
        nodes: el.nodes || [],
        oneway: tags.oneway === 'yes' || tags.oneway === '1' || type === 'motorway' || tags.junction === 'roundabout',
        width: roadWidth(type, tags),
        drivable: DRIVABLE.has(type) && tags.access !== 'no' && tags.service !== 'parking_aisle' && tags.service !== 'driveway',
        major: /^(motorway|trunk|primary|secondary|tertiary)/.test(type),
        lanes: parseInt(tags.lanes, 10) || 0,
        bridge: !!tags.bridge && tags.bridge !== 'no'
      });
    } else if (tags.building || tags['building:part']) {
      const ring = closeRing(pts);
      if (ring.length < 3) continue;
      buildings.push({ id: el.id, pts: ring, h: buildingHeight(el.id, tags), min: parseFloat(tags.min_height) || 0, colour: tags['building:colour'] || null, kind: tags.building });
    } else {
      let kind = null;
      if (tags.natural === 'water' || tags.water) kind = 'water';
      else if (tags.leisure === 'pitch' || tags.leisure === 'stadium') kind = 'pitch';
      else if (tags.landuse === 'cemetery') kind = 'cemetery';
      else if (tags.natural === 'wood' || tags.landuse === 'forest' || tags.landuse === 'orchard') kind = 'wood';
      else kind = 'park';
      const ring = closeRing(pts);
      if (ring.length >= 3) areas.push({ id: el.id, kind, pts: ring, name: tags.name || '' });
    }
  }
  return { roads, buildings, areas, trees };
}

export async function loadTile(tx, tz) {
  const key = `v2:${tx}:${tz}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const json = await fetchOverpass(buildQuery(tx, tz));
  const data = parseOverpass(json);
  cachePut(key, data);
  return data;
}
