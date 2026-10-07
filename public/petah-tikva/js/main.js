import * as THREE from './three.module.min.js';
import { loadTile, tileOf, TILE_W, TILE_H } from './osm.js';
import { World, MAP_SCALE } from './world.js';
import { Vehicle, Traffic, PoliceCar } from './cars.js';
import { CarAudio } from './audio.js';
import { makeGroundTexture } from './textures.js';
import { fallbackTile } from './fallback.js';

const $ = (id) => document.getElementById(id);

// ---------------- renderer / scene ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const DAY = { sky: new THREE.Color('#9cc7ec'), fog: new THREE.Color('#c9dbe8'), hemiSky: '#cfe6ff', hemiGround: '#8a7f6a', hemi: 0.9, sun: 2.4, sunColor: '#fff1d6' };
const NIGHT = { sky: new THREE.Color('#0b1224'), fog: new THREE.Color('#141c30'), hemiSky: '#3a4a78', hemiGround: '#1a1a22', hemi: 0.35, sun: 0.25, sunColor: '#9fb4ff' };
scene.background = DAY.sky.clone();
scene.fog = new THREE.Fog(DAY.fog.clone(), 250, 1100);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 2500);
const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 500;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);

// player headlights (night)
const headlight = new THREE.SpotLight('#fff3d0', 0, 90, 0.55, 0.5, 1.2);
scene.add(headlight, headlight.target);

const groundTex = makeGroundTexture();
groundTex.repeat.set(200, 200);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const world = new World(scene);
const traffic = new Traffic(scene, world);
const audio = new CarAudio();

const player = new Vehicle(scene, '#c8102e', 'car');
player.mesh.group.visible = false;

// mission marker + guide arrow
const markerMat = new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const marker = new THREE.Group();
marker.add(new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 60, 24, 1, true).translate(0, 30, 0), markerMat));
const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffcc33', side: THREE.DoubleSide }));
ring.position.y = 0.25;
marker.add(ring);
marker.visible = false;
scene.add(marker);
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffcc33' }));
arrow.visible = false;
scene.add(arrow);

// ---------------- state ----------------
const state = {
  started: false, paused: false, money: 0, health: 100, stars: 0,
  camMode: 0, night: false, horn: false,
  mission: null, missionCooldown: 3,
  police: [], escapeTimer: 0, bustTimer: 0, starCooldown: 0,
  fallback: false, lastStreet: '', toastT: 0
};
try { state.money = parseInt(localStorage.getItem('pt-money') || '0', 10) || 0; } catch (e) { /* ignore */ }

