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
      let tutDone = false; try { tutDone = !!localStorage.getItem('lt_tut'); } catch { }
      tutPending = !!(m.isNew || !tutDone);
      if (tutPending) setTimeout(() => me && showTut(0), 400);
      break;
    case 'me': { const prev = me; me = m; $('#meName').textContent = m.name; paintHud(); refreshPanel(); if (prev && prev.id === m.id) onMeDiff(prev, m); break; }
    case 'wd': wd = m; clockOff = m.now - Date.now(); paintEvent(); refreshPanel(); break;
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, fol: p.fol, lv: p.lv, veh: p.veh });
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { s.x = x; s.y = y; s.f = f; } } break;
    case 'fix': { const s = P.get(myId); if (s) { s.x = s.rx = m.x; s.y = s.ry = m.y; } break; }
    case 'toast': toast(m.msg, m.icon, m.ok); toastSfx(m); break;
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      const l = $('#log'); const d = document.createElement('div');
      if (m.sys) { d.className = 'sys'; d.textContent = m.text; } else d.innerHTML = `<b>${esc(m.name)}</b>: ${esc(m.text)}`;
      l.appendChild(d); setTimeout(() => d.remove(), 9000); while (l.children.length > 5) l.firstChild.remove();
      const s = P.get(m.id); if (s && !m.sys) { s.bubble = m.text; s.bt = performance.now() + 6000; }
      if (m.sys) { if (/🔥|🦈|💎|🎊|💰|💝/.test(m.text)) FX.play('notice'); } else if (m.id !== myId) FX.play('pop');
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
    case 'bite': FX.play('bite'); if (bobber) { FX.ring(bobber.x, bobber.y, '#fff', 600, 0.9); FX.float(bobber.x, bobber.y - .3, '‼️', '#fff', .6); } if (navigator.vibrate) navigator.vibrate(200); break;
    case 'req': showReq(m); break;
    case 'daily': if (tutPending) pendingDaily = m; else setTimeout(() => showDaily(m), 700); break;
    case 'quest': {
      const s = P.get(myId);
      if (m.kind === 'done') { toast(`เควสต์สำเร็จ: ${m.text} · รางวัล ${money(m.reward)}`, '📜'); FX.play('levelup'); if (s) { FX.ring(s.x, s.y, '#ffd34d', 900, 1.4); FX.float(s.x, s.y - .7, 'เควสต์สำเร็จ!', '#ffd34d', .5); } }
      else { toast(`ทำเควสต์ครบทั้ง 3 ข้อ! โบนัส ${money(m.reward)} · ติดต่อกัน ${m.streak} วัน 🔥`, '🏆'); setTimeout(() => FX.play('chime'), 500); if (s) { FX.burst(s.x, s.y, '#ffd34d', 30); FX.ring(s.x, s.y, '#ffffff', 1100, 2.2); FX.float(s.x, s.y - 1.1, '🏆 ครบทุกเควสต์!', '#8fe3a6', .6); } }
      break;
    }
    case 'trade': {
      if (m.open && !trade) FX.play('pop');
      trade = m.open ? m : null;
      if (!m.open && m.reason) { const ok = m.reason.startsWith('✅'); toast(m.reason, '🤝', ok); if (ok) { FX.play('chime'); const s = P.get(myId); if (s) FX.burst(s.x, s.y, '#8fe3a6', 14); } else FX.play('fail'); }
      renderTrade(); break;
    }
  }
}

// ------------------------------------------------------------------ audio / toast
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
  FX.play('ding');
}
const CAREER_ICON = c => G?.careers[c]?.icon || '';

