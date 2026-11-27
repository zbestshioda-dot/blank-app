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
  // game audio mixes with other apps (YouTube, Spotify) instead of taking over, and stops while the game is in the background
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { }
  document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend().catch(() => { }); else ac.resume().catch(() => { }); });

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
  // signature voice: ระนาดเอก (wooden bar: short body + inharmonic bar partials + mallet click), tuned to the Thai 7-equal scale
  const T = k => 523 * 2 ** (k / 7);   // Thai step k above C5 (each step ~171 cents, not western)
  function ranat(f, at = 0, v = 1) {
    tone(f, 0.26, { type: 'triangle', vol: 0.16 * v, at, attack: 0.002 });
    tone(f * 2.76, 0.07, { vol: 0.05 * v, at, attack: 0.001 });
    tone(f * 5.4, 0.03, { vol: 0.025 * v, at, attack: 0.001 });
    noise(0.018, { filter: 'highpass', freq: 3500, vol: 0.09 * v, at });
  }
  // กรอ: fast octave roll like a ranat player ending a phrase
  function roll(f, at, n = 7, v = 1) { for (let i = 0; i < n; i++) ranat(i % 2 ? f / 2 : f, at + i * 0.045, v * (1 - i / (n + 2))); }
  const SFX = {
    coin(big) {
      ranat(T(4), 0, .8); ranat(T(9), 0.07);
      if (big) roll(T(11), 0.16, 6, .8);
    },
    spend() { tone(660, 0.07, { type: 'triangle', vol: 0.08 }); tone(440, 0.1, { type: 'triangle', vol: 0.08, at: 0.05 }); },
    fail() { tone(220, 0.18, { type: 'square', vol: 0.07, slide: 140 }); },
    pop() { tone(500, 0.08, { vol: 0.2, slide: 950 }); },
    click() { ranat(T(14), 0, .25); },
    step(kind) {
      if (kind === 'p') { tone(170 + Math.random() * 30, 0.06, { type: 'triangle', vol: 0.07 }); return; }
      noise(0.05, { freq: kind === '=' || kind === ',' ? 2600 : 900, q: 1.5, vol: kind === 's' ? 0.05 : 0.035 });
    },
    // the game's signature motif "ติง ติง ตะ-ติ๊ง แล้วกรอ": same 4 notes every level-up / quest / achievement so players learn it
    levelup() { [T(2), T(4), T(7), T(9)].forEach((f, i) => ranat(f, i * (i === 3 ? 0.1 : 0.085))); roll(T(14), 0.38, 8); tone(T(14), 0.9, { vol: 0.06, at: 0.4, attack: 0.05 }); },
    chime() { [T(4), T(7), T(11)].forEach((f, i) => ranat(f, i * 0.09, .8)); },
    bell(k = 1) {   // big temple bell: low gong with slow-beating partials and a long tail (k: loudness, <1 = far away)
      [[98, .3], [196.5, .16], [262, .1], [331, .07], [494, .04]].forEach(([f, v]) => { tone(f, 4.2, { vol: v * k, attack: 0.004 }); tone(f * 1.006, 3.6, { vol: v * .5 * k, attack: 0.004 }); });
      noise(0.08, { filter: 'lowpass', freq: 900, vol: 0.18 * k });
    },
    pray() { [N.C5, N.G5].forEach((f, i) => tone(f, 1.6, { vol: 0.1, at: i * 0.25, attack: 0.05 })); },
    ding() { ranat(T(7), 0); ranat(T(11), 0.12); },
    bite() { for (let i = 0; i < 3; i++) tone(N.A5, 0.07, { type: 'square', vol: 0.12, at: i * 0.1 }); noise(0.3, { filter: 'lowpass', freq: 1500, sweep: 300, vol: 0.25, at: 0.05 }); },
    alarm() { for (let i = 0; i < 4; i++) { tone(620, 0.32, { type: 'sawtooth', vol: 0.07, at: i * 0.6, slide: 880 }); tone(880, 0.26, { type: 'sawtooth', vol: 0.07, at: i * 0.6 + 0.32, slide: 620 }); } },
    groan() { tone(140 + Math.random() * 40, 0.9, { type: 'sawtooth', vol: 0.05, slide: 85, attack: 0.15 }); noise(0.7, { filter: 'lowpass', freq: 500, sweep: 200, vol: 0.06, at: 0.1 }); },
    zbite() { noise(0.18, { filter: 'lowpass', freq: 1800, sweep: 400, vol: 0.3 }); tone(160, 0.35, { type: 'square', vol: 0.08, slide: 60, at: 0.05 }); },
    splash() { noise(0.45, { filter: 'lowpass', freq: 2500, sweep: 250, vol: 0.3 }); tone(300, 0.15, { vol: 0.08, slide: 120 }); },
    sizzle() { noise(0.6, { filter: 'highpass', freq: 3500, vol: 0.12 }); noise(0.4, { filter: 'highpass', freq: 5000, vol: 0.08, at: 0.2 }); },
    munch() { for (let i = 0; i < 3; i++) noise(0.06, { freq: 700, q: 2, vol: 0.18, at: i * 0.13 }); },
    sleep() { tone(392, 0.6, { vol: 0.08, attack: 0.1 }); tone(330, 0.8, { vol: 0.08, at: 0.3, attack: 0.1 }); },
    heal() { [N.E5, N.A5, N.C6].forEach((f, i) => tone(f, 0.4, { vol: 0.1, at: i * 0.1, attack: 0.02 })); },
    notice() { ranat(T(4), 0, .45); ranat(T(7), 0.08, .45); },
    // pet voices: arg = [kind, volume scale]; each kind is a few short synthesised notes with a little random pitch so it never sounds the same twice
    pet(arg) {
      const [k, v = 1] = Array.isArray(arg) ? arg : [arg], r = 1 + (Math.random() - .5) * .14;
      if (k === 'dog') { tone(520 * r, 0.09, { type: 'sawtooth', vol: .09 * v, slide: 330 }); noise(0.08, { freq: 900, q: 1.2, vol: .07 * v }); tone(560 * r, 0.1, { type: 'sawtooth', vol: .08 * v, slide: 340, at: 0.14 }); }
      else if (k === 'bigdog') { tone(260 * r, 0.14, { type: 'sawtooth', vol: .1 * v, slide: 170 }); noise(0.1, { freq: 500, q: 1, vol: .07 * v }); }
      else if (k === 'cat') { tone(560 * r, 0.14, { vol: .1 * v, slide: 900, attack: .03 }); tone(900 * r, 0.3, { vol: .1 * v, slide: 520, at: 0.13, attack: .02 }); }
      else if (k === 'bird') { for (let i = 0; i < 2; i++) tone(2100 * r, 0.06, { type: 'triangle', vol: .08 * v, slide: 2900, at: i * 0.09 }); }
      else if (k === 'duck') { for (let i = 0; i < 2; i++) { tone(430 * r, 0.1, { type: 'square', vol: .05 * v, slide: 330, at: i * 0.14 }); noise(0.09, { freq: 1200, q: 2, vol: .05 * v, at: i * 0.14 }); } }
      else if (k === 'squeak') { tone(1500 * r, 0.07, { vol: .08 * v, slide: 2300 }); tone(1800 * r, 0.06, { vol: .07 * v, slide: 2400, at: 0.09 }); }
      else if (k === 'low') { tone(160 * r, 0.25, { type: 'triangle', vol: .12 * v, slide: 210, attack: .04 }); }
      else if (k === 'magic') { [N.E6, N.G6, N.C6 * 2].forEach((f, i) => tone(f * r, 0.3, { vol: .07 * v, at: i * 0.07 })); }
      else if (k === 'roar') { tone(200 * r, 0.3, { type: 'sawtooth', vol: .08 * v, slide: 120 }); tone(900 * r, 0.12, { vol: .05 * v, slide: 1500, at: 0.05 }); }
      else tone(900 * r, 0.1, { vol: .08 * v, slide: 1300 });
    },
    chop() { noise(0.04, { freq: 1800, q: 3, vol: 0.12 }); tone(240, 0.05, { type: 'triangle', vol: 0.06 }); },
    reel(ten = .3) { noise(0.025, { freq: 3200 + ten * 1500, q: 4, vol: 0.05 }); },
    creak(ten = .8) { tone(180 + ten * 120, 0.18, { type: 'sawtooth', vol: 0.025, slide: 150 + ten * 60, attack: .03 }); },
    rev() { tone(110, 0.5, { type: 'sawtooth', vol: 0.05, slide: 260, attack: .02 }); tone(55, 0.6, { type: 'square', vol: 0.03, slide: 120 }); noise(0.4, { freq: 300, q: 1, vol: 0.05, sweep: 900 }); },
    cast() { noise(0.3, { freq: 900, sweep: 3800, q: 1.2, vol: 0.1 }); tone(1900, 0.22, { type: 'triangle', vol: 0.035, slide: 900, at: 0.04 }); },
    plop() { tone(620, 0.09, { vol: 0.16, slide: 180 }); noise(0.22, { filter: 'lowpass', freq: 1800, sweep: 300, vol: 0.18, at: 0.03 }); },
    zing() { noise(0.35, { freq: 4200, q: 6, vol: 0.06, sweep: 2200 }); tone(1300, 0.3, { type: 'sawtooth', vol: 0.02, slide: 700 }); },
    snap() { noise(0.06, { filter: 'highpass', freq: 3000, vol: 0.3 }); tone(900, 0.12, { type: 'square', vol: 0.06, slide: 120, at: 0.02 }); },
    landfish() { noise(0.5, { filter: 'lowpass', freq: 2600, sweep: 300, vol: 0.28 }); [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.12, at: 0.18 + i * 0.07 })); },
    whoosh() { noise(0.25, { freq: 400, sweep: 2500, q: 0.7, vol: 0.12 }); },
  };
  function play(name, arg) { if (!st.sfx) return; ensure(); try { SFX[name] && SFX[name](arg); } catch { } }

  // ------------------------------------------------------------------ background music
  // gentle generative tune: a 4-chord pad loop with random pentatonic plucks
  let musicTimer = null, beat = 0, nextAt = 0;
  const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const PENTA = [523.3, 587.3, 659.3, 784, 880, 1046.5];
  function startMusic() {
    if (musicTimer || !ac || window.BGM_EXT) return;   // the game plays its own day / night tracks instead
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
  // twinkling four-point stars that float up (coins, level-ups, rewards)
  function sparkle(x, y, color = '#fff6c2', n = 8, spread = .8) {
    for (let i = 0; i < n; i++) list.push({ k: 'star', x: x + (Math.random() - .5) * spread, y: y - Math.random() * .8, vy: .5 + Math.random() * .9, color, sz: .1 + Math.random() * .14, ph: Math.random() * 6, t0: now() + Math.random() * 220, dur: 800 + Math.random() * 500 });
  }
  // a column of light rising from the player (level up)
  function column(x, y, color = '#ffe28a') { list.push({ k: 'col', x, y, color, t0: now(), dur: 1100 }); }
  function dust(x, y) { list.push({ k: 'dust', x: x + (Math.random() - .5) * .2, y: y + .25, t0: now(), dur: 450 }); }
  function draw(g, X, Y, TS) {
    const t = now();
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], p = (t - e.t0) / e.dur;
      if (p >= 1) { list.splice(i, 1); continue; }
      if (p < 0) continue;
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
      } else if (e.k === 'star') {
        const yy = sy - e.vy * TS * p * 1.4, r = TS * e.sz * (.6 + .4 * Math.sin(p * 12 + e.ph)) * (1 - p * .5);
        g.globalAlpha = Math.sin(p * Math.PI); g.globalCompositeOperation = 'lighter'; g.fillStyle = e.color;
        g.beginPath(); g.moveTo(sx, yy - r * 1.5); g.quadraticCurveTo(sx, yy, sx + r * 1.5, yy); g.quadraticCurveTo(sx, yy, sx, yy + r * 1.5); g.quadraticCurveTo(sx, yy, sx - r * 1.5, yy); g.quadraticCurveTo(sx, yy, sx, yy - r * 1.5); g.fill();
      } else if (e.k === 'col') {
        const w = TS * (.55 + p * .25), hh = TS * (3.2 + p * 1.5), gr = g.createLinearGradient(0, sy - hh, 0, sy);
        gr.addColorStop(0, 'rgba(255,230,140,0)'); gr.addColorStop(1, e.color); g.globalAlpha = (1 - p) * .55; g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(sx - w / 2, sy - hh, w, hh);
      } else if (e.k === 'dust') {
        g.globalAlpha = (1 - p) * .35; g.fillStyle = '#e9e2cc';
        g.beginPath(); g.arc(sx, sy, TS * (.06 + p * .12), 0, 7); g.fill();
      }
      g.restore();
    }
  }

  return { play, float, burst, ring, dust, sparkle, column, draw, opts: st, setOpt, ensure, ctx: () => ac };
})();