// ---------------- input ----------------
const keys = {};
const touch = { left: false, right: false, gas: false, brake: false, hand: false };
addEventListener('keydown', (e) => {
  if (!state.started) return;
  const k = e.key.toLowerCase();
  keys[e.code] = true;
  if (e.code === 'Escape') toggleMenu();
  if (state.paused) return;
  if (e.code === 'KeyC') state.camMode = (state.camMode + 1) % 3;
  if (e.code === 'KeyN') setNight(!state.night);
  if (e.code === 'KeyM') toggleBigMap();
  if (e.code === 'KeyR') resetToRoad();
  if (k === ' ' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

if (matchMedia('(pointer: coarse)').matches) {
  $('touch').style.display = 'block';
  for (const b of document.querySelectorAll('.tbtn')) {
    const k = b.dataset.k;
    const on = (e) => { e.preventDefault(); if (k === 'menu') { toggleMenu(); return; } touch[k] = true; b.classList.add('active'); };
    const off = (e) => { e.preventDefault(); touch[k] = false; b.classList.remove('active'); };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off, { passive: false });
    b.addEventListener('touchcancel', off, { passive: false });
  }
}

function readInput() {
  const up = keys.KeyW || keys.ArrowUp || touch.gas;
  const down = keys.KeyS || keys.ArrowDown || touch.brake;
  const left = keys.KeyA || keys.ArrowLeft || touch.left;
  const right = keys.KeyD || keys.ArrowRight || touch.right;
  state.horn = !!keys.KeyH;
  return {
    throttle: (up ? 1 : 0) - (down ? 1 : 0),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    handbrake: !!(keys.Space || touch.hand)
  };
}

// ---------------- tile streaming ----------------
const tileState = new Map(); // key -> 'loading' | 'done' | 'failed'
let inFlight = 0;

function requestTile(tx, tz) {
  const key = tx + ',' + tz;
  if (tileState.has(key)) return null;
  tileState.set(key, 'loading');
  inFlight++;
  updateLoadingLabel();
  const p = (state.fallback ? Promise.resolve(fallbackTile(tx, tz)) : loadTile(tx, tz))
    .catch((err) => {
      console.warn('OSM tile failed', key, err);
      if (!world.tiles.size) {
        state.fallback = true;
        $('fallbackNote').style.display = 'block';
      }
      return state.fallback ? fallbackTile(tx, tz) : null;
    })
    .then((data) => {
      inFlight--;
      if (data) { world.addTile(tx, tz, data); tileState.set(key, 'done'); }
      else tileState.delete(key); // retry later
      updateLoadingLabel();
      return data;
    });
  return p;
}

function updateLoadingLabel() {
  $('loading').style.display = inFlight > 0 && state.started && !$('overlay').offsetParent ? 'block' : 'none';
}

let streamT = 0;
function streamTiles(dt) {
  streamT -= dt;
  if (streamT > 0) return;
  streamT = 0.5;
  // look slightly ahead in the direction of travel
  const ax = player.x + player.vx * 4, az = player.z + player.vz * 4;
  const [cx, cz] = tileOf(ax, az);
  const wanted = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) wanted.push([cx + dx, cz + dz]);
  const [px, pz] = tileOf(player.x, player.z);
  wanted.push([px, pz]);
  wanted.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
  for (const [tx, tz] of wanted) {
    if (inFlight >= 2) break;
    requestTile(tx, tz);
  }
  world.updateVisibility(player.x, player.z);
}

// ---------------- spawning / helpers ----------------
function spawnPlayer() {
  // start on Rothschild street if it's loaded, otherwise the closest main road to the centre
  let hit = null;
  for (const name of ['רוטשילד', 'חיים עוזר', 'ברון הירש', 'סטמפר']) {
    const roads = world.namedRoads.get(name);
    if (roads && roads.length) {
      let best = null, bd = Infinity;
      for (const r of roads) for (const p of r.pts) { const d = Math.hypot(p[0], p[1]); if (d < bd) { bd = d; best = p; } }
      hit = world.nearestRoad(best[0], best[1], 5);
      if (hit) break;
    }
  }
  if (!hit) hit = world.nearestRoad(0, 0, 600, r => r.major) || world.nearestRoad(0, 0, 900);
  if (hit) player.place(hit.x, hit.z, hit.heading);
  else player.place(0, 0, 0);
  player.mesh.group.visible = true;
}

function resetToRoad() {
  const hit = world.nearestRoad(player.x, player.z, 300);
  if (hit) {
    const lane = hit.road.oneway ? 0 : Math.min(hit.road.width / 4, 1.9);
    // keep to the right-hand lane
    player.place(hit.x + Math.cos(hit.heading) * lane, hit.z + Math.sin(hit.heading) * lane, hit.heading);
  }
}

function randomRoadPoint(minD, maxD) {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
    const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
    const hit = world.nearestRoad(x, z, 80, r => r.drivable && r.name && r.type !== 'service');
    if (hit) return hit;
  }
  return null;
}

function toast(text, color) {
  const t = $('toast');
  t.textContent = text;
  t.style.color = color || '';
  t.style.opacity = 1;
  state.toastT = 2.2;
}

// ---------------- missions ----------------
function newMission() {
  const pick = randomRoadPoint(180, 550);
  if (!pick) { state.missionCooldown = 3; return; }
  state.mission = { phase: 'pickup', x: pick.x, z: pick.z, street: pick.road.name, time: 0, limit: 0 };
  marker.position.set(pick.x, 0, pick.z);
  marker.visible = true;
  audio.ding();
}

