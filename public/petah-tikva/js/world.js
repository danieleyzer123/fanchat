// Turns parsed OSM tile data into merged 3D meshes, a collision grid, a road graph
// (for traffic / police routing) and pre-rendered minimap tiles.
import * as THREE from './three.module.min.js';
import { TILE_W, TILE_H } from './osm.js';
import {
  makeFacadeTextures, makeAsphaltTexture, makeSidewalkTexture, makeGrassTexture, makeLabelTexture
} from './textures.js';

const Y_AREA = 0.03, Y_WALK = 0.07, Y_ROAD = 0.12, Y_MARK = 0.16;
const MAP_SCALE = 0.5; // minimap pixels per meter

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

const WALL_COLORS = ['#ece4d4', '#f2ecdc', '#ddd3c1', '#e8dece', '#d2c9ba', '#f1e8d4', '#dcd6cc', '#cdbd9e', '#ead9ba', '#c3c9cc', '#e3d7c3', '#f4f1ea', '#d9c7a7'];
const TOWER_COLORS = ['#a9bccb', '#93a9bd', '#b8c4cc', '#7f98ad', '#c9d1d6'];

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

class GeoBuf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    if (c) this.col.push(c.r, c.g, c.b);
    return this.count - 1;
  }
  toGeometry(groups) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    if (groups) for (const [s, c, m] of groups) g.addGroup(s, c, m);
    g.computeBoundingSphere();
    return g;
  }
}

// Flat ribbon along a polyline with mitred joints
function ribbon(buf, pts, width, y, color, vScale = 10, offset = 0) {
  const n = pts.length;
  if (n < 2) return;
  const half = width / 2;
  let dist = 0;
  const base = buf.count;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let nx, nz, scale = 1;
    const d1x = p[0] - a[0], d1z = p[1] - a[1];
    const d2x = b[0] - p[0], d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    if (i === 0) { nx = -d2z / l2; nz = d2x / l2; }
    else if (i === n - 1) { nx = -d1z / l1; nz = d1x / l1; }
    else {
      const n1x = -d1z / l1, n1z = d1x / l1, n2x = -d2z / l2, n2z = d2x / l2;
      nx = n1x + n2x; nz = n1z + n2z;
      const l = Math.hypot(nx, nz);
      if (l < 1e-3) { nx = n1x; nz = n1z; }
      else { nx /= l; nz /= l; scale = Math.min(2.5, 1 / Math.max(0.2, nx * n1x + nz * n1z)); }
    }
    if (i > 0) dist += l1;
    const ox = nx * half * scale, oz = nz * half * scale;
    const cx = p[0] + nx * offset, cz = p[1] + nz * offset;
    buf.vert(cx + ox, y, cz + oz, 0, 1, 0, 0, dist / vScale, color);
    buf.vert(cx - ox, y, cz - oz, 0, 1, 0, 1, dist / vScale, color);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    buf.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

function disc(buf, x, z, r, y, color, segs = 12) {
  const c = buf.vert(x, y, z, 0, 1, 0, 0.5, 0.5, color);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    buf.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 1, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, color);
  }
  for (let i = 0; i < segs; i++) buf.idx.push(c, c + 2 + i, c + 1 + i);
}

