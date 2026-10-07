// Offline fallback used only when no OpenStreetMap server is reachable.
// It is NOT the real street layout - just a schematic grid that carries
// some well-known Petah Tikva street names so the game is still playable.
import { TILE_W, TILE_H } from './osm.js';

const EW = ['ז\'בוטינסקי', 'ברון הירש', 'מוהליבר', 'בר כוכבא', 'הרצל', 'פינסקר', 'אם המושבות', 'קפלן', 'העצמאות'];
const NS = ['רוטשילד', 'חיים עוזר', 'סטמפר', 'אחד העם', 'ההגנה', 'בן גוריון', 'בורוכוב', 'מונטיפיורי', 'שפירא', 'יהודה הלוי'];

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

export function fallbackTile(tx, tz) {
  const step = 130;
  const x0 = tx * TILE_W, z0 = tz * TILE_H;
  const roads = [], buildings = [], areas = [], trees = [];
  const nodeId = (ix, iz) => -(((ix + 5000) * 100000) + (iz + 5000));
  const ixa = Math.floor(x0 / step), ixb = Math.ceil((x0 + TILE_W) / step);
  const iza = Math.floor(z0 / step), izb = Math.ceil((z0 + TILE_H) / step);
  let rid = -1e9 - (tx * 1000 + tz) * 1000;
  for (let iz = iza; iz <= izb; iz++) {
    const pts = [], nodes = [];
    for (let ix = ixa; ix <= ixb; ix++) { pts.push([ix * step, iz * step]); nodes.push(nodeId(ix, iz)); }
    const major = ((iz % 4) + 4) % 4 === 0;
    roads.push({ id: -(1e8 + (iz + 5000) * 10 + 1) - tx * 1e6, type: major ? 'secondary' : 'residential', name: EW[((iz % EW.length) + EW.length) % EW.length], nameEn: '', pts, nodes, oneway: false, width: major ? 10 : 7, drivable: true, major, lanes: 0 });
  }
  for (let ix = ixa; ix <= ixb; ix++) {
    const pts = [], nodes = [];
    for (let iz = iza; iz <= izb; iz++) { pts.push([ix * step, iz * step]); nodes.push(nodeId(ix, iz)); }
    const major = ((ix % 4) + 4) % 4 === 0;
    roads.push({ id: -(2e8 + (ix + 5000) * 10 + 2) - tz * 1e6, type: major ? 'primary' : 'residential', name: NS[((ix % NS.length) + NS.length) % NS.length], nameEn: '', pts, nodes, oneway: false, width: major ? 11 : 7, drivable: true, major, lanes: 0 });
  }
  for (let ix = ixa; ix < ixb; ix++) for (let iz = iza; iz < izb; iz++) {
    const bx = ix * step, bz = iz * step;
    const seed = (ix * 7919 + iz * 104729) >>> 0;
    if (hash(seed) < 0.08) {
      areas.push({ id: -(3e8 + seed), kind: 'park', pts: [[bx + 12, bz + 12], [bx + step - 12, bz + 12], [bx + step - 12, bz + step - 12], [bx + 12, bz + step - 12]] });
      continue;
    }
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const s = seed * 9 + a * 3 + b;
      const cx = bx + 22 + a * 36, cz = bz + 22 + b * 36;
      const w = 14 + hash(s) * 12, d = 14 + hash(s + 1) * 12;
      const floors = 3 + Math.floor(hash(s + 2) * 6) + (hash(s + 3) > 0.95 ? 18 : 0);
      buildings.push({ id: -(4e8 + s), pts: [[cx, cz], [cx + w, cz], [cx + w, cz + d], [cx, cz + d]], h: floors * 3.1 + 1, min: 0, colour: null, kind: 'apartments' });
    }
  }
  return { roads, buildings, areas, trees, fallback: true };
}
