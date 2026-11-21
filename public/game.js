'use strict';
const TOUCH_UI = matchMedia('(pointer: coarse)').matches;
(() => {
const $ = s => document.querySelector(s);
try { const rf = new URLSearchParams(location.search).get('ref'); if (rf) localStorage.setItem('ltRef', rf.toUpperCase()); } catch { }   // invite link: the code is used once this player is in the game
const COLORS = ['#4aa3d1', '#7ac96b', '#e2b13c', '#d9907a', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const job = c => me?.career === c || !!me?.admin && me.god?.alljobs !== false;   // admins can do every job's work (unless switched off)
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// ---- pixel icons: emoji anywhere in the page (panels, buttons, toasts, the HUD) are swapped for the game's own pixel-art
// icons (public/assets/icons.webp). Text drawn on the canvas keeps its emoji.
const PXI = { map: null, re: null, cols: 16, rows: 12 };
function pxIconize(root) {
  if (!PXI.re || !root) return;
  const doNode = t => {
    const v = t.nodeValue; if (!v || !PXI.re.test(v)) return; PXI.re.lastIndex = 0;
    const p = t.parentElement; if (!p || p.closest('input,textarea,select,option,script,style,canvas,.noicon,[contenteditable],#actBtn,#fishCue')) return;
    const frag = document.createDocumentFragment(); let last = 0;
    v.replace(PXI.re, (m, off) => {
      const i = PXI.map[m.replace(/️/g, '')]; if (i === undefined) return m;
      if (off > last) frag.appendChild(document.createTextNode(v.slice(last, off)));
      const e = document.createElement('span'); e.className = 'pxi'; e.setAttribute('aria-label', m); e.title = '';
      e.style.backgroundPosition = `calc(-${i % PXI.cols} * var(--pxs)) calc(-${Math.floor(i / PXI.cols)} * var(--pxs))`;
      frag.appendChild(e); last = off + m.length; return m;
    });
    if (last === 0) return;
    if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
    t.replaceWith(frag);
  };
  if (root.nodeType === 3) return doNode(root);
  if (root.nodeType !== 1) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
  list.forEach(doNode);
}
fetch('assets/icons.json?v=2').then(r => r.json()).then(j => {
  PXI.map = {}; for (const [k, v] of Object.entries(j.map)) PXI.map[k.replace(/️/g, '')] = v;
  PXI.cols = j.cols; PXI.rows = j.rows;
  document.documentElement.style.setProperty('--pxrows', j.rows); document.documentElement.style.setProperty('--pxcols', j.cols);
  const keys = Object.keys(PXI.map).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  PXI.re = new RegExp(`(?<!\\u200D)(?:${keys.join('|')})\\uFE0F?(?!\\u200D|[\\u{1F3FB}-\\u{1F3FF}])`, 'gu');
  pxIconize(document.body);
  new MutationObserver(recs => { for (const r of recs) { if (r.type === 'characterData') pxIconize(r.target); else r.addedNodes.forEach(n => pxIconize(n)); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
}).catch(() => { });
const money = n => '฿' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ state
let ws, G = null, lastHouses = '';
let me = null, wd = null, myId = 0;
const P = new Map();                    // id -> player sprite
let clockOff = 0;
let panel = null, panelSig = '', tarotSeen = '';
let trade = null, tradeSig = '';
let call = null; const callLog = [];
const chatLog = [];
let creds = null, wantLogin = false;
let guide = null;                       // the yellow guide arrow's target
try { creds = JSON.parse(localStorage.getItem('lt_creds') || 'null'); } catch { }

// ------------------------------------------------------------------ login UI
// new characters pick a gender and a starter shirt; everyone starts with the same hairstyle
let avatar = clamp(creds?.avatar ?? 0, 0, 3), gender = creds?.gender || 'm';
const SHIRT_IDS = ['white', 'blue', 'green', 'red'];
const sw = $('#swatches');
// character creator: a big live preview (walking in place, tap ◀ ▶ to turn), gender toggle, round shirt colours
let prevView = 'front';
function paintSw() {
  sw.innerHTML = '';
  const row = document.createElement('div'); row.className = 'genders';
  for (const [g, l] of [['m', '👦 ชาย'], ['f', '👧 หญิง']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.className = g === gender ? 'on' : ''; b.onclick = () => { gender = g; paintSw(); }; row.appendChild(b); }
  sw.appendChild(row);
  const lab = document.createElement('div'); lab.className = 'lbl'; lab.textContent = 'สีเสื้อตัวแรก'; sw.appendChild(lab);
  const shirts = document.createElement('div'); shirts.className = 'shirts';
  SHIRT_IDS.forEach((id, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dot' + (i === avatar ? ' on' : ''); b.style.background = STARTER_COLORS.shirt[id]; b.title = id;
    b.onclick = () => { avatar = i; paintSw(); }; shirts.appendChild(b);
  });
  sw.appendChild(shirts);
}
(function previewLoop() {
  const cv = document.getElementById('cbPrev'); if (!cv) return; const g = cv.getContext('2d'); let spin = 0;
  const views = ['front', 'side', 'back', 'side'];
  document.getElementById('rotL').onclick = () => { spin = (spin + 3) % 4; prevView = views[spin]; };
  document.getElementById('rotR').onclick = () => { spin = (spin + 1) % 4; prevView = views[spin]; };
  cv.onclick = () => { spin = (spin + 1) % 4; prevView = views[spin]; };
  function draw(t) {
    requestAnimationFrame(draw);
    const box = document.getElementById('createBox'); if (!box || box.classList.contains('hidden') || !chImg) return;
    const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
    // stage: soft light, round pedestal, sparkles
    const gr = g.createRadialGradient(W / 2, H * .55, 10, W / 2, H * .55, W * .62); gr.addColorStop(0, 'rgba(255,236,170,.75)'); gr.addColorStop(1, 'rgba(255,236,170,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(W / 2, H - 22, 62, 14, 0, 0, 7); g.fill();
    g.fillStyle = '#e9c98a'; g.beginPath(); g.ellipse(W / 2, H - 26, 58, 12, 0, 0, 7); g.fill(); g.strokeStyle = '#a9742f'; g.lineWidth = 3; g.stroke();
    for (let i = 0; i < 6; i++) { const a = t / 1400 + i * 1.05, x = W / 2 + Math.cos(a) * (70 + i * 3), y = H * .5 + Math.sin(a * 1.3) * 70, o = (Math.sin(t / 300 + i * 2) + 1) / 2; g.globalAlpha = o * .9; g.fillStyle = '#fff3b0'; g.fillRect(x - 2, y - 6, 4, 12); g.fillRect(x - 6, y - 2, 12, 4); } g.globalAlpha = 1;
    const step = Math.floor(t / 150) % 4, bob = Math.abs(Math.sin(t / 150 * Math.PI / 2)) * 2;
    drawCharTo(g, { g: gender, lk: { hair: 'brown', shirt: SHIRT_IDS[avatar], pants: 'gray' } }, W / 2, H - 28 - bob, 215 / CH_ATLAS.h, prevView, step);
  }
  requestAnimationFrame(draw);
})();
// ---- pixel character (public/assets/pchar.webp, built by tools/build_pixel_chars.py)
// every frame has 4 layers: base (outline, skin, shoes) + shirt / pants / hair stored as grey shading and tinted per player
let CH_ATLAS = null, chImg = null; const chWait = [], chCache = new Map();
// recoloured character frames: an LRU cache (a hit moves the frame to the back) big enough for a busy square, so frames are not rebuilt every frame
const CH_MAX = 600;   // (~30 MB of small canvases; 1400 was too much for iPhones)
const chGet = k => { const c = chCache.get(k); if (c) { chCache.delete(k); chCache.set(k, c); } return c; };
const chPut = (k, c) => { chCache.set(k, c); while (chCache.size > CH_MAX) chCache.delete(chCache.keys().next().value); return c; };
const whenChars = fn => { if (chImg) fn(); else chWait.push(fn); };
// one small image per outfit sheet (public/assets/pchar/, tools/split_pchar.py), loaded the first time someone wears it:
// the old single atlas decoded to ~135 MB and iPhones reloaded the page
const CH_V = 'b6', chSheets = {};
function chSheet(g) {
  let e = chSheets[g]; if (e) return e.ok ? e.im : null;
  e = chSheets[g] = { im: new Image(), ok: false }; e.im.onload = () => { e.ok = true; if (g === '_base' || g === 'f') chBoot(); }; e.im.onerror = () => setTimeout(() => { delete chSheets[g]; }, 5000);
  e.im.src = `assets/pchar/${g}.webp?v=${CH_V}`; return null;
}
// where a frame lives: { img, y } once its sheet is loaded, else null (and the sheet starts loading)
function chSrc(frame) { const a = CH_ATLAS?.at[frame]; if (!a) return null; const im = chSheet(a[0]); return im ? { img: im, y: a[1] * CH_ATLAS.h } : null; }
function chBoot() { if (chImg || !chSheets._base?.ok || !chSheets.f?.ok) return; chImg = chSheets._base.im; chWait.splice(0).forEach(f => f()); }
fetch(`assets/pchar/index.json?v=${CH_V}`).then(r => r.json()).then(j => { CH_ATLAS = { ...j, rows: j.at, canvas: [j.w, j.h] }; chSheet('_base'); chSheet('f'); });
const DEFAULT_LOOK = { hair: 'brown', shirt: 'white', pants: 'gray' };
// starter colours are known before login (the creator screen); everything else comes from the server
const STARTER_COLORS = { shirt: { white: '#ffffff', blue: '#5aa0e0', green: '#7cc06a', red: '#e0645a' }, hair: { brown: '#6e4528' }, pants: { gray: '#bdbdbd' } };
const lookColor = (cat, id) => typeof id === 'string' && id[0] === '#' ? id : G?.looks?.[cat]?.[id]?.color || STARTER_COLORS[cat][id] || STARTER_COLORS[cat][Object.keys(STARTER_COLORS[cat])[0]];
// one tinted frame, cached per (frame, colours)
function charFrame(frame, lk) {
  const key = `${frame}|${lk.shirt}|${lk.pants}|${lk.hair}`; let c = chGet(key); if (c) return c;
  const { w, h } = CH_ATLAS, real = chSrc(frame), S = real || chSrc(frame.split(':').pop()); if (!S) return null;
  const sy = S.y, src = S.img, bx = 0;
  c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.drawImage(src, bx, sy, w, h, 0, 0, w, h);
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const t = tmp.getContext('2d');
  [['shirt', 1], ['pants', 2], ['hair', 3]].forEach(([cat, col]) => {
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h);
    t.drawImage(src, bx + col * w, sy, w, h, 0, 0, w, h);
    t.globalCompositeOperation = 'multiply'; t.fillStyle = lookColor(cat, lk[cat]); t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(src, bx + col * w, sy, w, h, 0, 0, w, h);
    g.drawImage(tmp, 0, 0);
  });
  if (real) chPut(key, c);   // (a stand-in while the outfit sheet loads is not kept; chSrc makes a new object each call, so compare by 'was it found')
  return c;
}
// one recoloured layer (hair) of a frame on its own canvas
function charLayer(frame, col, cat, lk) {
  const { w, h } = CH_ATLAS, S = chSrc(frame) || chSrc(frame.split(':').pop());
  const c = document.createElement('canvas'); c.width = w; c.height = h; const t = c.getContext('2d'); if (!S) return c;
  t.drawImage(S.img, col * w, S.y, w, h, 0, 0, w, h);
  t.globalCompositeOperation = 'multiply'; t.fillStyle = lookColor(cat, lk[cat]); t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'destination-in'; t.drawImage(S.img, col * w, S.y, w, h, 0, 0, w, h);
  return c;
}
// women wearing an outfit that only exists as a men's sheet: her own head on the outfit's body ('head'), or her hair showing
// under the outfit's hat ('hair'); hoods, masks and helmets that cover everything keep the outfit as drawn
const FEM_HEAD = { coat: 'head', office: 'head', merchant: 'head', thai: 'head', tuxedo: 'head', hoodie: 'head', pajama: 'head', tracksuit: 'head',
  chef: 'hair', farmer: 'hair', fisher: 'hair', rider: 'hair', cowboy: 'hair', magician: 'hair', beggar: 'hair', pilot: 'hair', devil: 'hair' };
const FEM_NECK = 52, FEM_HAT = 30;   // atlas rows: where her head ends / where her hair may show below a hat
function femOutfitFrame(sheet, step, lk) {
  const key = `F|${sheet}|${step}|${lk.shirt}|${lk.pants}|${lk.hair}`; let c = chGet(key); if (c) return c;
  const { w, h } = CH_ATLAS, body = charFrame(sheet + ':' + step, lk), mode = FEM_HEAD[sheet];
  c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (mode === 'head') {
    g.drawImage(body, 0, FEM_NECK, w, h - FEM_NECK, 0, FEM_NECK, w, h - FEM_NECK);
    g.drawImage(charFrame('f:' + step, lk), 0, 0, w, FEM_NECK, 0, 0, w, FEM_NECK);
    g.drawImage(charLayer('f:' + step, 3, 'hair', lk), 0, FEM_NECK, w, h - FEM_NECK, 0, FEM_NECK, w, h - FEM_NECK);
  } else {
    g.drawImage(body, 0, 0);
    g.drawImage(charLayer('f:' + step, 3, 'hair', lk), 0, FEM_HAT, w, h - FEM_HAT, 0, FEM_HAT, w, h - FEM_HAT);
  }
  return chPut(key, c);
}
// draw one character with its feet at (fx, fy), k = scale per sprite pixel; view = front | side | back; step = walk step 0-3; faceLeft for the side view
const OUTFIT_SHEET = { templeboy: 'scout', undertaker: 'tuxedo', mechanic: 'tracksuit', thug: 'hoodie', photographer: 'student', courier: 'rider', cashier: 'merchant', doctor: 'doctor', police: 'police', farmer: 'farmer', chef: 'chef', merchant: 'merchant', office: 'office', fisher: 'fisher', fishing: 'fisher', rider: 'rider', beggar: 'beggar', thief: 'thief',
  pajama: 'pajama', tracksuit: 'tracksuit', hoodie: 'hoodie', cowboy: 'cowboy', devil: 'devil', pilot: 'pilot', magician: 'magician', thai: 'thai', tuxedo: 'tuxedo', admin: 'admin',
  student: 'student', scout: 'scout', songkran: 'songkran', lanna: 'lanna', phasin: 'phasin', muaythai: 'muaythai', bunny: 'bunny', chinese: 'chinese', lukthung: 'lukthung', chakri: 'chakri', angel: 'angel', santa: 'santa',
  tigerpj: 'tigerpj', photog: 'photog', raincoat: 'raincoat', explorer: 'explorer', catsuit: 'catsuit', chicken: 'chicken', surf: 'surf', hiphop: 'hiphop', thairoyal: 'thairoyal', martial: 'martial', knight: 'knight', fortune: 'fortune', dino: 'dino', swim: 'swim', maid: 'maid', coat: 'coat', racer: 'racer', winter: 'winter', loykrathong: 'loykrathong' };   // women's versions are the 'f' + name sheets
const ofName = o => o ? (me?.gender === 'f' && o.nf ? o.nf : o.name) : '';
const WALK = { front: ['down0', 'down1', 'down0', 'down2'], back: ['up0', 'up1', 'up0', 'up1'], side: ['left0', 'left1', 'left0', 'left2'] };
// admin cloak aura: a pulsing dark-violet glow behind the body, sparks orbiting around it (front half drawn over the sprite)
function drawAura(px, py, H, t, front, gold) {
  const cy = py - H * .45, angel = gold === 'angel', fairy = gold === 'fairy', soft = angel || fairy;   // 😇 angel: white-gold light, halo and falling feathers · 🧚 fairy: pink-lilac glitter
  ctx.save();
  if (!front) {
    const pul = 1 + Math.sin(t / 380) * .08, r = H * .62 * pul, g = ctx.createRadialGradient(px, cy, H * .08, px, cy, r);
    if (angel) { g.addColorStop(0, 'rgba(255,252,230,.7)'); g.addColorStop(.55, 'rgba(255,236,170,.34)'); g.addColorStop(1, 'rgba(255,220,120,0)'); }
    else if (fairy) { g.addColorStop(0, 'rgba(255,214,242,.7)'); g.addColorStop(.55, 'rgba(238,160,255,.34)'); g.addColorStop(1, 'rgba(200,100,255,0)'); }
    else if (gold) { g.addColorStop(0, 'rgba(255,236,150,.7)'); g.addColorStop(.55, 'rgba(255,190,50,.38)'); g.addColorStop(1, 'rgba(200,120,0,0)'); }
    else { g.addColorStop(0, 'rgba(200,130,255,.75)'); g.addColorStop(.55, 'rgba(130,50,235,.42)'); g.addColorStop(1, 'rgba(60,0,120,0)'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, cy, r * .78, r, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = angel ? `rgba(255,248,200,${.45 + Math.sin(t / 300) * .2})` : fairy ? `rgba(255,190,240,${.45 + Math.sin(t / 300) * .2})` : gold ? `rgba(255,220,120,${.4 + Math.sin(t / 300) * .2})` : `rgba(214,170,255,${.35 + Math.sin(t / 300) * .2})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px, py - 2, H * .36 * pul, H * .11 * pul, 0, 0, 7); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = t / 900 + i * Math.PI * 2 / 9, z = Math.sin(a);
    if ((z > 0) !== front) continue;
    const rise = ((t / 1600 + i * .37) % 1), x = px + Math.cos(a) * H * .38, y = py - H * (.08 + rise * .85), s = (1.6 + z * .8) * (1 - rise * .5) * H / 60;
    ctx.fillStyle = `hsla(${angel ? 46 + i * 3 : fairy ? 300 + i * 8 : gold ? 42 + i * 2 : 270 + i * 9},100%,${(soft ? 82 : 70) + z * 8}%,${.85 * (1 - rise)})`;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 2.2), 0, 7); ctx.fill();
  }
  if (front && angel) {                                                          // a glowing halo over the head and a few feathers drifting down
    const hy = py - H * 1.02 + Math.sin(t / 700) * H * .02;
    ctx.strokeStyle = `rgba(255,240,170,${.8 + Math.sin(t / 250) * .15})`; ctx.lineWidth = Math.max(2, H * .05); ctx.shadowColor = '#ffe9a0'; ctx.shadowBlur = H * .25;
    ctx.beginPath(); ctx.ellipse(px, hy, H * .2, H * .06, 0, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 5; i++) { const f = (t / 3200 + i * .21) % 1, fx = px + Math.sin(t / 900 + i * 2) * H * .4 + (i - 2) * H * .1, fy = py - H * (.95 - f * .9);
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(Math.sin(t / 500 + i) * .8); ctx.globalAlpha = .85 * (1 - f); ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, H * .025), Math.max(2, H * .06), 0, 0, 7); ctx.fill(); ctx.restore(); }
  }
  if (front && fairy) {                                                          // twinkling stars around her
    for (let i = 0; i < 6; i++) { const a = t / 1100 + i * 1.05, tw = .5 + .5 * Math.sin(t / 220 + i * 2), x = px + Math.cos(a) * H * .45, y = py - H * (.25 + (i % 3) * .28) + Math.sin(a * 1.3) * H * .06, r = Math.max(1.5, H * .04) * (.6 + tw * .8);
      ctx.fillStyle = `rgba(255,${i % 2 ? 235 : 200},255,${.5 + tw * .5})`; ctx.fillRect(x - r * .3, y - r, r * .6, r * 2); ctx.fillRect(x - r, y - r * .3, r * 2, r * .6); }
  }
  ctx.restore();
}
// ---- vehicles: atlas sprites w_<key>_s (side, faces left) / _f (front) / _b (back)
const vehSpr = (key, view) => atlas?.sprites?.[`w_${key}_${view === 'side' ? 's' : view === 'front' ? 'f' : 'b'}`];
const vehH = (key, view) => { const s = vehSpr(key, view); return s ? s[3] / atlas.tile * TS : TS; };
const VEH_FACE_R = new Set(['spider']);   // side sprites drawn facing right (the rest face left)
// some top views only have one picture for both directions: flip it so the nose points the way you drive
const VEH_FLIP_B = new Set(['heli', 'heli2', 'jag', 'lambo', 'mclaren', 'phantom', 'spider']), VEH_FLIP_F = new Set(['porsche']);
function drawVeh(key, view, faceLeft, px, py) {
  const flipY = view === 'back' && VEH_FLIP_B.has(key) || view === 'front' && VEH_FLIP_F.has(key);
  const s = flipY || view === 'back' && VEH_FLIP_F.has(key) ? vehSpr(key, 'front') : vehSpr(key, view); if (!s || !atlasImg) return;
  const w = s[2] / atlas.tile * TS, h = s[3] / atlas.tile * TS;
  ctx.save(); ctx.translate(px, py + TS * .06); if (view === 'side' && !faceLeft !== VEH_FACE_R.has(key)) ctx.scale(-1, 1);
  if (flipY) { ctx.translate(0, -h); ctx.scale(1, -1); }
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h)); ctx.restore();
}
function drawRide(p, v, px, py, k, view, dir) {
  const faceLeft = dir === 'left', t = performance.now();
  if (v.kind === 'heli') py -= TS * (1.2 + Math.sin(t / 420) * .12);           // hovering above its shadow
  if (v.aura) {                                                                  // 💎 specials glow around their outline + sparkles
    ctx.save(); ctx.shadowColor = v.aura; ctx.shadowBlur = TS * (.35 + Math.sin(t / 260) * .12);
    drawVeh(p.veh, view, faceLeft, px, py); drawVeh(p.veh, view, faceLeft, px, py); ctx.restore();
    const h = vehH(p.veh, view), w = (vehSpr(p.veh, view)?.[2] || 48) / atlas.tile * TS;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) { const ph = (t / 1400 + i / 7) % 1, x = px + Math.sin(i * 2.4 + t / 900) * w * .48, y = py - h * (.1 + ph * .9);
      ctx.fillStyle = v.aura; ctx.globalAlpha = .9 * (1 - ph); ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, TS * .06 * (1 - ph * .5)), 0, 7); ctx.fill(); }
    ctx.restore();
    if (v.kind !== 'moto') return;
  }
  if (v.kind !== 'moto') return drawVeh(p.veh, view, faceLeft, px, py);          // in a car you only see the car
  const lift = p.veh === 'escoot' ? TS * .12 : TS * .32;                          // sit on the seat / stand on the deck
  const pil = [...P.values()].find(o => o.ps === p.id), back = faceLeft ? 1 : -1; // someone riding pillion sits behind
  const wl = p.whlT && t < p.whlT ? Math.sin((1 - (p.whlT - t) / 1400) * Math.PI) : 0;   // a wheelie: the front wheel up for a moment
  ctx.save();
  if (wl) { if (view === 'side') { const rx = px + back * TS * .55; ctx.translate(rx, py); ctx.rotate(back * wl * .5); ctx.translate(-rx, -py); } else ctx.translate(0, -wl * TS * .25); }
  const pilAt = () => pil && drawCharTo(ctx, pil, px + (view === 'side' ? back * TS * .44 : 0), py - lift - TS * (view === 'side' ? .04 : .12), k, view, 0, faceLeft);
  if (view !== 'back') pilAt();
  drawCharTo(ctx, p, px + (view === 'side' ? (faceLeft ? TS * .12 : -TS * .12) : 0), py - lift, k, view, 0, faceLeft);
  if (view === 'back') pilAt();
  drawVeh(p.veh, view, faceLeft, px, py);                                        // the bike in front hides the legs
  ctx.restore();
}
const SEAT_LEGS = .45;
// re-dye a sprite frame: the rider's green turned orange (the rival riders); cached per frame
const DYE = new Map();
function dyeFrame(fr, dye) {
  let m = DYE.get(fr); if (m) return m;
  const c = document.createElement('canvas'); c.width = fr.width; c.height = fr.height; const g = c.getContext('2d'); g.drawImage(fr, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    const r = a[i], gg = a[i + 1], b = a[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (gg !== mx || mx - mn < 45) continue;                 // only clearly green pixels
    const v = mx / 255, sat = (mx - mn) / mx;
    a[i] = Math.round(255 * v); a[i + 1] = Math.round(255 * v * (1 - sat * .55)); a[i + 2] = Math.round(255 * v * (1 - sat * .95));
  }
  g.putImageData(d, 0, 0); DYE.set(fr, c); return c;
}
const MONK_LOOK = { shirt: '#f0a03a', pants: '#e08a26', hair: '#d9a77c' };
// most outfit / uniform sheets have the hair painted into the sprite (no hair mask layer), so a dyed colour never showed.
// Recolour it: inside the base sprite's hair area, pixels that look like the painted brown hair (warm, darkish) are re-tinted
const HAIR_MASKED = {}, HAIR_MASK = {};
function sheetHasHair(sheet) {
  if (sheet in HAIR_MASKED) return HAIR_MASKED[sheet];
  const { w, h } = CH_ATLAS, S = chSrc(sheet + 'down0'); if (!S) return false;   // (sheet still loading: ask again later)
  const c = document.createElement('canvas'); c.width = w; c.height = h; const t = c.getContext('2d', { willReadFrequently: true });
  t.drawImage(S.img, 3 * w, S.y, w, h, 0, 0, w, h); const d = t.getImageData(0, 0, w, h).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return HAIR_MASKED[sheet] = n > 50;
}
const HAIR_HAT = { farmer: 1, fisher: 1, cowboy: 1, scout: 1, beggar: 1, magician: 1, police: 1, chef: 1, rider: 1, pilot: 1, santa: 1 }, HAIR_NONE = { admin: 1, thief: 1 };   // hats: dye only the hair below the brim · hood / mask: none shows
function hairFix(fr, outfit, step, gender, lk) {
  const sh = outfit.slice(0, -1).replace(/^f(?=[a-z]{3})/, m => CH_ATLAS.rows[outfit.slice(1) + 'down0'] !== undefined ? '' : m);
  if (!lk.hair || lk.hair === 'brown' || HAIR_NONE[sh]) return fr;
  const own = sheetHasHair(outfit);   // the sheet has its own hair layer (already dyed): only fix painted hair sticking out of it
  const y0 = HAIR_HAT[sh] ? FEM_HAT : 0;
  const key = `H|${outfit}|${step}|${gender}|${lk.hair}|${lk.shirt}|${lk.pants}`; let c = chGet(key); if (c) return c;
  const { w, h, rows } = CH_ATLAS, base = (gender === 'f' && rows['f:' + step] !== undefined ? 'f:' : '') + step;
  const mk = own ? outfit + step : base, m = HAIR_MASK[mk] || (HAIR_MASK[mk] = charLayer(mk, 3, 'hair', { hair: '#ffffff' }).getContext('2d').getImageData(0, 0, w, h).data);
  c = document.createElement('canvas'); c.width = w; c.height = h; const t = c.getContext('2d', { willReadFrequently: true }); t.drawImage(fr, 0, 0);
  const im = t.getImageData(0, 0, w, h), d = im.data, hx = lookColor('hair', lk.hair), C = [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16));
  const isHair = i => { const r = d[i], gg = d[i + 1], b = d[i + 2]; return d[i + 3] && !(Math.max(r, gg, b) > 135 || r + 8 < gg || gg + 8 < b || r - b > 120); };   // not hair: hats, halos, skin, coloured caps
  // the sheet's own hairdo can reach past the base hair area (buns, ponytails, wavy hair): grow the area along connected
  // hair-coloured pixels (a few px at most), so one head never ends up with two colours
  const sel = new Uint8Array(w * h), q = [];
  for (let p = y0 * w; p < w * h; p++) if (m[p * 4 + 3] && (own || isHair(p * 4))) { sel[p] = own ? 2 : 1; q.push(p, 0); }   // 2 = dyed already, leave as is
  for (let k = 0; k < q.length; k += 2) {
    const p = q[k], dep = q[k + 1]; if (dep >= 10) continue;
    const x = p % w, y = (p / w) | 0;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > y0 ? p - w : -1, y < FEM_NECK ? p + w : -1]) if (n >= 0 && !sel[n] && isHair(n * 4)) { sel[n] = 1; q.push(n, dep + 1); }
  }
  for (let i = y0 * w * 4; i < d.length; i += 4) {
    if (sel[i >> 2] !== 1) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const v = Math.min(255, Math.round((r * 2 + gg * 3 + b * 4) / 9 * 255 / 70));
    d[i] = v * C[0] / 255 | 0; d[i + 1] = v * C[1] / 255 | 0; d[i + 2] = v * C[2] / 255 | 0;
  }
  t.putImageData(im, 0, 0); return chPut(key, c);
}
// skin tone: sprites are drawn with one warm skin; other tones recolour the skin pixels (keeping their shading) per frame
// 🎨 dyed shop outfits: only the cloth pixels marked in the atlas 'dye' column (tools/dye_masks.py) take the new hue,
// so skin, hair, eyes and outlines never change; white cloth gets a soft tint on outfits marked wt
const OF_DYE = new WeakMap(), OF_MASK = new Map();
function dyeMask(frame) {
  let m = OF_MASK.get(frame); if (m) return m;
  const { w, h } = CH_ATLAS, L = CH_ATLAS.layers.length, S = chSrc(frame); if (!S || L < 5) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(S.img, 4 * w, S.y, w, h, 0, 0, w, h);
  m = g.getImageData(0, 0, w, h).data; OF_MASK.set(frame, m); return m;
}
function outfitDye(fr, frame, hue, wt, cut) {
  let m = OF_DYE.get(fr); if (!m) OF_DYE.set(fr, m = {}); const key = hue + '|' + cut; if (m[key]) return m[key];
  const mk = dyeMask(frame); if (!mk) return fr;
  const c = document.createElement('canvas'); c.width = fr.width; c.height = fr.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(fr, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data, H = hue / 60, k6 = Math.floor(H) % 6, f = H - Math.floor(H);
  for (let i = cut * c.width * 4; i < a.length; i += 4) {
    if (a[i + 3] < 40 || mk[i + 3] < 128) continue;
    const r = a[i], gg = a[i + 1], b = a[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = mx / 255;
    let s = mx ? (mx - mn) / mx : 0;
    if (s <= .2 && !(wt && v > .55)) continue;
    if (s < .15) s = .3;
    const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    const [R, G2, B2] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][k6];
    a[i] = R * 255; a[i + 1] = G2 * 255; a[i + 2] = B2 * 255;
  }
  g.putImageData(d, 0, 0); return (m[key] = c);
}
const SKIN_REF = [239, 150, 94], SKIN_COL = { fair: [247, 205, 176], light: [242, 185, 141], brown: [185, 112, 63], dark: [127, 74, 43] };
const skinMemo = new WeakMap();
function isSkin(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 150 || r !== mx) return false;
  const s = (mx - mn) / mx; if (s < .45 || s > .76) return false;
  const h = 60 * (g - b) / (mx - mn); return h >= 12 && h <= 28;     // the sprites' orange-tan skin; hair, shoes, khaki and straw fall outside
}
function skinFix(fr, tone) {
  const T = SKIN_COL[tone]; if (!T || !fr) return fr;
  let m = skinMemo.get(fr); if (!m) skinMemo.set(fr, m = {}); if (m[tone]) return m[tone];
  const c = document.createElement('canvas'); c.width = fr.width; c.height = fr.height;
  const t = c.getContext('2d', { willReadFrequently: true }); t.drawImage(fr, 0, 0);
  const im = t.getImageData(0, 0, c.width, c.height), d = im.data, L0 = SKIN_REF[0] * .3 + SKIN_REF[1] * .55 + SKIN_REF[2] * .15;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40 || !isSkin(d[i], d[i + 1], d[i + 2])) continue;
    const k = (d[i] * .3 + d[i + 1] * .55 + d[i + 2] * .15) / L0;
    d[i] = Math.min(255, T[0] * k); d[i + 1] = Math.min(255, T[1] * k); d[i + 2] = Math.min(255, T[2] * k);
  }
  t.putImageData(im, 0, 0); return (m[tone] = c);
}
function drawCharTo(g, p, fx, fy, k, view, step, faceLeft, seated) {
  // outfits (job clothes, reward outfits) are whole sheets; only the hair colour is applied on top
  const ofd = G?.outfitDefs?.[p.of], sheet0 = OUTFIT_SHEET[ofd?.base || p.of], sheet = sheet0 && p.g === 'f' && CH_ATLAS.rows[`f${sheet0}:down0`] !== undefined ? 'f' + sheet0 : sheet0,   // women's uniform when there is one
    outfit = sheet && CH_ATLAS.rows[`${sheet}:down0`] !== undefined ? sheet + ':' : p.g === 'f' && CH_ATLAS.rows['f:down0'] !== undefined ? 'f:' : '';   // women have their own base sprite
  const lk = p.of === 'monk' ? MONK_LOOK : { ...DEFAULT_LOOK, ...(p.lk || {}) }, [ax, ay] = CH_ATLAS.feet;   // 🙏 monks: saffron robe, shaved head
  if (outfit && !chSrc(outfit + WALK[view][step % 4])) return drawCharTo(g, { ...p, of: '', dye: 0 }, fx, fy, k, view, step, faceLeft, seated);   // outfit sheet still loading: plain clothes for a moment
  const fem = p.g === 'f' && sheet && outfit === sheet + ':' && sheet === sheet0 && FEM_HEAD[sheet] && CH_ATLAS.rows['f:down0'] !== undefined;
  const fr0 = fem ? femOutfitFrame(sheet, WALK[view][step % 4], lk) : charFrame(outfit + WALK[view][step % 4], lk);
  const fr1 = !fem && outfit && outfit !== 'f:' ? hairFix(fr0, outfit, WALK[view][step % 4], p.g, lk) : fr0;   // outfit sheets with the hair painted in: dye it
  const fm = p.of === 'monk' && monkFrame(WALK[view][step % 4]), frS = lk.skin && lk.skin !== 'warm' ? skinFix(fr1, lk.skin) : fr1, fr = fm || (p.dye ? dyeFrame(frS, p.dye) : ofd?.hue !== undefined ? outfitDye(frS, outfit + WALK[view][step % 4], ofd.hue, ofd.wt, fem && FEM_HEAD[sheet] === 'head' ? FEM_NECK : 0) : frS);
  g.save(); g.translate(fx, fy); if (view === 'side' && !faceLeft) g.scale(-1, 1);
  g.imageSmoothingEnabled = false;
  if (seated) {
    // sitting, seen from the front: the body as is, the legs (hips to feet) folded to under half their height (knees towards you)
    const hip = Math.round(ay - (ay - 4) * .34), legH = (CH_ATLAS.h - hip) * k * SEAT_LEGS, sh = CH_ATLAS.h - hip;
    g.drawImage(fr, 0, 0, CH_ATLAS.w, hip, -ax * k, -(ay - hip) * k * SEAT_LEGS - hip * k, CH_ATLAS.w * k, hip * k);
    g.drawImage(fr, 0, hip, CH_ATLAS.w, sh, -ax * k, -(ay - hip) * k * SEAT_LEGS, CH_ATLAS.w * k, legH);
  } else g.drawImage(fr, -ax * k, -ay * k, CH_ATLAS.w * k, CH_ATLAS.h * k);
  g.restore();
}
paintSw();
if (creds) { $('#inName').value = creds.name; $('#inPin').value = creds.pin; }
// share the game with friends (login screen + settings)
async function shareGame() {
  const url = 'https://is.gd/newlifetown', text = 'มาเล่น "เมืองชีวิตนี้เลือกได้" ด้วยกัน! เกมใช้ชีวิตออนไลน์ หางาน หาเงิน ซื้อบ้าน ตกปลา เล่นบนมือถือได้เลย';
  try { if (navigator.share) { await navigator.share({ title: 'เมืองชีวิตนี้เลือกได้', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย!', '📋'); }
  catch { prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน:', url); }
}
document.querySelectorAll('.shareBtn').forEach(b => b.onclick = shareGame);
// install as an app (phone home screen / computer): the browser's own prompt when it offers one, otherwise how-to steps
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
addEventListener('appinstalled', () => { installEvt = null; document.querySelectorAll('.instBtn').forEach(b => b.classList.add('hidden')); });
if (matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone) document.querySelectorAll('.instBtn').forEach(b => b.classList.add('hidden'));
try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { }); } catch { }
function howTo(html) {
  document.querySelector('.howTo')?.remove();
  const d = document.createElement('div'); d.className = 'howTo'; d.innerHTML = `<div class="howCard">${html}<button type="button" class="primary">เข้าใจแล้ว</button></div>`;
  d.onclick = e => { if (e.target === d || e.target.tagName === 'BUTTON') d.remove(); }; document.body.appendChild(d);
}
document.querySelectorAll('.instBtn').forEach(b => b.onclick = async () => {
  if (installEvt) { const e = installEvt; installEvt = null; try { await e.prompt(); await e.userChoice; } catch { } return; }
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (b.dataset.inst === 'm') howTo(ios
    ? '<h3>📱 ติดตั้งบน iPhone / iPad</h3><ol><li>เปิดเกมใน <b>Safari</b></li><li>แตะปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) ด้านล่าง</li><li>เลือก <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วกด <b>เพิ่ม</b></li></ol><small>จะมีไอคอนเกมบนหน้าจอ เปิดแล้วเต็มจอเหมือนแอป</small>'
    : '<h3>📱 ติดตั้งบนมือถือ Android</h3><ol><li>เปิดเกมใน <b>Chrome</b></li><li>แตะเมนู <b>⋮</b> มุมขวาบน</li><li>เลือก <b>"ติดตั้งแอป"</b> หรือ <b>"เพิ่มลงในหน้าจอหลัก"</b></li></ol><small>จะมีไอคอนเกมบนหน้าจอ เปิดแล้วเต็มจอเหมือนแอป</small>');
  else howTo('<h3>💻 ติดตั้งในคอม</h3><ol><li>เปิดเกมใน <b>Chrome</b> หรือ <b>Edge</b></li><li>กดไอคอน <b>ติดตั้ง ⊕</b> ทางขวาของช่องที่อยู่เว็บ<br><small>(หรือเมนู ⋮ → บันทึกและแชร์ → ติดตั้งหน้าเป็นแอป)</small></li><li>กด <b>ติดตั้ง</b></li></ol><small>จะมีไอคอนเกมบนเดสก์ท็อปและเมนูเริ่ม เปิดเป็นหน้าต่างแยก</small>');
});
const nameErr = v => /[^\x20-\x7e]/.test(v) ? 'ชื่อตัวละครใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น' : /\s/.test(v) ? 'ชื่อห้ามมีเว้นวรรค' : '';
$('#inName').addEventListener('input', e => { $('#loginErr').textContent = nameErr(e.target.value) ? nameErr(e.target.value).replace('ชื่อตัวละคร', 'ID') + ' (บัญชีเก่าที่เป็นภาษาไทยยังเข้าได้)' : ''; });
$('#createBack').onclick = () => { $('#createBox').classList.add('hidden'); $('#loginForm').classList.remove('hidden'); };
$('#createOk').onclick = () => {
  const cname = $('#inCname').value.trim();
  if (cname.length < 2) { $('#createErr').textContent = 'ตั้งชื่อตัวละครก่อน (2-16 ตัว)'; return; }
  $('#createErr').textContent = ''; creds = { ...creds, create: 1, cname, gender, shirt: SHIRT_IDS[avatar] }; loginBusy(true); wantLogin = true; connect();
};
let busyT = 0;
// ---- loading screen: shown from the moment you press "enter the city" until the town and the characters are ready to draw
const LD = { on: false, t0: 0, shown: 0, tip: 0 };
const LD_TIPS = ['💡 มือใหม่ซื้อเบ็ดกับน้าเล็กไปตกปลาขาย หาเงินง่ายที่สุด', '🛕 วัดอยู่บนสนามหญ้าใต้บ่อน้ำกลางเมือง ไหว้พระได้พรรายได้ +5%', '🎡 สวนสนุกเล่นเครื่องเล่นแล้วพลังงานกับความสุขเพิ่ม',
  '🔪 ที่ครัวใหญ่มีเกมหั่นผักผลไม้ ใครก็เล่นหาเงินได้', '🏠 ซื้อบ้านที่สำนักงานอสังหาฯ แล้วชวนเพื่อนมาเที่ยวบ้าน', '🔋 เครื่องร้อน? เปิดโหมดประหยัดแบตที่ ⚙️ ตั้งค่า', '📱 กดค้างปุ่มใช้งาน = วิ่ง'];
function loadScr(on) {
  const el = $('#loadScr'); if (!el) return;
  if (on) { if (LD.on) return; LD.on = true; LD.t0 = performance.now(); LD.shown = 0; el.classList.remove('hidden', 'out'); $('#ldTip').textContent = LD_TIPS[Math.floor(Math.random() * LD_TIPS.length)]; loadTick(); }
  else if (LD.on) { LD.on = false; el.classList.add('out'); setTimeout(() => { if (!LD.on) el.classList.add('hidden'); }, 380); }
}
function loadTick() {
  if (!LD.on) return;
  const steps = [['เชื่อมต่อเซิร์ฟเวอร์', ws && ws.readyState === 1, 1], ['เข้าสู่ระบบ', !!G, 1], ['โหลดภาพเมือง', !!atlasImg, 4], ['โหลดตัวละคร', !!chImg, 2], ['โหลดไอคอน', !!PXI.map, 1]];
  const tot = steps.reduce((a, s) => a + s[2], 0), done = steps.reduce((a, s) => a + (s[1] ? s[2] : 0), 0), cur = steps.find(s => !s[1]);
  const goal = done / tot, el = (performance.now() - LD.t0) / 1000, creep = cur ? Math.min(.9 * cur[2] / tot, el * .03) : 0;   // creep forward while waiting so it never looks stuck
  LD.shown = Math.max(LD.shown, Math.min(.99, goal + creep)); if (!cur) LD.shown = 1;
  $('#ldFill').style.width = (LD.shown * 100).toFixed(0) + '%'; $('#ldPct').textContent = Math.floor(LD.shown * 100) + '%';
  $('#ldMsg').textContent = cur ? `กำลัง${cur[0]}...` : 'พร้อมแล้ว!';
  if (el > 4 && Math.floor(el / 4) !== LD.tip) { LD.tip = Math.floor(el / 4); $('#ldTip').textContent = LD_TIPS[(LD.tip * 3) % LD_TIPS.length]; }
  if (!cur && me) return setTimeout(() => loadScr(false), 250);
  setTimeout(loadTick, 120);
}
// ---- 💰 Google AdSense H5 Games Ads: off unless the server sends G.ads (the owner sets the Fly secret ADSENSE_CLIENT)
// Rewarded: the player opens it from the phone, sees the reward first and chooses to watch. Full screen: only between places
// (going into the temple or the park), never in the first 3 minutes, at most once every 6 minutes.
const ADS = { ready: false, lastFull: 0, t0: 0 };
function adsInit() {
  if (ADS.ready || !G?.ads?.client) return; ADS.ready = true; ADS.t0 = Date.now();
  window.adsbygoogle = window.adsbygoogle || []; window.adBreak = window.adConfig = o => window.adsbygoogle.push(o);
  if (document.querySelector('script[src*="adsbygoogle.js"]')) { adConfig({ preloadAdBreaks: 'on', sound: 'on' }); return; }   // the server already put it in the page head
  const sc = document.createElement('script'); sc.async = true; sc.crossOrigin = 'anonymous';
  sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(G.ads.client);
  sc.setAttribute('data-ad-client', G.ads.client); sc.setAttribute('data-ad-frequency-hint', '360s'); if (G.ads.test) sc.setAttribute('data-adbreak-test', 'on');
  document.head.appendChild(sc);
  adConfig({ preloadAdBreaks: 'on', sound: 'on' });
}
const adPause = () => { try { FX.ctx()?.suspend(); } catch { } }, adResume = () => { try { FX.ctx()?.resume(); } catch { } };
function adReward() {
  if (!G?.ads || !window.adBreak) return toast('ยังไม่เปิดระบบโฆษณา', '🎁', false);
  if (!(me?.adLeft > 0)) return toast(`วันนี้ดูโฆษณารับรางวัลครบ ${G.ads.daily} ครั้งแล้ว พรุ่งนี้มาใหม่นะ`, '🎁', false);
  let asked = false;
  adBreak({ type: 'reward', name: 'reward_gems', beforeAd: adPause, afterAd: adResume,
    beforeReward: showAdFn => { asked = true; popup(`🎁 <b>ดูโฆษณาสั้นๆ จนจบ</b> รับ 💎${G.ads.gems} และพลังงาน +${G.ads.energy}<br><small>วันนี้เหลือ ${me.adLeft}/${G.ads.daily} ครั้ง · ปิดก่อนจบจะไม่ได้รางวัล</small>`, [['▶️ ดูโฆษณา', 'good', () => showAdFn()], ['ไม่ดู', '', () => { }]], 30000); },
    adDismissed: () => toast('ปิดโฆษณาก่อนจบ เลยยังไม่ได้รางวัลนะ', '🎁', false),
    adViewed: () => send({ t: 'adreward' }),
    adBreakDone: () => { if (!asked) toast('ตอนนี้ยังไม่มีโฆษณาให้ดู ลองใหม่อีกสักพักนะ', '🎁', false); } });
  closePanel();
}
function adFull(name) {
  if (!G?.ads || !ADS.ready || !window.adBreak || Date.now() - ADS.t0 < 180000 || Date.now() - ADS.lastFull < 360000) return;
  ADS.lastFull = Date.now();
  adBreak({ type: 'next', name, beforeAd: adPause, afterAd: adResume });
}
function loginBusy(on) {
  if (on) loadScr(true); else if (!G) loadScr(false);
  const b = $('#loginGo'), c = $('#createOk'); clearTimeout(busyT);
  b.disabled = c.disabled = !!on; b.classList.toggle('busy', !!on);
  b.firstElementChild.textContent = on ? '⏳ กำลังเข้าเมือง...' : '🚪 เข้าเมือง';
  if (on) busyT = setTimeout(() => loginBusy(false), 9000);
}
function loginShake() { const f = $('#createBox').classList.contains('hidden') ? $('#loginForm') : $('#createBox'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
// 🔑 Google sign-in (only when the server has a Google client ID): log in with a Google account linked in the settings
let gMode = 'login', gReady = null;
function gLoad(gid) {
  if (gReady || !gid) return gReady;
  return gReady = new Promise(ok => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    // redirect mode: the account picker opens in this same tab and Google posts back to /gauth (a popup on phones closed onto another tab)
    sc.onload = () => { try { google.accounts.id.initialize({ client_id: gid, ux_mode: 'redirect', login_uri: location.origin + '/gauth', callback: r => gGot(r.credential) }); ok(true); } catch { ok(false); } }; sc.onerror = () => ok(false); document.head.appendChild(sc); });
}
function gGot(cred) {
  if (!cred) return;
  if (gMode === 'link') { send({ t: 'glink', google: cred }); mgClose(); return; }
  creds = { google: cred }; $('#loginErr').textContent = ''; loginBusy(true); wantLogin = true; connect();
}
function gButton(el, w) { try { google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'th', width: Math.min(300, w || 280) }); } catch { } }
fetch('api/gcfg').then(r => r.json()).then(j => { if (!j.gid) return; gLoad(j.gid).then(ok => { if (!ok) return; $('#gWrap').classList.remove('hidden'); gMode = 'login'; try { sessionStorage.removeItem('lt_glink'); } catch { } gButton($('#gBtn'), $('#loginForm').clientWidth - 40); }); }).catch(() => { });
function gLinkOpen() {
  if (!G.gid) return toast('ยังไม่เปิดใช้การผูกบัญชี Google', '🔑', false);
  gLoad(G.gid).then(ok => {
    if (!ok) return toast('โหลดระบบ Google ไม่ได้ ลองใหม่อีกครั้ง', '🔑', false);
    gMode = 'link'; try { sessionStorage.setItem('lt_glink', '1'); } catch { } closePanel(); mgStop(); $('#mg').classList.remove('hidden');
    $('#mgBody').innerHTML = `<h2>🔑 ผูกบัญชี Google</h2><div class="sub" style="margin:8px 0 12px">กดปุ่มด้านล่างแล้วเลือกบัญชี Google ของคุณ · ครั้งหน้าที่หน้าเข้าเกม กด "ลงชื่อเข้าใช้ด้วย Google" ได้เลย ไม่ต้องจำ ID/PIN</div><div class="gLinkBtn" id="gLinkBtn"></div>`;
    gButton($('#gLinkBtn'), 300);
  });
}
$('#loginForm').onsubmit = e => {
  e.preventDefault();
  // the server has the final say: new characters must use English/digits, old Thai-named characters still log in
  creds = { name: $('#inName').value.trim(), pin: $('#inPin').value };
  $('#loginErr').textContent = '';
  loginBusy(true); wantLogin = true; connect();
};
$('#pinEye').onclick = () => { const i = $('#inPin'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pinEye').textContent = show ? '🙈' : '👁'; };
{ // one tip at a time under the button
  const tips = ['🎣 ตกปลาได้ทุกที่ที่มีน้ำ ปลาทองคำราคา ฿5,000', '🩺 หมอรับเคส ICU: ปั๊มหัวใจ ผ่าตัด ให้ตรงจังหวะ', '🏠 ซื้อบ้านในหมู่บ้านจัดสรร ปลูกผักในลานบ้านของตัวเอง', '🛵 เป็นไรเดอร์ ส่งอาหารให้ผู้เล่นตัวจริง', '📈 เล่นหุ้นที่ธนาคาร ซื้อถูก ขายแพง', '🤝 แลกของ คุยโทรศัพท์ กับเพื่อนในเมืองได้'];
  let k = Math.floor(Math.random() * tips.length); const el = $('#loginTip');
  const show = () => { el.classList.remove('in'); setTimeout(() => { el.textContent = '💡 ' + tips[k++ % tips.length]; el.classList.add('in'); }, 250); };
  show(); setInterval(() => { if (!$('#login').classList.contains('hidden')) show(); }, 5000);
}
if (!$('#inName').value) setTimeout(() => $('#inName').focus(), 300);

// ---- login promo video: plays muted behind the login (full screen on phones, in a phone frame beside the form on desktop)
const promo = (() => {
  const login = $('#login'), v = $('#promoV'), snd = $('#promoSnd'), form = $('#loginForm'); if (!v) return { stop() { } };
  const lite = (navigator.connection && navigator.connection.saveData) || matchMedia('(prefers-reduced-motion:reduce)').matches;
  let wantSound = false; try { wantSound = localStorage.getItem('lt_snd') === '1'; } catch { }
  const off = () => login.classList.remove('hasVid');
  const label = () => { snd.textContent = v.muted ? '🔇' : '🔊'; $('#sndHint')?.classList.toggle('hidden', !v.muted); };
  const EVBAN = Date.now() < Date.parse('2026-11-30T23:59:59+07:00') ? 'assets/lkbanner_tall.webp?v=1' : '';   // 🏮 festival weeks: the event poster replaces the video
  if (EVBAN) { v.removeAttribute('autoplay'); v.removeAttribute('poster'); v.style.display = 'none'; login.classList.add('posterOnly', 'evBan'); $('#promoPhone').style.background = `#0b1230 url(${EVBAN}) center/cover`; snd.style.display = 'none'; $('#sndHint')?.classList.add('hidden'); }
  else if (lite) { v.removeAttribute('autoplay'); login.classList.add('posterOnly'); }
  else {
    v.src = 'assets/ui/login_promo.mp4?v=3'; v.addEventListener('error', off); v.play().catch(() => { });
    v.addEventListener('playing', () => login.classList.add('vidOn'), { once: true });
  }
  snd.onclick = e => { e.stopPropagation(); v.muted = !v.muted; if (!v.muted) v.play().catch(() => { }); try { localStorage.setItem('lt_snd', v.muted ? '0' : '1'); } catch { } label(); };
  // browsers only allow sound after a tap: if the player liked sound last time, turn it on at their first tap
  if (wantSound) login.addEventListener('pointerdown', () => { v.muted = false; v.play().catch(() => { }); label(); }, { once: true });
  if (!EVBAN) label();
  // phone: the form is a bottom dock, closed to a single big button until tapped (a saved account just plays on)
  const saved = !!(creds && creds.name && (creds.pin || creds.tok)), start = $('#startBtn');
  const open = () => { form.classList.add('open'); setTimeout(() => $(saved && $('#inName').value ? '#inPin' : '#inName').focus(), 120); };
  if (saved) { start.textContent = `▶ เล่นต่อ · ${creds.name}`; }
  start.onclick = () => { if (saved && !form.classList.contains('open')) { loginBusy(true); creds = { name: creds.name, pin: creds.pin, tok: creds.tok }; wantLogin = true; connect(); } else open(); };
  $('#otherAcct').onclick = () => { $('#inName').value = ''; $('#inPin').value = ''; open(); };
  $('#promoPhone').onclick = () => { if (matchMedia('(max-width:860px)').matches) return; $('#inName').focus(); };   // desktop: the "enter the city" button in the video focuses the form
  return { open, stop() { v.pause(); v.removeAttribute('src'); v.load(); } };
})();
// back from Google's sign-in page (redirect mode): the server put the credential in the address fragment
let gPendLink = null;
{
  const mm = location.hash.match(/gcred=([\w.-]+)/), ge = location.hash.match(/gerr=(\w+)/);
  if (mm || ge) history.replaceState(null, '', location.pathname + location.search);
  let link = false; try { link = sessionStorage.getItem('lt_glink') === '1'; sessionStorage.removeItem('lt_glink'); } catch { }
  if (ge) setTimeout(() => { $('#loginErr').textContent = 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่อีกครั้ง'; promo.open(); }, 0);
  else if (mm && link) { gPendLink = mm[1]; if (creds && creds.name && (creds.pin || creds.tok)) setTimeout(() => { loginBusy(true); wantLogin = true; connect(); }, 0); }   // linking: log back in, then link
  else if (mm) setTimeout(() => { creds = { google: mm[1] }; $('#loginErr').textContent = ''; loginBusy(true); wantLogin = true; connect(); }, 0);
}
// ------------------------------------------------------------------ network
let lastMsgT = 0;
function connect() {
  if (ws && ws.readyState <= 1) { if (ws.readyState === 1) sendLogin(); return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (wantLogin) sendLogin(); };
  ws.onmessage = e => { lastMsgT = Date.now(); handle(JSON.parse(e.data)); };
  ws.onclose = () => {
    if (G) toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...', '📡', false);
    setTimeout(() => { if (wantLogin) connect(); }, 2000);
  };
}
function sendLogin() { send({ t: 'login', ...creds }); }
// a socket that stopped talking while the game is on screen (the phone switched networks): the world froze for players. The server
// sends the world every second, so 8 quiet seconds means the line is dead: drop it and reconnect.
setInterval(() => { if (G && wantLogin && !document.hidden && ws && ws.readyState === 1 && lastMsgT && Date.now() - lastMsgT > 8000) { lastMsgT = Date.now(); try { ws.close(); } catch { } } }, 2000);
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
let fixId = 0;                          // the server's last position correction we have applied
const doAct = (st, a, extra = {}) => send({ t: 'act', st, a, ...extra });

function handle(m) {
  switch (m.t) {
    case 'loginfail': if (creds?.tok || creds?.google) { try { localStorage.removeItem('lt_creds'); } catch { } creds = null; } loginBusy(false); loginShake(); promo.open(); $('#loginErr').textContent = m.msg; $('#createErr').textContent = m.msg; wantLogin = false; break;
    case 'newchar':     // new ID: pick gender + first shirt once
      loginBusy(false); wantLogin = false; $('#loginForm').classList.add('hidden'); $('#createBox').classList.remove('hidden');
      $('#createName').textContent = 'ยินดีต้อนรับ ID: ' + m.name; $('#inCname').value = ''; paintSw(); setTimeout(() => $('#inCname').focus(), 50); break;
    case 'kicked': wantLogin = false; toast(m.msg, '⚠️', false); break;
    case 'init':
      if (G && G.build && m.build !== G.build) $('#updBar').classList.remove('hidden');     // a new version was deployed
      G = m; myId = m.id; adsInit(); P.clear(); buildAreas(); chCache.clear(); buildStaff(); fixId = 0; afkSent = false; running = false; $('#actBtn').classList.remove('run'); $('#runBtn').classList.remove('on'); lastInput = performance.now();
      creds = m.relog ? { name: m.relog.name, tok: m.relog.tok } : creds.tok ? { name: creds.name, tok: creds.tok } : { name: creds.name, pin: creds.pin }; localStorage.setItem('lt_creds', JSON.stringify(creds)); if (gPendLink) { const gc = gPendLink; gPendLink = null; setTimeout(() => send({ t: 'glink', google: gc }), 500); } promo.stop(); gMode = 'link';
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden'); document.body.classList.add('inGame');
      chatLog.length = 0; m.chat.forEach(c => chatLog.push(c)); setTimeout(() => paintChatBox(), 0);
      { let tutDone = false; try { tutDone = !!localStorage.getItem('lt_tut2'); } catch { } tutPending = !!(m.isNew || !tutDone); }
      $('#topupBtn').classList.toggle('hidden', !m.pay); $('#topupBtn').onclick = () => FN.openTopup();
      if (tutPending) setTimeout(() => me && showTut(0), 400);
      else { setTimeout(lkBanner, 1300); if (m.pay?.on && !payBackRef) setTimeout(payBanner, 1600); setTimeout(() => me && checkNews(), 900); }
      if (payBackRef) { const r = payBackRef; payBackRef = ''; setTimeout(() => { send({ t: 'pay', op: 'check', ref: r }); openPanel({ kind: 'topup' }); }, 1200); }
      break;
    case 'me': { if (!me) { try { const rc = localStorage.getItem('ltRef'); if (rc) { localStorage.removeItem('ltRef'); setTimeout(() => send({ t: 'refuse', code: rc }), 2500); } } catch { } }
      const prev = me; me = m.d && prev ? { ...prev, ...m } : m; if (!prev || prev.frame !== me.frame) setTimeout(paintPortrait, 0); $('#meName').textContent = me.name; paintHud(); refreshPanel(); if (prev && prev.id === me.id) onMeDiff(prev, me); break; }   // d: only the fields that changed
    case 'announce': setTicker(m.text); showTicker(); break;
    case 'wd': {   // the full snapshot on login, then only the parts that changed (d: 1)
      if ('ann' in m && (m.ann || '') !== tickerAnn) setTicker(m.ann);
      wd = m.d && wd ? { ...wd, ...m } : m; clockOff = m.now - Date.now(); paintEvent();
      if (!m.d || Object.keys(m).some(k => k !== 't' && k !== 'd' && k !== 'now' && k !== 'on')) refreshPanel();
      if (m.houses) { const hs = JSON.stringify(m.houses.map(h => [h[2], h[7], h[8], h[9]])); if (G && hs !== lastHouses) { lastHouses = hs; layoutFurniture(); } }
      break; }
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, ox: 0, oy: 0, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        if (p.fn && p.fn !== s.fn && String(p.fn).startsWith('pool:') && s.name) setTimeout(() => { const q = s.fn && funPos(s); if (!q) return; FX.burst(q.x, q.y - .5, '#d8f2ff', 22); FX.ring(q.x, q.y - .4, '#ffffff', 900, 1.4); FX.play('splash'); }, 60);   // jumping into the pool: a big splash
        Object.assign(s, { um: p.um || 0, umb: p.umb || 0, id: p.id, name: p.name, av: p.av, c: p.c, lv: p.lv, dz: p.dz || [], pose: p.pose, title: p.title, tr: p.tr, g: p.g, lk: p.lk, npc: p.npc, zb: p.zb || '', ap: p.ap || 0, adm: p.adm, w: p.w, sad: p.sad, of: p.of || '', face: p.face || '', th: p.th, afk: p.afk, wk: p.wk, desc: p.desc, tf: p.tf, fn: p.fn || '', veh: p.veh || '', ps: p.ps || 0, pt: p.pt || '', pn: p.pn || '', pl: p.pl || 0, gg: p.gg || 0, bl: p.bl || '', wwm: p.wwm || 0 });
        if (p.id !== myId) { if (p.fc && !s.fc) { s.fcB = findWater(p.x, p.y); s.fcT = performance.now(); } s.fc = p.fc || 0; if (!s.fc) s.fcB = null; }
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ball': fbMsg(m); break;
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { if (Math.hypot(x - s.x, y - s.y) > 4) { s.rx = x; s.ry = y; } s.x = x; s.y = y; s.f = f; } } break;
    case 'whl': { const o = P.get(m.id); if (o) { o.whlT = performance.now() + 1400; if (Math.hypot(o.x - (P.get(myId)?.x || 0), o.y - (P.get(myId)?.y || 0)) < 12) FX.play('rev'); } break; }
    case 'jg': jgOpen(m.k, m.seed); break;
    case 'caught': FX.play('levelup'); { const s0 = P.get(myId); if (s0) { FX.burst(s0.x, s0.y - .6, '#ff4a4a', 18); FX.float(s0.x, s0.y - 1, '🚓 จับได้!', '#ffe14d', .6); } } break;
    case 'taxi': {
      const t0 = performance.now();
      if (m.phase === 'come') { taxiFx = { k: 'taxi', dx: 1, dy: 0, x: m.x - 5, y: m.y + .2, fx: m.x - 5, tx: m.x - 1.3, t0, dur: m.wait - 900 }; FX.play('notice'); setTimeout(() => FX.play('pop'), m.wait - 1000); }
      else { taxiFx = { k: 'taxi', dx: 1, dy: 0, x: m.x - 1.3, y: m.y + .2, fx: m.x - 1.3, tx: m.x + 9, t0: t0 + 700, dur: 1800, ease: 1 }; }
      break;
    }
    case 'fix': {
      if (m.fx) fixId = m.fx;
      const s = P.get(myId);
      if (s) {
        // small corrections are blended in over a few frames instead of snapping (no jitter against walls)
        if (!m.tp && Math.hypot(m.x - s.x, m.y - s.y) < 1.2) { s.ox += s.x - m.x; s.oy += s.y - m.y; }
        else { s.ox = s.oy = 0; }
        s.x = s.rx = m.x; s.y = s.ry = m.y; lastSent = '';
      }
      if (m.tp) { setTimeout(() => { const s1 = P.get(myId), id = s1 && areaOf(s1.x, s1.y)?.id; if (id === 'temple' || id === 'park') adFull('enter_' + id); }, 1500); closePanel(); FX.play('whoosh'); holdAfterTp = true; fadeT = performance.now(); }
      break;
    }
    case 'toast': toast(m.msg, m.icon, m.ok); toastSfx(m); break;
    case 'tfx':   // temple effects
      if (m.kind === 'bell') { bellT = performance.now(); FX.play('bell'); FX.ring(m.x, m.y, '#ffd34d', 1400, 1.6); if (navigator.vibrate) navigator.vibrate(30); }
      else if (m.kind === 'pray') { FX.play('pray'); const p0 = P.get(myId); if (p0) { FX.float(p0.x, p0.y - 1.6, '✨', '#ffe9a0', .6); FX.burst(p0.x, p0.y - 1, '#ffd34d', 14); } }
      else if (m.kind === 'alms') { FX.play('chime'); FX.burst(m.x, m.y - .8, '#ffd34d', 18); FX.float(m.x, m.y - 1.4, '🙏', '#ffe9a0', .6); }
      if (panel?.kind === 'wpray') refreshPanel(true);
      break;
    case 'siamsi': FX.play('chime'); siamsiPop(m); break;
    case 'catch': catchPop(m.item, m.first); break;
    case 'egg': eggFx(m); break;
    case 'amb': ambStart(m); break;
    case 'zn': case 'zspawn': case 'zdie': znMsg(m); break;
    case 'ww': case 'wwturn': case 'wwdie': wwMsg(m); break;
    case 'mypic': myPic = m.pic || ''; paintPortrait(); if (panel?.kind === 'profile') refreshPanel(true); break;
    case 'lotto': window.__lotto = m; if (panel?.kind === 'lotto') refreshPanel(true); break;
    case 'ideas': window.__ideas = m; if (panel?.kind === 'ideas') refreshPanel(true); break;
    case 'mayor': window.__mayor = m; if (panel?.kind === 'mayor') refreshPanel(true); break;
    case 'gangs': window.__gangs = m; if (panel?.kind === 'gang') refreshPanel(true); break;
    case 'stockhist': stockHist[m.id] = { i: m.i, c: m.c }; if (panel?.kind === 'bank') document.querySelectorAll('#panelBody canvas[data-chart]').forEach(drawStockChart); break;
    case 'mailsent': { const ta = $('#mailText'); if (ta) ta.value = ''; FX.play('chime'); if (panel?.kind === 'mail') { panel.sent = m.to; panel.to = m.to; panel.sentT = Date.now(); refreshPanel(true); setTimeout(() => { if (panel?.kind === 'mail' && Date.now() - panel.sentT >= 3900) { panel.sent = ''; refreshPanel(true); } }, 4000); } break; }
    case 'lkv': LKV = m; lkUi(); if (panel?.kind === 'lkev' || panel?.kind === 'lk') refreshPanel(true); break;
    case 'lkf': lkSpawn(m, 0); break;
    case 'fairgo': closePanel(); fairPlay(m); break;
    case 'lks': lkSky(m); break;
    case 'ev7': EV7 = m; ev7Ui(); if (panel?.kind === 'ev7') refreshPanel(true); break;
    case 'mail': mailList = m.list || []; if (panel?.kind === 'mail') refreshPanel(true); break;
    case 'hatch': { const pt = G.pets[m.id], q = P.get(myId); FX.play('pop'); if (q) { FX.burst(q.x, q.y - .6, '#fff3c4', 24); FX.sparkle(q.x, q.y - .8, '#ffe27a', 18); FX.column(q.x, q.y, m.rar >= 4 ? '#ffd34d' : '#bfe8ff'); } flashScreen(m.rar >= 4 ? '255,220,120' : '255,255,255', .3); if (pt) { const d = document.createElement('div'); d.className = 'hatchPop'; d.innerHTML = `<div><small>🐣 ไข่ฟักแล้ว!</small><canvas data-pet="${m.id}" width="120" height="120"></canvas><b>${pt.icon} ${esc(pt.name)}</b><span class="rtag r${pt.rar}">${G.fishRarity[pt.rar]}</span><small>ตั้งชื่อได้ในแอพ 🐾 สัตว์เลี้ยง · แตะเพื่อปิด</small></div>`; d.onclick = () => d.remove(); document.body.appendChild(d); try { drawPetIcon(d.querySelector('canvas'), m.id); } catch { } setTimeout(() => d.remove(), 7000); } break; }
    case 'refcode': window.__ref = m; if (panel?.kind === 'invite') refreshPanel(true); break;
    case 'info': infoCache.set(m.id, m); if (panel?.kind === 'player' && panel.pid === m.id) refreshPanel(true); break;
    case 'tchat': tradeChat.push(m); if (tradeChat.length > 30) tradeChat.shift(); paintTradeChat(); if (!m.mine) FX.play('pop'); break;
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      paintChatBox(m);
      const s = P.get(m.id); if (s && !m.sys && !m.g) {   // world chat floats over the head too
        const em = (m.text.match(/\p{Extended_Pictographic}(\u200d\p{Extended_Pictographic}|\ufe0f)*/gu) || []).slice(0, 3).join('');   // emoji in a chat line float big over your head
        const only = em && !m.text.replace(/[\p{Extended_Pictographic}\ufe0f\u200d\s]/gu, '');
        if (em) { s.emo = em; s.emoT = performance.now() + 4500; }
        if (!only) { s.bubble = m.text; s.bt = performance.now() + 6500; }
      }
      if (m.sys) { if (/🦈|💎|🎊|🏅|🎓/.test(m.text)) FX.play('notice'); } else if (m.id !== myId) FX.play('pop');
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
    case 'ledger': ledgerRes = m; if (panel?.kind === 'ledger') refreshPanel(true); break;
    case 'pay': payRes = m; if (panel?.kind === 'topup') refreshPanel(true); break;
    case 'payadmin': payAdm = m; if (panel?.kind === 'payadmin') refreshPanel(true); break;
    case 'payqr': payOpenRef = m.ref; if (panel?.kind === 'topup') refreshPanel(true); else openPanel({ kind: 'topup' }); break;
    case 'payredir': toast('กำลังไปหน้าชำระเงิน…', '💳'); setTimeout(() => { location.href = m.url; }, 300); break;
    case 'godfind': godFindRes = m; if (panel?.kind === 'god') refreshPanel(true); break;
    case 'quiz': {                                  // classroom pop quiz
      document.querySelectorAll('.req.quiz').forEach(e => e.remove()); if (m.end) break;
      const d = popup(`${m.teacher ? '👩‍🏫 <b>อาจารย์เรียกตอบ!</b>' : '📝 <b>ควิซประจำคาบ</b>'} <small>(${m.sec} วินาที)</small><br>${esc(m.q)}`, m.o.map((txt, i) => [txt, 'good', () => send({ t: 'quizans', i })]), m.sec * 1000);
      d.classList.add('quiz'); FX.play('ding'); break; }
    case 'bite': fishBiteT = performance.now(); FX.play('bite'); if (navigator.vibrate) navigator.vibrate([60, 40, 90]); if (bobber) { FX.ring(bobber.x, bobber.y, '#fff', 600, 1.1); FX.burst(bobber.x, bobber.y, '#dff4ff', 10); } break;
    case 'hooked': fightStart(m.fight); break;
    case 'mt': misLive = m; break;
    case 'ck': ckLive = { prog: m.prog, t: performance.now() }; break;
    case 'kfx': cookFx(m.kind); break;
    case 'rb': rbResult(m); break;
    case 'trashrun': runStart(m.seed); break;
    case 'rbfx': FX.play('notice'); if (navigator.vibrate) navigator.vibrate([40, 40, 40]); break;
    case 'afx': if (m.kind === 'gavel') { FX.play('ding'); } else if (m.kind === 'bid') FX.play('pop'); else if (m.kind === 'win') { FX.play('coin', true); FX.play('levelup'); } else if (m.kind === 'lose') FX.play('fail'); else FX.play('notice'); if (panel?.kind === 'warehouse') refreshPanel(true); break;
    case 'mq': misAsk(m); break;
    case 'mfx': if (m.kind === 'pick') { FX.play('pop'); } else if (m.kind === 'catch') { FX.play('pet', ['squeak', 1]); FX.play('chime'); } else FX.play('ding'); if (navigator.vibrate) navigator.vibrate(25); break;
    case 'req': showReq(m); break;
    case 'ring': showRing(m); break;
    case 'call': {
      if (m.open) { call = { with: m.with, phone: m.phone, fee: m.fee || 0, payer: !!m.payer, paid: 0, mins: 0, unread: 0 }; callLog.length = 0; FX.play('chime'); openPanel({ kind: 'phone', tab: 'call' }); }
      else { if (call) toast(`📞 ${m.why || 'วางสายแล้ว'}`, '📵', false); call = null; if (panel?.kind === 'phone') refreshPanel(true); }
      paintCallChip(); break;
    }
    case 'call_msg': {
      callLog.push(m); if (callLog.length > 50) callLog.shift();
      if (!m.me) {
        const c = { call: 1, name: m.name, text: m.text }; chatLog.push(c); paintChatBox(c); FX.play('pop');
        // call window minimised: count it on the chip and show the line over your head
        if (call && !(panel?.kind === 'phone' && panel.tab === 'call')) { call.unread = (call.unread || 0) + 1; toast(`📞 ${m.name}: ${m.text}`, '📞'); if (navigator.vibrate) navigator.vibrate(60); paintCallChip(); }
      }
      if (panel?.kind === 'phone') refreshPanel(true);
      break;
    }
    case 'call_fee': if (call) { call.mins = m.mins; call.paid = m.paid; if (panel?.kind === 'phone') refreshPanel(true); } break;
    case 'dtest': showDriveTest(m); break;
    case 'emo': { const s = P.get(m.id); if (s) { s.emo = m.e; s.emoT = performance.now() + 4200; } if (m.id !== myId) FX.play('pop'); break; }
    case 'bugs': bugList = m.list; if (panel?.kind === 'god') refreshPanel(true); break;
    case 'reset': try { localStorage.removeItem('lt_tut2'); } catch { } guide = null; setTimeout(() => showTut(0), 600); break;
    case 'crave': FX.play('ding'); break;
    case 'ach': FX.play('levelup'); { const s = P.get(myId); if (s) { FX.burst(s.x, s.y, '#ffd34d', 24); FX.ring(s.x, s.y, '#ffd34d', 900, 1.6); } } break;
    case 'daily': if (tutPending) pendingDaily = m; else setTimeout(() => showDaily(m), 700); break;
    case 'quest': {
      const s = P.get(myId);
      if ((m.kind === 'done' || m.kind === 'wdone') && QUEST_GIVER[m.type]) questPop(m.type, m.text, QUEST_GIVER[m.type].thx, m.reward);
      if (m.kind === 'wdone') { toast(`เควสต์รายสัปดาห์สำเร็จ: ${m.text} · รางวัล ${money(m.reward)}`, '🗓️'); FX.play('levelup'); break; }
      if (m.kind === 'wall') { toast(`ทำเควสต์รายสัปดาห์ครบทั้งหมด! โบนัส ${money(m.reward)} 🎉`, '🗓️'); FX.play('chime'); if (s) FX.burst(s.x, s.y, '#7fd3ff', 30); break; }
      if (m.kind === 'done') { toast(`เควสต์สำเร็จ: ${m.text} · รางวัล ${money(m.reward)}`, '📜'); FX.play('levelup'); if (s) { FX.ring(s.x, s.y, '#ffd34d', 900, 1.4); FX.float(s.x, s.y - .7, 'เควสต์สำเร็จ!', '#ffd34d', .5); } }
      else { toast(`ทำเควสต์ครบทั้ง 3 ข้อ! โบนัส ${money(m.reward)} · ติดต่อกัน ${m.streak} วัน 🔥`, '🏆'); setTimeout(() => FX.play('chime'), 500); if (s) { FX.burst(s.x, s.y, '#ffd34d', 30); FX.ring(s.x, s.y, '#ffffff', 1100, 2.2); } }
      break;
    }
    case 'trade': {
      if (m.open && !trade) FX.play('pop');
      trade = m.open ? m : null;
      if (!m.open && m.reason) { const ok = m.reason.startsWith('✅'); toast(m.reason, '🤝', ok); if (ok) FX.play('chime'); else FX.play('fail'); }
      renderTrade(); break;
    }
  }
}
// ---- the chat box under the status card: tabs, foldable, type straight into it
let cbTab = 'all', cbFolded = false, cbUnread = 0;
try { cbFolded = localStorage.getItem('lt_cb') === '1'; } catch { }
const cbShow = m => cbTab === 'all' ? !m.sys : (cbTab === 'sys' ? m.sys : cbTab === 'world' ? m.w : cbTab === 'gang' ? m.g : !m.sys && !m.w && !m.g);
function paintChatBox(added) {
  const box = $('#cbMsgs'); if (!box) return;
  box.innerHTML = chatLog.filter(cbShow).slice(-40).map(m => m.sys ? `<div class="sys">• ${esc(m.text)}</div>`
    : `<div class="${m.call ? 'call' : m.g ? 'g' : m.w ? 'w' : ''}">${m.call ? '📞 ' : m.g ? '🏴 ' : m.w ? '🌐 ' : ''}<b${m.adm ? ' class="admN"' : ''}>${m.adm ? '👑 ' : ''}${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('') || '<div class="sys">ยังไม่มีข้อความ</div>';
  box.scrollTop = box.scrollHeight;
  if (added && cbFolded && !added.sys) { cbUnread++; $('#cbNew').textContent = cbUnread; }
}
function foldChat(f) {
  cbFolded = f; $('#chatBox').classList.toggle('hidden', f); $('#cbOpen').classList.toggle('hidden', !f);
  if (!f) { cbUnread = 0; $('#cbNew').textContent = ''; paintChatBox(); }
  try { localStorage.setItem('lt_cb', f ? '1' : '0'); } catch { }
}
$('#cbFold').onclick = () => { FX.play('click'); foldChat(true); };
$('#cbOpen').onclick = () => { FX.play('click'); foldChat(false); };
document.querySelectorAll('#chatBox [data-ct]').forEach(b => b.onclick = () => {
  cbTab = b.dataset.ct; document.querySelectorAll('#chatBox [data-ct]').forEach(x => x.classList.toggle('on', x === b));
  $('#cbIn').placeholder = cbTab === 'gang' ? (me?.gang ? 'แตะเพื่อพิมพ์ · แชทแก๊ง (เห็นแค่สมาชิก)' : 'ยังไม่มีแก๊ง · เข้าร่วมได้ในแอป 🏴') : cbTab === 'world' || cbTab === 'all' ? 'แตะเพื่อพิมพ์ · แชทโลก (ทุกคนในเมืองเห็น)' : 'แตะเพื่อพิมพ์ · คุยกับคนใกล้ๆ';
  paintChatBox();
});
$('#cbForm').onsubmit = e => { e.preventDefault(); const i = $('#cbIn'); if (!i.value.trim()) return; const ch = cbTab === 'gang' ? 'gang' : cbTab === 'world' || cbTab === 'all' ? 'world' : 'near'; if (ch !== 'gang' && !worldOk(ch)) return; send({ t: 'chat', text: i.value, ch }); i.value = ''; i.blur(); };
foldChat(cbFolded);
// the chat window can be dragged anywhere (by its ⠿ grip, or the folded 💬 button); one spot per screen orientation
{
  const feed = $('#feed'), key = () => 'lt_cbpos_' + (innerWidth > innerHeight ? 'l' : 'p');
  const place = (x, y) => {
    const w = feed.offsetWidth || 200, h = Math.max(40, feed.offsetHeight || 40);
    x = Math.max(0, Math.min(innerWidth - Math.min(w, 120), x)); y = Math.max(0, Math.min(innerHeight - Math.min(h, 40), y));
    feed.style.setProperty('left', x + 'px', 'important'); feed.style.setProperty('top', y + 'px', 'important'); return [x, y];
  };
  const load = () => { let v = null; try { v = JSON.parse(localStorage.getItem(key()) || 'null'); } catch { }
    if (v) place(v[0], v[1]); else { feed.style.removeProperty('left'); feed.style.removeProperty('top'); } };
  let moved = false;
  const drag = el => el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const r = feed.getBoundingClientRect(), sx = e.clientX, sy = e.clientY; moved = false; let last = null;
    const mv = ev => { if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; moved = true; ev.preventDefault(); last = place(r.left + ev.clientX - sx, r.top + ev.clientY - sy); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (moved && last) try { localStorage.setItem(key(), JSON.stringify(last)); } catch { } };
    addEventListener('pointermove', mv, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  drag($('#cbGrip')); drag($('#cbOpen'));
  $('#cbOpen').addEventListener('click', e => { if (moved) { moved = false; e.stopImmediatePropagation(); foldChat(true); } }, true);   // a drag is not a tap
  $('#cbGrip').ondblclick = () => { try { localStorage.removeItem(key()); } catch { } load(); };
  addEventListener('resize', () => setTimeout(load, 60)); load();
}
function logLine(html, cls, bubbleOnly) {
  const l = $('#log'); const d = document.createElement('div');
  if (cls) d.className = cls; d.innerHTML = html;
  l.appendChild(d); setTimeout(() => d.remove(), 9000); while (l.children.length > 5) l.firstChild.remove();
}

// ------------------------------------------------------------------ toasts and popups
const recentToasts = new Map();
function toast(msg, icon = '✅', ok = true) {
  // never stack the same message: identical text within 8 s is dropped
  const key = icon + msg, t0 = performance.now();
  if (recentToasts.get(key) > t0 - 8000) return;
  recentToasts.set(key, t0); if (recentToasts.size > 50) recentToasts.delete(recentToasts.keys().next().value);
  // notices float above your own character's head (the CBT ticker stays at the top of the screen)
  // notices pop up in the middle of the screen, as the same card as the fishing cue
  const box = $('#notices'), d = document.createElement('div'), life = Math.min(7000, 3200 + msg.length * 45);
  d.className = 'notice' + (ok ? '' : ' bad'); d.innerHTML = `<b>${esc(icon)}</b><small>${esc(msg)}</small>`;
  d.style.animationDuration = `.25s, ${life}ms`;
  box.prepend(d); while (box.children.length > 2) box.lastChild.remove();
  setTimeout(() => d.remove(), life);
}
const heads = [];
const wrapCache = new Map();
function wrapText(text, maxW) {   // cached: the same bubble is wrapped every frame while it is shown
  const key = ctx.font + '|' + maxW + '|' + text, hit = wrapCache.get(key); if (hit) return hit;
  const r = wrapRaw(text, maxW); if (wrapCache.size > 300) wrapCache.clear(); wrapCache.set(key, r); return r;
}
function wrapRaw(text, maxW) {
  const out = []; let line = '';
  for (const ch of [...text]) { const tryL = line + ch; if (textW(tryL) > maxW && line) { out.push(line); line = ch.trim() ? ch : ''; } else line = tryL; }
  if (line) out.push(line); return out.slice(0, 4);
}
function drawHeads(X, Y) {
  const m = P.get(myId), now = performance.now(); if (!m) { heads.length = 0; return; }
  for (let i = heads.length - 1; i >= 0; i--) if (now - heads[i].t > heads[i].life) heads.splice(i, 1);
  if (!heads.length) return;
  const fs = clamp(Math.round(TS * .26), 12, 15), lh = fs * 1.35, maxW = Math.min(VW - 40, 340);   // same card look as the fishing cue: dark, gold rim
  ctx.save(); ctx.font = `600 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let by = (m.ry + (m.oy || 0)) * TS + Y - TS * 2.15 - (m.pose ? 0 : 0);
  const cx = clamp((m.rx + (m.ox || 0)) * TS + X, maxW / 2 + 8, VW - maxW / 2 - 8);
  for (let i = heads.length - 1; i >= 0; i--) {                    // newest closest to the head, older ones above
    const h = heads[i], age = now - h.t, a = Math.min(1, age / 180, (h.life - age) / 450);
    const lines = wrapText(h.text, maxW - 28), w = Math.max(...lines.map(l => textW(l))) + 28, hh = lines.length * lh + 14;
    by -= hh + 4; const y = by + (1 - Math.min(1, age / 180)) * 8;
    ctx.globalAlpha = Math.max(0, a);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = h.ok ? 'rgba(48,30,12,.9)' : 'rgba(70,22,14,.92)'; ctx.beginPath(); ctx.roundRect(cx - w / 2, y, w, hh, 13); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = h.ok ? '#d9b25a' : '#e0574a'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#fff6e0'; lines.forEach((l, k) => ctx.fillText(l, cx, y + 7 + lh * (k + .5)));
  }
  ctx.restore();
}
function siamsiPop(m) {   // fortune sticks: a shaking cylinder, then the stick number and its slip
  const c = { 'ดีมาก': '#2f9e44', 'ดี': '#3b8ed0', 'ปานกลาง': '#c9851a' }[m.luck] || '#555';
  popup(`<div class="siamsi"><div class="ssTube">🥢</div><div class="ssNo">เซียมซีใบที่ <b>${m.n}</b></div><div class="ssLuck" style="background:${c}">${esc(m.luck)}</div><div class="ssText">${esc(m.text)}</div></div>`, [['🙏 สาธุ', 'good', () => { }]], 30000);
}
function popup(html, buttons, ms = 20000) {
  const d = document.createElement('div'); d.className = 'req';
  d.innerHTML = `<div>${html}</div><div class="btns"></div>`;
  for (const [label, cls, fn] of buttons) { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = () => { fn(); d.remove(); }; d.querySelector('.btns').appendChild(b); }
  $('#reqs').appendChild(d); setTimeout(() => d.remove(), ms);
  return d;
}
function showReq(r) {
  const what = r.kind === 'hop' ? 'ขอซ้อนท้าย / ขึ้นรถของคุณ 🛵🚗' : r.kind === 'trade' ? 'ขอแลกเปลี่ยนของกับคุณ 🤝' : r.kind === 'phone' ? 'ขอเบอร์โทรของคุณ 📱 (ตกลง = แลกเบอร์กัน)' : `เสนอปฐมพยาบาลให้คุณ 💉 ค่ารักษา <b>${money(r.fee)}</b>`;
  popup(`<b>${esc(r.from.name)}</b> ${CAREER_ICON(r.from.c)} ${what}`, [['ตกลง', 'good', () => send({ t: 'req_ans', id: r.id, ok: true })], ['ปฏิเสธ', 'warn', () => send({ t: 'req_ans', id: r.id, ok: false })]]);
  FX.play('ding');
}
function showRing(r) {
  popup(`📞 สายเรียกเข้าจาก <b>${esc(r.name)}</b> <small>(${r.phone}${r.known ? '' : ' · ไม่อยู่ในรายชื่อ'})</small>`, [['📞 รับสาย', 'good', () => send({ t: 'req_ans', id: r.id, ok: true })], ['ไม่รับ', 'warn', () => send({ t: 'req_ans', id: r.id, ok: false })]], 25000);
  FX.play('ding'); setTimeout(() => FX.play('ding'), 600); if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
function paintCallChip() { const c = $('#callChip'); if (call) { c.classList.remove('hidden'); c.classList.toggle('unread', !!call.unread); c.textContent = call.unread ? `📞 ${call.with} · 💬 ${call.unread} ใหม่` : `📞 คุยกับ ${call.with}`; } else c.classList.add('hidden'); }
function paintDogChip() {
  const c = $('#dogChip'), q = me?.dogq;
  if (!q) return c.classList.add('hidden');
  const left = Math.max(0, Math.ceil((q.until - Date.now() - clockOff) / 1000));
  const tm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  c.classList.remove('hidden'); c.classList.toggle('late', left < 30); c.innerHTML = `${esc(q.kind === 'thief' ? `🚨 จับโจร ${q.name} · ${tm}` : `🐕 ตามหา น้อง${q.name} · ${tm}`)}<span class="chipX" data-x="dog">✕</span>`;
  document.querySelectorAll('.dogcd').forEach(el => { el.textContent = tm; });
}
setInterval(paintDogChip, 500);
const quitAsk = (txt, go) => popup(txt, [['ยกเลิกเลย', 'warn', go], ['ทำต่อ', 'good', () => { }]], 10000);
$('#dogChip').addEventListener('click', e => { if (!e.target.closest('.chipX')) return; e.stopImmediatePropagation(); const q = me?.dogq; if (q) quitAsk(q.kind === 'thief' ? `ยกเลิกเคสจับโจร "${esc(q.name)}"?` : `ยกเลิกเคสตามหาน้อง${esc(q.name)}?`, () => send({ t: 'questquit' })); }, true);
$('#misChip').addEventListener('click', e => { if (!e.target.closest('.chipX')) return; e.stopImmediatePropagation(); const m = me?.mis; if (m) quitAsk(`ยกเลิกภารกิจ "${esc(m.title)}"?`, () => send({ t: 'mission', op: 'quit' })); }, true);
$('#dogChip').onclick = () => { const q = me?.dogq; if (q) popup(`🐕 ตามหา "น้อง${q.name}" ของ${q.owner}<br>📍 แถว ${q.hint} · ดูวงสีเหลืองบนมินิแมพ ฟังเสียงเห่า`, [['ตกลง', 'good', () => { }]], 8000); };
$('#cbOn').onclick = () => openPanel({ kind: 'friends' });
$('#callChip').onclick = () => openPanel({ kind: 'phone', tab: 'call' });
const CAREER_ICON = c => G?.careers[c]?.icon || '';

// ------------------------------------------------------------------ HUD
function paintCardClock(h) {
  const dt = me?.date; if (dt) $('#cDate').textContent = `${dt.day} ${G.months[dt.month]}`;
  $('#cTime').textContent = hhmm(h);
  if (wd) { const t = `${wd.on}<i> ออนไลน์</i>`; if ($('#cbOn').innerHTML !== t) $('#cbOn').innerHTML = t; }
  $('#cWx').textContent = wd?.ev?.id === 'rain' ? '🌧️' : h >= 19 || h < 6 ? '🌙' : h < 8 || h >= 17 ? '⛅' : '☀️';
}
// today's quests listed in the card: tap one and you walk there by yourself
function paintQuestBox() {
  const q = me.quests, box = $('#qList'); if (!q || !box) return;
  const done = q.list.filter(x => x.done).length; $('#qCount').textContent = `${done}/3`;
  const first = q.list.findIndex(x => !x.done);
  const html = q.list.map((x, i) => {
    const tgt = x.type === 'earn' ? CAREER_TARGET[me.career] : QUEST_TARGET[x.type];
    return `<button class="qRow ${x.done ? 'done' : ''} ${i === first ? 'cur' : ''}" data-q="${x.done ? '' : tgt || ''}"><i>${x.done ? '☑' : i === first ? '◆' : '☐'}</i><span>${esc(x.text)} <small>(${Math.min(x.p, x.n)}/${x.n})</small>${i === first && tgt ? '<em>› แตะเพื่อเดินไปอัตโนมัติ</em>' : ''}</span></button>`;
  }).join('') + `<button class="qRow rew" data-open-r="1"><i>🎁</i><span>รางวัลความคืบหน้า${achTodo().length ? ' <i class="dot"></i>' : ''} <small>เข้าเกม ${me.login?.streak || 0} วันติด</small></span></button><button class="qRow more" data-open-q="1"><span>ดูเควสต์ทั้งหมด ›</span></button>`;
  if (box.dataset.h === html) return; box.dataset.h = html; box.innerHTML = html;
  box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { FX.play('click'); if (b.dataset.q) setGuide(b.dataset.q, false, true); else openPanel({ kind: 'quests' }); });
  box.querySelector('[data-open-q]').onclick = () => { FX.play('click'); openPanel({ kind: 'quests' }); };
  box.querySelector('[data-open-r]').onclick = () => { FX.play('click'); openPanel({ kind: 'rewards' }); };
}
function paintHud() {
  if (!me) return;
  const c = G.careers[me.career];
  if ((me.docjob?.dest || '') !== (window.__docDest || '')) { window.__docDest = me.docjob?.dest || ''; if (me.docjob) setGuide(me.docjob.dest, true); }   // a new envelope: point the way
  $('#card').classList.toggle('admin', !!me.admin); $('#godBtn').classList.toggle('hidden', !me.admin);
  $('#meCareer').textContent = me.career === 'none' ? '🙂 ว่างงาน' : `${c.icon} ${c.name} Lv.${me.lv}`;
  // ring around the portrait: progress to the next job level
  const jx = me.jx, pct = !jx ? 0 : jx.max ? 100 : Math.min(100, jx.cur / jx.need * 100);
  $('#jx').classList.toggle('hidden', !jx);
  if (jx) {
    $('#jxL').textContent = `EXP ${c.name} Lv.${jx.L}${jx.pay ? ` · เงิน +${jx.pay}%` : ''}`;
    $('#jxV').textContent = jx.max ? 'MAX' : me.career === 'office' ? `${jx.cur}/${jx.need} กะ` : `${(+jx.cur).toFixed(1)}/${jx.need}${jx.gain < 100 ? ` · ได้ ${jx.gain}%` : ''}`;
    $('#jxU').style.width = pct + '%';
  }
  $('#lvRing').style.background = `conic-gradient(#ffc94d ${pct}%, rgba(255,255,255,.12) 0)`; $('#lvPct').textContent = `★ ${pct.toFixed(1)}%`;
  paintQuestBox();
  // status pills (icons from the UI sheet where we have one)
  const ic = (f, alt) => f ? `<img src="assets/ui/${f}.png" alt="">` : alt;
  const DZ_IC = { cold: 'i_cold', flu: 'i_cold', poison: 'i_belly', insomnia: 'i_sleepy', exhaust: 'i_sad', malnut: 'i_meal' };
  const chips = (me.dz || []).map(d => `<span class="chip bad" data-dz="${d}">${ic(DZ_IC[d], G.diseases[d].icon)} ${G.diseases[d].name}</span>`);
  if (me.awake > 32 * 60 && !(me.dz || []).includes('insomnia')) chips.push(`<span class="chip warnc" data-dz="_sleepy">${ic('i_sleepy')} ง่วงนอน</span>`);
  if (me.hunger < 20) chips.push(`<span class="chip warnc" data-dz="_hungry">${ic('i_leg')} หิวมาก</span>`);
  if (me.happy < 20) chips.push(`<span class="chip bad" data-dz="_sad">${ic('i_sad')} ซึมเศร้า</span>`);
  if (me.craving) chips.push(`<span class="chip crave" data-dz="_crave">${ic('i_bulb')} อยากกิน${G.items[me.craving.item].icon}${esc(G.items[me.craving.item].name)}</span>`);
  if (me.desk >= 0 && me.enrolled) chips.push(`<span class="chip study" data-dz="_study">📖 เรียนอยู่ ${Math.round((me.study || 0) * 100)}%</span>`);
  if (me.licExp?.driving && me.licExp.driving < Date.now() + clockOff) chips.push('<span class="chip bad" data-dz="_lic">🪪 ใบขับขี่หมดอายุ</span>');
  if (me.utilOff) chips.push('<span class="chip bad" data-dz="_bills">🔌 ถูกตัดน้ำไฟ</span>');
  else if ((me.bills || []).length) chips.push(`<span class="chip warnc" data-dz="_bills">🧾 ค้างบิล ${money(me.bills.reduce((s, b) => s + b.water + b.elec, 0))}</span>`);
  $('#statusBox').classList.toggle('hidden', !chips.length);
  { const n = me.mailN || 0, f = $('#mailFab'); if (f) { f.classList.toggle('hidden', !n); $('#mailFabN').textContent = n > 9 ? '9+' : n; if (!f.onclick) f.onclick = () => openPanel({ kind: 'mail' }); } }
  paintPortrait(); $('#phoneBtn').classList.toggle('has', (me.mailN || 0) > 0 || (me.bills || []).length > 0 || achTodo().length > 0);
  const dzBox = $('#dzChips'); const html = chips.join('');
  if (dzBox.dataset.h !== html) { dzBox.dataset.h = html; dzBox.innerHTML = html; dzBox.querySelectorAll('[data-dz]').forEach(c => c.onclick = () => dzInfo(c.dataset.dz)); }
  $('#meMoney').textContent = me.monInf ? '∞' : Math.round(me.money).toLocaleString('en-US'); $('#meGems').textContent = me.gemInf ? '∞' : (me.gems || 0).toLocaleString('en-US');
  const qs = me.quests; if (qs) { const d = qs.list.filter(x => x.done).length; const ql = $('#qline'); ql.textContent = d === 3 ? 'เควสต์ครบแล้ว ✅' : `เควสต์ ${d}/3 · กดดู`; ql.classList.toggle('all', d === 3); }
  $('#bJ').style.width = (me.happy ?? 80) + '%'; $('#vJ').textContent = Math.floor(me.happy ?? 80);
  $('#bJ').style.background = me.happy < 20 ? '#7d7d9c' : me.happy < 45 ? '#d9a94a' : '#f08ad0';
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
  $('#vE').textContent = Math.floor(me.energy); $('#vH').textContent = Math.floor(me.hunger); $('#vL').textContent = Math.floor(me.health);
  { const fun = me.pose === 'fun', bed = me.pose === 'bed';   // ▶▶ next to the bars that are filling fast (park rides, sleeping)
    for (const [k, on] of [['energy', (fun || bed) && me.energy < 100 || (me.pose === 'seat' || me.pose === 'rest') && me.energy < 50], ['health', fun && me.health < 100], ['happy', fun && (me.happy ?? 80) < 100]]) document.querySelector(`.bar[data-bar="${k}"]`)?.classList.toggle('boost', !!on); }
  $('#card').style.borderLeftColor = COLORS[me.avatar ?? 0] || '#999';
  placeLog();
  $('#restBtn').classList.toggle('on', me.pose === 'rest');
  const atDesk = me.career === 'office' && me.chair != null && me.chair >= 0 || me.desk != null && me.desk >= 0; $('#mgBtn').classList.add('hidden'); if (!$('#mg').classList.contains('hidden') && !JG.cur && !$('#mgBody .mgEnd') && !$('#gLinkBtn')) mgClose();   // (mini-games were removed)
  if (!placing && !picking) $('#restBtn').innerHTML = me.pose === 'rest' ? '<span>🧍</span><small>ลุก</small>' : '<span>😌</span><small>พัก</small>';
  $('#begBtn').classList.toggle('hidden', !job('beggar'));
  $('#begBtn').classList.toggle('on', me.pose === 'beg');
  $('#begBtn').innerHTML = me.pose === 'beg' ? '<span>🧍</span><small>ลุก</small>' : '<span>🥣</span><small>ขอทาน</small>';

  paintNav();
  $('#phoneBtn').classList.toggle('has', job('rider') && (me.jobs || []).some(j => j.state === 'open'));
  const dn = $('#downView');
  if (me.down) {
    dn.classList.remove('hidden');
    paintDown();
  } else dn.classList.add('hidden');
}
// knocked out / jailed: show what is happening and when it ends
function paintDown() {
  const dn = $('#downView'); if (!me?.down) return;
  const left = me.down.until ? Math.max(0, Math.ceil((me.down.until - Date.now() - clockOff) / 1000)) : 0, mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  dn.innerHTML = me.down.kind === 'veg' ? `<b>🥬 หิวจนหมดแรง นอนเป็นผัก</b><span>ฟื้นในอีก <b class="big-cd">${mm}</b></span>`
    : me.down.kind === 'jail' ? `<b>⛓️ ติดคุกอยู่ที่สถานีตำรวจ</b><span>พ้นโทษในอีก <b class="big-cd">${mm}</b></span>`
    : `<b>🚑 หมดสติอยู่บนเตียงโรงพยาบาล</b><span>พักฟื้นสักครู่ เจ้าหน้าที่กำลังรักษาให้</span><span>ฟื้นในอีก <b class="big-cd">${mm}</b> · รักษาโรคให้หายด้วย${me.down.free ? ' · <b>ฟรี 💚</b>' : ''}</span>`;
}
setInterval(() => { if (me?.down) paintDown(); }, 500);
function paintEvent() {
  const e = $('#eventBar');
  if (wd?.ev) { if (e.dataset.t !== wd.ev.text) { e.dataset.t = wd.ev.text; e.innerHTML = `<span>${esc(wd.ev.text)}</span>`; }
    requestAnimationFrame(() => { const sp = e.firstElementChild; if (sp) e.classList.toggle('still', sp.offsetWidth <= e.clientWidth - 16); }); e.classList.remove('hidden'); } else { e.classList.add('hidden'); e.dataset.t = ''; }
  document.body.classList.toggle('hasEvent', !!wd?.ev);
}
// same clock as the server: days are slow, nights run twice as fast (server/data.js CLOCK)
const hourOfPhase = m => { const c = G.clock || { dawn: 0, dusk: 24, dayMin: 24 }, dayH = c.dusk - c.dawn; return m < c.dayMin ? c.dawn + m * dayH / c.dayMin : (c.dusk + (m - c.dayMin) * (24 - dayH) / (24 - c.dayMin)) % 24; };
const hourNow = () => FORCE_PHASE !== null ? +FORCE_PHASE * 24 : hourOfPhase(((((Date.now() + clockOff + (wd?.toff || 0)) % G.dayMs) + G.dayMs) % G.dayMs) / 60000);
// ---- background music: a day track and a night track (assets/music), cross-faded as the in-game clock turns
window.BGM_EXT = true;
// played through Web Audio (not an <audio> element): phones then don't treat the game as a media player, so the music
// doesn't show up in the notification shade or stop YouTube/Spotify; it mixes in and goes quiet when the game is hidden
const BGM = { vol: .42, buf: {}, src: {}, gain: {}, loading: {} };
function bgmLoad(k, ac) {
  if (BGM.loading[k]) return; BGM.loading[k] = 1;
  fetch(`assets/music/${k}.mp3?v=2`).then(r => r.arrayBuffer()).then(b => new Promise((res, rej) => ac.decodeAudioData(b, res, rej))).then(d => {
    const n = d.length, mono = ac.createBuffer(1, n, d.sampleRate), o = mono.getChannelData(0), L = d.getChannelData(0), R = d.numberOfChannels > 1 ? d.getChannelData(1) : L;
    for (let i = 0; i < n; i++) o[i] = (L[i] + R[i]) * .5;   // mono: half the memory on phones
    BGM.buf[k] = mono; BGM.loading[k] = 0;
  }).catch(() => { setTimeout(() => { BGM.loading[k] = 0; }, 15000); });
}
function bgmTick() {
  const ac = FX.ctx(); if (!G || !me || !ac || ac.state !== 'running') return;   // audio starts after the first tap
  const h = hourNow(), want = FX.opts.music ? (h >= 6 && h < 18.5 ? 'day' : 'night') : null;
  for (const k of ['day', 'night']) {
    const target = k === want ? BGM.vol : 0;
    if (target > 0 && !BGM.src[k]) {
      if (!BGM.buf[k]) { bgmLoad(k, ac); continue; }
      const g = ac.createGain(), s = ac.createBufferSource(); g.gain.value = 0; g.connect(ac.destination); s.buffer = BGM.buf[k]; s.loop = true; s.connect(g); s.start();
      BGM.src[k] = s; BGM.gain[k] = g;
    }
    const g = BGM.gain[k]; if (!g) continue;
    g.gain.value = Math.max(0, g.gain.value + (target - g.gain.value) * .06);
    if (target === 0 && g.gain.value < .01) { try { BGM.src[k].stop(); } catch { } BGM.src[k].disconnect(); g.disconnect(); BGM.src[k] = BGM.gain[k] = null; BGM.buf[k] = null; }   // faded out: let the buffer go
  }
}
setInterval(bgmTick, 100);
const dayNow = () => { const c = G.clock || { dawn: 0, dusk: 24, dayMin: 24 }, mid = (c.dayMin + (24 - c.dusk) * (24 - c.dayMin) / (24 - (c.dusk - c.dawn))) * 60000; return Math.floor((Date.now() + clockOff + (wd?.toff || 0) + G.dayMs - mid) / G.dayMs); };
const isInside = rid => { const m = P.get(myId); return !!m && roomOf(m.x, m.y)?.id === rid; };
const FORCE_PHASE = new URLSearchParams(location.search).get('phase');   // ?phase=0.95 previews a time of day
const isOpen = (kind, h = hourNow()) => { const o = G?.hours[kind]; return !o || (h >= o[0] && h < o[1]); };
setInterval(() => {
  if (!wd || !G) return;
  const h = hourNow();
  paintCardClock(h);
  const dt = me?.date; $('#clock').innerHTML = `${dt ? `<span>📅 ${dt.day}/${G.monthDays} ${G.months[dt.month]}</span><i> · </i>` : ''}<span>🕐 ${hhmm(h)} · 👥 ${wd.on}</span>`;
  document.querySelectorAll('.qcd').forEach(el => {
    const s = Math.max(0, Math.floor((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = s >= 86400 ? `${Math.floor(s / 86400)} วัน ${Math.floor(s % 86400 / 3600)} ชม.` : `${Math.floor(s / 3600)} ชม. ${Math.floor(s % 3600 / 60)} นาที`;
  });
  document.querySelectorAll('.cd').forEach(el => {
    const left = Math.max(0, Math.ceil((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = left > 0 ? `อีก ${left >= 60 ? Math.floor(left / 60) + ' นาที ' : ''}${left % 60} วิ` : 'พร้อมเก็บเกี่ยว!';
  });
}, 500);

document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => b.dataset.open === 'chat' ? openChatBox() : openPanel({ kind: b.dataset.open }));
function openChatBox() { foldChat(false); setTimeout(() => $('#cbIn').focus(), 30); }
$('#panelX').onclick = closePanel;
$('#mini').onclick = () => { if (!G) return; mapZoom = 1; openMap(); };
// the status card folds down to a small strip (face, money, slim bars); folded by default on phones
const placeLog = () => { const cd = $('#card'), db = $('#docBack'); $('#feed').style.top = (cd.offsetTop + cd.offsetHeight + (guide ? 36 : 6) + (db && !db.classList.contains('hidden') ? 34 : 0)) + 'px'; document.body.style.setProperty('--cardW', (cd.offsetLeft + cd.offsetWidth) + 'px'); const tr = $('#topRight'); if (tr) document.body.style.setProperty('--miniW', tr.offsetWidth + 'px'); };
addEventListener('resize', () => placeLog());
const setCard = mini => { $('#card').classList.toggle('mini', mini); placeLog(); try { localStorage.setItem('lt_card', mini ? '1' : '0'); } catch { } };
$('#cardToggle').onclick = e => { e.stopPropagation(); FX.play('click'); setCard(!$('#card').classList.contains('mini')); };
{ let c = null; try { c = localStorage.getItem('lt_card'); } catch { } setCard(c === null ? innerWidth < 700 && innerHeight > innerWidth : c === '1'); }
// what each bar means and how to fill it
const BAR_HELP = {
  energy: ['⚡', 'พลังงาน: ใช้ตอนทำงาน/ตกปลา/เรียน · เพิ่มได้จาก 🎡 เล่นเครื่องเล่นในสวนสนุก หรือ 🛏️ นอนที่เตียงในบ้าน · 🪑 นั่งพักฟื้นได้นิดหน่อยถึงครึ่งหลอด (อาหารไม่เพิ่มพลังงาน)'],
  hunger: ['🍗', 'ความอิ่ม: ลดลงเรื่อยๆ · เพิ่มได้จากการกินอาหาร (ร้านอาหาร ตลาด สั่งในมือถือ หรือของในกระเป๋า 🎒) ถ้าหิวนานเลือดจะลด'],
  health: ['❤️', 'สุขภาพ: ลดเมื่อหิวนานหรือป่วย · เพิ่มได้จาก 🎡 สวนสนุก (สระว่ายน้ำดีที่สุด), กินให้อิ่มเกิน 60, ชุดปฐมพยาบาล 🩹, นอนเตียงให้หมอรักษา'],
  happy: ['😊', 'ความสุข: ลดลงเรื่อยๆ ถ้าต่ำกว่า 20 จะทำงานไม่ได้ · เพิ่มได้จากกินของที่อยากกิน 🤤, นั่งม้านั่งที่จัตุรัส, คุยแชท, โทรหาเพื่อน, บริจาคให้ขอทาน, นอนบ้านตัวเอง'],
};
document.querySelectorAll('[data-bar]').forEach(b => b.onclick = e => { e.stopPropagation(); const [ic, t] = BAR_HELP[b.dataset.bar]; FX.play('click'); popup(`${ic} ${t}`, [['เข้าใจแล้ว', 'good', () => {}]], 12000); });
// cancel the yellow guide arrow (button under the status card)
function paintNav() {
  const b = $('#navX');
  if (!guide) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden'); b.textContent = `✖ ยกเลิกนำทาง${guide.label ? ': ' + guide.label : ''}`;
  const cd = $('#card'); b.style.top = (cd.offsetTop + cd.offsetHeight + 4) + 'px';
}
// office runners: after an envelope is delivered, one tap walks you back to the office front desk for the next one
function paintDocBack() {
  const b = $('#docBack'), m = P.get(myId), h = hourNow(), r = m && areaOf(m.x, m.y);
  const show = me?.career === 'office' && !me.docjob && me.office?.day === dayNow() && me.office?.closed !== dayNow() && h >= G.shift.start && h < G.shift.ot && r?.id !== 'r_office' && guide?.label !== STN('office')?.label;
  const was = !b.classList.contains('hidden'); b.classList.toggle('hidden', !show); if (was !== show) placeLog(); if (!show) return;
  const cd = $('#card'), nx = $('#navX'); b.style.top = (cd.offsetTop + cd.offsetHeight + 4 + (nx.classList.contains('hidden') ? 0 : nx.offsetHeight + 6)) + 'px';
}
$('#docBack').onclick = () => { FX.play('click'); setGuide('office', false, true); paintDocBack(); };
$('#navX').onclick = () => { guide = null; FX.play('click'); paintNav(); placeLog(); toast('ยกเลิกการนำทางแล้ว', '📍'); };
// fullscreen / landscape (Android Chrome & desktop; iOS only via "Add to Home Screen" + the manifest)
async function screenMode(mode) {
  const el = document.documentElement;
  try {
    if (mode === 'exit') { if (document.fullscreenElement) await document.exitFullscreen(); try { screen.orientation.unlock(); } catch { } return; }
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    if (mode === 'landscape') { try { await screen.orientation.lock('landscape'); toast('ล็อกจอแนวนอนแล้ว', '🔄'); } catch { toast('อุปกรณ์นี้ล็อกแนวนอนไม่ได้ หมุนเครื่องเองได้เลย', '🔄', false); } }
    if (mode === 'free') try { screen.orientation.unlock(); } catch { }
  } catch { toast('เบราว์เซอร์นี้เปิดเต็มจอไม่ได้ (iPhone: แชร์ → เพิ่มไปยังหน้าจอโฮม)', '⛶', false); }
  setTimeout(resize, 300);
}
document.addEventListener('fullscreenchange', () => { if (panel?.kind === 'settings') refreshPanel(true); setTimeout(resize, 200); });
// side menu can be folded away (remembered on this device)
$('#mapX').onclick = closeMap;
$('#mapView').addEventListener('pointerdown', e => { if (e.target.id === 'mapView') closeMap(); });
$('#panel').addEventListener('pointerdown', e => { if (e.target === $('#panel')) closePanel(); });
$('#restBtn').onclick = () => { if (!me || me.down) return; FX.play('click'); send({ t: 'rest', on: me.pose !== 'rest' }); };
// running: toggle with the 🏃 button, or hold Shift on a keyboard
let running = false, shiftRun = false, runSetT = 0;
const canRun = () => !!me && me.energy > G.run.minEnergy && !me.down;
function setRun(on) { if (on && wwIsWolf()) on = false; if (on && !canRun()) { if (me) toast('เหนื่อยเกินไป วิ่งไม่ไหว พักหรือกินอะไรก่อน', '🥵', false); on = false; } if (on === running) return; running = on; runSetT = performance.now(); send({ t: 'run', on }); $('#actBtn').classList.toggle('run', on); $('#runBtn').classList.toggle('on', on); }
$('#runBtn').onclick = () => { FX.play('click'); setRun(!running); };
$('#bagBtn').onclick = () => { FX.play('click'); panel?.kind === 'bag' ? closePanel() : openPanel({ kind: 'bag' }); };
$('#begBtn').onclick = () => { if (!me || me.down) return; FX.play('click'); send({ t: 'beg', on: me.pose !== 'beg' }); };
$('#talkBtn').onclick = () => talk();
$('#updBtn').onclick = () => location.reload();
// emoji over your head
const EMOJIS = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '👋', '🙏', '❤️', '🎉', '💤', '❓', '🤔', '😱', '🔥'];
$('#emoPick').innerHTML = EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('');
$('#emoPick').querySelectorAll('[data-e]').forEach(b => b.onclick = () => { send({ t: 'emo', e: b.dataset.e }); $('#emoPick').classList.add('hidden'); });
$('#emoBtn').onclick = () => { FX.play('click'); $('#emoPick').classList.toggle('hidden'); };
// the CBT notice scrolls across the top now and then
const TICKER_DEFAULT = '📢 เซิฟนี้เป็น CBT เมื่อเกมสมบูรณ์ข้อมูลจะถูกรีเซ็ต';
let tickerAnn = '';
function setTicker(text) { tickerAnn = text || ''; $('#ticker').firstElementChild.textContent = tickerAnn ? '📢 ' + tickerAnn : TICKER_DEFAULT; }
function showTicker() { const t = $('#ticker'); if (!G) return; t.classList.remove('hidden'); const sp = t.firstElementChild; sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; setTimeout(() => t.classList.add('hidden'), 16500); }
setTimeout(showTicker, 8000); setInterval(showTicker, 180000);
// away from the keyboard: no touch / key for 2 minutes = "ไม่อยู่"
let lastInput = performance.now(), afkSent = false;
const poke = () => { lastInput = performance.now(); if (afkSent) { afkSent = false; send({ t: 'afk', on: false }); } };
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(e => addEventListener(e, poke, { passive: true, capture: true }));
setInterval(() => { if (G && me && !afkSent && performance.now() - lastInput > 120000) { afkSent = true; send({ t: 'afk', on: true }); } }, 5000);

// ------------------------------------------------------------------ areas & collision
let AREA = {};
const areaOf = (x, y) => G?.areas.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;   // the town comes first: its park / football zones read as 'town'
const zoneOf = (x, y) => G?.areas.find(r => r.in && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)?.id || areaOf(x, y)?.id;
const roomOf = (x, y) => { const a = areaOf(x, y); return a && a.kind === 'room' ? a : null; };
const mapOf = id => { const a = AREA[id]; return a ? (a.kind === 'room' ? a.area : a.id) : 'town'; };
const tileAt = (x, y) => (x < 0 || y < 0 || x >= G.map.w || y >= G.map.h) ? ' ' : G.map.tiles[y][x];
const solid = (x, y) => G.solid.includes(tileAt(Math.floor(x), Math.floor(y)));
// the client checks with the full radius; the server allows a hair less, so rounding never causes a rejection
// home yards: which zone a spot is in, and whether the owner has opened it up yet
const yZone = (x, y) => clamp(Math.floor((x - 1) / G.yard.zw), 0, 2) + 3 * clamp(Math.floor((y - 1) / G.yard.zh), 0, 2);
const yzOpen = (house, z) => G.yard.start.includes(z) || (wd?.houses?.[house]?.[9] || []).includes(z);
const yardLocked = (x, y) => { if (x < G.yard.x0) return false; const a = areaOf(x, y); return !!a?.yard && !yzOpen(a.house, yZone(x - a.x, y - a.y)); };
const blockedAt = (x, y) => { const r = G.radius; return yardLocked(x, y) || solid(x - r, y - r) || solid(x + r, y - r) || solid(x - r, y + r) || solid(x + r, y + r) || roomWalls.some(b => x + r > b[0] && x - r < b[1] && y + r > b[2] && y - r < b[3]); };

// ------------------------------------------------------------------ input
const keys = {};
let joy = null;
// letter keys by their position, so WASD / E / space work with a Thai keyboard layout too
// some keyboards/IMEs send no e.code, only the Thai character: map the Thai Kedmanee keys back to their letters
const TH_KEY = { 'ไ': 'w', 'ฟ': 'a', 'ห': 's', 'ก': 'd', 'ำ': 'e', 'ิ': 'b', 'ร': 'i', 'ท': 'm', 'ๆ': 'q', '้': 'h', 'ย': 'p', 'พ': 'r', 'ด': 'f', 'แ': 'c', 'ะ': 't', '"': 'w', 'ฤ': 'a', 'ฆ': 's', 'ฏ': 'd', 'ฎ': 'e' };
const K = e => /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : e.code === 'Space' ? ' ' : TH_KEY[e.key] || e.key || '';
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) { if (K(e) === 'Escape') e.target.blur(); return; }
  keys[K(e).toLowerCase()] = true;
  if (!G) return;
  if (K(e) === 'e' || K(e) === ' ') { e.preventDefault(); if (FG) { if (!e.repeat) fightPress(); reelHold = true; return; } if (!e.repeat) onAction(); }
  if (K(e) === 'Enter' && !panel) { e.preventDefault(); openChatBox(); }
  if (K(e) === 'Escape') { closePanel(); }
  if (K(e) === 'b' || K(e) === 'i') openPanel({ kind: 'bag' });
  if (K(e) === 'm') { if ($('#mapView').classList.contains('hidden')) { mapZoom = 1; openMap(); } else $('#mapX').click(); }
  if (K(e) === 'q') openPanel({ kind: 'quests' });
  if (K(e) === 'h' || K(e) === '?') openPanel({ kind: 'keys' });
  if (K(e) === 'p') openPanel({ kind: 'phone' });
  if (K(e) === 'r') $('#restBtn').click();
  if (K(e) === 'f') talk();
  if (K(e) === 'Shift' && !running) { shiftRun = true; setRun(true); }
  if (K(e) === 'c' || K(e) === 't' || K(e) === 'Enter' && panel) { e.preventDefault(); openChatBox(); }
});
addEventListener('keyup', e => { keys[K(e).toLowerCase()] = false; if (K(e) === 'e' || K(e) === ' ') reelHold = false; if (K(e) === 'Shift' && shiftRun) { shiftRun = false; setRun(false); } });
const keysUp = () => { for (const k in keys) keys[k] = false; };
addEventListener('blur', keysUp);
document.addEventListener('visibilitychange', keysUp);
document.addEventListener('focusin', e => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) keysUp(); });
document.addEventListener('focusout', keysUp);

const cv = $('#cv'), mainCtx = cv.getContext('2d'); let ctx = mainCtx;   // ctx is swapped to an offscreen canvas while ground chunks are baked
let TS = 40, VW = 0, VH = 0, DPR = 1;
// battery saver (on by default on phones): 30 frames a second, a lighter canvas, no cast shadows, a slower minimap. Phones ran hot at 60 fps.
let ECO = TOUCH_UI; try { const v = localStorage.getItem('lt_eco'); if (v !== null) ECO = v === '1'; } catch { }
// the mouse wheel zooms the town in and out (computers); kept between visits
let zoomMul = 1; try { zoomMul = clamp(+localStorage.getItem('lt_zoom') || 1, .7, 1.6); } catch { }
function resize() {
  DPR = Math.min(ECO ? 1.5 : 2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  TS = Math.round(clamp(Math.min(VW, VH) / 9.5, 34, 54) * zoomMul);   // whole pixels: tile seams stay put while scrolling
}
addEventListener('resize', resize); resize();
cv.addEventListener('wheel', e => { if (!G) return; e.preventDefault(); zoomMul = clamp(zoomMul * (e.deltaY < 0 ? 1.1 : 1 / 1.1), .7, 1.6); try { localStorage.setItem('lt_zoom', zoomMul.toFixed(2)); } catch { } resize(); }, { passive: false });

let down = null, mouseHold = null, lastPtrMouse = false;
cv.addEventListener('pointerdown', e => {
  if (!G) return;
  lastPtrMouse = e.pointerType === 'mouse';
  cv.setPointerCapture(e.pointerId);
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  if ((e.pointerType === 'touch' || e.pointerType === 'pen') && !joy) joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
  else if (e.button === 0) mouseHold = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
});
cv.addEventListener('pointermove', e => {
  if (mouseHold && mouseHold.id === e.pointerId) { mouseHold.x = e.clientX; mouseHold.y = e.clientY; }
  if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.moved = true;
  if (joy && joy.id === e.pointerId) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy), max = 50;
    if (d > max) { joy.ox += dx - dx / d * max; joy.oy += dy - dy / d * max; dx = dx / d * max; dy = dy / d * max; }
    joy.dx = dx / max; joy.dy = dy / max;
    if (down?.moved) { const st = $('#stick'); st.style.display = 'block'; st.style.left = (joy.ox - 60) + 'px'; st.style.top = (joy.oy - 60) + 'px'; st.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`; }
  }
});
const endPtr = e => {
  if (mouseHold && mouseHold.id === e.pointerId) { const held = performance.now() - mouseHold.t > 260; mouseHold = null; if (held && down) down.moved = true; }
  if (down && down.id === e.pointerId) { if (!down.moved && performance.now() - down.t < 350) onTap(e.clientX, e.clientY); down = null; }
  if (joy && joy.id === e.pointerId) { joy = null; $('#stick').style.display = 'none'; }
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
// a popup appearing under your finger used to swallow the touch: always release the stick
addEventListener('pointerup', e => { if (joy && joy.id === e.pointerId) { joy = null; $('#stick').style.display = 'none'; } });

let camLift = 0;
const camRide = { x: 0, y: 0 };
function camera() {
  const m = P.get(myId); let x = m ? (camS.on ? camS.x : m.rx + m.ox) : 50, y = m ? (camS.on ? camS.y : m.ry + m.oy) : 36;
  if (m?.pose === 'fun' && m.fn) { const fo = funPos(m); if (fo) { camRide.x += (fo.x - camRide.x) * .08; camRide.y += (fo.y - 1 - camRide.y) * .08; x = camRide.x; y = camRide.y; } } else if (m) { camRide.x = x; camRide.y = y; }   // on a ride the view follows you, gently
  if (window.__camAt) { x = window.__camAt[0]; y = window.__camAt[1]; return { x: x * TS - VW / 2, y: y * TS - VH / 2 }; }   // automated screenshots only
  const target = panel && !trade && !(VW > VH && VH <= 520) ? VH * 0.24 : 0;   // landscape popups sit in the middle, no lift
  camLift += (target - camLift) * 0.18;
  const a = m ? areaOf(m.x, m.y) : null;
  if (a) {   // keep the view inside the current map/room (you never see past its edge)
    const fit = (pos, lo, size, view) => size * TS + TS * 2 <= view ? lo + size / 2 : clamp(pos, lo + view / TS / 2 - 1, lo + size - view / TS / 2 + 1);
    x = fit(x, a.x, a.w, VW); y = fit(y, a.y - (a.kind === 'room' ? .6 : 0), a.h + (a.kind === 'room' ? 1.2 : 0), VH - camLift * 2);
  }
  return { x: x * TS - VW / 2, y: y * TS - VH / 2 + camLift };
}
// tap the screen: a person under your finger opens their profile (walking somewhere is done from the 🗺️ map)
function onTap(sx, sy) {
  $('#emoPick').classList.add('hidden');
  if (!G || !me || sx == null) return;
  const c = camera(), wx = (sx + c.x) / TS, wy = (sy + c.y) / TS, m = P.get(myId); if (!m) return;
  if (placing) return placeTap(wx, wy);
  if (picking) return pickTap(wx, wy);
  const here = areaOf(m.x, m.y)?.id, myRoom = roomOf(m.x, m.y);
  for (const q of [...PETST.values(), ...(myRoom?.rk === 'petshop' ? shopPets(myRoom) : [])]) {   // petting a pet (yours, someone's or the shop's) makes it hop happily
    if (PETST.get(q.owner) === q && roomOf(q.x, q.y)) continue;   // (pets are hidden indoors)
    if (areaOf(q.x, q.y)?.id !== here || Math.hypot(q.x - wx, (q.y - .35) - wy) > .6) continue;
    return petPlay(q, true);
  }
  let hit = null, hd = .8;
  for (const p of P.values()) {
    if (p.id === myId || p.zb || areaOf(p.x, p.y)?.id !== here) continue;
    const d = Math.hypot(p.rx - wx, (p.ry - .35) - wy); if (d < hd) { hd = d; hit = p; }
  }
  if (hit) { FX.play('click'); if (hit.npc && !hit.bot) return talkToTown(hit); return openPanel({ kind: 'player', pid: hit.id }); }
  if (lastPtrMouse && !me.down) { autoNav = false; walkTo(wx, wy); }   // computers: click the ground to walk there
}
// ---- tap-to-walk: breadth-first path over free tiles of the current area, followed by the movement loop
let autoPath = null, autoNav = false, autoT = 0;
// walking by itself to a place picked on the map: one hop at a time (room exit → gate → door → place), using the doors on the way
function autoGuide(m) {
  const tg = nextHop(m, guide); if (!tg) { autoNav = false; return; }
  const d = Math.hypot(tg.x - m.x, tg.y - m.y), t = performance.now();
  if (tg.final) { if (d < 1.2) { autoNav = false; autoPath = null; return; } }
  else if (d < 1.1 && t > autoT) {                          // at a way point: go through it
    autoT = t + 1600; autoPath = null;
    const A = areaOf(m.x, m.y);
    if (A?.kind === 'room') return send({ t: 'exit' });
    const gt = G.stations.find(s => s.type === 'gate' && s.area === A?.id && Math.hypot(s.x - tg.x, s.y - tg.y) < .2);
    if (gt) return doAct(gt.id, 'go');
    const door = G.stations.find(s => s.type === 'door' && s.area === A?.id && Math.hypot(s.x - m.x, s.y - m.y) < s.r + .6);
    if (door) return send({ t: 'enter', st: door.id });
    return;
  }
  if (t < autoT) return;
  if (!autoPath || Math.hypot(autoPath.tx - tg.x, autoPath.ty - tg.y) > .5) { walkTo(tg.x, tg.y); if (!autoPath) { autoNav = false; toast('เดินไปเองไม่ได้ ลองเดินเองตามลูกศร', '📍', false); } }
}
function walkTo(wx, wy) {
  const m = P.get(myId), A = areaOf(m.x, m.y); if (!A || me.down) return;
  const W = G.map.w, free = (x, y) => x >= A.x && y >= A.y && x < A.x + A.w && y < A.y + A.h && !blockedAt(x + .5, y + .5);
  const sx = Math.floor(m.x), sy = Math.floor(m.y), gx = Math.floor(wx), gy = Math.floor(wy);
  const prev = new Map([[sy * W + sx, -1]]), q = [[sx, sy]];
  let best = sy * W + sx, bd = Math.hypot(sx - gx, sy - gy);
  for (let qi = 0; qi < q.length && qi < 6000; qi++) {
    const [x, y] = q[qi]; const dd = Math.hypot(x - gx, y - gy); if (dd < bd) { bd = dd; best = y * W + x; } if (!dd) break;
    for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ex, ny = y + ey, k = ny * W + nx; if (!prev.has(k) && free(nx, ny)) { prev.set(k, y * W + x); q.push([nx, ny]); } }
  }
  const path = []; for (let k = best; k !== -1; k = prev.get(k)) path.push([k % W + .5, Math.floor(k / W) + .5]);
  path.reverse(); path.shift();
  // the last step goes to the exact spot you tapped when it is walkable
  if (bd === 0 && !blockedAt(wx, wy)) path.push([wx, wy]);
  if (!path.length) return;
  autoPath = { pts: path, goal: path[path.length - 1], stuck: 0, tries: 0, tx: wx, ty: wy };
  FX.ring(wx, wy, '#ffc94d', 450, .5);
}
// returns the direction to walk this frame (or null), and steers around anything that blocks the way
function autoStep(m, dt) {
  const ap = autoPath; if (!ap) return null;
  while (ap.pts.length && Math.hypot(ap.pts[0][0] - m.x, ap.pts[0][1] - m.y) < .12) ap.pts.shift();
  if (!ap.pts.length) { autoPath = null; return null; }
  const [tx, ty] = ap.pts[0]; let dx = tx - m.x, dy = ty - m.y; const l = Math.hypot(dx, dy);
  dx /= l; dy /= l;
  if (ap.stuck > .35) {                 // not getting anywhere: turn aside, then plan the route again
    if (++ap.tries > 4) { autoPath = null; toast('ไปต่อไม่ได้ มีอะไรขวางทางอยู่', '🚧', false); return null; }
    ap.stuck = 0; const side = ap.tries % 2 ? 1 : -1; [dx, dy] = [-dy * side, dx * side]; ap.sideT = .25; ap.side = [dx, dy];
    const g = [ap.tx, ap.ty]; setTimeout(() => { if (autoPath === ap) { walkTo(g[0], g[1]); if (autoPath) autoPath.tries = ap.tries; } }, 260);
  }
  if (ap.sideT > 0) { ap.sideT -= dt; [dx, dy] = ap.side; }
  return [dx, dy];
}
// talk to the nearest person (player or townsfolk) within a few steps
function nearestPerson(r = 3) {
  const m = P.get(myId); if (!m) return null; const here = areaOf(m.x, m.y)?.id;
  let best = null, bd = r;
  for (const p of P.values()) {
    if (p.id === myId || p.zb || areaOf(p.x, p.y)?.id !== here) continue;
    const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function talk() {
  if (!G || !me) return;
  FX.play('click');
  // whoever is closest wins: a player or townsperson standing next to you comes before the staff behind the desk
  const p = nearestPerson(3.5), m = P.get(myId), sf = near && STAFF_AT[near.id];
  const pd = p ? Math.hypot(p.x - m.x, p.y - m.y) : 1e9, sd = sf ? Math.hypot(sf.x - m.x, sf.y - m.y) : 1e9;
  if (p && pd <= sd + .4) return p.npc && !p.bot ? talkToTown(p) : openPanel({ kind: 'player', pid: p.id });
  if (sf) return onAction();
  toast('ไม่มีใครอยู่ใกล้ๆ เดินเข้าไปใกล้คนที่อยากคุยก่อน', '💬', false);
}

// ------------------------------------------------------------------ ⚽ the football ground: the pitch picture, goals, stands and the shared
// ball. The server moves the ball (10 Hz); here it glides between updates (same friction) and rolls as it goes.
let FBJ = null, FBIMG = null, PITCHIMG = null, fbAsked = false, FBALL = null, fbAim = null, lastZone = null;
function fbLoad() {
  if (fbAsked) return; fbAsked = true;
  fetch('assets/football.json?v=1').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { FBJ = j; FBIMG = im; }; im.src = 'assets/football.webp?v=1'; }).catch(() => { fbAsked = false; });
  const p = new Image(); p.onload = () => { PITCHIMG = p; }; p.src = 'assets/pitch.webp?v=1';
}
function fbMsg(m) {
  const b = FBALL || (FBALL = { rx: m.x, ry: m.y, rot: 0 });
  Object.assign(b, { x: m.x, y: m.y, vx: m.vx, vy: m.vy, t0: performance.now(), sc: m.sc });
  if (Math.hypot(b.rx - m.x, b.ry - m.y) > 3) { b.rx = m.x; b.ry = m.y; }
  if (m.kick) FX.play(m.kick === myId ? 'pop' : 'click');
  if (m.goal !== undefined) {
    const P0 = G.football.pitch, gx = m.goal ? P0.x - .6 : P0.x + P0.w + .6, gy = P0.y + P0.h / 2;
    FX.burst(gx, gy - .5, m.goal ? '#ff8fc4' : '#7cc4ff', 30); FX.burst(gx, gy - 1, '#ffe27a', 20); FX.play('levelup');
    FX.float(gx, gy - 1.6, `⚽ โกล! ${m.by}`, '#fff', .9);
  }
}
function fbStep(dt) {
  const b = FBALL; if (!b) return;
  const P0 = G.football.pitch, tau = (performance.now() - b.t0) / 1000, k = (1 - Math.exp(-1.1 * tau)) / 1.1;
  let px = b.x + b.vx * k, py = b.y + b.vy * k;
  if (Math.abs(py - (P0.y + P0.h / 2)) > G.football.goalH / 2) px = clamp(px, P0.x + .22, P0.x + P0.w - .22);
  py = clamp(py, P0.y + .22, P0.y + P0.h - .22);
  const ox = b.rx, oy = b.ry, a = Math.min(1, dt * 12); b.rx += (px - b.rx) * a; b.ry += (py - b.ry) * a;
  b.rot += Math.hypot(b.rx - ox, b.ry - oy) * 4 * (b.rx >= ox ? 1 : -1);
}
function fbKick() {
  const m = P.get(myId); if (!m || !FBALL) return;
  const t = performance.now(); if (t < actCd) return; actCd = t + 350;
  let dx = FBALL.rx - m.x, dy = FBALL.ry - (m.y - .1);
  if (fbAim && t - fbAim[2] < 400) { dx = fbAim[0]; dy = fbAim[1]; }   // running: shoot the way you run
  send({ t: 'kick', dx: +dx.toFixed(3), dy: +dy.toFixed(3), p: 1 });
  FX.play('whoosh');
}
function pitchOnScreen(r, X, Y) { return (r.x + r.w + 2) * TS + X > 0 && (r.x - 2) * TS + X < VW && (r.y + r.h + 2) * TS + Y > 0 && (r.y - 2) * TS + Y < VH; }
function drawPitch(X, Y) {
  fbLoad(); const P0 = G.football.pitch;
  if (!PITCHIMG) { ctx.fillStyle = 'rgba(120,170,110,.5)'; ctx.fillRect(P0.x * TS + X, P0.y * TS + Y, P0.w * TS, P0.h * TS); return; }
  const W = P0.w / .955, H = P0.h / .9408;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(PITCHIMG, Math.round((P0.x - .0225 * W) * TS + X), Math.round((P0.y - .0296 * H) * TS + Y), Math.round(W * TS), Math.round(H * TS));
}
function fbEnts(ents, vis) {
  const P0 = G.football.pitch, cy = P0.y + P0.h / 2, gh = G.football.goalH / 2;
  for (const d of G.football.deco) if (vis(d[1], d[2], 8)) ents.push([d[0] === 'stands' ? G.football.standTop - .2 : d[2], 15, { k: 'deco', s: d[0], x: d[1], y: d[2] }]);
  ents.push([cy + gh, 15, { k: 'goal', side: 0 }], [cy + gh, 15, { k: 'goal', side: 1 }]);
  if (FBALL) { fbStep(Math.min(.1, (performance.now() - (FBALL.ft || performance.now())) / 1000)); FBALL.ft = performance.now(); if (vis(FBALL.rx, FBALL.ry, 2)) ents.push([FBALL.ry + .05, 15, { k: 'ball' }]); }
}
function fbSpr(name, x, y, X, Y, sc = 1) {
  const s = FBJ?.sprites[name]; if (!s) return null;
  const w = s[4] * TS * sc, h = w * s[3] / s[2], px = Math.round(x * TS + X - w / 2), py = Math.round(y * TS + Y - h);
  ctx.drawImage(FBIMG, s[0], s[1], s[2], s[3], px, py, Math.round(w), Math.round(h)); return { px, py, w, h };
}
function drawFb(e, X, Y, t) {
  if (e.k === 'deco') {
    const r = fbSpr(e.s, e.x, e.y, X, Y); if (!r || e.s !== 'score') return;
    const sc = FBALL?.sc || [0, 0], cx = r.px + r.w / 2, cy = r.py + r.h * .32;
    ctx.font = `bold ${Math.round(TS * .62)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7cc4ff'; ctx.fillText(sc[0], cx - r.w * .24, cy); ctx.fillStyle = '#ff8fc4'; ctx.fillText(sc[1], cx + r.w * .24, cy);
    ctx.fillStyle = '#ffe27a'; ctx.font = `bold ${Math.round(TS * .4)}px sans-serif`; ctx.fillText('-', cx, cy);
    ctx.font = `bold ${Math.round(TS * .22)}px sans-serif`; ctx.fillStyle = '#cfd8e3'; ctx.fillText('ฟ้า      ชมพู', cx, cy + TS * .5);
    return;
  }
  if (e.k === 'goal') {   // seen from the side: two posts, a crossbar and a net that slopes back
    const P0 = G.football.pitch, cy = P0.y + P0.h / 2, gh = G.football.goalH / 2, dir = e.side ? 1 : -1;
    const gx = (e.side ? P0.x + P0.w : P0.x) * TS + X, bx = gx + dir * 1.3 * TS, y0 = (cy - gh) * TS + Y, y1 = (cy + gh) * TS + Y, z = 1.35 * TS, zb = .7 * TS;
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(gx, y0 - z); ctx.lineTo(bx, y0 - zb); ctx.lineTo(bx, y1 - zb); ctx.lineTo(gx, y1 - z); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.13)'; ctx.fillRect(Math.min(gx, bx), y0, Math.abs(bx - gx), y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 10; i++) { const yy = y0 + (y1 - y0) * i / 10; ctx.moveTo(gx, yy - z); ctx.lineTo(bx, yy - zb); ctx.lineTo(bx, yy); }
    for (let i = 1; i < 4; i++) { const xx = gx + (bx - gx) * i / 4, zz = z + (zb - z) * i / 4; ctx.moveTo(xx, y0 - zz); ctx.lineTo(xx, y1 - zz); }
    ctx.stroke();
    ctx.strokeStyle = '#f4f6fa'; ctx.lineWidth = Math.max(2, TS * .09); ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(gx, y0); ctx.lineTo(gx, y0 - z); ctx.lineTo(gx, y1 - z); ctx.lineTo(gx, y1);
    ctx.moveTo(gx, y0 - z); ctx.lineTo(bx, y0 - zb); ctx.lineTo(bx, y0); ctx.moveTo(gx, y1 - z); ctx.lineTo(bx, y1 - zb); ctx.lineTo(bx, y1); ctx.moveTo(bx, y0 - zb); ctx.lineTo(bx, y1 - zb);
    ctx.stroke(); ctx.lineCap = 'butt';
    return;
  }
  if (e.k === 'ball') {
    const b = FBALL, px = b.rx * TS + X, py = b.ry * TS + Y, r = TS * .26;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(px, py + r * .15, r * 1.05, r * .45, 0, 0, 7); ctx.fill();
    const s = FBJ?.sprites.ball;
    ctx.save(); ctx.translate(px, py - r); ctx.rotate(b.rot);
    if (s) ctx.drawImage(FBIMG, s[0], s[1], s[2], s[3], -r, -r, r * 2, r * 2);
    else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, r * .35, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}
// ------------------------------------------------------------------ interaction
let near = null, actCd = 0;
function findNear() {
  const m = P.get(myId); if (!m || !G || me?.down) return null;
  const here = areaOf(m.x, m.y)?.id;
  let best = null, bd = 1e9;
  for (const s of G.stations) {
    if (s.area !== here || s.type === 'yzone' && yzOpen(s.idx, s.z) || (s.type === 'lk' || s.type === 'lksky') && !lkOnC()) continue;
    const d = Math.hypot(s.x - m.x, s.y - m.y);
    if (d <= s.r && d < bd) { bd = d; best = s; }
  }
  // ☂️ the umbrella man (only around while it rains): a yellow ring and the action button talk to him
  for (const p of P.values()) if (p.umb && p.npc) { const d = Math.hypot(p.x - m.x, p.y - m.y); if (d <= 1.8 && d < bd) { bd = d; best = { id: 'umbman', type: 'umb', npc: p, label: 'คุยกับลุงชัย (ซื้อร่ม)', icon: '☂️', x: p.x, y: p.y, r: 1.8, area: here }; } }
  if (here === 'town' && FBALL && zoneOf(m.x, m.y) === 'field') { const d = Math.hypot(FBALL.rx - m.x, FBALL.ry - (m.y - .1)); if (d <= 1.25 && d < bd + .6) { bd = d; best = { id: 'fbball', type: 'ball', icon: '⚽', label: '⚽ เตะ!' }; } }   // ⚽ near the ball: the action button kicks it
  // vegetable fields laid out in a home yard
  const ya = AREA[here];
  if (ya?.yard) { const h = wd?.houses?.[ya.house]; if (h) for (const k of h[2]) {
    const pos = furnPos(h, k); if (!pos || pos[0] !== 9 || !G.shop.furniture[fbase(k)]?.field) continue;
    const tile = G.shop.furniture[fbase(k)].tile, x = ya.x + pos[1], y = ya.y + pos[2] - (tile ? .5 : .9), d = Math.hypot(x - m.x, y - m.y), rr = tile ? 1.0 : 1.6;
    if (d < rr && d < bd) { bd = d; best = { id: 'yf:' + k, type: 'yfield', k, house: ya.house, x, y, r: rr, icon: '🌱', label: tile ? 'แปลงดิน' : 'แปลงผัก', tile }; }
  } }
  // the water's edge (with a rod): fish right here; keeps the spot while a cast is out
  if (!best && (me?.rods || []).length) {
    const pool = waterPoolAt(m.x, m.y);
    if (pool) { waterNear = { id: 'water', type: 'pier', pool, label: `ตกปลา · ${POOL_NAME[pool]}`, icon: '🎣', x: m.x, y: m.y, r: 3, area: here }; best = waterNear; }
    else if (me.cast && waterNear) best = waterNear;
    else waterNear = null;
  }
  // rider: hand the food to the customer you are standing next to
  if (me?.career === 'rider') for (const j of me.jobs || []) if (j.mine && j.state === 'picked') {
    const tgt = j.npc ? (j.area === here ? j.dest : null) : (() => { const p = P.get(j.custId); return p && areaOf(p.x, p.y)?.id === here ? p : null; })();
    if (tgt && Math.hypot(tgt.x - m.x, tgt.y - m.y) < 2.2) return { id: 'deliver' + j.id, type: 'deliver', oid: j.id, icon: '🥡', label: `ส่งอาหารให้ ${j.cust}`, x: tgt.x, y: tgt.y };
  }
  return best;
}
const onBike = () => { const m = P.get(myId), v = me?.ride && G.shop?.vehicles?.[me.ride]; return !!(v && v.kind === 'moto' && me.ride !== 'escoot' && m && !roomOf(m.x, m.y) && !me.pose); };
function onAction() {
  if (driving() || swimming()) return send({ t: 'rideoff' });
  if (me.pass) return send({ t: 'hopoff' });
  if (!near && onBike()) { const t0 = performance.now(); if (t0 < actCd) return; actCd = t0 + 1800; return send({ t: 'wheelie' }); }
  if (!near) { toast('เดินเข้าไปใกล้สถานที่ต่างๆ (ไอคอนลอย) เพื่อใช้งาน', '👣', true); return; }
  if (near.type === 'ball') return fbKick();
  const t = performance.now();
  const master = me.admin && me.god?.doors;
  if (near.type === 'door' && near.renov && !master) return toast(`${near.label} ปิดปรับปรุงชั่วคราว 🚧`, '🚧', false);
  if (near.type === 'door' && near.house === undefined) {
    if (t < actCd) return; actCd = t + 1300;
    if (!isOpen(near.bld) && !master) { const o = G.hours[near.bld]; return toast(`${near.label} ปิดอยู่ (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
    return send({ t: 'enter', st: near.id });
  }
  if (near.type === 'exit') { if (t < actCd) return; actCd = t + 1300; return send({ t: 'exit' }); }
  if (near.type === 'gate' && near.renov && !master && job('farmer') && near.id === 'gate_farm') return dialog({ name: 'ป้าสายใจ (ฝากงานที่ประตูไร่)', face: 'farmer_f', lines: ['ไร่ปิดปรับปรุงอยู่จ้ะ แต่งานในเมืองยังมีเยอะ', 'อยากรับภารกิจไหมหลาน?'], choices: [me.mis ? { label: '📋 ภารกิจที่ทำอยู่', fn: () => { dialogClose(); openPanel({ kind: 'career' }); } } : { label: '📋 รับภารกิจ (⚡5)', fn: () => { dialogClose(); send({ t: 'mission', op: 'start', car: 'farmer', st: 'gate_farm' }); }, cls: 'good' }, { label: '👋 ลาก่อน', fn: dialogClose }] });
  if (near.type === 'gate' && near.renov && !master) return toast('ไร่ชานเมืองปิดปรับปรุงชั่วคราว 🚧', '🚧', false);
  if (near.type === 'gate') { if (t < actCd) return; actCd = t + 1300; return doAct(near.id, 'go'); }
  if (near.type === 'deliver') return send({ t: 'order_deliver', id: near.oid });
  if (near.type === 'seat') return doAct(near.id, 'sit');
  if (near.type === 'wbell') { if (t < actCd) return; actCd = t + 600; bellT = performance.now(); return doAct(near.id, 'ring'); }
  if (near.type === 'siamsi') { if (t < actCd) return; actCd = t + 1500; return doAct(near.id, 'shake'); }
  if (near.type === 'trash' && job('beggar')) { if (t < actCd) return; actCd = t + 1500; return doAct(near.id, 'run'); }
  if (near.type === 'trash') return toast('ถังขยะ · ขอทานวิ่งเก็บขยะเริ่มจากตรงนี้', '🗑️', false);
  if (near.type === 'chair' && me.career === 'office') return doAct(near.id, 'sit');
  if (near.type === 'sdesk' && me.enrolled) return doAct(near.id, 'sit');
  if (/^k(pantry|board|pan|pot|grill|plate)$/.test(near.type)) { if (t < actCd) return; actCd = t + 250; return doAct(near.id, 'use'); }   // cooking battle stations
  if (near.type === 'kitchen' && me.cook?.hand === 'plate') return doAct(near.id, 'serve');
  if (near.type === 'pier') {                                         // fishing is all on the big button: cast, strike, (hold to reel), lift
    if (!me.cast) { if (t < actCd) return; actCd = t + 900; return doAct(near.id, 'cast'); }
    if (me.cast.state === 'fight') return fightPress();
    return strike();
  }
  if (near.type === 'umb') return talkToTown(near.npc);
  if (near.type === 'note') return dialog({ name: near.label, face: null, lines: [near.text], choices: [{ label: '👌 โอเค', fn: dialogClose }] });   // a plain readable sign
  if (near.type === 'wish' || near.type === 'secret') { if (t < actCd) return; actCd = t + 900; return doAct(near.id, near.type === 'wish' ? 'toss' : 'read'); }
  if (panel?.st === near.id) { closePanel(); return; }
  if (dlgQ) { dlgTap(); return; }
  if (STAFF_AT[near.id]?.guide) return guideTalk(STAFF_AT[near.id]);
  if (STAFF_AT[near.id]) return talkTo(STAFF_AT[near.id], near.id);
  openPanel({ kind: near.type, st: near.id });
}
// the big button: tap = use / enter, press and hold = run while held
{
  const ab = $('#actBtn'); let hold = null;
  ab.addEventListener('pointerdown', e => { e.preventDefault(); ab.setPointerCapture?.(e.pointerId); if (FG) { reelHold = true; fightPress(); hold = { id: e.pointerId, fish: 1 }; return; } hold = { id: e.pointerId, ran: false, tm: setTimeout(() => { if (hold) { hold.ran = true; setRun(true); if (navigator.vibrate) navigator.vibrate(20); } }, 320) }; });
  const up = e => { if (!hold || hold.id !== e.pointerId) return; if (hold.fish) { reelHold = false; hold = null; return; } clearTimeout(hold.tm); const ran = hold.ran; hold = null; if (ran) setRun(false); else if (e.type === 'pointerup') onAction(); };
  ab.addEventListener('pointerup', up); ab.addEventListener('pointercancel', up);
  ab.addEventListener('contextmenu', e => e.preventDefault());
}

// ------------------------------------------------------------------ main loop
let stuckT = 0, unstickAt = 0, downHintAt = 0;
let last = performance.now(), sendT = 0, lastSent = '', holdAfterTp = false, meMoving = false, fadeT = 0;
let homeBtnT = 0;
let frameT = 0, FDT = 1 / 60, liveT = 0;
const camS = { x: 0, y: 0, on: false };
function frame(t) {
  requestAnimationFrame(frame);
  // battery saver: full 60 fps while you walk, touch or anything moves near you; 30 fps only when standing idle
  const idle = performance.now() - Math.max(lastInput, liveT) > 1500 && !joy;
  if (ECO && (idle ? t - frameT < 30 : t - frameT < 14)) return; frameT = t;   // (and never more than 60 fps on phones: 90/120 Hz screens heat up and slow down)
  dlgTick();
  if (G && me && t - homeBtnT > 400) { homeBtnT = t; const m0 = P.get(myId), r0 = m0 && areaOf(m0.x, m0.y); { const vs = (me.vehicles || []).filter(k => G.shop.vehicles[k]), rb = $('#rideBtn'), v = G.shop.vehicles[me.ride]; rb.classList.toggle('hidden', !vs.length || !!(r0 && r0.kind === 'room')); rb.classList.toggle('on', !!v); const lbl = v ? `<span>🚶</span><small>ลงรถ</small>` : `<span>${G.shop.vehicles[vs[0]]?.icon || '🛵'}</span><small>ขี่รถ</small>`; if (rb.innerHTML !== lbl) rb.innerHTML = lbl; } paintDocBack(); const atHome = r0 && (r0.rk === 'house' || r0.yard) && r0.house === me.house; $('#homeBtn').classList.toggle('hidden', !atHome || !!placing); if (placing && !atHome) endPlace(); }
  const dt = Math.min(0.05, (t - last) / 1000); last = t; FDT = dt;
  if (!G || !me) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#14181d'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  if (RUN && !RUN.over && !document.getElementById('runWin')?.classList.contains('hidden')) return;   // the trash run covers the screen: don't draw the town under it (phones lagged)
  const m = P.get(myId);
  if (m) {
    let dx = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    let dy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
    if (joy && Math.hypot(joy.dx, joy.dy) > 0.15) { dx = joy.dx; dy = joy.dy; }
    if (mouseHold && !dx && !dy && performance.now() - mouseHold.t > 260) { const c = camera(), hx = (mouseHold.x + c.x) / TS - m.rx, hy = (mouseHold.y + c.y) / TS - (m.ry - .35), l = Math.hypot(hx, hy); if (l > .3) { dx = hx / l; dy = hy / l; } }
    if (dx || dy) { autoPath = null; autoNav = false; }
    else if (autoNav && guide && !me.down) autoGuide(m);
    if (!dx && !dy && autoPath && !me.down) { const st = autoStep(m, dt); if (st) [dx, dy] = st; }
    const ox0 = m.x, oy0 = m.y;
    if (holdAfterTp) { if (!dx && !dy && !joy) holdAfterTp = false; else { dx = 0; dy = 0; } }
    if (me.down) {
      if ((dx || dy) && performance.now() > downHintAt) { downHintAt = performance.now() + 4000; toast(me.down.kind === 'jail' ? 'ติดคุกอยู่ เดินไม่ได้ รอพ้นโทษ' : me.down.kind === 'hosp' ? 'คุณหมดสติอยู่บนเตียง เดินไม่ได้ · รอเจ้าหน้าที่รักษาให้ฟื้น (ดูเวลาด้านล่าง)' : 'หิวจนหมดแรง เดินไม่ได้ · กินอะไรสักอย่างเพื่อฟื้น', '🛏️', false); }
      dx = 0; dy = 0;
    }
    if (driving()) {                          // bumper cars: touching another car bounces you both apart
      const now0 = performance.now(), s = STN('ride_bumper');
      if (now0 > bump.until) {
        const others = [...P.values()].filter(o => o.id !== myId && o.pose === 'fun' && String(o.fn).startsWith('bumper:')).map(o => [o.rx, o.ry]);
        const used = ridersOf('bumper'); for (let i = 0; i < 4; i++) if (!used.has(i)) { const q = seatPos(s, i, now0 / 1000); others.push([q.x, q.y - .32]); }
        for (const [ox, oy] of others) { const ddx = m.x - ox, ddy = m.y - oy, dd = Math.hypot(ddx, ddy); if (dd < .85) { bump.x = ddx / (dd || 1); bump.y = ddy / (dd || 1); bump.until = now0 + 380; FX.play('pop'); FX.burst((m.x + ox) / 2, (m.y + oy) / 2 - .4, '#ffd45e', 8); if (navigator.vibrate) navigator.vibrate(60); break; } }
      }
      if (now0 < bump.until) { dx = bump.x * 1.4; dy = bump.y * 1.4; }
    }
    if (me.pass) {                             // riding as a passenger: you go where the driver goes
      const d = P.get(me.pass);
      if ((dx || dy) && performance.now() > downHintAt) { downHintAt = performance.now() + 4000; toast('นั่งรถเพื่อนอยู่ · กดปุ่ม "ลงรถ" เพื่อลง', '🛵', false); }
      if (d) { m.x = d.x; m.y = d.y; m.rx = d.rx; m.ry = d.ry; m.f = d.f; }
      dx = 0; dy = 0;
    }
    const l = Math.hypot(dx, dy); meMoving = false;
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      if (running && (!canRun() || me.run === false && performance.now() - runSetT > 1500)) setRun(false);
      const rv = me.ride && !roomOf(m.x, m.y) && !me.pose ? G.shop.vehicles[me.ride] : null, sp = G.speed * (me.speedBase || me.speed || 1) * (rv ? rv.speed : running ? G.run.mul : 1) * dt;
      // round to what we send so client and server always agree
      const r2 = v => Math.round(v * 100) / 100;
      const swim = swimming(), inPool0 = nearPoolW(m.x, m.y), ar0 = rv?.fly ? areaOf(m.x, m.y) : null, stuck = !ar0 && !swim && blockedAt(m.x, m.y), free0 = (x, y) => stuck && !solid(x, y) ? true : ar0 ? x > ar0.x + .6 && y > ar0.y + .8 && x < ar0.x + ar0.w - .6 && y < ar0.y + ar0.h - .4 : !blockedAt(x, y);   // helicopters fly over everything, but stay on this map
      const free = (x, y) => swim ? inPoolW(x, y) : !inPool0 && nearPoolW(x, y) ? false : free0(x, y);   // swimmers stay in the water; nobody walks or drives into it
      const bx = m.x, by = m.y;
      const nx = r2(m.x + dx * sp); if (free(nx, m.y)) m.x = nx;
      const ny = r2(m.y + dy * sp); if (free(m.x, ny)) m.y = ny;
      // corner assist: brushing the edge of a tree, pole or pot slides you around it instead of stopping dead
      if (m.x === bx && m.y === by && !ar0) {
        const slide = (ax, ay, px, py) => { if (!ax && !ay) return false; for (let o = .06; o <= .52; o += .04) for (const sg of [1, -1]) { const qx = bx + px * o * sg, qy = by + py * o * sg; if (free(qx, qy) && free(r2(qx + ax * sp), r2(qy + ay * sp))) { const k = Math.min(sp, o); m.x = r2(bx + px * k * sg); m.y = r2(by + py * k * sg); if (!free(m.x, m.y)) { m.x = bx; m.y = by; continue; } return true; } } return false; };
        if (Math.abs(dx) >= Math.abs(dy)) slide(Math.sign(dx), 0, 0, 1) || slide(0, Math.sign(dy), 1, 0);
        else slide(0, Math.sign(dy), 1, 0) || slide(Math.sign(dx), 0, 0, 1);
      }
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8; meMoving = Math.hypot(m.x - m.rx, m.y - m.ry) > 0.001;
      stepAcc += Math.hypot(m.x - m.rx, m.y - m.ry);
      if (stepAcc > 0.62) { stepAcc = 0; FX.play('step', tileAt(Math.floor(m.x), Math.floor(m.y))); if (Math.random() < .5) FX.dust(m.x, m.y); }
    }
    if (autoPath) autoPath.stuck = Math.hypot(m.x - ox0, m.y - oy0) < .004 ? autoPath.stuck + dt : 0;
    if (dx || dy) { fbAim = [dx, dy, performance.now()]; const z = zoneOf(m.x, m.y); if (z !== lastZone) { if (z === 'park' && lastZone) adFull('enter_park'); lastZone = z; } }   // walking into the amusement park counts as entering it (ads are rate-limited inside adFull)
    // watchdog: trying to walk but not moving for a while (and not against a wall) -> clear whatever holds us and ask the server to resync
    { const tryMove = (dx || dy) && !me.down, moved = Math.hypot(m.x - ox0, m.y - oy0) > .002, wall = tryMove && blockedAt(m.x + Math.sign(dx) * .35, m.y + Math.sign(dy) * .35);
      stuckT = tryMove && !moved && !wall ? stuckT + dt : 0;
      if (stuckT > 1.2 && performance.now() > unstickAt) { unstickAt = performance.now() + 4000; stuckT = 0; holdAfterTp = false; reelHold = false; if (!me.cast) FG = null; send({ t: 'unstick', x: m.x, y: m.y, why: JSON.stringify({ cast: me.cast?.state || 0, FG: !!FG, joy: !!joy, pose: me.pose || 0, down: me.down?.kind || 0 }) }); } }
    // walking into a gate's yellow circle takes you through it, no button needed
    if ((dx || dy) && near?.type === 'gate' && near.id.startsWith('ygate') && Math.hypot(near.x - m.x, near.y - m.y) < near.r * .75 && performance.now() > actCd) { actCd = performance.now() + 2000; autoPath = null; doAct(near.id, 'go'); }
    // walking down onto the door mat takes you outside, no button needed
    if (dy > .3 && near?.type === 'exit' && Math.hypot(near.x - m.x, near.y - m.y) < Math.max(.7, near.r * .6) && performance.now() > actCd) { actCd = performance.now() + 1500; autoPath = null; send({ t: 'exit' }); }
    m.rx = m.x; m.ry = m.y;
    if (meMoving || autoPath || me.pass || m.pose === 'fun') liveT = performance.now();
    // smooth camera: eases after you instead of being glued to every step; snaps on teleports
    { const tx = m.rx + m.ox, ty = m.ry + m.oy; if (!camS.on || Math.hypot(tx - camS.x, ty - camS.y) > 3) { camS.x = tx; camS.y = ty; camS.on = true; } else { const e = 1 - Math.exp(-dt * 9); camS.x += (tx - camS.x) * e; camS.y += (ty - camS.y) * e; } }
    m.ox *= 0.8; m.oy *= 0.8; if (Math.abs(m.ox) < .002) m.ox = 0; if (Math.abs(m.oy) < .002) m.oy = 0;
    sendT += dt;
    const sig = m.x.toFixed(2) + ',' + m.y.toFixed(2);
    if (sendT > 0.066 && sig !== lastSent) { sendT = 0; lastSent = sig; send({ t: 'p', x: +m.x.toFixed(2), y: +m.y.toFixed(2), f: m.f, fx: fixId }); }
  }
  { const k = 1 - Math.exp(-dt * 10); for (const p of P.values()) if (p.id !== myId) { const ddx = p.x - p.rx, ddy = p.y - p.ry; if (Math.abs(ddx) + Math.abs(ddy) > 6) { p.rx = p.x; p.ry = p.y; } else { p.rx += ddx * k; p.ry += ddy * k; if (Math.abs(ddx) + Math.abs(ddy) > .02) liveT = performance.now(); } } }
  stepPets(dt); stepFight(dt);

  near = findNear();
  const ab = $('#actBtn');
  if (wwIsWolf()) { const cd = wwCdLeft('summon'); ab.classList.remove('closed'); ab.classList.toggle('idle', cd > 0); actIco('📯'); $('#actLabel').textContent = cd ? `สมุน ${cd} วิ` : 'เรียกสมุน'; }
  else if (placing) { ab.classList.remove('idle', 'closed'); actIco('🔄'); $('#actLabel').textContent = 'หมุน'; }
  else if (picking) { ab.classList.add('idle'); actIco('✋'); $('#actLabel').textContent = 'แตะของ'; }
  else if (near) {
    ab.classList.remove('idle'); let ico = near.icon;
    const closed = near.type === 'door' && near.house === undefined && (near.renov || !isOpen(near.bld));
    const stf = STAFF_AT[near.id];
    if (stf) { ico = '💬'; staffGreet(stf); }
    if (/^k(pantry|board|pan|pot|grill|plate)$/.test(near.type) || near.type === 'kitchen' && me.cook) ico = cookCue(near)[0];
    if (near.type === 'pier') actRod(); else actIco(ico);
    $('#actLabel').textContent = stf ? `คุยกับ${stf.short}` : near.type === 'door' ? (near.house !== undefined ? `บ้าน #${near.house + 1}` : near.renov ? '🚧 ปิดปรับปรุง' : closed ? '🔒 ปิดอยู่' : 'เข้า ' + near.label)
      : near.type === 'exit' ? 'ออกจากอาคาร' : near.type === 'gate' ? (near.renov ? '🚧 ปิดปรับปรุง' : near.label) : near.type === 'seat' ? 'นั่ง' : near.type === 'sdesk' ? 'นั่งเรียน'
      : near.type === 'pier' ? (me.cast ? fishCue()[1] : 'เหวี่ยงเบ็ด') : /^k(pantry|board|pan|pot|grill|plate)$/.test(near.type) || near.type === 'kitchen' && me.cook ? cookCue(near)[1] : near.label;
    ab.classList.toggle('closed', closed);
  } else { ab.classList.add('idle'); ab.classList.remove('closed'); actIco('👆'); $('#actLabel').textContent = 'ใช้งาน'; }
  if (placing) { }
  else if (driving()) { ab.classList.remove('idle', 'closed'); actIco('🚪'); $('#actLabel').textContent = 'ลงจากรถ'; }
  else if (swimming()) { ab.classList.remove('idle', 'closed'); actIco('🪜'); $('#actLabel').textContent = 'ขึ้นจากสระ'; }   // in a bumper car the big button gets you out
  else if (me.pass) { ab.classList.remove('idle', 'closed'); actIco('🚶'); $('#actLabel').textContent = 'ลงรถ'; }       // riding with a friend
  else if (!near && onBike()) { ab.classList.remove('idle', 'closed'); actIco('🔥'); $('#actLabel').textContent = 'สับโดด'; }   // on a bike with nothing around: pop a wheelie
  paintFishCue();
  if (panel?.st && (!near || near.id !== panel.st)) closePanel();
  if (panel?.kind === 'player' && !P.get(panel.pid)) closePanel();
  draw(t);
  nearBtns(t);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ drawing
const hash = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
function draw(t) {
  // snap the camera to whole device pixels so the map does not shimmer against the player while walking
  const c = camera(), X = Math.round(-c.x * DPR) / DPR, Y = Math.round(-c.y * DPR) / DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, VW, VH);
  const meP = P.get(myId), A = meP ? areaOf(meP.x, meP.y) : null, myRoom = A && A.kind === 'room' ? A : null;
  let x0 = Math.max(0, Math.floor(c.x / TS)), y0 = Math.max(0, Math.floor(c.y / TS));
  let x1 = Math.min(G.map.w - 1, Math.ceil((c.x + VW) / TS)), y1 = Math.min(G.map.h - 1, Math.ceil((c.y + VH) / TS));
  if (A) { x0 = Math.max(x0, A.x); y0 = Math.max(y0, A.y); x1 = Math.min(x1, A.x + A.w - 1); y1 = Math.min(y1, A.y + A.h - 1); }
  // only things inside the area you are in are drawn: inside a building you never see the street
  const inside = (x, y) => !A || (x >= A.x && x <= A.x + A.w && y >= A.y && y <= A.y + A.h + .5);
  const tm = t / 1000;
  // outdoors the land and sea carry on past the edge of the map (the edge column repeats), so the view never ends in black
  drawArea = A;
  if (A && !myRoom) {
    const vx0 = Math.floor(c.x / TS) - 1, vy0 = Math.floor(c.y / TS) - 1, vx1 = Math.ceil((c.x + VW) / TS), vy1 = Math.ceil((c.y + VH) / TS);
    for (let ty = vy0; ty <= vy1; ty++) for (let tx = vx0; tx <= vx1; tx++) {
      if (tx >= A.x && tx < A.x + A.w && ty >= A.y && ty < A.y + A.h) continue;
      const cx = clamp(tx, A.x + 1, A.x + A.w - 2), cy = clamp(ty, A.y + 1, A.y + A.h - 2);
      const ch = G.map.tiles[cy][cx];
      drawTile(ch === 'w' ? 'w' : ch === 's' ? 's' : '.', tx, ty, tx * TS + X, ty * TS + Y, tm);
    }
  }
  if (A && !myRoom && atlasImg) {
    const k = TS + '|' + DPR; if (k !== gKey) { gKey = k; gCache.clear(); }
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (G.map.tiles[ty][tx] === 'w') drawTile('w', tx, ty, tx * TS + X, ty * TS + Y, tm);
    for (let cy = Math.floor(y0 / GCH); cy <= Math.floor(y1 / GCH); cy++) for (let cx = Math.floor(x0 / GCH); cx <= Math.floor(x1 / GCH); cx++) ctx.drawImage(groundChunk(A, cx, cy), cx * GCH * TS + X, cy * GCH * TS + Y, GCH * TS, GCH * TS);
  } else {
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(G.map.tiles[ty][tx], tx, ty, tx * TS + X, ty * TS + Y, tm);
    if (!myRoom) for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawEdges(tx, ty, tx * TS + X, ty * TS + Y);
  }
  if (myRoom) for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if ('io'.includes(G.map.tiles[ty][tx])) for (let d = 0; d < 4; d++) if (tileAt(tx + SIDES[d][0], ty + SIDES[d][1]) === '#') edgeDraw('curbShadow', d, tx * TS + X, ty * TS + Y);
  if (A?.id === 'town' && pitchOnScreen(G.football.pitch, X, Y)) drawPitch(X, Y);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const night = nightLevel();
  for (const s of G.stations) {
    if (!inside(s.x, s.y)) continue;
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -80 || py < -80 || px > VW + 80 || py > VH + 80) continue;
    if (s.type === 'gplot') { drawPlot(s, px, py, t); continue; }
    const isNear = near && near.id === s.id;
    if (isNear) { ctx.fillStyle = 'rgba(255,201,77,.35)'; ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py, TS * .85, TS * .4, 0, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  if (near?.type === 'umb') { const u = near.npc, px = (u.rx ?? u.x) * TS + X, py = (u.ry ?? u.y) * TS + Y, pr = 1 + Math.sin(t / 220) * .06; ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py + TS * .05, TS * .75 * pr, TS * .38 * pr, 0, 0, 7); ctx.stroke(); }
  if (near?.type === 'deliver') { const px = near.x * TS + X, py = near.y * TS + Y; ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py + TS * .2, TS * .9, TS * .45, 0, 0, 7); ctx.stroke(); }
  const ents = [];
  const vis = (x, y, r = 8) => inside(x, y) && x * TS + X > -r * TS && x * TS + X < VW + r * TS && y * TS + Y > -2 * TS && y * TS + Y < VH + r * TS;
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) ents.push([b.y + b.h, 0, b]);
  for (const p of G.props) if (vis(p.x, p.y, 4)) ents.push([GROUND_PROP.test(p.s) ? -1e9 : p.y, 1, p]);   // manholes, puddles, grass tufts lie flat
  for (const tr of G.trees) if (vis(tr[0] + .5, tr[1] + 1, 4)) ents.push([tr[1] + .95, 2, tr]);
  for (const f of roomFurniture) if (vis(f[1], f[2], 4)) ents.push([/rug|welcome|f_mat|^~|^y_soil/.test(f[0]) ? -1e9 : f[2], 3, f]);   // rugs and mats lie on the floor: always under people
  if (A?.id === 'town') for (const s of G.stations) if (s.type === 'ride' && vis(s.cx, rideBottom(s), 10)) ents.push([s.k === 'pool' || s.k === 'bumper' ? -1e8 : rideBottom(s), 8, s]);
  if (A?.id === 'temple' || A?.id === 'town') crowdEnts(A, ents, vis);
  if (A?.id === 'town' && vis(AREA.park.x + 20, AREA.park.y + 14, 26)) crowdEnts(AREA.park, ents, vis);   // the park's visitors, only while it is near the view
  if (A?.id === 'town' && vis(G.football.pitch.x + 9, G.football.pitch.y + 5, 22)) fbEnts(ents, vis);
  if ((A?.id === 'town' || A?.id === 'temple') && lkOnC()) lkEnts(A, ents, vis);
  if (A?.id === 'town' && G.fair?.on && vis(G.fair.x + 7, G.fair.y + 15, 24)) fairEnts(ents, vis);
  if (A?.id === 'town' && RIDE_IMG()) { const c = STN('ride_carousel'); if (c && vis(c.cx, rideBottom(c), 12)) ents.push([rideBottom(c) + .5, 9, c]); }   // the carousel roof goes over its riders
  if (A?.id === 'temple') { for (const st of G.stations) if (st.type === 'wat' && vis(st.cx, st.cy + st.h / 2, 12)) ents.push([st.k === 'sala' ? st.cy - st.h / 2 + .3 : st.cy + st.h / 2, 11, st]); ents.push([A.y + 1, 12, 'top'], [A.y + A.h, 12, 'bot']);
    { const t0 = performance.now(); watMonks(A, Math.min(.1, (t0 - (window.__watT || t0)) / 1000)); window.__watT = t0; for (const n of WATM) if (vis(n.rx, n.ry, 3)) ents.push([n.ry + .3, 4, n]); }
    ents.push([-1e8, 14, { fx: 'koi' }], [-1e8, 14, { fx: 'lotus' }], [A.y + 12.75, 14, { fx: 'incense', x: A.x + 22, y: A.y + 12.7 }], [A.y + 14, 14, { fx: 'leaves' }]); }
  { const s = A?.id === 'town' && STN('gate_temple'), F = s?.facade;   // the temple complex: one strip per tile column, each sorted by the ground's front edge there
    if (F && vis(F.cx, F.bv - 6, 16)) { loadWat(); if (WIMG) { const n = Math.ceil(F.w); for (let i = 0; i < n; i++) { const xm = F.x0 + i + .5, d = Math.min(1, Math.abs(xm - F.cx) / F.hw); ents.push([F.bv - F.lv * d + .05, 13, { s, i }]); } } else ents.push([s.y + 2.2, 13, { s }]); } }
  { const g = G.parkArch; if (A?.id === 'town' && g && vis(g.x, g.y, 8)) ents.push([g.y, 10, { x: g.x, y: g.y - .7, id: 'gate_park' }]); }   // the amusement park's arch over the walk from the avenue
  for (const p of P.values()) if (vis(p.rx, p.ry, 3)) {
    if (p.ps && P.get(p.ps)?.veh) continue;   // passengers are drawn with the bike / inside the car they ride in
    const rs = p.pose === 'fun' && p.fn ? STN('ride_' + String(p.fn).split(':')[0]) : null;   // riders are drawn with their ride (in front of it; behind the shooting counter)
    ents.push([rs ? (rs.k === 'shooting' ? (RIDE_IMG() ? rideBottom(rs) + .4 : rs.cy - rs.h / 2 + .4) : rs.k === 'bumper' || rs.k === 'pool' ? p.ry + .3 : rideBottom(rs) + .2) : p.ry + .3 + (p.veh && G.shop?.vehicles?.[p.veh]?.fly && !roomOf(p.x, p.y) ? 1e5 : 0), 4, p]);
  }   // helicopters fly over the roofs
  for (const p of P.values()) { const q = p.pt && PETST.get(p.id); if (q && vis(q.x, q.y, 3) && !roomOf(p.x, p.y)) ents.push([q.y + .3, 6, q]); }   // pets wait outside: none indoors
  { const q = lostDog(); if (q && vis(q.x, q.y, 3)) ents.push([q.y + .3, 6, q]); }
  { const q = thiefNpc(); if (q && vis(q.rx, q.ry, 3)) ents.push([q.ry + .3, 4, q]); }
  misEnts(ents, vis);
  if (me?.alms) me.alms.pts.forEach((q, i) => { if (!me.alms.got[i] && vis(q[0], q[1], 4)) ents.push([q[1] + .2, 7, { k: 'beacon', x: q[0], y: q[1] }]); });   // 🙏 alms stops
  rivalEnts(ents, vis);
  if (me?.cook && myRoom?.rk === 'kitchen') ents.push([1e8, 7, { k: 'cook' }]);
  if (myRoom?.rk === 'petshop') for (const q of shopPets(myRoom)) ents.push([q.y + .3, 6, q]);   // the shop's own animals
  for (const n of STAFF) if (vis(n.rx, n.ry, 3)) ents.push([n.ry + .3, 4, n]);
  { const t0 = performance.now(); stepAmbs(Math.min(.1, (t0 - (window.__ambT || t0)) / 1000)); window.__ambT = t0; }
  for (const a of ambs) if (a.area === A?.id) { if (!a.body.gone) ents.push([a.body.ry + .3, 4, a.body]); ents.push([a.y + halfY(a), 5, a]); }
  if (taxiFx) { const k = Math.min(1, Math.max(0, (performance.now() - taxiFx.t0) / taxiFx.dur)), e = taxiFx.ease ? k * k : 1 - (1 - k) * (1 - k); taxiFx.x = taxiFx.fx + (taxiFx.tx - taxiFx.fx) * e; if (performance.now() > taxiFx.t0 + taxiFx.dur + 4000) taxiFx = null; else ents.push([taxiFx.y + halfY(taxiFx), 5, taxiFx]); }
  if (A?.id === 'town') { stepTraffic(); for (const c of traffic) if (vis(c.x, c.y, 4)) ents.push([c.y + halfY(c), 5, c]); }
  if (myRoom?.rk === 'hospital') (wd?.beds || []).forEach((b, i) => { if (b && b[5]) { const s = STN('bed' + i); ents.push([s.y + .3, 4, npcPatient(b, s)]); } });
  ents.sort((a, b) => a[0] - b[0]);
  if (!myRoom && !ECO) drawCastShadows(ents, X, Y, night);
  drawZDecals(X, Y, t, A);
  for (const [, k, e] of ents) {
    if (k === 0) drawBuildingSprite(e, X, Y);
    else if (k === 1) { if (!e.open || isOpen(e.open)) spr(e.s, e.x, e.y - (e.z || 0), X, Y, e.sc || 1); }   // z: hung on a wall; open: only while that shop is open
    else if (k === 2) { const tr = e, sw = Math.sin(t / 1300 + tr[0] * .7 + tr[1] * .4) * .022 + Math.sin(t / 470 + tr[0]) * .006, bx = (tr[0] + .5) * TS + X, byy = (tr[1] + 1.05) * TS + Y; ctx.save(); ctx.translate(bx, byy); ctx.transform(1, 0, -sw, 1, 0, 0); ctx.translate(-bx, -byy); spr(tr[2], tr[0] + .5, tr[1] + 1.05, X, Y); ctx.restore(); }   // trees sway in the breeze
    else if (k === 3) {
      if (e[0][0] === '~') drawStairs(e[1], e[2], e[0] === '~stairs_d', X, Y);
      else if (e[3] === 'ghost') { const bad = !!placeBad(); ctx.globalAlpha = .6 + Math.sin(t / 200) * .2; if (bad) ctx.filter = 'sepia(1) saturate(6) hue-rotate(-50deg)'; sprF(e[0], e[1], e[2], X, Y, e[5]); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.strokeStyle = bad ? '#ff4a4a' : '#ffd770'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.ellipse(e[1] * TS + X, e[2] * TS + Y, TS * .55, TS * .2, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); if (e[4]?.spk) drawSprinkler(e, X, Y, t); }
      else { sprF(e[0], e[1], e[2], X, Y, e[5]); if (e[4]) drawYardCrop(e, X, Y, t); }
    }
    else if (k === 5) drawCar(e, X, Y);
    else if (k === 6) drawPet(e, X, Y, t);
    else if (k === 7) drawMisThing(e, X, Y, t);
    else if (k === 8) drawRideThing(e, X, Y, t);
    else if (k === 9) { const b2 = rideBottom(e), H0 = rH('car_base', RG.car.w); rdraw('car_roof', e.cx * TS + X, (b2 - H0 + .45) * TS + Y, RG.car.roofW, .5, .93, false, Math.sin(t / 900) * .012); }
    else if (k === 10) drawParkGate(e.x, e.y + .7, X, Y, e.id === 'gate_park');
    else if (k === 11) drawWat(e, X, Y, t);
    else if (k === 12) drawWatWall(e, X, Y);
    else if (k === 13) drawWatTownGate(e, X, Y);
    else if (k === 15) drawFb(e, X, Y, t);
    else if (k === 17) drawLk(e, X, Y, t);
    else if (k === 18) drawFair(e, X, Y, t);
    else if (k === 14) { if (e.fx === 'balloon' || e.fx === 'bunting' || e.fx === 'bubbles' || e.fx === 'pigeon' || e.fx === 'butterflies' || e.fx === 'critter') drawCrowdFx(e, X, Y, t); else drawWatFx(e, X, Y, t); }
    else drawPlayer(e, X, Y, t);
  }
  if (A?.yard) drawYardLocks(A, X, Y, t);
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) drawBuildingSign(b, X, Y);
  for (const s of G.stations) {
    if (s.type === 'gplot' || !inside(s.x, s.y)) continue;
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -60 || py < -60 || px > VW + 60 || py > VH + 60) continue;
    const isNear = near && near.id === s.id;
    if (/^(door|exit|bed|hbed|chair|seat|staff|sdesk|trash|wish|secret|note)$/.test(s.type) && !isNear) continue;
    if ((s.type === 'lk' || s.type === 'lksky') && !lkOnC()) continue;
    if (s.type === 'door' && s.house !== undefined) continue;
    if (s.type === 'yzone' && yzOpen(s.idx, s.z)) continue;
    if (STAFF_AT[s.id]) continue;   // a shopkeeper / guide stands here: no floating sticker over their head
    ctx.font = `${Math.round(TS * (isNear ? .7 : .55))}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(s.type === 'door' ? '🚪' : s.icon, px, py - TS * (s.type === 'lot' || s.type === 'gate' ? 1.1 : 1.7) + Math.sin(t / 380 + s.x) * 3);
    if (s.type === 'gate') sign(`${s.icon} ${s.label}`, px, py - TS * 1.8, { size: TS * .3, bg: 'rgba(40,90,150,.92)' });
  }
  drawOtherCasts(X, Y, t); drawBobber(X, Y, t); drawMisGuide(X, Y, t);
  drawSirens(X, Y);
  FX.draw(ctx, X, Y, TS);
  drawGuide(X, Y, t); drawSniff(X, Y, t);
  if (autoPath) {                          // tap-to-walk route: dotted line and a marker where you tapped
    const m = P.get(myId), pts = [[m.rx, m.ry], ...autoPath.pts];
    ctx.save(); ctx.setLineDash([TS * .14, TS * .14]); ctx.lineDashOffset = -t / 40; ctx.lineWidth = Math.max(3, TS * .08); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,201,77,.9)'; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x * TS + X, y * TS + Y) : ctx.moveTo(x * TS + X, y * TS + Y)); ctx.stroke(); ctx.setLineDash([]);
    const [gx, gy] = autoPath.goal, pr = 1 + Math.sin(t / 160) * .12;
    ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(gx * TS + X, gy * TS + Y, TS * .32 * pr, TS * .16 * pr, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  if (myRoom) drawRoomLabels(myRoom, X, Y, t);
  if (!myRoom) drawSunlight(t, night);
  else {                                   // indoors: warm lamp light from the middle of the room, darker corners
    const r = myRoom, cx = (r.x + r.w / 2) * TS + X, cy = (r.y + r.h / 2) * TS + Y, R0 = Math.max(r.w, r.h) * TS * .62;
    const gl = ctx.createRadialGradient(cx, cy - TS, TS, cx, cy, R0);
    gl.addColorStop(0, 'rgba(255,214,150,.10)'); gl.addColorStop(.7, 'rgba(255,200,140,0)'); gl.addColorStop(1, 'rgba(30,15,5,.28)');
    ctx.fillStyle = gl; ctx.fillRect(r.x * TS + X, r.y * TS + Y, r.w * TS, r.h * TS);
  }
  if (!myRoom) { drawRain(t); drawAtmos(t, night, A); }
  // inside: no day/night, but the office turns its lights off after work hours
  let dark = myRoom ? 0 : night;
  if (myRoom && myRoom.rk === 'office') { const h = hourNow(); if (h >= G.shift.ot || h < 6) dark = 0.62; }
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); if (!myRoom) drawLights(X, Y, dark); }
  if (!myRoom) drawZTint(t);
  drawHeads(X, Y);
  if (myRoom && myRoom.rk === 'office' && dark > 0) sign(`💡 ไฟปิดแล้ว (เลิกงาน ${hhmm(G.shift.ot)})`, VW / 2, VH * .2, { size: 14 });
  // short fade through black when you go through a door or a gate
  const fp = (performance.now() - fadeT) / 350;
  if (fp < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fp})`; ctx.fillRect(0, 0, VW, VH); }
  if (!ECO || t - (window.__miniT || 0) > 250) { window.__miniT = t; drawMini(); }
}
// home yard: locked zones lie under a hazy overgrown fog with a lock and the price of the next unlock
function drawYardLocks(A, X, Y, t) {
  const yz = wd?.houses?.[A.house]?.[9] || [], price = G.yard.price[yz.length];
  for (let z = 0; z < 9; z++) {
    if (yzOpen(A.house, z)) continue;
    const c = z % 3, r = Math.floor(z / 3), x0 = (A.x + 1 + c * G.yard.zw) * TS + X, y0 = (A.y + 1 + r * G.yard.zh) * TS + Y, w = G.yard.zw * TS, h = G.yard.zh * TS;
    if (x0 > VW || y0 > VH || x0 + w < 0 || y0 + h < 0) continue;
    ctx.fillStyle = 'rgba(28,46,24,.62)'; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(255,230,160,.55)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .9)}px serif`; ctx.fillText('🔒', x0 + w / 2, y0 + h / 2 - TS * .4 + Math.sin(t / 500 + z) * 2);
    if (A.house === me.house && price) sign(`ปลดล็อก ${money(price)}`, x0 + w / 2, y0 + h / 2 + TS * .55, { size: TS * .3 });
  }
}
// a vegetable field in a home yard: seedlings that grow, then the ripe crop bobbing on top
function drawYardCrop(e, X, Y, t) {
  if (e[4].spk) return drawSprinkler(e, X, Y, t);
  if (e[4].tile) return drawSoilCrop(e, X, Y, t);
  const pl = wd?.houses?.[e[4].house]?.[10]?.[e[4].k], px = e[1] * TS + X, py = (e[2] - 1) * TS + Y;
  if (near?.id === 'yf:' + e[4].k) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.strokeRect(px - TS - 2, py - TS - 2, TS * 2 + 4, TS * 2 + 4); }
  if (!pl) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `700 ${Math.round(TS * .6)}px sans-serif`; ctx.fillText('+', px, py); return; }
  const [crop, readyAt] = pl, it = G.items[crop], total = G.crops[crop].grow * 1000, left = readyAt - (Date.now() + clockOff), prog = clamp(1 - left / total, 0, 1);
  for (const [dx, dy] of [[-.5, -.4], [0, -.4], [.5, -.4], [-.5, .4], [0, .4], [.5, .4]]) {
    const cx = px + dx * TS, cy = py + dy * TS, sway = Math.sin(t / 600 + dx * 3 + dy) * TS * .02;
    if (left > 0) {
      const h = TS * (.12 + prog * .38);
      ctx.fillStyle = '#3f8a2a'; ctx.fillRect(cx - 1 + sway, cy - h, 2, h); ctx.fillStyle = prog < .5 ? '#7cc843' : '#4fa632';
      ctx.beginPath(); ctx.ellipse(cx - h * .35 + sway, cy - h * .7, h * .38, h * .2, -.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + h * .35 + sway, cy - h * .85, h * .38, h * .2, .5, 0, 7); ctx.fill();
    } else { ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .48)}px serif`; ctx.fillText(it.icon, cx, cy - TS * .12 + Math.sin(t / 260 + dx * 4) * 1.5); }
  }
  if (left <= 0) { ctx.font = `${Math.round(TS * .38)}px serif`; ctx.fillText('✨', px + TS * .8, py - TS * .85 + Math.sin(t / 200) * 3); }
  else { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(px - TS * .85, py + TS * .8, TS * 1.7, 4); ctx.fillStyle = '#9be15d'; ctx.fillRect(px - TS * .85, py + TS * .8, TS * 1.7 * prog, 4); }
}
// a sprinkler: the ghost shows the cells it reaches; a placed one sprays a ring of droplets now and then
function drawSprinkler(e, X, Y, t) {
  const r = e[4].spk, cx = Math.floor(e[1]), cy = Math.round(e[2]) - 1, x0 = (cx - r) * TS + X, y0 = (cy - r) * TS + Y, w = (2 * r + 1) * TS;
  if (e[4].ghost) { ctx.fillStyle = 'rgba(90,170,255,.18)'; ctx.fillRect(x0, y0, w, w); ctx.strokeStyle = 'rgba(120,200,255,.8)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(x0, y0, w, w); ctx.setLineDash([]); return; }
  const ph = ((t + cx * 377 + cy * 911) % 6000) / 1400; if (ph > 1) return;
  const px = (cx + .5) * TS + X, py = (cy + .5) * TS + Y, R = (r + .5) * TS * ph;
  ctx.fillStyle = `rgba(150,210,255,${.75 * (1 - ph)})`;
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; ctx.beginPath(); ctx.arc(px + Math.cos(a) * R, py + Math.sin(a) * R * .8 - Math.sin(ph * Math.PI) * TS * .3, Math.max(1.5, TS * .05), 0, 7); ctx.fill(); }
}
// a crop on a soil tile: wet soil darkens, a dry one asks for water; the plant goes seed -> sprout -> leafy -> budding -> ripe
const CROP_TINT = {};
function cropTint(id) {                         // the ripe crop's colour, for the buds (sampled once from its emoji)
  if (CROP_TINT[id]) return CROP_TINT[id];
  try { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.font = '14px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(G.items[id].icon, 8, 9);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && !(d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2] + 20)) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return (CROP_TINT[id] = n ? `rgb(${r / n | 0},${gg / n | 0},${b / n | 0})` : '#ffcf4a'); } catch { return (CROP_TINT[id] = '#ffcf4a'); }
}
function drawSoilCrop(e, X, Y, t) {
  const pl = wd?.houses?.[e[4].house]?.[10]?.[e[4].k], px = e[1] * TS + X, py = (e[2] - .5) * TS + Y;
  if (near?.id === 'yf:' + e[4].k) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2; ctx.strokeRect(px - TS / 2 + 1, py - TS / 2 + 1, TS - 2, TS - 2); }
  if (!pl) return;
  const [crop, readyAt, w] = pl, it = G.items[crop], left = readyAt - (Date.now() + clockOff), total = G.crops[crop].grow * 1000 * (w === 0 ? 2 : 1), prog = clamp(1 - left / total, 0, 1);
  if (left > 0 && w !== 0) { ctx.fillStyle = 'rgba(40,20,5,.32)'; ctx.fillRect(px - TS * .42, py - TS * .42, TS * .84, TS * .84); }   // watered: dark damp soil
  const sway = Math.sin(t / 600 + e[1] * 3) * TS * .03, by = py + TS * .22, st = left <= 0 ? 4 : Math.min(3, Math.floor(prog * 4));
  const cs = atlas?.sprites?.[`cr_${crop}_${st}`];
  if (cs && atlasImg) {                          // the painted plant (anchored at its feet, sways a touch, ripe ones bob)
    const w = cs[2] / atlas.tile * TS, h = cs[3] / atlas.tile * TS, bob = st === 4 ? Math.sin(t / 420 + e[1] * 3) * 1 : 0;
    ctx.save(); ctx.translate(Math.round(px), Math.round(py + TS * .46)); ctx.transform(1, 0, -sway / TS * .6, 1, 0, 0);
    ctx.drawImage(atlasImg, cs[0], cs[1], cs[2], cs[3], Math.round(-w / 2), Math.round(-h + bob), Math.round(w), Math.round(h)); ctx.restore();
  } else {
  const leaf = (ang, len, wid, col) => { ctx.save(); ctx.translate(px + sway * .5, by - TS * .04); ctx.rotate(ang + sway / TS); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, -len / 2, wid, len / 2, 0, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(20,60,20,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * .8); ctx.stroke(); ctx.restore(); };
  if (st === 0) {                               // seeds just sown
    ctx.fillStyle = '#3b2412'; ctx.beginPath(); ctx.ellipse(px, by - TS * .05, TS * .2, TS * .08, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8d6a0'; for (const [dx, dy] of [[-.08, -.06], [.06, -.04], [0, -.1]]) ctx.fillRect(px + dx * TS - 1, by + dy * TS - 1, 3, 2);
  } else if (st === 1) {                        // sprout: two small leaves
    ctx.fillStyle = '#4a8a2a'; ctx.fillRect(px - 1 + sway, by - TS * .2, 2, TS * .2);
    leaf(-.9, TS * .2, TS * .07, '#8ad24e'); leaf(.9, TS * .2, TS * .07, '#8ad24e');
  } else {                                      // leafy rosette, then buds in the crop's colour
    const n = st === 2 ? 5 : 7, L = TS * (st === 2 ? .32 : .42);
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * (Math.PI * 1.1 / (n - 1)); leaf(a + Math.PI / 2, L * (i % 2 ? .82 : 1), TS * .085, i % 2 ? '#3f9a4a' : '#52b25a'); }
    leaf(0, L * 1.05, TS * .09, '#2f8a44');
    if (st === 3) { ctx.fillStyle = cropTint(crop); for (const [dx, dy] of [[-.12, -.3], [.13, -.27], [0, -.4]]) { ctx.beginPath(); ctx.arc(px + dx * TS + sway, by + dy * TS, TS * .055, 0, 7); ctx.fill(); } }
    if (st === 4) { ctx.font = `${Math.round(TS * .5)}px serif`; ctx.textAlign = 'center'; ctx.fillText(it.icon, px + sway, by - TS * .32 + Math.sin(t / 260 + e[1] * 4) * 1.5); }
  }
  }
  {                                             // countdown under the crop: time left (or ready) with a thin progress bar
    const bw = TS * .8, bx = px - bw / 2, ty = py + TS * .5;
    const lbl = left <= 0 ? 'เก็บได้!' : left >= 3600e3 ? `${Math.floor(left / 3600e3)}ชม.${Math.floor(left % 3600e3 / 60000)}น.` : `${Math.floor(left / 60000)}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}`;
    ctx.font = `700 ${Math.max(9, Math.round(TS * .2))}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(lbl).width + 8;
    ctx.fillStyle = left <= 0 ? 'rgba(40,120,30,.9)' : 'rgba(20,14,8,.72)'; ctx.fillRect(px - tw / 2, ty - TS * .13, tw, TS * .26);
    if (left > 0) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx, ty + TS * .13, bw, 3); ctx.fillStyle = w === 0 ? '#ffb347' : '#6fdc6f'; ctx.fillRect(bx, ty + TS * .13, bw * prog, 3); }
    ctx.fillStyle = '#fff'; ctx.fillText(lbl, px, ty + 1); ctx.textBaseline = 'alphabetic';
  }
  if (left > 0 && w === 0) {                    // dry: a little water drop asks to be watered
    const bob = Math.sin(t / 300 + e[1]) * 2; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(px + TS * .3, py - TS * .32 + bob, TS * .14, 0, 7); ctx.fill();
    ctx.font = `${Math.round(TS * .2)}px serif`; ctx.textAlign = 'center'; ctx.fillText('💧', px + TS * .3, py - TS * .25 + bob);
  }
}
// a garden bed: wooden frame, dark tilled soil in furrows, crops planted in two rows that grow and ripen
function drawPlot(s, px, py, t) {
  const lot = wd?.lots?.[s.lot], isNear = near && near.id === s.id;
  const unlocked = lot && s.n < lot[1], x0 = px - TS * .95, y0 = py - TS * .95, W = TS * 1.9;
  const b = Math.max(3, TS * .09);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x0 + 3, y0 + 4, W, W);                          // shadow
  ctx.fillStyle = '#8a5a32'; ctx.fillRect(x0, y0, W, W);                                          // wooden frame
  ctx.fillStyle = '#a8733f'; ctx.fillRect(x0, y0, W, b * .6);
  ctx.fillStyle = unlocked ? '#5a3a22' : '#4a3a2e'; ctx.fillRect(x0 + b, y0 + b, W - 2 * b, W - 2 * b);   // soil
  for (let i = 0; i < 4; i++) {                                                                    // furrows
    const fy = y0 + b + (W - 2 * b) * (i + .5) / 4;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x0 + b + 2, fy, W - 2 * b - 4, Math.max(2, TS * .05));
    ctx.fillStyle = 'rgba(255,220,170,.10)'; ctx.fillRect(x0 + b + 2, fy - Math.max(2, TS * .05), W - 2 * b - 4, Math.max(1, TS * .03));
  }
  if (isNear) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.strokeRect(x0 - 2, y0 - 2, W + 4, W + 4); }
  if (!unlocked) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0, y0, W, W); ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText(lot ? '🔒' : '', px, py); return; }
  const pl = lot[2][s.n];
  if (!pl) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `700 ${Math.round(TS * .6)}px sans-serif`; ctx.fillText('+', px, py); return; }
  const [crop, readyAt] = pl, it = G.items[crop], total = G.crops[crop].grow * 1000;
  const left = readyAt - (Date.now() + clockOff), prog = clamp(1 - left / total, 0, 1);
  const spots = [[-.48, -.35], [0, -.35], [.48, -.35], [-.48, .4], [0, .4], [.48, .4]];
  for (const [dx, dy] of spots) {
    const cx = px + dx * TS, cy = py + dy * TS, sway = Math.sin(t / 600 + dx * 3 + dy) * TS * .02;
    if (left > 0) {                                     // sprout → leafy plant
      const h = TS * (.12 + prog * .38);
      ctx.fillStyle = '#3f8a2a'; ctx.fillRect(cx - 1 + sway, cy - h, 2, h);
      ctx.fillStyle = prog < .5 ? '#7cc843' : '#4fa632';
      ctx.beginPath(); ctx.ellipse(cx - h * .35 + sway, cy - h * .7, h * .38, h * .2, -.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + h * .35 + sway, cy - h * .85, h * .38, h * .2, .5, 0, 7); ctx.fill();
    } else {                                            // ripe: the crop itself, bobbing a little
      ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .48)}px serif`; ctx.fillText(it.icon, cx, cy - TS * .12 + Math.sin(t / 260 + dx * 4) * 1.5);
    }
  }
  if (left <= 0) { ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .38)}px serif`; ctx.fillText('✨', px + TS * .75, py - TS * .8 + Math.sin(t / 200) * 3); }
  else { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x0 + b, y0 + W - b - 4, W - 2 * b, 4); ctx.fillStyle = '#9be15d'; ctx.fillRect(x0 + b, y0 + W - b - 4, (W - 2 * b) * prog, 4); }   // growth bar
}
// ---- pets: a pet follows its owner along the owner's own trail (so it never walks through walls), hops while it trots,
// hops by itself now and then, and hops + sends hearts when you tap it
const PETST = new Map();
const petDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// the animals living in a pet shop: they stay put, breathe, hop now and then, and hop for a tap
const SHOP_PETS = { r_pet1: [['shiba', 3.4, 5.2], ['tabby', 10.6, 5.3], ['rabbit', 5.2, 7.6], ['hamster', 8.8, 7.6], ['poodle', 7, 6.4], ['duck', 2.4, 8], ['chick', 11.7, 8], ['corgi', 4.6, 4.7]],
  r_pet2: [['golden', 3.4, 5.2], ['whitecat', 10.6, 5.3], ['lop', 5.2, 7.6], ['guinea', 8.8, 7.6], ['pom', 7, 6.4], ['hedgehog', 2.4, 8], ['penguin', 11.7, 8], ['husky', 9.6, 4.7]] };
const SHOPPETS = new Map();
function shopPets(room) {
  let a = SHOPPETS.get(room.id);
  if (!a) {
    a = (SHOP_PETS[room.id] || []).map(([id, dx, dy], i) => ({ id, x: room.x + dx, y: room.y + dy, view: 'down', flip: false, phase: 0, moving: false, hop: 0, big: 1, hopDur: 420, idleAt: performance.now() + 400 + i * 700, shop: 1 }));
    SHOPPETS.set(room.id, a);
  }
  const now0 = performance.now();
  for (const q of a) if (now0 > q.idleAt) { q.idleAt = now0 + 2200 + Math.random() * 4500; petPlay(q, false); q.big = .7 + Math.random() * .6; if (Math.random() < .5) q.flip = !q.flip; }
  return a;
}
const PET_VOICE = { shiba: 'dog', golden: 'bigdog', corgi: 'dog', pug: 'dog', husky: 'bigdog', dalmatian: 'bigdog', poodle: 'dog', pom: 'dog', chihuahua: 'dog', tabby: 'cat', blackcat: 'cat', whitecat: 'cat', siamese: 'cat', calico: 'cat', britcat: 'cat', oddeye: 'cat',
  chick: 'bird', duck: 'duck', penguin: 'duck', rabbit: 'squeak', lop: 'squeak', hamster: 'squeak', guinea: 'squeak', hedgehog: 'squeak', squirrel: 'squeak', fox: 'dog', redpanda: 'squeak', panda: 'low', capybara: 'low', turtle: 'low', dragon: 'roar', unicorn: 'magic' };
// ---- cooking battle: what each station holds, the timers, what is in your hands, and the big button's hint
let ckLive = null;
const OPN = { chop: ['🔪', 'สับ'], fry: ['🍳', 'ผัด'], boil: ['🍲', 'ต้ม'], grill: ['🔥', 'ย่าง'] };
const AT_ST = { board: 'k_board', pan: 'k_pan', pot: 'k_pot', grill: 'k_grill', plate: 'k_plate', pantry: 'k_pantry' };
const cookSteps = r => Object.keys(r.in).map(i => `${G.items[i].icon}${(r.ops?.[i] || []).map(o => OPN[o][0]).join('')}`).join(' + ') + ' → 🍽️';
function cookState(cp) {                      // 0..1 progress, and whether it is ready / ruined
  const c = me.cook; if (!c) return {};
  const op = cp.ops[cp.k], now0 = Date.now() + clockOff;
  if (cp.at === 'pot' || cp.at === 'grill') { const el = (now0 - cp.t) / 1000, need = G.cook[op], win = G.cook.window[op]; return { p: Math.min(1, el / need), ready: el >= need && el < need + win, burnt: cp.burnt || el >= need + win, warn: el >= need ? (el - need) / win : 0 }; }
  if (cp.at === 'board' || cp.at === 'pan') { const i = c.comps.indexOf(cp), pr = ckLive?.prog?.[i] ?? cp.prog; return { p: cp.ready ? 1 : Math.min(1, pr / G.cook[op]), ready: cp.ready }; }
  return {};
}
function drawCook(X, Y, t) {
  const c = me.cook; if (!c) return;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const by = {};
  c.comps.forEach(cp => { if (AT_ST[cp.at] && cp.at !== 'pantry') (by[cp.at] = by[cp.at] || []).push(cp); });
  for (const [at, list] of Object.entries(by)) {
    const st = STN(AT_ST[at]); if (!st) continue;
    list.forEach((cp, j) => {
      const px = (st.x + (j - (list.length - 1) / 2) * .7) * TS + X, py = (st.y - 1.25) * TS + Y, s0 = cookState(cp);
      if (at === 'plate') { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(G.items[cp.ing].icon, px, py + TS * .35); return; }
      const col = s0.burnt ? '#5a3a2a' : s0.ready ? ((t / 200 | 0) % 2 ? '#7fe08a' : '#c9ffd0') : s0.warn ? '#ff8a3a' : '#ffd34d';
      ctx.fillStyle = 'rgba(20,16,12,.75)'; ctx.beginPath(); ctx.arc(px, py, TS * .36, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(px, py, TS * .36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s0.burnt ? 1 : s0.p || 0)); ctx.stroke();
      ctx.font = `${Math.round(TS * .38)}px serif`; ctx.fillText(s0.burnt ? '💀' : G.items[cp.ing].icon, px, py + 1);
      if ((at === 'pot' || at === 'grill') && !s0.burnt && Math.random() < .05) FX.burst(st.x, st.y - 1, at === 'pot' ? '#ffffff' : '#777777', 2);
      if (s0.burnt && Math.random() < .08) FX.burst(st.x, st.y - 1.2, '#444', 3);
      if (s0.ready && !s0.burnt) { ctx.font = `700 ${Math.round(TS * .24)}px 'Mitr',sans-serif`; ctx.fillStyle = s0.warn > .5 ? '#ff6a4a' : '#7fe08a'; ctx.fillText(s0.warn > .5 ? 'รีบยก!' : 'พร้อม!', px, py - TS * .55); }
    });
  }
  const P0 = P.get(myId);                     // what you carry: above your head
  if (P0) {
    const hx = P0.rx * TS + X, hy = P0.ry * TS + Y - TS * 1.85, held = typeof c.hand === 'number' && c.hand >= 0 ? c.comps[c.hand] : null;
    if (held || c.hand === 'plate') {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(hx, hy, TS * .42, TS * .3, 0, 0, 7); ctx.fill();
      ctx.font = `${Math.round(TS * .36)}px serif`; ctx.fillText(c.hand === 'plate' ? G.items[c.rid].icon : G.items[held.ing].icon, hx, hy + 1);
      if (held) { const nx = held.ops[held.k]; ctx.font = `${Math.round(TS * .22)}px serif`; ctx.fillText(nx ? OPN[nx][0] : '🍽️', hx + TS * .36, hy - TS * .2); }
    }
  }
  ctx.restore();
}
// the big button's label at a kitchen station
function cookCue(st) {
  const c = me.cook; if (!c) return ['🍳', st.label];
  const held = typeof c.hand === 'number' && c.hand >= 0 ? c.comps[c.hand] : null, where = st.type.slice(1), nx = held?.ops[held.k];
  const AT = { board: 'chop', pan: 'fry', pot: 'boil', grill: 'grill' };
  if (st.type === 'kitchen') return c.hand === 'plate' ? ['🛎️', 'เสิร์ฟ!'] : ['📋', 'ดูออเดอร์'];
  if (where === 'pantry') return held ? ['↩️', 'วางคืน'] : c.comps.some(x => x.at === 'pantry') ? ['🧺', 'หยิบวัตถุดิบ'] : ['🧺', 'หยิบครบแล้ว'];
  if (where === 'plate') return held ? (held.k >= held.ops.length ? ['🍽️', 'วางจัดจาน'] : ['⚠️', 'ยังไม่พร้อม']) : c.plated ? ['🍽️', 'ยกจาน'] : ['🍽️', 'โต๊ะจัดจาน'];
  if (held) return AT[where] === nx ? [OPN[nx][0], `วางเพื่อ${OPN[nx][1]}`] : ['⚠️', nx ? `ต้อง${OPN[nx][1]}ที่อื่น` : 'ไปจัดจาน'];
  const here = c.comps.filter(x => x.at === where); if (!here.length) return [st.icon, st.label];
  const r = here.map(cookState); if (r.some(x => x.burnt)) return ['🗑️', 'ทิ้งของเสีย'];
  if (r.some(x => x.ready)) return ['🫴', 'ยกขึ้น'];
  return where === 'board' || where === 'pan' ? [OPN[AT[where]][0], `กำลัง${OPN[AT[where]][1]}... ยืนอยู่`] : ['⏳', 'รอสุก...'];
}
let cookSnd = 0;
function cookFx(kind) {
  if (kind === 'pick' || kind === 'drop') FX.play('pop');
  else if (kind === 'ready') { FX.play('ding'); if (navigator.vibrate) navigator.vibrate(30); }
  else if (kind === 'burnt' || kind === 'fail') FX.play('fail');
  else if (kind === 'serve' || kind === 'plated') FX.play('chime');
  else if (kind === 'pot') FX.play('splash'); else if (kind === 'grill' || kind === 'pan') FX.play('sizzle'); else if (kind === 'board') FX.play('munch');
}
// sounds while you work: chopping knocks at the board, sizzling at the pan
setInterval(() => {
  const c = me?.cook, P0 = P.get(myId); if (!c || !P0 || roomOf(P0.x, P0.y)?.rk !== 'kitchen') return;
  for (const cp of c.comps) if ((cp.at === 'board' || cp.at === 'pan') && !cp.ready) { const st = STN(AT_ST[cp.at]); if (st && Math.hypot(P0.x - st.x, P0.y - st.y) < 1.5) { if (cp.at === 'board') FX.play('chop'); else if (++cookSnd % 4 === 0) FX.play('sizzle'); } }
}, 260);
// the order ticket: dish, time left, each ingredient's path
function cookChip() {
  const c = $('#misChip'); const k = me?.cook; if (!k || me?.mis) return false;
  const left = Math.max(0, Math.ceil((k.until - Date.now() - clockOff) / 1000));
  const parts = k.comps.map(cp => `${G.items[cp.ing].icon}${cp.at === 'plate' ? '✅' : cp.ops.slice(cp.k).map(o => OPN[o][0]).join('') || '🍽️'}`).join(' ');
  c.classList.remove('hidden'); c.classList.toggle('late', left < 20);
  c.textContent = `${G.items[k.rid].icon} ${G.items[k.rid].name} · ${k.plated ? (k.hand === 'plate' ? 'เสิร์ฟที่เคาน์เตอร์!' : 'ยกจานไปเสิร์ฟ') : parts} · ⏱ ${left}s`;
  return true;
}
// ---- beggars: the trash run. A street seen from behind the runner (Pepsiman style): three lanes, rubbish and coins to pick
// up, cones / boxes / dogs to jump over, cars and bins to dodge. Faster and faster until you crash.
let RUN = null;
const RUN_ITEMS = { cup: ['🥤', 2], can: ['🥫', 3], bottle: ['🍾', 3], coin: ['🪙', 8] };
const RUN_OBS = { cone: ['🚧', 0], box: ['📦', 0], dog: ['🐕', 0], car: ['🚗', 1], bin: ['🗑️', 1], cart: ['🛒', 0] };
function runStart(seed) {
  closePanel();
  let w = $('#runWin'); if (!w) { w = document.createElement('div'); w.id = 'runWin'; w.innerHTML = '<canvas id="runCv"></canvas><div class="runHud" id="runHud"></div><button class="x" id="runX" title="เลิกวิ่ง"></button><div class="runEnd hidden" id="runEnd"></div><div class="runHelp" id="runHelp">ปัด/แตะซ้าย-ขวา = เปลี่ยนเลน · ปัดขึ้น/แตะกลาง = กระโดด<br>⌨️ ← → เปลี่ยนเลน · ↑ หรือ Space กระโดด</div>'; document.body.appendChild(w); }
  w.classList.remove('hidden'); $('#runEnd').classList.add('hidden'); $('#runHelp').classList.remove('hidden');
  const r = (n => () => (n = (n * 16807) % 2147483647) / 2147483647)(seed || 1);
  RUN = { r, t: 0, v: 11, dist: 0, lane: 0, lx: 0, jt: -9, objs: [], nextZ: 22, got: { cups: 0, cans: 0, bottles: 0, coins: 0 }, crashed: 0, over: false, shake: 0, step: 0, last: performance.now(), pops: [] };
  $('#runX').onclick = () => runCrash(true);
  const cv = $('#runCv');
  let p0 = null;
  cv.onpointerdown = e => { p0 = { x: e.clientX, y: e.clientY }; };
  // a swipe counts as soon as the finger has travelled far enough, not when it lifts
  cv.onpointermove = e => {
    if (!p0 || !RUN || RUN.crashed) return; const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { p0 = null; runMove(dx > 0 ? 1 : -1); }
    else if (dy < -26 && -dy > Math.abs(dx)) { p0 = null; runJump(); }
  };
  cv.onpointerup = e => {
    if (!p0 || !RUN || RUN.crashed) return; const dx = e.clientX - p0.x, dy = e.clientY - p0.y; p0 = null;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) runMove(dx > 0 ? 1 : -1);
    else if (dy < -30) runJump();
    else { const x = e.clientX / innerWidth; if (x < .33) runMove(-1); else if (x > .67) runMove(1); else runJump(); }
  };
  setTimeout(() => $('#runHelp')?.classList.add('hidden'), 3500);
  FX.play('whoosh'); requestAnimationFrame(runFrame);
}
const runMove = d => { if (!RUN || RUN.crashed) return; const n = Math.max(-1, Math.min(1, RUN.lane + d)); if (n !== RUN.lane) { RUN.lane = n; FX.play('click'); } };
const runJump = () => { if (!RUN || RUN.crashed) return; if (RUN.t - RUN.jt > .62) { RUN.jt = RUN.t; FX.play('pop'); } };
addEventListener('keydown', e => {
  if (!RUN || $('#runWin')?.classList.contains('hidden')) return;
  const k = e.key; e.stopImmediatePropagation(); e.preventDefault();
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') runMove(-1); else if (k === 'ArrowRight' || k === 'd' || k === 'D') runMove(1);
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') runJump(); else if (k === 'Escape') runCrash(true);
}, true);
function runSpawn() {
  const R = RUN, r = R.r, z = R.nextZ, lanes = [-1, 0, 1].sort(() => r() - .5);
  const pat = r();
  if (pat < .35) {                                           // one obstacle, a line of rubbish in another lane
    const ok = Object.keys(RUN_OBS); R.objs.push({ z, lane: lanes[0], o: ok[Math.floor(r() * ok.length)] });
    const it = r() < .12 ? 'coin' : ['cup', 'can', 'bottle'][Math.floor(r() * 3)]; for (let i = 0; i < 4; i++) R.objs.push({ z: z + i * 2.2, lane: lanes[1], i: it });
  } else if (pat < .6) {                                     // two blockers, one gap with rubbish in it
    R.objs.push({ z, lane: lanes[0], o: r() < .5 ? 'car' : 'bin' }, { z, lane: lanes[1], o: r() < .5 ? 'cone' : 'box' });
    R.objs.push({ z: z - 1.5, lane: lanes[2], i: 'can' }, { z: z + 1.5, lane: lanes[2], i: 'cup' });
  } else if (pat < .8) {                                     // a low obstacle with rubbish arcing over it: jump through it
    R.objs.push({ z, lane: lanes[0], o: ['cone', 'box', 'dog', 'cart'][Math.floor(r() * 4)] });
    for (let i = -2; i <= 2; i++) R.objs.push({ z: z + i * 1.4, lane: lanes[0], i: i === 0 && r() < .5 ? 'coin' : 'bottle', h: 1.3 * (1 - (i / 2.6) ** 2) });
  } else {                                                   // a zig-zag of rubbish
    let L = lanes[0]; for (let i = 0; i < 6; i++) { R.objs.push({ z: z + i * 2.4, lane: L, i: i === 5 && r() < .4 ? 'coin' : 'cup' }); if (r() < .4) L = Math.max(-1, Math.min(1, L + (r() < .5 ? -1 : 1))); }
    R.objs.push({ z: z + 8, lane: lanes[1], o: r() < .5 ? 'car' : 'dog' });
  }
  R.nextZ = z + 13 + r() * 9 - Math.min(5, R.t / 25);
}
function runCrash(quit) {
  const R = RUN; if (!R || R.crashed) return;
  R.crashed = performance.now(); R.shake = 1; FX.play(quit ? 'click' : 'fail'); if (!quit && navigator.vibrate) navigator.vibrate([80, 40, 120]);
  const g = R.got, val = g.cups * 2 + g.cans * 3 + g.bottles * 3 + g.coins * 8 + Math.floor(R.dist / 100) * 2;
  setTimeout(() => {
    const e = $('#runEnd'); e.classList.remove('hidden');
    e.innerHTML = `<h2>${quit ? '🛑 เลิกวิ่ง' : '💥 ชนแล้ว!'}</h2><div class="runSum"><div>🏃 ระยะทาง <b>${Math.floor(R.dist)} ม.</b></div><div>🥤 แก้ว ${g.cups} · 🥫 กระป๋อง ${g.cans} · 🍾 ขวด ${g.bottles} · 🪙 เหรียญ ${g.coins}</div><div class="runVal">ขายของเก่าได้ประมาณ <b>${money(Math.min(400, val))}</b>${val > 400 ? '<br><small>(ได้สูงสุด ฿400 ต่อรอบ)</small>' : ''}</div></div><button class="primary big" id="runOk">♻️ เอาไปขาย</button>`;
    $('#runOk').onclick = () => { send({ t: 'trashrun.end', ...g, dist: Math.floor(R.dist) }); $('#runWin').classList.add('hidden'); RUN = null; };
  }, quit ? 100 : 1100);
}
function runFrame(now) {
  const R = RUN; if (!R) return;
  const cv = $('#runCv'); if (!cv) return;
  const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dt = Math.min(.05, (now - R.last) / 1000); R.last = now;
  if (!R.crashed) {
    R.t += dt; R.v = Math.min(30, 11 + R.t * .32); const dz = R.v * dt; R.dist += dz; R.step += dz;
    for (const o of R.objs) o.z -= dz;
    R.nextZ -= dz; while (R.nextZ < 70) runSpawn();
    if (R.step > 3.1) { R.step = 0; if (R.r() < .5) FX.play('step', ','); }
  }
  // object z = how far ahead of the runner it is (it shrinks as you run)
  R.lx += (R.lane - R.lx) * Math.min(1, dt * 14);
  const jh = (() => { const u = (R.t - R.jt) / .62; return u >= 0 && u < 1 ? Math.sin(u * Math.PI) * 1.6 : 0; })();
  // collisions
  if (!R.crashed) for (const o of R.objs) {
    if (o.done || o.z > .9 || o.z < -.6 || Math.abs(o.lane - R.lx) > .45) continue;
    if (o.i) { if (Math.abs(jh - (o.h || 0)) < 1.1) { o.done = 1; const k = { cup: 'cups', can: 'cans', bottle: 'bottles', coin: 'coins' }[o.i]; R.got[k]++; FX.play(o.i === 'coin' ? 'coin' : 'pop'); R.pops.push({ t: now, txt: `+${RUN_ITEMS[o.i][1]}` }); } }
    else if (RUN_OBS[o.o][1] || jh < .55) { o.done = 1; runCrash(false); break; }
  }
  R.objs = R.objs.filter(o => o.z > -3 && !(o.done && o.i));
  // ---- draw
  const sh = R.shake > 0 ? (R.shake *= .9, (Math.random() - .5) * 14 * R.shake) : 0;
  g.save(); g.translate(sh, 0);
  const y0 = H * .32, D = 5.2, by = H * 1.0, cx = W / 2, lw = Math.min(W * .26, 230);
  const S = z => D / (Math.max(-D * .8, z) + D), Y = z => y0 + (by - y0) * S(z), X = (l, z) => cx + l * lw * S(z);
  const sky = g.createLinearGradient(0, 0, 0, y0); sky.addColorStop(0, '#7ec8ff'); sky.addColorStop(1, '#d9f0ff'); g.fillStyle = sky; g.fillRect(-20, 0, W + 40, y0 + 1);
  g.fillStyle = '#9aa7b6'; for (let i = 0; i < 14; i++) { const bw = W / 10, bh = 30 + ((i * 53) % 70); g.fillRect(i * bw - 10, y0 - bh, bw * .8, bh); }
  g.fillStyle = '#c9d2db'; for (let i = 0; i < 14; i++) { const bw = W / 10; for (let k = 0; k < 4; k++) g.fillRect(i * bw + 4 + k * bw * .18, y0 - 20 - ((i * 53) % 70) * .6, bw * .1, 6); }
  g.fillStyle = '#7dbb5b'; g.fillRect(-20, y0, W + 40, by - y0);
  const quad = (l1, l2, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(X(l1, 80), Y(80)); g.lineTo(X(l2, 80), Y(80)); g.lineTo(X(l2, -2), Y(-2)); g.lineTo(X(l1, -2), Y(-2)); g.fill(); };
  quad(-2.3, 2.3, '#d8cfbf'); quad(-1.55, 1.55, '#4b4f57');
  g.fillStyle = '#e9d36a'; const off = R.dist % 6;
  for (let k = 0; k < 14; k++) { const z1 = k * 6 - off, z2 = z1 + 2.5; if (z2 < -1) continue; for (const l of [-.5, .5]) { g.beginPath(); g.moveTo(X(l - .02, z1), Y(z1)); g.lineTo(X(l + .02, z1), Y(z1)); g.lineTo(X(l + .02, z2), Y(z2)); g.lineTo(X(l - .02, z2), Y(z2)); g.fill(); } }
  for (let k = 0; k < 10; k++) { const z = k * 9 - (R.dist % 9); if (z < -1) continue; const s = S(z); g.font = `${Math.round(70 * s)}px serif`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(k % 2 ? '🌳' : '💡', X(-2.6, z), Y(z)); g.fillText(k % 2 ? '💡' : '🌳', X(2.6, z), Y(z)); }
  // objects far to near
  for (const o of [...R.objs].sort((a, b) => b.z - a.z)) {
    if (o.z > 62 || o.done) continue;
    const s = S(o.z), x = X(o.lane, o.z), y = Y(o.z), size = (o.i ? .42 : RUN_OBS[o.o][1] ? .95 : .62) * lw * s;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y, size * .45, size * .12, 0, 0, 7); g.fill();
    g.font = `${Math.round(size)}px serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const bob = o.i ? Math.sin(now / 200 + o.z) * 4 * s : 0;
    g.fillText(o.i ? RUN_ITEMS[o.i][0] : RUN_OBS[o.o][0], x, y - (o.h || 0) * .55 * lw * s - bob);
  }
  // the runner, from behind
  const px = X(R.lx, 0), py = Y(0) - 8, k = Math.min(H * .25, lw * 1.25) / CH_ATLAS.h;
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px, py, 46 * (1 - jh * .2), 12, 0, 0, 7); g.fill();
  if (chImg) drawCharTo(g, { of: 'beggar', g: me.gender, lk: me.look || {} }, px, py - jh * 70, k, 'back', R.crashed ? 0 : Math.floor(R.dist / 1.4) % 4);
  if (R.crashed) { g.font = '64px serif'; g.textAlign = 'center'; g.fillText('💫', px, py - CH_ATLAS.h * k - 10); }
  for (const p of R.pops) { const u = (now - p.t) / 700; if (u > 1) continue; g.globalAlpha = 1 - u; g.font = `800 24px 'Mitr',sans-serif`; g.fillStyle = '#ffd34d'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(p.txt, px + 50, py - 200 - u * 50); g.fillText(p.txt, px + 50, py - 200 - u * 50); g.globalAlpha = 1; }
  R.pops = R.pops.filter(p => now - p.t < 700);
  g.restore();
  const G0 = R.got; $('#runHud').innerHTML = `🏃 <b>${Math.floor(R.dist)}</b> ม. · 🥤${G0.cups} 🥫${G0.cans} 🍾${G0.bottles} 🪙${G0.coins} · ⚡ ${Math.round(R.v * 3.6)} กม./ชม.`;
  if (!(R.crashed && now - R.crashed > 3000)) requestAnimationFrame(runFrame);
}
// ---- riders: the orange rival in town, and the battle screen (Pokemon style, turn by turn)
let RIVAL = null;
function rivalEnts(ents, vis) {
  const r = me?.rival, P0 = P.get(myId);
  if (!r || !P0 || areaOf(P0.x, P0.y)?.id !== 'town') { RIVAL = null; return; }
  if (!RIVAL || RIVAL.name !== r.name) RIVAL = { id: 'rival', staff: 1, career: 'rider', c: 'rider', of: 'rider', dye: 'orange', g: 'm', lk: { hair: 'black' }, name: r.name, short: r.name, x: r.x, y: r.y, rx: r.x, ry: r.y, f: 6, dz: [] };
  const t = performance.now(); RIVAL.f = (t / 900 | 0) % 2 ? 6 : 2;
  if (vis(r.x, r.y, 3)) { ents.push([r.y + .3, 4, RIVAL]); ents.push([r.y + .31, 7, { k: 'mark', x: r.x, y: r.y }]); }
}
const RBM = [['dash', '🛵 บิดคันเร่ง', 'พลัง 22 · แม่น 95%'], ['cut', '📍 มุดทางลัด', 'พลัง 34 · แม่น 72%'], ['honk', '📣 บีบแตรข่ม', 'ลดพลังโจมตีศัตรู 3 เทิร์น'], ['smile', '😊 ยิ้มหวานให้ลูกค้า', 'ฟื้นแรงใจ 28% (พัก 2 เทิร์น)']];
let RB = null;
function rbOpen(st) {
  RB = { st, busy: true, shown: { me: st.me.hp, foe: st.foe.hp } };
  let w = $('#rbWin'); if (!w) { w = document.createElement('div'); w.id = 'rbWin'; document.body.appendChild(w); }
  w.innerHTML = `<div class="rbField"><div class="rbFoeBox rbBox"><b>${esc(st.foe.name)}</b><span>Lv.${st.foe.lv}</span><div class="rbHp"><i id="rbFoeHp"></i></div></div>
    <div class="rbFoeSpot"><canvas id="rbFoeCv" width="180" height="150"></canvas></div><div class="rbMeSpot"><canvas id="rbMeCv" width="200" height="170"></canvas></div>
    <div class="rbMeBox rbBox"><b>${esc(st.me.name)}</b><span>Lv.${st.me.lv}</span><div class="rbHp"><i id="rbMeHp"></i></div><small id="rbMeNum"></small></div></div>
    <div class="rbBottom"><div class="rbText" id="rbText"></div><div class="rbMenu hidden" id="rbMenu"></div></div>`;
  w.classList.remove('hidden'); closePanel();
  whenChars(() => {
    const f = $('#rbFoeCv').getContext('2d'); f.clearRect(0, 0, 180, 150); drawCharTo(f, { of: 'rider', dye: 'orange', g: 'm', lk: { hair: 'black' } }, 90, 140, 130 / CH_ATLAS.h, 'front', 0);
    const m = $('#rbMeCv').getContext('2d'); m.clearRect(0, 0, 200, 170); drawCharTo(m, { of: 'rider', g: me.gender, lk: me.look || {} }, 100, 165, 160 / CH_ATLAS.h, 'back', 0);
  });
  rbBars(); FX.play('notice');
  rbSay([`${st.foe.name} ต้องการแย่งลูกค้า (${st.cust})!`, `ไปเลย ${st.me.name}!`], () => rbMenu());
}
function rbBars() {
  if (!RB) return; const s = RB.st, sh = RB.shown;
  const set = (id, hp, max) => { const e = $(id); if (!e) return; const f = Math.max(0, hp / max); e.style.width = f * 100 + '%'; e.style.background = f > .5 ? '#4cd964' : f > .2 ? '#ffcc00' : '#ff3b30'; };
  set('#rbFoeHp', sh.foe, s.foe.max); set('#rbMeHp', sh.me, s.me.max); const n = $('#rbMeNum'); if (n) n.textContent = `${Math.round(sh.me)}/${s.me.max}`;
}
function rbSay(lines, done) {
  const el = $('#rbText'); let i = 0;
  const next = () => {
    if (i >= lines.length) return done && done();
    const L = lines[i++], txt = typeof L === 'string' ? L : L.text; el.textContent = '';
    if (typeof L === 'object' && L.fx) L.fx();
    let k = 0; const ty = setInterval(() => { el.textContent = txt.slice(0, ++k); if (k >= txt.length) { clearInterval(ty); setTimeout(next, 650); } }, 22);
  };
  next();
}
function rbMenu() {
  if (!RB) return; RB.busy = false; const mn = $('#rbMenu'), m = RB.st.me;
  $('#rbText').textContent = `${m.name} จะทำอะไร?`;
  mn.innerHTML = RBM.map(([k, l, d]) => `<button data-rb="${k}" ${k === 'smile' && m.cd > 0 ? 'disabled' : ''}><b>${l}</b><small>${d}</small></button>`).join('') + `<button data-rb="drink" ${m.drinks ? '' : 'disabled'}><b>🧃 เครื่องดื่มชูกำลัง</b><small>ฟื้นแรงใจ 35 · เหลือ ${m.drinks}</small></button><button data-rb="run" class="warn"><b>🏳️ ยอมถอย</b><small>ปล่อยลูกค้าไป</small></button>`;
  mn.classList.remove('hidden');
  mn.querySelectorAll('[data-rb]').forEach(b => b.onclick = () => { if (RB.busy) return; RB.busy = true; mn.classList.add('hidden'); FX.play('click'); send({ t: 'rb', mv: b.dataset.rb }); });
}
function rbShake(who, kind) {
  const c = $(who === 'me' ? '#rbMeCv' : '#rbFoeCv'); if (!c) return;
  c.classList.remove('rbHit', 'rbHeal', 'rbAtk'); void c.offsetWidth; c.classList.add(kind);
}
function rbResult(m) {
  if (m.start) return rbOpen(m.st);
  if (!RB) return;
  const lines = (m.ev || []).map(e => ({ text: e.text, fx: () => {
    if (e.mv) { rbShake(e.who, 'rbAtk'); FX.play(e.mv === 'honk' || e.mv === 'shout' ? 'notice' : e.mv === 'smile' || e.mv === 'call' ? 'heal' : 'whoosh'); }
    if (e.dmg) { RB.shown[e.tgt] = Math.max(0, RB.shown[e.tgt] - e.dmg); rbShake(e.tgt, 'rbHit'); FX.play(e.crit ? 'bite' : 'fail'); if (navigator.vibrate) navigator.vibrate(e.crit ? 80 : 40); rbBars(); }
    if (e.heal) { RB.shown[e.tgt] += e.heal; rbShake(e.tgt, 'rbHeal'); rbBars(); }
    if (e.miss) FX.play('click');
    if (e.win) FX.play('levelup'); if (e.lose) FX.play('fail');
  } }));
  if (m.st) RB.st = { ...RB.st, ...m.st };
  rbSay(lines, () => { if (m.end) setTimeout(() => { $('#rbWin')?.classList.add('hidden'); RB = null; }, 900); else rbMenu(); });
}
// ---- job missions: the current step drawn in the world (people, things to find/pick up, the animal to catch,
// the spot to work at), a guide arrow toward it, a chip with the time left, and the questions people ask
let misLive = null, MISNPC = null;
const MIS_CAREERS = ['office', 'farmer', 'merchant', 'doctor', 'police', 'beggar', 'rider', 'templeboy', 'undertaker', 'mechanic', 'thug', 'photographer', 'courier'];
const MIS_K = { go: '🚶', find: '🔍', collect: '🧺', deliver: '🤝', work: '🛠️', chase: '🏃', escort: '🧑‍🤝‍🧑', talk: '💬' };
function misBox() {
  const m = me.mis, cd = Math.max(0, Math.ceil(((me.misNext || 0) - (Date.now() + clockOff)) / 1000));
  if (me.career === 'none' && !me.admin) return '';
  if (m?.kind === 'icu' && panel?.kind === 'career') return '<div class="jobbox">🚨 กำลังทำเคสฉุกเฉินที่ ICU</div>';
  if (!m) {
    const giver = STAFF.find(x => x.career === me.career && !x.keeper), at = giver && STN(giver.st);
    const where = me.career === 'farmer' ? 'ไร่ชานเมืองปิดปรับปรุงอยู่ เกษตรกรรับภารกิจที่หน้าประตูไร่ (ฝั่งตะวันตกของเมือง)' : giver ? `คุยกับ <b>${esc(giver.short)}</b> ที่${esc(AREA[at?.area]?.label || AREA[at?.area]?.name || at?.label || '')}` : '';
    return `<div class="jobbox">📋 <b>ภารกิจอาชีพ</b> · งานจริงในเมือง 20 แบบสุ่มของ${esc(G.careers[me.career]?.name || '')} · <b>รับภารกิจได้ที่ NPC ของอาชีพ</b>${where ? `: ${where}` : ''}${cd > 0 ? `<br><small>งานใหม่เข้าในอีก ${cd} วินาที</small>` : ''}${me.admin ? `<div class="grid2">${['office', 'farmer', 'merchant', 'chef', 'doctor', 'police', 'beggar', 'rider'].map(c => B(`${G.careers[c].icon} ${G.careers[c].name}`, { t: 'mission', op: 'start', car: c }, c === me.career ? 'primary' : 'good')).join('')}</div><small>👑 แอดมินเลือกภารกิจของอาชีพไหนก็ได้ จากที่ไหนก็ได้</small>` : ''}</div>`;
  }
  const steps = m.steps.map((s, j) => `<li class="${s.done ? 'done' : j === m.i ? 'cur' : ''}">${s.done ? '✅' : j === m.i ? '👉' : '▫️'} ${MIS_K[s.k] || ''} ${esc(s.label)}</li>`).join('');
  return `<div class="jobbox">${m.icon} <b>${esc(m.title)}</b> · เหลือเวลา <b class="miscd"></b><br><small>${esc(m.story)}</small><ul class="misSteps">${steps}</ul>${B('ยกเลิกภารกิจ', { t: 'mission', op: 'quit' })}</div>`;
}
function paintMisChip() {
  document.querySelectorAll('.auccd').forEach(el => { const l = Math.max(0, Math.ceil((+el.dataset.t - Date.now() - clockOff) / 1000)); el.textContent = l ? `${l} วินาที` : 'ปิดรับซอง!'; });
  const c = $('#misChip'), m = me?.mis;
  if (!m) { if (!cookChip()) c.classList.add('hidden'); return; }
  const left = Math.max(0, Math.ceil((m.until - Date.now() - clockOff) / 1000)), tm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const cur = m.cur; let extra = '';
  if (cur?.k === 'collect') extra = ` (${cur.items.filter(i => i[2]).length}/${cur.items.length})`;
  if (cur?.k === 'work') extra = ` ${Math.floor(((misLive?.k === 'work' ? misLive.prog : cur.prog) || 0) / cur.sec * 100)}%`;
  if (cur?.k === 'escort' && misLive?.wait) extra = ' · รอด้วย!';
  c.classList.remove('hidden'); c.classList.toggle('late', left < 30);
  const html = `${esc(`${m.icon} ${cur ? (MIS_K[cur.k] || '') + ' ' + cur.label : m.title}${extra} · ${tm}`)}<span class="chipX">✕</span>`; if (c.innerHTML !== html) c.innerHTML = html;
  document.querySelectorAll('.miscd').forEach(el => { el.textContent = tm; });
}
setInterval(paintMisChip, 250);
$('#misChip').onclick = () => { if (me?.cook && !me.mis) return toast('ทำทีละขั้น: 🧺 หยิบวัตถุดิบ → 🔪 สับ / 🍳 ผัด (ยืนทำ) → 🍲 ต้ม / 🔥 ย่าง (สุกเองแต่อย่าปล่อยนาน!) → 🍽️ วางจัดจาน → 🛎️ ยกไปเสิร์ฟที่เคาน์เตอร์ด้านบน', '🍳'); openPanel({ kind: me?.mis?.kind === 'icu' ? 'icu' : 'career', st: me?.mis?.kind === 'icu' ? 'icu' : undefined }); };
function misAsk(m) {
  MISNPC = misPerson(m.who, 0, 0);
  dialog({ name: m.who.name, npc: 'misnpc', lines: [m.q], choices: m.ans.map((a, i) => ({ label: a, fn: () => { dialogClose(); send({ t: 'mission', op: 'answer', i }); } })) });
}
function misPerson(w, x, y) { return { id: 'misnpc', staff: 1, career: '', c: '', of: '', g: w.g, lk: w.lk, name: w.name, short: w.name, x, y, rx: x, ry: y, f: 6, dz: [], kid: w.kid }; }
const misAnim = {};
function misEnts(ents, vis) {
  const m = me?.mis, c = m?.cur, P0 = P.get(myId);
  if (!c || !P0 || areaOf(P0.x, P0.y)?.id !== (c.area || 'town')) { MISNPC = null; return; }
  const near = (x, y, r) => Math.hypot(P0.rx - x, P0.ry - y) < r;
  if (c.k === 'deliver' || c.k === 'talk' || (c.k === 'escort')) {
    let x = c.x, y = c.y;
    if (c.k === 'escort') { const L = misLive?.k === 'escort' ? misLive : c; x = L.fx ?? c.fx; y = L.fy ?? c.fy; }
    if (!MISNPC || MISNPC.name !== c.who.name) MISNPC = misPerson(c.who, x, y);
    MISNPC.x = x; MISNPC.y = y; MISNPC.rx += (x - MISNPC.rx) * .2; MISNPC.ry += (y - MISNPC.ry) * .2;
    if (Math.hypot(x - MISNPC.rx, y - MISNPC.ry) > 3) { MISNPC.rx = x; MISNPC.ry = y; }
    const dx = x - (MISNPC.px ?? x), dy = y - (MISNPC.py ?? y); if (Math.hypot(dx, dy) > .01) MISNPC.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8; MISNPC.px = x; MISNPC.py = y;
    if (vis(MISNPC.rx, MISNPC.ry, 3)) ents.push([MISNPC.ry + .3, 4, MISNPC]);
    if (vis(MISNPC.rx, MISNPC.ry, 3)) ents.push([MISNPC.ry + .31, 7, { k: 'mark', x: MISNPC.rx, y: MISNPC.ry, wait: c.k === 'escort' && misLive?.wait, ph: c.phase }]);
  } else MISNPC = null;
  if (c.k === 'find' && near(c.x, c.y, 9)) ents.push([c.y + .2, 7, { k: 'item', x: c.x, y: c.y, icon: c.icon, glow: 1 }]);
  if (c.k === 'collect') for (const it of c.items) if (!it[2] && near(it[0], it[1], 11)) ents.push([it[1] + .2, 7, { k: 'item', x: it[0], y: it[1], icon: c.icon }]);
  if (c.k === 'work') ents.push([-1e8, 7, { k: 'spot', x: c.x, y: c.y, icon: c.icon }]);
  if (c.k === 'go') ents.push([c.y + .2, 7, { k: 'beacon', x: c.x, y: c.y }]);
  if (c.k === 'chase') {
    const L = misLive?.k === 'chase' ? misLive : c, key = m.t0 + ':' + m.i;
    let q = misAnim[key]; if (!q) { for (const k in misAnim) delete misAnim[k]; q = misAnim[key] = { id: c.animal, x: L.cx, y: L.cy, view: 'down', flip: false, phase: 0, moving: false, hop: 0, big: 1, hopDur: 380, idleAt: 0, shop: 1 }; }
    const dx = L.cx - q.x, dy = L.cy - q.y, d = Math.hypot(dx, dy);
    q.x += dx * .25; q.y += dy * .25; q.moving = d > .02;
    if (q.moving) { q.phase += d * 2.2; if (Math.abs(dx) > Math.abs(dy)) { q.view = 'side'; q.flip = dx < 0; } else q.view = dy < 0 ? 'up' : 'down'; } else if (performance.now() > q.idleAt) { q.idleAt = performance.now() + 1500 + Math.random() * 2000; petPlay(q, false); }
    if (vis(q.x, q.y, 3)) ents.push([q.y + .3, 6, q]);
  }
}
function drawMisThing(e, X, Y, t) {
  const px = e.x * TS + X, py = e.y * TS + Y;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (e.k === 'item') {
    const b = Math.sin(t / 300 + e.x) * 3;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py + TS * .3, TS * .22, TS * .07, 0, 0, 7); ctx.fill();
    if (e.glow) { ctx.fillStyle = `rgba(255,236,140,${.25 + .15 * Math.sin(t / 200)})`; ctx.beginPath(); ctx.arc(px, py, TS * .45, 0, 7); ctx.fill(); }
    ctx.font = `${Math.round(TS * .5)}px serif`; ctx.fillText(e.icon, px, py + b);
  } else if (e.k === 'spot') {
    const p = (misLive?.k === 'work' ? misLive.prog : me.mis?.cur?.prog) || 0, sec = me.mis?.cur?.sec || 1;
    ctx.strokeStyle = 'rgba(255,214,90,.9)'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -t / 60;
    ctx.beginPath(); ctx.ellipse(px, py + TS * .25, TS * 1.5, TS * .6, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,214,90,.15)'; ctx.fill();
    ctx.font = `${Math.round(TS * .5)}px serif`; ctx.fillText(e.icon, px, py - TS * .3 + Math.sin(t / 250) * 3);
    if (p > 0) { ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(px, py - TS * 1.1, TS * .3, 0, 7); ctx.stroke(); ctx.strokeStyle = '#7fe08a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(px, py - TS * 1.1, TS * .3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p / sec)); ctx.stroke(); }
  } else if (e.k === 'beacon') {
    const g = ctx.createLinearGradient(0, py - TS * 3, 0, py); g.addColorStop(0, 'rgba(255,220,90,0)'); g.addColorStop(1, 'rgba(255,220,90,.45)');
    ctx.fillStyle = g; ctx.fillRect(px - TS * .35, py - TS * 3, TS * .7, TS * 3);
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(px, py, TS * .7 + Math.sin(t / 250) * 3, TS * .28, 0, 0, 7); ctx.stroke();
  } else if (e.k === 'cook') { ctx.restore(); return drawCook(X, Y, t);
  } else if (e.k === 'mark') {
    ctx.font = `800 ${Math.round(TS * .5)}px sans-serif`; ctx.fillStyle = e.wait ? '#ff6b5a' : '#ffd34d'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    const s = e.wait ? '⏳' : e.ph === 1 ? '' : '!', y = py - TS * 2.05 + Math.sin(t / 220) * 3;
    if (s) { ctx.strokeText(s, px, y); ctx.fillText(s, px, y); }
    if (e.wait) { ctx.font = `600 ${Math.round(TS * .26)}px 'Mitr',sans-serif`; ctx.fillStyle = '#fff'; ctx.strokeText('รอด้วย!', px, y - TS * .45); ctx.fillText('รอด้วย!', px, y - TS * .45); }
  }
  ctx.restore();
}
// where to go now: escort -> the destination once picked up; find/collect -> the hint ring's centre until you are close
function misTarget() {
  if (!me?.mis && me?.rival) return { x: me.rival.x, y: me.rival.y };
  const c = me?.mis?.cur; if (!c) return null;
  if (c.k === 'escort') return (misLive?.phase ?? c.phase) === 1 ? c.to : { x: misLive?.fx ?? c.fx, y: misLive?.fy ?? c.fy };
  if (c.k === 'chase') return { x: misLive?.cx ?? c.cx, y: misLive?.cy ?? c.cy };
  if (c.k === 'collect') { const it = c.items.find(i => !i[2]); return it ? { x: it[0], y: it[1], vague: 1 } : null; }
  if (c.k === 'find') return { x: c.hc[0], y: c.hc[1], vague: 1 };
  return { x: c.x, y: c.y };
}
function drawMisGuide(X, Y, t) {
  const s = P.get(myId), tg = misTarget(); if (!s || !tg || areaOf(s.x, s.y)?.id !== (me.mis?.cur?.area || 'town')) return;
  const dx = tg.x - s.rx, dy = tg.y - s.ry, d = Math.hypot(dx, dy); if (d < (tg.vague ? 7 : 3)) return;
  const a = Math.atan2(dy, dx), r = TS * 1.05, cx = s.rx * TS + X + Math.cos(a) * r, cy = s.ry * TS + Y + TS * .2 + Math.sin(a) * r * .6;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  ctx.fillStyle = tg.vague ? 'rgba(255,190,60,.9)' : 'rgba(90,170,255,.95)'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(TS * .3, 0); ctx.lineTo(-TS * .12, -TS * .18); ctx.lineTo(-TS * .04, 0); ctx.lineTo(-TS * .12, TS * .18); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.font = `700 ${Math.round(TS * .24)}px 'Mitr',sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = '#fff';
  const lx = s.rx * TS + X + Math.cos(a) * r * 1.55, ly = s.ry * TS + Y + TS * .2 + Math.sin(a) * r * .95; const txt = `${Math.round(d)} ม.`;
  ctx.strokeText(txt, lx, ly); ctx.fillText(txt, lx, ly);
}
function misMini(g, A, mapId) {
  if (me?.rival && mapId === 'town') { const x = (me.rival.x - A.x) * 2, y = (me.rival.y - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fill(); g.fillStyle = (performance.now() / 300 | 0) % 2 ? '#ff8a1a' : '#ffb85a'; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill(); }
  const c = me?.mis?.cur; if (!c || mapId !== 'town' || (c.area || 'town') !== 'town') return;
  const tg = misTarget(); if (!tg) return;
  const blink = (performance.now() / 350 | 0) % 2;
  if (c.hc && (c.k === 'find' || c.k === 'collect')) { g.strokeStyle = blink ? '#5ab0ff' : '#2a7fd0'; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.arc((c.hc[0] - A.x) * 2, (c.hc[1] - A.y) * 2, c.hc[2] * 2, 0, 7); g.stroke(); g.setLineDash([]); }
  else { const x = (tg.x - A.x) * 2, y = (tg.y - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.fillStyle = blink ? '#2a7fd0' : '#5ab0ff'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
}
// the police case's lost dog: sits out in town (only the officer on the case sees it), looks around, hops, barks when you are close
let lostQ = null;
function lostDog() {
  const c = me?.dogq, m = P.get(myId);
  if (!c || c.kind === 'thief' || !m || areaOf(m.x, m.y)?.id !== 'town') { lostQ = null; return null; }
  if (!lostQ || lostQ.key !== c.t0) lostQ = { key: c.t0, id: c.dog, x: c.x, y: c.y, view: 'down', flip: false, phase: 0, moving: false, hop: 0, big: 1, hopDur: 420, idleAt: performance.now() + 1500, shop: 0, lost: 1, barkAt: 0 };
  const now0 = performance.now(), d = Math.hypot(m.rx - c.x, m.ry - c.y);
  if (now0 > lostQ.idleAt) { lostQ.idleAt = now0 + 1800 + Math.random() * 2500; petPlay(lostQ, false); lostQ.big = .8 + Math.random() * .5; lostQ.flip = Math.random() < .5; }
  if (now0 > lostQ.barkAt && d < 16) { lostQ.barkAt = now0 + 2800 + Math.random() * 2500; FX.play('pet', [PET_VOICE[c.dog] || 'dog', Math.max(.12, 1 - d / 16)]); if (d < 9) FX.float(c.x, c.y - 1, '🐕', '#fff', .45); }
  return d < 11 ? lostQ : null;                    // out of sight until you are close
}
// the thief on a police case: a masked figure with a red name, pacing where he was seen (only the officer on the case sees him)
let thiefQ = null;
function thiefNpc() {
  const c = me?.dogq, m = P.get(myId);
  if (!c || c.kind !== 'thief' || !m || areaOf(m.x, m.y)?.id !== 'town') { thiefQ = null; return null; }
  if (!thiefQ || thiefQ.key !== c.t0) thiefQ = { key: c.t0, id: 'thief', npc: 1, red: 1, of: 'thief', g: 'm', name: c.name, lk: { hair: 'black', shirt: 'black', pants: 'black' }, dz: [], x: c.x, y: c.y, rx: c.x, ry: c.y, f: 6 };
  const t = performance.now() / 1000, d = Math.hypot(m.rx - c.x, m.ry - c.y), nx = c.x + Math.sin(t * .7) * .9;
  thiefQ.f = Math.cos(t * .7) > 0 ? 2 : 6; thiefQ.x = nx; thiefQ.rx = nx;
  if (d < 6 && !thiefQ.seen) { thiefQ.seen = 1; FX.float(c.x, c.y - 1.4, '😱', '#fff', .55); FX.play('notice'); }
  return d < 30 ? thiefQ : null;
}
function petPlay(q, love) {
  q.hop = performance.now(); q.big = love ? 1.7 : 1; q.hopDur = love ? 520 : 420;
  // voices: always when tapped; now and then for your own pet and the shop's animals (never other players' pets, to keep it quiet)
  if (love || (q.shop || q.owner === myId) && Math.random() < .3) FX.play('pet', [PET_VOICE[q.id] || 'squeak', love ? 1 : .55]);
  if (love) { FX.play('pop'); FX.float(q.x, q.y - .9, '❤', '#ff6b9a', .55); FX.burst(q.x, q.y - .5, '#ff9ec0', 8); if (navigator.vibrate) navigator.vibrate(12); }
}
function stepPets(dt) {
  const now0 = performance.now();
  for (const p of P.values()) {
    if (!p.pt) { PETST.delete(p.id); continue; }
    let q = PETST.get(p.id);
    const head = [p.rx, p.ry], area = areaOf(p.x, p.y)?.id;
    if (!q || q.id !== p.pt) {                                      // just called out: pops up next to the owner with a big hop
      q = { id: p.pt, owner: p.id, x: p.rx - .7, y: p.ry + .1, trail: [head], area, view: 'down', flip: false, phase: 0, moving: false, hop: 0, big: 1, hopDur: 420, idleAt: now0 + 2500 };
      PETST.set(p.id, q); petPlay(q, false); q.big = 1.5; if (p.id === myId) FX.play('pet', [PET_VOICE[q.id] || 'squeak', .8]); if (vis0(q)) { FX.burst(q.x, q.y - .4, '#ffe27a', 10); FX.play('pop'); }
    }
    const last = q.trail[q.trail.length - 1];
    if (area !== q.area || petDist(head, last) > 3) { q.area = area; q.trail = [head]; q.x = p.rx - .6; q.y = p.ry + .1; }   // door / teleport: it comes along
    else if (petDist(head, last) > .1) q.trail.push(head);
    let tot = 0;                                                     // keep ~3 tiles of trail
    for (let i = q.trail.length - 1; i > 0; i--) { tot += petDist(q.trail[i], q.trail[i - 1]); if (tot > 3) { q.trail.splice(0, i - 1); break; } }
    const D = 1.0; let tgt = null, acc = 0;
    for (let i = q.trail.length - 1; i > 0 && !tgt; i--) {
      const a = q.trail[i], b = q.trail[i - 1], l = petDist(a, b);
      if (acc + l >= D) { const f = (D - acc) / (l || 1); tgt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      acc += l;
    }
    if (!tgt) {                                                      // standing still next to you: stay, but never right on top of you
      const d = petDist([q.x, q.y], head);
      tgt = d < .6 ? [head[0] + (q.x - head[0]) / (d || 1) * .85 + (d ? 0 : .8), head[1] + (q.y - head[1]) / (d || 1) * .85] : [q.x, q.y];
    }
    const dx = tgt[0] - q.x, dy = tgt[1] - q.y, d = Math.hypot(dx, dy);
    let step = 0;
    if (d > .05) { const sp = Math.min(d * 6.5 + .6, 8.5); step = Math.min(d, sp * dt); q.x += dx / d * step; q.y += dy / d * step; }
    q.moving = step / Math.max(dt, .001) > .8;
    if (q.moving) {
      q.spd = step / Math.max(dt, .001); q.phase += Math.min(step * 2.4, dt * 8); q.idleAt = now0 + 2500 + Math.random() * 3500;
      if (Math.abs(dx) > Math.abs(dy) * 1.1) { q.view = 'side'; q.flip = dx < 0; } else q.view = dy < 0 ? 'up' : 'down';
    } else {
      q.phase = 0;
      if (now0 > q.idleAt) { q.idleAt = now0 + 2500 + Math.random() * 4500; petPlay(q, false); q.big = .7 + Math.random() * .5; if (Math.random() < .25) FX.float(q.x, q.y - .9, '♪', '#ffd9ea', .4); }
      if (now0 - (q.movedAt || 0) > 700) q.view = 'down';
    }
    if (q.moving) q.movedAt = now0;
    q.owner = p.id;
  }
  for (const id of [...PETST.keys()]) if (!P.has(id)) PETST.delete(id);
}
const vis0 = q => areaOf(q.x, q.y)?.id === areaOf(P.get(myId)?.x, P.get(myId)?.y)?.id;
const PET_FACE_L = new Set(['rabbit']);   // side frames drawn facing left (the rest face right)
function drawPet(q, X, Y, t) {
  if (!PET_AT || !petImg) return;
  const meta = PET_AT.pets[q.id]; if (!meta) return;
  const C = PET_AT.cell, now0 = performance.now();
  const size = TS * 1.08 * meta.sz;
  let h = 0, sx = 1, sy = 1;
  const u = (now0 - q.hop) / q.hopDur;
  if (u >= 0 && u < 1) {                                       // a hop: stretch going up, squash on landing
    h = Math.sin(u * Math.PI) * TS * .55 * q.big;
    sy = u > .8 ? 1 - .14 * Math.sin((u - .8) / .2 * Math.PI) : 1 + .08 * Math.sin(u * Math.PI); sx = 2 - sy;
  }
  else if (q.moving) { const b = Math.abs(Math.sin(q.phase * Math.PI)); h = b * TS * .2 * (q.spd > 4.5 ? .35 : 1); sy = 1 - .08 * Math.max(0, .25 - b) * 4; sx = 2 - sy; }
  else { const br = Math.sin(now0 / 420 + q.x * 3); sy = 1 + br * .02; sx = 2 - sy; }                // breathing
  const px = Math.round(q.x * TS + X), py = Math.round(q.y * TS + Y + TS * .32);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; const shr = 1 - Math.min(.45, h / (TS * .9));
  ctx.beginPath(); ctx.ellipse(px, py, TS * .3 * meta.sz * shr + TS * .06, TS * .1 * shr, 0, 0, 7); ctx.fill();
  const group = q.view === 'up' ? 1 : q.view === 'side' ? 2 : 0, nf = meta.n[group];
  const fr = q.moving ? Math.floor(q.phase * 1.5) % Math.max(1, nf) : 0;   // idle = frame 0
  const sw = size * sx, sh = size * sy;
  const legend = G.pets?.[q.id]?.rar >= 5;
  if (legend) petGlow(px, py - h - sh * .45, size, now0);
  const ow = P.get(q.owner);
  if (ow?.pl && !ow.veh && !ow.pose) {                       // 🦮 the lead: from the owner's hand to the pet's collar, sagging a little
    const hx = Math.round(ow.rx * TS + X) + (q.x < ow.rx ? -TS * .18 : TS * .18), hy = Math.round(ow.ry * TS + Y) - TS * .1, nx = px, ny = py - h - sh * .5;
    ctx.save(); ctx.strokeStyle = '#c0392b'; ctx.lineWidth = Math.max(1.5, TS * .035); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + nx) / 2, Math.max(hy, ny) + TS * .22, nx, ny); ctx.stroke();
    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(nx, ny, Math.max(2, TS * .05), 0, 7); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.translate(px, py - h);
  if (q.view === 'side' && q.flip !== PET_FACE_L.has(q.id)) ctx.scale(-1, 1);
  ctx.drawImage(petImg, (group * 4 + fr) * C, meta.row * C, C, C, -sw / 2, -sh + size * .03, sw, sh);
  ctx.restore();
  if (ow?.pn) sign(ow.pn, px, py - h - sh - TS * .08, { size: TS * .16, bg: 'rgba(255,248,230,.9)', color: '#6b3d1e' });   // its name
}
// legendary pets (rarity 5) shimmer: a soft halo and four-point stars drifting around them
function petGlow(cx, cy, size, t) {
  ctx.save();
  const hue = (t / 12) % 360, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * .75);
  g.addColorStop(0, `hsla(${hue},100%,80%,.28)`); g.addColorStop(1, `hsla(${hue},100%,80%,0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, size * .75, 0, 7); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const ph = (t / 1100 + i / 6) % 1, a = i * 2.4 + t / 2500, r = size * (.28 + .3 * ((i * 37) % 10) / 10), x = cx + Math.cos(a) * r, y = cy - ph * size * .6 + Math.sin(a) * r * .5, s = size * .09 * Math.sin(ph * Math.PI);
    ctx.fillStyle = `hsla(${(hue + i * 55) % 360},100%,${i % 2 ? 90 : 75}%,${Math.sin(ph * Math.PI)})`;
    ctx.beginPath(); ctx.moveTo(x, y - s * 2); ctx.quadraticCurveTo(x, y, x + s * 2, y); ctx.quadraticCurveTo(x, y, x, y + s * 2); ctx.quadraticCurveTo(x, y, x - s * 2, y); ctx.quadraticCurveTo(x, y, x, y - s * 2); ctx.fill();
  }
  ctx.restore();
}
// a pet's face for the shop / bag lists
// the drawn part of a pet's first frame (cells have empty margins that differ per animal), so every icon comes out the same size
const PET_BOX = new Map();
function petBox(row) {
  let b = PET_BOX.get(row); if (b) return b;
  const C = PET_AT.cell; b = [0, 0, C, C];
  try {
    const t = document.createElement('canvas'); t.width = t.height = C; const g = t.getContext('2d'); g.drawImage(petImg, 0, row * C, C, C, 0, 0, C, C);
    const d = g.getImageData(0, 0, C, C).data; let x0 = C, y0 = C, x1 = -1, y1 = -1;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (d[(y * C + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= x0) b = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  } catch { }
  PET_BOX.set(row, b); return b;
}
function drawPetIcon(c, id) {
  const meta = PET_AT.pets[id]; if (!meta) return; const g = c.getContext('2d'), C = PET_AT.cell, [bx, by, bw, bh] = petBox(meta.row);
  g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = true;
  const k = Math.min(c.width * .72 / bw, c.height * .72 / bh);
  g.drawImage(petImg, bx, meta.row * C + by, bw, bh, (c.width - bw * k) / 2, c.height - bh * k - c.height * .08, bw * k, bh * k);
}
const SKIN = ['#f3cfa6', '#e2b084', '#c98f60', '#8f5c3c'], HAIR = ['#2b1d14', '#5a3a22', '#b8692a', '#e5c15a', '#1c1c30', '#6d3b8f', '#c9473f', '#ececec'];
// ---- ZOMBIE NIGHT (every 13th, 20:00): zombie sprites, slime where they rise, the countdown / survival bar, overrun + end cards
let ZB = null, zbImg = null, ZN = { ph: 'off' }, zDecals = [];
fetch('assets/zombie.json?v=1').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { ZB = j; zbImg = im; }; im.src = 'assets/zombie.webp?v=1'; }).catch(() => {});
const zDecalImg = new Image(); zDecalImg.src = 'assets/zdecal.webp?v=1';
const zSilC = {};
function zSil(row, col) {   // a solid red copy of one zombie frame (cached) for the outline
  const key = row * 16 + col; if (zSilC[key]) return zSilC[key];
  const c = document.createElement('canvas'); c.width = ZB.w; c.height = ZB.h; const g = c.getContext('2d');
  g.drawImage(zbImg, col * ZB.w, row * ZB.h, ZB.w, ZB.h, 0, 0, ZB.w, ZB.h); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ff2a2a'; g.fillRect(0, 0, ZB.w, ZB.h);
  return (zSilC[key] = c);
}
function drawZombie(p, X, Y, t) {
  const px = Math.round(p.rx * TS + X), py = Math.round(p.ry * TS + Y + TS * .32);
  if (px < -120 || py < -160 || px > VW + 120 || py > VH + 160) return;
  const f8 = ((p.f | 0) % 8 + 8) % 8, dir = { 0: 'left', 1: 'left', 2: 'up', 3: 'right', 4: 'right', 5: 'right', 6: 'down', 7: 'left' }[f8];
  const moving = Math.hypot(p.x - p.rx, p.y - p.ry) > .02;
  p.walk = (p.walk || 0) + (moving ? (p.zb === 'run' ? .3 : .16) * FDT * 60 : 0);
  const fi = moving ? [1, 0, 2, 0][Math.floor(p.walk / 1.4) % 4] : 0, col = (dir === 'down' ? 0 : dir === 'up' ? 3 : 6) + fi;
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py, TS * (p.zb === 'brute' ? .5 : .32), TS * .12, 0, 0, 7); ctx.fill();
  if (!zbImg) { ctx.font = `${Math.round(TS * .9)}px serif`; ctx.textAlign = 'center'; ctx.fillText('🧟', px, py - TS * .3); return; }
  const k = TS * 1.55 / 96, w = ZB.w * k, h = ZB.h * k, row = ZB.rows[p.zb] || 0;
  const pul = .75 + Math.sin(t / 180) * .25;             // a pulsing red ring on the ground so they stand out in the dark
  ctx.strokeStyle = `rgba(255,40,40,${.55 * pul})`; ctx.lineWidth = Math.max(2, TS * .06); ctx.beginPath(); ctx.ellipse(px, py, TS * (p.zb === 'brute' ? .62 : .44), TS * .17, 0, 0, 7); ctx.stroke();
  const sil = zSil(row, col), o = Math.max(3, Math.round(TS * .075));
  ctx.save(); ctx.translate(px, py);
  if (dir === 'left') ctx.scale(-1, 1);
  if (sil) { ctx.globalAlpha = pul; for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) ctx.drawImage(sil, -ZB.feet[0] * k + dx, -ZB.feet[1] * k + dy, w, h); ctx.globalAlpha = 1; }   // thick red outline
  ctx.drawImage(zbImg, col * ZB.w, row * ZB.h, ZB.w, ZB.h, -ZB.feet[0] * k, -ZB.feet[1] * k, w, h);
  ctx.restore();
}
let zGroanT = 0;
function drawZDecals(X, Y, t, A) {
  if (ZN.ph === 'on' && t > zGroanT) { zGroanT = t + 2500 + Math.random() * 3000; const m = P.get(myId); if (m && [...P.values()].some(p => p.zb && Math.hypot(p.x - m.x, p.y - m.y) < 7)) FX.play('groan'); }

  if (!zDecals.length) return;
  const now0 = performance.now(); zDecals = zDecals.filter(d => now0 - d.t < 40000);
  for (const d of zDecals) {
    if (A && d.area !== A.id) continue;
    const px = d.x * TS + X, py = d.y * TS + Y + TS * .3, s = TS * (d.big ? 1.3 : 1);
    if (px < -s || py < -s || px > VW + s || py > VH + s || !zDecalImg.complete) continue;
    const age = (now0 - d.t) / 40000, grow = Math.min(1, (now0 - d.t) / 400);
    ctx.globalAlpha = Math.max(0, 1 - age * age) * .9;
    ctx.drawImage(zDecalImg, d.i * 96, 0, 96, 96, px - s / 2 * grow, py - s / 2 * .55 * grow, s * grow, s * .55 * grow);
    ctx.globalAlpha = 1;
  }
}
function drawZTint(t) {
  if (ZN.ph !== 'on' && ZN.ph !== 'warn') return;
  const a = ZN.ph === 'on' ? .16 : .1 + Math.sin(t / 250) * .04;   // light, so you can still see where you run
  ctx.fillStyle = `rgba(14,48,26,${a})`; ctx.fillRect(0, 0, VW, VH);
  const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .45, VW / 2, VH / 2, Math.max(VW, VH) * .75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, ZN.ph === 'warn' ? `rgba(120,0,0,${.28 + Math.sin(t / 250) * .1})` : 'rgba(0,10,4,.38)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}
const zIcon = (i, sz) => `<i class="zic" style="width:${sz}px;height:${sz}px;background-size:${sz * 9}px ${sz}px;background-position:-${i * sz}px 0"></i>`;
let ZWIN = { ids: new Set(), until: 0 }, znListOpen = true;
function znList() {   // a small, tap-to-fold survivor list on the left edge: never in the way of running
  let el = $('#znList');
  if (ZN.ph !== 'on' || !ZN.names) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'znList'; document.body.appendChild(el); el.onclick = () => { znListOpen = !znListOpen; FX.play('click'); el.dataset.k = ''; znList(); }; }
  const ns = ZN.names, myName = me?.name, k = `${znListOpen}|${ZN.alive}|${ns.join(',')}`;
  if (el.dataset.k === k) return; el.dataset.k = k;
  const show = ns.slice(0, 8), more = ZN.alive - show.length;
  el.classList.toggle('shut', !znListOpen);
  el.innerHTML = `<b>🧍 ผู้รอด ${ZN.alive} ${znListOpen ? '▾' : '▸'}</b>` + (znListOpen ? show.map(n => `<span class="${n === myName ? 'me' : ''}">${esc(n)}</span>`).join('') + (more > 0 ? `<i>+อีก ${more} คน</i>` : '') : '');
}
function znWinner(m) {   // big floating winner announcement, no taps needed, fades on its own
  ZWIN = { ids: new Set(m.ids || []), until: performance.now() + 180e3 };
  document.querySelectorAll('.znWin').forEach(e => e.remove());
  const d = document.createElement('div'); d.className = 'znWin';
  const ns = m.names || [], more = (m.n || 0) - ns.slice(0, 10).length;
  d.innerHTML = m.n ? `<div class="t">🏆 ผู้รอดชีวิตคืนนี้ 🏆</div><div class="n">${ns.slice(0, 10).map(n => `<span>${esc(n)}</span>`).join('')}${more > 0 ? `<span>+อีก ${more} คน</span>` : ''}</div>${m.won ? '<div class="y">คุณคือหนึ่งในผู้รอด! รางวัลอยู่ในกล่องจดหมาย ✉️</div>' : ''}`
    : `<div class="t">🌅 ฟ้าสางแล้ว</div><div class="y">คืนนี้ไม่มีใครรอดเลย... เดือนหน้าแก้มือนะ</div>`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 8200);
}
// ---- 🐺 WEREWOLF NIGHT (full moon, 21:00): one player is the werewolf; a painted sheet (assets/werewolf.*, same layout as the zombie
// sheet: rows walk/run, columns down0-2 up0-2 side0-2) when it exists, else a big wolf drawn from the emoji
let WW = { ph: 'off' }, WWB = null, wwImg = null;
fetch('assets/werewolf.json?v=1').then(r => r.ok ? r.json() : null).then(j => { if (!j) return; const im = new Image(); im.onload = () => { WWB = j; wwImg = im; }; im.src = 'assets/werewolf.webp?v=1'; }).catch(() => {});
const wwSilC = {};
function wwSil(row, col) {   // a solid purple copy of one werewolf frame (cached) for the outline
  const key = row * 16 + col; if (wwSilC[key]) return wwSilC[key];
  const c = document.createElement('canvas'); c.width = WWB.w; c.height = WWB.h; const g = c.getContext('2d');
  g.drawImage(wwImg, col * WWB.w, row * WWB.h, WWB.w, WWB.h, 0, 0, WWB.w, WWB.h); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#b44dff'; g.fillRect(0, 0, WWB.w, WWB.h);
  return (wwSilC[key] = c);
}
function drawWolf(p, X, Y, t, sc = 1) {
  const px = Math.round(p.rx * TS + X), py = Math.round(p.ry * TS + Y + TS * .32);
  if (px < -120 || py < -160 || px > VW + 120 || py > VH + 160) return;
  const moving = Math.hypot(p.x - p.rx, p.y - p.ry) > .02, f8 = ((p.f | 0) % 8 + 8) % 8, dir = { 0: 'left', 1: 'left', 2: 'up', 3: 'right', 4: 'right', 5: 'right', 6: 'down', 7: 'left' }[f8];
  p.walk = (p.walk || 0) + (moving ? .3 * FDT * 60 : 0);
  const pul = .75 + Math.sin(t / 160) * .25;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(px, py, TS * .45, TS * .15, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(180,77,255,${.8 * pul})`; ctx.lineWidth = Math.max(2, TS * .07); ctx.beginPath(); ctx.ellipse(px, py, TS * .62, TS * .22, 0, 0, 7); ctx.stroke();
  let top;
  if (wwImg) {
    const fi = moving ? [1, 0, 2, 0][Math.floor(p.walk / 1.4) % 4] : 0, col = (dir === 'down' ? 0 : dir === 'up' ? 3 : 6) + fi, row = WWB.rows?.[moving ? 'run' : 'walk'] || 0;
    const k = TS * 1.6 * sc / 96, w = WWB.w * k, h = WWB.h * k, sil = wwSil(row, col), o = Math.max(3, Math.round(TS * .08));
    ctx.save(); ctx.translate(px, py); if (dir === 'left') ctx.scale(-1, 1);
    ctx.globalAlpha = .85 + pul * .15; for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) ctx.drawImage(sil, -WWB.feet[0] * k + dx, -WWB.feet[1] * k + dy, w, h); ctx.globalAlpha = 1;   // thick purple outline: easy to spot
    ctx.drawImage(wwImg, col * WWB.w, row * WWB.h, WWB.w, WWB.h, -WWB.feet[0] * k, -WWB.feet[1] * k, w, h); ctx.restore();
    top = py - WWB.feet[1] * k;
  } else {
    const s = TS * 1.35, hop = moving ? Math.abs(Math.sin(p.walk / 2)) * TS * .12 : 0;
    ctx.save(); ctx.translate(px, py - hop); if (dir === 'right') ctx.scale(-1, 1);
    ctx.font = `${Math.round(s)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.shadowColor = 'rgba(255,40,20,.9)'; ctx.shadowBlur = 14 * pul; ctx.fillText('🐺', 0, TS * .1); ctx.restore();
    top = py - s - hop;
  }
  nameAndBubble(p, px, top + TS * .1, p.id === myId, t);
}
function wwCard(html, cls, ms) { znCard(html, cls, ms); }
function wwMsg(m) {
  if (m.t === 'wwturn') { FX.play('alarm'); if (navigator.vibrate) navigator.vibrate([80, 60, 160]); wwCard('<div style="font-size:64px">🐺</div><b>คุณกลายเป็นหมาป่า (โฮส)!</b><p>วิ่งชนมนุษย์เพื่อกัด คนที่โดนกัดจะกลายเป็นลูกน้องคุณ · ปุ่มเปลี่ยนเป็นสกิล 👃 ดมกลิ่น ⚡ วิ่งไว 📯 เรียกสมุน · <b>ห้ามยืนนิ่งเกิน 3 วินาที!</b></p>', 'warn', 5000); return; }
  if (m.t === 'wwdie') { FX.play('zbite'); if (navigator.vibrate) navigator.vibrate([60, 40, 120]); wwCard(`<div style="font-size:56px">🐺</div><b>โดนกัด! คุณกลายเป็นหมาป่าลูกน้อง</b><p>${esc(m.by || '')} กัดคุณ · ไล่กัดมนุษย์ที่เหลือต่อ ถ้ากัดหมดเมือง หมาป่าแบ่งเงินรางวัลกัน · ใช้สกิล 👃 ⚡ 📯 ได้</p>`, 'bite', 4000); return; }
  const was = WW.ph;
  if (m.ph === 'end') {
    WW = { ph: 'off' }; FX.play(m.won ? 'levelup' : 'chime');
    const d = document.createElement('div'); d.className = 'znWin';
    d.innerHTML = m.wolfWon ? `<div class="t">🐺 หมาป่าชนะ! 🐺</div><div class="y">ไม่มีใครรอดถึงเช้า · โฮสหมาป่า <b>${esc(m.host)}</b> ได้ส่วนแบ่งมากที่สุด</div>`
      : `<div class="t">🌅 ผู้รอดชีวิตคืนจันทร์เต็มดวง</div><div class="n">${(m.names || []).slice(0, 10).map(n => `<span>${esc(n)}</span>`).join('')}</div>${m.won ? '<div class="y">คุณรอด! รางวัลส่งเข้าจดหมายแล้ว 📬</div>' : ''}`;
    document.body.appendChild(d); setTimeout(() => d.remove(), 8200); return;
  }
  WW = { ...m, endT: performance.now() + Math.max(0, (m.end || 0) - (Date.now() + clockOff)) };
  if (m.ph === 'warn' && was !== 'warn') { FX.play('alarm'); wwCard('<img src="assets/wwbanner.webp?v=1" alt=""><b>คืนจันทร์เต็มดวง!</b><p>อีกไม่นานจะมีใครสักคนกลายเป็นหมาป่า · ทุกคนจะถูกพาออกมาในเมือง · ประตูทุกบานปิด</p>', 'warn', 4000); }
  if (m.ph === 'on' && was === 'warn' && m.me === 'alive') wwCard(`<div style="font-size:56px">🐺</div><b>${esc(m.wname)} คือหมาป่า!</b><p>วิ่งหนีอย่าให้โดนตัว รอดถึงเช้า = ได้รางวัลเต็ม</p>`, 'warn', 3000);
}
function wwHud(el) {
  const left = Math.max(0, Math.ceil(((WW.endT || 0) - performance.now()) / 1000)), mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const nw = (WW.wolves || []).length;
  const title = WW.ph === 'warn' ? `🌕 หมาป่าออกล่าใน ${mm}` : WW.me === 'wolf' ? `🐺 ${WW.boss ? 'คุณคือโฮสหมาป่า' : 'คุณคือหมาป่าลูกน้อง'} · ${mm}` : `🌕 รอดอีก ${mm}`;
  const sub = WW.ph === 'warn' ? 'ออกจากอาคาร เตรียมวิ่ง!' : WW.me === 'wolf' ? `กัดมนุษย์ให้หมด · เหลือ ${WW.alive} คน${WW.boss ? ' · ห้ามยืนนิ่ง!' : ''}` : WW.me === 'alive' ? `หมาป่า ${nw} ตัว · มนุษย์ ${WW.alive} คน · แผนที่ไม่เห็นใคร ระวัง!` : `ดูอยู่ข้างสนาม · มนุษย์ ${WW.alive} คน`;
  el.classList.remove('hidden'); el.classList.toggle('warn', WW.ph === 'warn' || WW.me === 'wolf'); el.classList.toggle('dead', false);
  el.innerHTML = `<span style="font-size:24px">🐺</span><div><b>${title}</b><small>${esc(sub)}</small></div>`;
}
const wwIsWolf = () => WW.ph === 'on' && WW.me === 'wolf';
const wwNow = () => Date.now() + clockOff;
const wwSniffing = () => wwIsWolf() && (WW.sk?.sniff || 0) > wwNow();
// while you are a wolf the bag / run / action buttons become 👃 sniff, ⚡ sprint and 📯 summon
const WW_BTN = { bagBtn: ['sniff', '👃', 'ดมกลิ่น'], runBtn: ['sprint', '⚡', 'วิ่งไว'], actBtn: ['summon', '📯', 'เรียกสมุน'] };
function wwCdLeft(k) { return Math.max(0, Math.ceil(((WW.sk?.[k + 'Cd'] || 0) - wwNow()) / 1000)); }
function wwBtns() {
  const on = wwIsWolf();
  for (const [id, [k, ic, lb]] of Object.entries(WW_BTN)) {
    const b = $('#' + id); if (!b) continue;
    if (id === 'actBtn') continue;   // (the action button is relabelled in the frame loop)
    if (on) { const cd = wwCdLeft(k); if (!b.dataset.ww) { b.dataset.ww = b.innerHTML; } b.innerHTML = `<span>${ic}</span><small>${cd ? cd + ' วิ' : lb}</small>`; b.classList.toggle('wwCd', cd > 0); b.classList.add('wwSk'); }
    else if (b.dataset.ww) { b.innerHTML = b.dataset.ww; delete b.dataset.ww; b.classList.remove('wwCd', 'wwSk'); }
  }
}
setInterval(wwBtns, 250);
for (const id of Object.keys(WW_BTN)) {
  const b = $('#' + id), k = WW_BTN[id][0];
  const stop = e => { if (!wwIsWolf()) return false; e.stopImmediatePropagation(); e.preventDefault(); return true; };
  b.addEventListener('pointerdown', e => { if (stop(e)) { FX.play('click'); if (running) setRun(false); send({ t: 'wwskill', k }); } }, true);
  b.addEventListener('pointerup', stop, true); b.addEventListener('pointercancel', stop, true); b.addEventListener('click', stop, true);
}
// 👃 while sniffing: a red arrow from the wolf to the nearest human
function drawSniff(X, Y, t) {
  if (!wwSniffing()) return;
  const m = P.get(myId); if (!m) return;
  let best = null, bd = 1e9; for (const id of WW.humans || []) { const o = P.get(id); if (!o) continue; const d = Math.hypot(o.x - m.x, o.y - m.y); if (d < bd) { bd = d; best = o; } }
  if (!best) return;
  const a = Math.atan2(best.ry - m.ry, best.rx - m.rx), cx = m.rx * TS + X, cy = m.ry * TS + Y, r = TS * 1.3 + Math.sin(t / 140) * 5;
  ctx.save(); ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.rotate(a);
  ctx.fillStyle = '#ff2a2a'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(TS * .5, 0); ctx.lineTo(-TS * .28, -TS * .34); ctx.lineTo(-TS * .12, 0); ctx.lineTo(-TS * .28, TS * .34); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  sign(`👃 ${best.name || ''} · ${Math.round(bd)} ม.`, cx, cy + TS * 1.05, { size: TS * .3, bg: 'rgba(200,20,20,.92)' });
}
function znHud() {
  const el = $('#znBar'); if (!el) return;
  znList();
  if (ZN.ph === 'off' && (WW.ph === 'warn' || WW.ph === 'on')) return wwHud(el);
  if (ZN.ph !== 'warn' && ZN.ph !== 'on') { el.classList.add('hidden'); return; }
  const left = Math.max(0, Math.ceil(((ZN.endT || 0) - performance.now()) / 1000)), mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  let title, sub;
  if (ZN.ph === 'warn') { title = `ซอมบี้บุกใน ${mm}`; sub = me && roomOf(me.x, me.y) ? '⚠️ ออกจากอาคารด่วน! อยู่ข้างในจะโดนรุม' : 'อยู่นอกอาคาร เตรียมวิ่งหนี!'; }
  else { title = `เอาตัวรอดอีก ${mm}`; sub = ZN.me === 'alive' ? `ระลอก ${ZN.wave || 1} · ผู้รอด ${ZN.alive} คน · ห้ามให้ซอมบี้ถึงตัว!` : ZN.me === 'dead' ? `คุณสลบแล้ว · ผู้รอด ${ZN.alive} คน` : `ดูอยู่ข้างสนาม · ผู้รอด ${ZN.alive} คน`; }
  el.classList.remove('hidden'); el.classList.toggle('warn', ZN.ph === 'warn'); el.classList.toggle('dead', ZN.me === 'dead');
  el.innerHTML = `${zIcon(ZN.ph === 'warn' ? 0 : ZN.me === 'dead' ? 6 : 1, 24)}<div><b>${title}</b><small>${sub}</small></div>`;
}
setInterval(znHud, 250);
function znCard(html, cls, ms) {
  const d = document.createElement('div'); d.className = 'znCard ' + (cls || ''); d.innerHTML = html; document.body.appendChild(d);
  if (ZN.ph === 'on' || ZN.ph === 'warn') ms = Math.min(ms, 2600);   // short while you need to run
  d.onclick = () => d.remove(); setTimeout(() => d.classList.add('out'), ms); setTimeout(() => d.remove(), ms + 600);
}
function znMsg(m) {
  if (m.t === 'zn') {
    const was = ZN.ph;
    if (m.ph === 'end') {
      ZN = { ph: 'off' }; znHud(); FX.play(m.won ? 'levelup' : 'chime');
      znWinner(m);
      return;
    }
    ZN = { ...m, endT: performance.now() + Math.max(0, m.end - (Date.now() + clockOff)) };
    if (m.ph === 'warn' && was !== 'warn') { FX.play('alarm'); znCard(`<img src="assets/zbanner.webp?v=1" alt=""><b>คืนปล่อยผี!</b><p>ซอมบี้กำลังบุกเมือง ออกจากอาคารให้ทัน แล้วเอาตัวรอดให้ได้</p>`, 'banner', 4500); }
    if (m.ph === 'on' && was === 'warn' && m.me === 'alive') znCard(`${zIcon(1, 40)}<b>พวกมันมาแล้ว!</b><p>วิ่งหนี อย่าให้ซอมบี้เข้าใกล้ · ห้ามเข้าอาคาร</p>`, '', 2600);
    znHud();
  } else if (m.t === 'zspawn') {
    const t0 = performance.now();
    for (const [area, x, y] of m.p) { zDecals.push({ area, x, y, t: t0 + Math.random() * 300, i: Math.random() < .5 ? 0 : 3 }); if (Math.random() < .3) zDecals.push({ area, x: x + .4, y: y + .2, t: t0, i: Math.random() < .5 ? 1 : 4 }); }
  } else if (m.t === 'zdie') {
    FX.play('zbite');
    if (m.why === 'in') znCard(`<img src="assets/zoverrun.webp?v=1" alt=""><b>ซอมบี้ทะลักเข้ามาในอาคาร!</b><p>คุณโดนรุมจนสลบ ฟื้นขึ้นมาที่จัตุรัส</p>`, 'overrun', 4200);
    else znCard(`${zIcon(6, 40)}<b>โดนกัด!</b><p>คุณสลบไป ฟื้นขึ้นมาที่จัตุรัส · รอบนี้อดรางวัลผู้รอด</p>`, 'bite', 3600);
  }
}
// ☂️ an open umbrella held over the head: a coloured canopy (panels + scalloped rim), a shaft down to the hand, swaying a little
const UMB_COL = [['#e8505b', '#ffd2d5'], ['#3d7be0', '#cfe0ff'], ['#f2b705', '#fff1b8'], ['#2fb36a', '#c9f5da'], ['#8a5cf0', '#e3d6ff'], ['#ff8a3d', '#ffe0c7']];
// 🎈 a balloon on a string from the hand (or a whole bunch for the seller)
function balloonShape(x, y, r, col, sh) {
  ctx.fillStyle = col; ctx.beginPath();
  if (sh === 'h') { ctx.moveTo(x, y + r * .9); ctx.bezierCurveTo(x - r * 1.5, y - r * .1, x - r * .7, y - r * 1.3, x, y - r * .45); ctx.bezierCurveTo(x + r * .7, y - r * 1.3, x + r * 1.5, y - r * .1, x, y + r * .9); }
  else if (sh === 's') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .5 : r * 1.1; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
  else ctx.ellipse(x, y, r * .85, r, 0, 0, 7);
  ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, r * .08); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(x - r * .3, y - r * .35, r * .18, r * .28, -.5, 0, 7); ctx.fill();
  if (!sh) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y + r * .95); ctx.lineTo(x - r * .14, y + r * 1.15); ctx.lineTo(x + r * .14, y + r * 1.15); ctx.fill(); }
}
function drawBalloon(id, px, top, H, pid, t) {
  const hx = px + TS * .32, hy = top + H * .5, r = TS * .26;
  const list = id === 'bunch' ? ['red', 'blue', 'yellow', 'green', 'pink', 'heart', 'purple'] : [id];
  list.forEach((k, i) => {
    const B = G.balloons?.[k]; if (!B) return;
    const sw = Math.sin(t / 700 + (+pid || 0) % 13 + i * 1.7) * TS * .12, n = list.length;
    const bx = hx + sw + (n > 1 ? (i - (n - 1) / 2) * r * 1.1 : TS * .08), by = top - TS * (n > 1 ? .55 + (i % 3) * .3 : .45);
    ctx.strokeStyle = 'rgba(60,60,60,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx + sw * .3, (hy + by) / 2, bx, by + r); ctx.stroke();
    balloonShape(bx, by, r, B.c, B.sh);
  });
}
function drawUmbrella(px, top, H, id, t) {
  const [c1, c2] = UMB_COL[Math.abs(+id || 0) % UMB_COL.length], r = TS * .62, cx = px + TS * .2, cy = top - TS * .04, hand = top + H * .5;
  ctx.save(); ctx.translate(cx, hand); ctx.rotate(Math.sin(t / 650 + (+id || 0)) * .05); ctx.translate(-cx, -hand);
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(2, TS * .05); ctx.lineCap = 'round';   // shaft and J handle
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, hand); ctx.arc(cx - TS * .07, hand, TS * .07, 0, Math.PI); ctx.stroke();
  const n = 6, rim = cy, ry = r * .66, sw = 2 * r / n, X = i => cx - r + i * sw;   // canopy: a half-dome with a scalloped rim, panels in two colours
  ctx.beginPath(); ctx.moveTo(cx - r, rim); ctx.ellipse(cx, rim, r, ry, 0, Math.PI, 2 * Math.PI);
  for (let i = n - 1; i >= 0; i--) ctx.quadraticCurveTo(X(i) + sw / 2, rim - TS * .07, X(i), rim);
  ctx.closePath(); ctx.fillStyle = c1; ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = c2;
  for (let i = 1; i < n; i += 2) { ctx.beginPath(); ctx.moveTo(cx, rim - ry); ctx.lineTo(X(i), rim + 2); ctx.lineTo(X(i + 1), rim + 2); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(cx - r * .35, rim - ry * .55, r * .2, ry * .14, -.6, 0, 7); ctx.fill();   // shine
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - r, rim); ctx.ellipse(cx, rim, r, ry, 0, Math.PI, 2 * Math.PI);
  for (let i = n - 1; i >= 0; i--) ctx.quadraticCurveTo(X(i) + sw / 2, rim - TS * .07, X(i), rim);
  ctx.stroke();
  ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.arc(cx, rim - ry - TS * .02, TS * .04, 0, 7); ctx.fill();   // tip
  ctx.restore();
}
function drawPlayer(p, X, Y, t) {
  if (p.zb) return drawZombie(p, X, Y, t);
  if (p.wwm || WW.ph === 'on' && WW.wolves?.includes(p.id)) return drawWolf(p, X, Y, t, p.id === WW.wolf ? 1.05 : p.wwm ? .78 : .9);
  if (!chImg) return drawPlayerPixel(p, X, Y, t);
  const snap = v => Math.round(v * DPR) / DPR;
  const fo = p.pose === 'fun' && p.fn ? funPos(p) : null;   // on a park ride: drawn where the ride carries them
  const px0 = snap(fo ? fo.x * TS + X : (p.rx + (p.ox || 0)) * TS + X), py0 = snap(fo ? (fo.y - fo.lift) * TS + Y : (p.ry + (p.oy || 0)) * TS + Y + TS * .32);
  if (px0 < -80 || py0 < -140 || px0 > VW + 80 || py0 > VH + 140) return;
  const pose = p.pose, lying = pose === 'bed' || pose === 'hosp' || pose === 'veg', sitting = pose === 'seat' || pose === 'chair' || pose === 'rest' || pose === 'beg' || pose === 'jail' || pose === 'study' || !!fo?.sit;
  const ang = (p.f / 8) * Math.PI * 2 - Math.PI, cx = Math.cos(ang), cy = Math.sin(ang);
  // facing from the 8-way index with hysteresis: on a diagonal keep the current facing if it is one of
  // the two neighbours, so a wobbling joystick does not flip the view (head turning) every frame
  const CARD = { 0: 'left', 2: 'up', 4: 'right', 6: 'down' }, DIAG = { 1: ['left', 'up'], 3: ['up', 'right'], 5: ['right', 'down'], 7: ['down', 'left'] };
  const f8 = ((p.f | 0) % 8 + 8) % 8;
  let dir = CARD[f8] || (DIAG[f8].includes(p.view) ? p.view : DIAG[f8].find(d => d === 'up' || d === 'down'));
  if (CARD[f8] && p.view && p.view !== dir && performance.now() - (p.viewT || 0) < 120) dir = p.view;   // tiny debounce
  if (dir !== p.view) { p.view = dir; p.viewT = performance.now(); }
  if (sitting || lying) dir = 'down';
  if (fo?.back) dir = 'up';
  const moving = !sitting && !lying && (p.id === myId ? meMoving : Math.hypot(p.x - p.rx, p.y - p.ry) > .02);
  p.walk = (p.walk || 0) + (moving ? (p.id === myId && running ? .34 : .2) * FDT * 60 : 0);
  const frame = moving ? Math.floor(p.walk / 1.4) % 4 : 0, bob = 0;   // the step frames already move; an extra bounce made the sprite shake
  const view = dir === 'down' ? 'front' : dir === 'up' ? 'back' : 'side';
  const k = TS * 1.55 / CH_ATLAS.h * (p.small || 1), H = CH_ATLAS.h * k;
  let px = px0, py = py0;
  const RV = p.veh && !lying && !sitting && G.shop?.vehicles?.[p.veh] && !roomOf(p.x, p.y) ? G.shop.vehicles[p.veh] : null;
  if (!fo?.high && !fo?.swim) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py, TS * (lying ? .55 : RV ? (RV.kind !== 'moto' ? (view === 'side' ? 1.2 : .75) : view === 'side' ? .8 : .4) : .32), TS * .11, 0, 0, 7); ctx.fill(); }
  const fk = fo && fo.s.k, fcol = fo && (fo.car || RIDE_COL[(+String(p.fn).split(':')[1] || 0) % RIDE_COL.length]);
  if (fo && (fk === 'ferris' || fk === 'coaster' || fk === 'bumper' || fk === 'carousel')) drawSeatProp(fk, px, py + (fk === 'carousel' ? 0 : TS * .1), fk === 'coaster' ? '#ffd45e' : fcol, fo);
  if (RV) {
    const top0 = py - (RV.kind !== 'moto' ? vehH(p.veh, view) + TS * (RV.kind === 'heli' ? 1.35 : .15) : H * .97 + TS * (p.veh === 'escoot' ? .12 : .32));
    drawRide(p, RV, px, py, k, view, dir); nameAndBubble(p, px, top0, p.id === myId, t);
    [...P.values()].filter(o => o.ps === p.id).forEach((o, i) => nameAndBubble(o, px + (i - .5) * TS * .2, top0 - TS * (.62 + i * .5), o.id === myId, t));   // the passengers' names (and chat) over the driver's
    return;
  }
  const aura = (p.of === 'admin' || p.of === 'thai' || p.of === 'angel') && !lying, gold = p.of === 'angel' ? (p.g === 'f' ? 'fairy' : 'angel') : p.of === 'thai', now0 = performance.now();   // admin cloak: violet · golden Thai outfit: gold · angel / fairy outfit: white-gold / pink
  if (aura) drawAura(px, py, H, now0, false, gold);
  ctx.save();
  if (lying) { ctx.translate(px, py - TS * .25); ctx.rotate(-Math.PI / 2); drawCharTo(ctx, p, H * .45, TS * .25, k, 'front', 0); }
  else if (fo?.swim) { ctx.beginPath(); ctx.rect(px - TS, py - H * 1.2, TS * 2, H * .78); ctx.clip(); drawCharTo(ctx, p, px, py + Math.sin(t / 380 + p.id) * TS * .05, k, 'front', 0); }   // swimming: only head and shoulders above the water
  else if (sitting) drawCharTo(ctx, p, px, py, k, 'front', 0, false, true);   // seated: whole body, legs folded
  else { if (!moving) { const br = 1 + Math.sin(now0 / 650 + ((+p.id || 0) % 97)) * .012; ctx.translate(px, py); ctx.scale(2 - br, br); ctx.translate(-px, -py); } drawCharTo(ctx, p, px, py - bob, k, view, frame, dir === 'left'); }   // standing still: a soft breath
  ctx.restore();
  if (fo?.swim) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py - H * .42, TS * .45 + Math.sin(t / 300) * 2, TS * .13, 0, 0, 7); ctx.stroke(); swimFx(p.id, fo.x, fo.y - .42 * H / TS, t); }
  if (fo) drawSeatFront(fk, px, py + (fk === 'carousel' ? 0 : TS * .1), fk === 'coaster' ? '#ffd45e' : fcol, fo);
  if (aura) drawAura(px, py, H, now0, true, gold);
  const umb = !lying && !fo && wd?.ev?.id === 'rain' && (p.id === myId ? (me?.inv?.umbrella || 0) > 0 : p.um) && !roomOf(p.x, p.y);
  if (umb) drawUmbrella(px, py - H * .97 - bob + (sitting ? H * .19 : 0), H, p.id, now0);   // ☂️ in the rain (the name tag moves up above it)
  const mine = p.id === myId, top = lying ? py0 - TS * .9 : py - H * .97 - bob + (sitting ? H * .19 : 0);
  if (p.bl && !lying && !fo?.swim) drawBalloon(p.bl, px, top + (umb ? -TS * .3 : 0), H, p.id, now0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (pose === 'beg') { ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText('🥣', px, py0 - TS * .05); }
  // little emote sprites from the sheet: dizzy when sick or knocked out, a light bulb over your head when you crave something
  const emote = pose === 'hosp' || pose === 'veg' || (p.dz || []).length ? '💫' : mine && me?.craving ? '💡' : pose === 'seat' ? '❤️' : null;
  if (emote) { ctx.font = `${Math.round(TS * .38)}px serif`; ctx.fillText(emote, px + TS * .42, top + TS * .05 + Math.sin(t / 300) * 3); }
  const badge = pose === 'jail' ? '⛓️' : pose === 'rest' || pose === 'bed' ? '💤' : pose === 'study' ? '📖' : p.sad ? '😞' : '';
  if (badge) { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(badge, px - TS * .42, top + Math.sin(t / 300) * 3); }
  nameAndBubble(p, px, umb ? top - TS * .42 : top, mine, t);
}
// ------------------------------------------------------------------ amusement park: rides drawn in code (until painted sprites
// ride_<key> exist in the atlas), and riders moving with them. Riders' real position is the ride's ticket spot; we only draw them on the ride.
const bump = { x: 0, y: 0, until: 0 };
const driving = () => { const m = P.get(myId); return !!m && m.pose === 'fun' && String(m.fn).startsWith('bumper:'); };
const swimming = () => { const m = P.get(myId); return !!m && m.pose === 'fun' && String(m.fn).startsWith('pool:'); };
const inPoolW = (x, y) => { const Q = G.pool; return !!Q?.x0 && x > Q.x0 + .4 && x < Q.x1 - .4 && y > Q.y0 + .7 && y < Q.y1 - .1; };
const nearPoolW = (x, y) => { const Q = G.pool; return !!Q?.x0 && x > Q.x0 - .35 && x < Q.x1 + .35 && y > Q.y0 - .1 && y < Q.y1 + .45; };
const RIDE_SEATS = { carousel: 6, ferris: 8, coaster: 6, bumper: 4, pool: 10, shooting: 3 };
const RIDE_COL = ['#ff7aa8', '#7ac8ff', '#ffd45e', '#8be08b', '#c79bff', '#ff9f5e', '#5ee0d0', '#ffb3c7', '#9fb6ff', '#ffe28a'];
const rideBottom = s => s.cy + s.h / 2;
// ---- painted ride pieces (public/assets/rides.*): the moving parts are separate images, turned and moved in code
let RIMG = null, RJ = null;
let ridesAsked = false;   // the rides picture loads the first time something needs it (the park, or its gate in town), not at start
function loadRides() { if (ridesAsked) return; ridesAsked = true; fetch('assets/rides.json?v=2').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { RJ = j; RIMG = im; }; im.src = 'assets/rides.webp?v=2'; }).catch(() => { ridesAsked = false; }); }
const RIDE_IMG = () => { if (!RIMG) loadRides(); return !!RIMG; };
// draw piece n with its anchor (ax, ay: 0..1 of the piece) at screen x, y, wT tiles wide; part: [y0, y1] slice (0..1) of the piece only
function rdraw(n, x, y, wT, ax = .5, ay = 1, flip = false, rot = 0, part = null, src = null) {
  const r = RJ?.s[n]; if (!r) return;
  const img = src || RIMG, sx = src ? 0 : r[0], sy = src ? 0 : r[1], w = wT * TS, h = w * r[3] / r[2];
  const p0 = part ? part[0] : 0, p1 = part ? part[1] : 1;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy + r[3] * p0, r[2], r[3] * (p1 - p0), -w * ax, -h * ay + h * p0, w, h * (p1 - p0));
  ctx.restore();
}
const rH = (n, wT) => { const r = RJ?.s[n]; return r ? wT * r[3] / r[2] : 0; };
// bumper cars come in colours: the white car multiplied by a colour (the black rubber stays black)
const TINT = new Map();
function tinted(n, col) {
  const key = n + col; let c = TINT.get(key); if (c) return c;
  const r = RJ.s[n]; c = document.createElement('canvas'); c.width = r[2]; c.height = r[3]; const g = c.getContext('2d');
  g.drawImage(RIMG, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.fillRect(0, 0, r[2], r[3]);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(RIMG, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  TINT.set(key, c); return c;
}
// sizes (tiles) and where things sit in the painted pieces
const RG = {
  car: { w: 7, surf: .57, rx: 2.25, ry: .97, horse: 1.75, saddle: 1.12, roofW: 7.6 },
  fer: { w: 7, hubX: .024 * 7, hubY: .07, R: 3.9, at: 3.72, gw: 1.05, seat: 1.08 },
  coa: { w: 10, car: 1.25 },
  bump: { w: 1.25 },
  shoot: { w: 8, duckY: .5, duck: .72 },
};
// the coaster track traced over the painted coaster (0..1 of the picture), a closed loop through the station
const COASTER_PATH = [[.42, .70], [.25, .66], [.08, .56], [.03, .42], [.10, .31], [.24, .28], [.36, .36], [.48, .47], [.62, .56], [.78, .58], [.92, .49], [.96, .36], [.86, .28], [.72, .31], [.65, .22], [.64, .10], [.53, .02], [.41, .08], [.38, .20], [.45, .32], [.52, .45], [.50, .58], [.46, .66]];
function coasterImgPt(s, u) {
  const P = COASTER_PATH, n = P.length, f = ((u % 1) + 1) % 1 * n, i = Math.floor(f), t = f - i;
  const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
  const cr = (a, b, c, d) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const W = RG.coa.w, H = rH('coaster', W), b = rideBottom(s);
  return { x: s.cx - W / 2 + cr(p0[0], p1[0], p2[0], p3[0]) * W, y: b - H + cr(p0[1], p1[1], p2[1], p3[1]) * H };
}
function coasterPt(s, u) {
  const b = rideBottom(s), a = u * Math.PI * 2;
  return { x: s.cx + Math.cos(a) * (s.w / 2 - 1.1), y: b - 1.9 + Math.sin(a) * 1.05 - 1.5 * Math.max(0, Math.sin(a * 2)), a };
}
// where a rider (or the empty seat) of a ride is now, in world tiles; sit / swim says how to draw them
function seatPos(s, slot, T) {
  const b = rideBottom(s);
  if (RIDE_IMG()) switch (s.k) {             // painted rides: seats follow the pictures
    case 'carousel': { const G2 = RG.car, a = T * .6 + slot * Math.PI * 2 / 6, H = rH('car_base', G2.w), cy = b - H * (1 - G2.surf), bob = Math.sin(T * 2.4 + slot) * .18;
      return { x: s.cx + Math.cos(a) * G2.rx, y: cy + Math.sin(a) * G2.ry, lift: G2.saddle + bob, bob, sit: 1, a, flip: Math.sin(a) > 0 }; }
    case 'ferris': { const F = RG.fer, a = T * .18 + slot * Math.PI * 2 / 8, hx = s.cx + F.hubX, hy = b - rH('fer_stand', F.w) * (1 - F.hubY);
      return { x: hx + Math.cos(a) * F.at, y: hy + Math.sin(a) * F.at + F.seat, lift: 0, sit: 1, high: 1, ax: hx + Math.cos(a) * F.at, ay: hy + Math.sin(a) * F.at }; }
    case 'coaster': { const u = (T * .045 + slot * .012) % 1, p = coasterImgPt(s, u), q = coasterImgPt(s, u + .004); return { x: p.x, y: p.y + .1, lift: 0, sit: 1, high: 1, flip: q.x < p.x }; }
    case 'shooting': return { x: s.cx - 2.4 + slot * 2.4, y: b + .35, lift: 0, back: 1 };
  }
  switch (s.k) {
    case 'carousel': { const a = T * .6 + slot * Math.PI * 2 / 6; return { x: s.cx + Math.cos(a) * (s.w / 2 - 1.4), y: b - 1.15 + Math.sin(a) * .85, lift: .3 + Math.sin(T * 2.4 + slot) * .14, sit: 1, a }; }
    case 'ferris': { const a = T * .22 + slot * Math.PI * 2 / 8, R = 3.1; return { x: s.cx + Math.cos(a) * R, y: b - 4.5 + Math.sin(a) * R + .6, lift: 0, sit: 1, high: 1 }; }
    case 'coaster': { const p = coasterPt(s, (T * .16 + slot * .04) % 1); return { x: p.x, y: p.y + .25, lift: 0, sit: 1, high: 1 }; }
    case 'pool': return { x: s.cx + Math.sin(T * .45 + slot * 1.9) * (s.w / 2 - 1.6), y: s.cy + Math.sin(T * .31 + slot * 2.7) * (s.h / 2 - 1.4) + .5, lift: 0, swim: 1 };
    case 'bumper': return { x: s.cx + Math.sin(T * .8 + slot * 2.1) * (s.w / 2 - 1.4), y: s.cy + .3 + Math.cos(T * .63 + slot * 1.3) * (s.h / 2 - 1.2), lift: .1, sit: 1, car: RIDE_COL[slot % RIDE_COL.length] };
    case 'shooting': return { x: s.cx - s.w / 2 + 1.7 + slot * 2.3, y: s.y + .1, lift: 0 };
  }
  return { x: s.x, y: s.y, lift: 0 };
}
function funPos(p) {
  const [k, sl] = String(p.fn || '').split(':'), s = STN('ride_' + k); if (!s) return null;
  if (k === 'bumper') return { x: p.rx + (p.ox || 0), y: p.ry + (p.oy || 0) + .32, lift: .1, sit: 1, car: RIDE_COL[(+sl || 0) % RIDE_COL.length], s, drive: 1 };
  if (k === 'pool') return { x: p.rx + (p.ox || 0), y: p.ry + (p.oy || 0) + .32, lift: 0, swim: 1, s, drive: 1 };   // you swim it yourself: drawn where you really are   // you drive it: drawn where you really are
  return { ...seatPos(s, +sl || 0, performance.now() / 1000), s };
}
// townsfolk riding along on the empty seats, so the park never looks dead (drawn only, they are not players)
const RIDE_NPC = {};
function rideNpc(k, i) {
  const key = k + i; let n = RIDE_NPC[key];
  if (!n) { const h = [...key].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 11); n = RIDE_NPC[key] = { id: 'rn' + key, npc: 1, name: '', g: h % 2 ? 'f' : 'm', lk: { hair: ['brown', 'black', 'blonde', 'ginger'][h % 4], shirt: SHIRT_IDS[(h >> 3) % 4], pants: 'gray' }, f: 6, dz: [] }; }
  return n;
}
const RIDE_NPC_ON = { carousel: [1, 3, 4], ferris: [0, 2, 5, 7], coaster: [1, 2, 4], pool: [2, 6, 8] };
function drawRideNpc(s, i, X, Y, t) {
  const q = seatPos(s, i, t / 1000), n = rideNpc(s.k, i), k = TS * 1.55 / CH_ATLAS.h, H = CH_ATLAS.h * k;
  const px = q.x * TS + X, py = (q.y - q.lift) * TS + Y;
  if (s.k !== 'pool') drawSeatProp(s.k, px, py + (s.k === 'carousel' ? 0 : TS * .1), s.k === 'coaster' ? '#ffd45e' : RIDE_COL[i % RIDE_COL.length], q);
  ctx.save();
  if (q.swim) { ctx.beginPath(); ctx.rect(px - TS, py - H * 1.2, TS * 2, H * .78); ctx.clip(); drawCharTo(ctx, n, px, py + Math.sin(t / 380 + i) * TS * .05, k, 'front', 0); }
  else drawCharTo(ctx, n, px, py, k, 'front', 0, false, true);
  ctx.restore();
  if (q.swim) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py - H * .42, TS * .45 + Math.sin(t / 300 + i) * 2, TS * .13, 0, 0, 7); ctx.stroke(); swimFx(n.id, q.x, q.y - .42 * H / TS, t); }
  else drawSeatFront(s.k, px, py + (s.k === 'carousel' ? 0 : TS * .1), s.k === 'coaster' ? '#ffd45e' : RIDE_COL[i % RIDE_COL.length], q);
}
// swimmers leave ripples and the odd splash
const SWIM_T = {};
function swimFx(id, x, y, t) {
  if ((SWIM_T[id] || 0) > t) return; SWIM_T[id] = t + 650 + Math.random() * 500;
  FX.ring(x, y, '#ffffff', 900, .7); if (Math.random() < .35) FX.burst(x, y - .1, '#d8f2ff', 5);
}
const ridersOf = k => { const used = new Set(); for (const p of P.values()) if (p.pose === 'fun' && String(p.fn).startsWith(k + ':')) used.add(+String(p.fn).split(':')[1]); return used; };
// what a rider sits in: a horse, a gondola, a coaster car, a bumper car
function drawSeatProp(k, x, y, col, q) {
  const u = TS;
  if (RIDE_IMG() && k !== 'pool') {          // painted seats
    const y0 = k === 'carousel' ? y : y - u * .1;
    if (k === 'carousel') rdraw('car_horse', x, y0 + RG.car.saddle * u, RG.car.horse / rH('car_horse', 1), .5, 1, !!q?.flip);
    else if (k === 'ferris') rdraw('fer_gondola', x, y0 - RG.fer.seat * u, RG.fer.gw, .5, 0);
    else if (k === 'coaster') rdraw('coaster_car', x, y0 + u * .2, RG.coa.car, .5, 1, !!q?.flip);
    else if (k === 'bumper') rdraw('bump_car', x, y0 + u * .25, RG.bump.w, .5, 1, false, 0, null, tinted('bump_car', col));
    return;
  }
  ctx.save(); ctx.translate(x, y);
  if (k === 'carousel') {             // a white horse on a golden pole
    ctx.fillStyle = '#e8c45a'; ctx.fillRect(-u * .04, -u * 1.6, u * .08, u * 1.6);
    ctx.fillStyle = '#fff7f0'; ctx.strokeStyle = '#7a5a46'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -u * .35, u * .38, u * .2, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(u * .36, -u * .62, u * .13, u * .22, -.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(-u * .14, -u * .55, u * .28, u * .1);
  } else if (k === 'ferris') {        // a hanging gondola
    ctx.strokeStyle = '#5b5f73'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -u * 1.1); ctx.lineTo(0, -u * .75); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = '#3a3448'; ctx.beginPath(); ctx.roundRect(-u * .42, -u * .78, u * .84, u * .7, u * .16); ctx.fill(); ctx.stroke();
  } else if (k === 'coaster' || k === 'bumper') {   // a little car
    ctx.fillStyle = col; ctx.strokeStyle = '#2d2a38'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-u * .48, -u * .42, u * .96, u * .5, u * .18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-u * .36, -u * .38, u * .5, u * .08);
    if (k === 'bumper') { ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-u * .3, -u * .42); ctx.lineTo(-u * .3, -u * 1.5); ctx.stroke(); }
  }
  ctx.restore();
}
// the part of the seat in front of the rider (gondola front, car body) so they look like they sit inside
function drawSeatFront(k, x, y, col, q) {
  const u = TS; if (k !== 'ferris' && k !== 'coaster' && k !== 'bumper') return;
  if (RIDE_IMG()) {                          // the lower front of the painted seat, over the rider's legs
    const y0 = y - u * .1;
    if (k === 'ferris') rdraw('fer_gondola', x, y0 - RG.fer.seat * u, RG.fer.gw, .5, 0, false, 0, [.66, 1]);
    else if (k === 'coaster') rdraw('coaster_car', x, y0 + u * .2, RG.coa.car, .5, 1, !!q?.flip, 0, [.5, 1]);
    else rdraw('bump_car', x, y0 + u * .25, RG.bump.w, .5, 1, false, 0, [.55, 1], tinted('bump_car', col));
    return;
  }
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = col; ctx.strokeStyle = '#2d2a38'; ctx.lineWidth = 2;
  if (k === 'ferris') { ctx.beginPath(); ctx.roundRect(-u * .42, -u * .36, u * .84, u * .32, u * .1); ctx.fill(); ctx.stroke(); }
  else { ctx.beginPath(); ctx.roundRect(-u * .5, -u * .24, u * 1, u * .3, u * .12); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}
// the painted version of a ride (true when drawn); moving seats of empty slots are drawn here, riders' seats with the riders
function drawRideImg(s, X, Y, t, used) {
  const T = t / 1000, P2 = (x, y) => [x * TS + X, y * TS + Y], b = rideBottom(s);
  const seats = n => { const out = []; for (let i = 0; i < n; i++) if (!used.has(i)) out.push([i, seatPos(s, i, T)]); return out; };
  if (s.k === 'carousel') {
    const [x, y] = P2(s.cx, b); rdraw('car_base', x, y, RG.car.w);
    for (const [i, q] of seats(6).sort((a, c) => a[1].y - c[1].y)) { const [hx, hy] = P2(q.x, q.y - q.lift); drawSeatProp('carousel', hx, hy, RIDE_COL[i], q); }
    return true;
  }
  if (s.k === 'ferris') {
    const F = RG.fer, [x, y] = P2(s.cx, b); rdraw('fer_stand', x, y, F.w);
    const [hx, hy] = P2(s.cx + F.hubX, b - rH('fer_stand', F.w) * (1 - F.hubY)); rdraw('fer_wheel', hx, hy, F.R * 2, .5, .5, false, T * .18);
    for (const [i, q] of seats(8)) { const [gx, gy] = P2(q.x, q.y); drawSeatProp('ferris', gx, gy + TS * .1, RIDE_COL[i], q); drawSeatFront('ferris', gx, gy + TS * .1, RIDE_COL[i], q); }
    return true;
  }
  if (s.k === 'coaster') {
    const [x, y] = P2(s.cx, b); rdraw('coaster', x, y, RG.coa.w);
    for (const [i, q] of seats(6)) { const [cx, cy] = P2(q.x, q.y); drawSeatProp('coaster', cx, cy + TS * .1, '#ffd45e', q); }
    return true;
  }
  if (s.k === 'shooting') {
    const W = RG.shoot.w, H = rH('shoot_booth', W), [x, y] = P2(s.cx, b); rdraw('shoot_booth', x, y, W);
    ctx.save(); ctx.beginPath(); const [lx] = P2(s.cx - W * .36, 0), [rx] = P2(s.cx + W * .36, 0); ctx.rect(lx, y - H * TS, rx - lx, H * TS); ctx.clip();
    for (let i = 0; i < 6; i++) { const dx = ((i * 1.1 + T * .9) % 6.6) - 3.3, [dX, dY] = P2(s.cx + dx, b - H * (1 - .69) + Math.abs(Math.sin(T * 3 + i)) * -.06); rdraw('shoot_duck', dX, dY, RG.shoot.duck, .5, 1); }
    ctx.restore();
    return true;
  }
  if (s.k === 'pool') {
    const x0 = s.cx - s.w / 2, y0 = s.cy - s.h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    for (let i = 1; i < 4; i++) { const [ax, ay] = P2(x0 + .3, y0 + i * s.h / 4), [bx] = P2(x0 + s.w - .3, 0); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.stroke(); }
    ctx.setLineDash([]);
    { const [lx, ly] = P2(x0 + 1.6, y0 + .1); rdraw('pool_ladder', lx, ly, .7, .5, .3); }
    { const [rx, ry] = P2(x0 + s.w - 1.4, y0 + s.h + .95); rdraw('pool_ring', rx, ry, .8, .5, 1); }
    for (const [ux, uy] of [[x0 - 2.3, y0 + s.h - .6], [x0 + s.w + 2.6, y0 + 2.2]]) { const [px, py] = P2(ux, uy); rdraw('pool_umbrella', px, py, 1.9, .5, 1); }
    return false;   // the water, its lanes and swimmers are drawn as before
  }
  if (s.k === 'bumper') {
    const [x0, y0] = P2(s.cx - s.w / 2, s.cy - s.h / 2), u = TS, W2 = s.w * u, H2 = s.h * u;
    ctx.fillStyle = '#3b3f52'; ctx.fillRect(x0, y0, W2, H2);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; for (let i = 1; i < s.w; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * u, y0); ctx.lineTo(x0 + i * u, y0 + H2); ctx.stroke(); }
    ctx.strokeStyle = '#ffd45e'; ctx.lineWidth = Math.max(4, u * .2); ctx.strokeRect(x0 + 2, y0 + 2, W2 - 4, H2 - 4);
    for (const [i, q] of seats(4)) { const [cx, cy] = P2(q.x, q.y); drawSeatProp('bumper', cx, cy + TS * .1, q.car, q); drawSeatFront('bumper', cx, cy + TS * .1, q.car, q); }
    return true;
  }
  return false;
}
// ------------------------------------------------------------------ 🛕 the temple: painted sprites (assets/temple.webp), shapes as a fallback
let WJ = null, WIMG = null;
let watAsked = false;   // loaded the first time the temple (or its front in town) comes into view
function loadWat() { if (watAsked) return; watAsked = true; fetch('assets/temple.json?v=3').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { WJ = j; WIMG = im; }; im.src = 'assets/temple.webp?v=3'; }).catch(() => { watAsked = false; }); }
function wdraw(n, cx, by, wT, alpha = 1) { const r = WJ?.s[n]; if (!r) return false; const w = wT * TS, h = w * r[3] / r[2]; ctx.globalAlpha = alpha; ctx.drawImage(WIMG, r[0], r[1], r[2], r[3], cx - w / 2, by - h, w, h); ctx.globalAlpha = 1; return true; }
const monkFr = {};
function monkFrame(name) {   // the monk's own walk frames (same cell and feet point as the player sprites)
  loadWat();
  if (!WIMG || !WJ.monk) return null; let c = monkFr[name]; if (c) return c;
  const r = WJ.s.monk, i = WJ.monk.indexOf(name); if (i < 0) return null;
  c = document.createElement('canvas'); c.width = 126; c.height = 96; c.getContext('2d').drawImage(WIMG, r[0] + i * 126, r[1], 126, 96, 0, 0, 126, 96);
  return monkFr[name] = c;
}
const WAT_SPR = { bot: [7.6, .15], chedi: [7.4, .7], sala: [11.6, 1.1], shop: [7.6, .8], bell: [4.4, .6] };   // drawn width (tiles), bottom below the footprint
// life in the temple: monks walking their rounds, lotus on the pond, incense smoke before the hall, bodhi leaves drifting down
const WATM = [];
function watMonks(A, dt) {
  if (!WATM.length) {
    const X = A.x, Y = A.y, mk = (i, name, path) => ({ id: 'watm' + i, staff: 1, career: 'monk', c: 'monk', of: 'monk', g: 'm', lk: {}, name, short: name, x: path[0][0], y: path[0][1], rx: path[0][0], ry: path[0][1], f: 6, dz: [], path, i: 1, wait: 0 });
    WATM.push(mk(1, 'พระมหาสมชาย', [[X + 15.5, Y + 18.5], [X + 27.5, Y + 18.5], [X + 27.5, Y + 28.5], [X + 15.5, Y + 28.5]]),
      mk(2, 'พระใบฎีกาเอก', [[X + 6, Y + 16.9], [X + 21, Y + 16.9], [X + 21, Y + 14.2], [X + 30.6, Y + 14.2], [X + 30.6, Y + 10.6], [X + 30.6, Y + 16.9], [X + 9, Y + 16.9], [X + 9, Y + 19.4], [X + 9, Y + 16.9]]),
      mk(3, 'สามเณรน้อย', [[X + 5, Y + 13], [X + 10, Y + 13], [X + 10, Y + 15], [X + 4, Y + 15]]));
  }
  for (const m of WATM) {
    if (m.wait > 0) m.wait -= dt;
    else { const [tx, ty] = m.path[m.i], dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
      if (d < .05) { m.i = (m.i + 1) % m.path.length; if (Math.random() < .35) m.wait = 2 + Math.random() * 5; }
      else { const st = Math.min(d, (m.id === 'watm3' ? .8 : 1.1) * dt); m.x += dx / d * st; m.y += dy / d * st; m.f = Math.round((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8; } }
    m.rx += (m.x - m.rx) * .3; m.ry += (m.y - m.ry) * .3;
  }
}
function drawWatFx(e, X, Y, t) {
  const u = TS, A = AREA.temple, T = t / 1000;
  if (e.fx === 'koi') {            // koi gliding round under the surface
    for (let i = 0; i < 5; i++) { const a = T * (.25 + i * .04) + i * 1.3, x = A.x + 21.5 + Math.cos(a) * (2.6 + i * .3), y = A.y + 23.5 + Math.sin(a) * (1.8 + (i % 2) * .6), dir = a + Math.PI / 2;
      ctx.save(); ctx.translate(x * u + X, y * u + Y); ctx.rotate(dir); ctx.globalAlpha = .75; ctx.fillStyle = i % 2 ? '#ff8a3a' : '#fff4ea';
      ctx.beginPath(); ctx.ellipse(0, 0, u * .26, u * .09, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(-u * .22, 0); ctx.lineTo(-u * .38, -u * .08 * Math.sin(T * 6 + i)); ctx.lineTo(-u * .38, u * .08); ctx.fill();
      if (i % 2 === 0) { ctx.fillStyle = '#ff6a2a'; ctx.beginPath(); ctx.arc(u * .06, 0, u * .05, 0, 7); ctx.fill(); } ctx.restore(); }
    ctx.globalAlpha = 1; return;
  }
  if (e.fx === 'lotus') {          // pads and flowers on the pond, bobbing a little
    for (let i = 0; i < 22; i++) {
      const x = A.x + 17.4 + ((i * 37) % 83) / 83 * 8.2, y = A.y + 20.4 + ((i * 53) % 61) / 61 * 6.2, bob = Math.sin(T * 1.3 + i) * u * .03;
      const px = x * u + X, py = y * u + Y + bob, r = u * (.28 + (i % 3) * .06);
      ctx.fillStyle = i % 4 ? '#3f8f4a' : '#4ea65a'; ctx.beginPath(); ctx.ellipse(px, py, r, r * .55, 0, .35, Math.PI * 2 - .05); ctx.lineTo(px, py); ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,25,.35)'; ctx.lineWidth = 1; ctx.stroke();
      if (i % 3 === 0) { const fy = py - u * .12; for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * .45; ctx.fillStyle = k % 2 ? '#f6b6cf' : '#ee8fb4'; ctx.beginPath(); ctx.ellipse(px + Math.cos(a) * u * .1, fy + Math.sin(a) * u * .1, u * .07, u * .15, a + Math.PI / 2, 0, 7); ctx.fill(); } ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.arc(px, fy, u * .045, 0, 7); ctx.fill(); }
    }
  } else if (e.fx === 'incense') { // a golden urn with incense sticks, smoke curling up
    const px = e.x * u + X, py = e.y * u + Y;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(px, py, u * .45, u * .14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = WAT.gold2; ctx.fillRect(px - u * .1, py - u * .3, u * .2, u * .3);
    ctx.fillStyle = WAT.gold; ctx.beginPath(); ctx.moveTo(px - u * .42, py - u * .62); ctx.quadraticCurveTo(px - u * .4, py - u * .25, px, py - u * .22); ctx.quadraticCurveTo(px + u * .4, py - u * .25, px + u * .42, py - u * .62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8962a'; ctx.beginPath(); ctx.ellipse(px, py - u * .62, u * .42, u * .1, 0, 0, 7); ctx.fill();
    for (let k = -2; k <= 2; k++) { ctx.fillStyle = '#b8322a'; ctx.fillRect(px + k * u * .08 - 1, py - u * 1.05, 2, u * .45); ctx.fillStyle = '#ffb347'; ctx.fillRect(px + k * u * .08 - 1.5, py - u * 1.08, 3, 3); }
    for (let k = 0; k < 7; k++) { const ph = ((T * .35 + k / 7) % 1), sx = px + Math.sin(T * 1.7 + k * 1.9) * u * .25 * ph, sy = py - u * 1.1 - ph * u * 2.4;
      ctx.fillStyle = `rgba(235,235,240,${.38 * (1 - ph)})`; ctx.beginPath(); ctx.arc(sx, sy, u * (.08 + ph * .28), 0, 7); ctx.fill(); }
  } else if (e.fx === 'leaves') {  // bodhi leaves drifting down
    for (let k = 0; k < 6; k++) { const ph = (T * .12 + k / 6) % 1, x = A.x + 7.5 + Math.sin(k * 2.3) * 2.2 + Math.sin(T * .9 + k) * .6 + ph * 1.2, y = A.y + 6 + ph * 5.5;
      ctx.save(); ctx.translate(x * u + X, y * u + Y); ctx.rotate(Math.sin(T * 2 + k) * 1.2); ctx.globalAlpha = Math.min(1, (1 - ph) * 3);
      ctx.fillStyle = k % 2 ? '#7fb24a' : '#c9a33e'; ctx.beginPath(); ctx.moveTo(0, -u * .12); ctx.quadraticCurveTo(u * .1, 0, 0, u * .12); ctx.quadraticCurveTo(-u * .1, 0, 0, -u * .12); ctx.fill(); ctx.restore(); }
  }
}
// ---- passers-by: families wandering the park, visitors at the temple (drawn on every phone the same way, no server needed)
const CROWD = {}, LOOKC = { shirt: ['white', 'blue', 'green', 'red', 'yellow', 'pink', 'purple', 'black'], pants: ['gray', 'blue', 'black', 'brown'], hair: ['brown', 'black'] };
const BALLOON = ['#ff5a6e', '#ffd23a', '#4fb3ff', '#7ee07a', '#c88cff', '#ff9a3c'];
function crowdMake(A) {
  const X = A.x, Y = A.y; let seed = A.id === 'park' ? 7331 : 9127; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pk = a => a[Math.floor(r() * a.length)];
  const L = [], person = (i, route, o = {}) => {
    const lk = { hair: pk(LOOKC.hair), shirt: pk(LOOKC.shirt), pants: pk(LOOKC.pants) }, j = Math.floor(r() * route.length), lane = (r() - .5) * .7;
    const pts = route.map(([x, y]) => [x + lane, y + lane * .4]);
    L.push({ id: 'crowd' + A.id + i, crowd: 1, npc: 1, staff: 1, c: '', of: '', g: r() < .5 ? 'f' : 'm', lk, name: '', dz: [], x: pts[j][0], y: pts[j][1], rx: pts[j][0], ry: pts[j][1], f: 6, path: pts, i: (j + 1) % pts.length, wait: r() * 3, sp: .8 + r() * .5, ...o });
  };
  if (A.id === 'park') {
    const P0 = (c, y) => [X + c, Y + y - 52];   // park walks: columns from the park's left edge, rows as map rows of the park's first home (top at row 52)
    const R = [   // the compact park: promenade (row ~63.5), two walks (cols 16 / 28) and the shopping street (row ~75)
      [P0(3, 63.5), P0(38, 63.5), P0(16, 63.5), P0(16, 75), P0(36, 75), P0(28, 75), P0(28, 63.5)],
      [P0(6, 62.8), P0(7, 62.8), P0(7, 61), P0(7, 62.8), P0(18, 62.8), P0(18, 61.8), P0(18, 62.8), P0(32, 62.8), P0(32, 61), P0(32, 62.8)],
      [P0(16, 64.2), P0(22, 64.2), P0(22, 65.6), P0(22, 64.2), P0(33, 64.2), P0(33, 65.6), P0(33, 64.2), P0(28, 64.2), P0(28, 75.2), P0(5, 75.2), P0(5, 75.6), P0(16, 75.2), P0(16, 64.2)],
      [P0(2, 63.2), P0(9, 63.2), P0(9, 65.6), P0(9, 63.2), P0(38, 63.2), P0(2, 63.2)]];
    for (let i = 0; i < 14; i++) { const kid = i % 3 === 1; person(i, R[i % R.length], kid ? { small: .72, balloon: pk(BALLOON) } : r() < .2 ? { balloon: pk(BALLOON) } : {}); }
    L.push({ id: 'crowd_seller', crowd: 1, npc: 1, staff: 1, c: '', of: '', g: 'm', lk: { hair: 'black', shirt: 'red', pants: 'black' }, name: '', dz: [], x: X + 12.5, y: Y + 12.7, rx: X + 12.5, ry: Y + 12.7, f: 6, path: null, seller: 1 });
  } else if (A.id === 'town') {
    // pavements run beside every main road: people stroll along them and stop to look around
    const seg = (x0, x1, y) => [[x0, y], [x1, y]], walks = [
      seg(14, 88, 13.5), seg(14, 88, 16.5), seg(4, 40, 30.5), seg(60, 93, 30.5), seg(3, 94, 33.5), seg(5, 48, 45.5), seg(5, 48, 48.5),
      [[44, 25.5], [57, 25.5], [57, 37.5], [44, 37.5]], [[46, 27.5], [55, 27.5], [55, 35.5], [46, 35.5]]];
    for (let i = 0; i < 22; i++) { const w = walks[i % walks.length], rt = w.length === 2 ? [w[0], w[1]] : w; person(i, i % 2 && w.length === 2 ? rt.slice().reverse() : rt, i % 5 === 3 ? { small: .72 } : {}); }
    L.forEach((m, i) => { m.n = i; if (m.path) { m.sp *= 1.15; } });
    TWNB.length = 0; for (let i = 0; i < 8; i++) TWNB.push({ hx: 44 + r() * 13, hy: 33.2 + r() * 3.4, x: 0, y: 0, z: 0, fly: 0, ph: r() * 7 });
    for (const b of TWNB) { b.x = b.hx; b.y = b.hy; }
    TWNC.length = 0; [['🐈', 20, 33.6], ['🐕', 70, 16.6], ['🐈', 32, 45.6], ['🐩', 80, 30.6], ['🐈', 52, 13.6]].forEach(([e, x, y], i) => TWNC.push({ e, x, y, tx: x, ty: y, wait: r() * 3, dir: 1, ph: r() * 6, home: y }));
  } else {
    const P0 = (c, rw) => [X + c, Y + rw];
    const R = [[P0(2, 16.9), P0(21.4, 16.9), P0(21.4, 13.8), P0(21.4, 16.9), P0(30.6, 16.9), P0(30.6, 11), P0(30.6, 16.9), P0(2, 16.9)],
      [P0(15.5, 18.5), P0(27.5, 18.5), P0(27.5, 28.5), P0(15.5, 28.5)],
      [P0(2, 17.2), P0(9, 17.2), P0(9, 19.6), P0(9, 17.2), P0(32, 17.2), P0(32, 19.5), P0(35, 25.6), P0(32, 19.5), P0(32, 17.2)]];
    for (let i = 0; i < 7; i++) person(i, R[i % R.length], i === 3 ? { small: .72 } : {});
    WATB.length = 0; for (let i = 0; i < 9; i++) WATB.push({ hx: X + 17 + r() * 11, hy: Y + 13.6 + r() * 2, x: 0, y: 0, z: 0, fly: 0, ph: r() * 7 });
    for (const b of WATB) { b.x = b.hx; b.y = b.hy; }
  }
  return CROWD[A.id] = L;
}
const WATB = [], TWNB = [], TWNC = [];   // temple pigeons, town-square pigeons, town cats and dogs
function crowdEnts(A, ents, vis) {
  const L = CROWD[A.id] || crowdMake(A), now0 = performance.now(), dt = Math.min(.1, (now0 - (CROWD['t' + A.id] || now0)) / 1000); CROWD['t' + A.id] = now0;
  for (const m of L) {
    if (m.path) {
      if (m.wait > 0) m.wait -= dt;
      else { const [tx, ty] = m.path[m.i], dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        if (d < .05) { m.i = (m.i + 1) % m.path.length; if (Math.random() < .3) m.wait = 1.5 + Math.random() * 4; }
        else { const st = Math.min(d, m.sp * dt); m.x += dx / d * st; m.y += dy / d * st; m.f = Math.round((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8; } }
      m.rx += (m.x - m.rx) * .3; m.ry += (m.y - m.ry) * .3;
    }
    if (!vis(m.rx, m.ry, 3)) continue;
    if (A.id === 'town' && m.n % 3 && (hourNow() >= 22 || hourNow() < 5)) continue;   // the late-night streets are quieter
    ents.push([m.ry + .3, 4, m]);
    if (m.balloon || m.seller) ents.push([m.ry + .31, 14, { fx: 'balloon', m }]);
  }
  if (A.id === 'park') { const Y0 = A.y - 52; ents.push([Y0 + 62.1, 14, { fx: 'bunting', y: Y0 + 62.1 }], [Y0 + 65, 14, { fx: 'bunting', y: Y0 + 65 }], [Y0 + 74.1, 14, { fx: 'bunting', y: Y0 + 74.1 }], [1e5, 14, { fx: 'bubbles', x: A.x + 7, y: Y0 + 60.6 }]); }
  if (A.id === 'town') {   // town critters: pigeons in the square, cats and dogs on the pavements
    for (const c of TWNC) {
      if (c.wait > 0) c.wait -= dt; else { const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy); if (d < .1) { c.wait = 2 + Math.random() * 6; c.tx = c.x + (Math.random() - .5) * 8; c.ty = c.home; c.tx = clamp(c.tx, 8, 90); } else { const st = Math.min(d, (c.e === '🐈' ? .9 : 1.3) * dt); c.x += dx / d * st; c.y += dy / d * st; c.dir = dx < 0 ? -1 : 1; } }
      if (vis(c.x, c.y, 2)) ents.push([c.y + .2, 14, { fx: 'critter', c }]);
    }
  }
  if (A.id === 'temple' || A.id === 'town') { const me0 = P.get(myId), PIG = A.id === 'temple' ? WATB : TWNB;
    for (const b of PIG) {   // pigeons peck about the courtyard and take off when someone walks up
      const near = me0 && Math.hypot(me0.rx - b.x, me0.ry - b.y) < 1.8 || L.some(m => Math.hypot(m.rx - b.x, m.ry - b.y) < .9);
      if (near && !b.fly) { b.fly = 1; b.vx = (Math.random() - .5) * 6; b.vy = -2 - Math.random() * 2; FX.play('pop'); }
      if (b.fly === 1) { b.x += b.vx * dt; b.y += b.vy * dt * .4; b.z += 3.2 * dt; if (b.z > 4) { b.fly = 2; b.back = now0 + 6000 + Math.random() * 6000; } }
      else if (b.fly === 2) { if (now0 > b.back) { b.fly = 3; b.x = b.hx + (Math.random() - .5) * 6; b.y = b.hy - 3; } }
      else if (b.fly === 3) { b.x += (b.hx - b.x) * dt * 1.2; b.y += (b.hy - b.y) * dt * 1.2; b.z = Math.max(0, b.z - 2.2 * dt); if (b.z <= 0 && Math.hypot(b.x - b.hx, b.y - b.hy) < .3) b.fly = 0; }
      if (b.fly !== 2 && vis(b.x, b.y, 2)) ents.push([b.y + .1, 14, { fx: 'pigeon', b }]);
    }
    if (A.id === 'temple') ents.push([1e5, 14, { fx: 'butterflies' }]);
  }
}
function drawCrowdFx(e, X, Y, t) {
  const u = TS, T = t / 1000;
  if (e.fx === 'balloon') {   // a balloon on a string (the seller holds a whole bunch)
    const m = e.m, hx = m.rx * u + X + u * .22 * (m.small || 1), hy = (m.ry + .32) * u + Y - u * .78 * (m.small || 1);
    const list = m.seller ? BALLOON.map((c, i) => [c, (i - 2.5) * .26, 1.5 + (i % 2) * .3]) : [[m.balloon, .05, 1.25]];
    for (const [col, ox, hgt] of list) {
      const bx = hx + ox * u + Math.sin(T * 1.6 + ox * 5 + m.rx) * u * .08, by = hy - hgt * u;
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo((hx + bx) / 2 + u * .06, (hy + by) / 2, bx, by + u * .22); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(bx, by, u * .2, u * .25, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(bx - u * .07, by - u * .09, u * .05, u * .08, -.5, 0, 7); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(bx - u * .04, by + u * .27); ctx.lineTo(bx + u * .04, by + u * .27); ctx.lineTo(bx, by + u * .22); ctx.fill();
    }
  } else if (e.fx === 'bunting') {   // festival flags strung along the main walk, little bulbs glowing at night
    const A = AREA.park, y = e.y, h0 = 2.3, dark = Math.max(0, Math.min(1, (Math.abs(hourNow() - 12.5) - 5.2) / 1.2));
    for (let x0 = A.x + 2; x0 < A.x + A.w - 3; x0 += 6) {
      const x1 = x0 + 6, P = k => [(x0 + (x1 - x0) * k) * u + X, (y - h0 + Math.sin(k * Math.PI) * .55) * u + Y];
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x0 * u + X - u * .05, (y - h0) * u + Y, u * .1, h0 * u);
      ctx.strokeStyle = 'rgba(60,40,30,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); for (let k = 0; k <= 1.001; k += .1) { const [px, py] = P(k); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();
      for (let k = .06, i = 0; k < 1; k += .11, i++) { const [px, py] = P(k), fl = Math.sin(T * 3 + k * 9 + x0) * u * .04;
        ctx.fillStyle = BALLOON[(i + x0) % BALLOON.length]; ctx.beginPath(); ctx.moveTo(px - u * .13, py); ctx.lineTo(px + u * .13, py); ctx.lineTo(px + fl, py + u * .32); ctx.fill();
        if (dark > 0) { ctx.fillStyle = `rgba(255,236,150,${.9 * dark})`; ctx.beginPath(); ctx.arc(px + u * .2, py + u * .02, u * .05, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,220,120,${.18 * dark})`; ctx.beginPath(); ctx.arc(px + u * .2, py, u * .22, 0, 7); ctx.fill(); } }
    }
  } else if (e.fx === 'bubbles') {   // a bubble machine by the carousel
    for (let k = 0; k < 9; k++) { const ph = (T * .18 + k / 9) % 1, x = e.x + Math.sin(T * .8 + k * 2.1) * 1.4 + ph * 2.2, y = e.y - ph * 4.5, r = u * (.08 + (k % 3) * .04);
      ctx.globalAlpha = Math.min(1, (1 - ph) * 2.5) * .8; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x * u + X, y * u + Y, r, 0, 7); ctx.stroke();
      ctx.fillStyle = `hsla(${(k * 40 + T * 60) % 360},90%,75%,.25)`; ctx.fill(); ctx.globalAlpha = 1; }
  } else if (e.fx === 'critter') {   // a cat or dog trotting along the pavement
    const c = e.c, px = c.x * u + X, py = c.y * u + Y, moving = c.wait <= 0, bob = moving ? Math.abs(Math.sin(T * 9 + c.ph)) * u * .06 : Math.sin(T * 1.6 + c.ph) * u * .012;
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(px, py, u * .2, u * .06, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(px, py - bob); ctx.scale(-c.dir, 1); ctx.font = `${Math.round(u * .5)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(c.e, 0, u * .06); ctx.restore();
  } else if (e.fx === 'pigeon') {
    const b = e.b, px = b.x * u + X, py = b.y * u + Y, flying = b.fly === 1 || b.fly === 3, z = b.z * u;
    ctx.save(); ctx.translate(px, py); ctx.scale(1.8, 1.8); ctx.translate(-px, -py);
    if (!flying || b.z < .3) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(px, py, u * .14, u * .05, 0, 0, 7); ctx.fill(); }
    const peck = !flying && Math.sin(T * 3 + b.ph) > .6 ? u * .05 : 0, wing = flying ? Math.sin(T * 30 + b.ph) * u * .14 : 0;
    ctx.fillStyle = '#8d93a0'; ctx.beginPath(); ctx.ellipse(px, py - u * .1 - z, u * .13, u * .08, 0, 0, 7); ctx.fill();
    if (flying) { ctx.fillStyle = '#a7adb9'; ctx.beginPath(); ctx.moveTo(px - u * .02, py - u * .12 - z); ctx.lineTo(px - u * .2, py - u * .16 - z - wing); ctx.lineTo(px + u * .05, py - u * .1 - z); ctx.fill(); ctx.beginPath(); ctx.moveTo(px + u * .02, py - u * .12 - z); ctx.lineTo(px + u * .2, py - u * .16 - z + wing); ctx.lineTo(px - u * .05, py - u * .1 - z); ctx.fill(); }
    ctx.fillStyle = '#6f7685'; ctx.beginPath(); ctx.arc(px + u * .1, py - u * .17 - z + peck, u * .055, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8a33a'; ctx.fillRect(px + u * .14, py - u * .17 - z + peck, u * .04, u * .02); ctx.restore();
  } else if (e.fx === 'butterflies') {
    const A = AREA.temple;
    for (let k = 0; k < 5; k++) { const cx = A.x + [17.5, 26.5, 3, 11, 38][k], cy = A.y + [12, 12, 14.5, 14.5, 19.5][k], x = cx + Math.sin(T * .7 + k * 3) * 1.2, y = cy - 1 + Math.sin(T * 1.1 + k) * .5, fl = Math.abs(Math.sin(T * 14 + k)) * u * .1;
      const px = x * u + X, py = y * u + Y; ctx.fillStyle = ['#ffd23a', '#ff8ec3', '#ffffff', '#8fd3ff', '#ffb347'][k];
      ctx.beginPath(); ctx.ellipse(px - fl * .6, py, fl, u * .07, -.4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(px + fl * .6, py, fl, u * .07, .4, 0, 7); ctx.fill(); }
  }
}
// the bell rings by itself at dawn and at dusk while you are in the temple
// 🔔 temple bells: at 6:00 and 18:00 three strokes (loud in the temple, softer in town); and now and then a lone stroke in the temple
// (or faintly near the temple gate in town)
{ let lastH = -1, nextAmb = performance.now() + 20000; setInterval(() => { if (!G || !me) return; const h = Math.floor(hourNow()), m = P.get(myId), ar = m && areaOf(m.x, m.y)?.id, inT = ar === 'temple';
  const gate = STN('gate_temple'), dg = m && gate && ar === 'town' ? Math.hypot(m.x - gate.x, m.y - gate.y) : 1e9;
  if (lastH >= 0 && h !== lastH && (h === 6 || h === 18) && (inT || ar === 'town')) { const k = inT ? 1 : dg < 30 ? .5 : .25; for (let i = 0; i < 3; i++) setTimeout(() => { if (inT) bellT = performance.now(); FX.play('bell', k); }, i * 2600); }
  lastH = h;
  if (performance.now() > nextAmb) { nextAmb = performance.now() + 50000 + Math.random() * 60000; if (inT) { bellT = performance.now(); FX.play('bell', .7); } else if (dg < 18) FX.play('bell', .3); }
}, 1000); }
const WAT = { red: '#b8322a', red2: '#8e241e', green: '#2f7d4f', gold: '#e3b23c', gold2: '#b88516', white: '#f6f0e2', shade: '#d9cfba', wood: '#8a5a2b', wood2: '#6b421d' };
let bellT = 0;
function poly(pts, fill, stroke, lw = 2) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } }
// a Thai gable roof seen from the front: stacked tiers, gold gable panel, chofa horns on top and naga tails at the eaves
function thaiRoof(cx, base, half, height, tiers = 3) {
  const u = TS;
  for (let i = tiers - 1; i >= 0; i--) {
    const hw = half * (1 - i * .16), b = base - i * height * .14, top = base - height - i * height * .05;
    poly([[cx - hw, b], [cx, top], [cx + hw, b]], i % 2 ? WAT.green : WAT.red, WAT.gold, Math.max(2, u * .08));
    poly([[cx - hw * .82, b - u * .12], [cx, top + height * .14], [cx + hw * .82, b - u * .12]], null, i % 2 ? '#4fa06e' : '#d9493c', Math.max(1, u * .05));
  }
  const top = base - height;
  poly([[cx - half * .42, base - height * .18], [cx, top + height * .3], [cx + half * .42, base - height * .18]], WAT.gold, WAT.gold2, 2);   // the gable panel
  ctx.fillStyle = WAT.gold2; ctx.beginPath(); ctx.arc(cx, base - height * .38, Math.max(3, half * .08), 0, 7); ctx.fill();
  ctx.strokeStyle = WAT.gold; ctx.lineWidth = Math.max(2, u * .12); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, top + u * .1); ctx.quadraticCurveTo(cx + u * .1, top - u * .7, cx + u * .45, top - u * .55); ctx.stroke();   // chofa
  for (const sd of [-1, 1]) { const ex = cx + sd * half, ey = base; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.quadraticCurveTo(ex + sd * u * .35, ey - u * .1, ex + sd * u * .3, ey - u * .55); ctx.stroke(); }   // naga tails
  ctx.lineCap = 'butt';
}
function drawWat(s, X, Y, t) {
  loadWat();
  const u = TS, x0 = (s.cx - s.w / 2) * u + X, y0 = (s.cy - s.h / 2) * u + Y, W = s.w * u, H = s.h * u, cx = x0 + W / 2, by = y0 + H;
  ctx.save();
  if (WIMG && WAT_SPR[s.k]) {
    const [wT, dy] = WAT_SPR[s.k], sw = s.k === 'bell' ? Math.max(0, 1 - (performance.now() - bellT) / 1600) : 0;
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.ellipse(cx + u * .2, by + dy * u - u * .25, wT * u * .42, u * .55, 0, 0, 7); ctx.fill();
    wdraw(s.k, cx + Math.sin(performance.now() / 45) * sw * u * .06, by + dy * u, wT);
    ctx.restore(); return;
  }
  if (s.k === 'bot') {                       // the ordination hall
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0 + u * .3, by - u * .1, W, u * .4);
    ctx.fillStyle = WAT.white; ctx.fillRect(x0, by - u * .9, W, u * .9); ctx.fillStyle = WAT.shade; ctx.fillRect(x0, by - u * .2, W, u * .2);   // platform
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? WAT.shade : '#ece4d2'; ctx.fillRect(cx - u * (1.4 - i * .2), by - u * (.3 + i * .3), u * (2.8 - i * .4), u * .3); }   // steps
    const wl = x0 + u * .9, ww = W - u * 1.8, wt = by - u * 4.3;
    ctx.fillStyle = WAT.white; ctx.fillRect(wl, wt, ww, u * 3.4); ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(wl, wt, ww, u * .5);
    for (let i = 0; i < 6; i++) { const px = wl + u * .1 + i * (ww - u * .5) / 5; ctx.fillStyle = '#efe6d2'; ctx.fillRect(px, wt + u * .2, u * .35, u * 3.2); ctx.fillStyle = WAT.gold; ctx.fillRect(px - u * .05, wt + u * .1, u * .45, u * .25); }   // columns
    ctx.fillStyle = WAT.red2; ctx.fillRect(cx - u * .95, by - u * 3.4, u * 1.9, u * 2.5); ctx.fillStyle = WAT.gold; ctx.fillRect(cx - u * .8, by - u * 3.25, u * 1.6, u * 2.35);   // the gilded door
    ctx.strokeStyle = WAT.gold2; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, by - u * 3.25); ctx.lineTo(cx, by - u * .9); ctx.stroke();
    for (const sd of [-1, 1]) for (const k of [1.9, 3.6]) { const wx = cx + sd * u * k - u * .4; ctx.fillStyle = WAT.gold; ctx.fillRect(wx - u * .08, by - u * 3.1, u * .96, u * 1.5); ctx.fillStyle = WAT.red; ctx.fillRect(wx, by - u * 3, u * .8, u * 1.3); }
    thaiRoof(cx, wt + u * .2, W / 2 + u * .2, u * 5.2, 3);
  } else if (s.k === 'chedi') {              // a white bell-shaped chedi with a golden spire
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(cx + u * .3, by, W * .55, u * .5, 0, 0, 7); ctx.fill();
    for (let i = 0; i < 4; i++) { const w = W * (1 - i * .14), h = u * .55; ctx.fillStyle = i % 2 ? WAT.shade : WAT.white; ctx.fillRect(cx - w / 2, by - h * (i + 1), w, h); ctx.fillStyle = WAT.gold; ctx.fillRect(cx - w / 2, by - h * (i + 1), w, u * .08); }
    const db = by - u * 2.2, dr = W * .36;
    ctx.fillStyle = WAT.white; ctx.beginPath(); ctx.moveTo(cx - dr, db); ctx.bezierCurveTo(cx - dr, db - dr * 1.6, cx + dr, db - dr * 1.6, cx + dr, db); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.beginPath(); ctx.moveTo(cx + dr * .2, db); ctx.bezierCurveTo(cx + dr * .3, db - dr * 1.4, cx + dr, db - dr * 1.3, cx + dr, db); ctx.closePath(); ctx.fill();
    ctx.fillStyle = WAT.gold; ctx.fillRect(cx - dr, db - u * .18, dr * 2, u * .18);
    const sb = db - dr * 1.2; ctx.fillStyle = WAT.gold; ctx.fillRect(cx - u * .5, sb - u * .4, u, u * .45);
    for (let i = 0; i < 7; i++) { const w = u * (.8 - i * .1); ctx.fillStyle = i % 2 ? WAT.gold2 : WAT.gold; ctx.fillRect(cx - w / 2, sb - u * (.4 + (i + 1) * .32), w, u * .32); }
    poly([[cx - u * .1, sb - u * 2.6], [cx, sb - u * 4.6], [cx + u * .1, sb - u * 2.6]], WAT.gold);
    const gl = .5 + Math.sin(t / 600) * .5; ctx.fillStyle = `rgba(255,240,180,${.25 * gl})`; ctx.beginPath(); ctx.arc(cx, sb - u * 4.5, u * .35, 0, 7); ctx.fill();
  } else if (s.k === 'bell') {               // the bell tower; the bell swings for a moment when someone strikes it
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0 + u * .2, by - u * .1, W, u * .35);
    ctx.fillStyle = WAT.white; ctx.fillRect(x0, by - u * .7, W, u * .7);
    for (const px of [x0 + u * .2, x0 + W - u * .55]) { ctx.fillStyle = WAT.red; ctx.fillRect(px, by - u * 3.8, u * .35, u * 3.1); }
    ctx.fillStyle = WAT.wood; ctx.fillRect(x0 + u * .1, by - u * 3.9, W - u * .2, u * .25);
    const sw = Math.max(0, 1 - (performance.now() - bellT) / 1600), ang = Math.sin((performance.now() - bellT) / 90) * .35 * sw;
    ctx.save(); ctx.translate(cx, by - u * 3.65); ctx.rotate(ang);
    ctx.fillStyle = WAT.gold2; ctx.fillRect(-u * .05, 0, u * .1, u * .3);
    ctx.fillStyle = WAT.gold; ctx.beginPath(); ctx.moveTo(-u * .3, u * .3); ctx.quadraticCurveTo(-u * .35, u * 1.3, -u * .55, u * 1.4); ctx.lineTo(u * .55, u * 1.4); ctx.quadraticCurveTo(u * .35, u * 1.3, u * .3, u * .3); ctx.closePath(); ctx.fill();
    ctx.restore();
    thaiRoof(cx, by - u * 3.9, W / 2 + u * .4, u * 2.2, 2);
  } else if (s.k === 'shop') {               // the temple shop: a little wooden stall
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x0 + u * .3, by - u * .1, W, u * .35);
    ctx.fillStyle = WAT.wood2; ctx.fillRect(x0, by - u * 2.6, W, u * 2.6); ctx.fillStyle = WAT.wood; ctx.fillRect(x0, by - u * 1.2, W, u * 1.2);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x0 + i * W / 6, by - u * 1.2, 2, u * 1.2); }
    ctx.font = `${Math.round(u * .62)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ['🪷', '🌼', '🍙', '🍡', '🧋'].forEach((e, i) => ctx.fillText(e, x0 + u * .7 + i * (W - u * 1.4) / 4, by - u * 1.15));
    for (const px of [x0 + u * .1, x0 + W - u * .35]) { ctx.fillStyle = WAT.red; ctx.fillRect(px, by - u * 3.6, u * .25, u * 3.6); }
    poly([[x0 - u * .4, by - u * 3.2], [x0 + u * .6, by - u * 4.3], [x0 + W - u * .6, by - u * 4.3], [x0 + W + u * .4, by - u * 3.2]], WAT.red, WAT.gold, 2);
    ctx.fillStyle = WAT.gold; ctx.fillRect(cx - u * 1.5, by - u * 4.1, u * 3, u * .6); ctx.fillStyle = WAT.red2; ctx.font = `700 ${Math.round(u * .38)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText('ร้านของวัด', cx, by - u * 3.8);
  } else if (s.k === 'sala') {               // the open sala: red posts and a Thai roof over a wooden floor (see-through when you are under it)
    const m = P.get(myId), under = m && m.rx > s.cx - s.w / 2 && m.rx < s.cx + s.w / 2 && m.ry > s.cy - s.h / 2 - .5 && m.ry < s.cy + s.h / 2;
    for (const [px, py] of [[0, 0], [9, 0], [0, 5], [9, 5]]) { ctx.fillStyle = WAT.red; ctx.fillRect(x0 + px * u + u * .3, y0 + py * u - u * 2.4, u * .4, u * 3.1); }
    ctx.globalAlpha = under ? .35 : 1;
    const rt = y0 - u * 2.6;
    poly([[x0 - u * .6, rt + u * 1.2], [x0 + u * 1.2, rt - u * 1.4], [x0 + W - u * 1.2, rt - u * 1.4], [x0 + W + u * .6, rt + u * 1.2]], WAT.red, WAT.gold, Math.max(2, u * .1));
    poly([[x0 + u * .6, rt - u * .2], [x0 + u * 2, rt - u * 2.4], [x0 + W - u * 2, rt - u * 2.4], [x0 + W - u * .6, rt - u * .2]], WAT.green, WAT.gold, Math.max(2, u * .08));
    ctx.strokeStyle = WAT.gold; ctx.lineWidth = Math.max(2, u * .1); ctx.lineCap = 'round';
    for (const sd of [-1, 1]) { const ex = sd < 0 ? x0 - u * .6 : x0 + W + u * .6; ctx.beginPath(); ctx.moveTo(ex, rt + u * 1.2); ctx.quadraticCurveTo(ex + sd * u * .3, rt + u, ex + sd * u * .2, rt + u * .5); ctx.stroke(); }
    ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  }
  ctx.restore();
}
// the white temple wall with a red cap and gold-tipped posts; a little Thai arch where the gate is
function drawWatWall(side, X, Y) {
  const T = AREA.temple; if (!T) return; const u = TS;
  const seg = (x0, y0, x1, y1) => { const a = [x0 * u + X, y0 * u + Y], b = [x1 * u + X, y1 * u + Y];
    if (y0 === y1) { ctx.fillStyle = WAT.white; ctx.fillRect(a[0], a[1] - u * .9, b[0] - a[0], u * 1.1); ctx.fillStyle = WAT.red; ctx.fillRect(a[0], a[1] - u * 1.05, b[0] - a[0], u * .22); ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(a[0], a[1] + u * .05, b[0] - a[0], u * .15);
      for (let x = x0; x <= x1; x += 4) { const px = x * u + X; ctx.fillStyle = WAT.white; ctx.fillRect(px - u * .2, a[1] - u * 1.3, u * .4, u * 1.5); ctx.fillStyle = WAT.gold; ctx.beginPath(); ctx.arc(px, a[1] - u * 1.35, u * .14, 0, 7); ctx.fill(); } }
    else { ctx.fillStyle = WAT.white; ctx.fillRect(a[0] - u * .2, a[1] - u * .9, u * .55, b[1] - a[1] + u * .9); ctx.fillStyle = WAT.red; ctx.fillRect(a[0] - u * .25, a[1] - u * .9, u * .65, b[1] - a[1]); ctx.fillStyle = WAT.white; ctx.fillRect(a[0] - u * .15, a[1] - u * .7, u * .45, b[1] - a[1]); } };
  const L = T.x + .3, R = T.x + T.w - .7, top = T.y + .9, bot = T.y + T.h - .1;
  if (side === 'top') { seg(T.x, top, T.x + T.w, top); seg(L, top, L, T.y + 16); seg(L, T.y + 18, L, bot); seg(R, top, R, bot);
    const gx = (T.x + .5) * u + X, gy = (T.y + 18) * u + Y;                 // the arch over the gate
    for (const dy of [-2.1, .1]) { ctx.fillStyle = WAT.white; ctx.fillRect(gx - u * .3, gy + dy * u - u * 1.8, u * .6, u * 1.9); }
    poly([[gx - u * .7, gy - u * 3.8], [gx, gy - u * 5.4], [gx + u * .7, gy - u * 3.8]], WAT.red, WAT.gold, 2);
  } else seg(T.x, bot, T.x + T.w, bot);
}
// the way in from town: a small Thai arch at the end of the south-west lane
function drawWatTownGate(e, X, Y) {
  const s = e.s, F = s.facade;
  if (WIMG && F && e.i !== undefined) {
    const r = WJ.s.entrance, k = r[2] / F.w, sx = r[0] + e.i * k, sw = Math.min(k, r[0] + r[2] - sx); if (sw <= 0) return;
    const h = r[3] / k, x0 = Math.floor((F.x0 + e.i) * TS + X), x1 = Math.ceil((F.x0 + e.i + sw / k) * TS + X) + 1, y0 = (F.by - h) * TS + Y;
    ctx.drawImage(WIMG, sx, r[1], sw, r[3], x0, y0, x1 - x0, h * TS); return;
  }
  const u = TS, gx = s.x * u + X, gy = (s.y + .9) * u + Y;
  for (const dy of [-1.3, 1.3]) { ctx.fillStyle = WAT.white; ctx.fillRect(gx - u * .25, gy + dy * u - u * 2.6, u * .5, u * 2.6); ctx.fillStyle = WAT.gold; ctx.fillRect(gx - u * .3, gy + dy * u - u * 2.75, u * .6, u * .2); }
  thaiRoof(gx, gy - u * 3.6, u * 1.9, u * 1.8, 2);
  ctx.fillStyle = WAT.gold; ctx.fillRect(gx - u * 1.1, gy - u * 3.5, u * 2.2, u * .55); ctx.fillStyle = WAT.red2; ctx.font = `700 ${Math.round(u * .36)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🛕 วัด', gx, gy - u * 3.22);
}
// the arch over the way in (town side and park side), with the park's name on its board
function drawParkGate(x, y, X, Y, town) {
  const sp = town && atlas?.sprites?.b_parkgate;
  if (sp && atlasImg) {                              // the big painted entrance by the south avenue (seen from town)
    const W = 7.2, w = W * TS, h = w * sp[3] / sp[2], px = x * TS + X, py = (y + .8) * TS + Y;
    ctx.drawImage(atlasImg, sp[0], sp[1], sp[2], sp[3], Math.round(px - w / 2), Math.round(py - h), Math.round(w), Math.round(h));
    ctx.font = `700 ${Math.round(TS * .5)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#b4467a';
    ctx.fillText('🎡 สวนสนุก', px, py - h * (1 - .256)); return;
  }
  if (!RIDE_IMG()) return;
  const W = 4.4, H = rH('park_gate', W), px = x * TS + X, py = y * TS + Y;
  rdraw('park_gate', px, py, W);
  const fs = Math.round(TS * .42); ctx.font = `700 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b4467a'; ctx.fillText('🎡 สวนสนุก', px, py - H * TS * (1 - .205));
}
function drawRideThing(s, X, Y, t) {
  const T = t / 1000, u = TS, P2 = (x, y) => [x * TS + X, y * TS + Y], b = rideBottom(s), used0 = ridersOf(s.k), npcs = (RIDE_NPC_ON[s.k] || []).filter(i => !used0.has(i)), used = new Set([...used0, ...npcs]);
  if (RIDE_IMG() && drawRideImg(s, X, Y, t, used)) { /* painted */ }
  else if (s.k === 'carousel') {
    const [cx, by] = P2(s.cx, b - 1.15), rx = (s.w / 2 - .3) * u;
    ctx.fillStyle = '#b9894a'; ctx.beginPath(); ctx.ellipse(cx, by + u * .25, rx, u * 1.05, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f6e0b0'; ctx.beginPath(); ctx.ellipse(cx, by, rx, u * 1.0, 0, 0, 7); ctx.fill();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; ctx.fillStyle = (Math.floor(T * 3) + i) % 2 ? '#fff6a8' : '#ffb347'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * .97, by + u * .18 + Math.sin(a) * u * .97, u * .07, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#e8c45a'; ctx.fillRect(cx - u * .12, by - u * 4.2, u * .24, u * 4.2);
    for (let i = 0; i < 6; i++) if (!used.has(i)) { const q = seatPos(s, i, T); if (Math.sin(q.a) < 0) { const [x, y] = P2(q.x, q.y - q.lift); drawSeatProp('carousel', x, y, RIDE_COL[i]); } }
    for (let i = 0; i < 6; i++) if (!used.has(i)) { const q = seatPos(s, i, T); if (Math.sin(q.a) >= 0) { const [x, y] = P2(q.x, q.y - q.lift); drawSeatProp('carousel', x, y, RIDE_COL[i]); } }
    const [rx0, ry0] = P2(s.cx, b - 5.3), n = 12;            // the striped tent roof, turning slowly
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2 + T * .3, a1 = (i + 1) / n * Math.PI * 2 + T * .3;
      ctx.fillStyle = i % 2 ? '#ff8fb8' : '#fff1dc'; ctx.beginPath(); ctx.moveTo(rx0, ry0 - u * 1.6);
      ctx.lineTo(rx0 + Math.cos(a0) * rx * 1.05, ry0 + Math.sin(a0) * u * .55); ctx.lineTo(rx0 + Math.cos(a1) * rx * 1.05, ry0 + Math.sin(a1) * u * .55); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#a8506e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(rx0, ry0, rx * 1.05, u * .55, 0, 0, Math.PI); ctx.stroke();
    ctx.fillStyle = '#ffd45e'; ctx.beginPath(); ctx.moveTo(rx0, ry0 - u * 2.3); ctx.lineTo(rx0 + u * .5, ry0 - u * 2.05); ctx.lineTo(rx0, ry0 - u * 1.8); ctx.fill();
  } else if (s.k === 'ferris') {
    const [cx, cy] = P2(s.cx, b - 4.5), R = 3.1 * u, [bx, by] = P2(s.cx, b);
    ctx.strokeStyle = '#8a8fa8'; ctx.lineWidth = Math.max(3, u * .14);
    ctx.beginPath(); ctx.moveTo(bx - u * 2.6, by - u * .2); ctx.lineTo(cx, cy); ctx.lineTo(bx + u * 2.6, by - u * .2); ctx.stroke();
    ctx.strokeStyle = '#f2f2ff'; ctx.lineWidth = Math.max(2, u * .1); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#d8d8ec'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) { const a = T * .22 + i * Math.PI / 8; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke(); }
    for (let i = 0; i < 24; i++) { const a = T * .22 + i * Math.PI / 12; ctx.fillStyle = (Math.floor(T * 2) + i) % 3 ? '#fff6a8' : '#ff8fb8'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, u * .06, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#c86b98'; ctx.beginPath(); ctx.arc(cx, cy, u * .3, 0, 7); ctx.fill();
    for (let i = 0; i < 8; i++) { const q = seatPos(s, i, T), [x, y] = P2(q.x, q.y); drawSeatProp('ferris', x, y, RIDE_COL[i]); if (!used.has(i)) drawSeatFront('ferris', x, y, RIDE_COL[i]); }
    ctx.fillStyle = '#7a5a46'; ctx.fillRect(bx - u * 1.2, by - u * .9, u * 2.4, u * .9); ctx.fillStyle = '#ffd45e'; ctx.fillRect(bx - u * 1.3, by - u * 1.15, u * 2.6, u * .3);
  } else if (s.k === 'coaster') {
    const pts = []; for (let i = 0; i <= 80; i++) pts.push(coasterPt(s, i / 80));
    ctx.strokeStyle = '#d9dce8'; ctx.lineWidth = 2;
    for (let i = 0; i < 80; i += 5) { const [x, y] = P2(pts[i].x, pts[i].y), [, gy] = P2(0, b - .2); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, gy); ctx.stroke(); }
    ctx.strokeStyle = '#e0484f'; ctx.lineWidth = Math.max(3, u * .16); ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = P2(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    for (let i = 0; i < 6; i++) if (!used.has(i)) { const q = seatPos(s, i, T), [x, y] = P2(q.x, q.y); drawSeatProp('coaster', x, y, '#ffd45e'); drawSeatFront('coaster', x, y, '#ffd45e'); }
    const [sx, sy] = P2(s.cx, b - .2); ctx.fillStyle = '#7a5a46'; ctx.fillRect(sx - u * 1.6, sy - u * 1.1, u * 3.2, u * 1.1);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e0484f'; ctx.fillRect(sx - u * 1.8 + i * u * .6, sy - u * 1.45, u * .6, u * .35); }
  } else if (s.k === 'bumper') {
    const [x0, y0] = P2(s.cx - s.w / 2, s.cy - s.h / 2), W2 = s.w * u, H2 = s.h * u;
    ctx.fillStyle = '#3b3f52'; ctx.fillRect(x0, y0, W2, H2);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; for (let i = 1; i < s.w; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * u, y0); ctx.lineTo(x0 + i * u, y0 + H2); ctx.stroke(); }
    ctx.strokeStyle = '#ffd45e'; ctx.lineWidth = Math.max(4, u * .2); ctx.strokeRect(x0 + 2, y0 + 2, W2 - 4, H2 - 4);
    for (let i = 0; i < 4; i++) if (!used.has(i)) { const q = seatPos(s, i, T), [x, y] = P2(q.x, q.y); drawSeatProp('bumper', x, y, q.car); drawSeatFront('bumper', x, y, q.car); }
    ctx.strokeStyle = 'rgba(200,200,220,.6)'; ctx.lineWidth = 2; for (const fx of [0, 1]) for (const fy of [0, 1]) { ctx.beginPath(); ctx.moveTo(x0 + 4 + fx * (W2 - 8), y0 + 4 + fy * (H2 - 8)); ctx.lineTo(x0 + 4 + fx * (W2 - 8), y0 - u * 1.4 + fy * (H2 - 8)); ctx.stroke(); }
  } else if (s.k === 'shooting') {
    const [x0, y0] = P2(s.cx - s.w / 2, s.cy - s.h / 2), W2 = s.w * u, H2 = s.h * u;
    ctx.fillStyle = '#8a5a3c'; ctx.fillRect(x0, y0 + H2 * .55, W2, H2 * .45);                  // counter (north side faces the promenade)
    ctx.fillStyle = '#f6e0b0'; ctx.fillRect(x0 + u * .2, y0 + H2 * .55, W2 - u * .4, u * .25);
    ctx.fillStyle = '#4a3a5c'; ctx.fillRect(x0, y0 - u * 1.4, W2, H2 * .55 + u * 1.4);             // back wall with the targets
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
      const x = x0 + ((i * 1.4 + T * (r ? -.9 : .9)) % (s.w)) * u, y = y0 - u * .9 + r * u * .9;
      ctx.fillStyle = r ? '#ffffff' : '#ffd45e'; ctx.beginPath(); ctx.arc(((x - x0) % W2 + W2) % W2 + x0, y, u * .22, 0, 7); ctx.fill();
      ctx.fillStyle = '#e0484f'; ctx.beginPath(); ctx.arc(((x - x0) % W2 + W2) % W2 + x0, y, u * .1, 0, 7); ctx.fill();
    }
    for (let i = 0; i < Math.ceil(s.w / .8); i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e0484f'; ctx.fillRect(x0 + i * u * .8, y0 - u * 1.9, u * .8, u * .5); }
  } else if (s.k === 'pool') {
    const [x0, y0] = P2(s.cx - s.w / 2, s.cy - s.h / 2);
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0 + u * .3, y0 + i * s.h * u / 4); ctx.lineTo(x0 + s.w * u - u * .3, y0 + i * s.h * u / 4); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#d8dde8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0 + u * 1.2, y0 - u * .3); ctx.lineTo(x0 + u * 1.2, y0 + u * .8); ctx.moveTo(x0 + u * 1.7, y0 - u * .3); ctx.lineTo(x0 + u * 1.7, y0 + u * .8); ctx.stroke();
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = u * .16; ctx.beginPath(); ctx.arc(x0 + s.w * u - u * 1.5, y0 + s.h * u + u * .45, u * .3, 0, 7); ctx.stroke();
  }
  if (chImg) for (const i of npcs) drawRideNpc(s, i, X, Y, t);
  const ty = RIDE_IMG() && { carousel: 1, ferris: 1, coaster: 1, shooting: 1 }[s.k] ? b - { carousel: 12.4, ferris: 12.9, coaster: 10.6, shooting: 7.9 }[s.k] : s.top ? s.cy - s.h / 2 - (s.k === 'shooting' ? 2.6 : .9) : b - (s.k === 'ferris' ? 8.2 : s.k === 'carousel' ? 7.9 : s.k === 'coaster' ? 4.6 : .5);
  const [lx, ly] = P2(s.cx, ty); sign(`${s.icon} ${s.label}`, lx, ly, { size: TS * .3, bg: 'rgba(160,50,110,.92)' });
}
const npcPatients = {};
function npcPatient(b, s) {
  const key = b[1]; let n = npcPatients[key];
  if (!n) { const h = [...String(b[0])].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7); n = npcPatients[key] = { id: key, npc: 1, name: b[0], g: h % 2 ? 'f' : 'm', lk: { hair: ['brown', 'black', 'blonde', 'ginger'][h % 4], shirt: SHIRT_IDS[(h >> 3) % 4], pants: ['gray', 'jeans', 'brown'][(h >> 5) % 3] }, pose: 'hosp', dz: ['🤒'] }; }
  n.rx = n.x = s.x; n.ry = n.y = s.y; return n;
}
// ---- job staff: an NPC at every place that hires (plus the rod seller), each with its own talk spot next to the counter
const STAFF_DEF = {   // every officer looks like their painted portrait (NPC_FACE): gender, hair, clothes
  templeboy: { name: 'พี่ตุ๋ย (เด็กวัดรุ่นพี่)', short: 'พี่ตุ๋ย', lk: { hair: 'black' }, hi: 'มาช่วยงานวัดไหม ได้บุญได้เงินด้วยนะ', yes: 'หลวงพ่อฝากงานไว้ รับภารกิจได้เลย' },
  undertaker: { name: 'ลุงสัป (สัปเหร่อประจำวัด)', short: 'ลุงสัป', lk: { hair: 'silver' }, hi: 'กลัวผีไหมหลาน? ถ้าไม่กลัว มาเป็นสัปเหร่อกับลุงสิ', yes: 'คืนนี้มีงาน เตรียมตัวให้พร้อมนะ' },
  mechanic: { name: 'ช่างเปี๊ยก (อู่หน้าโชว์รูม)', short: 'ช่างเปี๊ยก', lk: { hair: 'black' }, hi: 'รถเสียเต็มเมือง ช่างไม่พอ มาช่วยกันหน่อย', yes: 'มีรถรอซ่อมอยู่ รับงานเลย!' },
  thug: { name: 'เสี่ยเสือ (ลูกพี่ประจำตลาด)', short: 'เสี่ยเสือ', lk: { hair: 'black' }, hi: 'อยากเป็นนักเลงเหรอ? นักเลงจริงต้องใจดีนะเว้ย', yes: 'มีเรื่องให้เคลียร์ ไปจัดการหน่อย' },
  photographer: { name: 'พี่โฟกัส (สตูดิโอถ่ายภาพ)', short: 'พี่โฟกัส', lk: { hair: 'brown' }, hi: 'ชอบถ่ายรูปไหม มาเป็นช่างภาพกัน', yes: 'มีลูกค้าจ้างถ่ายรูป รับงานได้เลย' },
  courier: { name: 'พี่ด่วน (หัวหน้าส่งพัสดุ)', short: 'พี่ด่วน', g: 'f', lk: { hair: 'brown' }, hi: 'ไม่มีใบขับขี่ก็ส่งของได้ เดินส่งเอา!', yes: 'พัสดุมาลงแล้ว รีบไปส่งเลย' },
  office:   { name: 'คุณนภา (ฝ่ายบุคคล)', short: 'คุณนภา', g: 'f', lk: { hair: 'brown', shirt: 'white' }, hi: 'สวัสดีค่ะ สนใจร่วมงานกับไทยเทคไหมคะ?', yes: 'ทำงานให้ตรงเวลานะคะ เข้างาน 8 โมง!' },
  farmer:   { name: 'พี่ข้าวหอม (ประธานสหกรณ์)', short: 'พี่ข้าวหอม', g: 'f', lk: { hair: 'brown', shirt: 'red' }, hi: 'มาทำไร่ด้วยกันไหม ได้กินผักสดทุกวันเลยนะ', yes: 'ดูแลแปลงดีๆ นะ' },
  fishing:  { name: 'น้าเล็ก (สมาคมประมง)', short: 'น้าเล็ก', lk: { hair: 'silver' }, hi: 'มือใหม่ยังไม่มีเงิน? ซื้อเบ็ดคันละ ฿150 ไปตกปลาขายสิ หาเงินง่ายสุดแล้ว!', yes: 'ทุ่นจมเมื่อไหร่ ตวัดเลยนะ! แล้วค่อยๆ เย่อมันเข้ามา' },
  merchant: { name: 'เฮียชัย (เจ้าของโรงประมูล)', short: 'เฮียชัย', lk: { hair: 'brown' }, hi: 'มาประมูลของกันไหม ล็อตใหม่ขึ้นเวทีตลอด', yes: 'ซื้อถูกขายแพง จำไว้!' },
  doctor:   { name: 'หมอแพร (ผอ.โรงพยาบาล)', short: 'หมอแพร', g: 'f', lk: { hair: 'brown' }, hi: 'โรงพยาบาลขาดหมอ ถ้าเรียนจบแพทย์แล้วมาช่วยกันนะคะ', yes: 'อยู่ในโรงพยาบาลช่วงเวรได้เงินเดือนทุกชั่วโมงนะคะ' },
  rider:    { name: 'พี่ต่อ (หัวหน้าไรเดอร์)', short: 'พี่ต่อ', lk: { hair: 'black' }, hi: 'มีใบขับขี่ไหม? มาวิ่งส่งอาหารกัน', yes: 'ออเดอร์เข้าเยอะ ดูแอพด้วยนะ! ใบขับขี่ต้องต่ออายุทุกปีด้วย' },
  police:   { name: 'ผู้กองเอก (สถานีตำรวจ)', short: 'ผู้กองเอก', lk: { hair: 'black' }, hi: 'เมืองนี้ต้องการผู้พิทักษ์ จบ ม.6 แล้วมาสอบนายสิบนะ', yes: 'ถ้ามีแจ้งเหตุ 191 รีบไปนะ' },
  cashier:  { name: 'พี่แนน (ผู้จัดการร้าน)', short: 'พี่แนน', g: 'f', lk: { hair: 'brown', shirt: 'green' }, hi: 'ร้านเรารับพนักงานแคชเชียร์อยู่นะ ไม่ต้องมีวุฒิ สนใจไหม?', yes: 'ถึงกะแล้ว! ไปยืนแคชเชียร์ คิดเงินทอนให้ถูกนะ' },
  monk:     { name: 'หลวงพ่อเย็น (เจ้าอาวาส)', short: 'หลวงพ่อเย็น', lk: {}, hi: 'เจริญพร โยม · อยากบวชเรียนศึกษาธรรมไหม ชีวิตเรียบง่ายแต่อิ่มใจนะ', yes: 'ตื่นเช้าออกบิณฑบาต แล้วอย่าฉันหลังเที่ยงนะ' },
  beggar:   { name: 'ลุงจุก (ศาลาประชาคม)', short: 'ลุงจุก', lk: { hair: 'black', shirt: 'white', pants: 'brown' }, hi: 'ไม่มีงานทำก็มาเป็นขอทานกับลุงได้นะ วิ่งเก็บขยะที่ถังขยะ หรือนั่งขอทานก็ได้ เก็บให้เกิน 2,000 บาทก็พ้นแล้ว', yes: 'ใครบริจาคก็ขอบคุณเขาด้วยนะ' },
};
let STAFF = [], STAFF_AT = {};
function buildStaff() {
  STAFF = []; STAFF_AT = {};
  for (const s of G.stations.filter(x => x.type === 'staff')) {
    const d = STAFF_DEF[s.career]; if (!d) continue;
    const x = s.x, y = s.y - 0.35;
    const n = { id: 'staff_' + s.career, staff: 1, career: s.career, c: s.career, of: s.career, g: d.g || 'm', name: d.name, short: d.short, st: s.id, at: s.at, lk: { hair: 'brown', shirt: 'white', pants: 'gray', ...(d.lk || {}) },
      x, y, rx: x, ry: y, f: 6, dz: [], line: m => (m.career === s.career || s.career === 'fishing' && m.rod) ? ` ${d.yes}` : ` ${d.hi}`, greetT: 0 };
    STAFF.push(n); STAFF_AT[s.id] = n;
  }
  { const s = G.stations.find(x => x.type === 'guide');   // the town guide by the fountain
    if (s) { const n = { id: 'guide', staff: 1, guide: 1, career: '', c: '', of: '', g: 'f', name: 'พี่ฟ้า (จุดแนะนำเมือง)', short: 'พี่ฟ้า', st: s.id, lk: { hair: 'black', shirt: 'yellow', pants: 'blue' },
      x: s.x, y: s.y - .35, rx: s.x, ry: s.y - .35, f: 6, dz: [], line: () => ` ${GUIDE_HI[Math.floor(performance.now() / 9000) % GUIDE_HI.length]}`, greetT: 0, icon: '💁' };
      STAFF.push(n); STAFF_AT[s.id] = n; } }
  // shopkeepers: stand by their counter; talking to them is the same as using the place
  for (const d of KEEPERS) {
    const s = G.stations.find(x => x.id === d.st); if (!s) continue;
    const x = s.x + d.dx, y = s.y + d.dy;
    const n = { id: 'keep_' + d.st, staff: 1, keeper: 1, career: d.c || '', c: d.c || '', of: d.of || '', name: d.name, short: d.short, st: s.id, g: d.g || 'm', lk: { hair: 'brown', shirt: 'white', pants: 'gray', ...(d.lk || {}) },
      x, y, rx: x, ry: y, f: 6, dz: [], line: () => ` ${n.cur || d.hi[0]}`, greetT: 0, icon: d.icon, his: d.hi, bl: d.bl || '' };
    STAFF.push(n); STAFF_AT[s.id] = n;
  }
}
const KEEPERS = [   // shopkeepers, each matching their painted portrait (NPC_FACE)
  { st: 'balloon', name: 'ลุงโป่ง (ร้านลูกโป่ง)', short: 'ลุงโป่ง', icon: '🎈', dx: 0, dy: 1, of: 'magician', bl: 'bunch', lk: { hair: 'silver', shirt: 'yellow' }, hi: ['ลูกโป่งมาแล้วจ้า! ถือเดินเล่นสวยๆ', 'สีไหนดีหลาน ลุงมีครบ', 'ลูกโป่งหัวใจ เอาไปให้แฟนสิ'] },
  { st: 'fortune', name: 'แม่หมอจันทรา (แม่หมอพยากรณ์)', short: 'แม่หมอจันทรา', icon: '🔮', g: 'f', of: 'fortune', dx: -1.6, dy: .3, lk: { hair: 'brown' }, hi: ['มาสิลูก ให้ไพ่บอกทางให้', 'การเงิน การงาน หรือความรัก อยากรู้เรื่องไหน', 'ใจเย็นๆ แล้วตั้งคำถามในใจนะ'] },
  { st: 'petshop1', name: 'น้องมะลิ (ร้านสัตว์เลี้ยง)', short: 'น้องมะลิ', icon: '🐾', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'brown', shirt: 'red' }, hi: ['ยินดีต้อนรับค่ะ! อยากได้เพื่อนตัวฟูไหมคะ', 'ทุกตัวสุขภาพดีค่ะ ลูบได้นะคะ', 'ตัวไหนถูกใจ ลองแตะดูได้เลยค่ะ'] },
  { st: 'petshop2', name: 'พี่ภูผา (ร้านสัตว์เลี้ยง สาขา 2)', short: 'พี่ภูผา', icon: '🐶', dx: .7, dy: -1.15, of: 'hoodie', lk: { hair: 'black' }, hi: ['เข้ามาดูน้องๆ ได้เลยครับ', 'หมา แมว กระต่าย มีครบครับ', 'เลี้ยงแล้วพาเดินเล่นทุกวันนะครับ'] },
  { st: 'restaurant', name: 'ป้าแดง (เจ้าของร้านอาหาร)', short: 'ป้าแดง', icon: '🍛', g: 'f', dx: .6, dy: -1.15, lk: { hair: 'black', shirt: 'white', pants: 'brown' }, hi: ['หิวไหมจ๊ะ วันนี้มีเมนูเด็ดนะ', 'นั่งก่อนจ้ะ เดี๋ยวน้องเสิร์ฟให้', 'กินให้อิ่มนะลูก'] },
  { st: 'barber', name: 'ช่างโอ๋ (ช่างทำผม)', short: 'ช่างโอ๋', icon: '💈', dx: .6, dy: -1.15, lk: { hair: 'silver', shirt: 'black', pants: 'black' }, hi: ['อยากเปลี่ยนลุคไหมครับ', 'ทรงนี้ต้องลองสีบลอนด์นะ', 'ตัดผมใหม่ ชีวิตใหม่ครับ'] },
  { st: 'plantshop', name: 'ป้าสายใจ (ร้านต้นไม้)', short: 'ป้าสายใจ', icon: '🌳', g: 'f', dx: .6, dy: -1.15, lk: { hair: 'brown', shirt: 'green' }, hi: ['ต้นไม้ที่นี่ป้าดูแลเองทุกต้นเลยจ้ะ', 'อยากได้ร่มเงาหรือดอกไม้ บอกป้าได้นะ', 'ปลูกต้นไม้ในบ้านแล้วอากาศดี ใจก็สบาย 🌿']},
  { st: 'furnshop', name: 'น้องเก่ง (ร้านเฟอร์นิเจอร์)', short: 'น้องเก่ง', icon: '🛋️', dx: .6, dy: -1.15, of: 'hoodie', lk: { hair: 'black' }, hi: ['โซฟาตัวนี้นั่งสบายมากครับ', 'จัดบ้านสวย อยู่แล้วมีความสุขนะ', 'ซื้อแล้วส่งถึงบ้านเลยครับ'] },
  { st: 'police', name: 'ดาบหญิงสมศรี (เวรประจำโต๊ะ)', short: 'ดาบสมศรี', icon: '👮', g: 'f', dx: .4, dy: -1.15, of: 'police', lk: { hair: 'brown' }, hi: ['มีอะไรให้ช่วยคะ', 'อยากเป็นตำรวจ คุยกับผู้กองเอกนะคะ'] },
  { st: 'school', name: 'ผอ.ประเสริฐ (ผู้อำนวยการ)', short: 'ผอ.ประเสริฐ', icon: '🎓', dx: .5, dy: -1.1, of: 'office', lk: { hair: 'silver' }, hi: ['ตั้งใจเรียนนะ อนาคตอยู่ในมือเธอ', 'นั่งโต๊ะเรียนครบชั่วโมงได้ 1 คาบ', 'ยินดีต้อนรับสู่มหาวิทยาลัย'] },
  { st: 'cstore', name: 'น้องฝน (พนักงานร้าน)', short: 'น้องฝน', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'brown', shirt: 'white' }, hi: ['สวัสดีค่ะ ยินดีต้อนรับค่ะ', 'รับขนมจีบซาลาเปาเพิ่มไหมคะ', 'สะสมแต้มไหมคะ'] },
  { st: 'cstore2', name: 'น้องภูมิ (พนักงานร้าน · นักศึกษา)', short: 'น้องภูมิ', icon: '🏪', dx: .7, dy: -1.15, of: 'hoodie', lk: { hair: 'brown' }, hi: ['สวัสดีครับ ยินดีต้อนรับครับ', 'รับถุงไหมครับ', 'ทำงานพิเศษหลังเลิกเรียนครับ'] },
  { st: 'cstore3', name: 'น้องแพร (พนักงานร้าน)', short: 'น้องแพร', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'black', shirt: 'blue' }, hi: ['สวัสดีค่ะ เปิด 24 ชั่วโมงค่ะ', 'ข้าวกล่องอุ่นให้ไหมคะ', 'ลอตเตอรี่งวดนี้มาแล้วค่ะ'] },
  { st: 'cstore4', name: 'ยายบุญ (เจ้าของร้าน สาขาหมู่บ้าน)', short: 'ยายบุญ', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'silver', shirt: 'yellow', pants: 'brown' }, hi: ['มาแล้วเหรอหลาน', 'กินข้าวหรือยังจ๊ะ', 'น้ำเย็นๆ อยู่ในตู้นะลูก'] },
  { st: 'market', name: 'เจ๊ศรี (ผู้ดูแลตลาดกลาง)', short: 'เจ๊ศรี', icon: '🏪', g: 'f', dx: 2.6, dy: .35, lk: { hair: 'brown', shirt: 'green' }, hi: ['ซื้อขายที่นี่ ราคายุติธรรม', 'วางขายของได้นะ คนซื้อเยอะ', 'ของสดๆ ทั้งนั้นจ้า'] },
  { st: 'estate', name: 'คุณจิ๋ม (นายหน้าอสังหาฯ)', short: 'คุณจิ๋ม', icon: '🏡', g: 'f', dx: 1.4, dy: 0, lk: { hair: 'brown', shirt: 'pink' }, hi: ['อยากมีบ้านเป็นของตัวเองไหมคะ ทุกคนซื้อได้เลยค่ะ', 'บ้านเล็ก บ้านกลาง บ้านใหญ่ เลือกแบบได้ 6 แบบค่ะ', 'จะไปบ้านตัวเองหรือไปเยี่ยมบ้านเพื่อน บอกพี่ได้นะคะ'] },
  { st: 'toolshop', name: 'ช่างเปี๊ยก (ร้านอุปกรณ์)', short: 'ช่างเปี๊ยก', icon: '🛠️', dx: .5, dy: -1.1, lk: { hair: 'brown', shirt: 'black' }, hi: ['เครื่องมือดี งานก็ออกมาดี', 'อัปเกรดอุปกรณ์อาชีพได้ที่นี่', 'ของแท้ทุกชิ้นรับประกัน'] },
  { st: 'office', name: 'คุณแพรว (ประชาสัมพันธ์บริษัท)', short: 'คุณแพรว', icon: '🏢', g: 'f', dx: .6, dy: -1.15, of: 'office', lk: { hair: 'black' }, hi: ['สวัสดีค่ะ ไทยเทคยินดีต้อนรับค่ะ', 'สมัครงานติดต่อคุณนภาฝ่ายบุคคลได้เลยค่ะ', 'พนักงานเข้างาน 8 โมงนะคะ'] },
  { st: 'fashion', name: 'น้องมุก (ร้านแฟชั่น)', short: 'น้องมุก', icon: '👗', g: 'f', dx: .6, dy: -1.15, lk: { hair: 'brown', shirt: 'pink' }, hi: ['ชุดใหม่มาแล้วค่ะ ลองดูได้นะคะ', 'ชุดนี้ใส่แล้วดูดีมากเลยค่ะ', 'ยินดีต้อนรับค่ะ'] },
  { st: 'rider', name: 'พี่แบงค์ (เคาน์เตอร์ศูนย์ไรเดอร์)', short: 'พี่แบงค์', icon: '🛵', dx: .6, dy: -1.15, lk: { hair: 'black', shirt: 'green' }, hi: ['ออเดอร์เข้าเยอะเลยวันนี้', 'อยากเป็นไรเดอร์ คุยกับพี่ต่อได้เลยครับ', 'ขับขี่ปลอดภัยนะครับ'] },
  { st: 'dealer', name: 'คุณโอม (พนักงานขายรถ)', short: 'คุณโอม', icon: '🚗', dx: .6, dy: -1.15, of: 'office', lk: { hair: 'brown' }, hi: ['สนใจรุ่นไหนครับ ทดลองดูได้เลย', 'รุ่นนี้ประหยัดน้ำมันมากครับ', 'ซื้อวันนี้ขับออกได้ทันทีครับ'] },
  { st: 'bank', name: 'คุณนิด (พนักงานธนาคาร)', short: 'คุณนิด', icon: '🏦', g: 'f', dx: -2.4, dy: -0.4, of: 'office', lk: { hair: 'brown' }, hi: ['ฝากเงินไว้ได้ดอกเบี้ยนะคะ', 'ยินดีต้อนรับสู่ธนาคารค่ะ', 'กู้เงินได้ แต่อย่าลืมคืนนะคะ'] },
];
function staffGreet(n) {
  const t = performance.now(); if (t - n.greetT < 20000) return;
  n.greetT = t; if (n.his) n.cur = n.his[Math.floor(Math.random() * n.his.length)]; n.bubble = n.line(me).trim(); n.bt = t + 5000;
}
// two quick buttons over the nearest other player's head (within reach): view their profile / add them as a friend
let nbFor = null, nbSig = '';
function nearBtns(t) {
  const el = $('#nearBtns'), m = myId != null && P.get(myId);
  let best = null, bd = 2.6;
  if (m && !panel && !me?.down) for (const p of P.values()) {
    if (p.id === myId || p.npc || p.bot || p.tagT !== t) continue;      // only players drawn on screen this frame
    const d = Math.hypot(p.x - m.x, p.y - m.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); nbFor = null; return; }
  const friend = (me.friends || []).some(f => f.n === best.name) || (me.contacts || []).some(c => c.n === best.name);
  const sig = best.id + '|' + friend;
  if (sig !== nbSig) {
    nbSig = sig;
    el.innerHTML = friend ? '<button data-nb="info">👤 ข้อมูล</button>' : `<button data-nb="info">👤 ข้อมูล</button><button data-nb="add" class="${friend ? 'done' : 'add'}" ${friend ? 'disabled' : ''}>${friend ? '✓ เพื่อนกันแล้ว' : '➕ เพิ่มเพื่อน'}</button>`;
  }
  nbFor = best.id;
  el.style.fontSize = Math.round(TS * .27) + 'px';   // same text size as the name tag
  el.style.transform = `translate(${Math.round(best.tagX)}px,${Math.round(best.tagY)}px) translate(-50%,-100%)`;
  el.classList.remove('hidden');
}
function initNearBtns() {
  const el = $('#nearBtns');
  const stop = e => e.stopPropagation();
  ['pointerdown', 'touchstart', 'mousedown'].forEach(k => el.addEventListener(k, stop, { passive: true }));
  el.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b || nbFor == null) return;
    const o = P.get(nbFor); if (!o) return;
    FX.play('click');
    if (b.dataset.nb === 'info') openPanel({ kind: 'player', pid: o.id });
    else if (b.dataset.nb === 'add' && !b.disabled) { send({ t: 'req', kind: 'phone', to: o.id }); b.disabled = true; b.textContent = '⏳ ส่งคำขอแล้ว'; }
  });
}
initNearBtns();
$('#keyHint').onclick = () => { FX.play('click'); openPanel({ kind: 'keys' }); };
let NAME_MODE = 'all'; try { NAME_MODE = localStorage.getItem('lt_names') || 'all'; } catch { }
const NAME_TXT = { all: '🏷️ ป้ายเหนือหัว: แสดงทั้งหมด', name: '🏷️ ป้ายเหนือหัว: แค่ชื่อ', none: '🏷️ ป้ายเหนือหัว: ซ่อนหมด' };
function nameAndBubble(p, px, top, mine, t = performance.now()) {
  if (p.crowd) return;   // passers-by in the park and the temple: no name tags
  if (!p.npc && !mine) { p.tagX = px; p.tagY = top - TS * ((p.title ? .8 : .46) + (p.gg ? .16 : 0)); p.tagT = t; }
  if (NAME_MODE === 'none' && !p.red) return chatOnly(p, px, top - TS * .22, t);   // player setting: characters only (chat still shows)
  if (NAME_MODE === 'name' && (p.gg || p.title)) p = { ...p, gg: null, title: '' };
  const icon = p.red ? '🦹' : p.umb ? '☂️' : p.keeper ? p.icon : p.c === 'waiter' ? '🍽️' : p.staff || p.wk ? CAREER_ICON(p.c) || '💬' : p.npc ? '🏘️' : CAREER_ICON(p.c);
  const admTag = p.adm && !p.ap;   // an admin can switch the coloured name tag off (God panel)
  const label = `${admTag ? '👑 ' : ''}${icon} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`;
  if (admTag) premiumName(label, px, top - TS * .22, t);
  else sign(label, px, top - TS * .22, { size: TS * .27, bg: p.red ? 'rgba(210,24,24,.95)' : mine ? 'rgba(255,214,110,.96)' : p.npc ? 'rgba(80,70,50,.62)' : 'rgba(58,36,20,.82)', color: mine ? '#222' : '#fff' });
  if (p.afk) sign('💤 ไม่อยู่', px, top + TS * .12, { size: TS * .2, bg: 'rgba(60,60,80,.85)' });
  // stack the labels from their real pixel sizes so they never overlap: name → gang tag → title, 3px apart
  const nY = top - TS * .22, nFs = Math.max(10, Math.round(TS * (admTag ? .29 : .27))), GAP = 3;
  let yTop = nY - nFs * (admTag ? .8 : .775);
  const GT = p.gg && !p.npc;
  if (GT) { const gFs = Math.max(10, Math.round(TS * .22)), gh = gFs * 1.3, gy = yTop - GAP - gh / 2, lt = /e8c83a|e8913a/.test(p.gg[2]); sign(`${p.gg[0]} ${p.gg[1]}`, px, gy, { size: gFs, h: gh, bg: p.gg[2], color: lt ? '#2a1a05' : '#fff' }); yTop = gy - gh / 2; }
  const tFs = Math.max(10, Math.round(TS * .22)), ty = yTop - GAP - tFs * .6;
  if (p.title) yTop = ty - tFs * .6;
  if (p.title) {
    ctx.font = `800 ${tFs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, ty);
    // title colour = rarity; legendary titles (and the mayor's) shimmer
    if (p.tr === 8 && !p.adm) {   // 💖 supporter title: pink-gold-cyan shimmer that sweeps across, with twinkling stars around it
      const w = textW(`«${p.title}»`), g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), sh = (t / 900) % 1.4 - .2;
      g.addColorStop(0, '#ff7ad9'); g.addColorStop(.35, '#ffd86b'); g.addColorStop(.7, '#7fe8ff'); g.addColorStop(1, '#c58bff');
      ctx.fillStyle = g; ctx.fillText(`«${p.title}»`, px, ty);
      const g2 = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), c = 'rgba(255,255,255,0)';
      g2.addColorStop(0, c); g2.addColorStop(Math.max(0, Math.min(1, sh - .08)), c); g2.addColorStop(Math.max(0, Math.min(1, sh)), 'rgba(255,255,255,.95)'); g2.addColorStop(Math.max(0, Math.min(1, sh + .08)), c); g2.addColorStop(1, c);
      ctx.fillStyle = g2;
      for (let k = 0; k < 5; k++) {   // little four-point stars blinking on and off around the title
        const ph = (t / 700 + k * .37) % 1, a = Math.sin(ph * Math.PI), sx = px + (((k * 53) % 100) / 100 - .5) * (w + 14), sy = ty + ((k % 2) ? -1 : 1) * tFs * .55, r = 1.5 + a * 3;
        ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = k % 2 ? '#fff6b0' : '#ffd6f6'; ctx.beginPath();
        ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * .3, sy - r * .3); ctx.lineTo(sx + r, sy); ctx.lineTo(sx + r * .3, sy + r * .3); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r * .3, sy + r * .3); ctx.lineTo(sx - r, sy); ctx.lineTo(sx - r * .3, sy - r * .3); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = g2;
    }
    else if (p.tr === 7 && !p.adm) { const w = textW(`«${p.title}»`), g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), h0 = (t / 12) % 360; for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${(h0 + k * 60) % 360},95%,66%)`); ctx.fillStyle = g; }
    else if (p.adm || p.tr >= 5) { const c0 = p.adm ? '#ffd34d' : RAR_COL[5], w = textW(`«${p.title}»`), g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), sh = (t / 1400) % 1; g.addColorStop(0, c0); g.addColorStop(Math.max(0, sh - .15), c0); g.addColorStop(sh, '#fffbe6'); g.addColorStop(Math.min(1, sh + .15), c0); g.addColorStop(1, p.adm ? '#ffb52e' : '#ff8a1e'); ctx.fillStyle = g; }
    else ctx.fillStyle = RAR_COL[p.tr] || '#ffd34d';
    ctx.fillText(`«${p.title}»`, px, ty);
  }
  if (ZWIN.ids.has(p.id) && t < ZWIN.until && !p.npc) {   // zombie-night survivors wear a gold tag for a while
    const zFs = Math.max(10, Math.round(TS * .22)), zh = zFs * 1.3, zy = yTop - GAP - zh / 2 + Math.sin(t / 260) * 1.5;
    sign('🏆 ผู้รอดชีวิต', px, zy, { size: zFs, h: zh, bg: 'rgba(255,196,40,.95)', color: '#3a2400' }); yTop = zy - zh / 2;
  }
  if (p.emo && performance.now() < p.emoT) {
    const k = 1 - (p.emoT - performance.now()) / 4200, by = yTop - TS * .42 - Math.sin(Math.min(1, k * 4) * Math.PI / 2) * TS * .25;
    ctx.font = `${Math.round(TS * .75)}px serif`; ctx.fillText(p.emo, px, by - (p.bubble && performance.now() < p.bt ? TS * .6 : 0) + Math.sin(t / 160) * 2);
  }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
    const w = textW(txt) + 16, bh = TS * .5, by = yTop - GAP - 7 - bh / 2;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - bh / 2, w, bh, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 6, by + bh / 2 - 1); ctx.lineTo(px + 6, by + bh / 2 - 1); ctx.lineTo(px, by + bh / 2 + 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by + 1);
  }
}
// names hidden: only the emote and the chat bubble float over the head
function chatOnly(p, px, yTop, t) {
  if (p.emo && performance.now() < p.emoT) { ctx.font = `${Math.round(TS * .75)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.emo, px, yTop - TS * .3 - (p.bubble && performance.now() < p.bt ? TS * .6 : 0) + Math.sin(t / 160) * 2); }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = textW(txt) + 16, bh = TS * .5, by = yTop - bh / 2;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - bh / 2, w, bh, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 6, by + bh / 2 - 1); ctx.lineTo(px + 6, by + bh / 2 - 1); ctx.lineTo(px, by + bh / 2 + 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by + 1);
  }
}
// the admin's name tag: a rainbow that keeps flowing, with a soft glow
function premiumName(text, x, y, t) {
  const fs = Math.max(10, Math.round(TS * .29));
  ctx.font = `800 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = textW(text) + fs * 1.1, h = fs * 1.6;
  ctx.save();
  ctx.shadowColor = `hsla(${(t / 8) % 360},100%,60%,.9)`; ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(20,14,30,.92)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(t / 6 + i * 60) % 360},95%,65%)`);
  ctx.lineWidth = 2; ctx.strokeStyle = g; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.stroke();
  ctx.fillStyle = g; ctx.fillText(text, x, y + fs * .04);
}
function drawPlayerPixel(p, X, Y, t) {
  const px0 = (p.rx + (p.ox || 0)) * TS + X; let py0 = (p.ry + (p.oy || 0)) * TS + Y + TS * .32;
  if (px0 < -80 || py0 < -120 || px0 > VW + 80 || py0 > VH + 120) return;
  const u = TS / 16, id = p.id || 1, skin = SKIN[id % 4], hair = HAIR[(id * 3 + p.av) % HAIR.length];
  const shirt = COLORS[p.av] || '#999', pants = shade(shirt, -.55), dark = '#1d1a22';
  const pose = p.pose, lying = pose === 'bed' || pose === 'hosp' || pose === 'veg', sitting = pose === 'seat' || pose === 'chair' || pose === 'rest' || pose === 'beg' || pose === 'jail' || pose === 'study';
  const ang = (p.f / 8) * Math.PI * 2 - Math.PI, cx = Math.cos(ang), cy = Math.sin(ang);
  let dir = Math.abs(cy) > Math.abs(cx) ? (cy > 0 ? 'down' : 'up') : (cx > 0 ? 'right' : 'left');
  if (sitting || lying) dir = 'down';
  const moving = !sitting && !lying && (p.id === myId ? meMoving : Math.hypot(p.x - p.rx, p.y - p.ry) > .02);
  p.walk = (p.walk || 0) + (moving ? .25 * FDT * 60 : 0);
  const sw = moving ? Math.sin(p.walk) : 0, bob = moving ? Math.abs(Math.cos(p.walk)) * u * .8 : 0;
  let px = px0, py = py0;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(px, py, u * (lying ? 8 : 5.5), u * 2, 0, 0, 7); ctx.fill();
  if (p.veh && G.shop && !roomOf(p.x, p.y) && !sitting && !lying) {
    if (p.veh === 'car') { spr('car_blue', p.rx, p.ry + .55, X, Y, 1.05); py -= u * 4; }
    else { ctx.save(); ctx.translate(px, py - u * 2); if (dir === 'right') ctx.scale(-1, 1); ctx.font = `${Math.round(TS * .9)}px serif`; ctx.fillText(G.shop.vehicles[p.veh].icon, 0, 0); ctx.restore(); py -= u * 3; }
  }
  ctx.save();
  if (lying) { ctx.translate(px, py - u * 3); ctx.rotate(-Math.PI / 2); px = 0; py = u * 11; }
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(px + (x - 6) * u), Math.round(py + (y - 22) * u - bob), Math.ceil(w * u), Math.ceil(h * u)); };
  const L = sw * 2, Rr = -sw * 2;
  if (sitting) py += u * 4;
  R(1.4, 0.4, 9.2, 8, dark); R(1.4, 7.6, 9.2, 8, dark); R(0.4, 8.6, 11.2, 6, dark);
  if (!sitting) {
    R(2.4, 14.6, 3.2, 6.8 + Math.min(0, L) * .5, dark); R(6.4, 14.6, 3.2, 6.8 + Math.min(0, Rr) * .5, dark);
    R(3, 15, 2, 5 - Math.max(0, -L) * .4, pants); R(7, 15, 2, 5 - Math.max(0, -Rr) * .4, pants);
    R(2.8, 20 - Math.max(0, -L) * .4, 2.4, 1.2, '#3a2a20'); R(6.8, 20 - Math.max(0, -Rr) * .4, 2.4, 1.2, '#3a2a20');
  } else { R(2.4, 14.6, 7.2, 2.6, dark); R(3, 15, 6, 1.6, pants); }
  R(2, 8, 8, 7, shirt); R(2, 8, 8, 1, shade(shirt, .25));
  const armY = 9 + (dir === 'left' || dir === 'right' ? sw : -sw) * .8;
  if (dir !== 'left') R(1, armY, 1.4, 5, shade(shirt, -.15)); if (dir !== 'right') R(9.6, 9 - (armY - 9), 1.4, 5, shade(shirt, -.15));
  if (dir !== 'left') R(1, armY + 5, 1.4, 1.2, skin); if (dir !== 'right') R(9.6, 14 - (armY - 9), 1.4, 1.2, skin);
  R(2, 1, 8, 7, skin);
  if (dir === 'up') R(2, 1, 8, 6.2, hair);
  else {
    R(2, 1, 8, 2.4, hair); R(2, 1, 1.2, 5, hair); R(8.8, 1, 1.2, 5, hair);
    const eyesShut = pose === 'rest' || lying;
    if (dir === 'down') { if (eyesShut) { R(3.6, 5, 1.6, .5, dark); R(6.8, 5, 1.6, .5, dark); } else { R(3.8, 4.4, 1.2, 1.6, dark); R(7, 4.4, 1.2, 1.6, dark); } R(5.2, 6.4, 1.6, .6, '#c0605a'); }
    if (dir === 'left') { R(2, 1, 4, 3, hair); R(3.2, 4.4, 1.2, 1.6, dark); }
    if (dir === 'right') { R(6, 1, 4, 3, hair); R(7.6, 4.4, 1.2, 1.6, dark); }
  }
  ctx.restore();
  px = px0; if (sitting) py += u * 4;
  const mine = p.id === myId, top = (lying ? py0 - 10 * u : py - 23 * u - bob);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (pose === 'beg') { ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText('🥣', px, py0 + TS * .05); }
  const badge = pose === 'veg' ? '🥬' : pose === 'hosp' ? '🚑' : pose === 'jail' ? '⛓️' : pose === 'rest' || pose === 'bed' ? '💤' : p.sad ? '😞' : '';
  if (badge) { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(badge, px + 7 * u, top + Math.sin(t / 300) * 3); }
  sign(`${CAREER_ICON(p.c)} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,201,77,.95)' : 'rgba(18,22,28,.78)', color: mine ? '#222' : '#fff' });
  if (p.title) { ctx.font = `800 ${Math.round(TS * .22)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, top - TS * .58); ctx.fillStyle = RAR_COL[p.tr] || '#ffd34d'; ctx.fillText(`«${p.title}»`, px, top - TS * .58); }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
    const w = textW(txt) + 16, by = top - TS * (p.title ? 1.12 : .86), bh = TS * .5;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - bh / 2, w, bh, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 6, by + bh / 2 - 1); ctx.lineTo(px + 6, by + bh / 2 - 1); ctx.lineTo(px, by + bh / 2 + 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by + 1);
  }
}
// minimap: the map you are on (inside a building: the map outside it)
const miniBase = {};
const MINI_COLORS = { '=': '#555a63', ',': '#b7b4a6', c: '#a89c86', w: '#4aa3d1', p: '#a47b50', s: '#e3d19a', f: '#7b5538', B: '#c0643a', T: '#2f6b3a', '.': '#5e9b57', o: '#5e9b57', m: '#7fb04e', k: '#c98a5a', ' ': '#07090c' };
function buildMini() {
  for (const a of G.areas.filter(a => a.kind === 'map')) {
    const c = document.createElement('canvas'); c.width = a.w * 2; c.height = a.h * 2; const g = c.getContext('2d');
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { const ch = G.map.tiles[a.y + y][a.x + x]; g.fillStyle = SNOW && '.om'.includes(ch) ? '#dfe7f0' : SNOW && ch === 'T' ? '#7fa58a' : MINI_COLORS[ch] || '#5e9b57'; g.fillRect(x * 2, y * 2, 2, 2); }
    drawZonesOnMap(g, a, 2, false);
    // buildings as clean blocks in the same colours as the big map (shops/services, scenery, homes)
    for (const b of G.map.buildings) {
      if (b.x < a.x || b.x >= a.x + a.w || b.y < a.y || b.y >= a.y + a.h) continue;
      g.fillStyle = b.renov ? '#d9a21f' : b.deco ? '#b9a48f' : b.house !== undefined ? '#d98f6a' : '#4d5b7a';   // amber = closed for renovation
      g.fillRect((b.x - a.x) * 2, (b.y - a.y) * 2, b.w * 2, b.h * 2);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect((b.x - a.x) * 2, (b.y - a.y + b.h) * 2 - 1, b.w * 2, 1);
    }
    miniBase[a.id] = c;
  }
}
// the football pitch and the amusement park's rides painted onto a map canvas (minimap: k = 2 px per tile; big map: k = its scale)
function drawZonesOnMap(g, A, k, icons) {
  if (A.id !== 'town') return;
  const L = (x, y) => [(x - A.x) * k, (y - A.y) * k];
  const P0 = G.football?.pitch;
  if (P0) {
    const [px, py] = L(P0.x, P0.y), w = P0.w * k, h = P0.h * k;
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#5aa04f' : '#66ad5a'; g.fillRect(px + w * i / 6, py, w / 6 + .5, h); }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = Math.max(1, k * .18); g.strokeRect(px, py, w, h);
    g.beginPath(); g.moveTo(px + w / 2, py); g.lineTo(px + w / 2, py + h); g.stroke();
    g.beginPath(); g.arc(px + w / 2, py + h / 2, Math.min(w, h) * .16, 0, 7); g.stroke();
    const gh = G.football.goalH * k; g.fillStyle = '#ffffff'; g.fillRect(px - k * .6, py + (h - gh) / 2, k * .6, gh); g.fillRect(px + w, py + (h - gh) / 2, k * .6, gh);
    for (const d of G.football.deco) if (d[0] === 'stands' || d[0] === 'dugout' || d[0] === 'score' || d[0] === 'kiosk') {
      const sw = d[0] === 'stands' ? 6 : d[0] === 'dugout' ? 4 : d[0] === 'score' ? 3 : 2, sh = d[0] === 'stands' ? 3 : 1.6, [x, y] = L(d[1] - sw / 2, d[2] - sh);
      g.fillStyle = d[0] === 'stands' ? '#5f8fb0' : d[0] === 'score' ? '#34383f' : '#b07a4a'; g.fillRect(x, y, sw * k, sh * k);
    }
    if (icons) { g.font = `${Math.max(10, k * 2.2)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⚽', px + w / 2, py + h / 2); }
  }
  const RC = { carousel: '#f29ac1', ferris: '#f7c25c', coaster: '#e0675a', pool: '#5fc2ea', bumper: '#9b86e0', shooting: '#f2a35c' };
  for (const st of G.stations) if (st.type === 'ride' && st.w) {
    const [x, y] = L(st.cx - st.w / 2, st.cy - st.h / 2);
    g.fillStyle = RC[st.k] || '#f29ac1'; g.beginPath(); g.roundRect ? g.roundRect(x, y, st.w * k, st.h * k, Math.min(6, k)) : g.rect(x, y, st.w * k, st.h * k); g.fill();
    if (icons) { g.font = `${Math.max(10, k * 1.6)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(st.icon, x + st.w * k / 2, y + st.h * k / 2); }
  }
  if (G.parkArch) { const [x, y] = L(G.parkArch.x - 2, G.parkArch.y - .8); g.fillStyle = '#e88ab4'; g.fillRect(x, y, 4 * k, .8 * k); }
}
const outPos = (x, y) => { const r = roomOf(x, y); return r ? r.outside : { x, y }; };
function drawMini() {
  const m = P.get(myId); if (!m) return;
  const mapId = mapOf(areaOf(m.x, m.y)?.id), A = AREA[mapId], base = miniBase[mapId]; if (!base) return;
  // a window that follows you (the town grew too big to show whole): 70 x 52 tiles around you, clamped to the map
  const MW = 140, MH = 104, mini = $('#mini'); if (mini.width !== MW || mini.height !== MH) { mini.width = MW; mini.height = MH; }
  const g = mini.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#1b2a1e'; g.fillRect(0, 0, MW, MH);
  { const q = outPos(m.rx, m.ry), fit = (c, size, view) => size <= view ? (size - view) / 2 : clamp(c - view / 2, 0, size - view);
    const ox = Math.round(fit((q.x - A.x) * 2, base.width, MW)), oy = Math.round(fit((q.y - A.y) * 2, base.height, MH)); g.setTransform(1, 0, 0, 1, -ox, -oy); }
  g.drawImage(base, 0, 0);
  const tNow = performance.now();
  const wwOnMap = WW.ph === 'on', sniff = wwSniffing(), wolfMe = wwIsWolf();
  for (const p of P.values()) {
    if (wwOnMap) {   // 🌕 werewolf night: humans see nobody; wolves see their pack (purple), and humans (red) while sniffing
      if (p.id === myId || mapId !== 'town') continue;
      const isW = p.wwm || WW.wolves?.includes(p.id), isH = WW.humans?.includes(p.id);
      if (!(wolfMe && (isW || sniff && isH))) continue;
      const mx = (p.rx - A.x) * 2, my = (p.ry - A.y) * 2, s = isH ? 7 : 5;
      g.fillStyle = '#fff'; g.fillRect(mx - s / 2 - 1, my - s / 2 - 1, s + 2, s + 2); g.fillStyle = isH ? ((performance.now() / 250 | 0) % 2 ? '#ff1a1a' : '#ff7070') : '#b44dff'; g.fillRect(mx - s / 2, my - s / 2, s, s);
      continue;
    }
    if (p.zb && areaOf(p.rx, p.ry)?.id === A?.id || p.zb && mapId === areaOf(p.rx, p.ry)?.id) { g.fillStyle = '#ff2b2b'; g.fillRect((p.rx - A.x) * 2 - 2, (p.ry - A.y) * 2 - 2, 4, 4); continue; }
    if (p.npc || p.id === myId) continue;
    const q = outPos(p.rx, p.ry); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    const s = 5, mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2;
    if (Math.hypot(q.x - (p._mmx ?? q.x), q.y - (p._mmy ?? q.y)) > .004) p._mmt = tNow; p._mmx = q.x; p._mmy = q.y;
    if (tNow - (p._mmt || 0) < 600) { const k = ((tNow + Math.abs(p.id) * 137) % 900) / 900; g.strokeStyle = `rgba(255,255,255,${.85 * (1 - k)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(mx, my, 3 + k * 7, 0, 7); g.stroke(); }   // walking right now: a ripple
    g.fillStyle = '#fff'; g.fillRect(mx - s / 2 - 1, my - s / 2 - 1, s + 2, s + 2);
    g.fillStyle = p.adm ? `hsl(${(performance.now() / 8) % 360},90%,55%)` : COLORS[Math.abs(p.id * 7 + (p.av || 0)) % COLORS.length]; g.fillRect(mx - s / 2, my - s / 2, s, s);
  }
  misMini(g, A, mapId);
  if (me?.alms && mapId === 'town') { const b = (performance.now() / 350 | 0) % 2; me.alms.pts.forEach((q, i) => { if (me.alms.got[i]) return; const x = (q[0] - A.x) * 2, y = (q[1] - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.fillStyle = b ? '#ffb300' : '#ffd84d'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); });
  }
  if (mapId === 'town') { const x = (74 - A.x) * 2, y = (67 - A.y) * 2, big = me?.alms?.got.every(Boolean); g.font = `${big ? 20 : 14}px serif`; g.textAlign = 'center'; g.fillText('🛕', x, y + 5); }
  if (me?.dogq?.kind === 'thief' && mapId === 'town') { const b = (performance.now() / 300 | 0) % 2, x0 = (me.dogq.x - A.x) * 2, y0 = (me.dogq.y - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(x0, y0, 8, 0, 7); g.fill(); g.fillStyle = b ? '#ff2a2a' : '#a80000'; g.beginPath(); g.arc(x0, y0, 6, 0, 7); g.fill(); }
  if (me?.dogq?.hc && mapId === 'town') { const [hx, hy, hr] = me.dogq.hc; g.strokeStyle = (performance.now() / 400 | 0) % 2 ? '#ffd23a' : '#ff9f1a'; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.arc((hx - A.x) * 2, (hy - A.y) * 2, hr * 2, 0, 7); g.stroke(); g.setLineDash([]); g.font = '16px serif'; g.textAlign = 'center'; g.fillText('🐕', (hx - A.x) * 2, (hy - A.y) * 2 + 6); }
  { const q = PETST.get(myId); if (q && mapOf(areaOf(q.x, q.y)?.id) === mapId) { const mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 4.5, 0, 7); g.fill(); g.fillStyle = '#ff7eb0'; g.beginPath(); g.arc(mx, my, 3, 0, 7); g.fill(); } }   // your pet: a pink dot
  { // you: drawn last, bigger, with a pulsing ring so you can always find yourself
    const q = outPos(m.rx, m.ry), mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2, k = (performance.now() % 1200) / 1200;
    g.strokeStyle = `rgba(255,230,60,${1 - k})`; g.lineWidth = 4; g.beginPath(); g.arc(mx, my, 9 + k * 16, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 9, 0, 7); g.fill();
    g.fillStyle = '#ff2a10'; g.beginPath(); g.arc(mx, my, 6.5, 0, 7); g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  $('#miniName').textContent = `🗺️ ${A.yard && wd?.houses?.[A.house]?.[0] ? 'บ้าน' + wd.houses[A.house][0] : A.name}`;
}

// ------------------------------------------------------------------ panels
let panelOpenT = 0;
function openPanel(p) {
  if (p.kind === 'chat') p.sig = 'x';
  if (p.kind === 'player') { const o = P.get(p.pid); if (o && !o.npc) send({ t: 'info', id: p.pid }); }
  panel = p; panelSig = ''; panelOpenT = performance.now(); $('#panel').classList.remove('hidden'); $('#panel').classList.toggle('phMode', p.kind === 'phone'); $('#panel').classList.toggle('soc', !!p.soc); refreshPanel(true);
  if (p.kind === 'chat' && !TOUCH_UI) setTimeout(() => $('#chatIn')?.focus(), 50);   // phones: no keyboard until they tap the box (it would push the sheet up)
}
function closePanel() { panel = null; $('#panel').classList.add('hidden'); }
// phones: when the keyboard closes the browser can leave the whole page pushed up; put it back
addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) { if (scrollY || document.documentElement.scrollTop) scrollTo(0, 0); } }, 80));
// a finger on the panel (tap or scroll): hold redraws until it lifts, so taps are not lost and lists do not jump back
let panelTouchT = 0;
addEventListener('pointerdown', e => { if (e.target.closest?.('#panel')) panelTouchT = Infinity; }, true);
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => { if (panelTouchT === Infinity) panelTouchT = performance.now() + 450; }, true);
const scKey = e => e.id ? '#' + e.id : e.tagName + [...e.classList].map(c => '.' + CSS.escape(c)).join('');
function refreshPanel(force) {
  if (!panel || !me) return;
  if (!force && performance.now() < panelTouchT) return;
  let html = renderPanel(panel);
  if (panel.soc) html = socHead(panel.kind) + html.replace(/<h2>[\s\S]*?<\/h2>/, '');
  const stf = panel.st && STAFF_AT[panel.st];
  if (stf) html = html.replace('</h2>', `</h2><div class="npcSay"><canvas class="npcFace" data-staff="${stf.id}" width="48" height="56"></canvas><div><b>${esc(stf.name)}</b>${esc(stf.line(me))}</div></div>`);
  if (!force && html === panelSig) return;
  const ae = document.activeElement;
  if (!force && ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && $('#panelBody').contains(ae)) { if (panel.kind === 'chat') { const box = $('#chatMsgs'); if (box) box.innerHTML = chatHtml(); } return; }
  panelSig = html;
  const body = $('#panelBody'); const keep = ae && body.contains(ae) && ae.id ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
  const scroll = body.parentElement.scrollTop;
  const keepSc = [...body.querySelectorAll('*')].filter(e => e.scrollTop > 0 || e.scrollLeft > 0).map(e => { const k = scKey(e); return [k, [...body.querySelectorAll(k)].indexOf(e), e.scrollTop, e.scrollLeft]; });
  const drafts = [...body.querySelectorAll('input[id]:not([type=checkbox]):not([type=range]),textarea[id]')].filter(e => e.value).map(e => [e.id, e.value]);   // typed text survives a refresh (mobile keyboard closed = not focused)
  body.innerHTML = html; bindPanel(body); body.parentElement.scrollTop = scroll;
  for (const [id, v] of drafts) { const n = document.getElementById(id); if (n && !n.value && (n.tagName === 'TEXTAREA' || n.type === 'text' || !n.type || n.type === 'search')) n.value = v; }
  for (const [k, i, t, l] of keepSc) { const e = body.querySelectorAll(k)[i]; if (e) { e.scrollTop = t; e.scrollLeft = l; } }
  if (keep) { const n = document.getElementById(keep.id); if (n) { n.value = keep.v; n.focus(); try { n.setSelectionRange(keep.s, keep.s); } catch { } } }
  for (const id of ['chatMsgs', 'callMsgs']) { const cm = document.getElementById(id); if (cm) cm.scrollTop = cm.scrollHeight; }
}
function bindStocks(root) {
  root.querySelectorAll('canvas[data-spark]').forEach(drawSpark);
  root.querySelectorAll('canvas[data-chart]').forEach(c => { drawStockChart(c); const hv = e => { const r = c.getBoundingClientRect(); drawStockChart(c, e.clientX - r.left); }; c.onpointermove = hv; c.onpointerdown = hv; c.onpointerleave = () => drawStockChart(c); });
}
function zoomPic(src) {   // a player's photo, big
  document.querySelector('.howTo')?.remove();
  const d = document.createElement('div'); d.className = 'howTo'; d.innerHTML = `<div class="howCard" style="text-align:center"><img src="${src}" alt="" style="display:block;width:min(78vw,420px);max-height:62vh;object-fit:contain;border-radius:14px;margin:0 auto 10px;background:#e9d4ad"><button type="button" class="primary">ปิด</button></div>`;
  d.onclick = () => d.remove(); document.body.appendChild(d);
}
// LifeBook: the town's blue social app — ideas (and bug reports), friends and jobs in one place
function socHead(k) {
  const t = (l, kk, on) => `<button class="${on ? 'on' : ''}" data-m='{"fn":"social","k":"${kk}"}'>${l}</button>`;
  const sub = k === 'ideas' || k === 'bug' ? `<div class="socSub">${t('💡 ไอเดีย', 'ideas', k === 'ideas')}${t('🐞 แจ้งบัค', 'bug', k === 'bug')}</div>` : '';
  return `<div class="socHead"><b>📘 LifeBook</b><small>โซเชียลของเมืองชีวิต</small></div><div class="socTabs">${t('💡 ไอเดีย', 'ideas', k === 'ideas' || k === 'bug')}${t('👥 เพื่อน', 'friends', k === 'friends')}${t('💼 งาน', 'career', k === 'career')}</div>${sub}`;
}
function bindPanel(root) {
  bindStocks(root); bindWall(root); bindPay(root);
  root.querySelectorAll('img.phZoom').forEach(i => { i.style.cursor = 'zoom-in'; i.onclick = () => zoomPic(i.src); });
  { const ti = root.querySelector('#tipIn'); if (ti) ti.oninput = () => { if (panel) panel.tip = Math.max(0, Math.min(500, Math.floor(+ti.value) || 0)); }; }   // keep the tip through panel redraws
  root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    if (performance.now() - panelOpenT < 450) return;      // the tap that opened this panel must not also press a button in it
    FX.play('click');
    const m = JSON.parse(b.dataset.m);
    if (m.fn) return FN[m.fn](m, root);
    send(m);
  });
  const gs = root.querySelector('#godSpd');
  if (gs) { gs.oninput = () => { $('#godSpdV').textContent = (+gs.value).toFixed(1); }; gs.onchange = () => send({ t: 'god', op: 'speed', v: +gs.value }); }
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (!i.value.trim()) return; const ch = chatTab === 'all' ? 'world' : chatTab; if (!worldOk(ch)) return; send({ t: 'chat', text: i.value, ch }); i.value = ''; };
  const cf = root.querySelector('#callForm'); if (cf) cf.onsubmit = e => { e.preventDefault(); const i = $('#callIn'); if (i.value.trim()) send({ t: 'call_msg', text: i.value }); i.value = ''; };
  root.querySelectorAll('[data-staff]').forEach(c => whenChars(() => {
    const n = STAFF.find(x => x.id === c.dataset.staff) || STAFF.find(x => x.career === c.dataset.staff); if (!n) return;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); drawCharTo(g, n, 24, 98, 100 / CH_ATLAS.h, 'front', 0);
  }));
  root.querySelectorAll('[data-look]').forEach(c => whenChars(() => {
    const [cat, id] = c.dataset.look.split(':'), lk = { ...(me.look || {}), [cat]: id }, g = c.getContext('2d');
    drawCharTo(g, { g: me.gender, lk }, 36, 92, 86 / CH_ATLAS.h, 'front', 0);
  }));
  bindSpr(root);
  root.querySelectorAll('[data-pet]').forEach(c => { const draw = () => { if (!PET_AT || !petImg) return setTimeout(draw, 300); drawPetIcon(c, c.dataset.pet); }; draw(); });
  if (root.querySelector('canvas[data-pp]')) ppStart();
  root.querySelectorAll('[data-show]').forEach(c => drawShow(c));
  root.querySelectorAll('[data-lk]').forEach(c => { const draw = () => { if (!lkImgReady()) { lkLoad(); if (c.isConnected) setTimeout(draw, 300); return; } const s = LKJ.sprites[c.dataset.lk], g = c.getContext('2d'), k = Math.min(c.width / s[2], c.height / s[3]); g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height); g.drawImage(LKIMG, s[0], s[1], s[2], s[3], (c.width - s[2] * k) / 2, (c.height - s[3] * k) / 2, s[2] * k, s[3] * k); }; draw(); });
  root.querySelectorAll('[data-of]').forEach(c => whenChars(function draw() {
    const sh = OUTFIT_SHEET[c.dataset.of], fs = sh && (c.dataset.og || me.gender) === 'f' && CH_ATLAS.rows[`f${sh}:down0`] !== undefined ? 'f' + sh : sh;
    if (fs && !chSrc(fs + ':down0')) { if (c.isConnected) setTimeout(draw, 300); return; }   // its outfit sheet is still loading: draw it once it is there
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); drawCharTo(g, { g: c.dataset.og || me.gender, lk: c.dataset.og ? {} : me.look || {}, of: c.dataset.of }, 36, 92, 86 / CH_ATLAS.h, 'front', 0);
  }));
  const ms = root.querySelector('#mSearch'); if (ms) ms.oninput = () => { panel.q = ms.value; refreshPanel(true); }; const mq = root.querySelector('#mqIn'); if (mq) mq.oninput = () => { panel.mq = mq.value; refreshPanel(true); };
}
// ------------------------------------------------------------------ 🎪 the temple fair: stalls and lights drawn from assets/fair.webp, and the
// three stall games played in a small overlay (the server checks the time it took and pays by score)
let FAJ = null, FAIMG = null, faAsked = false;
function faLoad() { if (faAsked) return; faAsked = true; fetch('assets/fair.json?v=1').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { FAJ = j; FAIMG = im; }; im.src = 'assets/fair.webp?v=1'; }).catch(() => { faAsked = false; }); }
function fairEnts(ents, vis) {
  faLoad(); if (!FAIMG) return;
  for (const d of G.fair.deco) if (vis(d[1], d[2], 6)) ents.push([d[3] ? d[2] + 3 : d[2], 18, { s: d[0], x: d[1], y: d[2], z: d[3] }]);   // light strings hang over everyone
}
function drawFair(e, X, Y, t) {
  const s = FAJ.sprites[e.s]; if (!s) return;
  const w = s[4] * TS, h = w * s[3] / s[2], px = Math.round(e.x * TS + X - w / 2), py = Math.round((e.y - e.z) * TS + Y - h);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(FAIMG, s[0], s[1], s[2], s[3], px, py, Math.round(w), Math.round(h));
  const night = nightLevel();
  if (night > .15 && (e.s === 'f_lights' || e.s === 'f_pole' || e.s.startsWith('s_'))) { const g = ctx.createRadialGradient(px + w / 2, py + h * .4, 0, px + w / 2, py + h * .4, w * .7); g.addColorStop(0, `rgba(255,210,130,${night * .55})`); g.addColorStop(1, 'rgba(255,180,80,0)'); ctx.fillStyle = g; ctx.fillRect(px - w * .2, py - h * .3, w * 1.4, h * 1.4); }
}
function fairPlay(m) {
  const W = 340, H = 400, el = document.createElement('div'); el.id = 'fairG';
  el.innerHTML = `<div class="fgBox"><div class="fgH">🎪 ${esc(m.name)} <span id="fgInfo"></span></div><canvas width="${W}" height="${H}"></canvas><div class="fgTip"></div></div>`;
  document.body.appendChild(el);
  const c = el.querySelector('canvas'), g = c.getContext('2d'), info = el.querySelector('#fgInfo'), tip = el.querySelector('.fgTip');
  const t0 = performance.now(); let score = 0, done = false, raf = 0, ptr = { x: W / 2, y: H / 2 };
  const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); setTimeout(() => { send({ t: 'fair', op: 'end', id: m.id, score }); el.remove(); }, 1100); };
  const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const COL = ['#ff5a6e', '#ffd23a', '#4fb3ff', '#7ee07a', '#c88cff', '#ff9a3c'];
  let tap = null;
  c.onpointerdown = e => { e.preventDefault(); ptr = pos(e); tap = { ...ptr }; };
  c.onpointermove = e => { ptr = pos(e); };
  // ---- the three games
  const G1 = {
    darts: () => { const balls = []; for (let r = 0; r < 4; r++) for (let q = 0; q < 5; q++) balls.push({ x: 50 + q * 60, y: 70 + r * 62, c: COL[(r * 5 + q) % 6], pop: 0 }); let darts = 6, fx = [];
      tip.textContent = 'กดเพื่อปาลูกดอก — เล็งตอนเป้าอยู่บนลูกโป่ง';
      return tt => {
        g.fillStyle = '#7a5230'; g.fillRect(0, 0, W, H); g.fillStyle = '#9a6a3e'; g.fillRect(14, 30, W - 28, 280);
        for (const b of balls) { if (b.pop) continue; g.fillStyle = b.c; g.beginPath(); g.ellipse(b.x, b.y, 22, 26, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(b.x - 7, b.y - 9, 5, 0, 7); g.fill(); }
        const ax = W / 2 + Math.sin(tt * 1.7) * 130 + Math.sin(tt * 4.3) * 18, ay = 170 + Math.sin(tt * 2.3 + 1) * 110;
        g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(ax, ay, 14, 0, 7); g.moveTo(ax - 22, ay); g.lineTo(ax + 22, ay); g.moveTo(ax, ay - 22); g.lineTo(ax, ay + 22); g.stroke();
        for (const f of fx) { const k = (tt - f.t) * 3; if (k < 1) { g.strokeStyle = `rgba(255,255,255,${1 - k})`; g.beginPath(); g.arc(f.x, f.y, 10 + k * 30, 0, 7); g.stroke(); } }
        g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.textAlign = 'left'; g.fillText('🎯'.repeat(darts), 16, 350);
        if (tap && darts > 0) { darts--; const hit = balls.find(b => !b.pop && Math.hypot(b.x - ax, b.y - ay) < 26); if (hit) { hit.pop = 1; score++; FX.play('pop'); } else FX.play('click'); fx.push({ x: ax, y: ay, t: tt }); if (!darts) finish(); }
        info.textContent = `แตก ${score} ลูก`;
      }; },
    ring: () => { let rings = 3, phase = 0, res = []; tip.textContent = 'กดตอนเข็มอยู่ในช่องสีเขียว';
      return tt => {
        g.fillStyle = '#3a2a4e'; g.fillRect(0, 0, W, H); g.fillStyle = '#7a5230'; g.fillRect(20, 200, W - 40, 30);
        for (let i = 0; i < 3; i++) { const x = 80 + i * 90; g.fillStyle = ['#7ee07a', '#4fb3ff', '#ffd23a'][i]; g.fillRect(x - 9, 130, 18, 70); g.fillRect(x - 5, 110, 10, 22); if (res[i] === 1) { g.strokeStyle = '#ff5a6e'; g.lineWidth = 6; g.beginPath(); g.ellipse(x, 176, 22, 8, 0, 0, 7); g.stroke(); } else if (res[i] === 0) { g.fillStyle = '#fff'; g.font = '26px sans-serif'; g.textAlign = 'center'; g.fillText('✗', x, 100); } }
        const lvl = 3 - rings, sp = 2.2 + lvl * 1.3, zw = 0.22 - lvl * .05, zc = .5 + Math.sin(lvl * 2.1) * .2, k = (Math.sin(tt * sp) + 1) / 2;
        g.fillStyle = '#222'; g.fillRect(30, 290, W - 60, 30); g.fillStyle = '#5ed17a'; g.fillRect(30 + (W - 60) * (zc - zw / 2), 290, (W - 60) * zw, 30);
        g.fillStyle = '#fff'; g.fillRect(30 + (W - 60) * k - 3, 280, 6, 50);
        g.font = 'bold 20px sans-serif'; g.textAlign = 'left'; g.fillText('⭕'.repeat(rings), 16, 370);
        if (tap && rings > 0) { const ok = Math.abs(k - zc) < zw / 2; res.push(ok ? 1 : 0); if (ok) { score++; FX.play('coin'); } else FX.play('fail'); rings--; if (!rings) finish(); }
        info.textContent = `ลง ${score} ห่วง`;
      }; },
    fish: () => { const ducks = Array.from({ length: 6 }, (_, i) => ({ a: i, r: 60 + (i % 3) * 40, sp: .5 + (i % 2) * .4, ph: i * 1.1 })); let hookUp = 0;
      tip.textContent = 'ลากเบ็ดไปเหนือเป็ด แล้วกดเพื่อเกี่ยว · 20 วินาที';
      return tt => {
        const left = Math.max(0, 20 - tt); g.fillStyle = '#5aa8e0'; g.fillRect(0, 0, W, H); g.fillStyle = '#8fd0f5'; g.beginPath(); g.ellipse(W / 2, 190, 160, 160, 0, 0, 7); g.fill();
        for (const d of ducks) { const ang = d.ph + tt * d.sp * (d.a % 2 ? 1 : -1); d.x = W / 2 + Math.cos(ang) * d.r; d.y = 190 + Math.sin(ang) * d.r * .8;
          g.fillStyle = '#ffd23a'; g.beginPath(); g.ellipse(d.x, d.y, 18, 13, 0, 0, 7); g.fill(); g.beginPath(); g.arc(d.x + (Math.sin(ang) > 0 ? -12 : 12), d.y - 10, 8, 0, 7); g.fill(); g.fillStyle = '#ff8a3c'; g.fillRect(d.x + (Math.sin(ang) > 0 ? -22 : 18), d.y - 11, 6, 4); }
        g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.moveTo(ptr.x, 0); g.lineTo(ptr.x, ptr.y - 8); g.stroke(); g.strokeStyle = '#c0c0c0'; g.lineWidth = 3; g.beginPath(); g.arc(ptr.x, ptr.y, 7, 0, Math.PI); g.stroke();
        if (tap) { const d = ducks.find(q => Math.hypot(q.x - ptr.x, q.y - ptr.y) < 22); if (d) { score++; d.ph += 2 + Math.random() * 2; d.r = 50 + Math.random() * 100; FX.play('coin'); } else FX.play('click'); }
        g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'left'; g.fillText(`⏱ ${left.toFixed(1)}`, 14, 380);
        info.textContent = `ได้ ${score} ตัว`; if (!left) finish();
      }; },
  }[m.k]();
  const loop = () => { if (done) return; G1((performance.now() - t0) / 1000); tap = null; raf = requestAnimationFrame(loop); };
  loop();
}
// ------------------------------------------------------------------ 🏮 Loy Krathong: krathongs drifting on the lake (yours, other players' and
// the town's own), Lanna lanterns and string lights by the landing, sky lanterns rising over the temple; event tile + panels
let LKV = null, LKJ = null, LKIMG = null, lkAsked = false;
const LKF = [], LKS = [];
const lkOnC = () => !!G?.lk && Date.now() >= G.lk.start && Date.now() <= G.lk.end;
const lkImgReady = () => !!(LKJ && LKIMG);
function lkLoad() { if (lkAsked) return; lkAsked = true; fetch('assets/loykrathong.json?v=1').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { LKJ = j; LKIMG = im; }; im.src = 'assets/loykrathong.webp?v=1'; }).catch(() => { lkAsked = false; }); }
function lkUi() {
  const b = $('#lkBtn'); if (!b) return; const on = lkOnC();
  b.classList.toggle('hidden', !on);
  b.classList.toggle('has', on && LKV && !LKV.today);
  $('#lkN').textContent = LKV?.got ? '✔ ได้ชุดแล้ว' : `${Math.min(LKV?.days || 0, 3)}/3 วัน`;
  b.onclick = () => { openPanel({ kind: 'lkev' }); send({ t: 'lkv' }); };
}
function lkEvHtml() {
  const v = LKV || {}, need = v.need || 3, d = Math.min(v.days || 0, need);
  const cells = Array.from({ length: need }, (_, i) => `<div class="ev7Cell ${i < d ? 'got' : i === d && !v.today ? 'ready' : 'lock'}"><small>วันที่ ${i + 1}</small><i>🪷</i>${i === need - 1 ? 'รับชุดฟรี' : 'ลอยกระทง'}</div>`).join('');
  return `<h2>🏮 เทศกาลลอยกระทง 2569</h2>
    <img src="assets/lkbanner.webp?v=1" alt="" style="width:100%;border-radius:12px;display:block;margin:4px 0 8px">
    <div class="sub">📅 21–30 พ.ย. · 🌕 คืนลอยกระทงจริง <b>อังคาร 24 พ.ย.</b> รางวัล x2 + ปล่อยโคมฟรี 1 ลูก<br>
    🪷 ไปที่ <b>ท่าลอยกระทง ริมทะเลสาบ</b> (ระหว่างสะพานท่าน้ำ 2 อัน) หรือ <b>สระบัวในวัด</b> ซื้อกระทง เขียนคำอธิษฐาน แล้วลอย · ได้เงิน/เพชรสุ่ม วันละ 3 ครั้ง<br>
    💕 ลอยพร้อมเพื่อนที่ยืนข้างกัน = ลอยคู่ ประกาศให้ทั้งเมืองรู้ · 🏮 ปล่อยโคมลอยได้ที่ลานหน้าโบสถ์ในวัด<br>
    🎽 ลอยกระทงครบ <b>3 วัน</b> (วันไหนก็ได้) รับ <b>ชุดไทยลอยกระทง</b> ฟรี! ไม่มีขาย</div>
    <div class="ev7Grid" style="grid-template-columns:repeat(3,1fr)">${cells}</div>
    <div class="ev7Ban" style="min-height:0;padding:8px 12px"><div class="ev7Txt"><b style="font-size:18px">รางวัล: ชุดไทยลอยกระทง</b><span>${v.got ? '✔ ได้รับแล้ว ใส่/ถอดที่ ⚙️ ตั้งค่า' : `ลอยแล้ว ${d}/${need} วัน${v.today ? ' (วันนี้ลอยแล้ว ✔)' : ''}`}</span></div><canvas data-of="loykrathong" data-og="m" width="72" height="96"></canvas><canvas data-of="loykrathong" data-og="f" width="72" height="96"></canvas></div>
    ${B('🧭 พาไปท่าลอยกระทง', { fn: 'lkGo' }, 'primary big')}`;
}
const lkWater = (x, y) => G.map.tiles[Math.floor(y)]?.[Math.floor(x)] === 'w';
function lkSpawn(m, amb) {
  if (LKF.length > 40) LKF.splice(0, LKF.findIndex(k => k.amb) + 1 || 1);
  LKF.push({ area: m.area || 'town', sp: m.sp, x: m.x, y: m.y, vx: (Math.random() - .5) * .22, vy: .1 + Math.random() * .12, t0: performance.now(), life: amb ? 200e3 : 300e3, name: m.name || '', wish: m.wish || '', pair: m.pair, amb, ph: Math.random() * 7 });
}
function lkSky(m) { LKS.push({ x: m.x, y: m.y, t0: performance.now(), name: m.name || '', ph: Math.random() * 7, vx: (Math.random() - .5) * .25 }); if (LKS.length > 30) LKS.shift(); }
let lkAmbT = 0;
function lkEnts(A, ents, vis) {
  lkLoad(); if (!lkImgReady()) return;
  const tn = performance.now(), dt = Math.min(.1, (tn - (lkEnts.t || tn)) / 1000); lkEnts.t = tn;
  const night = nightLevel() > .2, fest = !!LKV?.fest;
  if (A.id === 'town') {
    for (const d of G.lk.deco) if (vis(d[1], d[2], 4)) ents.push([d[2], 17, { k: 'deco', s: d[0], x: d[1], y: d[2], z: d[3] }]);
  }
  {   // krathongs on the water here (the town lake or the temple's lotus pond)
    const P0 = G.lk.ponds?.[A.id] || [18, 60.4, 35, 61.6], here = LKF.filter(k => k.area === A.id), small = A.id === 'temple';
    if (tn > (lkEnts['a' + A.id] || 0) && here.filter(k => k.amb).length < (small ? (fest ? 8 : 5) : fest ? 26 : 14)) { lkEnts['a' + A.id] = tn + (fest ? 2500 : 5000) + Math.random() * 3000; const sp = ['kr_leaf', 'kr_leaf', 'kr_bread', 'kr_lotus'][Math.random() * 4 | 0]; lkSpawn({ sp, x: P0[0] + Math.random() * (P0[2] - P0[0]), y: P0[1] + Math.random() * (P0[3] - P0[1]), area: A.id }, 1); if (small) { const q = LKF[LKF.length - 1]; q.vx *= .5; q.vy *= .4; } }
    for (let i = LKF.length - 1; i >= 0; i--) {
      const k = LKF[i], age = tn - k.t0; if (age > k.life) { LKF.splice(i, 1); continue; } if (k.area !== A.id) continue;
      const nx = k.x + k.vx * dt, ny = k.y + k.vy * dt;
      if (lkWater(nx + Math.sign(k.vx) * .4, k.y)) k.x = nx; else k.vx = -k.vx;
      if (lkWater(k.x, ny + .3)) k.y = ny; else { k.vy = -Math.abs(k.vy) * .4; if (Math.abs(k.vy) < .02) k.vy = 0; }
      if (vis(k.x, k.y, 2)) ents.push([-1e7 + k.y, 17, { k: 'kr', e: k, age }]);   // on the water: under people standing on the shore
    }
  }
  if (A.id === 'temple') {
    for (const d of G.lk.decoT || []) if (vis(d[1], d[2], 4)) ents.push([d[2], 17, { k: 'deco', s: d[0], x: d[1], y: d[2], z: d[3] }]);
    if (night && tn > lkAmbT && LKS.length < (fest ? 16 : 9)) { lkAmbT = tn + 1800 + Math.random() * 2500; lkSky({ x: A.x + 6 + Math.random() * (A.w - 12), y: A.y + 14 + Math.random() * 12 }); }
    for (let i = LKS.length - 1; i >= 0; i--) { const l = LKS[i], age = (tn - l.t0) / 1000; if (age > 40) { LKS.splice(i, 1); continue; } ents.push([1e7, 17, { k: 'sky', e: l, age }]); }
  }
}
function lkSpr(name, x, y, X, Y, sc = 1) {
  const s = LKJ.sprites[name]; if (!s) return null;
  const w = s[4] * TS * sc, h = w * s[3] / s[2], px = Math.round(x * TS + X - w / 2), py = Math.round(y * TS + Y - h);
  ctx.drawImage(LKIMG, s[0], s[1], s[2], s[3], px, py, Math.round(w), Math.round(h)); return { px, py, w, h };
}
function lkGlow(px, py, r, a) { const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,200,110,${a})`); g.addColorStop(1, 'rgba(255,170,60,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); }
function drawLk(e, X, Y, t) {
  ctx.imageSmoothingEnabled = false; const night = nightLevel(), T = t / 1000;
  if (e.k === 'deco') {
    const sw = e.s === 'lanna' ? Math.sin(T * 1.3 + e.x) * .05 : 0;
    if (e.s === 'lanna') { ctx.strokeStyle = 'rgba(70,45,25,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(e.x * TS + X, (e.y - e.z - 1.2) * TS + Y); ctx.lineTo(e.x * TS + X, (e.y - e.z - .9) * TS + Y); ctx.stroke(); }
    ctx.save(); ctx.translate(e.x * TS + X, (e.y - e.z) * TS + Y); ctx.rotate(sw); const r = lkSpr(e.s, 0, 0, 0, 0); ctx.restore();
    if (night > .15 && r) lkGlow(e.x * TS + X, (e.y - e.z) * TS + Y - r.h / 2, TS * (e.s === 'lights' ? 1.6 : .9), night * 1.1);
    return;
  }
  if (e.k === 'kr') {
    const k = e.e, bob = Math.sin(T * 1.6 + k.ph) * TS * .03, fade = Math.min(1, (k.life - e.age) / 5000), px = k.x * TS + X, py = k.y * TS + Y + bob;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; const rr = (T * .8 + k.ph) % 1; ctx.beginPath(); ctx.ellipse(px, py, TS * (.35 + rr * .35), TS * (.12 + rr * .12), 0, 0, 7); ctx.stroke();
    if (night > .1) lkGlow(px, py - TS * .45, TS * .9, .5 + night);
    lkSpr(k.sp, k.x, k.y + bob / TS + .1, X, Y, .8);
    if (night > .1) { ctx.fillStyle = `rgba(255,${200 + Math.sin(T * 9 + k.ph) * 40 | 0},90,.95)`; ctx.beginPath(); ctx.arc(px, py - TS * .66, TS * .05, 0, 7); ctx.fill(); }
    if (!k.amb && e.age < 9000) { ctx.globalAlpha = fade * Math.min(1, (9000 - e.age) / 1500); sign(`${k.pair ? '💕 ' : '🪷 '}${k.name}${k.wish ? ` · "${k.wish}"` : ''}`, px, py - TS * 1.1, { size: TS * .24, bg: 'rgba(120,60,20,.85)' }); }
    ctx.globalAlpha = 1; return;
  }
  if (e.k === 'sky') {
    const l = e.e, x = l.x + Math.sin(e.age * .6 + l.ph) * .5 + l.vx * e.age, y = l.y - e.age * .55, a = Math.min(1, e.age / 1.5, (40 - e.age) / 6), px = x * TS + X, py = y * TS + Y;
    if (py < -TS * 2) return; ctx.globalAlpha = Math.max(0, a);
    lkGlow(px, py - TS * .4, TS * 1.2, .55 + night * .6); lkSpr('skylantern', x, y, X, Y, .9 - Math.min(.4, e.age * .012));
    if (l.name && e.age < 6) sign(`🏮 ${l.name}`, px, py - TS * 1.3, { size: TS * .22, bg: 'rgba(120,60,20,.85)' });
    ctx.globalAlpha = 1;
  }
}
setInterval(() => { if (G && lkOnC()) { lkUi(); } }, 60e3);
// ------------------------------------------------------------------ 🎁 the 7-day login event: a gift tile under the phone and its panel
let EV7 = null;
const ev7Ready = () => !!EV7 && EV7.n > EV7.got && Date.now() <= EV7.end;
function ev7Ui() {
  const b = $('#ev7Btn'); if (!b || !EV7) return;
  b.classList.toggle('hidden', !(EV7.on && EV7.got < 7 || ev7Ready()));
  b.classList.toggle('has', ev7Ready());
  $('#ev7N').textContent = ev7Ready() ? 'รับเลย!' : `${EV7.n}/7`;
  b.onclick = () => { openPanel({ kind: 'ev7' }); send({ t: 'ev7' }); };
  if (ev7Ready()) { const k = 'lt_ev7t_' + new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); let seen = false; try { seen = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch { }
    if (!seen) setTimeout(() => toast('🎁 กิจกรรมล็อกอิน 7 วัน: มีรางวัลรอรับ! กดไอคอน 🎁 ใต้มือถือ', '🎁', true), 6000); }
}
setInterval(() => { if (G && EV7?.on) send({ t: 'ev7' }); }, 10 * 60e3);   // still online after midnight: the new day counts too
function ev7Html() {
  const e = EV7; if (!e) { send({ t: 'ev7' }); return '<h2>🎁 กิจกรรม</h2><div class="sub">กำลังโหลด…</div>'; }
  const end = new Date(e.end + 7 * 3600e3), ends = `${end.getUTCDate()} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][end.getUTCMonth()]}`;
  const leftD = Math.max(0, Math.ceil((e.end - Date.now()) / 86400e3));
  const cell = (r, i) => {
    const s = i < e.got ? 'got' : i < e.n ? 'ready' : 'lock';
    const what = r.money ? ['💰', `฿${r.money.toLocaleString()}`] : r.gems ? ['💎', `${r.gems} เพชร`] : r.egg ? ['🥚', 'ไข่สัตว์เลี้ยง'] : ['🎽', 'ชุดกันหนาว'];
    if (r.outfit) return `<div class="ev7Cell big ${s}"><small>วันที่ 7 · รางวัลใหญ่</small><canvas data-of="${r.outfit}" data-og="m" width="72" height="96"></canvas><canvas data-of="${r.outfit}" data-og="f" width="72" height="96"></canvas><br><b>ชุดไหมพรมกันหนาว</b></div>`;
    return `<div class="ev7Cell ${s}"><small>วันที่ ${i + 1}</small><i>${what[0]}</i>${what[1]}</div>`;
  };
  const can = ev7Ready(), done = e.got >= 7, over = Date.now() > e.end;
  return `<h2>🎁 ${esc(e.title)}</h2>
    <div class="ev7Ban"><div class="ev7Txt"><small>❄️ กิจกรรมฤดูหนาว · ถึง ${ends}</small><b>ล็อกอิน 7 วัน</b><span>รับชุดไหมพรมกันหนาวฟรี!</span></div><canvas data-of="winter" data-og="m" width="72" height="96"></canvas><canvas data-of="winter" data-og="f" width="72" height="96"></canvas></div>
    <div class="sub">เข้าเกมวันไหนก็ได้ ไม่ต้องติดกัน ครบ 7 วันรับชุดเลย · ล็อกอินแล้ว <b>${e.n}/7</b> วัน${e.today ? ' (วันนี้นับแล้ว ✔)' : ''} · ${over ? '⌛ หมดเวลาแล้ว' : `เหลือเวลาอีก ${leftD} วัน`}</div>
    <div class="ev7Grid">${e.days.map(cell).join('')}</div>
    ${done ? '<div class="sub">🎉 รับรางวัลครบแล้ว ใส่/ถอดชุดได้ที่ ⚙️ ตั้งค่า</div>' : B(can ? '🎁 รับรางวัล' : over ? 'หมดเวลากิจกรรม' : 'พรุ่งนี้เข้ามารับรางวัลถัดไปนะ', { t: 'ev7', op: 'claim' }, can ? 'primary big' : 'big', !can)}`;
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  aucBid(m) { const v = +($('#aucAmt')?.value || 0); send({ t: 'act', st: m.st, a: 'bid', amt: v }); },
  openPets() { openPanel({ kind: 'pets' }); },
  titles: () => { panel.titles = !panel.titles; panel.frames = false; refreshPanel(true); const b = document.querySelector('#panelBody'); if (b) b.scrollTop = 0; },
  frames: () => { panel.frames = !panel.frames; panel.titles = false; refreshPanel(true); const b = document.querySelector('#panelBody'); if (b) b.scrollTop = 0; },
  showEd: () => { panel.showEd = !panel.showEd; panel.titles = panel.frames = false; refreshPanel(true); const b = document.querySelector('#panelBody'); if (b) b.scrollTop = 0; },
  showAch(m) { const cur = me.show?.ach || [], has = cur.includes(m.id); if (!has && cur.length >= 3) return toast('เลือกโชว์ได้สูงสุด 3 อัน กดเอาอันเดิมออกก่อน', '🏅'); send({ t: 'show', ach: has ? cur.filter(x => x !== m.id) : [...cur, m.id] }); },
  photo: () => pickPhoto(),
  lkFloat: m => { send({ t: 'act', st: m.st, a: 'float', kind: m.kind, wish: ($('#lkWish')?.value || '').trim() }); closePanel(); },
  lkGo: () => { closePanel(); setGuide('lk_float'); },
  place: m => startPlace(m.k),
  decoPick: () => startPick(),
  photoDel: () => send({ t: 'pic', data: '' }),
  chatTab: m => { chatTab = m.tab; panel.sig = 'x' + m.tab; refreshPanel(true); if (!TOUCH_UI) setTimeout(() => $('#chatIn')?.focus(), 30); },
  mailSend: () => { const to = $('#mailTo').value.trim(), text = $('#mailText').value.trim(); if (!to || !text) return toast('ใส่ชื่อผู้รับและข้อความ', '✉️', false); send({ t: 'mail', to, text }); },   // the text stays until the server confirms (mailsent)
  mailReply: m => { panel.to = m.to; refreshPanel(true); $('#mailText')?.focus(); },
  mtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  qtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  social(m) {
    const k = m.k || 'ideas';
    if (k === 'ideas') send({ t: 'idea', op: 'list', sort: panel?.sort || 'new' });
    const next = { kind: k, soc: 1, ...(k === 'ideas' ? { sort: panel?.soc ? panel.sort || 'new' : 'new' } : {}) };
    if (panel?.soc) { for (const x of Object.keys(panel)) delete panel[x]; Object.assign(panel, next); panelSig = ''; refreshPanel(true); } else openPanel(next);
  },
  wallSet(m) { PWALL = m.c >= 0 ? { c: m.c } : null; wallSave(); refreshPanel(true); },
  morder(m, root) { const tip = Math.floor(+root.querySelector('#tipIn')?.value || 0); panel.tip = tip; send({ t: 'morder', item: m.item, qty: m.qty, tip }); },
  openInvite() { send({ t: 'refcode' }); openPanel({ kind: 'invite' }); },
  refShare() { const R = window.__ref; if (!R) return; const url = location.origin + '/?ref=' + R.code, text = `มาเล่นเมืองชีวิตนี้เลือกได้ด้วยกัน! ใช้โค้ด ${R.code} รับไข่สัตว์เลี้ยงฟรี 🥚`;
    if (navigator.share) navigator.share({ title: 'เมืองชีวิตนี้เลือกได้', text, url }).catch(() => { }); else { try { navigator.clipboard.writeText(text + ' ' + url); toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย', '📋'); } catch { prompt('คัดลอกลิงก์นี้', url); } } },
  fbCopy(m) {
    const t = fbText(m.n), done = () => { try { localStorage.setItem('lt_fbpost', NEWS[0].v); } catch { } toast('คัดลอกแล้ว ไปวางในกลุ่มเฟสได้เลย', '📣'); };
    navigator.clipboard?.writeText(t).then(done, () => { const a = $('#fbTxt'); if (a) { a.select(); document.execCommand('copy'); } done(); }) || (() => { const a = $('#fbTxt'); a?.select(); document.execCommand('copy'); done(); })();
  },
  refCopy() { const R = window.__ref; if (!R) return; try { navigator.clipboard.writeText(R.code); toast('คัดลอกโค้ดแล้ว', '📋'); } catch { prompt('โค้ดของคุณ', R.code); } },
  refUse(m, root) { const c = root.querySelector('#refIn')?.value || ''; if (c.trim().length < 4) return toast('กรอกโค้ดเพื่อน', '🎟️', false); send({ t: 'refuse', code: c }); },
  openLotto() { send({ t: 'lotto', op: 'view' }); openPanel({ kind: 'lotto' }); },
  lotto: d => { if (d.pick) { const n = ($('#lottoIn')?.value || '').replace(/\D/g, ''); if (n.length !== 6) return toast('ใส่เลข 6 หลัก', '🎫', false); return send({ t: 'lotto', op: 'buy', num: n }); } send({ t: 'lotto', op: 'buy', qty: d.qty }); },
  openIdeas() { send({ t: 'idea', op: 'list', sort: 'new' }); openPanel({ kind: 'ideas', sort: 'new' }); },
  idea(m, root) {
    if (m.op === 'del' && !confirm('ลบโพสต์นี้?')) return;
    if (m.op === 'sort') { panel.sort = m.sort; return send({ t: 'idea', op: 'list', sort: m.sort }); }
    if (m.op === 'open') { panel.open = panel.open === m.id ? 0 : m.id; return refreshPanel(true); }
    const text = m.op === 'post' ? root.querySelector('#ideaIn')?.value : m.op === 'cm' ? root.querySelector('#ideaCm' + m.id)?.value : '';
    send({ t: 'idea', op: m.op, id: m.id, text, sort: panel.sort });
    if (m.op === 'post') { const e = root.querySelector('#ideaIn'); if (e) e.value = ''; }
  },
  petName(m) { const cur = me.pnames?.[m.id] || ''; const n = prompt(`ตั้งชื่อ${G.pets[m.id]?.name || 'สัตว์เลี้ยง'} (ไม่เกิน 12 ตัวอักษร · เว้นว่าง = ลบชื่อ)`, cur); if (n === null) return; send({ t: 'pet.name', id: m.id, name: n.trim() }); },
  openMayor() { send({ t: 'mayor', op: 'view' }); openPanel({ kind: 'mayor' }); },
  mayor(m, root) {
    if (m.op === 'run' && !confirm('ลงสมัครนายกเมือง ค่าสมัคร ' + (window.__mayor?.K?.fee || 50000).toLocaleString() + ' บาท (ไม่คืนเงิน) ยืนยัน?')) return;
    if (m.op === 'vote' && !confirm('โหวตให้ ' + m.n + '? โหวตได้ครั้งเดียวต่อรอบ เปลี่ยนไม่ได้')) return;
    if (m.op === 'ann') return send({ t: 'mayor', op: 'ann', text: root.querySelector('#mAnn')?.value || '' });
    send({ t: 'mayor', op: m.op, l: m.l, k: m.k });
  },
  openGang() { send({ t: 'gang', op: 'list' }); openPanel({ kind: 'gang' }); },
  gangTab(m) { panel.gtab = m.tab; if (m.tab === 'rank' || m.tab === 'list') send({ t: 'gang', op: 'list' }); refreshPanel(true); },
  gset(m, root) { panel.gnm = root.querySelector('#gName')?.value ?? panel.gnm; Object.assign(panel, m.set); refreshPanel(true); },
  gang(m, root) {
    const SURE = { leave: 'ออกจากแก๊งนี้?', disband: 'ยุบแก๊ง? สมาชิกทุกคนจะออก คลังแก๊งคืนให้หัวหน้า', kick: 'ไล่คนนี้ออกจากแก๊ง?', boss: 'ส่งต่อตำแหน่งหัวหน้าให้คนนี้? คุณจะเป็นรองหัวหน้า' };
    if (SURE[m.op] && !confirm(SURE[m.op])) return;
    if (m.op === 'create') return send({ t: 'gang', op: 'create', name: root.querySelector('#gName')?.value ?? panel.gnm ?? '', icon: panel.gic, color: panel.gco });
    if (m.op === 'donate') return send({ t: 'gang', op: 'donate', amt: +root.querySelector('#gAmt')?.value || 0 });
    if (m.op === 'rename') { const nm = (root.querySelector('#gRename')?.value || '').trim(); if (nm.length < 2) return toast('พิมพ์ชื่อแก๊งใหม่อย่างน้อย 2 ตัวอักษร', '🏴', false); if (!confirm(`เปลี่ยนชื่อแก๊งเป็น "${nm}" ใช้ 💎300?`)) return; return send({ t: 'gang', op: 'rename', name: nm }); }
    send({ t: 'gang', op: m.op, l: m.l, id: m.id });
    if (m.op === 'req' || m.op === 'create') setTimeout(() => send({ t: 'gang', op: 'list' }), 400);
  },
  delContact(m) { popup(`ลบ <b>${esc(m.n)}</b> ออกจากรายชื่อ?`, [['🗑️ ลบ', 'warn', () => send({ t: 'contact_del', phone: m.phone })], ['ยกเลิก', '', () => { }]], 10000); },
  phMap() { closePanel(); mapZoom = 1; openMap(); },
  phClose() { closePanel(); },
  bugReply(m) { const t = prompt('ข้อความที่จะส่งถึงกล่องจดหมายผู้เล่น (เว้นว่าง = ข้อความมาตรฐาน "แก้ไขเรียบร้อยแล้ว")', ''); if (t === null) return; send({ t: 'god', op: 'bugreply', bt: m.bt, login: m.login, text: t.trim() }); },
  fbGroup() { if (!FB_GROUP) return toast('กลุ่มเฟสบุ๊คกำลังจะมาเร็วๆ นี้', '👥', false); try { window.open(FB_GROUP, '_blank', 'noopener'); } catch { location.href = FB_GROUP; } },
  soilStore() { const h = wd?.houses?.[me.house]; if (!h) return; for (const k of me.furniture || []) if (G.shop.furniture[fbase(k)]?.tile && furnPos(h, k)) send({ t: 'hplace', k, store: 1 }); },
  stock(m, root) { const q = m.qty || Math.floor(+root.querySelector('#skQty')?.value || 0); if (!(q > 0)) return toast('ใส่จำนวนหุ้น', '📈', false); send(m.st ? { t: 'act', st: m.st, a: 'stock', op: m.op, id: m.id, qty: q } : { t: 'stock', op: m.op, id: m.id, qty: q }); },   // from the phone: no bank needed
  callMin() { closePanel(); toast('ย่อสายไว้แล้ว แตะแถบ 📞 ด้านบนเพื่อเปิด', '📞'); },
  list(m, root) { const v = Math.floor(+root.querySelector('#lp_' + m.item).value || 0); send({ t: 'act', st: m.st, a: 'list', item: m.item, qty: m.qty, price: v }); },
  bank(m, root) { const v = m.all ? m.all : +root.querySelector('#bankAmt')?.value || 0; send(m.st ? { t: 'act', st: m.st, a: m.op, amt: v } : { t: 'bankop', op: m.op, amt: v }); },   // from the phone: no bank needed
  price(m, root) { send({ t: 'act', st: m.st, a: m.op, price: m.zero ? 0 : +root.querySelector('#' + m.inp).value || 0 }); },
  guide(m) { closePanel(); setGuide(m.key, false, true); },
  guidePt(m) { closePanel(); guide = { x: m.x, y: m.y, area: m.area, label: m.label }; toast(`นำทางไป ${m.label}`, '📍'); paintNav(); placeLog(); },
  tut() { closePanel(); showTut(0); },
  map() { closePanel(); openMap(); },
  logout() { localStorage.removeItem('lt_creds'); wantLogin = false; location.reload(); },
  fs(m) { closePanel(); screenMode(m.mode); },
  toggle(m) { FX.setOpt(m.k, !FX.opts[m.k]); paintMute(); refreshPanel(true); },
  names() { const L = ['all', 'name', 'none']; NAME_MODE = L[(L.indexOf(NAME_MODE) + 1) % 3]; try { localStorage.setItem('lt_names', NAME_MODE); } catch { } refreshPanel(true); toast(NAME_TXT[NAME_MODE], '🏷️'); },
  eco() { ECO = !ECO; try { localStorage.setItem('lt_eco', ECO ? '1' : '0'); } catch { } resize(); refreshPanel(true); toast(ECO ? 'เปิดโหมดประหยัดแบต: เล่นยังลื่น ยืนเฉยๆ จะพักเครื่องให้เย็น' : 'ปิดโหมดประหยัดแบต: ภาพเต็ม 60 เฟรม', '🔋'); },
  tradeReq(m) { send({ t: 'req', kind: 'trade', to: m.to }); closePanel(); },
  heal(m, root) { send({ t: 'req', kind: 'heal', to: m.to, fee: +root.querySelector('#feeIn').value || 0 }); closePanel(); },
  addContact(m, root) { const ph = String(m.phone || root.querySelector('#phIn').value).replace(/\D/g, ''); if (G.taxi && ph === G.taxi.phone) { panel.tab = 'taxi'; return refreshPanel(true); } send({ t: 'contact_add', phone: ph }); },
  taxiGo(m) { send({ t: 'taxi', dest: m.dest }); closePanel(); },
  donate(m, root) { send({ t: 'donate', to: m.to, amt: +root.querySelector('#donIn').value || 0 }); },
  order(m, root) { send({ t: 'order', item: m.item, tip: panel?.tip ?? +(root.querySelector('#tipIn')?.value || 0) }); },
  open(m) { openPanel({ kind: m.kind, ...(m.set || {}) }); },
  qtalk(m) { talkQuest(m.type); },
  icuGo() { closePanel(); icuOpen(); },
  share() { shareGame(); },
  look(m) { send({ t: 'look', ...m.set }); },
  reel() { strike(); },
  bug(m, root) { const v = root.querySelector('#bugIn').value.trim(); if (v.length < 5) return toast('เขียนรายละเอียดอีกนิด', '🐞', false); send({ t: 'bug', text: v, ua: navigator.userAgent.slice(0, 160) + ` ${innerWidth}x${innerHeight}`, st: JSON.stringify({ cast: me.cast?.state || 0, FG: !!FG, joy: !!joy, hat: holdAfterTp, pose: me.pose || 0, down: me.down?.kind || 0, panel: panel?.kind || 0, dlg: !!dlgQ, run: !!RUN, rb: !!RB, mis: me.mis?.title || 0, cook: !!me.cook }).slice(0, 300) }); root.querySelector('#bugIn').value = ''; },
  reset(m, root) {
    const pin = root.querySelector('#resetPin').value, ok = root.querySelector('#resetOk').value.trim();
    if (ok !== 'รีเซ็ต') return toast('พิมพ์คำว่า "รีเซ็ต" ในช่องยืนยันก่อน', '⚠️', false);
    if (!confirm('ยืนยันรีเซ็ตตัวละคร? เงิน ของ บ้าน สวน งาน และความสำเร็จทั้งหมดจะหายไป (ID/PIN/ชื่อ/เบอร์โทรยังอยู่)')) return;
    send({ t: 'reset', pin }); closePanel();
  },
  god(m) { send({ t: 'god', op: m.op }); },
  godMoney(m, root) { const v = Math.floor(+(root.querySelector('#godMoney')?.value || 0)); if (!(v > 0) && m.op !== 'setmoney') return toast('ใส่จำนวนเงิน', '💰', false); send({ t: 'god', op: m.op || 'addmoney', v }); root.querySelector('#godMoney').value = ''; },
  openTopup() { payRes = null; send({ t: 'pay', op: 'view' }); openPanel({ kind: 'topup' }); },
  payPack(m) { paySel.pack = m.id; refreshPanel(true); },
  payMethod(m) { paySel.m = m.id; refreshPanel(true); },
  payBuy(m, root) {
    if (!root.querySelector('#payOk')?.checked) return toast('ติ๊กยืนยันก่อนชำระเงิน', '☑️');
    send({ t: 'pay', op: 'buy', pack: paySel.pack });
  },
  payShow(m) { payOpenRef = m.ref; refreshPanel(true); },
  payHide() { payOpenRef = ''; refreshPanel(true); },
  payCheck(m) { send({ t: 'pay', op: 'check', ref: m.ref }); },
  openPayAdmin() { payAdm = null; send({ t: 'god', op: 'payorders' }); openPanel({ kind: 'payadmin' }); },
  payVoid(m) { if (confirm(m.paid ? `ดึงของจากรายการ ${m.ref} คืน?\nใช้กับรายการทดสอบ/ที่คืนเงินแล้วเท่านั้น ผู้เล่นจะได้จดหมายแจ้ง` : `ยกเลิกรายการ ${m.ref}?`)) send({ t: 'god', op: 'payvoid', ref: m.ref }); },
  payOk(m) { if (confirm(`เติมเพชรให้รายการ ${m.ref} ด้วยมือ?\nทำเฉพาะเมื่อเช็กในแอปธนาคารแล้วว่าเงินเข้าจริง`)) send({ t: 'god', op: 'payok', ref: m.ref }); },
  payRecheck(m) { send({ t: 'god', op: 'paycheck', ref: m.ref }); },
  openLedger() { ledgerRes = null; send({ t: 'ledger' }); openPanel({ kind: 'ledger' }); },
  godLedger(m) { ledgerRes = null; send({ t: 'god', op: 'ledger', login: m.login }); openPanel({ kind: 'ledger', admin: 1 }); },
  rename() {
    const nm = prompt('ชื่อใหม่ (2–16 ตัวอักษร)\nบัตรเปลี่ยนชื่อใช้ 💎10', me.name || ''); if (nm == null) return;
    if (nm.trim() === me.name) return;
    if (!confirm(`เปลี่ยนชื่อเป็น "${nm.trim()}"\nใช้ 💎10 (มี 💎${me.gemInf ? '∞' : me.gems || 0}) ยืนยันไหม?`)) return;
    send({ t: 'rename', name: nm });
  },
  godFind(m, root) { send({ t: 'god', op: 'find', q: root.querySelector('#godFind')?.value || '' }); },
  godGem(m, root) { const n = Math.round(+(root.querySelector('#godGem_' + m.login)?.value || 0)), why = root.querySelector('#godGemW_' + m.login)?.value || '';
    if (!n) return toast('ใส่จำนวนเพชรก่อน', '💎'); if (!confirm(`${n > 0 ? 'ส่ง' : 'หัก'} 💎${Math.abs(n).toLocaleString()} ${n > 0 ? 'ให้' : 'จาก'} ${m.login}?`)) return; send({ t: 'god', op: 'givegems', login: m.login, n, why }); },
  godPin(m, root) { const pin = root.querySelector('#godPin_' + m.login)?.value || ''; if (!confirm(`ตั้ง PIN ใหม่ให้ ${m.login} เป็น ${pin}?`)) return; send({ t: 'god', op: 'setpin', login: m.login, pin }); },
  godName(m, root) { send({ t: 'god', op: 'rename', name: root.querySelector('#godName')?.value || '' }); },
};
let bugList = null;
// quest givers: every quest comes from a townsperson with a painted portrait (public/assets/portraits.*)
const QUEST_GIVER = {
  work:     { f: 'office_f',  name: 'คุณนภา (ฝ่ายบุคคล)', ask: 'ช่วยเคลียร์งานเอกสารที่บริษัทหน่อยนะคะ', thx: 'งานเสร็จทันเวลา ขอบคุณมากค่ะ!' },
  harvest:  { f: 'farmer_f',  name: 'พี่ข้าวหอม (ประธานสหกรณ์)', ask: 'ผักสุกเต็มแปลงเลย มาช่วยเก็บหน่อยสิ', thx: 'ได้ผลผลิตเต็มตะกร้า ขอบใจจ้า!' },
  fish:     { f: 'fisher_m',  name: 'น้าเล็ก (สมาคมประมง)', ask: 'ตลาดอยากได้ปลาสด ช่วยตกมาหน่อยนะ', thx: 'ปลาสดๆ แบบนี้แหละ เก่งมาก!' },
  buy:      { f: 'grocer_m',  name: 'เฮียชัย (คลังสินค้า)', ask: 'ของในคลังล้น ช่วยรับไปขายหน่อย', thx: 'ขายคล่องแบบนี้ เดี๋ยวเฮียลดให้อีก!' },
  cook:     { f: 'chef_m',    name: 'เชฟหมี (ครัวใหญ่)', ask: 'ออเดอร์เข้ารัวๆ มาช่วยครัวหน่อย', thx: 'ฝีมือใช้ได้นี่ มาช่วยอีกนะ!' },
  treat:    { f: 'doctor_f',  name: 'หมอแพร (ผอ.โรงพยาบาล)', ask: 'คนไข้รอคิวเยอะ ช่วยดูแลด้วยนะคะ', thx: 'คนไข้หายดีแล้ว ขอบคุณค่ะคุณหมอ' },
  deliver:  { f: 'rider_m',   name: 'พี่ต่อ (หัวหน้าไรเดอร์)', ask: 'ออเดอร์ค้างเพียบ ช่วยวิ่งส่งหน่อย!', thx: 'ส่งไวทันใจ ลูกค้าชมใหญ่เลย!' },
  trade:    { f: 'mprang_shy', thxF: 'mprang_wave', name: 'น้องมะปราง', ask: 'อยากลองแลกของกับคนอื่นจัง ช่วยหน่อยได้ไหม', thx: 'เย้! แลกของสนุกจังเลย' },
  chat:     { f: 'student_m', name: 'น้องภูมิ (นักศึกษา · ร้านสะดวกซื้อ)', ask: 'มาเมืองนี้ใหม่ ยังไม่รู้จักใครเลย ช่วยทักคนแถวนี้ให้หน่อย', thx: 'ได้เพื่อนใหม่แล้ว ขอบคุณครับ!' },
  eat:      { f: 'grandma',   name: 'ยายบุญ (ร้านสะดวกซื้อสาขาหมู่บ้าน)', ask: 'ผอมลงนะหลาน กินข้าวกินปลาบ้างสิ', thx: 'อิ่มท้องแล้ว ยายก็สบายใจจ้ะ' },
  sit:      { f: 'teacher_f', name: 'คุณจิ๋ม (นายหน้าอสังหาฯ)', ask: 'ทำงานหนักแล้ว ไปนั่งพักที่จัตุรัสบ้างนะคะ', thx: 'พักผ่อนบ้าง ชีวิตจะได้สมดุลค่ะ' },
  sell:     { f: 'market_f',  name: 'เจ๊ศรี (ตลาดกลาง)', ask: 'ตลาดขาดของ เอาของมาขายหน่อยสิ', thx: 'ของดีขายหมดเกลี้ยง ขอบใจนะ!' },
  earn:     { f: 'banker_f',  name: 'คุณนิด (ธนาคาร)', ask: 'ลองตั้งเป้าเก็บเงินวันนี้ดูไหมคะ', thx: 'ยอดเงินสวยมาก เก็บออมต่อนะคะ' },
  dailyall: { f: 'elder_m',   name: 'ผอ.ประเสริฐ (ผู้อำนวยการ)', ask: 'ช่วยเหลือชาวเมืองให้ครบทุกวัน เมืองเราจะน่าอยู่ขึ้น', thx: 'เมืองนี้โชคดีที่มีเธอ!' },
};
let FACES = null;
// ---- login screen: townsfolk to meet, falling petals, live online count
function buildCast() {
  const box = document.getElementById('heroCast'); if (!box || !FACES) return;
  const cast = [['office_f', 'นภา'], ['fisher_m', 'น้าเล็ก'], ['doctor_f', 'หมอแพร'], ['chef_m', 'เชฟหมี'], ['mprang_happy', 'มะปราง'], ['rider_m', 'พี่ต่อ'], ['farmer_f', 'ข้าวหอม'], ['police_f', 'ดาบสมศรี']], n = Object.keys(FACES.faces).length, px = innerWidth <= 860 ? 42 : 58;
  box.innerHTML = cast.map(([f, nm]) => { const i = FACES.faces[f]; return i === undefined ? '' : `<div class="cm"><i class="qface" style="background-size:${n * px}px ${px}px;background-position:-${i * px}px 0"></i>${nm}</div>`; }).join('');
}
(function loginFx() {
  const cv = document.getElementById('petals'), login = document.getElementById('login'); if (!cv || !login) return;
  const g = cv.getContext('2d'); let W = 0, H = 0, ps = [];
  const fit = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; ps = Array.from({ length: Math.round(Math.min(46, W / 28)) }, () => mk(true)); };
  const mk = init => ({ x: Math.random() * W, y: init ? Math.random() * H : -20, r: 4 + Math.random() * 7, vy: 22 + Math.random() * 34, vx: -8 + Math.random() * 22, ph: Math.random() * 7, rot: Math.random() * 7, vr: -1.5 + Math.random() * 3, hue: Math.random() < .75 ? '#ffc0d3' : '#ffe6a8' });
  let last = performance.now();
  function tick(t) {
    if (login.classList.contains('hidden') || !login.isConnected || getComputedStyle(login).display === 'none') return;
    requestAnimationFrame(tick);
    const dt = Math.min(.05, (t - last) / 1000); last = t; g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.y += p.vy * dt; p.x += (p.vx + Math.sin(t / 900 + p.ph) * 16) * dt; p.rot += p.vr * dt;
      if (p.y > H + 20 || p.x > W + 30) Object.assign(p, mk(false), { x: Math.random() * W });
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, .55 + Math.abs(Math.sin(t / 700 + p.ph)) * .45); g.globalAlpha = .85; g.fillStyle = p.hue;
      g.beginPath(); g.moveTo(0, -p.r); g.bezierCurveTo(p.r, -p.r * .6, p.r * .9, p.r * .7, 0, p.r); g.bezierCurveTo(-p.r * .9, p.r * .7, -p.r, -p.r * .6, 0, -p.r); g.fill(); g.restore();
    }
  }
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  fit(); addEventListener('resize', fit); requestAnimationFrame(tick);
  const online = () => fetch('/api/status').then(r => r.json()).then(j => { for (const id of ['heroOnline', 'promoOnline']) { const e = document.getElementById(id); if (e) e.innerHTML = j.online > 0 ? `<i></i>ตอนนี้มีคนออนไลน์ ${j.online} คน` : '<i></i>🌸 เมืองกำลังรอคุณอยู่'; } }).catch(() => { });
  online(); setInterval(() => { if (!login.classList.contains('hidden')) online(); }, 20000);
})();
fetch('assets/portraits.json?v=3').then(r => r.json()).then(j => { FACES = j; buildCast(); }).catch(() => { });
const faceHtml = (type, px = 46, alt) => { const g = QUEST_GIVER[type], i = FACES?.faces?.[alt || g?.f]; if (i === undefined) return ''; const n = Object.keys(FACES.faces).length;
  return `<i class="qface" style="width:${px}px;height:${px}px;background-size:${n * px}px ${px}px;background-position:-${i * px}px 0"></i>`; };
function questPop(type, title, line, reward) {
  const g = QUEST_GIVER[type]; if (!g || !FACES) return;
  document.querySelector('.questPop')?.remove();
  const d = document.createElement('div'); d.className = 'questPop';
  d.innerHTML = `${faceHtml(type, 64, g.thxF)}<div><b>${esc(g.name)}</b><span>“${esc(line)}”</span><small>${esc(title)} · <b style="color:var(--acc)">+${money(reward)}</b></small></div>`;
  document.body.appendChild(d); setTimeout(() => d.classList.add('out'), 3800); setTimeout(() => d.remove(), 4400);
}
// ------------------------------------------------------------------ ICU mini-games
// CPR: a ring closes in on the heart on every beat; press when it touches (20 beats). Surgery: a scalpel sweeps the
// incision bar; stop it inside the green zone, 5 steps, each faster with a narrower zone. Results go to the server.
let icuG = null, icuClosedT = 0;
function icuOpen() {
  const c = me?.icu; if (!c || icuG) return;
  closePanel(); dialogClose();
  let d = $('#icuG'); if (!d) { d = document.createElement('div'); d.id = 'icuG'; document.body.appendChild(d); }
  const cpr = c.kind === 'cpr';
  d.innerHTML = `<div class="icuBox"><div class="icuHead"><b>${cpr ? '💓 ปั๊มหัวใจ (CPR)' : '🔪 ผ่าตัดฉุกเฉิน'}</b><small>ผู้ป่วย: ${esc(c.who)}</small></div>
    <canvas id="icuC" width="560" height="300"></canvas><div class="icuMsg" id="icuMsg">${cpr ? 'กดปุ่มตอนวงแหวนหดมาแตะหัวใจ' : 'กดหยุดมีดตอนอยู่ในแถบเขียว'}</div>
    <div class="icuBtns"><button class="primary big" id="icuHit">${cpr ? '💓 ปั๊ม!' : '🔪 กรีด!'}</button><button id="icuQuit">ส่งต่อเคส</button></div></div>`;
  d.classList.remove('hidden');
  icuG = { kind: c.kind, c, t0: performance.now() + 1800, taps: [], pos: [], step: 0, steps: c.zones?.length || 0, fb: [], done: false };
  if (cpr) { icuG.iv = 60000 / c.cpr.bpm; icuG.n = c.cpr.n; }
  const hit = () => icuHit(); $('#icuHit').onpointerdown = e => { e.preventDefault(); hit(); };
  $('#icuQuit').onclick = () => { doAct('icu', 'quit'); icuClosedT = 1; icuClose(); };
  d.onpointerdown = e => { if (e.target.id === 'icuC') { e.preventDefault(); hit(); } };
}
function icuClose() { icuG = null; $('#icuG')?.classList.add('hidden'); }
function icuHit() {
  const g = icuG; if (!g || g.done) return;
  const t = performance.now(); if (t < g.t0 - 300) return;
  if (g.kind === 'cpr') {
    g.taps.push(t); const k = Math.round((t - g.t0) / g.iv), off = t - (g.t0 + k * g.iv), d = Math.abs(off);
    g.fb.push({ t, txt: d <= 70 ? 'เป๊ะ!' : d <= 140 ? 'ดี' : d <= 220 ? 'เกือบ' : 'พลาด', col: d <= 70 ? '#2ecc71' : d <= 140 ? '#f1c40f' : '#e67e22' });
    FX.play(d <= 140 ? 'click' : 'fail');
  } else {
    const p = icuPos(t), z = g.c.zones[g.step], ok = p >= z[0] && p <= z[1];
    g.pos.push(+p.toFixed(3)); g.fb.push({ t, txt: ok ? 'แม่นยำ!' : 'คลาดเคลื่อน', col: ok ? '#2ecc71' : '#e74c3c' }); FX.play(ok ? 'splash' : 'fail');
    g.step++; g.stepT = t + 500;
    if (g.step >= g.steps) icuFinish();
  }
}
const icuPos = t => { const g = icuG; if (!g || g.step >= g.steps) return 0; const st = Math.max(g.t0, g.stepT || 0), ph = ((t - st) / 1000 * g.c.speeds[g.step] * .9) % 2; return ph < 1 ? ph : 2 - ph; };
function icuFinish() {
  const g = icuG; if (!g || g.done) return; g.done = true;
  let payload;
  if (g.kind === 'cpr') {   // for every beat the closest press (ms off), each press counted once
    const used = new Set(), off = [];
    for (let k = 0; k < g.n; k++) { const bt = g.t0 + k * g.iv; let best = null, bi = -1; g.taps.forEach((tp, i) => { if (used.has(i)) return; const d = tp - bt; if (Math.abs(d) <= g.iv / 2 && (best === null || Math.abs(d) < Math.abs(best))) { best = d; bi = i; } }); if (bi >= 0) used.add(bi); off.push(best === null ? null : Math.round(best)); }
    payload = { off };
  } else payload = { pos: g.pos };
  $('#icuMsg').textContent = 'กำลังประเมินผล...';
  icuClosedT = 1; setTimeout(() => { doAct('icu', 'done', payload); icuClose(); }, 700);
}
function icuDraw() {
  const g = icuG; if (!g) return; const c = document.getElementById('icuC'); if (!c) return;
  const x = c.getContext('2d'), W = c.width, H = c.height, t = performance.now(); x.clearRect(0, 0, W, H);
  x.fillStyle = '#0d1b24'; x.fillRect(0, 0, W, H);
  // monitor grid
  x.strokeStyle = 'rgba(80,200,160,.12)'; x.lineWidth = 1; for (let i = 0; i < W; i += 28) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); } for (let j = 0; j < H; j += 28) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (t < g.t0) { x.fillStyle = '#fff'; x.font = '800 64px sans-serif'; x.fillText(Math.ceil((g.t0 - t) / 600), W / 2, H / 2); return; }
  if (g.kind === 'cpr') {
    const k = (t - g.t0) / g.iv, beat = Math.round(k), ph = k - Math.floor(k), cx = W / 2, cy = H / 2 + 10;
    if (k > g.n - .5 && !g.done) return icuFinish();
    // ECG line
    x.strokeStyle = '#3ef0a0'; x.lineWidth = 2.5; x.beginPath();
    for (let i = 0; i < W; i += 3) { const u = ((t / 1000) * 1.8 - i / W * 3) % 1, y = u > .02 && u < .06 ? -40 : u > .06 && u < .09 ? 30 : 0; i ? x.lineTo(i, 52 + y * .6) : x.moveTo(i, 52); } x.stroke();
    // heart + closing ring
    const pulse = 1 + Math.max(0, .18 - Math.abs(ph < .5 ? ph : ph - 1) * .9);
    x.font = `${Math.round(86 * pulse)}px serif`; x.fillText('❤️', cx, cy);
    const rr = 46 + (1 - ph) * 90; x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(62,240,160,.6)'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, 46, 0, 7); x.stroke();
    x.fillStyle = '#9fe'; x.font = '700 18px sans-serif'; x.fillText(`ครั้งที่ ${Math.min(g.n, beat + 1)}/${g.n} · ${g.c.cpr.bpm} ครั้ง/นาที`, cx, H - 22);
  } else {
    const p = icuPos(t), z = g.c.zones[Math.min(g.step, g.steps - 1)], bx = 40, bw = W - 80, by = H / 2 - 22, bh = 44;
    x.fillStyle = '#f2d4c4'; x.beginPath(); x.roundRect(bx, by, bw, bh, 12); x.fill();   // skin
    x.setLineDash([8, 7]); x.strokeStyle = '#7a3b3b'; x.lineWidth = 2; x.beginPath(); x.moveTo(bx + 10, by + bh / 2); x.lineTo(bx + bw - 10, by + bh / 2); x.stroke(); x.setLineDash([]);
    x.fillStyle = 'rgba(46,204,113,.55)'; x.fillRect(bx + z[0] * bw, by - 6, (z[1] - z[0]) * bw, bh + 12);
    g.pos.forEach((q, i) => { x.fillStyle = '#c0392b'; x.fillRect(bx + q * bw - 2, by + 6, 4, bh - 12); });
    if (t > (g.stepT || 0) && g.step < g.steps) { const mx = bx + p * bw; x.font = '34px serif'; x.fillText('🔪', mx, by - 18); x.fillStyle = '#fff'; x.fillRect(mx - 2, by - 4, 4, bh + 8); }
    x.fillStyle = '#9fe'; x.font = '700 18px sans-serif'; x.fillText(`ขั้นที่ ${Math.min(g.step + 1, g.steps)}/${g.steps}`, W / 2, H - 26);
  }
  const f = g.fb[g.fb.length - 1]; if (f && t - f.t < 600) { x.globalAlpha = 1 - (t - f.t) / 600; x.fillStyle = f.col; x.font = '800 30px sans-serif'; x.fillText(f.txt, W / 2, 100 - (t - f.t) / 20); x.globalAlpha = 1; }
}
// ------------------------------------------------------------------ dialog box (talking to people)
// A box at the bottom of the screen: portrait, name, the line typing itself out. Tap = finish the line / next line;
// the last line shows the choices. Portraits: painted faces where the townsperson has one, else their pixel sprite.
const NPC_FACE = { staff_monk: 'monk_m', staff_office: 'office_f', staff_farmer: 'farmer_f', staff_fishing: 'fisher_m', staff_chef: 'chef_m', staff_rider: 'rider_m', staff_merchant: 'grocer_m', staff_police: 'police_m',
  staff_doctor: 'doctor_f', staff_beggar: 'beggar_m', keep_restaurant: 'shop_f', keep_barber: 'barber_m', keep_furnshop: 'thief_m', keep_plantshop: 'farmer_f', keep_police: 'police_f', keep_school: 'elder_m',
  keep_petshop1: 'girl', keep_petshop2: 'folk_m1', keep_cstore: 'sad_f', keep_cstore2: 'student_m', keep_cstore3: 'nurse_f', keep_cstore4: 'grandma', keep_market: 'market_f', keep_estate: 'teacher_f', keep_toolshop: 'worker_m', keep_bank: 'banker_f', keep_office: 'folk_f1', keep_fashion: 'girl', keep_rider: 'folk_m2', keep_dealer: 'folk_m3' };
// what each person talks about: a few short conversations (each a list of lines), picked at random with 💬 คุยต่อ
const TALK = {
  staff_monk: [['วัดนี้สร้างมาตั้งแต่ก่อตั้งเมือง', 'ตีระฆังได้นะโยม เสียงดังกังวานไปทั้งวัด'], ['เขย่าเซียมซีหน้าโบสถ์ดูสิ', 'ใบละสิบบาท ทำบุญเข้าวัดด้วย'], ['ไหว้พระแล้วใจสงบ', 'ทำงานอะไรก็ราบรื่นขึ้น เจริญพร']],
  staff_office: [['บริษัทเราส่งเอกสารไปทั่วเมืองทุกวันเลยค่ะ', 'ยิ่งส่งไกล ค่าส่งยิ่งเยอะนะคะ', 'หลังห้าโมงเย็นยังทำโอทีได้ถึงสามทุ่ม ได้เงินเพิ่มอีกด้วย'], ['ใครอยากเข้ามาทำงานที่นี่ต้องจบปริญญาตรีก่อนนะคะ', 'ไปเรียนที่มหาวิทยาลัยได้ นั่งเรียนครบชั่วโมงก็ได้หนึ่งคาบ'], ['ช่วงนี้ดิฉันอยากได้เก้าอี้ทำงานตัวใหม่จัง', 'ตัวเก่านั่งแล้วปวดหลังมากเลยค่ะ 😅']],
  staff_fishing: [['ตกปลาได้ทุกที่ที่มีน้ำนะ ทะเลสาบ บ่อ ชายหาด', 'ทะเลกับน้ำจืดมีปลาไม่เหมือนกัน ลองไปทั้งสองแบบสิ'], ['เบ็ดดีขึ้น แถบเขียวก็กว้างขึ้น', 'ปลาหายากอย่างปลาทองคำกับโลมาก็กินเบ็ดบ่อยขึ้นด้วย'], ['สมัยหนุ่มๆ น้าเคยตกฉลามได้ด้วยมือเปล่านะ', '...ล้อเล่นน่า ใช้เบ็ดคาร์บอนต่างหาก ฮ่าๆ'], ['สมุดภาพปลาเปิดดูในมือถือได้นะ', 'ลองตกให้ครบทุกชนิดดูสิ ได้ฉายาด้วย']],
  staff_chef: [['อาหารดีเริ่มที่วัตถุดิบดี', 'ปลาสดจากชาวประมง ผักจากชาวไร่ ทำอะไรก็อร่อย'], ['อยากเป็นเชฟต้องมีใบรับรองเชฟก่อนนะ', 'ซื้อได้ที่มหาวิทยาลัย'], ['ต้มยำหม้อนี้ใส่พริกไปสามกำมือ', 'ใครกินไม่ไหวไม่ใช่ความผิดฉันนะ 🌶️']],
  staff_rider: [['ออเดอร์เข้ามาเรื่อยๆ ดูในแอพมือถือนะ', 'ไปรับอาหารที่ร้าน แล้วไปส่งถึงตัวลูกค้า'], ['ใบขับขี่ต้องต่ออายุทุกปีนะ', 'หมดอายุแล้วรับงานไม่ได้ ไปต่อที่โชว์รูมรถ'], ['ฝนตกก็ต้องวิ่งนะ ลูกค้ารออยู่', 'แต่ระวังเป็นหวัดด้วยล่ะ']],
  staff_merchant: [['ที่นี่เป็นโรงประมูลแล้ว ล็อตขึ้นเวทีทีละล็อต', 'ยื่นซองเดาราคาแข่งกับเสี่ยเฮง เจ๊หมวย พวกนั้น'], ['ซื้อได้ต่ำกว่ามูลค่าจริงก็กำไร', 'แต่ถ้าใจร้อนเสนอสูงเกินก็ขาดทุนนะ'], ['ฟังผู้ประเมินไว้บ้าง', 'แต่สภาพของก็สำคัญ ของมีตำหนิราคาตกเยอะ']],
  staff_police: [['ตามหาหมาที่หายไปได้ที่นี่ ค่าตอบแทนดี', 'รับเคสได้ตลอด 24 ชม.'], ['อยากเป็นตำรวจต้องจบ ม.6 และสอบนายสิบตำรวจก่อน', 'ไปเรียนและสอบได้ที่มหาวิทยาลัย'], ['เมืองนี้สงบสุขได้ เพราะทุกคนช่วยกันดูแล']],
  staff_doctor: [['ป่วยแล้วอย่าฝืน มาโรงพยาบาลนะ', 'บอกอาการให้ชัดๆ หมอจะได้รักษาถูก'], ['กินให้ครบ นอนให้พอ', 'ภูมิคุ้มกันจะดีขึ้นเอง']],
  staff_farmer: [['ไร่ชานเมืองปิดปรับปรุงอยู่นะ', 'อีกไม่นานคงได้กลับไปปลูกผักกันอีก'], ['ทุเรียนปลูกนานหน่อย แต่ราคาดีมาก', 'ข้าวโตเร็ว ขายได้ทุกวัน']],
  staff_beggar: [['ลุงไม่มีอะไรเลย มีแต่ใจ', 'แต่คนในเมืองนี้ใจดีนะ'], ['นั่งตรงที่คนพลุกพล่าน', 'ได้เศษเงินบ่อยกว่า']],
  keep_market: [['ตลาดเปิดยี่สิบสี่ชั่วโมงจ้า', 'ซื้อจากผู้เล่นถูกกว่าร้าน NPC นะ ลองดูก่อน'], ['วางขายของได้นะ ตั้งราคาเองเลย', 'แต่อย่าตั้งแพงเกิน เดี๋ยวไม่มีคนซื้อ'], ['ทุเรียนวันนี้หอมมาก', 'เจ๊แอบกินไปลูกนึงแล้ว 🤫']],
  keep_bank: [['ฝากเงินได้ดอกเบี้ยทุกวันเกมนะคะ'], ['ที่นี่มีตลาดหุ้นด้วยนะคะ', 'ซื้อตอนถูก ขายตอนแพง... พูดง่ายทำยากค่ะ 😅'], ['กู้เงินได้ แต่ระหว่างเป็นหนี้ รายได้ส่วนหนึ่งจะถูกหักไปใช้หนี้นะคะ']],
  keep_restaurant: [['หิวไหมจ๊ะ วันนี้มีกะเพราไข่ดาว', 'ซื้อตุนใส่กระเป๋าไว้กินทีหลังก็ได้นะ'], ['ถ้าตัวละครอยากกินอะไร', 'รีบมากินนะ ความสุขเพิ่มเยอะเลย']],
  keep_toolshop: [['เครื่องมือดี งานก็ออกมาดี', 'อัปเกรดอุปกรณ์อาชีพได้ที่นี่ เงินเข้าเพิ่มขึ้นแน่นอน'], ['ร้านนี้ไม่ขายเบ็ดแล้วนะ', 'ไปซื้อกับน้าเล็กที่สมาคมประมง']],
  keep_school: [['การศึกษาคือการลงทุนที่คุ้มที่สุด', 'เรียนจบ ม.6 ก่อน แล้วค่อยต่อปริญญาตรี'], ['นั่งโต๊ะเรียนครบหนึ่งชั่วโมงในเกม ได้หนึ่งคาบ', 'อย่าโดดเรียนล่ะ ครูเห็นนะ 👀'], ['สอบใบขับขี่ สอบนายสิบ ก็ที่นี่']],
  keep_police: [['มีอะไรให้ช่วยไหมคะ', 'ของหาย โดนขโมย มาแจ้งได้เลย'], [ 'อย่าพกเงินสดเยอะ ฝากธนาคารไว้ปลอดภัยกว่า']],
  keep_barber: [['ทุกคนเริ่มด้วยผมสีน้ำตาลเหมือนกัน', 'มาย้อมสีใหม่ ให้ตัวเองดูโดดเด่นสิครับ'], ['สีที่เคยทำไปแล้ว เปลี่ยนกลับได้ฟรีนะ'], ['ทำผมใหม่แล้วความสุขเพิ่มด้วยนะ', 'วิทยาศาสตร์ยืนยัน... มั้งครับ 😆']],
  keep_estate: [['หมู่บ้านเราพิเศษนะคะ บ้านที่เห็นคือบ้านของคนที่อยู่ในเกมตอนนี้', 'ใครออฟไลน์ บ้านก็จะหลบไปก่อน กลับมาเมื่อไหร่ก็มาตั้งใหม่ค่ะ'], ['บ้านทุกหลังมีสวนไว้ปลูกผักด้วยนะคะ', 'ต่อเติมชั้นสองชั้นสามได้ที่บันไดในบ้านค่ะ'], ['ทำงานหนักแล้วอย่าลืมพักนะคะ', 'ไปนั่งเล่นที่จัตุรัสบ้าง ชีวิตจะได้สมดุล']],
  keep_cstore2: [['ผมเรียนอยู่มหาวิทยาลัยครับ ทำงานพิเศษตอนเย็น', 'มาเมืองนี้ใหม่ๆ ยังไม่ค่อยรู้จักใครเลย'], ['ดึกๆ หิวก็แวะมาได้นะครับ', 'ข้าวกล่องอุ่นไมโครเวฟให้ด้วย']],
  keep_petshop1: [['น้องๆ ที่นี่ฉีดวัคซีนครบทุกตัวค่ะ', 'อยากได้ตัวไหน บอกได้เลยนะคะ'], ['สัตว์เลี้ยงเดินตามเราได้ทุกที่เลยค่ะ', 'แตะที่ตัวเขาดู จะกระโดดดีใจด้วยนะ']],
  keep_petshop2: [['ผมเลี้ยงหมามาตั้งแต่เด็กครับ', 'เลยมาเปิดร้านนี้เลย'], ['ตัวหายากอย่างมังกรกับยูนิคอร์น ก็มีนะครับ', 'ต้องเก็บเงินหน่อย แต่คุ้มครับ']],
  keep_cstore4: [['ยายเปิดร้านนี้มาตั้งแต่หมู่บ้านเพิ่งสร้าง', 'เห็นเด็กๆ โตกันมาทุกคนเลย'], ['ผอมลงนะหลาน กินข้าวกินปลาบ้างสิ', 'ข้าวกล่องในตู้อร่อยนะ ยายชิมแล้ว']],
  keep_plantshop: [['ต้นไม้ที่นี่ป้าดูแลเองทุกต้นเลยจ้ะ', 'อยากได้ร่มเงา พุ่มไม้ หรือดอกไม้ บอกป้าได้นะ'], ['ต้นไม้ในบ้านช่วยให้อากาศดี ใจก็สบายด้วยจ้ะ'], ['อยากปลูกผักกินเอง ไปดูแปลงดินที่ร้านเฟอร์นิเจอร์นะ ป้าเอาเมล็ดมาเองไม่ได้ แต่เอาใจช่วยจ้ะ 🌱']],
  keep_furnshop: [['ซื้อเฟอร์นิเจอร์แล้วส่งถึงบ้านเลยครับ', 'จัดวางเองได้ด้วยปุ่ม 🛋️ จัดบ้าน'], ['บ้านสบาย นอนหลับสบาย ความสุขก็เพิ่มขึ้นครับ'], ['ผมใส่ฮู้ดทั้งวันเพราะในร้านแอร์เย็นมากครับ 🥶']],
  cstore: [['เปิดยี่สิบสี่ชั่วโมงทุกวันค่ะ', 'น้ำ ขนม ข้าวกล่อง ยา มีครบ'], ['ดึกๆ หิวก็แวะมาได้นะคะ'], ['รับถุงไหมคะ... อ๋อ ไม่รับ ช่วยโลกด้วย ดีมากค่ะ 🌱']],
  town: [['ได้ยินว่าเที่ยงคืนที่มุมทะเลสาบฝั่งตะวันออก มีอะไรแปลกๆ ว่ายวนอยู่', 'ใครจะไปรู้... อาจเป็นแค่ข่าวลือก็ได้'],
    ['ลือกันว่านายกฯ ชอบปลอมตัวเป็นคนธรรมดามาเดินเล่นในเมือง', 'ถ้าเห็นใครท่าทางแปลกๆ ลองเดินไปทักใกล้ๆ ดูสิ'],
    ['เคยลองโยนเหรียญที่น้ำพุกลางเมืองไหม', 'เขาว่าน้ำพุทำนายดวงได้ บางทีก็คืนเงินให้ด้วยนะ'],
    ['มีคนบอกว่าเจอป้ายเล็กๆ ซ่อนอยู่ตามมุมเมืองที่ไม่ค่อยมีใครเดินไป', 'หลังตึกใหญ่ ริมขอบเมือง... ใครจะไปรู้มีกี่ป้าย'], ['วันนี้อากาศดีจังเลย', 'เหมาะกับการไปนั่งเล่นที่จัตุรัส'], ['ได้ยินว่ามีคนตกปลาทองคำได้ด้วยนะ', 'ฉันลองมาทั้งเดือนยังไม่เคยเห็นเลย'], ['ค่าไฟเดือนนี้แพงจัง', 'คงต้องเปิดแอร์น้อยลงหน่อย'], [ 'ช่วงนี้มีข่าวบ่อย'], ['เคยไปทะเลฝั่งตะวันออกหรือยัง', 'ตอนเย็นสวยมากเลย'], ['หมอที่โรงพยาบาลเก่งมาก', 'รักษาไข้หวัดหายในวันเดียว']],
};
let dlgQ = null;
function dlgFace(face, npc) {
  const z = innerWidth <= 600 ? 64 : 84;
  if (face && FACES?.faces?.[face] !== undefined) { const i = FACES.faces[face], n = Object.keys(FACES.faces).length; return `<i class="qface dlgPic" style="width:${z}px;height:${z}px;background-size:${n * z}px ${z}px;background-position:-${i * z}px 0"></i>`; }
  return npc ? `<canvas class="dlgPic dlgPix" data-dlg="${esc(npc)}" width="84" height="84"></canvas>` : '';
}
// opts: { name, face (painted face id), npc (staff id or player id for the pixel portrait), lines: [], choices: [{ label, fn, cls }] }
function dialog(opts) {
  closePanel();
  dlgQ = { ...opts, i: 0, shown: 0, t0: performance.now() };
  let d = $('#dlg');
  if (!d) { d = document.createElement('div'); d.id = 'dlg'; document.body.appendChild(d); d.onclick = e => { if (e.target.closest('button')) return; dlgTap(); }; }
  d.innerHTML = `${dlgFace(opts.face, opts.npc)}<div class="dlgBody"><b class="dlgName">${esc(opts.name)}</b><p class="dlgText"></p><div class="dlgCh"></div><i class="dlgNext">▼</i></div><button class="dlgX">✕</button>`;
  d.querySelector('.dlgX').onclick = () => dialogClose();
  d.classList.remove('hidden');
  const c = d.querySelector('[data-dlg]');
  if (c) whenChars(() => { const n = STAFF.find(x => x.id === c.dataset.dlg) || (c.dataset.dlg === 'misnpc' ? MISNPC : null) || P.get(+c.dataset.dlg); if (!n) return; const g = c.getContext('2d'); g.clearRect(0, 0, 84, 84); drawCharTo(g, n, 42, 150, 150 / CH_ATLAS.h, 'front', 0); });
  dlgRender();
}
function dialogClose() { dlgQ = null; $('#dlg')?.classList.add('hidden'); }
function dlgRender() {
  const d = $('#dlg'); if (!d || !dlgQ) return;
  const line = dlgQ.lines[dlgQ.i] || '', last = dlgQ.i >= dlgQ.lines.length - 1, done = dlgQ.shown >= line.length;
  const fc = dlgQ.faces?.[dlgQ.i];   // a different expression for this line
  if (fc && fc !== dlgQ.curFace) { dlgQ.curFace = fc; const old = d.querySelector('.dlgPic'); if (old) old.outerHTML = dlgFace(fc); }
  d.querySelector('.dlgText').textContent = line.slice(0, Math.floor(dlgQ.shown));
  d.querySelector('.dlgNext').style.visibility = done && !last ? 'visible' : 'hidden';
  const ch = d.querySelector('.dlgCh');
  if (done && last && !ch.dataset.on) {
    ch.dataset.on = 1;
    const list = dlgQ.choices?.length ? dlgQ.choices : [{ label: '👋 ลาก่อน', fn: () => dialogClose() }];
    ch.innerHTML = list.map((c, k) => `<button data-k="${k}" class="${c.cls || ''}">${esc(c.label)}</button>`).join('');
    ch.querySelectorAll('button').forEach(b => b.onclick = () => { FX.play('click'); const c = list[+b.dataset.k]; c.fn ? c.fn() : dialogClose(); });
  }
}
function dlgTick() {   // called every frame: types the current line out
  if (!dlgQ) return;
  const line = dlgQ.lines[dlgQ.i] || '';
  if (dlgQ.shown < line.length) { dlgQ.shown = Math.min(line.length, dlgQ.shown + 0.9); dlgRender(); }
}
function dlgTap() {
  if (!dlgQ) return;
  const line = dlgQ.lines[dlgQ.i] || '';
  if (dlgQ.shown < line.length) { dlgQ.shown = line.length; return dlgRender(); }
  if (dlgQ.i < dlgQ.lines.length - 1) { dlgQ.i++; dlgQ.shown = 0; FX.play('click'); dlgRender(); }
  else if (!dlgQ.choices?.length) dialogClose();
}
// talking to a shop or job NPC: greeting, then choose: use the place / chat more / bye. Quick repeat visits skip the chat.
const talkedAt = {};
// 💁 พี่ฟ้า, the town guide: what to do next, how things work, and a walk-you-there arrow
const GUIDE_HI = ['สวัสดีจ้า มาใหม่ใช่ไหม? ถามพี่ได้ทุกเรื่องเลย', 'งงตรงไหน ถามพี่ฟ้าได้นะ', 'อยากรู้วิธีหาเงิน หางาน หรือที่เที่ยว ถามพี่ได้เลย'];
const GUIDE_TOPICS = [
  ['💰 หาเงินยังไงดี', ['เริ่มง่ายสุดคือตกปลาจ้า ซื้อเบ็ด ฿150 ที่สมาคมประมงกับน้าเล็ก แล้วไปตกที่ท่าน้ำ', 'ได้ปลาแล้วเอาไปขายที่สมาคมประมง ปลาหายากราคาดีมาก', 'มีเงินแล้วไปเรียนที่มหาวิทยาลัย ได้ใบรับรองแล้วสมัครงานดีๆ ได้เงินมากขึ้น']],
  ['💼 มีอาชีพอะไรบ้าง', ['พนักงานบริษัท · พ่อค้า · หมอ · ไรเดอร์ · ตำรวจ · ขอทาน', 'แต่ละอาชีพต้องมีใบรับรองจากมหาวิทยาลัยก่อน แล้วไปสมัครกับเจ้าหน้าที่ที่ทำงานนั้น', 'เปลี่ยนงานบ่อยๆ ต้องรอคูลดาวน์นะ เลือกให้ดีล่ะ']],
  ['⚡ พลังงาน / อิ่ม / เลือด', ['ทำงาน ทำเควส ตกปลา ล้วนใช้พลังงาน ⚡ ถ้าหมดจะทำอะไรไม่ได้', 'กินข้าวที่ร้านอาหารหรือร้านสะดวกซื้อเพื่อให้อิ่ม นอนพักที่บ้านหรือนั่งม้านั่งก็ได้พลังคืน', 'ที่ฟื้นไวสุดคือสวนสนุก! เล่นเครื่องเล่นแล้วได้พลังงาน เลือด และความสุขทุกวินาที']],
  ['🎡 ที่เที่ยว / เดินทาง', ['สวนสนุกอยู่สุดถนนเส้นหลักด้านใต้ หมู่บ้านจัดสรรอยู่สุดถนนด้านเหนือ', 'ขี้เกียจเดิน? โทรเรียกแท็กซี่ 888-888 หรือกดแอพแท็กซี่ในมือถือ ไปส่งถึงหน้าประตู', 'มีเงินแล้วซื้อมอไซค์หรือรถที่โชว์รูมรถ ให้เพื่อนซ้อนท้ายได้ด้วยนะ']],
  ['📱 มือถือทำอะไรได้', ['มือถือมีทุกอย่าง: โทรหาเพื่อน แชท สั่งอาหาร ซื้อหุ้น จ่ายบิล ดูเควส', 'ขอเบอร์เพื่อนได้โดยแตะที่ตัวเพื่อนแล้วกด "ขอเบอร์"', 'เควสประจำวันทำครบได้รางวัลด้วยนะ ดูได้มุมซ้ายบน']],
];
const GUIDE_GO = [['🎣 น้าเล็ก (ซื้อเบ็ด)', 'staff_fishing'], ['🎓 มหาวิทยาลัย', 'door_school'], ['🍜 ร้านอาหาร', 'door_restaurant'], ['🏦 ธนาคาร', 'door_bank'], ['🚗 โชว์รูมรถ', 'door_dealer'], ['🎡 สวนสนุก', 'ride_carousel'], ['⚽ สนามฟุตบอล', 'seat_fb8_0']];
function guideTalk(n) {
  const base = { name: n.name, npc: n.id };
  const menu = (lines) => dialog({ ...base, lines, choices: [
    ...GUIDE_TOPICS.map(([l, ls]) => ({ label: l, fn: () => menu(ls) })),
    { label: '🧭 พาไปที่...', fn: () => dialog({ ...base, lines: ['อยากไปไหนจ๊ะ เดี๋ยวพี่ชี้ทางให้ เดินตามลูกศรสีเหลืองไปได้เลย'], choices: [...GUIDE_GO.map(([l, k]) => ({ label: l, fn: () => { dialogClose(); setGuide(k); } })), { label: '↩️ กลับ', fn: () => menu(['มีอะไรอยากถามอีกไหมจ๊ะ']) }] }) },
    { label: '👋 ขอบคุณครับ', fn: dialogClose, cls: 'primary' }] });
  const tip = !me.vehicles?.length && (me.money || 0) < 2000 ? 'ยังไม่มีเงินใช่ไหม ลองไปตกปลาก่อนเลย พี่พาไปหาน้าเล็กได้นะ' : me.career === 'none' ? 'ยังไม่มีงานทำเหรอ ลองดูว่ามีอาชีพอะไรบ้างสิ' : 'วันนี้อยากรู้อะไรจ๊ะ';
  menu([`สวัสดีจ้า ${me.name || ''}! พี่ฟ้าประจำจุดแนะนำเมืองจ้า`, tip]);
}
function talkTo(n, st) {
  const now = performance.now(), quick = now - (talkedAt[n.id] || -1e9) < 90000; talkedAt[n.id] = now;
  const openIt = () => { dialogClose(); openPanel({ kind: STN(st)?.type || 'staff', st }); };
  if (quick) return openIt();
  const key = n.id.startsWith('keep_cstore') ? 'cstore' : n.id, topics = TALK[key] || TALK.town;
  const act = n.keeper ? '🛒 ดูร้าน / ใช้บริการ' : n.career === 'fishing' ? '🎣 ดูเบ็ด' : me.career === n.career ? '📋 ดูงาน' : '📝 สมัครงาน';
  const more = () => dialog({ ...base, lines: [...topics[Math.floor(Math.random() * topics.length)]], choices });
  const base = { name: n.name, face: NPC_FACE[n.id], npc: n.id };
  const misOk = !n.keeper && MIS_CAREERS.includes(n.career) && job(n.career);
  const mis = misOk ? [me.mis ? { label: '📋 ภารกิจที่ทำอยู่', fn: () => { dialogClose(); openPanel({ kind: 'career' }); } } : { label: '📋 รับภารกิจ (⚡5)', fn: () => { dialogClose(); send({ t: 'mission', op: 'start', car: n.career, st }); }, cls: 'good' }] : [];
  const choices = [{ label: act, fn: openIt, cls: 'primary' }, ...mis, { label: '💬 คุยต่อ', fn: more }, { label: '👋 ลาก่อน', fn: dialogClose }];
  const hi = (n.line ? n.line(me) : '').trim() || 'สวัสดี';
  dialog({ ...base, lines: [hi], choices });
}
// tapping a townsperson NPC: a short chat (with their portrait), the profile one tap away
const FOLK_TALK = {
  folk_m1: [['เพิ่งเลิกงานมาครับ วันนี้ส่งเอกสารไปสิบรอบ', 'ขาลากเลย ฮ่าๆ'], ['ถ้าอยากทำงานบริษัท ต้องเรียนจบปริญญาตรีก่อนนะครับ']],
  folk_f1: [['กำลังจะไปธนาคารค่ะ', 'ได้ยินว่าหุ้นตัวหนึ่งขึ้นแรงมาก'], ['ร้านทำผมเปิดใหม่ข้างในแล้วนะคะ', 'ตกแต่งสวยมาก']],
  folk_f2: [['ป้าขายข้าวแกงอยู่แถวตลาด', 'หิวก็แวะมานะลูก'], ['เดี๋ยวนี้เมืองเราคนเยอะขึ้นเยอะเลย', 'ดีใจจริงๆ']],
  folk_m2: [['วันนี้แดดแรงจัง', 'เลยใส่หมวกออกมา'], ['ไปตกปลาริมหาดมา ได้ปลาทูสองตัว', 'คืนนี้ทอดกินพอดี']],
  folk_m3: [['กำลังเก็บเงินซื้อบ้านในหมู่บ้านจัดสรรครับ', 'อีกนิดเดียว!'], ['เคยลองตกปลาที่ทะเลสาบไหม', 'ปลาน้ำจืดเยอะมาก']],
  folk_f3: [['ป้าอยู่หมู่บ้านนี้มาสิบปีแล้ว', 'เพื่อนบ้านน่ารักทุกคน'], ['ปลูกผักในลานบ้านสนุกนะ', 'ลองดูสิ']],
  folk_m4: [['สมัยตาหนุ่มๆ ที่นี่ยังเป็นทุ่งนาอยู่เลย', 'เดี๋ยวนี้มีร้านสะดวกซื้อแล้ว สะดวกจริงๆ'], ['ออกมาเดินเล่นทุกเย็น', 'หมอบอกว่าดีต่อสุขภาพ']],
  folk_m5: [['เพิ่งเลิกเรียนครับ', 'การบ้านเยอะมากเลย 😩'], ['โตขึ้นผมอยากเป็นตำรวจ', 'ต้องเรียนให้จบ ม.6 ก่อน']],
};
// easter eggs: coin in the fountain, a secret sign, the disguised mayor, the legendary fish
function eggFx(m) {
  document.querySelectorAll('#reqs .req.egg').forEach(e => e.remove());
  const pop = (...a) => popup(...a).classList.add('egg');
  const s = P.get(myId), x = s?.x || 50, y = s?.y || 35;
  if (m.k === 'wish') {
    FX.play('coin'); FX.float(50, 33.2, '🪙', '#ffd34d', .5); FX.ring(50, 33.6, '#bfe8ff', 700, 1.2);
    if (m.win) { FX.play('coin', true); FX.play('levelup'); for (let i = 0; i < 4; i++) setTimeout(() => { FX.burst(50 + (Math.random() - .5) * 2, 33 + (Math.random() - .5), '#ffd34d', 26); FX.ring(50, 33.6, '#ffe58a', 1000, 2.4); }, i * 220); }
    pop(`⛲ <b>คำทำนายจากน้ำพุ</b><br>"${esc(m.f)}"${m.win ? `<br><br>✨ <b>น้ำพุคืนโชคให้คุณ ${money(m.win)}!</b>` : ''}`, [['🙏 สาธุ', 'good', () => { }]], m.win ? 12000 : 6000);
  } else if (m.k === 'secret') {
    FX.play('chime'); FX.burst(x, y - .6, '#9be7ff', 22); FX.ring(x, y, '#ffffff', 900, 1.6);
    pop(`🪧 <b>"คุณเจอที่ลับแล้ว!"</b><br>ได้ 💎${m.gems} · เจอแล้ว ${m.n}/5 จุด${m.frame ? `<br><br>🖼️ <b>เจอครบทุกจุด! ได้กรอบพิเศษ "${esc(m.frame)}"</b> ใส่ได้ที่โปรไฟล์ → กรอบรูป` : ''}`, [['เยี่ยม!', 'good', () => { }]], 10000);
  } else if (m.k === 'mayor') {
    closePanel(); FX.play(m.again ? 'pop' : 'levelup');
    if (!m.again) { FX.burst(x, y - .6, '#ffd34d', 30); FX.ring(x, y, '#ffd34d', 1000, 2); }
    dialog({ name: `${m.name} (นายกฯ ปลอมตัว)`, face: null, lines: m.again ? ['ชู่ว์... วันนี้คุณจับผมได้แล้วนะ', 'พรุ่งนี้ผมจะปลอมตัวให้เนียนกว่านี้!'] : ['เอ๊ะ! จำผมได้ด้วยเหรอเนี่ย', 'ผมนายกฯ เอง แอบปลอมตัวมาดูชีวิตชาวเมือง', `เก่งมาก! รับ 💎${m.gems} ไปเลย แล้วอย่าบอกใครว่าผมปลอมตัวเป็นใครนะ... อ้าว ประกาศไปแล้ว`], choices: [{ label: '😆 แล้วเจอกันใหม่', fn: dialogClose }] });
  } else if (m.k === 'legend') {
    FX.play('levelup'); for (let i = 0; i < 6; i++) setTimeout(() => { FX.burst(x + (Math.random() - .5) * 2, y - .8, `hsl(${i * 60},95%,65%)`, 26); FX.ring(x, y, `hsl(${i * 60 + 30},95%,70%)`, 1100, 2.6); }, i * 200);
  }
}
function talkToTown(o) {
  if (o.umb) {   // ☂️ the umbrella man in the square (only while it rains)
    const has = (me?.inv?.umbrella || 0) > 0;
    return dialog({ name: o.name, face: null, npc: o.id, lines: has ? ['ฝนตกหนักเลยนะ', 'อ้าว มีร่มแล้วนี่ ดีแล้วๆ ไม่เปียกไม่เป็นหวัด'] : ['ร่มจ้า ร่ม! ฝนตกแบบนี้ไม่มีร่มเดี๋ยวก็เป็นหวัด', `คันละ ${money(o.umb)} ซื้อครั้งเดียวใช้ได้ตลอด`, 'เก็บไว้ในกระเป๋า ฝนตกตอนอยู่ข้างนอกจะกางให้เอง'],
      choices: [...(has ? [] : [{ label: `☂️ ซื้อร่ม ${money(o.umb)}`, cls: 'primary', fn: () => { send({ t: 'umbbuy' }); dialogClose(); } }]), { label: '👋 ลาก่อน', fn: dialogClose }] });
  }
  send({ t: 'npctalk', id: o.id });
  const info = { label: '👤 ดูข้อมูล', fn: () => { dialogClose(); openPanel({ kind: 'player', pid: o.id }); } }, bye = { label: '👋 ลาก่อน', fn: dialogClose };
  if (/^mprang/.test(o.face)) {   // น้องมะปราง changes expression as she talks
    const q = me.quests?.list.find(x => x.type === 'trade');
    const lines = q && !q.done ? ['สวัสดีค่ะ! หนูชื่อมะปราง', 'อยากลองแลกของกับคนอื่นจัง... ช่วยหนูหน่อยได้ไหมคะ', 'ถ้าพี่แลกของสำเร็จ หนูจะดีใจมากเลย! ว้าว!', 'ไว้เจอกันใหม่นะคะ บ๊ายบาย!']
      : ['สวัสดีค่ะ! หนูชื่อมะปราง', 'วันนี้หนูได้แลกสติกเกอร์กับพี่ข้างบ้านด้วย... เขินจัง', 'รู้ไหมคะ ที่ทะเลมีคนตกโลมาได้ด้วยนะ! ว้าว!', 'ไว้เจอกันใหม่นะคะ บ๊ายบาย!'];
    return dialog({ name: o.name, face: 'mprang_happy', faces: ['mprang_happy', 'mprang_shy', 'mprang_wow', 'mprang_wave'], npc: o.id, lines, choices: [info, bye] });
  }
  const pool = FOLK_TALK[o.face] || TALK.town, t = pool[Math.floor(Math.random() * pool.length)];
  dialog({ name: o.name, face: o.face || null, npc: o.id, lines: ['สวัสดีจ้า', ...t], choices: [info, { label: '💬 คุยต่อ', fn: () => talkToTown(o) }, bye] });
}
// quest givers talk too (tap their portrait in the quest list)
function talkQuest(type) {
  const g = QUEST_GIVER[type], x = me.quests?.list.find(q => q.type === type) || me.wquests?.list.find(q => q.type === type); if (!g) return;
  const lines = x?.done ? [g.thx, 'มีอะไรให้ช่วยอีกก็มาบอกนะ'] : [g.ask, x ? `ฝากด้วยนะ: ${x.text} (ตอนนี้ ${x.p.toLocaleString()}/${x.n.toLocaleString()})` : 'ฝากด้วยนะ', `ทำสำเร็จ ได้รางวัล ${money(x?.reward || 0)}`];
  dialog({ name: g.name, face: g.f, lines, choices: [{ label: '📜 กลับไปหน้าเควสต์', fn: () => { dialogClose(); openPanel({ kind: 'quests' }); }, cls: 'primary' }, { label: '👋 ลาก่อน', fn: dialogClose }] });
}
// 📖 fish book: every species with its sprite; ones you have not caught yet are dark silhouettes
function fishBook() {
  const all = Object.entries(G.items).filter(([, it]) => it.kind === 'fish' && it.rar && it.spr).sort((a, b) => a[1].rar - b[1].rar || a[1].base - b[1].base);
  const dex = me.fishdex || {}, got = all.filter(([id]) => dex[id]).length;
  const cell = ([id, it]) => `<div class="fbook ${dex[id] ? 'got' : ''} r${it.rar}" title="${esc(it.name)}"><canvas class="fspr" data-spr="${it.spr}" width="56" height="40"></canvas><small>${dex[id] ? esc(it.name) : '???'}</small>${dex[id] ? `<em>x${dex[id]}</em>` : ''}</div>`;
  const cells = [...new Set(all.map(([, it]) => it.rar))].map(r => { const g = all.filter(([, it]) => it.rar === r); return `<div class="fbookH"><span class="rtag r${r}">${G.fishRarity[r] || RAR[r]}</span> <small>${g.filter(([id]) => dex[id]).length}/${g.length}</small></div><div class="fbookGrid">${g.map(cell).join('')}</div>`; }).join('');
  return `<div class="secT" style="margin-top:14px">📖 สมุดภาพปลา ${got}/${all.length}</div>
    <div class="sub">${[1, 2, 3, 4, 5].map(r => `<span class="rtag r${r}">${G.fishRarity[r]}</span>`).join('')} · ยิ่งหายากยิ่งราคาดี · เบ็ดที่ดีขึ้นทำให้ปลาหายากกินเบ็ดบ่อยขึ้น</div>${cells}`;
}
// rods: the shop list at the fishing club (st) or the bag list (no st): stats, buy, hold
function rodRows(st) {
  const have = me.rods || [];
  return G.rodOrder.filter(k => st || have.includes(k)).map(k => {
    const r = G.rods[k], own = have.includes(k), on = me.rodEq === k;
    const stats = `ตวัดง่าย/สายเหนียว ${Math.round(r.zone * 100)}% · โชคปลาหายาก x${r.luck} · ขยะ ${Math.round(r.junk * 100)}%`;
    const btn = own ? B(on ? 'ถืออยู่ ✓' : 'ถือเบ็ดนี้', { t: 'rod', id: k }, on ? 'primary' : 'good', on) : B(money(r.price), { t: 'act', st, a: 'rod', rod: k }, 'good', me.money < r.price);
    return itemRowRaw(r.icon, `${esc(r.name)}${on ? ' <span class="tag">ในมือ</span>' : ''}`, `${esc(r.desc)} · ${stats}`, btn);
  }).join('') || '<div class="sub">ยังไม่มีเบ็ด · ซื้อได้กับน้าเล็กที่สมาคมประมง</div>';
}
// fishing anywhere: standing at the water's edge with a rod makes a fishing spot right where you are
function waterPoolAt(x, y) {
  let best = null, bd = 1.7;
  for (let j = Math.floor(y) - 2; j <= Math.floor(y) + 2; j++) for (let i = Math.floor(x) - 2; i <= Math.floor(x) + 2; i++) {
    if (tileAt(i, j) !== 'w') continue;
    const d = Math.hypot(Math.max(i - x, 0, x - i - 1), Math.max(j - y, 0, y - j - 1));
    if (d < bd) { bd = d; best = [i, j]; }
  }
  if (!best) return null;
  const a = areaOf(best[0] + .5, best[1] + .5); if (!a || a.kind !== 'map') return null;
  return a.id === 'farm' ? 'river' : a.id === 'town' && best[0] >= 100 ? 'sea' : 'lake';
}
let waterNear = null;
const POOL_NAME = { sea: '🌊 ทะเล', lake: '🏞️ น้ำจืด (ทะเลสาบ/บ่อ)', river: '🐟 แม่น้ำ' };
// draws atlas sprites into <canvas data-spr> (furniture/vehicles stand on the bottom edge, fish (.fspr) are centred and can scale up)
// 🪪 profile showcase: the car at the back, the character always in front of it, the pet beside
function drawShow(c) {
  const d = JSON.parse(c.dataset.show || '{}'), cs = d.car && `w_${d.car}_s`;
  if (!chImg || (cs && (!atlas || !atlasImg)) || (d.pet && (!PET_AT || !petImg))) return setTimeout(() => drawShow(c), 300);
  const g = c.getContext('2d'), W = c.width, H = c.height; g.clearRect(0, 0, W, H);
  const sp = cs && atlas.sprites[cs];
  if (sp) { const k = Math.min(W * .78 / sp[2], H * .62 / sp[3]); g.imageSmoothingEnabled = k < 1; g.drawImage(atlasImg, sp[0], sp[1], sp[2], sp[3], (W - sp[2] * k) / 2 - (d.pet ? 10 : 0), H - 8 - sp[3] * k, sp[2] * k, sp[3] * k); }
  const meta = d.pet && PET_AT.pets[d.pet];
  if (meta) { const C = PET_AT.cell, [bx, by, bw, bh] = petBox(meta.row), k = Math.min(H * .34 / bh, W * .2 / bw); g.imageSmoothingEnabled = true; g.drawImage(petImg, bx, meta.row * C + by, bw, bh, W * .74 - bw * k / 2, H - 6 - bh * k, bw * k, bh * k); }
  drawCharTo(g, { g: d.g, lk: d.lk || {}, of: d.of || '' }, sp || meta ? W * .42 : W / 2, H - 6, H * .78 / CH_ATLAS.h, 'front', 0);
}
const showCv = (sh, w = 260, h = 150) => `<div class="showBox"><canvas data-show="${esc(JSON.stringify(sh))}" width="${w}" height="${h}"></canvas></div>`;
function bindSpr(root) {
  root.querySelectorAll('[data-spr]').forEach(c => { const draw = () => { const sp = atlas?.sprites?.[c.dataset.spr]; if (!sp || !atlasImg) return setTimeout(draw, 300);
    const fish = c.classList.contains('fspr'), fit = c.classList.contains('vfit'), g = c.getContext('2d'), k = fish ? Math.min((c.width - 2) / sp[2], (c.height - 2) / sp[3]) : fit ? Math.min((c.width - 20) / sp[2], (c.height - 14) / sp[3]) : Math.min((c.width - 8) / sp[2], (c.height - 6) / sp[3], 1.6);
    g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = !fish || k < 1;
    g.drawImage(atlasImg, sp[0], sp[1], sp[2], sp[3], (c.width - sp[2] * k) / 2, fish ? (c.height - sp[3] * k) / 2 : c.height - 3 - sp[3] * k, sp[2] * k, sp[3] * k); }; draw(); });
}
function catchPop(id, first) {
  const it = G.items[id]; if (!it?.spr) return;
  document.querySelector('.catchPop')?.remove();
  const d = document.createElement('div'); d.className = `catchPop r${it.rar}`;
  d.innerHTML = `<canvas class="fspr" data-spr="${it.spr}" width="150" height="100"></canvas><b>${esc(it.name)}</b>${rarTag(id)}${first ? '<small>📖 ชนิดใหม่! บันทึกลงสมุดภาพปลาแล้ว</small>' : `<small>~${money(it.base)}</small>`}`;
  document.body.appendChild(d); bindSpr(d); setTimeout(() => d.classList.add('out'), 2600); setTimeout(() => d.remove(), 3200);
}
// item icon: fish have their own pixel sprite; everything else is an emoji. Fish also carry a rarity tag.
const itemIco = (id, w = 40, h = 30) => { const it = G.items[id]; return it?.spr ? `<canvas class="fspr" data-spr="${it.spr}" width="${w}" height="${h}"></canvas>` : (it?.icon || ''); };
const rarTag = id => { const r = G.items[id]?.rar; return r ? `<span class="rtag r${r}">${G.fishRarity?.[r] || ''}</span>` : ''; };
const itemRow = (id, right, sub = '') => { const it = G.items[id]; return `<div class="item"><div class="em">${itemIco(id)}</div><div class="nm">${esc(it.name)}${rarTag(id)}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; };
function itemRowRaw(icon, name, sub, right) { return `<div class="item"><div class="em">${icon}</div><div class="nm">${name}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; }
const eatText = e => [e.hunger && `อิ่ม+${e.hunger}`, e.energy && `⚡+${e.energy}`, e.health && `❤️+${e.health}`].filter(Boolean).join(' ');
let chatTab = 'all', worldAt = 0;
// world chat: one line every 3 seconds. Too soon -> say so and keep what was typed, so nothing is lost
function worldOk(ch) {
  if (ch !== 'world') return true;
  const left = Math.ceil((worldAt + 3000 - Date.now()) / 1000);
  if (left > 0) { toast(`แชทโลกส่งได้ทุก 3 วินาที · รออีก ${left} วินาที แล้วกดส่งใหม่ได้เลย (ข้อความยังอยู่ในช่องพิมพ์)`, '💬', false); return false; }
  worldAt = Date.now(); return true;
}
const chatHtml = () => chatLog.filter(m => chatTab === 'all' ? !m.sys : m.sys || (chatTab === 'world' ? m.w : !m.w)).map(m => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div class="${m.w ? 'w' : ''}"><b${m.adm ? ' class="admN"' : ''}>${m.adm ? '👑 ' : ''}${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');
// ---- profile photo, titles by rarity, mail
let myPic = '', mailList = [], tradeChat = [];
const infoCache = new Map();
const facePng = () => `assets/ui/face_${me?.gender === 'f' ? 'f' : 'm'}.png`;
function paintPortrait() {
  const im = $('#mePortrait'); const src = myPic || facePng(); if (im.getAttribute('src') !== src) im.src = src;
  const box = im.parentElement, f = me?.frame ?? -1; let el = box.querySelector('.pfx');
  box.classList.toggle('hasFrame', f >= 0);
  if (f < 0) { el?.remove(); return; }
  const sz = Math.round(im.getBoundingClientRect().width * 1.62) || 100, html = frameHtml(f, sz);
  if (!el || el.dataset.k !== f + ':' + sz) { el?.remove(); box.insertAdjacentHTML('beforeend', html); }
}
// a profile frame drawn over a photo of size ~ sz/1.6 centred in the same box (the frame's hole sits on the centre)
let FRAMES_AT = null;
fetch('assets/frames.json?v=2').then(r => r.json()).then(j => { FRAMES_AT = j; if (me) paintPortrait(); }).catch(() => { });
function frameHtml(id, sz, fit = true) {
  if (!FRAMES_AT || id < 0) return '';
  const [hx, hy] = FRAMES_AT.holes[id] || [.5, .5], c = FRAMES_AT.cols, sp = id >= 24, sz0 = sz;
  // fit: the frame grows a little (the layout makes room for it) and the photo shrinks a little so the photo fills the frame's hole without the ring covering it
  let ps = 100;
  if (fit && FRAMES_AT.hr?.[id]) { sz = Math.round(sz * 1.18); ps = Math.max(80, Math.min(100, Math.round(2 * FRAMES_AT.hr[id] * sz / (sz0 / 1.62) * 1.06 * 50) * 2)); }
  return `<span class="pfx ${sp ? 'sp g' + id : ''}" data-k="${id}:${sz0}" data-ps="${ps}" style="--fs:${sz}px;background-position:${-(id % c) * sz}px ${-Math.floor(id / c) * sz}px;transform:translate(${Math.round(-hx * sz)}px,${Math.round(-hy * sz)}px)"></span>`;
}
let godFindRes = null, ledgerRes = null, payRes = null, payAdm = null, payBackRef = '';
const paySel = { pack: 'p100', m: 'slip' };
let payOpenRef = '';
// 💎 PromptPay QR (draw) and slip QR (read): small libraries, loaded only when the top-up shop opens
const libLoad = {};
const loadLib = (k, src) => libLoad[k] || (libLoad[k] = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => { delete libLoad[k]; no(new Error('load ' + k)); }; document.head.appendChild(sc); }));
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
async function readSlipQR(file) {
  const bmp = await createImageBitmap(file);
  const tries = [1400, 900, 2000, 600];
  if ('BarcodeDetector' in window) { try { const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp); if (r[0]?.rawValue) return r[0].rawValue; } catch { } }
  await loadLib('jsqr', JSQR_LIB);
  for (const mx of tries) {
    const k = Math.min(1, mx / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return '';
}
function bindPay(root) {
  const cv = root.querySelector('#payQr');
  if (cv && cv.dataset.qr) loadLib('qr', QR_LIB).then(() => {
    const q = window.qrcode(0, 'M'); q.addData(cv.dataset.qr); q.make();
    const n = q.getModuleCount(), cell = Math.max(4, Math.floor(260 / (n + 8))), sz = cell * (n + 8), g = cv.getContext('2d');
    cv.width = cv.height = sz; g.fillStyle = '#fff'; g.fillRect(0, 0, sz, sz); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
    const sv = root.querySelector('#payQrSave'); if (sv) sv.onclick = () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `promptpay-${cv.dataset.ref}.png`; a.click(); };
  }).catch(() => { cv.replaceWith(Object.assign(document.createElement('div'), { className: 'sub', textContent: 'โหลด QR ไม่สำเร็จ ลองปิดแล้วเปิดใหม่ หรือโอนเข้าพร้อมเพย์ตามเลขด้านล่าง' })); });
  const f = root.querySelector('#paySlip'), pk = root.querySelector('#paySlipPick');
  if (pk && f) pk.onclick = () => f.click();
  if (f) f.onchange = async () => {
    const file = f.files?.[0]; f.value = ''; if (!file) return;
    toast('กำลังอ่านสลิป…', '📷');
    let qr = ''; try { qr = await readSlipQR(file); } catch { }
    if (!qr) return toast('หา QR บนสลิปไม่เจอ ใช้รูปสลิปเต็มใบที่บันทึกจากแอปธนาคาร (อย่าครอปจนตัด QR)', '📷', false);
    send({ t: 'pay', op: 'slip', ref: f.dataset.ref, qr });
  };
}
try { const q = new URLSearchParams(location.search); if (q.get('paid')) payBackRef = q.get('paid').replace(/\D/g, '').slice(0, 20); if (q.get('paid') || q.get('paycancel')) history.replaceState(null, '', location.pathname); } catch { }
const PAY_ST = { new: ['⏳ รอชำระ', 'var(--muted,#999)'], paid: ['✅ สำเร็จ', 'var(--good)'], review: ['🔎 รอตรวจสอบ', '#e0913a'], exp: ['หมดอายุ', '#999'], void: ['↩️ ยกเลิกแล้ว', '#c9302c'] };
// ✨ live previews of the paid items: the sparkly supporter title over your own character, and you in the angel / fairy outfit
let ppRaf = 0;
function paintPayPrev(c, t) {
  let W = c.clientWidth, Hh = c.clientHeight; const d = Math.min(2, window.devicePixelRatio || 1); if (!W || !Hh || !me) return;
  if (c.width !== Math.round(W * d)) { c.width = Math.round(W * d); c.height = Math.round(Hh * d); }
  const g = c.getContext('2d'), z = 1.35; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(d * z, 0, 0, d * z, 0, 0);
  const mp = P.get(myId) || {}, kind = c.dataset.pp, angel = kind !== 'title'; W /= z; Hh /= z;
  const p = { id: -77, name: me.name, c: mp.c, g: me.gender, lk: me.look || {}, of: angel ? 'angel' : mp.of, title: kind !== 'angel' ? (G.payTitle?.title || 'ผู้สนับสนุนเมือง') : '', tr: 8 };
  const H = Hh * .56, k = H / CH_ATLAS.h, px = W / 2, py = Hh * .95, gold = p.g === 'f' ? 'fairy' : 'angel', nm = NAME_MODE;
  ctx = g; NAME_MODE = 'all';
  try {
    if (angel) drawAura(px, py, H, t, false, gold);
    drawCharTo(g, p, px, py, k, 'front', 0);
    if (angel) drawAura(px, py, H, t, true, gold);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    nameAndBubble(p, px, py - H * .97, true, t);
  } finally { ctx = mainCtx; NAME_MODE = nm; }
}
function ppLoop() {
  const cs = document.querySelectorAll('canvas[data-pp]'); if (!cs.length) { ppRaf = 0; return; }
  const t = performance.now(); cs.forEach(c => { if (c.offsetParent) paintPayPrev(c, t); }); ppRaf = requestAnimationFrame(ppLoop);
}
const ppStart = () => whenChars(() => { if (!ppRaf) ppRaf = requestAnimationFrame(ppLoop); });
const hasAngel = () => (me?.outfits || []).includes('angel'), vipOnC = () => (me?.vipT || 0) > Date.now() + clockOff;
// banner shown after entering the game (once a day at most if the player ticks "not today"); the ✕ closes it
// 🏮 the festival poster after entering the game, once a day while the event runs ("coming soon" until the night itself)
function lkBanner() {
  if (!me || !lkOnC() || $('#lkBan')) return;
  const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); let seen = ''; try { seen = localStorage.getItem('lt_lkban') || ''; } catch { }
  if (seen === day) return;
  const dw = $('#dailyWrap'); if ((dw && dw.offsetParent) || !$('#tut')?.classList.contains('hidden') && $('#tut')?.offsetParent) return void setTimeout(lkBanner, 1500);
  try { localStorage.setItem('lt_lkban', day); } catch { }
  const fest = day === G.lk.day, past = day > G.lk.day;
  const el = document.createElement('div'); el.id = 'lkBan';
  el.innerHTML = `<div class="lkBox"><button class="pbX" title="ปิด">✕</button><img src="assets/lkbanner.webp?v=1" alt="">
    <div class="lkSoon">${fest ? '🌕 คืนนี้! คืนลอยกระทง รางวัล x2' : past ? '🏮 เทศกาลลอยกระทง ถึง 30 พ.ย.' : '✨ เร็วๆ นี้! คืนลอยกระทง อังคาร 24 พ.ย. ✨'}</div>
    <p>ลอยกระทงที่ท่าน้ำทะเลสาบได้แล้ววันนี้ · ลอยครบ 3 วัน รับ <b>ชุดไทยลอยกระทง</b> ฟรี!</p>
    <button class="primary big lkGo">🏮 ดูกิจกรรม</button></div>`;
  const close = () => el.remove();
  el.querySelector('.pbX').onclick = close; el.onclick = e => { if (e.target === el) close(); };
  el.querySelector('.lkGo').onclick = () => { close(); openPanel({ kind: 'lkev' }); send({ t: 'lkv' }); };
  document.body.appendChild(el); FX.play('chime');
}
function payBanner() {
  if (!G?.pay?.on || !me || $('#payBan')) return;
  let skip = ''; try { skip = localStorage.getItem('lt_payban') || ''; } catch { }
  if (skip === new Date().toDateString()) return;
  const dw = $('#dailyWrap'); if ((dw && dw.offsetParent) || $('#lkBan') || !$('#tut')?.classList.contains('hidden') && $('#tut')?.offsetParent) return void setTimeout(payBanner, 1500);   // wait for the daily reward / tutorial to close first
  const showT = !vipOnC(), showA = !hasAngel(); if (!showT && !showA) return;
  const ofn = G.outfitDefs?.angel ? (me.gender === 'f' && G.outfitDefs.angel.nf ? G.outfitDefs.angel.nf : G.outfitDefs.angel.name) : 'ชุดเทวดา';
  const el = document.createElement('div'); el.id = 'payBan';
  el.innerHTML = `<div class="pbBox"><button class="pbX" title="ปิด">✕</button><div class="pbH">✨ ของพิเศษ เฉพาะผู้สนับสนุนเมือง ✨</div>
    <div class="pbRow">${showT ? `<div class="pbIt"><canvas data-pp="title"></canvas><b>💖 ฉายาวิ้งวับ</b><small>30 วัน · ฿${G.pay.vip}</small></div>` : ''}${showA ? `<div class="pbIt"><canvas data-pp="angel"></canvas><b>😇 ${esc(ofn)}</b><small>ใส่ได้ถาวร · ฿${G.pay.angel}</small></div>` : ''}</div>
    <button class="primary big pbGo">💎 ดูแพ็กเติมเงิน</button><label class="pbNo"><input type="checkbox"> วันนี้ไม่ต้องแสดงอีก</label></div>`;
  const close = () => { try { if (el.querySelector('.pbNo input').checked) localStorage.setItem('lt_payban', new Date().toDateString()); } catch { } el.remove(); };
  el.querySelector('.pbX').onclick = close; el.onclick = e => { if (e.target === el) close(); };
  el.querySelector('.pbGo').onclick = () => { close(); FN.openTopup(); };
  document.body.appendChild(el); ppStart();
}
function topupHtml() {
  const R = payRes; if (!R) return `<h2>💎 ร้านเติมเงิน</h2><div class="sub">กำลังโหลด…</div>`;
  if (!R.on) return `<h2>💎 ร้านเติมเงิน</h2><div class="sub">ระบบเติมเงินยังไม่เปิดให้บริการ${me?.admin ? '<br>แอดมิน: ตั้งค่า SLIP2GO_SECRET และ PROMPTPAY_ID ใน Fly.io ก่อน' : ''}</div>`;
  const avail = p => !(p.kind === 'outfit' && R.hasAngel);
  if (!R.packs.find(p => p.id === paySel.pack && avail(p))) paySel.pack = (R.packs.find(p => p.id === 'p100') || R.packs[0]).id;
  const pk = R.packs.find(p => p.id === paySel.pack);
  if (!R.methods[paySel.m]) paySel.m = Object.keys(R.methods)[0];
  const ofn = G.outfitDefs?.angel ? (me.gender === 'f' && G.outfitDefs.angel.nf ? G.outfitDefs.angel.nf : G.outfitDefs.angel.name) : 'ชุดเทวดา';
  const vipLeft = R.vipT > Date.now() + clockOff ? Math.ceil((R.vipT - Date.now() - clockOff) / 86400e3) : 0;
  const card = p => { const on = p.id === paySel.pack, ok = avail(p), bon = !p.kind && R.first ? Math.round(p.gems * R.bonus) : 0;
    const head = p.kind === 'title' ? `<canvas class="ppCv" data-pp="title"></canvas><b style="font-size:15px">💖 ฉายาพิเศษ</b><div>${titleHtml(G.payTitle?.title || 'ผู้สนับสนุนเมือง', 8)}</div><small>30 วัน · สีวิ้งวับ${vipLeft ? ` · เหลือ ${vipLeft} วัน (ต่ออายุได้)` : ''}</small>`
      : p.kind === 'outfit' ? `<canvas class="ppCv" data-pp="angel"></canvas><b style="font-size:15px">😇 ${esc(ofn)}</b><small>${ok ? 'ชุดพิเศษ + ออร่า · ไม่มีขายในร้าน' : '✅ คุณมีชุดนี้แล้ว'}</small>`
      : `<b style="font-size:18px">💎${p.gems}</b>${bon ? `<small style="color:var(--good)">+${bon} โบนัส</small>` : ''}`;
    return `<button class="item" ${ok ? '' : 'disabled'} style="display:block;text-align:center;${on ? 'border:3px solid #2fa34a;background:#e4ffd6;box-shadow:0 0 0 2px #2fa34a' : ''}" data-m='${JSON.stringify({ fn: 'payPack', id: p.id })}'>${on ? '<small style="color:#2fa34a;font-weight:800">✓ เลือกอยู่</small>' : ''}${head}<div style="font-weight:800">฿${p.thb}</div>${p.tag && !p.kind ? `<small class="tag">${p.tag}</small>` : ''}</button>`; };
  const special = R.packs.filter(p => p.kind), gems = R.packs.filter(p => !p.kind);
  const what = o => o.pack === 'vip' ? '💖 ฉายาพิเศษ 30 วัน' : o.pack === 'angel' ? '😇 ' + ofn : `💎${o.gems}${o.bonus ? ` +${o.bonus}` : ''}`;
  const my = (R.my || []).map(o => { const st = PAY_ST[o.st] || [o.st, '#999'];
    return `<div class="item"><div class="nm">${what(o)} · ฿${o.thb}<small>${new Date(o.t).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · #${o.ref}${o.why ? '<br>⚠️ ' + esc(o.why) : ''}</small></div><b style="color:${st[1]};white-space:nowrap">${st[0]}</b>${o.st === 'new' && o.qr && o.ref !== payOpenRef ? B('📷 ส่งสลิป', { fn: 'payShow', ref: o.ref }) : ''}</div>`; }).join('');
  const op = (R.my || []).find(o => o.ref === payOpenRef && o.st === 'new' && o.qr);
  const box = op ? `<div class="jobbox" style="text-align:center"><b>สแกนจ่าย ฿${op.thb} รับ ${what(op)}</b><br><small>#${op.ref}</small><br>
      <canvas id="payQr" data-qr="${esc(op.qr)}" data-ref="${op.ref}" style="width:220px;height:220px;max-width:100%;background:#fff;margin:6px auto;display:block"></canvas>
      <small>พร้อมเพย์ ${esc(R.pp || '')}${R.to ? ` · ชื่อบัญชี <b>${esc(R.to)}</b>` : ''}<br>ยอดต้องเป็น <b>฿${op.thb}</b> พอดี · ตรวจชื่อบัญชีก่อนกดโอน</small>
      <div class="grid2" style="margin-top:6px"><button type="button" id="payQrSave">💾 บันทึกรูป QR</button>${B('✖ ปิด', { fn: 'payHide' })}</div>
      <div class="sub" style="margin-top:8px">โอนเสร็จแล้ว ส่งรูปสลิปจากแอปธนาคาร ของจะเข้าทันทีเมื่อตรวจผ่าน</div>
      <button type="button" class="primary big" id="paySlipPick">📷 อัปโหลดสลิป</button><input type="file" id="paySlip" data-ref="${op.ref}" accept="image/*" hidden></div>` : '';
  const got = pk.kind === 'title' ? 'ฉายาพิเศษ 30 วัน' : pk.kind === 'outfit' ? ofn : '💎' + (pk.gems + (R.first ? Math.round(pk.gems * R.bonus) : 0));
  return `<h2>💎 ร้านเติมเงิน</h2>${R.sb ? '<div class="jobbox">🧪 โหมดทดสอบ (Sandbox) ไม่ตัดเงินจริง</div>' : ''}
    <div class="sub">คุณมี 💎${(me?.gems || 0).toLocaleString()}${R.first ? ' · 🎉 เติมเพชรครั้งแรกรับโบนัส +' + Math.round(R.bonus * 100) + '%' : ''}</div>
    <div class="secT">✨ ของพิเศษ</div><div class="grid2">${special.map(card).join('')}</div>
    <div class="secT">💎 เพชร</div><div class="grid2">${gems.map(card).join('')}</div>
    ${box}<div class="sub" style="margin-top:6px">📱 จ่ายด้วยการสแกน QR พร้อมเพย์จากแอปธนาคารไหนก็ได้ แล้วอัปโหลดสลิป</div>
    <label class="sub" style="display:flex;gap:6px;align-items:flex-start;margin-top:8px"><input type="checkbox" id="payOk" style="width:auto"> <span>ฉันอายุ 18 ปีขึ้นไป หรือได้รับอนุญาตจากผู้ปกครองแล้ว และเข้าใจว่าของที่ซื้อเป็นไอเทมในเกม ไม่สามารถแลกคืนเป็นเงินได้</span></label>
    ${B(`📱 ชำระ ฿${pk.thb} รับ ${got}`, { fn: 'payBuy' }, 'primary big')}
    <small style="opacity:.75">ตรวจสลิปอัตโนมัติ · 1 สลิปใช้ได้ครั้งเดียว · ใช้ได้เฉพาะสลิปที่โอนหลังกดชำระ · มีปัญหาแจ้งแอดมินพร้อมเลขรายการ</small>
    ${my ? `<div class="secT">รายการของฉัน</div><div class="list">${my}</div>` : ''}`;
}
function payAdminHtml() {
  const R = payAdm, back = B('‹ กลับ', { fn: 'open', kind: 'god' }) + ' ';
  if (!R) return `<h2>${back}💎 รายการเติมเงิน</h2><div class="sub">กำลังโหลด…</div>`;
  const rows = R.list.map(o => { const st = PAY_ST[o.st] || [o.st, '#999'];
    return `<div class="item" style="display:block"><div class="nm"><b>${esc(o.n || o.l)}</b> <span class="tag">${esc(o.l)}</span> · 💎${o.gems}${o.bonus ? '+' + o.bonus : ''} · <b>฿${o.thb}</b> ${o.sb ? '<span class="tag">🧪 ทดสอบ</span> ' : ''}<b style="color:${st[1]}">${st[0]}</b><small>#${o.ref} · ${esc(o.m)} · ${new Date(o.t).toLocaleString('th-TH')}${o.back ? ' · แจ้งล่าสุด ' + esc(o.back) : ''}${o.by ? ' · โดย ' + esc(o.by) : ''}${o.why ? '<br>⚠️ ' + esc(o.why) : ''}</small></div>
      ${o.st === 'paid' ? `<div class="grid2">${B('↩️ ดึงของคืน', { fn: 'payVoid', ref: o.ref, paid: 1 }, 'warn')}</div>` : o.st === 'void' ? `<div class="grid2">${B('✅ คืนของให้ (เงินเข้าจริง)', { fn: 'payOk', ref: o.ref }, 'warn')}</div>` : `<div class="grid2">${B('🔄 ตรวจสลิปอีกครั้ง', { fn: 'payRecheck', ref: o.ref })}${B('✅ เติมให้ด้วยมือ', { fn: 'payOk', ref: o.ref }, 'warn')}${B('🗑️ ยกเลิกรายการ', { fn: 'payVoid', ref: o.ref })}</div>`}</div>`; }).join('');
  return `<h2>${back}💎 รายการเติมเงิน</h2>
    <div class="sub">${R.on ? '🟢 เปิดรับเงิน' : '🔴 ปิดอยู่'} · พร้อมเพย์ ${esc(R.pp || '— (ตั้ง PROMPTPAY_ID)')} · ${R.to ? 'ชื่อ ' + esc(R.to) : 'ยังไม่ได้ตั้ง PAY_NAME'} · Slip2Go ${R.sk ? '✅' : '❌ (ตั้ง SLIP2GO_SECRET)'} · ${R.recv ? 'ตรวจชื่อผู้รับ ✅' : '⚠️ ยังไม่ได้ตั้ง SLIP_RECEIVER: ทุกสลิปต้องรอแอดมินกดยืนยัน'}</div>
    <div class="grid2"><div class="item"><div class="nm">วันนี้<small style="color:var(--good)">฿${R.today.toLocaleString()} (${R.todayN} รายการ)</small></div></div><div class="item"><div class="nm">รวมทั้งหมด<small style="color:var(--good)">฿${R.total.toLocaleString()} (${R.n} รายการ)</small></div></div></div>
    ${R.review ? `<div class="jobbox">🔎 รอตรวจสอบ ${R.review} รายการ: เช็กว่าเงินเข้าในแอปธนาคารก่อนกดเติมด้วยมือ</div>` : ''}
    <div class="list">${rows || '<div class="sub">ยังไม่มีรายการ</div>'}</div>`;
}
function ledgerHtml(p) {
  const back = p.admin ? B('‹ กลับ', { fn: 'open', kind: 'god' }) + ' ' : '';
  if (!ledgerRes) return `<h2>${back}💸 ประวัติการเงิน</h2><div class="sub">กำลังโหลด…</div>`;
  const L = (ledgerRes.list || []).slice().reverse(), dayOf = t => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  const today = dayOf(Date.now() + clockOff), td = L.filter(e => dayOf(e[0]) === today);
  const inc = td.filter(e => e[1] > 0).reduce((s, e) => s + e[1], 0), out = td.filter(e => e[1] < 0).reduce((s, e) => s - e[1], 0);
  const cats = {}; for (const e of td) if (e[1] < 0) cats[e[2]] = (cats[e[2]] || 0) - e[1];
  const top = Object.entries(cats).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${esc(k)} ${money(v)}`).join(' · ');
  let cur = '', rows = '';
  for (const e of L) {
    const d = dayOf(e[0]); if (d !== cur) { cur = d; rows += `<div class="secT">${d === today ? 'วันนี้' : d}</div>`; }
    const tm = new Date(e[0]).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    rows += `<div class="item"><div class="nm">${esc(e[2])}<small>${tm} · คงเหลือ ${money(e[3])}</small></div><b style="color:${e[1] > 0 ? 'var(--good)' : 'var(--bad)'};white-space:nowrap">${e[1] > 0 ? '+' : '−'}${money(Math.abs(e[1]))}</b></div>`;
  }
  return `<h2>${back}💸 ประวัติการเงิน${ledgerRes.who ? ` · ${esc(ledgerRes.who)}` : ''}</h2>
    <div class="grid2"><div class="item"><div class="nm">📈 รายรับวันนี้<small style="color:var(--good)">+${money(inc)}</small></div></div><div class="item"><div class="nm">📉 รายจ่ายวันนี้<small style="color:var(--bad)">−${money(out)}</small></div></div></div>
    ${top ? `<div class="sub">จ่ายมากสุดวันนี้: ${top}</div>` : ''}<div class="sub">เก็บ 150 รายการล่าสุด · รายการเดียวกันที่ติดกันในเวลาใกล้กันจะรวมเป็นบรรทัดเดียว</div>
    <div class="list">${rows || '<div class="sub">ยังไม่มีรายการ (เริ่มบันทึกตั้งแต่อัปเดตนี้)</div>'}</div>`;
}
function godFindHtml() {
  if (!godFindRes) return '';
  if (!godFindRes.list.length) return `<div class="sub">ไม่พบผู้เล่นที่ตรงกับ "${esc(godFindRes.q)}"</div>`;
  const d = t => t ? new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  return `<div class="list">${godFindRes.list.map(x => `<div class="item" style="display:block"><div class="nm"><b>${esc(x.name)}</b> <span class="tag">ID: ${esc(x.login)}</span> ${x.on ? '<span class="tag" style="background:var(--good)">ออนไลน์</span>' : ''}
    <small>💰 ${money(x.money)} · 🏦 ${money(x.bank)} · 💎 ${x.gems} · 💼 ${esc(x.career)}${x.house ? ` · 🏠 บ้าน #${x.house}` : ''}<br>📱 ${esc(String(x.phone || '—'))} · เข้าเกม ${x.days} วัน · ${x.gmail ? 'ผูก Google แล้ว' : 'ไม่ได้ผูก Google'}<br>สมัคร ${d(x.created)} · ออนไลน์ล่าสุด ${x.on ? 'ตอนนี้' : x.last ? d(x.last) : esc(x.lastDay || '—')}</small></div>
    <div class="rowf" style="margin-top:4px"><input id="godPin_${esc(x.login)}" type="text" inputmode="numeric" maxlength="8" placeholder="PIN ใหม่ 4–8 หลัก">${B('🔑 ตั้ง PIN', { fn: 'godPin', login: x.login }, 'warn')}</div>
    <div class="rowf" style="margin-top:4px"><input id="godGem_${esc(x.login)}" type="text" inputmode="numeric" maxlength="7" placeholder="💎 จำนวน (ติดลบ = หัก)"><input id="godGemW_${esc(x.login)}" type="text" maxlength="80" placeholder="เหตุผล (ผู้เล่นเห็น)">${B('💎 ส่งเพชร', { fn: 'godGem', login: x.login }, 'good')}</div>${B('💸 ดูประวัติการเงิน', { fn: 'godLedger', login: x.login })}</div>`).join('')}</div>`;
}
function econHtml() {   // today's pump board and the economy mood (stats panel)
  const e = me.econ; if (!e) return '';
  const d = e.next - e.litre, arr = Math.abs(d) < .05 ? 'ทรงตัว' : d > 0 ? `ขึ้น ${d.toFixed(2)} ฿` : `ลง ${(-d).toFixed(2)} ฿`;
  const mood = e.mood === 'slow' ? '📉 ซบเซา (ภาษีลดครึ่ง)' : e.mood === 'boom' ? '📈 คึกคัก' : '➖ ปกติ';
  return `<div class="grid2"><div class="item"><div class="nm">⛽ ราคาน้ำมัน<small>฿${e.litre.toFixed(2)}/ลิตร · พรุ่งนี้${arr}</small></div></div><div class="item"><div class="nm">🏛️ เศรษฐกิจวันนี้<small>${mood}</small></div></div></div>`;
}
function frameRows() {
  const own = me.frames || [], cur = me.frame ?? -1, pic = myPic || facePng();
  const card = f => { const has = own.includes(f.id), on = cur === f.id;
    const btn = f.locked && !has ? (me.admin ? B(on ? 'ใส่อยู่ ✓' : '👑 ลองใส่', { t: 'frame', op: 'wear', id: on ? -1 : f.id }, on ? 'primary' : '') : '<small>🔒 เร็วๆ นี้</small>')
      : has ? B(on ? 'ถอด' : 'ใส่', { t: 'frame', op: 'wear', id: on ? -1 : f.id }, on ? '' : 'good') : B(money(f.price), { t: 'frame', op: 'buy', id: f.id }, 'good', me.money < f.price);
    return `<div class="frmCard ${on ? 'on' : ''} ${f.locked && !has ? 'lock' : ''}"><div class="fprev"><img src="${pic}" alt="">${frameHtml(f.id, 64, false)}</div><b>${esc(f.name)}</b>${btn}</div>`; };
  const sec = (t, list) => `<div class="secT">${t}</div><div class="frmGrid">${list.map(card).join('')}</div>`;
  return sec('💍 กรอบโลหะและอัญมณี', G.frameDefs.slice(0, 12)) + sec('🌸 กรอบน่ารัก', G.frameDefs.slice(12, 24)) + sec('✨ กรอบพิเศษ (เรืองแสง · สายรุ้งกับนีออนวางขายแล้ว)', G.frameDefs.slice(24));
}
const RAR = ['', 'ธรรมดา', 'ไม่ธรรมดา', 'หายาก', 'มหากาพย์', 'ตำนาน', 'พิเศษ', 'ในตำนาน', 'ผู้สนับสนุน'];
const RAR_COL = ['#ffd34d', '#e8e8e8', '#7be07b', '#62b8ff', '#d08cff', '#ffb43c', '#ffd34d', '#ff6bd6', '#ff9be6'];
const titleHtml = (t, r) => t ? `<span class="ttl rar${r || 1}">«${esc(t)}»</span>` : '';
// shrink a photo from the album to a small square JPEG before it is sent (kept under ~20 KB)
function pickPhoto() {
  // the input must be in the page for iOS Safari to open the photo picker
  let inp = document.getElementById('picIn');
  if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'picIn'; inp.style.display = 'none'; document.body.appendChild(inp); }
  inp.value = '';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); cropOpen(im); };
    im.onerror = () => toast('เปิดรูปนี้ไม่ได้', '🖼️', false);
    im.src = url;
  };
  inp.click();
}
// ---- crop the picked photo: drag to move, pinch / wheel / slider to zoom; the circle is what others see
let crop = null;
function cropOpen(im) {
  const C = $('#cropCv'), S = C.width;
  crop = { im, z: 1, cx: im.width / 2, cy: im.height / 2, pts: new Map(), pinch: 0 };
  const base = () => S / Math.min(im.width, im.height), k = () => base() * crop.z;
  const fix = () => { const h = S / 2 / k(); crop.cx = clamp(crop.cx, h, im.width - h); crop.cy = clamp(crop.cy, h, im.height - h); };
  crop.draw = () => {
    fix(); const g = C.getContext('2d'), kk = k();
    g.fillStyle = '#222'; g.fillRect(0, 0, S, S);
    g.drawImage(im, S / 2 - crop.cx * kk, S / 2 - crop.cy * kk, im.width * kk, im.height * kk);
    g.save(); g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.rect(0, 0, S, S); g.moveTo(S - 4, S / 2); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.fill('evenodd');
    g.strokeStyle = '#ffd770'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 7); g.stroke(); g.restore();
  };
  const zoomTo = z => { crop.z = clamp(z, 1, 5); $('#cropZoom').value = crop.z; crop.draw(); };
  const sc = () => S / C.getBoundingClientRect().width;   // css px -> canvas px
  C.onpointerdown = e => { C.setPointerCapture(e.pointerId); crop.pts.set(e.pointerId, [e.clientX, e.clientY]); if (crop.pts.size === 2) { const [a, b] = [...crop.pts.values()]; crop.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); crop.pz = crop.z; } };
  C.onpointermove = e => {
    const old = crop.pts.get(e.pointerId); if (!old) return;
    crop.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (crop.pts.size === 2) { const [a, b] = [...crop.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (crop.pinch) zoomTo(crop.pz * d / crop.pinch); return; }
    crop.cx -= (e.clientX - old[0]) * sc() / k(); crop.cy -= (e.clientY - old[1]) * sc() / k(); crop.draw();
  };
  C.onpointerup = C.onpointercancel = e => { crop.pts.delete(e.pointerId); if (crop.pts.size < 2) crop.pinch = 0; };
  C.onwheel = e => { e.preventDefault(); zoomTo(crop.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); };
  $('#cropZoom').oninput = e => zoomTo(+e.target.value);
  $('#cropZoom').value = 1;
  $('#cropX').onclick = $('#cropNo').onclick = () => { $('#crop').classList.add('hidden'); crop = null; };
  $('#cropOk').onclick = () => {
    const O = 384, c = document.createElement('canvas'); c.width = c.height = O; const g = c.getContext('2d'), kk = k() * O / S;
    g.fillStyle = '#fff'; g.fillRect(0, 0, O, O);
    g.drawImage(im, O / 2 - crop.cx * kk, O / 2 - crop.cy * kk, im.width * kk, im.height * kk);
    let q = .9, fmt = c.toDataURL('image/webp', .5).startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', d = c.toDataURL(fmt, q); while (d.length > 78000 && q > .3) { q -= .08; d = c.toDataURL(fmt, q); }
    send({ t: 'pic', data: d }); $('#crop').classList.add('hidden'); crop = null;
  };
  $('#crop').classList.remove('hidden'); crop.draw();
}
const achTodo = () => (me?.ach || []).filter(x => !(me.achGot || []).includes(x));
const achRew = a => a.g || (me.achReward || [])[a.r || 1] || 0;
function achvPanel() {
  const todo = achTodo(), sum = todo.reduce((t, id) => t + achRew(G.ach.find(x => x.id === id) || {}), 0), got = (me.ach || []).length;
  const st = a => (me.achGot || []).includes(a.id) ? 2 : (me.ach || []).includes(a.id) ? 0 : 1;
  const pct = a => Math.min(1, (me.stats?.[a.stat] || 0) / a.n);
  const rows = G.ach.slice().sort((x, y) => st(x) - st(y) || (st(x) === 1 ? pct(y) - pct(x) : 0) || (x.r || 1) - (y.r || 1)).map(a => {
    const s2 = st(a), c = a.c ? G.careers[a.c] : null, pv = Math.min(a.n, me.stats?.[a.stat] || 0);
    if (a.secret && s2 === 1) return `<div class="item"><div class="em">❔</div><div class="nm"><b>??? ความสำเร็จลับ</b><small>ยังเป็นความลับ... ลองสังเกตสิ่งรอบตัว ฟังชาวเมืองคุยกัน</small></div><span class="tag">💎?</span></div>`;
    const btn = s2 === 0 ? B(`🎁 รับ 💎${achRew(a)}`, { t: 'achclaim', id: a.id }, 'primary') : s2 === 2 ? '<span class="tag">รับแล้ว ✓</span>' : `<span class="tag">💎${achRew(a)}</span>`;
    if (a.nt) return `<div class="item ${s2 === 2 ? 'done' : ''}"><div class="em">${s2 === 1 ? '🔒' : '⭐'}</div><div class="nm"><b>${esc(a.title)}</b> <span class="tag">ไม่มีฉายา</span><small>${a.desc} · ${pv.toLocaleString()}/${a.n.toLocaleString()}</small><div class="wbar"><u style="width:${pct(a) * 100}%"></u></div></div>${btn}</div>`;
    return `<div class="item ${s2 === 2 ? 'done' : ''}"><div class="em">${s2 === 1 ? '🔒' : '🏅'}</div><div class="nm">${titleHtml(a.title, a.r)} <span class="rtag r${a.r || 1}">${RAR[a.r || 1]}</span>${c ? ` <span class="tag">${c.icon} ${c.name}</span>` : ''}<small>${a.desc} · ${pv.toLocaleString()}/${a.n.toLocaleString()}</small><div class="wbar"><u style="width:${pct(a) * 100}%"></u></div></div>${btn}</div>`;
  }).join('');
  return `<h2>🏅 ความสำเร็จ</h2><div class="sub">ปลดล็อกแล้ว ${got}/${G.ach.length} · ได้เพชร 💎5–20 ตามความยาก พร้อมฉายาบนหัว · ⭐ ความสำเร็จเล็กๆ ได้ 💎1–3 (ไม่มีฉายา)</div>
    ${todo.length ? `<div class="jobbox">🎁 รอรับรางวัล ${todo.length} รายการ รวม <b>💎${sum}</b>${B('รับทั้งหมด', { t: 'achclaim', id: 'all' }, 'primary big')}</div>` : ''}
    <div class="list">${rows}</div>`;
}
// ---- stock market (bank tab): price list with sparklines, a candlestick chart with moving averages and volume, holdings and trading
const stockHist = {};
const SK_COL = { up: '#26a69a', dn: '#ef5350' };
function stockPanel(p, st) {
  const sk = wd?.sk; if (!sk) return '<div class="sub">กำลังโหลดตลาด...</div>';
  const sid = p.sid || sk.l[0][0], row = sk.l.find(x => x[0] === sid) || sk.l[0], meta = G.stocks.find(x => x.id === row[0]);
  if (stockHist[row[0]]?.i !== sk.i && !p['req' + sk.i + row[0]]) { p['req' + sk.i + row[0]] = 1; send({ t: 'stockhist', id: row[0] }); }
  const n = p.sn || 60, hold = (me.stocks || {})[row[0]], price = row[1];
  const port = Object.entries(me.stocks || {}).reduce((t, [id, [q, avg]]) => { const pr = sk.l.find(x => x[0] === id)?.[1] || 0; t.v += q * pr; t.c += q * avg; return t; }, { v: 0, c: 0 });
  const pct = v => `<b style="color:${v >= 0 ? SK_COL.up : SK_COL.dn}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2)}%</b>`;
  const list = sk.l.map(([id, c, ch, sp]) => { const m2 = G.stocks.find(x => x.id === id), mine = (me.stocks || {})[id];
    return `<button class="skRow ${id === row[0] ? 'on' : ''}" data-m='${JSON.stringify({ fn: 'qtab', set: { sid: id } })}'><span class="skN">${m2.icon} <b>${id}</b><small>${esc(m2.name)}${mine ? ` · ถือ ${mine[0].toLocaleString()}` : ''}</small></span><canvas data-spark="${sp.join(',')}" width="70" height="26"></canvas><span class="skP">${c.toFixed(2)}<small>${pct(ch)}</small></span></button>`; }).join('');
  const maxBuy = Math.max(0, Math.floor((me.money - G.stockFee[1]) / (price * (1 + G.stockFee[0]))));
  const pl = hold ? (price - hold[1]) * hold[0] : 0;
  const ranges = [[30, '15 นาที'], [60, '30 นาที'], [120, '1 ชม.'], [240, '2 ชม.']].map(([k, l]) => B(l, { fn: 'qtab', set: { sn: k } }, n === k ? 'primary' : '')).join('');
  return `<div class="sub">เปิดตามเวลาธนาคาร · ราคาเปลี่ยนทุก 30 วินาที · ค่าธรรมเนียมซื้อขาย ${(G.stockFee[0] * 100).toFixed(2)}% (ขั้นต่ำ ${money(G.stockFee[1])}) · ขึ้นได้ก็ลงได้ ลงทุนแต่พอดี</div>
    <div class="jobbox">💼 พอร์ตของคุณ มูลค่า <b>${money(Math.round(port.v))}</b>${port.c ? ` · ${port.v - port.c >= 0 ? 'กำไร' : 'ขาดทุน'} <b style="color:${port.v - port.c >= 0 ? SK_COL.up : SK_COL.dn}">${money(Math.round(Math.abs(port.v - port.c)))}</b> (${((port.v / port.c - 1) * 100).toFixed(1)}%)` : ' · ยังไม่มีหุ้น'}</div>
    <div class="skList">${list}</div>
    <div class="skHead"><div>${meta.icon} <b>${row[0]}</b> ${esc(meta.name)}<small>${esc(meta.desc)}</small></div><div class="skBig">${price.toFixed(2)}<small>${pct(row[2])} <i>24 ชม.เกม</i></small></div></div>
    <div class="tabs skR">${ranges}</div>
    <canvas class="skChart" data-chart="${row[0]}" data-n="${n}"></canvas>
    <div class="grid2" style="margin-top:6px"><div class="item"><div class="nm">📦 ถืออยู่<small><b>${hold ? hold[0].toLocaleString() : 0}</b> หุ้น${hold ? ` · ทุนเฉลี่ย ${hold[1].toFixed(2)}` : ''}</small></div></div><div class="item"><div class="nm">${pl >= 0 ? '💹 กำไร' : '📉 ขาดทุน'}<small><b style="color:${pl >= 0 ? SK_COL.up : SK_COL.dn}">${money(Math.round(Math.abs(pl)))}</b>${hold ? ` (${((price / hold[1] - 1) * 100).toFixed(1)}%)` : ''}</small></div></div></div>
    <div class="rowf" style="margin-top:8px"><input id="skQty" type="number" min="1" value="${Math.min(10, maxBuy) || 1}" inputmode="numeric"><span class="sub" style="margin:0">หุ้น · ซื้อได้สูงสุด ${maxBuy.toLocaleString()}</span></div>
    <div class="grid2" style="margin-top:6px">${B('🟢 ซื้อ', { fn: 'stock', st, op: 'buy', id: row[0] }, 'good')}${B('🔴 ขาย', { fn: 'stock', st, op: 'sell', id: row[0] }, 'warn', !hold)}${B(`ซื้อเต็มเงิน (${maxBuy.toLocaleString()})`, { fn: 'stock', st, op: 'buy', id: row[0], qty: maxBuy }, '', !maxBuy)}${B('ขายหมด', { fn: 'stock', st, op: 'sell', id: row[0], qty: hold ? hold[0] : 0 }, '', !hold)}</div>`;
}
function drawSpark(c) {
  const v = c.dataset.spark.split(',').map(Number), g = c.getContext('2d'), W = c.width, H = c.height, lo = Math.min(...v), hi = Math.max(...v), up = v[v.length - 1] >= v[0];
  g.clearRect(0, 0, W, H); g.strokeStyle = up ? SK_COL.up : SK_COL.dn; g.lineWidth = 1.6; g.beginPath();
  v.forEach((y, i) => { const px = i / (v.length - 1) * (W - 2) + 1, py = H - 2 - (y - lo) / ((hi - lo) || 1) * (H - 4); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
}
function drawStockChart(c, hover) {
  const h = stockHist[c.dataset.chart]; const dpr = window.devicePixelRatio || 1, W = c.clientWidth || 340, H = 230;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#141a22'; g.fillRect(0, 0, W, H);
  if (!h) { g.fillStyle = '#8a96a8'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('กำลังโหลดกราฟ...', W / 2, H / 2); return; }
  const all = h.c, n = Math.min(+c.dataset.n || 60, all.length), cs = all.slice(-n), off = all.length - n;
  const ma = k => all.map((_, i) => i < k - 1 ? null : all.slice(i - k + 1, i + 1).reduce((t, x) => t + x[3], 0) / k).slice(-n);
  const R0 = 50, PH = H * .74, VH = H * .16, top = 8, cw = (W - R0 - 6) / n;
  let lo = Math.min(...cs.map(x => x[2])), hi = Math.max(...cs.map(x => x[1])); const pad = (hi - lo) * .08 || hi * .01; lo -= pad; hi += pad;
  const Y = p => top + (hi - p) / (hi - lo) * (PH - top), vmax = Math.max(...cs.map(x => x[4]));
  g.font = '10px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) { const p = lo + (hi - lo) * k / 4, y = Y(p); g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(4, y); g.lineTo(W - R0, y); g.stroke(); g.fillStyle = '#8a96a8'; g.fillText(p.toFixed(p < 20 ? 2 : 1), W - R0 + 4, y); }
  cs.forEach(([o, hh, l, cl, v], i) => {
    const x = 4 + i * cw + cw / 2, up = cl >= o, col = up ? SK_COL.up : SK_COL.dn;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(hh)); g.lineTo(x, Y(l)); g.stroke();
    const bw = Math.max(1, cw * .68), y1 = Y(Math.max(o, cl)), y2 = Y(Math.min(o, cl)); g.fillStyle = col; g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    g.globalAlpha = .45; const vh = v / vmax * VH; g.fillRect(x - bw / 2, H - 14 - vh, bw, vh); g.globalAlpha = 1;
  });
  for (const [k, col] of [[10, '#ffd34d'], [30, '#6aa9ff']]) { const m = ma(k); g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); let st = false; m.forEach((v, i) => { if (v == null) return; const x = 4 + i * cw + cw / 2; st ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); st = true; }); g.stroke(); }
  const last = cs[cs.length - 1][3], ly = Y(last), upL = last >= cs[cs.length - 1][0];
  g.setLineDash([4, 3]); g.strokeStyle = upL ? SK_COL.up : SK_COL.dn; g.beginPath(); g.moveTo(4, ly); g.lineTo(W - R0, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = upL ? SK_COL.up : SK_COL.dn; g.fillRect(W - R0 + 1, ly - 8, R0 - 2, 16); g.fillStyle = '#fff'; g.fillText(last.toFixed(2), W - R0 + 4, ly);
  g.fillStyle = '#8a96a8'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (let k = 1; k < 4; k++) { const i = Math.floor(n * k / 4), mins = (n - i) * (wd?.sk?.ms || 30000) / 60000; g.fillText(`-${mins >= 60 ? (mins / 60).toFixed(1) + 'ชม.' : Math.round(mins) + 'น.'}`, 4 + i * cw + cw / 2, H - 2); }
  g.textAlign = 'left'; g.fillStyle = '#ffd34d'; g.fillText('MA10', 8, H * .74 + 12); g.fillStyle = '#6aa9ff'; g.fillText('MA30', 44, H * .74 + 12);
  if (hover != null) {                          // crosshair + OHLC of the candle under the finger
    const i = clamp(Math.floor((hover - 4) / cw), 0, n - 1), [o, hh, l, cl, v] = cs[i], x = 4 + i * cw + cw / 2;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x, top); g.lineTo(x, H - 14); g.stroke();
    g.fillStyle = 'rgba(20,26,34,.92)'; g.fillRect(6, 6, 200, 18); g.fillStyle = cl >= o ? SK_COL.up : SK_COL.dn; g.textBaseline = 'middle';
    g.fillText(`เปิด ${o} สูง ${hh} ต่ำ ${l} ปิด ${cl}`, 10, 15);
  }
}
function rewardsPanel() {
  const L = me.login; if (!L) return '';
  const it = L.big.item && G.shop.furniture[L.big.item], into = L.every - L.toBig;
  const gifts = Object.entries(G.shop.furniture).filter(([, f]) => f.gift).map(([k, f]) => `<span class="gift ${(me.keep || []).includes(k) ? 'own' : ''}" title="${esc(f.name)}">${f.icon}<small>${(me.keep || []).includes(k) ? '✓' : ''}</small></span>`).join('');
  const w = me.wquests, todo = achTodo();
  return `<h2>🎁 รางวัลและความคืบหน้า</h2>
    <div class="secT">📅 โบนัสเข้าเกม</div>
    <div class="grid2"><div class="item"><div class="nm">🔥 ติดต่อกัน<small>${L.streak} วัน</small></div></div><div class="item"><div class="nm">📆 เข้าเกมรวม<small>${L.days} วัน</small></div></div>
      <div class="item"><div class="nm">✅ วันนี้ได้แล้ว<small>${money(L.today)}</small></div></div><div class="item"><div class="nm">⏭️ พรุ่งนี้จะได้<small><b style="color:var(--acc)">${money(L.tomorrow)}</b> (ถ้าเข้าต่อเนื่อง)</small></div></div></div>
    <div class="days">${L.table.map((v, i) => `<div class="${i + 1 < Math.min(L.streak, 7) ? 'got' : i + 1 === Math.min(L.streak, 7) ? 'now' : ''}"><small>วัน ${i + 1}${i === 6 ? '+' : ''}</small><b>฿${i === 6 ? Math.max(v, L.today) : v}</b></div>`).join('')}</div>
    <div class="sub">หลังวันที่ 7 ได้เพิ่มวันละ ฿10 จนถึง ฿500/วัน · ขาดหนึ่งวัน โบนัสรายวันเริ่มนับใหม่</div>
    <div class="jobbox"><b>🎉 รางวัลใหญ่ทุก ${L.every} วันที่เข้าเกม</b> (นับรวม ขาดได้ไม่หาย)
      <div class="wbar big"><u style="width:${into / L.every * 100}%"></u></div>
      <div class="sub">${into}/${L.every} วัน · <b>อีก ${L.toBig} วัน</b> ได้ ${money(L.big.cash)}${it ? ` + ${it.icon} <b>${it.name}</b> (เฟอร์นิเจอร์พิเศษ ความสบาย +${it.comfort})` : ''}</div>
      <div class="gifts">${gifts}</div><div class="sub">ของพิเศษหาซื้อไม่ได้ ได้จากรางวัลใหญ่เท่านั้น เก็บไว้ตลอดแม้ยังไม่มีบ้าน มีบ้านเมื่อไหร่จะตั้งให้อัตโนมัติ</div></div>
    ${w ? `<div class="secT">🗓️ เควสต์รายสัปดาห์ ${w.list.filter(x => x.done).length}/3</div>${w.list.map(x => `<div class="sub">${x.done ? '✅' : '◻️'} ${esc(x.text)} · ${x.p.toLocaleString()}/${x.n.toLocaleString()}</div>`).join('')}${B('ดูเควสต์รายสัปดาห์', { fn: 'open', kind: 'quests', set: { tab: 'week' } }, 'good')}` : ''}
    <div class="secT">🏅 ความสำเร็จ ${(me.ach || []).length}/${G.ach.length}</div>
    ${B(todo.length ? `🎁 รับรางวัลความสำเร็จ (${todo.length})` : 'ดูความสำเร็จทั้งหมด', { fn: 'open', kind: 'achv' }, todo.length ? 'primary' : '')}`;
}
function achRows() {
  const has = id => (me.ach || []).includes(id) ? 0 : 1;   // unlocked titles first, then by rarity
  return G.ach.filter(a => !a.nt).sort((x, y) => has(x.id) - has(y.id) || (x.r || 1) - (y.r || 1)).map(a => {
    const has = (me.ach || []).includes(a.id), c = a.c ? G.careers[a.c] : null, prog = Math.min(a.n, me.stats?.[a.stat] || 0), on = me.title === a.id;
    return `<div class="item ${has ? 'done' : ''}"><div class="em">${has ? '🏅' : '🔒'}</div><div class="nm">${titleHtml(a.title, a.r)}<span class="rtag r${a.r || 1}">${RAR[a.r || 1]}</span> ${c ? `<span class="tag">${c.icon} ${c.name}</span>` : ''}<small>${a.desc} · ${prog.toLocaleString()}/${a.n.toLocaleString()}</small></div>${has ? B(on ? 'ใช้อยู่ ✓' : 'ใช้ฉายานี้', { t: 'title', id: on ? '' : a.id }, on ? 'primary' : 'good') : ''}</div>`;
  }).join('');
}
function paintTradeChat() {
  const box = document.getElementById('tchatLog'); if (!box) return;
  box.innerHTML = tradeChat.map(x => `<div class="${x.mine ? 'me' : ''}"><b>${esc(x.name)}</b>: ${esc(x.text)}</div>`).join('') || '<div class="sub">พิมพ์คุยต่อรองกันได้ตรงนี้</div>';
  box.scrollTop = box.scrollHeight;
}
const hoursTxt = k => { const o = G.hours[k]; return o ? (o[1] - o[0] >= 24 ? 'เปิด 24 ชม.' : `เปิด ${hhmm(o[0])}–${hhmm(o[1])}`) : ''; };
const lic = id => me.licenses.includes(id);
const licExp = id => lic(id) && !!G.licenses[id]?.renew && (me.licExp?.[id] || 0) < Date.now() + clockOff;
const licOk = id => lic(id) && !licExp(id);
// buildings point you to their staff NPC (a separate spot) for applying
function staffHint(career) {
  const c = G.careers[career], n = STAFF.find(x => x.career === career && !x.keeper);
  if (me.career === career) return `<div class="jobbox ok">${c.icon} คุณทำงานเป็น<b>${c.name}</b> · Lv.${me.lv}</div>`;
  return `<div class="jobbox">💬 อยากเป็น ${c.icon} <b>${c.name}</b>? คุยกับ <b>${esc(n?.name || 'เจ้าหน้าที่')}</b> ที่ยืนอยู่ข้างๆ เพื่อสมัครงาน</div>`;
}
// "apply for this job here" block, shown in every building that hires
function applyBox(career, st) {
  const c = G.careers[career];
  if (me.career === career) return `<div class="jobbox ok">${c.icon} คุณทำงานเป็น<b>${c.name}</b>ที่นี่ · Lv.${me.lv}</div>`;
  const miss = (c.need || []).filter(l => !licOk(l)).map(l => G.licenses[l].name + (licExp(l) ? ' (หมดอายุ ต่อที่โชว์รูมรถ)' : ''));
  const wait = me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ เพิ่งเปลี่ยนงาน ต้องรออีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : '';
  return `<div class="jobbox"><b>📝 รับสมัคร ${c.icon} ${c.name}</b><div class="sub">${c.desc}</div>
    ${miss.length ? `<div class="sub" style="color:var(--bad)">ต้องมี: ${miss.join(', ')}</div>` : ''}${wait}
    ${me.career !== 'none' ? `<div class="sub">ตอนนี้คุณเป็น${G.careers[me.career].name} สมัครงานนี้ = ลาออกจากงานเดิม</div>` : ''}
    ${B(`✍️ สมัครงาน${c.name}`, { t: 'act', st, a: 'apply', career }, 'primary big', miss.length > 0 || me.jobWait > 0)}</div>`;
}
const needCareer = c => job(c) || !G.careers[c] ? '' : `<div class="sub" style="color:var(--bad)">⚠️ ต้องเป็น ${G.careers[c].icon} ${G.careers[c].name} ก่อน</div>`;

// what's new: a short summary of every update (newest first). Shown once after each update; also under ⚙️ → 🆕 อัปเดต
const NEWS = [
  { v: '2026-11-23r', d: '21 พ.ย.', items: [
    '🪷 ลอยกระทงที่วัดได้แล้ว! ท่าลอยกระทงสระบัวหน้าโบสถ์ ประดับโคมล้านนารอบสระ (นับรวมภารกิจชุดฟรีเหมือนท่าน้ำทะเลสาบ)',
  ] },
  { v: '2026-11-23q', d: '21 พ.ย.', items: [
    '🎪 <b>งานวัดมาแล้ว!</b> ลานงานวัดข้างสนามฟุตบอล (ลอดซุ้มแดงจากถนนใหม่) มีของกินใหม่: ลูกชิ้นปิ้ง ไส้กรอกอีสาน ขนมครก ไข่นกกระทา ไอติมกะทิ ลูกชุบ ชาเย็น',
    '🎈 เกมงานวัดเล่นได้จริง: ปาเป้าลูกโป่ง · ปาห่วงขวด · ตกเป็ดน้อย ครั้งละ ฿20 ได้เงินรางวัลตามคะแนน คะแนนเต็มได้ตุ๊กตา + 💎',
  ] },
  { v: '2026-11-23p', d: '21 พ.ย.', items: [
    '🏮 หน้าเข้าเกมเปลี่ยนเป็นโปสเตอร์ลอยกระทงช่วงเทศกาล และมีประกาศ "เร็วๆ นี้" ตอนเข้าเกม (วันละครั้ง)',
  ] },
  { v: '2026-11-23o', d: '21 พ.ย.', items: [
    '🏮 <b>เทศกาลลอยกระทง</b> 21–30 พ.ย.! ลอยกระทงที่ท่าน้ำทะเลสาบ เขียนคำอธิษฐาน ลอยคู่กับเพื่อน ปล่อยโคมลอยที่วัด · ลอยครบ 3 วันรับ <b>ชุดไทยลอยกระทง</b> ฟรี · 🌕 อังคาร 24 พ.ย. คืนลอยกระทงจริง รางวัล x2 · กดไอคอน 🏮 ใต้มือถือ',
  ] },
  { v: '2026-11-23n', d: '23 พ.ย.', items: [
    '🗺️ มินิแมพซูมใกล้ขึ้นและเลื่อนตามตัวเรา เห็นจุดคนชัดขึ้น ใครกำลังเดินอยู่จะมีวงกระเพื่อมรอบจุด (กดมินิแมพเพื่อดูแผนที่ทั้งเมือง)',
  ] },
  { v: '2026-11-23m', d: '23 พ.ย.', items: [
    '👮 ชุดอาชีพโฉมใหม่ ทั้งชายและหญิง: ตำรวจ หมอ ไรเดอร์ (สาวไรเดอร์มีชุดของตัวเองแล้ว) และขอทาน',
  ] },
  { v: '2026-11-23l', d: '23 พ.ย.', items: [
    '🎁 <b>กิจกรรมล็อกอิน 7 วัน</b> (ถึง 14 ธ.ค.) เข้าเกมวันไหนก็ได้ครบ 7 วัน รับ <b>ชุดไหมพรมกันหนาว</b> ฟรี! ระหว่างทางมีเงิน เพชร และไข่สัตว์เลี้ยง · กดไอคอน 🎁 ใต้มือถือ',
  ] },
  { v: '2026-11-23k', d: '23 พ.ย.', items: [
    '👗 ชุดใหม่ 6 แบบที่ร้านแฟชั่น (ซื้อด้วยเพชร 💎): 🦖 ชุดไดโนเสาร์, 🩳 ชุดเล่นน้ำ (สาวๆ เป็นบิกินี่), 🧥 โค้ทกันหนาว, 🏍️ ชุดเด็กแว้น (สาวๆ เป็นสก๊อยสายซิ่ง), 🎀 ชุดเมด',
  ] },
  { v: '2026-11-23j', d: '23 พ.ย.', items: [
    '💎 แก้เติมเพชรด้วยสลิปแล้วค้าง "รอชำระ" / ขึ้นว่าสลิปเคยถูกใช้แล้ว ทั้งที่เพิ่งส่งครั้งแรก ตอนนี้ส่งสลิปซ้ำได้ ของเข้าตามปกติ',
  ] },
  { v: '2026-11-23i', d: '23 พ.ย.', items: [
    '🗺️ มินิแมพและแผนที่ใหญ่อัปเดตแล้ว: เห็นย่านใต้ สวนสนุก (เครื่องเล่นแต่ละสี) สนามฟุตบอล และลานน้ำพุ กดหมุดในแผนที่เพื่อนำทางไปได้ · พื้นในแผนที่เป็นหิมะตามฤดู',
  ] },
  { v: '2026-11-23h', d: '23 พ.ย.', items: [
    '⛲ ลานว่างกลางเมือง (ที่เคยเป็นซุ้มสวนสนุก) กลายเป็นลานน้ำพุ มีม้านั่งให้นั่งพัก และรถไอติม & ขนมเปิดขาย',
  ] },
  { v: '2026-11-23g', d: '23 พ.ย.', items: [
    '🏙️ เมืองขยายลงทางใต้! ถนนเส้นใหม่มีทางเท้า เสาไฟ ป้ายรถเมล์ ต่อจากถนนใหญ่ทางใต้ของเมือง',
    '🎡 สวนสนุกกับ ⚽ สนามฟุตบอลย้ายมาอยู่ในเมืองหลักแล้ว เดินลอดซุ้มประตูเข้าไปได้เลย ไม่ต้องวาร์ป ยืนดูคนเตะบอลจากริมถนนก็ได้',
    '🚀 เกมลื่นขึ้นมาก โดยเฉพาะที่ที่คนเยอะ (ตัวละครไม่ต้องวาดใหม่ทุกเฟรมแล้ว)',
  ] },
  { v: '2026-11-23f', d: '23 พ.ย.', items: [
    '🏟️ อัฒจันทร์สนามบอลขึ้นไปนั่งได้แล้ว (10 ที่นั่ง) เดินเข้าใกล้เก้าอี้แล้วกดนั่ง',
    '⚽ สนามฟุตบอลเล็กลงครึ่งหนึ่ง เล่นกันสนุกขึ้น ไม่ต้องวิ่งไกล',
  ] },
  { v: '2026-11-23e', d: '23 พ.ย.', items: [
    '⚽ เปิดสนามฟุตบอลสาธารณะ! ทางเข้าอยู่ริมถนนฝั่งซ้ายของเมือง (ทางไปไร่เก่า) หรือเรียกแท็กซี่ไปก็ได้',
    '🥅 เตะบอลได้จริง ทุกคนในสนามเห็นลูกเดียวกัน เดินชนบอลเพื่อเลี้ยง เข้าใกล้แล้วกดปุ่ม ⚽ เตะ (ยิงไปทางที่วิ่งอยู่)',
    '📺 ป้ายสกอร์ ฟ้า - ชมพู ยิงเข้าประตูขวา = ทีมฟ้าได้แต้ม ประตูซ้าย = ทีมชมพู คนยิงได้ความสุขเพิ่ม',
  ] },
  { v: '2026-11-23d', d: '23 พ.ย.', items: [
    '📱 แก้ iPhone/iPad จอดำและขึ้น "กำลังเชื่อมต่อใหม่" วนไม่หยุด หลังอัปเดตหิมะ (ตอนนี้โหลดเบาลงมาก)',
  ] },
  { v: '2026-11-23c', d: '23 พ.ย.', items: [
    '❄️ ฤดูหนาวมาแล้ว! สนามหญ้าทั้งเมืองกลายเป็นหิมะ ต้นไม้และพุ่มไม้มีหิมะเกาะ',
    '☂️ ลุงชัยขายร่มย้ายมายืนข้างเสาไฟมุมซ้ายล่างของจัตุรัส (ทางไปร้าน 24 ชม.) เดินเข้าใกล้มีวงกลมเหลือง กดปุ่มใช้งานคุยได้เลย',
    '👑 ชื่อแอดมินในแชทเป็นสีรุ้ง · แอดมินซ่อนสีชื่อบนหัวได้ในแผง God',
  ]},
  { v: '2026-11-23b', d: '23 พ.ย.', items: [
    '🛋️ ย้ายปุ่มจัดบ้านขึ้นไปไว้เหนือปุ่มอื่น ไม่ซ้อนปุ่มอิโมจิ/ขี่รถแล้ว (ทั้งในบ้านและในลานบ้าน)',
  ]},
  { v: '2026-11-23a', d: '23 พ.ย.', items: [
    '🔑 ล็อกอินด้วย Google บนมือถือ: เลือกบัญชีแล้วกลับเข้าเกมในแท็บเดิม (เดิมเด้งไปแท็บอื่น) · คนที่ผูก Google แล้วกด "เล่นต่อ" ได้เลย',
    '🚜 เอาไร่ชานเมืองออกจากเกมและแผนที่แล้ว (ประตูทางไปไร่ทางซ้ายของเมืองหายไปด้วย) · ใครค้างอยู่ในไร่ เข้าเกมครั้งหน้าจะกลับมาที่เมือง',
  ]},
  { v: '2026-11-22c', d: '22 พ.ย.', items: [
    '☂️ ร้านสะดวกซื้อมีร่มขายแล้ว ซื้อได้ทุกเวลา (ลุงชัยยังมาขายตอนฝนตกเหมือนเดิม)',
    '🍳 ทำอาหารที่ครัวใหญ่ไม่บวก EXP อาชีพอื่นแล้ว (ได้อาหาร + ทิปเหมือนเดิม)',
    '💼 ลาออกจากพนักงานบริษัทเอง เลเวลไม่หายแล้ว (ถ้าโดนไล่ออกยังเริ่มใหม่)',
    '🧑‍🤝‍🧑 ภารกิจพาลูกค้า: ลูกค้าเดินลัดตามเรา ไม่เดินย้อนกลับไปทางเก่าแล้ว',
    '💇 ย้อมผมติดทั้งหัว ไม่เหลือ 2 สี (ชุดจีน ชุดเซิร์ฟ ฯลฯ)',
    '🪧 ป้ายทางเข้าหมู่บ้านจัดสรรกดอ่านได้แล้ว · 🛋️ ปุ่มจัดบ้านไม่ซ้อนปุ่มอิโมจิแล้ว',
  ]},
  { v: '2026-11-22b', d: '22 พ.ย.', items: [
    '🔮 แม่หมอจันทรามายืนหน้าเต็นท์แล้ว (เดิมโดนเต็นท์บังมองไม่เห็น)',
    '🃏 หน้าดูดวงใหม่: เลือกไพ่คว่ำ 3 ใบ (การเงิน/การงาน/ความรัก) แล้วไพ่พลิกเปิดพร้อมคำทำนาย',
    '👁️ แม่หมอแม่นขึ้น: มองเห็นชีวิตจริงของคุณในเมือง (เงินเข้าออก หนี้ งาน คนในโทรศัพท์ สัตว์เลี้ยง) + เลขนำโชคและสีมงคลประจำวัน',
  ] },
  { v: '2026-11-22', d: '22 พ.ย.', items: [
    '🔮 เปิดเต็นท์แม่หมอจันทรา กลางเมือง: เลือกดูการเงิน การงาน หรือความรัก เปิดไพ่ยิปซี 1 ใบ ฿50 วันละครั้ง ไพ่ดีรับโบนัส ฿30',
    '👗 ชุดใหม่ "ชุดแม่หมอพยากรณ์" ที่ร้านแฟชั่น (💎300)',
  ] },
  { v: '2026-11-21c', d: '21 พ.ย. (รอบ 74)', items: [
    '⚡ ไฟล์เกมเล็กลง โหลดเข้าเกมเร็วขึ้น (โดยเฉพาะเน็ตมือถือ)',
  ] },
  { v: '2026-11-21b', d: '21 พ.ย. (รอบ 73)', items: [
    '📣 แอดมินกดคัดลอกข่าวอัปเดตไปโพสต์ในกลุ่มเฟสได้ในคลิกเดียว (⚙️ → โพสต์ข่าวลงเฟส)'] },
  { v: '2026-11-21a', d: '21 พ.ย. (รอบ 72)', items: [
    '📱 <b>แก้ iPhone เด้งออก/หน้าเว็บมีปัญหา</b>: ภาพตัวละครแยกเป็นไฟล์เล็กตามชุด โหลดเฉพาะชุดที่มีคนใส่อยู่ใกล้ๆ ใช้หน่วยความจำน้อยลงมาก',
    '⚡ เจอผู้เล่นคนอื่นแล้วไม่กระตุก (ถ้าชุดยังโหลดไม่เสร็จ จะเห็นใส่ชุดธรรมดาแป๊บเดียว)'] },
  { v: '2026-11-20l', d: '20 พ.ย. (รอบ 71)', items: [
    '🐺 <b>คืนหมาป่าโฉมใหม่</b>: คนที่โดนกัดจะกลายเป็น<b>หมาป่าลูกน้อง</b> ช่วยล่าคนอื่นต่อ · มนุษย์จะไม่เห็นใครบนมินิแมพ',
    '👃 สกิลหมาป่า (แทนปุ่มเดิม): <b>ดมกลิ่น</b> (แทนกระเป๋า) มนุษย์ขึ้นจุดแดงบนแผนที่ + ลูกศรชี้ 8 วิ · <b>วิ่งไว</b> (แทนปุ่มวิ่ง) 5 วิ · <b>เรียกสมุน</b> (แทนปุ่มใช้งาน) หมาป่า 2 ตัวมาช่วยไล่ 20 วิ',
    '💰 มนุษย์รอดถึงเช้าได้รางวัลเต็ม · ถ้ากัดหมดเมือง หมาป่าแบ่งเงินกัน โฮสได้มากสุด ที่เหลือตามจำนวนที่กัด'] },
  { v: '2026-11-20k', d: '20 พ.ย. (รอบ 70)', items: [
    '⚡ <b>ลดแลค</b>: เซิร์ฟเวอร์ไม่ค้างตอนบันทึกข้อมูลแล้ว (เดิมกระตุกพร้อมกันทุก 15 วินาที) · ส่งข้อมูลผู้เล่นน้อยลง',
    '📱 มือถือจอ 90/120Hz วาดภาพไม่เกิน 60 เฟรม เครื่องไม่ร้อน ลื่นนานขึ้น'] },
  { v: '2026-11-20j', d: '20 พ.ย. (รอบ 69)', items: [
    '🐺 หมาป่ามีรูปใหม่ วาดเต็มตัว เดิน/วิ่งได้ทุกทิศ · มี<b>เส้นขอบสีม่วง</b>รอบตัว มองเห็นง่ายแม้กลางคืน',
    '🌕 การ์ดเตือนคืนจันทร์เต็มดวงมีภาพใหม่'] },
  { v: '2026-11-20i', d: '20 พ.ย. (รอบ 68)', items: [
    '🎈 ร้านลูกโป่งลุงโป่งย้ายไปอยู่ที่<b>สวนสนุก</b> (ถนนร้านค้าด้านใต้) · ลูกโป่งที่ซื้อแล้วยังถือได้เหมือนเดิม',
    '👗 ร้านแฟชั่นเลิกขายชุดสีพิเศษ (ใครซื้อไปแล้วยังใส่ได้จากกระเป๋า)',
    '🚁 เฮลิคอปเตอร์ส่วนตัวในโชว์รูม ล็อกไว้ก่อน เร็วๆ นี้เปิดขาย'] },
  { v: '2026-11-20h', d: '20 พ.ย. (รอบ 67)', items: [
    '🌕🐺 <b>คืนหมาป่า</b> ทุกคืนจันทร์เต็มดวง 21:00 น. สุ่มคนในเมืองกลายเป็นหมาป่า ไล่ขย้ำคนอื่น · หมาป่ายืนนิ่งเกิน 3 วิ คำสาปหลุดไปหาคนใหม่ · รอดถึงเช้าได้รางวัลเต็ม ถ้าหมาป่ากินหมด โฮสหมาป่าได้ส่วนแบ่งมากสุด',
    '💼 <b>อาชีพใหม่ 6 อาชีพ</b>: 🧒 เด็กวัด · ⚱️ สัปเหร่อ (หน้าประตูวัด) · 🔧 ช่างซ่อมรถ (หน้าโชว์รูม) · 😎 นักเลง (ตลาด) · 📷 ช่างภาพ (จัตุรัส) · 📦 พนักงานส่งของ (หน้าคลังสินค้า) ทำภารกิจเดินจริงในเมือง',
    '📋 ภารกิจใหม่: หมอออกตรวจผู้ป่วย 5 บ้าน · ตำรวจสืบคดีงัดร้านทอง · ช่างซ่อมรถ 3 คัน · ช่างภาพถ่ายภาพ 5 สถานที่ · ส่งพัสดุ 10 ชิ้น',
    '🎈 <b>ร้านลูกโป่งลุงโป่ง</b> ข้างน้ำพุ ซื้อแล้วถือเดินให้ทุกคนเห็น มีทรงหัวใจ ดาว และลูกโป่งทองคำ',
    '🔔 ระฆังวัดดังบ่อยขึ้น ได้ยินถึงในเมือง (6 โมงเช้า/6 โมงเย็นตี 3 ครั้ง)',
    '🆕 แก้หน้าข่าวอัปเดตไม่เด้ง'] },
  { v: '2026-11-20g', d: '20 พ.ย. (รอบ 66)', items: [
    '⌨️ <b>พนักงานบริษัท</b>: งานใหม่ "พิมพ์เอกสารตามแบบ" นั่งโต๊ะคอมพิมพ์ให้ตรงต้นแบบ (กดที่บริษัท)',
    '📦 <b>พนักงานร้านสะดวกซื้อ</b>: งานใหม่ "เติมของและจัดเรียงชั้น" หยิบจากลังวางให้ตรงช่อง',
    '🥤 <b>พ่อค้า</b>: งานใหม่ "ส่งของเติมตู้กดน้ำ" ทั่วเมือง เติมตู้เต็มได้โบนัส (กดที่โรงประมูล)',
    '🧟 <b>คืนปล่อยผีโหดขึ้น</b>: ขอบเมืองทั้ง 4 ทิศมีซอมบี้วิ่งไว 2 ตัว + ซอมบี้อ้วน 1 ตัวเฝ้าอยู่ หนีไปหลบขอบแมพไม่รอดแล้ว!',
    '🧠 ซอมบี้ฉลาดขึ้น: บางตัวไม่วิ่งตามหลัง แต่<b>ดักหน้า</b>ทางที่คุณกำลังวิ่งไป'] },
  { v: '2026-11-20f', d: '20 พ.ย. (รอบ 65)', items: [
    '👗 <b>ชุดแฟชั่นใหม่ 11 แบบ</b> ที่ร้านแฟชั่น (มีแบบผู้หญิงด้วย): ชุดนอนลายเสือ · ช่างภาพสายลุย · ชุดกันฝนเหลือง · นักสำรวจป่า · แมวขาวขนฟู · และชุดเพชร 💎 ไก่น้อยกุ๊กกุ๊ก · สายเซิร์ฟฮาวาย · ฮิปฮอปสตรีท · ไทยราชสำนัก · จอมยุทธ์มังกรแดง · อัศวินเกราะเงิน',
    '🎨 <b>ชุดสีพิเศษ</b> ทั้งชุดใหม่และชุดเก่า แยกเป็นชุดละชิ้น อยู่ในแท็บ 🎨 สีพิเศษ (เปลี่ยนแค่สีผ้า ผิวกับผมเหมือนเดิม)',
    '👗 ร้านแฟชั่นแบ่งหมวด: ลำลอง · ไทย & เทศกาล · คอสตูม · สีพิเศษ'] },
  { v: '2026-11-20e', d: '20 พ.ย. (รอบ 64)', items: [
    '🪪 <b>หน้าข้อมูลผู้เล่นใหม่</b>: โชว์ตัวละครในชุด สัตว์เลี้ยง และรถของคุณไว้อวด (ตัวละครอยู่หน้ารถเสมอ) · กด ✏️ เลือกเองได้จากของที่มี · คนอื่นแตะดูก็เห็น',
    '🏅 เลือกความสำเร็จที่จะโชว์ได้เอง 3 อัน · หน้าข้อมูลเหลือแค่ทรัพย์สินรวมกับความสำเร็จ ดูสะอาดตา',
    '🎒 แท็บชุดในกระเป๋าเป็นรูปชุดแบบเดียวกับร้านขายชุด · เอาข้อมูลเบ็ดออกจากกระเป๋า (เปลี่ยนเบ็ดได้ที่ร้านน้าเล็ก)'] },
  { v: '2026-11-20d', d: '20 พ.ย. (รอบ 63)', items: [
    '📐 จัดหน้าจอใหม่: รูปโปรไฟล์กับแถบสถานะชิดซ้ายขึ้น · จอแนวนอนแถบสถานะยาวเท่ากล่องเควสต์ · จอแนวตั้งเห็นเงินกับเพชรครบ',
    '💬 <b>ลากหน้าต่างแชทได้</b> จับที่ปุ่ม ⠿ แล้วลากไปวางตรงไหนก็ได้ (แตะสองครั้งเพื่อคืนที่เดิม)',
    '🗨️ แชทโลกขึ้นเป็นข้อความบนหัวตัวละครแล้ว',
    '📖 สมุดภาพปลาแบ่งหมวดตามความหายาก ธรรมดา → ตำนาน',
    '⭐ <b>ความสำเร็จเล็กๆ 20 อย่าง</b> ไม่มีฉายา แต่ได้เพชร 💎1–3',
  ] },
  { v: '2026-11-20c', d: '20 พ.ย. (รอบ 62)', items: [
    '💎 <b>ร้านเติมเงินแบบใหม่</b> สแกน QR พร้อมเพย์จากแอปธนาคารไหนก็ได้ แล้วอัปโหลดสลิป ระบบตรวจสลิปให้อัตโนมัติ ของเข้าทันที',
  ] },
  { v: '2026-11-20b', d: '20 พ.ย. (รอบ 61)', items: [
    '🖼️ <b>วอลเปเปอร์มือถือ</b> ใส่รูปของตัวเองได้ ปรับซูม เลื่อนซ้าย-ขวา ขึ้น-ลง และความมืดได้ หรือเลือกสีพื้นฐาน (แอปวอลเปเปอร์ในมือถือ)',
    '📱 จัดแอปในมือถือใหม่เป็นหมวด: ติดต่อ · เงินทอง · ชีวิตประจำวัน · รางวัล · อื่นๆ หาแอปง่ายขึ้น',
    '📘 <b>LifeBook</b> แอปโซเชียลสีฟ้า รวมไอเดีย (และแจ้งบัค) เพื่อน และงาน ไว้ในแอปเดียว',
    '😀 ปุ่มอิโมจิกลับมาแล้ว อยู่เหนือปุ่มวิ่ง',
    '🎨 <b>เลือกสีผิว</b>ได้แล้ว 5 แบบ ฟรี ที่ร้านทำผม 💈',
    '🏴 หัวหน้าแก๊งเปลี่ยนชื่อแก๊งได้แล้ว 💎300 (บ้านแก๊ง → เปลี่ยนชื่อแก๊ง)',
    '🧾 ค่าน้ำค่าไฟถูกลงครึ่งหนึ่ง และไม่คิดค่าน้ำค่าไฟช่วงที่ออฟไลน์',
    '📊 แถบสถานะดูง่ายขึ้น: ไม่มีตัวเลข หลอดอยู่ชิดชื่อ กรอบกว้างขึ้น',
  ] },
  { v: '2026-11-20a', d: '20 พ.ย. (รอบ 60)', items: [
    '⚡ แก้อาการแลค: ส่งข้อมูลระหว่างเกมกับเซิร์ฟน้อยลงราว 3–4 เท่า และตัวละครวาดลื่นขึ้นในที่คนเยอะ',
    '☂️ ร่มกันฝน! ฝนตกเมื่อไหร่ ลุงชัยจะถือร่มเดินมาขายที่จัตุรัส (มาเฉพาะตอนฝนตก) เก็บไว้ในกระเป๋า ฝนตกตอนอยู่ข้างนอกจะกางให้เอง ไม่เปียก ไม่เป็นหวัด',
    '💇 แก้สีผมที่ย้อมไม่ขึ้นตอนใส่ชุดทำงานหรือชุดพิเศษ ตอนนี้เห็นสีผมแล้ว (ถ้าใส่หมวก จะเห็นเฉพาะผมใต้หมวก)',
  ] },
  { v: '2026-11-19p', d: '19 พ.ย. (รอบ 59)', items: [
    '💎 เปิดร้านเติมเงิน! กดไอคอน 💎 ข้างมือถือได้เลย',
    '💖 ฉายาวิ้งวับ "ผู้สนับสนุนเมือง" 30 วัน และ 😇 ชุดเทวดา/นางฟ้า ดูตัวอย่างตัวละครของเราเองก่อนซื้อได้',
  ] },
  { v: '2026-11-19o', d: '19 พ.ย. (รอบ 58)', items: [
    '⚡ ทำงาน/เควสใช้พลังงานน้อยลงราว 30% ทุกอาชีพ',
    '⏱️ คูลดาวน์เควสอาชีพสั้นลง: ภารกิจ ICU, ตามจับโจร, ตามหาหมา, ภารกิจหมอ และมินิเกมอาชีพ',
    '🌟 ผู้สมัครนายกได้ชื่อเสียงฟรีจากการทำดีให้เมือง (เก็บขยะ ให้ทาน ทำบุญ รักษาคนไข้ ส่งของ ตั้งใจเรียน รอดคืนปล่อยผี) สูงสุด 6/วัน',
    '🧟 คืนปล่อยผี: มีรายชื่อผู้รอดเล็กๆ ขอบซ้าย (แตะเพื่อพับ) และประกาศผู้รอดชีวิตตัวใหญ่กลางจอ ผู้รอดได้ป้าย 🏆 เหนือหัว 3 นาที',
  ] },
  { v: '2026-11-19n', d: '19 พ.ย. (รอบ 57)', items: [
    '🎡 <b>สวนสนุกโฉมใหม่ กะทัดรัด</b> เครื่องเล่นทุกอย่างอยู่ใกล้กัน เดินไม่กี่ก้าว · มี<b>ถนนร้านค้า</b> ด้านใต้: 🏪 มินิมาร์ท 24 ชม., ร้านขนม & ของฝาก, ฟู้ดทรัค, รถไอศกรีม, คาเฟ่ และตู้กดน้ำ',
  ] },
  { v: '2026-11-19m', d: '19 พ.ย. (รอบ 56)', items: [
    '💸 <b>ประวัติการเงิน</b> แอพใหม่ในมือถือ ดูได้ว่าเงินเข้า-ออกจากอะไร รายรับ/รายจ่ายวันนี้ และจ่ายอะไรมากสุด',
    '✏️ <b>บัตรเปลี่ยนชื่อ 💎10</b> กด "แก้ไขชื่อ" ที่หน้าข้อมูลผู้เล่น',
    '📜 แก้เควสต์รายสัปดาห์ที่ค้าง: เควสต์ของอาชีพเก่าเปลี่ยนเป็นเควสต์ที่ทำได้ · เควสต์ทำอาหาร 26 จาน ลดเหลือ 10 จาน (ความคืบหน้าและรางวัลเท่าเดิม)',
  ] },
  { v: '2026-11-19l', d: '19 พ.ย. (รอบ 55)', items: [
    '🍳 <b>ครัวใหญ่ทำอาหารได้แล้ว ใครก็ทำได้</b> รับออเดอร์ เดินไปตู้วัตถุดิบ เขียง กระทะ หม้อ เตาย่าง แล้วจัดจานเสิร์ฟ (หั่นผักผลไม้ยังเล่นได้เหมือนเดิม) · มีเควสต์ทำอาหารให้ทุกคน',
    '🧾 <b>ค่าจ้างบอกยอดเข้ากระเป๋าจริง</b> ถ้ามีหักภาษีหรือผ่อนเงินกู้อัตโนมัติ จะบอกว่าหักไปเท่าไร',
    '🧟 <b>คืนปล่อยผีสู้กันในเมือง</b> สวนสนุก หมู่บ้านจัดสรร และวัด ปิดชั่วคราว ใครอยู่ข้างในจะถูกพากลับเข้าเมือง',
    '💡 แก้บัค: พิมพ์ไอเดียแล้วข้อความหายก่อนกดโพสต์',
    '📱 <b>อัปเดตและบทช่วยสอนย้ายไปอยู่ในมือถือ</b>',
  ] },
  { v: '2026-11-19k', d: '19 พ.ย. (รอบ 54)', items: [
    '🧟 <b>ซอมบี้มีขอบแดงชัดๆ</b> และวงแดงกระพริบที่พื้น มองเห็นง่ายในที่มืด',
    '👀 <b>คืนปล่อยผีมองเห็นชัดขึ้น</b> จอมืดน้อยลง ป้ายแจ้งเตือนเล็กลง อยู่ด้านบน ไม่บังทางวิ่ง',
    '⏱️ <b>พืชในสวนมีเวลานับถอยหลัง</b> ใต้ต้น พร้อมแถบความคืบหน้า ขึ้นว่า "เก็บได้!" เมื่อโตเต็มที่',
    '🎒 <b>กระเป๋าจัดหมวดหมู่</b> แยกแท็บ ของ / ชุด & เบ็ด / ข้อมูล และแยกหมวด กิน/ใช้ · ปลา · ผลผลิต · ของอื่น',
  ] },
  { v: '2026-11-19j', d: '19 พ.ย. (รอบ 53)', items: [
    '🧾 <b>ลดภาษีรายได้</b> ฿30,000 แรกต่อวันไม่เสีย ส่วนที่เกินเสียแค่ 5% เกิน ฿100,000 เสีย 10% (เดิม 10% / 20%)',
    '⛽ <b>ราคาน้ำมันขึ้นลงรายวัน</b> เหมือนปั๊มจริง ไม่เกิน ±15% และโดยรวมถูกลงกว่าเดิม ดูราคาวันนี้และพรุ่งนี้ได้ที่หน้าสถิติ',
    '📉 <b>วันที่เศรษฐกิจซบเซา รัฐลดภาษีครึ่งหนึ่ง</b> ภาษีไม่มีวันสูงกว่าปกติ',
  ] },
  { v: '2026-11-19i', d: '19 พ.ย. (รอบ 52)', items: [
    '📝 <b>ควิซระหว่างนั่งเรียน</b> มีคำถามเด้งขึ้นมาให้ตอบ ตอบถูกเรียนจบคาบเร็วขึ้น ตอนอาจารย์เรียกตอบถูกได้โบนัสเงินด้วย ตอบผิดไม่เสียอะไร',
    '🔔 <b>แจ้งเตือนกลางจอเล็กลง</b> เป็นแถบเล็กๆ ไม่บังหน้าจอ',
    '🐦 <b>เหตุการณ์สุ่มในห้องเรียน</b> นกบินเข้าห้อง เจอเหรียญใต้โต๊ะ เพื่อนส่งโน้ต หรือแบ่งขนมให้',
  ] },
  { v: '2026-11-19h', d: '19 พ.ย. (รอบ 51)', items: [
    '🎡 <b>ย้ายทางเข้าสวนสนุกมาใกล้ๆ</b> อยู่ข้างถนนสายกลางใต้ลานเมือง เดินจากจุดเกิดไม่กี่ก้าว พร้อมซุ้มประตูใหม่ ตกแต่งลูกโป่ง ซุ้มตั๋ว และซุ้มขนม',
  ] },
  { v: '2026-11-19g', d: '19 พ.ย. (รอบ 50)', items: [
    '🤧 <b>ป่วยยากขึ้น</b> โอกาสติดหวัด/ไข้หวัดใหญ่/อดนอนลดลงครึ่งหนึ่ง',
    '🛡️ <b>ภูมิคุ้มกันนานขึ้น</b> หายป่วยแล้วกันป่วยซ้ำ 20 นาที (ออกจากโรงพยาบาล 30 นาที)',
    '⚠️ <b>มีเตือนก่อนป่วย</b> ตากฝนใกล้เปียก หรือยืนใกล้คนป่วย จะมีข้อความเตือนให้หลบ',
    '😌 <b>ไข้หวัดหายเองได้</b> นั่งหรือนอนพักในอาคารต่อเนื่อง 1 นาที',
  ] },
  { v: '2026-11-19f', d: '19 พ.ย. (รอบ 49)', items: [
    '🌳 <b>ร้านต้นไม้เปิดแล้ว</b> (แทนร้านดอกไม้) จัดร้านเป็นระเบียบ ขายต้นไม้ในบ้านและของแต่งสวน คุยกับป้าสายใจได้เลย',
    '🏡 <b>อสังหาริมทรัพย์เปิด 24 ชั่วโมง</b>',
    '🖼️ <b>กรอบสายรุ้งกับนีออนวางขายแล้ว</b> ฿12,000 ที่เมนูกรอบรูป',
    '😇 <b>ชุดเทวดา/นางฟ้ามีแอร่า</b> เทวดามีห่วงเรืองแสงกับขนนกร่วง นางฟ้ามีประกายดาวสีชมพู',
    '🌾 <b>รูปพืชผักแบบวาดใหม่</b> ข้าว ข้าวโพด พริก ทุเรียน และพืชใหม่ในสวนบ้าน',
    '🐞 แก้บัค: ที่นั่งบางตัวที่ลุกไม่ได้ (ติดกำแพง) ตอนนี้ขยับออกได้แล้ว',
  ] },
  { v: '2026-11-19e', d: '19 พ.ย. (รอบ 48)', items: [
    '🌱 <b>ทุกคนปลูกผักในสวนบ้านได้แล้ว!</b> ซื้อ🟫 แปลงดินที่ร้านเฟอร์นิเจอร์ (แท็บสวน) วางต่อกันเป็นแปลงในสวนหลังบ้าน แล้วแตะแปลงเพื่อปลูก',
    '💧 ผักต้อง<b>รดน้ำ</b> ไม่รดจะโตช้าลงครึ่งหนึ่ง แตะแปลงแล้วกด รดน้ำทั้งแปลง · ดินที่รดแล้วจะเป็นสีเข้ม ฝนตกก็รดให้',
    '💦 <b>สปริงเกลอร์</b> ทองแดง (3×3) และอิริเดียม (5×5) วางกลางแปลงแล้วรดน้ำรอบตัวให้เอง ตอนวางจะเห็นกรอบสีฟ้าว่ารดถึงช่องไหน',
    '🌿 ต้นผักโตให้เห็นทีละขั้น: เมล็ด → ต้นอ่อน → ใบเต็ม → ออกดอก → ผลสุก',
    '🌾 อาชีพเกษตรกรปิดแล้ว ใครเป็นเกษตรกรอยู่จะกลับมาว่างงาน (เลือกอาชีพใหม่ได้) และได้คืนค่าสวนที่ไร่เต็มจำนวน',
  ] },
  { v: '2026-11-19d', d: '19 พ.ย. (รอบ 47)', items: [
    '🛋️ <b>จัดบ้านใหม่!</b> กดปุ่มจัดบ้านในบ้าน แล้ว<b>แตะของในห้อง</b>เพื่อหยิบย้ายได้เลย · ปุ่ม 📦 เปิดคลังของ',
    '🗂️ คลังเฟอร์นิเจอร์แบ่งเป็นหมวดเหมือนร้าน มีรูปของจริง ของซ้ำรวมเป็นใบเดียวพร้อมตัวเลขจำนวน',
    '🧱 วางของทะลุกำแพงไม่ได้แล้ว (เงาจะเป็นสีแดงถ้าวางตรงนั้นไม่ได้)',
    '🟫🎨 ร้านเฟอร์นิเจอร์ขาย<b>พื้น</b>และ<b>วอลเปเปอร์ผนัง</b>แล้ว ซื้อครั้งเดียว เลือกแต่งแยกแต่ละชั้นได้',
  ] },
  { v: '2026-11-19z', d: '19 พ.ย. (รอบ 46)', items: [
    '🧟 <b>คืนปล่อยผี!</b> ทุกวันที่ 13 เวลา 20:00 น. ซอมบี้จะบุกเมือง มีเวลา 60 วินาทีให้ออกจากอาคาร ใครอยู่ข้างในจะโดนรุมแล้วฟื้นที่จัตุรัส',
    '🏃 ซอมบี้มาเป็นระลอกตามจุดที่มีผู้เล่น ทั้งในเมือง ไร่ หมู่บ้าน สวนสนุก วัด และสวนหลังบ้าน ระวัง <b>ซอมบี้วิ่ง</b> กับ <b>ซอมบี้ยักษ์</b> ระลอกสุดท้าย',
    '🚪 ระหว่างคืนปล่อยผี ประตูทุกอาคารถูกปิดตาย ต้องหนีอยู่ข้างนอกเท่านั้น จุดแดงบนแผนที่เล็กคือซอมบี้',
    '📜 รอดถึงฟ้าสาง รับ <b>จดหมายผู้รอดชีวิต</b> ฿5,000 + 💎5 และฉายา «ผู้รอดชีวิต» / «นักล่าซอมบี้» (รอด 5 ครั้ง)',
  ] },
  { v: '2026-11-19h', d: '19 พ.ย. (รอบ 45)', items: [
    '🎡 <b>สวนสนุกเปิดให้เล่นฟรี!</b> ทุกเครื่องเล่นไม่ต้องซื้อตั๋วแล้ว',
    '✕ <b>ยกเลิกเควสได้ทุกที่</b> กดกากบาทบนแถบเควส (ตามหาหมา จับโจร ภารกิจอาชีพ)',
    '🚑 หมดสติรอบที่ 2 ของวันขึ้นไป ฟื้นเร็วขึ้น: เริ่มที่ 10 วินาที แล้วค่อยๆ นานขึ้น สูงสุด 30 วินาที',
    '🛋️ <b>จัดบ้านแบบใหม่</b> ไม่มีแถบบังกลางจอแล้ว ใช้ปุ่มขวาล่าง: ✓ วาง · ✕ ยกเลิก · 🔄 หมุน · 📦 เก็บ · ระหว่างจัดบ้านพลังงาน ความอิ่ม เลือด ความสุขไม่ลด',
    '🛏️ <b>ย้ายเตียงประจำบ้านได้แล้ว</b> (อยู่ในรายการจัดบ้าน วางได้ที่ชั้น 1)',
    '🏴 <b>แชทแก๊ง</b> แท็บใหม่ข้างแชทโลก ข้อความสีส้ม เห็นแค่สมาชิกแก๊ง',
  ] },
  { v: '2026-11-19g', d: '19 พ.ย. (รอบ 44)', items: [
    '🎫 <b>ลอตเตอรี่มาแล้ว!</b> แอปใหม่ในมือถือ ใบละ ฿100 ออกทุกวันที่ 1 และ 16 เวลา 16:00 น. รางวัลที่ 1 ฿3,000,000 · 3 ตัวท้าย · 2 ตัวท้าย · ถูกรางวัลรับเงินที่จดหมาย (ไอเดียจากคุณ Tood 💡)',
    '👑 <b>ฉายาเศรษฐี</b> ซื้อได้ที่หน้าเปลี่ยนฉายา ตั้งแต่ ฿1 ล้าน ถึง ฿100 ล้าน',
    '🧾 <b>ภาษีรายได้รายวัน:</b> ฿20,000 แรกของวันไม่เสีย · ส่วนที่เกินเสีย 10% · เกิน ฿60,000 เสีย 20% · ดูยอดได้ที่ข้อมูลผู้เล่น',
    '⛽ <b>ค่าน้ำมัน:</b> ขี่รถส่วนตัวเสียค่าน้ำมันตามระยะทาง รถยิ่งแรงยิ่งกินน้ำมัน (รถไรเดอร์กับรถสายตรวจฟรี)',
    '🥤 เครื่องดื่มชูกำลังกลับมาเพิ่มพลังงาน +20 ดื่มได้วันละ 3 ขวด',
    '⚖️ ปรับสมดุลรายได้อาชีพ: ออฟฟิศและไรเดอร์ได้เงินเพิ่ม 25% · เคสตำรวจจ่ายตามระยะทาง · หมอไม่อยู่หน้าจอไม่ได้เงินเดือน · หั่นผักได้วันละไม่เกิน ฿3,000',
  ] },
  { v: '2026-11-19f', d: '19 พ.ย. (รอบ 43)', items: [
    '🪑 <b>นั่งพักได้พลังงานคืนนิดหน่อย</b> (นั่งต่อเนื่อง 10 วินาทีขึ้นไป ฟื้นได้ถึง 50%) · อยากเต็มหลอดต้องนอนเตียงหรือไปสวนสนุก · ขอบคุณไอเดียจากคุณสมรศรี 💡',
    '🏷️ <b>ซ่อนป้ายเหนือหัวได้</b> ที่ ⚙️ ตั้งค่า: แสดงทั้งหมด / แค่ชื่อ / ซ่อนหมด (เหลือแต่ตัวละครกับข้อความแชท) · ไอเดียจากคุณสมรศรีเช่นกัน',
    '🖼️ กรอบรูปไม่บังหน้าแล้ว · รูปโปรไฟล์คมขึ้น (อัปรูปใหม่อีกครั้งเพื่อให้ได้รูปคม)',
    '🏪 ปรับสมดุลตลาด: ของที่วางขายครบ 2 ชั่วโมงแล้วไม่มีคนซื้อ ตลาดรับซื้อที่ 40% ของราคาตลาด (ดีกว่าขาย NPC แต่ขายให้ผู้เล่นด้วยกันได้ราคาดีที่สุด)',
  ] },
  { v: '2026-11-19e', d: '19 พ.ย. (รอบ 42)', items: [
    '👗 <b>ชุดใหม่ 12 แบบ</b> ที่ร้านแฟชั่น! ชุดนักเรียนไทย ลูกเสือ สงกรานต์ ล้านนา ผ้าซิ่น นักมวยไทย กระต่ายชมพู ตรุษจีน/กี่เพ้า ลูกทุ่งกากเพชร ไทยจักรี · ชุดชายกับหญิงแยกแบบกัน ร้านจะโชว์เฉพาะชุดที่ใส่ได้',
    '😇 <b>ชุดเทวดา / นางฟ้า</b> ราคาพิเศษ 💎200',
    '🎅 <b>ของขวัญปีใหม่!</b> ชาวเมืองทุกคนที่เข้าเล่นภายใน 31 ธ.ค. 2569 รับ <b>ชุดซานต้า</b> ฟรี ไม่มีขาย ดูที่จดหมาย ✉️',
  ] },
  { v: '2026-11-19d', d: '19 พ.ย. (รอบ 41)', items: [
    '🏛️ <b>ระบบนายกเมือง!</b> เลือกตั้งทุก 4 สัปดาห์ (แอป 🏛️ ในมือถือ) · ลงสมัครได้ตั้งแต่ Lv.8 โหวตได้ตั้งแต่ Lv.5 · นายกได้ฉายา เงินเดือนรายวัน เลือกนโยบายเมือง และประกาศได้วันละครั้ง',
    '🏷️ ชื่อ แก๊ง และฉายา ไม่ซ้อนกันแล้ว · ป้ายแก๊งเล็กลงเท่าฉายา',
    '🔋 <b>พลังงาน:</b> อาหารไม่เพิ่มพลังงานแล้ว · นั่งพักไม่ฟื้นพลังงานกับเลือด · พลังงานหมดให้ไปเล่นสวนสนุกหรือนอนเตียงที่บ้าน · มี <b>»»</b> ขึ้นหลังหลอดเวลากำลังฟื้นเร็ว',
    '🎡 <b>สวนสนุกโฉมใหม่</b> เล็กลง เดินง่าย จัดสวยขึ้น · เครื่องเล่นฟื้นพลังงานและเลือด <b>เร็วขึ้น 4 เท่า</b> · สระว่ายน้ำเดินว่ายไปมาได้ · ร้านขายของในสวนสนุก (ป๊อปคอร์น สายไหม ลูกโป่ง ตุ๊กตา ฯลฯ)',
    '🐶 ตั้งชื่อสัตว์เลี้ยงได้ · ใส่/ถอดสายจูงได้ (ซื้อสายจูงที่ร้านสัตว์เลี้ยง)',
    '🏠 ซื้อบ้านได้บ้านโล่ง มีเตียงให้ แต่งเองได้เต็มที่ · <b>เพื่อนกดเข้าชมบ้านได้แล้ว</b> (จากรายชื่อเพื่อน)',
    '💡 แอปใหม่ <b>ไอเดียทำเกม</b> เสนอไอเดีย กดถูกใจ คอมเมนต์ได้ · เอาแชทออกจากมือถือแล้ว',
    '✉️ มีซองจดหมายเด้งบนจอเวลามีจดหมายใหม่ · เปลี่ยนฉายา/กรอบรูปเปิดเป็นหน้าใหม่ กดกลับได้',
    '✨ ชุดไทยทองคำมีออร่าแล้ว · รถหลายคันที่เคยขี่ถอยหลัง หันถูกทางแล้ว',
    '🚁 เฮลิคอปเตอร์กู้ภัยแดงเลิกขาย · เฮลิคอปเตอร์ขาวราคา 💎10,000',
    '🏪 <b>ตลาดกลาง:</b> NPC เลิกขายของแล้ว · สั่งของที่ผู้เล่นวางขายได้ในแอปเดลิเวอรี (แท็บ 🏪 ของจากตลาด) ไรเดอร์รับไปส่ง · ของที่วางขายครบ 2 ชั่วโมงแล้วไม่มีคนซื้อ ตลาดรับซื้อให้ (40% ของราคาตลาด)',
    '🎟️ <b>ชวนเพื่อน!</b> แชร์โค้ดของคุณ เพื่อนได้ 🥚 ไข่สัตว์เลี้ยง 1 ใบ · เมื่อเพื่อนเล่นครบ 30 นาที คุณได้ 🥚 ไข่สุ่ม + 💎10 (สูงสุด 20 คน) รับที่จดหมาย',
    '🐣 ไข่สัตว์เลี้ยง: เปิดในกระเป๋าแล้วฟักเป็นสัตว์ที่ยังไม่มี',
    '🐞 แก้ตัวเลขส่งงานบริษัทเป็น 0 · แก้นั่งเก้าอี้รัวๆ ปั๊มความสุข · แก้ขี่รถลงสระในสวนสนุก · ขี่รถตกปลาไม่ได้แล้ว (ลงจากรถก่อน)',
  ] },
  { v: '2026-11-19c', d: '19 พ.ย. (รอบ 40)', items: [
    '🛕 <b>ทางเข้าวัดใหม่!</b> วัดหลังใหญ่ตั้งอยู่บนสนามหญ้าใต้บ่อน้ำในเมือง (ทางเดินหินจากถนนเส้นล่าง) เดินเข้าบันไดกลางเพื่อเข้าวัด',
    '🙏 วัดมีชีวิตขึ้น: ญาติโยมเดินไหว้พระ นกพิราบเดินจิกพื้นลาน (เดินเข้าใกล้แล้วบินหนี) ปลาคาร์ปว่ายในสระบัว ผีเสื้อบินรอบกระถางดอกไม้',
    '🎡 สวนสนุกคึกคัก: ครอบครัวเดินเที่ยว เด็กๆ ถือลูกโป่ง คนขายลูกโป่ง ธงราวประดับ (กลางคืนไฟกระพริบ) ฟองสบู่ข้างม้าหมุน ลานอาหารมีรถขายอาหาร ไอศกรีม และโต๊ะนั่งกิน',
    '🔪 <b>อาชีพเชฟปิดแล้ว</b> (ใครเป็นเชฟจะกลับมาว่างงาน เลือกอาชีพใหม่ได้) · ที่ครัวใหญ่มีเกมใหม่ <b>หั่นผักผลไม้</b> ใครก็เล่นได้ ปาดนิ้วฟันให้ขาด ฟันหลายลูกได้คอมโบ ระวังระเบิด 💣',
    '🎣 ตกปลา: กรอสายเข้ามาจนสุดแล้วปลาขึ้นฝั่งเลย ไม่ต้องกดยกอีกรอบ',
    '🪪 สอบใบขับขี่/ต่ออายุ ย้ายไปที่ <b>โชว์รูมรถ</b> แล้ว',
    '👗 ร้านแฟชั่นขายเฉพาะชุดพิเศษ (เลิกขายเสื้อกับกางเกงแยกชิ้น)',
    '🔋 มือถือร้อน/แบตหมดไว: เพิ่ม <b>โหมดประหยัดแบต</b> (เปิดเองบนมือถือ ปิดได้ที่ ⚙️ ตั้งค่า) · แก้อาการเกมค้างตอนเน็ตสะดุด: ต่อใหม่ให้เองภายในไม่กี่วินาที · เอาแอปเพลงออกจากมือถือในเกม',
  ] },
  { v: '2026-11-19b', d: '19 พ.ย. (รอบ 39)', items: [
    '🛕 วัดโฉมใหม่! ทางเข้าวัดย้ายมาอยู่ริมทะเลสาบ ใต้ถนนฝั่งซ้ายของเมือง เป็นซุ้มวัดหลังใหญ่สีทองอร่าม เดินเข้าประตูกลางได้เลย',
    '🏯 ในวัดวาดใหม่ทั้งหมด: พระอุโบสถ เจดีย์ทอง ศาลาไม้ หอระฆัง ร้านค้าวัด · มีสระบัว ต้นโพธิ์ใบไม้ร่วง กระถางธูปควันลอย และโคมไฟส่องทางตอนกลางคืน',
    '🙏 มีพระกับสามเณรเดินอยู่ในวัด · ระฆังดังเองตอน 6 โมงเช้ากับ 6 โมงเย็น · นั่งชมสระบัวได้ที่มุมสระทั้ง 4 มุม',
    '🧡 ผู้เล่นที่เป็นพระได้ชุดจีวรตัวใหม่ เดินได้ทุกทิศ · หลวงพ่อเย็นมีรูปของท่านแล้ว',
    '🧧 ของใหม่ที่ร้านค้าวัด: ผ้ายันต์นำโชค พกติดตัวไว้ ไหว้พระแล้วได้พรนานขึ้น 2 เท่า',
  ] },
  { v: '2026-11-19a', d: '19 พ.ย. (รอบ 38)', items: [
    '🛕 แผนที่ใหม่! <b>วัดเมืองชีวิต</b> ทางเข้าอยู่สุดขอบเมืองฝั่งซ้าย (ตรงกลาง) หรือนั่งแท็กซี่ไปก็ได้',
    '🏯 ในวัดมีโบสถ์ เจดีย์ทององค์ใหญ่ ศาลาโล่งให้นั่งเล่น ลานดินทราย และร้านค้าวัด (ชุดธูปเทียน พวงมาลัย ข้าวต้มมัด ขนมไทย น้ำลำไย)',
    '🙏 ไหว้พระในโบสถ์ ได้รับพร 20 นาที รายได้ทุกอย่าง +5% · เขย่าเซียมซีหน้าโบสถ์ · ตีระฆังได้ทุกคน เสียงดังทั้งวัด 🔔',
    '🧡 อาชีพใหม่ <b>พระ</b> สมัครกับหลวงพ่อเย็นที่หน้าโบสถ์ · ตื่นเช้าออกบิณฑบาต 05:00–10:00 เดินรับบาตรตามจุดสีทองในเมืองแล้วกลับวัดรับปัจจัย',
    '🍚 พระฉันอาหารได้แค่ช่วงเช้าถึงเที่ยง (ดื่มน้ำได้) แต่หิวช้ากว่าคนทั่วไป · ผู้เล่นใส่บาตรพระได้ กดที่ตัวพระแล้วเลือกอาหาร ได้บุญ+ได้พร',
  ] },
  { v: '2026-11-18f', d: '18 พ.ย. (รอบ 37)', items: [
    '🏘️ ระบบบ้านใหม่! ทุกคนมีบ้านของตัวเองได้ ไม่จำกัด 12 หลังอีกต่อไป · ซื้อกับคุณจิ๋ม สำนักงานอสังหาฯ (ทางเข้าหมู่บ้าน)',
    '🏠 เลือกขนาดได้ 3 แบบ: บ้านเล็ก ฿20,000 · บ้านกลาง ฿65,000 (2 ชั้น) · บ้านใหญ่ ฿160,000 (3 ชั้น) และเลือกหน้าตาบ้านได้ 6 แบบ',
    '✨ หมู่บ้านคือบ้านของคนที่ออนไลน์อยู่! ตอนคุณเข้าเกม บ้านของคุณจะไปตั้งบนแปลงว่าง ออกเกมแล้วบ้านก็หลบไปก่อน (ของในบ้านอยู่ครบ)',
    '👥 ไปเยี่ยมบ้านเพื่อนได้ (เพื่อนต้องบันทึกเบอร์คุณไว้) · ระบบเช่าบ้านปิดแล้ว คืนค่าเช่าที่เหลือให้อัตโนมัติ · เจ้าของบ้านเดิมได้บ้านแบบใหม่พร้อมของครบ',
  ] },
  { v: '2026-11-18e', d: '18 พ.ย. (รอบ 36)', items: [
    '👮 ตำรวจ: เคสใหม่ 🚨 ตามจับโจร! รับแจ้งเหตุที่สถานี แล้วขับรถสายตรวจไปตามจุดแดงบนแผนที่ โจรชื่อสีแดง ถึงตัวก็จับได้ (จับไวได้โบนัส)',
    '🔍 ตำรวจ: เกมจับผิดภาพหาโจรปลอมตัว 5 ภาพ · 🎯 เกมซ้อมยิงเป้า (ห้ามยิงป้ายพลเมือง) ได้ค่าแรงตามคะแนน',
    '🧾 อาชีพใหม่: พนักงานซูเปอร์มาร์เก็ต! สมัครกับพี่แนนที่ร้านสะดวกซื้อสาขาถนนเหนือ ไม่ต้องมีวุฒิ · ยืนแคชเชียร์ คิดเงินแล้วเลือกเงินทอนให้ถูก',
    '🥬 เชฟ: เปลี่ยนจากเกมแข่งทำอาหาร เป็นเกมวิ่งเก็บผัก กระโดดข้ามน้องหมาน้องแมว เก็บผักได้มากได้เงินมาก (นับเป็นเควสปรุงอาหาร)',
    '🔑 ผูกบัญชี Google ได้ที่ ตั้งค่า แล้วเข้าเกมด้วยปุ่ม Google ไม่ต้องจำ ID/PIN',
    '🐞 แก้หน้าสถานีตำรวจเปิดไม่ขึ้นสำหรับตำรวจ',
  ] },
  { v: '2026-11-18d', d: '18 พ.ย. (รอบ 35)', items: [
    '🛵 ซ้อนท้ายเพื่อนได้แล้ว! แตะที่เพื่อนที่ขี่มอไซค์/ขับรถ แล้วกด "ขอซ้อนท้าย" หรือ "ขอขึ้นรถ" (มอไซค์ซ้อนได้ 1 คน · รถยนต์ 3 คน · รถตู้ 5 คน) กดปุ่มใหญ่ "ลงรถ" เพื่อลง',
    '🔥 ขี่มอไซค์แล้วกดปุ่มใหญ่ = สับโดด! ยกล้อหน้าโชว์เท่ๆ',
    '💁 พี่ฟ้า จุดแนะนำเมือง ยืนข้างน้ำพุกลางเมือง ถามได้ทุกเรื่อง หาเงิน อาชีพ พลังงาน ที่เที่ยว และให้พี่ฟ้าชี้ทางไปที่ต่างๆ ได้',
    '⚡ รับออเดอร์ไรเดอร์ และแข่งกับไรเดอร์ส้ม ใช้พลังงานแล้ว (ทุกงานและเควสใช้พลังงาน)',
  ] },
  { v: '2026-11-18c', d: '18 พ.ย. (รอบ 34)', items: [
    '🎡 สวนสนุกโฉมใหม่! ม้าหมุน ชิงช้าสวรรค์ รถไฟเหาะ รถบั๊ม บูธยิงเป้า และสระว่ายน้ำ เปลี่ยนเป็นภาพวาดใหม่ทั้งหมด พร้อมซุ้มประตูทางเข้าสวนสนุก',
    '🛵 ไรเดอร์ที่รับออเดอร์ไว้ เข้าไปรับอาหารได้แม้ร้านอาหารปิดแล้ว · ไรเดอร์ส้มมาแย่งลูกค้าถี่ขึ้น',
    '🚓 ตำรวจได้รถสายตรวจขับฟรี 1 คัน (ถูกยึดคืนเมื่อเปลี่ยนอาชีพ)',
    '😀 พิมพ์อีโมจิในแชท จะลอยขึ้นเหนือหัวตัวละคร',
    '💬 เพิ่มแชท "รวม" (แชทโลก + คนใกล้ๆ ไม่มีข้อความระบบ) ไว้ช่องแรก',
    '🚕 เปิดบริการแท็กซี่! โทร 888-888 หรือกดแอพแท็กซี่ในมือถือ เลือกปลายทาง รถมารับถึงที่แล้วพาไปส่งหน้าประตู (ค่าโดยสารตามระยะทาง)',
    '🎡 ย้ายทางเข้าสวนสนุกไปไว้สุดถนนเส้นหลักด้านใต้ของเมือง',
    '🎣 เพิ่มเสียงตกปลา: เหวี่ยงเบ็ด ทุ่นตกน้ำ ปลาวิ่ง สายขาด และตอนได้ปลา',
  ] },
  { v: '2026-11-18b', d: '18 พ.ย. (รอบ 33)', items: [
    '🎡 <b>เปิดแมพใหม่ สวนสนุก!</b> เดินไปที่ป้าย 🎡 สุดถนนเส้นกลางทางใต้ของเมือง แล้วกดเข้า',
    '🎠 ม้าหมุน · 🎡 ชิงช้าสวรรค์ · 🎢 รถไฟเหาะ · 🏊 สระว่ายน้ำ · 🚗 รถบั๊มพ์ · 🎯 เกมยิงเป้า เล่นได้จริง ซื้อตั๋วแล้วขึ้นเล่น ได้ <b>⚡ พลังงาน ❤️ เลือด 😊 ความสุข ทุกวินาที</b> แต่ละเครื่องให้ไม่เท่ากัน เดินออกเมื่อไหร่ก็ลง',
    '🚗 <b>รถบั๊มพ์ขับเองได้จริง</b> ขับไปชนคนอื่นแล้วเด้งกระเด็น (กดปุ่มใหญ่เพื่อลงจากรถ) · 🏊 กระโดดลงสระน้ำกระจาย ว่ายแล้วมีระลอกน้ำ · 🎠🎡 เห็นคนนั่งหมุนไปกับม้าหมุนและชิงช้าสวรรค์ มีชาวเมืองมานั่งเล่นด้วย',
    '⚡ ทำงานและทำเควสต์ใช้พลังงานมากขึ้น 30% ไปเติมพลังที่สวนสนุกกันนะ'] },
  { v: '2026-11-18a', d: '18 พ.ย. (รอบ 32)', items: [
    '⚖️ <b>ปรับสมดุล</b>: วิ่งช้าลง (รถทุกคันเร็วกว่าวิ่งแล้ว) · อาชีพหมอได้เงินน้อยลง (เงินเวร ค่าช่วยชีวิต และเคส ICU ลดลง เคสถัดไปรอนานขึ้น) · 🎣 ตกปลาง่ายขึ้น (ปลากินเบ็ดไวขึ้น จังหวะตวัดกว้างขึ้น สายขาดยากขึ้น ยกปลาขึ้นง่ายขึ้น) · 🥬 หิวจนหมดแรง ฟื้นใน 6 วินาที',
    '🛵 สมัครเป็น<b>ไรเดอร์ได้มอไซค์ส่งอาหารฟรี 1 คัน</b> (ยืมใช้ ถ้าเปลี่ยนอาชีพบริษัทจะยึดคืน) · ไรเดอร์ตอนนี้ได้รถด้วย',
    '🧑‍💼 มีพนักงานยืนหลังเคาน์เตอร์ที่ บริษัทไทยเทค · ร้านอาหาร · ร้านแฟชั่น · ศูนย์ไรเดอร์ · โชว์รูมรถ · 🏥 เดินทะลุเปลเข็นในโรงพยาบาลได้',
    '📱 มือถือ: <b>กู้เงิน/ฝาก/ถอน และซื้อหุ้นในมือถือได้แล้ว</b> (ปุ่มกู้ใหญ่ขึ้น) · รายชื่อในโทรศัพท์เลื่อนได้ไม่เด้งกลับ · เปิดหน้าต่างแล้วไม่เด้งคีย์บอร์ดดันจอขึ้น · มีแอป 👥 กลุ่มเฟสบุ๊ค · แตะรูปในข้อมูลผู้เล่นเพื่อดูรูปใหญ่',
    '💬 เอาแชทรวมออก <b>แชทโลกอยู่ช่องแรก</b> ใกล้ๆ อยู่ช่องถัดไป · ลิงก์แชร์เกมใหม่ is.gd/newlifetown',
    '🐟 ร้านขายปลาเปิด 24 ชม. · สมุดภาพปลาย้ายไปอยู่ในมือถืออย่างเดียว · 🚗 รูปรถในโชว์รูมและสัตว์ในร้านสัตว์เลี้ยงเล็กลงและขนาดเท่ากันหมด · ร้านสัตว์เลี้ยงสาขา 2 แต่งร้านใหม่ไม่ซ้ำสาขาแรก',
    '🐾 สัตว์เลี้ยงไม่กระโดดถี่ๆ ตอนวิ่งเร็ว และซ่อนตัวเมื่อเข้าอาคาร · แก้รถ/สัตว์เลี้ยงบางตัวเดินถอยหลัง · 🚪 ทางไปไร่และหมู่บ้านต้องกดเพื่อเข้า (ไม่วาร์ปเองตอนเดินผ่าน)',
    '💻 คอม: WASD / E / Spacebar ใช้ได้แม้เปิดแป้นภาษาไทย ตกปลาบนคอมได้แล้ว · 📲 สลับแอปแล้วกลับมา ไม่จอดำแล้ว',
    '🐞 ทีมงานตอบกลับรายงานบัคถึงกล่องจดหมายของผู้แจ้งได้แล้ว'] },
  { v: '2026-11-16z6', d: '16 พ.ย. (รอบ 31)', items: ['📱 จัดแอปในมือถือใหม่ เอาโปรไฟล์ แผนที่ อากาศ ออก (โปรไฟล์ดูได้จากการแตะรูปตัวเอง แผนที่แตะมินิแมพ) · 💼 หน้างานของฉันไม่แสดงภารกิจอาชีพแล้ว รับภารกิจได้ที่ NPC ของแต่ละอาชีพเหมือนเดิม'] },
  { v: '2026-11-16z5', d: '16 พ.ย. (รอบ 30)', items: ['📲 หน้าล็อกอินมีปุ่ม <b>ติดตั้งบนมือถือ</b> · <b>แชร์ลิงก์</b> (is.gd/lifetown) · <b>ติดตั้งในคอม</b> ติดตั้งแล้วมีไอคอนเกม เปิดเต็มจอเหมือนแอป', '💖 มือถือมีแอป <b>สนับสนุน</b> · ผู้จัดทำ นาย วราวุฒิ สีเสือ'] },
  { v: '2026-11-16z4', d: '16 พ.ย. (รอบ 29)', items: [
    '📱 <b>เอาแถบเมนูออก</b> ทุกอย่างย้ายเข้าไปอยู่ในมือถือแล้ว (เพิ่มแอป งาน · อันดับ · วิธีเล่น · แจ้งบัค) · ปุ่มมือถือใหญ่ขึ้น แนวตั้งอยู่ใต้นาฬิกา แนวนอนอยู่ข้างมินิแมพ · มีจุดแดงเตือนเมื่อมีจดหมาย บิล หรือรางวัล',
    '💬 แนวนอน กล่องแชทกว้างเท่ากระดานเควสต์กับการ์ดสถานะ',
    '🛵 แก้บั๊ก<b>ให้ทิปไรเดอร์ไม่ได้</b> (ช่องทิปเด้งกลับเป็น 0) · 📈 <b>ซื้อขายหุ้นผ่านมือถือได้แล้ว</b> ไม่ต้องไปธนาคาร',
    '👥 เดินใกล้เพื่อนที่เพิ่มกันแล้ว ขึ้นแค่ปุ่ม <b>ข้อมูล</b> · รายชื่อในมือถือ <b>ปักดาว ⭐ รายการโปรด</b> (ขึ้นบนสุด) และลบได้ (มีถามยืนยัน)'] },
  { v: '2026-11-16z3', d: '16 พ.ย. (รอบ 28)', items: ['🎵 เพลงในเกมไม่ขึ้นเป็นเครื่องเล่นเพลงบนแถบแจ้งเตือนมือถือแล้ว · เปิด YouTube/Spotify ฟังไปด้วยได้ เพลงไม่ตัดกัน (อยากฟังเพลงตัวเองอย่างเดียว ปิดเพลงในเกมที่ ⚙️ หรือแอปเพลงในมือถือ) · ออกจากเกมแล้วเสียงเกมหยุดเอง'] },
  { v: '2026-11-16z2', d: '16 พ.ย. (รอบ 27)', items: ['🐟 การ์ดโชว์ปลาที่ตกได้เล็กลง (เล็กสุดบนมือถือ) ไม่บังน้ำกับคนอื่นแล้ว'] },
  { v: '2026-11-16z', d: '16 พ.ย. (รอบ 26)', items: ['📱 <b>มือถือโฉมใหม่</b> เปิดมาเป็นหน้าจอโทรศัพท์จริงๆ มีวอลเปเปอร์เมือง นาฬิกา และแอป 16 อัน (โทร แชท จดหมาย เดลิเวอรี หุ้น บิล แผนที่ เพื่อน โปรไฟล์ ตั้งค่า เควสต์ รางวัล สัตว์เลี้ยง สมุดปลา อากาศ เพลง) · แตะแถบล่างหรือปุ่ม ‹ เพื่อกลับหน้าหลัก'] },
  { v: '2026-11-16y', d: '16 พ.ย. (รอบ 25)', items: ['🥚 เพิ่มอีสเตอร์เอ้กแล้ว', '🎣 เห็นคนอื่นตกปลาแล้ว (คันเบ็ด สายเบ็ด ทุ่นลอย ทุ่นจมตอนปลากิน สายตึงตอนเย่อปลา) ไม่ใช่ยืนเฉยๆ'] },
  { v: '2026-11-16x', d: '16 พ.ย. (รอบ 24)', items: [
    '🚶 <b>เดินลื่นขึ้น</b> เดินเฉียดต้นไม้ เสาไฟ กระถางดอกไม้ หรือมุมตึก ตัวละครจะไถลอ้อมไปเอง ไม่ติดค้าง · นิ้วที่สองแตะจอไม่ทำให้จอยหลุดแล้ว',
    '💬 ปุ่ม <b>คุย</b> คุยกับคนที่ยืนใกล้ที่สุด (ผู้เล่นหรือชาวเมือง) ไม่เด้งไปหาผู้กองเอกหรือพนักงานเคาน์เตอร์ทุกครั้งแล้ว',
    '🗑️ <b>วิ่งเก็บขยะไม่แลค</b> ไม่วาดเมืองซ้อนข้างหลังตอนวิ่ง · ปัดเปลี่ยนเลน/กระโดดติดทันทีไม่ต้องรอยกนิ้ว'] },
  { v: '2026-11-16w', d: '16 พ.ย. (รอบ 23)', items: ['💬 ตัวเลขผู้เล่นที่ออนไลน์ย้ายจากการ์ดสถานะไปอยู่ท้ายแถบแท็บในกล่องแชท แตะเพื่อดูรายชื่อคนที่ออนไลน์'] },
  { v: '2026-11-16v', d: '16 พ.ย. (รอบ 22)', items: [
    '👥 เดินเข้าใกล้ผู้เล่นคนอื่น จะมีปุ่ม <b>ข้อมูล</b> และ <b>เพิ่มเพื่อน</b> ขึ้นเหนือชื่อเขา',
    '🚁 แก้บั๊ก<b>เฮลิคอปเตอร์โดนดึงกลับ</b>ตอนบินข้ามตึก',
    '💻 <b>เล่นบนคอมง่ายขึ้น</b> คลิกพื้นเพื่อเดิน · กดเมาส์ค้างเดินตามเมาส์ · ล้อเมาส์ซูม · M แผนที่ · Q เควสต์ · กด H ดูปุ่มลัดทั้งหมด',
    '👆 แก้บั๊กแตะตัวผู้เล่นคนอื่นแล้วโปรไฟล์ไม่เปิด',
    '📢 แอดมินเปลี่ยนข้อความประกาศแถบแดงด้านบนได้'] },
  { v: '2026-11-16u', d: '16 พ.ย. (รอบ 21)', items: ['🎣 ป้ายบอกจังหวะตกปลา (รอปลากินเบ็ด / ตวัด! / กรอสาย) ย้ายขึ้นไปอยู่เหนือตัวละครและเล็กลง ไม่บังผิวน้ำ'] },
  { v: '2026-11-16t', d: '16 พ.ย. (รอบ 20)', items: [
    '🎣 <b>ตกปลาง่ายขึ้นมาก</b> ตวัดได้นานขึ้นเกือบเท่าตัวหลังทุ่นจม · ตวัดเร็วไปไม่เสียปลาแล้ว แค่รอทุ่นจมใหม่ · เย่อสบายขึ้น (สายขาดยากขึ้น ปลาหนียากขึ้น กรอสายเร็วขึ้น สู้สั้นลง) · ยกปลาได้ช่วงกว้างขึ้นและพลาดได้ 5 ครั้ง',
    '🚫 เอาข้อความและปุ่มเรื่อง<b>ล้วงกระเป๋า</b>ที่หลงเหลือออกหมดแล้ว'] },
  { v: '2026-11-16s', d: '16 พ.ย. (รอบ 19)', items: [
    '📢 ประกาศภัยแล้งขยับขึ้นไปอยู่สูงขึ้นในจอแนวตั้ง',
    '🚫 เอา<b>อาชีพโจร</b> (ล้วงกระเป๋า ชุดโจร สายตรวจจับโจร 191 ค่าหัว) และ<b>จุดฝูงชน</b>ออกจากเมืองทั้งหมดแล้ว · ตำรวจรับเคสตามหาหมาที่หายไปเหมือนเดิม'] },
  { v: '2026-11-16r', d: '16 พ.ย. (รอบ 18)', items: [
    '🎣 ปุ่มเบ็ดตกปลาวาดคันเบ็ดใหม่ให้ชัดขึ้น (ด้ามจับ รอก และสายเบ็ดอยู่ในกรอบปุ่ม)',
    '💬 แชทโลก: ถ้าพิมพ์ถี่เกินไป (ส่งได้ทุก 3 วินาที) จะบอกเวลาที่ต้องรอ และข้อความยังค้างในช่องพิมพ์ให้ส่งใหม่ได้'] },
  { v: '2026-11-16q', d: '16 พ.ย. (รอบ 17)', items: ['📜 แนวตั้ง: ป้ายเหตุการณ์ขยับขึ้นมาเหนือตัวละคร'] },
  { v: '2026-11-16p', d: '16 พ.ย. (รอบ 16)', items: ['📜 แนวตั้ง: ป้ายเหตุการณ์ย้ายมาอยู่กลางจอ ยาวเต็มความกว้าง และตัวหนังสือจัดกึ่งกลาง (ถ้าข้อความยาวจะยังวิ่งวนอยู่)'] },
  { v: '2026-11-16o', d: '16 พ.ย. (รอบ 15)', items: ['📱 แนวนอน: ปุ่มกระเป๋า พัก วิ่ง ขอทาน และปุ่มใช้งาน เลื่อนไปชิดขวาจอแล้ว (เมนูย้ายขึ้นไปด้านบนแล้ว จึงมีที่ว่างพอ)'] },
  { v: '2026-11-16n', d: '16 พ.ย. (รอบ 14)', items: [
    '📜 <b>ป้ายเหตุการณ์ (ฝนตกชุก ฯลฯ) เป็นแถบโปร่งใสวิ่งเหมือนประกาศเซิร์ฟเวอร์</b> ไม่บังหน้าจอแล้ว',
    '📱 <b>แนวนอน:</b> เมนูกางออกเป็นแถวตามขอบบนจอ · <b>แนวตั้ง:</b> ป้ายเหตุการณ์ไปอยู่ชิดแถวเดียวกับเมนูด้านบน ไม่ทับมินิแมพ'] },
  { v: '2026-11-16m', d: '16 พ.ย. (รอบ 13)', items: ['🌤️ ย้ายป้ายสภาพอากาศและเวลากลับไปไว้ที่เดิม ใต้มินิแมพ'] },
  { v: '2026-11-16l', d: '16 พ.ย. (รอบ 12)', items: ['🛏️ ตอนหมดสติอยู่บนเตียงโรงพยาบาล ถ้ากดเดิน จะมีข้อความบอกว่าเดินไม่ได้และต้องรอเจ้าหน้าที่ (ไม่ใช่บัค)'] },
  { v: '2026-11-16k', d: '16 พ.ย. (รอบ 11)', items: ['🗺️ ย้ายป้ายวันเวลาและสภาพอากาศไปไว้มุมบนซ้ายของมินิแมพ ไม่ดันเมนูด้านขวาลงมาแล้ว'] },
  { v: '2026-11-16j', d: '16 พ.ย. (รอบ 10)', items: [
    '💚 <b>ผู้เล่นใหม่ไม่ป่วยแล้ว</b> 3 ชั่วโมงแรก (หรือจนกว่าจะหาเงินได้ ฿3,000) จะไม่ติดโรคใดๆ',
    '🏥 <b>หมดสติแล้วฟื้นเร็วขึ้น</b> รอแค่ 25 วินาที (1 นาทีถ้ามีหมอออนไลน์) ฟื้นมาเลือด 70 <b>โรคหายหมด</b> และกันป่วยซ้ำ 10 นาที · ค่ารักษาลดเหลือ 10% (สูงสุด ฿600) และ<b>ฟรี</b>สำหรับผู้เล่นใหม่หรือมีเงินไม่ถึง ฿500'] },
  { v: '2026-11-16i', d: '16 พ.ย. (รอบ 9)', items: ['🐞 แก้บัค: ตกปลาเสร็จแล้วบางครั้งเดินไม่ได้ · ถ้าตัวละครค้างเดินไม่ไป เกมจะปลดล็อกและซิงก์ตำแหน่งกับเซิร์ฟเวอร์ให้เองใน 1–2 วินาที · ขอบคุณที่แจ้งบัคค่ะ 🙏'] },
  { v: '2026-11-16h', d: '16 พ.ย. (รอบ 8)', items: [
    '🎬 <b>หน้าล็อกอินใหม่</b> วิดีโอโปรโมทตัวใหม่ (ฉากจริงในเกม) กรอบเรืองแสงสีรุ้งบนคอม ปุ่มเข้าเมืองมีแสงวิ่ง แตะ 🔊 เพื่อฟังเพลง',
    '🎵 <b>เพลงประกอบใหม่</b> กลางวันกับกลางคืนมีเพลงคนละเพลง เปลี่ยนนุ่มๆ ตามเวลาในเกม (ปิด/เปิดได้ที่ ⚙️ ตั้งค่า → เพลง)'] },
  { v: '2026-11-16g', d: '16 พ.ย. (รอบ 7)', items: ['🗺️ เอาหมุดสีม่วง (NPC อาชีพ) ออกจากแผนที่ใหญ่แล้ว แผนที่ดูโล่งขึ้น'] },
  { v: '2026-11-16f', d: '16 พ.ย. (รอบ 6)', items: [
    '📋 <b>ภารกิจอาชีพย้ายไปอยู่ที่ NPC ของแต่ละอาชีพ</b> เช่น ภารกิจตำรวจคุยกับจ่าที่สถานีตำรวจ ภารกิจหมอคุยกับหมอที่โรงพยาบาล ภารกิจไรเดอร์ที่ศูนย์ไรเดอร์ ฯลฯ แล้วเลือก "📋 รับภารกิจ" · เกษตรกรรับที่ประตูไร่ (ไร่ยังปิดปรับปรุง)'] },
  { v: '2026-11-16e', d: '16 พ.ย. (รอบ 5)', items: [
    '🎣 <b>ตกปลา: บอกจังหวะกลางจอแล้ว</b> รอปลา · ตวัด! · กดค้างกรอสาย · ปล่อยสาย! (สายจะขาด) · ยกตอนปลาโผล่ พร้อมคำแนะนำสั้นๆ และสีกระพริบตามสถานการณ์',
    '🎣 ปุ่มใหญ่ตอนอยู่ริมน้ำเปลี่ยนเป็น<b>รูปคันเบ็ดใหม่</b> สีตามเบ็ดที่ถือ (ไม้ไผ่ ไฟเบอร์ คาร์บอน โปร ทอง มังกร) คันโค้งตามแรงปลา สายเปลี่ยนสีตามความตึง และเห็นทุ่น/ปลาที่ปลายสาย'] },
  { v: '2026-11-16d', d: '16 พ.ย. (รอบ 4)', items: [
    '🐞 <b>แก้บัค: วิ่งเก็บขยะขึ้น "ผลการวิ่งผิดปกติ" ไม่ได้เงิน</b> ยิ่งวิ่งนานยิ่งเจอบ่อย (ระบบนับว่าเก็บของเร็วเกินไป ทั้งที่ยิ่งวิ่งเร็วของก็มาถี่ขึ้นจริง) · ตอนนี้ตรวจจากระยะทางแทน และถ้าผิดปกติจริงจะบอกเหตุผลชัดๆ · ได้สูงสุด ฿400 ต่อรอบ บอกไว้ในหน้าสรุปแล้ว ขอบคุณที่แจ้งบัคค่ะ 🙏'] },
  { v: '2026-11-16c', d: '16 พ.ย. (รอบ 3)', items: [
    '🪪 รูปในหน้า<b>ข้อมูลผู้เล่น</b>เป็นวงกลมแบบเดียวกับแถบสถานะ (ทั้งของเราและของคนอื่น)'] },
  { v: '2026-11-16b', d: '16 พ.ย. (รอบ 2)', items: [
    '🖼️ <b>กรอบรูปโปรไฟล์ 36 แบบ!</b> กดรูปโปรไฟล์ → 🖼️ กรอบรูป · กรอบโลหะและอัญมณี (ไม้ เงิน ทอง แพลทินัม แหวนเพชร ทับทิม มรกต ไพลิน …) และกรอบน่ารัก (ซากุระ ทานตะวัน แมว กระต่าย น้องหมา ลูกกวาด …) ซื้อแล้วใส่ได้เลย ทุกคนเห็นในโปรไฟล์',
    '✨ <b>กรอบพิเศษ 12 แบบ เรืองแสงเคลื่อนไหว</b> แต่ละแบบสีและจังหวะต่างกัน (มงกุฎราชา ปีกเทวดา ปีศาจ เปลวเพลิง น้ำแข็ง สายฟ้า กาแล็กซี สายรุ้ง นีออน ลายไทย ดอกบัว สายน้ำ) · ตอนนี้ล็อกไว้ก่อน เร็วๆ นี้!'] },
  { v: '2026-11-16a', d: '16 พ.ย.', items: [
    '🎨 <b>ไอคอนพิกเซลชุดใหม่ทั้งเกม!</b> ไอคอนในเมนู ปุ่ม แจ้งเตือน หน้าร้าน กระเป๋า เควสต์ อิโมจิ ฯลฯ เปลี่ยนเป็นภาพพิกเซลอาร์ตเข้ากับตัวเกม (185 ไอคอน)'] },
  { v: '2026-11-15za', d: '15 พ.ย. (รอบ 27)', items: [
    '🥣 <b>เปิดสมัครขอทานได้เหมือนเดิม</b> สมัครที่ศาลาประชาคม (เงินสด+เงินฝากไม่เกิน ฿2,000) · ไม่มีการกลายเป็นขอทานอัตโนมัติแล้ว · มีเงินเกิน ฿2,000 ยังพ้นจากขอทานเหมือนเดิม'] },
  { v: '2026-11-15z', d: '15 พ.ย. (รอบ 26)', items: [
    '🏃 <b>ขอทาน: วิ่งเก็บขยะ!</b> (แบบ Pepsiman) ไปที่ถังขยะแล้วกดปุ่มใหญ่ วิ่งไปตามถนน 3 เลน เก็บแก้ว 🥤 กระป๋อง 🥫 ขวด 🍾 เหรียญ 🪙 · กระโดดข้ามกรวย กล่อง หมา รถเข็น · หลบรถกับถังขยะ · ยิ่งวิ่งยิ่งเร็ว จนกว่าจะชน แล้วเอาของไปขาย',
    '🚫 เอาการเดินคุ้ยขยะออกแล้ว · <b>สมัครเป็นขอทานไม่ได้แล้ว</b> คนที่เงินหมดตัวและไม่มีงาน (เงินสด+เงินฝากไม่ถึง ฿100) จะกลายเป็นขอทานเอง · <b>มีเงินเกิน ฿2,000 พ้นจากขอทานอัตโนมัติ</b>'] },
  { v: '2026-11-15y', d: '15 พ.ย. (รอบ 25)', items: [
    '🧡 <b>ไรเดอร์: แย่งลูกค้า!</b> ไรเดอร์ส้มคู่แข่ง (ชุดสีส้ม) จะโผล่มาในเมืองเป็นพักๆ เพื่อแย่งลูกค้าของคุณ ตามจุดสีส้มบนมินิแมพแล้ววิ่งไปขวาง หรือกด 🔎 ออกตามหาที่ศูนย์ไรเดอร์',
    '⚔️ <b>สู้แบบโปเกม่อน</b> ผลัดกันเลือกท่า: 🛵 บิดคันเร่ง 📍 มุดทางลัด 📣 บีบแตรข่ม 😊 ยิ้มหวานให้ลูกค้า 🧃 เครื่องดื่มชูกำลัง · แรงใจใครหมดก่อนแพ้ ชนะได้ค่าส่ง+ทิปตามเลเวล · ขี่รถอยู่ตอนเจอได้เปรียบ'] },
  { v: '2026-11-15x', d: '15 พ.ย. (รอบ 24)', items: [
    '🔨 <b>พ่อค้า: โรงประมูล!</b> คลังสินค้าราคาส่งกลายเป็นโรงประมูล ล็อตสินค้าขึ้นเวทีทีละล็อต (ลังสินค้า ของสด ปลา อาหาร กล่องปริศนา) มีสภาพสินค้าและช่วงราคาจากผู้ประเมิน',
    '✉️ <b>ยื่นซองเดาราคาแข่งกับคู่แข่ง 3 คน</b> (เสี่ยเฮงใจถึง เจ๊หมวยเขี้ยว คุณหญิงมาลีรวยแต่ไม่รู้ราคา ฯลฯ) ใครเสนอสูงสุดชนะ แล้วเปิดมูลค่าจริง: <b>ซื้อต่ำกว่าราคาจริง = กำไร สูงกว่า = ขาดทุน</b> · อัปเกรดรถเข็นสินค้าให้ผู้ประเมินแม่นขึ้น'] },
  { v: '2026-11-15w', d: '15 พ.ย. (รอบ 23)', items: [
    '🔥 <b>เชฟ: Cooking Battle!</b> รับออเดอร์ที่เคาน์เตอร์ครัวใหญ่ แล้ววิ่งทำจริงในครัว: 🧺 หยิบวัตถุดิบ → 🔪 <b>สับ</b>ที่เขียง / 🍳 <b>ผัด</b>ที่กระทะ (ยืนทำจนเสร็จ) → 🍲 <b>ต้ม</b> / 🔥 <b>ย่าง</b> (สุกเองแต่ต้องยกให้ทัน ไม่งั้นเละ/ไหม้) → 🍽️ <b>รวมจาน</b> → 🛎️ ยกไปเสิร์ฟให้ทันเวลา · เสิร์ฟเร็วได้ทิปและมีโอกาสได้เพิ่มอีกจาน',
    '🚑 <b>หมอ ICU ไม่ใช่มินิเกมแล้ว</b> เคสฉุกเฉิน 8 แบบ เดินไปหยิบเครื่องมือ/ยาในโรงพยาบาลจริง แล้วยืนรักษาคนไข้ที่เตียง ICU ให้ทันเวลา',
    '🧹 <b>เอามินิเกมออกทั้งหมด</b> (มินิเกมฆ่าเวลาในออฟฟิศ/ตอนนั่งเรียน, แถบจังหวะ ICU)'] },
  { v: '2026-11-15v', d: '15 พ.ย. (รอบ 22)', items: [
    '📋 <b>ภารกิจอาชีพ! ทุกอาชีพมีงาน 20 แบบ สุ่มมาให้ทำ</b> เล่นกันจริงๆ ในเมือง ไม่ใช่มินิเกม: เดินไปส่งเอกสาร ตามหาของหาย เก็บของที่กระจาย ส่งของถึงมือคน ยืนทำงานจนเสร็จ ไล่จับสัตว์ที่หนี พาคนแก่/คนเจ็บเดินไปส่ง และคุยตอบคำถามให้ถูก',
    '🧭 รับภารกิจที่เมนู 💼 งาน (⚡5) มีลูกศรชี้ทางพร้อมระยะ จุดบนมินิแมพ ป้ายบอกขั้นตอนและเวลาที่เหลือ · ค่าตอบแทนตามเวลาที่ใช้ ทำเสร็จก่อนครึ่งเวลาโบนัส +25% · หมดเวลา = ล้มเหลว · ตอบคำถามผิดเสียเวลา 20 วิ'] },
  { v: '2026-11-15u', d: '15 พ.ย. (รอบ 21)', items: [
    '🎣 <b>ตกปลาแบบใหม่ สมจริง ไม่มีแถบมินิเกมแล้ว</b> ยืนริมน้ำแล้วกด<b>ปุ่มใหญ่</b>เหวี่ยงเบ็ดได้เลย ทุ่นลอยอยู่ในน้ำจริง',
    '🫧 ทุ่นไหวเบาๆ = ปลาแค่แตะเหยื่อ (ตวัดตอนนี้ปลาตกใจหนี) · <b>ทุ่นจมเมื่อไหร่ กดตวัดทันที</b>',
    '💪 <b>เย่อเบ็ด</b>: กดค้าง = กรอสาย ปล่อย = ผ่อนสาย ปลาจะวิ่งสู้เป็นช่วงๆ คันเบ็ดโค้ง สายเปลี่ยนเป็นเหลือง/แดงเมื่อตึง ถ้าฝืนกรอตอนสายแดง <b>สายขาด</b> ปล่อยนานไปปลา<b>ลากสายหนี</b> สายหย่อนนานไป<b>เบ็ดหลุด</b> · ปลายิ่งหายากยิ่งสู้นาน',
    '🐟 ปลาหมดแรงเข้าฝั่งแล้วจะดิ้นกระโดดโผล่ <b>กดยกให้ตรงตอนมันโผล่</b> พลาด 3 ครั้งหลุด · เบ็ดดีตวัดง่ายขึ้น สายเหนียวขึ้น จังหวะยกกว้างขึ้น'] },
  { v: '2026-11-15t', d: '15 พ.ย. (รอบ 20)', items: [
    '📱 <b>ลดขนาดหน้าต่างด้านล่าง (Bottom Sheet) ทุกอัน</b> เตี้ยลงและแคบลง เห็นฉากเกมด้านบนมากขึ้น พร้อมลดขนาดตัวอักษร ปุ่ม แถวรายการ การ์ด และแท็บด้านในทุกหน้า (กระเป๋า ร้านค้า สัตว์เลี้ยง เควสต์ ฯลฯ) · เลื่อนดูเนื้อหาที่เหลือได้เหมือนเดิม'] },
  { v: '2026-11-15s', d: '15 พ.ย. (รอบ 19)', items: [
    '🐾 <b>สัตว์เลี้ยงย้ายมาอยู่ในเมนู</b> (แถบเมนูด้านบน ปุ่ม 🐾) ไม่ต้องเปิดกระเป๋าแล้ว · สัตว์เลี้ยง<b>ระดับตำนาน</b> (🐼 แพนด้า 🐲 มังกรน้อย 🦄 ยูนิคอร์น) มี <b>ประกายระยิบระยับ</b>ตอนเดินอยู่ข้างคุณ',
    '👮 <b>ตำรวจเปลี่ยนจากลาดตระเวน เป็นเควส "ตามหาหมาที่หายไป"</b> รับเคสที่สถานีตำรวจ หมาจะหลบอยู่ที่ไหนสักแห่งในเมือง ฟังเสียงเห่าและดูวงสีเหลืองบนมินิแมพ ค่าตอบแทน = ฐาน + ตามเวลาที่ใช้ตามหา (เจอเร็วกว่าครึ่งเวลาโบนัส +25%) · มีเวลาจำกัด 2.5–7 นาทีตามระยะทาง ถ้าไม่เจอทันถือว่าล้มเหลว'] },
  { v: '2026-11-15r', d: '15 พ.ย. (รอบ 18)', items: [
    '🔊 <b>เสียงสัตว์เลี้ยง!</b> หมาเห่า แมวร้องเมี้ยว ลูกเจี๊ยบเจี๊ยบ เป็ดก๊าบ กระต่ายร้องแหลมๆ แพนด้าครางเบาๆ มังกรคำราม และยูนิคอร์นมีเสียงวิบวับ · ได้ยินตอนแตะที่ตัวมัน ตอนเรียกออกมา และตอนมันกระโดดเล่นเองบางครั้ง (ปิดได้ที่ ⚙️ เสียง)'] },
  { v: '2026-11-15q', d: '15 พ.ย. (รอบ 17)', items: [
    '🐾 <b>เดินเข้าร้านสัตว์เลี้ยงได้แล้ว!</b> ทั้ง 2 สาขามีห้องด้านใน ตู้ปลา และสัตว์ตัวเป็นๆ เดินเล่นกระโดดอยู่ในร้าน แตะที่ตัวมันได้ · มีพนักงานประจำร้าน น้องมะลิ (สาขา 1) และ พี่ภูผา (สาขา 2) คุยแล้วดูรายการสัตว์เลี้ยงได้เลย'] },
  { v: '2026-11-15p', d: '15 พ.ย. (รอบ 16)', items: [
    '🐶 <b>ร้านสัตว์เลี้ยง สาขา 2</b> ย้ายมาอยู่มุมตะวันตกเฉียงเหนือแทนบ้านสองหลังเดิม · ทั้งสองสาขาอยู่ใน 🗺️ รายการสถานที่ของแผนที่ กดเพื่อเดินไปหาได้เหมือนอาคารอื่น',
    '🤫 บอทผู้เล่นไม่พิมพ์ในแชทโลกอีกแล้ว'] },
  { v: '2026-11-15o', d: '15 พ.ย. (รอบ 15)', items: [
    '🐾 <b>ร้านสัตว์เลี้ยงเปิดให้บริการแล้ว!</b> ทั้ง 2 สาขา (ถนนเหนือ · ถนนเหนือฝั่งตะวันตก) เปิด 09:00–21:00 เดินไปที่เคาน์เตอร์หน้าร้านเพื่อเลือกรับเลี้ยงสัตว์ได้ทั้ง 32 ชนิด แล้วเรียกออกมาเดินตามที่เมนู 🐾 สัตว์เลี้ยง · 🏋️ ฟิตเนสและ 🥊 โรงยิมยังปิดปรับปรุง'] },
  { v: '2026-11-15n', d: '15 พ.ย. (รอบ 14)', items: [
    '🗺️ <b>มินิแมพ/แผนที่ใหญ่อัปเดต</b> อาคารที่ปิดปรับปรุง (ร้านสัตว์เลี้ยง ฟิตเนส โรงยิม ห้องสมุด ร้านดอกไม้ สถานีดับเพลิง) เป็นสี <b>เหลืองอำพัน</b> เห็นชัดว่าเข้าไม่ได้ และสัตว์เลี้ยงของคุณเป็น <b>จุดสีชมพู</b> บนมินิแมพ'] },
  { v: '2026-11-15m', d: '15 พ.ย. (รอบ 13)', items: [
    '🐾 <b>สัตว์เลี้ยง 32 ชนิด!</b> หมา แมว กระต่าย แฮมสเตอร์ เม่น กระรอก ลูกเป็ด จิ้งจอก แพนด้า เพนกวิน คาปิบาร่า ไปจนถึง 🐲 มังกรน้อย และ 🦄 ยูนิคอร์น แบ่งความหายากทั่วไป–มหากาพย์',
    '🎒 รับเลี้ยงได้ที่ <b>กระเป๋า → 🐾 เปิดสัตว์เลี้ยง</b> (ที่ร้านสัตว์เลี้ยง) เรียกออกมาเดินตามได้ทุกที่ เข้าตึก/วาร์ปก็ตามมา และผู้เล่นคนอื่นก็เห็นสัตว์ของคุณ',
    '🦘 <b>กระโดดน่ารัก</b> วิ่งตามแล้วเด้งดึ๋งๆ มีหายใจเบาๆ กระโดดเล่นเองเป็นพักๆ และ <b>แตะที่ตัวมัน</b>เพื่อให้กระโดดดีใจพร้อมหัวใจ ❤'] },
  { v: '2026-11-15l', d: '15 พ.ย. (รอบ 12)', items: [
    '🐾 <b>ร้านสัตว์เลี้ยง 2 สาขา</b> (ถนนเหนือ · ถนนเหนือฝั่งตะวันตก) และ 🏋️ <b>ฟิตเนส</b> กับ 🥊 <b>โรงยิมมวย</b> เปิดตัวบนแผนที่แล้ว · ตอนนี้ปิดปรับปรุง รอเปิดเร็วๆ นี้' ] },
  { v: '2026-11-15k', d: '15 พ.ย. (รอบ 11)', items: [
    '🎬 <b>หน้าล็อกอินเป็นวิดีโอโปรโมท</b> เปิดเกมมาเจอวิดีโอเมืองขยับได้ทันที (กดปุ่ม 🔊 เพื่อเปิดเสียง) · บนมือถือเต็มจอ กด "เข้าเมืองเลย!" · ถ้าเคยเล่นแล้วกด "เล่นต่อ" ได้ทันที',
    '📦 กล่องล็อกอินเล็กลง ตัดข้อความที่ไม่จำเป็นออก เหลือแค่ช่อง ID/PIN กับปุ่มเข้าเมือง',
    '🎞️ วิดีโอใหม่ (ไม่มีตัวหนังสือในคลิป) ขึ้นคำบรรยายตามฉาก: เลือกอาชีพ เมืองจริงผู้เล่นจริง ตกปลา ทำสวน สร้างตัวละคร ซื้อบ้าน' ] },
  { v: '2026-11-15j', d: '15 พ.ย. (รอบ 10)', items: [
    '🔑 <b>ฟอร์มล็อกอินใหม่</b> ช่องกรอกมีไอคอน กดดู/ซ่อน PIN ได้ ปุ่มเข้าเมืองขึ้นสถานะกำลังเข้า ใส่ผิดการ์ดสั่นเตือน มีขั้นตอน 1-2-3 และเคล็ดลับหมุนเวียน',
    '🧍 <b>หน้าสร้างตัวละครใหม่</b> ตัวละครตัวใหญ่เดินอยู่บนแท่น กดลูกศรหมุนดูได้รอบตัว เลือกเพศและสีเสื้อแล้วเห็นผลทันที' ] },
  { v: '2026-11-15i', d: '15 พ.ย. (รอบ 9)', items: [
    '🌸 <b>หน้าล็อกอินใหม่</b> ชื่อเกมตัวใหญ่ ฉากเมืองขยับช้าๆ กลีบซากุระปลิวลง โชว์ชาวเมืองที่จะได้เจอ บอกว่าทำอะไรได้บ้าง และบอกจำนวนคนที่ออนไลน์ตอนนี้' ] },
  { v: '2026-11-15h', d: '15 พ.ย. (รอบ 8)', items: [
    '🩺 <b>หมอไม่ต้องเข้าเวรแล้ว</b> ได้เงินจาก<b>เคสฉุกเฉินที่ ICU</b> แทน (มุมขวาล่างของโรงพยาบาล)',
    '💓 เคสสุ่ม: <b>ปั๊มหัวใจ</b> กดตอนวงแหวนหดมาแตะหัวใจให้ตรงจังหวะ 20 ครั้ง · 🔪 <b>ผ่าตัด</b> หยุดมีดให้อยู่ในแถบเขียว 5 ขั้น เร็วขึ้นเรื่อยๆ',
    '💰 ยิ่งแม่นยิ่งได้มาก · ได้เกิน 95% ประกาศให้ทั้งเมืองรู้ · เคสใหม่เข้าทุก 30 วินาที' ] },
  { v: '2026-11-15g', d: '15 พ.ย. (รอบ 7)', items: [
    '👧 <b>น้องมะปราง</b> ออกมาเดินเล่นในเมืองแล้ว คุยด้วยแล้วจะเปลี่ยนสีหน้าไปตามเรื่อง (ยิ้ม เขิน ตกใจ โบกมือ)',
    '🖼️ ชาวเมืองที่เดินเล่นทุกคนมีชื่อ หน้าตา และรูปวาดของตัวเอง: พี่โจ้ คุณเมย์ ป้าสมใจ พี่ดำ ต้นกล้า · ในหมู่บ้าน: ป้านวล ตาเฉย น้องเจมส์ · แต่ละคนมีเรื่องคุยของตัวเอง' ] },
  { v: '2026-11-15f', d: '15 พ.ย. (รอบ 6)', items: [
    '🖼️ <b>NPC ทุกคนที่คุยได้มีรูปวาดแล้ว</b> และหน้าตาในเกมตรงกับรูป: หมอแพร (ผอ.โรงพยาบาล) · พี่ข้าวหอม (สหกรณ์) · ลุงจุก (ศาลาประชาคม) · ยายบุญ (ร้านสะดวกซื้อสาขาหมู่บ้าน) · น้องภูมิ · น้องเก่ง · คุณจิ๋ม ฯลฯ',
    '🤫 ผู้เล่นในเมืองเงียบลง ไม่พิมพ์แชทรบกวนแล้ว',
    '🚶 ชาวเมือง NPC ที่เดินเล่นน้อยลง เมืองโล่งขึ้น' ] },
  { v: '2026-11-15e', d: '15 พ.ย. (รอบ 5)', items: [
    '💬 <b>กล่องบทสนทนา</b> คุยกับเจ้าของร้าน เจ้าหน้าที่ และชาวเมืองแล้วจะขึ้นกล่องคุย มีรูปตัวละคร ข้อความค่อยๆ พิมพ์ขึ้น แตะเพื่ออ่านต่อ',
    '🗨️ ทุกคนมีเรื่องคุยของตัวเอง กด <b>คุยต่อ</b> ฟังเคล็ดลับและมุกของแต่ละคน · แตะรูปผู้ให้เควสต์เพื่อคุยได้ด้วย' ] },
  { v: '2026-11-15d', d: '15 พ.ย. (รอบ 4)', items: [
    '📜 <b>เควสต์มีผู้ให้เควสต์แล้ว</b> แต่ละเควสต์มาจากชาวเมืองที่มีรูปวาดของตัวเอง เช่น ยายศรีชวนกินข้าว น้าเล็กอยากได้ปลาสด เจ๊ศรีอยากได้ของมาขาย',
    '🎉 ทำเควสต์สำเร็จ ผู้ให้เควสต์จะเด้งขึ้นมาขอบคุณ' ] },
  { v: '2026-11-15c', d: '15 พ.ย. (รอบ 3)', items: [
    '🎣 <b>ตกปลาได้ทุกที่ที่มีน้ำ</b> ไม่มีจุดตกปลาตายตัวแล้ว ยืนริมทะเลสาบ บ่อน้ำ ชายหาด หรือสะพาน แล้วกดปุ่ม 🎣 ได้เลย',
    '🎋 <b>เบ็ดเป็นไอเท็ม</b> 6 แบบ ราคาต่างกัน: ไม้ไผ่ ฿150 · ไฟเบอร์กลาส ฿1,500 · คาร์บอน ฿6,000 · โปรตกทะเล ฿20,000 · ทองคำ ฿75,000 · มังกรทะเลลึก ฿250,000 (ซื้อกับน้าเล็ก เปลี่ยนเบ็ดได้ในกระเป๋า)',
    '🐟 ปลาใหม่อีก 47 ชนิด รวม 79 ชนิด: น้ำจืดกับทะเลมีปลาคนละแบบ มีปลามาร์ลิน ปลาตกเบ็ด เต่าทะเล และ<b>โลมา (ตำนาน)</b>',
    '🔄 ใครเคยอัปเกรดเบ็ดที่ร้านอุปกรณ์ ได้เบ็ดระดับที่เทียบเท่าไปแล้วในกระเป๋า' ] },
  { v: '2026-11-15b', d: '15 พ.ย. (รอบ 2)', items: [
    '🐟 <b>ปลาใหม่ 25 ชนิด</b> รวมเป็น 32 ชนิด มีรูปปลาของตัวเอง: ปลาทู ปลาทอง กุ้ง ปู ปลาหมึกยักษ์ ม้าน้ำ ปลากระโทงดาบ ฉลามหัวค้อน ปลาคาร์ป ฯลฯ',
    '⭐ ปลามี<b>ความหายาก</b> 5 ระดับ: ทั่วไป · ไม่ธรรมดา · หายาก · มหากาพย์ · ตำนาน (ปลาทองคำ ✨ ฿5,000)',
    '📖 <b>สมุดภาพปลา</b> ที่สมาคมประมง ดูว่าตกชนิดไหนได้แล้ว · ตกได้แล้วมีป๊อปอัปโชว์ปลา',
    '🏅 ฉายาใหม่: นักสะสมปลา · ตำนานริมน้ำ · ผู้ครอบครองปลาทองคำ' ] },
  { v: '2026-11-15a', d: '15 พ.ย.', items: [
    '🚧 <b>ไร่ชานเมืองปิดปรับปรุงชั่วคราว</b> ประตูทางไปไร่ปิดอยู่ ใครที่อยู่ในไร่จะกลับมาที่ประตูเมืองตอนเข้าเกม' ] },
  { v: '2026-11-14d', d: '14 พ.ย. (รอบ 3)', items: [
    '🪑 จัตุรัส: ย้ายม้านั่งไปชิดแนวพุ่มไม้ทั้งสองฝั่ง (4 ตัว หันหาน้ำพุ ไม่ขวางทางเดิน) เอากระถางต้นไม้ข้างม้านั่งออก',
    '🌷 แต่งทั้งเมือง: หลังร้านค้าทุกร้านมีสวนหลังบ้านล้อมรั้วไม้ขาว แนวพุ่มไม้ แปลงดอกไม้ · สนามหญ้าโล่งๆ มีมุมสวน พุ่มไม้ ดอกไม้ ม้านั่ง' ] },
  { v: '2026-11-14c', d: '14 พ.ย. (รอบ 2)', items: [
    '🤵 ชุดใหม่ <b>ชุดทักซิโด้หูกระต่าย</b> ซื้อได้ที่ร้านแฟชั่น ฿180,000',
    '⛲ จัดจัตุรัสกลางเมืองใหม่: ทางเดินรูปกากบาทรอบน้ำพุ สนามหญ้า 4 มุมล้อมรั้วไม้ขาวและแนวพุ่มไม้ ต้นไม้ร่มรื่น แปลงดอกไม้ โคมไฟ 4 มุม ม้านั่งหันหาน้ำพุ',
    '🍦 เอารถไอติมออกจากจัตุรัส' ] },
  { v: '2026-11-14b', d: '14 พ.ย.', items: [
    '👮 โต๊ะสถานีตำรวจมี <b>ดาบสมชาย</b> นั่งเวรประจำโต๊ะ',
    '🎓 มหาวิทยาลัยมี <b>ผอ.ประเสริฐ</b> ผู้อำนวยการยืนที่โต๊ะ',
    '🏪 ร้านสะดวกซื้อทั้ง 4 สาขามีพนักงานประจำเคาน์เตอร์',
    '🛋️ ร้านเฟอร์นิเจอร์ และ 💈 ร้านทำผม <b>เดินเข้าไปในร้านได้แล้ว</b> จัดร้านใหม่ (โซฟา ชุดห้องนอน โต๊ะอาหาร / เก้าอี้ทำผม กระจก อ่างสระผม)',
    '🚗 โชว์รูมรถ และ 🛠️ ร้านอุปกรณ์ มีพนักงานยืนหลังเคาน์เตอร์',
    '🐟 เอาตู้ข้างร้านขายปลาออก ย้ายร้านขายปลาไปตั้งแทนที่',
    '🗺️ แผนที่: เอาวงกลมดำมีตัวเลขออก ใช้สัญลักษณ์ของแต่ละที่แทน · มินิแมพแสดงตัวอาคารชัดขึ้น',
    '🆕 มีหน้าสรุปอัปเดตแบบนี้ทุกครั้งที่อัปเดตเกม' ] },
];
// 📣 the latest updates as a plain-text Facebook post (Facebook no longer lets apps post to groups, so the admin pastes it)
const fbClean = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
function fbNewCount() { let v = ''; try { v = localStorage.getItem('lt_fbpost') || ''; } catch { } const i = NEWS.findIndex(n => n.v === v); return i < 0 ? 1 : Math.max(1, i); }
function fbText(n) {
  const L = NEWS.slice(0, n);
  return [`🆕 อัปเดตเกม Life Town เมืองชีวิตนี้เลือกได้! (${L[0].d.replace(/\s*\(.*\)/, '')})`, '',
    ...L.flatMap(x => x.items.map(t => '• ' + fbClean(t))), '', `🎮 เล่นฟรีบนมือถือ/คอม ไม่ต้องโหลด: ${location.origin}`, '#LifeTown #เกมมือถือ #เกมออนไลน์'].join('\n');
}
function newsHtml() {
  return `<h2>🆕 อัปเดตล่าสุด</h2>` + NEWS.slice(0, 5).map((n, i) => `<div class="sub" style="margin-top:${i ? 12 : 4}px"><b>${n.d}</b></div><ul style="margin:4px 0 0;padding-left:20px;line-height:1.7;font-size:14px">${n.items.map(t => `<li>${t}</li>`).join('')}</ul>`).join('');
}
function checkNews() {
  let seen = ''; try { seen = localStorage.getItem('lt_news') || ''; } catch { }
  if (seen === NEWS[0].v || !me) return;
  const dw = $('#dailyWrap'), busy = panel || $('#payBan') || (dw && dw.offsetParent) || $('#tut')?.offsetParent && !$('#tut').classList.contains('hidden') || !$('#mg')?.classList.contains('hidden');
  if (busy) return void setTimeout(checkNews, 2500);   // wait until nothing else is on screen (daily reward, top-up banner, a panel...)
  try { localStorage.setItem('lt_news', NEWS[0].v); } catch { }
  openPanel({ kind: 'news' });
}

// ---- gang / club panel (phone app 🏴)
function invitePanel() {
  const R = window.__ref; if (!R) return '<h2>🎟️ ชวนเพื่อน</h2><div class="sub">กำลังโหลด…</div>';
  const link = location.origin + '/?ref=' + R.code;
  return `<h2>🎟️ ชวนเพื่อนมาเล่น</h2>
    <div class="jobbox">โค้ดของคุณ<div style="font:800 30px/1.3 monospace;letter-spacing:5px;color:var(--acc);margin:4px 0">${R.code}</div>
      <div class="grid2">${B('📤 แชร์ลิงก์', { fn: 'refShare' }, 'primary')}${B('📋 คัดลอกโค้ด', { fn: 'refCopy' })}</div></div>
    <div class="sub">เพื่อนที่เข้าเกมครั้งแรกผ่านลิงก์ หรือกรอกโค้ดนี้ภายใน 3 วันแรก<br>🥚 เพื่อนได้ <b>ไข่สัตว์เลี้ยงปริศนา 1 ใบ</b><br>🎁 เมื่อเพื่อนเล่นครบ <b>${R.need || 30} นาที</b> คุณได้ <b>ไข่สัตว์เลี้ยงสุ่ม 1 ใบ + 💎${R.gems}</b> (กดรับที่จดหมาย ✉️)<br>ชวนมาแล้ว <b>${R.n}</b> คน · ได้รางวัลแล้ว <b>${Math.min(R.paid || 0, R.max || 20)}/${R.max || 20}</b> คน</div>
    ${R.canUse ? `<div class="secT">มีโค้ดของเพื่อน?</div><div class="rowf"><input id="refIn" maxlength="8" placeholder="กรอกโค้ด 6 ตัว" style="text-transform:uppercase">${B('ใช้โค้ด', { fn: 'refUse' }, 'good')}</div>` : R.by ? '<div class="sub">✅ คุณใช้โค้ดเพื่อนไปแล้ว</div>' : ''}
    <small style="opacity:.7;word-break:break-all">${esc(link)}</small>`;
}
function lottoPanel() {
  const L = window.__lotto; if (!L) return '<h2>🎫 ลอตเตอรี่</h2><div class="sub">กำลังโหลด…</div>';
  const th = k => { const [y, m, d] = k.split('-').map(Number); return `${d} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${y + 543}`; };
  const left = Math.max(0, L.at - Date.now()), dd = Math.floor(left / 864e5), hh = Math.floor(left / 36e5) % 24, mm = Math.floor(left / 6e4) % 60;
  const tk = n => `<span style="display:inline-block;margin:2px;padding:3px 7px;border-radius:7px;background:#fff;border:2px solid #e0404a;font:800 14px monospace;letter-spacing:2px;color:#b0202a">${n}</span>`;
  const last = L.last ? `<div class="jobbox"><b>ผลงวด ${th(L.last.key)}</b><br>🥇 รางวัลที่ 1: <b style="font:800 20px monospace;letter-spacing:3px">${L.last.first}</b><br>3 ตัวท้าย: <b>${L.last.l3.join(' , ')}</b> · 2 ตัวท้าย: <b>${L.last.l2}</b>${L.myLast && L.myLast.key === L.last.key ? `<br>คุณซื้อ ${L.myLast.n} ใบ · ${L.myLast.won ? `🎉 ถูกรางวัล ${money(L.myLast.won)} (รับที่จดหมาย ✉️)` : 'ไม่ถูกรางวัล'}` : ''}</div>` : '';
  return `<h2>🎫 ลอตเตอรี่</h2>
    <div class="sub">ออกทุกวันที่ 1 และ 16 เวลา 16:00 น. (เวลาจริง) · ใบละ ${money(L.price)} · งวดละไม่เกิน ${L.max} ใบ<br>🥇 รางวัลที่ 1 (ตรง 6 หลัก) <b>${money(L.prize.first)}</b> · 3 ตัวท้าย (2 รางวัล) ${money(L.prize.l3)} · 2 ตัวท้าย ${money(L.prize.l2)}</div>
    <div class="jobbox">งวดถัดไป <b>${th(L.key)}</b> · อีก ${dd ? dd + ' วัน ' : ''}${hh} ชม. ${mm} นาที</div>
    <div class="grid2">${B('🎲 สุ่ม 1 ใบ', { fn: 'lotto', qty: 1 }, 'primary')}${B('🎲 สุ่ม 5 ใบ', { fn: 'lotto', qty: 5 })}${B('🎲 สุ่ม 10 ใบ', { fn: 'lotto', qty: 10 })}</div>
    <div class="rowf" style="margin-top:6px"><input id="lottoIn" inputmode="numeric" maxlength="6" placeholder="เลือกเลขเอง 6 หลัก">${B('ซื้อเลขนี้', { fn: 'lotto', pick: 1 }, 'good')}</div>
    <div class="secT">ลอตเตอรี่ของฉันงวดนี้ (${L.my.length} ใบ)</div><div>${L.my.map(tk).join('') || '<small>ยังไม่ได้ซื้อ</small>'}</div>
    ${last}<small style="opacity:.7">เล่นแต่พอดี เงินในเกมเท่านั้น</small>`;
}
function ideasPanel(p) {
  const I = window.__ideas, ago = t => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'เมื่อกี้' : m < 60 ? m + ' นาที' : m < 1440 ? Math.floor(m / 60) + ' ชม.' : Math.floor(m / 1440) + ' วัน'; };
  const posts = !I ? '<div class="sub">กำลังโหลด…</div>' : I.list.map(i => `<div class="item" style="display:block">
      <div style="display:flex;gap:8px;align-items:center"><b>💡 ${esc(i.n)}</b><small style="opacity:.7">${ago(i.t)}</small>${i.mine ? `<span style="margin-left:auto">${B('🗑️', { fn: 'idea', op: 'del', id: i.id })}</span>` : ''}</div>
      <p style="margin:6px 0;white-space:pre-wrap;word-break:break-word">${esc(i.text)}</p>
      <div class="grid2">${B(`${i.liked ? '👍 ถูกใจแล้ว' : '👍 ถูกใจ'} ${i.likes || ''}`, { fn: 'idea', op: 'like', id: i.id }, i.liked ? 'primary' : '')}${B(`💬 คอมเมนต์ ${i.cm.length || ''}`, { fn: 'idea', op: 'open', id: i.id })}</div>
      ${p.open === i.id ? `<div style="margin-top:6px">${i.cm.map(c => `<div style="padding:4px 8px;margin:3px 0;border-radius:10px;background:rgba(0,0,0,.12)"><b>${c.a ? '👑 ' : ''}${esc(c.n)}</b> <small style="opacity:.7">${ago(c.t)}</small><br>${esc(c.text)}</div>`).join('') || '<small>ยังไม่มีคอมเมนต์</small>'}
        <div class="rowf" style="margin-top:4px"><input id="ideaCm${i.id}" maxlength="150" placeholder="เขียนคอมเมนต์…">${B('ส่ง', { fn: 'idea', op: 'cm', id: i.id }, 'primary')}</div></div>` : ''}
    </div>`).join('') || '<div class="sub">ยังไม่มีไอเดีย มาเป็นคนแรกเลย!</div>';
  return `<h2>💡 ไอเดียทำเกม</h2><div class="sub">อยากให้เมืองมีอะไรเพิ่ม เสนอได้เลย ทีมงานอ่านทุกโพสต์ · กดถูกใจไอเดียที่ชอบ ไอเดียยอดนิยมมีโอกาสได้ทำจริง</div>
    <textarea id="ideaIn" maxlength="300" rows="3" style="width:100%;box-sizing:border-box;border-radius:10px;padding:8px;font:inherit" placeholder="เช่น อยากให้มีร้านกาแฟในสวนสนุก…"></textarea>
    ${B('📝 โพสต์ไอเดีย', { fn: 'idea', op: 'post' }, 'primary')}
    <div class="tabs" style="margin-top:8px">${B('🆕 ล่าสุด', { fn: 'idea', op: 'sort', sort: 'new' }, p.sort !== 'top' ? 'primary' : '')}${B('🔥 ยอดนิยม', { fn: 'idea', op: 'sort', sort: 'top' }, p.sort === 'top' ? 'primary' : '')}</div>${posts}`;
}
function mayorPanel() {
  const M = window.__mayor; if (!M) return '<h2>🏛️ เลือกตั้งนายกเมือง</h2><div class="sub">กำลังโหลด…</div>';
  const K = M.K, c = M.cur, ok = v => v ? '✅' : '❌';
  const cur = c ? `<div class="item"><div class="nm">🏛️ นายกเมืองตอนนี้: <b>${esc(c.n)}</b><small>วาระที่ ${c.terms} · นโยบาย ${c.pol ? M.pol[c.pol].n + ' (' + M.pol[c.pol].d + ')' : 'ยังไม่ได้ประกาศนโยบาย'}${c.ann ? '<br>📢 ' + esc(c.ann) : ''}</small></div></div>` : '<div class="item"><div class="nm">🏛️ ยังไม่มีนายกเมือง<small>ผู้ที่ชนะเลือกตั้งรอบนี้จะได้เป็นคนแรก</small></div></div>';
  let mine = '';
  if (M.isMe) {
    mine = `<div class="secT">👑 หน้าที่นายกเมือง</div>
      ${B(M.salDone ? '💰 รับเงินเดือนแล้ววันนี้' : `💰 รับเงินเดือน ${money(K.salary)}`, { fn: 'mayor', op: 'sal' }, 'good', !!M.salDone)}
      <div class="sub" style="margin-top:6px">เลือกนโยบายของเมือง (เปลี่ยนได้ทุกเมื่อ)</div>
      <div class="grid2">${Object.entries(M.pol).map(([k, v]) => B(v.n, { fn: 'mayor', op: 'pol', k }, c.pol === k ? 'primary' : '')).join('')}</div>
      ${c.pol ? `<div class="sub">${M.pol[c.pol].d}</div>` : ''}
      <div class="rowf" style="margin-top:8px"><input id="mAnn" maxlength="70" placeholder="ประกาศถึงชาวเมือง (วันละครั้ง)"></div>
      ${B(M.annDone ? '📢 วันนี้ประกาศแล้ว' : '📢 ประกาศ', { fn: 'mayor', op: 'ann' }, 'primary', !!M.annDone)}`;
  }
  const care = c && c.pol === 'care' ? `<div class="secT">🎁 เบี้ยเมือง</div>${B(M.claimed ? '✅ รับแล้ววันนี้' : `🎁 รับเบี้ยเมือง ${money(K.care)}`, { fn: 'mayor', op: 'claim' }, 'good', !!M.claimed)}` : '';
  const runBox = M.run ? `<div class="item"><div class="nm">🗳️ คุณเป็นผู้สมัคร · ชื่อเสียง ${M.run.rep}<small>หาเสียงได้อีก ${M.run.left} ครั้งวันนี้ · ครั้งละ ${money(K.camp)}<br>🌟 ชื่อเสียงฟรีจากทำดีให้เมือง วันนี้ ${M.run.act || 0}/${M.run.actMax || 6}: เก็บขยะ · ให้ทาน · ทำบุญ · รักษา/ช่วยชีวิตคนไข้ · ส่งของ · ตั้งใจเรียน · รอดคืนปล่อยผี (+3)</small></div>${B('📣 หาเสียง ' + money(K.camp), { fn: 'mayor', op: 'camp' }, 'good', !M.run.left)}</div>`
    : `${B('🗳️ ลงสมัคร ' + money(K.fee), { fn: 'mayor', op: 'run' }, 'primary', M.lv < K.minLv || me.money < K.fee)}<div class="sub">ต้องเลเวล ${K.minLv}+ (คุณ Lv.${M.lv}) · เป็นนายกติดกันได้ไม่เกิน ${K.maxTerms} วาระ</div>`;
  const rows = M.cands.map((r, i) => `<div class="item"><div class="nm">${i === 0 ? '🥇' : '#' + (i + 1)} ${esc(r.n)}<small>${r.v} คะแนนเสียง · ชื่อเสียง ${r.rep} · คะแนนรวม ${r.s}</small></div>${M.voted === r.l ? '<small>✅ คุณโหวตให้</small>' : B('🗳️ โหวต', { fn: 'mayor', op: 'vote', l: r.l, n: r.n }, 'good', !!M.voted || M.lv < K.voteLv || r.l === M.my)}</div>`).join('') || '<div class="sub">ยังไม่มีผู้สมัครในรอบนี้ มาเป็นคนแรกสิ!</div>';
  return `<h2>🏛️ เลือกตั้งนายกเมือง</h2>${cur}${mine}${care}
    <div class="secT">🗳️ การเลือกตั้งรอบนี้ · เหลืออีก ${M.left} วัน</div>
    <div class="sub">คะแนนรวม = คะแนนเสียง×10 + ชื่อเสียง · ใครสูงสุดเมื่อครบรอบได้เป็นนายก 1 วาระ (4 สัปดาห์) · โหวตได้คนละ 1 เสียง ต้องเลเวล ${K.voteLv}+ ${M.voted ? '· ✅ คุณโหวตแล้ว' : ''}</div>
    ${runBox}${rows}`;
}
function gangPanel(p) {
  const g = me.gang, gt = p.gtab || (g ? 'hq' : 'list'), GL = window.__gangs || { list: [], icons: ['🐉'], colors: ['#e0584a'], create: 20000 };
  const bar = (v, mx, col = 'var(--ok)') => `<div style="height:10px;border-radius:6px;background:rgba(0,0,0,.18);overflow:hidden;margin:4px 0"><i style="display:block;height:100%;width:${Math.min(100, mx ? v / mx * 100 : 0)}%;background:${col}"></i></div>`;
  const RL = { boss: '👑 หัวหน้า', vice: '⭐ รองหัวหน้า', mem: 'สมาชิก' };
  const tabs = (g ? [['hq', '🏠 บ้านแก๊ง'], ['mem', '👥 สมาชิก'], ...(g.role !== 'mem' ? [['req', '📨 คำขอ' + (g.req.length ? ` (${g.req.length})` : '')]] : []), ['rank', '🏆 อันดับ']] : [['list', '🏴 แก๊งทั้งหมด'], ['new', '➕ ตั้งแก๊ง']])
    .map(([k, l]) => B(l, { fn: 'gangTab', tab: k }, gt === k ? 'primary' : '')).join('');
  const rows = GL.list.map(r => `<div class="item"><div class="nm"><span style="color:${r.color}">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '#' + r.rank}</span> ${r.icon} ${esc(r.name)}<small>${r.ln} · ${r.n}/${r.cap} คน · หัวหน้า ${esc(r.boss)} · สัปดาห์นี้ ${r.wpts.toLocaleString()} แต้ม</small></div>${!g ? (r.asked ? '<small>รอตอบรับ…</small>' : r.n >= r.cap ? '<small>เต็ม</small>' : B('📨 ขอเข้า', { fn: 'gang', op: 'req', id: r.id }, 'good')) : g.id === r.id ? '<small>แก๊งของคุณ</small>' : ''}</div>`).join('') || '<div class="sub">ยังไม่มีแก๊งในเมือง ตั้งแก๊งแรกได้เลย!</div>';
  let body = '';
  if (!g && gt === 'new') {
    const ic = p.gic || GL.icons[0], co = p.gco || GL.colors[0], nm = p.gnm || '';
    body = `<div class="sub">ตั้งแก๊งใช้เงิน <b>${money(GL.create)}</b> · รับสมาชิกได้ 10 คน อัปเกรดบ้านแก๊งได้ถึง 30 คน · เงินสดของคุณ ${money(me.money)}</div>
      <div class="rowf" style="margin-top:8px"><input id="gName" maxlength="14" placeholder="ชื่อแก๊ง (2-14 ตัวอักษร)" value="${esc(nm)}"></div>
      <div class="secT">ตราประจำแก๊ง</div><div class="grid2">${GL.icons.map(i => B(i, { fn: 'gset', set: { gic: i } }, i === ic ? 'primary' : '')).join('')}</div>
      <div class="secT">สีแก๊ง</div><div class="grid2">${GL.colors.map(c => `<button class="${c === co ? 'primary' : ''}" data-m="${esc(JSON.stringify({ fn: 'gset', set: { gco: c } }))}" style="background:${c};min-height:34px">${c === co ? '✔' : ''}</button>`).join('')}</div>
      <div class="item"><div class="nm"><span style="background:${co};color:#fff;padding:2px 8px;border-radius:8px">${ic} ${esc(nm || 'ชื่อแก๊ง')}</span><small>ตัวอย่างป้ายที่จะขึ้นใต้ชื่อคุณ</small></div></div>
      ${B('🏴 ตั้งแก๊ง ' + money(GL.create), { fn: 'gang', op: 'create' }, 'primary', me.money < GL.create)}`;
  } else if (!g) {
    body = `<div class="sub">ยังไม่มีแก๊ง · เข้าแก๊งเพื่อสะสมแต้มด้วยกัน ทำภารกิจประจำวัน และมีบ้านแก๊งไว้พักฟื้น</div>${rows}`;
  } else if (gt === 'hq') {
    const N = g.next, pc = Math.round(g.inc * 100);
    body = `<div class="item"><div class="nm">🎯 ภารกิจแก๊งวันนี้<small>ทำแต้มรวมให้ถึง ${g.msn.goal.toLocaleString()} (${g.msn.prog.toLocaleString()} แล้ว) · สำเร็จทุกคนได้ ${money(g.msn.pay)} ${g.msn.done ? '· ✅ สำเร็จแล้ว' : ''}</small>${bar(g.msn.prog, g.msn.goal, g.msn.done ? 'var(--ok)' : 'var(--acc)')}</div></div>
      <div class="grid2"><div class="item"><div class="nm">💰 คลังแก๊ง<small><b style="color:var(--acc);font-size:16px">${money(g.bank)}</b></small></div></div><div class="item"><div class="nm">⭐ แต้มรวม<small><b style="font-size:16px">${g.pts.toLocaleString()}</b> · สัปดาห์นี้ ${g.wpts.toLocaleString()} · ของฉัน ${g.mine.toLocaleString()}</small></div></div></div>
      <div class="sub">แต้มมาจากรายได้ของสมาชิกทุกคน (สูงสุด 300 แต้ม/วัน/คน) และจากการบริจาค · แก๊งอันดับ #${g.rank} ของสัปดาห์นี้</div>
      <div class="secT">🏠 ${g.ln} (Lv.${g.lvl})</div>
      <div class="sub">สิทธิพิเศษ: ${pc ? `รายได้ +${pc}% · ` : ''}พักฟื้นได้ +${g.rest} พลังงานทุก 30 นาที · รับสมาชิกได้ ${g.cap} คน</div>
      ${B(g.restLeft ? `🛋️ พักได้อีก ${Math.ceil(g.restLeft / 60)} นาที` : `🛋️ พักที่บ้านแก๊ง +${g.rest}⚡`, { fn: 'gang', op: 'rest' }, 'good', !!g.restLeft)}
      <div class="rowf" style="margin-top:10px"><input id="gAmt" type="number" min="100" value="1000" inputmode="numeric"></div>
      ${B('💰 บริจาคเข้าคลังแก๊ง', { fn: 'gang', op: 'donate' }, 'primary')}
      ${N ? `<div class="item" style="margin-top:10px"><div class="nm">⬆️ อัปเกรดเป็น ${N.n}<small>ใช้เงินคลัง ${money(N.cost)} ${g.bank >= N.cost ? '✅' : '❌'} · แต้มรวม ${N.pts.toLocaleString()} ${g.pts >= N.pts ? '✅' : '❌'} · รับได้ ${N.cap} คน${N.inc ? ` · รายได้ +${Math.round(N.inc * 100)}%` : ''} · พัก +${N.rest}</small></div>${B('อัปเกรด', { fn: 'gang', op: 'upgrade' }, g.role === 'boss' ? 'good' : '', g.role !== 'boss')}</div>` : '<div class="sub">🏆 บ้านแก๊งอัปเกรดสูงสุดแล้ว</div>'}
      ${g.role === 'boss' ? `<div class="secT">✏️ เปลี่ยนชื่อแก๊ง</div><div class="rowf"><input id="gRename" maxlength="14" placeholder="ชื่อแก๊งใหม่"></div>${B('✏️ เปลี่ยนชื่อ 💎300', { fn: 'gang', op: 'rename' }, 'primary', !me.admin && (me.gems || 0) < 300)}` : ''}
      <div class="grid2" style="margin-top:14px">${B('🚪 ออกจากแก๊ง', { fn: 'gang', op: 'leave' })}${g.role === 'boss' ? B('💥 ยุบแก๊ง', { fn: 'gang', op: 'disband' }) : ''}</div>`;
  } else if (gt === 'mem') {
    body = g.mem.map(m => { const me0 = m.l === g.my, act = [];
      if (g.role !== 'mem' && m.r !== 'boss' && !me0 && !(m.r === 'vice' && g.role !== 'boss')) act.push(B('ไล่ออก', { fn: 'gang', op: 'kick', l: m.l }));
      if (g.role === 'boss' && m.r !== 'boss') act.push(B(m.r === 'vice' ? 'ปลดรอง' : '⭐ ตั้งรอง', { fn: 'gang', op: 'vice', l: m.l }), B('👑 ส่งต่อหัวหน้า', { fn: 'gang', op: 'boss', l: m.l }));
      return `<div class="item"><div class="nm">${m.on ? '🟢' : '⚪'} ${esc(m.n)}<small>${RL[m.r]} · สัปดาห์นี้ ${m.p.toLocaleString()} แต้ม</small></div>${act.length ? `<div class="grid2">${act.join('')}</div>` : ''}</div>`; }).join('');
  } else if (gt === 'req') {
    body = g.req.length ? g.req.map(r => `<div class="item"><div class="nm">📨 ${esc(r.n)}<small>ขอเข้าแก๊ง</small></div><div class="grid2">${B('✅ รับ', { fn: 'gang', op: 'accept', l: r.l }, 'good')}${B('ปฏิเสธ', { fn: 'gang', op: 'deny', l: r.l })}</div></div>`).join('') : '<div class="sub">ยังไม่มีคนขอเข้า</div>';
  } else {
    body = `<div class="sub">อันดับรายสัปดาห์ (รีเซ็ตทุกวันจันทร์) · แก๊งที่ 1 ได้ชื่อขึ้นป้ายเด่นตลอดสัปดาห์</div>${rows}`;
  }
  return `<h2>${g ? `<span style="color:${g.color}">${g.icon} ${esc(g.name)}</span>` : '🏴 แก๊ง / ชมรม'}</h2><div class="tabs">${tabs}</div>${body}`;
}
function renderPanel(p) {
  const k = p.kind, st = p.st;
  switch (k) {
    case 'news': return newsHtml();
    case 'ev7': return ev7Html();
    case 'lkev': return lkEvHtml();
    case 'fairgame': { const g = G.fair.games[STN(st).k];
      const how = { darts: 'เป้าเล็งจะส่ายไปมา กดเพื่อปาลูกดอก มี 6 ดอก ยิ่งลูกโป่งแตกมากยิ่งได้มาก', ring: 'เข็มพลังจะวิ่งไปมา กดตอนเข็มอยู่ในช่องสีเขียว ห่วงจะลงขวด มี 3 ห่วง ยิ่งเล่นยิ่งยาก', fish: 'ลากเบ็ดไปเหนือเป็ด แล้วกดเพื่อเกี่ยว มีเวลา 20 วินาที ตกให้ได้มากที่สุด' }[STN(st).k];
      return `<h2>${STN(st).icon} ${esc(g.name)}</h2><div class="sub">🎪 เกมงานวัด · เล่นครั้งละ ${money(g.price)}<br>${how}<br>🏆 คะแนนเต็ม: เงินรางวัล ${money(g.pay[g.pay.length - 1])} + 💎1 + 🧸 ตุ๊กตารางวัลใหญ่</div>
        <div class="sub">รางวัลตามคะแนน: ${g.pay.map((v, i) => `${i}=${v ? money(v) : '-'}`).join(' · ')}</div>${B(`🎮 เล่นเลย (${money(g.price)})`, { t: 'act', st, a: 'start' }, 'primary big', me.money < g.price)}`; }
    case 'lk': {
      const v = LKV || {}, K = G.lk.kinds;
      return `<h2>🪷 ท่าลอยกระทง</h2><div class="sub">เลือกกระทง เขียนคำอธิษฐาน แล้วลอยลงทะเลสาบ · ทุกคนในเมืองเห็นกระทงของคุณ · ลอยพร้อมเพื่อนข้างๆ = ลอยคู่ 💕<br>
        วันนี้ได้รางวัลอีก <b>${v.left ?? 3}</b> ครั้ง${v.fest ? ' · <b>🌕 วันลอยกระทง รางวัล x2!</b>' : ''} · ความคืบหน้าชุดฟรี <b>${Math.min(v.days || 0, v.need || 3)}/${v.need || 3}</b> วัน</div>
        <input id="lkWish" maxlength="40" placeholder="คำอธิษฐาน (ไม่บังคับ)" style="width:100%;margin:6px 0 8px">
        <div class="looks">${Object.entries(K).map(([k, o]) => `<div class="look"><canvas data-lk="${o.sp}" width="72" height="64"></canvas><small>${esc(o.name)}</small>${B(money(o.price), { fn: 'lkFloat', st, kind: k }, 'good', me.money < o.price)}</div>`).join('')}</div>`;
    }
    case 'lksky': return `<h2>🏮 ปล่อยโคมลอย</h2><div class="sub">ปล่อยโคมลอยขึ้นฟ้า ขอให้ทุกข์โศกลอยไปกับโคม · ทุกคนในวัดเห็นโคมของคุณ${LKV?.fest ? ' · <b>วันนี้วันลอยกระทง ปล่อยโคมแรกฟรี!</b>' : ''}</div>
      <div class="looks"><div class="look"><canvas data-lk="skylantern" width="72" height="72"></canvas><small>โคมลอย</small>${B(money(G.lk.sky), { t: 'act', st, a: 'release' }, 'primary')}</div></div>`;
    case 'fbpost': {
      const n = Math.max(1, Math.min(NEWS.length, p.n || fbNewCount())), txt = fbText(n);
      return `<h2>📣 โพสต์ข่าวลงเฟส</h2><div class="sub">กดคัดลอก แล้วไปวางในกลุ่มเฟส · เลือกจำนวนรอบอัปเดตที่จะรวมในโพสต์ได้</div>
        <div class="tabs">${[1, 2, 3, 5].map(k => B(`${k} รอบ`, { fn: 'qtab', set: { n: k } }, n === k ? 'primary' : '')).join('')}</div>
        <textarea id="fbTxt" readonly style="width:100%;height:320px;font-size:14px;line-height:1.5;padding:8px;box-sizing:border-box;border-radius:8px">${esc(txt)}</textarea>
        <div style="margin-top:8px">${B('📋 คัดลอกข้อความ', { fn: 'fbCopy', n }, 'primary big')}</div>`;
    }
    case 'icu': {
      const wait = Math.max(0, Math.ceil(((me.icuNext || 0) - Date.now() - clockOff) / 1000));
      if (!job('doctor')) return `<h2>🚨 ICU · ห้องฉุกเฉิน</h2><div class="sub">เฉพาะแพทย์เท่านั้น · หมอรับเคสฉุกเฉินที่นี่ แล้วลงมือรักษาจริงในห้อง</div>`;
      const pay = G.icu.pay[Math.min(me.lv, G.icu.pay.length) - 1] * 2.2;
      const cur = me.mis?.kind === 'icu';
      return `<h2>🚨 ICU · ห้องฉุกเฉิน</h2><div class="sub">เคสฉุกเฉินสุ่ม 8 แบบ (หัวใจหยุดเต้น ผ่าตัดไส้ติ่ง หอบหืด กระดูกหัก เสียเลือดมาก แพ้รุนแรง ไข้เลือดออก แผลลึก) · เดินไปหยิบยา/อุปกรณ์ในห้อง แล้วยืนรักษาคนไข้ที่เตียง ICU จนเสร็จภายในเวลา · ~${money(pay)} ต่อเคส ทำเร็ว +25% · ⚡${G.icu.energy}</div>
        ${cur ? misBox() : me.mis ? '<div class="jobbox">มีภารกิจอื่นค้างอยู่ ทำให้เสร็จก่อน</div>' : wait ? `<div class="jobbox">⏳ เคสถัดไปจะเข้ามาในอีก <b>${wait}</b> วินาที</div>` : B('🚑 รับเคสฉุกเฉิน', { t: 'act', st, a: 'start' }, 'primary big')}`;
    }
    case 'office': {
      const l = Math.min(me.career === 'office' ? me.lv : 1, G.titles.length), wage = G.wages[l - 1];
      const o = me.office, today = dayNow();
      let status = '';
      if (job('office')) {
        const state = o && o.day === today ? (o.closed === today ? '✅ เลิกงานแล้ว' : `🟢 ทำงานอยู่ · ส่งไปแล้ว ${o.n || 0} งาน`) : '⚪ ยังไม่ได้เริ่มงานวันนี้';
        status = `<div class="item" style="display:block">ตำแหน่ง <b>${G.titles[l - 1]}</b> · ค่าส่งเอกสาร <b>~${money(Math.round(wage * .3))}–${money(Math.round(wage * .95))}</b>/งาน (ยิ่งไกลยิ่งได้มาก)<br>วันนี้: ${state}</div>
          ${me.docjob ? `<div class="jobbox ok">📄 กำลังส่งเอกสารไปที่ <b>${esc(STN(me.docjob.dest)?.label || '')}</b> · ค่าส่ง ~${money(me.docjob.pay)}${B('📍 นำทาง', { fn: 'guide', key: me.docjob.dest }, 'good')}</div>` : B('📄 รับงานส่งเอกสาร', { t: 'act', st, a: 'job' }, 'primary big')}
          <div class="sub" style="margin-top:8px">📄 รับซองเอกสารที่นี่ เดินไปส่งให้ถึงหน้าอาคารปลายทาง ได้เงินทันที (ไกลได้มาก) แล้วกลับมารับงานต่อ · เวลางาน ${hhmm(G.shift.start)}–${hhmm(G.shift.end)} เริ่มเมื่อไหร่ก็ได้ ไม่มีมาสาย · โอทีต่อได้ถึง ${hhmm(G.shift.ot)} (ค่าส่ง x${G.shift.otMul})</div>
          ${jgBox('type', 'นั่งโต๊ะคอม พิมพ์เอกสารตามต้นแบบให้ตรงทุกตัวอักษร 12 บรรทัด')}
          ${B('📦 ลาออก', { t: 'resign' }, 'warn')}`;
      }
      return `<h2>🏢 บริษัท ไทยเทค · ฝ่ายบุคคล</h2><div class="sub">${hoursTxt('office')} · เวลางาน ${hhmm(G.shift.start)}–${hhmm(G.shift.end)} + โอทีถึง ${hhmm(G.shift.ot)} (x${G.shift.otMul}) · ได้เงินตามจำนวนเอกสารที่ส่ง (ต้องจบปริญญาตรี)</div>${status}${job('office') ? '' : staffHint('office')}`;
    }
    case 'sdesk': {
      const L = me.enrolled && G.licenses[me.enrolled];
      return `<h2>📖 โต๊ะเรียน</h2>${L ? `<div class="sub">กำลังเรียน${L.name} ${me.classes}/${L.classes} คาบ · นั่งครบ 1 ชั่วโมงในเกม = 1 คาบ</div>${B('📖 นั่งเรียน', { t: 'act', st, a: 'sit' }, 'primary big')}` : '<div class="sub">ต้องลงทะเบียนเรียนที่เคาน์เตอร์มหาวิทยาลัยก่อน (ม.6 / ปริญญาตรี)</div>'}`;
    }
    case 'chair':
      return `<h2>💺 โต๊ะทำงาน</h2><div class="sub">สำหรับพนักงานบริษัท ตอนนี้งานบริษัทคือส่งเอกสาร 📄 รับงานที่ฝ่ายบุคคล (เคาน์เตอร์หน้าออฟฟิศ)</div>${needCareer('office')}`;
    case 'market': {
      const tab = p.tab || 'buy', mk = wd?.mk || {}, cat = p.cat || 'all', q = (p.q || '').trim().toLowerCase();
      const tabs = `<div class="tabs">${[['buy', '🛍️ ซื้อ'], ['sell', '🏷️ ขาย'], ['mine', `📋 ของฉัน (${(me.listings || []).length})`]].map(([k, l]) => B(l, { fn: 'mtab', set: { tab: k } }, tab === k ? 'primary' : '')).join('')}</div>`;
      const cats = `<div class="tabs cats">${[['all', 'ทั้งหมด'], ...Object.entries(G.cats)].map(([k, l]) => B(l, { fn: 'mtab', set: { cat: k } }, cat === k ? 'good' : '')).join('')}</div>`;
      const search = `<input id="mSearch" placeholder="🔍 ค้นหาชื่อสินค้า เช่น ปลา, ข้าว" value="${esc(p.q || '')}" autocomplete="off">`;
      const match = id => { const it = G.items[id]; return (cat === 'all' || it.kind === cat) && (!q || it.name.toLowerCase().includes(q) || id.includes(q)); };
      let body = '';
      if (tab === 'buy') {
        body = Object.entries(G.items).filter(([id, it]) => it.base < 1000 && !it.menu && !it.egg && match(id) && ((mk[id]?.n || 0) > 0 || q)).map(([id]) => {
          const m2 = { ...(mk[id] || {}) };
          const own = (me.listings || []).filter(L => L.item === id).reduce((t, L) => t + L.qty, 0);
          const n = Math.max(0, (m2.n || 0) - own);
          const pl = n ? `<b style="color:var(--ok)">ผู้เล่น ${money(m2.best)}</b> (${n} ชิ้น)` : '<span style="opacity:.6">ไม่มีผู้เล่นวางขาย</span>';
          return itemRow(id, `${B(n ? `ซื้อ ${money(m2.best)}` : 'ไม่มีของ', { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', !n)}`, `${pl}${(G.items[id].rar || 0) >= 3 ? ' · ปลาหายาก ร้าน NPC ไม่มีขาย' : ` · ร้าน NPC ${money(m2.sell || 0)}`}`);
        }).join('');
        body = `<div class="sub">ซื้อจากผู้เล่นที่วางขาย (ถูกที่สุดก่อนเสมอ) · ร้าน NPC เลิกขายแล้ว · สั่งให้ไรเดอร์มาส่งได้ในแอพ 📱 เดลิเวอรี</div>${search}${cats}<div class="list">${body || '<div class="sub">ไม่พบสินค้า</div>'}</div>`;
      } else if (tab === 'sell') {
        const inv = Object.entries(me.inv).filter(([id, q]) => q > 0 && match(id));
        body = inv.map(([id, q]) => {
          const it = G.items[id], m2 = { ...(mk[id] || {}), ...(me.npcp?.[id] ? { npc: me.npcp[id] } : {}) }, sug = m2.n ? Math.max(1, m2.best - 1) : Math.round(m2.ref || it.base);
          return itemRow(id, '', `มี ${q} · ราคาตลาด ~${money(m2.ref || it.base)} · ผู้เล่นขายถูกสุด ${m2.n ? money(m2.best) : '—'} · <span style="color:var(--bad)">NPC รับซื้อแค่ ${money(m2.npc || 0)}</span>`) +
            `<div class="rowf" style="margin:-2px 0 6px"><input id="lp_${id}" type="number" min="1" value="${sug}" style="width:90px"> <span class="sub" style="margin:0">฿/ชิ้น</span>${B('วาง 1', { fn: 'list', st, item: id, qty: 1 })}${B(`วางหมด ${q}`, { fn: 'list', st, item: id, qty: q }, 'good')}${B(`NPC ${money((m2.npc || 0) * q)}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' })}</div>`;
        }).join('');
        body = `<div class="sub">💡 <b>วางขายให้ผู้เล่น</b>ได้ราคาดีกว่ามาก (ตลาดหัก 5% · ขายได้แม้ออฟไลน์) · ขาย NPC ได้เงินทันทีแต่ราคาต่ำมาก</div>${search}${cats}${body || '<div class="sub">ไม่มีของที่ตรงกับตัวกรอง</div>'}`;
      } else {
        body = (me.listings || []).map(L => itemRow(L.item, B('เก็บคืน', { t: 'act', st, a: 'unlist', id: L.id }, 'warn'), `${L.qty} ชิ้น · ${money(L.price)}/ชิ้น`)).join('') || '<div class="sub">ยังไม่ได้วางขายอะไร</div>';
        body = `<div class="list">${body}</div>`;
      }
      const pick = (me.jobs || []).some(j => j.mine && j.state === 'taken' && j.src === 'market') ? `<div class="jobbox ok">🛵 มีของต้องรับไปส่ง ${B('📦 รับของจากตลาด', { t: 'act', st, a: 'pickup' }, 'primary')}</div>` : '';
      return `<h2>🏪 ตลาดกลาง</h2><div class="sub">${hoursTxt('market')} · ของที่วางขายครบ 2 ชั่วโมงแล้วยังไม่มีคนซื้อ ตลาดจะรับซื้อให้ที่ 40% ของราคาตลาด (ขายให้ผู้เล่นด้วยกันได้ราคาดีกว่า)</div>${pick}${tabs}${body}`;
    }
    case 'fortune': {   // 🔮 tarot tent: pick a topic (3 face-down cards), one card a day; the new card flips over once
      const F = G.fortuneCfg, T = G.tarot || {}, ids = Object.keys(T), f = me.fortune;
      const css = `<style>.tcd{width:96px;height:128px;border-radius:10px;border:3px solid #d9a521;box-shadow:0 4px 14px rgba(60,20,90,.35);margin:0 auto}
        .tbk{background:radial-gradient(circle at 50% 45%,#f6d36b 0 9%,transparent 10%),repeating-linear-gradient(45deg,#3b1f6e 0 8px,#4a2a85 8px 16px);display:flex;align-items:flex-end;justify-content:center}
        .tpk{flex:1;text-align:center;cursor:pointer;background:none;border:0;padding:4px;transition:transform .15s}.tpk:hover:not(:disabled){transform:translateY(-6px)}.tpk:disabled{opacity:.45;cursor:default}
        .tpk b{display:block;margin-top:6px}.tfl{animation:tfl .9s ease-out}@keyframes tfl{0%{transform:rotateY(90deg) scale(.8);filter:brightness(3)}60%{transform:rotateY(0) scale(1.08)}100%{transform:none}}
        .tglow{animation:tglow 2.4s ease-in-out infinite}@keyframes tglow{50%{box-shadow:0 0 22px #b07cff}}</style>`;
      const head = `<h2>🔮 เต็นท์แม่หมอจันทรา</h2>`;
      if (!f || !T[f.id]) {
        const poor = me.money < F.price;
        const picks = Object.entries(F.topics).map(([k, [ic, nm]]) => `<button class="tpk" data-m="${esc(JSON.stringify({ t: 'act', st, a: 'read', topic: k }))}" ${poor ? 'disabled' : ''}>
          <div class="tcd tbk tglow"><span style="font-size:30px;margin-bottom:10px">${ic}</span></div><b>${nm}</b></button>`).join('');
        return `${css}${head}<div class="jobbox" style="font-style:italic">"ตั้งจิตให้มั่น นึกถึงเรื่องที่อยากรู้... แล้วเลือกไพ่ใบที่ใจเรียกหา"<br><small>— แม่หมอจันทรา</small></div>
          <div style="display:flex;gap:6px;margin:10px 0">${picks}</div>
          <div class="sub" style="text-align:center">ค่าดูดวง ${money(F.price)} · วันละครั้ง · ถ้าได้ไพ่ดี แม่หมอแถมโชค ${money(F.bonus)}${poor ? '<br>⚠️ เงินไม่พอ' : ''}</div>`;
      }
      const t = T[f.id], tp = F.topics[f.topic] || ['🔮', ''], key = f.d + f.id + f.topic, fresh = key !== tarotSeen; tarotSeen = key;
      const omen = f.good ? ['✨ ดวงดี', '#2e9e5b'] : t.s[f.r] < 0 ? ['⚠️ ระวัง', '#c0482b'] : ['🌙 กลางๆ', '#8a6d3b'];
      return `${css}${head}<div style="text-align:center"><div class="sub">${tp[0]} ดวง${esc(tp[1])}ของคุณวันนี้</div>
        <div class="${fresh ? 'tfl' : ''}" style="perspective:600px;margin:10px auto"><div class="tcd" style="width:120px;height:152px;background:url(assets/tarot.webp) -${ids.indexOf(f.id) * 120}px 0/${ids.length * 120}px 152px;image-rendering:pixelated;${f.r ? 'transform:rotate(180deg)' : ''}"></div></div>
        <b style="font-size:15px">${esc(t.n)}</b>${f.r ? '<div class="sub">(ไพ่กลับหัว)</div>' : ''}
        <div style="display:inline-block;margin:6px 0;padding:2px 10px;border-radius:99px;background:${omen[1]};color:#fff;font-size:12px">${omen[0]}</div>
        ${f.sees?.length ? `<div class="jobbox" style="text-align:left;line-height:1.6"><b>🔮 แม่หมอมองเห็นว่า...</b>${f.sees.map(x => `<div style="margin-top:4px">• ${esc(x)}</div>`).join('')}</div>` : ''}
        <div class="jobbox" style="font-size:15px;line-height:1.6"><b>🃏 ไพ่บอกว่า</b><br>"${esc(t[f.r ? 'rev' : 'up'][f.topic] || '')}"<br><small>— แม่หมอจันทรา</small></div>
        ${f.luck ? `<div class="sub">🍀 เลขนำโชควันนี้ <b>${f.luck.num}</b> · สีมงคล <b>${esc(f.luck.col)}</b></div>` : ''}</div>
        ${f.paid ? `<div class="jobbox ok">🍀 ไพ่ดี! แม่หมอแถมโชคให้ ${money(f.paid)}</div>` : ''}<div class="sub" style="text-align:center">พรุ่งนี้มาเปิดไพ่ใหม่ได้อีกนะ</div>`;
    }
    case 'pshop': {
      const rows = (STN(st)?.items || G.pshop?.items || []).map(id => { const it = G.items[id], u = Math.ceil(it.base * G.pshop.markup), e = it.eat || {};
        return itemRow(id, `<div>${B(money(u), { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', me.money < u)}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 }, '', me.money < u * 5)}</div>`,
          [e.hunger && `อิ่ม +${e.hunger}`, e.happy && `สุข +${e.happy}`, !it.eat && 'ของฝาก ขายต่อได้', `มีอยู่ ${me.inv[id] || 0}`].filter(Boolean).join(' · ')); }).join('');
      return `<h2>${STN(st).icon} ${STN(st).label}</h2><div class="sub">ป๊อปคอร์น สายไหม ฮอตดอก น้ำเย็นๆ ลูกโป่ง และตุ๊กตาของฝาก · ซื้อแล้วเก็บในกระเป๋า กดใช้ได้ทุกเมื่อ</div><div class="list">${rows}</div>`;
    }
    case 'tshop': {
      const rows = (G.tshop?.items || []).map(id => { const it = G.items[id], u = Math.ceil(it.base * G.tshop.markup), e = it.eat || {};
        return itemRow(id, `<div>${B(money(u), { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', me.money < u)}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 }, '', me.money < u * 5)}</div>`,
          [id === 'offering' && 'ใช้ไหว้พระในโบสถ์', id === 'malai' && 'ของฝาก ขายต่อได้', id === 'amulet' && 'พกไว้ ไหว้พระแล้วได้พรนาน 2 เท่า', e.hunger && `อิ่ม +${e.hunger}`, e.energy && `พลัง +${e.energy}`, e.happy && `สุข +${e.happy}`, `มีอยู่ ${me.inv[id] || 0}`].filter(Boolean).join(' · ')); }).join('');
      return `<h2>🪔 ร้านค้าวัด</h2><div class="sub">เปิดทุกวัน · ชุดไหว้พระ พวงมาลัย ขนมไทย ของใส่บาตร · ชุดธูปเทียนใช้ไหว้พระในโบสถ์แทนการจ่ายเงิน</div><div class="list">${rows}</div>`;
    }
    case 'wpray': {
      const bl = (me.bless || 0) > Date.now() + clockOff ? `<div class="jobbox ok">✨ ได้รับพรอยู่ เหลืออีก ${Math.ceil((me.bless - Date.now() - clockOff) / 60000)} นาที · รายได้ทุกอย่าง +5%</div>` : '';
      const h = hourNow(), A = me.alms;
      let monk = '';
      if (job('monk')) {
        if (A) { const n = A.got.filter(Boolean).length; monk = `<div class="jobbox">🙏 <b>กำลังบิณฑบาต</b> รับบาตรแล้ว ${n}/${A.pts.length} จุด${n === A.pts.length ? ' · <b>ครบแล้ว! ยืนหน้าพระประธานแล้วจะได้ปัจจัยจากวัด</b>' : ' · ไปตามจุดสีทองบนแผนที่ในเมือง'}</div>`; }
        else if (me.almsDay === dayNow()) monk = '<div class="jobbox ok">🙏 วันนี้บิณฑบาตแล้ว · พรุ่งนี้เช้าตื่นมาออกใหม่นะ</div>';
        else monk = `<div class="jobbox">🌅 ออกบิณฑบาตได้ทุกเช้า 05:00–10:00 · ตอนนี้ ${h >= 5 && h < 10 ? '<b>ได้เวลาแล้ว!</b>' : 'ยังไม่ใช่เวลา'}</div>${B('🙏 ออกบิณฑบาต (⚡6)', { t: 'act', st, a: 'alms' }, 'primary big', !(h >= 5 && h < 10))}`;
        monk += `<div class="sub">🍚 พระฉันได้แค่ 05:00–12:00 (งดฉันหลังเที่ยง ดื่มน้ำได้) · ตีระฆังในวัดได้ทุกเมื่อ</div>`;
      }
      return `<h2>🛕 พระอุโบสถ</h2><div class="sub">กราบพระประธาน ขอพรให้ทำงานรุ่ง · ใช้ชุดธูปเทียนดอกไม้จากร้านค้าวัด หรือจ่ายค่าธูปเทียนหน้าโบสถ์</div>${bl}${monk}
        ${B(`🙏 ไหว้พระขอพร ${(me.inv.offering || 0) > 0 ? '(ใช้ชุดธูปเทียน 1 ชุด)' : money(G.templeq?.pray || 20)}`, { t: 'act', st, a: 'pray' }, 'good big')}${job('monk') ? '' : staffHint('monk')}`;
    }
    case 'cstore': {
      const rows = (G.cstore?.items || []).map(id => { const it = G.items[id], u = Math.ceil(it.base * G.cstore.markup), e = it.eat || {};
        return itemRow(id, `<div>${B(money(u), { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', me.money < u)}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 }, '', me.money < u * 5)}</div>`,
          [e.hunger && `อิ่ม +${e.hunger}`, e.energy && `พลัง +${e.energy}`, e.health && `เลือด +${e.health}`, e.happy && `สุข +${e.happy}`].filter(Boolean).join(' · ') + ` · มีอยู่ ${me.inv[id] || 0}`); }).join('');
      const cashier = job('cashier') ? jgBox('cash', 'เข้ากะแคชเชียร์ คิดเงินทอนลูกค้า 10 คน') + jgBox('stock', 'ของหมดชั้น! หยิบของจากลังไปเติมและจัดเรียงให้ตรงช่อง') : '';
      return cashier + `<h2>🏪 ร้านสะดวกซื้อ 24 ชม.</h2><div class="sub">เปิดตลอด 24 ชั่วโมง ของมีเสมอ ไม่ต้องรอใครวางขาย · ราคาสูงกว่าตลาดนิดหน่อย</div><div class="list">${rows}</div>`;
    }
    case 'warehouse': {
      const c = me.auc, head = `<h2>🔨 โรงประมูล</h2><div class="sub">${hoursTxt('warehouse')} · ล็อตละ 20 วินาที ยื่นซองประมูลได้ครั้งเดียว (แก้ราคาได้ก่อนหมดเวลา) แข่งกับคู่แข่ง 3 คน · ใครเสนอสูงสุดชนะและจ่ายตามที่เสนอ · ได้ของมาแล้วโรงประมูลรับซื้อคืนในราคาจริงทันที: <b>ต่ำกว่าราคาจริง = กำไร</b> สูงกว่า = ขาดทุน</div>`;
      if (!job('merchant')) return `${head}<div class="jobbox">เฉพาะ<b>พ่อค้า</b> · สมัครได้ที่นี่</div>`;
      const vend = jgBox('vend', 'ขนเครื่องดื่มขึ้นรถไปเติมตู้กดน้ำทั่วเมือง ใส่ให้ตรงช่อง เติมเต็มตู้ได้โบนัส');
      const lot = c ? `<div class="aucLot"><div class="aucIco">${c.icon}</div><div><b>${esc(c.name)}</b><div class="aucItems">${Object.entries(c.items).map(([id, q]) => `<span>${G.items[id].icon} ${esc(G.items[id].name)} ×${q}</span>`).join('')}</div><small>สภาพ: <b>${c.cond}</b> · 🧐 ผู้ประเมินว่าราวๆ <b>${money(c.lo)} – ${money(c.hi)}</b></small></div></div>` : '';
      if (!c || c.stage === 'done' && !c.result) return `${head}${vend}<div class="jobbox">ยังไม่มีล็อตบนเวที</div>${B('🔨 เปิดล็อตถัดไป (⚡4)', { t: 'act', st, a: 'auction' }, 'primary big')}`;
      if (c.stage === 'bid') {
        const bots = c.bots.map(b => `<div class="aucBot">${b.sent ? '✉️' : '🤔'} <b>${esc(b.name)}</b> <small>${esc(b.style)} · ${b.sent ? 'ยื่นซองแล้ว' : 'กำลังคิด...'}</small></div>`).join('');
        return `${head}${vend}${lot}<div class="aucTimer">⏱ เหลือเวลา <b class="auccd" data-t="${c.until}"></b></div><div class="aucBots">${bots}<div class="aucBot me">${c.my ? '✉️' : '✍️'} <b>คุณ</b> <small>${c.my ? `ยื่นแล้ว ${money(c.my)} (แก้ได้)` : 'ยังไม่ได้ยื่น'}</small></div></div>
          <div class="rowf" style="margin-top:8px"><input id="aucAmt" type="number" min="10" step="10" inputmode="numeric" placeholder="ราคาที่จะเสนอ (บาท)" value="${c.my || ''}">${B(c.my ? '✉️ แก้ซอง' : '✉️ ยื่นซอง', { fn: 'aucBid', st }, 'primary')}</div>
          <div class="sub">เงินสดที่มี ${money(me.money)} · ไม่ยื่นก็ได้ ถ้าคิดว่าแพงเกินไป</div>`;
      }
      const rows = c.result.map(([n, b, mine], i) => `<div class="aucRes ${i === 0 ? 'win' : ''} ${mine ? 'me' : ''}">${i === 0 ? '🏆' : `${i + 1}.`} <b>${esc(mine ? 'คุณ' : n)}</b><span>${money(b)}</span>${b <= c.real ? '<i class="up">ต่ำกว่าจริง</i>' : '<i class="dn">เกินราคาจริง</i>'}</div>`).join('');
      const iWon = c.result[0]?.[2], verdict = iWon ? (c.net >= 0 ? `<div class="aucVerdict good">🎉 คุณชนะ! กำไร <b>${money(c.net)}</b></div>` : `<div class="aucVerdict bad">😵 ชนะแต่จ่ายแพงไป ขาดทุน <b>${money(-c.net)}</b></div>`) : `<div class="aucVerdict">${esc(c.win)} ได้ไป${c.my ? ' · คุณไม่ได้เสียเงิน' : ''}</div>`;
      return `${head}${vend}${lot}<div class="aucReal">💎 มูลค่าจริง <b>${money(c.real)}</b></div><div class="aucResList">${rows}</div>${verdict}${B('🔨 ล็อตถัดไป (⚡4)', { t: 'act', st, a: 'auction' }, 'primary big')}`;
    }
    case 'rider': return `<h2>🛵 ศูนย์ไรเดอร์ส่งอาหาร</h2><div class="sub">${hoursTxt('rider')} · ต้องมีใบขับขี่และมอเตอร์ไซค์ · รับออเดอร์ผ่านแอพในมือถือ 📱</div>${staffHint('rider')}${job('rider') ? `<div class="jobbox">🧡 <b>แย่งลูกค้า!</b> ไรเดอร์ส้มคู่แข่งจะโผล่มาแย่งลูกค้าเป็นพักๆ (จุดสีส้มบนมินิแมพ) วิ่งไปชนแล้วสู้กันแบบผลัดกันเลือกท่า ชนะได้ค่าส่ง+ทิป · ${me.rival ? `ตอนนี้ ${esc(me.rival.name)} อยู่ในเมือง!` : B('🔎 ออกตามหาไรเดอร์ส้ม', { t: 'rbseek' }, 'primary')}</div>` + riderJobs() : ''}`;
    case 'restaurant': {
      const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, `<div class="col2">${B(`กินเลย ${money(it.base)}`, { t: 'act', st, a: 'eat', item: id }, 'good')}${B('🥡 ใส่กระเป๋า', { t: 'act', st, a: 'buy', item: id, qty: 1 })}</div>`, `${eatText(it.eat)} · มีในกระเป๋า ${me.inv[id] || 0}`)).join('');
      const pick = job('rider') ? (() => { const n = (me.jobs || []).filter(j => j.mine && j.state === 'taken').length; return `<div class="jobbox">${B(n ? `🥡 รับอาหาร ${n} ออเดอร์` : 'ยังไม่มีออเดอร์ให้รับ', { t: 'act', st, a: 'pickup' }, 'primary big', !n)}</div>`; })() : '';
      return `<h2>🍜 ร้านอาหาร</h2><div class="sub">${hoursTxt('restaurant')} · <b>ซื้อตุนใส่กระเป๋า</b>ไว้กินทีหลังได้ (กดใช้ในกระเป๋า 🎒) · สั่งให้มาส่งได้ผ่านแอพในมือถือ 📱 · ของราคาถูกอาจทำให้🤢อาหารเป็นพิษ</div>${pick}<div class="list">${rows}</div>`;
    }
    case 'kitchen': {
      const rows = G.recipes.map(r => {
        const out = G.items[r.id]; const ok = Object.entries(r.in).every(([i, q]) => (me.inv[i] || 0) >= q);
        const ing = Object.entries(r.in).map(([i, q]) => `${G.items[i].icon}${q} (มี ${me.inv[i] || 0})`).join(' + ');
        return itemRow(r.id, B(me.cook ? 'กำลังทำ...' : '🔥 รับออเดอร์ ⚡12', { t: 'act', st, a: 'cook', rid: r.id }, ok && !me.cook ? 'good' : '', !ok || !!me.cook), `${ing} · ${cookSteps(r)} · ขาย ~${money(out.base)}`);
      }).join('');
      const ings = [...new Set(G.recipes.flatMap(r => Object.keys(r.in)))].map(i => { const it = G.items[i], c = Math.ceil(it.base * 1.3); return itemRow(i, `<div class="col2">${B(`ซื้อ ${money(c)}`, { t: 'act', st, a: 'buy', item: i, qty: 1 }, '', me.money < c)}${B('x5', { t: 'act', st, a: 'buy', item: i, qty: 5 }, '', me.money < c * 5)}</div>`, `มีในกระเป๋า ${me.inv[i] || 0}`); }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">${hoursTxt('kitchen')} · ใครก็มาทำได้ ไม่ต้องสมัครงาน</div><div class="secT">🔪 งานหั่นผักผลไม้ (ได้ค่าแรง)</div>${jgBox('slice', 'ผักผลไม้ลอยขึ้นมา ปาดนิ้วฟันให้ขาด ฟันทีเดียวหลายลูกได้คอมโบ ระวังระเบิด 💣')}<div class="secT">🍳 ทำอาหาร</div><div class="sub">ปรุงอาหารขายได้แพงกว่าวัตถุดิบหลายเท่า · ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง (ถูกกว่า) หรือซื้อที่ครัวนี้ (แพงกว่า 30%)</div><div class="sub">กดรับออเดอร์ แล้วเดินไป 🧺 ตู้วัตถุดิบ → 🔪 เขียง / 🍳 กระทะ / 🍲 หม้อ / 🔥 เตาย่าง → 🍽️ โต๊ะจัดจาน แล้วกลับมาเสิร์ฟที่เคาน์เตอร์</div><h3>🍳 เมนู</h3><div class="list">${rows}</div><h3>🛒 วัตถุดิบ</h3><div class="list">${ings}</div>`;
    }
    case 'hospital': {
      const dz = me.dz || [], price = dz.length ? 1500 + 500 * (dz.length - 1) : 800, waiting = (wd?.beds || []).filter(Boolean).length;
      const mine = dz.map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, `${G.diseases[d].sym.join(' · ')}<br>${G.diseases[d].self}`, '')).join('');
      const shift = job('doctor') ? `<div class="jobbox ok">🚨 หมอไม่ต้องเข้าเวรแล้ว · ไปที่ <b>ICU</b> (มุมขวาล่างของโรงพยาบาล) รับเคสฉุกเฉิน แล้วลงมือรักษาในห้องจริง ได้ค่ารักษาทุกเคส</div>${B('📍 ไป ICU', { fn: 'guide', key: 'icu' }, 'good')}` : '';
      return `<h2>🏥 โรงพยาบาล</h2><div class="sub">เปิด 24 ชม. · สุขภาพ ${Math.floor(me.health)}/100 · <b>ถูกกว่า:</b> นอนที่ <b>เตียงคนไข้</b> รอหมอรักษา (~฿300) · ตอนนี้มีคนไข้ ${waiting} เตียง</div>${shift}
        ${mine ? `<div class="list">${mine}</div>` : '<div class="sub">✅ ตอนนี้คุณไม่ได้ป่วย</div>'}
        <h3>💊 ร้านขายยา</h3><div class="sub">ซื้อยาให้ตรงกับอาการ แล้วกดใช้ในกระเป๋า 🎒 (ถูกกว่าให้พยาบาลรักษา)</div><div class="list">${Object.entries(G.items).filter(([, it]) => it.pharmacy).map(([id, it]) => itemRow(id, B(`ซื้อ ${money(it.base)}`, { t: 'act', st, a: 'medbuy', item: id }, it.cures?.some(d => dz.includes(d)) ? 'good pulse' : '', me.money < it.base), `${it.cures ? `รักษา <b>${it.cures.map(d => G.diseases[d].icon + G.diseases[d].name).join(', ')}</b>${it.cures.some(d => dz.includes(d)) ? ' ✅ ตรงอาการคุณ' : ''} · ` : ''}${eatText(it.eat)} · มีในกระเป๋า ${me.inv[id] || 0}`)).join('')}</div>
        ${B(`💉 ให้พยาบาล NPC รักษาทันที ${money(price)}${dz.length ? ' (หายทุกโรค)' : ' (❤️ +40)'}`, { t: 'act', st, a: 'heal' }, 'big')}
        ${job('doctor') ? '<div class="sub">🩺 เดินไปที่เตียงที่มีคนไข้ (ทั้งผู้เล่นและชาวเมือง) แล้ววินิจฉัยจากอาการ</div>' : staffHint('doctor')}`;
    }
    case 'bed': {
      const s = STN(st), b = wd?.beds?.[s.idx];
      if (job('doctor') && b && b[1] !== myId) {
        const [name, , sym, hp, n, npc, dn] = b;
        if (dn) return `<h2>🚨 ${esc(name)} หมดสติ!</h2><div class="sub">ต้องช่วยให้ฟื้นก่อน แล้วค่อยวินิจฉัยโรค</div>${B('💓 ปั๊มหัวใจ / ช่วยให้ฟื้น (⚡8)', { t: 'act', st, a: 'revive' }, 'primary big pulse')}`;
        const opts = n ? Object.entries(G.treatments).map(([k, tr]) => B(`${tr.icon} ${tr.name}`, { t: 'act', st, a: 'treat', tx: k }, 'good')).join('') : B('🩺 ตรวจร่างกาย + ให้ยาบำรุง', { t: 'act', st, a: 'treat', tx: 'checkup' }, 'good');
        return `<h2>🛏️ ${esc(name)}${npc ? ' <span class="tag">ชาวเมือง</span>' : ''} · ❤️${hp}</h2>
          <div class="item" style="display:block;font-size:13px"><b>อาการ:</b> ${sym.length ? sym.map(x => esc(x)).join(' · ') : 'ไม่มีอาการป่วย แค่อ่อนแรง'}${n > 1 ? ` <i>(ป่วย ${n} โรค รักษาทีละโรค)</i>` : ''}</div>
          ${n ? '<div class="sub" style="margin:4px 0 0">เลือกการรักษาที่ตรงกับอาการ (⚡8) ถูก = ได้ค่ารักษา · ผิด = คนไข้สุขภาพลด</div>' : ''}<div class="treat">${opts}</div>`;
      }
      if (b && b[1] === myId) return `<h2>🛏️ คุณนอนรอหมออยู่</h2><div class="sub">หมอออนไลน์จะได้รับแจ้งเตือน · เดินออกเพื่อลุกจากเตียง</div>${(me.dz || []).map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, G.diseases[d].sym.join(' · '), '')).join('')}`;
      if (b) return `<h2>🛏️ เตียงนี้มีคนไข้แล้ว</h2><div class="sub">${esc(b[0])} นอนรอหมออยู่</div>`;
      return `<h2>🛏️ เตียงคนไข้</h2><div class="sub">นอนรอให้หมอผู้เล่นมาวินิจฉัยและรักษา (ถูกกว่าเคาน์เตอร์มาก)</div>${B('🛏️ นอนรอหมอ', { t: 'act', st, a: 'lie' }, 'primary big')}`;
    }
    case 'hstair': {
      const s = STN(st), h = wd?.houses?.[s.idx], lv = h?.[8] || 0, to = s.down ? s.fl - 1 : s.fl + 1, mine = me.house === s.idx;
      if (s.down) return `<h2>🪜 ${esc(s.label)}</h2>${B(`⬇️ ลงไปชั้น ${to}`, { t: 'act', st, a: 'go' }, 'primary big')}${mine ? B('🛋️ จัดบ้าน', { fn: 'open', kind: 'homedeco' }) : ''}`;
      const built = to <= 1 + lv;
      return `<h2>🪜 ${esc(s.label)}</h2><div class="sub">บ้านหลังนี้มี ${1 + lv} ชั้น (สูงสุด ${G.shop.floors} ชั้น) · ชั้นใหม่เป็นห้องว่างขนาดเท่าชั้นล่าง จัดวางเฟอร์นิเจอร์ได้ตามใจ</div>
        ${built ? B(`⬆️ ขึ้นไปชั้น ${to}`, { t: 'act', st, a: 'go' }, 'primary big') : mine ? `<div class="jobbox">🏗️ ต่อเติมชั้น ${to}<br><small>สร้างเสร็จทันที · ชั้นบนเป็นของบ้านหลังนี้ (ถ้าขายบ้าน ชั้นที่ต่อเติมจะหายไปด้วย)</small>${B(`🏗️ สร้างชั้น ${to} ${money(G.shop.floorPrice[to])}`, { t: 'act', st, a: 'build' }, 'good big', me.money < G.shop.floorPrice[to])}</div>` : `<div class="sub">🔒 ยังไม่มีชั้น ${to}</div>`}
        ${mine ? B('🛋️ จัดบ้าน', { fn: 'open', kind: 'homedeco' }) : ''}`;
    }
    case 'yzone': {
      const s = STN(st), mine = me.house === s.idx, n = (me.yz || []).length, price = G.yard.price[n];
      if (!mine) return '<h2>🔒 พื้นที่สวน</h2><div class="sub">เฉพาะเจ้าของบ้านเท่านั้นที่ขยายสวนได้</div>';
      return `<h2>🌳 ขยายสวนรอบบ้าน</h2><div class="sub">เปิดพื้นที่ใหม่ ${G.yard.zw}×${G.yard.zh} ช่อง ไว้ปลูกผักและจัดสวน · ตอนนี้มี ${3 + n}/9 ส่วน</div>${B(`🔓 ปลดล็อก ${money(price)}`, { t: 'act', st, a: 'unlock' }, 'primary big', me.money < price)}`;
    }
    case 'yfield': {
      const k = st.slice(3), h = wd?.houses?.[me.house];
      if (near?.house !== me.house || !h) return '<h2>🌱 แปลงผัก</h2><div class="sub">แปลงผักของเจ้าของบ้าน</div>';
      const pl = (h[10] || {})[k], slow = false;
      if (G.shop.furniture[fbase(k)]?.tile) {
        const bed = soilBedOf(h, k), cr = h[10] || {}, empty = bed.filter(o => !cr[o]).length, ripe = bed.filter(o => cr[o] && cr[o][1] <= Date.now() + clockOff).length, dry = bed.filter(o => cr[o] && cr[o][2] === 0 && cr[o][1] > Date.now() + clockOff).length;
        const rows = Object.entries(G.crops).map(([id, c]) => { const sd = Math.ceil(c.seed / 3);
          return itemRow(id, `<div>${B(`1 ช่อง ${money(sd)}`, { t: 'yfarm', k, op: 'plant', crop: id }, '', !!pl)}${B(`ทั้งแปลง ${money(sd * empty)}`, { t: 'yfarm', k, op: 'plant', crop: id, all: 1 }, 'good', !empty)}</div>`, `โต ~${Math.round(c.grow * (slow ? 1.25 : 1) / 60 * 10) / 10} นาที · ช่องละ 1-2 หน่วย · ราคาตลาด ~${money(wd?.mk[id]?.ref || G.items[id].base)}`); }).join('');
        return `<h2>🟫 แปลงดิน ${bed.length} ช่อง</h2><div class="sub">ว่าง ${empty} · กำลังโต ${bed.length - empty - ripe} · สุกแล้ว ${ripe}${pl ? ` · ช่องนี้: ${G.items[pl[0]].icon} <span class="cd" data-t="${pl[1]}"></span>` : ''}</div>
          ${dry ? B(`💧 รดน้ำทั้งแปลง (${dry} ช่อง · ⚡${Math.max(1, Math.ceil(dry / 4))})`, { t: 'yfarm', k, op: 'water', all: 1 }, 'primary big') : ''}
          ${ripe ? B(`🧺 เก็บเกี่ยวทั้งแปลง (${ripe} ช่อง)`, { t: 'yfarm', k, op: 'harvest', all: 1 }, 'primary big') : ''}<div class="sub">💡 ผักที่ไม่ได้รดน้ำโตช้าลงครึ่งหนึ่ง · วาง💦 สปริงเกลอร์ (ร้านเฟอร์นิเจอร์ › สวน) ไว้กลางแปลงแล้วจะรดน้ำรอบตัวให้เองทุกครั้งที่ปลูก · ฝนตกก็รดให้</div><div class="list">${rows}</div>`;
      }
      if (!pl) {
        const rows = Object.entries(G.crops).map(([id, c]) => itemRow(id, B(`ปลูก ${money(c.seed)}`, { t: 'yfarm', k, op: 'plant', crop: id }), `โต ~${Math.round(c.grow * (slow ? 1.25 : 1) / 60 * 10) / 10} นาที · ได้ ${c.min}-${c.max} · ราคาตลาด ~${money(wd?.mk[id]?.ref || G.items[id].base)}`)).join('');
        return `<h2>🌱 แปลงผักในสวน</h2><div class="sub">เลือกพืชที่จะปลูก (⚡5)${slow ? ' · ชาวสวนปลูกโตเร็วกว่า 25%' : ''}</div><div class="list">${rows}</div>`;
      }
      const it = G.items[pl[0]];
      return `<h2>${it.icon} ${esc(it.name)}</h2><div class="sub"><span class="cd" data-t="${pl[1]}"></span></div>${B('🧺 เก็บเกี่ยว (⚡6)', { t: 'yfarm', k, op: 'harvest' }, 'primary big')}`;
    }
    case 'homedeco': {
      if (me.house < 0) return '<h2>🛋️ จัดบ้าน</h2><div class="sub">ต้องมีบ้านของตัวเองก่อน</div>';
      const h = wd?.houses?.[me.house]; if (!h) return '';
      const m0 = P.get(myId), rr = m0 && areaOf(m0.x, m0.y), inHome = rr && (rr.rk === 'house' || rr.yard) && rr.house === me.house;
      const cats = [['basic', '⭐ พื้นฐาน'], ['live', '🛋️ นั่งเล่น'], ['bed', '🛏️ นอน'], ['kitchen', '🍳 ครัว'], ['deco', '🌿 ของแต่ง'], ['fun', '🎮 บันเทิง'], ['wall', '🧱 กั้นห้อง'], ['garden', '🌳 สวน'], ['style', '🟫 พื้น/ผนัง']];
      const own = [...new Set(['sbed', ...(me.furniture || []), ...(me.keep || [])])].filter(k => G.shop.furniture[fbase(k)]);
      const catOf = k => G.shop.furniture[fbase(k)].cat || 'basic';
      const tab = cats.some(c => c[0] === p.dtab) ? p.dtab : (cats.find(c => own.some(k => catOf(k) === c[0]))?.[0] || 'basic');
      const tabs = `<div class="tabs ftabs">${cats.map(([k, l]) => { const n = k === 'style' ? 0 : own.filter(o => catOf(o) === k).length; return B(l + (n ? ` <i class="tcnt">${n}</i>` : ''), { fn: 'qtab', set: { dtab: k } }, tab === k ? 'primary' : ''); }).join('')}</div>`;
      const head = `<h2>🛋️ จัดบ้าน</h2><div class="sub">${inHome ? 'แตะการ์ดเพื่อวางของจากคลัง · หรือกดปุ่มด้านล่างแล้ว<b>แตะของในห้อง</b>เพื่อย้าย' : '⚠️ เข้าไปในบ้านหรือสวนของคุณก่อน แล้วค่อยจัดวาง'} · ระหว่างจัดบ้านพลังงาน/เลือด/ความสุขไม่ลด</div>
        ${B('✋ แตะของในห้องเพื่อย้าย', { fn: 'decoPick' }, 'primary big', !inHome)}${tabs}`;
      if (tab === 'style') {
        const fl = rr?.rk === 'house' ? rr.floor || 1 : 1, cur = houseStyle({ house: me.house, floor: fl });
        const sec = (isF, ids, defs) => ids.map(id => { const d = defs[id], on = cur[isF ? 0 : 1] === id;
          return `<div class="look fcard ${on ? 'on' : ''}">${styleThumb(isF, id)}<small>${esc(d.name)}</small>${on ? '<span class="tag">ใช้อยู่ ✓</span>' : B('ใช้กับชั้นนี้', { t: 'hstyle', fl, [isF ? 'floor' : 'wall']: id }, 'good', rr?.rk !== 'house' || rr.house !== me.house)}</div>`; }).join('');
        const fIds = Object.keys(G.shop.hfloors).filter(id => !G.shop.hfloors[id].price || (me.hfl || []).includes(id)), wIds = Object.keys(G.shop.hwalls).filter(id => !G.shop.hwalls[id].price || (me.hwl || []).includes(id));
        return head + `<div class="sub">${rr?.rk === 'house' && rr.house === me.house ? `กำลังแต่ง <b>ชั้น ${fl}</b> (ไปชั้นอื่นแล้วเปิดเมนูนี้ เพื่อแต่งชั้นนั้น)` : '⚠️ เข้าไปในบ้านก่อน แล้วเลือกพื้น/ผนังให้ชั้นที่ยืนอยู่'} · ซื้อแบบใหม่ได้ที่ร้านเฟอร์นิเจอร์ แท็บ 🟫 พื้น / 🎨 ผนัง</div>
          <div class="secT">🟫 พื้น (${fIds.length})</div><div class="looks">${sec(true, fIds, G.shop.hfloors)}</div><div class="secT">🎨 ผนัง (${wIds.length})</div><div class="looks">${sec(false, wIds, G.shop.hwalls)}</div>`;
      }
      // the same piece bought several times shows once, with how many you have and how many are still in storage
      const groups = new Map(); for (const k of own) if (catOf(k) === tab) { const b = fbase(k); (groups.get(b) || groups.set(b, []).get(b)).push(k); }
      const cards = [...groups].map(([b, ks]) => {
        const f = G.shop.furniture[b], placed = ks.filter(k => furnPos(h, k)), store = ks.filter(k => !furnPos(h, k)), n = ks.length;
        const where = !store.length ? (n > 1 ? `วางครบ ${n} ชิ้น` : placed[0] && furnPos(h, placed[0])[0] === 9 ? 'วางในสวน' : `วางที่ชั้น ${furnPos(h, placed[0])[0]}`) : placed.length ? `วาง ${placed.length} · คลัง ${store.length}` : 'อยู่ในคลัง';
        let btns;
        if (f.tile) btns = B('🟫 วาง', { fn: 'place', k: nextSoil() || store[0] || ks[0] }, 'good', !store.length || !inHome) + (placed.length ? B('📦 เก็บหมด', { fn: 'soilStore' }) : '');
        else btns = (store.length ? B('📍 วาง', { fn: 'place', k: store[0] }, 'good', !inHome) : n === 1 ? B('✋ ย้าย', { fn: 'place', k: ks[0] }, 'good', !inHome) : '')
          + (placed.length && b !== 'sbed' ? B('📦', { t: 'hplace', k: placed[placed.length - 1], store: 1 }) : '')
          + (f.multi && store.length ? B('♻️', { t: 'hplace', k: store[store.length - 1], del: 1 }) : '');
        return `<div class="look fcard dcard ${store.length ? '' : 'on'}"><canvas data-spr="${furnSpr(ks[0])}" width="96" height="80"></canvas>${n > 1 ? `<b class="dcnt">x${n}</b>` : ''}<small>${f.icon} ${esc(f.name)}</small><em>${where}</em><div class="col2">${btns}</div></div>`;
      }).join('');
      return head + `<div class="looks">${cards || '<div class="sub">หมวดนี้ยังไม่มีของ ซื้อได้ที่ 🛋️ ร้านเฟอร์นิเจอร์ในเมือง</div>'}</div>`;
    }
    case 'hbed': {
      const s = STN(st), h = wd?.houses?.[s.idx], own = me.house === s.idx && !(h && h[5]), rent = me.rent && me.rent.idx === s.idx;
      return own || rent ? `<h2>🛏️ เตียงนอน</h2><div class="sub">นอนแล้วได้พลังงาน หายง่วง หายอ่อนเพลีย (ทุก 2 นาที)</div>${B(`😴 นอนพัก (+${50 + (own ? me.comfort * 2 : 0)}⚡)`, { t: 'act', st, a: 'sleep' }, 'primary big')}` : '<h2>🛏️ เตียงนอน</h2><div class="sub">นอนได้เฉพาะเจ้าของบ้านหรือผู้เช่า</div>';
    }
    case 'school': {
      const L = G.licenses;
      const course = (id, what) => {
        const l = L[id], blocked = l.need && !lic(l.need);
        if (lic(id)) return itemRowRaw(l.icon, l.name, 'เรียนจบแล้ว ✓', '<span class="tag">จบแล้ว</span>');
        if (me.enrolled === id) return itemRowRaw('📖', `${l.name} (เรียนแล้ว ${me.classes}/${l.classes} คาบ)`, `<div class="qbar"><i style="width:${(me.classes + (me.study || 0)) / l.classes * 100}%"></i></div>เดินไปนั่งที่ <b>📖 โต๊ะเรียน</b> นั่งครบ 1 ชั่วโมงในเกม = 1 คาบ (เหมือนพนักงานนั่งทำงาน) · ลุกเดินแล้วความคืบหน้าของคาบนั้นยังอยู่`, me.desk >= 0 ? '<span class="tag">กำลังเรียน</span>' : '');
        return itemRowRaw(l.icon, l.name, `ค่าเทอม ${money(l.price)} · เรียน ${l.classes} คาบ · ${what}${blocked ? ` · <span style="color:var(--bad)">ต้องจบ${L[l.need].name}ก่อน</span>` : ''}`, B(`ลงทะเบียน ${money(l.price)}`, { t: 'act', st, a: 'enroll', lic: id }, 'good', blocked || !!me.enrolled));
      };
      const pol = lic('policeExam') ? itemRowRaw('👮', L.policeExam.name, 'สอบผ่านแล้ว ✓', '<span class="tag">ผ่าน</span>')
        : itemRowRaw('👮', 'สอบนายสิบตำรวจ', `ค่าสมัครสอบ ${money(L.policeExam.price)} · ตอบ 3 ข้อ ต้องถูกทุกข้อ · ต้องจบ ม.6`, B('📝 สอบ', { t: 'act', st, a: 'ptest' }, 'good', !lic('hs')));
      const degRow = course('hs', 'ปลดล็อกการเรียนปริญญาตรีและสอบตำรวจ') + course('degree', 'ปลดล็อกงานบริษัท และเรียนต่อแพทย์') + pol;
      const rows = ['medicine'].map(id => {
        const l = L[id], has = lic(id), blocked = l.need && !lic(l.need);
        const c = Object.values(G.careers).find(c => (c.need || []).includes(id));
        return itemRowRaw(l.icon, l.name, `ปลดล็อกอาชีพ ${c.name}${l.need ? ` · ต้องจบ${L[l.need].name}ก่อน` : ''}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(l.price), { t: 'act', st, a: 'learn', lic: id }, 'good', blocked));
      }).join('');
      return `<h2>🎓 มหาวิทยาลัย</h2><div class="sub">${hoursTxt('school')} · ลงทะเบียนที่นี่ แล้ว<b>นั่งเรียนที่โต๊ะเรียน</b>ตามเวลา · สอบใบขับขี่ย้ายไปที่โชว์รูมรถแล้ว</div><div class="list">${degRow}${rows}</div>`;
    }
    case 'pets': case 'petshop': {
      const shopMode = p.kind === 'petshop', have = me.pets || [], ids = Object.keys(G.pets).sort((a, b) => G.pets[a].price - G.pets[b].price);
      const card = id => { const pt = G.pets[id], own = have.includes(id), on = me.pet === id;
        const btn = own ? (!shopMode || on) ? B(on ? '📦 เก็บเข้า' : '🐾 เรียกออกมา', { t: 'pet.call', id: on ? '' : id }, on ? '' : 'good') : '<small>มีแล้ว ✓</small>' : B(money(pt.price), { t: 'act', st: p.st, a: 'buy', pet: id }, 'good', me.money < pt.price);
        const nm = me.pnames?.[id], nameBtn = own && !shopMode ? B(nm ? '✏️ เปลี่ยนชื่อ' : '✏️ ตั้งชื่อ', { fn: 'petName', id }) : '';
        return `<div class="look fcard petcard ${on ? 'on' : ''}"><canvas data-pet="${id}" width="84" height="84"></canvas><small>${nm ? `<b>"${esc(nm)}"</b><br>` : ''}${pt.icon} ${esc(pt.name)}${on ? ' ✓' : ''}</small>${nameBtn}<span class="rtag r${pt.rar}">${G.fishRarity[pt.rar]}</span><em>${esc(pt.desc)}</em>${btn}</div>`; };
      const mine = ids.filter(id => have.includes(id)), shop = ids.filter(id => !have.includes(id));
      const leashRow = shopMode ? itemRowRaw('🦮', 'สายจูงสัตว์เลี้ยง', 'ใส่ให้สัตว์เลี้ยงตัวไหนก็ได้ · ใส่/ถอดได้ในแอพ 🐾 สัตว์เลี้ยง', me.leash ? '<small>มีแล้ว ✓</small>' : B(money(me.leashPrice || 800), { t: 'act', st: p.st, a: 'leash' }, 'good', me.money < (me.leashPrice || 800)))
        : me.leash ? `<div class="setRow"><span><b>🦮 สายจูง</b><small>ใส่แล้วจะเห็นสายจูงจากมือคุณถึงสัตว์เลี้ยง</small></span>${B(me.leashOn ? 'ใส่อยู่ · ถอด' : 'ถอดอยู่ · ใส่', { t: 'pet.leash' }, me.leashOn ? 'good' : '')}</div>` : '<div class="sub">🦮 ซื้อสายจูงได้ที่ร้านสัตว์เลี้ยง</div>';
      if (shopMode) return `<h2>🐾 ${esc(STN(p.st)?.label || 'ร้านสัตว์เลี้ยง')}</h2>${leashRow}<div class="sub">${hoursTxt('petshop')} · รับเลี้ยงแล้วเรียกออกมาเดินตามได้ที่เมนู 🐾 สัตว์เลี้ยง · เลี้ยงได้ทีละ 1 ตัว · มี ${have.length}/${ids.length} ตัว</div>
        <div class="looks">${ids.map(card).join('')}</div>`;
      return `<h2>🐾 สัตว์เลี้ยง</h2><div class="sub">${me.pet ? `ตอนนี้ ${G.pets[me.pet].icon} <b>${esc(G.pets[me.pet].name)}</b> เดินตามคุณอยู่ · แตะที่ตัวมันเพื่อเล่นด้วย` : 'เรียกสัตว์เลี้ยงออกมาเดินตามคุณได้ (รับเลี้ยงเพิ่มที่ร้านสัตว์เลี้ยง 🐾 ถนนเหนือ)'} · เลี้ยงได้ทีละ 1 ตัว</div>
        ${mine.length ? leashRow : ''}
        ${mine.length ? `<div class="secT">💖 สัตว์เลี้ยงของฉัน (${mine.length})</div><div class="looks">${mine.map(card).join('')}</div>` : ''}
        ${mine.length ? '' : '<div class="jobbox">ยังไม่มีสัตว์เลี้ยง · ไปรับเลี้ยงที่ร้านสัตว์เลี้ยง 🐾 (ถนนเหนือ) ได้เลย</div>'}`;
    }
    case 'bag': {
      const CATS = [['all', '📦 ทั้งหมด'], ['use', '🍱 กิน/ใช้'], ['fish', '🐟 ปลา'], ['crop', '🌾 ผลผลิต'], ['goods', '🧺 ของอื่น']];
      const catOf = id => { const it = G.items[id]; return it.eat || it.egg ? 'use' : it.kind === 'fish' ? 'fish' : it.kind === 'crop' ? 'crop' : 'goods'; };
      const ents = Object.entries(me.inv).filter(([id, q]) => G.items[id] && q > 0), gcat = CATS.some(c => c[0] === p.gcat) ? p.gcat : 'all', gtab = ['items', 'wear', 'info'].includes(p.gtab) ? p.gtab : 'items';
      const ord = { use: 0, fish: 1, crop: 2, goods: 3 };
      const shown = ents.filter(([id]) => gcat === 'all' || catOf(id) === gcat).sort((a, b) => ord[catOf(a[0])] - ord[catOf(b[0])] || G.items[b[0]].base * b[1] - G.items[a[0]].base * a[1]);
      const ctabs = `<div class="tabs ftabs">${CATS.map(([k, l]) => { const n = k === 'all' ? ents.length : ents.filter(([id]) => catOf(id) === k).length; return B(l + (n ? ` <i class="tcnt">${n}</i>` : ''), { fn: 'qtab', set: { gcat: k } }, gcat === k ? 'primary' : ''); }).join('')}</div>`;
      const totalV = shown.reduce((s, [id, q]) => s + G.items[id].base * q, 0);
      const gtabs = `<div class="tabs">${[['items', '🎒 ของ'], ['wear', '👕 ชุด'], ['info', '📋 ข้อมูล']].map(([k, l]) => B(l, { fn: 'qtab', set: { gtab: k } }, gtab === k ? 'primary' : '')).join('')}</div>`;
      const rows = shown.map(([id, q]) => { const it = G.items[id]; return itemRow(id, it.egg ? B('🐣 เปิดไข่', { t: 'use', item: id }, 'primary') : it.eat ? B('ใช้', { t: 'use', item: id }, 'good') : '', it.egg ? `x${q} · ฟักออกมาเป็นสัตว์เลี้ยงสุ่ม (ตัวที่ยังไม่มี)` : `x${q} · ~${money(it.base)}${it.eat ? ' · ' + eatText(it.eat) : ''}`); }).join('');
      const licTxt = me.licenses.map(l => G.licenses[l].icon + G.licenses[l].name).join(', ') || 'ไม่มี';
      const tools = Object.entries(me.tools || {}).map(([c, t]) => `${G.shop.tools[c]?.icon || ''}${'★'.repeat(t)}`).join(' ') || '—';
      const home = me.house >= 0 ? `บ้านเลขที่ ${me.house + 1} ⭐${me.comfort}` : me.rent ? `เช่าบ้านเลขที่ ${me.rent.idx + 1}` : 'ยังไม่มี';
      const own = `<div class="grid2" style="margin:6px 0"><div class="item"><div class="nm">🛠️ อุปกรณ์<small>${tools}</small></div></div><div class="item"><div class="nm">🏠 บ้าน<small>${home}</small></div>${me.house >= 0 || me.rent ? B('📍', { fn: 'guide', key: 'door_house' + (me.house >= 0 ? me.house : me.rent.idx) }) : ''}</div><div class="item"><div class="nm">🌾 สวน<small>${me.garden ? `แปลงที่ ${me.garden.lot + 1} · ${me.garden.n} แปลงปลูก` : 'ยังไม่มี'}</small></div>${me.garden ? B('📍', { fn: 'guide', key: 'lot' + me.garden.lot }) : ''}</div><div class="item"><div class="nm">🏦 ธนาคาร<small>${money(me.bank)}${me.loan ? ` · หนี้ ${money(me.loan)}` : ''}</small></div></div><div class="item"><div class="nm">📱 เบอร์ของฉัน<small>${me.phone}</small></div></div></div>`;
      const job = me.career !== 'none' && G.careers[me.career]?.where;
      const outfits = (me.outfits || []).length ? `<div class="looks">${me.outfits.map(id => { const on = me.outfit === id; return `<div class="look ${on ? 'on' : ''}"><canvas data-of="${id}" width="72" height="96"></canvas><small>${esc(ofName(G.outfitDefs[id]) || id)}</small>${B(on ? 'ถอด' : 'ใส่', { fn: 'look', set: { outfit: on ? '' : id } }, on ? '' : 'good')}</div>`; }).join('')}</div>` : '';
      if (gtab === 'items') return `<h2>🎒 กระเป๋า</h2>${gtabs}${ctabs}<div class="sub">${shown.length} อย่าง · มูลค่าประมาณ ${money(totalV)}</div><div class="list">${rows || '<div class="sub">ไม่มีของในหมวดนี้</div>'}</div>`;
      if (gtab === 'info') return `<h2>🎒 กระเป๋า</h2>${gtabs}<div class="sub">ใบรับรอง: ${licTxt} · ทรัพย์สินรวม ${money(me.worth)}</div>${own}`;
      return `<h2>🎒 กระเป๋า</h2>${gtabs}
        <div class="secT">👕 ชุด</div>
        <div class="setRow"><span><b>ซ่อนชุดอาชีพ</b><small>${job ? `ใส่เสื้อผ้าของตัวเองแทนชุด${G.careers[me.career].name}` : 'ตอนนี้ยังไม่มีชุดอาชีพ'}</small></span>${B(me.hideJob ? 'ซ่อนอยู่' : 'แสดงอยู่', { fn: 'look', set: { hideJob: !me.hideJob } }, me.hideJob ? 'good' : '')}</div>
        ${outfits || '<div class="sub">ชุดพิเศษ (รางวัล) จะมาอยู่ตรงนี้ เช่น 🎽 ชุดนักตกปลา (ตกปลาถึงเลเวลสูงสุด) · ชุดแฟชั่นจะมาเพิ่มในอนาคต</div>'}`;
    }
    case 'career': {
      const cur = G.careers[me.career];
      const rows = Object.entries(G.careers).filter(([id]) => id !== 'none').map(([id, c]) => {
        const where = STN(c.where), stf = STAFF.find(x => x.career === id && !x.keeper);
        const miss = (c.need || []).filter(l => !licOk(l)).map(l => G.licenses[l].name + (licExp(l) ? ' (หมดอายุ)' : ''));
        return itemRowRaw(c.icon, `${c.name}${me.career === id ? ' <span class="tag">ปัจจุบัน</span>' : ''}`, `สมัคร: คุยกับ <b>${esc(stf?.short || 'เจ้าหน้าที่')}</b> ที่${where?.label || '-'}${miss.length ? ` · <span style="color:var(--bad)">ต้องมี ${miss.join(', ')}</span>` : ''}<br>${c.desc}`, B('🚶 เดินไปสมัคร', { fn: 'guide', key: stf ? stf.st : c.where }, 'good'));
      }).join('');
      const starter = `<div class="jobbox">💡 <b>เพิ่งเริ่มเล่น ยังไม่มีเงิน?</b> ไปซื้อเบ็ด ${money(G.fishing.rod)} กับน้าเล็กที่สมาคมประมง แล้ว<b>ตกปลาขาย</b> ทำได้ทุกคนทุกเวลาไม่ต้องสมัครงาน ${me.rod ? '' : B('🎣 ไปซื้อเบ็ด', { fn: 'guide', key: 'staff_fishing' }, 'good')}</div>`;
      return `<h2>💼 งานของฉัน</h2>
        <div class="jobbox ${me.career === 'none' ? '' : 'ok'}">${me.career === 'none' ? '🙂 ตอนนี้ยัง<b>ว่างงาน</b> — เดินเข้าไปสมัครงานในอาคารต่างๆ ได้เลย' : `${cur.icon} <b>${cur.name}</b> · Lv.${me.lv}${me.jx && me.career !== 'office' ? `<div class="sub">⭐ EXP ${(+me.jx.cur).toFixed(1)}/${me.jx.need} · ได้ EXP ${me.jx.gain}% ต่อครั้ง (เลเวลยิ่งสูงยิ่งได้น้อย) · รายได้จากงาน +${me.jx.pay}%</div>` : ''}`}
        ${me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ สมัครงานใหม่ได้ในอีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : ''}
        ${me.career !== 'none' ? B('📦 ลาออก', { t: 'resign' }, 'warn') : ''}</div>
        ${starter}<div class="sub" style="margin-top:8px">⏳ เปลี่ยนงานแล้วต้องรอ 5 นาทีถึงจะสมัครงานใหม่ได้ · 🎣 ตกปลา ทำได้ทุกคน ไม่ต้องสมัคร</div><div class="secT">👤 สมัครงาน / เปลี่ยนอาชีพ</div><div class="sub">กด 🚶 แล้วตัวละครจะเดินไปหาเจ้าหน้าที่ให้เอง</div><div class="list">${rows}</div>`;
    }
    case 'toolshop': {
      const order = [me.career, ...Object.keys(G.shop.tools).filter(c => c !== me.career)].filter(c => G.shop.tools[c]);
      const rows = order.map(c => {
        const d = G.shop.tools[c], t = (me.tools || {})[c] || 0, cc = G.careers[c] || { fisher: { icon: '🎣', name: 'ตกปลา (ทุกคน)' }, farmer: { icon: '🌱', name: 'ปลูกผักในสวนบ้าน (ทุกคน)' } }[c] || { icon: '', name: c };
        const sub = t >= 3 ? `สูงสุดแล้ว · ${d.fx[2]}` : `ถัดไป: ${d.fx[t]}${t ? ` · ตอนนี้: ${d.fx[t - 1]}` : ''}`;
        return itemRowRaw(d.icon, `${d.name} <span class="tag">${cc.icon} ${cc.name}</span> <span style="color:var(--acc)">${'★'.repeat(t)}${'☆'.repeat(3 - t)}</span>`, sub,
          t >= 3 ? '<span class="tag">MAX</span>' : B(money(G.shop.toolPrices[t]), { t: 'act', st, a: 'buy', career: c }, c === me.career ? 'good' : ''));
      }).join('');
      return `<h2>🛠️ ร้านอุปกรณ์</h2><div class="sub">${hoursTxt('toolshop')} · อัปเกรดอุปกรณ์ให้หาเงินได้มากขึ้น · อัปได้ 3 ระดับ</div><div class="list">${rows}</div>`;
    }
    case 'dealer': {
      const dl = G.licenses.driving, hasDL = (me.licenses || []).includes('driving'), exp = me.licExp?.driving || 0, leftD = Math.round((exp - Date.now() - clockOff) / G.dayMs * 10) / 10;
      const drive = !hasDL ? itemRowRaw('🪪', 'สอบใบขับขี่', `ค่าสอบ ${money(dl.price)} · ตอบคำถามจราจร 3 ข้อ ต้องถูกทุกข้อ · ต้องต่ออายุทุกปีในเกม (${money(dl.renew)})`, B('📝 สอบ', { t: 'act', st, a: 'dtest' }, 'good'))
        : itemRowRaw('🪪', `ใบขับขี่ ${licExp('driving') ? '<span class="tag" style="background:var(--bad)">หมดอายุ</span>' : ''}`, licExp('driving') ? 'หมดอายุแล้ว — ต่ออายุเพื่อทำงานไรเดอร์ต่อ' : `ใช้ได้อีก ${leftD} วันในเกม (1 ปี = 60 วันในเกม = 1 วันจริง)`, B(`ต่ออายุ ${money(dl.renew)}`, { t: 'act', st, a: 'renew' }, licExp('driving') ? 'primary' : '', !licExp('driving') && leftD > 15));
      const tab = ['car', 'gem'].includes(p.vtab) ? p.vtab : 'moto', lic = (me.licenses || []).includes('driving'), mine = me.vehicles || [];
      const cards = Object.entries(G.shop.vehicles).filter(([k, v]) => (!v.hidden || (me.vehicles || []).includes(k)) && (tab === 'gem' ? !!v.gem : v.kind === tab && !v.gem) && (!v.job || v.job === me.career)).sort((a, b) => (a[1].gem || a[1].price) - (b[1].gem || b[1].price)).map(([key, v]) => {
        const has = mine.includes(key), on = me.ride === key, need = v.license && !lic, cost = v.gem ? `💎${v.gem.toLocaleString()}` : money(v.price), afford = v.gem ? me.gemInf || (me.gems || 0) >= v.gem : me.money >= v.price;
        const btn = has ? `<div class="col2">${B(on ? '✓ ใช้อยู่' : `${v.icon} ขี่`, { t: 'ride', v: key, on: 1 }, on ? 'primary' : 'good', on)}${v.gem ? '' : B(`ขาย ${money(Math.round(v.price * .6))}`, { t: 'act', st, a: 'sell', v: key }, 'warn')}</div>` : v.locked ? B('🔒 เร็วๆ นี้', { t: 'act', st, a: 'buy', v: key }, '', true) : B(need ? '🪪 ต้องมีใบขับขี่' : cost, { t: 'act', st, a: 'buy', v: key }, need ? '' : v.gem ? 'primary' : 'good', need || !afford);
        return `<div class="look fcard vcard ${has ? 'on' : ''}"><canvas class="vfit" data-spr="w_${key}_s" width="150" height="80"></canvas><small>${v.icon} ${esc(v.name)}</small><em>ความเร็ว ×${v.speed}${v.license ? '' : ' · ไม่ต้องมีใบขับขี่'}${v.job ? ' · เฉพาะตำรวจ' : ''}${v.aura ? ' · ✨ออร่า' : ''}${v.fly ? ' · บินข้ามทุกอย่าง' : ''}</em>${btn}</div>`; }).join('');
      return `<h2>🚗 โชว์รูมรถ</h2><div class="sub">${hoursTxt('dealer')} · ขี่/ขับได้ทุกที่นอกอาคาร (เร็วกว่าวิ่ง ไม่เปลืองพลังงาน) · กดปุ่ม 🛵 มุมขวาล่างเพื่อขึ้น/ลงรถ · ขายคืนได้ 60%${lic ? '' : ' · <b>รถส่วนใหญ่ต้องมีใบขับขี่</b> สอบได้ที่นี่เลย'}</div>
        <div class="list" style="margin-bottom:8px">${drive}</div><div class="tabs">${B('🏍️ มอเตอร์ไซค์', { fn: 'qtab', set: { vtab: 'moto' } }, tab === 'moto' ? 'primary' : '')}${B('🚗 รถยนต์', { fn: 'qtab', set: { vtab: 'car' } }, tab === 'car' ? 'primary' : '')}${B('💎 รุ่นพิเศษ', { fn: 'qtab', set: { vtab: 'gem' } }, tab === 'gem' ? 'primary' : '')}</div>${tab === 'gem' ? `<div class="jobbox">💎 คุณมีเพชร <b>${me.gemInf ? '∞ (แอดมิน)' : (me.gems || 0).toLocaleString()}</b> · ได้เพชรจากเข้าเกมทุกวัน (+2, ครบสัปดาห์ +10, ครบ 30 วัน +50) ความสำเร็จ (+5–15 ตามความยาก) และทำเควสต์รายสัปดาห์ครบ (+20) · รุ่นพิเศษมีออร่าเรืองแสงตอนขับ ขายคืนไม่ได้</div>` : ''}<div class="looks">${cards}</div>`;
    }
    case 'garage': {
      const rows = (me.vehicles || []).filter(k => G.shop.vehicles[k]).map(k => { const v = G.shop.vehicles[k], on = me.ride === k;
        return `<div class="look fcard vcard ${on ? 'on' : ''}"><canvas data-spr="w_${k}_s" width="150" height="80"></canvas><small>${v.icon} ${esc(v.name)}</small>${B(on ? '🚶 ลงรถ' : `${v.icon} ขี่`, { t: 'ride', v: k, on: on ? 0 : 1 }, on ? '' : 'good')}</div>`; }).join('');
      return `<h2>🔑 รถของฉัน</h2><div class="sub">เลือกคันที่จะขี่ · ซื้อเพิ่มที่ 🚗 โชว์รูมรถ</div><div class="looks">${rows || '<div class="sub">ยังไม่มีรถ</div>'}</div>`;
    }
    case 'bank': {
      const bk = G.shop.bank, btab = p.btab || 'acct';
      const tabs = `<div class="tabs">${B('💰 บัญชี', { fn: 'qtab', set: { btab: 'acct' } }, btab === 'acct' ? 'primary' : '')}${B('📈 ตลาดหุ้น', { fn: 'qtab', set: { btab: 'stock' } }, btab === 'stock' ? 'primary' : '')}</div>`;
      if (btab === 'stock') return `<h2>🏦 ธนาคาร · ตลาดหุ้น</h2>${tabs}${stockPanel(p, st)}`;
      return `<h2>🏦 ธนาคาร</h2>${tabs}${billsBox()}<div class="sub">${hoursTxt('bank')} · ดอกเบี้ยเงินฝาก <b>${+(bk.rate * 100).toFixed(2)}% ต่อวันเกม</b> (24 นาที · บนยอดไม่เกิน ${money(bk.cap)})</div>
        <div class="grid2"><div class="item"><div class="nm">💵 เงินสด<small><b style="color:var(--acc);font-size:16px">${money(me.money)}</b></small></div></div><div class="item"><div class="nm">🏦 เงินฝาก<small><b style="color:var(--ok);font-size:16px">${money(me.bank)}</b></small></div></div></div>
        <div class="rowf" style="margin-top:10px"><input id="bankAmt" type="number" min="1" value="1000" inputmode="numeric"></div>
        <div class="grid2" style="margin-top:8px">${B('⬇️ ฝาก', { fn: 'bank', st, op: 'deposit' }, 'good')}${B('⬆️ ถอน', { fn: 'bank', st, op: 'withdraw' })}${B('ฝากทั้งหมด', { fn: 'bank', st, op: 'deposit', all: Math.floor(me.money) })}${B('ถอนทั้งหมด', { fn: 'bank', st, op: 'withdraw', all: me.bank })}</div>
        <div class="sub" style="margin-top:14px"><b>💳 กู้เงิน</b> · สูงสุด ${money(bk.loanMax)} ค่าธรรมเนียม ${bk.loanFee * 100}% + ดอกเบี้ย ${bk.loanRate * 100}% ต่อวันเกมบนยอดหนี้ · ระหว่างเป็นหนี้ ${bk.repayShare * 100}% ของรายได้ถูกหักใช้หนี้อัตโนมัติ</div>
        <div class="item"><div class="nm">หนี้คงเหลือ<small><b style="color:${me.loan ? 'var(--bad)' : 'var(--ok)'};font-size:16px">${money(me.loan)}</b></small></div></div>
        <div class="grid2" style="margin-top:6px">${B('💳 กู้ตามจำนวนที่ใส่', { fn: 'bank', st, op: 'borrow' }, 'primary')}${B('✅ ใช้คืนตามจำนวนที่ใส่', { fn: 'bank', st, op: 'repay' }, me.loan ? 'good' : '', !me.loan)}</div>`;
    }
    case 'pier': {
      const s = STN(st) || waterNear; if (!s) return '<div class="sub">เดินไปริมน้ำก่อนนะ</div>';
      const c = me.cast, pool = G.fish[s.pool] || [];
      const here = pool.filter(([id]) => id && G.items[id].rar), got = here.filter(([id]) => me.fishdex?.[id]).length;
      const fishes = `${here.length} ชนิด (ตกได้แล้ว ${got}) ` + [1, 2, 3, 4, 5].map(r => [r, here.filter(([id]) => G.items[id].rar === r).length]).filter(([, n]) => n).map(([r, n]) => `<span class="rtag r${r}">${G.fishRarity[r]} ${n}</span>`).join('') + ' · ดูรายชื่อในแอปสมุดปลาในมือถือ';
      const rod = G.rods[me.rodEq];
      const head = `<h2>🎣 ${esc(s.label)}</h2><div class="sub">${rod ? `ในมือ: ${rod.icon} <b>${esc(rod.name)}</b> (เปลี่ยนได้ที่ร้านน้าเล็ก) · ` : ''}ปลาแถวนี้: ${fishes} · ตกปลา Lv.${me.fishLv}${me.fishLv >= G.fishing.maxLv ? ' (สูงสุด)' : ` (${me.fishXp % G.fishing.xpPerLv}/${G.fishing.xpPerLv})`}</div>`;
      if (!me.rod) return `${head}<div class="jobbox">🎣 ต้องมี<b>เบ็ดตกปลา</b>ก่อน ซื้อได้กับน้าเล็กที่สมาคมประมง (${money(G.fishing.rod)}) · ใครก็ตกปลาได้ ไม่ต้องสมัครงาน${B('📍 ไปซื้อเบ็ด', { fn: 'guide', key: 'staff_fishing' }, 'good big')}</div>`;
      let btn;
      if (!c) btn = B('🎣 เหวี่ยงเบ็ด (⚡8)', { t: 'act', st, a: 'cast' }, 'primary big');
      else if (c.state === 'wait') btn = `<div class="fishHelp" style="font-size:16px;margin:14px 0">⏳ รอปลากินเบ็ด... อย่าเพิ่งดึง!</div>${B('ดึงเบ็ด (เร็วไปปลาหนี)', { t: 'act', st, a: 'reel', pos: -1 }, 'big')}`;
      else btn = `<div class="fishHelp"><b>‼️ ปลากินเบ็ด!</b> กดตอนขีดขาวอยู่ใน<b style="color:var(--ok)">แถบเขียว</b></div><div class="fbar" id="fBar"><div class="zone" id="fZone"></div><div class="mark" id="fMark"></div></div>${B('🎣 ดึง!', { fn: 'reel' }, 'primary big pulse')}`;
      return `${head}${btn}<div class="sub" style="margin-top:8px">ปุ่มใหญ่สีเหลือง (มุมขวาล่าง) ใช้ดึงเบ็ดได้เหมือนกัน · ตกปลาจน Lv.${G.fishing.maxLv} ได้รางวัล 🎽 ชุดนักตกปลา</div>`;
    }
    case 'fishclub': {
      const fish = Object.entries(me.inv).filter(([id, q]) => q > 0 && G.items[id].kind === 'fish');
      const rows = fish.map(([id, q]) => itemRow(id, B(`ขาย ${money((wd?.mk[id]?.farm || 0) * q)}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' }, 'good'), `มี ${q} · รับซื้อ ${money(wd?.mk[id]?.farm || 0)}/ตัว`)).join('');
      return `<h2>🎣 สมาคมประมง · ร้านขายปลา</h2><div class="sub">${hoursTxt('fishclub')} · แหล่งตกปลา: 🏞️ ทะเลสาบ (ใต้เมือง) · 🌊 ทะเล (ฝั่งตะวันออก)</div>
        <div class="jobbox">💬 ซื้อเบ็ด/อัปเกรดเบ็ด คุยกับ <b>น้าเล็ก</b> ที่ยืนอยู่ข้างๆ</div>
        ${fish.length ? `<div class="sub" style="margin-top:10px"><b>รับซื้อปลา</b> (ดีกว่าร้าน NPC ในตลาด แต่ถูกกว่าขายให้ผู้เล่น)</div><div class="list">${rows}</div>` : '<div class="sub">ยังไม่มีปลาในกระเป๋า</div>'}<div class="sub" style="margin-top:10px">📖 ดูสมุดภาพปลาได้ในมือถือ (แอปสมุดปลา)</div>`;
    }
    case 'balloon': {
      const own = me.balloons || [], rows = Object.entries(G.balloons || {}).map(([k, b]) => {
        const has = own.includes(k), on = me.balloon === k;
        const btn = has ? B(on ? '✋ เก็บ' : '🎈 ถือ', { t: 'act', st, a: 'hold', id: on ? '' : k }, on ? '' : 'good') : B(b.gems ? `💎${b.gems}` : money(b.price), { t: 'act', st, a: 'buy', id: k }, 'primary', b.gems ? (me.gems || 0) < b.gems : me.money < b.price);
        return itemRowRaw(`<span style="color:${b.c};font-size:26px">${b.sh === 'h' ? '❤' : b.sh === 's' ? '★' : '●'}</span>`, `${esc(b.name)}${on ? ' <span class="tag">ถืออยู่</span>' : has ? ' <span class="tag">มีแล้ว</span>' : ''}`, b.sh ? 'รูปทรงพิเศษ' : 'ลูกโป่งกลม', btn);
      }).join('');
      return `<h2>🎈 ร้านลูกโป่งลุงโป่ง</h2><div class="sub">ซื้อครั้งเดียวได้ตลอด ถือเดินเล่นให้ทุกคนเห็น · ถือได้ทีละลูก กดเปลี่ยนสีได้ตลอด</div><div class="list">${rows}</div>`;
    }
    case 'staff': {
      const S = STN(st), key = S.career;
      if (key === 'fishing') {
        const outfit = (me.outfits || []).includes('fisher') ? `<div class="jobbox ok">🎽 คุณได้ชุดนักตกปลาแล้ว! ใส่ได้ที่ ⚙️ ตั้งค่า</div>` : `<div class="sub">🏆 ตกปลาจนถึง Lv.${G.fishing.maxLv} ได้รางวัล <b>ชุดนักตกปลา</b></div>`;
        return `<h2>🎣 น้าเล็ก · ร้านเบ็ดสมาคมประมง</h2><div class="sub">ตกปลา Lv.${me.fishLv}/${G.fishing.maxLv} · เบ็ดที่ดีขึ้น = แถบเขียวกว้างขึ้น ขยะน้อยลง ปลาหายากกินเบ็ดบ่อยขึ้น · ซื้อแล้วเก็บในกระเป๋า เปลี่ยนเบ็ดได้ตลอด</div>
          <div class="list">${rodRows(st)}</div>${outfit}
          <div class="sub" style="margin-top:8px">วิธีตก: เดินไปยืน<b>ริมน้ำที่ไหนก็ได้</b> (ทะเลสาบ บ่อน้ำ ชายหาด สะพาน) → กด<b>ปุ่มใหญ่</b>เหวี่ยงเบ็ด → ทุ่นไหวเบาๆ คือปลาแตะเหยื่อ (อย่าเพิ่ง!) <b>ทุ่นจมเมื่อไหร่ กดตวัด</b> → <b>กดค้าง = กรอสาย ปล่อย = ผ่อนสาย</b> สายแดงเมื่อไหร่ต้องผ่อน ไม่งั้นขาด → ปลาหมดแรงเข้าฝั่งแล้ว<b>ยกตอนมันกระโดดโผล่</b> · ทะเลกับน้ำจืดมีปลาคนละชนิด</div>`;
      }
      return `<h2>💬 ${esc(STAFF_AT[st]?.name || 'เจ้าหน้าที่')}</h2>${applyBox(key, st)}`;
    }
    case 'coop':
      return `<h2>🧑‍🌾 สหกรณ์การเกษตร</h2><div class="sub">${hoursTxt('coop')} · เกษตรกรต้องมี<b>สวนของตัวเอง</b> ซื้อได้ที่ป้ายหน้าสวนแต่ละแปลง (${money(G.garden.lotPrice)} ได้ ${G.garden.startPlots} แปลงปลูก ขยายได้ถึง ${G.garden.maxPlots})</div>${staffHint('farmer')}
        ${me.garden ? B('📍 ไปสวนของฉัน', { fn: 'guide', key: 'lot' + me.garden.lot }, 'good big') : ''}`;
    case 'farmbuy': {
      const crops = Object.entries(me.inv).filter(([id, q]) => q > 0 && G.items[id].kind === 'crop');
      const rows = crops.map(([id, q]) => itemRow(id, B(`ขาย ${money((wd?.mk[id]?.farm || 0) * q)}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' }, 'good'), `มี ${q} · รับซื้อ ${money(wd?.mk[id]?.farm || 0)}/หน่วย · ราคาตลาด ~${money(wd?.mk[id]?.ref || 0)}`)).join('');
      return `<h2>⚖️ จุดรับซื้อผลผลิต</h2><div class="sub">${hoursTxt('farmbuy')} · ขายได้ทันทีในไร่ ไม่ต้องเข้าเมือง (วางขายให้ผู้เล่นที่ตลาดกลางได้ราคาดีกว่า)</div><div class="list">${rows || '<div class="sub">ไม่มีพืชผลในกระเป๋า</div>'}</div>`;
    }
    case 'lot': {
      const s = STN(st), lot = wd?.lots?.[s.lot], mine = me.garden && me.garden.lot === s.lot;
      if (mine) {
        const n = me.garden.n, next = G.garden.expand[n];
        return `<h2>🪧 สวนของคุณ (แปลงที่ ${s.lot + 1})</h2><div class="sub">มี ${n}/${G.garden.maxPlots} แปลงปลูก · เดินไปที่แปลงดินเพื่อปลูก/เก็บเกี่ยว</div>
          ${n < G.garden.maxPlots ? B(`🌱 ขยายแปลงปลูกที่ ${n + 1} (${money(next)})`, { t: 'act', st, a: 'expand' }, 'primary big') : '<div class="jobbox ok">ขยายครบแล้ว</div>'}
          <div style="margin-top:14px">${B('ขายสวนคืนสหกรณ์ (ได้คืน 60%)', { t: 'act', st, a: 'sell' }, 'warn')}</div>`;
      }
      if (lot) return `<h2>🪧 สวนของ ${esc(lot[0])}</h2><div class="sub">${lot[1]} แปลงปลูก</div>`;
      return `<h2>🪧 สวนแปลงที่ ${s.lot + 1} ว่าง</h2><div class="sub">ซื้อสวนเป็นของตัวเอง ปลูกได้คนเดียว ไม่มีใครมาเก็บตัดหน้า · เริ่ม ${G.garden.startPlots} แปลงปลูก ขยายได้ถึง ${G.garden.maxPlots}</div>
        ${me.garden ? '<div class="sub" style="color:var(--bad)">คุณมีสวนแล้ว</div>' : ''}${needCareer('farmer')}${B(`🌾 ซื้อสวน ${money(G.garden.lotPrice)}`, { t: 'act', st, a: 'buy' }, 'primary big', !!me.garden || me.career !== 'farmer')}`;
    }
    case 'gplot': {
      const s = STN(st), lot = wd?.lots?.[s.lot], mine = me.garden && me.garden.lot === s.lot;
      if (!mine) return `<h2>🌱 แปลงปลูก</h2><div class="sub">${lot ? `สวนของ ${esc(lot[0])}` : 'สวนนี้ยังไม่มีเจ้าของ — ซื้อได้ที่ป้ายหน้าสวน'}</div>`;
      if (s.n >= me.garden.n) return `<h2>🔒 แปลงปลูกที่ ${s.n + 1}</h2><div class="sub">ยังไม่ได้ขยาย — ขยายที่ป้ายหน้าสวน (${money(G.garden.expand[me.garden.n])})</div>`;
      const pl = me.garden.crops[s.n];
      if (!pl) {
        const rows = Object.entries(G.crops).map(([id, c]) => itemRow(id, B(`ปลูก ${money(c.seed)}`, { t: 'act', st, a: 'plant', crop: id }), `โต ${Math.round(c.grow / 60 * 10) / 10} นาที · ได้ ${c.min}-${c.max} · ราคาตลาด ~${money(wd?.mk[id]?.ref || G.items[id].base)}`)).join('');
        return `<h2>🌱 แปลงปลูกที่ ${s.n + 1}</h2><div class="sub">เลือกพืชที่จะปลูก (⚡5)</div>${needCareer('farmer')}<div class="list">${rows}</div>`;
      }
      const it = G.items[pl[0]];
      return `<h2>${it.icon} ${esc(it.name)}</h2><div class="sub"><span class="cd" data-t="${pl[1]}"></span></div>${B('🧺 เก็บเกี่ยว (⚡6)', { t: 'act', st, a: 'harvest' }, 'primary big')}`;
    }
    case 'estate': {
      const tiers = G.homeTiers || [], styles = G.homeStyles || [], sty = Math.max(0, Math.min(styles.length - 1, p.hstyle ?? me.hown?.style ?? 0));
      const pickStyle = `<div class="sub" style="margin-top:8px"><b>🎨 เลือกแบบบ้าน</b></div><div class="hStyles">${styles.map(([sp, nm], k) => `<button class="look ${k === sty ? 'on' : ''}" data-m='${JSON.stringify({ fn: 'qtab', set: { hstyle: k } })}'><canvas data-spr="${sp}" width="96" height="80"></canvas><small>${esc(nm)}</small></button>`).join('')}</div>`;
      const mineSlot = me.house >= 0, friends = [...P.values()].filter(o => o.id !== myId && !o.npc && (me.contacts || []).some(c => c.n === o.name));
      const visit = friends.length ? `<div class="sub" style="margin-top:10px"><b>👥 ไปเยี่ยมบ้านเพื่อน</b> (เพื่อนต้องบันทึกเบอร์คุณไว้ด้วย)</div><div class="list">${friends.map(o => itemRowRaw('🏡', esc(o.name), 'ออนไลน์อยู่', B('ไปเยี่ยม', { t: 'act', st, a: 'visit', id: o.id }, 'good'))).join('')}</div>` : '';
      if (me.hown) {
        const T = tiers[me.hown.tier || 0];
        return `<h2>🏡 สำนักงานอสังหาฯ</h2><div class="sub">${hoursTxt('estate')} · คุณจิ๋มดูแลบ้านทุกหลังในหมู่บ้าน</div>
          <div class="jobbox ok">${T?.icon || '🏠'} <b>บ้านของคุณ: ${esc(T?.name || 'บ้าน')}</b> · แบบ "${esc(styles[me.hown.style]?.[1] || '')}"<br><small>${mineSlot ? '📍 ตอนนี้ตั้งอยู่ในหมู่บ้านแล้ว' : '⏳ หมู่บ้านเต็มชั่วคราว รอที่ว่างสักครู่'}</small>
          <div class="grid2" style="margin-top:6px">${B('🏠 พาไปบ้านฉัน', { t: 'act', st, a: 'home' }, 'primary', !mineSlot)}${B('💰 ขายบ้านคืน', { fn: 'confirmSell', st }, 'warn')}</div></div>
          ${pickStyle}${B(sty === me.hown.style ? 'แบบปัจจุบัน' : `🎨 เปลี่ยนเป็นแบบนี้ ฿3,000`, { t: 'act', st, a: 'style', style: sty }, 'good', sty === me.hown.style)}${visit}`;
      }
      const cards = tiers.map((T, k) => itemRowRaw(T.icon, `${esc(T.name)} · <b style="color:var(--acc)">${money(T.price)}</b>`, esc(T.desc), B('ซื้อ', { t: 'act', st, a: 'buy', tier: k, style: sty }, 'good', me.money < T.price))).join('');
      return `<h2>🏡 สำนักงานอสังหาฯ</h2><div class="sub">${hoursTxt('estate')} · <b>ทุกคนมีบ้านของตัวเองได้</b> · บ้านของคุณจะไปตั้งในหมู่บ้านตอนที่คุณออนไลน์ (หมู่บ้านคือบ้านของคนที่อยู่ในเกมตอนนั้น)</div>
        ${pickStyle}<div class="sub" style="margin-top:10px"><b>🏠 เลือกขนาดบ้าน</b></div><div class="list">${cards}</div>${visit}`;
    }
    case 'door': return houseDoor(STN(st), st);
    case 'furnshop': {
      const own = !!me.hown, cats = [['basic', '⭐ พื้นฐาน'], ['live', '🛋️ นั่งเล่น'], ['bed', '🛏️ ห้องนอน'], ['kitchen', '🍳 ครัว'], ['deco', '🌿 ของแต่ง'], ['fun', '🎮 บันเทิง'], ['wall', '🧱 กั้นห้อง'], ['garden', '🌳 สวน'], ['hfloor', '🟫 พื้น'], ['hwall', '🎨 ผนัง']];
      const tab = cats.some(c => c[0] === p.ftab) ? p.ftab : 'basic';
      if (tab === 'hfloor' || tab === 'hwall') {
        const fl = tab === 'hfloor', defs = fl ? G.shop.hfloors : G.shop.hwalls, mine = fl ? me.hfl || [] : me.hwl || [];
        const cards = Object.entries(defs).sort((a, b) => a[1].price - b[1].price).map(([id, d]) => { const has = !d.price || mine.includes(id);
          return `<div class="look fcard ${has ? 'on' : ''}">${styleThumb(fl, id)}<small>${esc(d.name)}</small><em>${fl ? 'พื้นทั้งชั้น' : 'วอลเปเปอร์ผนังหลัง'}</em>${has ? `<span class="tag">${d.price ? 'มีแล้ว ✓' : 'ฟรี ✓'}</span>` : B(money(d.price), { t: 'act', st, a: 'buy', [fl ? 'hfloor' : 'hwall']: id }, own ? 'good' : '', !own || me.money < d.price)}</div>`; }).join('');
        return `<h2>🛋️ ร้านเฟอร์นิเจอร์</h2><div class="sub">${hoursTxt('furnshop')} · ${fl ? 'พื้นบ้าน' : 'วอลเปเปอร์'}ซื้อครั้งเดียว ใช้ได้ทุกชั้น · เปลี่ยนได้ที่ 🛋️ จัดบ้าน › แท็บ 🟫 พื้น/ผนัง</div>${own ? '' : '<div class="jobbox">🏡 ต้องมีบ้านของตัวเองก่อน</div>'}
          <div class="tabs ftabs">${cats.map(([k, l]) => B(l, { fn: 'qtab', set: { ftab: k } }, tab === k ? 'primary' : '')).join('')}</div><div class="looks">${cards}</div>`;
      }
      const list = Object.entries(G.shop.furniture).filter(([, f]) => !f.gift && (f.cat || 'basic') === tab).sort((a, b) => a[1].price - b[1].price);
      const cards = list.map(([k, f]) => { const cnt = me.furniture.filter(x => fbase(x) === k).length, has = !f.multi && cnt > 0;
        return `<div class="look fcard ${has ? 'on' : ''}"><canvas data-spr="${furnSpr(k)}" width="96" height="80"></canvas><small>${f.icon} ${esc(f.name)}</small><em>${f.multi ? (cnt ? `มีแล้ว ${cnt} ชิ้น` : f.solid ? 'กั้นทางเดิน' : 'เดินผ่านได้') : f.comfort ? `ความสบาย +${f.comfort}` : 'ของแต่ง'}</em>${has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'buy', item: k }, own ? 'good' : '', !own || me.money < f.price) + (f.multi && f.price * 10 <= 20000 ? B(`x10 ${money(f.price * 10)}`, { t: 'act', st, a: 'buy', item: k, qty: 10 }, '', !own || me.money < f.price * 10) : '')}</div>`; }).join('');
      return `<h2>🛋️ ร้านเฟอร์นิเจอร์</h2><div class="sub">${hoursTxt('furnshop')} · ซื้อแล้วส่งเข้าคลังที่บ้าน จัดวางเองด้วยปุ่ม 🛋️ จัดบ้าน · ความสบายรวมสูงสุด ⭐30${own ? ` · บ้านเลขที่ ${me.house + 1} ความสบาย ⭐ <b>${me.comfort}</b>` : ''}</div>${own ? '' : '<div class="jobbox">🏡 ต้องมีบ้านของตัวเองก่อนถึงจะซื้อเฟอร์นิเจอร์ได้</div>'}
        <div class="tabs ftabs">${cats.map(([k, l]) => B(l, { fn: 'qtab', set: { ftab: k } }, tab === k ? 'primary' : '')).join('')}</div><div class="looks">${cards}</div>`;
    }
    case 'plantshop': {
      const own = !!me.hown, cats = [['garden', '🌳 ต้นไม้ & สวน'], ['indoor', '🪴 ต้นไม้ในบ้าน']];
      const tab = cats.some(c => c[0] === p.ptab) ? p.ptab : 'garden';
      const list = Object.entries(G.shop.furniture).filter(([k, f]) => !f.gift && (tab === 'garden' ? f.cat === 'garden' : G.shop.plantIndoor.includes(k))).sort((a, b) => a[1].price - b[1].price);
      const cards = list.map(([k, f]) => { const cnt = me.furniture.filter(x => fbase(x) === k).length, has = !f.multi && cnt > 0;
        return `<div class="look fcard ${has ? 'on' : ''}"><canvas data-spr="${furnSpr(k)}" width="96" height="80"></canvas><small>${f.icon} ${esc(f.name)}</small><em>${f.multi ? (cnt ? `มีแล้ว ${cnt} ชิ้น` : f.solid ? 'กั้นทางเดิน' : 'เดินผ่านได้') : f.comfort ? `ความสบาย +${f.comfort}` : 'ของแต่ง'}</em>${has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'buy', item: k }, own ? 'good' : '', !own || me.money < f.price) + (f.multi && f.price * 10 <= 20000 ? B(`x10 ${money(f.price * 10)}`, { t: 'act', st, a: 'buy', item: k, qty: 10 }, '', !own || me.money < f.price * 10) : '')}</div>`; }).join('');
      return `<h2>🌳 ร้านต้นไม้</h2><div class="sub">${hoursTxt('flower')} · ต้นไม้ใหญ่ พุ่มไม้ ดอกไม้ และไม้ประดับ ซื้อแล้วส่งเข้าคลังที่บ้าน วางเองด้วยปุ่ม 🛋️ จัดบ้าน · 🌱 อยากปลูกผัก? ซื้อ 🟫 แปลงดิน ที่ร้านเฟอร์นิเจอร์ (แท็บสวน)</div>${own ? '' : '<div class="jobbox">🏡 ต้องมีบ้านของตัวเองก่อนถึงจะซื้อต้นไม้ได้</div>'}
        <div class="tabs ftabs">${cats.map(([k, l]) => B(l, { fn: 'qtab', set: { ptab: k } }, tab === k ? 'primary' : '')).join('')}</div><div class="looks">${cards}</div>`;
    }
    case 'barber':
    case 'fashion': {
      const W = { hair: [], shirt: [], pants: [], ...(me.wardrobe || {}), skin: Object.keys(G.looks.skin || {}) }, lk = { skin: 'warm', ...(me.look || {}) };
      const sec = (cat, title) => `<div class="sub" style="margin-top:10px"><b>${title}</b></div><div class="looks">${Object.entries(G.looks[cat]).map(([id, it]) => {
        const has = W[cat].includes(id), on = lk[cat] === id;
        return `<div class="look ${on ? 'on' : ''}"><canvas data-look="${cat}:${id}" width="72" height="96"></canvas><small>${esc(it.name)}</small>${on ? `<span class="tag">${cat === 'skin' ? 'ใช้อยู่' : 'ใส่อยู่'}</span>` : has ? B(cat === 'skin' ? 'เลือก' : 'ใส่', { t: 'wear', cat, id }, 'good') : B(money(it.price), { t: 'act', st, a: 'buy', cat, id }, '')}</div>`;
      }).join('')}</div>`;
      if (p.kind === 'barber') return `<h2>💈 ร้านทำผม</h2><div class="sub">${hoursTxt('barber')} · ทุกคนเริ่มด้วยผมสีน้ำตาลเหมือนกัน มาย้อมสีผมได้ที่นี่ (ทำผมใหม่แล้วมีความสุขเพิ่ม) · สีที่เคยทำแล้วเปลี่ยนกลับได้ฟรี</div>${sec('hair', '💇 ย้อมสีผม')}${G.looks.skin ? sec('skin', '🎨 สีผิว (เปลี่ยนได้ฟรีตลอด)') : ''}`;
      const ft = 'outfit';   // the shop sells whole outfits only (shirts and trousers are gone)
      return `<h2>👗 ร้านแฟชั่น</h2><div class="sub">${hoursTxt('fashion')} · ขายชุดพิเศษใส่ทั้งตัว แต่งตัวใหม่แล้วมีความสุขเพิ่ม · ชุดที่ซื้อแล้วถอด/ใส่ได้ฟรีตลอด · ย้อมผมที่ร้านทำผม 💈</div>
        ${ft !== 'outfit' ? sec(ft, ft === 'shirt' ? '👕 เสื้อ' : '👖 กางเกง') : `
        <div class="sub" style="margin-top:10px"><b>👗 ชุดพิเศษ</b> · ใส่ทับทั้งตัว (แทนชุดอาชีพด้วย) · ซื้อครั้งเดียว ถอด/ใส่ได้ตลอด</div>${(() => { const CT = [['casual', '👕 ลำลอง'], ['thai', '🇹🇭 ไทย & เทศกาล'], ['costume', '🎭 คอสตูม']], oc = CT.some(c => c[0] === p.oc) ? p.oc : 'casual';
          const ok = ([id, o]) => (o.price || o.gems) && !o.nosale && (!o.g || o.g === me.gender || (me.outfits || []).includes(id));
          const tabs = `<div class="tabs ftabs">${CT.map(([k, l]) => { const n = Object.entries(G.outfitDefs).filter(e => ok(e) && e[1].cat === k).length; return B(`${l} <i class="tcnt">${n}</i>`, { fn: 'qtab', set: { oc: k } }, oc === k ? 'primary' : ''); }).join('')}</div>`;
          const cost = o => o.gems ? 1e12 + o.gems : o.price;
          return tabs + `<div class="looks">${Object.entries(G.outfitDefs).filter(e => ok(e) && e[1].cat === oc).sort(([, x], [, y]) => oc === 'dye' ? (x.base > y.base ? 1 : x.base < y.base ? -1 : x.hue - y.hue) : cost(x) - cost(y)).map(([id, o]) => {
          const has = (me.outfits || []).includes(id), on = me.outfit === id;
          return `<div class="look ${on ? 'on' : ''}"><canvas data-of="${id}" width="72" height="96"></canvas><small>${esc(ofName(o))}</small>${has ? B(on ? 'ถอด' : 'ใส่', { t: 'act', st, a: 'outfit', id }, on ? '' : 'good') : B(o.gems ? `💎${o.gems}` : money(o.price), { t: 'act', st, a: 'outfit', id }, '')}</div>`;
        }).join('')}</div>`; })()}`}`;
    }
    case 'police': return `<h2>👮 สถานีตำรวจ</h2><div class="sub">เปิด 24 ชม. · ตำรวจรับเคสตามจับโจร 🚨 เคสหมาหาย 🐕 เล่นจับผิดภาพหาโจร 🔍 และซ้อมยิงเป้า 🎯 · ได้รถสายตรวจขับฟรี · ต้องจบ ม.6 และสอบนายสิบตำรวจที่มหาวิทยาลัย</div>${staffHint('police')}${job('police') ? dogBox(st) : ''}`;
    case 'square': return `<h2>📋 ศาลาประชาคม</h2><div class="sub">${hoursTxt('square')} · สมัครเป็นขอทานได้ที่นี่ (เงินสด+ฝากไม่เกิน ฿2,000) · หาเงินโดย<b>วิ่งเก็บขยะ</b>ที่ถังขยะ หรือนั่งขอทาน (ปุ่ม 🥣) · มีเงินเกิน ฿2,000 พ้นจากขอทานอัตโนมัติ</div>${staffHint('beggar')}`;
    case 'ride': {
      const S = STN(st), R = G.rides?.[S?.k]; if (!R) return '';
      const mine = P.get(myId), on = mine?.pose === 'fun' && String(mine.fn).startsWith(S.k + ':'), n = ridersOf(S.k).size;
      const g = R.gain, pm = v => `+${Math.round(v * 60)}/นาที`;
      return `<h2>${R.icon} ${esc(R.name)}</h2><div class="sub">${esc(R.desc)} · <b style="color:var(--ok)">เล่นฟรี!</b> ครั้งละ ${R.mins} นาที · ตอนนี้มีคนเล่น ${n}/${R.cap}</div>
        <div class="grid2"><div class="item"><div class="nm">⚡ พลังงาน<small><b style="color:var(--ok)">${pm(g.energy)}</b></small></div></div><div class="item"><div class="nm">❤️ เลือด<small><b style="color:var(--ok)">${pm(g.health)}</b></small></div></div><div class="item"><div class="nm">😊 ความสุข<small><b style="color:var(--ok)">${pm(g.happy)}</b></small></div></div><div class="item"><div class="nm">⏱️ เวลา<small><b>${R.mins} นาที/ตั๋ว</b></small></div></div></div>
        ${on ? B('🚶 ลงจากเครื่องเล่น', { t: 'rideoff' }, 'big') : B(R.price ? `🎟️ ซื้อตั๋ว ${money(R.price)} แล้วเล่นเลย` : '🎉 เล่นเลย (ฟรี)', { t: 'act', st, a: 'play' }, 'primary big', n >= R.cap || me.money < R.price)}
        <div class="sub" style="margin-top:8px">ระหว่างเล่นได้พลังงาน เลือด และความสุขทุกวินาที · เดินออกเมื่อไหร่ก็ลงจากเครื่องเล่น</div>`;
    }
    case 'gate': return `<h2>${STN(st).icon} ${STN(st).label}</h2>${B('เดินทาง', { t: 'act', st, a: 'go' }, 'primary big')}`;
    case 'seat': return `<h2>🪑 ที่นั่ง</h2>${B('นั่งพัก', { t: 'act', st, a: 'sit' }, 'primary big')}`;
    case 'quests': {
      const q = me.quests; if (!q) return '';
      const qtabs = `<div class="tabs">${B('📜 รายวัน', { fn: 'qtab', set: { tab: 'day' } }, p.tab !== 'week' ? 'primary' : '')}${B(`🗓️ รายสัปดาห์${me.wquests ? ` (${me.wquests.list.filter(x => x.done).length}/3)` : ''}`, { fn: 'qtab', set: { tab: 'week' } }, p.tab === 'week' ? 'primary' : '')}${B('🎁 รางวัล', { fn: 'open', kind: 'rewards' })}</div>`;
      if (p.tab === 'week' && me.wquests) {
        const w = me.wquests;
        const wr = w.list.map(x => { const c = x.career ? G.careers[x.career] : null, pc = Math.min(100, x.p / x.n * 100);
          const g = QUEST_GIVER[x.type];
          return `<div class="item qitem ${x.done ? 'done' : ''}"><div class="em">${faceHtml(x.type) || (x.done ? '✅' : x.type === 'dailyall' ? '📜' : c ? c.icon : { earn: '💰', fish: '🎣', eat: '🍛', chat: '💬', sell: '🏪' }[x.type] || '🗓️')}</div><div class="nm">${g ? `<span class="qgiver">${esc(g.name)}</span>` : ''}${x.done ? '✅ ' : ''}${esc(x.text)}<small>${x.p.toLocaleString()}/${x.n.toLocaleString()} · รางวัล <b style="color:var(--acc)">${money(x.reward)}</b>${c && me.career !== x.career ? ` · ต้องเป็น${c.name}` : ''}</small><div class="wbar"><u style="width:${pc}%"></u></div></div>${x.done ? '<span class="tag">สำเร็จ</span>' : ''}</div>`; }).join('');
        return `<h2>🗓️ เควสต์รายสัปดาห์</h2>${qtabs}<div class="sub">เป้าหมายระยะยาว นับจากสิ่งที่ทำทุกวัน (รวมเควสต์รายวัน) · รีเซ็ตทุกวันจันทร์ ในอีก <b class="qcd" data-t="${w.resetAt}"></b></div>
          <div class="list">${wr}</div>
          <div class="item ${w.bonus ? 'done' : ''}" style="margin-top:10px"><div class="em">🏆</div><div class="nm">ทำครบทั้ง 3 ข้อในสัปดาห์นี้<small>โบนัส <b style="color:var(--acc)">${money(w.bonusAmount)}</b> · นับรวมไปปลดล็อกฉายา "นักล่าเควสต์"</small></div>${w.bonus ? '<span class="tag">ได้แล้ว</span>' : ''}</div>`;
      }
      const rows = q.list.map((x, i) => {
        const c = x.career ? G.careers[x.career] : null, wrong = c && me.career !== x.career;
        const icon = x.done ? '✅' : c ? c.icon : { trade: '🤝', chat: '💬', eat: '🍛', sell: '🏪', earn: '💰', sit: '🪑' }[x.type] || '📜';
        const tgt = x.type === 'earn' ? CAREER_TARGET[me.career] : QUEST_TARGET[x.type];
        const btn = x.done ? '<span class="tag">สำเร็จ</span>' : `<div class="col2">${tgt ? B('📍 ไป', { fn: 'guide', key: tgt }, 'good') : ''}${B('🔄', { t: 'quest_reroll', i }, '', q.rerolled)}</div>`;
        const g = QUEST_GIVER[x.type];
        return `<div class="item qitem ${x.done ? 'done' : ''}"><div class="em" ${QUEST_GIVER[x.type] ? `data-m='${JSON.stringify({ fn: 'qtalk', type: x.type })}'` : ''}>${faceHtml(x.type) || icon}</div><div class="nm">${g ? `<span class="qgiver">${esc(g.name)}</span><span class="qsay">“${esc(x.done ? g.thx : g.ask)}”</span>` : ''}${x.done ? '✅ ' : ''}${esc(x.text)}<small>${x.p.toLocaleString()}/${x.n.toLocaleString()} · รางวัล <b style="color:var(--acc)">${money(x.reward)}</b>${wrong ? ` · ต้องเป็น${c.name}` : ''}</small><div class="qbar"><i style="width:${Math.round(x.p / x.n * 100)}%"></i></div></div>${btn}</div>`;
      }).join('');
      return `<h2>📜 เควสต์ประจำวัน</h2>${qtabs}<div class="sub">เควสต์ใหม่ในอีก <b class="qcd" data-t="${q.resetAt}"></b> (เที่ยงคืนเวลาไทย)${q.streak ? ` · 🔥 ทำครบติดต่อกัน ${q.streak} วัน` : ''}</div>
        <div class="list">${rows}</div>
        <div class="item ${q.bonus ? 'done' : ''}" style="margin-top:10px"><div class="em">🏆</div><div class="nm">ทำครบทั้ง 3 ข้อ<small>โบนัส <b style="color:var(--acc)">${money(q.bonusAmount)}</b> · ทำครบติดต่อกันทุกวัน โบนัส +10%/วัน</small></div>${q.bonus ? '<span class="tag">ได้แล้ว</span>' : ''}</div>`;
    }
    case 'achv': return achvPanel();
    case 'rewards': return rewardsPanel();
    case 'ach':
    case 'ledger': return ledgerHtml(p);
    case 'topup': return topupHtml();
    case 'payadmin': return me.admin ? payAdminHtml() : '';
    case 'profile': {
      const ti = G.ach.find(x => x.id === me.title) || (G.lux || []).find(x => x.id === me.title) || (me.title === 'vip' && me.vipT > Date.now() + clockOff ? G.payTitle : null), got = (me.ach || []).length;
      // changing the title or the frame opens its own page with a back button
      if (p.titles) return `<h2>${B('‹ กลับ', { fn: 'titles' })} 🏅 เปลี่ยนฉายา</h2><div class="sub">สีบอกความหายาก: ${[1, 2, 3, 4, 5].map(r => `<span class="rtag r${r}">${RAR[r]}</span>`).join('')}</div>
        <div class="sub">ตั้งฉายาที่ปลดล็อกแล้วให้ลอยบนหัว ทุกคนในเมืองเห็น · ที่ปลดล็อกแล้วอยู่ด้านบน</div>${(() => { const T = G.payTitle; if (!T) return ''; const has = me.vipT > Date.now() + clockOff, on = me.title === T.id; const left = has ? Math.ceil((me.vipT - Date.now() - clockOff) / 86400e3) : 0;
          return `<div class="secT">💖 ฉายาผู้สนับสนุน</div><div class="list"><div class="item ${has ? 'done' : ''}"><div class="em">💖</div><div class="nm">${titleHtml(T.title, T.r)}<span class="rtag r8">${RAR[8]}</span><small>${has ? `เหลืออีก ${left} วัน` : 'ได้จากแพ็กเติมเงิน ฿49 (30 วัน)'}</small></div>${has ? B(on ? 'ใช้อยู่ ✓' : 'ใช้', { t: 'title', id: on ? '' : T.id }, on ? 'primary' : 'good') : G.pay ? B('ดูแพ็ก', { fn: 'openTopup' }) : ''}</div></div>`; })()}<div class="secT">👑 ฉายาเศรษฐี (ซื้อด้วยเงิน)</div><div class="list">${(G.lux || []).map(T => { const has = (me.luxT || []).includes(T.id), on = me.title === T.id;
          return `<div class="item ${has ? 'done' : ''}"><div class="em">👑</div><div class="nm">${titleHtml(T.title, T.r)}<span class="rtag r${T.r}">${RAR[T.r] || ''}</span><small>${has ? 'เป็นเจ้าของแล้ว' : money(T.price)}</small></div>${has ? B(on ? 'ใช้อยู่ ✓' : 'ใช้', { t: 'title', id: on ? '' : T.id }, on ? 'primary' : 'good') : B(`ซื้อ ${money(T.price)}`, { t: 'luxbuy', id: T.id }, '', me.money < T.price)}</div>`; }).join('')}</div>
        <div class="list">${achRows()}</div>${B('‹ กลับไปหน้าข้อมูลผู้เล่น', { fn: 'titles' })}`;
      if (p.frames) return `<h2>${B('‹ กลับ', { fn: 'frames' })} 🖼️ กรอบรูป</h2>${frameRows()}${B('‹ กลับไปหน้าข้อมูลผู้เล่น', { fn: 'frames' })}`;
      const sh = { of: '', pet: '', car: '', ach: [], ...(me.show || {}) }, shCv = { of: sh.of, pet: sh.pet, car: sh.car, g: me.gender, lk: me.look || {} };
      const myAch = G.ach.filter(a => !a.nt && (me.ach || []).includes(a.id)).sort((x, y) => (y.r || 1) - (x.r || 1));
      if (p.showEd) {
        const pick = (on, inner, m) => `<div class="look ${on ? 'on' : ''}">${inner}${B(on ? 'โชว์อยู่ ✓' : 'โชว์', { t: 'show', ...m }, on ? 'primary' : 'good', on)}</div>`;
        const ofs = ['', ...(me.outfits || [])].map(id => pick(sh.of === id, `<canvas data-of="${id}" width="72" height="96"></canvas><small>${id ? esc(ofName(G.outfitDefs[id]) || id) : 'ชุดปกติ'}</small>`, { of: id })).join('');
        const pets = ['', ...(me.pets || []).filter(id => G.pets[id])].map(id => pick(sh.pet === id, id ? `<canvas data-pet="${id}" width="72" height="72"></canvas><small>${G.pets[id].icon} ${esc(me.pnames?.[id] || G.pets[id].name)}</small>` : '<div class="shNone">🚫</div><small>ไม่โชว์</small>', { pet: id })).join('');
        const cars = ['', ...(me.vehicles || []).filter(k => G.shop.vehicles[k])].map(k => pick(sh.car === k, k ? `<canvas class="vfit" data-spr="w_${k}_s" width="110" height="64"></canvas><small>${G.shop.vehicles[k].icon} ${esc(G.shop.vehicles[k].name)}</small>` : '<div class="shNone">🚫</div><small>ไม่โชว์</small>', { car: k })).join('');
        const achs = myAch.map(a => { const on = sh.ach.includes(a.id); return `<div class="item ${on ? 'done' : ''}"><div class="em">🏅</div><div class="nm">${titleHtml(a.title, a.r || 1)}</div>${B(on ? 'โชว์อยู่ ✓' : 'โชว์', { fn: 'showAch', id: a.id }, on ? 'primary' : 'good')}</div>`; }).join('');
        return `<h2>${B('‹ กลับ', { fn: 'showEd' })} ✏️ แก้ไขหน้าโชว์</h2>${showCv(shCv)}
          <div class="secT">👕 ชุด</div><div class="looks">${ofs}</div>
          <div class="secT">🐾 สัตว์เลี้ยง</div><div class="looks">${pets}</div>
          <div class="secT">🚗 รถ</div><div class="looks">${cars}</div>
          <div class="secT">🏅 ความสำเร็จที่โชว์ (${sh.ach.length}/3)</div><div class="list">${achs || '<div class="sub">ยังไม่มีความสำเร็จ</div>'}</div>${B('‹ กลับไปหน้าข้อมูลผู้เล่น', { fn: 'showEd' })}`;
      }
      const top3 = (sh.ach.length ? sh.ach.map(id => myAch.find(a => a.id === id)).filter(Boolean) : myAch).slice(0, 3);
      return `<h2>🪪 ข้อมูลผู้เล่น</h2>
        <div class="prof"><div class="phCol"><span class="phWrap"><img class="ph phZoom" title="แตะเพื่อดูรูปใหญ่" src="${myPic || facePng()}" alt="">${frameHtml(me.frame ?? -1, 124)}</span>${B('🏅 เปลี่ยนฉายา', { fn: 'titles' }, 'good')}${B('🖼️ กรอบรูป', { fn: 'frames' })}</div><div class="pi"><b>${me.admin ? '👑 ' : ''}${esc(me.name)}</b> ${B('✏️ แก้ไขชื่อ 💎10', { fn: 'rename' })}<div>${CAREER_ICON(me.career)} ${G.careers[me.career]?.name || 'ว่างงาน'} · Lv.${me.lv}</div><div>${me.admin ? titleHtml(G.adminTitle || 'นายกเทศมนตรี', 6) : ti ? titleHtml(ti.title, ti.r) : '<small>ยังไม่ได้ตั้งฉายา</small>'}</div>
          <div class="grid2" style="margin-top:6px">${B('🖼️ เปลี่ยนรูปจากอัลบั้ม', { fn: 'photo' }, 'good')}${myPic ? B('ลบรูป', { fn: 'photoDel' }) : ''}</div></div></div>
        ${showCv(shCv)}<div class="showEdBtn">${B('✏️ แก้ไขชุด สัตว์เลี้ยง รถ', { fn: 'showEd' })}</div>
        <div class="item"><div class="nm">💰 ทรัพย์สินรวม<small>${money(me.worth)}</small></div></div>
        <div class="secT">🏅 ความสำเร็จ</div><div class="tchips">${top3.map(a => `<span class="rar${a.r || 1}">🏅 ${esc(a.title)}</span>`).join('') || '<small>ยังไม่มี ลองทำงาน ตกปลา หรือเข้าเกมทุกวัน</small>'}</div>
        <div class="showEdBtn">${B('✏️ เลือกความสำเร็จที่โชว์', { fn: 'showEd' })}</div>`;
    }
    case 'mail': {
      if (!p.read) { p.read = 1; if ((me.mailN || 0) > 0) send({ t: 'mailread' }); }
      const rows = mailList.map(x => `<div class="mailItem ${x.read ? '' : 'new'}"><small>${x.read ? '' : '🆕 '}จาก <b>${esc(x.from)}</b> · ${new Date(x.t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</small><p style="white-space:pre-wrap">${esc(x.text)}</p>${x.gift ? (x.got ? '<div class="sub">✅ รับของขวัญแล้ว</div>' : B(`🎁 รับของขวัญ${x.gift.eggs ? ` 🥚x${x.gift.eggs}` : ''}${x.gift.gems ? ` 💎${x.gift.gems}` : ''}${x.gift.outfit ? ` 🎽 ${ofName(G.outfitDefs[x.gift.outfit])}` : ''}`, { t: 'mailclaim', id: x.id }, 'primary')) : ''}
        <div class="rowf" style="margin-top:4px">${B('↩️ ตอบกลับ', { fn: 'mailReply', to: x.from })}${B('🗑️', { t: 'maildel', id: x.id }, 'warn')}</div></div>`).join('');
      const names = [...new Set([...(me.friends || []).map(f => f.n), ...[...P.values()].filter(x => !x.npc && x.id !== myId).map(x => x.name)])];
      return `<h2>📬 กล่องจดหมาย</h2><div class="sub">ส่งถึงผู้เล่นคนไหนก็ได้ด้วยชื่อตัวละคร แม้เขาจะออฟไลน์ เก็บได้ 50 ฉบับล่าสุด</div>
        <div class="secT">✍️ เขียนจดหมาย</div>
        <input id="mailTo" maxlength="16" list="mailNames" placeholder="ชื่อผู้รับ" value="${esc(p.to || '')}"><datalist id="mailNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <textarea id="mailText" maxlength="500" placeholder="ข้อความ..."></textarea>${B('📨 ส่งจดหมาย', { fn: 'mailSend' }, 'primary big')}${p.sent ? `<div class="jobbox ok">✅ ส่งข้อความแล้ว (ถึง ${esc(p.sent)})</div>` : ''}
        <div class="secT">📥 จดหมายของคุณ (${mailList.length})</div>${rows || '<div class="sub">ยังไม่มีจดหมาย</div>'}`;
    }
    case 'phone': return phonePanel(p);
    case 'rank': {
      const rows = (wd?.lb || []).map((r, i) => itemRowRaw(['🥇', '🥈', '🥉'][i] || `${i + 1}.`, `${esc(r.name)} <span class="tag">${CAREER_ICON(r.c)}</span>${r.on ? ' 🟢' : ''}${r.ti ? ` <small style="display:inline;color:var(--acc)">«${esc(r.ti)}»</small>` : ''}`, '', `<b>${money(r.w)}</b>`)).join('');
      return `<h2>🏆 อันดับเศรษฐี</h2><div class="sub">นับเงินสด + เงินฝาก + ทรัพย์สิน</div><div class="list">${rows}</div>`;
    }
    case 'chat':
      return `<h2>💬 แชท</h2><div class="tabs">${B('💬 รวม', { fn: 'chatTab', tab: 'all' }, chatTab === 'all' ? 'primary' : '')}${B('🌐 แชทโลก', { fn: 'chatTab', tab: 'world' }, chatTab === 'world' ? 'primary' : '')}${B('👥 คนใกล้ๆ', { fn: 'chatTab', tab: 'near' }, chatTab === 'near' ? 'primary' : '')}</div>
        <div class="sub">${chatTab === 'all' ? 'แชทโลก + คนใกล้ๆ รวมกัน (ไม่มีข้อความระบบ) · พิมพ์ที่นี่ = ส่งเข้าแชทโลก' : chatTab === 'world' ? 'ทุกคนในเมืองอ่านได้ ไม่ขึ้นบนหัว (ส่งได้ทุก 3 วินาที)' : 'ข้อความจะลอยเป็นบับเบิ้ลบนหัว เฉพาะคนที่อยู่ใกล้คุณ (~14 ช่อง) เท่านั้นที่เห็น'}</div><div id="chatMsgs">${chatHtml()}</div><form id="chatForm" class="rowf"><input id="chatIn" maxlength="120" placeholder="${chatTab === 'world' || chatTab === 'all' ? 'พิมพ์ถึงทุกคน...' : 'พิมพ์ข้อความ...'}" autocomplete="off"><button class="primary" type="submit">ส่ง</button></form>`;
    case 'screen': {
      const fsOn = !!document.fullscreenElement, canFs = !!document.documentElement.requestFullscreen;
      return `<h2>⛶ หน้าจอ</h2><div class="sub">${canFs ? 'เต็มจอซ่อนแถบเบราว์เซอร์ · แนวนอนจะล็อกจอให้เป็นแนวนอน (มือถือ Android)' : 'iPhone/iPad ใช้เต็มจอจากเบราว์เซอร์ไม่ได้: กดปุ่มแชร์ ⬆️ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดเกมจากไอคอนจะเต็มจอ · หมุนเครื่องเป็นแนวนอนได้เลย'}</div>
        <div class="grid2">${B(fsOn ? '↙️ ออกจากเต็มจอ' : '⛶ เต็มจอ', { fn: 'fs', mode: fsOn ? 'exit' : 'full' }, fsOn ? '' : 'primary', !canFs)}${B('🔄 เต็มจอ + แนวนอน', { fn: 'fs', mode: 'landscape' }, 'good', !canFs)}</div>
        ${fsOn ? B('📱 แนวตั้ง (ปลดล็อกการหมุน)', { fn: 'fs', mode: 'free' }, 'big') : ''}`;
    }
    case 'keys': {
      const K = (k, d) => `<div class="keyRow"><span>${k.split(' ').map(x => `<kbd>${x}</kbd>`).join('')}</span><em>${d}</em></div>`;
      return `<h2>⌨️ เล่นบนคอม</h2><div class="sub">ใช้ได้ทั้งคีย์บอร์ดและเมาส์ · กด <kbd>H</kbd> เพื่อเปิดหน้านี้อีกครั้ง</div><div class="keyGrid">
        ${K('W A S D', 'เดิน (หรือปุ่มลูกศร)')}${K('Shift', 'กดค้างเพื่อวิ่ง')}${K('E Space', 'ใช้งาน / เข้าอาคาร / ดึงเบ็ด')}${K('F', 'คุยกับคนใกล้ๆ')}
        ${K('R', 'นั่งพัก')}${K('Enter T', 'พิมพ์แชท')}${K('B I', 'กระเป๋า')}${K('P', 'มือถือ')}
        ${K('M', 'แผนที่')}${K('Q', 'เควสต์')}${K('Esc', 'ปิดหน้าต่าง')}${K('H', 'คีย์ลัด (หน้านี้)')}
        ${K('🖱️คลิก', 'คลิกพื้นเพื่อเดินไปตรงนั้น · คลิกคนเพื่อดูข้อมูล')}${K('🖱️กดค้าง', 'เดินตามเมาส์')}${K('🖱️ล้อ', 'ซูมเข้า/ออก')}</div>`;
    }
    case 'help':
      return `<h2>❔ วิธีเล่น</h2><div class="sub" style="font-size:14px;line-height:1.7">
        👣 <b>เดิน</b>: มือถือแตะค้างแล้วลาก · เปิด 🗺️ แผนที่แล้ว<b>แตะสถานที่</b> ตัวละครจะเดินไปเอง (มีเส้นนำทาง) · แตะตัวคนอื่นเพื่อดูข้อมูล · คอม WASD/ลูกศร<br>
        🟡 <b>ปุ่มใหญ่ขวาล่าง</b>: แตะ = เข้าอาคาร/ใช้งาน/ดึงเบ็ด (คอม: E) · <b>กดค้าง = วิ่ง</b> (คอม: Shift) · ออกจากอาคารแค่เดินลงไปที่พรมหน้าประตู · 💬 <b>คุย</b> กับคนใกล้ๆ (F) · 😌 <b>พัก</b> (R) · 😀 อิโมจิบนหัว<br>
        💰 <b>เริ่มต้นไม่มีเงิน?</b> ซื้อเบ็ดที่สมาคมประมงแล้ว<b>ตกปลาขาย</b> · ทุ่นจมแล้วกดตวัด เย่อปลาเข้าฝั่ง แล้วยกตอนมันโผล่<br>
        💼 <b>หางาน</b>: คุยกับ NPC เจ้าหน้าที่ (💬) ที่ยืนข้างเคาน์เตอร์ของแต่ละที่ · เปลี่ยนงานแล้วรอ 5 นาที<br>
        🎓 <b>เรียน</b>: ลงทะเบียนที่มหาวิทยาลัย แล้วนั่งที่โต๊ะเรียน 1 ชั่วโมงในเกม = 1 คาบ · ใบขับขี่ต้องต่ออายุทุกปี<br>
        🕐 <b>เวลา</b>: 1 วันในเกม = 24 นาที (กลางคืน 19:00–07:00 ผ่านไปใน 3 นาที) · ร้านต่างๆ มีเวลาเปิด-ปิด<br>
        😌 <b>พัก</b>: นั่งพักหลับตาแก้ง่วง · พลังงาน/เลือดคืนได้ที่ 🎡 สวนสนุก หรือ 🛏️ เตียงในบ้าน<br>
        ❤️ <b>สุขภาพ</b>: หิวนานเลือดลด · ป่วยต้องหาหมอ · แตะแถบสถานะเพื่อดูวิธีเพิ่ม<br>
        🍱 <b>ตุนอาหาร</b>: ซื้อใส่กระเป๋าที่ร้านอาหาร แล้วกด "ใช้" ในกระเป๋าตอนหิว<br>
        👥 <b>เพื่อน</b>: คุยกับคนอื่นแล้ว "📱 ขอเบอร์" (ปฏิเสธ 2 ครั้ง ต้องรอ 10 นาที) · ดูเพื่อนที่ออนไลน์ที่เมนู 👥<br>
        💤 ไม่ได้แตะจอ 2 นาที จะขึ้นว่า "ไม่อยู่"</div>
        <div class="grid2" style="margin-top:8px">${B('📖 ดูบทช่วยสอน', { fn: 'tut' })}${B('🗺️ เปิดแผนที่', { fn: 'map' })}</div>`;
    case 'player': {
      const o = P.get(p.pid); if (!o) return '';
      const m = P.get(myId), d = Math.hypot(o.x - m.x, o.y - m.y), far = d > 5.5;
      if (o.npc) {
        if (o.wk && o.desc) return `<h2>${esc(o.name)} <span class="tag">NPC</span></h2><div class="sub">${esc(o.desc)}</div>`;
        if (o.wk) return `<h2>${CAREER_ICON(o.c)} ${esc(o.name)} <span class="tag">NPC</span></h2><div class="sub">ทำงาน${G.careers[o.c]?.name || ''}แทน เพราะตอนนี้ไม่มีผู้เล่นทำงานนี้ออนไลน์${o.c === 'police' ? ' · สายตรวจจะวิ่งไล่จับคนที่ถูกแจ้งความ' : ''}</div>`;
        return `<h2>🏘️ ${esc(o.name)} <span class="tag">ชาวเมือง</span></h2><div class="sub">ชาวบ้านที่เดินไปมาในเมือง ทักทายกันได้ในแชท</div>`;
      }
      const fee = `<input id="feeIn" type="number" value="200" min="0" max="1000" style="width:90px">`;
      const known = (me.contacts || []).some(c => c.n === o.name);
      const inf = infoCache.get(o.id);
      const prof = `<div class="prof"><span class="phWrap"><img class="ph phZoom" title="แตะเพื่อดูรูปใหญ่" src="${inf?.pic || `assets/ui/face_${o.g === 'f' ? 'f' : 'm'}.png`}" alt="">${frameHtml(inf?.fr ?? -1, 124)}</span><div class="pi">
        <div>${CAREER_ICON(o.c)} ${G.careers[o.c]?.name || 'ว่างงาน'} · Lv.${o.lv || 1}</div><div>${titleHtml(o.title, o.tr)}</div>
        ${inf ? `<small>💰 ${money(inf.worth)} · 🎣 Lv.${inf.fishLv} · อยู่ในเมือง ${inf.days} วัน${inf.home ? ` · 🏠 บ้าน #${inf.home}` : ''}${inf.degree ? ' · 🎓' : ''}${inf.phone ? ` · 📱 ${inf.phone}` : ''}</small>` : '<small>กำลังโหลด...</small>'}</div></div>
        ${inf?.sh ? showCv(inf.sh) : ''}${inf?.ach?.length ? `<div class="tchips">${inf.ach.slice(0, 3).map(([t, r]) => `<span class="rar${r}">🏅 ${esc(t)}</span>`).join('')}</div>` : ''}`;
      return `<h2>${o.adm ? '👑 ' : ''}${esc(o.name)}${o.afk ? ' <span class="tag">💤 ไม่อยู่</span>' : ''}</h2>${prof}
        <div class="grid2" style="margin-bottom:6px">${B('✉️ ส่งจดหมาย', { fn: 'open', kind: 'mail', set: { to: o.name } })}</div>
        <div class="sub">${far ? '⚠️ อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน' : 'อยู่ใกล้พอที่จะติดต่อกันได้'}</div>
        <div class="grid2">${B('🤝 แลกเปลี่ยน', { fn: 'tradeReq', to: o.id }, 'primary', far)}${B(known ? '📇 มีเบอร์แล้ว' : '📱 ขอเบอร์', { t: 'req', kind: 'phone', to: o.id }, 'good', far || known)}</div>
        ${o.veh && G.shop.vehicles[o.veh] && G.shop.vehicles[o.veh].kind !== 'heli' && o.veh !== 'escoot' ? `<div class="jobbox">${G.shop.vehicles[o.veh].kind === 'moto' ? '🛵' : '🚗'} ${esc(o.name)} กำลังขี่${esc(G.shop.vehicles[o.veh].name)}${B(me.pass === o.id ? '🚶 ลงรถ' : G.shop.vehicles[o.veh].kind === 'moto' ? '🛵 ขอซ้อนท้าย' : '🚗 ขอขึ้นรถ', me.pass === o.id ? { t: 'hopoff' } : { t: 'req', kind: 'hop', to: o.id }, 'good', far && me.pass !== o.id)}</div>` : ''}
        ${job('doctor') ? `<div class="rowf" style="margin-top:8px">ค่ารักษา ${fee} ${B('💉 เสนอปฐมพยาบาล', { fn: 'heal', to: o.id }, 'good', far)}</div>` : ''}
        ${o.c === 'monk' ? `<div class="jobbox">🙏 ใส่บาตรพระ · เลือกอาหารในกระเป๋า ได้บุญ ความสุขเพิ่ม และได้รับพร 10 นาที<div class="rowf" style="margin-top:6px;flex-wrap:wrap;gap:4px">${Object.entries(me.inv).filter(([id, q]) => q > 0 && G.items[id]?.eat?.hunger > 0).slice(0, 6).map(([id]) => B(`${G.items[id].icon} ${G.items[id].name}`, { t: 'alms_give', to: o.id, item: id }, 'good', far)).join('') || '<small>ไม่มีอาหารในกระเป๋า · ซื้อข้าวต้มมัด/ขนมไทยที่ร้านค้าวัดได้</small>'}</div></div>` : ''}
        ${o.c === 'beggar' ? `<div class="jobbox">🥣 ขอทาน · บริจาคแล้วอิ่มบุญ ความสุขเพิ่ม<div class="rowf" style="margin-top:6px"><input id="donIn" type="number" value="20" min="1" style="width:90px"> ${B('🙏 บริจาค', { fn: 'donate', to: o.id }, 'good', far)}</div></div>` : ''}`;
    }
    case 'gang': return gangPanel(p);
    case 'mayor': return mayorPanel();
    case 'ideas': return ideasPanel(p);
    case 'lotto': return lottoPanel();
    case 'invite': return invitePanel();
    case 'friends': {
      const fr = (me.friends || []).slice().sort((a, b) => (b.fav || 0) - (a.fav || 0) || b.on - a.on);
      const rows = fr.map(f => itemRowRaw(f.on ? (f.afk ? '🌙' : '🟢') : '⚪', `${f.fav ? '⭐ ' : ''}${esc(f.n)}`, f.on ? `${f.afk ? 'ไม่อยู่หน้าจอ · ' : 'ออนไลน์ · '}${esc(f.where)}` : 'ออฟไลน์', f.on ? `<div class="col2">${B('📞 โทร', { t: 'call', phone: f.p }, 'good', !!call)}${f.home === 1 ? B('🏡 ไปเที่ยวบ้าน', { t: 'visit', p: f.p }) : f.home === 2 ? '<small>มีบ้าน · เขายังไม่ได้บันทึกเบอร์คุณ</small>' : ''}</div>` : '')).join('');
      const others = [...P.values()].filter(x => !x.npc && x.id !== myId && !fr.some(f => f.n === x.name));
      const orow = others.map(x => itemRowRaw(x.afk ? '🌙' : '🟢', `${x.adm ? '👑 ' : ''}${esc(x.name)} <span class="tag">${CAREER_ICON(x.c)} ${G.careers[x.c]?.name || ''}</span>`, `${AREA[areaOf(x.x, x.y)?.id]?.name || areaOf(x.x, x.y)?.label || ''}${x.afk ? ' · ไม่อยู่หน้าจอ' : ''}`, '')).join('');
      const onN = fr.filter(f => f.on).length;
      return `<h2>👥 เพื่อน</h2><div class="sub">เพื่อนออนไลน์ ${onN}/${fr.length} คน · เพิ่มเพื่อนได้โดยกด 💬 คุย กับเขาแล้ว "📱 ขอเบอร์"</div>
        <div class="list">${rows || '<div class="sub">ยังไม่มีเพื่อนในรายชื่อ</div>'}</div>
        <div class="secT">🌐 ผู้เล่นอื่นที่ออนไลน์ตอนนี้ (${others.length})</div><div class="list">${orow || '<div class="sub">ไม่มี</div>'}</div>`;
    }
    case 'bug':
      return `<h2>🐞 แจ้งบัค / ปัญหา</h2><div class="sub">เล่าว่าเกิดอะไรขึ้น ทำอะไรอยู่ตอนนั้น (ระบบจะแนบตำแหน่งและรุ่นเครื่องให้อัตโนมัติ)</div>
        <textarea id="bugIn" maxlength="600" placeholder="เช่น เดินเข้าโรงพยาบาลแล้วตัวละครติดผนัง..."></textarea>${B('📨 ส่งรายงาน', { fn: 'bug' }, 'primary big')}`;
    case 'god': {
      if (!me.admin) return '';
      const g = me.god || {};
      const bl = bugList ? (bugList.length ? bugList.map(b => `<div class="bugItem">${esc(b.text)}<small>${esc(b.by)} · ${esc(b.where)} · ${new Date(b.t).toLocaleString('th-TH')}${b.st ? `<br><code style="font-size:10px;opacity:.7">${esc(b.st)}</code>` : ''}</small>${b.done ? '<small style="color:var(--ok)">✅ แจ้งผู้เล่นแล้ว</small>' : B('✅ ตอบกลับว่าแก้แล้ว', { fn: 'bugReply', bt: b.t, login: b.login || '' }, 'good')}</div>`).join('') : '<div class="sub">ไม่มีรายงานบัค</div>') : '';
      return `<h2>👑 God mode</h2><div class="sub">เฉพาะแอดมิน · ปกติเล่นด้วยค่าสเตตัสธรรมดา</div>
        <div class="setRow"><span><b>♾️ เงิน/เพชรไม่จำกัด</b><small>เปิดอยู่ = ซื้อได้ทุกอย่าง ปิด = กลับไปใช้เงินจริงของคุณ</small></span>${B(me.monInf ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'inf' }, me.monInf ? 'good' : '')}</div>
        <div class="secT">💰 ปรับเงินตัวเอง${me.monInf ? ' <small>(ปิดเงินไม่จำกัดก่อนจึงลด/ตั้งได้)</small>' : ''}</div><div class="rowf"><input id="godMoney" type="number" inputmode="numeric" min="0" placeholder="จำนวนเงิน เช่น 1000000"></div><div class="grid2">${B('➕ เพิ่ม', { fn: 'godMoney' }, 'primary')}${B('➖ ลด', { fn: 'godMoney', op: 'submoney' }, '', !!me.monInf)}${B('🎯 ตั้งเป็นจำนวนนี้', { fn: 'godMoney', op: 'setmoney' }, '', !!me.monInf)}</div>
        <div class="secT">💎 เติมเงินจริง</div>${B('💎 ดูรายการเติมเงิน / ยอดขาย', { fn: 'openPayAdmin' }, 'primary')}
        <div class="secT">🔎 ค้นหาผู้เล่น</div><div class="rowf"><input id="godFind" maxlength="20" placeholder="ไอดี / ชื่อในเกม / เบอร์">${B('ค้นหา', { fn: 'godFind' }, 'primary')}</div>${godFindHtml()}
        <div class="secT">✏️ เปลี่ยนชื่อตัวเอง</div><div class="rowf"><input id="godName" maxlength="16" placeholder="ชื่อใหม่ 2–16 ตัว" value="${esc(me.name || '')}">${B('บันทึก', { fn: 'godName' }, 'good')}</div>
        <div class="setRow"><span><b>💼 ทำงานได้ทุกอาชีพ</b><small>ปิดแล้วจะทำได้เฉพาะงานของอาชีพตัวเองเหมือนผู้เล่นทั่วไป</small></span>${B(g.alljobs !== false ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'alljobs' }, g.alljobs !== false ? 'good' : '')}</div>
        <div class="setRow"><span><b>🏅 ฉายา «${esc(G.adminTitle || 'นายกเทศมนตรี')}»</b><small>ปิดแล้วบนหัวจะขึ้นฉายาจากความสำเร็จที่เลือกไว้แทน</small></span>${B(!g.notitle ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'notitle' }, !g.notitle ? 'good' : '')}</div>
        <div class="setRow"><span><b>🌧️ ให้ฝนตก</b><small>ฝนตก 4 นาที (ทดสอบร่ม/พืช) กดอีกครั้งเพื่อหยุด</small></span>${B(wd?.ev?.id === 'rain' ? 'หยุด' : 'เริ่ม', { fn: 'god', op: 'rain' }, wd?.ev?.id === 'rain' ? 'bad' : '')}</div>
        <div class="setRow"><span><b>📣 โพสต์ข่าวลงเฟส</b><small>ได้ข้อความอัปเดตพร้อมลิงก์เกม ไปวางในกลุ่มเฟสได้เลย</small></span>${B('📋 เปิด', { fn: 'open', kind: 'fbpost' }, 'primary')}</div>
        <div class="setRow"><span><b>🐺 ทดสอบคืนหมาป่า</b><small>เริ่มเลยตอนนี้ (เตือน 10 วิ · ยาว 2.5 นาที) กดอีกครั้งเพื่อหยุด</small></span>${B(WW.ph !== 'off' ? 'หยุด' : 'เริ่ม', { fn: 'god', op: 'werewolf' }, WW.ph !== 'off' ? 'bad' : '')}</div>
        <div class="setRow"><span><b>🧟 ทดสอบคืนปล่อยผี</b><small>เริ่มเลยตอนนี้ (เตือน 15 วิ · ยาว 2.5 นาที) กดอีกครั้งเพื่อหยุด</small></span>${B(ZN.ph !== 'off' ? 'หยุด' : 'เริ่ม', { fn: 'god', op: 'zombie' }, ZN.ph !== 'off' ? 'bad' : '')}</div>
        <div class="setRow"><span><b>⚡ ไม่มีคูลดาวน์</b><small>ทุกอย่างไม่ต้องรอ (เปลี่ยนงาน ตกปลา ฯลฯ)</small></span>${B(g.nocd ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'nocd' }, g.nocd ? 'good' : '')}</div>
        <div class="setRow"><span><b>🛡️ ล็อกสเตตัสเต็ม</b><small>ไม่หิว ไม่ป่วย ไม่หมดสติ</small></span>${B(g.lock ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'lock' }, g.lock ? 'good' : '')}</div>
        <div class="setRow"><span><b>🏃 ความเร็ว x<span id="godSpdV">${(g.speed || 1).toFixed(1)}</span></b><small>เลื่อนปรับได้ 1–5 เท่า (กดค้างปุ่มวิ่งได้อีก)</small></span><input id="godSpd" type="range" min="1" max="5" step="0.5" value="${g.speed || 1}" style="width:130px"></div>
        <div class="setRow"><span><b>✨ วาร์ป</b><small>เปิดแล้วกด 🗺️ แผนที่ แตะตรงไหนก็วาร์ปไปที่นั่น</small></span>${B(g.warp ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'warp' }, g.warp ? 'good' : '')}</div>
        ${g.warp ? B('🗺️ เปิดแผนที่เพื่อวาร์ป', { fn: 'map' }, 'primary big') : ''}
        <div class="setRow"><span><b>🌑 ชุดคลุมแอดมิน + ออร่า</b><small>ชุดเฉพาะแอดมิน ไม่มีขาย · ทุกคนเห็นออร่ารอบตัว</small></span>${B(g.cloak ? 'ใส่อยู่' : 'ซ่อนอยู่', { fn: 'god', op: 'cloak' }, g.cloak ? 'good' : '')}</div>
        <div class="setRow"><span><b>🚪 เข้าได้ทุกอาคาร</b><small>แม้ร้านปิด ปิดปรับปรุง หรือบ้านของคนอื่น · ไม่โดนไล่ออกตอนร้านปิด</small></span>${B(g.doors ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'doors' }, g.doors ? 'good' : '')}</div>
        <div class="setRow"><span><b>🏷️ ซ่อนสีชื่อแอดมินบนหัว</b><small>ป้ายชื่อบนหัวเป็นแบบธรรมดา ไม่มีสีรุ้ง/มงกุฎ (คนอื่นก็เห็นแบบนี้) · ชื่อในแชทยังเป็นสีพิเศษ</small></span>${B(g.plain ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'plain' }, g.plain ? 'primary' : '')}</div>
        <div class="setRow"><span><b>👻 ล่องหน</b><small>คนอื่นมองไม่เห็นตัว ไม่ขึ้นในแผนที่/รายชื่อออนไลน์ (แชทใกล้ๆ ยังเห็นข้อความ)</small></span>${B(g.invis ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'invis' }, g.invis ? 'good' : '')}</div>
        <div class="grid2">${B('💯 สเตตัสเต็ม', { fn: 'god', op: 'fill' }, 'primary')}${B('💰 เงิน 999,999', { fn: 'god', op: 'money' }, 'primary')}</div><div class="grid2" style="margin-top:6px">${B('💎 เพชร +1,000', { fn: 'god', op: 'gems' }, 'primary')}</div>
        <div class="secT">🐞 รายงานบัคจากผู้เล่น</div><div class="grid2">${B('📥 โหลดรายงาน', { fn: 'god', op: 'bugs' })}${B('🗑️ ล้างทั้งหมด', { fn: 'god', op: 'bugclear' }, 'warn', !bugList?.length)}</div>${bl}`;
    }
    case 'more': {                                   // everything that is not an everyday button
      const tile = (kind, icon, label, sub, badge) => `<button class="moreTile" data-m='${JSON.stringify({ fn: 'open', kind })}'><b>${icon}</b><span>${label}${badge ? ' <i class="dot"></i>' : ''}</span><small>${sub}</small></button>`;
      return `<h2>⋯ เมนูเพิ่มเติม</h2><div class="moreGrid">
        ${tile('profile', '🪪', 'โปรไฟล์', 'รูป · ฉายา · สถิติ')}
        ${tile('rewards', '🎁', 'รางวัล', 'เข้าเกมรายวัน · ความสำเร็จ', achTodo().length > 0)}
        ${tile('friends', '👥', 'เพื่อน', 'ใครออนไลน์อยู่')}
        ${tile('rank', '🏆', 'อันดับ', 'เศรษฐีของเมือง')}
        ${tile('help', '❔', 'วิธีเล่น', 'ปุ่มและระบบต่างๆ')}
        ${tile('settings', '⚙️', 'ตั้งค่า', 'เสียง · จอ · รีเซ็ต')}
        ${tile('bug', '🐞', 'แจ้งบัค', 'ส่งถึงทีมงาน')}
        ${me.admin ? tile('god', '👑', 'God mode', 'แอดมินเท่านั้น') : ''}
      </div>`;
    }
    case 'settings': {
      const fsOn = !!document.fullscreenElement, canFs = !!document.documentElement.requestFullscreen;
      return `<h2>⚙️ ตั้งค่า</h2>
        <div class="secT">🏷️ ป้ายเหนือหัว</div><div class="grid2">${B(NAME_TXT[NAME_MODE], { fn: 'names' }, NAME_MODE === 'all' ? '' : 'good')}</div><div class="sub">แตะเพื่อสลับ: แสดงทั้งหมด → แค่ชื่อ → ซ่อนหมด (เหลือแต่ตัวละครกับข้อความแชท) · ตั้งแค่ในเครื่องนี้</div>
        <div class="secT">🔋 เครื่องร้อน / แบตหมดไว</div><div class="grid2">${B(ECO ? '🔋 โหมดประหยัดแบต: เปิด' : '🔋 โหมดประหยัดแบต: ปิด', { fn: 'eco' }, ECO ? 'good' : '')}</div><div class="sub">เปิดไว้ = เดินลื่น 60 เฟรม แต่ตอนยืนเฉยๆ ลดเหลือ 30 ให้เครื่องเย็น (เปิดอยู่แล้วบนมือถือ)</div>
        <div class="secT">🔊 เสียง</div><div class="grid2">${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'good' : '')}${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🎵 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'good' : '')}</div>
        <div class="secT">⛶ หน้าจอ</div><div class="grid2">${B(fsOn ? '↙️ ออกจากเต็มจอ' : '⛶ เต็มจอ', { fn: 'fs', mode: fsOn ? 'exit' : 'full' }, fsOn ? '' : 'primary', !canFs)}${B('🔄 เต็มจอ + แนวนอน', { fn: 'fs', mode: 'landscape' }, 'good', !canFs)}</div>
        ${canFs ? '' : '<div class="sub">iPhone/iPad: กดแชร์ ⬆️ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดเกมจากไอคอนจะเต็มจอ</div>'}
        ${G.gid ? `<div class="secT">🔑 บัญชี Google</div>${me.gmail ? `<div class="jobbox ok">✅ ผูกกับ <b>${esc(me.gmail)}</b> แล้ว · เข้าเกมด้วยปุ่ม Google ได้เลย${B('ยกเลิกการผูก', { t: 'glink', off: 1 })}</div>` : `<div class="sub">ผูกไว้แล้วเข้าเกมด้วย Google ได้ ไม่ต้องจำ ID/PIN · ย้ายเครื่องก็เข้าได้</div>${B('🔑 ผูกบัญชี Google', { fn: 'gLink' }, 'primary big')}`}` : ''}
        ${me.admin ? `<div class="secT">👑 แอดมิน</div>${B('👑 เปิด God mode', { fn: 'open', kind: 'god' }, 'primary big')}` : ''}
        <div class="secT" style="color:var(--bad)">♻️ รีเซ็ตตัวละคร (เริ่มใหม่)</div>
        <div class="sub">ล้างเงิน ของ บ้าน สวน งาน วุฒิ และความสำเร็จทั้งหมด เริ่มใหม่ที่จัตุรัส (ID, PIN, ชื่อ, เบอร์โทร และรายชื่อเพื่อนยังอยู่)</div>
        <div class="grid2"><input id="resetPin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN ของคุณ"><input id="resetOk" placeholder='พิมพ์ "รีเซ็ต"'></div>
        ${B('♻️ รีเซ็ตตัวละคร', { fn: 'reset' }, 'warn big')}
        ${B('🚪 ออกจากระบบ', { fn: 'logout' }, 'big')}`;
    }
  }
  return '';
}
function billsBox() {
  const bills = me.bills || [], due = bills.reduce((s, b) => s + b.water + b.elec, 0);
  const rows = bills.map(b => itemRowRaw(b.late ? '⚠️' : '🧾', `ค่าน้ำค่าไฟเดือน${G.months[b.m % 12]} · บ้าน #${b.home + 1}`, `💧 ค่าน้ำ ${money(b.water)} · ⚡ ค่าไฟ ${money(b.elec)}${b.late ? ' · <b style="color:var(--bad)">เกินกำหนด (รวมค่าปรับ)</b>' : ' · จ่ายภายในสิ้นเดือนหน้า'}`, '')).join('');
  const next = me.date ? `${G.monthDays - me.date.day + 1} วันในเกม (${G.months[(me.date.month + 1) % 12]})` : '';
  return `<div class="jobbox ${me.utilOff ? '' : due ? '' : 'ok'}"><b>🧾 ค่าน้ำค่าไฟ</b>${me.home >= 0 ? ` · บิลรอบถัดไปในอีก ${next}` : ' · ยังไม่มีบ้าน/บ้านเช่า ไม่ต้องจ่าย'}
    ${me.utilOff ? '<div class="sub" style="color:var(--bad)">🔌 ถูกตัดน้ำตัดไฟ — นอนที่บ้านไม่ได้จนกว่าจะจ่าย</div>' : ''}
    ${rows ? `<div class="list">${rows}</div>${B(`💳 จ่ายทั้งหมด ${money(due)}`, { t: 'paybills' }, 'primary big')}` : '<div class="sub">ไม่มีบิลค้างจ่าย ✅</div>'}</div>`;
}
function houseDoor(s, st) {
  const i = s.house, h = wd?.houses?.[i]; if (!h) return '';
  const [owner, cf, furn] = h, mine = me.house === i, friend = owner && !mine && (me.contacts || []).length >= 0;
  if (!owner) return `<h2>🌱 ที่ดินว่าง</h2><div class="sub">หมู่บ้านนี้เป็นบ้านของผู้เล่นที่ออนไลน์อยู่ · แปลงนี้ว่าง รอบ้านของผู้เล่นคนต่อไป</div><div class="jobbox">🏡 อยากมีบ้าน? ซื้อได้ที่ <b>คุณจิ๋ม สำนักงานอสังหาฯ</b> (ทางเข้าหมู่บ้าน) · ซื้อได้ทุกคน ไม่จำกัด${B('📍 พาไปหาคุณจิ๋ม', { fn: 'guide', key: 'estate' }, 'good')}</div>`;
  if (mine) {
    const T = G.homeTiers?.[me.hown?.tier || 0];
    return `<h2>🏠 บ้านของคุณ</h2><div class="sub">${T ? `${T.icon} ${T.name} · ` : ''}ความสบาย ⭐ <b>${me.comfort}</b> → พลังงานฟื้นเร็วขึ้น +${me.comfort * 3}% · บ้านจะตั้งอยู่ในหมู่บ้านตอนคุณออนไลน์ เพื่อนที่คุณบันทึกเบอร์ไว้เข้ามาเยี่ยมได้</div>
      ${B('🚪 เข้าบ้าน', { t: 'enter', st }, 'primary big')}
      <div class="sub" style="margin-top:10px">🛋️ ซื้อเฟอร์นิเจอร์ที่ร้านเฟอร์นิเจอร์ แล้วกดปุ่ม 🛋️ จัดบ้าน · 🏗️ ต่อเติมชั้นได้ที่บันไดในบ้าน · 🔓 ขยายสวนได้ที่ป้ายในสวน</div>
      ${(me.keep || []).length ? `<div class="sub" style="margin-top:8px"><b>🎁 ของพิเศษจากรางวัลเข้าเกม</b> ${me.keep.map(k => `${G.shop.furniture[k].icon} ${G.shop.furniture[k].name}`).join(' · ')}</div>` : ''}`;
  }
  return `<h2>🏠 บ้านของ ${esc(owner)}</h2><div class="sub">ความสบาย ⭐ ${cf} ${furn.length ? furn.slice(0, 20).map(k => G.shop.furniture[fbase(k)]?.icon || '').join('') : ''}</div>
    ${B('🚪 เข้าไปเยี่ยม', { t: 'enter', st }, 'primary big')}<div class="sub">เข้าได้ถ้าเจ้าของบ้านบันทึกเบอร์คุณไว้ (เป็นเพื่อนกัน) · ขอเบอร์ได้โดยแตะที่ตัวผู้เล่น</div>`;
}
// the lost-dog case: take it at the station, find the dog out in town before the time is up
function dogBox(st) {
  const c0 = me.dogq, tcd = Math.max(0, Math.ceil(((me.thiefNext || 0) - (Date.now() + clockOff)) / 1000));
  if (c0?.kind === 'thief') return `<div class="jobbox">🚨 <b>ตามจับโจร: <span style="color:#e0332a">${esc(c0.name)}</span></b> · ฉก${esc(c0.stole)}<br>📍 เห็นล่าสุดแถว <b>${esc(c0.hint)}</b> · เหลือเวลา <b class="dogcd"></b><br><small>ดู <b style="color:#e0332a">จุดแดง</b> บนมินิแมพ ขับรถสายตรวจไปให้ถึงตัว (ชื่อสีแดง) จับเร็วได้โบนัส</small>${B('ยกเลิกเคส', { t: 'act', st, a: 'dogquit' })}</div>`;
  const thief = `<div class="jobbox">🚨 <b>ตามจับโจร</b> · ขับรถตามจุดแดงบนแผนที่ไปจับโจรชื่อสีแดง · ค่าตอบแทนสูง${tcd > 0 ? `<br><small>แจ้งเหตุใหม่ในอีก ${tcd} วินาที</small>` : ''}${B(`🚓 รับแจ้งเหตุ (⚡${Math.ceil(6 * (G.energyMul || 1))})`, { t: 'act', st, a: 'thief' }, 'primary', tcd > 0 || !!c0)}</div>`;
  return (c0 ? '' : thief) + dogBox0(st) + jgBox('spot', 'หาคนร้ายที่ปลอมตัวในฝูงชน 5 ภาพ') + jgBox('shoot', 'ซ้อมยิงเป้า 30 วินาที อย่ายิงโดนพลเมือง');
}
function dogBox0(st) {
  const c = me.dogq, cd = Math.max(0, Math.ceil(((me.dogNext || 0) - (Date.now() + clockOff)) / 1000));
  if (c) return `<div class="jobbox">🐕 <b>เคสหมาหาย: น้อง${esc(c.name)}</b> (${G.pets[c.dog]?.name || ''}) · เจ้าของ ${esc(c.owner)}<br>📍 มีคนเห็นแถว <b>${esc(c.hint)}</b> · เหลือเวลา <b class="dogcd"></b><br><small>เดินไปให้ใกล้ตัวมันเพื่อพบ · ฟังเสียงเห่า และดูวงสีเหลืองบนแผนที่ · เจอเร็วได้โบนัส</small>${B('ยกเลิกเคส', { t: 'act', st, a: 'dogquit' })}</div>`;
  return `<div class="jobbox">🐕 <b>เคสหมาหาย</b> · ค่าตอบแทนตามเวลาที่ใช้ตามหา (ตามไกลได้มาก) · เวลาจำกัด ถ้าไม่เจอทันถือว่าล้มเหลว${cd > 0 ? `<br><small>เคสใหม่เข้าในอีก ${cd} วินาที</small>` : ''}${B('📋 รับเคสหมาหาย (⚡5)', { t: 'act', st, a: 'dog' }, 'primary', cd > 0)}</div>`;
}
function riderJobs() {
  const jobs = me.jobs || [];
  if (!jobs.length) return '<div class="sub" style="margin-top:10px">ยังไม่มีออเดอร์ รอสักครู่... (ออเดอร์ใหม่จะแจ้งเตือน 🔔)</div>';
  return `<div class="list">${jobs.map(j => {
    const it = G.items[j.item], st = j.state;
    const where = j.npc ? `${AREA[j.area]?.name || ''}` : 'ลูกค้าผู้เล่น (ตำแหน่งสด)';
    let btn = '';
    if (st === 'open') btn = B(`รับออเดอร์ ⚡${Math.ceil(5 * (G.energyMul || 1))}`, { t: 'order_take', id: j.id }, 'good');
    else if (st === 'taken') btn = `<div class="col2">${j.src === 'market' ? B('📍 ไปตลาด', { fn: 'guide', key: 'market' }, 'good') : B('📍 ไปร้าน', { fn: 'guide', key: 'restaurant' }, 'good')}${B('คืน', { t: 'order_drop', id: j.id })}</div>`;
    else btn = j.npc ? B('📍 ไปส่ง', { fn: 'guidePt', x: j.dest.x, y: j.dest.y, area: j.area, label: `ส่งให้ ${j.cust}` }, 'primary') : B('📍 ไปส่ง', { fn: 'guide', key: 'p' + j.custId }, 'primary');
    const state = st === 'open' ? '🆕 รอไรเดอร์' : st === 'taken' ? (j.src === 'market' ? '🏃 ไปรับที่ตลาดกลาง' : '🏃 ไปรับที่ร้าน') : j.src === 'market' ? '📦 ไปส่งลูกค้า' : '🥡 ไปส่งลูกค้า';
    return itemRowRaw(it.icon, `${j.src === 'market' ? '🏪 ' : ''}${esc(it.name)}${j.qty > 1 ? ' x' + j.qty : ''} → ${esc(j.cust)}`, `${state} · ค่าส่ง <b style="color:var(--acc)">${money(j.fee)}</b>${j.tip ? ` + ทิป ${money(j.tip)}` : ''} · ${where}`, btn);
  }).join('')}</div>`;
}
// 📱 the phone: a pixel handset with a home screen of apps; each app opens on the screen, or the matching menu
// [label, action, picture in the 4x4 app sheet, badge key]
// ---- phone wallpaper (this device only): a preset colour, or the player's own picture with zoom / position / darkness
const WALL_COLS = ['linear-gradient(160deg,#ffd3e2,#c9a8ff)', 'linear-gradient(160deg,#a8e6ff,#3a7bd5)', 'linear-gradient(160deg,#b9f6ca,#2e9e6b)', 'linear-gradient(160deg,#ffe29a,#ff8a5c)',
  'linear-gradient(160deg,#2b2d42,#0b0c18)', 'linear-gradient(160deg,#ff9a9e,#fecfef)', 'linear-gradient(160deg,#fdfbfb,#d6dde6)', 'linear-gradient(160deg,#4b2c20,#a46a3c)',
  '#e84a5f', '#2f80ed', '#27ae60', '#111'];
const WALL_DEF = { z: 1, x: 50, y: 50, d: 0 };
let PWALL = null; try { PWALL = JSON.parse(localStorage.getItem('lt_wall') || 'null'); } catch { }
function wallSave() { try { if (PWALL) localStorage.setItem('lt_wall', JSON.stringify(PWALL)); else localStorage.removeItem('lt_wall'); return true; } catch { toast('รูปใหญ่เกินไป เก็บในเครื่องไม่ได้ ลองรูปอื่น', '⚠️', false); return false; } }
function wallStyle(W) {
  if (!W) return '';
  if (!W.img) return WALL_COLS[W.c] ? `background:${WALL_COLS[W.c]}` : '';
  const z = W.z ?? 1, x = W.x ?? 50, y = W.y ?? 50, d = W.d ?? 0;
  return `background:linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})),url(${W.img}) ${x}% ${y}%/cover;transform:scale(${z});transform-origin:${x}% ${y}%`;
}
const wallLayer = () => `<div class="phWall" style="${wallStyle(PWALL)}"></div>`;
function bindWall(root) {
  const f = root.querySelector('#wallFile'), pk = root.querySelector('#wallPick');
  if (pk && f) pk.onclick = () => f.click();
  if (f) f.onchange = () => {
    const file = f.files?.[0]; if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const old = PWALL; PWALL = { img: c.toDataURL('image/jpeg', .8), ...WALL_DEF };
      if (!wallSave()) PWALL = old; else toast('ตั้งวอลเปเปอร์แล้ว', '🖼️');
      refreshPanel(true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('เปิดรูปนี้ไม่ได้', '⚠️', false); };
    img.src = url;
  };
  root.querySelectorAll('input[data-wall]').forEach(r => {
    r.oninput = () => { if (!PWALL?.img) return; PWALL[r.dataset.wall] = +r.value; root.querySelectorAll('.phWall').forEach(w => w.setAttribute('style', wallStyle(PWALL))); };
    r.onchange = () => { wallSave(); panelSig = ''; };
  });
}
const PH_APPS = [
  ['โทรศัพท์', { fn: 'qtab', set: { tab: 'contacts' } }, 0, 'call'], ['จดหมาย', { fn: 'open', kind: 'mail' }, 2, 'mail'], ['เดลิเวอรี', { fn: 'qtab', set: { tab: 'food' } }, 3],
  ['หุ้น', { fn: 'open', kind: 'bank', set: { btab: 'stock' } }, 4], ['บิล', { fn: 'qtab', set: { tab: 'bills' } }, 5, 'bills'], 
  ['ตั้งค่า', { fn: 'open', kind: 'settings' }, 9], ['รางวัล', { fn: 'open', kind: 'achv' }, 11, 'ach'],
  ['สัตว์เลี้ยง', { fn: 'open', kind: 'pets' }, 12], ['สมุดปลา', { fn: 'qtab', set: { tab: 'fish' } }, 13]];
// the rest of the old menu, as plain apps on the last row
const PH_MORE = [['LifeBook', '📘', { fn: 'social', k: 'ideas' }, 0, 'linear-gradient(#8ec5ff,#1d6fe0)'], ['วอลเปเปอร์', '🖼️', { fn: 'qtab', set: { tab: 'wall' } }, 0, 'linear-gradient(#ffe0f4,#b07cf0)'], ['เติมเงิน', '💎', { fn: 'openTopup' }, 0, 'linear-gradient(#e6d8ff,#8a5cf0)'], ['การเงิน', '💸', { fn: 'openLedger' }, 0, 'linear-gradient(#d2f5ff,#2fa0c8)'], ['อัปเดต', '🆕', { fn: 'open', kind: 'news' }, 0, 'linear-gradient(#d8ffd2,#3fb54f)'], ['บทช่วยสอน', '📖', { fn: 'tut' }, 0, 'linear-gradient(#ffe9c8,#e0913a)'], ['ลอตเตอรี่', '🎫', { fn: 'openLotto' }, 0, 'linear-gradient(#ffd0d0,#e0404a)'], ['ชวนเพื่อน', '🎟️', { fn: 'openInvite' }, 0, 'linear-gradient(#c7f7c0,#2fb36a)'], ['เลือกตั้ง', '🏛️', { fn: 'openMayor' }, 0, 'linear-gradient(#9bb8ff,#3d5bd9)'], ['แก๊ง', '🏴', { fn: 'openGang' }, 0, 'linear-gradient(#ff9a8a,#c9302c)'], ['ดูโฆษณา', '🎁', { fn: 'adReward' }, 0, 'linear-gradient(#ffe08a,#ff9f43)'], ['อันดับ', '🏅', { fn: 'open', kind: 'rank' }, 0, 'linear-gradient(#ffe7a0,#d9a93a)'],
  ['กลุ่มเฟสบุ๊ค', '👥', { fn: 'fbGroup' }, 0, 'linear-gradient(#7fb0ff,#1877f2)'], ['สนับสนุน', '💖', { fn: 'qtab', set: { tab: 'support' } }, 0, 'linear-gradient(#ffd0e4,#f06b9c)'],
  ['God', '👑', { fn: 'open', kind: 'god' }, 1, 'linear-gradient(#fff1a8,#f0b830)']];
// the home screen, grouped so the everyday apps come first
const PH_GROUPS = [['ติดต่อ', ['โทรศัพท์', 'จดหมาย', 'LifeBook', 'แก๊ง']], ['เงินทอง', ['บิล', 'การเงิน', 'หุ้น', 'ลอตเตอรี่']],
  ['ชีวิตประจำวัน', ['เดลิเวอรี', 'สัตว์เลี้ยง', 'สมุดปลา', 'เลือกตั้ง']], ['รางวัล', ['รางวัล', 'อันดับ', 'ชวนเพื่อน', 'ดูโฆษณา']],
  ['อื่นๆ', ['เติมเงิน', 'อัปเดต', 'บทช่วยสอน', 'วอลเปเปอร์', 'ตั้งค่า', 'กลุ่มเฟสบุ๊ค', 'สนับสนุน', 'God']]];
const FB_GROUP = 'https://www.facebook.com/share/g/1JTskmvnm1/';   // the game's Facebook group (the 👥 app in the phone)
const PH_TITLE = { wall: 'วอลเปเปอร์', mkt: 'เดลิเวอรี', taxi: 'แท็กซี่', support: 'สนับสนุน', contacts: 'โทรศัพท์', call: 'กำลังคุย', food: 'เดลิเวอรี', rider: 'งานไรเดอร์', bills: 'บิล', fish: 'สมุดปลา', wx: 'อากาศ', music: 'เพลง' };
function phonePanel(p) {
  const tab = p.tab || (call ? 'call' : 'home');
  const dt = me?.date, clock = hhmm(hourNow());
  const status = `<div class="phStat"><b>${clock}</b><span>📶 🔋</span></div>`;
  if (tab === 'home') {
    const badge = k => (k === 'call' && call) || (k === 'mail' && (me.mailN || 0) > 0) || (k === 'bills' && (me.bills || []).length) || (k === 'ach' && achTodo().length) ? '<em></em>' : '';
    const app = ([l, m, i, bk]) => `<button class="phApp" data-m="${esc(JSON.stringify(m))}"><i style="background-position:${(i % 4) * 100 / 3}% ${Math.floor(i / 4) * 100 / 3}%"></i>${badge(bk)}<small>${l}</small></button>`;
    const emApp = ([l, e, m, , bg]) => `<button class="phApp em" data-m="${esc(JSON.stringify(m))}"><i style="background:${bg}">${e}</i><small>${l}</small></button>`;
    const all = {}; for (const a of PH_APPS) all[a[0]] = app(a);
    for (const a of PH_MORE.filter(a => (!a[3] || me.admin) && (a[2].fn !== 'adReward' || G.ads) && (a[2].fn !== 'openTopup' || G.pay))) all[a[0]] = emApp(a);
    const used = new Set(), sec = PH_GROUPS.map(([t, names]) => { const h = names.filter(n => all[n]).map(n => (used.add(n), all[n])).join(''); return h ? `<div class="phSec">${t}</div><div class="phApps">${h}</div>` : ''; }).join('');
    const rest = Object.keys(all).filter(n => !used.has(n)).map(n => all[n]).join('');   // anything not listed in a group still shows, at the end
    return `<div class="phone"><div class="phScr home">${wallLayer()}${status}<div class="phClock"><b>${clock}</b><small>${dt ? `${dt.day} ${G.months[dt.month]}` : ''}</small></div><div class="phList">${sec}${rest ? `<div class="phApps">${rest}</div>` : ''}</div><button class="phBar" data-m='{"fn":"phClose"}' title="ปิด"></button></div><img class="phFrame" src="assets/phone/frame.webp" alt=""></div>`;
  }
  let body = '';
  if (tab === 'contacts') {
    const onl = new Set((me.friends || []).filter(f => f.on).map(f => f.p));
    const fav = new Set((me.friends || []).filter(f => f.fav).map(f => f.p)), list = (me.contacts || []).slice().sort((x, y) => fav.has(y.p) - fav.has(x.p) || onl.has(y.p) - onl.has(x.p));
    const rows = list.map(c => itemRowRaw(onl.has(c.p) ? '🟢' : '⚪', `${fav.has(c.p) ? '⭐ ' : ''}${esc(c.n)}`, c.p, `<div class="rowf">${B(fav.has(c.p) ? '★' : '☆', { t: 'contact_pin', phone: c.p }, fav.has(c.p) ? 'primary' : '')}${B('📞', { t: 'call', phone: c.p }, 'good', !!call)}${B('🗑️', { fn: 'delContact', phone: c.p, n: c.n })}</div>`)).join('');
    const taxiRow = G.taxi ? itemRowRaw('🚕', '<b>แท็กซี่เมืองชีวิต</b>', `${G.taxi.phone.replace(/(\d{3})(\d{3})/, '$1-$2')} · เรียกได้ 24 ชม.`, B('📞 เรียก', { fn: 'qtab', set: { tab: 'taxi' } }, 'good')) : '';
    body = `<div class="jobbox">📱 เบอร์ของคุณ: <b style="font-size:18px;letter-spacing:2px">${me.phone}</b><div class="sub">บอกเบอร์นี้ให้เพื่อน แล้วเพื่อนจะบันทึกและโทรหาคุณได้</div></div>
      <div class="rowf" style="margin:10px 0"><input id="phIn" inputmode="numeric" maxlength="6" placeholder="เบอร์เพื่อน 6 หลัก">${B('บันทึก', { fn: 'addContact' }, 'good')}</div>
      <div class="list">${taxiRow}${rows || (taxiRow ? '' : '<div class="sub">ยังไม่มีรายชื่อ</div>')}</div>`;
  } else if (tab === 'taxi') {
    const T = G.taxi; if (!T) body = '<div class="sub">ยังไม่เปิดบริการ</div>';
    else {
      const AA = areaOf(me.x, me.y), ar = AA?.id || '', area = ar.startsWith('yard') ? 'housing' : ar, inRoom = !AA || AA.kind === 'room' || ar === 'farm';
      const OUT = { housing: { x: 50, y: 4 }, park: { x: 54, y: 57.4 }, temple: { x: 74, y: 73.8 } }, here = OUT[area] || { x: me.x, y: me.y };
      const fee = d => { const t = OUT[d.id] || d; return Math.round(T.base + Math.hypot(here.x - t.x, here.y - t.y) * T.perTile + (area !== 'town' ? T.far : 0) + (OUT[d.id] ? T.far : 0)); };
      const rows = T.dest.filter(d => Math.hypot(me.x - d.x, me.y - d.y) >= 3).map(d => [d, fee(d)]).sort((x, y) => x[1] - y[1])
        .map(([d, f]) => itemRowRaw(d.icon, esc(d.label), `ค่าโดยสาร <b style="color:var(--acc)">${money(f)}</b>`, B('🚕 ไป', { fn: 'taxiGo', dest: d.id }, 'good', inRoom || me.money < f))).join('');
      body = `<div class="jobbox">🚕 <b>แท็กซี่เมืองชีวิต</b> · โทร <b style="letter-spacing:1px">${T.phone.replace(/(\d{3})(\d{3})/, '$1-$2')}</b><div class="sub">${inRoom ? '🚪 ออกไปรอริมถนนข้างนอกก่อน แล้วค่อยเรียกรถ' : 'เลือกปลายทาง แท็กซี่จะมารับถึงที่แล้วพาไปส่งหน้าประตู · ยิ่งไกลยิ่งแพง'}</div></div><div class="list">${rows}</div>`;
    }
  } else if (tab === 'call') {
    if (!call) body = '<div class="sub">ยังไม่มีสาย — โทรหาเพื่อนจากแท็บรายชื่อ (เพื่อนต้องออนไลน์)</div>';
    else { call.unread = 0; setTimeout(paintCallChip, 0); }
    if (call) body = `<div class="jobbox ok">📞 กำลังคุยกับ <b>${esc(call.with)}</b><div class="sub">${call.payer ? `คุณเป็นคนโทร · ค่าโทร ${money(call.fee)}/นาที · จ่ายแล้ว ${money(call.paid)} (${call.mins} นาที)` : 'อีกฝ่ายเป็นคนจ่ายค่าโทร'}</div></div><div id="callMsgs">${callLog.map(m => `<div class="${m.me ? 'me' : ''}"><b>${m.me ? 'คุณ' : esc(m.name)}</b>: ${esc(m.text)}</div>`).join('')}</div>
      <form id="callForm" class="rowf"><input id="callIn" maxlength="120" placeholder="พิมพ์คุยในสาย..." autocomplete="off"><button class="primary" type="submit">ส่ง</button></form><div class="grid2">${B('➖ ย่อหน้าต่าง (คุยต่อได้)', { fn: 'callMin' })}${B('📵 วางสาย', { t: 'call_end' }, 'warn big')}</div>`;
  } else if (tab === 'food') {
    const open = isOpen('restaurant');
    const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, B(`สั่ง ${money(it.base)}+ส่ง`, { fn: 'order', item: id }, 'good', !open), eatText(it.eat))).join('');
    const mine = (me.myOrders || []).filter(o => o.src !== 'market').map(o => itemRowRaw(G.items[o.item].icon, esc(G.items[o.item].name), o.state === 'open' ? '⏳ รอไรเดอร์รับออเดอร์' : o.state === 'taken' ? `🏃 ${esc(o.rider)} กำลังไปรับที่ร้าน` : `🛵 ${esc(o.rider)} กำลังมาส่ง`, o.state === 'open' ? B('ยกเลิก', { t: 'order_cancel', id: o.id }, 'warn') : '')).join('');
    body = `<div class="sub">${open ? 'ร้านอาหารเปิดอยู่' : '🔒 ร้านอาหารปิด (07:00–23:00)'} · ค่าส่งคิดตามระยะทาง · ไรเดอร์ผู้เล่นมาส่งถึงตัว (ถ้าไม่มีไรเดอร์ ร้านส่งเองแต่ช้า)</div>
      ${mine ? `<div class="sub"><b>ออเดอร์ของฉัน</b></div><div class="list">${mine}</div>` : ''}
      <div class="rowf" style="margin:8px 0">ทิปไรเดอร์ <input id="tipIn" type="number" inputmode="numeric" min="0" max="500" value="${p.tip || 0}" style="width:90px"> ฿</div><div class="list">${rows}</div>`;
  } else if (tab === 'mkt') {
    const mk = wd?.mk || {}, q = (p.mq || '').trim().toLowerCase();
    const rows = Object.entries(G.items).filter(([id, it]) => (mk[id]?.n || 0) > 0 && !it.egg && (!q || it.name.toLowerCase().includes(q))).sort((a, b) => a[1].name.localeCompare(b[1].name, 'th'))
      .map(([id]) => itemRow(id, `<div class="col2">${B(`x1 ${money(mk[id].best)}`, { fn: 'morder', item: id, qty: 1 }, 'good', me.money < mk[id].best)}${mk[id].n > 1 ? B('x5', { fn: 'morder', item: id, qty: 5 }) : ''}</div>`, `ผู้เล่นวางขาย ${mk[id].n} ชิ้น · ถูกสุด ${money(mk[id].best)}`)).join('');
    const mine = (me.myOrders || []).filter(o => o.src === 'market').map(o => itemRowRaw(G.items[o.item].icon, `${esc(G.items[o.item].name)} x${o.qty}`, o.state === 'open' ? '⏳ รอไรเดอร์รับออเดอร์' : o.state === 'taken' ? `🏃 ${esc(o.rider)} กำลังไปรับที่ตลาด` : `🛵 ${esc(o.rider)} กำลังมาส่ง`, o.state === 'open' ? B('ยกเลิก', { t: 'order_cancel', id: o.id }, 'warn') : '')).join('');
    body = `<div class="sub">🏪 สั่งของที่ผู้เล่นวางขายในตลาดกลาง ไรเดอร์ไปรับที่ตลาดแล้วมาส่งถึงตัว · จ่ายค่าของ + ค่าส่ง (ไม่มีใครรับใน 10 นาที ของจะส่งเข้ากระเป๋าให้เอง)</div>
      ${mine ? `<div class="sub"><b>ออเดอร์ของฉัน</b></div><div class="list">${mine}</div>` : ''}
      <input id="mqIn" placeholder="🔍 ค้นหาสินค้า" value="${esc(p.mq || '')}" autocomplete="off" oninput="this.dataset.v=this.value">
      <div class="rowf" style="margin:8px 0">ทิปไรเดอร์ <input id="tipIn" type="number" inputmode="numeric" min="0" max="500" value="${p.tip || 0}" style="width:90px"> ฿</div><div class="list">${rows || '<div class="sub">ตอนนี้ยังไม่มีผู้เล่นวางขายของ</div>'}</div>`;
  } else if (tab === 'rider') body = riderJobs();
  else if (tab === 'bills') body = billsBox();
  else if (tab === 'fish') body = fishBook();
  else if (tab === 'support') body = `<div class="phSup"><div class="big">💖</div><b>สนับสนุนเมืองชีวิตนี้เลือกได้</b><small>ขอบคุณที่เล่นด้วยกันนะครับ ทุกการสนับสนุนช่วยให้เซิร์ฟเวอร์เปิดต่อและมีอัปเดตใหม่ๆ</small>
    <div class="qrBox"><img src="assets/ui/support_qr.png?v=1" alt="QR สนับสนุน" onerror="this.parentNode.classList.add('none')"><span>QR สนับสนุนเร็วๆ นี้</span></div>
    <a class="qrSave" href="assets/ui/support_qr.png?v=1" download="lifetown-support-qr.png">📥 บันทึกรูป QR</a><small class="qrHint">หรือกดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ"</small>
    <div class="by">ผู้จัดทำ<br><b>นาย วราวุฒิ สีเสือ</b></div></div>`;
  else if (tab === 'wx') { const ev = wd?.ev, h = hourNow(); body = `<div class="phWx"><div class="big">${ev?.id === 'rain' ? '🌧️' : h >= 19 || h < 6 ? '🌙' : h < 8 || h >= 17 ? '⛅' : '☀️'}</div><b>${clock}</b><small>${dt ? `${dt.day} ${G.months[dt.month]}` : ''}</small><div class="jobbox">${ev ? esc(ev.text) : 'วันนี้อากาศปกติ ไม่มีเหตุการณ์พิเศษ'}</div></div>`; }
  else if (tab === 'wall') {
    const W = PWALL || {}, sw = WALL_COLS.map((c, i) => `<button class="wSw${!W.img && W.c === i ? ' on' : ''}" style="background:${c}" data-m='{"fn":"wallSet","c":${i}}'></button>`).join('');
    const sl = (k, l, min, max, st) => `<label class="wSl">${l}<input type="range" data-wall="${k}" min="${min}" max="${max}" step="${st}" value="${W[k] ?? WALL_DEF[k]}"></label>`;
    body = `<div class="wPrev">${wallLayer()}</div>
      <div class="sub"><b>📷 ใช้รูปของคุณ</b></div><div class="grid2"><button class="good" id="wallPick" type="button">📷 เลือกรูป</button><input type="file" id="wallFile" accept="image/*" hidden>${B('↺ ค่าเริ่มต้น', { fn: 'wallSet', c: -1 })}</div>
      ${W.img ? `<div class="sub" style="margin-top:8px"><b>ปรับรูป</b></div>${sl('z', '🔍 ซูม', 1, 3, .05)}${sl('x', '↔️ ซ้าย-ขวา', 0, 100, 1)}${sl('y', '↕️ ขึ้น-ลง', 0, 100, 1)}${sl('d', '🌙 ความมืด', 0, .6, .02)}` : ''}
      <div class="sub" style="margin-top:8px"><b>🎨 สีพื้นฐาน</b></div><div class="wSws">${sw}</div>
      <div class="sub">วอลเปเปอร์เก็บไว้ในเครื่องนี้เท่านั้น ถ้าเปลี่ยนเครื่องต้องตั้งใหม่</div>`;
  }
  else if (tab === 'music') body = `<div class="phWx"><div class="big">🎵</div><b>${(h => h >= 6 && h < 19 ? 'เพลงกลางวัน' : 'เพลงกลางคืน')(hourNow())}</b><small>เพลงเปลี่ยนเองตามเวลาในเกม</small></div><div class="grid2">${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🔇 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'primary' : '')}${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'primary' : '')}</div>`;
  const sub = tab === 'contacts' || tab === 'call' ? `<div class="tabs">${B('📇 รายชื่อ', { fn: 'qtab', set: { tab: 'contacts' } }, tab === 'contacts' ? 'primary' : '')}${B(call ? '📞 กำลังคุย' : '📞 สาย', { fn: 'qtab', set: { tab: 'call' } }, tab === 'call' ? 'primary' : '')}</div>`
    : tab === 'food' || tab === 'rider' || tab === 'mkt' ? `<div class="tabs">${B('🍔 อาหาร', { fn: 'qtab', set: { tab: 'food' } }, tab === 'food' ? 'primary' : '')}${B('🏪 ของจากตลาด', { fn: 'qtab', set: { tab: 'mkt' } }, tab === 'mkt' ? 'primary' : '')}${job('rider') ? B('🛵 งานไรเดอร์', { fn: 'qtab', set: { tab: 'rider' } }, tab === 'rider' ? 'primary' : '') : ''}</div>` : '';
  return `<div class="phone"><div class="phScr">${status}<div class="phHead"><button data-m='{"fn":"qtab","set":{"tab":"home"}}'>‹</button><b>${PH_TITLE[tab] || ''}</b></div><div class="phBody">${sub}${body}</div><button class="phBar" data-m='{"fn":"qtab","set":{"tab":"home"}}' title="หน้าหลัก"></button></div><img class="phFrame" src="assets/phone/frame.webp" alt=""></div>`;
}

// ------------------------------------------------------------------ map readability
const nightLevel = () => clamp((0.2 - Math.cos((hourNow() / 24 - 0.5) * Math.PI * 2)) / 1.2, 0, 0.55);
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  return `rgb(${Math.round((t - r) * p + r)},${Math.round((t - g) * p + g)},${Math.round((t - b) * p + b)})`;
}
function sign(text, x, y, o = {}) {
  const fs = Math.max(10, Math.round(o.size || TS * .36));
  ctx.font = `700 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = textW(text) + fs * .9, h = o.h || fs * 1.55;
  ctx.fillStyle = o.bg || 'rgba(58,36,20,.88)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = o.color || '#fff'; ctx.fillText(text, x, y + fs * .04);
}
const STN = id => id === 'water' ? waterNear : G.stations.find(s => s.id === id);
let atlas = null, atlasImg = null;
let PET_AT = null, petImg = null;
fetch('assets/pets.json?v=1').then(r => r.json()).then(j => { PET_AT = j; setTimeout(() => { const im = new Image(); im.onload = () => { petImg = im; }; im.src = 'assets/pets.webp?v=2'; }, 3500); }).catch(() => { });
fetch('assets/atlas.json?v=v10').then(r => r.json()).then(j => { atlas = j; const im = new Image(); im.onload = () => { atlasImg = im; }; im.src = (SNOW ? 'assets/atlas_snow.webp' : 'assets/atlas.webp') + '?v=v10'; });   // ❄️ the snowy atlas is baked ahead (tools/build_snow_atlas.js): building it on the phone ran iPhones out of memory
// ❄️ winter: the lawns are snow and trees / bushes carry snow on top. Done once on a copy of the atlas when it loads,
// so every place that draws grass or a tree (ground chunks, the map edge, shop thumbnails) gets the snowy look for free.
// Not run in the game any more: tools/build_snow_atlas.js runs it once and saves assets/atlas_snow.webp
const SNOW = true;
function snowAtlas(im, j) {
  try {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const GROUND = /^(g_grass|g_grass3|g_grass_dots|g_grass_flowers|o_grass)$/, PLANT = /^(tree|tree\d|tree_\w+|pine\d?|bush\d?|hedge|hedge_flower|palm|palm_small|x_tree|o_topiary|o_hedgering|o_hedgecube|o_pottree)$/;
    for (const [name, r] of Object.entries(j.sprites)) {
      const ground = GROUND.test(name); if (!ground && !PLANT.test(name)) continue;
      const [x, y, w, h] = r, im2 = g.getImageData(x, y, w, h), d = im2.data;
      if (ground) {                       // lawn -> snow: keep the texture's light and shade, cool white-blue
        for (let i = 0; i < d.length; i += 4) { const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11, v = Math.max(200, Math.min(246, 226 + (l - 110) * .45)); d[i] = v - 8; d[i + 1] = v - 2; d[i + 2] = Math.min(255, v + 8); }
      } else {                            // leaves facing up get a snow cap (2-3 px thick), plus a few flakes caught inside
        const op = (px, py) => px >= 0 && py >= 0 && px < w && py < h && d[(py * w + px) * 4 + 3] > 40;
        const leaf = i => { const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2]; return g0 >= r0 - 6 && g0 + 30 > b0; };   // green-ish (not the brown trunk)
        const cap = new Uint8Array(w * h), th = Math.max(3, Math.round(h / 13));
        const air = new Uint8Array(w * h), st = [];   // transparent pixels connected to the sprite's border = open sky (holes inside the crown are not)
        for (let px = 0; px < w; px++) st.push(px, (h - 1) * w + px); for (let py = 0; py < h; py++) st.push(py * w, py * w + w - 1);
        while (st.length) { const q = st.pop(); if (air[q] || d[q * 4 + 3] > 40) continue; air[q] = 1; const qx = q % w; if (qx > 0) st.push(q - 1); if (qx < w - 1) st.push(q + 1); if (q >= w) st.push(q - w); if (q < w * (h - 1)) st.push(q + w); }
        for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4; if (d[i + 3] < 200 || (d[i] > d[i + 1] + 10 && d[i + 1] >= d[i + 2])) continue;   // not the brown trunk; soft ground shadows stay as they are
          let top = py < th; for (let k = 1; k <= th && !top; k++) if (py - k >= 0 && air[(py - k) * w + px]) top = true;   // open sky just above
          // the top of each leaf clump inside the crown: a darker shadow line just above it
          const lum = q => d[q] * .3 + d[q + 1] * .59 + d[q + 2] * .11;
          let clump = false; if (py > 2 && py < h * .75) for (let k = 1; k <= 2; k++) { const q = ((py - k) * w + px) * 4; if (d[q + 3] > 200 && leaf(i) && lum(q) < lum(i) - 28) { clump = true; break; } }
          const hsh = (px * 73856093 ^ py * 19349663) >>> 0;
          if (top || clump || hsh % 97 === 0) cap[py * w + px] = 1;
        }
        for (let p = 0; p < cap.length; p++) if (cap[p]) { const i = p * 4, sh = (d[i] + d[i + 1] + d[i + 2]) / 3 < 70 ? 222 : 246; d[i] = sh - 6; d[i + 1] = sh; d[i + 2] = 255; }
      }
      g.putImageData(im2, x, y);
    }
    return c;
  } catch { return im; }
}
function spr(name, cx, by, X, Y, scale = 1) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const w = s[2] / atlas.tile * TS * scale, h = s[3] / atlas.tile * TS * scale;
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(cx * TS + X - w / 2), Math.round(by * TS + Y - h), Math.round(w), Math.round(h));
  return true;
}
function sprF(name, cx, by, X, Y, flip) {   // a sprite, mirrored left-right when flip is set (turned furniture)
  if (!flip) return spr(name, cx, by, X, Y);
  const px = Math.round(cx * TS + X); ctx.save(); ctx.translate(px, 0); ctx.scale(-1, 1); const r = spr(name, 0, by, 0, Y); ctx.restore(); return r;
}
function tex(name, tx, ty, px, py) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const q = atlas.tile;
  // sample 1px inside each quarter: the lossy atlas bleeds a little at sprite edges, which showed as lines between tiles
  ctx.drawImage(atlasImg, s[0] + (tx & 1) * q + 1, s[1] + (ty & 1) * q + 1, q - 2, q - 2, Math.floor(px), Math.floor(py), Math.ceil(TS) + 1, Math.ceil(TS) + 1);
  return true;
}
// your own house: the floor / wallpaper picked for this storey (wd.houses[i][14] = { storey: [floor, wall] })
// shop / home-menu preview of a floor (the real floor texture) or a wallpaper (its colour and pattern)
function styleThumb(isFloor, id) {
  if (isFloor) return `<canvas class="fspr" data-spr="${id}" width="96" height="80"></canvas>`;
  const w = G.shop.hwalls[id]; return `<div class="wallSw ${w.pat || ''}" style="--c:${w.c};--d:${shade(w.c, -.3)};--e:${shade(w.c, -.18)}"></div>`;
}
const houseStyle = rm => wd?.houses?.[rm.house]?.[14]?.[rm.floor || 1] || ['fl_wood', 'cream'];
function wallPat(w, px, py, S, tx) {          // brick / wood plank / damask texture over the wallpaper (upper band + wall, above the wainscot)
  const top = py - TS, h = TS * 1.58; ctx.save(); ctx.beginPath(); ctx.rect(px, top + TS * .1, S, h - TS * .1); ctx.clip();
  if (w.pat === 'brick') { const bh = TS / 5; ctx.fillStyle = shade(w.c, -.3);
    for (let r = 0; r * bh < h; r++) { const y = top + r * bh; ctx.fillRect(px, y, S, Math.max(1, TS * .03)); const off = (r % 2) * TS / 4 + (tx % 2) * TS / 2; for (let x = -off; x < S; x += TS / 2) ctx.fillRect(px + x, y, Math.max(1, TS * .03), bh); } }
  else if (w.pat === 'plank') { ctx.fillStyle = shade(w.c, -.28); for (let i = 0; i <= 4; i++) ctx.fillRect(px + i * TS / 4, top, Math.max(1, TS * .03), h); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(px + TS * .06, top, TS * .05, h); }
  else if (w.pat === 'damask') { ctx.fillStyle = shade(w.c, .25); for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { const cx = px + (c + .5 + (r % 2) * .5) * TS / 2, cy = top + (r + .5) * TS * .4; ctx.beginPath(); ctx.moveTo(cx, cy - TS * .1); ctx.lineTo(cx + TS * .07, cy); ctx.lineTo(cx, cy + TS * .1); ctx.lineTo(cx - TS * .07, cy); ctx.fill(); } }
  ctx.restore();
}
const FLOOR = { fashion: 'fl_marble', police: 'fl_concrete', office: 'fl_carpet_blue', market: 'fl_beige', warehouse: 'fl_concrete', rider: 'fl_stone', dealer: 'fl_white', toolshop: 'fl_concrete',
  restaurant: 'fl_checker', kitchen: 'fl_bluecheck', hospital: 'fl_mint', school: 'fl_tatami', bank: 'fl_marble', house: 'fl_wood', cstore: 'fl_white', petshop: 'fl_wood' };
const WALL = { fashion: '#f6d6e4', police: '#c7d3e6', office: '#c9d3dc', market: '#f1e3c4', warehouse: '#8d7a5e', rider: '#3f6b63', dealer: '#dfe6ec', toolshop: '#b9a17f',
  restaurant: '#e9cfa4', kitchen: '#f3f3f3', hospital: '#e6f1f6', school: '#cfe0c4', bank: '#efe2bb', house: '#ecd2b2', cstore: '#e4efe9', petshop: '#f6e6c8' };
function under(tx, ty) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) { const c = tileAt(tx + dx, ty + dy); if (',=kmspc'.includes(c)) return c; }
  return '.';
}
const depthCache = new Map(); let drawArea = null;
function waterDepth(tx, ty) {
  const k = ty * 4096 + tx; let d = depthCache.get(k); if (d !== undefined) return d;
  d = 4; const A = drawArea; if (!A || tx < A.x || ty < A.y || tx >= A.x + A.w || ty >= A.y + A.h) return 4;   // open sea past the map edge
  for (let r = 1; r <= 4 && d === 4; r++) for (let j = -r; j <= r && d === 4; j++) for (let i = -r; i <= r; i++) {
    const x = tx + i, y = ty + j; if (A && (x < A.x || y < A.y || x >= A.x + A.w || y >= A.y + A.h)) continue;   // the map's own edge is open sea
    const c = tileAt(x, y); if (c !== 'w' && c !== ' ') { d = r - 1; break; }
  }
  depthCache.set(k, d); return d;
}
// text widths are measured once per font+text (labels and name tags are redrawn every frame)
const textWCache = new Map();
function textW(text) {
  const k = ctx.font + '|' + text; let w = textWCache.get(k);
  if (w === undefined) { w = ctx.measureText(text).width; if (textWCache.size > 3000) textWCache.clear(); textWCache.set(k, w); }
  return w;
}
// the ground outdoors never changes: bake it into 8x8-tile chunks once and blit those (water stays live for its ripples)
const GCH = 8; const gCache = new Map(); let gKey = '';
function groundChunk(A, cx, cy) {
  const key = A.id + ':' + cx + ',' + cy; let c = gCache.get(key);
  if (c) { gCache.delete(key); gCache.set(key, c); return c; }
  c = document.createElement('canvas'); c.width = c.height = Math.ceil(GCH * TS * DPR);
  const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.imageSmoothingEnabled = false;
  const tx0 = cx * GCH, ty0 = cy * GCH, tx1 = Math.min(tx0 + GCH, A.x + A.w), ty1 = Math.min(ty0 + GCH, A.y + A.h);
  ctx = g;
  try {
    for (let ty = Math.max(ty0, A.y); ty < ty1; ty++) for (let tx = Math.max(tx0, A.x); tx < tx1; tx++) { const ch = G.map.tiles[ty][tx]; if (ch !== 'w') drawTile(ch, tx, ty, (tx - tx0) * TS, (ty - ty0) * TS, 0); }
    for (let ty = Math.max(ty0, A.y); ty < ty1; ty++) for (let tx = Math.max(tx0, A.x); tx < tx1; tx++) drawEdges(tx, ty, (tx - tx0) * TS, (ty - ty0) * TS);
  } finally { ctx = mainCtx; }
  gCache.set(key, c); if (gCache.size > 36) gCache.delete(gCache.keys().next().value);
  return c;
}
function drawTile(ch, tx, ty, px, py, tm) {
  if (ch === 'B' || ch === 'T' || ch === 'o' && !roomGrid[ty * G.map.w + tx]) ch = under(tx, ty);
  if (ch === 'o') ch = 'i';
  if (ch === 'g') ch = '.';
  const S = Math.ceil(TS) + 1;
  switch (ch) {
    case '.': { const v = hash(tx >> 1, ty >> 1); tex(v < .84 ? 'g_grass' : v < .92 ? 'g_grass_dots' : 'g_grass_flowers', tx, ty, px, py); return; }
    case 'm': tex(hash(tx >> 1, ty >> 1) < .9 ? 'g_grass3' : 'g_grass_dots', tx, ty, px, py); return;
    case 's': tex('g_sand', tx, ty, px, py); return;
    case 'k': tex('g_terracotta', tx, ty, px, py); return;
    case 'c': tex('g_cobble', tx, ty, px, py); return;
    case 'p': tex('g_planks', tx, ty, px, py); return;
    case 'f': tex('g_grass3', tx, ty, px, py); return;                 // garden beds are drawn by drawPlot on top
    case ',': {
      tex('g_sidewalk', tx, ty, px, py);
      const hz = tileAt(tx - 1, ty) === '=' && tileAt(tx + 1, ty) === '=', vt = tileAt(tx, ty - 1) === '=' && tileAt(tx, ty + 1) === '=';
      if (hz || vt) { if (!tex('g_asphalt', tx, ty, px, py)) { ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S); } ctx.fillStyle = '#eef0f2'; for (let i = 0; i < 4; i++) hz ? ctx.fillRect(px + 2, py + i * TS / 4 + 2, TS - 4, TS / 8) : ctx.fillRect(px + i * TS / 4 + 2, py + 2, TS / 8, TS - 4); }
      return;
    }
    case '=': {
      if (!tex('g_asphalt', tx, ty, px, py)) { ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S); }
      const v = hash(tx, ty); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(px + v * TS * .7, py + (1 - v) * TS * .7, 3, 3);
      ctx.fillStyle = '#f2d25c';
      const up = tileAt(tx, ty - 1) === '=', dn = tileAt(tx, ty + 1) === '=', left = tileAt(tx - 1, ty) === '=', right = tileAt(tx + 1, ty) === '=';
      if (up && !dn && left && right && tx % 2 === 0 && tileAt(tx, ty - 2) !== '=') ctx.fillRect(px + TS * .15, py - 2, TS * .7, 4);
      if (left && !right && up && dn && ty % 2 === 0 && tileAt(tx - 2, ty) !== '=') ctx.fillRect(px - 2, py + TS * .15, 4, TS * .7);
      return;
    }
    case 'w': {
      // deeper (darker) the further from land
      const dep = waterDepth(tx, ty);
      ctx.fillStyle = ['#5cb3e3', '#4aa2da', '#3d8fd1', '#3480c4', '#2c72b6'][dep]; ctx.fillRect(px, py, S, S);
      const ph = Math.sin(tm * 1.5 + tx * .9 + ty * 1.7);
      if (dep >= 3 && hash(tx, ty) < .12) { const sp = (tm * .8 + hash(ty, tx) * 6) % 6; if (sp < 1) { ctx.fillStyle = `rgba(255,255,255,${.5 * (1 - sp)})`; ctx.fillRect(px + TS * .3, py + TS * .4, TS * .4 * (1 - sp * .5), Math.max(2, TS / 14)); } }
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(px + TS * (.2 + ph * .1), py + TS * .3, TS * .35, Math.max(2, TS / 16));
      ctx.fillStyle = 'rgba(20,60,120,.18)'; ctx.fillRect(px + TS * .5, py + TS * (.7 + ph * .05), TS * .3, Math.max(2, TS / 16));
      if (',.sk'.includes(tileAt(tx, ty - 1))) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(px, py, S, Math.max(2, TS / 12)); }
      return;
    }
    case 'i': { const rm = roomGrid[ty * G.map.w + tx]; if (!tex((rm?.rk === 'house' && houseStyle(rm)[0]) || FLOOR[rm?.rk] || 'fl_wood', tx, ty, px, py)) { ctx.fillStyle = '#b89a78'; ctx.fillRect(px, py, S, S); } return; }
    case 'D': { tex('fl_wood', tx, ty, px, py); ctx.fillStyle = 'rgba(160,40,40,.55)'; ctx.fillRect(px + 2, py + TS * .2, TS - 4, TS * .6); return; }
    case '#': {
      const rm = roomGrid[ty * G.map.w + tx];
      if (rm && ty === rm.y && tx > rm.x && tx < rm.x + rm.w - 1) {
        // back wall: wallpaper with a faint pattern, a chair rail, a darker wainscot and a skirting board
        const hw = rm.rk === 'house' ? G.shop.hwalls?.[houseStyle(rm)[1]] : null, c = hw?.c || WALL[rm.rk] || '#dddddd';
        // the back wall stands taller than one tile: an upper band (with a cornice) above the room
        ctx.fillStyle = shade(c, .05); ctx.fillRect(px, py - TS, S, S);
        ctx.fillStyle = 'rgba(255,255,255,.10)'; for (let i = 0; i < 4; i++) ctx.fillRect(px + i * TS / 4 + TS / 8 - 1, py - TS + TS * .2, 2, TS * .8);
        ctx.fillStyle = shade(c, -.5); ctx.fillRect(px, py - TS, S, TS * .1);
        ctx.fillStyle = c; ctx.fillRect(px, py, S, S);
        ctx.fillStyle = 'rgba(255,255,255,.10)'; for (let i = 0; i < 4; i++) ctx.fillRect(px + i * TS / 4 + TS / 8 - 1, py + 3, 2, TS * .5);
        ctx.fillStyle = shade(c, -.18); ctx.fillRect(px, py + TS * .6, S, TS * .3);
        ctx.fillStyle = shade(c, .12); ctx.fillRect(px, py + TS * .58, S, Math.max(2, TS * .05));
        ctx.fillStyle = shade(c, -.45); ctx.fillRect(px, py + TS * .88, S, TS * .12);
        ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(px, py, S, Math.max(2, TS * .06));
        if (hw?.pat) wallPat(hw, px, py, S, tx);
      } else if (rm) {
        // side and front walls: one solid wall with a wooden trim where it meets the floor
        ctx.fillStyle = '#3a2b24'; ctx.fillRect(px, py, S, S);
        const fl = (dx, dy) => 'ioD'.includes(tileAt(tx + dx, ty + dy));
        ctx.fillStyle = '#7a5434';
        if (fl(1, 0)) ctx.fillRect(px + TS - TS * .14, py, TS * .14 + 1, S);
        if (fl(-1, 0)) ctx.fillRect(px, py, TS * .14, S);
        if (fl(0, -1)) ctx.fillRect(px, py, S, TS * .14);
      } else { ctx.fillStyle = '#2a2730'; ctx.fillRect(px, py, S, S); ctx.fillStyle = '#3a3542'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4); }
      return;
    }
    case ' ': ctx.fillStyle = '#07090c'; ctx.fillRect(px, py, S, S); return;
    default: ctx.fillStyle = '#5e9b57'; ctx.fillRect(px, py, S, S);
  }
}
function houseInfo(b) {
  const h = wd?.houses?.[b.house]; if (!h) return { label: '🏠' };
  const [owner, cf] = h, mine = me && me.house === b.house;
  if (!owner) return { label: '🌱 ที่ว่าง' };
  return { label: `🏠 บ้าน${owner}`, stars: cf, mine };
}
// village homes take the look their owner picked; an empty plot is just a lawn with a little sign
function homeSprite(b) {
  const i = b.house ?? b.yhouse; if (i === undefined) return b.sprite;
  const h = wd?.houses?.[i]; if (!h || !h[0]) return b.house !== undefined ? '' : b.sprite;
  return G.homeStyles?.[h[11]]?.[0] || b.sprite;
}
function drawBuildingSprite(b, X, Y) {
  const sp = homeSprite(b);
  if (!sp) {
    const x0 = b.x * TS + X, y0 = b.y * TS + Y;
    ctx.fillStyle = '#6fae5e'; ctx.fillRect(x0, y0, b.w * TS, b.h * TS); ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = Math.max(2, TS * .08); ctx.setLineDash([TS * .25, TS * .18]); ctx.strokeRect(x0 + 2, y0 + 2, b.w * TS - 4, b.h * TS - 4); ctx.setLineDash([]);
    ctx.font = `${Math.round(TS * .7)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🌱', x0 + b.w * TS / 2, y0 + b.h * TS / 2);
    return;
  }
  if (!spr(sp, b.x + b.w / 2, b.y + b.h + .02, X, Y)) { ctx.fillStyle = '#8a7a6a'; ctx.fillRect(b.x * TS + X, b.y * TS + Y, b.w * TS, b.h * TS); }
}
function drawBuildingSign(b, X, Y) {
  const s = atlas?.sprites[homeSprite(b) || b.sprite]; const hTiles = s ? s[3] / atlas.tile : b.h;
  const cx = (b.x + b.w / 2) * TS + X, top = (b.y + b.h - hTiles) * TS + Y;
  if (b.house !== undefined) {
    const h = houseInfo(b);
    sign(h.label + (h.stars ? ` ⭐${h.stars}` : ''), cx, top - TS * .1, { size: TS * .26, bg: h.mine ? 'rgba(255,201,77,.95)' : h.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.85)', color: h.mine ? '#222' : '#fff' });
    return;
  }
  if (b.deco && !b.label) return;
  if (b.renov) { sign(`🚧 ${b.label} · ปิดปรับปรุง`, cx, top - TS * .15, { size: TS * .32, bg: 'rgba(150,90,10,.92)', border: '#ffc94d88' }); return; }
  if (b.deco) { ctx.globalAlpha = .75; sign(`${b.icon} ${b.label}`, cx, top - TS * .1, { size: TS * .26 }); ctx.globalAlpha = 1; return; }
  const open = isOpen(b.id);
  sign(`${b.icon} ${b.label}${open ? '' : ' · ปิด'}`, cx, top - TS * .15, { size: TS * .34, bg: open ? 'rgba(18,22,28,.9)' : 'rgba(90,30,30,.92)', border: '#ffc94d88' });
  const o = G.hours[b.id]; if (o && o[1] - o[0] < 24) sign(`${hhmm(o[0])}–${hhmm(o[1])}`, cx, top + TS * .32, { size: TS * .22, bg: 'rgba(0,0,0,.55)' });
}
// ------------------------------------------------------------------ depth: soft tile edges, cast shadows, sunlight
// material of a tile for edge blending (trees and buildings stand on grass)
const MAT = c => c === '=' ? 'road' : ',ckp'.includes(c) ? 'pave' : c === 's' ? 'sand' : c === 'w' ? 'water' : c === 'f' ? 'grass' : c === ' ' || c === '#' || c === 'i' || c === 'D' || c === 'o' ? null : 'grass';
let edgeTS = 0; const EDGE = {};
// one small canvas per edge kind, drawn for the top side and rotated for the others
function edgeCanvas(kind) {
  if (edgeTS !== TS) { edgeTS = TS; for (const k in EDGE) delete EDGE[k]; }
  if (EDGE[kind]) return EDGE[kind];
  const S = Math.ceil(TS) + 1, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), lin = (h, stops) => { const gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, S, h); };
  const px = Math.max(2, Math.round(TS / 16));
  if (kind === 'curbShadow') {          // road below a kerb: the kerb casts a soft shadow onto the asphalt
    lin(TS * .34, [[0, 'rgba(0,0,0,.42)'], [.35, 'rgba(0,0,0,.16)'], [1, 'rgba(0,0,0,0)']]);
  } else if (kind === 'curbLip') {      // pavement next to a road: a raised kerb stone with a lit top and a dark face
    g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(0, 0, S, px * 2);
    g.fillStyle = 'rgba(70,60,50,.55)'; g.fillRect(0, 0, S, px * .8);
    lin(TS * .25, [[0, 'rgba(0,0,0,0)'], [.3, 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,0)']]);
  } else if (kind === 'grassOver' || kind === 'grassSand') {   // grass spilling over a paved/sandy edge: soft, ragged
    lin(TS * .28, SNOW ? [[0, 'rgba(110,130,160,.28)'], [1, 'rgba(110,130,160,0)']] : kind === 'grassOver' ? [[0, 'rgba(20,50,10,.38)'], [1, 'rgba(20,50,10,0)']] : [[0, 'rgba(80,140,40,.55)'], [1, 'rgba(80,140,40,0)']]);
    let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let x = 0; x < S; x += px) {
      const h = px * (1 + Math.floor(rnd() * 3));
      g.fillStyle = SNOW ? (rnd() < .5 ? '#eef3f9' : '#dfe7f1') : rnd() < .5 ? '#5da535' : '#4c912a'; g.fillRect(x, 0, px, h);
      if (rnd() < .3) { g.fillStyle = SNOW ? '#ffffff' : '#76bf45'; g.fillRect(x, h - px, px, px); }
    }
  } else if (kind === 'shore') {        // water next to land: a light shallow band with a foam line at the edge
    lin(TS * .42, [[0, 'rgba(170,230,240,.55)'], [.35, 'rgba(120,200,230,.25)'], [1, 'rgba(120,200,230,0)']]);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, S, Math.max(2, px));
    let r = 3; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let x = 0; x < S; x += px * 2) if (rnd() < .45) { g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x, px * (1 + Math.floor(rnd() * 3)), px * 2, px); }
  } else if (kind === 'grassLift') {    // grass next to a lower surface: a light rim so the lawn reads as raised
    lin(TS * .14, [[0, 'rgba(255,255,220,.22)'], [1, 'rgba(255,255,220,0)']]);
  }
  return EDGE[kind] = c;
}
function edgeDraw(kind, side, px, py) {
  const c = edgeCanvas(kind), S = c.width;
  if (side === 0) { ctx.drawImage(c, px, py); return; }
  ctx.save(); ctx.translate(px + S / 2, py + S / 2); ctx.rotate(side * Math.PI / 2); ctx.drawImage(c, -S / 2, -S / 2); ctx.restore();
}
// sides: 0 top, 1 right, 2 bottom, 3 left (rotation of the top-edge canvas)
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function drawEdges(tx, ty, px, py) {
  const me = MAT(tileAt(tx, ty)); if (!me) return;
  if (me === 'water') { for (let d = 0; d < 4; d++) { const nb = MAT(tileAt(tx + SIDES[d][0], ty + SIDES[d][1])); if (nb && nb !== 'water') edgeDraw('shore', d, px, py); } return; }
  for (let d = 0; d < 4; d++) {
    const nb = MAT(tileAt(tx + SIDES[d][0], ty + SIDES[d][1])); if (!nb || nb === me) continue;
    if (me === 'road') edgeDraw('curbShadow', d, px, py);
    else if (me === 'pave' && nb === 'road') edgeDraw('curbLip', d, px, py);
    else if ((me === 'pave' || me === 'soil') && nb === 'grass') edgeDraw('grassOver', d, px, py);
    else if (me === 'sand' && nb === 'grass') edgeDraw('grassSand', d, px, py);
    else if (me === 'grass' && (nb === 'road' || nb === 'pave')) edgeDraw('grassLift', d, px, py);
  }
}
// cast shadows: every standing sprite is drawn once as a black silhouette, sheared along the sun direction
let shadowAtlas = null, shadowBuf = null;
function silhouettes() {
  if (shadowAtlas || !atlasImg) return shadowAtlas;
  const c = document.createElement('canvas'); c.width = atlasImg.width; c.height = atlasImg.height;
  const g = c.getContext('2d'); g.drawImage(atlasImg, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  return shadowAtlas = c;
}
// back from another app: phones may have thrown away the canvases (black screen) or left a dead connection; rebuild both
function gfxRecover() {
  chCache.clear(); DYE.clear(); gCache.clear(); shadowAtlas = null; shadowBuf = null;
  cv.width = 0; resize();
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (Date.now() - hiddenAt > 1500) gfxRecover();
  if (ws && ws.readyState === 1 && Date.now() - lastMsgT > 6000) { try { ws.close(); } catch { } }   // a socket that went quiet in the background: reconnect
  else if (wantLogin && (!ws || ws.readyState > 1)) connect();
});
addEventListener('pageshow', e => { if (e.persisted) { gfxRecover(); if (wantLogin && (!ws || ws.readyState > 1)) connect(); } });
cv.addEventListener('contextrestored', gfxRecover);
const FLAT = /^(f_rug|flowerbed|fl_|g_|pond|grass_tuft|manhole|puddle|tuft)/;
const GROUND_PROP = /^(manhole|puddle|tuft|grass_tuft)$/;
function drawCastShadows(ents, X, Y, night) {
  const sa = silhouettes(); if (!sa) return;
  const day = 1 - night / 0.55; if (day < 0.05) return;
  const h = hourNow(), off = clamp((h - 12) / 6, -1.2, 1.2);
  const k = 0.45 - off * 0.75, d = 0.32 + Math.abs(off) * 0.28;      // morning: long shadows to the right; evening: to the left
  const W = Math.ceil(VW * DPR), H = Math.ceil(VH * DPR);
  if (!shadowBuf) shadowBuf = document.createElement('canvas');
  if (shadowBuf.width !== W || shadowBuf.height !== H) { shadowBuf.width = W; shadowBuf.height = H; }
  const g = shadowBuf.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.imageSmoothingEnabled = false;
  const one = (name, cx, by, scale = 1) => {
    const s = atlas.sprites[name]; if (!s || FLAT.test(name)) return;
    const w = s[2] / atlas.tile * TS * scale, hh = s[3] / atlas.tile * TS * scale;
    if (hh < TS * .7) return;
    const ox = (cx * TS + X) * DPR, oy = (by * TS + Y) * DPR;
    g.setTransform(DPR, 0, -k * DPR, -d * DPR, ox, oy);
    g.drawImage(sa, s[0], s[1], s[2], s[3], -w / 2, -hh, w, hh);   // the sprite's top is sheared down and sideways, away from its base
  };
  for (const [, kind, e] of ents) {
    if (kind === 0) one(e.sprite, e.x + e.w / 2, e.y + e.h + .02);
    else if (kind === 1 && !e.z) one(e.s, e.x, e.y);
    else if (kind === 2) one(e[2], e[0] + .5, e[1] + 1.05);
    else if (kind === 5) { const [n, sc] = carSprite(e); one(n, e.x, e.y + halfY(e), sc); }
    else if (kind === 4 && e.rx != null) {          // people: a body-shaped blob
      g.setTransform(DPR, 0, -k * DPR, -d * DPR, ((e.rx) * TS + X) * DPR, ((e.ry + .32) * TS + Y) * DPR);
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, -TS * .55, TS * .2, TS * .55, 0, 0, 7); g.fill();
    }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.26 * day; ctx.drawImage(shadowBuf, 0, 0); ctx.restore();
}
// warm sunlight from the top-left, golden at dawn/dusk, with a soft vignette and slow light shafts
function drawSunlight(t, night) {
  const day = 1 - night / 0.55; if (day < 0.05) return;
  const h = hourNow(), gold = clamp(Math.abs(h - 12) / 6, 0, 1);
  const warm = ctx.createLinearGradient(0, 0, VW, VH);
  warm.addColorStop(0, `rgba(255,${226 - gold * 40},${150 - gold * 60},${(.16 + gold * .14) * day})`);
  warm.addColorStop(.55, 'rgba(255,220,150,0)');
  warm.addColorStop(1, `rgba(60,30,80,${.12 * day})`);
  ctx.fillStyle = warm; ctx.fillRect(0, 0, VW, VH);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const ph = t / 9000;
  for (let i = 0; i < 4; i++) {            // light shafts
    const x = ((i * .31 + ph * .05) % 1.2 - .1) * VW * 1.3, w = VW * (.06 + .04 * Math.sin(ph + i * 2));
    const a = (.035 + .02 * Math.sin(ph * 2 + i)) * day;
    ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = '#ffe2a8';
    ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + w, -10); ctx.lineTo(x + w + VH * .9, VH + 10); ctx.lineTo(x + VH * .9, VH + 10); ctx.fill();
  }
  ctx.restore();
  const v = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.hypot(VW, VH) * .62);
  v.addColorStop(0, 'rgba(20,10,0,0)'); v.addColorStop(1, `rgba(20,10,0,${.32 * day + .1})`);
  ctx.fillStyle = v; ctx.fillRect(0, 0, VW, VH);
}
// ---- traffic: cars and buses drive on the left (Thai roads) along fixed routes, turn at corners, keep their distance,
// take turns at crossings and stop for people. Cosmetic only: they never block anyone.
const ROUTES = [
  [[2.5, 32.5], [2.5, 14.5], [95.5, 14.5], [95.5, 77.5], [49.5, 77.5], [49.5, 40.6], [50.5, 40.6], [50.5, 76.5], [94.5, 76.5], [94.5, 15.5], [3.5, 15.5], [3.5, 31.5], [41.4, 31.5], [41.4, 32.5]],
  [[92.5, 32.5], [58.6, 32.5], [58.6, 31.5], [92.5, 31.5]],
  [[4.6, 46.5], [47.6, 46.5], [47.6, 47.5], [4.6, 47.5]],
];
// sprites per kind: side view (faces left, mirrored for right), front (coming toward you), back (driving away)
const VEH = {
  red:    { faceR: 1, side: 'v_red_side', front: ['car_red', .45], back: 'v_red_back', len: 1.9, v: 3.2 },
  blue:   { faceR: 1, side: 'v_blue_side', front: ['car_blue', .45], back: 'v_blue_back', len: 1.9, v: 3.0 },
  taxi:   { faceR: 1, side: 'v_taxi_side', front: ['taxi', .41], back: 'v_taxi_back', len: 1.9, v: 3.4 },
  yellow: { faceR: 1, side: 'v_yellow_side', front: 'v_yellow_front', back: 'v_yellow_back', len: 1.9, v: 3.1 },
  police: { faceR: 1, side: 'v_police_side', front: 'v_police_front', back: 'v_police_front', len: 1.9, v: 3.3 },
  amb:    { side: 'v_amb_side', front: 'v_amb_back', back: 'v_amb_back', len: 2.3, v: 6, deep: 1.2 },
  bus:    { side: 'v_bus_side', front: 'v_bus_front', back: 'v_bus_back', len: 3.8, v: 2.4, deep: 1.7 },
};
const FLEET = [['bus', 'red', 'taxi', 'blue', 'yellow', 'police', 'red', 'taxi', 'bus', 'blue', 'yellow', 'taxi', 'red', 'blue'], ['taxi', 'red', 'blue'], ['yellow', 'red', 'blue']];
let traffic = [], trafT = 0, taxiFx = null;   // taxiFx: the cab you called, driving up to you / away after the drop
const routeLen = r => r.reduce((t, a, i) => { const b = r[(i + 1) % r.length]; return t + Math.hypot(b[0] - a[0], b[1] - a[1]); }, 0);
function routePos(r, d) {                     // point and heading at distance d along a closed route
  const L = routeLen(r); d = ((d % L) + L) % L;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l) return { x: a[0] + (b[0] - a[0]) * d / l, y: a[1] + (b[1] - a[1]) * d / l, dx: Math.sign(b[0] - a[0]), dy: Math.sign(b[1] - a[1]) };
    d -= l;
  }
  return { x: r[0][0], y: r[0][1], dx: 1, dy: 0 };
}
// half of the car's size along each axis, from its heading
// corners and U-turns: only one car at a time inside a small zone around each turning point
const CORNERS = ROUTES.map(r => { let d = 0; return r.map((a, i) => { const p = r[(i + r.length - 1) % r.length]; d += i ? Math.hypot(a[0] - p[0], a[1] - p[1]) : 0; return { x: a[0], y: a[1], d }; }); });
const ZONE = 1.9;
// corners close to each other (the two lanes turning at the same junction) share one zone
const CLUSTER = (() => { const pts = CORNERS.flat(), id = new Map(); let n = 0;
  for (const p of pts) { const near = pts.find(q => id.has(q.x + ',' + q.y) && Math.hypot(q.x - p.x, q.y - p.y) < 2.6); id.set(p.x + ',' + p.y, near ? id.get(near.x + ',' + near.y) : n++); }
  const groups = {}; for (const [k, v] of id) (groups[v] = groups[v] || []).push(pts.find(q => q.x + ',' + q.y === k));
  return Object.fromEntries([...id].map(([k, v]) => [k, groups[v]])); })();   // one shared array per cluster
// o is behind me in my own lane (following me): it does not stop me from turning
const behind = (c, o) => o.r === c.r && ((c.d - o.d) % routeLen(c.r) + routeLen(c.r)) % routeLen(c.r) < 6;
function cornerAhead(c) {                    // the next turning point on my route, and how far away it is
  const L = routeLen(c.r), d = ((c.d % L) + L) % L; let best = null;
  for (const k of CORNERS[ROUTES.indexOf(c.r)]) { const ahead = ((k.d - d) % L + L) % L; if (!best || ahead < best.ahead) best = { ...k, ahead }; }
  return best;
}
const halfX = c => c.dx ? VEH[c.k].len / 2 : .45, halfY = c => c.dx ? .4 : (VEH[c.k].deep || 1.1) / 2;
function stepTraffic() {
  const t = performance.now(), dt = Math.min(.1, (t - (trafT || t)) / 1000); trafT = t;
  if (!traffic.length) {
    let id = 0;
    ROUTES.forEach((r, ri) => { const L = routeLen(r), n = FLEET[ri].length; FLEET[ri].forEach((k, i) => { const c = { id: id++, k, r, d: L * i / n, v: 0 }; Object.assign(c, routePos(r, c.d)); traffic.push(c); }); });
  }
  const people = [...P.values()];
  for (const c of traffic) {
    const V = VEH[c.k], look = .55 + c.v * .35;
    // blocked if any car's box overlaps the stretch of road just ahead of mine (same lane, or crossing my path)
    const ax = c.x + c.dx * (halfX(c) + look / 2), ay = c.y + c.dy * (halfY(c) + look / 2);
    const bx = c.dx ? look / 2 : .42, by = c.dy ? look / 2 : .42;
    let blocker = null;
    for (const o of traffic) {
      if (o === c) continue;
      if (Math.abs(o.x - ax) < bx + halfX(o) && Math.abs(o.y - ay) < by + halfY(o)) { blocker = o; break; }
    }
    // wait before a corner while another car is turning there (or still inside the turn)
    if (!blocker) {
      const k = cornerAhead(c), near = k.ahead < halfX(c) + ZONE + .3;
      if (near && c.holds !== k.x + ',' + k.y) {
        const zone = CLUSTER[k.x + ',' + k.y];
        const busy = traffic.find(o => o !== c && !behind(c, o) && (o.holds && CLUSTER[o.holds] === zone || o.waitZone !== zone && zone.some(q => Math.hypot(o.x - q.x, o.y - q.y) < ZONE + Math.max(halfX(o), halfY(o)))));
        if (busy) { blocker = busy; c.waitZone = zone; } else { c.holds = k.x + ',' + k.y; c.waitZone = null; }
      }
      if (!near && c.holds && k.ahead > halfX(c) + ZONE + 1) c.holds = null;
    }
    if (!blocker) for (const o of ambs) if (Math.abs(o.x - ax) < bx + halfX(o) && Math.abs(o.y - ay) < by + halfY(o)) { blocker = o; break; }
    if (!blocker) for (const p of people) if (Math.abs(p.rx - ax) < bx + .3 && Math.abs(p.ry - ay) < by + .3) { blocker = p; break; }
    // two cars waiting on each other at a crossing: the lower id goes first
    c.blockedBy = blocker; c.wait = blocker ? (c.wait || 0) + dt : 0;
    const want = blocker ? 0 : V.v * (c.dx && c.dy ? .5 : 1);
    c.v += Math.max(-9 * dt, Math.min(2.4 * dt, want - c.v));      // gentle speed-up, firm braking
    if (c.v > 0) { c.d += c.v * dt; Object.assign(c, routePos(c.r, c.d)); }
  }
}
// ---- ambulance: drives along the roads to where someone collapsed, parks over them, then drives off toward the hospital
let ambs = [];
const DRIVE = '=,ckps';
function ambStart(m) {
  const src = P.get(m.id); if (!src || !G) return;
  const A = G.areas.find(a => a.id === m.area); if (!A) return;
  const W = G.map.w, inA = (x, y) => x >= A.x && y >= A.y && x < A.x + A.w && y < A.y + A.h, key = (x, y) => y * W + x;
  // 1) from the spot, over anything walkable, to the nearest road
  const sx = Math.floor(m.x), sy = Math.floor(m.y), road = A.id === 'farm' ? 'c' : '=';
  const prev = new Map([[key(sx, sy), -1]]), q = [[sx, sy]]; let entry = null;
  for (let i = 0; i < q.length && i < 8000; i++) {
    const [x, y] = q[i]; if (tileAt(x, y) === road) { entry = [x, y]; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (!prev.has(k) && inA(nx, ny) && (!blockedAt(nx + .5, ny + .5) || DRIVE.includes(tileAt(nx, ny)))) { prev.set(k, key(x, y)); q.push([nx, ny]); } }
  }
  if (!entry) return;
  const tail = []; for (let k = key(entry[0], entry[1]); k !== -1; k = prev.get(k)) tail.push([k % W + .5, Math.floor(k / W) + .5]);   // entry → spot
  // 2) along the road, from a point ~30 tiles away (toward the hospital in town) to the entry
  const p2 = new Map([[key(entry[0], entry[1]), [-1, 0]]]), q2 = [entry]; let far = entry, best = -1;
  const hosp = G.map.buildings.find(b => b.id === 'hospital'), hx = hosp ? hosp.x + hosp.w / 2 : entry[0], hy = hosp ? hosp.y + hosp.h + 2 : entry[1];
  for (let i = 0; i < q2.length; i++) {
    const [x, y] = q2[i], dep = p2.get(key(x, y))[1];
    const score = Math.min(dep, 30) * 10 - (A.id === 'town' ? Math.hypot(x - hx, y - hy) : 0);
    if (dep <= 30 && score > best) { best = score; far = [x, y]; }
    if (dep >= 30) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (!p2.has(k) && inA(nx, ny) && tileAt(nx, ny) === road) { p2.set(k, [key(x, y), dep + 1]); q2.push([nx, ny]); } }
  }
  const head = []; for (let k = key(far[0], far[1]); k !== -1; k = p2.get(k)[0]) head.push([k % W + .5, Math.floor(k / W) + .5]);   // far → entry
  const path = head.concat(tail.slice(1).reverse()); path[path.length - 1] = [m.x, m.y + .3];
  const body = { ...src, id: 'down' + m.id, x: m.x, y: m.y, rx: m.x, ry: m.y, pose: 'hosp', bubble: null, emo: null, ox: 0, oy: 0 };
  ambs = ambs.filter(a => a.body.id !== body.id);
  ambs.push({ k: 'amb', path, d: 0, v: 0, phase: 'in', t: 0, body, area: m.area, x: path[0][0], y: path[0][1], dx: 0, dy: 0 });
}
function pathPos(path, d) {
  for (let i = 0; i < path.length - 1; i++) { const a = path[i], b = path[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d <= l) return { x: a[0] + (b[0] - a[0]) * d / l, y: a[1] + (b[1] - a[1]) * d / l, dx: Math.sign(b[0] - a[0]), dy: b[0] === a[0] ? Math.sign(b[1] - a[1]) : 0, end: false }; d -= l; }
  const z = path[path.length - 1]; return { x: z[0], y: z[1], end: true };
}
function stepAmbs(dt) {
  for (const a of ambs) {
    if (a.phase === 'stop') { a.t += dt; if (a.t > .7) a.body.gone = true; if (a.t > 2.6) { a.phase = 'out'; a.path = a.path.slice().reverse(); a.d = 0; a.v = 0; } continue; }
    // emergency vehicle: only waits for a car that is not itself waiting for the ambulance
    const ax = a.x + a.dx * 1.6, ay = a.y + a.dy * 1.2;
    const car = traffic.find(o => o.blockedBy !== a && Math.abs(o.x - ax) < .5 + halfX(o) && Math.abs(o.y - ay) < .5 + halfY(o));
    const want = car ? 0 : a.phase === 'in' && pathPos(a.path, a.d + 3).end ? 2.5 : VEH.amb.v;   // slow down to park
    a.v += Math.max(-12 * dt, Math.min(4 * dt, want - a.v));
    a.d += a.v * dt; const p = pathPos(a.path, a.d);
    a.x = p.x; a.y = p.y; if (!p.end) { a.dx = p.dx; a.dy = p.dy; }
    if (p.end) { if (a.phase === 'in') { a.phase = 'stop'; a.t = 0; } else a.done = true; }
  }
  ambs = ambs.filter(a => !a.done);
}
function carSprite(c) {
  const V = VEH[c.k];
  if (c.dx) return [V.side, 1, V.faceR ? c.dx < 0 : c.dx > 0];
  const f = c.dy > 0 ? V.front : V.back;
  return Array.isArray(f) ? [f[0], f[1], false] : [f, 1, false];
}
function drawCar(c, X, Y) {
  const [name, sc, flip] = carSprite(c), s = atlas && atlasImg && atlas.sprites[name]; if (!s) return;
  const w = s[2] / atlas.tile * TS * sc, h = s[3] / atlas.tile * TS * sc;
  const cx = Math.round(c.x * TS + X), by = Math.round((c.y + halfY(c) * (c.dx ? 1.1 : .9)) * TS + Y);
  ctx.save(); ctx.translate(cx, by); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h)); ctx.restore();
}
function drawSirens(X, Y) {
  if (!ambs.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const on = Math.floor(performance.now() / 220) % 2;
  for (const a of ambs) { if (a.area !== drawArea?.id) continue; const px = a.x * TS + X, py = (a.y - .9) * TS + Y, g = ctx.createRadialGradient(px, py, 0, px, py, TS * 1.1);
    g.addColorStop(0, on ? 'rgba(255,40,40,.75)' : 'rgba(60,110,255,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(px - TS * 1.1, py - TS * 1.1, TS * 2.2, TS * 2.2); }
  ctx.restore();
}
function drawLights(X, Y, dark) {
  ctx.globalCompositeOperation = 'lighter';
  const glow = (px, py, r, col) => { if (px < -200 || py < -200 || px > VW + 200 || py > VH + 200) return; const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2); };
  // shop doors spill warm light onto the street while they are open
  for (const b of G.map.buildings) if (b.st && !b.renov && b.house === undefined && isOpen(b.id)) glow((b.x + b.w / 2) * TS + X, (b.y + b.h) * TS + Y, TS * 2.2, `rgba(255,190,110,${dark * .75})`);
  // homes with someone living in them have lit windows
  for (const b of G.map.buildings) if (b.house !== undefined && wd?.houses?.[b.house]?.[0]) glow((b.x + b.w / 2) * TS + X, (b.y + b.h - 1.2) * TS + Y, TS * 1.6, `rgba(255,210,130,${dark * .6})`);
  // cars: headlights ahead, red tail lights behind
  if (drawArea?.id === 'town') for (const c of traffic) { const px = c.x * TS + X, py = c.y * TS + Y, fx = c.dx * (halfX(c) + .9), fy = c.dy * (halfY(c) + .9); glow(px + fx * TS, py + fy * TS, TS * 1.5, `rgba(255,245,200,${dark * .85})`); glow(px - c.dx * halfX(c) * TS, py - c.dy * halfY(c) * TS, TS * .7, `rgba(255,50,30,${dark * .55})`); }
  for (const p of G.props) if (/^(lamp|o_lamp|o_lantern)/.test(p.s)) {
    const px = p.x * TS + X, py = (p.y - (p.s === 'o_lantern' ? .8 : p.s === 'o_lampball' ? 1.15 : 1.6)) * TS + Y; if (px < -200 || py < -200 || px > VW + 200 || py > VH + 200) continue;
    const fl = 1 + Math.sin(performance.now() / 170 + p.x * 3.1 + p.y) * .05 + Math.sin(performance.now() / 61 + p.x) * .025, R = TS * 2.6 * fl;   // a lamp breathes a little
    const g = ctx.createRadialGradient(px, py, 0, px, py, R);
    g.addColorStop(0, `rgba(255,236,170,${dark * 1.2})`); g.addColorStop(.18, `rgba(255,208,120,${dark * .85})`); g.addColorStop(1, 'rgba(255,190,100,0)');
    ctx.fillStyle = g; ctx.fillRect(px - R, py - R, R * 2, R * 2);
    const pool = ctx.createRadialGradient(px, py + TS * 1.5, 0, px, py + TS * 1.5, TS * 1.7); pool.addColorStop(0, `rgba(255,200,120,${dark * .45})`); pool.addColorStop(1, 'rgba(255,200,120,0)');   // the pool of light on the ground
    ctx.save(); ctx.translate(0, py + TS * 1.5); ctx.scale(1, .55); ctx.translate(0, -(py + TS * 1.5)); ctx.fillStyle = pool; ctx.fillRect(px - TS * 1.7, py - TS * .2, TS * 3.4, TS * 3.4); ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ navigation across maps
const GATE_TO = { field_in: 'field', town_from_field: 'town', temple_in: 'temple', town_from_temple: 'town', farm_in: 'farm', town_from_farm: 'town', housing_in: 'housing', town_from_housing: 'town', park_in: 'park', town_from_park: 'town' };
function targetOf(key) {
  if (key && key[0] === 'p' && /^p\d+$/.test(key)) { const p = P.get(+key.slice(1)); return p && { player: p.id, label: p.name }; }
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, area: s.area };
}
const CAREER_TARGET = { monk: 'wat_pray', cashier: 'cstore', police: 'police', beggar: 'square', none: 'staff_fishing', office: 'office', farmer: 'coop', merchant: 'warehouse', doctor: 'hospital', rider: 'rider' };
const QUEST_TARGET = { work: 'office', harvest: 'coop', fish: 'fishclub', buy: 'warehouse', cook: 'kitchen', treat: 'hospital', deliver: 'rider', sell: 'market', eat: 'restaurant', sit: 'seatb43.6', study: 'school' };
function setGuide(key, quiet, auto) {
  const g = targetOf(key); if (!g) return;
  guide = g; autoNav = !!auto; autoPath = null;
  if (g.label === 'เจ้าหน้าที่' && STAFF_AT[key]) g.label = STAFF_AT[key].short;
  if (!quiet) { toast(auto ? `กำลังเดินไป ${g.label} (ขยับจอยเพื่อหยุดเดินเอง)` : `นำทางไป ${g.label} — เดินตามลูกศรสีเหลือง (ยกเลิกได้ที่ปุ่มใต้สถานะ)`, '📍'); FX.play('notice'); }
  paintNav(); placeLog();
}
// the next point to walk to: room exit -> gate to the right map -> building door -> target
function nextHop(m, g) {
  const curA = areaOf(m.x, m.y); if (!curA) return null;
  let tgt = g;
  if (g.player) { const p = P.get(g.player); if (!p) return null; tgt = { x: p.x, y: p.y, area: areaOf(p.x, p.y)?.id, label: p.name }; }
  if (curA.id === tgt.area) return { ...tgt, final: true };
  if (curA.kind === 'room') return { x: curA.exit.x, y: curA.exit.y - 1, label: 'ทางออก', area: curA.id };
  const tMap = mapOf(tgt.area);
  if (tMap !== curA.id) {
    const gates = G.stations.filter(s => s.type === 'gate' && s.area === curA.id);
    const gt = gates.find(s => GATE_TO[s.to] === tMap) || gates.find(s => GATE_TO[s.to] === 'town') || gates[0];
    return gt && { x: gt.x, y: gt.y, label: gt.label, area: curA.id };
  }
  const room = AREA[tgt.area];
  return room && { x: room.doorPt.x, y: room.doorPt.y + .3, label: tgt.label + ' (ประตู)', area: curA.id };
}
function drawGuide(X, Y, t) {
  if (!guide) return;
  const m = P.get(myId); if (!m) return;
  const tg = nextHop(m, guide); if (!tg) { guide = null; paintNav(); return; }
  const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy);
  if (tg.final && d < 2) { guide = null; paintNav(); placeLog(); FX.play('ding'); toast('ถึงแล้ว! กดปุ่มใหญ่สีเหลืองเพื่อใช้งาน', '📍'); return; }
  const a = Math.atan2(dy, dx), cx = m.rx * TS + X, cy = m.ry * TS + Y, r = TS * 1.15 + Math.sin(t / 180) * 4;
  ctx.save(); ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.rotate(a);
  ctx.fillStyle = '#ffc94d'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(TS * .42, 0); ctx.lineTo(-TS * .24, -TS * .3); ctx.lineTo(-TS * .1, 0); ctx.lineTo(-TS * .24, TS * .3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const gx = tg.x * TS + X, gy = tg.y * TS + Y;
  ctx.strokeStyle = `rgba(255,201,77,${.55 + .45 * Math.sin(t / 160)})`; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(gx, gy + TS * .15, TS * 1.2, TS * .6, 0, 0, 7); ctx.stroke();
  sign(`📍 ${tg.label} · ${Math.round(d)} ม.`, cx, cy + TS * 1.05, { size: TS * .3, bg: 'rgba(255,201,77,.95)', color: '#222' });
}

// full-screen map of one outdoor area: a clean, simplified drawing with numbered markers
// and a legend underneath. Tap a marker or a legend row to get the yellow guide arrow.
const MAP_COL = { '=': '#5d636d', ',': '#c9c5b5', c: '#c4b494', w: '#5fb4e6', p: '#b48a5c', s: '#ecdcab', f: '#8a6040', B: '#9a8a7a', T: '#6fae5c', '.': '#8cc56f', o: '#8cc56f', m: '#a7d07a', k: '#e0b083', ' ': '#07090c' };
let mapZoom = 1, mapCur = null;
function zoomMap(z, cx, cy) {
  const box = $('#mapScroll'), old = mapZoom; mapZoom = clamp(z, 1, 5); if (mapZoom === old) return;
  const r = box.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const fx = (box.scrollLeft + cx) / old, fy = (box.scrollTop + cy) / old;     // keep the point under the finger/cursor still
  openMap(mapCur, true);
  box.scrollLeft = fx * mapZoom - cx; box.scrollTop = fy * mapZoom - cy;
}
$('#mapIn').onclick = () => zoomMap(mapZoom * 1.5); $('#mapOut').onclick = () => zoomMap(mapZoom / 1.5);
$('#mapScroll').addEventListener('wheel', e => { e.preventDefault(); const r = $('#mapScroll').getBoundingClientRect(); zoomMap(mapZoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
{ // two-finger pinch to zoom, one finger drags the map when zoomed in
  const pts = new Map(); let pinch = 0, drag = null;
  const box = $('#mapScroll');
  box.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } else drag = { x: e.clientX, y: e.clientY, sl: box.scrollLeft, st: box.scrollTop, moved: false }; });
  box.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = box.getBoundingClientRect(); if (Math.abs(d / pinch - 1) > 0.12) { zoomMap(mapZoom * d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; } }
    else if (drag && e.pointerType !== 'mouse' || drag && e.buttons) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 6) drag.moved = true; box.scrollLeft = drag.sl - dx; box.scrollTop = drag.st - dy; }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) setTimeout(() => { drag = null; }, 0); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('click', e => { if (drag?.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
}
function openMap(mapId, keepScroll) {
  const m = P.get(myId);
  mapId = mapId || mapOf(areaOf(m.x, m.y)?.id); if (AREA[mapId]?.yard) mapId = 'housing';   // home yards are private: the big map shows the estate instead
  if (mapId !== mapCur && !keepScroll) mapZoom = Math.min(mapZoom, 5);
  mapCur = mapId;
  const A = AREA[mapId];
  $('#mapView').classList.remove('hidden');
  $('#mapTabs').innerHTML = G.areas.filter(a => a.kind === 'map' && !a.yard).map(a => `<button data-map="${a.id}" class="${a.id === mapId ? 'primary' : ''}">${a.name}</button>`).join('');
  $('#mapTabs').querySelectorAll('[data-map]').forEach(b => b.onclick = () => { mapZoom = 1; openMap(b.dataset.map); });
  // the legend sits beside the map on wide screens and in landscape, under it on portrait phones
  const c = $('#bigMap'), W = A.w, H = A.h, land = innerWidth > innerHeight, wide = innerWidth > 820 || land;
  const legendW = innerWidth > 1100 ? 300 : land && innerWidth <= 1100 ? 230 : 300;
  const k = Math.max(2, Math.min((Math.min(innerWidth, 1180) - (wide ? legendW : 30)) / W, (innerHeight - (wide ? (land && innerHeight < 600 ? 100 : 140) : 330)) / H)) * mapZoom;
  $('#mapZoomLbl').textContent = `${Math.round(mapZoom * 100)}%`;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * k * dpr; c.height = H * k * dpr; c.style.width = W * k + 'px'; c.style.height = H * k + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // ground: flat colours, trees as soft dots, roads drawn clearly
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = G.map.tiles[A.y + y][A.x + x];
    g.fillStyle = SNOW && '.TBomg'.includes(ch) ? '#e6edf5' : MAP_COL[ch === 'T' || ch === 'B' || ch === 'o' ? '.' : ch] || '#8cc56f'; g.fillRect(x * k, y * k, k + .6, k + .6);
    if (ch === 'T') { g.fillStyle = '#4f8f43'; g.beginPath(); g.arc((x + .5) * k, (y + .5) * k, k * .45, 0, 7); g.fill(); }
  }
  drawZonesOnMap(g, A, k, false);
  const L = (x, y) => [(x - A.x) * k, (y - A.y) * k];
  const places = [], dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  // buildings as clean blocks
  for (const b of G.map.buildings) {
    if (b.x < A.x || b.x >= A.x + A.w) continue;
    const [bx, by] = L(b.x, b.y), mineHouse = b.house !== undefined && (me.house === b.house || me.rent?.idx === b.house);
    g.fillStyle = b.renov ? '#d9a21f' : b.deco ? '#b9a48f' : b.house !== undefined ? (mineHouse ? '#f2b636' : '#d98f6a') : isOpen(b.id) ? '#4d5b7a' : '#7a4a4a';
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(bx + 1, by + 1, b.w * k - 2, b.h * k - 2, Math.min(6, k)); g.fill(); g.stroke();
    if (b.deco || !b.st) { if (b.label) { g.font = `${Math.max(9, k * .8)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.icon, bx + b.w * k / 2, by + b.h * k / 2); } continue; }
    const h = b.house !== undefined ? houseInfo(b) : null;
    places.push({ key: b.house !== undefined ? 'door_' + b.id : b.st, icon: b.house !== undefined ? '🏠' : b.icon, label: b.house !== undefined ? `บ้าน #${b.house + 1}` : b.label,
      sub: b.house !== undefined ? (mineHouse ? '⭐ บ้านของฉัน' : h.label.replace(/^\S+\s/, '')) : `${isOpen(b.id) ? '🟢 เปิด' : '🔴 ปิด'} ${hoursTxt(b.id).replace('เปิด ', '')}`,
      x: bx + b.w * k / 2, y: by + b.h * k / 2, hl: mineHouse, kind: b.house !== undefined ? 'home' : 'bld' });
  }
  for (const s of G.stations) {
    if (s.area !== A.id || !/^(pier|gate|coop|farmbuy|estate|fishclub|lot|square)$/.test(s.type)) continue;
    if (s.type === 'lot' && !(me.garden?.lot === s.lot) && !(!wd?.lots?.[s.lot] && job('farmer'))) continue;
    const [x, y] = L(s.x, s.y);
    places.push({ key: s.id, icon: s.icon, label: s.type === 'lot' ? (me.garden?.lot === s.lot ? 'สวนของฉัน' : `สวนว่าง #${s.lot + 1}`) : s.label, sub: s.renov ? '🚧 ปิดปรับปรุงชั่วคราว' : s.type === 'gate' ? 'ทางไปแผนที่อื่น' : s.type === 'pier' ? 'จุดตกปลา' : '', x, y, hl: me.garden?.lot === s.lot, kind: s.type === 'gate' ? 'gate' : 'spot' });
  }
  if (mapId === 'town') { const [x, y] = L(50, 32); places.push({ key: 'seatb43.6', icon: '⛲', label: 'จัตุรัสกลางเมือง', sub: 'นั่งเล่น พูดคุย', x, y, kind: 'spot' }); }
  if (mapId === 'town') {   // the south district and the fountain square
    const pin = (key, icon, label, sub, tx, ty, kind = 'spot') => { const [x, y] = L(tx, ty); places.push({ key, icon, label, sub, x, y, kind }); };
    const pa = AREA.park, P0 = G.football?.pitch;
    if (pa) pin('ride_carousel', '🎡', 'สวนสนุก', 'เครื่องเล่น ร้านขนม ลูกโป่ง', pa.x + pa.w / 2, pa.y + pa.h / 2);
    if (P0) pin('seat_fb8_0', '⚽', 'สนามฟุตบอล', 'เตะบอลกับเพื่อน นั่งดูบนอัฒจันทร์', P0.x + P0.w / 2, P0.y + P0.h / 2);
    if (STN('pshop_sq')) pin('pshop_sq', '⛲', 'ลานน้ำพุ', 'ม้านั่ง · รถไอติม & ขนม', 56.5, 58.5);
  }
  const staffPl = [];   // (job staff pins were taken off the map)
  // place markers: the place's own symbol on a light badge (no numbered black dots); job staff are person pins with their career's symbol
  const r = clamp(k * .95, 8, 13);
  places.forEach(pl => {
    pl.n = pl.icon;
    dot(pl.x, pl.y, r + 2, pl.hl ? '#ffc94d' : pl.kind === 'gate' ? '#2f7fd1' : pl.kind === 'home' ? '#c0623e' : pl.kind === 'spot' ? '#2e8a57' : 'rgba(255,255,255,.55)');
    dot(pl.x, pl.y, r, 'rgba(255,255,255,.92)');
    g.font = `${Math.round(r * 1.25)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(pl.n, pl.x, pl.y + 1);
  });
  staffPl.forEach((pl, i) => {
    pl.n = pl.ci;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.moveTo(pl.x, pl.y + r * 1.5); g.arc(pl.x, pl.y - r * .2, r + 2, Math.PI * .8, Math.PI * 2.2); g.fill();
    g.fillStyle = pl.hl ? '#ffc94d' : '#8b4fc4'; g.beginPath(); g.moveTo(pl.x, pl.y + r * 1.3); g.arc(pl.x, pl.y - r * .2, r, Math.PI * .8, Math.PI * 2.2); g.fill();
    g.font = `${Math.round(r * 1.15)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pl.n, pl.x, pl.y - r * .15);
  });
  if (me.dogq?.kind === 'thief' && mapId === 'town') { const [x, y] = L(me.dogq.x, me.dogq.y); g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(x, y, r * 1.1, 0, 7); g.fill(); g.font = `${Math.round(r * 1.6)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🦹', x, y - r * 1.6); }
  if (me.dogq?.hc && mapId === 'town') { const [hx, hy, hr] = me.dogq.hc, [x, y] = L(hx, hy); g.strokeStyle = '#ffb300'; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath(); g.arc(x, y, hr * k, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,200,0,.12)'; g.fill(); g.font = `${Math.round(r * 1.6)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🐕', x, y); }
  // online players as coloured dots with their names; you are the big white dot with a ring
  let onHere = 0;
  for (const p of P.values()) {
    if (p.npc) continue;
    const q = outPos(p.x, p.y); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    const mine = p.id === myId, [x, y] = L(q.x, q.y);
    if (mine) { g.strokeStyle = '#ff6b3d'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 1.5, 0, 7); g.stroke(); dot(x, y, r * .8, '#fff'); continue; }
    onHere++;
    const col = p.adm ? `hsl(${(performance.now() / 8) % 360},90%,60%)` : COLORS[(p.id * 7 + (p.av || 0)) % COLORS.length];
    dot(x, y, r * .75, '#fff'); dot(x, y, r * .55, col);
    g.font = `700 ${Math.max(10, Math.round(r * .95))}px 'Mitr',sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(p.name, x, y - r * .8); g.fillStyle = '#fff'; g.fillText(p.name, x, y - r * .8);
  }
  if (guide) { const hop = guide.player ? null : guide; if (hop && mapOf(hop.area) === mapId) { const q = AREA[hop.area]?.kind === 'room' ? AREA[hop.area].outside : hop, [x, y] = L(q.x, q.y); g.strokeStyle = '#ffc94d'; g.lineWidth = 3; g.setLineDash([5, 4]); g.beginPath(); g.arc(x, y, r * 1.9, 0, 7); g.stroke(); g.setLineDash([]); } }
  // legend
  const here = roomOf(m.x, m.y);
  const row = pl => `<button data-key="${esc(pl.key)}" class="${pl.hl ? 'hl' : ''}"><i class="k-${pl.kind}">${pl.n}</i><span>${esc(pl.label)}${pl.sub ? `<small>${esc(pl.sub)}</small>` : ''}</span></button>`;
  $('#mapLegend').innerHTML = `<div class="lgHead">⚪ คุณอยู่${here ? `ใน${esc(here.label)}` : 'ที่วงสีส้ม'} · 🟢 ผู้เล่นออนไลน์บนแผนที่นี้ ${onHere} คน · แตะชื่อเพื่อนำทาง</div>`
    + `<div class="lgSec">📍 สถานที่</div>${places.map(row).join('')}`;
  places.push(...staffPl);
  $('#mapLegend').querySelectorAll('[data-key]').forEach(b => b.onclick = () => { closeMap(); setGuide(b.dataset.key, false, true); });
  if (!keepScroll && mapZoom > 1) { const q = outPos(m.x, m.y), [x, y] = L(q.x, q.y), box = $('#mapScroll'); box.scrollLeft = x - box.clientWidth / 2; box.scrollTop = y - box.clientHeight / 2; }
  c.onclick = e => {
    const rc = c.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    if (me.admin && me.god?.warp) { closeMap(); send({ t: 'god', op: 'warpto', x: +(A.x + x / k).toFixed(2), y: +(A.y + y / k).toFixed(2) }); return; }   // god mode: warp
    const hit = places.map(pl => [pl, Math.hypot(pl.x - x, pl.y - y)]).sort((a, b) => a[1] - b[1])[0];
    if (hit && hit[1] < r * 2.2) { closeMap(); setGuide(hit[0].key, false, true); }
  };
}
function closeMap() { $('#mapView').classList.add('hidden'); }

// first-time tutorial
const TUT = () => [
  ['👋', 'ยินดีต้อนรับสู่เมือง!', 'ตัวคุณคือตัวละครที่มีป้ายชื่อ<b>สีเหลือง</b> ผู้เล่นคนอื่นก็อยู่ในเมืองเดียวกัน'],
  ['👣', 'วิธีเดิน', 'มือถือ: <b>แตะค้างตรงไหนก็ได้แล้วลากนิ้ว</b><br>คอม: ปุ่ม <b>W A S D</b> หรือลูกศร'],
  ['🚪', 'เข้าอาคาร', 'เดินไปหน้าประตู แล้วกด<b>ปุ่มกลมสีเหลือง</b> (คอม: E) · ร้านต่างๆ มี<b>เวลาเปิด-ปิด</b> ดูได้ที่ป้าย'],
  ['🎣', 'หาเงินก้อนแรก', 'แนะนำให้<b>ตกปลา</b>ก่อน! ซื้อเบ็ดกับ<b>น้าเล็ก</b>ที่สมาคมประมง (ริมทะเลสาบ) แล้วไปท่าตกปลา · ยืนริมน้ำแล้วกดปุ่มใหญ่เหวี่ยงเบ็ด พอ<b>ทุ่นจมกดตวัด</b> กดค้างเย่อปลาเข้าฝั่ง แล้ว<b>ยกตอนปลาโผล่</b> · เอาปลาไปขายได้เลย'],
  ['💼', 'หางานทำ', 'คุณเริ่มต้น<b>ว่างงาน</b> · คุยกับ <b>NPC เจ้าหน้าที่ 💬</b> ที่ยืนข้างเคาน์เตอร์ เช่น พ่อค้า (คลังสินค้า), เกษตรกร (สหกรณ์ในไร่) · งานบริษัท/หมอต้องเรียนจบที่มหาวิทยาลัยก่อน'],
  ['❤️', 'ดูแลตัวเอง', 'กินให้อิ่ม ป่วยต้องหาหมอ · พลังงานหมดไป <b>สวนสนุก</b> 🎡 หรือ<b>นอนที่เตียงในบ้าน</b> 🛏️ · <b>แตะแถบสถานะ</b>เพื่อดูวิธีเพิ่ม · 💬 ปุ่ม<b>คุย</b>ไว้คุยกับคนใกล้ๆ'],
  ['🗺️', 'หลงทาง?', 'แตะ<b>แผนที่เล็ก</b>มุมขวาบน แล้วแตะสถานที่ จะมี<b>ลูกศรสีเหลือง</b>พาไป (ยกเลิกได้ที่ปุ่มใต้สถานะ) · เมนู 💼 บอกว่าแต่ละงานสมัครที่ไหน'],
];
let tutStep = 0, tutPending = false, pendingDaily = null;
function showTut(i = 0) {
  tutStep = i; const steps = TUT(), [icon, title, body] = steps[i];
  $('#tut').classList.remove('hidden');
  $('#tutBody').innerHTML = `<div class="tutIcon">${icon}</div><h2>${esc(title)}</h2><p>${body}</p><div class="dots">${steps.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>`;
  $('#tutNext').textContent = i === steps.length - 1 ? '🚀 เริ่มเล่น! (ไปซื้อเบ็ดตกปลา)' : 'ถัดไป →';
}
$('#tutNext').onclick = () => { FX.play('click'); if (tutStep < TUT().length - 1) return showTut(tutStep + 1); endTut(); };
$('#tutSkip').onclick = endTut;
function endTut() {
  tutPending = false; if (pendingDaily) { const d = pendingDaily; pendingDaily = null; setTimeout(() => showDaily(d), 600); }
  $('#tut').classList.add('hidden'); try { localStorage.setItem('lt_tut2', '1'); } catch { }
  if (me && me.career === 'none' && !me.rod) { setGuide('staff_fishing', true); toast('ลูกศรสีเหลืองจะพาไปหาน้าเล็ก ซื้อเบ็ดแล้วตกปลาหาเงินก้อนแรก!', '🎣'); }
  else if (me && me.career === 'none') openPanel({ kind: 'career' });
}
function showDaily(d) {
  const box = $('#daily');
  const L = d.login, bigIt = d.big?.item && G.shop.furniture[d.big.item];
  box.innerHTML = `<div class="tutIcon">${d.big ? '🎉' : '🎁'}</div><h2>โบนัสเข้าเกมวันที่ ${d.streak}</h2><p>เข้าเล่นทุกวันติดต่อกัน รางวัลจะเพิ่มขึ้นเรื่อยๆ${d.streak > 7 ? ' (หลังวันที่ 7 เพิ่มวันละ ฿10 สูงสุด ฿500)' : ''}</p>
    <div class="days">${d.table.map((v, i) => `<div class="${i + 1 < Math.min(d.streak, 7) ? 'got' : i + 1 === Math.min(d.streak, 7) ? 'now' : ''}"><small>วัน ${i + 1}${i === 6 ? '+' : ''}</small><b>฿${(i === 6 ? Math.max(v, d.reward) : v).toLocaleString()}</b></div>`).join('')}</div>
    <div class="big-reward">+${money(d.reward)}</div>
    ${d.big ? `<div class="bigGift">🎉 <b>รางวัลใหญ่ เข้าเกมครบ ${d.days} วัน!</b><br>+${money(d.big.cash)}${bigIt ? ` และ ${bigIt.icon} <b>${bigIt.name}</b> (เฟอร์นิเจอร์พิเศษ ความสบาย +${bigIt.comfort} ตั้งในบ้านให้อัตโนมัติ)` : ''}</div>` : ''}
    ${L ? `<div class="sub">พรุ่งนี้ได้ <b>${money(L.tomorrow)}</b> · อีก <b>${L.toBig}</b> วันถึงรางวัลใหญ่ 🎉</div>` : ''}
    <div class="rowf" style="margin-top:8px"><button id="dailyMore">📅 ดูความคืบหน้า</button><button class="primary big" id="dailyOk" style="flex:1">รับเลย!</button></div>`;
  $('#dailyWrap').classList.remove('hidden');
  $('#dailyOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); FX.play('coin', true); };
  $('#dailyMore').onclick = () => { $('#dailyWrap').classList.add('hidden'); FX.play('coin', true); openPanel({ kind: 'rewards' }); };
}
// driving test
function showDriveTest(m) {
  const qs = m.qs, box = $('#daily'), ans = [];
  box.innerHTML = `<div class="tutIcon">${m.lic === 'driving' ? '🪪' : '👮'}</div><h2>สอบ${esc(m.title)}</h2><p>ตอบให้ถูกทุกข้อ</p>${qs.map((q, i) => `<div class="dq"><b>${i + 1}. ${esc(q.q)}</b>${q.a.map((a, j) => `<button data-q="${i}" data-a="${j}">${esc(a)}</button>`).join('')}</div>`).join('')}<button class="primary big" id="dtOk" disabled>ส่งคำตอบ</button>`;
  $('#dailyWrap').classList.remove('hidden');
  box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const i = +b.dataset.q; ans[i] = +b.dataset.a;
    box.querySelectorAll(`[data-q="${i}"]`).forEach(x => x.classList.toggle('good', x === b));
    $('#dtOk').disabled = qs.some((_, k) => ans[k] === undefined);
  });
  $('#dtOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); doAct(m.st, 'answer', { ans }); };
}

// ------------------------------------------------------------------ areas, interiors
let roomGrid = [], roomFurniture = [], roomWalls = [];   // roomWalls: footprints [x0, x1, y0, y1] of the walls and screens players put up in their homes
const FURN_SPRITE = { rugr: 'f_rug_round', rugb: 'f_rug_blue', cactus: 'f_cactus', plant2: 'f_plant2', lamp: 'f_floorlamp', table: 'f_table_chairs', rtable: 'f_round_table', shelf: 'f_bookshelf', desk: 'f_laptop_desk', wardrobe2: 'f_wardrobe', mirror: 'f_mirror', armchair: 'f_armchair', bunk: 'f_bunk', coffee: 'f_coffee', winer: 'f_wine_rack',
  bookcase: 'f_bookshelf_wide', gclock: 'f_clock', teddy: 'i_teddy', flamp: 'f_floorlamp', vase: 'f_vase', plant: 'f_plant', sofa: 'f_sofa_red', tv: 'f_tv', bed: 'f_bed_pink', aqua: 'f_aquarium', art: 'f_pictures', piano: 'f_guitar', jacuzzi: 'f_bath' };
// where each piece of bought furniture stands in the house (by kind, so a home always looks arranged)
const FURN_POS = { sbed: [3.4, 3.3], bookcase: [4.6, 1.6], gclock: [6.3, 1.5], teddy: [2.9, 6.8], flamp: [10.2, 6.6], vase: [4.9, 4.3], tv: [8, 2.9], sofa: [8, 6.7], plant: [11, 8.7], aqua: [9.6, 8.7], art: [9.2, 1.05], piano: [1.1, 5.9], bed: [2.2, 6.2], jacuzzi: [11.8, 5.5] };
function buildAreas() {
  AREA = Object.fromEntries(G.areas.map(a => [a.id, a]));
  roomGrid = new Array(G.map.w * G.map.h);
  for (const r of G.areas) if (r.kind === 'room') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomGrid[y * G.map.w + x] = r;
  buildMini(); layoutFurniture();
}
// where a piece stands: [floor, x, y] in room tiles; [0] = put away; unplaced old pieces keep their default spot on floor 1
const fbase = k => String(k).split('#')[0];   // partition pieces are owned many times over: wdoor, wdoor#2 ...
const furnSpr = k => FURN_SPRITE[k] || G?.shop?.furniture?.[fbase(k)]?.spr;
const furnPos = (h, k) => { const p = h[7]?.[k]; if (p) return p[0] ? p : null; return FURN_POS[k] ? [1, FURN_POS[k][0], FURN_POS[k][1]] : null; };
// ---- arranging your home: pick a piece, tap the floor to move it, then confirm
let placing = null, picking = false, decoBack = false, myFurnHit = [];
// decorate mode without a piece in hand: tap something standing in your room to pick it up and move it
function startPick() {
  const m = P.get(myId), r = m && areaOf(m.x, m.y);
  if (!r || !(r.rk === 'house' || r.yard) || r.house !== me.house) return toast('เข้าไปในบ้านหรือสวนของคุณก่อน แล้วค่อยจัดวาง', '🏠', false);
  closePanel(); picking = true; decoBack = true; placeMode(true);
  $('#placeBar').innerHTML = `<b>✋ แตะของในห้องเพื่อย้าย</b><small>แตะเฟอร์นิเจอร์ที่วางอยู่ · ✓ เสร็จ · 📦 รายการของในคลัง</small><button id="plOk" style="display:none"></button><button id="plX" style="display:none"></button><button id="plStore" style="display:none"></button>`;
  $('#placeBar').classList.remove('hidden');
  $('#plOk').onclick = $('#plX').onclick = () => endPick();
  $('#plStore').onclick = () => { endPick(); openPanel({ kind: 'homedeco' }); };
  layoutFurniture();
}
function endPick() { picking = false; decoBack = false; $('#placeBar').classList.add('hidden'); placeMode(false); layoutFurniture(); }
function pickTap(wx, wy) {
  const m = P.get(myId), r = m && areaOf(m.x, m.y); if (!r) return;
  const fl = r.yard ? 9 : r.floor || 1;
  // the piece whose picture is under your finger (front-most first: the one standing lowest on screen)
  const hit = myFurnHit.filter(o => o.fl === fl && wx >= o.x - o.w / 2 && wx <= o.x + o.w / 2 && wy <= o.y + .15 && wy >= o.y - o.h).sort((a, b) => b.y - a.y)[0];
  if (!hit) return toast('แตะที่ตัวเฟอร์นิเจอร์ที่ต้องการย้าย', '✋', false);
  FX.play('click'); picking = false; startPlace(hit.k);
}
function startPlace(k) {
  const m = P.get(myId), r = m && areaOf(m.x, m.y);
  if (!r || !(r.rk === 'house' || r.yard) || r.house !== me.house) return toast('เข้าไปในบ้านหรือสวนของคุณก่อน แล้วค่อยจัดวาง', '🏠', false);
  closePanel(); picking = false; decoBack = true;   // after this piece: back to tap-to-move
  if (r.yard && G.shop.furniture[fbase(k)]?.tile) {   // soil: a brush - every tap lays the next tile from storage on that cell
    placing = { k, house: r.house, fl: 9, brush: true, bx: [.5, r.w - .5, 1, r.h - .5], x: Math.floor(m.x - r.x) + .5, y: Math.floor(m.y - r.y) + 1 };
    return placeBar(k);
  }
  if (r.yard && G.shop.furniture[fbase(k)]?.sprk) {   // sprinklers sit on a grid cell
    placing = { k, house: r.house, fl: 9, cell: true, bx: [.5, r.w - .5, 1, r.h - .5], x: Math.floor(m.x - r.x) + .5, y: Math.floor(m.y - r.y) + 1 };
    return placeBar(k);
  }
  if (r.yard) {                                  // out in the yard
    placing = { flip: !!furnPos(wd.houses[r.house], k)?.[3], k, house: r.house, fl: 9, bx: [.7, r.w - .7, 1.5, r.h - .8], x: clamp(Math.round((m.x - r.x) * 2) / 2, .7, r.w - .7), y: clamp(Math.round((m.y - r.y - .8) * 2) / 2, 1.5, r.h - .8) };
    return placeBar(k);
  }
  placing = { flip: !!furnPos(wd.houses[r.house], k)?.[3], k, house: r.house, fl: r.floor || 1, bx: [.7, 13.3, 1.2, 9.5], x: clamp(Math.round((m.x - r.x) * 2) / 2, 1, 13), y: clamp(Math.round((m.y - r.y - .6) * 2) / 2, 1.5, 9.3) };
  placeBar(k);
}
function placeBar(k) {
  const f = G.shop.furniture[fbase(k)];
  if (placing?.brush) {
    const left = (me.furniture || []).filter(o => G.shop.furniture[fbase(o)]?.tile && !furnPos(wd.houses[me.house], o)).length;
    $('#placeBar').innerHTML = `<b>🟫 วางแปลงดิน</b><small>แตะพื้นทีละช่อง ช่องที่ติดกันจะต่อเป็นแปลงเดียว · ในคลังเหลือ ${left} ช่อง</small><div class="pb"><button id="plOk" class="primary">✓ เสร็จ</button></div>`;
    $('#placeBar').classList.remove('hidden'); $('#plOk').onclick = () => { endPlace(); FX.play('click'); };
    layoutFurniture(); return;
  }
  placeMode(true);
  $('#placeBar').innerHTML = `<b>${f.icon} ${esc(f.name)}</b><small>แตะพื้นเพื่อเลื่อน · ✓ วาง · ✕ ยกเลิก · 🔄 หมุน · 📦 เก็บ</small><div class="pb" style="display:none">${['⬅️', '⬆️', '⬇️', '➡️'].map((a, i) => `<button data-nud="${i}">${a}</button>`).join('')}<button id="plOk" class="primary">✓ วาง</button><button id="plStore">📦 เก็บ</button><button id="plX">✕</button></div>`;
  $('#placeBar').classList.remove('hidden');
  $('#placeBar').querySelectorAll('[data-nud]').forEach(b => b.onclick = () => { const d = [[-.25, 0], [0, -.25], [0, .25], [.25, 0]][+b.dataset.nud]; placing.x = clamp(placing.x + d[0], placing.bx[0], placing.bx[1]); placing.y = clamp(placing.y + d[1], placing.bx[2], placing.bx[3]); layoutFurniture(); });
  $('#plOk').onclick = () => { const bad = placeBad(); if (bad) { FX.play('fail'); return toast(bad, '🧱', false); } send({ t: 'hplace', k, fl: placing.fl, x: placing.x, y: placing.y, flip: placing.flip ? 1 : 0 }); endPlace(); FX.play('click'); };
  $('#plStore').onclick = () => { send({ t: 'hplace', k, store: 1 }); endPlace(); };
  $('#plX').onclick = () => endPlace();
  layoutFurniture();
}
function endPlace() { placing = null; $('#placeBar').classList.add('hidden'); placeMode(false); layoutFurniture(); if (decoBack) startPick(); }
// while arranging: the big buttons bottom-right turn into the tools (✓ instead of run, ✕ instead of rest, 🔄 on the action button, 📦 instead of the bag)
const PLACE_BTN = { runBtn: ['✓', 'วาง', () => $('#plOk')?.click()], restBtn: ['✕', 'ยกเลิก', () => $('#plX')?.click()], bagBtn: ['📦', 'เก็บ', () => $('#plStore')?.click()] };
function placeMode(on) {
  document.body.classList.toggle('placing', on);
  const PL = { runBtn: 'เสร็จ', restBtn: 'ออก', bagBtn: 'คลังของ' };
  for (const [id, [ic, lb0]] of Object.entries(PLACE_BTN)) {
    const b = $('#' + id); if (!b) continue; const lb = picking ? PL[id] : lb0;
    if (on) { if (b.dataset.orig == null) b.dataset.orig = b.innerHTML; b.innerHTML = `<span>${ic}</span><small>${lb}</small>`; }
    else if (b.dataset.orig != null) { b.innerHTML = b.dataset.orig; delete b.dataset.orig; }
  }
  if (!on) { actIconKey = ''; if (me) $('#restBtn').innerHTML = me.pose === 'rest' ? '<span>🧍</span><small>ลุก</small>' : '<span>😌</span><small>พัก</small>'; }
  send({ t: 'decor', on: !!on });   // stats hold still while you decorate
}
for (const id of Object.keys(PLACE_BTN)) $('#' + id).addEventListener('click', e => { if (!placing && !picking) return; e.stopImmediatePropagation(); e.preventDefault(); FX.play('click'); PLACE_BTN[id][2](); }, true);
$('#actBtn').addEventListener('pointerdown', e => { if (picking) { e.stopImmediatePropagation(); e.preventDefault(); return; } if (!placing) return; e.stopImmediatePropagation(); e.preventDefault(); FX.play('click'); placing.flip = !placing.flip; layoutFurniture(); }, true);
$('#actBtn').addEventListener('pointerup', e => { if (placing || picking) { e.stopImmediatePropagation(); } }, true);
function nextSoil(skip) {                       // the next soil tile still in storage
  const h = wd?.houses?.[me.house]; if (!h) return null;
  return (me.furniture || []).find(o => o !== skip && G.shop.furniture[fbase(o)]?.tile && !furnPos(h, o)) || null;
}
function placeTap(wx, wy) {
  const r = AREA[placing.fl === 9 ? `yard${placing.house}` : `r_house${placing.house}` + (placing.fl > 1 ? `_f${placing.fl}` : '')]; if (!r) return;
  if (placing.brush) {
    const cx = Math.floor(wx - r.x), cy = Math.floor(wy - r.y);
    send({ t: 'hplace', k: placing.k, fl: 9, x: cx + .5, y: cy + 1 }); FX.play('click');
    const nk = nextSoil(placing.k); if (!nk) { toast('วางแปลงดินครบแล้ว ซื้อเพิ่มได้ที่ร้านเฟอร์นิเจอร์ (แท็บสวน)', '🟫'); return endPlace(); }
    placing.k = nk; placing.x = cx + 1.5; placing.y = cy + 1; placeBar(nk); return;
  }
  if (placing.cell) { placing.x = clamp(Math.floor(wx - r.x) + .5, placing.bx[0], placing.bx[1]); placing.y = clamp(Math.floor(wy - r.y) + 1, placing.bx[2], placing.bx[3]); return layoutFurniture(); }
  placing.x = clamp(Math.round((wx - r.x) * 4) / 4, placing.bx[0], placing.bx[1]); placing.y = clamp(Math.round((wy - r.y + .3) * 4) / 4, placing.bx[2], placing.bx[3]); layoutFurniture();
}
// can the piece in hand stand here? not poking into the room's walls, and not through a partition wall (nor a wall through furniture)
const FLATF = sp => /rug|mat|carpet/.test(sp || '');
function placeBad() {
  if (!placing || placing.brush) return '';
  const f = G.shop.furniture[fbase(placing.k)], sp = furnSpr(placing.k), a = atlas?.sprites?.[sp]; if (!f || !a) return '';
  const hw = a[2] / atlas.tile / 2 - .12, isWall = f.cat === 'wall', h = wd?.houses?.[placing.house]; if (!h) return '';
  if (placing.fl !== 9) { const r = AREA[`r_house${placing.house}` + (placing.fl > 1 ? `_f${placing.fl}` : '')]; if (r && (placing.x - hw < 1 - .05 || placing.x + hw > r.w - 1 + .05)) return 'วางทะลุกำแพงไม่ได้ ขยับเข้ามาในห้องอีกนิด'; }
  if (FLATF(sp)) return '';
  if (placing.cell) { const cx = Math.floor(placing.x), cy = Math.round(placing.y) - 1;
    return h[2].some(k => k !== placing.k && furnPos(h, k)?.[0] === 9 && (G.shop.furniture[fbase(k)]?.tile || G.shop.furniture[fbase(k)]?.sprk) && Math.floor(furnPos(h, k)[1]) === cx && Math.round(furnPos(h, k)[2]) - 1 === cy) ? 'ช่องนี้มีแปลงดินหรือสปริงเกลอร์อยู่แล้ว' : ''; }
  for (const k of h[2]) {
    if (k === placing.k) continue; const g = G.shop.furniture[fbase(k)], p = furnPos(h, k); if (!g || !p || p[0] !== placing.fl) continue;
    if ((g.cat === 'wall') === isWall || FLATF(furnSpr(k))) continue;          // walls may meet walls; rugs lie under anything
    const b = atlas?.sprites?.[furnSpr(k)]; if (!b) continue; const ow = b[2] / atlas.tile / 2 - .12;
    if (Math.abs(p[1] - placing.x) < hw + ow && Math.abs(placing.y - p[2]) < .6) return isWall ? `ผนังทะลุ${g.name}ไม่ได้ ย้ายของออกก่อนหรือวางที่อื่น` : 'วางทะลุกำแพงไม่ได้ ขยับออกจากผนังกั้นห้องก่อน';
  }
  return '';
}
function drawStairs(x, y, down, X, Y) {   // a little staircase drawn on the floor (no sprite for it in the atlas)
  const px = x * TS + X, py = y * TS + Y, w = TS * 1.3, n = 5, sh = TS * .2;
  for (let i = 0; i < n; i++) {
    const k = down ? i : n - 1 - i, yy = py - (n - i) * sh;
    ctx.fillStyle = k % 2 ? '#a0703f' : '#b9834c'; ctx.fillRect(px - w / 2, yy, w, sh);
    ctx.fillStyle = '#6b4423'; ctx.fillRect(px - w / 2, yy + sh - 2, w, 2);
  }
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(px - w / 2 - 3, py - n * sh, 3, n * sh); ctx.fillRect(px + w / 2, py - n * sh, 3, n * sh);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(TS * .3)}px 'Mitr',sans-serif`; ctx.textAlign = 'center'; ctx.fillText(down ? '⬇' : '⬆', px, py - n * sh - 4);
}
// soil autotile: grass shows on each side that has no soil next to it (see tools/add_soil.py for the piece order)
// the connected bed of soil tiles a tile belongs to (same rule as the server)
function soilBedOf(h, k) {
  const cell = o => { const p = furnPos(h, o); return p && p[0] === 9 && G.shop.furniture[fbase(o)]?.tile ? `${Math.floor(p[1])},${Math.round(p[2]) - 1}` : null; };
  const at = new Map(); for (const o of h[2]) { const c = cell(o); if (c) at.set(c, o); }
  const out = [k], seen = new Set([cell(k)]);
  for (let i = 0; i < out.length; i++) { const [x, y] = cell(out[i]).split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = `${x + dx},${y + dy}`; if (at.has(c) && !seen.has(c)) { seen.add(c); out.push(at.get(c)); } } }
  return out;
}
function soilSprite(set, x, y) {
  const n = set.has(`${x},${y - 1}`), s = set.has(`${x},${y + 1}`), w = set.has(`${x - 1},${y}`), e = set.has(`${x + 1},${y}`);
  const open = (!n) + (!s) + (!w) + (!e);
  const i = open === 0 ? 0 : open >= 3 ? 15 : open === 1 ? (!n ? 1 : !s ? 2 : !w ? 3 : 4)
    : !n && !w ? 5 : !n && !e ? 6 : !s && !w ? 7 : !s && !e ? 8 : !n && !s ? 13 : 14;
  return 'y_soil' + i;
}
function addWall(f, sp, x, y) {               // solid pieces block a strip along their base (sw: a narrower trunk for trees, lamps...)
  if (!f?.solid) return; const a = atlas?.sprites?.[sp], hw = f.sw ? f.sw / 2 : (a ? a[2] / atlas.tile / 2 : 1.4) - .1;
  roomWalls.push([x - hw, x + hw, y - .45, y]);
}
function layoutFurniture() {
  roomFurniture = []; roomWalls = []; myFurnHit = [];
  const hitAdd = (r, k, sp, pos) => { if (r.house !== me?.house) return; const a = atlas?.sprites?.[sp]; if (a) myFurnHit.push({ k, fl: pos[0], x: r.x + pos[1], y: r.y + pos[2], w: a[2] / atlas.tile, h: a[3] / atlas.tile }); };
  for (const r of G.areas) {
    if (r.yard) {                              // the owner's garden pieces out in the yard (floor 9)
      const h = wd?.houses?.[r.house]; if (!h) continue;
      const soil = new Set(); for (const k of h[2]) { const p = furnPos(h, k); if (p && p[0] === 9 && G.shop.furniture[fbase(k)]?.tile) soil.add(`${Math.floor(p[1])},${Math.round(p[2]) - 1}`); }
      for (const k of h[2]) {
        if (placing && placing.house === r.house && placing.k === k) continue;
        const pos = furnPos(h, k); let sp = furnSpr(k); if (!(pos && pos[0] === 9 && sp)) continue;
        const f = G.shop.furniture[fbase(k)];
        if (f?.tile) sp = soilSprite(soil, Math.floor(pos[1]), Math.round(pos[2]) - 1);   // joins up with the soil next to it
        roomFurniture.push([sp, r.x + pos[1], r.y + pos[2], null, f?.field ? { k, house: r.house, tile: !!f.tile } : f?.sprk ? { k, house: r.house, spk: f.sprk } : null, pos[3]]); hitAdd(r, k, sp, pos);
        addWall(f, sp, r.x + pos[1], r.y + pos[2]);
      }
      if (placing && placing.house === r.house && placing.fl === 9) roomFurniture.push([furnSpr(placing.k), r.x + placing.x, r.y + placing.y, 'ghost', G.shop.furniture[fbase(placing.k)]?.sprk ? { spk: G.shop.furniture[fbase(placing.k)].sprk, ghost: 1 } : null, placing.flip]);
      continue;
    }
    if (r.kind !== 'room') continue;
    for (const f of r.furniture || []) roomFurniture.push(f);
    if (r.rk === 'house') {
      const h = wd?.houses?.[r.house], fl = r.floor || 1; if (!h) continue;
      if (fl === 1) { const bs = G.stations.find(x => x.id === 'hbed' + r.house), bp = h[0] ? furnPos(h, 'sbed') : null; if (bs) { if (!h[0]) { bs.x = r.x + 3.4; bs.y = r.y + 3.7; } else if (bp && bp[0] === 1) { bs.x = r.x + bp[1]; bs.y = r.y + bp[2] + .4; } } }
      for (const k of h[2]) {
        if (placing && placing.house === r.house && placing.k === k) continue;   // the piece being moved is drawn at the cursor
        const pos = furnPos(h, k), sp = furnSpr(k); if (!(pos && pos[0] === fl && sp)) continue;
        roomFurniture.push([sp, r.x + pos[1], r.y + pos[2], null, null, pos[3]]); hitAdd(r, k, sp, pos);
        addWall(G.shop.furniture[fbase(k)], sp, r.x + pos[1], r.y + pos[2]);
      }
      if (placing && placing.house === r.house && placing.fl === fl) roomFurniture.push([furnSpr(placing.k), r.x + placing.x, r.y + placing.y, 'ghost', null, placing.flip]);
    }
  }
}
function drawRoomLabels(r, X, Y, t) {
  const px = r.x * TS + X, py = r.y * TS + Y;
  const h = r.rk === 'house' ? wd?.houses?.[r.house] : null;
  sign(r.rk === 'house' ? (h && h[0] ? `🏠 บ้านของ ${h[0]}` : `🏠 บ้านเลขที่ ${r.house + 1}`) + (r.floor ? ` · ชั้น ${r.floor}` : (h && h[8] ? ' · ชั้น 1' : '')) : `${r.icon} ${r.label}`, px + r.w * TS / 2, py - TS * .1, { size: TS * .34, border: '#ffc94d88' });
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
  if (!r.floor) ctx.fillText('⬇ ทางออก', px + Math.floor(r.w / 2) * TS, py + (r.h + .45) * TS + Math.sin(t / 300) * 2);
}

// ---- atmosphere: dusk/dawn colour grade, fireflies at night, morning mist, drifting leaves/petals, rain ripples
const ATM = { fly: null, leaf: null, rip: [] };
function drawAtmos(t, night, A) {
  if (!A) return;
  const h = hourNow(), rain = wd?.ev?.id === 'rain';
  // dusk (16.5-19.5) glows orange-pink along the horizon; dawn (5-7.5) is peach and cool
  const dusk = clamp(1 - Math.abs(h - 18) / 1.6, 0, 1), dawn = clamp(1 - Math.abs(h - 6.2) / 1.3, 0, 1);
  if ((dusk > .02 || dawn > .02) && !rain) {
    const g = ctx.createLinearGradient(0, 0, 0, VH), a = Math.max(dusk, dawn);
    if (dusk >= dawn) { g.addColorStop(0, `rgba(120,60,150,${.28 * a})`); g.addColorStop(.55, `rgba(255,120,80,${.20 * a})`); g.addColorStop(1, `rgba(255,170,90,${.36 * a})`); }
    else { g.addColorStop(0, `rgba(255,170,150,${.14 * a})`); g.addColorStop(.6, `rgba(255,214,170,${.10 * a})`); g.addColorStop(1, `rgba(120,150,210,${.16 * a})`); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  }
  // deep night: cool moonlight vignette so the middle of the screen stays readable
  if (night > .25) { const k = (night - .25) / .3, v = ctx.createRadialGradient(VW / 2, VH * .55, Math.min(VW, VH) * .25, VW / 2, VH * .55, Math.hypot(VW, VH) * .6); v.addColorStop(0, 'rgba(60,90,180,0)'); v.addColorStop(1, `rgba(4,8,30,${.32 * k})`); ctx.fillStyle = v; ctx.fillRect(0, 0, VW, VH); }
  // morning mist: slow pale bands drifting across, gone by 8:30
  const mist = clamp(1 - Math.max(0, h - 5) / 3.4, 0, 1) * (h < 9 && h > 4.2 ? 1 : 0) + (rain ? .35 : 0);
  if (mist > .03) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const x = ((t / (26000 + i * 7000) + i * .27) % 1.4 - .2) * VW * 1.4 - VW * .2, y = VH * (.18 + i * .22) + Math.sin(t / 5000 + i) * 14, w = VW * .9, hh = VH * .22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, w * .6); g.addColorStop(0, `rgba(235,240,250,${.2 * mist})`); g.addColorStop(1, 'rgba(235,240,250,0)');
      ctx.translate(0, y); ctx.scale(1, hh / (w * .6)); ctx.translate(0, -y); ctx.fillStyle = g; ctx.fillRect(x - w, y - w, w * 2, w * 2); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    ctx.restore();
  }
  // fireflies: only on grassy maps at night
  if (night > .3 && !rain && (A.id === 'park' || A.id === 'temple' || A.id === 'farm' || A.id === 'housing' || A.id === 'town')) {
    if (!ATM.fly) ATM.fly = Array.from({ length: ECO ? 14 : 24 }, () => [Math.random(), Math.random(), Math.random() * 6.28, .4 + Math.random() * .8]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const f of ATM.fly) {
      const x = (f[0] + Math.sin(t / 3100 * f[3] + f[2]) * .06) * VW, y = (f[1] + Math.cos(t / 2300 * f[3] + f[2]) * .05) * VH, tw = .5 + .5 * Math.sin(t / 420 * f[3] + f[2]);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, `rgba(210,255,140,${.8 * tw})`); g.addColorStop(1, 'rgba(210,255,140,0)'); ctx.fillStyle = g; ctx.fillRect(x - 9, y - 9, 18, 18);
    }
    ctx.restore();
  }
  // a small flock crosses the sky now and then (daytime, open maps)
  if (night < .3 && !rain && (A.id === 'town' || A.id === 'park' || A.id === 'farm' || A.id === 'housing')) {
    const per = 38000, ph = (t % per) / per;
    if (ph < .32) {
      const q = ph / .32, fx = -60 + q * (VW + 120), fy = VH * (.12 + .06 * Math.sin(q * 3)), flap = t / 110;
      ctx.save(); ctx.strokeStyle = 'rgba(40,40,60,.7)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) { const bx = fx - Math.abs(i - 2) * 18 - (i > 2 ? 0 : 0), by = fy + (i - 2) * 9 + Math.abs(i - 2) * 6, w = Math.sin(flap + i * .8) * 4.5 + 1;
        ctx.beginPath(); ctx.moveTo(bx - 8, by - w); ctx.quadraticCurveTo(bx - 3, by - w * .2 + 2, bx, by); ctx.quadraticCurveTo(bx + 3, by - w * .2 + 2, bx + 8, by - w); ctx.stroke(); }
      ctx.restore();
    }
  }
  // leaves and petals drift down in the daytime on open maps (the temple already has its own)
  if (night < .3 && !rain && A.id !== 'temple') {
    if (!ATM.leaf) ATM.leaf = Array.from({ length: ECO ? 7 : 12 }, () => [Math.random(), Math.random(), Math.random() * 6.28, .5 + Math.random() * .7, Math.floor(Math.random() * 3)]);
    const cols = A.id === 'park' || A.id === 'housing' ? ['#ffc4d6', '#ffe0ea', '#fff3b0'] : ['#9ccc5c', '#c7d96a', '#e2b95c'];
    ctx.save();
    for (const f of ATM.leaf) {
      const sp = .018 * f[3], y = ((f[1] + t / 1000 * sp) % 1.1 - .05) * VH, x = ((f[0] + t / 1000 * .012 * f[3]) % 1.1 - .05) * VW + Math.sin(t / 900 * f[3] + f[2]) * 18;
      ctx.translate(x, y); ctx.rotate(t / 700 * f[3] + f[2]); ctx.scale(1, .5 + .5 * Math.abs(Math.sin(t / 500 * f[3] + f[2]))); ctx.fillStyle = cols[f[4]]; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2.4, 0, 0, 7); ctx.fill(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    ctx.restore();
  }
  // rain: rings spread on the ground where drops land
  if (rain) {
    if (ATM.rip.length < (ECO ? 10 : 18) && Math.random() < .5) ATM.rip.push([Math.random() * VW, VH * .25 + Math.random() * VH * .75, t]);
    ctx.save(); ctx.strokeStyle = 'rgba(210,230,255,.55)'; ctx.lineWidth = 1;
    for (let i = ATM.rip.length - 1; i >= 0; i--) { const r = ATM.rip[i], p = (t - r[2]) / 650; if (p >= 1) { ATM.rip.splice(i, 1); continue; } ctx.globalAlpha = (1 - p) * .7; ctx.beginPath(); ctx.ellipse(r[0], r[1], 2 + p * 11, (2 + p * 11) * .42, 0, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
}
let rainDrops = null;
function drawRain(t) {
  if (wd?.ev?.id !== 'rain') return;
  if (!rainDrops) rainDrops = Array.from({ length: ECO ? 80 : 130 }, () => [Math.random(), Math.random(), .6 + Math.random() * .6]);
  ctx.strokeStyle = 'rgba(190,215,255,.45)'; ctx.lineWidth = 1.4; ctx.beginPath();
  for (const d of rainDrops) {
    const x = ((d[0] * VW + t * .12 * d[2]) % (VW + 40)) - 20, y = ((d[1] * VH + t * .9 * d[2]) % (VH + 40)) - 20;
    ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 16);
  }
  ctx.stroke(); ctx.fillStyle = 'rgba(40,60,90,.12)'; ctx.fillRect(0, 0, VW, VH);
}
function dzInfo(id) {
  if (id === '_sleepy') return toast('ไม่ได้นอนนานแล้ว นั่งพักหลับตา (😌) หรือนอนที่บ้าน ไม่งั้นจะป่วยเป็นอดนอน', '🥱', false);
  if (id === '_sad') return toast('ความสุขต่ำมาก ทำงานไม่ได้ · กินของที่อยากกิน นั่งเล่นที่จัตุรัส โทรหาเพื่อน บริจาคให้ขอทาน นอนในบ้านตัวเอง', '😞', false);
  if (id === '_crave') return toast(`อยากกิน${G.items[me.craving.item].name} หาซื้อที่ตลาด/ร้านอาหาร แล้วกินภายในเวลาจะมีความสุขเพิ่มมาก`, '🤤');
  if (id === '_bills') return openPanel({ kind: 'phone', tab: 'bills' });
  if (id === '_study') return toast('กำลังนั่งเรียน นั่งครบ 1 ชั่วโมงในเกมได้ 1 คาบ (เดินเพื่อลุก)', '📖');
  if (id === '_duty') return toast(`เข้าเวรอยู่ในโรงพยาบาล ได้เงินเดือนทุกชั่วโมงจนถึง ${hhmm(G.doctor.end)} (ออกจากโรงพยาบาล = หยุดนับ)`, '🩺');
  if (id === '_lic') return toast('ใบขับขี่หมดอายุ ต่ออายุได้ที่โชว์รูมรถ', '🪪', false);
  if (id === '_hungry') return toast('หิวมาก หิวนานๆ เลือดจะลด ถ้าหมดหลอดจะล้มนอนเป็นผัก รีบหาอะไรกิน', '🍗', false);
  const d = G.diseases[id];
  toast(`${d.name}: ${d.sym.join(', ')} · สาเหตุ: ${d.cause} · ${d.self}`, d.icon, false);
}

// ------------------------------------------------------------------ fishing: cast, strike, play the fish, lift it out
// Everything happens in the world on the big button. Wait: the float bobs, small nibbles dip it (striking then scares
// the fish). Bite: the float is yanked under - strike now. Fight: hold = reel in, let go = give line. A running fish
// pulls hard: keep reeling and the line snaps; give it line for too long and it runs off; leave the line slack and the
// hook slips. A tired fish reeled all the way in is landed on the bank at once.
let fishBiteT = 0, FG = null, reelHold = false, nibble = { at: 0, t: 0 };
function strike() {
  if (!me?.cast || !waterNear) return;
  FX.play(me.cast.state === 'bite' ? 'splash' : 'fail'); doAct('water', 'hook');
}
function fightStart(f) {
  const r = (n => () => (n = (n * 16807) % 2147483647) / 2147483647)(f.seed || 7);
  FG = { ...f, rnd: r, t0: performance.now(), dist: 1, ten: .35, sta: 1, run: false, pt: performance.now() + 400, slack: 0, mode: 'fight', miss: 0, surf: 0, surfEnd: 0, lastTick: 0, str0: 0, sway: r() * 6 };
  FX.play('splash'); if (navigator.vibrate) navigator.vibrate(120); if (bobber) { FX.ring(bobber.x, bobber.y, '#fff', 700, 1.3); FX.burst(bobber.x, bobber.y, '#dff4ff', 14); }
}
function fightEnd(ok, why) {
  if (!FG) return; FG = null; reelHold = false;
  if (ok) { doAct('water', 'land'); FX.play('landfish'); const s = P.get(myId); if (s) FX.burst(s.x, s.y - .2, '#dff4ff', 16); }
  else { doAct('water', 'lose', { why }); FX.play(why === 'snap' ? 'snap' : 'fail'); if (navigator.vibrate) navigator.vibrate(why === 'snap' ? [40, 30, 40] : 30); }
}
// a press: in the land phase it is the lift; otherwise just the start of a hold
function fightPress() {
  if (!FG || FG.mode !== 'land') return;
  const now0 = performance.now();
  if (now0 >= FG.surf && now0 <= FG.surfEnd) return fightEnd(true);
  FG.miss++; FG.ten = Math.min(.9, FG.ten + .15); FX.play('splash'); if (fishAt()) FX.ring(fishAt().x, fishAt().y, '#fff', 400, .7);
  if (FG.miss >= 10) fightEnd(false, 'miss');
}
function stepFight(dt) {
  if (!FG) return;
  if (!me?.cast && performance.now() - FG.t0 > 1500) { FG = null; reelHold = false; return; }   // (the 'me' update can arrive a moment after 'hooked')
  const now0 = performance.now(), r = FG.rnd, hold = reelHold, el = now0 - FG.t0;
  if (FG.mode === 'fight') {
    if (now0 > FG.pt) {                                    // the fish alternates between runs and rests
      FG.run = !FG.run; if (FG.run) FX.play("zing");
      FG.pt = now0 + (FG.run ? (700 + r() * 1100) * (.7 + FG.pow * .6) : (900 + r() * 1400) * (1.3 - FG.pow * .5));
      FG.str0 = FG.pow * (.6 + r() * .6) * (.45 + FG.sta * .55);
      if (FG.run) { if (navigator.vibrate) navigator.vibrate(Math.round(40 + FG.str0 * 80)); const f = fishAt(); if (f) FX.ring(f.x, f.y, '#fff', 500, .5 + FG.str0); }
    }
    if (FG.run) {
      const st = FG.str0;
      if (hold) { FG.ten += .7 * st / FG.str * dt * 1.15; FG.dist -= .02 * dt; FG.sta -= .16 * st * dt; }
      else { FG.ten += (st * .25 - .6) * dt; FG.dist += .07 * st * dt; FG.sta -= .07 * st * dt; }
      if (Math.random() < dt * 6) { const f = fishAt(); if (f) FX.burst(f.x, f.y, '#e8f7ff', 2); }
    } else {
      if (hold) { FG.dist -= 1.35 * (.24 + .16 * (1 - FG.pow)) * (.55 + .45 * (1 - FG.sta)) * dt * (1 + (FG.str - 1) * .5); FG.ten += (.45 - FG.ten) * 2.2 * dt; }
      else { FG.ten -= .55 * dt; FG.sta = Math.min(1, FG.sta + .025 * dt); }
    }
    FG.ten = Math.max(0, FG.ten); FG.sta = Math.max(0, FG.sta);
    FG.slack = FG.ten < .08 ? FG.slack + dt : Math.max(0, FG.slack - dt * 2);
    if (hold && now0 - FG.lastTick > (FG.run ? 140 : 85)) { FG.lastTick = now0; FX.play('reel', FG.ten); }
    if (FG.ten > .78 && Math.random() < dt * 4) FX.play('creak', FG.ten);
    if (FG.ten >= 1) return fightEnd(false, 'snap');
    if (FG.dist >= 2.7) return fightEnd(false, 'run');
    if (FG.slack > 8) return fightEnd(false, 'slack');
    if (FG.dist <= .12) {
      if (el < (FG.min || 0) + 400) FG.dist = .13;              // (the server wants a little fight first)
      else return fightEnd(true);                            // reeled all the way in: the fish comes straight up onto the bank
    }
  } else {                                                   // at the bank: it thrashes and breaks the surface now and then
    FG.ten = .55 + Math.sin(now0 / 90) * .12;
    if (now0 > FG.surfEnd) { FG.surf = now0 + 450 + r() * 450; FG.surfEnd = FG.surf + FG.land; }
    if (now0 >= FG.surf && !FG.splashed) { FG.splashed = true; FX.play('splash'); const f = fishAt(); if (f) { FX.ring(f.x, f.y, '#fff', 450, .9); FX.burst(f.x, f.y - .2, '#e8f7ff', 8); } }
    if (now0 > FG.surfEnd) FG.splashed = false;
    if (now0 - FG.landT > 11000) { FG.mode = 'fight'; FG.dist = .45; FG.run = true; FG.pt = now0 + 1200; FG.str0 = FG.pow; FG.miss = 0; }   // it dives again
  }
}
// where the hooked fish is: out along the cast line, swinging side to side, closer as you reel it in
function fishAt() {
  const s = P.get(myId); if (!s || !bobber) return null;
  const dx = bobber.x - s.rx, dy = bobber.y - s.ry, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const d = FG ? .7 + FG.dist * (L - .7 + .6) : L, t = performance.now() / 1000;
  const sw = FG ? Math.sin(t * (FG.run ? 2.6 : 1.1) + FG.sway) * (.25 + .55 * FG.dist) * (FG.mode === 'land' ? .4 : 1) : 0;
  return { x: s.rx + ux * d - uy * sw, y: s.ry + uy * d + ux * sw };
}
// the big button's icon: set only when it changes (an emoji, or the drawn fishing rod)
let actIconKey = '';
function actIco(txt, html) { const k = html ? txt : 'T' + txt; if (k === actIconKey) return; actIconKey = k; const el = $('#actIcon'); if (html) el.innerHTML = html; else el.textContent = txt; }
// the fishing rod on the big button: the rod you hold (its colour), bending with the pull, the line to the float / fish
const ROD_COL = { bamboo: ['#c9a35a', '#8a6a2c'], fiber: ['#3a7bd5', '#1d4e8f'], carbon: ['#3b3b44', '#15151a'], pro: ['#1f8a5b', '#0f5236'], gold: ['#f2c94c', '#a87a12'], dragon: ['#b23ad6', '#5e157a'] };
function actRod() {
  const c = me.cast, st = !c ? 'idle' : c.state === 'wait' ? 'wait' : c.state === 'bite' ? 'bite' : FG?.mode === 'land' ? 'land' : 'fight';
  const ten = st === 'fight' ? Math.round((FG?.ten || 0) * 4) : st === 'bite' ? 2 : 0, rod = me.rodEq || 'bamboo', key = `rod:${rod}:${st}:${ten}:${reelHold ? 1 : 0}`;
  if (key === actIconKey) return;
  const [c1, c2] = ROD_COL[rod] || ROD_COL.bamboo;
  // a clean rod: grip bottom-left, the rod arcs up to the tip; the tip bends down a little with the pull
  const bend = [0, 2, 4, 6, 8][ten], tip = [38, 9 + bend * .4], grip = [9, 39], ctrl = [24, 16 - bend * .3];
  const lineCol = ten >= 3 ? '#ff5a4a' : ten >= 2 ? '#ffd34d' : '#ffffff';
  const hook = st === 'idle' ? '' : st === 'wait' ? `<line x1="${tip[0]}" y1="${tip[1]}" x2="36" y2="42" stroke="${lineCol}" stroke-width="1"/><circle cx="36" cy="42" r="3.2" fill="#fff" stroke="#3e2414" stroke-width=".8"/><path d="M33.2 42a2.8 2.8 0 0 1 5.6 0z" fill="#e0453a"/>`
    : st === 'bite' ? `<line x1="${tip[0]}" y1="${tip[1]}" x2="36" y2="41" stroke="${lineCol}" stroke-width="1.2"/><circle cx="36" cy="43" r="3" fill="#fff" stroke="#3e2414" stroke-width=".8"/><text x="41" y="16" font-size="13" font-weight="900" fill="#ffd34d" stroke="#3e2414" stroke-width="1">!</text>`
    : `<line x1="${tip[0]}" y1="${tip[1]}" x2="34" y2="40" stroke="${lineCol}" stroke-width="1.4"/><path d="M29 42q5-4 10 0q-5 4-10 0z" fill="#9fb3c2" stroke="#26323a" stroke-width=".8"/>`;
  const rodPath = `M${grip[0]} ${grip[1]} Q${ctrl[0]} ${ctrl[1]} ${tip[0]} ${tip[1]}`;
  actIco(key, `<svg class="rodIco ${st}" viewBox="0 0 48 48" width="44" height="44"><path d="${rodPath}" fill="none" stroke="#3e2414" stroke-width="4.2" stroke-linecap="round"/><path d="${rodPath}" fill="none" stroke="${c1}" stroke-width="2.2" stroke-linecap="round"/><path d="M${grip[0]} ${grip[1]} L${grip[0] + 6} ${grip[1] - 6}" stroke="#7a4a22" stroke-width="4.2" stroke-linecap="round"/><circle cx="16" cy="30" r="3.6" fill="#c8ccd2" stroke="#3e2414" stroke-width="1.2"/><circle cx="16" cy="30" r="1.3" fill="${c2}"/>${hook}</svg>`);
}
// the big cue on screen while fishing (strike now / hold to reel / let it run / lift it out)
function paintFishCue() {
  const el = $('#fishCue'); if (!el) return;
  const c = me?.cast; if (!c || near?.type !== 'pier') { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
  const [ic, txt] = fishCue(), cls = c.state === 'bite' ? 'bite' : !FG ? 'wait' : FG.mode === 'land' ? 'land' : FG.ten > .78 ? 'warn' : FG.slack > 1.2 ? 'warn' : reelHold ? 'reel' : 'hold';
  const sub = { wait: 'ทุ่นไหวเบาๆ = ปลาแค่แตะ อย่าเพิ่งกด', bite: 'ทุ่นจมแล้ว! กดปุ่มใหญ่ทันที', hold: 'กดค้างปุ่มใหญ่เพื่อกรอสาย', reel: 'ดีมาก! ดูสีสาย ถ้าแดงให้ปล่อย', warn: FG && FG.ten > .78 ? 'สายตึงจะขาด! ปล่อยนิ้วก่อน' : 'สายหย่อนนานเบ็ดจะหลุด กรอสาย!', land: 'ปลาหมดแรงแล้ว แตะตอนมันกระโดดโผล่' }[cls];
  const html = `<b>${ic} ${txt}</b><small>${sub}</small>`;
  if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
  el.className = 'fc-' + cls;
}
// the big button's icon + label while fishing
function fishCue() {
  const c = me?.cast; if (!c) return ['🎣', 'เหวี่ยงเบ็ด'];
  if (c.state === 'wait') return ['⏳', 'รอปลากินเบ็ด...'];
  if (c.state === 'bite') return ['‼️', 'ตวัด!'];
  if (!FG) return ['🎣', 'กำลังสู้กับปลา'];
  if (FG.mode === 'land') return ['🐟', 'ยกตอนปลาโผล่!'];
  if (FG.ten > .78) return ['⚠️', reelHold ? 'ปล่อยสาย!' : 'สายตึงมาก'];
  if (FG.slack > 1.2) return ['〰️', 'สายหย่อน กรอ!'];
  return reelHold ? ['🌀', 'กรอสาย...'] : ['✊', 'กดค้าง = กรอสาย'];
}

// ------------------------------------------------------------------ sound & effects glue
let stepAcc = 0, bobber = null;
function paintMute() { }
// a quick soft flash over the whole screen for big moments (level up, big money)
function flashScreen(rgb, a0) { const d = document.createElement('div'); d.style.cssText = `position:fixed;inset:0;z-index:40;pointer-events:none;background:radial-gradient(circle at 50% 55%,rgba(${rgb},${a0}),rgba(${rgb},0) 70%);opacity:1;transition:opacity .7s ease-out`; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.style.opacity = '0')); setTimeout(() => d.remove(), 800); }
function onMeDiff(a, b) {
  const s = P.get(myId); if (!s) return;
  const x = s.x, y = s.y;
  const dm = b.monInf && b.money > a.money ? 0 : b.money - a.money;
  if (a.energy >= 10 && b.energy < 10 && !b.down) toast('พลังงานใกล้หมดแล้ว! ไปเล่นเครื่องเล่นที่ 🎡 สวนสนุก หรือกลับไปนอนที่ 🛏️ เตียงในบ้าน (นั่งพักฟื้นได้ช้าๆ ถึงครึ่งหลอด)', '😴', false);   // the admin's unlimited wallet refilling is not income
  if (dm) { const sp = document.createElement('span'); sp.className = 'mfloat'; sp.style.color = dm > 0 ? '#ffd34d' : '#ff8a7a'; sp.textContent = (dm > 0 ? '+' : '−') + money(Math.abs(dm)); $('#card').appendChild(sp); setTimeout(() => sp.remove(), 1600); }
  if (dm > 0) { FX.play('coin', dm >= 1000); FX.float(x, y, '+' + money(dm), '#ffd34d', dm >= 1000 ? .55 : .42); if (dm >= 300) FX.burst(x, y, '#ffd34d', Math.min(24, 6 + Math.floor(dm / 200))); FX.sparkle(x, y - .5, '#fff1a8', dm >= 1000 ? 14 : dm >= 200 ? 8 : 4); if (dm >= 3000) flashScreen('255,226,140', .22); }
  else if (dm < 0) { FX.play('spend'); FX.float(x + .4, y, '−' + money(-dm), '#ff8a7a', .34); }
  const gained = [];
  for (const [k, q] of Object.entries(b.inv)) { const d = q - (a.inv[k] || 0); if (d > 0) gained.push(`+${d}${G.items[k].icon}`); }
  if (gained.length) { FX.play('pop'); FX.float(x - .3, y - .4, gained.join(' '), '#ffffff', .5); FX.burst(x, y, '#ffffff', 6); FX.sparkle(x, y - .4, '#ffffff', 5); }
  if (b.career === a.career && b.lv > a.lv) { FX.play('levelup'); FX.ring(x, y, '#ffd34d', 900, 1.6); FX.float(x, y - .6, `LEVEL UP! Lv.${b.lv}`, '#ffd34d', .55); FX.burst(x, y, '#ffd34d', 20); FX.column(x, y); FX.sparkle(x, y - .6, '#ffffff', 18, 1.4); flashScreen('255,235,170', .3); }
  if (a.energy < 99.5 && b.energy >= 100) toast('พลังงานเต็มแล้ว!', '⚡');
  if (b.energy - a.energy >= 8) FX.float(x + .5, y + .2, `+${Math.round(b.energy - a.energy)}⚡`, '#f2c94c', .34);
  if (b.health - a.health >= 8) { FX.float(x - .5, y + .2, `+${Math.round(b.health - a.health)}❤️`, '#ff8a8a', .34); FX.ring(x, y, '#8fe3a6', 700, 1); }
  if (b.hunger - a.hunger >= 8) FX.float(x, y + .4, `+${Math.round(b.hunger - a.hunger)}🍗`, '#8fe3a6', .34);
  if (!a.cast && b.cast) { bobber = findWater(s.x, s.y); castT = performance.now(); FX.play('cast'); if (bobber) setTimeout(() => { FX.play('plop'); FX.ring(bobber.x, bobber.y, '#fff', 800, 1); }, 380); }
  if (!b.cast) { bobber = null; FG = null; reelHold = false; if (a.cast) holdAfterTp = false; }
  if (!a.down && b.down) { FX.play('fail'); closePanel(); }
  if (a.down && !b.down) FX.play('heal');
}
const ICON_SFX = { '🍳': 'sizzle', '🍛': 'munch', '🍜': 'munch', '🍲': 'munch', '🥗': 'munch', '😴': 'sleep', '😌': 'sleep', '🏥': 'heal', '💉': 'heal', '💓': 'heal', '🎓': 'levelup', '🌱': 'pop', '📦': 'pop', '🔔': 'ding', '🛵': 'notice' };
function toastSfx(m) { if (!m.ok) return FX.play('fail'); if (ICON_SFX[m.icon]) FX.play(ICON_SFX[m.icon]); }
// the float lands 2-3 tiles out, in the direction with the most open water
let castT = 0;
function findWater(x, y) {
  let best = null, bn = 0;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]]) {
    let n = 0, far = null;
    for (let d = 1; d <= 4; d++) { const tx = Math.floor(x + dx * d), ty = Math.floor(y + dy * d); if (tileAt(tx, ty) === 'w') { n++; if (d <= 3.2) far = { x: x + dx * Math.min(d, 2.8), y: y + dy * Math.min(d, 2.8) }; } else if (n) break; }
    if (far && n > bn) { bn = n; best = far; }
  }
  return best;
}
// other players fishing: their rod, the line and the float (it dips on a bite, the line goes taut in a fight)
function drawOtherCasts(X, Y, t) {
  const here = areaOf(P.get(myId)?.x || 0, P.get(myId)?.y || 0)?.id;
  for (const s of P.values()) {
    if (s.id === myId || !s.fc || !s.fcB || areaOf(s.x, s.y)?.id !== here) continue;
    const b = s.fcB, px = s.rx * TS + X, py = s.ry * TS + Y + TS * .32;
    if (px < -TS * 4 || px > VW + TS * 4 || py < -TS * 4 || py > VH + TS * 4) continue;
    const ddx = b.x - s.rx, ddy = b.y - s.ry, dl = Math.hypot(ddx, ddy) || 1, ux = ddx / dl, uy = ddy / dl, side = ux >= -.05 ? 1 : -1;
    const hx = px + side * TS * .18, hy = py - TS * .78, fight = s.fc === 3, bend = TS * (fight ? .4 : s.fc === 2 ? .25 : .08);
    const tx0 = hx + ux * TS * .75 + side * TS * .45, ty0 = hy + uy * TS * .45 - TS * .85, tx = tx0 + ux * bend * .5, ty = ty0 + bend;
    const cx0 = (hx + tx0) / 2 - side * bend * .15, cy0 = (hy + ty0) / 2 - bend * .25;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a2e16'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(cx0, cy0, tx, ty); ctx.stroke();
    ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(cx0, cy0, tx, ty); ctx.stroke();
    const fl = Math.min(1, (performance.now() - (s.fcT || 0)) / 380);
    let ex = (s.rx + ddx * fl) * TS + X, ey = (s.ry + ddy * fl) * TS + Y - Math.sin(fl * Math.PI) * TS * 1.2 + Math.sin(t / 420 + s.id) * 1.5;
    if (s.fc === 2) { ex += Math.sin(t / 35) * 3; ey += TS * .1; }
    if (fight) { ex += Math.sin(t / 160) * TS * .35; ey += Math.cos(t / 210) * TS * .2; if (Math.random() < .06) FX.ring((ex - X) / TS, (ey - Y) / TS, '#fff', 360, .5); }
    ctx.strokeStyle = fight ? '#ffd34d' : 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo((tx + ex) / 2, Math.max(ty, ey) + (fight ? 0 : TS * .4), ex, ey); ctx.stroke();
    if (!fight) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey - TS * .04, TS * .07, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#e8402f'; ctx.beginPath(); ctx.arc(ex, ey - TS * .04, TS * .07, 0, Math.PI); ctx.fill(); }
    else { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(ex, ey, TS * .22, TS * .08, 0, 0, 7); ctx.fill(); }
  }
}
function drawBobber(X, Y, t) {
  if (!bobber || !me?.cast) return;
  const s = P.get(myId); if (!s) return;
  const c = me.cast, now0 = performance.now(), fl = Math.min(1, (now0 - castT) / 380);
  const px = s.rx * TS + X, py = s.ry * TS + Y + TS * .32, hx = px + (bobber.x > s.rx ? 1 : -1) * TS * .18, hy = py - TS * .78;
  const tens = FG ? FG.ten : c.state === 'bite' ? .5 : .1;
  // the rod: from the hands up toward the water, bending more the harder the fish pulls
  const ddx = bobber.x - s.rx, ddy = bobber.y - s.ry, dl = Math.hypot(ddx, ddy) || 1, ux = ddx / dl, uy = ddy / dl, side = ux >= -.05 ? 1 : -1;
  const bend = TS * (.06 + tens * .5);
  const tx0 = hx + ux * TS * .75 + side * TS * .45, ty0 = hy + uy * TS * .45 - TS * .85;   // held up and out over the water
  const tx = tx0 + ux * bend * .5, ty = ty0 + bend;                                        // the tip dips toward the fish
  const cx0 = (hx + tx0) / 2 - side * bend * .15, cy0 = (hy + ty0) / 2 - bend * .25;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4a2e16'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(cx0, cy0, tx, ty); ctx.stroke();
  ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(cx0, cy0, tx, ty); ctx.stroke();
  // where the line ends: the float, or the fish once it is hooked
  let ex, ey, sub = false;
  if (FG) { const f = fishAt(); ex = f.x * TS + X; ey = f.y * TS + Y; }
  else {
    ex = (s.rx + (bobber.x - s.rx) * fl) * TS + X; ey = (s.ry + (bobber.y - s.ry) * fl) * TS + Y - Math.sin(fl * Math.PI) * TS * 1.2;
    if (fl >= 1) {
      ey += Math.sin(t / 420) * 1.5;
      if (c.state === 'wait') {                              // nibbles: the float dips a little now and then (don't strike yet!)
        if (now0 > nibble.at) { nibble = { at: now0 + 1400 + Math.random() * 2600, t: now0 }; if (Math.random() < .7) FX.ring(bobber.x, bobber.y, '#fff', 380, .35); }
        const u = (now0 - nibble.t) / 260; if (u < 1) ey += Math.sin(u * Math.PI) * TS * .09;
      } else if (c.state === 'bite') { sub = true; ex += Math.sin(t / 35) * 3; ey += TS * .1; if (Math.random() < .2) FX.ring(bobber.x, bobber.y, '#fff', 300, .5); }
    }
  }
  // the line: sags when slack, straight and red-hot when it is about to snap
  const col = tens > .8 ? ((now0 / 90 | 0) % 2 ? '#ff4a3a' : '#ffd0c8') : tens > .55 ? '#ffd34d' : 'rgba(255,255,255,.85)';
  const sag = FG ? TS * Math.max(0, .5 - tens) * 1.4 : fl < 1 ? 0 : TS * .45;
  ctx.strokeStyle = col; ctx.lineWidth = tens > .55 ? 1.8 : 1.3;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + ex) / 2, (ty + ey) / 2 + sag, ex, ey); ctx.stroke();
  if (FG) {                                                  // the fish: a dark shape under the water, splashing on its runs; at the bank it leaps
    const f = fishAt(), big = TS * (.22 + FG.pow * .3), leap = FG.mode === 'land' && now0 >= FG.surf && now0 <= FG.surfEnd;
    ctx.save(); ctx.translate(ex, ey);
    if (leap) {
      const u = (now0 - FG.surf) / FG.land, hgt = Math.sin(u * Math.PI) * TS * .55;
      ctx.translate(0, -hgt); ctx.rotate(Math.sin(u * Math.PI * 2) * .6);
      ctx.fillStyle = '#c7d4dc'; ctx.beginPath(); ctx.ellipse(0, 0, big, big * .42, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-big * .9, 0); ctx.lineTo(-big * 1.45, -big * .4); ctx.lineTo(-big * 1.45, big * .4); ctx.fill();
      ctx.fillStyle = '#26323a'; ctx.beginPath(); ctx.arc(big * .55, -big * .08, big * .09, 0, 7); ctx.fill();
    } else {
      ctx.globalAlpha = .38 + .25 * (1 - FG.dist); ctx.fillStyle = '#10232e';
      ctx.rotate(Math.sin(t / 160) * .3); ctx.beginPath(); ctx.ellipse(0, 0, big, big * .42, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-big * .9, 0); ctx.lineTo(-big * 1.4, -big * .35); ctx.lineTo(-big * 1.4, big * .35); ctx.fill();
    }
    ctx.restore();
    if (FG.run && Math.random() < .25) FX.ring(f.x, f.y, '#fff', 300, .3 + FG.str0 * .4);
    return;
  }
  // the float
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, TS * .1, 0, sub ? Math.PI : 7, sub); ctx.fill();
  ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.arc(ex, ey, TS * .1, Math.PI, 0); if (!sub) ctx.fill();
  if (sub) { ctx.font = `800 ${Math.round(TS * .45)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd34d'; ctx.fillText('!', ex, ey - TS * .5); }
}

// ------------------------------------------------------------------ trade window
function renderTrade() {
  const w = $('#tradeWin');
  if (!trade) { w.classList.add('hidden'); tradeSig = ''; tradeChat = []; return; }
  if (w.classList.contains('hidden')) paintTradeChat();
  w.classList.remove('hidden'); closePanel();
  const { mine, theirs } = trade;
  const col = o => {
    const items = Object.entries(o.items).map(([id, q]) => `<div class="item" style="padding:4px 6px"><span class="em" style="font-size:18px;width:22px">${G.items[id].icon}</span><span class="nm">${esc(G.items[id].name)}</span><b>x${q}</b></div>`).join('');
    return `${items || '<div class="sub">— ยังไม่ใส่ของ —</div>'}<div style="margin-top:6px">💵 <b>${money(o.money)}</b></div>`;
  };
  const inv = Object.entries(me.inv).map(([id, q]) => {
    const cur = mine.items[id] || 0;
    return `<div class="item" style="padding:4px 6px"><span class="em" style="font-size:18px;width:22px">${G.items[id].icon}</span><span class="nm">${esc(G.items[id].name)} <small>มี ${q}</small></span>
      <span class="step"><button data-ti="${id}" data-d="-1">−</button><b>${cur}</b><button data-ti="${id}" data-d="1">+</button><button data-ti="${id}" data-d="all">ทั้งหมด</button></span></div>`;
  }).join('');
  const html = `<h2>🤝 แลกเปลี่ยนกับ ${esc(trade.with.name)}</h2><div class="sub">ใส่ของ/เงิน แล้วกดยืนยันทั้งสองฝ่ายจึงจะแลก (ถ้ามีใครแก้ ต้องยืนยันใหม่)</div>
    <div class="trade"><div class="col ${mine.ok ? 'ok' : ''}"><b>คุณให้</b> ${mine.ok ? '✅' : ''}${col(mine)}</div><div class="col ${theirs.ok ? 'ok' : ''}"><b>${esc(trade.with.name)} ให้</b> ${theirs.ok ? '✅' : ''}${col(theirs)}</div></div>
    <div class="sub" style="margin-top:10px">เงินที่ให้ (฿${me.money.toLocaleString()} ที่มี)</div>
    <div class="rowf"><input id="tMoney" type="number" min="0" value="${mine.money}"><button id="tSet">ตั้งเงิน</button></div>
    <div class="sub" style="margin-top:10px">ของในกระเป๋า</div><div class="list">${inv || '<div class="sub">ไม่มีของ</div>'}</div>
    <div class="rowf" style="margin-top:12px"><button class="warn" id="tCancel" style="flex:1">ยกเลิก</button><button class="primary" id="tOk" style="flex:2">${mine.ok ? '⏳ รออีกฝ่ายยืนยัน' : '✅ ยืนยันการแลกเปลี่ยน'}</button></div>`;
  const body = $('#tradeBody');
  if (html === tradeSig) return; tradeSig = html;
  const keep = document.activeElement?.id === 'tMoney' ? document.activeElement.value : null;
  body.innerHTML = html;
  if (keep !== null) { $('#tMoney').value = keep; $('#tMoney').focus(); }
  const sendOffer = (items, mon) => send({ t: 'trade_offer', items, money: mon });
  body.querySelectorAll('[data-ti]').forEach(b => b.onclick = () => {
    const id = b.dataset.ti, d = b.dataset.d, items = { ...mine.items }, have = me.inv[id] || 0;
    let v = d === 'all' ? have : (items[id] || 0) + +d; v = clamp(v, 0, have);
    if (v) items[id] = v; else delete items[id];
    sendOffer(items, mine.money);
  });
  $('#tSet').onclick = () => sendOffer(mine.items, +$('#tMoney').value || 0);
  $('#tOk').onclick = () => { if (+$('#tMoney').value !== mine.money) sendOffer(mine.items, +$('#tMoney').value || 0); send({ t: 'trade_confirm' }); };
  $('#tCancel').onclick = () => send({ t: 'trade_cancel' });
}
setInterval(() => { if (trade) renderTrade(); }, 800);
// ------------------------------------------------------------------ job mini-games (police / cashier / chef)
// The server starts a round (energy, cooldown) and pays the score at the end; the game itself is played here.
const JG = { cur: null };
const jgRng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function jgStop(report) {
  const g = JG.cur; if (!g) return; JG.cur = null;
  clearInterval(g.iv); cancelAnimationFrame(g.raf); if (g.off) g.off();
  if (report) send({ t: 'jg', op: 'end', k: g.k, score: g.score });
}
function jgHead(g, extra = '') { const J = G.jobGames[g.k]; return `<h2>${J.icon} ${esc(J.name)}</h2><div class="mgTop"><span>คะแนน <b id="jgS">${g.score}</b>${extra}</span><span class="tm">⏱ <b id="mgT"></b></span></div><div class="mgTimer"><u id="mgU"></u></div>`; }
function jgClock(g, secs, onEnd) {           // a countdown bar; g.end can be pulled in (wrong answers cost time)
  g.end = performance.now() + secs * 1000;
  g.iv = setInterval(() => {
    if (JG.cur !== g) return;
    const left = Math.max(0, g.end - performance.now()), t = $('#mgT'), u = $('#mgU');
    if (t) t.textContent = (left / 1000).toFixed(1); if (u) u.style.width = left / (secs * 10) + '%';
    if (!left) (onEnd || jgFinish)(g);
  }, 100);
}
const jgScore = g => { const s = $('#jgS'); if (s) s.textContent = g.score; };
function jgFinish(g) {
  if (JG.cur !== g) return;
  jgStop(true); FX.play(g.score > 0 ? 'levelup' : 'fail');
  const J = G.jobGames[g.k], est = Math.round(Math.min(g.score, J.max) * J.per);
  $('#mgBody').innerHTML = `<h2>${J.icon} ${esc(J.name)}</h2><div class="mgEnd"><div class="sub">${esc(g.endWhy || 'หมดเวลา!')}</div><div class="sub">คะแนน</div><div class="big">${g.score}</div><div class="sub">ค่าแรงประมาณ ${money(est)}+ (โบนัสตามเลเวล) เข้ากระเป๋าแล้ว</div></div>
    <div class="grid2">${B(`🔁 เล่นอีกรอบ ⚡${Math.ceil(J.energy * (G.energyMul || 1))}`, { fn: 'jgGo', k: g.k }, 'primary')}${B('ปิด', { fn: 'jgClose' })}</div>`;
  bindPanel($('#mgBody'));
}
FN.gLink = gLinkOpen;
FN.adReward = () => adReward();
FN.confirmSell = m => popup('💰 ขายบ้านคืนโครงการ? เฟอร์นิเจอร์และสวนจะหายไปด้วย (ได้เงินคืนบางส่วน)', [['ขายเลย', 'warn', () => send({ t: 'act', st: m.st, a: 'sell' })], ['ยกเลิก', '', () => { }]]);
FN.jgGo = m => send({ t: 'jg', op: 'start', k: m.k });
FN.jgClose = () => { jgStop(true); mgClose(); };
function jgOpen(k, seed) {
  mgStop(); jgStop(false); $('#mg').classList.remove('hidden'); FX.play('notice');
  const g = JG.cur = { k, score: 0, r: jgRng(seed), t0: performance.now() };
  ({ spot: jgSpot, shoot: jgShoot, cash: jgCash, slice: jgSlice, type: jgType, stock: jgStock, vend: jgVend })[k]?.(g);
}
const jgPick = (g, a) => a[Math.floor(g.r() * a.length)];

// 🔍 spot the difference: the same crowd twice; in the right picture one person is someone else - that's the thief
function jgSpot(g) {
  const CROWD = ['🧑', '👩', '👨', '🧔', '👵', '👴', '👱', '🧒', '👧', '👦', '👲', '🧕', '👮', '🤵', '👷', '💂'];
  g.round = 0;
  const next = () => {
    if (JG.cur !== g) return;
    if (g.round >= 5) { g.endWhy = 'จับโจรครบทุกภาพ เก่งมาก!'; return jgFinish(g); }
    const n = 20, L = Array.from({ length: n }, () => jgPick(g, CROWD)), i = Math.floor(g.r() * n), R = L.slice();
    do R[i] = jgPick(g, CROWD); while (R[i] === L[i]);
    const grid = (a, side) => `<div class="jgGrid">${a.map((e, j) => `<button data-s="${side}" data-j="${j}">${e}</button>`).join('')}</div>`;
    $('#mgBody').innerHTML = jgHead(g, ` · ภาพ ${g.round + 1}/5`) + `<div class="sub">แตะคนที่ <b>ต่างจากภาพซ้าย</b> ในภาพขวา = โจรปลอมตัว! (แตะผิด -4 วิ)</div><div class="jgPair">${grid(L, 'l')}${grid(R, 'r')}</div>`;
    $('#mgBody').querySelectorAll('[data-j]').forEach(b => b.onclick = () => {
      const ok = b.dataset.s === 'r' && +b.dataset.j === i;
      if (ok) { b.classList.add('ok'); g.score++; g.round++; jgScore(g); FX.play('ding'); setTimeout(next, 350); }
      else { b.classList.add('bad'); g.end -= 4000; FX.play('fail'); if (navigator.vibrate) navigator.vibrate(40); }
    });
  };
  jgClock(g, 45); next();
}

// 🎯 target practice: targets pop up, tap them; cardboard citizens must not be shot
function jgShoot(g) {
  $('#mgBody').innerHTML = jgHead(g) + `<div class="sub">แตะเป้า 🎯 ให้ไว (+1) · ห้ามยิงป้ายพลเมือง 🙋 (-2)</div><canvas id="jgC" class="jgCan" width="400" height="300"></canvas>`;
  const c = $('#jgC'), x = c.getContext('2d'), T = [], fx = [];
  let spawn = 0, last = performance.now(), aim = null;
  const hit = e => {
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) * c.width / r.width, py = (e.clientY - r.top) * c.height / r.height; aim = [px, py, performance.now()];
    FX.play('chop');
    for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; if (Math.hypot(px - t.x, py - t.y) < t.r) { T.splice(i, 1);
      if (t.civ) { g.score = Math.max(0, g.score - 2); FX.play('fail'); fx.push([t.x, t.y, '-2', '#ff5a4a', performance.now()]); if (navigator.vibrate) navigator.vibrate(60); }
      else { g.score++; FX.play('ding'); fx.push([t.x, t.y, '+1', '#ffe14d', performance.now()]); }
      jgScore(g); return; } }
  };
  c.addEventListener('pointerdown', hit);
  const loop = now => {
    if (JG.cur !== g) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now; spawn -= dt;
    if (spawn <= 0) { spawn = .45 + g.r() * .45; T.push({ x: 40 + g.r() * 320, y: 50 + g.r() * 210, r: 26, civ: g.r() < .22, born: now, life: 1100 + g.r() * 700 }); }
    x.fillStyle = '#5b3a22'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#7a5130'; for (let i = 0; i < 400; i += 50) x.fillRect(i, 0, 3, 300);
    x.fillStyle = '#c9a26a'; x.fillRect(0, 270, 400, 30);
    for (let i = T.length - 1; i >= 0; i--) {
      const t = T[i], age = now - t.born; if (age > t.life) { T.splice(i, 1); continue; }
      const s = Math.min(1, age / 150, (t.life - age) / 150);
      x.save(); x.translate(t.x, t.y); x.scale(1, s);
      if (t.civ) { x.font = '44px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🙋', 0, 0); }
      else for (const [rr, col] of [[26, '#fff'], [20, '#e53b2c'], [13, '#fff'], [6, '#e53b2c']]) { x.fillStyle = col; x.beginPath(); x.arc(0, 0, rr, 0, 7); x.fill(); }
      x.restore();
    }
    for (let i = fx.length - 1; i >= 0; i--) { const [fx0, fy, tx, col, t0] = fx[i], k = (now - t0) / 600; if (k > 1) { fx.splice(i, 1); continue; } x.globalAlpha = 1 - k; x.fillStyle = col; x.font = '700 22px sans-serif'; x.textAlign = 'center'; x.fillText(tx, fx0, fy - 30 * k); x.globalAlpha = 1; }
    if (aim && now - aim[2] < 250) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(aim[0], aim[1], 14, 0, 7); x.moveTo(aim[0] - 20, aim[1]); x.lineTo(aim[0] + 20, aim[1]); x.moveTo(aim[0], aim[1] - 20); x.lineTo(aim[0], aim[1] + 20); x.stroke(); }
    g.raf = requestAnimationFrame(loop);
  };
  g.off = () => c.removeEventListener('pointerdown', hit);
  jgClock(g, 30); g.raf = requestAnimationFrame(loop);
}

// 🧾 cashier: add up the basket, see what the customer paid with, pick the right change
function jgCash(g) {
  const GOODS = [['💧', 'น้ำดื่ม', 10], ['🍞', 'ขนมปัง', 25], ['🥛', 'นมกล่อง', 15], ['🍜', 'บะหมี่กึ่งฯ', 7], ['🥚', 'ไข่ 10 ฟอง', 45], ['🍱', 'ข้าวกล่อง', 39], ['☕', 'กาแฟเย็น', 30], ['🧼', 'สบู่', 22], ['🍫', 'ช็อกโกแลต', 20], ['🍌', 'กล้วย', 18], ['🧃', 'น้ำผลไม้', 12], ['🍦', 'ไอศกรีม', 16]];
  const FACES = ['🧑', '👩', '👨', '👵', '👴', '🧔', '👧', '👦', '🧕'];
  const next = () => {
    if (JG.cur !== g) return;
    if (g.score >= 10) { g.endWhy = 'คิดเงินครบ 10 คน ไม่มีผิดเลย!'; return jgFinish(g); }
    const n = 1 + Math.floor(g.r() * 3) + (g.score >= 4 ? 1 : 0), items = Array.from({ length: n }, () => jgPick(g, GOODS)), total = items.reduce((t, i) => t + i[2], 0);
    const paid = [20, 50, 100, 500, 1000].find(v => v >= total + 1 && g.r() < .7) || [50, 100, 500, 1000].find(v => v > total);
    const ans = paid - total, opts = new Set([ans]);
    while (opts.size < 4) { const d = jgPick(g, [-10, -5, -3, -2, -1, 1, 2, 3, 5, 10, 20]); if (ans + d > 0) opts.add(ans + d); }
    $('#mgBody').innerHTML = jgHead(g, ` · ลูกค้า ${g.score + 1}/10`) + `<div class="jgCash"><div class="cust">${jgPick(g, FACES)}<small>"คิดเงินด้วยครับ"</small></div>
      <div class="bill">${items.map(i => `<div><span>${i[0]} ${i[1]}</span><b>฿${i[2]}</b></div>`).join('')}<div class="paid"><span>ลูกค้าจ่าย</span><b>💵 ฿${paid}</b></div></div></div>
      <div class="sub">ต้องทอนเงินเท่าไหร่? (ตอบผิด -5 วิ)</div><div class="mgAns">${[...opts].sort(() => g.r() - .5).map(v => `<button data-v="${v}">฿${v}</button>`).join('')}</div>`;
    $('#mgBody').querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      if (+b.dataset.v === ans) { b.classList.add('ok'); g.score++; jgScore(g); FX.play('coin'); setTimeout(next, 300); }
      else { b.classList.add('bad'); g.end -= 5000; FX.play('fail'); if (navigator.vibrate) navigator.vibrate(40); }
    });
  };
  jgClock(g, 60); next();
}

// 🔪 slice the fruit and vegetables: they are thrown up from below, swipe across them; never cut a bomb
function jgSlice(g) {
  $('#mgBody').innerHTML = jgHead(g) + `<div class="sub">ปาดนิ้วผ่านผักผลไม้ให้ขาด (+1) · ฟันทีเดียว 3 ลูกขึ้นไป = คอมโบ! · ห้ามฟันระเบิด 💣 (-5 และเสียเวลา)</div><canvas id="jgC" class="jgCan" width="400" height="440" style="touch-action:none"></canvas>`;
  const c = $('#jgC'), x = c.getContext('2d'), W = 400, H = 440, F = [], parts = [], trail = [], pops = [], stains = [];
  const KINDS = [['🍉', '#e8435a'], ['🍍', '#f5c542'], ['🍎', '#e33b2e'], ['🍊', '#f59a23'], ['🥕', '#f08a24'], ['🥦', '#5fae3a'], ['🍆', '#8a4fb3'], ['🥒', '#6dbb45'], ['🍅', '#e2452f'], ['🍌', '#f2d64b'], ['🥥', '#efe9de'], ['🍋', '#f4e04d'], ['🍇', '#7b4bb0'], ['🌽', '#f2c94c'], ['🍑', '#f7a07a'], ['🥭', '#f6b73c']];
  const SPR = {}, sprite = e => { if (SPR[e]) return SPR[e]; const s = document.createElement('canvas'); s.width = s.height = 80; const q = s.getContext('2d'); q.font = '60px serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(e, 40, 44); return SPR[e] = s; };
  let next = 0, last = performance.now(), down = false, swipeN = 0, shake = 0;
  const t0 = performance.now();
  const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const segHit = (ax, ay, bx, by, px, py, r) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return Math.hypot(ax + dx * t - px, ay + dy * t - py) < r; };
  const cut = (ax, ay, bx, by) => {
    if (JG.cur !== g || Math.hypot(bx - ax, by - ay) < 4) return;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i]; if (!segHit(ax, ay, bx, by, f.x, f.y, f.r)) continue;
      F.splice(i, 1); const ang = Math.atan2(by - ay, bx - ax), now0 = performance.now();
      if (f.bomb) {
        g.score = Math.max(0, g.score - 5); g.end -= 3000; shake = 1; FX.play('fail'); if (navigator.vibrate) navigator.vibrate(150);
        pops.push([f.x, f.y, '💥 -5', '#ff5a4a', now0]); for (let k = 0; k < 30; k++) { const a = Math.random() * 7, v = 80 + Math.random() * 260; parts.push({ juice: k % 2 ? '#ffb347' : '#555', x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .7, r: 3 + Math.random() * 4 }); }
        jgScore(g); continue;
      }
      g.score++; swipeN++; FX.play('chop'); if (navigator.vibrate) navigator.vibrate(15);
      for (const sd of [-1, 1]) parts.push({ half: sd, e: f.e, x: f.x, y: f.y, vx: f.vx + Math.cos(ang + Math.PI / 2) * sd * 80, vy: Math.min(f.vy, 0) * .3 + Math.sin(ang + Math.PI / 2) * sd * 80 - 40, rot: 0, vr: sd * 3, ang, life: 1.6 });
      for (let k = 0; k < 16; k++) { const a = Math.random() * 7, v = 50 + Math.random() * 170; parts.push({ juice: f.col, x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: .45 + Math.random() * .4, r: 2 + Math.random() * 3.5 }); }
      stains.push([f.x, f.y, f.col, now0, Math.random() * 7]); if (stains.length > 14) stains.shift();
      if (swipeN === 3) { g.score += 2; pops.push([f.x, f.y - 34, 'คอมโบ! +2', '#ffe14d', now0]); FX.play('coin'); }
      else if (swipeN > 3) { g.score++; pops.push([f.x, f.y - 34, `คอมโบ x${swipeN}! +1`, '#ffe14d', now0]); }
      else pops.push([f.x, f.y, '+1', '#ffffff', now0]);
      jgScore(g);
    }
  };
  const pd = e => { e.preventDefault(); c.setPointerCapture?.(e.pointerId); down = true; swipeN = 0; trail.length = 0; trail.push([...pos(e), performance.now()]); };
  const pm = e => { if (!down) return; e.preventDefault(); const p = pos(e), q = trail[trail.length - 1]; if (q) cut(q[0], q[1], p[0], p[1]); trail.push([...p, performance.now()]); if (trail.length > 24) trail.shift(); };
  const pu = () => { down = false; };
  c.addEventListener('pointerdown', pd); c.addEventListener('pointermove', pm); c.addEventListener('pointerup', pu); c.addEventListener('pointercancel', pu);
  g.off = () => { c.removeEventListener('pointerdown', pd); c.removeEventListener('pointermove', pm); c.removeEventListener('pointerup', pu); c.removeEventListener('pointercancel', pu); };
  const throwWave = () => {
    const el = (performance.now() - t0) / 1000, n = 1 + Math.floor(g.r() * (el > 12 ? 4 : 3));
    for (let i = 0; i < n; i++) {
      const bomb = el > 4 && g.r() < .13, k = jgPick(g, KINDS), x0 = 50 + g.r() * (W - 100);
      F.push({ e: bomb ? '💣' : k[0], col: k[1], bomb, x: x0, y: H + 30, vx: (W / 2 - x0) * (.25 + g.r() * .5) + (g.r() - .5) * 60, vy: -(560 + g.r() * 120), r: 26, rot: 0, vr: (g.r() - .5) * 5 });
    }
    FX.play('whoosh');
  };
  const draw = now0 => {
    if (JG.cur !== g) return;
    g.raf = requestAnimationFrame(draw);
    const dt = Math.min(.05, (now0 - last) / 1000); last = now0;
    if (now0 > next) { throwWave(); next = now0 + 900 + g.r() * 700 - Math.min(400, (now0 - t0) / 60); }
    for (let i = F.length - 1; i >= 0; i--) { const f = F[i]; f.vy += 620 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; if (f.y > H + 60 && f.vy > 0) F.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.vr) p.rot += p.vr * dt; if (p.life <= 0 || p.y > H + 80) parts.splice(i, 1); }
    x.save();
    if (shake > 0) { x.translate((Math.random() - .5) * 10 * shake, (Math.random() - .5) * 10 * shake); shake = Math.max(0, shake - dt * 2.5); }
    // the chopping board
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#c98f55'); bg.addColorStop(1, '#a8703b'); x.fillStyle = bg; x.fillRect(-10, -10, W + 20, H + 20);
    x.strokeStyle = 'rgba(90,50,20,.22)'; x.lineWidth = 2; for (let yy = 18; yy < H; yy += 34) { x.beginPath(); x.moveTo(0, yy); x.bezierCurveTo(W * .3, yy + 6, W * .7, yy - 6, W, yy + 3); x.stroke(); }
    for (const [sx, sy, col, st, a] of stains) { const al = Math.max(0, 1 - (now0 - st) / 6000); if (!al) continue; x.globalAlpha = al * .35; x.fillStyle = col; x.beginPath(); x.ellipse(sx, sy, 26, 15, a, 0, 7); x.fill(); x.globalAlpha = 1; }
    for (const f of F) {
      x.save(); x.translate(f.x, f.y); x.rotate(f.rot); x.drawImage(sprite(f.e), -38, -40, 76, 76);
      if (f.bomb) { const fl = (now0 / 70 | 0) % 2; x.fillStyle = fl ? '#ffe14d' : '#ff7a1a'; x.beginPath(); x.arc(17, -27, 5 + fl * 2, 0, 7); x.fill(); }
      x.restore();
    }
    for (const p of parts) {
      if (p.half) { x.save(); x.translate(p.x, p.y); x.rotate(p.ang); x.beginPath(); x.rect(-50, p.half < 0 ? -50 : 0, 100, 50); x.clip(); x.rotate(-p.ang + p.rot); x.globalAlpha = Math.min(1, p.life * 2); x.drawImage(sprite(p.e), -38, -40, 76, 76); x.restore(); x.globalAlpha = 1; }
      else { x.globalAlpha = Math.min(1, p.life * 2.5); x.fillStyle = p.juice; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); x.globalAlpha = 1; }
    }
    // the blade's trail
    const tr = trail.filter(q => now0 - q[2] < 140);
    if (tr.length > 1) { for (const [w, col] of [[11, 'rgba(160,220,255,.35)'], [5, 'rgba(255,255,255,.95)']]) { x.strokeStyle = col; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = w; x.beginPath(); tr.forEach((q, i) => i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); } }
    for (let i = pops.length - 1; i >= 0; i--) { const [px, py, txt, col, st] = pops[i], k = (now0 - st) / 900; if (k > 1) { pops.splice(i, 1); continue; }
      x.globalAlpha = 1 - k; x.font = "800 22px 'Mitr',sans-serif"; x.textAlign = 'center'; x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.6)'; x.strokeText(txt, px, py - k * 40); x.fillStyle = col; x.fillText(txt, px, py - k * 40); x.globalAlpha = 1; }
    x.restore();
  };
  g.raf = requestAnimationFrame(draw);
  jgClock(g, 40);
}
// ⌨️ office: type the line from the template exactly as shown (a quote, an invoice, a memo...)
function jgType(g) {
  const N = () => Math.floor(g.r() * 900 + 100), M = () => (Math.floor(g.r() * 90 + 10) * 100).toLocaleString();
  const T = [() => `ใบเสนอราคาเลขที่ ${N()}`, () => `ยอดรวม ${M()} บาท`, () => `เรียน ผู้จัดการฝ่ายขาย`, () => `ประชุมวันจันทร์ ${Math.floor(g.r() * 5 + 9)}.00 น.`, () => `ใบแจ้งหนี้ INV-${N()}`,
    () => `ส่งของภายใน ${Math.floor(g.r() * 6 + 2)} วัน`, () => `จึงเรียนมาเพื่อโปรดทราบ`, () => `ขอแสดงความนับถือ`, () => `รหัสพนักงาน TT${N()}`, () => `ห้องประชุม ${Math.floor(g.r() * 4 + 1)}0${Math.floor(g.r() * 9 + 1)}`,
    () => `อนุมัติงบ ${M()} บาท`, () => `ลูกค้า บริษัท สยามรุ่ง จำกัด`, () => `โทร 02-${N()}-${N()}0`, () => `รายงานยอดขายไตรมาส ${Math.floor(g.r() * 4 + 1)}`, () => `กำหนดส่ง ${Math.floor(g.r() * 28 + 1)} มีนาคม`];
  const norm = v => v.replace(/\s+/g, ' ').trim();
  let want = '';
  const next = () => {
    if (JG.cur !== g) return;
    if (g.score >= 12) { g.endWhy = 'พิมพ์ครบ 12 บรรทัด เป๊ะทุกตัว!'; return jgFinish(g); }
    want = jgPick(g, T)();
    $('#mgBody').innerHTML = jgHead(g, ` · บรรทัด ${g.score + 1}/12`) + `<div class="jgDoc"><small>📄 ต้นแบบ</small><b>${esc(want)}</b></div>
      <div class="sub">🖥️ พิมพ์ให้ตรงต้นแบบทุกตัวอักษร (ถูกแล้วไปบรรทัดต่อไปเอง)</div><input id="jgIn" class="jgIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="พิมพ์ตรงนี้...">
      <div class="grid2" style="margin-top:6px">${B('⏭️ ข้าม (-5 วิ)', { fn: 'jgTypeSkip' })}</div>`;
    bindPanel($('#mgBody'));
    const inp = $('#jgIn'); inp.focus();
    inp.oninput = () => {
      const v = norm(inp.value), ok = v === norm(want);
      inp.classList.toggle('bad', !norm(want).startsWith(v));
      if (ok) { g.score++; jgScore(g); FX.play('coin'); inp.disabled = true; inp.classList.add('ok'); setTimeout(next, 250); }
    };
  };
  FN.jgTypeSkip = () => { if (JG.cur !== g) return; g.end -= 5000; FX.play('fail'); next(); };
  jgClock(g, 75); next();
}
// 📦 convenience store: take items out of the box one by one and put each on the empty spot of the shelf that shows it
function jgStock(g) {
  const ROWS = [['🥤 เครื่องดื่ม', ['🥤', '🧃', '🥛', '💧']], ['🍪 ขนม', ['🍪', '🍫', '🍬', '🥨']], ['🧴 ของใช้', ['🧴', '🧻', '🧼', '🪥']]];
  let slots = [], cur = null;
  const fresh = () => { slots = ROWS.map(([, ic]) => Array.from({ length: 6 }, () => ({ ic: jgPick(g, ic), full: g.r() < .4 }))); };
  const draw = () => {
    const empty = slots.flat().filter(s => !s.full);
    if (!empty.length) { fresh(); return draw(); }
    if (!cur || !empty.some(s => s.ic === cur)) cur = jgPick(g, empty).ic;
    $('#mgBody').innerHTML = jgHead(g) + `<div class="sub">หยิบของจากลังแล้วแตะช่องว่างบนชั้นที่มีรูปตรงกัน (วางผิด -3 วิ)</div>
      <div class="jgShelf">${slots.map((r, i) => `<div class="lbl">${ROWS[i][0]}</div><div class="row">${r.map((s, j) => `<button data-s="${i}_${j}" class="${s.full ? 'full' : ''}">${s.ic}</button>`).join('')}</div>`).join('')}</div>
      <div class="jgBoxIt">📦 ลังสินค้า → <b>${cur}</b></div>`;
    $('#mgBody').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const [i, j] = b.dataset.s.split('_').map(Number), s = slots[i][j]; if (s.full) return;
      if (s.ic === cur) { s.full = true; cur = null; g.score++; jgScore(g); FX.play('coin'); draw(); }
      else { b.classList.add('bad'); g.end -= 3000; FX.play('fail'); if (navigator.vibrate) navigator.vibrate(40); setTimeout(() => b.classList.remove('bad'), 300); }
    });
  };
  fresh(); jgClock(g, 45); draw();
}
// 🥤 merchant: unload the truck into vending machines around town - pick a drink from a crate, drop it in a column that sells it
function jgVend(g) {
  const DR = ['🥤', '🧃', '☕', '💧', '🍵', '🥛'], SPOTS = ['หน้าสถานีตำรวจ', 'ป้ายรถเมล์', 'หน้าโรงพยาบาล', 'มหาวิทยาลัย', 'สวนสนุก', 'ตลาดกลาง', 'หน้าธนาคาร'];
  let cols = [], hold = null, n = 0;
  const fresh = () => { n++; const k = [...DR].sort(() => g.r() - .5).slice(0, 4), d = [...k, ...k].sort(() => g.r() - .5); cols = d.map(x => ({ d: x, c: Math.floor(g.r() * 4) })); };
  const draw = () => {
    if (cols.every(c => c.c >= 5)) { g.score += 3; jgScore(g); FX.play('levelup'); fresh(); }
    const kinds = [...new Set(cols.map(c => c.d))];
    $('#mgBody').innerHTML = jgHead(g, ` · ตู้ที่ ${n}`) + `<div class="sub">🚚 ตู้${SPOTS[(n - 1) % SPOTS.length]} · แตะลังเพื่อหยิบ แล้วแตะช่องที่ขายเครื่องดื่มนั้นและยังไม่เต็ม (ผิด -2 วิ) · เติมตู้เต็ม +3</div>
      <div class="jgVend">${cols.map((c, i) => `<button data-c="${i}" class="${c.c >= 5 ? 'full' : ''}"><i>${c.d}</i><small>${'▮'.repeat(c.c)}${'▯'.repeat(5 - c.c)}</small></button>`).join('')}</div>
      <div class="jgCrates">${kinds.map(d => `<button data-d="${d}" class="${hold === d ? 'on' : ''}">${d}<small>ลัง</small></button>`).join('')}</div>
      <div class="sub">${hold ? `ถืออยู่: <b>${hold}</b>` : 'มือว่าง: หยิบจากลังก่อน'}</div>`;
    $('#mgBody').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { hold = b.dataset.d; FX.play('click'); draw(); });
    $('#mgBody').querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
      const c = cols[+b.dataset.c]; if (!hold) return;
      if (c.d === hold && c.c < 5) { c.c++; g.score++; jgScore(g); FX.play('coin'); if (c.c >= 5 || !cols.some(x => x.d === hold && x.c < 5)) hold = null; draw(); }
      else { b.classList.add('bad'); g.end -= 2000; FX.play('fail'); if (navigator.vibrate) navigator.vibrate(40); setTimeout(() => b.classList.remove('bad'), 300); }
    });
  };
  fresh(); jgClock(g, 50); draw();
}
// the boxes that start them, shown in the police / store / kitchen panels
function jgBox(k, note) {
  const J = G.jobGames?.[k]; if (!J) return '';
  const cd = Math.max(0, Math.ceil(((me.jgNext?.[k] || 0) - (Date.now() + clockOff)) / 1000));
  return `<div class="jobbox">${J.icon} <b>${esc(J.name)}</b> · ${note}<br><small>ค่าแรง ~${money(J.per)} ต่อคะแนน (สูงสุด ${J.max} คะแนน) + โบนัสเลเวล</small>
    <div style="margin-top:6px">${B(cd > 0 ? `⏳ พักอีก ${cd} วิ` : `▶️ เริ่มเล่น ⚡${Math.ceil(J.energy * (G.energyMul || 1))}`, { fn: 'jgGo', k }, 'primary big', cd > 0)}</div></div>`;
}
// ------------------------------------------------------------------ office mini-games (only while seated at your desk)
// Something to do during long shifts. The score is sent to the server, which may add a small bonus (capped per day).
const MG = { cur: null, timer: 0 };
const MG_GAMES = {
  math: { icon: '🧮', name: 'คิดเลขเร็ว', desc: '30 วินาที ตอบให้ถูกมากที่สุด (ตอบผิด -2 วิ)' },
  mail: { icon: '📧', name: 'เคลียร์อีเมล', desc: '30 วินาที แยกอีเมลงานกับอีเมลขยะ' },
  memo: { icon: '🗂️', name: 'จับคู่แฟ้ม', desc: 'เปิดการ์ดหาคู่ให้ครบ ยิ่งเปิดน้อยยิ่งได้คะแนน' },
};
const mgBest = k => { try { return +localStorage.getItem('lt_mg_' + k) || 0; } catch { return 0; } };
const mgSetBest = (k, v) => { try { if (v > mgBest(k)) localStorage.setItem('lt_mg_' + k, v); } catch { } };
function mgStop() { clearInterval(MG.timer); MG.timer = 0; MG.cur = null; if (JG.cur) jgStop(true); }
function mgClose() { mgStop(); $('#mg').classList.add('hidden'); }
$('#mgX').onclick = () => { FX.play('click'); mgClose(); };
$('#mgBtn').onclick = () => { FX.play('click'); mgMenu(); };
$('#godBtn').onclick = () => { FX.play('click'); panel?.kind === 'god' ? closePanel() : openPanel({ kind: 'god' }); };
$('#homeBtn').onclick = () => { FX.play('click'); if (picking) return endPick(); if (placing) return; const m = P.get(myId), r = m && areaOf(m.x, m.y); if (r && (r.rk === 'house' || r.yard) && r.house === me.house) startPick(); else openPanel({ kind: 'homedeco' }); };   // in your home: straight into tap-to-move (📦 opens the list)
$('#rideBtn').onclick = () => { FX.play('click'); const vs = (me.vehicles || []).filter(k => G.shop.vehicles[k]);
  if (me.ride) send({ t: 'ride', v: me.ride, on: 0 }); else if (vs.length === 1) send({ t: 'ride', v: vs[0], on: 1 }); else openPanel({ kind: 'garage' }); };
function mgMenu() {
  mgStop(); $('#mg').classList.remove('hidden');
  const study = me.desk != null && me.desk >= 0;
  $('#mgBody').innerHTML = `<h2>🎮 มินิเกมฆ่าเวลา</h2><div class="sub">${study ? 'เล่นแก้เบื่อระหว่างนั่งเรียน คาบเรียนยังนับต่อตามปกติ · เล่นจบได้ความสุขเพิ่ม' : 'เล่นได้ระหว่างนั่งทำงาน ค่าแรงยังเดินตามปกติ · ได้คะแนนดีมีโบนัสเล็กน้อยและความสุขเพิ่ม (โบนัสสูงสุดวันละ ฿300)'}</div>
    <div class="mgList">${Object.entries(MG_GAMES).map(([k, g]) => `<button data-g="${k}"><i>${g.icon}</i><span><b>${g.name}</b><small>${g.desc} · สถิติ ${mgBest(k)}</small></span></button>`).join('')}</div>`;
  $('#mgBody').querySelectorAll('[data-g]').forEach(b => b.onclick = () => { FX.play('click'); mgStart(b.dataset.g); });
}
// a countdown game: draw() paints one round, the timer ends it
function mgTimed(key, secs, round) {
  const g = MG.cur = { key, score: 0, end: performance.now() + secs * 1000, secs };
  const tick = () => {
    if (MG.cur !== g) return;
    const left = Math.max(0, g.end - performance.now());
    const t = $('#mgT'), u = $('#mgU'); if (t) t.textContent = (left / 1000).toFixed(1); if (u) u.style.width = left / (secs * 10) + '%';
    if (!left) mgEnd(key, g.score);
  };
  MG.timer = setInterval(tick, 100);
  g.next = () => { round(g); tick(); };
  g.next();
}
const mgHead = (g, name) => `<h2>${MG_GAMES[g.key].icon} ${name}</h2><div class="mgTop"><span>คะแนน ${g.score}</span><span class="tm">⏱ <b id="mgT"></b></span></div><div class="mgTimer"><u id="mgU"></u></div>`;
function mgStart(key) {
  mgStop(); $('#mg').classList.remove('hidden');
  if (key === 'math') mgTimed('math', 30, g => {
    const op = ['+', '-', '×'][Math.floor(Math.random() * 3)];
    let a = 2 + Math.floor(Math.random() * 18), b = 2 + Math.floor(Math.random() * 12);
    if (op === '-' && b > a) [a, b] = [b, a];
    if (op === '×') { a = 2 + Math.floor(Math.random() * 10); b = 2 + Math.floor(Math.random() * 9); }
    const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
    const opts = new Set([ans]); while (opts.size < 4) opts.add(Math.max(0, ans + Math.floor(Math.random() * 11) - 5));
    $('#mgBody').innerHTML = mgHead(g, 'คิดเลขเร็ว') + `<div class="mgQ">${a} ${op} ${b} = ?</div><div class="mgAns">${[...opts].sort(() => Math.random() - .5).map(v => `<button data-v="${v}">${v}</button>`).join('')}</div>`;
    $('#mgBody').querySelectorAll('[data-v]').forEach(bt => bt.onclick = () => {
      const ok = +bt.dataset.v === ans; bt.classList.add(ok ? 'ok' : 'bad'); FX.play(ok ? 'ding' : 'click');
      if (ok) g.score++; else g.end -= 2000;
      setTimeout(() => MG.cur === g && g.next(), ok ? 150 : 350);
    });
  });
  if (key === 'mail') {
    const WORK = ['สรุปยอดขายประจำเดือน', 'นัดประชุมทีมบ่ายสอง', 'ใบเสนอราคาลูกค้า', 'แก้ไขสัญญาฉบับใหม่', 'รายงานความคืบหน้าโปรเจกต์', 'ขออนุมัติงบประมาณ', 'ตารางเวรสัปดาห์หน้า', 'ไฟล์นำเสนอผู้บริหาร', 'ใบลาพักร้อน', 'ตรวจสอบใบแจ้งหนี้'];
    const SPAM = ['คุณถูกรางวัล 10 ล้าน!!!', 'กดลิงก์รับเงินฟรีทันที', 'ลดน้ำหนัก 10 โล ใน 3 วัน', 'ยืนยันรหัสผ่านด่วน มิฉะนั้นบัญชีจะถูกปิด', 'เจ้าชายต่างแดนขอโอนเงิน', 'สินเชื่อด่วน ไม่ต้องค้ำ', 'ดูดวงแม่นๆ ฟรี', 'iPhone ราคา 99 บาท'];
    const FROM = ['หัวหน้าฝ่าย', 'ฝ่ายบัญชี', 'ลูกค้า', 'HR', 'เพื่อนร่วมงาน'], SFROM = ['no-reply@w1n-prize.xyz', 'lucky@free-money.cc', 'admin@bank-verify.top', 'promo@deal99.biz'];
    mgTimed('mail', 30, g => {
      const spam = Math.random() < .45, subj = spam ? SPAM[Math.floor(Math.random() * SPAM.length)] : WORK[Math.floor(Math.random() * WORK.length)];
      const from = spam ? SFROM[Math.floor(Math.random() * SFROM.length)] : FROM[Math.floor(Math.random() * FROM.length)];
      $('#mgBody').innerHTML = mgHead(g, 'เคลียร์อีเมล') + `<div class="mgMail"><small>จาก: ${esc(from)}</small><b>${esc(subj)}</b></div><div class="mgAns"><button data-s="0">📥 งาน</button><button data-s="1">🗑️ ขยะ</button></div>`;
      $('#mgBody').querySelectorAll('[data-s]').forEach(bt => bt.onclick = () => {
        const ok = (bt.dataset.s === '1') === spam; bt.classList.add(ok ? 'ok' : 'bad'); FX.play(ok ? 'ding' : 'click');
        if (ok) g.score++; else g.end -= 2000;
        setTimeout(() => MG.cur === g && g.next(), ok ? 120 : 350);
      });
    });
  }
  if (key === 'memo') {
    const icons = ['📁', '📎', '🖇️', '📊', '🖨️', '☕', '📌', '💼'], deck = [...icons, ...icons].sort(() => Math.random() - .5);
    const g = MG.cur = { key, moves: 0, open: [], got: new Set(), t0: performance.now(), lock: false };
    const draw = () => {
      const secs = Math.floor((performance.now() - g.t0) / 1000);
      $('#mgBody').innerHTML = `<h2>🗂️ จับคู่แฟ้ม</h2><div class="mgTop"><span>เปิดไป ${g.moves} ครั้ง · คู่ ${g.got.size / 2}/8</span><span class="tm">⏱ ${secs}</span></div>
        <div class="mgGrid">${deck.map((ic, i) => { const up = g.open.includes(i) || g.got.has(i); return `<button data-i="${i}" class="${up ? (g.got.has(i) ? 'got' : '') : 'dn'}">${up ? ic : '?'}</button>`; }).join('')}</div>`;
      $('#mgBody').querySelectorAll('[data-i]').forEach(bt => bt.onclick = () => {
        const i = +bt.dataset.i; if (g.lock || g.open.includes(i) || g.got.has(i)) return;
        FX.play('click'); g.open.push(i);
        if (g.open.length === 2) {
          g.moves++; const [x, y] = g.open;
          if (deck[x] === deck[y]) { g.got.add(x); g.got.add(y); g.open = []; FX.play('ding'); if (g.got.size === 16) { draw(); return setTimeout(() => MG.cur === g && mgEnd('memo', Math.max(1, 30 - (g.moves - 8) * 2)), 400); } }
          else { g.lock = true; setTimeout(() => { if (MG.cur !== g) return; g.open = []; g.lock = false; draw(); }, 650); }
        }
        draw();
      });
    };
    draw(); MG.timer = setInterval(() => { const t = $('#mgBody .tm'); if (t && MG.cur === g) t.textContent = '⏱ ' + Math.floor((performance.now() - g.t0) / 1000); }, 1000);
  }
}
function mgEnd(key, score) {
  mgStop(); const best = mgBest(key), rec = score > best; mgSetBest(key, score);
  send({ t: 'minigame', game: key, score });
  FX.play('notice');
  $('#mgBody').innerHTML = `<h2>${MG_GAMES[key].icon} ${MG_GAMES[key].name}</h2><div class="mgEnd"><div class="sub">คะแนนของคุณ</div><div class="big">${score}</div><div class="sub">${rec ? '🏆 สถิติใหม่!' : `สถิติ ${best}`}</div></div>
    <div class="grid2">${B('🔁 เล่นอีกครั้ง', { fn: 'mgAgain', key }, 'primary')}${B('🎮 เลือกเกม', { fn: 'mgMenu' })}</div>`;
  bindPanel($('#mgBody'));
}
FN.mgAgain = m => mgStart(m.key);
FN.mgMenu = () => mgMenu();
window.__lt = { get zn() { return ZN; }, get TS() { return TS; }, get picking() { return picking; }, get placing() { return placing; }, send, mgStart, mgMenu, get traffic() { return traffic; }, get ambs() { return ambs; }, ambStart, P, camera, walkTo, get wd() { return wd; }, get me() { return me; }, get myId() { return myId; }, get running() { return running; }, get TS() { return TS; }, openPanel, drawCharTo, get G() { return G; } };   // read-only hooks for automated UI tests
$('#tchatForm').onsubmit = e => { e.preventDefault(); const i = $('#tchatIn'); if (i.value.trim()) send({ t: 'trade_chat', text: i.value }); i.value = ''; };
})();
