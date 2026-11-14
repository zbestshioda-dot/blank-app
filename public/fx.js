'use strict';
// Sound (synthesised with Web Audio, no files to download) + visual effects.
window.FX = (() => {
  // ------------------------------------------------------------------ settings
  const st = { sfx: true, music: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem('lt_audio') || '{}')); } catch { }
  const save = () => { try { localStorage.setItem('lt_audio', JSON.stringify(st)); } catch { } };

  // ------------------------------------------------------------------ audio graph
  let ac = null, master, sfxBus, musicBus, noiseBuf;
  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = st.sfx ? 0.55 : 0; sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = st.music ? 0.16 : 0; musicBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
    return ac;
  }
  // browsers only allow audio after a user gesture
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => addEventListener(e, ensure, { passive: true }));

  function tone(freq, dur, o = {}) {
    if (!ac) return;
    const t = ac.currentTime + (o.at || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const v = o.vol ?? 0.3, a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(dur, o = {}) {
    if (!ac) return;
    const t = ac.currentTime + (o.at || 0);
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ac.createGain(), v = o.vol ?? 0.2;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ sound effects
  const N = { C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, B5: 988, C6: 1047, E6: 1319, G6: 1568 };
  const SFX = {
    coin(big) {
      tone(N.B5, 0.09, { type: 'square', vol: 0.12 });
      tone(N.E6, 0.28, { type: 'square', vol: 0.12, at: 0.07 });
      if (big) { tone(N.G6, 0.35, { type: 'triangle', vol: 0.15, at: 0.15 }); tone(N.C6 * 2, 0.4, { vol: 0.08, at: 0.22 }); }
    },
    spend() { tone(660, 0.07, { type: 'triangle', vol: 0.08 }); tone(440, 0.1, { type: 'triangle', vol: 0.08, at: 0.05 }); },
    fail() { tone(220, 0.18, { type: 'square', vol: 0.07, slide: 140 }); },
    pop() { tone(500, 0.08, { vol: 0.2, slide: 950 }); },
    click() { tone(1400, 0.03, { vol: 0.05 }); },
    step(kind) {
      if (kind === 'p') { tone(170 + Math.random() * 30, 0.06, { type: 'triangle', vol: 0.07 }); return; }
      noise(0.05, { freq: kind === '=' || kind === ',' ? 2600 : 900, q: 1.5, vol: kind === 's' ? 0.05 : 0.035 });
    },
    levelup() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.18, at: i * 0.09 })); tone(N.E6, 0.6, { vol: 0.1, at: 0.36 }); },
    chime() { [N.G5, N.C6, N.E6].forEach((f, i) => tone(f, 0.7, { vol: 0.14, at: i * 0.08, attack: 0.01 })); },
    ding() { tone(N.C6, 0.25, { vol: 0.18 }); tone(N.E6, 0.45, { vol: 0.16, at: 0.12 }); },
    bite() { for (let i = 0; i < 3; i++) tone(N.A5, 0.07, { type: 'square', vol: 0.12, at: i * 0.1 }); noise(0.3, { filter: 'lowpass', freq: 1500, sweep: 300, vol: 0.25, at: 0.05 }); },
    splash() { noise(0.45, { filter: 'lowpass', freq: 2500, sweep: 250, vol: 0.3 }); tone(300, 0.15, { vol: 0.08, slide: 120 }); },
    sizzle() { noise(0.6, { filter: 'highpass', freq: 3500, vol: 0.12 }); noise(0.4, { filter: 'highpass', freq: 5000, vol: 0.08, at: 0.2 }); },
    munch() { for (let i = 0; i < 3; i++) noise(0.06, { freq: 700, q: 2, vol: 0.18, at: i * 0.13 }); },
    sleep() { tone(392, 0.6, { vol: 0.08, attack: 0.1 }); tone(330, 0.8, { vol: 0.08, at: 0.3, attack: 0.1 }); },
    heal() { [N.E5, N.A5, N.C6].forEach((f, i) => tone(f, 0.4, { vol: 0.1, at: i * 0.1, attack: 0.02 })); },
    notice() { tone(N.G5, 0.12, { vol: 0.06 }); tone(N.C6, 0.2, { vol: 0.06, at: 0.08 }); },
    whoosh() { noise(0.25, { freq: 400, sweep: 2500, q: 0.7, vol: 0.12 }); },
  };
  function play(name, arg) { if (!st.sfx) return; ensure(); try { SFX[name] && SFX[name](arg); } catch { } }

  // ------------------------------------------------------------------ background music
  // gentle generative tune: a 4-chord pad loop with random pentatonic plucks
  let musicTimer = null, beat = 0, nextAt = 0;
  const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const PENTA = [523.3, 587.3, 659.3, 784, 880, 1046.5];
  function startMusic() {
    if (musicTimer || !ac) return;
    nextAt = ac.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!st.music || ac.state !== 'running') { nextAt = ac.currentTime + 0.1; return; }
      while (nextAt < ac.currentTime + 0.6) {
        const at = nextAt - ac.currentTime, chord = CHORDS[Math.floor(beat / 8) % CHORDS.length];
        if (beat % 8 === 0) chord.forEach(f => tone(f / 2, 4.2, { type: 'sine', vol: 0.35, at, attack: 0.6, dest: musicBus }));
        if (beat % 2 === 0) tone(chord[0] / 4, 0.5, { type: 'triangle', vol: 0.25, at, dest: musicBus });
        if (Math.random() < 0.45) tone(PENTA[Math.floor(Math.random() * PENTA.length)], 0.6, { type: 'triangle', vol: 0.18, at, attack: 0.01, dest: musicBus });
        nextAt += 0.5; beat++;
      }
    }, 200);
  }
  function setOpt(k, v) {
    st[k] = v; save(); ensure();
    if (!ac) return;
    const t = ac.currentTime;
    if (k === 'sfx') sfxBus.gain.setTargetAtTime(v ? 0.55 : 0, t, 0.05);
    if (k === 'music') musicBus.gain.setTargetAtTime(v ? 0.16 : 0, t, 0.3);
  }

  // ------------------------------------------------------------------ visual effects (world coordinates in tiles)
  const list = [];
  const now = () => performance.now();
  function float(x, y, text, color = '#ffe28a', size = 0.42) { list.push({ k: 'text', x, y, text, color, size, t0: now(), dur: 1400 }); }
  function burst(x, y, color = '#ffd34d', n = 10) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2.5; list.push({ k: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, color, t0: now(), dur: 650 + Math.random() * 300 }); }
  }
  function ring(x, y, color = '#ffffff', dur = 700, max = 1.2) { list.push({ k: 'ring', x, y, color, t0: now(), dur, max }); }
  function dust(x, y) { list.push({ k: 'dust', x: x + (Math.random() - .5) * .2, y: y + .25, t0: now(), dur: 450 }); }
  function draw(g, X, Y, TS) {
    const t = now();
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], p = (t - e.t0) / e.dur;
      if (p >= 1) { list.splice(i, 1); continue; }
      const sx = e.x * TS + X, sy = e.y * TS + Y;
      g.save();
      if (e.k === 'text') {
        g.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
        g.font = `800 ${Math.round(TS * e.size)}px 'Noto Sans Thai',sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const yy = sy - TS * (0.9 + p * 1.1);
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(e.text, sx, yy); g.fillStyle = e.color; g.fillText(e.text, sx, yy);
      } else if (e.k === 'p') {
        const s = (t - e.t0) / 1000;
        g.globalAlpha = 1 - p; g.fillStyle = e.color;
        g.beginPath(); g.arc(sx + e.vx * s * TS * .5, sy + (e.vy * s + 4 * s * s) * TS * .5, TS * .07, 0, 7); g.fill();
      } else if (e.k === 'ring') {
        g.globalAlpha = 1 - p; g.strokeStyle = e.color; g.lineWidth = 3;
        g.beginPath(); g.ellipse(sx, sy, TS * e.max * p, TS * e.max * p * .55, 0, 0, 7); g.stroke();
      } else if (e.k === 'dust') {
        g.globalAlpha = (1 - p) * .35; g.fillStyle = '#e9e2cc';
        g.beginPath(); g.arc(sx, sy, TS * (.06 + p * .12), 0, 7); g.fill();
      }
      g.restore();
    }
  }

  return { play, float, burst, ring, dust, draw, opts: st, setOpt, ensure };
})();