function updateMission(dt) {
  const m = state.mission;
  if (!m) {
    state.missionCooldown -= dt;
    if (state.missionCooldown <= 0) newMission();
    $('mission').style.display = 'none';
    arrow.visible = false;
    return;
  }
  const dist = Math.hypot(m.x - player.x, m.z - player.z);
  if (m.phase === 'dropoff') {
    m.time += dt;
    if (m.time > m.limit) {
      toast('הנוסע ירד. נגמר הזמן!', '#ff6b6b');
      state.mission = null; state.missionCooldown = 5; marker.visible = false;
      return;
    }
  }
  if (dist < 7 && player.speed < 4) {
    if (m.phase === 'pickup') {
      const drop = randomRoadPoint(450, 1100);
      if (!drop) return;
      const d = Math.hypot(drop.x - player.x, drop.z - player.z);
      Object.assign(m, { phase: 'dropoff', x: drop.x, z: drop.z, street: drop.road.name, time: 0, limit: Math.round(d / 8 + 35), reward: Math.round(30 + d / 12) });
      marker.position.set(drop.x, 0, drop.z);
      toast('הנוסע עלה!');
      audio.ding();
    } else {
      const bonus = Math.max(0, Math.round((m.limit - m.time) * 1.5));
      const total = m.reward + bonus;
      state.money += total;
      saveMoney();
      toast(`+₪${total}`, '#7ee07e');
      audio.ding();
      state.mission = null; state.missionCooldown = 4; marker.visible = false;
      return;
    }
  }
  const label = m.phase === 'pickup' ? 'אספו נוסע ברחוב' : 'הסיעו את הנוסע לרחוב';
  const timer = m.phase === 'dropoff' ? `<span class="timer">${Math.max(0, Math.ceil(m.limit - m.time))} שנ׳</span>` : '';
  $('mission').innerHTML = `${timer}${label} <b>${m.street}</b> · ${Math.round(dist)} מ׳`;
  $('mission').style.display = 'block';
  // floating arrow above the car pointing at the target
  arrow.visible = dist > 25;
  arrow.position.set(player.x, 3.4, player.z);
  arrow.rotation.set(0, Math.atan2(-(m.x - player.x), -(m.z - player.z)), 0);
  marker.children[1].scale.setScalar(1 + Math.sin(performance.now() / 200) * 0.06);
}

function saveMoney() { try { localStorage.setItem('pt-money', String(state.money)); } catch (e) { /* ignore */ } }

// ---------------- wanted level / police ----------------
function addStar() {
  if (state.starCooldown > 0) return;
  state.starCooldown = 2.5;
  state.stars = Math.min(4, state.stars + 1);
  state.escapeTimer = 0;
}

function spawnPolice() {
  const hit = randomRoadPoint(140, 260);
  if (!hit) return;
  const p = new PoliceCar(scene);
  p.place(hit.x, hit.z, Math.atan2(player.x - hit.x, -(player.z - hit.z)));
  p.mesh.headMat.emissiveIntensity = state.night ? 3 : 0.2;
  state.police.push(p);
}

function clearPolice() {
  for (const p of state.police) p.remove(scene);
  state.police = [];
}

