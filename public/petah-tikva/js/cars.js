// Vehicles: meshes, arcade physics, city traffic and police pursuit.
import * as THREE from './three.module.min.js';

const glassMat = new THREE.MeshStandardMaterial({ color: '#1b2430', roughness: 0.15, metalness: 0.6 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.8 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#b8bcc2', roughness: 0.3, metalness: 0.8 });
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14).rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8).rotateZ(Math.PI / 2);

function box(w, h, l, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Forward is local -Z.
export function makeCarMesh(color, kind = 'car') {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff3c0', emissiveIntensity: 0.2 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: '#7a0b0b', emissive: '#ff1a1a', emissiveIntensity: 0.15 });
  const wheels = [], steerPivots = [];
  let length = 4.4, width = 1.9;

  if (kind === 'bus') {
    length = 12; width = 2.55;
    g.add(box(2.55, 2.6, 12, paint, 0, 1.75, 0));
    const stripe = new THREE.MeshStandardMaterial({ color: '#1f7a3f', roughness: 0.5 });
    g.add(box(2.57, 0.5, 12.02, stripe, 0, 0.75, 0));
    g.add(box(2.58, 1.0, 10.4, glassMat, 0, 2.3, 0.4));
    g.add(box(2.3, 1.3, 0.05, glassMat, 0, 2.1, -6.01));
    const hl = box(2.2, 0.2, 0.06, headMat, 0, 0.8, -6.02); hl.castShadow = false; g.add(hl);
    const bl = box(2.2, 0.2, 0.06, brakeMat, 0, 0.9, 6.02); bl.castShadow = false; g.add(bl);
    for (const [x, z] of [[-1.1, -4], [1.1, -4], [-1.1, 3.8], [1.1, 3.8]]) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateZ(Math.PI / 2), tireMat);
      w.add(t);
      w.position.set(x, 0.5, z);
      g.add(w); wheels.push(w);
    }
  } else {
    g.add(box(1.9, 0.62, 4.4, paint, 0, 0.62, 0));
    // cabin + roof
    g.add(box(1.68, 0.55, 2.2, glassMat, 0, 1.18, 0.25));
    g.add(box(1.62, 0.08, 1.9, paint, 0, 1.48, 0.3));
    // pillars
    g.add(box(1.72, 0.5, 0.12, paint, 0, 1.18, 1.35));
    // bumpers
    g.add(box(1.92, 0.25, 0.2, darkMat, 0, 0.42, -2.25));
    g.add(box(1.92, 0.25, 0.2, darkMat, 0, 0.42, 2.25));
    for (const s of [-1, 1]) {
      const hl = box(0.42, 0.16, 0.06, headMat, s * 0.65, 0.72, -2.21); hl.castShadow = false; g.add(hl);
      const bl = box(0.42, 0.16, 0.06, brakeMat, s * 0.65, 0.76, 2.21); bl.castShadow = false; g.add(bl);
      // mirrors
      g.add(box(0.18, 0.12, 0.1, paint, s * 1.02, 1.0, -0.75));
    }
    for (const [x, z] of [[-0.86, -1.35], [0.86, -1.35], [-0.86, 1.4], [0.86, 1.4]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      const w = new THREE.Group();
      w.add(new THREE.Mesh(wheelGeo, tireMat));
      w.add(new THREE.Mesh(rimGeo, rimMat));
      pivot.add(w);
      g.add(pivot);
      wheels.push(w);
      if (z < 0) steerPivots.push(pivot);
    }
  }

  let sirens = null;
  if (kind === 'police') {
    // Israeli police: white car, blue stripe, blue/red light bar
    const stripe = new THREE.MeshStandardMaterial({ color: '#1546a8', roughness: 0.4 });
    g.add(box(1.93, 0.22, 3.6, stripe, 0, 0.7, 0));
    const blue = new THREE.MeshStandardMaterial({ color: '#0a2a8a', emissive: '#2050ff', emissiveIntensity: 0 });
    const red = new THREE.MeshStandardMaterial({ color: '#6a0a0a', emissive: '#ff2020', emissiveIntensity: 0 });
    g.add(box(1.3, 0.1, 0.35, darkMat, 0, 1.56, 0.3));
    const l = box(0.6, 0.16, 0.3, blue, -0.33, 1.66, 0.3);
    const r = box(0.6, 0.16, 0.3, red, 0.33, 1.66, 0.3);
    g.add(l, r);
    sirens = { blue, red };
  } else if (kind === 'taxi') {
    const signMat = new THREE.MeshStandardMaterial({ color: '#ffd400', emissive: '#ffc800', emissiveIntensity: 0.3 });
    g.add(box(0.7, 0.22, 0.3, signMat, 0, 1.63, 0.3));
  }
  return { group: g, wheels, steerPivots, headMat, brakeMat, sirens, length, width, paint };
}

