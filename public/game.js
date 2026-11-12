'use strict';
(() => {
const $ = s => document.querySelector(s);
const COLORS = ['#ef6a5b', '#f2a541', '#f2d14b', '#7ac96b', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const DAY_MS = 8 * 60 * 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '฿' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
let ws, G = null;                       // G = static init data
let me = null, wd = null, myId = 0;     // private state, world data
const P = new Map();                    // id -> player sprite
let clockOff = 0;
let panel = null, panelSig = '';        // { kind, st? }
let trade = null, tradeSig = '';
const chatLog = [];
let creds = null, wantLogin = false;
try { creds = JSON.parse(localStorage.getItem('lt_creds') || 'null'); } catch { }

// ------------------------------------------------------------------ login UI
let avatar = creds?.avatar ?? Math.floor(Math.random() * COLORS.length);
const sw = $('#swatches');
COLORS.forEach((c, i) => { const b = document.createElement('b'); b.style.background = c; b.onclick = () => { avatar = i; paintSw(); }; sw.appendChild(b); });
function paintSw() { [...sw.children].forEach((b, i) => b.classList.toggle('on', i === avatar)); }
paintSw();
const STARTERS = { office: '👔 พนักงานออฟฟิศ — ทำงานรับเงินเดือน', farmer: '🌾 เกษตรกร — ปลูกพืช', fisher: '🎣 ชาวประมง — ตกปลา', merchant: '🛒 พ่อค้า — ซื้อมาขายไป', streamer: '🎥 สตรีมเมอร์ — ไลฟ์สะสมแฟน' };
for (const [k, v] of Object.entries(STARTERS)) $('#inCareer').insertAdjacentHTML('beforeend', `<option value="${k}">${v}</option>`);
$('#careerHint').textContent = 'เปลี่ยนอาชีพได้ตลอด และปลดล็อกโปรแกรมเมอร์ เชฟ แพทย์ได้ที่โรงเรียน';
if (creds) { $('#inName').value = creds.name; $('#inPin').value = creds.pin; $('#inCareer').value = creds.career || 'office'; }
$('#loginForm').onsubmit = e => {
  e.preventDefault();
  creds = { name: $('#inName').value.trim(), pin: $('#inPin').value, avatar, career: $('#inCareer').value };
  $('#loginErr').textContent = '';
  wantLogin = true; connect();
};

// ------------------------------------------------------------------ network
function connect() {
  if (ws && ws.readyState <= 1) { if (ws.readyState === 1) sendLogin(); return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (wantLogin) sendLogin(); };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (G) { toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...', '📡', false); }
    G = G && { ...G, dead: true };
    setTimeout(() => { if (wantLogin) connect(); }, 2000);
  };
}
function sendLogin() { send({ t: 'login', ...creds }); }
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
const doAct = (st, a, extra = {}) => send({ t: 'act', st, a, ...extra });

function handle(m) {
  switch (m.t) {
    case 'loginfail': $('#loginErr').textContent = m.msg; wantLogin = false; break;
    case 'kicked': wantLogin = false; toast(m.msg, '⚠️', false); break;
    case 'init':
      G = m; myId = m.id; P.clear(); buildMini();
      localStorage.setItem('lt_creds', JSON.stringify(creds));
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden');
      chatLog.length = 0; m.chat.forEach(c => chatLog.push(c));
      break;
    case 'me': me = m; $('#meName').textContent = m.name; paintHud(); refreshPanel(); break;
    case 'wd': wd = m; clockOff = m.now - Date.now(); paintEvent(); refreshPanel(); break;
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, fol: p.fol, lv: p.lv });
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { s.x = x; s.y = y; s.f = f; } } break;
    case 'fix': { const s = P.get(myId); if (s) { s.x = s.rx = m.x; s.y = s.ry = m.y; } break; }
    case 'toast': toast(m.msg, m.icon, m.ok); break;
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      const l = $('#log'); const d = document.createElement('div');
      if (m.sys) { d.className = 'sys'; d.textContent = m.text; } else d.innerHTML = `<b>${esc(m.name)}</b>: ${esc(m.text)}`;
      l.appendChild(d); setTimeout(() => d.remove(), 9000); while (l.children.length > 5) l.firstChild.remove();
      const s = P.get(m.id); if (s && !m.sys) { s.bubble = m.text; s.bt = performance.now() + 6000; }
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
    case 'bite': beep(); if (navigator.vibrate) navigator.vibrate(200); break;
    case 'req': showReq(m); break;
    case 'trade': trade = m.open ? m : null; if (!m.open && m.reason) toast(m.reason, '🤝', m.reason.startsWith('✅')); renderTrade(); break;
  }
}