function updatePolice(dt) {
  state.starCooldown -= dt;
  const want = state.stars === 0 ? 0 : Math.min(4, state.stars);
  if (state.police.length < want && Math.random() < dt * 0.8) spawnPolice();
  let nearest = Infinity;
  for (const p of state.police) {
    p.think(dt, world, player);
    nearest = Math.min(nearest, Math.hypot(p.x - player.x, p.z - player.z));
  }
  // police vs player bump
  for (const p of state.police) resolveCarCar(player, p, true);
  for (let i = 0; i < state.police.length; i++) for (let j = i + 1; j < state.police.length; j++) resolveCarCar(state.police[i], state.police[j], true);

  if (state.stars > 0) {
    if (nearest > 110) {
      state.escapeTimer += dt;
      if (state.escapeTimer > 12) {
        state.stars--; state.escapeTimer = 0;
        if (state.stars === 0) { clearPolice(); toast('ברחת מהמשטרה!', '#7ee07e'); }
      }
    } else state.escapeTimer = 0;
    // busted?
    if (nearest < 8 && player.speed < 2.5) {
      state.bustTimer += dt;
      if (state.bustTimer > 2) {
        const fine = Math.round(state.money * 0.2) + 50;
        state.money = Math.max(0, state.money - fine); saveMoney();
        toast(`נעצרת! קנס ₪${fine}`, '#6fa8ff');
        state.stars = 0; state.bustTimer = 0; clearPolice();
      }
    } else state.bustTimer = 0;
  } else if (state.police.length) clearPolice();
  // far-away police get respawned closer
  for (let i = state.police.length - 1; i >= 0; i--) {
    if (Math.hypot(state.police[i].x - player.x, state.police[i].z - player.z) > 600) { state.police[i].remove(scene); state.police.splice(i, 1); }
  }
  return nearest;
}

// circle-vs-circle collision between two dynamic vehicles
function resolveCarCar(a, b, bothDynamic) {
  const ac = a.circles(), bc = b.circles();
  const R = (a.mesh.width + b.mesh.width) / 2;
  let hit = 0;
  for (const [ax, az] of ac) for (const [bx, bz] of bc) {
    let nx = ax - bx, nz = az - bz;
    const d = Math.hypot(nx, nz);
    if (d >= R || d < 1e-4) continue;
    nx /= d; nz /= d;
    const pen = R - d;
    const rv = (a.vx - (b.vx || 0)) * nx + (a.vz - (b.vz || 0)) * nz;
    if (bothDynamic) {
      a.x += nx * pen / 2; a.z += nz * pen / 2; b.x -= nx * pen / 2; b.z -= nz * pen / 2;
      if (rv < 0) {
        a.vx -= nx * rv * 0.6; a.vz -= nz * rv * 0.6;
        b.vx += nx * rv * 0.6; b.vz += nz * rv * 0.6;
        hit = Math.max(hit, -rv);
      }
    }
  }
  return hit;
}

// player vs kinematic traffic
function collideTraffic() {
  const pc = player.circles();
  for (const c of traffic.cars) {
    if (Math.abs(c.px - player.x) > 14 || Math.abs(c.pz - player.z) > 14) continue;
    const fx = Math.sin(c.heading), fz = -Math.cos(c.heading);
    const half = c.mesh.length / 2 - c.mesh.width / 2;
    const n = Math.max(2, Math.round(half / 0.9) + 1);
    const R = (player.mesh.width + c.mesh.width) / 2;
    const cvx = fx * c.speed, cvz = fz * c.speed;
    let struck = 0;
    for (let i = 0; i < n; i++) {
      const o = -half + (2 * half * i) / (n - 1);
      const bx = c.px + fx * o, bz = c.pz + fz * o;
      for (const [ax, az] of pc) {
        let nx = ax - bx, nz = az - bz;
        const d = Math.hypot(nx, nz);
        if (d >= R || d < 1e-4) continue;
        nx /= d; nz /= d;
        const pen = R - d;
        player.x += nx * pen; player.z += nz * pen;
        const rv = (player.vx - cvx) * nx + (player.vz - cvz) * nz;
        if (rv < 0) {
          player.vx -= nx * rv * 1.2; player.vz -= nz * rv * 1.2;
          struck = Math.max(struck, -rv);
          if (c.kind !== 'bus') { c.kx += -nx * -rv * 0.6; c.kz += -nz * -rv * 0.6; }
        }
      }
    }
    if (struck > 2) {
      c.stunned = Math.max(c.stunned, 2.5 + Math.random() * 2);
      onImpact(struck);
      if (struck > 7) addStar();
    }
  }
  player.sync();
}

function onImpact(strength) {
  if (strength < 3) return;
  audio.crash(strength);
  shake = Math.min(1, shake + strength * 0.04);
  if (strength > 7) {
    state.health = Math.max(0, state.health - (strength - 6) * 2.2);
    if (state.health <= 0) {
      toast('הרכב התרסק!', '#ff6b6b');
      state.health = 100;
      state.money = Math.max(0, state.money - 100); saveMoney();
      state.stars = 0; clearPolice();
      resetToRoad();
    }
  }
}

