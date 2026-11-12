'use strict';
(() => {
const $ = s => document.querySelector(s);
const COLORS = ['#ef6a5b', '#f2a541', '#f2d14b', '#7ac96b', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const DAY_MS = 8 * 60 * 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '฿' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
let ws, G = null, lastHouses = '';                       // G = static init data
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
      G = m; myId = m.id; P.clear(); buildRooms(); buildMini();
      localStorage.setItem('lt_creds', JSON.stringify(creds));
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden');
      chatLog.length = 0; m.chat.forEach(c => chatLog.push(c));
      let tutDone = false; try { tutDone = !!localStorage.getItem('lt_tut'); } catch { }
      tutPending = !!(m.isNew || !tutDone);
      if (tutPending) setTimeout(() => me && showTut(0), 400);
      break;
    case 'me': { const prev = me; me = m; $('#meName').textContent = m.name; paintHud(); refreshPanel(); if (prev && prev.id === m.id) onMeDiff(prev, m); break; }
    case 'wd': { const hs = JSON.stringify(m.houses); wd = m; clockOff = m.now - Date.now(); paintEvent(); refreshPanel(); if (G && hs !== lastHouses) { lastHouses = hs; layoutFurniture(); } break; }
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, fol: p.fol, lv: p.lv, veh: p.veh, dz: p.dz || [], bed: p.bed });
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { if (Math.hypot(x - s.x, y - s.y) > 4) { s.rx = x; s.ry = y; } s.x = x; s.y = y; s.f = f; } } break;
    case 'fix': { const s = P.get(myId); if (s) { s.x = s.rx = m.x; s.y = s.ry = m.y; } if (m.tp) { closePanel(); FX.play('whoosh'); holdAfterTp = true; } break; }
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
  const chips = (me.dz || []).map(d => `<span class="chip bad" data-dz="${d}">${G.diseases[d].icon} ${G.diseases[d].name}</span>`);
  if (me.awake > 20 * 60 && !(me.dz || []).includes('insomnia')) chips.push('<span class="chip warnc" data-dz="_sleepy">🥱 เริ่มง่วง ควรไปนอน</span>');
  if (me.hunger < 20) chips.push('<span class="chip warnc" data-dz="_hungry">🍗 หิวมาก</span>');
  const dzBox = $('#dzChips'); const html = chips.join('');
  if (dzBox.dataset.h !== html) { dzBox.dataset.h = html; dzBox.innerHTML = html; dzBox.querySelectorAll('[data-dz]').forEach(c => c.onclick = () => dzInfo(c.dataset.dz)); }
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
const SOLID = 'wBTo';
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
  const m = P.get(myId); let x = m ? m.rx : 30, y = m ? m.ry : 20;
  // when a bottom sheet is open, lift the view so your character stays visible above it
  const target = panel && !trade ? VH * 0.24 : 0;
  camLift += (target - camLift) * 0.18;
  // inside a building: frame the room (centre it if it fits, otherwise follow but stay inside it)
  const r = m && G?.rooms ? roomOf(m.x, m.y) : null;
  if (r) {
    const fit = (pos, lo, size, view) => size * TS + TS * 2 <= view ? lo + size / 2 : clamp(pos, lo + view / TS / 2 - 1, lo + size - view / TS / 2 + 1.5);
    x = fit(x, r.x, r.w, VW); y = fit(y, r.y - .6, r.h + 1.2, VH - camLift * 2);
  }
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
  if (near.type === 'door') return send({ t: 'enter', st: near.id });
  if (near.type === 'exit') return send({ t: 'exit' });
  if (panel?.st === near.id) { closePanel(); return; }
  openPanel({ kind: near.type, st: near.id });
}
$('#actBtn').onclick = onAction;