export class Vehicle {
  constructor(scene, color, kind = 'car') {
    this.mesh = makeCarMesh(color, kind);
    this.kind = kind;
    scene.add(this.mesh.group);
    this.x = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.steer = 0; this.speed = 0; this.vf = 0;
    this.maxSpeed = kind === 'police' ? 47 : 58;
    this.accel = kind === 'police' ? 13 : 15;
    this.impact = 0; // last collision strength (m/s)
    this.body = 0;   // visual body roll
    this.pitch = 0;
  }

  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return -Math.cos(this.heading); }

  place(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vz = 0;
    this.sync();
  }

  update(dt, input, world) {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = Math.sin(this.heading);
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;
    const thr = input.throttle;
    const braking = (thr < 0 && vf > 0.5) || (thr > 0 && vf < -0.5);
    if (braking) {
      const b = 26 * dt * Math.abs(thr);
      vf = Math.abs(vf) <= b ? 0 : vf - Math.sign(vf) * b;
    } else if (thr > 0) {
      vf += thr * this.accel * dt * Math.max(0.15, 1 - (vf / this.maxSpeed) ** 2);
    } else if (thr < 0) {
      vf += thr * 7 * dt * Math.max(0, 1 + vf / 14);
    }
    // rolling + air drag
    vf -= vf * (0.12 + Math.abs(vf) * 0.0035) * dt;
    if (thr === 0 && Math.abs(vf) < 0.3) vf *= Math.max(0, 1 - 6 * dt);
    if (input.handbrake) vf -= vf * 1.2 * dt;

    // steering: smooth input, less lock at speed
    const target = input.steer * 0.62 / (1 + Math.abs(vf) / 18);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    let yaw = (vf / 2.7) * Math.tan(this.steer);
    if (input.handbrake && Math.abs(vf) > 5) yaw *= 1.45;
    this.heading += yaw * dt;

    const grip = input.handbrake ? 1.4 : 8.5;
    vr *= Math.exp(-grip * dt);

    const nfx = Math.sin(this.heading), nfz = -Math.cos(this.heading);
    const nrx = Math.cos(this.heading), nrz = Math.sin(this.heading);
    this.vx = nfx * vf + nrx * vr;
    this.vz = nfz * vf + nrz * vr;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vf = vf;
    this.drift = Math.abs(vr);
    this.braking = braking || input.handbrake;

    this.impact = 0;
    if (world) this.collide(world);
    this.speed = Math.hypot(this.vx, this.vz);

    // visual: wheels spin, body roll/pitch
    this.wheelSpin = (this.wheelSpin || 0) + vf * dt / 0.36;
    this.body += ((-yaw * vf) * 0.004 - this.body) * Math.min(1, dt * 6);
    this.pitch += ((braking ? 0.03 : thr > 0 ? -0.015 : 0) - this.pitch) * Math.min(1, dt * 5);
    this.sync();
  }

  circles() {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    const half = this.mesh.length / 2 - this.mesh.width / 2;
    const n = Math.max(2, Math.round(half / 0.9) + 1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = -half + (2 * half * i) / (n - 1);
      out.push([this.x + fx * o, this.z + fz * o]);
    }
    return out;
  }

  collide(world) {
    const R = this.mesh.width / 2 + 0.05;
    const near = world.wallsNear(this.x, this.z, this.mesh.length);
    for (let iter = 0; iter < 2; iter++) {
      for (const [cx, cz] of this.circles()) {
        for (const w of near) {
          let px, pz, rr = R;
          if (w.post) { px = w.x; pz = w.z; rr = R + w.r; }
          else {
            const dx = w.bx - w.ax, dz = w.bz - w.az;
            const l2 = dx * dx + dz * dz || 1;
            let t = ((cx - w.ax) * dx + (cz - w.az) * dz) / l2;
            t = Math.max(0, Math.min(1, t));
            px = w.ax + dx * t; pz = w.az + dz * t;
          }
          let nx = cx - px, nz = cz - pz;
          const d = Math.hypot(nx, nz);
          if (d >= rr) continue;
          if (d < 1e-4) { nx = -this.fwdX; nz = -this.fwdZ; } else { nx /= d; nz /= d; }
          const pen = rr - d;
          this.x += nx * pen; this.z += nz * pen;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.impact = Math.max(this.impact, -vn);
            this.vx -= nx * vn * 1.3; this.vz -= nz * vn * 1.3;
            this.vx *= 0.92; this.vz *= 0.92;
          }
        }
      }
    }
  }

  sync() {
    const g = this.mesh.group;
    g.position.set(this.x, 0, this.z);
    g.rotation.set(this.pitch, -this.heading, this.body, 'YXZ');
    for (const w of this.mesh.wheels) w.rotation.x = -(this.wheelSpin || 0);
    for (const p of this.mesh.steerPivots) p.rotation.y = -this.steer;
    this.mesh.brakeMat.emissiveIntensity = this.braking ? 2.5 : (this.lightsOn ? 0.8 : 0.15);
  }

  remove(scene) { scene.remove(this.mesh.group); }
}