// ---------------- day / night ----------------
function setNight(n) {
  state.night = n;
  const P = n ? NIGHT : DAY;
  scene.background.copy(P.sky);
  scene.fog.color.copy(P.fog);
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemi;
  sun.color.set(P.sunColor); sun.intensity = P.sun;
  headlight.intensity = n ? 60 : 0;
  player.lightsOn = n;
  player.mesh.headMat.emissiveIntensity = n ? 4 : 0.2;
  world.setNight(n);
  traffic.setNight(n);
  for (const p of state.police) p.mesh.headMat.emissiveIntensity = n ? 3 : 0.2;
}

// ---------------- camera ----------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let shake = 0;
function updateCamera(dt, snap) {
  const fx = Math.sin(player.heading), fz = -Math.cos(player.heading);
  // follow the velocity direction a bit for a nicer drift camera
  let dirx = fx, dirz = fz;
  if (player.speed > 3) {
    const vx = player.vx / player.speed, vz = player.vz / player.speed;
    const dot = vx * fx + vz * fz;
    if (dot > 0) { dirx = fx * 0.6 + vx * 0.4; dirz = fz * 0.6 + vz * 0.4; }
  }
  const dl = Math.hypot(dirx, dirz) || 1; dirx /= dl; dirz /= dl;
  let back, up, lookAhead, lookUp;
  if (state.camMode === 0) { back = 8 + player.speed * 0.06; up = 3.3; lookAhead = 4; lookUp = 1.2; }
  else if (state.camMode === 1) { back = 15; up = 7; lookAhead = 6; lookUp = 0.5; }
  else { back = -0.4; up = 1.35; lookAhead = 20; lookUp = 1.0; }
  const target = new THREE.Vector3(player.x - dirx * back, up, player.z - dirz * back);
  const k = snap || state.camMode === 2 ? 1 : 1 - Math.exp(-dt * 6);
  camPos.lerp(target, k);
  if (state.camMode === 2) camPos.copy(target);
  camera.position.copy(camPos);
  camLook.set(player.x + fx * lookAhead, lookUp, player.z + fz * lookAhead);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.lookAt(camLook);
  const fov = 62 + Math.min(18, player.speed * 0.3);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  player.mesh.group.visible = state.camMode !== 2;
}

// ---------------- minimap / big map ----------------
const mm = $('minimap'), mmg = mm.getContext('2d');
function drawMap(g, W, H, cx, cz, scale, rot, extras) {
  g.save();
  g.fillStyle = '#1e2228';
  g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2);
  g.rotate(rot);
  g.scale(scale / MAP_SCALE, scale / MAP_SCALE);
  g.translate(-cx * MAP_SCALE, -cz * MAP_SCALE);
  const viewR = Math.hypot(W, H) / 2 / scale;
  for (const t of world.tiles.values()) {
    const x0 = t.tx * TILE_W, z0 = t.tz * TILE_H;
    if (x0 > cx + viewR || x0 + TILE_W < cx - viewR || z0 > cz + viewR || z0 + TILE_H < cz - viewR) continue;
    g.drawImage(t.mapCanvas, x0 * MAP_SCALE, z0 * MAP_SCALE, TILE_W * MAP_SCALE + 0.5, TILE_H * MAP_SCALE + 0.5);
  }
  const dot = (x, z, color, r) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x * MAP_SCALE, z * MAP_SCALE, r * MAP_SCALE / scale, 0, Math.PI * 2);
    g.fill();
  };
  if (extras) {
    if (state.mission) dot(state.mission.x, state.mission.z, '#ffcc33', 9);
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const p of state.police) dot(p.x, p.z, blink ? '#3d6bff' : '#ff3d3d', 6);
  }
  g.restore();
}