// ------------------------------------------------------------------ main loop
let last = performance.now(), sendT = 0, lastSent = '', holdAfterTp = false, meMoving = false;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (!G || !me) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#14181d'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const m = P.get(myId);
  if (m) {
    let dx = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    let dy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
    if (joy && Math.hypot(joy.dx, joy.dy) > 0.15) { dx = joy.dx; dy = joy.dy; }
    // after going through a door, wait until the stick/keys are released so you don't walk straight back out
    if (holdAfterTp) { if (!dx && !dy && !joy) holdAfterTp = false; else { dx = 0; dy = 0; } }
    const l = Math.hypot(dx, dy); meMoving = false;
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      const sp = G.speed * (me.speed || 1) * dt;
      let nx = m.x + dx * sp; if (!blockedAt(nx, m.y)) m.x = nx;
      let ny = m.y + dy * sp; if (!blockedAt(m.x, ny)) m.y = ny;
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8; meMoving = true;
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
  autoDoor();
  const ab = $('#actBtn');
  if (near) { ab.classList.remove('hidden'); $('#actIcon').textContent = near.icon; $('#actLabel').textContent = near.type === 'plot' ? 'แปลงเกษตร' : near.type === 'door' ? 'เข้า ' + near.label : near.label; }
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
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, VW, VH);
  const meP = P.get(myId), myRoom = meP ? roomOf(meP.x, meP.y) : null;
  let x0 = Math.max(0, Math.floor(c.x / TS)), y0 = Math.max(0, Math.floor(c.y / TS));
  let x1 = Math.min(G.map.w - 1, Math.ceil((c.x + VW) / TS)), y1 = Math.min(G.map.h - 1, Math.ceil((c.y + VH) / TS));
  if (myRoom) { x0 = Math.max(x0, myRoom.x); y0 = Math.max(y0, myRoom.y); x1 = Math.min(x1, myRoom.x + myRoom.w - 1); y1 = Math.min(y1, myRoom.y + myRoom.h - 1); }
  const inside = (x, y) => !myRoom || (x >= myRoom.x && x <= myRoom.x + myRoom.w && y >= myRoom.y && y <= myRoom.y + myRoom.h + .5);
  const tm = t / 1000;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(G.map.tiles[ty][tx], tx, ty, tx * TS + X, ty * TS + Y, tm);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const night = nightLevel();
  // ground-level markers: farm plots and glowing door mats
  for (const s of G.stations) {
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -80 || py < -80 || px > VW + 80 || py > VH + 80) continue;
    if (s.type === 'plot') { drawPlot(s, px, py, t); continue; }
    const isNear = near && near.id === s.id;
    if (isNear) { ctx.fillStyle = 'rgba(255,201,77,.35)'; ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, py, TS * .85, TS * .4, 0, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  // everything that stands up is drawn back-to-front so you can walk behind it
  const ents = [];
  const vis = (x, y, r = 8) => inside(x, y) && x * TS + X > -r * TS && x * TS + X < VW + r * TS && y * TS + Y > -2 * TS && y * TS + Y < VH + r * TS;
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) ents.push([b.y + b.h, 0, b]);
  for (const p of G.props) if (vis(p.x, p.y, 4)) ents.push([p.y, 1, p]);
  for (const tr of G.trees) if (vis(tr[0] + .5, tr[1] + 1, 4)) ents.push([tr[1] + .95, 2, tr]);
  for (const f of roomFurniture) if (vis(f[1], f[2], 4)) ents.push([f[2], 3, f]);
  for (const p of P.values()) if (vis(p.rx, p.ry, 3)) ents.push([p.ry + .3, 4, p]);
  ents.sort((a, b) => a[0] - b[0]);
  for (const [, k, e] of ents) {
    if (k === 0) drawBuildingSprite(e, X, Y, night);
    else if (k === 1) spr(e.s, e.x, e.y, X, Y);
    else if (k === 2) spr(e[2], e[0] + .5, e[1] + 1.05, X, Y);
    else if (k === 3) spr(e[0], e[1], e[2], X, Y);
    else drawPlayer(e, X, Y, t);
  }
  // signs and floating station icons on top
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) drawBuildingSign(b, X, Y);
  for (const s of G.stations) {
    if (s.type === 'plot' || s.type === 'house' || !inside(s.x, s.y)) continue;
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -60 || py < -60 || px > VW + 60 || py > VH + 60) continue;
    const isNear = near && near.id === s.id;
    if (/^(door|exit|bed|hbed)$/.test(s.type) && !isNear) continue;
    if (s.type === 'exit') continue;
    ctx.font = `${Math.round(TS * (isNear ? .7 : .55))}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(s.type === 'door' ? '🚪' : s.icon, px, py - TS * 1.7 + Math.sin(t / 380 + s.x) * 3);
  }
  drawBobber(X, Y, t);
  FX.draw(ctx, X, Y, TS);
  drawGuide(X, Y, t);
  if (myRoom) drawRoomLabels(myRoom, X, Y, t);
  if (!myRoom) drawRain(t);
  const dark = myRoom ? 0 : night;
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); drawLights(X, Y, dark); }
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
const SKIN = ['#f3cfa6', '#e2b084', '#c98f60', '#8f5c3c'], HAIR = ['#2b1d14', '#5a3a22', '#b8692a', '#e5c15a', '#1c1c30', '#6d3b8f', '#c9473f', '#ececec'];
function drawPlayer(p, X, Y, t) {
  const px = p.rx * TS + X; let py = p.ry * TS + Y + TS * .32;
  if (px < -80 || py < -120 || px > VW + 80 || py > VH + 120) return;
  const u = TS / 16, id = p.id || 1, skin = SKIN[id % 4], hair = HAIR[(id * 3 + p.av) % HAIR.length];
  const shirt = COLORS[p.av] || '#999', pants = shade(shirt, -.55), dark = '#1d1a22';
  // facing from the 8-way index: 0=left, 2=up, 4=right, 6=down
  const ang = (p.f / 8) * Math.PI * 2 - Math.PI, cx = Math.cos(ang), cy = Math.sin(ang);
  const dir = Math.abs(cy) > Math.abs(cx) ? (cy > 0 ? 'down' : 'up') : (cx > 0 ? 'right' : 'left');
  const moving = p.id === myId ? meMoving : Math.hypot(p.x - p.rx, p.y - p.ry) > .02;
  p.walk = (p.walk || 0) + (moving ? .25 : 0);
  const sw = moving ? Math.sin(p.walk) : 0, bob = moving ? Math.abs(Math.cos(p.walk)) * u * .8 : 0;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(px, py, u * 5.5, u * 2, 0, 0, 7); ctx.fill();
  if (p.veh && G.shop && !roomOf(p.x, p.y)) {
    if (p.veh === 'car') { spr('car_blue', p.rx, p.ry + .55, X, Y, 1.05); py -= u * 4; }
    else { ctx.save(); ctx.translate(px, py - u * 2); if (dir === 'right') ctx.scale(-1, 1); ctx.font = `${Math.round(TS * .9)}px serif`; ctx.fillText(G.shop.vehicles[p.veh].icon, 0, 0); ctx.restore(); py -= u * 3; }
  }
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(px + (x - 6) * u), Math.round(py + (y - 22) * u - bob), Math.ceil(w * u), Math.ceil(h * u)); };
  const L = sw * 2, Rr = -sw * 2;
  // outline silhouette
  R(1.4, 0.4, 9.2, 8, dark); R(1.4, 7.6, 9.2, 8, dark); R(0.4, 8.6, 11.2, 6, dark);
  R(2.4, 14.6, 3.2, 6.8 + Math.min(0, L) * .5, dark); R(6.4, 14.6, 3.2, 6.8 + Math.min(0, Rr) * .5, dark);
  // legs + shoes
  R(3, 15, 2, 5 - Math.max(0, -L) * .4, pants); R(7, 15, 2, 5 - Math.max(0, -Rr) * .4, pants);
  R(2.8, 20 - Math.max(0, -L) * .4, 2.4, 1.2, '#3a2a20'); R(6.8, 20 - Math.max(0, -Rr) * .4, 2.4, 1.2, '#3a2a20');
  // body + arms
  R(2, 8, 8, 7, shirt); R(2, 8, 8, 1, shade(shirt, .25));
  const armY = 9 + (dir === 'left' || dir === 'right' ? sw : -sw) * .8;
  if (dir !== 'left') R(1, armY, 1.4, 5, shade(shirt, -.15)); if (dir !== 'right') R(9.6, 9 - (armY - 9), 1.4, 5, shade(shirt, -.15));
  if (dir !== 'left') R(1, armY + 5, 1.4, 1.2, skin); if (dir !== 'right') R(9.6, 14 - (armY - 9), 1.4, 1.2, skin);
  // head
  R(2, 1, 8, 7, skin);
  if (dir === 'up') R(2, 1, 8, 6.2, hair);
  else {
    R(2, 1, 8, 2.4, hair); R(2, 1, 1.2, 5, hair); R(8.8, 1, 1.2, 5, hair);
    if (dir === 'down') { R(3.8, 4.4, 1.2, 1.6, dark); R(7, 4.4, 1.2, 1.6, dark); R(5.2, 6.4, 1.6, .6, '#c0605a'); }
    if (dir === 'left') { R(2, 1, 4, 3, hair); R(3.2, 4.4, 1.2, 1.6, dark); }
    if (dir === 'right') { R(6, 1, 4, 3, hair); R(7.6, 4.4, 1.2, 1.6, dark); }
  }
  const mine = p.id === myId, top = py - 23 * u - bob;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (p.bed) { ctx.font = `${Math.round(TS * .4)}px serif`; ctx.fillText('💤', px + 6 * u, top + Math.sin(t / 300) * 3); }
  sign(`${CAREER_ICON(p.c)} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,201,77,.95)' : 'rgba(18,22,28,.78)', color: mine ? '#222' : '#fff' });
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 28 ? p.bubble.slice(0, 27) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Noto Sans Thai',sans-serif`;
    const w = ctx.measureText(txt).width + 14, by = top - TS * .8;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - TS * .27, w, TS * .46, 8); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by - TS * .03);
  }
}
// minimap
let miniBase = null;
const MINI_COLORS = { '=': '#555a63', ',': '#b7b4a6', w: '#4aa3d1', p: '#a47b50', s: '#e3d19a', f: '#7b5538', B: '#c0643a', T: '#2f6b3a', '.': '#5e9b57', o: '#5e9b57', m: '#7fb04e', k: '#c98a5a' };
function buildMini() {
  const c = document.createElement('canvas'); c.width = G.tw * 2; c.height = G.map.h * 2; const g = c.getContext('2d');
  for (let y = 0; y < G.map.h; y++) for (let x = 0; x < G.tw; x++) { g.fillStyle = MINI_COLORS[G.map.tiles[y][x]] || '#5e9b57'; g.fillRect(x * 2, y * 2, 2, 2); }
  miniBase = c;
  const mini = $('#mini'); mini.width = c.width; mini.height = c.height;
}
function drawMini() {
  const g = $('#mini').getContext('2d'); g.drawImage(miniBase, 0, 0);
  for (const p of P.values()) { const q = townPos(p.rx, p.ry); g.fillStyle = p.id === myId ? '#fff' : COLORS[p.av]; const s = p.id === myId ? 5 : 3; g.fillRect(q.x * 2 - s / 2, q.y * 2 - s / 2, s, s); }
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
  enter(m) { closePanel(); send({ t: 'enter', st: m.st }); },
  mtab(m) { panel.tab = m.tab; refreshPanel(true); },
  list(m, root) { const v = Math.floor(+root.querySelector('#lp_' + m.item).value || 0); send({ t: 'act', st: m.st, a: 'list', item: m.item, qty: m.qty, price: v }); },
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
      const tab = p.tab || 'buy', mk = wd?.mk || {};
      const tabs = `<div class="tabs">${[['buy', '🛍️ ซื้อ'], ['sell', '🏷️ ขาย'], ['mine', `📋 ของที่ฉันวางขาย (${(me.listings || []).length})`]].map(([k, l]) => B(l, { fn: 'mtab', tab: k }, tab === k ? 'primary' : '')).join('')}</div>`;
      let body = '';
      if (tab === 'buy') {
        body = Object.entries(G.items).filter(([, it]) => it.base < 2000).map(([id, it]) => {
          const m2 = { ...(mk[id] || {}) };
          const own = (me.listings || []).filter(L => L.item === id).reduce((t, L) => t + L.qty, 0);
          if (own && own >= m2.n) m2.n = 0;                  // only my own listings: nothing to buy
          const pl = m2.n ? `<b style="color:var(--ok)">ผู้เล่น ${money(m2.best)}</b> (${m2.n - own} ชิ้น)` : own ? '<span style="opacity:.6">มีแต่ของที่คุณวางขายเอง</span>' : '<span style="opacity:.6">ไม่มีผู้เล่นวางขาย</span>';
          return itemRow(id, `<div style="display:flex;flex-direction:column;gap:4px">${B(m2.n ? `ซื้อ ${money(m2.best)}` : 'ไม่มีของ', { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', !m2.n)}${B(`NPC ${money(m2.sell || 0)}`, { t: 'act', st, a: 'npcbuy', item: id, qty: 1 })}</div>`, `${pl} · ร้าน NPC ${money(m2.sell || 0)}`);
        }).join('');
        body = `<div class="sub">ซื้อจากผู้เล่นถูกที่สุดก่อนเสมอ · ร้าน NPC มีของตลอดแต่<b>แพงมาก</b></div><div class="list">${body}</div>`;
      } else if (tab === 'sell') {
        const inv = Object.entries(me.inv).filter(([, q]) => q > 0);
        body = inv.map(([id, q]) => {
          const it = G.items[id], m2 = mk[id] || {}, sug = m2.n ? Math.max(1, m2.best - 1) : Math.round(it.base * 1.3);
          return itemRow(id, '', `มี ${q} · ผู้เล่นอื่นขายถูกสุด ${m2.n ? money(m2.best) : '—'} · NPC รับซื้อ ${money(m2.npc || 0)}`) +
            `<div class="rowf" style="margin:-2px 0 6px"><input id="lp_${id}" type="number" min="1" value="${sug}" style="width:96px"> <span class="sub" style="margin:0">฿/ชิ้น</span>${B('วางขาย 1', { fn: 'list', st, item: id, qty: 1 })}${B(`วางขายหมด ${q}`, { fn: 'list', st, item: id, qty: q }, 'good')}${B(`NPC ${money((m2.npc || 0) * q)}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' })}</div>`;
        }).join('');
        body = `<div class="sub">ตั้งราคาเองแล้ววางขายให้ผู้เล่นคนอื่นซื้อ (ตลาดหัก 5%) · ขายตอนออฟไลน์ก็ได้เงิน · หรือขาย NPC ทันทีราคาถูก</div>${body || '<div class="sub">ไม่มีของในกระเป๋า</div>'}`;
      } else {
        body = (me.listings || []).map(L => itemRow(L.item, B('เก็บคืน', { t: 'act', st, a: 'unlist', id: L.id }, 'warn'), `${L.qty} ชิ้น · ${money(L.price)}/ชิ้น`)).join('') || '<div class="sub">ยังไม่ได้วางขายอะไร</div>';
        body = `<div class="list">${body}</div>`;
      }
      return `<h2>🏪 ตลาดกลาง</h2>${tabs}${body}`;
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
      return `<h2>🍜 ร้านอาหาร (NPC)</h2><div class="sub">ร้าน NPC ราคาแพง · อาหารฝีมือเชฟผู้เล่นที่ตลาดกลางถูกกว่าและให้พลังงานมากกว่า · ข้าวมันไก่ข้างทางมีโอกาส🤢อาหารเป็นพิษ</div>
        <div class="list">${itemRowRaw('🍛', 'ข้าวมันไก่', 'อิ่ม +25 · เสี่ยงอาหารเป็นพิษ 4%', B('ซื้อ ฿200', { t: 'act', st, a: 'eat', kind: 'basic' }))}${itemRowRaw('🍲', 'บุฟเฟ่ต์ชาบู', 'อิ่ม +70 พลังงาน +10 · สะอาดปลอดภัย', B('ซื้อ ฿900', { t: 'act', st, a: 'eat', kind: 'buffet' }))}</div>`;
    case 'kitchen': {
      const rows = G.recipes.map(r => {
        const out = G.items[r.id]; const ok = Object.entries(r.in).every(([i, q]) => (me.inv[i] || 0) >= q);
        const ing = Object.entries(r.in).map(([i, q]) => `${G.items[i].icon}${q} (มี ${me.inv[i] || 0})`).join(' + ');
        return itemRow(r.id, B('ปรุง ⚡12', { t: 'act', st, a: 'cook', rid: r.id }, ok ? 'good' : '', !ok), `${ing} · ขาย ~${money(out.base)} · อิ่ม+${out.eat.hunger} ⚡+${out.eat.energy || 0}`);
      }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">ปรุงอาหารขายได้แพงกว่าวัตถุดิบ ~3 เท่า · ซื้อวัตถุดิบจากชาวไร่/ชาวประมงที่ <b>ตลาดกลาง</b> แล้วเอาอาหารไปวางขายที่ตลาดกลางเหมือนกัน</div>${needCareer('chef')}<div class="list">${rows}</div>
        ${B('📍 ไปตลาดกลาง', { fn: 'guide', key: 'market' })}`;
    }
    case 'hospital': {
      const dz = me.dz || [], price = dz.length ? 1500 + 500 * (dz.length - 1) : 1200, waiting = (wd?.beds || []).filter(Boolean).length;
      const mine = dz.map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, `${G.diseases[d].sym.join(' · ')}<br>${G.diseases[d].self}`, '')).join('');
      return `<h2>🏥 เคาน์เตอร์โรงพยาบาล</h2><div class="sub">สุขภาพ ${Math.floor(me.health)}/100 · <b>ทางเลือกที่ถูกกว่า:</b> ไปนอนที่ <b>เตียงคนไข้</b> (ด้านขวา) รอหมอผู้เล่นรักษา ค่ารักษาแค่ ฿600 · ตอนนี้มีคนไข้รอ ${waiting} เตียง</div>
        ${mine ? `<div class="list">${mine}</div>` : '<div class="sub">✅ ตอนนี้คุณไม่ได้ป่วย</div>'}
        ${B(`💉 ให้พยาบาล NPC รักษาทันที ${money(price)}${dz.length ? ' (หายทุกโรค)' : ' (❤️ +40)'}`, { t: 'act', st, a: 'heal' }, 'big')}
        ${me.career === 'doctor' ? `<div class="sub" style="margin-top:12px">👨‍⚕️ แพทย์: เดินไปที่เตียงที่มีคนไข้เพื่อวินิจฉัยและรักษา หรือเข้าเวรรับค่าตอบแทน</div>${B('🩺 เข้าเวร (⚡28)', { t: 'act', st, a: 'shift' }, 'primary big')}` : ''}`;
    }
    case 'bed': {
      const s = STN(st), b = wd?.beds?.[s.idx];
      if (me.career === 'doctor' && b && b[1] !== myId) {
        const [name, , sym, hp, n] = b;
        const opts = n ? Object.entries(G.treatments).map(([k, tr]) => B(`${tr.icon} ${tr.name}`, { t: 'act', st, a: 'treat', tx: k }, 'good')).join('') : B('🩺 ตรวจร่างกาย + ให้ยาบำรุง', { t: 'act', st, a: 'treat', tx: 'checkup' }, 'good');
        return `<h2>🛏️ คนไข้: ${esc(name)}</h2><div class="sub">สุขภาพ ${hp}/100 ${n > 1 ? `· ป่วย ${n} โรค (รักษาทีละโรค)` : ''}</div>
          <div class="item" style="display:block"><b>อาการที่พบ:</b><br>${sym.length ? sym.map(x => '• ' + esc(x)).join('<br>') : 'ไม่มีอาการป่วย แค่อ่อนแรง'}</div>
          <div class="sub" style="margin-top:10px">${n ? 'วินิจฉัยจากอาการแล้วเลือกการรักษาที่ถูกต้อง (⚡10) ถูก = ได้ ฿900 · ผิด = คนไข้สุขภาพลด' : ''}</div><div class="list">${opts}</div>`;
      }
      if (b && b[1] === myId) return `<h2>🛏️ คุณนอนรอหมออยู่</h2><div class="sub">หมอออนไลน์จะได้รับแจ้งเตือน · ค่ารักษา ฿600 · อยากออกจากเตียง เดินออกไปได้เลย</div>${(me.dz || []).map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, G.diseases[d].sym.join(' · '), '')).join('')}`;
      if (b) return `<h2>🛏️ เตียงนี้มีคนไข้แล้ว</h2><div class="sub">${esc(b[0])} นอนรอหมออยู่ ลองเตียงอื่น</div>`;
      return `<h2>🛏️ เตียงคนไข้</h2><div class="sub">นอนรอให้หมอผู้เล่นมาวินิจฉัยและรักษา ค่ารักษา ฿600 (ถูกกว่าเคาน์เตอร์มาก)</div>${B('🛏️ นอนรอหมอ', { t: 'act', st, a: 'lie' }, 'primary big')}`;
    }
    case 'hbed': {
      const s = STN(st), mine = me.house === s.idx;
      return mine ? `<h2>🛏️ เตียงที่บ้าน</h2><div class="sub">นอนแล้วได้พลังงาน และหายง่วง/หายอ่อนเพลีย</div>${B(`😴 นอนพัก (+${40 + me.comfort * 2}⚡, ทุก 60 วิ)`, { t: 'act', st, a: 'sleep' }, 'primary big')}` : '<h2>🛏️ เตียงของเจ้าของบ้าน</h2><div class="sub">นอนได้เฉพาะเจ้าของบ้าน</div>';
    }
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
      if (!mine) return `<h2>🏠 บ้านของ ${esc(owner)}</h2><div class="sub">ความสบาย ⭐ ${cf}</div><div style="font-size:30px;letter-spacing:4px">${furn.map(k => G.shop.furniture[k].icon).join('') || '— ยังไม่ได้แต่งบ้าน —'}</div>${B('🚪 เข้าไปเยี่ยมบ้าน', { fn: 'enter', st }, 'primary big')}`;
      const rows = Object.entries(G.shop.furniture).map(([k, f]) => itemRowRaw(f.icon, f.name, `ความสบาย +${f.comfort}`, me.furniture.includes(k) ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'furnish', item: k }, 'good'))).join('');
      return `<h2>🏠 บ้านของคุณ</h2><div class="sub">ความสบาย ⭐ <b>${me.comfort}</b> → พลังงานฟื้นเร็วขึ้น <b>+${me.comfort * 3}%</b> ตลอดเวลา · นอนที่บ้านได้ +${40 + me.comfort * 2}⚡</div>
        ${B('🚪 เข้าบ้าน (นอนพักที่เตียงในบ้าน)', { fn: 'enter', st }, 'primary big')}
        <div class="sub" style="margin-top:12px"><b>🛋️ แต่งบ้าน</b> (ของจะไปวางในบ้านจริง)</div><div class="list">${rows}</div>
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
// ---- sprite atlas (public/assets/atlas.webp + .json, 48 px per tile)
let atlas = null, atlasImg = null;
fetch('assets/atlas.json').then(r => r.json()).then(j => { atlas = j; const im = new Image(); im.onload = () => { atlasImg = im; }; im.src = 'assets/atlas.webp'; });
// draw a sprite with its bottom-centre at world tile (cx, by)
function spr(name, cx, by, X, Y, scale = 1) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const w = s[2] / atlas.tile * TS * scale, h = s[3] / atlas.tile * TS * scale;
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(cx * TS + X - w / 2), Math.round(by * TS + Y - h), Math.round(w), Math.round(h));
  return true;
}
// ground textures are 2x2 tiles; pick the quarter for this tile
function tex(name, tx, ty, px, py) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const q = atlas.tile;
  ctx.drawImage(atlasImg, s[0] + (tx & 1) * q, s[1] + (ty & 1) * q, q, q, Math.floor(px), Math.floor(py), Math.ceil(TS) + 1, Math.ceil(TS) + 1);
  return true;
}
const FLOOR = { office: 'fl_checker', market: 'fl_beige', warehouse: 'g_pavers', studio: 'fl_stone', home: 'fl_wood', dealer: 'fl_white', toolshop: 'fl_brick',
  restaurant: 'fl_checker', kitchen: 'fl_bluecheck', hospital: 'fl_white', school: 'fl_wood', cowork: 'fl_stone', bank: 'fl_beige', house: 'fl_wood' };