// ------------------------------------------------------------------ audio / toast
let actx;
function beep() { try { actx = actx || new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = .12; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .18); } catch { } }
function toast(msg, icon = '✅', ok = true) {
  const d = document.createElement('div'); d.className = 'toast' + (ok ? '' : ' bad'); d.textContent = `${icon} ${msg}`;
  const t = $('#toasts'); t.appendChild(d); while (t.children.length > 4) t.firstChild.remove();
  setTimeout(() => d.remove(), 3600);
}
function showReq(r) {
  const d = document.createElement('div'); d.className = 'req';
  const what = r.kind === 'trade' ? `ขอแลกเปลี่ยนของกับคุณ 🤝` : `เสนอรักษาคุณ 💉 ค่ารักษา <b>${money(r.fee)}</b>`;
  d.innerHTML = `<div><b>${esc(r.from.name)}</b> ${CAREER_ICON(r.from.c)} ${what}</div><div class="btns"><button class="good">ตกลง</button><button class="warn">ปฏิเสธ</button></div>`;
  const [ok, no] = d.querySelectorAll('button');
  ok.onclick = () => { send({ t: 'req_ans', id: r.id, ok: true }); d.remove(); };
  no.onclick = () => { send({ t: 'req_ans', id: r.id, ok: false }); d.remove(); };
  $('#reqs').appendChild(d); setTimeout(() => d.remove(), 20000);
  beep();
}
const CAREER_ICON = c => G?.careers[c]?.icon || '';

// ------------------------------------------------------------------ HUD
function paintHud() {
  if (!me) return;
  $('#meCareer').textContent = `${CAREER_ICON(me.career)} Lv.${me.lv}`;
  $('#meMoney').textContent = money(me.money);
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
}
function paintEvent() {
  const e = $('#eventBar');
  if (wd?.ev) { e.textContent = wd.ev.text; e.classList.remove('hidden'); } else e.classList.add('hidden');
}
setInterval(() => {
  if (!wd) return;
  const ph = phaseNow(); const h = Math.floor(ph * 24), mi = Math.floor((ph * 24 - h) * 60);
  $('#clock').textContent = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} · 👥 ${wd.on}`;
  document.querySelectorAll('.cd').forEach(el => {
    const left = Math.max(0, Math.ceil((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = left > 0 ? `อีก ${left} วิ` : 'พร้อมเก็บเกี่ยว!';
  });
}, 500);
const phaseNow = () => (((Date.now() + clockOff) % DAY_MS) / DAY_MS);

document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPanel({ kind: b.dataset.open }));
$('#panelX').onclick = closePanel;
$('#panel').addEventListener('pointerdown', e => { if (e.target === $('#panel')) closePanel(); });

// ------------------------------------------------------------------ map helpers
const SOLID = 'wBT';
const tileAt = (x, y) => (x < 0 || y < 0 || x >= G.map.w || y >= G.map.h) ? 'T' : G.map.tiles[y][x];
const solid = (x, y) => SOLID.includes(tileAt(Math.floor(x), Math.floor(y)));
const blockedAt = (x, y) => { const r = G.radius; return solid(x - r, y - r) || solid(x + r, y - r) || solid(x - r, y + r) || solid(x + r, y + r); };

// ------------------------------------------------------------------ input
const keys = {};
let joy = null;                         // { id, ox, oy, dx, dy }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Escape') e.target.blur(); return; }
  keys[e.key.toLowerCase()] = true;
  if (!G) return;
  if (e.key === 'e' || e.key === ' ' || e.key === 'Enter' && !panel) { e.preventDefault(); onAction(); }
  if (e.key === 'Escape') { closePanel(); }
  if (e.key === 'b') openPanel({ kind: 'bag' });
  if (e.key === 'c' || e.key === 't') { e.preventDefault(); openPanel({ kind: 'chat' }); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const cv = $('#cv'), ctx = cv.getContext('2d');
let TS = 40, VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  TS = clamp(Math.min(VW, VH) / 9.5, 34, 54);
}
addEventListener('resize', resize); resize();

let down = null;
cv.addEventListener('pointerdown', e => {
  if (!G) return;
  cv.setPointerCapture(e.pointerId);
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  if (e.pointerType === 'touch' || e.pointerType === 'pen') joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
  else mouseTarget = null;
});
cv.addEventListener('pointermove', e => {
  if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.moved = true;
  if (joy && joy.id === e.pointerId) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy), max = 50;
    if (d > max) { joy.ox += dx - dx / d * max; joy.oy += dy - dy / d * max; dx = dx / d * max; dy = dy / d * max; }
    joy.dx = dx / max; joy.dy = dy / max;
    if (down?.moved) { const st = $('#stick'); st.style.display = 'block'; st.style.left = (joy.ox - 60) + 'px'; st.style.top = (joy.oy - 60) + 'px'; st.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`; }
  }
});
const endPtr = e => {
  if (down && down.id === e.pointerId) {
    if (!down.moved && performance.now() - down.t < 350) onTap(e.clientX, e.clientY);
    down = null;
  }
  if (joy && joy.id === e.pointerId) { joy = null; $('#stick').style.display = 'none'; }
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
let mouseTarget = null;

function camera() {
  const m = P.get(myId); const x = m ? m.rx : 30, y = m ? m.ry : 20;
  return { x: x * TS - VW / 2, y: y * TS - VH / 2 };
}
function onTap(px, py) {
  const c = camera(); const wx = (px + c.x) / TS, wy = (py + c.y) / TS;
  let best = null, bd = 0.9;
  for (const p of P.values()) {
    if (p.id === myId) continue;
    const d = Math.hypot(p.rx - wx, p.ry - 0.2 - wy);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) openPanel({ kind: 'player', pid: best.id });
}

// ------------------------------------------------------------------ interaction
let near = null;
function findNear() {
  const m = P.get(myId); if (!m || !G) return null;
  let best = null, bd = 1e9;
  for (const s of G.stations) {
    const d = Math.hypot(s.x - m.x, s.y - m.y);
    if (d <= s.r && d < bd) { bd = d; best = s; }
  }
  return best;
}
function onAction() {
  if (!near) { toast('เดินเข้าไปใกล้สถานที่ต่างๆ (ไอคอนลอย) เพื่อใช้งาน', '👣', true); return; }
  if (panel?.st === near.id) { closePanel(); return; }
  openPanel({ kind: near.type, st: near.id });
}
$('#actBtn').onclick = onAction;

// ------------------------------------------------------------------ main loop
let last = performance.now(), sendT = 0, lastSent = '';
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (!G || !me) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#14181d'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const m = P.get(myId);
  if (m) {
    let dx = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    let dy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
    if (joy && Math.hypot(joy.dx, joy.dy) > 0.15) { dx = joy.dx; dy = joy.dy; }
    const l = Math.hypot(dx, dy);
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      const sp = G.speed * dt;
      let nx = m.x + dx * sp; if (!blockedAt(nx, m.y)) m.x = nx;
      let ny = m.y + dy * sp; if (!blockedAt(m.x, ny)) m.y = ny;
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8;
    }
    m.rx = m.x; m.ry = m.y;
    sendT += dt;
    const sig = m.x.toFixed(2) + ',' + m.y.toFixed(2);
    if (sendT > 0.066 && sig !== lastSent) { sendT = 0; lastSent = sig; send({ t: 'p', x: +m.x.toFixed(2), y: +m.y.toFixed(2), f: m.f }); }
  }
  for (const p of P.values()) if (p.id !== myId) { const k = Math.min(1, dt * 12); p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }

  near = findNear();
  const ab = $('#actBtn');
  if (near) { ab.classList.remove('hidden'); $('#actIcon').textContent = near.icon; $('#actLabel').textContent = near.type === 'plot' ? 'แปลงเกษตร' : near.label; }
  else ab.classList.add('hidden');
  if (panel?.st && (!near || near.id !== panel.st)) closePanel();
  if (panel?.kind === 'player' && !P.get(panel.pid)) closePanel();

  draw(t);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ drawing