function drawPlayerArrow(g, x, y, angle, size) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = '#ff3b3b';
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -size); g.lineTo(size * 0.7, size * 0.8); g.lineTo(0, size * 0.4); g.lineTo(-size * 0.7, size * 0.8);
  g.closePath(); g.fill(); g.stroke();
  g.restore();
}

function updateMinimap() {
  const W = mm.width, H = mm.height;
  const scale = 0.9 - Math.min(0.45, player.speed * 0.008); // zoom out with speed
  drawMap(mmg, W, H, player.x, player.z, scale, -player.heading, true);
  // mission target off-screen indicator
  if (state.mission) {
    const dx = state.mission.x - player.x, dz = state.mission.z - player.z;
    const a = Math.atan2(dx, -dz) - player.heading;
    const d = Math.hypot(dx, dz) * scale;
    if (d > W / 2 - 14) {
      const r = W / 2 - 16;
      mmg.fillStyle = '#ffcc33';
      mmg.beginPath();
      mmg.arc(W / 2 + Math.sin(a) * r, H / 2 - Math.cos(a) * r, 9, 0, Math.PI * 2);
      mmg.fill();
    }
  }
  drawPlayerArrow(mmg, W / 2, H / 2, 0, 12);
  // keep the north letter on the rim, rotated with the map
  const c = $('compass');
  const ang = -player.heading;
  c.style.left = `calc(50% + ${Math.sin(ang) * (mm.clientWidth / 2 - 12)}px)`;
  c.style.top = `calc(50% - ${Math.cos(ang) * (mm.clientWidth / 2 - 12) + 9}px)`;
}

const bigmap = $('bigmap'), bmc = $('bigmapCanvas');
let bigScale = 0.25;
function toggleBigMap(force) {
  const show = force !== undefined ? force : bigmap.style.display !== 'block';
  bigmap.style.display = show ? 'block' : 'none';
  if (show) { bmc.width = bmc.clientWidth; bmc.height = bmc.clientHeight; renderBigMap(); }
}
function renderBigMap() {
  if (bigmap.style.display !== 'block') return;
  const g = bmc.getContext('2d');
  drawMap(g, bmc.width, bmc.height, player.x, player.z, bigScale, 0, true);
  drawPlayerArrow(g, bmc.width / 2, bmc.height / 2, player.heading, 12);
}
bmc.addEventListener('wheel', (e) => { e.preventDefault(); bigScale = Math.max(0.06, Math.min(1.5, bigScale * (e.deltaY > 0 ? 0.85 : 1.18))); renderBigMap(); }, { passive: false });
bmc.addEventListener('click', (e) => {
  const r = bmc.getBoundingClientRect();
  const x = player.x + (e.clientX - r.left - r.width / 2) / bigScale;
  const z = player.z + (e.clientY - r.top - r.height / 2) / bigScale;
  teleportTo(x, z);
  toggleBigMap(false);
});

function teleportTo(x, z) {
  const hit = world.nearestRoad(x, z, 400);
  if (hit) { player.place(hit.x, hit.z, hit.heading); }
  else { player.place(x, z, player.heading); }
  updateCamera(0, true);
  state.stars = 0; clearPolice();
  traffic.clear();
}

// ---------------- menu ----------------
function toggleMenu() {
  state.paused = !state.paused;
  $('menu').style.display = state.paused ? 'flex' : 'none';
  if (state.paused) fillTeleport();
}
function fillTeleport() {
  const sel = $('teleport');
  const names = [...world.namedRoads.keys()].sort((a, b) => a.localeCompare(b, 'he'));
  sel.innerHTML = '<option value="">בחרו רחוב...</option>' + names.map(n => `<option>${n.replace(/</g, '&lt;')}</option>`).join('');
}
$('teleport').addEventListener('change', (e) => {
  const roads = world.namedRoads.get(e.target.value);
  if (!roads) return;
  const r = roads[Math.floor(roads.length / 2)];
  const p = r.pts[Math.floor(r.pts.length / 2)];
  teleportTo(p[0], p[1]);
  toggleMenu();
});
$('btnResume').onclick = toggleMenu;
$('btnNight').onclick = () => setNight(!state.night);
$('btnCam').onclick = () => { state.camMode = (state.camMode + 1) % 3; };
$('btnMute').onclick = () => { audio.setMuted(!audio.muted); $('btnMute').textContent = audio.muted ? 'הפעל קול' : 'השתק'; };
$('btnMap').onclick = () => { toggleMenu(); toggleBigMap(true); };