const WALL = { office: '#c9d3dc', market: '#f1e3c4', warehouse: '#8d7a5e', studio: '#4a3f63', home: '#e7c9a9', dealer: '#dfe6ec', toolshop: '#b9a17f',
  restaurant: '#e9cfa4', kitchen: '#f3f3f3', hospital: '#e6f1f6', school: '#cfe0c4', cowork: '#c4d0dc', bank: '#efe2bb', house: '#ecd2b2' };
function under(tx, ty) {   // what ground lies beneath a building/prop/tree tile
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) { const c = tileAt(tx + dx, ty + dy); if (',=kmsp'.includes(c)) return c; }
  return '.';
}
function drawTile(ch, tx, ty, px, py, tm) {
  if (ch === 'B' || ch === 'T' || ch === 'o') ch = under(tx, ty);
  const S = Math.ceil(TS) + 1;
  switch (ch) {
    case '.': { const v = hash(tx >> 1, ty >> 1); tex(v < .84 ? 'g_grass' : v < .92 ? 'g_grass_dots' : 'g_grass_flowers', tx, ty, px, py); return; }
    case 'm': tex(hash(tx >> 1, ty >> 1) < .9 ? 'g_grass3' : 'g_grass_dots', tx, ty, px, py); return;
    case 's': tex('g_sand', tx, ty, px, py); return;
    case 'k': tex('g_terracotta', tx, ty, px, py); return;
    case 'p': tex('g_planks', tx, ty, px, py); return;
    case 'f': tex('g_dirt', tx, ty, px, py); ctx.fillStyle = 'rgba(96,52,24,.55)'; ctx.fillRect(px, py, S, S); ctx.fillStyle = 'rgba(50,26,10,.45)'; for (let i = 1; i < 4; i++) ctx.fillRect(px + 3, py + i * TS / 4, TS - 6, Math.max(2, TS / 18)); return;
    case ',': {
      tex('g_sidewalk', tx, ty, px, py);
      const hz = tileAt(tx - 1, ty) === '=' && tileAt(tx + 1, ty) === '=', vt = tileAt(tx, ty - 1) === '=' && tileAt(tx, ty + 1) === '=';
      if (hz || vt) {   // where a sidewalk crosses a road: zebra crossing
        ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S); ctx.fillStyle = '#eef0f2';
        for (let i = 0; i < 4; i++) hz ? ctx.fillRect(px + 2, py + i * TS / 4 + 2, TS - 4, TS / 8) : ctx.fillRect(px + i * TS / 4 + 2, py + 2, TS / 8, TS - 4);
      }
      return;
    }
    case '=': {
      ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S);
      const v = hash(tx, ty); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(px + v * TS * .7, py + (1 - v) * TS * .7, 3, 3);
      ctx.fillStyle = '#f2d25c';
      const up = tileAt(tx, ty - 1) === '=', down = tileAt(tx, ty + 1) === '=', left = tileAt(tx - 1, ty) === '=', right = tileAt(tx + 1, ty) === '=';
      if (up && !down && left && right && tx % 2 === 0 && !(tileAt(tx, ty - 2) === '=')) ctx.fillRect(px + TS * .15, py - 2, TS * .7, 4);   // horizontal centre line
      if (left && !right && up && down && ty % 2 === 0 && tileAt(tx - 2, ty) !== '=') ctx.fillRect(px - 2, py + TS * .15, 4, TS * .7);   // vertical centre line
      return;
    }
    case 'w': {
      ctx.fillStyle = '#3d8fd1'; ctx.fillRect(px, py, S, S);
      const ph = Math.sin(tm * 1.5 + tx * .9 + ty * 1.7);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(px + TS * (.2 + ph * .1), py + TS * .3, TS * .35, Math.max(2, TS / 16));
      ctx.fillStyle = 'rgba(20,60,120,.18)'; ctx.fillRect(px + TS * .5, py + TS * (.7 + ph * .05), TS * .3, Math.max(2, TS / 16));
      if (',.sk'.includes(tileAt(tx, ty - 1))) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(px, py, S, Math.max(2, TS / 12)); }
      return;
    }
    case 'i': { const rm = roomGrid[ty * G.map.w + tx]; if (!tex(FLOOR[rm?.kind] || 'fl_wood', tx, ty, px, py)) { ctx.fillStyle = '#b89a78'; ctx.fillRect(px, py, S, S); } return; }
    case 'D': { tex('fl_wood', tx, ty, px, py); return; }
    case '#': {
      const rm = roomGrid[ty * G.map.w + tx];
      if (rm && ty === rm.y && tx > rm.x && tx < rm.x + rm.w - 1) {   // back wall: wallpaper + skirting
        ctx.fillStyle = WALL[rm.kind] || '#ddd'; ctx.fillRect(px, py, S, S);
        ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(px + TS / 2, py, 2, TS * .8);
        ctx.fillStyle = shade(WALL[rm.kind] || '#dddddd', -.35); ctx.fillRect(px, py + TS * .82, S, TS * .18);
      } else { ctx.fillStyle = '#2a2730'; ctx.fillRect(px, py, S, S); ctx.fillStyle = '#3a3542'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4); }
      return;
    }
    case ' ': ctx.fillStyle = '#07090c'; ctx.fillRect(px, py, S, S); return;
    default: ctx.fillStyle = '#5e9b57'; ctx.fillRect(px, py, S, S);
  }
}
function houseInfo(b) {
  const h = wd?.houses?.[b.house];
  return h ? { label: `🏠 ${h[0]}`, stars: h[1], mine: me && me.house === b.house } : { label: `🏷️ ขาย ${money(G.shop.housePrices[b.house])}`, forSale: true };
}
function drawBuildingSprite(b, X, Y) {
  if (!spr(b.sprite, b.x + b.w / 2, b.y + b.h + .02, X, Y)) { ctx.fillStyle = '#8a7a6a'; ctx.fillRect(b.x * TS + X, b.y * TS + Y, b.w * TS, b.h * TS); }
}
function drawBuildingSign(b, X, Y) {
  const s = atlas?.sprites[b.sprite]; const hTiles = s ? s[3] / atlas.tile : b.h;
  const cx = (b.x + b.w / 2) * TS + X, top = (b.y + b.h - hTiles) * TS + Y;
  if (b.house !== undefined) {
    const h = houseInfo(b);
    sign(h.label + (h.stars ? ` ⭐${h.stars}` : ''), cx, top - TS * .1, { size: TS * .28, bg: h.mine ? 'rgba(255,201,77,.95)' : h.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.85)', color: h.mine ? '#222' : '#fff' });
    return;
  }
  if (b.deco) { ctx.globalAlpha = .75; sign(`${b.icon} ${b.label}`, cx, top - TS * .1, { size: TS * .26 }); ctx.globalAlpha = 1; return; }
  sign(`${b.icon} ${b.label}`, cx, top - TS * .15, { size: TS * .36, bg: 'rgba(18,22,28,.9)', border: '#ffc94d88' });
}
// warm light pools around lamps and windows at night
function drawLights(X, Y, dark) {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.props) if (/^lamp/.test(p.s)) {
    const px = p.x * TS + X, py = (p.y - 1.6) * TS + Y; if (px < -200 || py < -200 || px > VW + 200 || py > VH + 200) continue;
    const g = ctx.createRadialGradient(px, py, 0, px, py, TS * 2.4);
    g.addColorStop(0, `rgba(255,200,110,${dark * .9})`); g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g; ctx.fillRect(px - TS * 2.4, py - TS * 2.4, TS * 4.8, TS * 4.8);
  }
  ctx.globalCompositeOperation = 'source-over';
}
// navigation: a yellow arrow that walks the player to a place
let guide = null;
const TARGETS = {
  farm: () => ({ x: 15, y: 43, label: 'ไร่กลางเมือง' }),
};
function targetOf(key) {
  if (TARGETS[key]) return TARGETS[key]();
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, id: s.id, room: s.room };
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
  // targets inside a building: walk to its door first; if you're in another room, to the exit
  const inR = roomOf(m.x, m.y), tR = guide.room ? G.rooms.find(r => r.id === guide.room) : null;
  let tg = guide, final = true;
  if (inR && (!tR || tR.id !== inR.id)) { tg = { x: inR.exit.x, y: inR.exit.y - .6, label: 'ทางออก' }; final = false; }
  else if (!inR && tR) { tg = { x: tR.doorPt.x, y: tR.doorPt.y, label: guide.label + ' (ประตู)' }; final = false; }
  const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy);
  if (!final && d < 1.2) return;
  if (final && d < 2) { guide = null; FX.play('ding'); toast('ถึงแล้ว! กดปุ่มกลมสีเหลืองเพื่อใช้งาน', '📍'); return; }
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