// ------------------------------------------------------------------ HUD
function paintHud() {
  if (!me) return;
  $('#meCareer').textContent = `${CAREER_ICON(me.career)} Lv.${me.lv}`;
  $('#meMoney').textContent = money(me.money);
  const qs = me.quests; if (qs) { const d = qs.list.filter(x => x.done).length; const ql = $('#qline'); ql.textContent = d === 3 ? '📜 เควสต์ครบแล้ว ✅' : `📜 เควสต์ ${d}/3 · กดดู`; ql.classList.toggle('all', d === 3); $('#qBtn').classList.toggle('has', d < 3); }
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
  $('#vE').textContent = Math.floor(me.energy); $('#vH').textContent = Math.floor(me.hunger); $('#vL').textContent = Math.floor(me.health);
  $('#card').style.borderLeftColor = COLORS[me.avatar ?? 0] || '#999';
}
function paintEvent() {
  const e = $('#eventBar');
  if (wd?.ev) { e.textContent = wd.ev.text; e.classList.remove('hidden'); } else e.classList.add('hidden');
}
setInterval(() => {
  if (!wd) return;
  const ph = phaseNow(); const h = Math.floor(ph * 24), mi = Math.floor((ph * 24 - h) * 60);
  $('#clock').textContent = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} · 👥 ${wd.on}`;
  document.querySelectorAll('.qcd').forEach(el => {
    const s = Math.max(0, Math.floor((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = `${Math.floor(s / 3600)} ชม. ${Math.floor(s % 3600 / 60)} นาที`;
  });
  document.querySelectorAll('.cd').forEach(el => {
    const left = Math.max(0, Math.ceil((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = left > 0 ? `อีก ${left} วิ` : 'พร้อมเก็บเกี่ยว!';
  });
}, 500);
const phaseNow = () => (((Date.now() + clockOff) % DAY_MS) / DAY_MS);

document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPanel({ kind: b.dataset.open }));
$('#panelX').onclick = closePanel;
$('#mini').onclick = () => G && openMap();
$('#mapX').onclick = closeMap;
$('#mapView').addEventListener('pointerdown', e => { if (e.target.id === 'mapView') closeMap(); });
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

let camLift = 0;
function camera() {
  const m = P.get(myId); const x = m ? m.rx : 30, y = m ? m.ry : 20;
  // when a bottom sheet is open, lift the view so your character stays visible above it
  const target = panel && !trade ? VH * 0.24 : 0;
  camLift += (target - camLift) * 0.18;
  return { x: x * TS - VW / 2, y: y * TS - VH / 2 + camLift };
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
      const sp = G.speed * (me.speed || 1) * dt;
      let nx = m.x + dx * sp; if (!blockedAt(nx, m.y)) m.x = nx;
      let ny = m.y + dy * sp; if (!blockedAt(m.x, ny)) m.y = ny;
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8;
      stepAcc += Math.hypot(m.x - m.rx, m.y - m.ry);
      if (stepAcc > 0.62) { stepAcc = 0; FX.play('step', tileAt(Math.floor(m.x), Math.floor(m.y))); if (Math.random() < .5) FX.dust(m.x, m.y); }
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
  // zones, then buildings with roof icons, doors and name signs
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const night = nightLevel();
  drawZones(X, Y);
  for (const b of G.map.buildings) drawBuilding(b, X, Y, night);
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
  drawBobber(X, Y, t);
  FX.draw(ctx, X, Y, TS);
  drawGuide(X, Y, t);
  // night
  const dark = night;
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); }
  drawMini();
}
function drawPlot(s, px, py, t) {
  const pl = wd?.plots?.[s.idx];
  const isNear = near && near.id === s.id;
  if (isNear) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.strokeRect(px - TS, py - TS, TS * 2, TS * 2); }
  if (!pl) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = `700 ${Math.round(TS * .6)}px sans-serif`; ctx.fillText('+', px, py); return; }
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
  const px = p.rx * TS + X; let py = p.ry * TS + Y;
  if (px < -80 || py < -80 || px > VW + 80 || py > VH + 80) return;
  const r = TS * .36, col = COLORS[p.av] || '#999', ang = (p.f / 8) * Math.PI * 2 - Math.PI;
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py + r * .85, r, r * .45, 0, 0, 7); ctx.fill();
  // riding: draw the vehicle big underneath and sit the player on top of it
  if (p.veh && G.shop) { ctx.save(); ctx.translate(px, py + r * .45); if (Math.cos(ang) > 0) ctx.scale(-1, 1); ctx.font = `${Math.round(TS * .95)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(G.shop.vehicles[p.veh].icon, 0, 0); ctx.restore(); py -= r * .55; }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, p.veh ? r * .82 : r, 0, 7); ctx.fill();
  ctx.lineWidth = p.id === myId ? 3 : 2; ctx.strokeStyle = p.id === myId ? '#fff' : 'rgba(0,0,0,.45)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px + Math.cos(ang) * r * .5, py + Math.sin(ang) * r * .5, r * .3, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(px + Math.cos(ang) * r * .62, py + Math.sin(ang) * r * .62, r * .13, 0, 7); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const mine = p.id === myId;
  sign(`${CAREER_ICON(p.c)} ${p.name}`, px, py - r - TS * .3, { size: TS * .27, bg: mine ? 'rgba(255,201,77,.95)' : 'rgba(18,22,28,.78)', color: mine ? '#222' : '#fff' });
  ctx.textBaseline = 'alphabetic';
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
    FX.play('click');
    const m = JSON.parse(b.dataset.m);
    if (m.fn) return FN[m.fn](m, root);
    send(m);
  });
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; };
  const af = root.querySelector('#ansForm'); if (af) af.onsubmit = e => { e.preventDefault(); FN.ans({ st: panel.st }, root); };
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  bank(m, root) { const v = m.all ? m.all : +root.querySelector('#bankAmt').value || 0; send({ t: 'act', st: m.st, a: m.op, amt: v }); },
  guide(m) { closePanel(); setGuide(m.key); },
  tut() { closePanel(); showTut(0); },
  map() { closePanel(); openMap(); },
  ans(m, root) { const v = root.querySelector('#ansIn').value.trim(); if (v === '') return; doAct(m.st, 'submit', { ans: v }); root.querySelector('#ansIn').value = ''; },
  logout() { localStorage.removeItem('lt_creds'); wantLogin = false; location.reload(); },
  toggle(m) { FX.setOpt(m.k, !FX.opts[m.k]); paintMute(); refreshPanel(true); },
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
      const l = Math.min(me.lv, G.titles.length), pay = 450 + 100 * (l - 1);
      return `<h2>🏢 บริษัท ไทยเทค</h2><div class="sub">ตำแหน่ง: <b>${G.titles[l - 1]}</b> · ทำงานต่อเนื่องเพื่อเลื่อนขั้น · เงินเดือนต่อกะ ~${money(pay)}</div>${needCareer('office')}
        ${B(`💼 ทำงาน (⚡15) ~${money(pay)}`, { t: 'act', st, a: 'work' }, 'primary big')}${B(`🌙 ทำโอที x2.6 (⚡30, เสียสุขภาพ)`, { t: 'act', st, a: 'ot' }, 'big')}`;
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
        itemRow(id, `<div>${B('ซื้อ 1', { t: 'act', st, a: 'buy', item: id, qty: 1 })}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 })}${B('x10', { t: 'act', st, a: 'buy', item: id, qty: 10 })}</div>`,
          `ราคาส่ง ${money(it.wholesale)} · ราคาตลาด ~${money(it.base)} · สต็อกเหลือ ${wd?.stock[id] ?? '-'}`)).join('');
      return `<h2>📦 คลังสินค้าราคาส่ง</h2><div class="sub">สต็อกมีจำกัดและทุกคนแย่งกัน ทุกครั้งที่ซื้อเสีย ⚡4 (ซื้อได้ครั้งละไม่เกิน 10) ซื้อไปขายให้ผู้เล่นที่ต้องการ (กดคนในแมพ → แลกเปลี่ยน) หรือขายตลาดกลาง</div>${needCareer('merchant')}<div class="list">${rows}</div>`;
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
      const ingIds = [...new Set(G.recipes.flatMap(r => Object.keys(r.in)))];
      const buys = ingIds.map(i => { const it = G.items[i], p = Math.ceil(it.base * 1.8); return itemRowRaw(it.icon, esc(it.name), `มี ${me.inv[i] || 0} · ร้านขาย ${money(p)}/หน่วย (แพงกว่าซื้อจากผู้เล่น ~80%)`, `<div>${B('ซื้อ 1', { t: 'act', st, a: 'buy', item: i, qty: 1 })}${B('x5', { t: 'act', st, a: 'buy', item: i, qty: 5 })}</div>`); }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">ปรุงอาหารขายได้แพงกว่าวัตถุดิบ ~3 เท่า · วัตถุดิบถูกที่สุดคือซื้อจากชาวไร่/ชาวประมง (แตะตัวเขาในแมพ → แลกเปลี่ยน) ถ้าไม่มีใครขาย ซื้อจากร้านได้</div>${needCareer('chef')}<div class="list">${rows}</div>
        <div class="sub" style="margin-top:14px"><b>🛒 ซื้อวัตถุดิบจากร้าน</b></div><div class="list">${buys}</div>`;
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
      return `<h2>🏠 บ้านพัก</h2><div class="sub">พลังงาน ${Math.floor(me.energy)}/100</div>${B('😴 งีบหลับ (ฟรี, +25⚡, คูลดาวน์ 90 วิ)', { t: 'act', st, a: 'rest' }, 'big')}${B('🛏️ นอนห้องพัก ฿400 (+40⚡ +10❤️, คูลดาวน์ 60 วิ)', { t: 'act', st, a: 'inn' }, 'big')}`;
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
      const veh = (me.vehicles || []).map(v => G.shop.vehicles[v].icon).join(' ') || '—';
      const tools = Object.entries(me.tools || {}).map(([c, t]) => `${G.shop.tools[c].icon}${'★'.repeat(t)}`).join(' ') || '—';
      const own = `<div class="grid2" style="margin:6px 0"><div class="item"><div class="nm">🚗 ยานพาหนะ<small>${veh}</small></div></div><div class="item"><div class="nm">🛠️ อุปกรณ์<small>${tools}</small></div></div><div class="item"><div class="nm">🏠 บ้าน<small>${me.house >= 0 ? `มีแล้ว ⭐${me.comfort}` : 'ยังไม่มี'}</small></div>${me.house >= 0 ? B('📍', { fn: 'guide', key: 'house' + me.house }) : ''}</div><div class="item"><div class="nm">🏦 ธนาคาร<small>${money(me.bank)}${me.loan ? ` · หนี้ ${money(me.loan)}` : ''}</small></div></div></div>`;
      return `<h2>🎒 กระเป๋า</h2><div class="sub">ใบรับรอง: ${lic} · ทรัพย์สินรวม ${money(me.worth)} · รายได้สะสม ${money(me.earned)}</div>${own}<div class="list">${rows || '<div class="sub">ยังไม่มีของ — ปลูก ตกปลา ปรุงอาหาร หรือแลกเปลี่ยนกับผู้เล่นอื่น</div>'}</div>`;
    }
    case 'career': {
      const rows = Object.entries(G.careers).map(([id, c]) => {
        const locked = c.license && !me.licenses.includes(c.license);
        return itemRowRaw(c.icon, `${c.name}${me.career === id ? ' <span class="tag">ปัจจุบัน</span>' : ''}`, locked ? `🔒 ต้องมี ${G.licenses[c.license].name} (โรงเรียน)` : c.desc,
          B(me.career === id ? 'อาชีพนี้' : 'เลือก', { t: 'career', career: id }, me.career === id ? '' : 'good', me.career === id || locked));
      }).join('');
      return `<h2>💼 เลือกอาชีพ</h2><div class="sub">เปลี่ยนได้ทุกเมื่อ ฟรี (เลเวลของแต่ละอาชีพเก็บไว้แยกกัน)</div><div class="list">${rows}</div>`;
    }
    case 'toolshop': {
      const order = [me.career, ...Object.keys(G.shop.tools).filter(c => c !== me.career)];
      const rows = order.map(c => {
        const d = G.shop.tools[c], t = (me.tools || {})[c] || 0, cc = G.careers[c];
        const stars = '★'.repeat(t) + '☆'.repeat(3 - t);
        const sub = t >= 3 ? `สูงสุดแล้ว · ${d.fx[2]}` : `ถัดไป: ${d.fx[t]}${t ? ` · ตอนนี้: ${d.fx[t - 1]}` : ''}`;
        return itemRowRaw(d.icon, `${d.name} <span class="tag">${cc.icon} ${cc.name}</span> <span style="color:var(--acc)">${stars}</span>`, sub,
          t >= 3 ? '<span class="tag">MAX</span>' : B(money(G.shop.toolPrices[t]), { t: 'act', st, a: 'buy', career: c }, c === me.career ? 'good' : ''));
      }).join('');
      return `<h2>🛠️ ร้านอุปกรณ์</h2><div class="sub">อัปเกรดอุปกรณ์ให้อาชีพหาเงินได้มากขึ้น (มีผลตอนทำอาชีพนั้น) · อัปได้ 3 ระดับ</div><div class="list">${rows}</div>`;
    }
    case 'dealer': {
      const best = Object.entries(G.shop.vehicles).filter(([k]) => (me.vehicles || []).includes(k)).sort((a, b) => b[1].speed - a[1].speed)[0]?.[0];
      const rows = Object.entries(G.shop.vehicles).map(([k, v]) => {
        const has = (me.vehicles || []).includes(k);
        return itemRowRaw(v.icon, `${v.name}${best === k ? ' <span class="tag">กำลังใช้</span>' : ''}`, `เดินเร็วขึ้น x${v.speed}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(v.price), { t: 'act', st, a: 'buy', veh: k }, 'good'));
      }).join('');
      return `<h2>🚗 โชว์รูมรถ</h2><div class="sub">ยานพาหนะทำให้เดินทางเร็วขึ้น ไปทำงาน ไปขายของ ไปหาเพื่อนได้ไวขึ้น · ใช้คันที่เร็วที่สุดที่มีอัตโนมัติ · ทุกคนเห็นคุณขี่</div><div class="list">${rows}</div>`;
    }
    case 'bank': {
      const bk = G.shop.bank;
      return `<h2>🏦 ธนาคาร</h2><div class="sub">ฝากเงินได้ดอกเบี้ย <b>${bk.rate * 100}% ต่อวัน</b> (คิดดอกบนยอดไม่เกิน ${money(bk.cap)}) · เงินในธนาคาร<b>ไม่หายตอนเป็นลม</b></div>
        <div class="grid2"><div class="item"><div class="nm">💵 เงินสด<small><b style="color:var(--acc);font-size:16px">${money(me.money)}</b></small></div></div><div class="item"><div class="nm">🏦 เงินฝาก<small><b style="color:var(--ok);font-size:16px">${money(me.bank)}</b></small></div></div></div>
        <div class="rowf" style="margin-top:10px"><input id="bankAmt" type="number" min="1" value="1000" inputmode="numeric"></div>
        <div class="grid2" style="margin-top:8px">${B('⬇️ ฝาก', { fn: 'bank', st, op: 'deposit' }, 'good')}${B('⬆️ ถอน', { fn: 'bank', st, op: 'withdraw' })}${B('ฝากทั้งหมด', { fn: 'bank', st, op: 'deposit', all: Math.floor(me.money) })}${B('ถอนทั้งหมด', { fn: 'bank', st, op: 'withdraw', all: me.bank })}</div>
        <div class="sub" style="margin-top:14px"><b>💳 กู้เงิน</b> · กู้ได้สูงสุด ${money(bk.loanMax)} ค่าธรรมเนียม ${bk.loanFee * 100}% · ระหว่างเป็นหนี้ ${bk.repayShare * 100}% ของรายได้จะถูกหักใช้หนี้อัตโนมัติ</div>
        <div class="item"><div class="nm">หนี้คงเหลือ<small><b style="color:${me.loan ? 'var(--bad)' : 'var(--ok)'};font-size:16px">${money(me.loan)}</b></small></div>${B('กู้ (ตามจำนวนในช่อง)', { fn: 'bank', st, op: 'borrow' })}${B('ใช้คืน', { fn: 'bank', st, op: 'repay' }, me.loan ? 'good' : '', !me.loan)}</div>`;
    }
    case 'house': {
      const s = STN(st), h = wd?.houses?.[s.idx], price = G.shop.housePrices[s.idx];
      if (!h) return `<h2>🏷️ บ้านว่าง ประกาศขาย</h2><div class="sub">ในเมืองมีบ้านแค่ 6 หลัง ใครซื้อก่อนได้ก่อน!</div>
        <div class="list">${itemRowRaw('😴', 'นอนฟรีที่บ้าน', 'พลังงาน +40 (และมากขึ้นตามความสบาย) ทุก 60 วิ', '')}${itemRowRaw('🛋️', 'แต่งบ้าน', 'เฟอร์นิเจอร์เพิ่มความสบาย → พลังงานฟื้นเร็วขึ้นตลอดเวลา', '')}${itemRowRaw('🪧', 'ชื่อคุณบนบ้าน', 'ทุกคนในเมืองเห็นว่าบ้านหลังนี้เป็นของใคร', '')}</div>
        ${me.house >= 0 ? '<div class="sub" style="color:var(--bad)">คุณมีบ้านแล้ว ต้องขายหลังเดิมก่อน</div>' : ''}${B(`🏠 ซื้อบ้าน ${money(price)}`, { t: 'act', st, a: 'buy' }, 'primary big', me.house >= 0)}`;
      const [owner, cf, , furn] = h, mine = me.house === s.idx;
      if (!mine) return `<h2>🏠 บ้านของ ${esc(owner)}</h2><div class="sub">ความสบาย ⭐ ${cf}</div><div style="font-size:30px;letter-spacing:4px">${furn.map(k => G.shop.furniture[k].icon).join('') || '— ยังไม่ได้แต่งบ้าน —'}</div>`;
      const rows = Object.entries(G.shop.furniture).map(([k, f]) => itemRowRaw(f.icon, f.name, `ความสบาย +${f.comfort}`, me.furniture.includes(k) ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'furnish', item: k }, 'good'))).join('');
      return `<h2>🏠 บ้านของคุณ</h2><div class="sub">ความสบาย ⭐ <b>${me.comfort}</b> → พลังงานฟื้นเร็วขึ้น <b>+${me.comfort * 3}%</b> ตลอดเวลา · นอนที่บ้านได้ +${40 + me.comfort * 2}⚡</div>
        ${B(`😴 นอนพัก (+${40 + me.comfort * 2}⚡, ทุก 60 วิ)`, { t: 'act', st, a: 'sleep' }, 'primary big')}
        <div class="sub" style="margin-top:12px"><b>🛋️ แต่งบ้าน</b></div><div class="list">${rows}</div>
        <div style="margin-top:14px">${B(`ขายบ้าน (ได้คืน ~70%)`, { t: 'act', st, a: 'sell' }, 'warn')}</div>`;
    }
    case 'quests': {
      const q = me.quests; if (!q) return '';
      const rows = q.list.map((x, i) => {
        const c = x.career ? G.careers[x.career] : null, wrong = c && me.career !== x.career;
        const icon = x.done ? '✅' : c ? c.icon : { trade: '🤝', chat: '💬', eat: '🍛', sell: '🏪', earn: '💰' }[x.type] || '📜';
        const tgt = x.type === 'earn' ? CAREER_TARGET[me.career] : QUEST_TARGET[x.type];
        const btn = x.done ? '<span class="tag">สำเร็จ</span>' : `<div style="display:flex;flex-direction:column;gap:4px">${tgt ? B('📍 ไป', { fn: 'guide', key: tgt }, 'good') : ''}${B('🔄', { t: 'quest_reroll', i }, '', q.rerolled)}</div>`;
        return `<div class="item ${x.done ? 'done' : ''}"><div class="em">${icon}</div><div class="nm">${esc(x.text)}<small>${x.p.toLocaleString()}/${x.n.toLocaleString()} · รางวัล <b style="color:var(--acc)">${money(x.reward)}</b>${wrong ? ` · ต้องเป็น${c.name}` : ''}</small><div class="qbar"><i style="width:${Math.round(x.p / x.n * 100)}%"></i></div></div>${btn}</div>`;
      }).join('');
      return `<h2>📜 เควสต์ประจำวัน</h2><div class="sub">เควสต์ใหม่ในอีก <b class="qcd" data-t="${q.resetAt}"></b> (เที่ยงคืนเวลาไทย) · ทำสำเร็จได้รางวัลทันที${q.streak ? ` · 🔥 ทำครบติดต่อกัน ${q.streak} วัน` : ''}</div>
        <div class="list">${rows}</div>
        <div class="item ${q.bonus ? 'done' : ''}" style="margin-top:10px"><div class="em">🏆</div><div class="nm">ทำครบทั้ง 3 ข้อ<small>โบนัส <b style="color:var(--acc)">${money(q.bonusAmount)}</b> · ทำครบติดต่อกันทุกวัน โบนัส +10%/วัน (สูงสุด +50%)</small></div>${q.bonus ? '<span class="tag">ได้แล้ว</span>' : ''}</div>
        <div class="sub" style="margin-top:8px">🔄 เปลี่ยนเควสต์ได้วันละ 1 ข้อ${q.rerolled ? ' (วันนี้ใช้ไปแล้ว)' : ''} · เควสต์อาชีพจะตามอาชีพที่เป็นอยู่ตอนเปลี่ยน</div>`;
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
        <div class="sub" style="margin-top:12px"><b>🔊 ตั้งค่าเสียง</b></div>
        <div class="grid2">${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'good' : '')}${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🎵 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'good' : '')}</div>
        <div class="grid2" style="margin-top:8px">${B('📖 ดูบทช่วยสอน', { fn: 'tut' })}${B('🗺️ เปิดแผนที่', { fn: 'map' })}</div>
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

