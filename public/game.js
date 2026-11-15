'use strict';
(() => {
const $ = s => document.querySelector(s);
const COLORS = ['#4aa3d1', '#7ac96b', '#e2b13c', '#d9907a', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const job = c => me?.career === c || !!me?.admin;   // admins can do every job's work
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
fetch('assets/icons.json?v=1').then(r => r.json()).then(j => {
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
let panel = null, panelSig = '';
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
const whenChars = fn => { if (chImg) fn(); else chWait.push(fn); };
fetch('assets/pchar.json?v=a1').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { CH_ATLAS = { ...j, canvas: [j.w, j.h] }; chImg = im; chWait.splice(0).forEach(f => f()); }; im.src = 'assets/pchar.webp?v=a1'; });
const DEFAULT_LOOK = { hair: 'brown', shirt: 'white', pants: 'gray' };
// starter colours are known before login (the creator screen); everything else comes from the server
const STARTER_COLORS = { shirt: { white: '#ffffff', blue: '#5aa0e0', green: '#7cc06a', red: '#e0645a' }, hair: { brown: '#6e4528' }, pants: { gray: '#bdbdbd' } };
const lookColor = (cat, id) => G?.looks?.[cat]?.[id]?.color || STARTER_COLORS[cat][id] || STARTER_COLORS[cat][Object.keys(STARTER_COLORS[cat])[0]];
// one tinted frame, cached per (frame, colours)
function charFrame(frame, lk) {
  const key = `${frame}|${lk.shirt}|${lk.pants}|${lk.hair}`; let c = chCache.get(key); if (c) return c;
  const { w, h, rows, per } = CH_ATLAS, r0 = rows[frame] ?? 0, bx = per ? Math.floor(r0 / per) * w * 4 : 0, row = per ? r0 % per : r0;   // frames wrap into blocks of `per` rows
  c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.drawImage(chImg, bx, row * h, w, h, 0, 0, w, h);
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const t = tmp.getContext('2d');
  [['shirt', 1], ['pants', 2], ['hair', 3]].forEach(([cat, col]) => {
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h);
    t.drawImage(chImg, bx + col * w, row * h, w, h, 0, 0, w, h);
    t.globalCompositeOperation = 'multiply'; t.fillStyle = lookColor(cat, lk[cat]); t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(chImg, bx + col * w, row * h, w, h, 0, 0, w, h);
    g.drawImage(tmp, 0, 0);
  });
  chCache.set(key, c); if (chCache.size > 400) chCache.delete(chCache.keys().next().value);
  return c;
}
// one recoloured layer (hair) of a frame on its own canvas
function charLayer(frame, col, cat, lk) {
  const { w, h, rows, per } = CH_ATLAS, r0 = rows[frame] ?? 0, bx = per ? Math.floor(r0 / per) * w * 4 : 0, row = per ? r0 % per : r0;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const t = c.getContext('2d');
  t.drawImage(chImg, bx + col * w, row * h, w, h, 0, 0, w, h);
  t.globalCompositeOperation = 'multiply'; t.fillStyle = lookColor(cat, lk[cat]); t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'destination-in'; t.drawImage(chImg, bx + col * w, row * h, w, h, 0, 0, w, h);
  return c;
}
// women wearing an outfit that only exists as a men's sheet: her own head on the outfit's body ('head'), or her hair showing
// under the outfit's hat ('hair'); hoods, masks and helmets that cover everything keep the outfit as drawn
const FEM_HEAD = { office: 'head', merchant: 'head', thai: 'head', tuxedo: 'head', hoodie: 'head', pajama: 'head', tracksuit: 'head',
  chef: 'hair', farmer: 'hair', fisher: 'hair', rider: 'hair', cowboy: 'hair', magician: 'hair', beggar: 'hair', pilot: 'hair', devil: 'hair' };
const FEM_NECK = 40, FEM_HAT = 30;   // atlas rows: where her head ends / where her hair may show below a hat
function femOutfitFrame(sheet, step, lk) {
  const key = `F|${sheet}|${step}|${lk.shirt}|${lk.pants}|${lk.hair}`; let c = chCache.get(key); if (c) return c;
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
  chCache.set(key, c); return c;
}
// draw one character with its feet at (fx, fy), k = scale per sprite pixel; view = front | side | back; step = walk step 0-3; faceLeft for the side view
const OUTFIT_SHEET = { doctor: 'doctor', police: 'police', farmer: 'farmer', chef: 'chef', merchant: 'merchant', office: 'office', fisher: 'fisher', fishing: 'fisher', rider: 'rider', beggar: 'beggar', thief: 'thief',
  pajama: 'pajama', tracksuit: 'tracksuit', hoodie: 'hoodie', cowboy: 'cowboy', devil: 'devil', pilot: 'pilot', magician: 'magician', thai: 'thai', tuxedo: 'tuxedo', admin: 'admin' };
const WALK = { front: ['down0', 'down1', 'down0', 'down2'], back: ['up0', 'up1', 'up0', 'up1'], side: ['left0', 'left1', 'left0', 'left2'] };
// admin cloak aura: a pulsing dark-violet glow behind the body, sparks orbiting around it (front half drawn over the sprite)
function drawAura(px, py, H, t, front) {
  const cy = py - H * .45;
  ctx.save();
  if (!front) {
    const pul = 1 + Math.sin(t / 380) * .08, r = H * .62 * pul, g = ctx.createRadialGradient(px, cy, H * .08, px, cy, r);
    g.addColorStop(0, 'rgba(200,130,255,.75)'); g.addColorStop(.55, 'rgba(130,50,235,.42)'); g.addColorStop(1, 'rgba(60,0,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, cy, r * .78, r, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(214,170,255,${.35 + Math.sin(t / 300) * .2})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px, py - 2, H * .36 * pul, H * .11 * pul, 0, 0, 7); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = t / 900 + i * Math.PI * 2 / 9, z = Math.sin(a);
    if ((z > 0) !== front) continue;
    const rise = ((t / 1600 + i * .37) % 1), x = px + Math.cos(a) * H * .38, y = py - H * (.08 + rise * .85), s = (1.6 + z * .8) * (1 - rise * .5) * H / 60;
    ctx.fillStyle = `hsla(${270 + i * 9},100%,${70 + z * 10}%,${.85 * (1 - rise)})`;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 2.2), 0, 7); ctx.fill();
  }
  ctx.restore();
}
// ---- vehicles: atlas sprites w_<key>_s (side, faces left) / _f (front) / _b (back)
const vehSpr = (key, view) => atlas?.sprites?.[`w_${key}_${view === 'side' ? 's' : view === 'front' ? 'f' : 'b'}`];
const vehH = (key, view) => { const s = vehSpr(key, view); return s ? s[3] / atlas.tile * TS : TS; };
function drawVeh(key, view, faceLeft, px, py) {
  const s = vehSpr(key, view); if (!s || !atlasImg) return;
  const w = s[2] / atlas.tile * TS, h = s[3] / atlas.tile * TS;
  ctx.save(); ctx.translate(px, py + TS * .06); if (view === 'side' && !faceLeft) ctx.scale(-1, 1);
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
  drawCharTo(ctx, p, px + (view === 'side' ? (faceLeft ? TS * .12 : -TS * .12) : 0), py - lift, k, view, 0, faceLeft);
  drawVeh(p.veh, view, faceLeft, px, py);                                        // the bike in front hides the legs
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
function drawCharTo(g, p, fx, fy, k, view, step, faceLeft, seated) {
  // outfits (job clothes, reward outfits) are whole sheets; only the hair colour is applied on top
  const sheet0 = OUTFIT_SHEET[p.of], sheet = sheet0 && p.g === 'f' && CH_ATLAS.rows[`f${sheet0}:down0`] !== undefined ? 'f' + sheet0 : sheet0,   // women's uniform when there is one
    outfit = sheet && CH_ATLAS.rows[`${sheet}:down0`] !== undefined ? sheet + ':' : p.g === 'f' && CH_ATLAS.rows['f:down0'] !== undefined ? 'f:' : '';   // women have their own base sprite
  const lk = { ...DEFAULT_LOOK, ...(p.lk || {}) }, [ax, ay] = CH_ATLAS.feet;
  const fr0 = p.g === 'f' && sheet && outfit === sheet + ':' && sheet === sheet0 && FEM_HEAD[sheet] && CH_ATLAS.rows['f:down0'] !== undefined
    ? femOutfitFrame(sheet, WALK[view][step % 4], lk) : charFrame(outfit + WALK[view][step % 4], lk);
  const fr = p.dye ? dyeFrame(fr0, p.dye) : fr0;
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
  const url = location.origin + location.pathname, text = 'มาเล่น "เมืองชีวิตนี้เลือกได้" ด้วยกัน! เกมใช้ชีวิตออนไลน์ หางาน หาเงิน ซื้อบ้าน ตกปลา เล่นบนมือถือได้เลย';
  try { if (navigator.share) { await navigator.share({ title: 'เมืองชีวิตนี้เลือกได้', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย!', '📋'); }
  catch { prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน:', url); }
}
document.querySelectorAll('.shareBtn').forEach(b => b.onclick = shareGame);
const nameErr = v => /[^\x20-\x7e]/.test(v) ? 'ชื่อตัวละครใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น' : /\s/.test(v) ? 'ชื่อห้ามมีเว้นวรรค' : '';
$('#inName').addEventListener('input', e => { $('#loginErr').textContent = nameErr(e.target.value) ? nameErr(e.target.value).replace('ชื่อตัวละคร', 'ID') + ' (บัญชีเก่าที่เป็นภาษาไทยยังเข้าได้)' : ''; });
$('#createBack').onclick = () => { $('#createBox').classList.add('hidden'); $('#loginForm').classList.remove('hidden'); };
$('#createOk').onclick = () => {
  const cname = $('#inCname').value.trim();
  if (cname.length < 2) { $('#createErr').textContent = 'ตั้งชื่อตัวละครก่อน (2-16 ตัว)'; return; }
  $('#createErr').textContent = ''; creds = { ...creds, create: 1, cname, gender, shirt: SHIRT_IDS[avatar] }; loginBusy(true); wantLogin = true; connect();
};
let busyT = 0;
function loginBusy(on) {
  const b = $('#loginGo'), c = $('#createOk'); clearTimeout(busyT);
  b.disabled = c.disabled = !!on; b.classList.toggle('busy', !!on);
  b.firstElementChild.textContent = on ? '⏳ กำลังเข้าเมือง...' : '🚪 เข้าเมือง';
  if (on) busyT = setTimeout(() => loginBusy(false), 9000);
}
function loginShake() { const f = $('#createBox').classList.contains('hidden') ? $('#loginForm') : $('#createBox'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
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
  if (lite) { v.removeAttribute('autoplay'); login.classList.add('posterOnly'); }
  else {
    v.src = 'assets/ui/login_promo.mp4?v=2'; v.addEventListener('error', off); v.play().catch(() => { });
    v.addEventListener('playing', () => login.classList.add('vidOn'), { once: true });
  }
  snd.onclick = e => { e.stopPropagation(); v.muted = !v.muted; if (!v.muted) v.play().catch(() => { }); try { localStorage.setItem('lt_snd', v.muted ? '0' : '1'); } catch { } label(); };
  // browsers only allow sound after a tap: if the player liked sound last time, turn it on at their first tap
  if (wantSound) login.addEventListener('pointerdown', () => { v.muted = false; v.play().catch(() => { }); label(); }, { once: true });
  label();
  // phone: the form is a bottom dock, closed to a single big button until tapped (a saved account just plays on)
  const saved = !!(creds && creds.name && creds.pin), start = $('#startBtn');
  const open = () => { form.classList.add('open'); setTimeout(() => $(saved && $('#inName').value ? '#inPin' : '#inName').focus(), 120); };
  if (saved) { start.textContent = `▶ เล่นต่อ · ${creds.name}`; }
  start.onclick = () => { if (saved && !form.classList.contains('open')) { loginBusy(true); creds = { name: creds.name, pin: creds.pin }; wantLogin = true; connect(); } else open(); };
  $('#otherAcct').onclick = () => { $('#inName').value = ''; $('#inPin').value = ''; open(); };
  $('#promoPhone').onclick = () => { if (matchMedia('(max-width:860px)').matches) return; $('#inName').focus(); };   // desktop: the "enter the city" button in the video focuses the form
  return { open, stop() { v.pause(); v.removeAttribute('src'); v.load(); } };
})();
// ------------------------------------------------------------------ network
function connect() {
  if (ws && ws.readyState <= 1) { if (ws.readyState === 1) sendLogin(); return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (wantLogin) sendLogin(); };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (G) toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...', '📡', false);
    setTimeout(() => { if (wantLogin) connect(); }, 2000);
  };
}
function sendLogin() { send({ t: 'login', ...creds }); }
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
let fixId = 0;                          // the server's last position correction we have applied
const doAct = (st, a, extra = {}) => send({ t: 'act', st, a, ...extra });

function handle(m) {
  switch (m.t) {
    case 'loginfail': loginBusy(false); loginShake(); promo.open(); $('#loginErr').textContent = m.msg; $('#createErr').textContent = m.msg; wantLogin = false; break;
    case 'newchar':     // new ID: pick gender + first shirt once
      loginBusy(false); wantLogin = false; $('#loginForm').classList.add('hidden'); $('#createBox').classList.remove('hidden');
      $('#createName').textContent = 'ยินดีต้อนรับ ID: ' + m.name; $('#inCname').value = ''; paintSw(); setTimeout(() => $('#inCname').focus(), 50); break;
    case 'kicked': wantLogin = false; toast(m.msg, '⚠️', false); break;
    case 'init':
      if (G && G.build && m.build !== G.build) $('#updBar').classList.remove('hidden');     // a new version was deployed
      G = m; myId = m.id; P.clear(); buildAreas(); chCache.clear(); buildStaff(); fixId = 0; afkSent = false; running = false; $('#actBtn').classList.remove('run'); $('#runBtn').classList.remove('on'); lastInput = performance.now();
      creds = { name: creds.name, pin: creds.pin }; localStorage.setItem('lt_creds', JSON.stringify(creds)); promo.stop();
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden'); document.body.classList.add('inGame');
      chatLog.length = 0; m.chat.forEach(c => chatLog.push(c)); setTimeout(() => paintChatBox(), 0);
      { let tutDone = false; try { tutDone = !!localStorage.getItem('lt_tut2'); } catch { } tutPending = !!(m.isNew || !tutDone); }
      if (tutPending) setTimeout(() => me && showTut(0), 400);
      else setTimeout(() => me && checkNews(), 900);
      break;
    case 'me': { const prev = me; me = m; if (!prev || prev.frame !== m.frame) setTimeout(paintPortrait, 0); $('#meName').textContent = m.name; paintHud(); refreshPanel(); if (prev && prev.id === m.id) onMeDiff(prev, m); break; }
    case 'announce': setTicker(m.text); showTicker(); break;
    case 'wd': { if ((m.ann || '') !== tickerAnn) setTicker(m.ann); const hs = JSON.stringify(m.houses.map(h => [h[2], h[7], h[8], h[9]])); wd = m; clockOff = m.now - Date.now(); paintEvent(); refreshPanel(); if (G && hs !== lastHouses) { lastHouses = hs; layoutFurniture(); } break; }
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, ox: 0, oy: 0, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, lv: p.lv, dz: p.dz || [], pose: p.pose, title: p.title, tr: p.tr, g: p.g, lk: p.lk, npc: p.npc, adm: p.adm, w: p.w, sad: p.sad, of: p.of || '', face: p.face || '', th: p.th, afk: p.afk, wk: p.wk, desc: p.desc, tf: p.tf, veh: p.veh || '', pt: p.pt || '' });
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { if (Math.hypot(x - s.x, y - s.y) > 4) { s.rx = x; s.ry = y; } s.x = x; s.y = y; s.f = f; } } break;
    case 'fix': {
      if (m.fx) fixId = m.fx;
      const s = P.get(myId);
      if (s) {
        // small corrections are blended in over a few frames instead of snapping (no jitter against walls)
        if (!m.tp && Math.hypot(m.x - s.x, m.y - s.y) < 1.2) { s.ox += s.x - m.x; s.oy += s.y - m.y; }
        else { s.ox = s.oy = 0; }
        s.x = s.rx = m.x; s.y = s.ry = m.y; lastSent = '';
      }
      if (m.tp) { closePanel(); FX.play('whoosh'); holdAfterTp = true; fadeT = performance.now(); }
      break;
    }
    case 'toast': toast(m.msg, m.icon, m.ok); toastSfx(m); break;
    case 'catch': catchPop(m.item, m.first); break;
    case 'egg': eggFx(m); break;
    case 'amb': ambStart(m); break;
    case 'mypic': myPic = m.pic || ''; paintPortrait(); if (panel?.kind === 'profile') refreshPanel(true); break;
    case 'stockhist': stockHist[m.id] = { i: m.i, c: m.c }; if (panel?.kind === 'bank') document.querySelectorAll('#panelBody canvas[data-chart]').forEach(drawStockChart); break;
    case 'mailsent': { const ta = $('#mailText'); if (ta) ta.value = ''; FX.play('chime'); if (panel?.kind === 'mail') { panel.sent = m.to; panel.to = m.to; panel.sentT = Date.now(); refreshPanel(true); setTimeout(() => { if (panel?.kind === 'mail' && Date.now() - panel.sentT >= 3900) { panel.sent = ''; refreshPanel(true); } }, 4000); } break; }
    case 'mail': mailList = m.list || []; if (panel?.kind === 'mail') refreshPanel(true); break;
    case 'info': infoCache.set(m.id, m); if (panel?.kind === 'player' && panel.pid === m.id) refreshPanel(true); break;
    case 'tchat': tradeChat.push(m); if (tradeChat.length > 30) tradeChat.shift(); paintTradeChat(); if (!m.mine) FX.play('pop'); break;
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      paintChatBox(m);
      const s = P.get(m.id); if (s && !m.sys && !m.w) { s.bubble = m.text; s.bt = performance.now() + 6500; }
      if (m.sys) { if (/🦈|💎|🎊|🏅|🎓/.test(m.text)) FX.play('notice'); } else if (m.id !== myId) FX.play('pop');
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
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
const cbShow = m => cbTab === 'all' || (cbTab === 'sys' ? m.sys : cbTab === 'world' ? m.w : !m.sys && !m.w);
function paintChatBox(added) {
  const box = $('#cbMsgs'); if (!box) return;
  box.innerHTML = chatLog.filter(cbShow).slice(-40).map(m => m.sys ? `<div class="sys">• ${esc(m.text)}</div>`
    : `<div class="${m.call ? 'call' : m.w ? 'w' : ''}">${m.call ? '📞 ' : m.w ? '🌐 ' : ''}<b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('') || '<div class="sys">ยังไม่มีข้อความ</div>';
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
  $('#cbIn').placeholder = cbTab === 'world' ? 'แตะเพื่อพิมพ์ · แชทโลก (ทุกคนในเมืองเห็น)' : 'แตะเพื่อพิมพ์ · คุยกับคนใกล้ๆ';
  paintChatBox();
});
$('#cbForm').onsubmit = e => { e.preventDefault(); const i = $('#cbIn'); if (!i.value.trim()) return; const ch = cbTab === 'world' ? 'world' : 'near'; if (!worldOk(ch)) return; send({ t: 'chat', text: i.value, ch }); i.value = ''; i.blur(); };
foldChat(cbFolded);
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
  heads.push({ text: `${icon} ${msg}`, ok, t: t0, life: Math.min(7000, 3200 + msg.length * 45) });
  while (heads.length > 2) heads.shift();
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
  const fs = Math.max(11, Math.round(TS * .27)), lh = fs * 1.3, maxW = Math.min(VW - 40, TS * 6.5);
  ctx.save(); ctx.font = `600 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let by = (m.ry + (m.oy || 0)) * TS + Y - TS * 2.15 - (m.pose ? 0 : 0);
  const cx = clamp((m.rx + (m.ox || 0)) * TS + X, maxW / 2 + 8, VW - maxW / 2 - 8);
  for (let i = heads.length - 1; i >= 0; i--) {                    // newest closest to the head, older ones above
    const h = heads[i], age = now - h.t, a = Math.min(1, age / 180, (h.life - age) / 450);
    const lines = wrapText(h.text, maxW - 18), w = Math.max(...lines.map(l => textW(l))) + 18, hh = lines.length * lh + 8;
    by -= hh + 4; const y = by + (1 - Math.min(1, age / 180)) * 8;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = h.ok ? 'rgba(255,248,232,.96)' : 'rgba(255,232,224,.97)'; ctx.strokeStyle = h.ok ? '#6b8f2c' : '#b8452f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(cx - w / 2, y, w, hh, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2410'; lines.forEach((l, k) => ctx.fillText(l, cx, y + 4 + lh * (k + .5)));
  }
  ctx.restore();
}
function popup(html, buttons, ms = 20000) {
  const d = document.createElement('div'); d.className = 'req';
  d.innerHTML = `<div>${html}</div><div class="btns"></div>`;
  for (const [label, cls, fn] of buttons) { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = () => { fn(); d.remove(); }; d.querySelector('.btns').appendChild(b); }
  $('#reqs').appendChild(d); setTimeout(() => d.remove(), ms);
  return d;
}
function showReq(r) {
  const what = r.kind === 'trade' ? 'ขอแลกเปลี่ยนของกับคุณ 🤝' : r.kind === 'phone' ? 'ขอเบอร์โทรของคุณ 📱 (ตกลง = แลกเบอร์กัน)' : `เสนอปฐมพยาบาลให้คุณ 💉 ค่ารักษา <b>${money(r.fee)}</b>`;
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
  c.classList.remove('hidden'); c.classList.toggle('late', left < 30); c.textContent = `🐕 ตามหา น้อง${q.name} · ${tm}`;
  document.querySelectorAll('.dogcd').forEach(el => { el.textContent = tm; });
}
setInterval(paintDogChip, 500);
$('#dogChip').onclick = () => { const q = me?.dogq; if (q) popup(`🐕 ตามหา "น้อง${q.name}" ของ${q.owner}<br>📍 แถว ${q.hint} · ดูวงสีเหลืองบนมินิแมพ ฟังเสียงเห่า`, [['ตกลง', 'good', () => { }]], 8000); };
$('#cbOn').onclick = () => openPanel({ kind: 'friends' });
$('#callChip').onclick = () => openPanel({ kind: 'phone', tab: 'call' });
const CAREER_ICON = c => G?.careers[c]?.icon || '';

// ------------------------------------------------------------------ HUD
function paintCardClock(h) {
  const dt = me?.date; if (dt) $('#cDate').textContent = `${dt.day} ${G.months[dt.month]}`;
  $('#cTime').textContent = hhmm(h);
  if (wd) $('#cbOn').textContent = `${wd.on} ออนไลน์`;
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
  paintPortrait(); $('#mailBtn').classList.toggle('has', (me.mailN || 0) > 0);
  const dzBox = $('#dzChips'); const html = chips.join('');
  if (dzBox.dataset.h !== html) { dzBox.dataset.h = html; dzBox.innerHTML = html; dzBox.querySelectorAll('[data-dz]').forEach(c => c.onclick = () => dzInfo(c.dataset.dz)); }
  $('#meMoney').textContent = Math.round(me.money).toLocaleString('en-US'); $('#meGems').textContent = me.gemInf ? '∞' : (me.gems || 0).toLocaleString('en-US');
  const qs = me.quests; if (qs) { const d = qs.list.filter(x => x.done).length; const ql = $('#qline'); ql.textContent = d === 3 ? 'เควสต์ครบแล้ว ✅' : `เควสต์ ${d}/3 · กดดู`; ql.classList.toggle('all', d === 3); $('#qBtn').classList.toggle('has', d < 3); }
  $('#bJ').style.width = (me.happy ?? 80) + '%'; $('#vJ').textContent = Math.floor(me.happy ?? 80);
  $('#bJ').style.background = me.happy < 20 ? '#7d7d9c' : me.happy < 45 ? '#d9a94a' : '#f08ad0';
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
  $('#vE').textContent = Math.floor(me.energy); $('#vH').textContent = Math.floor(me.hunger); $('#vL').textContent = Math.floor(me.health);
  $('#card').style.borderLeftColor = COLORS[me.avatar ?? 0] || '#999';
  placeLog();
  $('#restBtn').classList.toggle('on', me.pose === 'rest');
  const atDesk = me.career === 'office' && me.chair != null && me.chair >= 0 || me.desk != null && me.desk >= 0; $('#mgBtn').classList.add('hidden'); if (!$('#mg').classList.contains('hidden')) mgClose();   // (mini-games were removed)
  $('#restBtn').innerHTML = me.pose === 'rest' ? '<span>🧍</span><small>ลุก</small>' : '<span>😌</span><small>พัก</small>';
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
  dn.innerHTML = me.down.kind === 'veg' ? `<b>🥬 หิวจนหมดแรง นอนเป็นผัก</b><span>ร่างกายจะค่อยๆ ฟื้นเอง (❤️ ${Math.floor(me.health)}/15)</span>`
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
const BGM = { day: null, night: null, vol: .42 };
function bgmTick() {
  if (!G || !me) return;
  const h = hourNow(), want = FX.opts.music ? (h >= 6 && h < 18.5 ? 'day' : 'night') : null;
  for (const k of ['day', 'night']) {
    let a = BGM[k];
    if (!a && k === want) { a = BGM[k] = new Audio(`assets/music/${k}.mp3?v=1`); a.loop = true; a.volume = 0; a.preload = 'auto'; }
    if (!a) continue;
    const target = k === want ? BGM.vol : 0;
    a.volume = Math.max(0, Math.min(1, a.volume + (target - a.volume) * .06));
    if (target > 0 && a.paused) a.play().catch(() => { });
    if (target === 0 && a.volume < .01 && !a.paused) a.pause();
  }
}
setInterval(bgmTick, 100);
addEventListener('pointerdown', () => { for (const k of ['day', 'night']) { const a = BGM[k]; if (a && a.paused && a.volume > 0) a.play().catch(() => { }); } });   // after a tap the browser lets it play
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
const placeLog = () => { const cd = $('#card'), db = $('#docBack'); $('#feed').style.top = (cd.offsetTop + cd.offsetHeight + (guide ? 36 : 6) + (db && !db.classList.contains('hidden') ? 34 : 0)) + 'px'; document.body.style.setProperty('--cardW', (cd.offsetLeft + cd.offsetWidth) + 'px'); };
addEventListener('resize', () => placeLog());
const setCard = mini => { $('#card').classList.toggle('mini', mini); placeLog(); try { localStorage.setItem('lt_card', mini ? '1' : '0'); } catch { } };
$('#cardToggle').onclick = e => { e.stopPropagation(); FX.play('click'); setCard(!$('#card').classList.contains('mini')); };
{ let c = null; try { c = localStorage.getItem('lt_card'); } catch { } setCard(c === null ? innerWidth < 700 && innerHeight > innerWidth : c === '1'); }
// what each bar means and how to fill it
const BAR_HELP = {
  energy: ['⚡', 'พลังงาน: ใช้ตอนทำงาน/ตกปลา/เรียน · เพิ่มได้จาก 😌 นั่งพักหลับตา (เร็ว 3 เท่า), นั่งม้านั่ง, นอนที่บ้าน, กินอาหาร หรือเครื่องดื่มชูกำลัง'],
  hunger: ['🍗', 'ความอิ่ม: ลดลงเรื่อยๆ · เพิ่มได้จากการกินอาหาร (ร้านอาหาร ตลาด สั่งในมือถือ หรือของในกระเป๋า 🎒) ถ้าหิวนานเลือดจะลด'],
  health: ['❤️', 'สุขภาพ: ลดเมื่อหิวนานหรือป่วย · เพิ่มได้จาก 😌 นั่งพัก (ถ้าไม่หิว), กินให้อิ่มเกิน 60, ชุดปฐมพยาบาล 🩹, นอนเตียงให้หมอรักษา'],
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
const setMenu = open => { $('#menu').classList.toggle('hidden', !open); $('#menuToggle').classList.toggle('closed', !open); $('#menuToggle').title = open ? 'ซ่อนเมนู' : 'เปิดเมนู'; try { localStorage.setItem('lt_menu', open ? '1' : '0'); } catch { } };
$('#menuToggle').onclick = () => { FX.play('click'); setMenu($('#menu').classList.contains('hidden')); };
{ let m = '1'; try { m = localStorage.getItem('lt_menu') ?? '1'; } catch { } setMenu(m !== '0'); }
$('#mapX').onclick = closeMap;
$('#mapView').addEventListener('pointerdown', e => { if (e.target.id === 'mapView') closeMap(); });
$('#panel').addEventListener('pointerdown', e => { if (e.target === $('#panel')) closePanel(); });
$('#restBtn').onclick = () => { if (!me || me.down) return; FX.play('click'); send({ t: 'rest', on: me.pose !== 'rest' }); };
// running: toggle with the 🏃 button, or hold Shift on a keyboard
let running = false, shiftRun = false, runSetT = 0;
const canRun = () => !!me && me.energy > G.run.minEnergy && !me.down;
function setRun(on) { if (on && !canRun()) { if (me) toast('เหนื่อยเกินไป วิ่งไม่ไหว พักหรือกินอะไรก่อน', '🥵', false); on = false; } if (on === running) return; running = on; runSetT = performance.now(); send({ t: 'run', on }); $('#actBtn').classList.toggle('run', on); $('#runBtn').classList.toggle('on', on); }
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
const areaOf = (x, y) => G?.areas.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
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
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }
  keys[e.key.toLowerCase()] = true;
  if (!G) return;
  if (e.key === 'e' || e.key === ' ') { e.preventDefault(); if (FG) { if (!e.repeat) fightPress(); reelHold = true; return; } if (!e.repeat) onAction(); }
  if (e.key === 'Enter' && !panel) { e.preventDefault(); openChatBox(); }
  if (e.key === 'Escape') { closePanel(); }
  if (e.key === 'b' || e.key === 'i') openPanel({ kind: 'bag' });
  if (e.key === 'm') { if ($('#mapView').classList.contains('hidden')) { mapZoom = 1; openMap(); } else $('#mapX').click(); }
  if (e.key === 'q') openPanel({ kind: 'quests' });
  if (e.key === 'h' || e.key === '?') openPanel({ kind: 'keys' });
  if (e.key === 'p') openPanel({ kind: 'phone' });
  if (e.key === 'r') $('#restBtn').click();
  if (e.key === 'f') talk();
  if (e.key === 'Shift' && !running) { shiftRun = true; setRun(true); }
  if (e.key === 'c' || e.key === 't' || e.key === 'Enter' && panel) { e.preventDefault(); openChatBox(); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.key === 'e' || e.key === ' ') reelHold = false; if (e.key === 'Shift' && shiftRun) { shiftRun = false; setRun(false); } });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const cv = $('#cv'), mainCtx = cv.getContext('2d'); let ctx = mainCtx;   // ctx is swapped to an offscreen canvas while ground chunks are baked
let TS = 40, VW = 0, VH = 0, DPR = 1;
// the mouse wheel zooms the town in and out (computers); kept between visits
let zoomMul = 1; try { zoomMul = clamp(+localStorage.getItem('lt_zoom') || 1, .7, 1.6); } catch { }
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
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
function camera() {
  const m = P.get(myId); let x = m ? m.rx + m.ox : 50, y = m ? m.ry + m.oy : 36;
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
  const here = areaOf(m.x, m.y)?.id, myRoom = roomOf(m.x, m.y);
  for (const q of [...PETST.values(), ...(myRoom?.rk === 'petshop' ? shopPets(myRoom) : [])]) {   // petting a pet (yours, someone's or the shop's) makes it hop happily
    if (areaOf(q.x, q.y)?.id !== here || Math.hypot(q.x - wx, (q.y - .35) - wy) > .6) continue;
    return petPlay(q, true);
  }
  let hit = null, hd = .8;
  for (const p of P.values()) {
    if (p.id === myId || areaOf(p.x, p.y)?.id !== here) continue;
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
    if (p.id === myId || areaOf(p.x, p.y)?.id !== here) continue;
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

// ------------------------------------------------------------------ interaction
let near = null, actCd = 0;
function findNear() {
  const m = P.get(myId); if (!m || !G || me?.down) return null;
  const here = areaOf(m.x, m.y)?.id;
  let best = null, bd = 1e9;
  for (const s of G.stations) {
    if (s.area !== here || s.type === 'yzone' && yzOpen(s.idx, s.z)) continue;
    const d = Math.hypot(s.x - m.x, s.y - m.y);
    if (d <= s.r && d < bd) { bd = d; best = s; }
  }
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
function onAction() {
  if (!near) { toast('เดินเข้าไปใกล้สถานที่ต่างๆ (ไอคอนลอย) เพื่อใช้งาน', '👣', true); return; }
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
  if (near.type === 'wish' || near.type === 'secret') { if (t < actCd) return; actCd = t + 900; return doAct(near.id, near.type === 'wish' ? 'toss' : 'read'); }
  if (panel?.st === near.id) { closePanel(); return; }
  if (dlgQ) { dlgTap(); return; }
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
function frame(t) {
  requestAnimationFrame(frame); dlgTick();
  if (G && me && t - homeBtnT > 400) { homeBtnT = t; const m0 = P.get(myId), r0 = m0 && areaOf(m0.x, m0.y); { const vs = (me.vehicles || []).filter(k => G.shop.vehicles[k]), rb = $('#rideBtn'), v = G.shop.vehicles[me.ride]; rb.classList.toggle('hidden', !vs.length || !!(r0 && r0.kind === 'room')); rb.classList.toggle('on', !!v); const lbl = v ? `<span>🚶</span><small>ลงรถ</small>` : `<span>${G.shop.vehicles[vs[0]]?.icon || '🛵'}</span><small>ขี่รถ</small>`; if (rb.innerHTML !== lbl) rb.innerHTML = lbl; } paintDocBack(); const atHome = r0 && (r0.rk === 'house' || r0.yard) && r0.house === me.house; $('#homeBtn').classList.toggle('hidden', !atHome || !!placing); if (placing && !atHome) endPlace(); }
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
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
    const l = Math.hypot(dx, dy); meMoving = false;
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      if (running && (!canRun() || me.run === false && performance.now() - runSetT > 1500)) setRun(false);
      const rv = me.ride && !roomOf(m.x, m.y) && !me.pose ? G.shop.vehicles[me.ride] : null, sp = G.speed * (me.speedBase || me.speed || 1) * (rv ? rv.speed : running ? G.run.mul : 1) * dt;
      // round to what we send so client and server always agree
      const r2 = v => Math.round(v * 100) / 100;
      const ar0 = rv?.fly ? areaOf(m.x, m.y) : null, stuck = !ar0 && blockedAt(m.x, m.y), free = (x, y) => stuck && !solid(x, y) ? true : ar0 ? x > ar0.x + .6 && y > ar0.y + .8 && x < ar0.x + ar0.w - .6 && y < ar0.y + ar0.h - .4 : !blockedAt(x, y);   // helicopters fly over everything, but stay on this map
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
    // watchdog: trying to walk but not moving for a while (and not against a wall) -> clear whatever holds us and ask the server to resync
    { const tryMove = (dx || dy) && !me.down, moved = Math.hypot(m.x - ox0, m.y - oy0) > .002, wall = tryMove && blockedAt(m.x + Math.sign(dx) * .35, m.y + Math.sign(dy) * .35);
      stuckT = tryMove && !moved && !wall ? stuckT + dt : 0;
      if (stuckT > 1.2 && performance.now() > unstickAt) { unstickAt = performance.now() + 4000; stuckT = 0; holdAfterTp = false; reelHold = false; if (!me.cast) FG = null; send({ t: 'unstick', x: m.x, y: m.y, why: JSON.stringify({ cast: me.cast?.state || 0, FG: !!FG, joy: !!joy, pose: me.pose || 0, down: me.down?.kind || 0 }) }); } }
    // walking into a gate's yellow circle takes you through it, no button needed
    if ((dx || dy) && near?.type === 'gate' && Math.hypot(near.x - m.x, near.y - m.y) < near.r * .75 && performance.now() > actCd) { actCd = performance.now() + 2000; autoPath = null; doAct(near.id, 'go'); }
    // walking down onto the door mat takes you outside, no button needed
    if (dy > .3 && near?.type === 'exit' && Math.hypot(near.x - m.x, near.y - m.y) < Math.max(.7, near.r * .6) && performance.now() > actCd) { actCd = performance.now() + 1500; autoPath = null; send({ t: 'exit' }); }
    m.rx = m.x; m.ry = m.y;
    m.ox *= 0.8; m.oy *= 0.8; if (Math.abs(m.ox) < .002) m.ox = 0; if (Math.abs(m.oy) < .002) m.oy = 0;
    sendT += dt;
    const sig = m.x.toFixed(2) + ',' + m.y.toFixed(2);
    if (sendT > 0.066 && sig !== lastSent) { sendT = 0; lastSent = sig; send({ t: 'p', x: +m.x.toFixed(2), y: +m.y.toFixed(2), f: m.f, fx: fixId }); }
  }
  for (const p of P.values()) if (p.id !== myId) { const k = Math.min(1, dt * 12); p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }
  stepPets(dt); stepFight(dt);

  near = findNear();
  const ab = $('#actBtn');
  if (near) {
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
  if (near?.type === 'deliver') { const px = near.x * TS + X, py = near.y * TS + Y; ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py + TS * .2, TS * .9, TS * .45, 0, 0, 7); ctx.stroke(); }
  const ents = [];
  const vis = (x, y, r = 8) => inside(x, y) && x * TS + X > -r * TS && x * TS + X < VW + r * TS && y * TS + Y > -2 * TS && y * TS + Y < VH + r * TS;
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) ents.push([b.y + b.h, 0, b]);
  for (const p of G.props) if (vis(p.x, p.y, 4)) ents.push([GROUND_PROP.test(p.s) ? -1e9 : p.y, 1, p]);   // manholes, puddles, grass tufts lie flat
  for (const tr of G.trees) if (vis(tr[0] + .5, tr[1] + 1, 4)) ents.push([tr[1] + .95, 2, tr]);
  for (const f of roomFurniture) if (vis(f[1], f[2], 4)) ents.push([/rug|welcome|f_mat|^~|^y_soil/.test(f[0]) ? -1e9 : f[2], 3, f]);   // rugs and mats lie on the floor: always under people
  for (const p of P.values()) if (vis(p.rx, p.ry, 3)) ents.push([p.ry + .3 + (p.veh && G.shop?.vehicles?.[p.veh]?.fly && !roomOf(p.x, p.y) ? 1e5 : 0), 4, p]);   // helicopters fly over the roofs
  for (const p of P.values()) { const q = p.pt && PETST.get(p.id); if (q && vis(q.x, q.y, 3)) ents.push([q.y + .3, 6, q]); }
  { const q = lostDog(); if (q && vis(q.x, q.y, 3)) ents.push([q.y + .3, 6, q]); }
  misEnts(ents, vis);
  rivalEnts(ents, vis);
  if (me?.cook && myRoom?.rk === 'kitchen') ents.push([1e8, 7, { k: 'cook' }]);
  if (myRoom?.rk === 'petshop') for (const q of shopPets(myRoom)) ents.push([q.y + .3, 6, q]);   // the shop's own animals
  for (const n of STAFF) if (vis(n.rx, n.ry, 3)) ents.push([n.ry + .3, 4, n]);
  { const t0 = performance.now(); stepAmbs(Math.min(.1, (t0 - (window.__ambT || t0)) / 1000)); window.__ambT = t0; }
  for (const a of ambs) if (a.area === A?.id) { if (!a.body.gone) ents.push([a.body.ry + .3, 4, a.body]); ents.push([a.y + halfY(a), 5, a]); }
  if (A?.id === 'town') { stepTraffic(); for (const c of traffic) if (vis(c.x, c.y, 4)) ents.push([c.y + halfY(c), 5, c]); }
  if (myRoom?.rk === 'hospital') (wd?.beds || []).forEach((b, i) => { if (b && b[5]) { const s = STN('bed' + i); ents.push([s.y + .3, 4, npcPatient(b, s)]); } });
  ents.sort((a, b) => a[0] - b[0]);
  if (!myRoom) drawCastShadows(ents, X, Y, night);
  for (const [, k, e] of ents) {
    if (k === 0) drawBuildingSprite(e, X, Y);
    else if (k === 1) { if (!e.open || isOpen(e.open)) spr(e.s, e.x, e.y - (e.z || 0), X, Y); }   // z: hung on a wall; open: only while that shop is open
    else if (k === 2) spr(e[2], e[0] + .5, e[1] + 1.05, X, Y);
    else if (k === 3) {
      if (e[0][0] === '~') drawStairs(e[1], e[2], e[0] === '~stairs_d', X, Y);
      else if (e[3] === 'ghost') { ctx.globalAlpha = .6 + Math.sin(t / 200) * .2; spr(e[0], e[1], e[2], X, Y); ctx.globalAlpha = 1; ctx.strokeStyle = '#ffd770'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.ellipse(e[1] * TS + X, e[2] * TS + Y, TS * .55, TS * .2, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      else { spr(e[0], e[1], e[2], X, Y); if (e[4]) drawYardCrop(e, X, Y, t); }
    }
    else if (k === 5) drawCar(e, X, Y);
    else if (k === 6) drawPet(e, X, Y, t);
    else if (k === 7) drawMisThing(e, X, Y, t);
    else drawPlayer(e, X, Y, t);
  }
  if (A?.yard) drawYardLocks(A, X, Y, t);
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) drawBuildingSign(b, X, Y);
  for (const s of G.stations) {
    if (s.type === 'gplot' || !inside(s.x, s.y)) continue;
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -60 || py < -60 || px > VW + 60 || py > VH + 60) continue;
    const isNear = near && near.id === s.id;
    if (/^(door|exit|bed|hbed|chair|seat|staff|sdesk|trash|wish|secret)$/.test(s.type) && !isNear) continue;
    if (s.type === 'door' && s.house !== undefined) continue;
    if (s.type === 'yzone' && yzOpen(s.idx, s.z)) continue;
    ctx.font = `${Math.round(TS * (isNear ? .7 : .55))}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(s.type === 'door' ? '🚪' : s.icon, px, py - TS * (s.type === 'lot' || s.type === 'gate' ? 1.1 : 1.7) + Math.sin(t / 380 + s.x) * 3);
    if (s.type === 'gate') sign(`${s.icon} ${s.label}`, px, py - TS * 1.8, { size: TS * .3, bg: 'rgba(40,90,150,.92)' });
  }
  drawBobber(X, Y, t); drawMisGuide(X, Y, t);
  drawSirens(X, Y);
  FX.draw(ctx, X, Y, TS);
  drawGuide(X, Y, t);
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
  if (!myRoom) drawRain(t);
  // inside: no day/night, but the office turns its lights off after work hours
  let dark = myRoom ? 0 : night;
  if (myRoom && myRoom.rk === 'office') { const h = hourNow(); if (h >= G.shift.ot || h < 6) dark = 0.62; }
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); if (!myRoom) drawLights(X, Y, dark); }
  drawHeads(X, Y);
  if (myRoom && myRoom.rk === 'office' && dark > 0) sign(`💡 ไฟปิดแล้ว (เลิกงาน ${hhmm(G.shift.ot)})`, VW / 2, VH * .2, { size: 14 });
  // short fade through black when you go through a door or a gate
  const fp = (performance.now() - fadeT) / 350;
  if (fp < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fp})`; ctx.fillRect(0, 0, VW, VH); }
  drawMini();
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
function drawSoilCrop(e, X, Y, t) {
  const pl = wd?.houses?.[e[4].house]?.[10]?.[e[4].k], px = e[1] * TS + X, py = (e[2] - .5) * TS + Y;
  if (near?.id === 'yf:' + e[4].k) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2; ctx.strokeRect(px - TS / 2 + 1, py - TS / 2 + 1, TS - 2, TS - 2); }
  if (!pl) return;
  const [crop, readyAt] = pl, it = G.items[crop], total = G.crops[crop].grow * 1000, left = readyAt - (Date.now() + clockOff), prog = clamp(1 - left / total, 0, 1);
  const sway = Math.sin(t / 600 + e[1] * 3) * TS * .02;
  if (left > 0) {
    const h = TS * (.14 + prog * .4);
    ctx.fillStyle = '#3f8a2a'; ctx.fillRect(px - 1 + sway, py + TS * .2 - h, 2, h); ctx.fillStyle = prog < .5 ? '#7cc843' : '#4fa632';
    ctx.beginPath(); ctx.ellipse(px - h * .35 + sway, py + TS * .2 - h * .7, h * .38, h * .2, -.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px + h * .35 + sway, py + TS * .2 - h * .85, h * .38, h * .2, .5, 0, 7); ctx.fill();
  } else { ctx.fillStyle = '#fff'; ctx.font = `${Math.round(TS * .55)}px serif`; ctx.fillText(it.icon, px, py + Math.sin(t / 260 + e[1] * 4) * 1.5); }
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
const MIS_CAREERS = ['office', 'farmer', 'merchant', 'chef', 'doctor', 'police', 'beggar', 'rider'];
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
  c.textContent = `${m.icon} ${cur ? (MIS_K[cur.k] || '') + ' ' + cur.label : m.title}${extra} · ${tm}`;
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
  if (!c || !m || areaOf(m.x, m.y)?.id !== 'town') { lostQ = null; return null; }
  if (!lostQ || lostQ.key !== c.t0) lostQ = { key: c.t0, id: c.dog, x: c.x, y: c.y, view: 'down', flip: false, phase: 0, moving: false, hop: 0, big: 1, hopDur: 420, idleAt: performance.now() + 1500, shop: 0, lost: 1, barkAt: 0 };
  const now0 = performance.now(), d = Math.hypot(m.rx - c.x, m.ry - c.y);
  if (now0 > lostQ.idleAt) { lostQ.idleAt = now0 + 1800 + Math.random() * 2500; petPlay(lostQ, false); lostQ.big = .8 + Math.random() * .5; lostQ.flip = Math.random() < .5; }
  if (now0 > lostQ.barkAt && d < 16) { lostQ.barkAt = now0 + 2800 + Math.random() * 2500; FX.play('pet', [PET_VOICE[c.dog] || 'dog', Math.max(.12, 1 - d / 16)]); if (d < 9) FX.float(c.x, c.y - 1, '🐕', '#fff', .45); }
  return d < 11 ? lostQ : null;                    // out of sight until you are close
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
      q.phase += step * 2.4; q.idleAt = now0 + 2500 + Math.random() * 3500;
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
  else if (q.moving) { const b = Math.abs(Math.sin(q.phase * Math.PI)); h = b * TS * .2; sy = 1 - .08 * Math.max(0, .25 - b) * 4; sx = 2 - sy; }
  else { const br = Math.sin(now0 / 420 + q.x * 3); sy = 1 + br * .02; sx = 2 - sy; }                // breathing
  const px = Math.round(q.x * TS + X), py = Math.round(q.y * TS + Y + TS * .32);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; const shr = 1 - Math.min(.45, h / (TS * .9));
  ctx.beginPath(); ctx.ellipse(px, py, TS * .3 * meta.sz * shr + TS * .06, TS * .1 * shr, 0, 0, 7); ctx.fill();
  const group = q.view === 'up' ? 1 : q.view === 'side' ? 2 : 0, nf = meta.n[group];
  const fr = q.moving ? Math.floor(q.phase * 1.5) % Math.max(1, nf) : 0;   // idle = frame 0
  const sw = size * sx, sh = size * sy;
  const legend = G.pets?.[q.id]?.rar >= 5;
  if (legend) petGlow(px, py - h - sh * .45, size, now0);
  ctx.save(); ctx.translate(px, py - h);
  if (q.view === 'side' && q.flip) ctx.scale(-1, 1);
  ctx.drawImage(petImg, (group * 4 + fr) * C, meta.row * C, C, C, -sw / 2, -sh + size * .03, sw, sh);
  ctx.restore();
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
function drawPetIcon(c, id) {
  const meta = PET_AT.pets[id]; if (!meta) return; const g = c.getContext('2d'), C = PET_AT.cell;
  g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = true;
  const k = Math.min(c.width, c.height) * (.62 + meta.sz * .38) / C;
  g.drawImage(petImg, 0, meta.row * C, C, C, (c.width - C * k) / 2, c.height - C * k + 2, C * k, C * k);
}
const SKIN = ['#f3cfa6', '#e2b084', '#c98f60', '#8f5c3c'], HAIR = ['#2b1d14', '#5a3a22', '#b8692a', '#e5c15a', '#1c1c30', '#6d3b8f', '#c9473f', '#ececec'];
function drawPlayer(p, X, Y, t) {
  if (!chImg) return drawPlayerPixel(p, X, Y, t);
  const snap = v => Math.round(v * DPR) / DPR;
  const px0 = snap((p.rx + (p.ox || 0)) * TS + X), py0 = snap((p.ry + (p.oy || 0)) * TS + Y + TS * .32);
  if (px0 < -80 || py0 < -140 || px0 > VW + 80 || py0 > VH + 140) return;
  const pose = p.pose, lying = pose === 'bed' || pose === 'hosp' || pose === 'veg', sitting = pose === 'seat' || pose === 'chair' || pose === 'rest' || pose === 'beg' || pose === 'jail' || pose === 'study';
  const ang = (p.f / 8) * Math.PI * 2 - Math.PI, cx = Math.cos(ang), cy = Math.sin(ang);
  // facing from the 8-way index with hysteresis: on a diagonal keep the current facing if it is one of
  // the two neighbours, so a wobbling joystick does not flip the view (head turning) every frame
  const CARD = { 0: 'left', 2: 'up', 4: 'right', 6: 'down' }, DIAG = { 1: ['left', 'up'], 3: ['up', 'right'], 5: ['right', 'down'], 7: ['down', 'left'] };
  const f8 = ((p.f | 0) % 8 + 8) % 8;
  let dir = CARD[f8] || (DIAG[f8].includes(p.view) ? p.view : DIAG[f8].find(d => d === 'up' || d === 'down'));
  if (CARD[f8] && p.view && p.view !== dir && performance.now() - (p.viewT || 0) < 120) dir = p.view;   // tiny debounce
  if (dir !== p.view) { p.view = dir; p.viewT = performance.now(); }
  if (sitting || lying) dir = 'down';
  const moving = !sitting && !lying && (p.id === myId ? meMoving : Math.hypot(p.x - p.rx, p.y - p.ry) > .02);
  p.walk = (p.walk || 0) + (moving ? (p.id === myId && running ? .34 : .2) : 0);
  const frame = moving ? Math.floor(p.walk / 1.4) % 4 : 0, bob = 0;   // the step frames already move; an extra bounce made the sprite shake
  const view = dir === 'down' ? 'front' : dir === 'up' ? 'back' : 'side';
  const k = TS * 1.55 / CH_ATLAS.h, H = CH_ATLAS.h * k;
  let px = px0, py = py0;
  const RV = p.veh && !lying && !sitting && G.shop?.vehicles?.[p.veh] && !roomOf(p.x, p.y) ? G.shop.vehicles[p.veh] : null;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py, TS * (lying ? .55 : RV ? (RV.kind !== 'moto' ? (view === 'side' ? 1.2 : .75) : view === 'side' ? .8 : .4) : .32), TS * .11, 0, 0, 7); ctx.fill();
  if (RV) { drawRide(p, RV, px, py, k, view, dir); nameAndBubble(p, px, py - (RV.kind !== 'moto' ? vehH(p.veh, view) + TS * (RV.kind === 'heli' ? 1.35 : .15) : H * .97 + TS * (p.veh === 'escoot' ? .12 : .32)), p.id === myId, t); return; }
  const aura = p.of === 'admin' && !lying, now0 = performance.now();
  if (aura) drawAura(px, py, H, now0, false);
  ctx.save();
  if (lying) { ctx.translate(px, py - TS * .25); ctx.rotate(-Math.PI / 2); drawCharTo(ctx, p, H * .45, TS * .25, k, 'front', 0); }
  else if (sitting) drawCharTo(ctx, p, px, py, k, 'front', 0, false, true);   // seated: whole body, legs folded
  else drawCharTo(ctx, p, px, py - bob, k, view, frame, dir === 'left');
  ctx.restore();
  if (aura) drawAura(px, py, H, now0, true);
  const mine = p.id === myId, top = lying ? py0 - TS * .9 : py - H * .97 - bob + (sitting ? H * .19 : 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (pose === 'beg') { ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText('🥣', px, py0 - TS * .05); }
  // little emote sprites from the sheet: dizzy when sick or knocked out, a light bulb over your head when you crave something
  const emote = pose === 'hosp' || pose === 'veg' || (p.dz || []).length ? '💫' : mine && me?.craving ? '💡' : pose === 'seat' ? '❤️' : null;
  if (emote) { ctx.font = `${Math.round(TS * .38)}px serif`; ctx.fillText(emote, px + TS * .42, top + TS * .05 + Math.sin(t / 300) * 3); }
  const badge = pose === 'jail' ? '⛓️' : pose === 'rest' || pose === 'bed' ? '💤' : pose === 'study' ? '📖' : p.sad ? '😞' : '';
  if (badge) { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(badge, px - TS * .42, top + Math.sin(t / 300) * 3); }
  nameAndBubble(p, px, top, mine, t);
}
const npcPatients = {};
function npcPatient(b, s) {
  const key = b[1]; let n = npcPatients[key];
  if (!n) { const h = [...String(b[0])].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7); n = npcPatients[key] = { id: key, npc: 1, name: b[0], g: h % 2 ? 'f' : 'm', lk: { hair: ['brown', 'black', 'blonde', 'ginger'][h % 4], shirt: SHIRT_IDS[(h >> 3) % 4], pants: ['gray', 'jeans', 'brown'][(h >> 5) % 3] }, pose: 'hosp', dz: ['🤒'] }; }
  n.rx = n.x = s.x; n.ry = n.y = s.y; return n;
}
// ---- job staff: an NPC at every place that hires (plus the rod seller), each with its own talk spot next to the counter
const STAFF_DEF = {   // every officer looks like their painted portrait (NPC_FACE): gender, hair, clothes
  office:   { name: 'คุณนภา (ฝ่ายบุคคล)', short: 'คุณนภา', g: 'f', lk: { hair: 'brown', shirt: 'white' }, hi: 'สวัสดีค่ะ สนใจร่วมงานกับไทยเทคไหมคะ?', yes: 'ทำงานให้ตรงเวลานะคะ เข้างาน 8 โมง!' },
  farmer:   { name: 'พี่ข้าวหอม (ประธานสหกรณ์)', short: 'พี่ข้าวหอม', g: 'f', lk: { hair: 'brown', shirt: 'red' }, hi: 'มาทำไร่ด้วยกันไหม ได้กินผักสดทุกวันเลยนะ', yes: 'ดูแลแปลงดีๆ นะ' },
  fishing:  { name: 'น้าเล็ก (สมาคมประมง)', short: 'น้าเล็ก', lk: { hair: 'silver' }, hi: 'มือใหม่ยังไม่มีเงิน? ซื้อเบ็ดคันละ ฿150 ไปตกปลาขายสิ หาเงินง่ายสุดแล้ว!', yes: 'ทุ่นจมเมื่อไหร่ ตวัดเลยนะ! แล้วค่อยๆ เย่อมันเข้ามา' },
  merchant: { name: 'เฮียชัย (เจ้าของโรงประมูล)', short: 'เฮียชัย', lk: { hair: 'brown' }, hi: 'มาประมูลของกันไหม ล็อตใหม่ขึ้นเวทีตลอด', yes: 'ซื้อถูกขายแพง จำไว้!' },
  chef:     { name: 'เชฟหมี (หัวหน้าครัว)', short: 'เชฟหมี', lk: { hair: 'black' }, hi: 'อยากเป็นเชฟต้องมีใบรับรองนะ แล้วมาปรุงด้วยกัน', yes: 'วัตถุดิบดี อาหารก็อร่อย!' },
  doctor:   { name: 'หมอแพร (ผอ.โรงพยาบาล)', short: 'หมอแพร', g: 'f', lk: { hair: 'brown' }, hi: 'โรงพยาบาลขาดหมอ ถ้าเรียนจบแพทย์แล้วมาช่วยกันนะคะ', yes: 'อยู่ในโรงพยาบาลช่วงเวรได้เงินเดือนทุกชั่วโมงนะคะ' },
  rider:    { name: 'พี่ต่อ (หัวหน้าไรเดอร์)', short: 'พี่ต่อ', lk: { hair: 'black' }, hi: 'มีใบขับขี่ไหม? มาวิ่งส่งอาหารกัน', yes: 'ออเดอร์เข้าเยอะ ดูแอพด้วยนะ! ใบขับขี่ต้องต่ออายุทุกปีด้วย' },
  police:   { name: 'ผู้กองเอก (สถานีตำรวจ)', short: 'ผู้กองเอก', lk: { hair: 'black' }, hi: 'เมืองนี้ต้องการผู้พิทักษ์ จบ ม.6 แล้วมาสอบนายสิบนะ', yes: 'ถ้ามีแจ้งเหตุ 191 รีบไปนะ' },
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
  // shopkeepers: stand by their counter; talking to them is the same as using the place
  for (const d of KEEPERS) {
    const s = G.stations.find(x => x.id === d.st); if (!s) continue;
    const x = s.x + d.dx, y = s.y + d.dy;
    const n = { id: 'keep_' + d.st, staff: 1, keeper: 1, career: d.c || '', c: d.c || '', of: d.of || '', name: d.name, short: d.short, st: s.id, g: d.g || 'm', lk: { hair: 'brown', shirt: 'white', pants: 'gray', ...(d.lk || {}) },
      x, y, rx: x, ry: y, f: 6, dz: [], line: () => ` ${n.cur || d.hi[0]}`, greetT: 0, icon: d.icon, his: d.hi };
    STAFF.push(n); STAFF_AT[s.id] = n;
  }
}
const KEEPERS = [   // shopkeepers, each matching their painted portrait (NPC_FACE)
  { st: 'petshop1', name: 'น้องมะลิ (ร้านสัตว์เลี้ยง)', short: 'น้องมะลิ', icon: '🐾', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'brown', shirt: 'red' }, hi: ['ยินดีต้อนรับค่ะ! อยากได้เพื่อนตัวฟูไหมคะ', 'ทุกตัวสุขภาพดีค่ะ ลูบได้นะคะ', 'ตัวไหนถูกใจ ลองแตะดูได้เลยค่ะ'] },
  { st: 'petshop2', name: 'พี่ภูผา (ร้านสัตว์เลี้ยง สาขา 2)', short: 'พี่ภูผา', icon: '🐶', dx: .7, dy: -1.15, of: 'hoodie', lk: { hair: 'black' }, hi: ['เข้ามาดูน้องๆ ได้เลยครับ', 'หมา แมว กระต่าย มีครบครับ', 'เลี้ยงแล้วพาเดินเล่นทุกวันนะครับ'] },
  { st: 'restaurant', name: 'ป้าแดง (เจ้าของร้านอาหาร)', short: 'ป้าแดง', icon: '🍛', g: 'f', dx: -1.9, dy: 0.7, lk: { hair: 'black', shirt: 'white', pants: 'brown' }, hi: ['หิวไหมจ๊ะ วันนี้มีเมนูเด็ดนะ', 'นั่งก่อนจ้ะ เดี๋ยวน้องเสิร์ฟให้', 'กินให้อิ่มนะลูก'] },
  { st: 'barber', name: 'ช่างโอ๋ (ช่างทำผม)', short: 'ช่างโอ๋', icon: '💈', dx: .6, dy: -1.15, lk: { hair: 'silver', shirt: 'black', pants: 'black' }, hi: ['อยากเปลี่ยนลุคไหมครับ', 'ทรงนี้ต้องลองสีบลอนด์นะ', 'ตัดผมใหม่ ชีวิตใหม่ครับ'] },
  { st: 'furnshop', name: 'น้องเก่ง (ร้านเฟอร์นิเจอร์)', short: 'น้องเก่ง', icon: '🛋️', dx: .6, dy: -1.15, of: 'hoodie', lk: { hair: 'black' }, hi: ['โซฟาตัวนี้นั่งสบายมากครับ', 'จัดบ้านสวย อยู่แล้วมีความสุขนะ', 'ซื้อแล้วส่งถึงบ้านเลยครับ'] },
  { st: 'police', name: 'ดาบหญิงสมศรี (เวรประจำโต๊ะ)', short: 'ดาบสมศรี', icon: '👮', g: 'f', dx: .4, dy: -1.15, of: 'police', lk: { hair: 'brown' }, hi: ['มีอะไรให้ช่วยคะ', 'อยากเป็นตำรวจ คุยกับผู้กองเอกนะคะ'] },
  { st: 'school', name: 'ผอ.ประเสริฐ (ผู้อำนวยการ)', short: 'ผอ.ประเสริฐ', icon: '🎓', dx: .5, dy: -1.1, of: 'office', lk: { hair: 'silver' }, hi: ['ตั้งใจเรียนนะ อนาคตอยู่ในมือเธอ', 'นั่งโต๊ะเรียนครบชั่วโมงได้ 1 คาบ', 'ยินดีต้อนรับสู่มหาวิทยาลัย'] },
  { st: 'cstore', name: 'น้องฝน (พนักงานร้าน)', short: 'น้องฝน', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'brown', shirt: 'white' }, hi: ['สวัสดีค่ะ ยินดีต้อนรับค่ะ', 'รับขนมจีบซาลาเปาเพิ่มไหมคะ', 'สะสมแต้มไหมคะ'] },
  { st: 'cstore2', name: 'น้องภูมิ (พนักงานร้าน · นักศึกษา)', short: 'น้องภูมิ', icon: '🏪', dx: .7, dy: -1.15, of: 'hoodie', lk: { hair: 'brown' }, hi: ['สวัสดีครับ ยินดีต้อนรับครับ', 'รับถุงไหมครับ', 'ทำงานพิเศษหลังเลิกเรียนครับ'] },
  { st: 'cstore3', name: 'น้องแพร (พนักงานร้าน)', short: 'น้องแพร', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'black', shirt: 'blue' }, hi: ['สวัสดีค่ะ เปิด 24 ชั่วโมงค่ะ', 'ข้าวกล่องอุ่นให้ไหมคะ', 'ลอตเตอรี่งวดนี้มาแล้วค่ะ'] },
  { st: 'cstore4', name: 'ยายบุญ (เจ้าของร้าน สาขาหมู่บ้าน)', short: 'ยายบุญ', icon: '🏪', g: 'f', dx: .7, dy: -1.15, lk: { hair: 'silver', shirt: 'yellow', pants: 'brown' }, hi: ['มาแล้วเหรอหลาน', 'กินข้าวหรือยังจ๊ะ', 'น้ำเย็นๆ อยู่ในตู้นะลูก'] },
  { st: 'market', name: 'เจ๊ศรี (ผู้ดูแลตลาดกลาง)', short: 'เจ๊ศรี', icon: '🏪', g: 'f', dx: 2.6, dy: .35, lk: { hair: 'brown', shirt: 'green' }, hi: ['ซื้อขายที่นี่ ราคายุติธรรม', 'วางขายของได้นะ คนซื้อเยอะ', 'ของสดๆ ทั้งนั้นจ้า'] },
  { st: 'estate', name: 'คุณจิ๋ม (นายหน้าอสังหาฯ)', short: 'คุณจิ๋ม', icon: '🏡', g: 'f', dx: 1.4, dy: 0, lk: { hair: 'brown', shirt: 'pink' }, hi: ['บ้านสวย ทำเลดี ราคาคุ้มค่ะ', 'สนใจซื้อหรือเช่าบ้านไหมคะ', 'ปล่อยเช่าบ้านก็มีรายได้นะคะ'] },
  { st: 'toolshop', name: 'ช่างเปี๊ยก (ร้านอุปกรณ์)', short: 'ช่างเปี๊ยก', icon: '🛠️', dx: .5, dy: -1.1, lk: { hair: 'brown', shirt: 'black' }, hi: ['เครื่องมือดี งานก็ออกมาดี', 'อัปเกรดอุปกรณ์อาชีพได้ที่นี่', 'ของแท้ทุกชิ้นรับประกัน'] },
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
  const friend = (me.contacts || []).some(c => c.n === best.name);
  const sig = best.id + '|' + friend;
  if (sig !== nbSig) {
    nbSig = sig;
    el.innerHTML = `<button data-nb="info">👤 ข้อมูล</button><button data-nb="add" class="${friend ? 'done' : 'add'}" ${friend ? 'disabled' : ''}>${friend ? '✓ เพื่อนกันแล้ว' : '➕ เพิ่มเพื่อน'}</button>`;
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
function nameAndBubble(p, px, top, mine, t = performance.now()) {
  if (!p.npc && !mine) { p.tagX = px; p.tagY = top - TS * (p.title ? .8 : .46); p.tagT = t; }
  const icon = p.keeper ? p.icon : p.c === 'waiter' ? '🍽️' : p.staff || p.wk ? CAREER_ICON(p.c) || '💬' : p.npc ? '🏘️' : CAREER_ICON(p.c);
  const label = `${p.adm ? '👑 ' : ''}${icon} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`;
  if (p.adm) premiumName(label, px, top - TS * .22, t);
  else sign(label, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,214,110,.96)' : p.npc ? 'rgba(80,70,50,.62)' : 'rgba(58,36,20,.82)', color: mine ? '#222' : '#fff' });
  if (p.afk) sign('💤 ไม่อยู่', px, top + TS * .12, { size: TS * .2, bg: 'rgba(60,60,80,.85)' });
  if (p.title) {
    ctx.font = `800 ${Math.round(TS * .22)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, top - TS * .58);
    // title colour = rarity; legendary titles (and the mayor's) shimmer
    if (p.tr === 7 && !p.adm) { const w = textW(`«${p.title}»`), g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), h0 = (t / 12) % 360; for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, `hsl(${(h0 + k * 60) % 360},95%,66%)`); ctx.fillStyle = g; }
    else if (p.adm || p.tr >= 5) { const c0 = p.adm ? '#ffd34d' : RAR_COL[5], w = textW(`«${p.title}»`), g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), sh = (t / 1400) % 1; g.addColorStop(0, c0); g.addColorStop(Math.max(0, sh - .15), c0); g.addColorStop(sh, '#fffbe6'); g.addColorStop(Math.min(1, sh + .15), c0); g.addColorStop(1, p.adm ? '#ffb52e' : '#ff8a1e'); ctx.fillStyle = g; }
    else ctx.fillStyle = RAR_COL[p.tr] || '#ffd34d';
    ctx.fillText(`«${p.title}»`, px, top - TS * .58);
  }
  if (p.emo && performance.now() < p.emoT) {
    const k = 1 - (p.emoT - performance.now()) / 4200, by = top - TS * (p.title ? 1.25 : 1.0) - Math.sin(Math.min(1, k * 4) * Math.PI / 2) * TS * .25;
    ctx.font = `${Math.round(TS * .75)}px serif`; ctx.fillText(p.emo, px, by + Math.sin(t / 160) * 2);
  }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
    const w = textW(txt) + 16, by = top - TS * (p.title ? 1.12 : .86), bh = TS * .5;
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
  p.walk = (p.walk || 0) + (moving ? .25 : 0);
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
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { g.fillStyle = MINI_COLORS[G.map.tiles[a.y + y][a.x + x]] || '#5e9b57'; g.fillRect(x * 2, y * 2, 2, 2); }
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
const outPos = (x, y) => { const r = roomOf(x, y); return r ? r.outside : { x, y }; };
function drawMini() {
  const m = P.get(myId); if (!m) return;
  const mapId = mapOf(areaOf(m.x, m.y)?.id), A = AREA[mapId], base = miniBase[mapId]; if (!base) return;
  const mini = $('#mini'); if (mini.width !== base.width) { mini.width = base.width; mini.height = base.height; }
  const g = mini.getContext('2d'); g.drawImage(base, 0, 0);
  for (const p of P.values()) {
    if (p.npc || p.id === myId) continue;
    const q = outPos(p.rx, p.ry); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    const s = 5, mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2;
    g.fillStyle = '#fff'; g.fillRect(mx - s / 2 - 1, my - s / 2 - 1, s + 2, s + 2);
    g.fillStyle = p.adm ? `hsl(${(performance.now() / 8) % 360},90%,55%)` : COLORS[Math.abs(p.id * 7 + (p.av || 0)) % COLORS.length]; g.fillRect(mx - s / 2, my - s / 2, s, s);
  }
  misMini(g, A, mapId);
  if (me?.dogq?.hc && mapId === 'town') { const [hx, hy, hr] = me.dogq.hc; g.strokeStyle = (performance.now() / 400 | 0) % 2 ? '#ffd23a' : '#ff9f1a'; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.arc((hx - A.x) * 2, (hy - A.y) * 2, hr * 2, 0, 7); g.stroke(); g.setLineDash([]); g.font = '16px serif'; g.textAlign = 'center'; g.fillText('🐕', (hx - A.x) * 2, (hy - A.y) * 2 + 6); }
  { const q = PETST.get(myId); if (q && mapOf(areaOf(q.x, q.y)?.id) === mapId) { const mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 4.5, 0, 7); g.fill(); g.fillStyle = '#ff7eb0'; g.beginPath(); g.arc(mx, my, 3, 0, 7); g.fill(); } }   // your pet: a pink dot
  { // you: drawn last, bigger, with a pulsing ring so you can always find yourself
    const q = outPos(m.rx, m.ry), mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2, k = (performance.now() % 1200) / 1200;
    g.strokeStyle = `rgba(255,230,60,${1 - k})`; g.lineWidth = 4; g.beginPath(); g.arc(mx, my, 9 + k * 16, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(mx, my, 9, 0, 7); g.fill();
    g.fillStyle = '#ff2a10'; g.beginPath(); g.arc(mx, my, 6.5, 0, 7); g.fill();
  }
  $('#miniName').textContent = `🗺️ ${A.name}`;
}

// ------------------------------------------------------------------ panels
let panelOpenT = 0;
function openPanel(p) {
  if (p.kind === 'chat') p.sig = 'x';
  if (p.kind === 'player') { const o = P.get(p.pid); if (o && !o.npc) send({ t: 'info', id: p.pid }); }
  panel = p; panelSig = ''; panelOpenT = performance.now(); $('#panel').classList.remove('hidden'); refreshPanel(true);
  if (p.kind === 'chat') setTimeout(() => $('#chatIn')?.focus(), 50);
}
function closePanel() { panel = null; $('#panel').classList.add('hidden'); }
function refreshPanel(force) {
  if (!panel || !me) return;
  let html = renderPanel(panel);
  const stf = panel.st && STAFF_AT[panel.st];
  if (stf) html = html.replace('</h2>', `</h2><div class="npcSay"><canvas class="npcFace" data-staff="${stf.id}" width="48" height="56"></canvas><div><b>${esc(stf.name)}</b>${esc(stf.line(me))}</div></div>`);
  if (!force && html === panelSig) return;
  const ae = document.activeElement;
  if (!force && ae && ae.tagName === 'INPUT' && $('#panelBody').contains(ae)) { if (panel.kind === 'chat') { const box = $('#chatMsgs'); if (box) box.innerHTML = chatHtml(); } return; }
  panelSig = html;
  const body = $('#panelBody'); const keep = ae && body.contains(ae) && ae.id ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
  const scroll = body.parentElement.scrollTop;
  body.innerHTML = html; bindPanel(body); body.parentElement.scrollTop = scroll;
  if (keep) { const n = document.getElementById(keep.id); if (n) { n.value = keep.v; n.focus(); try { n.setSelectionRange(keep.s, keep.s); } catch { } } }
  for (const id of ['chatMsgs', 'callMsgs']) { const cm = document.getElementById(id); if (cm) cm.scrollTop = cm.scrollHeight; }
}
function bindStocks(root) {
  root.querySelectorAll('canvas[data-spark]').forEach(drawSpark);
  root.querySelectorAll('canvas[data-chart]').forEach(c => { drawStockChart(c); const hv = e => { const r = c.getBoundingClientRect(); drawStockChart(c, e.clientX - r.left); }; c.onpointermove = hv; c.onpointerdown = hv; c.onpointerleave = () => drawStockChart(c); });
}
function bindPanel(root) {
  bindStocks(root);
  root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    if (performance.now() - panelOpenT < 450) return;      // the tap that opened this panel must not also press a button in it
    FX.play('click');
    const m = JSON.parse(b.dataset.m);
    if (m.fn) return FN[m.fn](m, root);
    send(m);
  });
  const gs = root.querySelector('#godSpd');
  if (gs) { gs.oninput = () => { $('#godSpdV').textContent = (+gs.value).toFixed(1); }; gs.onchange = () => send({ t: 'god', op: 'speed', v: +gs.value }); }
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (!i.value.trim()) return; if (!worldOk(chatTab)) return; send({ t: 'chat', text: i.value, ch: chatTab }); i.value = ''; };
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
  root.querySelectorAll('[data-of]').forEach(c => whenChars(() => {
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); drawCharTo(g, { g: me.gender, lk: me.look || {}, of: c.dataset.of }, 36, 92, 86 / CH_ATLAS.h, 'front', 0);
  }));
  const ms = root.querySelector('#mSearch'); if (ms) ms.oninput = () => { panel.q = ms.value; refreshPanel(true); };
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  aucBid(m) { const v = +($('#aucAmt')?.value || 0); send({ t: 'act', st: m.st, a: 'bid', amt: v }); },
  openPets() { openPanel({ kind: 'pets' }); },
  titles: () => { panel.titles = !panel.titles; refreshPanel(true); if (panel.titles) setTimeout(() => { const t = document.querySelector('#panelBody .secT'); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); },
  photo: () => pickPhoto(),
  place: m => startPlace(m.k),
  photoDel: () => send({ t: 'pic', data: '' }),
  chatTab: m => { chatTab = m.tab; panel.sig = 'x' + m.tab; refreshPanel(true); setTimeout(() => $('#chatIn')?.focus(), 30); },
  mailSend: () => { const to = $('#mailTo').value.trim(), text = $('#mailText').value.trim(); if (!to || !text) return toast('ใส่ชื่อผู้รับและข้อความ', '✉️', false); send({ t: 'mail', to, text }); },   // the text stays until the server confirms (mailsent)
  mailReply: m => { panel.to = m.to; refreshPanel(true); $('#mailText')?.focus(); },
  mtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  qtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  soilStore() { const h = wd?.houses?.[me.house]; if (!h) return; for (const k of me.furniture || []) if (G.shop.furniture[fbase(k)]?.tile && furnPos(h, k)) send({ t: 'hplace', k, store: 1 }); },
  stock(m, root) { const q = m.qty || Math.floor(+root.querySelector('#skQty')?.value || 0); if (!(q > 0)) return toast('ใส่จำนวนหุ้น', '📈', false); send({ t: 'act', st: m.st, a: 'stock', op: m.op, id: m.id, qty: q }); },
  callMin() { closePanel(); toast('ย่อสายไว้แล้ว แตะแถบ 📞 ด้านบนเพื่อเปิด', '📞'); },
  list(m, root) { const v = Math.floor(+root.querySelector('#lp_' + m.item).value || 0); send({ t: 'act', st: m.st, a: 'list', item: m.item, qty: m.qty, price: v }); },
  bank(m, root) { const v = m.all ? m.all : +root.querySelector('#bankAmt').value || 0; send({ t: 'act', st: m.st, a: m.op, amt: v }); },
  price(m, root) { send({ t: 'act', st: m.st, a: m.op, price: m.zero ? 0 : +root.querySelector('#' + m.inp).value || 0 }); },
  guide(m) { closePanel(); setGuide(m.key, false, true); },
  guidePt(m) { closePanel(); guide = { x: m.x, y: m.y, area: m.area, label: m.label }; toast(`นำทางไป ${m.label}`, '📍'); paintNav(); placeLog(); },
  tut() { closePanel(); showTut(0); },
  map() { closePanel(); openMap(); },
  logout() { localStorage.removeItem('lt_creds'); wantLogin = false; location.reload(); },
  fs(m) { closePanel(); screenMode(m.mode); },
  toggle(m) { FX.setOpt(m.k, !FX.opts[m.k]); paintMute(); refreshPanel(true); },
  tradeReq(m) { send({ t: 'req', kind: 'trade', to: m.to }); closePanel(); },
  heal(m, root) { send({ t: 'req', kind: 'heal', to: m.to, fee: +root.querySelector('#feeIn').value || 0 }); closePanel(); },
  addContact(m, root) { send({ t: 'contact_add', phone: m.phone || root.querySelector('#phIn').value }); },
  donate(m, root) { send({ t: 'donate', to: m.to, amt: +root.querySelector('#donIn').value || 0 }); },
  order(m, root) { send({ t: 'order', item: m.item, tip: +(root.querySelector('#tipIn')?.value || 0) }); },
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
fetch('assets/portraits.json?v=2').then(r => r.json()).then(j => { FACES = j; buildCast(); }).catch(() => { });
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
const NPC_FACE = { staff_office: 'office_f', staff_farmer: 'farmer_f', staff_fishing: 'fisher_m', staff_chef: 'chef_m', staff_rider: 'rider_m', staff_merchant: 'grocer_m', staff_police: 'police_m',
  staff_doctor: 'doctor_f', staff_beggar: 'beggar_m', keep_restaurant: 'shop_f', keep_barber: 'barber_m', keep_furnshop: 'thief_m', keep_police: 'police_f', keep_school: 'elder_m',
  keep_petshop1: 'girl', keep_petshop2: 'folk_m1', keep_cstore: 'sad_f', keep_cstore2: 'student_m', keep_cstore3: 'nurse_f', keep_cstore4: 'grandma', keep_market: 'market_f', keep_estate: 'teacher_f', keep_toolshop: 'worker_m', keep_bank: 'banker_f' };
// what each person talks about: a few short conversations (each a list of lines), picked at random with 💬 คุยต่อ
const TALK = {
  staff_office: [['บริษัทเราส่งเอกสารไปทั่วเมืองทุกวันเลยค่ะ', 'ยิ่งส่งไกล ค่าส่งยิ่งเยอะนะคะ', 'หลังห้าโมงเย็นยังทำโอทีได้ถึงสามทุ่ม ได้เงินเพิ่มอีกด้วย'], ['ใครอยากเข้ามาทำงานที่นี่ต้องจบปริญญาตรีก่อนนะคะ', 'ไปเรียนที่มหาวิทยาลัยได้ นั่งเรียนครบชั่วโมงก็ได้หนึ่งคาบ'], ['ช่วงนี้ดิฉันอยากได้เก้าอี้ทำงานตัวใหม่จัง', 'ตัวเก่านั่งแล้วปวดหลังมากเลยค่ะ 😅']],
  staff_fishing: [['ตกปลาได้ทุกที่ที่มีน้ำนะ ทะเลสาบ บ่อ ชายหาด', 'ทะเลกับน้ำจืดมีปลาไม่เหมือนกัน ลองไปทั้งสองแบบสิ'], ['เบ็ดดีขึ้น แถบเขียวก็กว้างขึ้น', 'ปลาหายากอย่างปลาทองคำกับโลมาก็กินเบ็ดบ่อยขึ้นด้วย'], ['สมัยหนุ่มๆ น้าเคยตกฉลามได้ด้วยมือเปล่านะ', '...ล้อเล่นน่า ใช้เบ็ดคาร์บอนต่างหาก ฮ่าๆ'], ['มีสมุดภาพปลาที่สมาคมด้วยนะ', 'ลองตกให้ครบทุกชนิดดูสิ ได้ฉายาด้วย']],
  staff_chef: [['อาหารดีเริ่มที่วัตถุดิบดี', 'ปลาสดจากชาวประมง ผักจากชาวไร่ ทำอะไรก็อร่อย'], ['อยากเป็นเชฟต้องมีใบรับรองเชฟก่อนนะ', 'ซื้อได้ที่มหาวิทยาลัย'], ['ต้มยำหม้อนี้ใส่พริกไปสามกำมือ', 'ใครกินไม่ไหวไม่ใช่ความผิดฉันนะ 🌶️']],
  staff_rider: [['ออเดอร์เข้ามาเรื่อยๆ ดูในแอพมือถือนะ', 'ไปรับอาหารที่ร้าน แล้วไปส่งถึงตัวลูกค้า'], ['ใบขับขี่ต้องต่ออายุทุกปีนะ', 'หมดอายุแล้วรับงานไม่ได้ ไปต่อที่มหาวิทยาลัย'], ['ฝนตกก็ต้องวิ่งนะ ลูกค้ารออยู่', 'แต่ระวังเป็นหวัดด้วยล่ะ']],
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
  keep_estate: [['บ้านในหมู่บ้านจัดสรร ซื้อหรือเช่าก็ได้ค่ะ', 'มีลานบ้านไว้ทำสวนด้วยนะคะ'], ['ปล่อยเช่าบ้าน มีรายได้ทุกเดือนค่ะ'], ['ทำงานหนักแล้วอย่าลืมพักนะคะ', 'ไปนั่งเล่นที่จัตุรัสบ้าง ชีวิตจะได้สมดุล']],
  keep_cstore2: [['ผมเรียนอยู่มหาวิทยาลัยครับ ทำงานพิเศษตอนเย็น', 'มาเมืองนี้ใหม่ๆ ยังไม่ค่อยรู้จักใครเลย'], ['ดึกๆ หิวก็แวะมาได้นะครับ', 'ข้าวกล่องอุ่นไมโครเวฟให้ด้วย']],
  keep_petshop1: [['น้องๆ ที่นี่ฉีดวัคซีนครบทุกตัวค่ะ', 'อยากได้ตัวไหน บอกได้เลยนะคะ'], ['สัตว์เลี้ยงเดินตามเราได้ทุกที่เลยค่ะ', 'แตะที่ตัวเขาดู จะกระโดดดีใจด้วยนะ']],
  keep_petshop2: [['ผมเลี้ยงหมามาตั้งแต่เด็กครับ', 'เลยมาเปิดร้านนี้เลย'], ['ตัวหายากอย่างมังกรกับยูนิคอร์น ก็มีนะครับ', 'ต้องเก็บเงินหน่อย แต่คุ้มครับ']],
  keep_cstore4: [['ยายเปิดร้านนี้มาตั้งแต่หมู่บ้านเพิ่งสร้าง', 'เห็นเด็กๆ โตกันมาทุกคนเลย'], ['ผอมลงนะหลาน กินข้าวกินปลาบ้างสิ', 'ข้าวกล่องในตู้อร่อยนะ ยายชิมแล้ว']],
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
  const cells = all.map(([id, it]) => `<div class="fbook ${dex[id] ? 'got' : ''} r${it.rar}" title="${esc(it.name)}"><canvas class="fspr" data-spr="${it.spr}" width="56" height="40"></canvas><small>${dex[id] ? esc(it.name) : '???'}</small>${dex[id] ? `<em>x${dex[id]}</em>` : ''}</div>`).join('');
  return `<div class="secT" style="margin-top:14px">📖 สมุดภาพปลา ${got}/${all.length}</div>
    <div class="sub">${[1, 2, 3, 4, 5].map(r => `<span class="rtag r${r}">${G.fishRarity[r]}</span>`).join('')} · ยิ่งหายากยิ่งราคาดี · เบ็ดที่ดีขึ้นทำให้ปลาหายากกินเบ็ดบ่อยขึ้น</div><div class="fbookGrid">${cells}</div>`;
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
function bindSpr(root) {
  root.querySelectorAll('[data-spr]').forEach(c => { const draw = () => { const sp = atlas?.sprites?.[c.dataset.spr]; if (!sp || !atlasImg) return setTimeout(draw, 300);
    const fish = c.classList.contains('fspr'), g = c.getContext('2d'), k = fish ? Math.min((c.width - 2) / sp[2], (c.height - 2) / sp[3]) : Math.min((c.width - 8) / sp[2], (c.height - 6) / sp[3], 1.6);
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
let chatTab = 'near', worldAt = 0;
// world chat: one line every 3 seconds. Too soon -> say so and keep what was typed, so nothing is lost
function worldOk(ch) {
  if (ch !== 'world') return true;
  const left = Math.ceil((worldAt + 3000 - Date.now()) / 1000);
  if (left > 0) { toast(`แชทโลกส่งได้ทุก 3 วินาที · รออีก ${left} วินาที แล้วกดส่งใหม่ได้เลย (ข้อความยังอยู่ในช่องพิมพ์)`, '💬', false); return false; }
  worldAt = Date.now(); return true;
}
const chatHtml = () => chatLog.filter(m => m.sys || (chatTab === 'world' ? m.w : !m.w)).map(m => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div class="${m.w ? 'w' : ''}"><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');
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
fetch('assets/frames.json?v=1').then(r => r.json()).then(j => { FRAMES_AT = j; if (me) paintPortrait(); }).catch(() => { });
function frameHtml(id, sz) {
  if (!FRAMES_AT || id < 0) return '';
  const [hx, hy] = FRAMES_AT.holes[id] || [.5, .5], c = FRAMES_AT.cols, sp = id >= 24;
  return `<span class="pfx ${sp ? 'sp g' + id : ''}" data-k="${id}:${sz}" style="--fs:${sz}px;background-position:${-(id % c) * sz}px ${-Math.floor(id / c) * sz}px;transform:translate(${Math.round(-hx * sz)}px,${Math.round(-hy * sz)}px)"></span>`;
}
function frameRows() {
  const own = me.frames || [], cur = me.frame ?? -1, pic = myPic || facePng();
  const card = f => { const has = own.includes(f.id), on = cur === f.id;
    const btn = f.locked && !has ? (me.admin ? B(on ? 'ใส่อยู่ ✓' : '👑 ลองใส่', { t: 'frame', op: 'wear', id: on ? -1 : f.id }, on ? 'primary' : '') : '<small>🔒 เร็วๆ นี้</small>')
      : has ? B(on ? 'ถอด' : 'ใส่', { t: 'frame', op: 'wear', id: on ? -1 : f.id }, on ? '' : 'good') : B(money(f.price), { t: 'frame', op: 'buy', id: f.id }, 'good', me.money < f.price);
    return `<div class="frmCard ${on ? 'on' : ''} ${f.locked && !has ? 'lock' : ''}"><div class="fprev"><img src="${pic}" alt="">${frameHtml(f.id, 64)}</div><b>${esc(f.name)}</b>${btn}</div>`; };
  const sec = (t, list) => `<div class="secT">${t}</div><div class="frmGrid">${list.map(card).join('')}</div>`;
  return sec('💍 กรอบโลหะและอัญมณี', G.frameDefs.slice(0, 12)) + sec('🌸 กรอบน่ารัก', G.frameDefs.slice(12, 24)) + sec('✨ กรอบพิเศษ (เรืองแสง · ล็อกไว้ก่อน)', G.frameDefs.slice(24));
}
const RAR = ['', 'ธรรมดา', 'ไม่ธรรมดา', 'หายาก', 'มหากาพย์', 'ตำนาน', 'พิเศษ', 'ในตำนาน'];
const RAR_COL = ['#ffd34d', '#e8e8e8', '#7be07b', '#62b8ff', '#d08cff', '#ffb43c', '#ffd34d', '#ff6bd6'];
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
    const O = 160, c = document.createElement('canvas'); c.width = c.height = O; const g = c.getContext('2d'), kk = k() * O / S;
    g.fillStyle = '#fff'; g.fillRect(0, 0, O, O);
    g.drawImage(im, O / 2 - crop.cx * kk, O / 2 - crop.cy * kk, im.width * kk, im.height * kk);
    let q = .85, d = c.toDataURL('image/jpeg', q); while (d.length > 22000 && q > .3) { q -= .1; d = c.toDataURL('image/jpeg', q); }
    send({ t: 'pic', data: d }); $('#crop').classList.add('hidden'); crop = null;
  };
  $('#crop').classList.remove('hidden'); crop.draw();
}
const achTodo = () => (me?.ach || []).filter(x => !(me.achGot || []).includes(x));
const achRew = a => (me.achReward || [])[a.r || 1] || 0;
function achvPanel() {
  const todo = achTodo(), sum = todo.reduce((t, id) => t + achRew(G.ach.find(x => x.id === id) || {}), 0), got = (me.ach || []).length;
  const st = a => (me.achGot || []).includes(a.id) ? 2 : (me.ach || []).includes(a.id) ? 0 : 1;
  const pct = a => Math.min(1, (me.stats?.[a.stat] || 0) / a.n);
  const rows = G.ach.slice().sort((x, y) => st(x) - st(y) || (st(x) === 1 ? pct(y) - pct(x) : 0) || (x.r || 1) - (y.r || 1)).map(a => {
    const s2 = st(a), c = a.c ? G.careers[a.c] : null, pv = Math.min(a.n, me.stats?.[a.stat] || 0);
    if (a.secret && s2 === 1) return `<div class="item"><div class="em">❔</div><div class="nm"><b>??? ความสำเร็จลับ</b><small>ยังเป็นความลับ... ลองสังเกตสิ่งรอบตัว ฟังชาวเมืองคุยกัน</small></div><span class="tag">💎?</span></div>`;
    const btn = s2 === 0 ? B(`🎁 รับ 💎${achRew(a)}`, { t: 'achclaim', id: a.id }, 'primary') : s2 === 2 ? '<span class="tag">รับแล้ว ✓</span>' : `<span class="tag">💎${achRew(a)}</span>`;
    return `<div class="item ${s2 === 2 ? 'done' : ''}"><div class="em">${s2 === 1 ? '🔒' : '🏅'}</div><div class="nm">${titleHtml(a.title, a.r)} <span class="rtag r${a.r || 1}">${RAR[a.r || 1]}</span>${c ? ` <span class="tag">${c.icon} ${c.name}</span>` : ''}<small>${a.desc} · ${pv.toLocaleString()}/${a.n.toLocaleString()}</small><div class="wbar"><u style="width:${pct(a) * 100}%"></u></div></div>${btn}</div>`;
  }).join('');
  return `<h2>🏅 ความสำเร็จ</h2><div class="sub">ปลดล็อกแล้ว ${got}/${G.ach.length} · ทุกความสำเร็จได้เพชร 💎5–15 ตามความยาก และใช้เป็นฉายาบนหัวได้</div>
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
  return G.ach.slice().sort((x, y) => has(x.id) - has(y.id) || (x.r || 1) - (y.r || 1)).map(a => {
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
  const miss = (c.need || []).filter(l => !licOk(l)).map(l => G.licenses[l].name + (licExp(l) ? ' (หมดอายุ ต่อที่มหาวิทยาลัย)' : ''));
  const wait = me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ เพิ่งเปลี่ยนงาน ต้องรออีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : '';
  return `<div class="jobbox"><b>📝 รับสมัคร ${c.icon} ${c.name}</b><div class="sub">${c.desc}</div>
    ${miss.length ? `<div class="sub" style="color:var(--bad)">ต้องมี: ${miss.join(', ')}</div>` : ''}${wait}
    ${me.career !== 'none' ? `<div class="sub">ตอนนี้คุณเป็น${G.careers[me.career].name} สมัครงานนี้ = ลาออกจากงานเดิม</div>` : ''}
    ${B(`✍️ สมัครงาน${c.name}`, { t: 'act', st, a: 'apply', career }, 'primary big', miss.length > 0 || me.jobWait > 0)}</div>`;
}
const needCareer = c => job(c) ? '' : `<div class="sub" style="color:var(--bad)">⚠️ ต้องเป็น ${G.careers[c].icon} ${G.careers[c].name} ก่อน</div>`;

// what's new: a short summary of every update (newest first). Shown once after each update; also under ⚙️ → 🆕 อัปเดต
const NEWS = [
  { v: '2026-11-16y', d: '16 พ.ย. (รอบ 25)', items: ['🥚 เพิ่มอีสเตอร์เอ้กแล้ว'] },
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
function newsHtml() {
  return `<h2>🆕 อัปเดตล่าสุด</h2>` + NEWS.slice(0, 5).map((n, i) => `<div class="sub" style="margin-top:${i ? 12 : 4}px"><b>${n.d}</b></div><ul style="margin:4px 0 0;padding-left:20px;line-height:1.7;font-size:14px">${n.items.map(t => `<li>${t}</li>`).join('')}</ul>`).join('');
}
function checkNews() {
  let seen = ''; try { seen = localStorage.getItem('lt_news') || ''; } catch { }
  if (seen === NEWS[0].v) return;
  try { localStorage.setItem('lt_news', NEWS[0].v); } catch { }
  if (!panel) openPanel({ kind: 'news' });
}
function renderPanel(p) {
  const k = p.kind, st = p.st;
  switch (k) {
    case 'news': return newsHtml();
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
        body = Object.entries(G.items).filter(([id, it]) => it.base < 1000 && !it.menu && match(id)).map(([id]) => {
          const m2 = { ...(mk[id] || {}) };
          const own = (me.listings || []).filter(L => L.item === id).reduce((t, L) => t + L.qty, 0);
          const n = Math.max(0, (m2.n || 0) - own);
          const pl = n ? `<b style="color:var(--ok)">ผู้เล่น ${money(m2.best)}</b> (${n} ชิ้น)` : '<span style="opacity:.6">ไม่มีผู้เล่นวางขาย</span>';
          return itemRow(id, `<div class="col2">${B(n ? `ซื้อ ${money(m2.best)}` : 'ไม่มีของ', { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', !n)}${(G.items[id].rar || 0) >= 3 ? '' : B(`NPC ${money(m2.sell || 0)}`, { t: 'act', st, a: 'npcbuy', item: id, qty: 1 })}</div>`, `${pl}${(G.items[id].rar || 0) >= 3 ? ' · ปลาหายาก ร้าน NPC ไม่มีขาย' : ` · ร้าน NPC ${money(m2.sell || 0)}`}`);
        }).join('');
        body = `<div class="sub">ซื้อจากผู้เล่นถูกที่สุดก่อนเสมอ · ร้าน NPC มีของตลอดแต่<b>แพงมาก</b></div>${search}${cats}<div class="list">${body || '<div class="sub">ไม่พบสินค้า</div>'}</div>`;
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
      return `<h2>🏪 ตลาดกลาง</h2><div class="sub">${hoursTxt('market')}</div>${tabs}${body}`;
    }
    case 'cstore': {
      const rows = (G.cstore?.items || []).map(id => { const it = G.items[id], u = Math.ceil(it.base * G.cstore.markup), e = it.eat || {};
        return itemRow(id, `<div>${B(money(u), { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', me.money < u)}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 }, '', me.money < u * 5)}</div>`,
          [e.hunger && `อิ่ม +${e.hunger}`, e.energy && `พลัง +${e.energy}`, e.health && `เลือด +${e.health}`, e.happy && `สุข +${e.happy}`].filter(Boolean).join(' · ') + ` · มีอยู่ ${me.inv[id] || 0}`); }).join('');
      return `<h2>🏪 ร้านสะดวกซื้อ 24 ชม.</h2><div class="sub">เปิดตลอด 24 ชั่วโมง ของมีเสมอ ไม่ต้องรอใครวางขาย · ราคาสูงกว่าตลาดนิดหน่อย</div><div class="list">${rows}</div>`;
    }
    case 'warehouse': {
      const c = me.auc, head = `<h2>🔨 โรงประมูล</h2><div class="sub">${hoursTxt('warehouse')} · ล็อตละ 20 วินาที ยื่นซองประมูลได้ครั้งเดียว (แก้ราคาได้ก่อนหมดเวลา) แข่งกับคู่แข่ง 3 คน · ใครเสนอสูงสุดชนะและจ่ายตามที่เสนอ · ได้ของมาแล้วโรงประมูลรับซื้อคืนในราคาจริงทันที: <b>ต่ำกว่าราคาจริง = กำไร</b> สูงกว่า = ขาดทุน</div>`;
      if (!job('merchant')) return `${head}<div class="jobbox">เฉพาะ<b>พ่อค้า</b> · สมัครได้ที่นี่</div>`;
      const lot = c ? `<div class="aucLot"><div class="aucIco">${c.icon}</div><div><b>${esc(c.name)}</b><div class="aucItems">${Object.entries(c.items).map(([id, q]) => `<span>${G.items[id].icon} ${esc(G.items[id].name)} ×${q}</span>`).join('')}</div><small>สภาพ: <b>${c.cond}</b> · 🧐 ผู้ประเมินว่าราวๆ <b>${money(c.lo)} – ${money(c.hi)}</b></small></div></div>` : '';
      if (!c || c.stage === 'done' && !c.result) return `${head}<div class="jobbox">ยังไม่มีล็อตบนเวที</div>${B('🔨 เปิดล็อตถัดไป (⚡4)', { t: 'act', st, a: 'auction' }, 'primary big')}`;
      if (c.stage === 'bid') {
        const bots = c.bots.map(b => `<div class="aucBot">${b.sent ? '✉️' : '🤔'} <b>${esc(b.name)}</b> <small>${esc(b.style)} · ${b.sent ? 'ยื่นซองแล้ว' : 'กำลังคิด...'}</small></div>`).join('');
        return `${head}${lot}<div class="aucTimer">⏱ เหลือเวลา <b class="auccd" data-t="${c.until}"></b></div><div class="aucBots">${bots}<div class="aucBot me">${c.my ? '✉️' : '✍️'} <b>คุณ</b> <small>${c.my ? `ยื่นแล้ว ${money(c.my)} (แก้ได้)` : 'ยังไม่ได้ยื่น'}</small></div></div>
          <div class="rowf" style="margin-top:8px"><input id="aucAmt" type="number" min="10" step="10" inputmode="numeric" placeholder="ราคาที่จะเสนอ (บาท)" value="${c.my || ''}">${B(c.my ? '✉️ แก้ซอง' : '✉️ ยื่นซอง', { fn: 'aucBid', st }, 'primary')}</div>
          <div class="sub">เงินสดที่มี ${money(me.money)} · ไม่ยื่นก็ได้ ถ้าคิดว่าแพงเกินไป</div>`;
      }
      const rows = c.result.map(([n, b, mine], i) => `<div class="aucRes ${i === 0 ? 'win' : ''} ${mine ? 'me' : ''}">${i === 0 ? '🏆' : `${i + 1}.`} <b>${esc(mine ? 'คุณ' : n)}</b><span>${money(b)}</span>${b <= c.real ? '<i class="up">ต่ำกว่าจริง</i>' : '<i class="dn">เกินราคาจริง</i>'}</div>`).join('');
      const iWon = c.result[0]?.[2], verdict = iWon ? (c.net >= 0 ? `<div class="aucVerdict good">🎉 คุณชนะ! กำไร <b>${money(c.net)}</b></div>` : `<div class="aucVerdict bad">😵 ชนะแต่จ่ายแพงไป ขาดทุน <b>${money(-c.net)}</b></div>`) : `<div class="aucVerdict">${esc(c.win)} ได้ไป${c.my ? ' · คุณไม่ได้เสียเงิน' : ''}</div>`;
      return `${head}${lot}<div class="aucReal">💎 มูลค่าจริง <b>${money(c.real)}</b></div><div class="aucResList">${rows}</div>${verdict}${B('🔨 ล็อตถัดไป (⚡4)', { t: 'act', st, a: 'auction' }, 'primary big')}`;
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
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">${hoursTxt('kitchen')} · ปรุงอาหารขายได้แพงกว่าวัตถุดิบหลายเท่า · ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง (ถูกกว่า) หรือซื้อที่ครัวนี้ (แพงกว่า 30%)</div>${staffHint('chef')}${job('chef') ? `<h3>🍳 เมนู</h3><div class="list">${rows}</div><h3>🛒 วัตถุดิบ</h3><div class="list">${ings}</div>` : ''}`;
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
      const pl = (h[10] || {})[k], slow = me.career !== 'farmer';
      if (G.shop.furniture[fbase(k)]?.tile) {
        const bed = soilBedOf(h, k), cr = h[10] || {}, empty = bed.filter(o => !cr[o]).length, ripe = bed.filter(o => cr[o] && cr[o][1] <= Date.now() + clockOff).length;
        const rows = Object.entries(G.crops).map(([id, c]) => { const sd = Math.ceil(c.seed / 3);
          return itemRow(id, `<div>${B(`1 ช่อง ${money(sd)}`, { t: 'yfarm', k, op: 'plant', crop: id }, '', !!pl)}${B(`ทั้งแปลง ${money(sd * empty)}`, { t: 'yfarm', k, op: 'plant', crop: id, all: 1 }, 'good', !empty)}</div>`, `โต ~${Math.round(c.grow * (slow ? 1.25 : 1) / 60 * 10) / 10} นาที · ช่องละ 1-2 หน่วย · ราคาตลาด ~${money(wd?.mk[id]?.ref || G.items[id].base)}`); }).join('');
        return `<h2>🟫 แปลงดิน ${bed.length} ช่อง</h2><div class="sub">ว่าง ${empty} · กำลังโต ${bed.length - empty - ripe} · สุกแล้ว ${ripe}${pl ? ` · ช่องนี้: ${G.items[pl[0]].icon} <span class="cd" data-t="${pl[1]}"></span>` : ''}${slow ? ' · ชาวสวนปลูกโตเร็วกว่า 25%' : ''}</div>
          ${ripe ? B(`🧺 เก็บเกี่ยวทั้งแปลง (${ripe} ช่อง)`, { t: 'yfarm', k, op: 'harvest', all: 1 }, 'primary big') : ''}<div class="list">${rows}</div>`;
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
      const own = [...new Set([...(me.furniture || []), ...(me.keep || [])])];
      const soils = own.filter(k => G.shop.furniture[fbase(k)]?.tile), soilOn = soils.filter(k => furnPos(h, k)).length;
      const soilRow = soils.length ? itemRowRaw('🟫', `แปลงดิน ${soils.length} ช่อง`, `วางในสวนแล้ว ${soilOn} · ในคลัง ${soils.length - soilOn} · ช่องที่ติดกันต่อเป็นแปลงเดียว`,
        `<div class="col2">${B('🟫 วาง', { fn: 'place', k: nextSoil() || soils[0] }, 'good', soils.length === soilOn)}${soilOn ? B('📦 เก็บหมด', { fn: 'soilStore' }) : ''}</div>`) : '';
      const rows = soilRow + own.filter(k => !G.shop.furniture[fbase(k)]?.tile).map(k => { const f = G.shop.furniture[fbase(k)]; if (!f) return ''; const pos = furnPos(h, k), n = k.split('#')[1] || (f.multi ? 1 : 0);
        return itemRowRaw(f.icon, f.name + (n ? ` #${n}` : ''), pos ? (pos[0] === 9 ? '🌳 วางอยู่ในสวน' : `วางอยู่ชั้น ${pos[0]}`) : '📦 อยู่ในคลัง', `<div class="col2">${B(pos ? '✋ ย้าย' : '📍 วาง', { fn: 'place', k }, 'good')}${pos ? B('📦', { t: 'hplace', k, store: 1 }) : ''}${f.multi && !pos ? B('♻️', { t: 'hplace', k, del: 1 }) : ''}</div>`); }).join('');
      return `<h2>🛋️ จัดบ้าน</h2><div class="sub">เลือกชิ้นที่จะวาง แล้วแตะพื้นห้องในชั้นที่คุณยืนอยู่ · ของในคลังยังนับความสบาย ⭐ · ซื้อเพิ่มที่ 🛋️ ร้านเฟอร์นิเจอร์ในเมือง · บ้านมี ${1 + (h[8] || 0)}/${G.shop.floors} ชั้น (ต่อเติมที่บันได 🪜)</div>
        <div class="list">${rows || '<div class="sub">ยังไม่มีเฟอร์นิเจอร์ ซื้อได้ที่ร้านเฟอร์นิเจอร์ในเมือง</div>'}</div>`;
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
      const dl = L.driving, exp = me.licExp?.driving || 0, leftD = Math.round((exp - Date.now() - clockOff) / G.dayMs * 10) / 10;
      const drive = !lic('driving') ? itemRowRaw('🪪', 'สอบใบขับขี่', `ค่าสอบ ${money(dl.price)} · ตอบคำถามจราจร 3 ข้อ ต้องถูกทุกข้อ · ต้องต่ออายุทุกปีในเกม (${money(dl.renew)})`, B('📝 สอบ', { t: 'act', st, a: 'dtest' }, 'good'))
        : itemRowRaw('🪪', `ใบขับขี่ ${licExp('driving') ? '<span class="tag" style="background:var(--bad)">หมดอายุ</span>' : ''}`, licExp('driving') ? 'หมดอายุแล้ว — ต่ออายุเพื่อทำงานไรเดอร์ต่อ' : `ใช้ได้อีก ${leftD} วันในเกม (1 ปี = 60 วันในเกม = 1 วันจริง)`, B(`ต่ออายุ ${money(dl.renew)}`, { t: 'act', st, a: 'renew' }, licExp('driving') ? 'primary' : '', !licExp('driving') && leftD > 15));
      const degRow = course('hs', 'ปลดล็อกการเรียนปริญญาตรีและสอบตำรวจ') + course('degree', 'ปลดล็อกงานบริษัท และเรียนต่อแพทย์') + pol + drive;
      const rows = ['cooking', 'medicine'].map(id => {
        const l = L[id], has = lic(id), blocked = l.need && !lic(l.need);
        const c = Object.values(G.careers).find(c => (c.need || []).includes(id));
        return itemRowRaw(l.icon, l.name, `ปลดล็อกอาชีพ ${c.name}${l.need ? ` · ต้องจบ${L[l.need].name}ก่อน` : ''}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(l.price), { t: 'act', st, a: 'learn', lic: id }, 'good', blocked));
      }).join('');
      return `<h2>🎓 มหาวิทยาลัย</h2><div class="sub">${hoursTxt('school')} · ลงทะเบียนที่นี่ แล้ว<b>นั่งเรียนที่โต๊ะเรียน</b>ตามเวลา · สอบใบขับขี่/ต่ออายุได้ที่นี่</div><div class="list">${degRow}${rows}</div>`;
    }
    case 'pets': case 'petshop': {
      const shopMode = p.kind === 'petshop', have = me.pets || [], ids = Object.keys(G.pets).sort((a, b) => G.pets[a].price - G.pets[b].price);
      const card = id => { const pt = G.pets[id], own = have.includes(id), on = me.pet === id;
        const btn = own ? (!shopMode || on) ? B(on ? '📦 เก็บเข้า' : '🐾 เรียกออกมา', { t: 'pet.call', id: on ? '' : id }, on ? '' : 'good') : '<small>มีแล้ว ✓</small>' : B(money(pt.price), { t: 'act', st: p.st, a: 'buy', pet: id }, 'good', me.money < pt.price);
        return `<div class="look fcard petcard ${on ? 'on' : ''}"><canvas data-pet="${id}" width="84" height="84"></canvas><small>${pt.icon} ${esc(pt.name)}${on ? ' ✓' : ''}</small><span class="rtag r${pt.rar}">${G.fishRarity[pt.rar]}</span><em>${esc(pt.desc)}</em>${btn}</div>`; };
      const mine = ids.filter(id => have.includes(id)), shop = ids.filter(id => !have.includes(id));
      if (shopMode) return `<h2>🐾 ${esc(STN(p.st)?.label || 'ร้านสัตว์เลี้ยง')}</h2><div class="sub">${hoursTxt('petshop')} · รับเลี้ยงแล้วเรียกออกมาเดินตามได้ที่เมนู 🐾 สัตว์เลี้ยง · เลี้ยงได้ทีละ 1 ตัว · มี ${have.length}/${ids.length} ตัว</div>
        <div class="looks">${ids.map(card).join('')}</div>`;
      return `<h2>🐾 สัตว์เลี้ยง</h2><div class="sub">${me.pet ? `ตอนนี้ ${G.pets[me.pet].icon} <b>${esc(G.pets[me.pet].name)}</b> เดินตามคุณอยู่ · แตะที่ตัวมันเพื่อเล่นด้วย` : 'เรียกสัตว์เลี้ยงออกมาเดินตามคุณได้ (รับเลี้ยงเพิ่มที่ร้านสัตว์เลี้ยง 🐾 ถนนเหนือ)'} · เลี้ยงได้ทีละ 1 ตัว</div>
        ${mine.length ? `<div class="secT">💖 สัตว์เลี้ยงของฉัน (${mine.length})</div><div class="looks">${mine.map(card).join('')}</div>` : ''}
        ${mine.length ? '' : '<div class="jobbox">ยังไม่มีสัตว์เลี้ยง · ไปรับเลี้ยงที่ร้านสัตว์เลี้ยง 🐾 (ถนนเหนือ) ได้เลย</div>'}`;
    }
    case 'bag': {
      const rows = Object.entries(me.inv).map(([id, q]) => { const it = G.items[id]; return itemRow(id, it.eat ? B('ใช้', { t: 'use', item: id }, 'good') : '', `x${q} · ~${money(it.base)}${it.eat ? ' · ' + eatText(it.eat) : ''}`); }).join('');
      const licTxt = me.licenses.map(l => G.licenses[l].icon + G.licenses[l].name).join(', ') || 'ไม่มี';
      const rod = G.rods[me.rodEq] ? `${G.rods[me.rodEq].icon} ${G.rods[me.rodEq].name} · ตกปลา Lv.${me.fishLv}` : 'ยังไม่มีเบ็ด (ซื้อที่สมาคมประมง)';
      const tools = Object.entries(me.tools || {}).map(([c, t]) => `${G.shop.tools[c]?.icon || ''}${'★'.repeat(t)}`).join(' ') || '—';
      const home = me.house >= 0 ? `บ้านเลขที่ ${me.house + 1} ⭐${me.comfort}` : me.rent ? `เช่าบ้านเลขที่ ${me.rent.idx + 1}` : 'ยังไม่มี';
      const own = `<div class="grid2" style="margin:6px 0"><div class="item"><div class="nm">🎣 ตกปลา<small>${rod}</small></div></div><div class="item"><div class="nm">🛠️ อุปกรณ์<small>${tools}</small></div></div><div class="item"><div class="nm">🏠 บ้าน<small>${home}</small></div>${me.house >= 0 || me.rent ? B('📍', { fn: 'guide', key: 'door_house' + (me.house >= 0 ? me.house : me.rent.idx) }) : ''}</div><div class="item"><div class="nm">🌾 สวน<small>${me.garden ? `แปลงที่ ${me.garden.lot + 1} · ${me.garden.n} แปลงปลูก` : 'ยังไม่มี'}</small></div>${me.garden ? B('📍', { fn: 'guide', key: 'lot' + me.garden.lot }) : ''}</div><div class="item"><div class="nm">🏦 ธนาคาร<small>${money(me.bank)}${me.loan ? ` · หนี้ ${money(me.loan)}` : ''}</small></div></div><div class="item"><div class="nm">📱 เบอร์ของฉัน<small>${me.phone}</small></div></div></div>`;
      const job = me.career !== 'none' && G.careers[me.career]?.where;
      const outfits = (me.outfits || []).map(id => `<div class="setRow"><span><b>🎽 ${esc(G.outfitDefs[id]?.name || id)}</b><small>${esc(G.outfitDefs[id]?.how || '')}</small></span>${B(me.outfit === id ? 'ใส่อยู่ ✓' : 'ใส่', { fn: 'look', set: { outfit: me.outfit === id ? '' : id } }, me.outfit === id ? 'primary' : 'good')}</div>`).join('');
      return `<h2>🎒 กระเป๋า</h2><div class="sub">ใบรับรอง: ${licTxt} · ทรัพย์สินรวม ${money(me.worth)}</div>${own}<div class="list">${rows || '<div class="sub">ยังไม่มีของ</div>'}</div>
        <div class="secT">🎣 เบ็ดตกปลา</div><div class="list">${rodRows()}</div>
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
      return `<h2>💼 งานของฉัน</h2>${misBox()}
        <div class="jobbox ${me.career === 'none' ? '' : 'ok'}">${me.career === 'none' ? '🙂 ตอนนี้ยัง<b>ว่างงาน</b> — เดินเข้าไปสมัครงานในอาคารต่างๆ ได้เลย' : `${cur.icon} <b>${cur.name}</b> · Lv.${me.lv}${me.jx && me.career !== 'office' ? `<div class="sub">⭐ EXP ${(+me.jx.cur).toFixed(1)}/${me.jx.need} · ได้ EXP ${me.jx.gain}% ต่อครั้ง (เลเวลยิ่งสูงยิ่งได้น้อย) · รายได้จากงาน +${me.jx.pay}%</div>` : ''}`}
        ${me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ สมัครงานใหม่ได้ในอีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : ''}
        ${me.career !== 'none' ? B('📦 ลาออก', { t: 'resign' }, 'warn') : ''}</div>
        ${starter}<div class="sub" style="margin-top:8px">⏳ เปลี่ยนงานแล้วต้องรอ 5 นาทีถึงจะสมัครงานใหม่ได้ · 🎣 ตกปลา ทำได้ทุกคน ไม่ต้องสมัคร</div><div class="secT">👤 สมัครงาน / เปลี่ยนอาชีพ</div><div class="sub">กด 🚶 แล้วตัวละครจะเดินไปหาเจ้าหน้าที่ให้เอง</div><div class="list">${rows}</div>`;
    }
    case 'toolshop': {
      const order = [me.career, ...Object.keys(G.shop.tools).filter(c => c !== me.career)].filter(c => G.shop.tools[c]);
      const rows = order.map(c => {
        const d = G.shop.tools[c], t = (me.tools || {})[c] || 0, cc = G.careers[c] || { fisher: { icon: '🎣', name: 'ตกปลา (ทุกคน)' } }[c] || { icon: '', name: c };
        const sub = t >= 3 ? `สูงสุดแล้ว · ${d.fx[2]}` : `ถัดไป: ${d.fx[t]}${t ? ` · ตอนนี้: ${d.fx[t - 1]}` : ''}`;
        return itemRowRaw(d.icon, `${d.name} <span class="tag">${cc.icon} ${cc.name}</span> <span style="color:var(--acc)">${'★'.repeat(t)}${'☆'.repeat(3 - t)}</span>`, sub,
          t >= 3 ? '<span class="tag">MAX</span>' : B(money(G.shop.toolPrices[t]), { t: 'act', st, a: 'buy', career: c }, c === me.career ? 'good' : ''));
      }).join('');
      return `<h2>🛠️ ร้านอุปกรณ์</h2><div class="sub">${hoursTxt('toolshop')} · อัปเกรดอุปกรณ์ให้หาเงินได้มากขึ้น · อัปได้ 3 ระดับ</div><div class="list">${rows}</div>`;
    }
    case 'dealer': {
      const tab = ['car', 'gem'].includes(p.vtab) ? p.vtab : 'moto', lic = (me.licenses || []).includes('driving'), mine = me.vehicles || [];
      const cards = Object.entries(G.shop.vehicles).filter(([, v]) => (tab === 'gem' ? !!v.gem : v.kind === tab && !v.gem) && (!v.job || v.job === me.career)).sort((a, b) => (a[1].gem || a[1].price) - (b[1].gem || b[1].price)).map(([key, v]) => {
        const has = mine.includes(key), on = me.ride === key, need = v.license && !lic, cost = v.gem ? `💎${v.gem.toLocaleString()}` : money(v.price), afford = v.gem ? me.gemInf || (me.gems || 0) >= v.gem : me.money >= v.price;
        const btn = has ? `<div class="col2">${B(on ? '✓ ใช้อยู่' : `${v.icon} ขี่`, { t: 'ride', v: key, on: 1 }, on ? 'primary' : 'good', on)}${v.gem ? '' : B(`ขาย ${money(Math.round(v.price * .6))}`, { t: 'act', st, a: 'sell', v: key }, 'warn')}</div>` : B(need ? '🪪 ต้องมีใบขับขี่' : cost, { t: 'act', st, a: 'buy', v: key }, need ? '' : v.gem ? 'primary' : 'good', need || !afford);
        return `<div class="look fcard vcard ${has ? 'on' : ''}"><canvas data-spr="w_${key}_s" width="150" height="80"></canvas><small>${v.icon} ${esc(v.name)}</small><em>ความเร็ว ×${v.speed}${v.license ? '' : ' · ไม่ต้องมีใบขับขี่'}${v.job ? ' · เฉพาะตำรวจ' : ''}${v.aura ? ' · ✨ออร่า' : ''}${v.fly ? ' · บินข้ามทุกอย่าง' : ''}</em>${btn}</div>`; }).join('');
      return `<h2>🚗 โชว์รูมรถ</h2><div class="sub">${hoursTxt('dealer')} · ขี่/ขับได้ทุกที่นอกอาคาร (เร็วกว่าวิ่ง ไม่เปลืองพลังงาน) · กดปุ่ม 🛵 มุมขวาล่างเพื่อขึ้น/ลงรถ · ขายคืนได้ 60%${lic ? '' : ' · <b>รถส่วนใหญ่ต้องมีใบขับขี่</b> สอบได้ที่มหาวิทยาลัย'}</div>
        <div class="tabs">${B('🏍️ มอเตอร์ไซค์', { fn: 'qtab', set: { vtab: 'moto' } }, tab === 'moto' ? 'primary' : '')}${B('🚗 รถยนต์', { fn: 'qtab', set: { vtab: 'car' } }, tab === 'car' ? 'primary' : '')}${B('💎 รุ่นพิเศษ', { fn: 'qtab', set: { vtab: 'gem' } }, tab === 'gem' ? 'primary' : '')}</div>${tab === 'gem' ? `<div class="jobbox">💎 คุณมีเพชร <b>${me.gemInf ? '∞ (แอดมิน)' : (me.gems || 0).toLocaleString()}</b> · ได้เพชรจากเข้าเกมทุกวัน (+2, ครบสัปดาห์ +10, ครบ 30 วัน +50) ความสำเร็จ (+5–15 ตามความยาก) และทำเควสต์รายสัปดาห์ครบ (+20) · รุ่นพิเศษมีออร่าเรืองแสงตอนขับ ขายคืนไม่ได้</div>` : ''}<div class="looks">${cards}</div>`;
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
        <div class="item"><div class="nm">หนี้คงเหลือ<small><b style="color:${me.loan ? 'var(--bad)' : 'var(--ok)'};font-size:16px">${money(me.loan)}</b></small></div>${B('กู้', { fn: 'bank', st, op: 'borrow' })}${B('ใช้คืน', { fn: 'bank', st, op: 'repay' }, me.loan ? 'good' : '', !me.loan)}</div>`;
    }
    case 'pier': {
      const s = STN(st) || waterNear; if (!s) return '<div class="sub">เดินไปริมน้ำก่อนนะ</div>';
      const c = me.cast, pool = G.fish[s.pool] || [];
      const here = pool.filter(([id]) => id && G.items[id].rar), got = here.filter(([id]) => me.fishdex?.[id]).length;
      const fishes = `${here.length} ชนิด (ตกได้แล้ว ${got}) ` + [1, 2, 3, 4, 5].map(r => [r, here.filter(([id]) => G.items[id].rar === r).length]).filter(([, n]) => n).map(([r, n]) => `<span class="rtag r${r}">${G.fishRarity[r]} ${n}</span>`).join('') + ' · ดูรายชื่อในสมุดภาพปลาที่สมาคมประมง';
      const rod = G.rods[me.rodEq];
      const head = `<h2>🎣 ${esc(s.label)}</h2><div class="sub">${rod ? `ในมือ: ${rod.icon} <b>${esc(rod.name)}</b> (เปลี่ยนได้ในกระเป๋า) · ` : ''}ปลาแถวนี้: ${fishes} · ตกปลา Lv.${me.fishLv}${me.fishLv >= G.fishing.maxLv ? ' (สูงสุด)' : ` (${me.fishXp % G.fishing.xpPerLv}/${G.fishing.xpPerLv})`}</div>`;
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
      const book = fishBook();
      return `<h2>🎣 สมาคมประมง · ร้านขายปลา</h2><div class="sub">${hoursTxt('fishclub')} · แหล่งตกปลา: 🏞️ ทะเลสาบ (ใต้เมือง) · 🌊 ทะเล (ฝั่งตะวันออก) · 🐟 แม่น้ำ (ไร่ชานเมือง)</div>
        <div class="jobbox">💬 ซื้อเบ็ด/อัปเกรดเบ็ด คุยกับ <b>น้าเล็ก</b> ที่ยืนอยู่ข้างๆ</div>
        ${fish.length ? `<div class="sub" style="margin-top:10px"><b>รับซื้อปลา</b> (ดีกว่าร้าน NPC ในตลาด แต่ถูกกว่าขายให้ผู้เล่น)</div><div class="list">${rows}</div>` : '<div class="sub">ยังไม่มีปลาในกระเป๋า</div>'}${book}`;
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
      const rows = (wd?.houses || []).map((h, i) => {
        const [owner, , , sale, rentP, tenant] = h;
        const status = owner ? `เจ้าของ: ${esc(owner)}${sale ? ` · <b style="color:var(--ok)">ขาย ${money(sale)}</b>` : ''}${rentP ? ` · ให้เช่า ${money(rentP)}/วัน` : ''}` : `<b style="color:var(--ok)">ขาย ${money(G.shop.housePrices[i])}</b> · เช่า ${money(G.shop.houseRent[i])}/วัน`;
        return itemRowRaw('🏠', `บ้านเลขที่ ${i + 1}${me.house === i ? ' <span class="tag">ของคุณ</span>' : ''}`, status + (tenant ? ` · ผู้เช่า: ${esc(tenant)}` : ''), B('📍', { fn: 'guide', key: 'door_house' + i }, 'good'));
      }).join('');
      return `<h2>🏡 สำนักงานอสังหาฯ</h2><div class="sub">${hoursTxt('estate')} · ซื้อ/เช่าได้ที่หน้าบ้านแต่ละหลัง · เจ้าของบ้านประกาศขายหรือปล่อยเช่าให้ผู้เล่นอื่นได้</div><div class="list">${rows}</div>`;
    }
    case 'door': return houseDoor(STN(st), st);
    case 'furnshop': {
      const own = me.house >= 0, cats = [['basic', '⭐ พื้นฐาน'], ['live', '🛋️ นั่งเล่น'], ['bed', '🛏️ ห้องนอน'], ['kitchen', '🍳 ครัว'], ['deco', '🌿 ของแต่ง'], ['fun', '🎮 บันเทิง'], ['wall', '🧱 กั้นห้อง'], ['garden', '🌳 สวน']];
      const tab = cats.some(c => c[0] === p.ftab) ? p.ftab : 'basic';
      const list = Object.entries(G.shop.furniture).filter(([, f]) => !f.gift && (f.cat || 'basic') === tab).sort((a, b) => a[1].price - b[1].price);
      const cards = list.map(([k, f]) => { const cnt = me.furniture.filter(x => fbase(x) === k).length, has = !f.multi && cnt > 0;
        return `<div class="look fcard ${has ? 'on' : ''}"><canvas data-spr="${furnSpr(k)}" width="96" height="80"></canvas><small>${f.icon} ${esc(f.name)}</small><em>${f.multi ? (cnt ? `มีแล้ว ${cnt} ชิ้น` : f.solid ? 'กั้นทางเดิน' : 'เดินผ่านได้') : f.comfort ? `ความสบาย +${f.comfort}` : 'ของแต่ง'}</em>${has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'buy', item: k }, own ? 'good' : '', !own || me.money < f.price) + (f.multi && f.price * 10 <= 20000 ? B(`x10 ${money(f.price * 10)}`, { t: 'act', st, a: 'buy', item: k, qty: 10 }, '', !own || me.money < f.price * 10) : '')}</div>`; }).join('');
      return `<h2>🛋️ ร้านเฟอร์นิเจอร์</h2><div class="sub">${hoursTxt('furnshop')} · ซื้อแล้วส่งเข้าคลังที่บ้าน จัดวางเองด้วยปุ่ม 🛋️ จัดบ้าน · ความสบายรวมสูงสุด ⭐30${own ? ` · บ้านเลขที่ ${me.house + 1} ความสบาย ⭐ <b>${me.comfort}</b>` : ''}</div>${own ? '' : '<div class="jobbox">🏡 ต้องมีบ้านของตัวเองก่อนถึงจะซื้อเฟอร์นิเจอร์ได้</div>'}
        <div class="tabs ftabs">${cats.map(([k, l]) => B(l, { fn: 'qtab', set: { ftab: k } }, tab === k ? 'primary' : '')).join('')}</div><div class="looks">${cards}</div>`;
    }
    case 'barber':
    case 'fashion': {
      const W = { hair: [], shirt: [], pants: [], ...(me.wardrobe || {}) }, lk = me.look || {};
      const sec = (cat, title) => `<div class="sub" style="margin-top:10px"><b>${title}</b></div><div class="looks">${Object.entries(G.looks[cat]).map(([id, it]) => {
        const has = W[cat].includes(id), on = lk[cat] === id;
        return `<div class="look ${on ? 'on' : ''}"><canvas data-look="${cat}:${id}" width="72" height="96"></canvas><small>${esc(it.name)}</small>${on ? '<span class="tag">ใส่อยู่</span>' : has ? B('ใส่', { t: 'wear', cat, id }, 'good') : B(money(it.price), { t: 'act', st, a: 'buy', cat, id }, '')}</div>`;
      }).join('')}</div>`;
      if (p.kind === 'barber') return `<h2>💈 ร้านทำผม</h2><div class="sub">${hoursTxt('barber')} · ทุกคนเริ่มด้วยผมสีน้ำตาลเหมือนกัน มาย้อมสีผมได้ที่นี่ (ทำผมใหม่แล้วมีความสุขเพิ่ม) · สีที่เคยทำแล้วเปลี่ยนกลับได้ฟรี</div>${sec('hair', '💇 ย้อมสีผม')}`;
      const ft = ['shirt', 'pants', 'outfit'].includes(p.ftab) ? p.ftab : 'shirt';
      const ftabs = `<div class="tabs">${[['shirt', '👕 เสื้อ'], ['pants', '👖 กางเกง'], ['outfit', '👗 ชุด']].map(([k, l]) => B(l, { fn: 'qtab', set: { ftab: k } }, ft === k ? 'primary' : '')).join('')}</div>`;
      return `<h2>👕 ร้านแฟชั่น</h2><div class="sub">${hoursTxt('fashion')} · แต่งตัวใหม่แล้วมีความสุขเพิ่ม · ของที่ซื้อแล้วเปลี่ยนกลับไปใส่ได้ฟรี · ย้อมผมที่ร้านทำผม 💈</div>${ftabs}
        ${ft !== 'outfit' ? sec(ft, ft === 'shirt' ? '👕 เสื้อ' : '👖 กางเกง') : `
        <div class="sub" style="margin-top:10px"><b>👗 ชุดพิเศษ</b> · ใส่ทับทั้งตัว (แทนชุดอาชีพด้วย) · ซื้อครั้งเดียว ถอด/ใส่ได้ตลอด</div><div class="looks">${Object.entries(G.outfitDefs).filter(([, o]) => o.price).map(([id, o]) => {
          const has = (me.outfits || []).includes(id), on = me.outfit === id;
          return `<div class="look ${on ? 'on' : ''}"><canvas data-of="${id}" width="72" height="96"></canvas><small>${esc(o.name)}</small>${has ? B(on ? 'ถอด' : 'ใส่', { t: 'act', st, a: 'outfit', id }, on ? '' : 'good') : B(money(o.price), { t: 'act', st, a: 'outfit', id }, '')}</div>`;
        }).join('')}</div>`}`;
    }
    case 'police': return `<h2>👮 สถานีตำรวจ</h2><div class="sub">เปิด 24 ชม. · ตำรวจรับเคส 🐕 ตามหาหมาที่หายไป (ค่าตอบแทนตามเวลาที่ใช้ · หมดเวลา = ล้มเหลว) · ต้องจบ ม.6 และสอบนายสิบตำรวจที่มหาวิทยาลัย</div>${staffHint('police')}${job('police') ? dogBox(st) + policeReports() : ''}`;
    case 'square': return `<h2>📋 ศาลาประชาคม</h2><div class="sub">${hoursTxt('square')} · สมัครเป็นขอทานได้ที่นี่ (เงินสด+ฝากไม่เกิน ฿2,000) · หาเงินโดย<b>วิ่งเก็บขยะ</b>ที่ถังขยะ หรือนั่งขอทาน (ปุ่ม 🥣) · มีเงินเกิน ฿2,000 พ้นจากขอทานอัตโนมัติ</div>${staffHint('beggar')}`;
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
    case 'profile': {
      const ti = G.ach.find(x => x.id === me.title), got = (me.ach || []).length;
      return `<h2>🪪 ข้อมูลผู้เล่น</h2>
        <div class="prof"><div class="phCol"><span class="phWrap"><img class="ph" src="${myPic || facePng()}" alt="">${frameHtml(me.frame ?? -1, 124)}</span>${B(p.titles ? '▲ ซ่อนฉายา' : '🏅 เปลี่ยนฉายา', { fn: 'titles' }, 'good')}${B(p.frames ? '▲ ซ่อนกรอบ' : '🖼️ กรอบรูป', { fn: 'qtab', set: { frames: !p.frames } })}</div><div class="pi"><b>${me.admin ? '👑 ' : ''}${esc(me.name)}</b><div>${CAREER_ICON(me.career)} ${G.careers[me.career]?.name || 'ว่างงาน'} · Lv.${me.lv}</div><div>${me.admin ? titleHtml(G.adminTitle || 'นายกเทศมนตรี', 6) : ti ? titleHtml(ti.title, ti.r) : '<small>ยังไม่ได้ตั้งฉายา</small>'}</div>
          <div class="grid2" style="margin-top:6px">${B('🖼️ เปลี่ยนรูปจากอัลบั้ม', { fn: 'photo' }, 'good')}${myPic ? B('ลบรูป', { fn: 'photoDel' }) : ''}</div></div></div>
        <div class="grid2"><div class="item"><div class="nm">💰 ทรัพย์สินรวม<small>${money(me.worth)}</small></div></div><div class="item"><div class="nm">🎣 ตกปลา<small>Lv.${me.fishLv}</small></div></div><div class="item"><div class="nm">📱 เบอร์<small>${me.phone}</small></div></div><div class="item"><div class="nm">🏅 ฉายา<small>${got}/${G.ach.length}</small></div></div></div>
        ${(() => { const mine = G.ach.filter(a => (me.ach || []).includes(a.id)).sort((x, y) => (y.r || 1) - (x.r || 1)), todo = achTodo().length;
          return `<div class="secT">🏅 ความสำเร็จ ${mine.length}/${G.ach.length}</div><div class="tchips">${mine.slice(0, 16).map(a => `<span class="rar${a.r || 1}">🏅 ${esc(a.title)}</span>`).join('') || '<small>ยังไม่มี ลองทำงาน ตกปลา หรือเข้าเกมทุกวัน</small>'}${mine.length > 16 ? `<small>+${mine.length - 16}</small>` : ''}</div>
          <div class="grid2" style="margin-top:6px">${B(todo ? `🎁 รับรางวัล (${todo})` : '📋 ความสำเร็จทั้งหมด', { fn: 'open', kind: 'achv' }, todo ? 'primary' : 'good')}${B('📅 รางวัลเข้าเกม', { fn: 'open', kind: 'rewards' })}</div>`; })()}
        ${p.frames ? frameRows() : ''}
        ${p.titles ? `<div class="secT">🏅 เปลี่ยนฉายา · สีบอกความหายาก: ${[1, 2, 3, 4, 5].map(r => `<span class="rtag r${r}">${RAR[r]}</span>`).join('')}</div>
        <div class="sub">ตั้งฉายาที่ปลดล็อกแล้วให้ลอยบนหัว ทุกคนในเมืองเห็น · ที่ปลดล็อกแล้วอยู่ด้านบน</div><div class="list">${achRows()}</div>` : ''}`;
    }
    case 'mail': {
      if (!p.read) { p.read = 1; if ((me.mailN || 0) > 0) send({ t: 'mailread' }); }
      const rows = mailList.map(x => `<div class="mailItem ${x.read ? '' : 'new'}"><small>${x.read ? '' : '🆕 '}จาก <b>${esc(x.from)}</b> · ${new Date(x.t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</small><p>${esc(x.text)}</p>
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
      return `<h2>💬 แชท</h2><div class="tabs">${B('👥 คนใกล้ๆ', { fn: 'chatTab', tab: 'near' }, chatTab === 'near' ? 'primary' : '')}${B('🌐 แชทโลก', { fn: 'chatTab', tab: 'world' }, chatTab === 'world' ? 'primary' : '')}</div>
        <div class="sub">${chatTab === 'world' ? 'ทุกคนในเมืองอ่านได้ ไม่ขึ้นบนหัว (ส่งได้ทุก 3 วินาที)' : 'ข้อความจะลอยเป็นบับเบิ้ลบนหัว เฉพาะคนที่อยู่ใกล้คุณ (~14 ช่อง) เท่านั้นที่เห็น'}</div><div id="chatMsgs">${chatHtml()}</div><form id="chatForm" class="rowf"><input id="chatIn" maxlength="120" placeholder="${chatTab === 'world' ? 'พิมพ์ถึงทุกคน...' : 'พิมพ์ข้อความ...'}" autocomplete="off"><button class="primary" type="submit">ส่ง</button></form>`;
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
        😌 <b>พัก</b>: นั่งพักได้ทุกที่ พลังงานฟื้นเร็ว 3 เท่า และเลือดค่อยๆ ฟื้น (ถ้าไม่หิว)<br>
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
      const prof = `<div class="prof"><span class="phWrap"><img class="ph" src="${inf?.pic || `assets/ui/face_${o.g === 'f' ? 'f' : 'm'}.png`}" alt="">${frameHtml(inf?.fr ?? -1, 124)}</span><div class="pi">
        <div>${CAREER_ICON(o.c)} ${G.careers[o.c]?.name || 'ว่างงาน'} · Lv.${o.lv || 1}</div><div>${titleHtml(o.title, o.tr)}</div>
        ${inf ? `<small>💰 ${money(inf.worth)} · 🎣 Lv.${inf.fishLv} · อยู่ในเมือง ${inf.days} วัน${inf.home ? ` · 🏠 บ้าน #${inf.home}` : ''}${inf.degree ? ' · 🎓' : ''}${inf.phone ? ` · 📱 ${inf.phone}` : ''}</small>` : '<small>กำลังโหลด...</small>'}</div></div>
        ${inf?.ach?.length ? `<div class="tchips">${inf.ach.slice(0, 12).map(([t, r]) => `<span class="rar${r}">🏅 ${esc(t)}</span>`).join('')}</div>` : ''}`;
      return `<h2>${o.adm ? '👑 ' : ''}${esc(o.name)}${o.afk ? ' <span class="tag">💤 ไม่อยู่</span>' : ''}</h2>${prof}
        <div class="grid2" style="margin-bottom:6px">${B('✉️ ส่งจดหมาย', { fn: 'open', kind: 'mail', set: { to: o.name } })}</div>
        <div class="sub">${far ? '⚠️ อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน' : 'อยู่ใกล้พอที่จะติดต่อกันได้'}</div>
        <div class="grid2">${B('🤝 แลกเปลี่ยน', { fn: 'tradeReq', to: o.id }, 'primary', far)}${B(known ? '📇 มีเบอร์แล้ว' : '📱 ขอเบอร์', { t: 'req', kind: 'phone', to: o.id }, 'good', far || known)}</div>
        ${job('doctor') ? `<div class="rowf" style="margin-top:8px">ค่ารักษา ${fee} ${B('💉 เสนอปฐมพยาบาล', { fn: 'heal', to: o.id }, 'good', far)}</div>` : ''}
        ${o.c === 'beggar' ? `<div class="jobbox">🥣 ขอทาน · บริจาคแล้วอิ่มบุญ ความสุขเพิ่ม<div class="rowf" style="margin-top:6px"><input id="donIn" type="number" value="20" min="1" style="width:90px"> ${B('🙏 บริจาค', { fn: 'donate', to: o.id }, 'good', far)}</div></div>` : ''}`;
    }
    case 'friends': {
      const fr = (me.friends || []).slice().sort((a, b) => b.on - a.on);
      const rows = fr.map(f => itemRowRaw(f.on ? (f.afk ? '🌙' : '🟢') : '⚪', esc(f.n), f.on ? `${f.afk ? 'ไม่อยู่หน้าจอ · ' : 'ออนไลน์ · '}${esc(f.where)}` : 'ออฟไลน์', f.on ? B('📞 โทร', { t: 'call', phone: f.p }, 'good', !!call) : '')).join('');
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
      const bl = bugList ? (bugList.length ? bugList.map(b => `<div class="bugItem">${esc(b.text)}<small>${esc(b.by)} · ${esc(b.where)} · ${new Date(b.t).toLocaleString('th-TH')}${b.st ? `<br><code style="font-size:10px;opacity:.7">${esc(b.st)}</code>` : ''}</small></div>`).join('') : '<div class="sub">ไม่มีรายงานบัค</div>') : '';
      return `<h2>👑 God mode</h2><div class="sub">เฉพาะแอดมิน · ปกติเล่นด้วยค่าสเตตัสธรรมดา</div>
        <div class="setRow"><span><b>⚡ ไม่มีคูลดาวน์</b><small>ทุกอย่างไม่ต้องรอ (เปลี่ยนงาน ตกปลา ฯลฯ)</small></span>${B(g.nocd ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'nocd' }, g.nocd ? 'good' : '')}</div>
        <div class="setRow"><span><b>🛡️ ล็อกสเตตัสเต็ม</b><small>ไม่หิว ไม่ป่วย ไม่หมดสติ</small></span>${B(g.lock ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'lock' }, g.lock ? 'good' : '')}</div>
        <div class="setRow"><span><b>🏃 ความเร็ว x<span id="godSpdV">${(g.speed || 1).toFixed(1)}</span></b><small>เลื่อนปรับได้ 1–5 เท่า (กดค้างปุ่มวิ่งได้อีก)</small></span><input id="godSpd" type="range" min="1" max="5" step="0.5" value="${g.speed || 1}" style="width:130px"></div>
        <div class="setRow"><span><b>✨ วาร์ป</b><small>เปิดแล้วกด 🗺️ แผนที่ แตะตรงไหนก็วาร์ปไปที่นั่น</small></span>${B(g.warp ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'warp' }, g.warp ? 'good' : '')}</div>
        ${g.warp ? B('🗺️ เปิดแผนที่เพื่อวาร์ป', { fn: 'map' }, 'primary big') : ''}
        <div class="setRow"><span><b>🌑 ชุดคลุมแอดมิน + ออร่า</b><small>ชุดเฉพาะแอดมิน ไม่มีขาย · ทุกคนเห็นออร่ารอบตัว</small></span>${B(g.cloak ? 'ใส่อยู่' : 'ซ่อนอยู่', { fn: 'god', op: 'cloak' }, g.cloak ? 'good' : '')}</div>
        <div class="setRow"><span><b>🚪 เข้าได้ทุกอาคาร</b><small>แม้ร้านปิด ปิดปรับปรุง หรือบ้านของคนอื่น · ไม่โดนไล่ออกตอนร้านปิด</small></span>${B(g.doors ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'doors' }, g.doors ? 'good' : '')}</div>
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
        <div class="secT">🔊 เสียง</div><div class="grid2">${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'good' : '')}${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🎵 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'good' : '')}</div>
        <div class="secT">⛶ หน้าจอ</div><div class="grid2">${B(fsOn ? '↙️ ออกจากเต็มจอ' : '⛶ เต็มจอ', { fn: 'fs', mode: fsOn ? 'exit' : 'full' }, fsOn ? '' : 'primary', !canFs)}${B('🔄 เต็มจอ + แนวนอน', { fn: 'fs', mode: 'landscape' }, 'good', !canFs)}</div>
        ${canFs ? '' : '<div class="sub">iPhone/iPad: กดแชร์ ⬆️ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดเกมจากไอคอนจะเต็มจอ</div>'}
        ${me.admin ? `<div class="secT">👑 แอดมิน</div>${B('👑 เปิด God mode', { fn: 'open', kind: 'god' }, 'primary big')}` : ''}
        <div class="secT">🎮 อื่นๆ</div>
        <div class="grid2">${B('📤 ชวนเพื่อน', { fn: 'share' }, 'good')}${B('🐞 แจ้งบัค', { fn: 'open', kind: 'bug' })}${B('❔ วิธีเล่น', { fn: 'open', kind: 'help' })}${B('📖 บทช่วยสอน', { fn: 'tut' })}${B('🆕 อัปเดต', { fn: 'open', kind: 'news' })}</div>
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
  const [owner, cf, furn, sale, rentP, tenant, until] = h, price = G.shop.housePrices[i], rent = G.shop.houseRent[i];
  const mine = me.house === i, iRent = me.rent && me.rent.idx === i;
  const canEnter = mine || iRent;
  const enter = canEnter ? B(owner || tenant ? '🚪 เข้าบ้าน' : '🚪 เข้าไปดูบ้าน', { t: 'enter', st }, 'primary big') : (owner || tenant ? '<div class="sub">🔒 เข้าได้เฉพาะเจ้าของบ้านและผู้เช่า</div>' : '<div class="sub">🔒 บ้านว่าง ห้ามเข้า — ซื้อหรือเช่าก่อนถึงจะเข้าได้</div>');
  const days = r => `<div class="grid3">${[1, 3, 7].map(d => B(`${d} วัน ${money(r * d)}`, { t: 'act', st, a: 'rent', days: d }, 'good')).join('')}</div>`;
  const left = until ? Math.max(0, Math.round((until - Date.now() - clockOff) / G.dayMs * 10) / 10) : 0;
  if (mine) {
    const rows = Object.entries(G.shop.furniture).filter(([, f]) => !f.gift && !f.cat).map(([k, f]) => itemRowRaw(f.icon, f.name, `ความสบาย +${f.comfort}`, me.furniture.includes(k) ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'furnish', item: k }, 'good'))).join('') + '<div class="sub">🛋️ เฟอร์นิเจอร์อีกกว่า 70 แบบ ที่ร้านเฟอร์นิเจอร์ในเมือง</div>';
    return `<h2>🏠 บ้านของคุณ (เลขที่ ${i + 1})</h2><div class="sub">ความสบาย ⭐ <b>${me.comfort}</b> → พลังงานฟื้นเร็วขึ้น +${me.comfort * 3}% · ${tenant ? `ผู้เช่า: ${esc(tenant)} (อีก ${left} วัน)` : 'ไม่มีผู้เช่า'}</div>${enter}
      <div class="sub" style="margin-top:12px"><b>🪧 ประกาศขายให้ผู้เล่น</b> ${me.houseSale ? `(ตอนนี้ ${money(me.houseSale)})` : ''}</div>
      <div class="rowf"><input id="saleIn" type="number" value="${me.houseSale || price}">${B('ประกาศขาย', { fn: 'price', st, op: 'list', inp: 'saleIn' }, 'good')}${me.houseSale ? B('ยกเลิก', { fn: 'price', st, op: 'list', zero: 1 }) : ''}</div>
      <div class="sub" style="margin-top:8px"><b>🔑 ปล่อยเช่า</b> ต่อวัน ${me.houseRent ? `(ตอนนี้ ${money(me.houseRent)})` : ''}</div>
      <div class="rowf"><input id="rentIn" type="number" value="${me.houseRent || rent}">${B('ปล่อยเช่า', { fn: 'price', st, op: 'rentout', inp: 'rentIn' }, 'good')}${me.houseRent ? B('ยกเลิก', { fn: 'price', st, op: 'rentout', zero: 1 }) : ''}</div>
      <div class="sub" style="margin-top:12px"><b>🛋️ แต่งบ้าน</b></div><div class="list">${rows}</div>
      ${(me.keep || []).length ? `<div class="sub" style="margin-top:8px"><b>🎁 ของพิเศษจากรางวัลเข้าเกม</b> ${me.keep.map(k => `${G.shop.furniture[k].icon} ${G.shop.furniture[k].name}`).join(' · ')} (ตั้งในบ้านอัตโนมัติ)</div>` : ''}
      <div style="margin-top:14px">${B('ขายบ้านคืนโครงการ (ได้คืน ~70%)', { t: 'act', st, a: 'sell' }, 'warn')}</div>`;
  }
  let body = `<div class="sub">ความสบาย ⭐ ${cf} ${furn.length ? furn.map(k => G.shop.furniture[fbase(k)]?.icon || '').join('') : ''}</div>`;
  if (iRent) body += `<div class="jobbox ok">🔑 คุณเช่าบ้านหลังนี้อยู่ เหลืออีก ${left} วัน</div>${enter}<div class="sub" style="margin-top:8px">ต่อสัญญา</div>${days(owner ? rentP : rent)}`;
  else if (tenant) body += `<div class="sub">มีผู้เช่าอยู่: ${esc(tenant)}</div>${enter}`;
  else {
    body += enter;
    if (!owner) body += `<div class="sub" style="margin-top:10px"><b>ซื้อจากโครงการ</b></div>${B(`🏠 ซื้อบ้าน ${money(price)}`, { t: 'act', st, a: 'buy' }, 'good big', me.house >= 0)}<div class="sub" style="margin-top:10px"><b>เช่ากับโครงการ</b> ${money(rent)}/วัน (1 วัน = 24 นาที)</div>${days(rent)}`;
    else {
      if (sale) body += `<div class="sub" style="margin-top:10px"><b>${esc(owner)} ประกาศขาย</b></div>${B(`🏠 ซื้อ ${money(sale)}`, { t: 'act', st, a: 'buy' }, 'good big', me.house >= 0)}`;
      if (rentP) body += `<div class="sub" style="margin-top:10px"><b>${esc(owner)} ปล่อยเช่า</b> ${money(rentP)}/วัน</div>${days(rentP)}`;
      if (!sale && !rentP) body += '<div class="sub" style="margin-top:10px">ไม่ได้ประกาศขายหรือให้เช่า</div>';
    }
    if (me.house >= 0) body += '<div class="sub" style="color:var(--bad)">คุณมีบ้านแล้ว</div>';
  }
  return `<h2>🏠 บ้านเลขที่ ${i + 1}${owner ? ` · ของ ${esc(owner)}` : ' · ว่าง'}</h2>${body}`;
}
// the lost-dog case: take it at the station, find the dog out in town before the time is up
function dogBox(st) {
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
    if (st === 'open') btn = B('รับออเดอร์', { t: 'order_take', id: j.id }, 'good');
    else if (st === 'taken') btn = `<div class="col2">${B('📍 ไปร้าน', { fn: 'guide', key: 'restaurant' }, 'good')}${B('คืน', { t: 'order_drop', id: j.id })}</div>`;
    else btn = j.npc ? B('📍 ไปส่ง', { fn: 'guidePt', x: j.dest.x, y: j.dest.y, area: j.area, label: `ส่งให้ ${j.cust}` }, 'primary') : B('📍 ไปส่ง', { fn: 'guide', key: 'p' + j.custId }, 'primary');
    const state = st === 'open' ? '🆕 รอไรเดอร์' : st === 'taken' ? '🏃 ไปรับที่ร้าน' : '🥡 ไปส่งลูกค้า';
    return itemRowRaw(it.icon, `${esc(it.name)} → ${esc(j.cust)}`, `${state} · ค่าส่ง <b style="color:var(--acc)">${money(j.fee)}</b>${j.tip ? ` + ทิป ${money(j.tip)}` : ''} · ${where}`, btn);
  }).join('')}</div>`;
}
function phonePanel(p) {
  const tab = p.tab || (call ? 'call' : 'contacts');
  const tabs = `<div class="tabs">${[['contacts', '📇 รายชื่อ'], ['call', call ? '📞 กำลังคุย' : '📞 โทร'], ['food', '🍔 อาหาร'], ['bills', (me.bills || []).length ? '🧾 บิล ❗' : '🧾 บิล'], ...(job('rider') ? [['rider', '🛵 ไรเดอร์']] : []), ...(job('police') ? [['police', '🚨 แจ้งเหตุ']] : [])].map(([k, l]) => B(l, { fn: 'mtab', set: { tab: k } }, tab === k ? 'primary' : '')).join('')}</div>`;
  let body = '';
  if (tab === 'contacts') {
    const onl = new Set((me.friends || []).filter(f => f.on).map(f => f.p));
    const rows = (me.contacts || []).map(c => itemRowRaw(onl.has(c.p) ? '🟢' : '⚪', esc(c.n), c.p, `<div class="rowf">${B('📞', { t: 'call', phone: c.p }, 'good', !!call)}${B('🗑️', { t: 'contact_del', phone: c.p })}</div>`)).join('');
    body = `<div class="jobbox">📱 เบอร์ของคุณ: <b style="font-size:18px;letter-spacing:2px">${me.phone}</b><div class="sub">บอกเบอร์นี้ให้เพื่อน แล้วเพื่อนจะบันทึกและโทรหาคุณได้</div></div>
      <div class="rowf" style="margin:10px 0"><input id="phIn" inputmode="numeric" maxlength="6" placeholder="เบอร์เพื่อน 6 หลัก">${B('บันทึก', { fn: 'addContact' }, 'good')}</div>
      <div class="list">${rows || '<div class="sub">ยังไม่มีรายชื่อ</div>'}</div>`;
  } else if (tab === 'call') {
    if (!call) body = '<div class="sub">ยังไม่มีสาย — โทรหาเพื่อนจากแท็บรายชื่อ (เพื่อนต้องออนไลน์)</div>';
    else { call.unread = 0; setTimeout(paintCallChip, 0); }
    if (call) body = `<div class="jobbox ok">📞 กำลังคุยกับ <b>${esc(call.with)}</b><div class="sub">${call.payer ? `คุณเป็นคนโทร · ค่าโทร ${money(call.fee)}/นาที · จ่ายแล้ว ${money(call.paid)} (${call.mins} นาที)` : 'อีกฝ่ายเป็นคนจ่ายค่าโทร'}</div></div><div id="callMsgs">${callLog.map(m => `<div class="${m.me ? 'me' : ''}"><b>${m.me ? 'คุณ' : esc(m.name)}</b>: ${esc(m.text)}</div>`).join('')}</div>
      <form id="callForm" class="rowf"><input id="callIn" maxlength="120" placeholder="พิมพ์คุยในสาย..." autocomplete="off"><button class="primary" type="submit">ส่ง</button></form><div class="grid2">${B('➖ ย่อหน้าต่าง (คุยต่อได้)', { fn: 'callMin' })}${B('📵 วางสาย', { t: 'call_end' }, 'warn big')}</div>`;
  } else if (tab === 'food') {
    const open = isOpen('restaurant');
    const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, B(`สั่ง ${money(it.base)}+ส่ง`, { fn: 'order', item: id }, 'good', !open), eatText(it.eat))).join('');
    const mine = (me.myOrders || []).map(o => itemRowRaw(G.items[o.item].icon, esc(G.items[o.item].name), o.state === 'open' ? '⏳ รอไรเดอร์รับออเดอร์' : o.state === 'taken' ? `🏃 ${esc(o.rider)} กำลังไปรับที่ร้าน` : `🛵 ${esc(o.rider)} กำลังมาส่ง`, o.state === 'open' ? B('ยกเลิก', { t: 'order_cancel', id: o.id }, 'warn') : '')).join('');
    body = `<div class="sub">${open ? 'ร้านอาหารเปิดอยู่' : '🔒 ร้านอาหารปิด (07:00–23:00)'} · ค่าส่งคิดตามระยะทาง · ไรเดอร์ผู้เล่นมาส่งถึงตัว (ถ้าไม่มีไรเดอร์ ร้านส่งเองแต่ช้า)</div>
      ${mine ? `<div class="sub"><b>ออเดอร์ของฉัน</b></div><div class="list">${mine}</div>` : ''}
      <div class="rowf" style="margin:8px 0">ทิปไรเดอร์ <input id="tipIn" type="number" min="0" max="500" value="0" style="width:90px"> ฿</div><div class="list">${rows}</div>`;
  } else if (tab === 'rider') body = riderJobs();
  else if (tab === 'bills') body = billsBox();
  return `<h2>📱 มือถือ</h2>${tabs}${body}`;
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
  const w = textW(text) + fs * .9, h = fs * 1.55;
  ctx.fillStyle = o.bg || 'rgba(58,36,20,.88)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = o.color || '#fff'; ctx.fillText(text, x, y + fs * .04);
}
const STN = id => id === 'water' ? waterNear : G.stations.find(s => s.id === id);
let atlas = null, atlasImg = null;
let PET_AT = null, petImg = null;
fetch('assets/pets.json?v=1').then(r => r.json()).then(j => { PET_AT = j; const im = new Image(); im.onload = () => { petImg = im; }; im.src = 'assets/pets.webp?v=1'; }).catch(() => { });
fetch('assets/atlas.json?v=v5').then(r => r.json()).then(j => { atlas = j; const im = new Image(); im.onload = () => { atlasImg = im; }; im.src = 'assets/atlas.webp?v=v5'; });
function spr(name, cx, by, X, Y, scale = 1) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const w = s[2] / atlas.tile * TS * scale, h = s[3] / atlas.tile * TS * scale;
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(cx * TS + X - w / 2), Math.round(by * TS + Y - h), Math.round(w), Math.round(h));
  return true;
}
function tex(name, tx, ty, px, py) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const q = atlas.tile;
  // sample 1px inside each quarter: the lossy atlas bleeds a little at sprite edges, which showed as lines between tiles
  ctx.drawImage(atlasImg, s[0] + (tx & 1) * q + 1, s[1] + (ty & 1) * q + 1, q - 2, q - 2, Math.floor(px), Math.floor(py), Math.ceil(TS) + 1, Math.ceil(TS) + 1);
  return true;
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
    case 'i': { const rm = roomGrid[ty * G.map.w + tx]; if (!tex(FLOOR[rm?.rk] || 'fl_wood', tx, ty, px, py)) { ctx.fillStyle = '#b89a78'; ctx.fillRect(px, py, S, S); } return; }
    case 'D': { tex('fl_wood', tx, ty, px, py); ctx.fillStyle = 'rgba(160,40,40,.55)'; ctx.fillRect(px + 2, py + TS * .2, TS - 4, TS * .6); return; }
    case '#': {
      const rm = roomGrid[ty * G.map.w + tx];
      if (rm && ty === rm.y && tx > rm.x && tx < rm.x + rm.w - 1) {
        // back wall: wallpaper with a faint pattern, a chair rail, a darker wainscot and a skirting board
        const c = WALL[rm.rk] || '#dddddd';
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
  const [owner, cf, , sale, rentP, tenant] = h, mine = me && me.house === b.house;
  if (!owner) return { label: tenant ? `🔑 ${tenant}` : `🏷️ ขาย/เช่า #${b.house + 1}`, forSale: !tenant, mine: me?.rent?.idx === b.house };
  return { label: `🏠 ${owner}${sale ? ' · ขาย' : rentP && !tenant ? ' · ให้เช่า' : ''}`, stars: cf, mine, forSale: !!sale };
}
function drawBuildingSprite(b, X, Y) {
  if (!spr(b.sprite, b.x + b.w / 2, b.y + b.h + .02, X, Y)) { ctx.fillStyle = '#8a7a6a'; ctx.fillRect(b.x * TS + X, b.y * TS + Y, b.w * TS, b.h * TS); }
}
function drawBuildingSign(b, X, Y) {
  const s = atlas?.sprites[b.sprite]; const hTiles = s ? s[3] / atlas.tile : b.h;
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
    lin(TS * .28, kind === 'grassOver' ? [[0, 'rgba(20,50,10,.38)'], [1, 'rgba(20,50,10,0)']] : [[0, 'rgba(80,140,40,.55)'], [1, 'rgba(80,140,40,0)']]);
    let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    for (let x = 0; x < S; x += px) {
      const h = px * (1 + Math.floor(rnd() * 3));
      g.fillStyle = rnd() < .5 ? '#5da535' : '#4c912a'; g.fillRect(x, 0, px, h);
      if (rnd() < .3) { g.fillStyle = '#76bf45'; g.fillRect(x, h - px, px, px); }
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
  red:    { side: 'v_red_side', front: ['car_red', .45], back: 'v_red_back', len: 1.9, v: 3.2 },
  blue:   { side: 'v_blue_side', front: ['car_blue', .45], back: 'v_blue_back', len: 1.9, v: 3.0 },
  taxi:   { side: 'v_taxi_side', front: ['taxi', .41], back: 'v_taxi_back', len: 1.9, v: 3.4 },
  yellow: { side: 'v_yellow_side', front: 'v_yellow_front', back: 'v_yellow_back', len: 1.9, v: 3.1 },
  police: { side: 'v_police_side', front: 'v_police_front', back: 'v_police_front', len: 1.9, v: 3.3 },
  amb:    { side: 'v_amb_side', front: 'v_amb_back', back: 'v_amb_back', len: 2.3, v: 6, deep: 1.2 },
  bus:    { side: 'v_bus_side', front: 'v_bus_front', back: 'v_bus_back', len: 3.8, v: 2.4, deep: 1.7 },
};
const FLEET = [['bus', 'red', 'taxi', 'blue', 'yellow', 'police', 'red', 'taxi', 'bus', 'blue', 'yellow', 'taxi', 'red', 'blue'], ['taxi', 'red', 'blue'], ['yellow', 'red', 'blue']];
let traffic = [], trafT = 0;
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
  if (c.dx) return [V.side, 1, c.dx > 0];
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
    const g = ctx.createRadialGradient(px, py, 0, px, py, TS * 2.4);
    g.addColorStop(0, `rgba(255,200,110,${dark * .9})`); g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g; ctx.fillRect(px - TS * 2.4, py - TS * 2.4, TS * 4.8, TS * 4.8);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ navigation across maps
const GATE_TO = { farm_in: 'farm', town_from_farm: 'town', housing_in: 'housing', town_from_housing: 'town' };
function targetOf(key) {
  if (key && key[0] === 'p' && /^p\d+$/.test(key)) { const p = P.get(+key.slice(1)); return p && { player: p.id, label: p.name }; }
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, area: s.area };
}
const CAREER_TARGET = { police: 'police', beggar: 'square', none: 'staff_fishing', office: 'office', farmer: 'coop', merchant: 'warehouse', chef: 'kitchen', doctor: 'hospital', rider: 'rider' };
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
    g.fillStyle = MAP_COL[ch === 'T' || ch === 'B' || ch === 'o' ? '.' : ch] || '#8cc56f'; g.fillRect(x * k, y * k, k + .6, k + .6);
    if (ch === 'T') { g.fillStyle = '#4f8f43'; g.beginPath(); g.arc((x + .5) * k, (y + .5) * k, k * .45, 0, 7); g.fill(); }
  }
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
  ['❤️', 'ดูแลตัวเอง', 'กินให้อิ่ม ป่วยต้องหาหมอ · <b>นั่งพัก</b> (😌) ได้ทุกที่ ฟื้นพลังงานและเลือด · <b>แตะแถบสถานะ</b>เพื่อดูวิธีเพิ่ม · 💬 ปุ่ม<b>คุย</b>ไว้คุยกับคนใกล้ๆ'],
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
const FURN_POS = { bookcase: [4.6, 1.6], gclock: [6.3, 1.5], teddy: [2.9, 6.8], flamp: [10.2, 6.6], vase: [4.9, 4.3], tv: [8, 2.9], sofa: [8, 6.7], plant: [11, 8.7], aqua: [9.6, 8.7], art: [9.2, 1.05], piano: [1.1, 5.9], bed: [2.2, 6.2], jacuzzi: [11.8, 5.5] };
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
let placing = null;
function startPlace(k) {
  const m = P.get(myId), r = m && areaOf(m.x, m.y);
  if (!r || !(r.rk === 'house' || r.yard) || r.house !== me.house) return toast('เข้าไปในบ้านหรือสวนของคุณก่อน แล้วค่อยจัดวาง', '🏠', false);
  closePanel();
  if (r.yard && G.shop.furniture[fbase(k)]?.tile) {   // soil: a brush - every tap lays the next tile from storage on that cell
    placing = { k, house: r.house, fl: 9, brush: true, bx: [.5, r.w - .5, 1, r.h - .5], x: Math.floor(m.x - r.x) + .5, y: Math.floor(m.y - r.y) + 1 };
    return placeBar(k);
  }
  if (r.yard) {                                  // out in the yard
    placing = { k, house: r.house, fl: 9, bx: [.7, r.w - .7, 1.5, r.h - .8], x: clamp(Math.round((m.x - r.x) * 2) / 2, .7, r.w - .7), y: clamp(Math.round((m.y - r.y - .8) * 2) / 2, 1.5, r.h - .8) };
    return placeBar(k);
  }
  placing = { k, house: r.house, fl: r.floor || 1, bx: [.7, 13.3, 1.2, 9.5], x: clamp(Math.round((m.x - r.x) * 2) / 2, 1, 13), y: clamp(Math.round((m.y - r.y - .6) * 2) / 2, 1.5, 9.3) };
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
  $('#placeBar').innerHTML = `<b>${f.icon} ${esc(f.name)}</b><small>แตะพื้นห้องเพื่อเลื่อน · ปุ่มลูกศรขยับละเอียด</small><div class="pb">${['⬅️', '⬆️', '⬇️', '➡️'].map((a, i) => `<button data-nud="${i}">${a}</button>`).join('')}<button id="plOk" class="primary">✓ วาง</button><button id="plStore">📦 เก็บ</button><button id="plX">✕</button></div>`;
  $('#placeBar').classList.remove('hidden');
  $('#placeBar').querySelectorAll('[data-nud]').forEach(b => b.onclick = () => { const d = [[-.25, 0], [0, -.25], [0, .25], [.25, 0]][+b.dataset.nud]; placing.x = clamp(placing.x + d[0], placing.bx[0], placing.bx[1]); placing.y = clamp(placing.y + d[1], placing.bx[2], placing.bx[3]); layoutFurniture(); });
  $('#plOk').onclick = () => { send({ t: 'hplace', k, fl: placing.fl, x: placing.x, y: placing.y }); endPlace(); FX.play('click'); };
  $('#plStore').onclick = () => { send({ t: 'hplace', k, store: 1 }); endPlace(); };
  $('#plX').onclick = () => endPlace();
  layoutFurniture();
}
function endPlace() { placing = null; $('#placeBar').classList.add('hidden'); layoutFurniture(); }
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
  placing.x = clamp(Math.round((wx - r.x) * 4) / 4, placing.bx[0], placing.bx[1]); placing.y = clamp(Math.round((wy - r.y + .3) * 4) / 4, placing.bx[2], placing.bx[3]); layoutFurniture();
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
  roomFurniture = []; roomWalls = [];
  for (const r of G.areas) {
    if (r.yard) {                              // the owner's garden pieces out in the yard (floor 9)
      const h = wd?.houses?.[r.house]; if (!h) continue;
      const soil = new Set(); for (const k of h[2]) { const p = furnPos(h, k); if (p && p[0] === 9 && G.shop.furniture[fbase(k)]?.tile) soil.add(`${Math.floor(p[1])},${Math.round(p[2]) - 1}`); }
      for (const k of h[2]) {
        if (placing && placing.house === r.house && placing.k === k) continue;
        const pos = furnPos(h, k); let sp = furnSpr(k); if (!(pos && pos[0] === 9 && sp)) continue;
        const f = G.shop.furniture[fbase(k)];
        if (f?.tile) sp = soilSprite(soil, Math.floor(pos[1]), Math.round(pos[2]) - 1);   // joins up with the soil next to it
        roomFurniture.push([sp, r.x + pos[1], r.y + pos[2], null, f?.field ? { k, house: r.house, tile: !!f.tile } : null]);
        addWall(f, sp, r.x + pos[1], r.y + pos[2]);
      }
      if (placing && placing.house === r.house && placing.fl === 9) roomFurniture.push([furnSpr(placing.k), r.x + placing.x, r.y + placing.y, 'ghost']);
      continue;
    }
    if (r.kind !== 'room') continue;
    for (const f of r.furniture || []) roomFurniture.push(f);
    if (r.rk === 'house') {
      const h = wd?.houses?.[r.house], fl = r.floor || 1; if (!h) continue;
      for (const k of h[2]) {
        if (placing && placing.house === r.house && placing.k === k) continue;   // the piece being moved is drawn at the cursor
        const pos = furnPos(h, k), sp = furnSpr(k); if (!(pos && pos[0] === fl && sp)) continue;
        roomFurniture.push([sp, r.x + pos[1], r.y + pos[2]]);
        addWall(G.shop.furniture[fbase(k)], sp, r.x + pos[1], r.y + pos[2]);
      }
      if (placing && placing.house === r.house && placing.fl === fl) roomFurniture.push([furnSpr(placing.k), r.x + placing.x, r.y + placing.y, 'ghost']);
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
let rainDrops = null;
function drawRain(t) {
  if (wd?.ev?.id !== 'rain') return;
  if (!rainDrops) rainDrops = Array.from({ length: 90 }, () => [Math.random(), Math.random(), .6 + Math.random() * .6]);
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
  if (id === '_lic') return toast('ใบขับขี่หมดอายุ ต่ออายุได้ที่มหาวิทยาลัย', '🪪', false);
  if (id === '_hungry') return toast('หิวมาก หิวนานๆ เลือดจะลด ถ้าหมดหลอดจะล้มนอนเป็นผัก รีบหาอะไรกิน', '🍗', false);
  const d = G.diseases[id];
  toast(`${d.name}: ${d.sym.join(', ')} · สาเหตุ: ${d.cause} · ${d.self}`, d.icon, false);
}

// ------------------------------------------------------------------ fishing: cast, strike, play the fish, lift it out
// Everything happens in the world on the big button. Wait: the float bobs, small nibbles dip it (striking then scares
// the fish). Bite: the float is yanked under - strike now. Fight: hold = reel in, let go = give line. A running fish
// pulls hard: keep reeling and the line snaps; give it line for too long and it runs off; leave the line slack and the
// hook slips. A tired fish comes in; at the bank it thrashes and breaks the surface - lift exactly then.
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
  if (ok) { doAct('water', 'land'); FX.play('splash'); const s = P.get(myId); if (s) FX.burst(s.x, s.y - .2, '#dff4ff', 16); }
  else { doAct('water', 'lose', { why }); FX.play('fail'); if (navigator.vibrate) navigator.vibrate(why === 'snap' ? [40, 30, 40] : 30); }
}
// a press: in the land phase it is the lift; otherwise just the start of a hold
function fightPress() {
  if (!FG || FG.mode !== 'land') return;
  const now0 = performance.now();
  if (now0 >= FG.surf && now0 <= FG.surfEnd) return fightEnd(true);
  FG.miss++; FG.ten = Math.min(.95, FG.ten + .25); FX.play('splash'); if (fishAt()) FX.ring(fishAt().x, fishAt().y, '#fff', 400, .7);
  if (FG.miss >= 6) fightEnd(false, 'miss');
}
function stepFight(dt) {
  if (!FG) return;
  if (!me?.cast && performance.now() - FG.t0 > 1500) { FG = null; reelHold = false; return; }   // (the 'me' update can arrive a moment after 'hooked')
  const now0 = performance.now(), r = FG.rnd, hold = reelHold, el = now0 - FG.t0;
  if (FG.mode === 'fight') {
    if (now0 > FG.pt) {                                    // the fish alternates between runs and rests
      FG.run = !FG.run;
      FG.pt = now0 + (FG.run ? (700 + r() * 1100) * (.7 + FG.pow * .6) : (900 + r() * 1400) * (1.3 - FG.pow * .5));
      FG.str0 = FG.pow * (.6 + r() * .6) * (.45 + FG.sta * .55);
      if (FG.run) { if (navigator.vibrate) navigator.vibrate(Math.round(40 + FG.str0 * 80)); const f = fishAt(); if (f) FX.ring(f.x, f.y, '#fff', 500, .5 + FG.str0); }
    }
    if (FG.run) {
      const st = FG.str0;
      if (hold) { FG.ten += .7 * st / FG.str * dt * 1.7; FG.dist -= .02 * dt; FG.sta -= .16 * st * dt; }
      else { FG.ten += (st * .25 - .6) * dt; FG.dist += .07 * st * dt; FG.sta -= .07 * st * dt; }
      if (Math.random() < dt * 6) { const f = fishAt(); if (f) FX.burst(f.x, f.y, '#e8f7ff', 2); }
    } else {
      if (hold) { FG.dist -= (.24 + .16 * (1 - FG.pow)) * (.55 + .45 * (1 - FG.sta)) * dt * (1 + (FG.str - 1) * .5); FG.ten += (.45 - FG.ten) * 2.2 * dt; }
      else { FG.ten -= .55 * dt; FG.sta = Math.min(1, FG.sta + .025 * dt); }
    }
    FG.ten = Math.max(0, FG.ten); FG.sta = Math.max(0, FG.sta);
    FG.slack = FG.ten < .08 ? FG.slack + dt : Math.max(0, FG.slack - dt * 2);
    if (hold && now0 - FG.lastTick > (FG.run ? 140 : 85)) { FG.lastTick = now0; FX.play('reel', FG.ten); }
    if (FG.ten > .78 && Math.random() < dt * 4) FX.play('creak', FG.ten);
    if (FG.ten >= 1) return fightEnd(false, 'snap');
    if (FG.dist >= 2.2) return fightEnd(false, 'run');
    if (FG.slack > 5) return fightEnd(false, 'slack');
    if (FG.dist <= .12) {
      if (el < (FG.min || 0) + 400) FG.dist = .13;              // (the server wants a little fight first)
      else { FG.mode = 'land'; FG.dist = .1; FG.surf = now0 + 500 + r() * 600; FG.surfEnd = FG.surf + FG.land; FG.landT = now0; }
    }
  } else {                                                   // at the bank: it thrashes and breaks the surface now and then
    FG.ten = .55 + Math.sin(now0 / 90) * .12;
    if (now0 > FG.surfEnd) { FG.surf = now0 + 450 + r() * 450; FG.surfEnd = FG.surf + FG.land; }
    if (now0 >= FG.surf && !FG.splashed) { FG.splashed = true; FX.play('splash'); const f = fishAt(); if (f) { FX.ring(f.x, f.y, '#fff', 450, .9); FX.burst(f.x, f.y - .2, '#e8f7ff', 8); } }
    if (now0 > FG.surfEnd) FG.splashed = false;
    if (now0 - FG.landT > 7000) { FG.mode = 'fight'; FG.dist = .45; FG.run = true; FG.pt = now0 + 1200; FG.str0 = FG.pow; FG.miss = 0; }   // it dives again
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
function onMeDiff(a, b) {
  const s = P.get(myId); if (!s) return;
  const x = s.x, y = s.y;
  const dm = b.money - a.money;
  if (dm) { const sp = document.createElement('span'); sp.className = 'mfloat'; sp.style.color = dm > 0 ? '#ffd34d' : '#ff8a7a'; sp.textContent = (dm > 0 ? '+' : '−') + money(Math.abs(dm)); $('#card').appendChild(sp); setTimeout(() => sp.remove(), 1600); }
  if (dm > 0) { FX.play('coin', dm >= 1000); FX.float(x, y, '+' + money(dm), '#ffd34d', dm >= 1000 ? .55 : .42); if (dm >= 300) FX.burst(x, y, '#ffd34d', Math.min(24, 6 + Math.floor(dm / 200))); }
  else if (dm < 0) { FX.play('spend'); FX.float(x + .4, y, '−' + money(-dm), '#ff8a7a', .34); }
  const gained = [];
  for (const [k, q] of Object.entries(b.inv)) { const d = q - (a.inv[k] || 0); if (d > 0) gained.push(`+${d}${G.items[k].icon}`); }
  if (gained.length) { FX.play('pop'); FX.float(x - .3, y - .4, gained.join(' '), '#ffffff', .5); FX.burst(x, y, '#ffffff', 6); }
  if (b.career === a.career && b.lv > a.lv) { FX.play('levelup'); FX.ring(x, y, '#ffd34d', 900, 1.6); FX.float(x, y - .6, `LEVEL UP! Lv.${b.lv}`, '#ffd34d', .55); FX.burst(x, y, '#ffd34d', 20); }
  if (a.energy < 99.5 && b.energy >= 100) toast('พลังงานเต็มแล้ว!', '⚡');
  if (b.energy - a.energy >= 8) FX.float(x + .5, y + .2, `+${Math.round(b.energy - a.energy)}⚡`, '#f2c94c', .34);
  if (b.health - a.health >= 8) { FX.float(x - .5, y + .2, `+${Math.round(b.health - a.health)}❤️`, '#ff8a8a', .34); FX.ring(x, y, '#8fe3a6', 700, 1); }
  if (b.hunger - a.hunger >= 8) FX.float(x, y + .4, `+${Math.round(b.hunger - a.hunger)}🍗`, '#8fe3a6', .34);
  if (!a.cast && b.cast) { bobber = findWater(s.x, s.y); castT = performance.now(); FX.play('whoosh'); if (bobber) setTimeout(() => { FX.play('splash'); FX.ring(bobber.x, bobber.y, '#fff', 800, 1); }, 380); }
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
function mgStop() { clearInterval(MG.timer); MG.timer = 0; MG.cur = null; }
function mgClose() { mgStop(); $('#mg').classList.add('hidden'); }
$('#mgX').onclick = () => { FX.play('click'); mgClose(); };
$('#mgBtn').onclick = () => { FX.play('click'); mgMenu(); };
$('#godBtn').onclick = () => { FX.play('click'); panel?.kind === 'god' ? closePanel() : openPanel({ kind: 'god' }); };
$('#homeBtn').onclick = () => { FX.play('click'); openPanel({ kind: 'homedeco' }); };
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
window.__lt = { send, mgStart, mgMenu, get traffic() { return traffic; }, get ambs() { return ambs; }, ambStart, P, camera, walkTo, get wd() { return wd; }, get me() { return me; }, get myId() { return myId; }, get running() { return running; }, get TS() { return TS; }, openPanel, drawCharTo };   // read-only hooks for automated UI tests
$('#tchatForm').onsubmit = e => { e.preventDefault(); const i = $('#tchatIn'); if (i.value.trim()) send({ t: 'trade_chat', text: i.value }); i.value = ''; };
})();