// ----------------- traffic -----------------
const TRAFFIC_COLORS = ['#f4f4f2', '#f4f4f2', '#f4f4f2', '#c8ccd0', '#c8ccd0', '#8a9097', '#2a2d33', '#1c2c4c', '#7a1d1d', '#e9e4d6', '#3c5a7a', '#5d6b4f'];
const SPEED = { motorway: 25, trunk: 22, primary: 15, secondary: 14, tertiary: 12, residential: 9, unclassified: 9, living_street: 5, service: 6, road: 9 };

export class TrafficCar {
  constructor(scene, kind) {
    const color = kind === 'bus' ? '#f2f2ee' : kind === 'taxi' ? '#f6f6f2' : TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
    this.mesh = makeCarMesh(color, kind);
    this.kind = kind;
    scene.add(this.mesh.group);
    this.speed = 0;
    this.stunned = 0;
    this.kx = 0; this.kz = 0;
    this.wheelSpin = 0;
  }

  setOn(road, i, dir, t) {
    this.road = road; this.i = i; this.dir = dir; this.t = t;
    this.prevNode = null;
    this.computePose(true);
  }

  segLen() {
    const a = this.road.pts[this.i], b = this.road.pts[this.i + 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  // dist "t" is measured from the segment start in the direction of travel
  computePose(snap) {
    const r = this.road;
    const a = r.pts[this.i], b = r.pts[this.i + 1];
    const [s, e] = this.dir > 0 ? [a, b] : [b, a];
    const dx = e[0] - s[0], dz = e[1] - s[1];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const lane = r.oneway ? 0 : Math.min(r.width / 4, 1.9);
    const f = Math.min(1, this.t / len);
    // right-hand traffic: the right of travel direction (ux, uz) is (-uz, ux) with x east / z south
    this.x = s[0] + dx * f - uz * lane;
    this.z = s[1] + dz * f + ux * lane;
    const h = Math.atan2(ux, -uz);
    if (snap || this.heading === undefined) this.heading = h;
    else {
      let d = h - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * 0.25;
    }
  }

  // choose the next segment when reaching a node
  advanceNode(world) {
    const r = this.road;
    const nodeIdx = this.dir > 0 ? this.i + 1 : this.i;
    const nodeId = r.nodes[nodeIdx];
    const atEnd = this.dir > 0 ? nodeIdx === r.pts.length - 1 : nodeIdx === 0;
    const refs = world.nodeRefs.get(nodeId) || [];
    const options = [];
    for (const ref of refs) {
      if (!ref.road.drivable) continue;
      const n = ref.road.pts.length;
      if (ref.idx < n - 1) options.push({ road: ref.road, i: ref.idx, dir: 1 });
      if (ref.idx > 0 && !ref.road.oneway) options.push({ road: ref.road, i: ref.idx - 1, dir: -1 });
    }
    // don't go back the way we came
    const back = (o) => o.road === r && ((this.dir > 0 && o.dir < 0 && o.i === this.i) || (this.dir < 0 && o.dir > 0 && o.i === this.i));
    let choices = options.filter(o => !back(o));
    const straight = choices.find(o => o.road === r);
    let pick;
    if (!choices.length) pick = options[0] || { road: r, i: this.i, dir: -this.dir };
    else if (straight && !atEnd && Math.random() < 0.7) pick = straight;
    else {
      // prefer turns that don't involve a sharp U-turn
      const cur = this.heading;
      const scored = choices.map(o => {
        const a = o.road.pts[o.i], b = o.road.pts[o.i + 1];
        const [s, e] = o.dir > 0 ? [a, b] : [b, a];
        const h = Math.atan2(e[0] - s[0], -(e[1] - s[1]));
        const d = Math.abs(Math.atan2(Math.sin(h - cur), Math.cos(h - cur)));
        return { o, w: d > 2.5 ? 0.05 : 1 + Math.random() };
      });
      scored.sort((p, q) => q.w - p.w);
      pick = scored[0].o;
    }
    this.road = pick.road; this.i = pick.i; this.dir = pick.dir; this.t = 0;
  }

  update(dt, world, obstacles) {
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.speed = 0;
      this.kx *= Math.exp(-3 * dt); this.kz *= Math.exp(-3 * dt);
      this.ox = (this.ox || 0) + this.kx * dt; this.oz = (this.oz || 0) + this.kz * dt;
      this.sync();
      return;
    }
    const target = SPEED[this.road.type.replace('_link', '')] || 9;
    // look ahead for obstacles (other cars / the player) in our lane
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    let limit = target;
    const look = 8 + this.speed * 1.2 + this.mesh.length / 2;
    for (const o of obstacles) {
      if (o === this) continue;
      const dx = o.x - this.x, dz = o.z - this.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > look) continue;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (lat > 2.4) continue;
      const gap = along - (this.mesh.length + (o.mesh ? o.mesh.length : 4.4)) / 2 - 1.5;
      limit = Math.min(limit, Math.max(0, gap * 0.9));
    }
    // slow down a bit before the end of a segment that turns sharply
    const remain = this.segLen() - this.t;
    if (remain < 12) limit = Math.min(limit, Math.max(5, remain + 4));
    const acc = limit > this.speed ? 3 : 8;
    this.speed += Math.max(-acc * dt, Math.min(acc * dt, limit - this.speed));
    if (this.speed < 0) this.speed = 0;
    this.t += this.speed * dt;
    let guard = 0;
    while (this.t > this.segLen() && guard++ < 6) {
      const over = this.t - this.segLen();
      const r = this.road, i = this.i, d = this.dir;
      // continue along the same road if not at a junction
      const nodeIdx = d > 0 ? i + 1 : i;
      const atEnd = d > 0 ? nodeIdx === r.pts.length - 1 : nodeIdx === 0;
      if (!atEnd && !world.isJunction(r.nodes[nodeIdx])) { this.i += d; this.t = over; }
      else { this.advanceNode(world); this.t = over; }
    }
    this.wheelSpin += this.speed * dt / 0.36;
    this.ox = (this.ox || 0) * Math.exp(-0.5 * dt); this.oz = (this.oz || 0) * Math.exp(-0.5 * dt);
    this.computePose(false);
    this.sync();
  }