// ------------------------------------------------------------------ map readability: signs, buildings, zones, navigation
const nightLevel = () => clamp((0.2 - Math.cos((phaseNow() - 0.5) * Math.PI * 2)) / 1.2, 0, 0.55);
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  return `rgb(${Math.round((t - r) * p + r)},${Math.round((t - g) * p + g)},${Math.round((t - b) * p + b)})`;
}
function sign(text, x, y, o = {}) {
  const fs = Math.max(10, Math.round(o.size || TS * .36));
  ctx.font = `700 ${fs}px 'Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fs * .9, h = fs * 1.55;
  ctx.fillStyle = o.bg || 'rgba(18,22,28,.88)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = o.color || '#fff'; ctx.fillText(text, x, y + fs * .04);
}
const STN = id => G.stations.find(s => s.id === id);
function houseLook(b) {
  const h = wd?.houses?.[b.house];
  if (!h) return { ...b, color: '#8f9499', label: `🏷️ ขาย ${money(G.shop.housePrices[b.house])}`, forSale: true };
  return { ...b, color: COLORS[h[2]] || b.color, label: `🏠 ${h[0]}`, stars: h[1], mine: me && me.house === b.house };
}
function drawBuilding(b, X, Y, night) {
  if (b.house !== undefined) b = houseLook(b);
  const px = b.x * TS + X, py = b.y * TS + Y, w = b.w * TS, h = b.h * TS;
  if (px > VW + 40 || py > VH + 40 || px + w < -40 || py + h < -40) return;
  const st = b.st && STN(b.st), south = st ? st.y > b.y + b.h / 2 : true;
  const fh = Math.min(h * .36, TS * 1.5), rh = h - fh;
  const roofY = south ? py : py + fh, faY = south ? py + rh : py;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(px + 6, py + 8, w, h);
  // front wall with windows and a door facing the street
  ctx.fillStyle = shade(b.color, -.4); ctx.fillRect(px, faY, w, fh);
  const doorX = st ? st.x * TS + X : -1e9;
  ctx.fillStyle = night > .15 ? '#ffd97a' : 'rgba(190,225,255,.85)';
  for (let wx = px + TS * .35; wx + TS * .5 < px + w - TS * .2; wx += TS * .95)
    if (Math.abs(wx + TS * .25 - doorX) > TS * .8) ctx.fillRect(wx, faY + fh * .25, TS * .5, fh * .4);
  if (st) {
    const dw = TS * .9, dh = fh * .75, dy = south ? faY + fh - dh : faY;
    ctx.fillStyle = '#4a3324'; ctx.fillRect(doorX - dw / 2, dy, dw, dh);
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(doorX + dw * .28, dy + dh / 2, Math.max(2, TS * .05), 0, 7); ctx.fill();
  }
  // roof
  ctx.fillStyle = b.color; ctx.fillRect(px, roofY, w, rh);
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(px, roofY, w, rh * .5);
  ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(px, roofY + rh * .5 - 1.5, w, 3);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  const cx = px + w / 2, cy = roofY + rh / 2;
  if (b.house !== undefined) {
    sign(b.label, cx, cy - (b.stars ? TS * .2 : 0), { size: TS * .3, bg: b.mine ? 'rgba(255,201,77,.95)' : b.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.88)', color: b.mine ? '#222' : '#fff' });
    if (b.stars) sign(`⭐ ${b.stars}`, cx, cy + TS * .32, { size: TS * .24 });
    return;
  }
  if (b.deco) { ctx.globalAlpha = .55; sign(`${b.icon} ${b.label}`, cx, cy, { size: TS * .3 }); ctx.globalAlpha = 1; return; }
  // icon badge + name sign so every place is recognisable from afar
  ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(cx, cy - TS * .42, TS * .6, 0, 7); ctx.fill();
  ctx.strokeStyle = shade(b.color, -.3); ctx.lineWidth = 3; ctx.stroke();
  ctx.font = `${Math.round(TS * .78)}px serif`; ctx.fillStyle = '#000'; ctx.fillText(b.icon, cx, cy - TS * .38);
  sign(b.label, cx, cy + TS * .55, { size: TS * .4, border: shade(b.color, .25) });
}
function drawZones(X, Y) {
  const fx = 2 * TS + X, fy = 2 * TS + Y, fw = 16 * TS, fhh = 10 * TS;
  ctx.strokeStyle = '#9b7748'; ctx.lineWidth = Math.max(3, TS * .09); ctx.setLineDash([TS * .55, TS * .18]);
  ctx.strokeRect(fx, fy, fw, fhh); ctx.setLineDash([]);
  sign('🌾 ไร่กลางเมือง', fx + fw / 2, fy + fhh, { size: TS * .42, bg: 'rgba(74,52,26,.94)' });
  sign('🎣 ท่าเรือตกปลา', 33 * TS + X, 35.35 * TS + Y, { size: TS * .4, bg: 'rgba(26,62,88,.94)' });
}
// navigation: a yellow arrow that walks the player to a place
let guide = null;
const TARGETS = {
  farm: () => ({ x: 9, y: 7.5, label: 'ไร่กลางเมือง' }),
};
function targetOf(key) {
  if (TARGETS[key]) return TARGETS[key]();
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, id: s.id };
}
const CAREER_TARGET = { office: 'office', farmer: 'farm', fisher: 'pier1', merchant: 'warehouse', streamer: 'studio', programmer: 'cowork', chef: 'kitchen', doctor: 'hospital' };
const QUEST_TARGET = { work: 'office', harvest: 'farm', fish: 'pier1', buy: 'warehouse', stream: 'studio', code: 'cowork', cook: 'kitchen', shift: 'hospital', sell: 'market', eat: 'restaurant' };
function setGuide(key, quiet) {
  const g = targetOf(key); if (!g) return;
  guide = g;
  if (!quiet) { toast(`นำทางไป ${g.label} — เดินตามลูกศรสีเหลือง`, '📍'); FX.play('notice'); }
}
function drawGuide(X, Y, t) {
  if (!guide) return;
  const m = P.get(myId); if (!m) return;
  const dx = guide.x - m.x, dy = guide.y - m.y, d = Math.hypot(dx, dy);
  if (d < 2) { guide = null; FX.play('ding'); toast('ถึงแล้ว! กดปุ่มกลมสีเหลืองเพื่อใช้งาน', '📍'); return; }
  const a = Math.atan2(dy, dx), cx = m.rx * TS + X, cy = m.ry * TS + Y, r = TS * 1.15 + Math.sin(t / 180) * 4;
  ctx.save(); ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.rotate(a);
  ctx.fillStyle = '#ffc94d'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(TS * .42, 0); ctx.lineTo(-TS * .24, -TS * .3); ctx.lineTo(-TS * .1, 0); ctx.lineTo(-TS * .24, TS * .3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const gx = guide.x * TS + X, gy = guide.y * TS + Y;
  ctx.strokeStyle = `rgba(255,201,77,${.55 + .45 * Math.sin(t / 160)})`; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(gx, gy + TS * .15, TS * 1.2, TS * .6, 0, 0, 7); ctx.stroke();
  sign(`📍 ${guide.label} · ${Math.round(d)} ม.`, cx, cy + TS * 1.05, { size: TS * .3, bg: 'rgba(255,201,77,.95)', color: '#222' });
}

// full-screen town map: tap a place to navigate there
function openMap() {
  const v = $('#mapView'); v.classList.remove('hidden');
  const c = $('#bigMap'), W = G.map.w, H = G.map.h;
  const k = Math.min((Math.min(innerWidth, 980) - 24) / W, (innerHeight - 110) / H);
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * k * dpr; c.height = H * k * dpr; c.style.width = W * k + 'px'; c.style.height = H * k + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = { '=': '#555a63', ',': '#b7b4a6', w: '#4aa3d1', p: '#a47b50', s: '#e3d19a', f: '#7b5538', B: '#888', T: '#2f6b3a', '.': '#5e9b57' };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { g.fillStyle = col[G.map.tiles[y][x]]; g.fillRect(x * k, y * k, k + .5, k + .5); }
  const hits = [];
  const label = (text, x, y, size, bg, maxW = 1e9) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // shrink the font until the label fits inside its building
    for (; size > 8; size -= .5) { g.font = `700 ${size}px 'Noto Sans Thai',sans-serif`; if (g.measureText(text).width + size * .8 <= maxW) break; }
    const w = g.measureText(text).width + size * .8, h = size * 1.5;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = '#fff'; g.fillText(text, x, y + 1);
  };
  const fs = clamp(k * .85, 10, 15);
  for (let b of G.map.buildings) {
    g.fillStyle = b.color; g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.5; g.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
    if (b.house !== undefined) b = houseLook(b);
    const cx = (b.x + b.w / 2) * k, cy = (b.y + b.h / 2) * k;
    if (b.house !== undefined) { label(b.forSale ? '🏷️ ขาย' : b.label, cx, cy, fs * .8, b.mine ? 'rgba(200,140,20,.95)' : b.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.9)', b.w * k - 2); hits.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k, key: b.st }); continue; }
    if (b.deco) { g.globalAlpha = .6; label(b.label, cx, cy, fs * .85, 'rgba(18,22,28,.8)', b.w * k - 2); g.globalAlpha = 1; continue; }
    label(`${b.icon} ${b.label}`, cx, cy, fs, 'rgba(18,22,28,.9)', b.w * k - 2);
    hits.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k, key: b.st });
  }
  label('🌾 ไร่กลางเมือง', 10 * k, 7 * k, fs, 'rgba(74,52,26,.94)'); hits.push({ x: 2 * k, y: 2 * k, w: 16 * k, h: 10 * k, key: 'farm' });
  label('🎣 ท่าเรือ', 39 * k, 39.3 * k, fs, 'rgba(26,62,88,.94)'); hits.push({ x: 31 * k, y: 35 * k, w: 14 * k, h: 5 * k, key: 'pier1' });
  for (const p of P.values()) {
    const mine = p.id === myId;
    g.fillStyle = mine ? '#fff' : COLORS[p.av]; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p.x * k, p.y * k, mine ? k * .75 : k * .5, 0, 7); g.fill(); g.stroke();
    if (mine) label('คุณอยู่ที่นี่', p.x * k, p.y * k - fs * 1.4, fs * .85, 'rgba(255,120,60,.95)');
  }
  if (guide) { g.strokeStyle = '#ffc94d'; g.lineWidth = 3; g.beginPath(); g.arc(guide.x * k, guide.y * k, k * 1.4, 0, 7); g.stroke(); }
  c.onclick = e => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    if (h) { closeMap(); setGuide(h.key); }
  };
}
function closeMap() { $('#mapView').classList.add('hidden'); }

// first-time tutorial
const TUT = () => [
  ['👋', 'ยินดีต้อนรับสู่เมือง!', 'ตัวคุณคือวงกลมที่มีป้ายชื่อ<b>สีเหลือง</b> ผู้เล่นคนอื่นก็เดินอยู่ในเมืองเดียวกันกับคุณ'],
  ['👣', 'วิธีเดิน', 'มือถือ: <b>แตะค้างตรงไหนก็ได้แล้วลากนิ้ว</b> (จอยจะโผล่ใต้นิ้ว)<br>คอม: ปุ่ม <b>W A S D</b> หรือลูกศร'],
  ['🏪', 'ใช้สถานที่', 'ทุกตึกมี<b>ป้ายชื่อบนหลังคา</b> เดินไปที่<b>ประตู</b> (วงกลมเรืองแสง) แล้วกด<b>ปุ่มกลมสีเหลือง</b>มุมขวาล่าง (คอม: E)'],
  ['🗺️', 'หลงทาง?', 'แตะ<b>แผนที่เล็ก</b>มุมขวาบน แล้วแตะสถานที่ที่อยากไป จะมี<b>ลูกศรสีเหลือง</b>พาเดินไป'],
  ['💼', `อาชีพของคุณ: ${G.careers[me.career].icon} ${G.careers[me.career].name}`, `${G.careers[me.career].desc}<br><br>📜 ทำ<b>เควสต์ประจำวัน</b>รับเงินเพิ่ม · 🤝 <b>แตะผู้เล่นอื่น</b>เพื่อแลกเปลี่ยนของ`],
];
let tutStep = 0, tutPending = false, pendingDaily = null;
function showTut(i = 0) {
  tutStep = i; const steps = TUT(), [icon, title, body] = steps[i];
  $('#tut').classList.remove('hidden');
  $('#tutBody').innerHTML = `<div class="tutIcon">${icon}</div><h2>${esc(title)}</h2><p>${body}</p><div class="dots">${steps.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>`;
  $('#tutNext').textContent = i === steps.length - 1 ? '🚀 เริ่มเล่น! (พาไปที่ทำงาน)' : 'ถัดไป →';
}
$('#tutNext').onclick = () => { FX.play('click'); if (tutStep < TUT().length - 1) return showTut(tutStep + 1); endTut(); };
$('#tutSkip').onclick = endTut;
function endTut() {
  tutPending = false; if (pendingDaily) { const d = pendingDaily; pendingDaily = null; setTimeout(() => showDaily(d), 600); }
  $('#tut').classList.add('hidden'); try { localStorage.setItem('lt_tut', '1'); } catch { } if (me) setGuide(CAREER_TARGET[me.career]); }

// daily login bonus popup
function showDaily(d) {
  const box = $('#daily');
  box.innerHTML = `<div class="tutIcon">🎁</div><h2>โบนัสเข้าเกมวันที่ ${d.streak}</h2><p>เข้าเล่นทุกวันติดต่อกัน รางวัลจะเพิ่มขึ้นเรื่อยๆ (สูงสุดวันที่ 7)</p>
    <div class="days">${d.table.map((v, i) => `<div class="${i + 1 < Math.min(d.streak, 7) ? 'got' : i + 1 === Math.min(d.streak, 7) ? 'now' : ''}"><small>วัน ${i + 1}</small><b>฿${v.toLocaleString()}</b></div>`).join('')}</div>
    <div class="big-reward">+${money(d.reward)}</div><button class="primary big" id="dailyOk">รับเลย!</button>`;
  $('#dailyWrap').classList.remove('hidden');
  $('#dailyOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); FX.play('coin', true); const s = P.get(myId); if (s) { FX.burst(s.x, s.y, '#ffd34d', 26); FX.float(s.x, s.y - .6, '+' + money(d.reward), '#ffd34d', .6); } };
}

// ------------------------------------------------------------------ sound & effects glue
let stepAcc = 0, bobber = null;
function paintMute() { $('#muteBtn').textContent = FX.opts.sfx || FX.opts.music ? '🔊' : '🔇'; }
paintMute();
$('#muteBtn').onclick = () => { const on = !(FX.opts.sfx || FX.opts.music); FX.setOpt('sfx', on); FX.setOpt('music', on); paintMute(); if (panel?.kind === 'help') refreshPanel(true); };
function onMeDiff(a, b) {
  const s = P.get(myId); if (!s) return;
  const x = s.x, y = s.y;
  const dm = b.money - a.money;
  if (dm) { const sp = document.createElement('span'); sp.className = 'mfloat'; sp.style.color = dm > 0 ? '#ffd34d' : '#ff8a7a'; sp.textContent = (dm > 0 ? '+' : '−') + money(Math.abs(dm)); $('#card').appendChild(sp); setTimeout(() => sp.remove(), 1600); }
  if (dm > 0) { FX.play('coin', dm >= 1000); FX.float(x, y, '+' + money(dm), '#ffd34d', dm >= 1000 ? .55 : .42); if (dm >= 300) FX.burst(x, y, '#ffd34d', Math.min(24, 6 + Math.floor(dm / 200))); }
  else if (dm < 0) { FX.play('spend'); FX.float(x + .4, y, '−' + money(-dm), '#ff8a7a', .34); }
  let gained = [];
  for (const [k, q] of Object.entries(b.inv)) { const d = q - (a.inv[k] || 0); if (d > 0) gained.push(`+${d}${G.items[k].icon}`); }
  if (gained.length) { FX.play('pop'); FX.float(x - .3, y - .4, gained.join(' '), '#ffffff', .5); FX.burst(x, y, '#ffffff', 6); }
  if (b.career === a.career && b.lv > a.lv) { FX.play('levelup'); FX.ring(x, y, '#ffd34d', 900, 1.6); FX.ring(x, y, '#ffffff', 700, 1.1); FX.float(x, y - .6, `LEVEL UP! Lv.${b.lv}`, '#ffd34d', .55); FX.burst(x, y, '#ffd34d', 20); }
  if (a.energy < 99.5 && b.energy >= 100) toast('พลังงานเต็มแล้ว! ไปทำงานต่อได้เลย', '⚡');
  if (a.career !== b.career) setTimeout(() => setGuide(CAREER_TARGET[b.career]), 300);
  if (b.energy - a.energy >= 8) FX.float(x + .5, y + .2, `+${Math.round(b.energy - a.energy)}⚡`, '#f2c94c', .34);
  if (b.health - a.health >= 8) { FX.float(x - .5, y + .2, `+${Math.round(b.health - a.health)}❤️`, '#ff8a8a', .34); FX.ring(x, y, '#8fe3a6', 700, 1); }
  if (b.hunger - a.hunger >= 8) FX.float(x, y + .4, `+${Math.round(b.hunger - a.hunger)}🍗`, '#8fe3a6', .34);
  if (!a.cast && b.cast) { bobber = findWater(s.x, s.y); FX.play('whoosh'); if (bobber) setTimeout(() => { FX.play('splash'); FX.ring(bobber.x, bobber.y, '#fff', 800, 1); }, 250); }
  if (!b.cast) bobber = null;
}
const ICON_SFX = { '🍳': 'sizzle', '🍛': 'munch', '🍲': 'munch', '😴': 'sleep', '🛏️': 'sleep', '🏥': 'heal', '💉': 'heal', '🎓': 'levelup', '🌱': 'pop', '📦': 'pop', '🎥': 'notice', '🔥': 'levelup' };
function toastSfx(m) {
  if (!m.ok) return FX.play('fail');
  if (ICON_SFX[m.icon]) FX.play(ICON_SFX[m.icon]);
  if (m.icon === '🔥') { const s = P.get(myId); if (s) { FX.burst(s.x, s.y, '#ff7a3d', 24); FX.ring(s.x, s.y, '#ff7a3d', 900, 1.8); } }
}
function findWater(x, y) {
  for (let d = 1; d <= 3; d++) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const tx = Math.floor(x + dx * d), ty = Math.floor(y + dy * d);
    if (tileAt(tx, ty) === 'w') return { x: tx + .5, y: ty + .5 };
  }
  return null;
}
function drawBobber(X, Y, t) {
  if (!bobber || !me?.cast) return;
  const s = P.get(myId); if (!s) return;
  const bite = me.cast.state === 'bite';
  const bx = bobber.x * TS + X + (bite ? Math.sin(t / 30) * 3 : 0), by = bobber.y * TS + Y + (bite ? Math.sin(t / 45) * 4 + 4 : Math.sin(t / 400) * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(s.rx * TS + X, s.ry * TS + Y - TS * .2); ctx.quadraticCurveTo((s.rx * TS + X + bx) / 2, Math.min(s.ry * TS + Y, by) - TS * .6, bx, by); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, TS * .12, 0, 7); ctx.fill();
  ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.arc(bx, by, TS * .12, Math.PI, 0); ctx.fill();
  if (bite && Math.random() < .08) FX.ring(bobber.x, bobber.y, '#fff', 500, .6);
}

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