function polygon(buf, pts, y, color, uvScale = 20) {
  const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  const base = buf.count;
  for (const p of pts) buf.vert(p[0], y, p[1], 0, 1, 0, p[0] / uvScale, p[1] / uvScale, color);
  for (const t of tris) {
    const [a, b, c] = t;
    // make the face point up (+y): with x right / z south, up-facing is clockwise in (x,z)
    const ax = pts[a][0], az = pts[a][1];
    const cross = (pts[b][0] - ax) * (pts[c][1] - az) - (pts[b][1] - az) * (pts[c][0] - ax);
    if (cross < 0) buf.idx.push(base + a, base + b, base + c);
    else buf.idx.push(base + a, base + c, base + b);
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.tiles = new Map();
    this.builtWays = new Set();
    this.wallGrid = new Map();   // collision: building edges
    this.roadGrid = new Map();   // road segments for street lookup / spawning
    this.nodeGrid = new Map();   // graph nodes for routing
    this.nodeRefs = new Map();   // osm node id -> [{road, idx}]
    this.nodePos = new Map();
    this.roads = [];
    this.namedRoads = new Map(); // name -> [road]
    this.labelCache = new Map();
    this.night = false;

    const facade = makeFacadeTextures();
    this.mats = {
      wall: new THREE.MeshStandardMaterial({ map: facade.map, vertexColors: true, roughness: 0.88, metalness: 0.02, emissiveMap: facade.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 }),
      roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      road: new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      walk: new THREE.MeshStandardMaterial({ map: makeSidewalkTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      mark: new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      area: new THREE.MeshStandardMaterial({ map: makeGrassTexture(), vertexColors: true, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: '#6b4f35', roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }),
      palm: new THREE.MeshStandardMaterial({ color: '#4f7a2e', roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
      solarPanel: new THREE.MeshStandardMaterial({ color: '#1d2b44', roughness: 0.3, metalness: 0.5 }),
      solarTank: new THREE.MeshStandardMaterial({ color: '#e0e0dc', roughness: 0.5, metalness: 0.3 }),
      pole: new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.6, metalness: 0.5 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffd27a', emissiveIntensity: 0 })
    };
    this.geo = {
      trunk: new THREE.CylinderGeometry(0.18, 0.28, 3, 6).translate(0, 1.5, 0),
      crown: new THREE.IcosahedronGeometry(2.4, 1).translate(0, 4.4, 0),
      palmTrunk: new THREE.CylinderGeometry(0.22, 0.3, 8, 6).translate(0, 4, 0),
      palmCrown: new THREE.ConeGeometry(3.2, 1.6, 7, 1, true).translate(0, 7.6, 0),
      panel: new THREE.BoxGeometry(2, 0.08, 1.6).rotateX(-0.6),
      tank: new THREE.CylinderGeometry(0.4, 0.4, 1.8, 10).rotateZ(Math.PI / 2),
      pole: new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).translate(0, 1.6, 0),
      sign: new THREE.PlaneGeometry(2.2, 0.55),
      lampPole: new THREE.CylinderGeometry(0.08, 0.12, 8, 6).translate(0, 4, 0),
      lampHead: new THREE.BoxGeometry(0.5, 0.18, 1.2).translate(0, 8, 0.5)
    };
  }

  // ---------- spatial helpers ----------
  static key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  gridAdd(grid, cell, x0, z0, x1, z1, item) {
    const ax = Math.floor(Math.min(x0, x1) / cell), bx = Math.floor(Math.max(x0, x1) / cell);
    const az = Math.floor(Math.min(z0, z1) / cell), bz = Math.floor(Math.max(z0, z1) / cell);
    for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) {
      const k = World.key(cx, cz);
      let arr = grid.get(k);
      if (!arr) grid.set(k, arr = []);
      arr.push(item);
    }
  }
  gridQuery(grid, cell, x, z, r, out) {
    const ax = Math.floor((x - r) / cell), bx = Math.floor((x + r) / cell);
    const az = Math.floor((z - r) / cell), bz = Math.floor((z + r) / cell);
    for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) {
      const arr = grid.get(World.key(cx, cz));
      if (arr) for (const it of arr) out.add(it);
    }
    return out;
  }
  wallsNear(x, z, r) { return this.gridQuery(this.wallGrid, 20, x, z, r, new Set()); }
  roadSegsNear(x, z, r) { return this.gridQuery(this.roadGrid, 40, x, z, r, new Set()); }

  nearestRoad(x, z, maxDist = 30, filter = null) {
    let best = null, bd = maxDist * maxDist;
    for (const s of this.roadSegsNear(x, z, maxDist)) {
      if (filter && !filter(s.road)) continue;
      const a = s.road.pts[s.i], b = s.road.pts[s.i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < bd) { bd = d; best = { road: s.road, i: s.i, t, x: px, z: pz, dist: Math.sqrt(d), heading: Math.atan2(dx, -dz) }; }
    }
    return best;
  }

  nearestNode(x, z, maxDist = 200) {
    let best = null, bd = Infinity;
    for (let r = 50; r <= maxDist && !best; r *= 2) {
      for (const id of this.gridQuery(this.nodeGrid, 50, x, z, r, new Set())) {
        const p = this.nodePos.get(id);
        const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  }

  neighbors(id) {
    const out = [];
    const refs = this.nodeRefs.get(id);
    if (!refs) return out;
    for (const { road, idx } of refs) {
      if (idx > 0) out.push(road.nodes[idx - 1]);
      if (idx < road.nodes.length - 1) out.push(road.nodes[idx + 1]);
    }
    return out;
  }

  // A* over the drivable road graph (ignores one-way so the police can chase you anywhere)
  findPath(fromId, toId, maxIter = 6000) {
    if (fromId == null || toId == null) return null;
    const goal = this.nodePos.get(toId);
    const h = (id) => { const p = this.nodePos.get(id); return Math.hypot(p[0] - goal[0], p[1] - goal[1]); };
    const open = [[h(fromId), fromId]];
    const g = new Map([[fromId, 0]]);
    const came = new Map();
    const closed = new Set();
    let it = 0;
    while (open.length && it++ < maxIter) {
      // binary-heap pop
      const top = open[0], last = open.pop();
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === i) break;
          [open[i], open[m]] = [open[m], open[i]]; i = m;
        }
      }
      const cur = top[1];
      if (cur === toId) {
        const path = [cur];
        let c = cur;
        while (came.has(c)) { c = came.get(c); path.push(c); }
        return path.reverse().map(id => this.nodePos.get(id));
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const cp = this.nodePos.get(cur);
      for (const nb of this.neighbors(cur)) {
        if (closed.has(nb)) continue;
        const np = this.nodePos.get(nb);
        const ng = g.get(cur) + Math.hypot(np[0] - cp[0], np[1] - cp[1]);
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng); came.set(nb, cur);
          open.push([ng + h(nb), nb]);
          let i = open.length - 1;
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (open[p][0] <= open[i][0]) break;
            [open[p], open[i]] = [open[i], open[p]]; i = p;
          }
        }
      }
    }
    return null;
  }

  label(name) {
    let m = this.labelCache.get(name);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: makeLabelTexture(name) });
      this.labelCache.set(name, m);
    }
    return m;
  }

  // ---------- tile building ----------
  addTile(tx, tz, data) {
    const key = tx + ',' + tz;
    if (this.tiles.has(key)) return;
    const group = new THREE.Group();
    group.name = 'tile ' + key;
    const tile = { tx, tz, group, data, mapCanvas: this.drawMapTile(tx, tz, data) };
    this.tiles.set(key, tile);

    // register drivable roads in the graph first so junctions are known
    const newRoads = [];
    for (const r of data.roads) {
      if (this.builtWays.has('r' + r.id)) continue;
      this.builtWays.add('r' + r.id);
      newRoads.push(r);
      if (r.drivable && r.nodes.length === r.pts.length) {
        this.roads.push(r);
        r.length = 0;
        for (let i = 0; i < r.pts.length; i++) {
          const id = r.nodes[i];
          let refs = this.nodeRefs.get(id);
          if (!refs) {
            this.nodeRefs.set(id, refs = []);
            this.nodePos.set(id, r.pts[i]);
            this.gridAdd(this.nodeGrid, 50, r.pts[i][0], r.pts[i][1], r.pts[i][0], r.pts[i][1], id);
          }
          refs.push({ road: r, idx: i });
          if (i < r.pts.length - 1) {
            const a = r.pts[i], b = r.pts[i + 1];
            r.length += Math.hypot(b[0] - a[0], b[1] - a[1]);
            this.gridAdd(this.roadGrid, 40, a[0], a[1], b[0], b[1], { road: r, i });
          }
        }
        if (r.name) {
          let arr = this.namedRoads.get(r.name);
          if (!arr) this.namedRoads.set(r.name, arr = []);
          arr.push(r);
        }
      }
    }

    this.buildRoads(group, newRoads);
    this.buildBuildings(group, data.buildings);
    this.buildAreasAndTrees(group, data, newRoads);
    this.scene.add(group);
    return tile;
  }

  isJunction(id) {
    const refs = this.nodeRefs.get(id);
    return refs && refs.length > 1;
  }

  buildRoads(group, roads) {
    const roadBuf = new GeoBuf(), walkBuf = new GeoBuf(), markBuf = new GeoBuf();
    const white = new THREE.Color('#f2f2f2'), yellow = new THREE.Color('#f2c230');
    const signs = [], lamps = [];
    for (const r of roads) {
      const w = r.width;
      if (r.type === 'pedestrian') {
        ribbon(walkBuf, r.pts, w, Y_WALK + 0.01, null, 4);
        continue;
      }
      if (r.drivable && !/^(motorway|trunk)/.test(r.type) && r.type !== 'service') {
        ribbon(walkBuf, r.pts, w + 6, Y_WALK, null, 4);
      }
      ribbon(roadBuf, r.pts, w, Y_ROAD, null, 12);
      // round caps fill gaps at junctions and ends
      disc(roadBuf, r.pts[0][0], r.pts[0][1], w / 2, Y_ROAD, null);
      disc(roadBuf, r.pts[r.pts.length - 1][0], r.pts[r.pts.length - 1][1], w / 2, Y_ROAD, null);
      for (let i = 1; i < r.pts.length - 1; i++) {
        if (r.nodes[i] != null && this.isJunction(r.nodes[i])) disc(roadBuf, r.pts[i][0], r.pts[i][1], w / 2, Y_ROAD, null);
      }

      // lane markings (skip near junctions)
      if (w >= 6 && r.type !== 'service') {
        const junctionPts = [];
        r.nodes.forEach((id, i) => { if (i === 0 || i === r.nodes.length - 1 || this.isJunction(id)) junctionPts.push(r.pts[i]); });
        const nearJ = (x, z) => junctionPts.some(p => Math.abs(p[0] - x) < w && Math.abs(p[1] - z) < w);
        const dash = 3, gap = 6;
        let carry = 0;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 0.1) continue;
          const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
          const lanes = r.oneway ? Math.max(1, Math.round(w / 3.4)) : 2;
          const offsets = [];
          if (r.oneway) { for (let k = 1; k < lanes; k++) offsets.push(-w / 2 + (w * k) / lanes); }
          else offsets.push(0);
          for (let s = carry; s < len; s += dash + gap) {
            const e = Math.min(len, s + dash);
            const mx = a[0] + ux * (s + e) / 2, mz = a[1] + uz * (s + e) / 2;
            if (nearJ(mx, mz)) continue;
            for (const off of offsets) {
              const col = !r.oneway && r.major ? yellow : white;
              const x0 = a[0] + ux * s + nx * off, z0 = a[1] + uz * s + nz * off;
              const x1 = a[0] + ux * e + nx * off, z1 = a[1] + uz * e + nz * off;
              const hw = 0.09;
              const base = markBuf.count;
              markBuf.vert(x0 + nx * hw, Y_MARK, z0 + nz * hw, 0, 1, 0, 0, 0, col);
              markBuf.vert(x0 - nx * hw, Y_MARK, z0 - nz * hw, 0, 1, 0, 0, 0, col);
              markBuf.vert(x1 + nx * hw, Y_MARK, z1 + nz * hw, 0, 1, 0, 0, 0, col);
              markBuf.vert(x1 - nx * hw, Y_MARK, z1 - nz * hw, 0, 1, 0, 0, 0, col);
              markBuf.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
          }
          carry = 0;
          // edge lines on major roads
          if (r.major) {
            for (const side of [-1, 1]) {
              const off = side * (w / 2 - 0.35);
              const base = markBuf.count;
              const hw = 0.08;
              markBuf.vert(a[0] + nx * (off + hw), Y_MARK, a[1] + nz * (off + hw), 0, 1, 0, 0, 0, white);
              markBuf.vert(a[0] + nx * (off - hw), Y_MARK, a[1] + nz * (off - hw), 0, 1, 0, 0, 0, white);
              markBuf.vert(b[0] + nx * (off + hw), Y_MARK, b[1] + nz * (off + hw), 0, 1, 0, 0, 0, white);
              markBuf.vert(b[0] + nx * (off - hw), Y_MARK, b[1] + nz * (off - hw), 0, 1, 0, 0, 0, white);
              markBuf.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
            }
          }
        }
      }

      // street name signs at the ends of named streets
      if (r.name && r.drivable && r.length > 40) {
        for (const end of [0, r.pts.length - 1]) {
          const p = r.pts[end], q = r.pts[end === 0 ? 1 : end - 1];
          const dx = q[0] - p[0], dz = q[1] - p[1];
          const l = Math.hypot(dx, dz) || 1;
          const ux = dx / l, uz = dz / l;
          const off = w / 2 + 1.8;
          // place on the right-hand corner, a few meters into the street
          signs.push({ x: p[0] + ux * 6 - uz * off, z: p[1] + uz * 6 + ux * off, rot: Math.atan2(dx, dz), name: r.name });
        }
      }
      // street lamps along major roads
      if (r.drivable && (r.major || r.type === 'residential')) {
        const step = r.major ? 35 : 45;
        let acc = hash(r.id) * step;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz);
          if (len < 0.1) continue;
          const ux = dx / len, uz = dz / len;
          for (; acc < len; acc += step) {
            const side = (Math.floor(acc / step) % 2) ? 1 : -1;
            lamps.push({ x: a[0] + ux * acc - uz * side * (w / 2 + 1), z: a[1] + uz * acc + ux * side * (w / 2 + 1), rot: Math.atan2(uz * side, -ux * side) });
          }
          acc -= len;
        }
      }
    }
    if (walkBuf.count) { const m = new THREE.Mesh(walkBuf.toGeometry(), this.mats.walk); m.receiveShadow = true; group.add(m); }
    if (roadBuf.count) { const m = new THREE.Mesh(roadBuf.toGeometry(), this.mats.road); m.receiveShadow = true; group.add(m); }
    if (markBuf.count) group.add(new THREE.Mesh(markBuf.toGeometry(), this.mats.mark));

    if (signs.length) {
      const poles = new THREE.InstancedMesh(this.geo.pole, this.mats.pole, signs.length);
      const mtx = new THREE.Matrix4();
      signs.forEach((s, i) => {
        poles.setMatrixAt(i, mtx.makeTranslation(s.x, 0, s.z));
        const plate = new THREE.Mesh(this.geo.sign, this.label(s.name));
        plate.position.set(s.x, 3.0, s.z);
        plate.rotation.y = s.rot + Math.PI / 2;
        const back = plate.clone();
        back.rotation.y += Math.PI;
        back.position.x -= Math.cos(s.rot) * 0.03; back.position.z += Math.sin(s.rot) * 0.03;
        group.add(plate, back);
      });
      group.add(poles);
    }
    if (lamps.length) {
      const poles = new THREE.InstancedMesh(this.geo.lampPole, this.mats.pole, lamps.length);
      const heads = new THREE.InstancedMesh(this.geo.lampHead, this.mats.lamp, lamps.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      lamps.forEach((l, i) => {
        q.setFromAxisAngle(up, l.rot);
        mtx.compose(new THREE.Vector3(l.x, 0, l.z), q, one);
        poles.setMatrixAt(i, mtx);
        heads.setMatrixAt(i, mtx);
        this.gridAdd(this.wallGrid, 20, l.x, l.z, l.x, l.z, { post: true, x: l.x, z: l.z, r: 0.25 });
      });
      poles.castShadow = true;
      group.add(poles, heads);
    }
  }

  buildBuildings(group, buildings) {
    const walls = new GeoBuf(), roofs = new GeoBuf();
    const solar = [];
    const col = new THREE.Color();
    for (const b of buildings) {
      if (this.builtWays.has('b' + b.id)) continue;
      this.builtWays.add('b' + b.id);
      let pts = b.pts;
      const area = signedArea(pts);
      if (Math.abs(area) < 6) continue;
      // make winding consistent so wall normals face outward
      if (area > 0) pts = pts.slice().reverse();
      const h = Math.max(b.h, b.min + 2.5), y0 = b.min;
      const tower = h > 38;
      const rnd = hash(b.id);
      if (b.colour) { try { col.set(b.colour); } catch (e) { col.set(WALL_COLORS[0]); } }
      else col.set(tower ? TOWER_COLORS[Math.floor(rnd * TOWER_COLORS.length)] : WALL_COLORS[Math.floor(rnd * WALL_COLORS.length)]);
      const wallCol = col.clone();
      const roofCol = col.clone().multiplyScalar(0.78);
      let u = 0;
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i], c = pts[(i + 1) % n];
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        // outward normal (pts are clockwise in x/z after the reverse above)
        const nx = -dz / len, nz = dx / len;
        const base = walls.count;
        const u0 = Math.round(u / 3) * 3 / 12, u1 = u0 + len / 12;
        walls.vert(a[0], y0, a[1], nx, 0, nz, u0, y0 / 12.4, wallCol);
        walls.vert(c[0], y0, c[1], nx, 0, nz, u1, y0 / 12.4, wallCol);
        walls.vert(c[0], h, c[1], nx, 0, nz, u1, h / 12.4, wallCol);
        walls.vert(a[0], h, a[1], nx, 0, nz, u0, h / 12.4, wallCol);
        walls.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        u += len;
        if (y0 < 2) this.gridAdd(this.wallGrid, 20, a[0], a[1], c[0], c[1], { ax: a[0], az: a[1], bx: c[0], bz: c[1] });
      }
      polygon(roofs, pts, h, roofCol);
      // dud shemesh (solar water heater) on most residential roofs - a very Israeli sight
      if (!tower && Math.abs(area) > 60 && rnd > 0.25) {
        let cx = 0, cz = 0;
        for (const p of pts) { cx += p[0]; cz += p[1]; }
        cx /= pts.length; cz /= pts.length;
        if (pointInPoly(cx, cz, pts)) solar.push([cx, h, cz, rnd * Math.PI * 2]);
      }
    }
    if (walls.count) {
      // one mesh with two material groups: facades + roofs
      const all = new GeoBuf();
      all.pos = walls.pos.concat(roofs.pos);
      all.nor = walls.nor.concat(roofs.nor);
      all.uv = walls.uv.concat(roofs.uv);
      all.col = walls.col.concat(roofs.col);
      const off = walls.count;
      all.idx = walls.idx.concat(roofs.idx.map(i => i + off));
      const geo = all.toGeometry([[0, walls.idx.length, 0], [walls.idx.length, roofs.idx.length, 1]]);
      const mesh = new THREE.Mesh(geo, [this.mats.wall, this.mats.roof]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (solar.length) {
      const panels = new THREE.InstancedMesh(this.geo.panel, this.mats.solarPanel, solar.length);
      const tanks = new THREE.InstancedMesh(this.geo.tank, this.mats.solarTank, solar.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
      solar.forEach(([x, y, z, r], i) => {
        q.setFromAxisAngle(up, r);
        m.compose(new THREE.Vector3(x, y + 0.7, z), q, s);
        panels.setMatrixAt(i, m);
        const back = new THREE.Vector3(0, 0.9, -1.1).applyQuaternion(q);
        m.compose(new THREE.Vector3(x + back.x, y + back.y + 0.4, z + back.z), q, s);
        tanks.setMatrixAt(i, m);
      });
      group.add(panels, tanks);
    }
  }

  buildAreasAndTrees(group, data, roads) {
    const buf = new GeoBuf();
    const trees = [], palms = [];
    const kindCol = {
      park: new THREE.Color('#9bc27a'), wood: new THREE.Color('#6f9a55'), pitch: new THREE.Color('#7fc46a'),
      cemetery: new THREE.Color('#b9bd98'), water: new THREE.Color('#4f8fbf')
    };
    for (const a of data.areas) {
      if (this.builtWays.has('a' + a.id)) continue;
      this.builtWays.add('a' + a.id);
      const yOff = a.kind === 'water' ? 0.01 : a.kind === 'pitch' ? 0.025 : 0;
      polygon(buf, a.pts, Y_AREA + yOff, kindCol[a.kind] || kindCol.park, 12);
      if (a.kind === 'park' || a.kind === 'wood' || a.kind === 'cemetery') {
        let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
        for (const p of a.pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
        const ar = Math.abs(signedArea(a.pts));
        const count = Math.min(300, Math.floor(ar / (a.kind === 'wood' ? 60 : 180)));
        let seed = a.id;
        for (let i = 0; i < count * 2 && trees.length < 4000; i++) {
          const x = minx + hash(seed++) * (maxx - minx), z = minz + hash(seed++) * (maxz - minz);
          if (pointInPoly(x, z, a.pts)) trees.push([x, z, hash(seed++)]);
        }
      }
    }
    for (const t of data.trees) trees.push([t[0], t[1], hash(Math.floor(t[0] * 31 + t[1] * 17))]);
    // street trees and palm-lined avenues
    for (const r of roads) {
      if (!r.drivable || r.type === 'service' || /^(motorway|trunk)/.test(r.type) || r.type.endsWith('_link')) continue;
      const palm = r.type === 'primary' || r.type === 'secondary';
      const step = palm ? 16 : 13;
      let acc = hash(r.id + 7) * step;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        const ux = dx / len, uz = dz / len;
        for (; acc < len; acc += step) {
          if (acc < 8 || len - acc < 8) continue;
          for (const side of [-1, 1]) {
            const off = r.width / 2 + 2.2;
            const x = a[0] + ux * acc - uz * side * off, z = a[1] + uz * acc + ux * side * off;
            const rr = hash(Math.floor(x * 13 + z * 7));
            if (rr < 0.25) continue;
            (palm ? palms : trees).push([x, z, rr]);
          }
        }
        acc -= len;
      }
    }
    if (buf.count) { const m = new THREE.Mesh(buf.toGeometry(), this.mats.area); m.receiveShadow = true; group.add(m); }

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    if (trees.length) {
      const trunks = new THREE.InstancedMesh(this.geo.trunk, this.mats.trunk, trees.length);
      const crowns = new THREE.InstancedMesh(this.geo.crown, this.mats.leaf, trees.length);
      const c = new THREE.Color();
      trees.forEach(([x, z, r], i) => {
        const s = 0.75 + r * 0.6;
        q.setFromAxisAngle(up, r * 6.28);
        m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        crowns.setColorAt(i, c.setHSL(0.24 + r * 0.08, 0.42, 0.26 + r * 0.1));
        this.gridAdd(this.wallGrid, 20, x, z, x, z, { post: true, x, z, r: 0.35 * s });
      });
      trunks.castShadow = crowns.castShadow = true;
      group.add(trunks, crowns);
    }
    if (palms.length) {
      const trunks = new THREE.InstancedMesh(this.geo.palmTrunk, this.mats.trunk, palms.length);
      const crowns = new THREE.InstancedMesh(this.geo.palmCrown, this.mats.palm, palms.length);
      palms.forEach(([x, z, r], i) => {
        const s = 0.85 + r * 0.4;
        q.setFromAxisAngle(up, r * 6.28);
        m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        this.gridAdd(this.wallGrid, 20, x, z, x, z, { post: true, x, z, r: 0.35 });
      });
      trunks.castShadow = crowns.castShadow = true;
      group.add(trunks, crowns);
    }
  }

  // Pre-render this tile for the minimap (0.5 px per meter)
  drawMapTile(tx, tz, data) {
    const W = Math.ceil(TILE_W * MAP_SCALE), H = Math.ceil(TILE_H * MAP_SCALE);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const ox = tx * TILE_W, oz = tz * TILE_H;
    g.fillStyle = '#2b2f36';
    g.fillRect(0, 0, W, H);
    const path = (pts, close) => {
      g.beginPath();
      pts.forEach((p, i) => {
        const x = (p[0] - ox) * MAP_SCALE, y = (p[1] - oz) * MAP_SCALE;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      if (close) g.closePath();
    };
    for (const a of data.areas) {
      g.fillStyle = a.kind === 'water' ? '#3a6f9a' : '#3f6b3a';
      path(a.pts, true); g.fill();
    }
    g.fillStyle = '#4a4f58';
    for (const b of data.buildings) { path(b.pts, true); g.fill(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    const order = (r) => (r.major ? 2 : r.drivable ? 1 : 0);
    const sorted = data.roads.slice().sort((a, b) => order(a) - order(b));
    for (const r of sorted) {
      g.strokeStyle = r.major ? '#e8c35a' : r.drivable ? '#d9dde3' : '#8a8f96';
      g.lineWidth = Math.max(1.5, r.width * MAP_SCALE);
      path(r.pts, false); g.stroke();
    }
    return c;
  }

  setNight(night) {
    this.night = night;
    this.mats.wall.emissiveIntensity = night ? 0.9 : 0;
    this.mats.lamp.emissiveIntensity = night ? 2.5 : 0;
  }

  updateVisibility(px, pz, radius = 1700) {
    for (const t of this.tiles.values()) {
      const cx = (t.tx + 0.5) * TILE_W, cz = (t.tz + 0.5) * TILE_H;
      t.group.visible = Math.abs(cx - px) < radius && Math.abs(cz - pz) < radius;
    }
  }
}

export { MAP_SCALE, pointInPoly };