// ---------------- HUD ----------------
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  if (state.toastT > 0) { state.toastT -= dt; if (state.toastT <= 0) $('toast').style.opacity = 0; }
  if (hudT > 0) return;
  hudT = 0.1;
  $('speed').textContent = Math.round(player.speed * 3.6);
  $('money').textContent = '₪' + state.money.toLocaleString('he-IL');
  const stars = $('stars').children;
  for (let i = 0; i < stars.length; i++) stars[i].className = i < state.stars ? 'on' : '';
  $('health').firstElementChild.style.width = state.health + '%';
  const hit = world.nearestRoad(player.x, player.z, 25);
  const name = hit ? (hit.road.name || (hit.road.type === 'service' ? 'דרך שירות' : 'רחוב ללא שם')) : '';
  if (name !== state.lastStreet) { state.lastStreet = name; $('streetName').textContent = name; }
  renderBigMap();
}

// ---------------- main loop ----------------
let last = performance.now();
let ready = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!ready) { renderer.render(scene, camera); return; }
  streamTiles(dt);
  if (!state.paused) {
    // fixed sub-steps keep collisions stable at high speed
    const steps = Math.ceil(dt / 0.0167);
    const h = dt / steps;
    const input = readInput();
    for (let i = 0; i < steps; i++) player.update(h, input, world);
    if (player.impact) onImpact(player.impact);
    traffic.update(dt, player, state.police);
    collideTraffic();
    const policeDist = updatePolice(dt);
    updateMission(dt);
    audio.update(dt, { speed: player.speed, throttle: input.throttle, drift: player.drift, horn: state.horn, sirenDist: state.police.length ? policeDist : null });
    updateHUD(dt);
  }
  updateCamera(dt, false);
  // shadows + headlights follow the player
  sun.position.set(player.x + 90, 160, player.z + 50);
  sun.target.position.set(player.x, 0, player.z);
  const fx = Math.sin(player.heading), fz = -Math.cos(player.heading);
  headlight.position.set(player.x + fx * 2, 1.0, player.z + fz * 2);
  headlight.target.position.set(player.x + fx * 30, 0, player.z + fz * 30);
  ground.position.set(Math.round(player.x / 40) * 40, 0, Math.round(player.z / 40) * 40);
  updateMinimap();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (bigmap.style.display === 'block') { bmc.width = bmc.clientWidth; bmc.height = bmc.clientHeight; }
});

// ---------------- start ----------------
$('btnStart').onclick = async () => {
  audio.start();
  $('btnStart').disabled = true;
  $('btnStart').style.display = 'none';
  $('progress').style.display = 'block';
  const bar = $('progress').firstElementChild;
  $('status').textContent = 'מוריד את מפת פתח תקווה מ־OpenStreetMap...';
  bar.style.width = '15%';
  // load the centre tile first, then its neighbours
  await requestTile(0, 0);
  bar.style.width = '55%';
  if (state.fallback) $('status').textContent = 'שרתי המפה לא זמינים, אז נטענת מפה סכמטית...';
  else $('status').textContent = 'בונה רחובות ובניינים...';
  const neighbours = [[-1, 0], [0, -1], [1, 0], [0, 1]];
  await Promise.all(neighbours.slice(0, 2).map(([x, z]) => requestTile(x, z)));
  bar.style.width = '100%';
  spawnPlayer();
  if (state.fallback) $('fallbackNote').style.display = 'block';
  updateCamera(0, true);
  ready = true;
  state.started = true;
  $('overlay').style.display = 'none';
  toast('ברוכים הבאים לפתח תקווה!');
  setTimeout(() => { $('help').style.opacity = 0.35; }, 12000);
};