// full-screen town map: tap a place to navigate there
function openMap() {
  const v = $('#mapView'); v.classList.remove('hidden');
  const c = $('#bigMap'), W = G.tw, H = G.map.h;
  const k = Math.min((Math.min(innerWidth, 980) - 24) / W, (innerHeight - 110) / H);
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * k * dpr; c.height = H * k * dpr; c.style.width = W * k + 'px'; c.style.height = H * k + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = MINI_COLORS;
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
  for (const b of G.map.buildings) {
    const sp = atlas?.sprites[b.sprite];
    if (sp && atlasImg) { const w = sp[2] / atlas.tile * k, h = sp[3] / atlas.tile * k; g.drawImage(atlasImg, sp[0], sp[1], sp[2], sp[3], (b.x + b.w / 2) * k - w / 2, (b.y + b.h) * k - h, w, h); }
    else { g.fillStyle = '#8a7a6a'; g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k); }
    const cx = (b.x + b.w / 2) * k, cy = (b.y + b.h / 2) * k;
    if (b.house !== undefined) { const h = houseInfo(b); label(h.forSale ? '🏷️ ขาย' : h.label, cx, cy, fs * .8, h.mine ? 'rgba(200,140,20,.95)' : h.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.9)', b.w * k + 6); hits.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k, key: b.st }); continue; }
    if (b.deco) { g.globalAlpha = .6; label(b.label, cx, cy, fs * .85, 'rgba(18,22,28,.8)', b.w * k - 2); g.globalAlpha = 1; continue; }
    label(`${b.icon} ${b.label}`, cx, cy, fs, 'rgba(18,22,28,.9)', b.w * k - 2);
    hits.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k, key: b.st });
  }
  label('🌾 ไร่กลางเมือง', 15 * k, 45 * k, fs, 'rgba(74,52,26,.94)'); hits.push({ x: 2 * k, y: 39 * k, w: 25 * k, h: 13 * k, key: 'farm' });
  label('🎣 ท่าเรือ', 44 * k, 49.2 * k, fs, 'rgba(26,62,88,.94)'); hits.push({ x: 38 * k, y: 44 * k, w: 12 * k, h: 5 * k, key: 'pier1' });
  label('⛲ สวนสาธารณะ', 36.5 * k, 44.5 * k, fs * .85, 'rgba(60,90,50,.9)');
  for (const p of P.values()) {
    const mine = p.id === myId;
    g.fillStyle = mine ? '#fff' : COLORS[p.av]; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    const q = townPos(p.x, p.y), inR = roomOf(p.x, p.y);
    g.beginPath(); g.arc(q.x * k, q.y * k, mine ? k * .75 : k * .5, 0, 7); g.fill(); g.stroke();
    if (mine) label(inR ? `คุณอยู่ใน${inR.label}` : 'คุณอยู่ที่นี่', q.x * k, q.y * k - fs * 1.4, fs * .85, 'rgba(255,120,60,.95)');
  }
  if (guide) { const q = guide.room ? G.rooms.find(r => r.id === guide.room).outside : guide; g.strokeStyle = '#ffc94d'; g.lineWidth = 3; g.beginPath(); g.arc(q.x * k, q.y * k, k * 1.4, 0, 7); g.stroke(); }
  c.onclick = e => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    if (h) { closeMap(); setGuide(h.key); }
  };
}
function closeMap() { $('#mapView').classList.add('hidden'); }

