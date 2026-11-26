// © เมืองชีวิตนี้เลือกได้ (Life Town) — newlifetownth.fly.dev · สงวนลิขสิทธิ์ ห้ามคัดลอก ดัดแปลง หรือนำไปเผยแพร่ซ้ำโดยไม่ได้รับอนุญาต
'use strict';
const TOUCH_UI = matchMedia('(pointer: coarse)').matches;
(() => {
// 🔒 runs only on our own site: a copy on another domain shows where the real game is instead
if (!/^(newlifetownth\.fly\.dev|localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  document.body.innerHTML = '<div style="font:16px sans-serif;text-align:center;padding:40px 16px;color:#333;background:#fff8ec;min-height:100vh">เกมนี้เล่นได้ที่เว็บทางการเท่านั้น<br><br><a href="https://newlifetownth.fly.dev" style="font-size:20px">newlifetownth.fly.dev</a><br><br><small>© เมืองชีวิตนี้เลือกได้ · สงวนลิขสิทธิ์</small></div>';
  return;
}
const $ = s => document.querySelector(s);
try { const rf = new URLSearchParams(location.search).get('ref'); if (rf) localStorage.setItem('ltRef', rf.toUpperCase()); } catch { }   // invite link: the code is used once this player is in the game
const COLORS = ['#4aa3d1', '#7ac96b', '#e2b13c', '#d9907a', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const job = c => me?.career === c || !!me?.admin && me.god?.alljobs !== false;   // admins can do every job's work (unless switched off)
// 🍸 how drunk someone looks: 2 = very drunk (sways, 🥴), 1 = tipsy, 0 = sober (the server sends when each wears off)
const dkLv = p => { const d = p?.dk; if (!d) return 0; const n = Date.now() + clockOff; return d[1] > n ? 2 : d[0] > n ? 1 : 0; };
const dkSway = (p, t) => { const l = dkLv(p); return l ? Math.sin(t / 260 + (Math.abs(+p.id || 0) % 7)) * (l === 2 ? .08 : .03) : 0; };
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
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
const CH_MAX = IOS ? 350 : 600;   // (~30 MB of small canvases; 1400 was too much for iPhones, which also cap all canvases together)
const chGet = k => { const c = chCache.get(k); if (c) { chCache.delete(k); chCache.set(k, c); } return c; };
const chPut = (k, c) => { chCache.set(k, c); while (chCache.size > CH_MAX) chCache.delete(chCache.keys().next().value); return c; };
const whenChars = fn => { if (chImg) fn(); else chWait.push(fn); };
// one small image per outfit sheet (public/assets/pchar/, tools/split_pchar.py), loaded the first time someone wears it:
// the old single atlas decoded to ~135 MB and iPhones reloaded the page
const CH_V = 'b11', chSheets = {};
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
const OUTFIT_SHEET = { bartender: 'tuxedo', templeboy: 'scout', undertaker: 'tuxedo', mechanic: 'tracksuit', thug: 'hoodie', photographer: 'student', detective: 'detective', courier: 'rider', cashier: 'merchant', doctor: 'doctor', police: 'police', farmer: 'farmer', chef: 'chef', merchant: 'merchant', office: 'office', fisher: 'fisher', fishing: 'fisher', rider: 'rider', beggar: 'beggar', thief: 'thief',
  pajama: 'pajama', tracksuit: 'tracksuit', hoodie: 'hoodie', cowboy: 'cowboy', devil: 'devil', pilot: 'pilot', magician: 'magician', thai: 'thai', tuxedo: 'tuxedo', admin: 'admin',
  student: 'student', scout: 'scout', songkran: 'songkran', lanna: 'lanna', phasin: 'phasin', muaythai: 'muaythai', bunny: 'bunny', chinese: 'chinese', lukthung: 'lukthung', chakri: 'chakri', angel: 'angel', santa: 'santa',
  tigerpj: 'tigerpj', photog: 'photog', scrubs: 'scrubs', raincoat: 'raincoat', explorer: 'explorer', catsuit: 'catsuit', chicken: 'chicken', surf: 'surf', hiphop: 'hiphop', thairoyal: 'thairoyal', martial: 'martial', knight: 'knight', fortune: 'fortune', dino: 'dino', tanktop: 'tanktop', bear: 'bear', panda: 'panda', cathood: 'cathood', kitsune: 'kitsune', swim: 'swim', maid: 'maid', coat: 'coat', racer: 'racer', winter: 'winter', loykrathong: 'loykrathong', wedding: 'wedding' };   // women's versions are the 'f' + name sheets
const ofName = o => o ? (me?.gender === 'f' && o.nf ? o.nf : o.name) : '';
const WALK = { front: ['down0', 'down1', 'down0', 'down2'], back: ['up0', 'up1', 'up0', 'up1'], side: ['left0', 'left1', 'left0', 'left2'] };
// admin cloak aura: a pulsing dark-violet glow behind the body, sparks orbiting around it (front half drawn over the sprite)
function drawAura(px, py, H, t, front, gold) {
  const fox = gold === 'fox'; if (fox) gold = false;   // 🦊 nine-tail fox: the violet aura with pink-magenta sparks
  const cy = py - H * .45, angel = gold === 'angel', fairy = gold === 'fairy', soft = angel || fairy;   // 😇 angel: white-gold light, halo and falling feathers · 🧚 fairy: pink-lilac glitter
  ctx.save();
  if (!front) {
    const pul = 1 + Math.sin(t / 380) * .08, r = H * .62 * pul, g = ctx.createRadialGradient(px, cy, H * .08, px, cy, r);
    if (angel) { g.addColorStop(0, 'rgba(255,252,230,.7)'); g.addColorStop(.55, 'rgba(255,236,170,.34)'); g.addColorStop(1, 'rgba(255,220,120,0)'); }
    else if (fairy) { g.addColorStop(0, 'rgba(255,214,242,.7)'); g.addColorStop(.55, 'rgba(238,160,255,.34)'); g.addColorStop(1, 'rgba(200,100,255,0)'); }
    else if (gold) { g.addColorStop(0, 'rgba(255,236,150,.7)'); g.addColorStop(.55, 'rgba(255,190,50,.38)'); g.addColorStop(1, 'rgba(200,120,0,0)'); }
    else if (fox) { g.addColorStop(0, 'rgba(225,150,255,.75)'); g.addColorStop(.55, 'rgba(160,60,235,.45)'); g.addColorStop(1, 'rgba(90,0,140,0)'); }
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
    ctx.fillStyle = `hsla(${angel ? 46 + i * 3 : fairy ? 300 + i * 8 : gold ? 42 + i * 2 : fox ? 285 + i * 6 : 270 + i * 9},100%,${(soft ? 82 : 70) + z * 8}%,${.85 * (1 - rise)})`;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 2.2), 0, 7); ctx.fill();
  }
  if (front && angel) {                                                          // a glowing halo over the head and a few feathers drifting down
    const hy = py - H * 1.02 + Math.sin(t / 700) * H * .02;
    const hw = Math.round(H * .4), hh = Math.round(H * .12), pad = Math.ceil(H * .3);
    const hc = glowGet('halo', hw, hh, pad, g => { g.strokeStyle = 'rgb(255,240,170)'; g.lineWidth = Math.max(2, H * .05); g.shadowColor = '#ffe9a0'; g.shadowBlur = H * .25; g.beginPath(); g.ellipse(hw / 2, hh / 2, hw / 2, hh / 2, 0, 0, 7); g.stroke(); });
    ctx.globalAlpha = .8 + Math.sin(t / 250) * .15; ctx.drawImage(hc, px - hw / 2 - pad, hy - hh / 2 - pad, hw + pad * 2, hh + pad * 2); ctx.globalAlpha = 1;
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
