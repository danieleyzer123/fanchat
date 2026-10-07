import * as THREE from './three.module.min.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(c, repeat = true, anisotropy = 8) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Facade: 4 windows x 4 floors per tile (12m x 12.4m). Israeli style:
// plaster walls, aluminium windows with "trisim" roller shutters, some AC units.
export function makeFacadeTextures() {
  const S = 512, cell = S / 4;
  const c = canvas(S, S), g = c.getContext('2d');
  const e = canvas(S, S), ge = e.getContext('2d');
  const r = rnd(7);
  // plaster with subtle noise (white so vertex colours tint it)
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 225 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  for (let fy = 0; fy < 4; fy++) {
    // floor slab line
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, fy * cell + cell - 6, S, 6);
    for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * cell, y0 = fy * cell;
      const wx = x0 + cell * 0.2, wy = y0 + cell * 0.22, ww = cell * 0.6, wh = cell * 0.52;
      // frame
      g.fillStyle = '#bfc4c8';
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      // glass
      const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glass.addColorStop(0, '#3d4f60');
      glass.addColorStop(1, '#1e2a36');
      g.fillStyle = glass;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(wx + 4, wy + 4, ww * 0.35, wh - 8);
      // mullion
      g.fillStyle = '#bfc4c8';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      // roller shutter (trisim) partially closed
      const shut = r();
      if (shut > 0.35) {
        const sh = wh * (shut - 0.35) / 0.65;
        g.fillStyle = '#d6d2c8';
        g.fillRect(wx, wy, ww, sh);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = wy; y < wy + sh; y += 5) g.fillRect(wx, y, ww, 1);
      }
      // AC unit under some windows
      if (r() > 0.6) {
        g.fillStyle = '#e9e9e4';
        g.fillRect(wx + ww * 0.55, wy + wh + 8, ww * 0.38, cell * 0.14);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.arc(wx + ww * 0.74, wy + wh + 8 + cell * 0.07, cell * 0.05, 0, Math.PI * 2);
        g.fill();
      }
      // night lighting
      if (r() > 0.45) {
        const warm = r() > 0.3;
        ge.fillStyle = warm ? '#ffcf7a' : '#cfe2ff';
        ge.globalAlpha = 0.55 + r() * 0.45;
        ge.fillRect(wx, wy, ww, wh * (shut > 0.35 ? 1 - (shut - 0.35) / 0.65 : 1));
        ge.globalAlpha = 1;
      }
    }
  }
  return { map: finish(c), emissive: finish(e) };
}

export function makeAsphaltTexture() {
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rnd(11);
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) {
    const v = 55 + Math.floor(r() * 45);
    g.fillStyle = `rgba(${v},${v},${v + 3},0.6)`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  // a few patches / cracks
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(30,30,32,0.25)';
    g.beginPath();
    g.ellipse(r() * S, r() * S, 10 + r() * 30, 6 + r() * 15, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

export function makeSidewalkTexture() {
  const S = 128;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rnd(3);
  g.fillStyle = '#b9b4aa';
  g.fillRect(0, 0, S, S);
  // interlocking paving stones (typical Israeli "avnei mishtalvot")
  g.strokeStyle = 'rgba(90,85,78,0.55)';
  g.lineWidth = 2;
  for (let y = 0; y < S; y += 32) {
    for (let x = 0; x < S; x += 32) {
      const v = 170 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(x + 1, y + 1, 30, 30);
      g.strokeRect(x + 1, y + 1, 30, 30);
    }
  }
  return finish(c);
}

export function makeGroundTexture() {
  const S = 512;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rnd(5);
  g.fillStyle = '#8f8b78';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 30000; i++) {
    const t = r();
    g.fillStyle = t < 0.4 ? 'rgba(120,128,90,0.35)' : t < 0.7 ? 'rgba(160,150,125,0.35)' : 'rgba(100,96,82,0.35)';
    g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3);
  }
  return finish(c);
}

export function makeGrassTexture() {
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rnd(9);
  g.fillStyle = '#5f8a3f';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 16000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? 'rgba(80,120,50,0.5)' : 'rgba(120,160,70,0.4)';
    g.fillRect(r() * S, r() * S, 1, 2 + r() * 3);
  }
  return finish(c);
}

export function makeSkyTexture(night) {
  const c = canvas(2, 256), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  if (night) {
    grad.addColorStop(0, '#05070f');
    grad.addColorStop(0.6, '#101a33');
    grad.addColorStop(1, '#2a3550');
  } else {
    grad.addColorStop(0, '#3f7fd0');
    grad.addColorStop(0.55, '#8fc0ec');
    grad.addColorStop(1, '#e6eef2');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeLabelTexture(text, opts = {}) {
  const c = canvas(256, 64), g = c.getContext('2d');
  g.fillStyle = opts.bg || '#1a5fb4';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#fff';
  g.font = 'bold 32px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.direction = 'rtl';
  g.fillText(text, 128, 34, 236);
  return finish(c, false, 4);
}