const hash = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
function draw(t) {
  const c = camera(), X = -c.x, Y = -c.y;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#1d3a2a'; ctx.fillRect(0, 0, VW, VH);
  const x0 = Math.max(0, Math.floor(c.x / TS)), y0 = Math.max(0, Math.floor(c.y / TS));
  const x1 = Math.min(G.map.w - 1, Math.ceil((c.x + VW) / TS)), y1 = Math.min(G.map.h - 1, Math.ceil((c.y + VH) / TS));
  const tm = t / 1000;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const ch = G.map.tiles[ty][tx], px = tx * TS + X, py = ty * TS + Y, v = hash(tx, ty);
    let col;
    switch (ch) {
      case '=': col = '#4b5058'; break;
      case ',': col = '#b7b4a6'; break;
      case 'w': col = `hsl(200,55%,${46 + Math.sin(tm * 1.6 + tx * .7 + ty * .5) * 3}%)`; break;
      case 'p': col = '#a47b50'; break;
      case 's': col = '#e3d19a'; break;
      case 'f': col = '#7b5538'; break;
      case 'B': col = '#3b4a3a'; break;
      default: col = `hsl(${108 + v * 12},${34 + v * 8}%,${42 + v * 5}%)`;
    }
    ctx.fillStyle = col; ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(TS) + 1, Math.ceil(TS) + 1);
    if (ch === '=') { // lane dashes
      ctx.fillStyle = '#e8d9a0';
      if ((ty === 20) && (tx < 29 || tx > 30) && tx % 2 === 0) ctx.fillRect(px + 4, py + TS - 2, TS - 8, 4);
      if (tx === 29 && ty % 2 === 0 && ty !== 20 && ty !== 21) ctx.fillRect(px + TS - 2, py + 4, 4, TS - 8);
    }
    if (ch === 'p') { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(px, py + TS * .5, TS, 2); ctx.fillRect(px, py, TS, 1); }
    if (ch === 'f') { ctx.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 1; i < 4; i++) ctx.fillRect(px + 2, py + i * TS / 4, TS - 4, 2); }
    if (ch === '.' && v > .86) { ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(px + v * TS * .8, py + (1 - v) * TS * 5, 3, 3); }
    if (ch === 'T') { // tree
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px + TS / 2 + 3, py + TS * .8, TS * .38, TS * .16, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2f6b3a'; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS * .45, TS * .46, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d8a49'; ctx.beginPath(); ctx.arc(px + TS * .42, py + TS * .38, TS * .26, 0, 7); ctx.fill();
    }
  }
  // buildings
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of G.map.buildings) {
    const px = b.x * TS + X, py = b.y * TS + Y, w = b.w * TS, h = b.h * TS;
    if (px > VW || py > VH || px + w < 0 || py + h < 0) continue;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(px + 6, py + 8, w, h);
    ctx.fillStyle = b.color; ctx.fillRect(px, py, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px, py, w, h * .18);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(px, py + h - h * .1, w, h * .1);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);
    ctx.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 1; i < b.h; i += 2) ctx.fillRect(px + 8, py + i * TS - 2, w - 16, 3);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `800 ${Math.round(TS * .42)}px 'Noto Sans Thai',sans-serif`;
    ctx.fillText(b.label, px + w / 2, py + h / 2);
  }
  // stations
  for (const s of G.stations) {
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -60 || py < -60 || px > VW + 60 || py > VH + 60) continue;
    if (s.type === 'plot') { drawPlot(s, px, py, t); continue; }
    const isNear = near && near.id === s.id;
    ctx.fillStyle = isNear ? 'rgba(255,201,77,.5)' : 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.ellipse(px, py + TS * .15, TS * (isNear ? .9 : .7), TS * (isNear ? .45 : .35), 0, 0, 7); ctx.fill();
    if (isNear) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2; ctx.stroke(); }
    const bob = Math.sin(t / 380 + s.x) * 3;
    ctx.font = `${Math.round(TS * .75)}px serif`; ctx.fillStyle = '#fff'; ctx.fillText(s.icon, px, py - TS * .55 + bob);
  }
  // players (sorted by y)
  const list = [...P.values()].sort((a, b) => a.ry - b.ry);
  for (const p of list) drawPlayer(p, X, Y, t);
  // night
  const l = Math.cos((phaseNow() - 0.5) * Math.PI * 2);
  const dark = clamp((0.2 - l) / 1.2, 0, 0.55);
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); }
  drawMini();
}
function drawPlot(s, px, py, t) {
  const pl = wd?.plots?.[s.idx];
  const isNear = near && near.id === s.id;
  if (isNear) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.strokeRect(px - TS, py - TS, TS * 2, TS * 2); }
  if (!pl) return;
  const [crop, owner, , readyAt] = pl, it = G.items[crop], total = G.crops[crop].grow * 1000;
  const left = readyAt - (Date.now() + clockOff);
  if (left > 0) {
    const prog = clamp(1 - left / (total * 1.6), 0, 1);
    ctx.font = `${Math.round(TS * (.35 + prog * .5))}px serif`; ctx.fillText('🌱', px, py);
  } else {
    ctx.font = `${Math.round(TS * .95)}px serif`; ctx.fillText(it.icon, px, py + Math.sin(t / 250) * 2);
    ctx.font = `${Math.round(TS * .4)}px serif`; ctx.fillText('✨', px + TS * .55, py - TS * .55 + Math.sin(t / 200) * 3);
  }
  if (owner === myId) { ctx.fillStyle = 'rgba(255,201,77,.9)'; ctx.beginPath(); ctx.arc(px - TS * .8, py - TS * .8, 4, 0, 7); ctx.fill(); }
}
function drawPlayer(p, X, Y, t) {
  const px = p.rx * TS + X, py = p.ry * TS + Y;
  if (px < -80 || py < -80 || px > VW + 80 || py > VH + 80) return;
  const r = TS * .36, col = COLORS[p.av] || '#999', ang = (p.f / 8) * Math.PI * 2 - Math.PI;
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py + r * .85, r, r * .45, 0, 0, 7); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  ctx.lineWidth = p.id === myId ? 3 : 2; ctx.strokeStyle = p.id === myId ? '#fff' : 'rgba(0,0,0,.45)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px + Math.cos(ang) * r * .5, py + Math.sin(ang) * r * .5, r * .3, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(px + Math.cos(ang) * r * .62, py + Math.sin(ang) * r * .62, r * .13, 0, 7); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(TS * .28)}px 'Noto Sans Thai',sans-serif`;
  const label = `${CAREER_ICON(p.c)} ${p.name}`;
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(label, px, py - r - 8);
  ctx.fillStyle = p.id === myId ? '#ffe28a' : '#fff'; ctx.fillText(label, px, py - r - 8);
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 28 ? p.bubble.slice(0, 27) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Noto Sans Thai',sans-serif`;
    const w = ctx.measureText(txt).width + 14, by = py - r - TS * .85;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - TS * .27, w, TS * .46, 8); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by + TS * .08);
  }
  ctx.textBaseline = 'middle';
}
// minimap
let miniBase = null;
function buildMini() {
  const c = document.createElement('canvas'); c.width = 120; c.height = 88; const g = c.getContext('2d');
  const colors = { '=': '#555a63', ',': '#a9a699', w: '#4aa3d1', p: '#a47b50', s: '#e3d19a', f: '#7b5538', B: '#c0643a', T: '#2f6b3a', '.': '#5e9b57' };
  for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.map.w; x++) { g.fillStyle = colors[G.map.tiles[y][x]]; g.fillRect(x * 2, y * 2, 2, 2); }
  miniBase = c;
}
function drawMini() {
  const g = $('#mini').getContext('2d'); g.drawImage(miniBase, 0, 0);
  for (const p of P.values()) { g.fillStyle = p.id === myId ? '#fff' : COLORS[p.av]; const s = p.id === myId ? 5 : 3; g.fillRect(p.rx * 2 - s / 2, p.ry * 2 - s / 2, s, s); }
}