  sync() {
    const g = this.mesh.group;
    g.position.set(this.x + (this.ox || 0), 0, this.z + (this.oz || 0));
    g.rotation.set(0, -this.heading, 0);
    for (const w of this.mesh.wheels) w.rotation.x = -this.wheelSpin;
    this.mesh.brakeMat.emissiveIntensity = this.speed < 2 ? 2 : (this.lightsOn ? 0.8 : 0.15);
  }

  get px() { return this.x + (this.ox || 0); }
  get pz() { return this.z + (this.oz || 0); }

  remove(scene) { scene.remove(this.mesh.group); }
}

export class Traffic {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.cars = [];
    this.max = 45;
    this.night = false;
  }

  spawnNear(px, pz, minD, maxD) {
    const w = this.world;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const hit = w.nearestRoad(x, z, 60, r => r.type !== 'service' && r.type !== 'living_street');
      if (!hit) continue;
      const kind = Math.random() < 0.06 && hit.road.major ? 'bus' : Math.random() < 0.08 ? 'taxi' : 'car';
      const car = new TrafficCar(this.scene, kind);
      const dir = hit.road.oneway ? 1 : (Math.random() < 0.5 ? 1 : -1);
      const len = Math.hypot(hit.road.pts[hit.i + 1][0] - hit.road.pts[hit.i][0], hit.road.pts[hit.i + 1][1] - hit.road.pts[hit.i][1]);
      car.setOn(hit.road, hit.i, dir, (dir > 0 ? hit.t : 1 - hit.t) * len);
      // avoid spawning on top of another car
      if (this.cars.some(c => Math.hypot(c.x - car.x, c.z - car.z) < 9)) { car.remove(this.scene); continue; }
      car.speed = 5;
      car.lightsOn = this.night;
      this.cars.push(car);
      return car;
    }
    return null;
  }

  update(dt, player, extra) {
    const px = player.x, pz = player.z;
    // despawn far cars, spawn new ones out of sight
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - px, c.z - pz) > 520) { c.remove(this.scene); this.cars.splice(i, 1); }
    }
    let spawns = 0;
    while (this.cars.length < this.max && spawns++ < 3) {
      if (!this.spawnNear(px, pz, this.cars.length < 15 ? 40 : 160, 420)) break;
    }
    const obstacles = [...this.cars, player, ...extra];
    for (const c of this.cars) c.update(dt, this.world, obstacles);
  }

  setNight(n) {
    this.night = n;
    for (const c of this.cars) { c.lightsOn = n; c.mesh.headMat.emissiveIntensity = n ? 3 : 0.2; }
  }

  clear() { for (const c of this.cars) c.remove(this.scene); this.cars = []; }
}