// first-time tutorial
const TUT = () => [
  ['👋', 'ยินดีต้อนรับสู่เมือง!', 'ตัวคุณคือตัวละครที่มีป้ายชื่อ<b>สีเหลือง</b> ผู้เล่นคนอื่นก็เดินอยู่ในเมืองเดียวกันกับคุณ'],
  ['👣', 'วิธีเดิน', 'มือถือ: <b>แตะค้างตรงไหนก็ได้แล้วลากนิ้ว</b> (จอยจะโผล่ใต้นิ้ว)<br>คอม: ปุ่ม <b>W A S D</b> หรือลูกศร'],
  ['🚪', 'เข้าอาคาร', 'ทุกตึกมี<b>ป้ายชื่อบนหลังคา</b> <b>เดินชนประตู</b>เพื่อเข้าไปข้างใน แล้วไปที่เคาน์เตอร์ (ไอคอนลอย) กด<b>ปุ่มกลมสีเหลือง</b> (คอม: E) · ออกโดยเดินลงพรมหน้าประตู'],
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

// ------------------------------------------------------------------ building interiors
let roomGrid = [], roomFurniture = [];
// [sprite, x, y(bottom)] relative to the room's top-left corner; the counter station stands at (7, 2.6)
const ROOM_LAYOUT = {
  office: [['f_window', 3.5, 1.1], ['f_window', 10.5, 1.1], ['f_desk', 7, 2.3], ['f_computer_desk', 3.3, 5.6], ['f_computer_desk', 10.7, 5.6], ['f_filing_grey', 1.6, 2.6], ['f_filing_blue', 12.4, 2.6], ['f_plant', 1.6, 8.7], ['f_plant2', 12.4, 8.7]],
  market: [['f_shelf_jars', 2.6, 2.6], ['f_shelf_plants', 11.4, 2.6], ['f_counter', 7, 2.3], ['stall_green', 3.4, 6.6], ['stall_red', 10.6, 6.6], ['f_plant3', 1.6, 8.7]],
  warehouse: [['crate', 1.8, 3.2], ['crate', 3, 3.2], ['barrel', 4.2, 3.2], ['f_cabinet', 7, 2.3], ['hay2', 11.5, 3.4], ['hay', 11.6, 6.6], ['sack', 2.2, 6.6], ['barrel2', 3.3, 6.6], ['crate', 12.2, 8.6]],
  studio: [['f_window', 10.5, 1.1], ['f_speaker', 1.6, 2.6], ['f_stereo', 3.5, 2.6], ['f_laptop_desk', 7, 2.3], ['f_guitar', 12.3, 2.7], ['f_rug_round', 7, 6.4], ['f_beanbag', 3, 6], ['f_beanbag', 11, 6], ['f_floorlamp', 12.4, 8.6]],
  home: [['f_bed_blue', 2.4, 3.6], ['f_bed_pink', 2.4, 7.4], ['f_bed_green', 11.6, 3.6], ['f_bed_beige', 11.6, 7.4], ['f_drawer', 7, 2.2], ['f_rug_red', 7, 6.4], ['f_window', 4.8, 1.1]],
  dealer: [['f_desk', 7, 2.3], ['car_red', 3, 4.8], ['car_blue', 11, 4.8], ['car_green', 3, 8.3], ['car_yellow', 11, 8.3], ['f_plant', 1.5, 2.6], ['f_plant2', 12.5, 2.6]],
  toolshop: [['f_shelf_pots', 2.6, 2.6], ['f_bookshelf3', 11.6, 2.7], ['f_counter', 7, 2.3], ['cart', 3, 7.2], ['crate', 11.4, 6.6], ['barrel', 12.4, 6.6], ['f_trash', 12.4, 8.7]],
  restaurant: [['f_counter_micro', 7, 2.3], ['menuboard', 12.4, 2.7], ['f_plant4', 1.6, 2.6], ['f_table_chairs', 3, 5.4], ['f_round_table', 11, 5.4], ['f_table_check', 3, 8.4], ['f_table_check', 11, 8.4]],
  kitchen: [['f_counter_micro', 2.7, 2.6], ['f_stove', 4.9, 2.6], ['f_counter_toast', 7, 2.3], ['f_counter_oven', 9.6, 2.6], ['f_fridge', 12, 2.7], ['f_shelf_pots', 2.6, 6.4], ['f_bench', 10.5, 6.6]],
  hospital: [['f_counter', 3.5, 2.3], ['f_shelf_jars', 1.8, 6.4], ['f_plant', 1.5, 8.7], ['f_window', 6.4, 1.1], ['f_bed_blue', 9, 3.3], ['f_bed_blue', 11.5, 3.3], ['f_bed_blue', 9, 6.7], ['f_bed_blue', 11.5, 6.7]],
  school: [['f_bookshelf_wide', 2.6, 2.6], ['f_bookshelf', 11.8, 2.6], ['f_desk', 7, 2.3], ['f_desk', 3.6, 5.4], ['f_desk', 10.4, 5.4], ['f_desk', 3.6, 7.9], ['f_desk', 10.4, 7.9], ['f_clock', 9.4, .95]],
  cowork: [['f_laptop_desk', 7, 2.3], ['f_computer_desk', 3.2, 5.4], ['f_computer_desk', 10.8, 5.4], ['f_laptop_desk', 3, 8.4], ['f_laptop_desk', 11, 8.4], ['f_coffee', 12.4, 2.6], ['f_plant', 1.6, 2.6]],
  bank: [['f_cabinet', 7, 2.3], ['f_filing_grey', 1.6, 2.6], ['f_filing_grey', 12.4, 2.6], ['f_rug_blue', 7, 6.6], ['f_plant', 1.6, 8.7], ['f_plant2', 12.4, 8.7], ['f_pictures', 4, 1.05], ['f_pictures', 10, 1.05]],
};
const FURN_SPRITE = { plant: 'f_plant', sofa: 'f_sofa_red', tv: 'f_tv', bed: 'f_bed_pink', aqua: 'f_aquarium', art: 'f_pictures', piano: 'f_guitar', jacuzzi: 'f_bath' };
const FURN_SLOTS = [[11.8, 8.6], [8, 2.9], [11, 2.9], [11.2, 5.6], [5.3, 1.05], [2.3, 6.4], [6.5, 6.2], [3, 8.8]];
function buildRooms() {
  roomGrid = new Array(G.map.w * G.map.h);
  for (const r of G.rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomGrid[y * G.map.w + x] = r;
  layoutFurniture();
}
function layoutFurniture() {
  roomFurniture = [];
  for (const r of G.rooms) {
    let items = ROOM_LAYOUT[r.kind] || [];
    if (r.kind === 'house') {
      const h = wd?.houses?.[r.house];
      items = [['f_bed_blue', 3, 3.3], ['f_window', 6, 1.1], ['f_welcome', 7, 9.2]].concat(h ? h[3].map((k, i) => [FURN_SPRITE[k], ...FURN_SLOTS[i]]) : []);
    }
    for (const [sp, x, y] of items) roomFurniture.push([sp, r.x + x, r.y + y]);
  }
}
const roomOf = (x, y) => G?.rooms?.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const townPos = (x, y) => { const r = roomOf(x, y); return r ? r.outside : { x, y }; };
function drawRoomLabels(r, X, Y, t) {
  {
    const px = r.x * TS + X, py = r.y * TS + Y;
    const h = r.kind === 'house' ? wd?.houses?.[r.house] : null;
    sign(r.kind === 'house' ? (h ? `🏠 บ้านของ ${h[0]}` : '🏷️ บ้านว่าง') : `${r.icon} ${r.label}`, px + r.w * TS / 2, py - TS * .1, { size: TS * .34, border: '#ffc94d88' });
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${Math.round(TS * .3)}px 'Noto Sans Thai',sans-serif`;
    ctx.fillText('⬇ ทางออก', px + 7 * TS, py + (r.h + .45) * TS + Math.sin(t / 300) * 2);
  }
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
// walk into a door to go in, walk onto the doormat inside to go out
let doorCd = 0, doorArmed = true;
function autoDoor() {
  const m = P.get(myId); if (!m || !G?.rooms || performance.now() < doorCd) return;
  const r = roomOf(m.x, m.y);
  if (r) { doorArmed = false; if (m.y > r.y + r.h - 1.1) { doorCd = performance.now() + 1500; send({ t: 'exit' }); } return; }
  // after coming out, step away from the door before walking into one re-enters
  const nearest = Math.min(...G.rooms.map(rm => Math.hypot(m.x - rm.doorPt.x, m.y - rm.doorPt.y)));
  if (!doorArmed) { if (nearest > 1.1) doorArmed = true; return; }
  for (const rm of G.rooms) if (Math.hypot(m.x - rm.doorPt.x, m.y - rm.doorPt.y) < 0.55) {
    doorCd = performance.now() + 1500;
    send({ t: 'enter', st: rm.house !== undefined ? rm.bld : 'door_' + rm.bld }); return;
  }
}
function dzInfo(id) {
  if (id === '_sleepy') return toast('ไม่ได้นอนนานแล้ว ถ้าเกิน 25 นาทีจะป่วยเป็นอดนอน ไปนอนที่ห้องพักหรือบ้าน', '🥱', false);
  if (id === '_hungry') return toast('หิวมาก ถ้าหลอดหมดนานจะขาดสารอาหาร ซื้ออาหารที่ตลาดกลางหรือร้านอาหาร', '🍗', false);
  const d = G.diseases[id];
  toast(`${d.name}: ${d.sym.join(', ')} · สาเหตุ: ${d.cause} · ${d.self} · ไปนอนรอหมอที่เตียงในโรงพยาบาลได้`, d.icon, false);
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