// ------------------------------------------------------------------ panels
function openPanel(p) {
  if (p.kind === 'chat') p.sig = 'x';
  panel = p; panelSig = ''; $('#panel').classList.remove('hidden'); refreshPanel(true);
  if (p.kind === 'chat') setTimeout(() => $('#chatIn')?.focus(), 50);
}
function closePanel() { panel = null; $('#panel').classList.add('hidden'); }
function refreshPanel(force) {
  if (!panel || !me) return;
  const html = renderPanel(panel);
  const sig = html;
  if (!force && sig === panelSig) return;
  if (panel.kind === 'chat' && document.activeElement?.id === 'chatIn' && !force) { const box = $('#chatMsgs'); if (box) box.innerHTML = chatHtml(); return; }
  panelSig = sig;
  const body = $('#panelBody'); const ae = document.activeElement; const keep = ae && body.contains(ae) && ae.id ? { id: ae.id, v: ae.value } : null;
  body.innerHTML = html; bindPanel(body);
  if (keep) { const n = document.getElementById(keep.id); if (n) { n.value = keep.v; n.focus(); } }
  const cm = $('#chatMsgs'); if (cm) cm.scrollTop = cm.scrollHeight;
}
function bindPanel(root) {
  root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const m = JSON.parse(b.dataset.m);
    if (m.fn) return FN[m.fn](m, root);
    send(m);
  });
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; };
  const af = root.querySelector('#ansForm'); if (af) af.onsubmit = e => { e.preventDefault(); FN.ans({ st: panel.st }, root); };
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  ans(m, root) { const v = root.querySelector('#ansIn').value.trim(); if (v === '') return; doAct(m.st, 'submit', { ans: v }); root.querySelector('#ansIn').value = ''; },
  logout() { localStorage.removeItem('lt_creds'); wantLogin = false; location.reload(); },
  tradeReq(m) { send({ t: 'req', kind: 'trade', to: m.to }); closePanel(); },
  heal(m, root) { send({ t: 'req', kind: 'heal', to: m.to, fee: +root.querySelector('#feeIn').value || 0 }); closePanel(); },
  donate(m, root) { send({ t: 'donate', to: m.to, amt: +root.querySelector('#donIn').value || 0 }); },
};
const itemRow = (id, right, sub = '') => { const it = G.items[id]; return `<div class="item"><div class="em">${it.icon}</div><div class="nm">${esc(it.name)}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; };
const needCareer = (c) => me.career === c ? '' : `<div class="sub" style="color:var(--bad)">⚠️ ต้องเป็น ${G.careers[c].icon} ${G.careers[c].name} (เปลี่ยนที่เมนู 💼)</div>`;
const chatHtml = () => chatLog.map(m => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');

function renderPanel(p) {
  const k = p.kind, st = p.st;
  switch (k) {
    case 'office': {
      const l = Math.min(me.lv, G.titles.length), pay = 450 + 160 * (l - 1);
      return `<h2>🏢 บริษัท ไทยเทค</h2><div class="sub">ตำแหน่ง: <b>${G.titles[l - 1]}</b> · ทำงานต่อเนื่องเพื่อเลื่อนขั้น · เงินเดือนต่อกะ ~${money(pay)}</div>${needCareer('office')}
        ${B(`💼 ทำงาน (⚡15) ~${money(pay)}`, { t: 'act', st, a: 'work' }, 'primary big')}${B(`🌙 ทำโอที x1.9 (⚡30, เสียสุขภาพ)`, { t: 'act', st, a: 'ot' }, 'big')}`;
    }
    case 'market': {
      const rows = Object.entries(G.items).map(([id, it]) => {
        const have = me.inv[id] || 0, cur = wd?.mk[id] ?? it.base, d = cur / it.base - 1;
        return itemRow(id, `<div style="text-align:right"><b>${money(cur)}</b><br><small class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d * 100).toFixed(0)}%</small></div>` +
          (have ? `<div>${B('ขาย 1', { t: 'act', st, a: 'sell', item: id, qty: 1 })}${B(`ขายหมด ${have}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' }, 'good')}</div>` : ''), have ? `มี ${have}` : '');
      }).join('');
      return `<h2>🏪 ตลาดกลาง</h2><div class="sub">ราคาแชร์กันทั้งเมือง ขายเยอะราคาตก แล้วค่อยๆ ฟื้น · อาชีพที่เกี่ยวข้องได้ราคาดีกว่า 8–12% · อยากได้ราคาดีกว่านี้ไปแลกเปลี่ยนกับผู้เล่นโดยตรง!</div><div class="list">${rows}</div>`;
    }
    case 'warehouse': {
      const rows = Object.entries(G.items).filter(([, it]) => it.wholesale).map(([id, it]) =>
        itemRow(id, `<div>${B('ซื้อ 1', { t: 'act', st, a: 'buy', item: id, qty: 1 })}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 })}</div>`,
          `ราคาส่ง ${money(it.wholesale)} · ราคาตลาด ~${money(it.base)} · สต็อกเหลือ ${wd?.stock[id] ?? '-'}`)).join('');
      return `<h2>📦 คลังสินค้าราคาส่ง</h2><div class="sub">สต็อกมีจำกัดและทุกคนแย่งกัน ซื้อไปขายให้ผู้เล่นที่ต้องการ (กดคนในแมพ → แลกเปลี่ยน) หรือขายตลาดกลาง</div>${needCareer('merchant')}<div class="list">${rows}</div>`;
    }
    case 'studio':
      return `<h2>🎥 สตูดิโอสตรีม</h2><div class="sub">ผู้ติดตาม <b>${me.followers.toLocaleString()}</b> คน · รายได้แฝงทุก 30 วินาที · ยิ่งดังยิ่งมีลุ้นไวรัล · ผู้เล่นคนอื่นเดินมาโดเนทได้</div>${needCareer('streamer')}${B('🎥 เริ่มไลฟ์ (⚡20)', { t: 'act', st, a: 'stream' }, 'primary big')}`;
    case 'cowork': {
      const task = me.task;
      return `<h2>💻 โค้ดดิ้งสเปซ</h2><div class="sub">ลูกค้าส่งโค้ดมา บอกว่าโปรแกรมพิมพ์อะไรออกมา ถูกได้ค่าจ้างก้อนใหญ่ ผิดไม่ได้อะไร (ตอบภายใน 25 วิได้โบนัส)</div>${needCareer('programmer')}
        ${task ? `<pre>${esc(task.code)}</pre><form id="ansForm" class="rowf"><input id="ansIn" inputmode="numeric" placeholder="ผลลัพธ์ที่พิมพ์ออกมา" autocomplete="off"><button class="primary" type="submit">ส่งงาน (⚡18)</button></form>` : ''}
        ${B(task ? '🔄 เปลี่ยนโจทย์' : '📝 รับงานใหม่', { t: 'act', st, a: 'new' }, task ? '' : 'primary big')}`;
    }
    case 'restaurant':
      return `<h2>🍜 ร้านอาหาร</h2><div class="sub">ความหิวเต็มคือสุขภาพดี หิวจัดแล้วสุขภาพจะลดและรายได้ตก · อาหารฝีมือเชฟผู้เล่นให้พลังงานมากกว่า</div>
        <div class="list">${itemRowRaw('🍛', 'ข้าวมันไก่', 'อิ่ม +25', B('ซื้อ ฿80', { t: 'act', st, a: 'eat', kind: 'basic' }))}${itemRowRaw('🍲', 'บุฟเฟ์ชาบู', 'อิ่ม +70 พลังงาน +10', B('ซื้อ ฿350', { t: 'act', st, a: 'eat', kind: 'buffet' }))}</div>`;
    case 'kitchen': {
      const rows = G.recipes.map(r => {
        const out = G.items[r.id]; const ok = Object.entries(r.in).every(([i, q]) => (me.inv[i] || 0) >= q);
        const ing = Object.entries(r.in).map(([i, q]) => `${G.items[i].icon}${q} (มี ${me.inv[i] || 0})`).join(' + ');
        return itemRow(r.id, B('ปรุง ⚡12', { t: 'act', st, a: 'cook', rid: r.id }, ok ? 'good' : '', !ok), `${ing} · ขาย ~${money(out.base)} · อิ่ม+${out.eat.hunger} ⚡+${out.eat.energy || 0}`);
      }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">ซื้อวัตถุดิบจากชาวไร่/ชาวประมง (แลกเปลี่ยนในแมพ) มาปรุงเป็นอาหาร ขายได้แพงกว่าวัตถุดิบหลายเท่า</div>${needCareer('chef')}<div class="list">${rows}</div>`;
    }
    case 'hospital':
      return `<h2>🏥 โรงพยาบาล</h2><div class="sub">สุขภาพของคุณ ${Math.floor(me.health)}/100 · หมอผู้เล่นอาจรักษาให้ถูกกว่า (กดที่ตัวหมอในแมพ)</div>
        ${B('💉 รักษาตัว ฿800 (❤️ +40)', { t: 'act', st, a: 'heal' }, 'big')}${me.career === 'doctor' ? `<div class="sub" style="margin-top:12px">แพทย์: เข้าเวร หรือเดินไปรักษาผู้เล่นคนอื่นรับค่ารักษา</div>${B('🩺 เข้าเวร (⚡28)', { t: 'act', st, a: 'shift' }, 'primary big')}` : needCareer('doctor')}`;
    case 'school': {
      const rows = Object.entries(G.licenses).map(([id, l]) => {
        const has = me.licenses.includes(id), c = Object.values(G.careers).find(c => c.license === id);
        return itemRowRaw(c.icon, l.name, `ปลดล็อกอาชีพ ${c.name}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(l.price), { t: 'act', st, a: 'learn', lic: id }, 'good'));
      }).join('');
      return `<h2>🎓 โรงเรียน</h2><div class="sub">ซื้อใบรับรองเพื่อปลดล็อกอาชีพพิเศษ (ถาวร)</div><div class="list">${rows}</div>`;
    }
    case 'home':
      return `<h2>🏠 บ้านพัก</h2><div class="sub">พลังงาน ${Math.floor(me.energy)}/100</div>${B('😴 งีบหลับ (ฟรี, +25⚡, คูลดาวน์ 30 วิ)', { t: 'act', st, a: 'rest' }, 'big')}${B('🛏️ นอนห้องพัก ฿150 (+60⚡ +10❤️)', { t: 'act', st, a: 'inn' }, 'big')}`;
    case 'pier': {
      const c = me.cast;
      let btn;
      if (!c) btn = B('🎣 เหวี่ยงเบ็ด (⚡8)', { t: 'act', st, a: 'cast' }, 'primary big');
      else if (c.state === 'wait') btn = `<div class="sub" style="text-align:center;font-size:16px;margin:14px 0">⏳ รอปลากินเบ็ด... อย่าเพิ่งดึง!</div>${B('ดึงเบ็ด', { t: 'act', st, a: 'reel' }, 'big')}`;
      else btn = B('‼️ ปลากินเบ็ด! ดึงเลย!', { t: 'act', st, a: 'reel' }, 'big pulse');
      return `<h2>🎣 ท่าเรือตกปลา</h2><div class="sub">เหวี่ยงเบ็ดแล้วรอ เมื่อปลากินเบ็ดให้กดดึงทันใน 1.7 วินาที · ได้ปลาเป็นของ ไปขายตลาดหรือขายให้เชฟ</div>${needCareer('fisher')}${btn}
        <div class="sub" style="margin-top:10px">🥫 ขยะ · 🐟 ฿45 · 🐠 ฿120 · 🐡 ฿300 · 🐋 ฿800 · 🦈 ฿2,400 · 💎 ฿8,000</div>`;
    }
    case 'plot': {
      const s = G.stations.find(x => x.id === st), pl = wd?.plots?.[s.idx];
      if (!pl) {
        const rows = Object.entries(G.crops).map(([id, c]) => itemRow(id, B(`ปลูก ${money(c.seed)}`, { t: 'act', st, a: 'plant', crop: id }), `โต ${c.grow} วิ · ได้ ${c.min}-${c.max} หน่วย · ขาย ~${money(G.items[id].base)}/หน่วย`)).join('');
        return `<h2>🌱 แปลงเกษตร #${s.idx + 1}</h2><div class="sub">แปลงว่าง · เลือกพืชที่จะปลูก (⚡6)</div>${needCareer('farmer')}<div class="list">${rows}</div>`;
      }
      const [crop, owner, oname, readyAt] = pl, it = G.items[crop], mine = owner === myId;
      return `<h2>${it.icon} ${esc(it.name)} <span class="tag">ของ ${esc(oname)}${mine ? ' (คุณ)' : ''}</span></h2>
        <div class="sub"><span class="cd" data-t="${readyAt}"></span> · เจ้าของมีสิทธิ์เก็บก่อน หลังพืชโตเกิน 60 วิ ใครก็เก็บได้!</div>${needCareer('farmer')}${B('🧺 เก็บเกี่ยว (⚡8)', { t: 'act', st, a: 'harvest' }, 'primary big')}`;
    }
    case 'bag': {
      const rows = Object.entries(me.inv).map(([id, q]) => { const it = G.items[id]; return itemRow(id, it.eat ? B('ใช้', { t: 'use', item: id }, 'good') : '', `x${q} · ~${money(it.base)}${it.eat ? ' · ' + eatText(it.eat) : ''}`); }).join('');
      const lic = me.licenses.map(l => G.licenses[l].name).join(', ') || 'ไม่มี';
      return `<h2>🎒 กระเป๋า</h2><div class="sub">ใบรับรอง: ${lic} · ทรัพย์สินรวม ${money(me.worth)} · รายได้สะสม ${money(me.earned)}</div><div class="list">${rows || '<div class="sub">ยังไม่มีของ — ปลูก ตกปลา ปรุงอาหาร หรือแลกเปลี่ยนกับผู้เล่นอื่น</div>'}</div>`;
    }
    case 'career': {
      const rows = Object.entries(G.careers).map(([id, c]) => {
        const locked = c.license && !me.licenses.includes(c.license);
        return itemRowRaw(c.icon, `${c.name}${me.career === id ? ' <span class="tag">ปัจจุบัน</span>' : ''}`, locked ? `🔒 ต้องมี ${G.licenses[c.license].name} (โรงเรียน)` : c.desc,
          B(me.career === id ? 'อาชีพนี้' : 'เลือก', { t: 'career', career: id }, me.career === id ? '' : 'good', me.career === id || locked));
      }).join('');
      return `<h2>💼 เลือกอาชีพ</h2><div class="sub">เปลี่ยนได้ทุกเมื่อ ฟรี (เลเวลของแต่ละอาชีพเก็บไว้แยกกัน)</div><div class="list">${rows}</div>`;
    }
    case 'rank': {
      const rows = (wd?.lb || []).map((r, i) => itemRowRaw(['🥇', '🥈', '🥉'][i] || `${i + 1}.`, `${esc(r.name)} <span class="tag">${CAREER_ICON(r.c)}</span>${r.on ? ' 🟢' : ''}`, '', `<b>${money(r.w)}</b>`)).join('');
      return `<h2>🏆 อันดับเศรษฐี</h2><div class="sub">นับเงินสด + มูลค่าของในกระเป๋า</div><div class="list">${rows}</div>`;
    }
    case 'chat':
      return `<h2>💬 แชท</h2><div id="chatMsgs">${chatHtml()}</div><form id="chatForm" class="rowf"><input id="chatIn" maxlength="120" placeholder="พิมพ์ข้อความ..." autocomplete="off"><button class="primary" type="submit">ส่ง</button></form>`;
    case 'help':
      return `<h2>❔ วิธีเล่น</h2><div class="sub" style="font-size:14px;line-height:1.7">
        👣 <b>เดิน</b>: มือถือแตะค้างแล้วลากนิ้ว (จอยลอย) · คอม WASD/ลูกศร<br>
        🏢 <b>ใช้งานสถานที่</b>: เดินเข้าไอคอนลอย แล้วกดปุ่มกลมสีเหลือง (คอม: E)<br>
        🧑‍🤝‍🧑 <b>เจอผู้เล่นอื่น</b>: แตะที่ตัวเขา → แลกเปลี่ยนของ/เงิน, โดเนท, ให้หมอรักษา<br>
        💼 <b>อาชีพ</b>: เมนูมุมขวาบน เลือกได้ตลอด หมอ/เชฟ/โปรแกรมเมอร์ต้องซื้อใบรับรองที่โรงเรียน<br>
        🔗 <b>เศรษฐกิจเชื่อมกัน</b>: ชาวไร่/ชาวประมง → เชฟปรุงอาหาร → พ่อค้า/ผู้เล่นซื้อไปกิน · ทุกคนต้องกินให้อิ่มและดูแลสุขภาพ<br>
        ⚠️ พลังงาน⚡ฟื้นช้าตามเวลา · หิวจัดสุขภาพลด · สุขภาพ 0 จะเป็นลมเสียเงิน</div>
        ${B('🚪 ออกจากระบบ', { fn: 'logout' }, 'warn big')}`;
    case 'player': {
      const o = P.get(p.pid); if (!o) return '';
      const m = P.get(myId); const d = Math.hypot(o.x - m.x, o.y - m.y), far = d > 5.5;
      const fee = `<input id="feeIn" type="number" value="500" min="0" max="3000" style="width:90px">`;
      return `<h2>${esc(o.name)} <span class="tag">${CAREER_ICON(o.c)} ${G.careers[o.c].name} Lv.${o.lv}</span></h2>
        <div class="sub">${far ? '⚠️ อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน' : 'อยู่ใกล้พอที่จะติดต่อกันได้'}${o.c === 'streamer' ? ` · ผู้ติดตาม ${o.fol.toLocaleString()}` : ''}</div>
        ${B('🤝 ขอแลกเปลี่ยน (ของ/เงิน)', { fn: 'tradeReq', to: o.id }, 'primary big', far)}
        ${o.c === 'streamer' ? `<div class="rowf" style="margin-top:8px"><input id="donIn" type="number" value="100" min="10"> ${B('💝 โดเนท', { fn: 'donate', to: o.id }, 'good', far)}</div>` : ''}
        ${me.career === 'doctor' ? `<div class="rowf" style="margin-top:8px">ค่ารักษา ${fee} ${B('💉 เสนอรักษา', { fn: 'heal', to: o.id }, 'good', far)}</div>` : ''}`;
    }
  }
  return '';
}
const eatText = e => [e.hunger && `อิ่ม+${e.hunger}`, e.energy && `⚡+${e.energy}`, e.health && `❤️+${e.health}`].filter(Boolean).join(' ');
function itemRowRaw(icon, name, sub, right) { return `<div class="item"><div class="em">${icon}</div><div class="nm">${name}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; }

// ------------------------------------------------------------------ trade window
function renderTrade() {
  const w = $('#tradeWin');
  if (!trade) { w.classList.add('hidden'); tradeSig = ''; return; }
  w.classList.remove('hidden'); closePanel();
  const { mine, theirs } = trade;
  const col = (o, editable) => {
    const items = Object.entries(o.items).map(([id, q]) => `<div class="item" style="padding:4px 6px"><span class="em" style="font-size:18px;width:22px">${G.items[id].icon}</span><span class="nm">${esc(G.items[id].name)}</span><b>x${q}</b></div>`).join('');
    return `${items || '<div class="sub">— ยังไม่ใส่ของ —</div>'}<div style="margin-top:6px">💵 <b>${money(o.money)}</b></div>`;
  };
  const inv = Object.entries(me.inv).map(([id, q]) => {
    const cur = mine.items[id] || 0;
    return `<div class="item" style="padding:4px 6px"><span class="em" style="font-size:18px;width:22px">${G.items[id].icon}</span><span class="nm">${esc(G.items[id].name)} <small>มี ${q}</small></span>
      <span class="step"><button data-ti="${id}" data-d="-1">−</button><b>${cur}</b><button data-ti="${id}" data-d="1">+</button><button data-ti="${id}" data-d="all">ทั้งหมด</button></span></div>`;
  }).join('');
  const html = `<h2>🤝 แลกเปลี่ยนกับ ${esc(trade.with.name)}</h2><div class="sub">ใส่ของ/เงินที่ต้องการให้ แล้วกดยืนยันทั้งสองฝ่ายจึงจะแลก (ถ้ามีใครแก้ ต้องยืนยันใหม่)</div>
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
const _refresh = refreshPanel;
setInterval(() => { if (trade) renderTrade(); }, 800);
})();