// --------------- police AI ----------------
export class PoliceCar extends Vehicle {
  constructor(scene) {
    super(scene, '#f7f7f7', 'police');
    this.path = null; this.pathIdx = 0; this.repath = 0;
    this.stuck = 0; this.reverse = 0; this.flash = 0;
  }

  think(dt, world, target) {
    this.repath -= dt;
    const dist = Math.hypot(target.x - this.x, target.z - this.z);
    if (this.repath <= 0 && dist > 35) {
      this.repath = 1.2;
      const from = world.nearestNode(this.x, this.z), to = world.nearestNode(target.x, target.z);
      this.path = world.findPath(from, to) || null;
      this.pathIdx = 0;
    }
    let tx = target.x, tz = target.z;
    if (dist > 35 && this.path && this.path.length > 1) {
      // advance along the path to a point ~12m ahead
      while (this.pathIdx < this.path.length - 1) {
        const p = this.path[this.pathIdx];
        if (Math.hypot(p[0] - this.x, p[1] - this.z) < 12) this.pathIdx++;
        else break;
      }
      const p = this.path[this.pathIdx];
      tx = p[0]; tz = p[1];
    } else if (dist <= 35) {
      // lead the target a little
      tx += target.vx * 0.6; tz += target.vz * 0.6;
    }
    const want = Math.atan2(tx - this.x, -(tz - this.z));
    let diff = want - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const input = { throttle: 1, steer: Math.max(-1, Math.min(1, diff * 2.2)), handbrake: false };
    if (Math.abs(diff) > 1.2 && this.speed > 14) input.throttle = -0.6;
    if (dist < 8 && target.speed < 3) input.throttle = 0.15;

    // un-stick: reverse for a moment if not moving
    if (this.reverse > 0) {
      this.reverse -= dt;
      input.throttle = -1; input.steer = -input.steer;
    } else if (this.speed < 1.2 && dist > 9) {
      this.stuck += dt;
      if (this.stuck > 1.3) { this.reverse = 1.1; this.stuck = 0; }
    } else this.stuck = 0;

    this.update(dt, input, world);
    this.flash += dt;
    const on = Math.floor(this.flash * 6) % 2 === 0;
    this.mesh.sirens.blue.emissiveIntensity = on ? 4 : 0.2;
    this.mesh.sirens.red.emissiveIntensity = on ? 0.2 : 4;
  }
}
