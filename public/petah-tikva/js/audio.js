// Procedural car audio with WebAudio (engine, tyre screech, crash, horn, siren).
export class CarAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // engine: two detuned saws through a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.engFilter); this.osc2.connect(g2); g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // noise source for screech / crash
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    this.skidFilter = ctx.createBiquadFilter(); this.skidFilter.type = 'bandpass'; this.skidFilter.frequency.value = 2200; this.skidFilter.Q.value = 3;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    n.connect(this.skidFilter); this.skidFilter.connect(this.skidGain); this.skidGain.connect(this.master);
    n.start();

    // siren
    this.siren = ctx.createOscillator(); this.siren.type = 'triangle'; this.siren.frequency.value = 700;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.siren.start();

    // horn
    this.horn1 = ctx.createOscillator(); this.horn1.type = 'square'; this.horn1.frequency.value = 415;
    this.horn2 = ctx.createOscillator(); this.horn2.type = 'square'; this.horn2.frequency.value = 523;
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    this.horn1.connect(hf); this.horn2.connect(hf); hf.connect(this.hornGain); this.hornGain.connect(this.master);
    this.horn1.start(); this.horn2.start();
    this.sirenT = 0;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  update(dt, { speed, throttle, drift, horn, sirenDist }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // fake gearbox: rpm rises within each gear
    const gears = [0, 9, 17, 26, 36, 47, 70];
    let g = 1;
    while (g < gears.length - 1 && speed > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const frac = Math.min(1, (speed - lo) / (hi - lo));
    const rpm = 900 + frac * 4800 + (throttle > 0 ? 400 : 0);
    const f = rpm / 60 * 1.0;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5 + 1, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(400 + rpm * 0.25 + (throttle > 0 ? 500 : 0), t, 0.08);
    this.engGain.gain.setTargetAtTime(0.10 + (throttle > 0 ? 0.08 : 0.02) + Math.min(0.06, speed * 0.002), t, 0.1);
    this.skidGain.gain.setTargetAtTime(drift > 4 && speed > 6 ? Math.min(0.25, (drift - 4) * 0.04) : 0, t, 0.05);
    this.hornGain.gain.setTargetAtTime(horn ? 0.12 : 0, t, 0.02);
    // two-tone police siren, louder when close
    this.sirenT += dt;
    if (sirenDist != null && sirenDist < 400) {
      this.siren.frequency.setTargetAtTime(Math.floor(this.sirenT * 1.6) % 2 ? 960 : 720, t, 0.05);
      this.sirenGain.gain.setTargetAtTime(Math.max(0, 0.13 * (1 - sirenDist / 400)), t, 0.1);
    } else this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
  }

  crash(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    const v = Math.min(0.9, 0.15 + strength * 0.04);
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + 0.55);
  }

  ding() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [880, 1320].forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 0.45);
    });
  }
}
