'use strict';
(() => {
const $ = s => document.querySelector(s);
const COLORS = ['#ef6a5b', '#f2a541', '#f2d14b', '#7ac96b', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
try { creds = JSON.parse(localStorage.getItem('lt_creds') || 'null'); } catch { }

// ------------------------------------------------------------------ login UI
let avatar = creds?.avatar ?? Math.floor(Math.random() * COLORS.length);
const sw = $('#swatches');
COLORS.forEach((c, i) => { const b = document.createElement('b'); b.style.background = c; b.onclick = () => { avatar = i; paintSw(); }; sw.appendChild(b); });
function paintSw() { [...sw.children].forEach((b, i) => b.classList.toggle('on', i === avatar)); }
paintSw();
if (creds) { $('#inName').value = creds.name; $('#inPin').value = creds.pin; }
const nameErr = v => /[^\x20-\x7e]/.test(v) ? 'ชื่อตัวละครใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น' : /\s/.test(v) ? 'ชื่อห้ามมีเว้นวรรค' : '';
$('#inName').addEventListener('input', e => { $('#loginErr').textContent = nameErr(e.target.value) ? nameErr(e.target.value) + ' (ตัวละครเก่าชื่อไทยยังเข้าได้)' : ''; });
$('#loginForm').onsubmit = e => {
  e.preventDefault();
  // the server has the final say: new characters must use English/digits, old Thai-named characters still log in
  creds = { name: $('#inName').value.trim(), pin: $('#inPin').value, avatar };
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
    if (G) toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่...', '📡', false);
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
      G = m; myId = m.id; P.clear(); buildAreas();
      localStorage.setItem('lt_creds', JSON.stringify(creds));
      $('#login').classList.add('hidden'); $('#hud').classList.remove('hidden');
      chatLog.length = 0; m.chat.forEach(c => chatLog.push(c));
      { let tutDone = false; try { tutDone = !!localStorage.getItem('lt_tut2'); } catch { } tutPending = !!(m.isNew || !tutDone); }
      if (tutPending) setTimeout(() => me && showTut(0), 400);
      break;
    case 'me': { const prev = me; me = m; $('#meName').textContent = m.name; paintHud(); refreshPanel(); if (prev && prev.id === m.id) onMeDiff(prev, m); break; }
    case 'wd': { const hs = JSON.stringify(m.houses.map(h => h[2])); wd = m; clockOff = m.now - Date.now(); paintEvent(); refreshPanel(); if (G && hs !== lastHouses) { lastHouses = hs; layoutFurniture(); } break; }
    case 'roster': {
      const ids = new Set();
      for (const p of m.players) {
        ids.add(p.id);
        let s = P.get(p.id);
        if (!s) { s = { x: p.x, y: p.y, rx: p.x, ry: p.y, ox: 0, oy: 0, f: p.f, bubble: '', bt: 0 }; P.set(p.id, s); }
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, lv: p.lv, veh: p.veh, dz: p.dz || [], pose: p.pose, title: p.title });
        if (p.id === myId && !s.init) { s.init = true; s.x = s.rx = p.x; s.y = s.ry = p.y; }
      }
      for (const id of [...P.keys()]) if (!ids.has(id)) P.delete(id);
      break;
    }
    case 'ps': for (const [id, x, y, f] of m.p) { const s = P.get(id); if (s && id !== myId) { if (Math.hypot(x - s.x, y - s.y) > 4) { s.rx = x; s.ry = y; } s.x = x; s.y = y; s.f = f; } } break;
    case 'fix': {
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
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      logLine(m.sys ? m.text : `<b>${esc(m.name)}</b>: ${esc(m.text)}`, m.sys ? 'sys' : '', !m.sys);
      const s = P.get(m.id); if (s && !m.sys) { s.bubble = m.text; s.bt = performance.now() + 6500; }
      if (m.sys) { if (/🦈|💎|🎊|🏅|🎓/.test(m.text)) FX.play('notice'); } else if (m.id !== myId) FX.play('pop');
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
    case 'bite': FX.play('bite'); if (bobber) { FX.ring(bobber.x, bobber.y, '#fff', 600, 0.9); FX.float(bobber.x, bobber.y - .3, '‼️', '#fff', .6); } if (navigator.vibrate) navigator.vibrate(200); break;
    case 'req': showReq(m); break;
    case 'ring': showRing(m); break;
    case 'call': {
      if (m.open) { call = { with: m.with, phone: m.phone }; callLog.length = 0; FX.play('chime'); openPanel({ kind: 'phone', tab: 'call' }); }
      else { if (call) toast(`📞 ${m.why || 'วางสายแล้ว'}`, '📵', false); call = null; if (panel?.kind === 'phone') refreshPanel(true); }
      paintCallChip(); break;
    }
    case 'call_msg': {
      callLog.push(m); if (callLog.length > 50) callLog.shift();
      if (!m.me) { logLine(`📞 <b>${esc(m.name)}</b>: ${esc(m.text)}`, 'call', false); FX.play('pop'); }
      if (panel?.kind === 'phone') refreshPanel(true);
      break;
    }
    case 'dtest': showDriveTest(m.qs); break;
    case 'ach': FX.play('levelup'); { const s = P.get(myId); if (s) { FX.burst(s.x, s.y, '#ffd34d', 24); FX.ring(s.x, s.y, '#ffd34d', 900, 1.6); } } break;
    case 'daily': if (tutPending) pendingDaily = m; else setTimeout(() => showDaily(m), 700); break;
    case 'quest': {
      const s = P.get(myId);
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
function logLine(html, cls, bubbleOnly) {
  const l = $('#log'); const d = document.createElement('div');
  if (cls) d.className = cls; d.innerHTML = html;
  l.appendChild(d); setTimeout(() => d.remove(), 9000); while (l.children.length > 5) l.firstChild.remove();
}

// ------------------------------------------------------------------ toasts and popups
function toast(msg, icon = '✅', ok = true) {
  const d = document.createElement('div'); d.className = 'toast' + (ok ? '' : ' bad'); d.textContent = `${icon} ${msg}`;
  const t = $('#toasts'); t.appendChild(d); while (t.children.length > 4) t.firstChild.remove();
  setTimeout(() => d.remove(), 3800);
}
function popup(html, buttons, ms = 20000) {
  const d = document.createElement('div'); d.className = 'req';
  d.innerHTML = `<div>${html}</div><div class="btns"></div>`;
  for (const [label, cls, fn] of buttons) { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = () => { fn(); d.remove(); }; d.querySelector('.btns').appendChild(b); }
  $('#reqs').appendChild(d); setTimeout(() => d.remove(), ms);
  return d;
}
function showReq(r) {
  const what = r.kind === 'trade' ? 'ขอแลกเปลี่ยนของกับคุณ 🤝' : `เสนอปฐมพยาบาลให้คุณ 💉 ค่ารักษา <b>${money(r.fee)}</b>`;
  popup(`<b>${esc(r.from.name)}</b> ${CAREER_ICON(r.from.c)} ${what}`, [['ตกลง', 'good', () => send({ t: 'req_ans', id: r.id, ok: true })], ['ปฏิเสธ', 'warn', () => send({ t: 'req_ans', id: r.id, ok: false })]]);
  FX.play('ding');
}
function showRing(r) {
  popup(`📞 สายเรียกเข้าจาก <b>${esc(r.name)}</b> <small>(${r.phone}${r.known ? '' : ' · ไม่อยู่ในรายชื่อ'})</small>`, [['📞 รับสาย', 'good', () => send({ t: 'req_ans', id: r.id, ok: true })], ['ไม่รับ', 'warn', () => send({ t: 'req_ans', id: r.id, ok: false })]], 25000);
  FX.play('ding'); setTimeout(() => FX.play('ding'), 600); if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
function paintCallChip() { const c = $('#callChip'); if (call) { c.classList.remove('hidden'); c.textContent = `📞 คุยกับ ${call.with}`; } else c.classList.add('hidden'); }
$('#callChip').onclick = () => openPanel({ kind: 'phone', tab: 'call' });
const CAREER_ICON = c => G?.careers[c]?.icon || '';

// ------------------------------------------------------------------ HUD
function paintHud() {
  if (!me) return;
  const c = G.careers[me.career];
  $('#meCareer').textContent = me.career === 'none' ? '🙂 ว่างงาน' : `${c.icon} Lv.${me.lv}`;
  const chips = (me.dz || []).map(d => `<span class="chip bad" data-dz="${d}">${G.diseases[d].icon} ${G.diseases[d].name}</span>`);
  if (me.awake > 32 * 60 && !(me.dz || []).includes('insomnia')) chips.push('<span class="chip warnc" data-dz="_sleepy">🥱 เริ่มง่วง ควรพัก</span>');
  if (me.hunger < 20) chips.push('<span class="chip warnc" data-dz="_hungry">🍗 หิวมาก</span>');
  const dzBox = $('#dzChips'); const html = chips.join('');
  if (dzBox.dataset.h !== html) { dzBox.dataset.h = html; dzBox.innerHTML = html; dzBox.querySelectorAll('[data-dz]').forEach(c => c.onclick = () => dzInfo(c.dataset.dz)); }
  $('#meMoney').textContent = money(me.money);
  const qs = me.quests; if (qs) { const d = qs.list.filter(x => x.done).length; const ql = $('#qline'); ql.textContent = d === 3 ? '📜 เควสต์ครบแล้ว ✅' : `📜 เควสต์ ${d}/3 · กดดู`; ql.classList.toggle('all', d === 3); $('#qBtn').classList.toggle('has', d < 3); }
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
  $('#vE').textContent = Math.floor(me.energy); $('#vH').textContent = Math.floor(me.hunger); $('#vL').textContent = Math.floor(me.health);
  $('#card').style.borderLeftColor = COLORS[me.avatar ?? 0] || '#999';
  $('#restBtn').classList.toggle('on', me.pose === 'rest');
  $('#restBtn').textContent = me.pose === 'rest' ? '🧍 ลุก' : '😌 พัก';
  $('#phoneBtn').classList.toggle('has', me.career === 'rider' && (me.jobs || []).some(j => j.state === 'open'));
  const dn = $('#downView');
  if (me.down) {
    dn.classList.remove('hidden');
    dn.innerHTML = me.down.kind === 'veg' ? `<b>🥬 หิวจนหมดแรง นอนเป็นผัก</b><span>ร่างกายจะค่อยๆ ฟื้นเอง (❤️ ${Math.floor(me.health)}/15)</span>` : `<b>🚑 หมดสติอยู่ที่โรงพยาบาล</b><span>รอหมอมาช่วย... ทำอะไรไม่ได้</span>`;
  } else dn.classList.add('hidden');
}
function paintEvent() {
  const e = $('#eventBar');
  if (wd?.ev) { e.textContent = wd.ev.text; e.classList.remove('hidden'); } else e.classList.add('hidden');
}
const hourNow = () => FORCE_PHASE !== null ? +FORCE_PHASE * 24 : ((((Date.now() + clockOff + (wd?.toff || 0)) % G.dayMs) / G.dayMs) * 24);
const FORCE_PHASE = new URLSearchParams(location.search).get('phase');   // ?phase=0.95 previews a time of day
const isOpen = (kind, h = hourNow()) => { const o = G?.hours[kind]; return !o || (h >= o[0] && h < o[1]); };
setInterval(() => {
  if (!wd || !G) return;
  const h = hourNow();
  $('#clock').textContent = `🕐 ${hhmm(h)} · 👥 ${wd.on}`;
  document.querySelectorAll('.qcd').forEach(el => {
    const s = Math.max(0, Math.floor((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = `${Math.floor(s / 3600)} ชม. ${Math.floor(s % 3600 / 60)} นาที`;
  });
  document.querySelectorAll('.cd').forEach(el => {
    const left = Math.max(0, Math.ceil((+el.dataset.t - (Date.now() + clockOff)) / 1000));
    el.textContent = left > 0 ? `อีก ${left >= 60 ? Math.floor(left / 60) + ' นาที ' : ''}${left % 60} วิ` : 'พร้อมเก็บเกี่ยว!';
  });
}, 500);

document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPanel({ kind: b.dataset.open }));
$('#panelX').onclick = closePanel;
$('#mini').onclick = () => G && openMap();
$('#mapX').onclick = closeMap;
$('#mapView').addEventListener('pointerdown', e => { if (e.target.id === 'mapView') closeMap(); });
$('#panel').addEventListener('pointerdown', e => { if (e.target === $('#panel')) closePanel(); });
$('#restBtn').onclick = () => { if (!me || me.down) return; FX.play('click'); send({ t: 'rest', on: me.pose !== 'rest' }); };

// ------------------------------------------------------------------ areas & collision
let AREA = {};
const areaOf = (x, y) => G?.areas.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
const roomOf = (x, y) => { const a = areaOf(x, y); return a && a.kind === 'room' ? a : null; };
const mapOf = id => { const a = AREA[id]; return a ? (a.kind === 'room' ? a.area : a.id) : 'town'; };
const tileAt = (x, y) => (x < 0 || y < 0 || x >= G.map.w || y >= G.map.h) ? ' ' : G.map.tiles[y][x];
const solid = (x, y) => G.solid.includes(tileAt(Math.floor(x), Math.floor(y)));
// the client checks with the full radius; the server allows a hair less, so rounding never causes a rejection
const blockedAt = (x, y) => { const r = G.radius; return solid(x - r, y - r) || solid(x + r, y - r) || solid(x - r, y + r) || solid(x + r, y + r); };

// ------------------------------------------------------------------ input
const keys = {};
let joy = null;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Escape') e.target.blur(); return; }
  keys[e.key.toLowerCase()] = true;
  if (!G) return;
  if (e.key === 'e' || e.key === ' ' || e.key === 'Enter' && !panel) { e.preventDefault(); onAction(); }
  if (e.key === 'Escape') { closePanel(); }
  if (e.key === 'b') openPanel({ kind: 'bag' });
  if (e.key === 'p') openPanel({ kind: 'phone' });
  if (e.key === 'r') $('#restBtn').click();
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
  if (down && down.id === e.pointerId) { if (!down.moved && performance.now() - down.t < 350) onTap(e.clientX, e.clientY); down = null; }
  if (joy && joy.id === e.pointerId) { joy = null; $('#stick').style.display = 'none'; }
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
// a popup appearing under your finger used to swallow the touch: always release the stick
addEventListener('pointerup', e => { if (joy && joy.id === e.pointerId) { joy = null; $('#stick').style.display = 'none'; } });

let camLift = 0;
function camera() {
  const m = P.get(myId); let x = m ? m.rx + m.ox : 50, y = m ? m.ry + m.oy : 36;
  const target = panel && !trade ? VH * 0.24 : 0;
  camLift += (target - camLift) * 0.18;
  const a = m ? areaOf(m.x, m.y) : null;
  if (a) {   // keep the view inside the current map/room (you never see past its edge)
    const fit = (pos, lo, size, view) => size * TS + TS * 2 <= view ? lo + size / 2 : clamp(pos, lo + view / TS / 2 - 1, lo + size - view / TS / 2 + 1);
    x = fit(x, a.x, a.w, VW); y = fit(y, a.y - (a.kind === 'room' ? .6 : 0), a.h + (a.kind === 'room' ? 1.2 : 0), VH - camLift * 2);
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
let near = null, actCd = 0;
function findNear() {
  const m = P.get(myId); if (!m || !G || me?.down) return null;
  const here = areaOf(m.x, m.y)?.id;
  let best = null, bd = 1e9;
  for (const s of G.stations) {
    if (s.area !== here || s.type === 'exit' && false) continue;
    const d = Math.hypot(s.x - m.x, s.y - m.y);
    if (d <= s.r && d < bd) { bd = d; best = s; }
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
  if (near.type === 'door' && near.house === undefined) {
    if (t < actCd) return; actCd = t + 1300;
    if (!isOpen(near.bld)) { const o = G.hours[near.bld]; return toast(`${near.label} ปิดอยู่ (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
    return send({ t: 'enter', st: near.id });
  }
  if (near.type === 'exit') { if (t < actCd) return; actCd = t + 1300; return send({ t: 'exit' }); }
  if (near.type === 'gate') { if (t < actCd) return; actCd = t + 1300; return doAct(near.id, 'go'); }
  if (near.type === 'deliver') return send({ t: 'order_deliver', id: near.oid });
  if (near.type === 'seat') return doAct(near.id, 'sit');
  if (near.type === 'chair' && me.career === 'office') return doAct(near.id, 'sit');
  if (panel?.st === near.id) { closePanel(); return; }
  openPanel({ kind: near.type, st: near.id });
}
$('#actBtn').onclick = onAction;

// ------------------------------------------------------------------ main loop
let last = performance.now(), sendT = 0, lastSent = '', holdAfterTp = false, meMoving = false, fadeT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (!G || !me) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#14181d'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  const m = P.get(myId);
  if (m) {
    let dx = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    let dy = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
    if (joy && Math.hypot(joy.dx, joy.dy) > 0.15) { dx = joy.dx; dy = joy.dy; }
    if (holdAfterTp) { if (!dx && !dy && !joy) holdAfterTp = false; else { dx = 0; dy = 0; } }
    if (me.down) { dx = 0; dy = 0; }
    const l = Math.hypot(dx, dy); meMoving = false;
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      const sp = G.speed * (me.speed || 1) * dt;
      // round to what we send so client and server always agree
      const r2 = v => Math.round(v * 100) / 100;
      const nx = r2(m.x + dx * sp); if (!blockedAt(nx, m.y)) m.x = nx;
      const ny = r2(m.y + dy * sp); if (!blockedAt(m.x, ny)) m.y = ny;
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8; meMoving = Math.hypot(m.x - m.rx, m.y - m.ry) > 0.001;
      stepAcc += Math.hypot(m.x - m.rx, m.y - m.ry);
      if (stepAcc > 0.62) { stepAcc = 0; FX.play('step', tileAt(Math.floor(m.x), Math.floor(m.y))); if (Math.random() < .5) FX.dust(m.x, m.y); }
    }
    m.rx = m.x; m.ry = m.y;
    m.ox *= 0.8; m.oy *= 0.8; if (Math.abs(m.ox) < .002) m.ox = 0; if (Math.abs(m.oy) < .002) m.oy = 0;
    sendT += dt;
    const sig = m.x.toFixed(2) + ',' + m.y.toFixed(2);
    if (sendT > 0.066 && sig !== lastSent) { sendT = 0; lastSent = sig; send({ t: 'p', x: +m.x.toFixed(2), y: +m.y.toFixed(2), f: m.f }); }
  }
  for (const p of P.values()) if (p.id !== myId) { const k = Math.min(1, dt * 12); p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }

  near = findNear();
  const ab = $('#actBtn');
  if (near) {
    ab.classList.remove('hidden'); $('#actIcon').textContent = near.icon;
    const closed = near.type === 'door' && near.house === undefined && !isOpen(near.bld);
    $('#actLabel').textContent = near.type === 'door' ? (near.house !== undefined ? `บ้านเลขที่ ${near.house + 1}` : closed ? '🔒 ปิดอยู่' : 'เข้า ' + near.label) : near.type === 'exit' ? 'ออกจากอาคาร' : near.type === 'gate' ? near.label : near.type === 'seat' ? 'นั่ง' : near.label;
    ab.classList.toggle('closed', closed);
  } else ab.classList.add('hidden');
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
  const meP = P.get(myId), A = meP ? areaOf(meP.x, meP.y) : null, myRoom = A && A.kind === 'room' ? A : null;
  let x0 = Math.max(0, Math.floor(c.x / TS)), y0 = Math.max(0, Math.floor(c.y / TS));
  let x1 = Math.min(G.map.w - 1, Math.ceil((c.x + VW) / TS)), y1 = Math.min(G.map.h - 1, Math.ceil((c.y + VH) / TS));
  if (A) { x0 = Math.max(x0, A.x); y0 = Math.max(y0, A.y); x1 = Math.min(x1, A.x + A.w - 1); y1 = Math.min(y1, A.y + A.h - 1); }
  // only things inside the area you are in are drawn: inside a building you never see the street
  const inside = (x, y) => !A || (x >= A.x && x <= A.x + A.w && y >= A.y && y <= A.y + A.h + .5);
  const tm = t / 1000;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(G.map.tiles[ty][tx], tx, ty, tx * TS + X, ty * TS + Y, tm);
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
  for (const p of G.props) if (vis(p.x, p.y, 4)) ents.push([p.y, 1, p]);
  for (const tr of G.trees) if (vis(tr[0] + .5, tr[1] + 1, 4)) ents.push([tr[1] + .95, 2, tr]);
  for (const f of roomFurniture) if (vis(f[1], f[2], 4)) ents.push([f[2], 3, f]);
  for (const p of P.values()) if (vis(p.rx, p.ry, 3)) ents.push([p.ry + .3, 4, p]);
  ents.sort((a, b) => a[0] - b[0]);
  for (const [, k, e] of ents) {
    if (k === 0) drawBuildingSprite(e, X, Y);
    else if (k === 1) spr(e.s, e.x, e.y, X, Y);
    else if (k === 2) spr(e[2], e[0] + .5, e[1] + 1.05, X, Y);
    else if (k === 3) spr(e[0], e[1], e[2], X, Y);
    else drawPlayer(e, X, Y, t);
  }
  for (const b of G.map.buildings) if (vis(b.x + b.w / 2, b.y + b.h)) drawBuildingSign(b, X, Y);
  for (const s of G.stations) {
    if (s.type === 'gplot' || !inside(s.x, s.y)) continue;
    const px = s.x * TS + X, py = s.y * TS + Y;
    if (px < -60 || py < -60 || px > VW + 60 || py > VH + 60) continue;
    const isNear = near && near.id === s.id;
    if (/^(door|exit|bed|hbed|chair|seat)$/.test(s.type) && !isNear) continue;
    if (s.type === 'door' && s.house !== undefined) continue;
    ctx.font = `${Math.round(TS * (isNear ? .7 : .55))}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(s.type === 'door' ? '🚪' : s.icon, px, py - TS * (s.type === 'lot' || s.type === 'gate' ? 1.1 : 1.7) + Math.sin(t / 380 + s.x) * 3);
    if (s.type === 'gate') sign(`${s.icon} ${s.label}`, px, py - TS * 1.8, { size: TS * .3, bg: 'rgba(40,90,150,.92)' });
  }
  drawBobber(X, Y, t);
  FX.draw(ctx, X, Y, TS);
  drawGuide(X, Y, t);
  if (myRoom) drawRoomLabels(myRoom, X, Y, t);
  if (!myRoom) drawRain(t);
  // inside: no day/night, but the office turns its lights off after work hours
  let dark = myRoom ? 0 : night;
  if (myRoom && myRoom.rk === 'office') { const h = hourNow(); if (h >= G.shift.end || h < 6) dark = 0.62; }
  if (dark > 0.01) { ctx.fillStyle = `rgba(8,12,48,${dark})`; ctx.fillRect(0, 0, VW, VH); if (!myRoom) drawLights(X, Y, dark); }
  if (myRoom && myRoom.rk === 'office' && dark > 0) sign('💡 ไฟปิดแล้ว (เลิกงาน 17:00)', VW / 2, VH * .2, { size: 14 });
  // short fade through black when you go through a door or a gate
  const fp = (performance.now() - fadeT) / 350;
  if (fp < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fp})`; ctx.fillRect(0, 0, VW, VH); }
  drawMini();
}
function drawPlot(s, px, py, t) {
  const lot = wd?.lots?.[s.lot], isNear = near && near.id === s.id;
  const unlocked = lot && s.n < lot[1];
  if (isNear) { ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 3; ctx.strokeRect(px - TS, py - TS, TS * 2, TS * 2); }
  if (!unlocked) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px - TS, py - TS, TS * 2, TS * 2); ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText(lot ? '🔒' : '', px, py); return; }
  const pl = lot[2][s.n];
  if (!pl) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = `700 ${Math.round(TS * .6)}px sans-serif`; ctx.fillText('+', px, py); return; }
  const [crop, readyAt] = pl, it = G.items[crop], total = G.crops[crop].grow * 1000;
  const left = readyAt - (Date.now() + clockOff);
  if (left > 0) { const prog = clamp(1 - left / total, 0, 1); ctx.font = `${Math.round(TS * (.35 + prog * .5))}px serif`; ctx.fillText('🌱', px, py); }
  else { ctx.font = `${Math.round(TS * .95)}px serif`; ctx.fillText(it.icon, px, py + Math.sin(t / 250) * 2); ctx.font = `${Math.round(TS * .4)}px serif`; ctx.fillText('✨', px + TS * .55, py - TS * .55 + Math.sin(t / 200) * 3); }
}
const SKIN = ['#f3cfa6', '#e2b084', '#c98f60', '#8f5c3c'], HAIR = ['#2b1d14', '#5a3a22', '#b8692a', '#e5c15a', '#1c1c30', '#6d3b8f', '#c9473f', '#ececec'];
function drawPlayer(p, X, Y, t) {
  const px0 = (p.rx + (p.ox || 0)) * TS + X; let py0 = (p.ry + (p.oy || 0)) * TS + Y + TS * .32;
  if (px0 < -80 || py0 < -120 || px0 > VW + 80 || py0 > VH + 120) return;
  const u = TS / 16, id = p.id || 1, skin = SKIN[id % 4], hair = HAIR[(id * 3 + p.av) % HAIR.length];
  const shirt = COLORS[p.av] || '#999', pants = shade(shirt, -.55), dark = '#1d1a22';
  const pose = p.pose, lying = pose === 'bed' || pose === 'hosp' || pose === 'veg', sitting = pose === 'seat' || pose === 'chair' || pose === 'rest';
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
  const badge = pose === 'veg' ? '🥬' : pose === 'hosp' ? '🚑' : pose === 'rest' || pose === 'bed' ? '💤' : '';
  if (badge) { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(badge, px + 7 * u, top + Math.sin(t / 300) * 3); }
  sign(`${CAREER_ICON(p.c)} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,201,77,.95)' : 'rgba(18,22,28,.78)', color: mine ? '#222' : '#fff' });
  if (p.title) { ctx.font = `800 ${Math.round(TS * .22)}px 'Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, top - TS * .58); ctx.fillStyle = '#ffd34d'; ctx.fillText(`«${p.title}»`, px, top - TS * .58); }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Noto Sans Thai',sans-serif`;
    const w = ctx.measureText(txt).width + 16, by = top - TS * (p.title ? 1.12 : .86), bh = TS * .5;
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
    const q = outPos(p.rx, p.ry); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    g.fillStyle = p.id === myId ? '#fff' : COLORS[p.av]; const s = p.id === myId ? 5 : 3; g.fillRect((q.x - A.x) * 2 - s / 2, (q.y - A.y) * 2 - s / 2, s, s);
  }
  $('#miniName').textContent = `🗺️ ${A.name}`;
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
function bindPanel(root) {
  root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    FX.play('click');
    const m = JSON.parse(b.dataset.m);
    if (m.fn) return FN[m.fn](m, root);
    send(m);
  });
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (i.value.trim()) send({ t: 'chat', text: i.value }); i.value = ''; };
  const cf = root.querySelector('#callForm'); if (cf) cf.onsubmit = e => { e.preventDefault(); const i = $('#callIn'); if (i.value.trim()) send({ t: 'call_msg', text: i.value }); i.value = ''; };
  const ms = root.querySelector('#mSearch'); if (ms) ms.oninput = () => { panel.q = ms.value; refreshPanel(true); };
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  mtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  list(m, root) { const v = Math.floor(+root.querySelector('#lp_' + m.item).value || 0); send({ t: 'act', st: m.st, a: 'list', item: m.item, qty: m.qty, price: v }); },
  bank(m, root) { const v = m.all ? m.all : +root.querySelector('#bankAmt').value || 0; send({ t: 'act', st: m.st, a: m.op, amt: v }); },
  price(m, root) { send({ t: 'act', st: m.st, a: m.op, price: m.zero ? 0 : +root.querySelector('#' + m.inp).value || 0 }); },
  guide(m) { closePanel(); setGuide(m.key); },
  guidePt(m) { closePanel(); guide = { x: m.x, y: m.y, area: m.area, label: m.label }; toast(`นำทางไป ${m.label}`, '📍'); },
  tut() { closePanel(); showTut(0); },
  map() { closePanel(); openMap(); },
  logout() { localStorage.removeItem('lt_creds'); wantLogin = false; location.reload(); },
  toggle(m) { FX.setOpt(m.k, !FX.opts[m.k]); paintMute(); refreshPanel(true); },
  tradeReq(m) { send({ t: 'req', kind: 'trade', to: m.to }); closePanel(); },
  heal(m, root) { send({ t: 'req', kind: 'heal', to: m.to, fee: +root.querySelector('#feeIn').value || 0 }); closePanel(); },
  addContact(m, root) { send({ t: 'contact_add', phone: m.phone || root.querySelector('#phIn').value }); },
  order(m, root) { send({ t: 'order', item: m.item, tip: +(root.querySelector('#tipIn')?.value || 0) }); },
};
const itemRow = (id, right, sub = '') => { const it = G.items[id]; return `<div class="item"><div class="em">${it.icon}</div><div class="nm">${esc(it.name)}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; };
function itemRowRaw(icon, name, sub, right) { return `<div class="item"><div class="em">${icon}</div><div class="nm">${name}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; }
const eatText = e => [e.hunger && `อิ่ม+${e.hunger}`, e.energy && `⚡+${e.energy}`, e.health && `❤️+${e.health}`].filter(Boolean).join(' ');
const chatHtml = () => chatLog.map(m => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');
const hoursTxt = k => { const o = G.hours[k]; return o ? (o[1] - o[0] >= 24 ? 'เปิด 24 ชม.' : `เปิด ${hhmm(o[0])}–${hhmm(o[1])}`) : ''; };
const lic = id => me.licenses.includes(id);
// "apply for this job here" block, shown in every building that hires
function applyBox(career, st) {
  const c = G.careers[career];
  if (me.career === career) return `<div class="jobbox ok">${c.icon} คุณทำงานเป็น<b>${c.name}</b>ที่นี่ · Lv.${me.lv}</div>`;
  const miss = (c.need || []).filter(l => !lic(l)).map(l => G.licenses[l].name);
  if (c.vehicle && !(me.vehicles || []).some(v => v === c.vehicle || v === 'car')) miss.push(G.shop.vehicles[c.vehicle].name);
  const wait = me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ เพิ่งเปลี่ยนงาน ต้องรออีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : '';
  return `<div class="jobbox"><b>📝 รับสมัคร ${c.icon} ${c.name}</b><div class="sub">${c.desc}</div>
    ${miss.length ? `<div class="sub" style="color:var(--bad)">ต้องมี: ${miss.join(', ')}</div>` : ''}${wait}
    ${me.career !== 'none' ? `<div class="sub">ตอนนี้คุณเป็น${G.careers[me.career].name} สมัครงานนี้ = ลาออกจากงานเดิม</div>` : ''}
    ${B(`✍️ สมัครงาน${c.name}`, { t: 'act', st, a: 'apply', career }, 'primary big', miss.length > 0 || me.jobWait > 0)}</div>`;
}
const needCareer = c => me.career === c ? '' : `<div class="sub" style="color:var(--bad)">⚠️ ต้องเป็น ${G.careers[c].icon} ${G.careers[c].name} ก่อน</div>`;

function renderPanel(p) {
  const k = p.kind, st = p.st;
  switch (k) {
    case 'office': {
      const l = Math.min(me.career === 'office' ? me.lv : 1, G.titles.length), wage = G.wages[l - 1];
      const o = me.office, today = Math.floor((Date.now() + clockOff + (wd?.toff || 0)) / G.dayMs);
      let status = '';
      if (me.career === 'office') {
        const state = o && o.day === today ? (o.closed === today ? '✅ เลิกงานแล้ว' : `🟢 เข้างานแล้ว${o.late ? ' (สาย)' : ''} · ${o.hours.toFixed(1)} ชม.`) : '⚪ ยังไม่ลงเวลาเข้างาน';
        status = `<div class="item" style="display:block">ตำแหน่ง <b>${G.titles[l - 1]}</b> · ค่าแรง <b>${money(wage)}</b>/ชม.<br>วันนี้: ${state}<br>มาสาย/ขาดงานสะสม: <b style="color:${(o?.strikes || 0) >= 2 ? 'var(--bad)' : 'inherit'}">${o?.strikes || 0}</b> ครั้ง (3 ครั้งขึ้นไปมีโอกาสถูกเลิกจ้าง)</div>
          <div class="sub" style="margin-top:8px">💺 เดินไปที่ <b>โต๊ะทำงาน</b> ตัวไหนก็ได้แล้วกดนั่ง · เข้างาน ${hhmm(G.shift.start)} (สายได้ถึง ${hhmm(G.shift.grace)}) · เลิก ${hhmm(G.shift.end)}</div>
          ${B('📦 ลาออก', { t: 'resign' }, 'warn')}`;
      }
      return `<h2>🏢 บริษัท ไทยเทค · ฝ่ายบุคคล</h2><div class="sub">${hoursTxt('office')} · เวลางาน ${hhmm(G.shift.start)}–${hhmm(G.shift.end)} · ได้เงินตามชั่วโมงที่นั่งทำงาน (ต้องจบปริญญาตรี)</div>${status}${me.career === 'office' ? '' : applyBox('office', st)}`;
    }
    case 'chair':
      return `<h2>💺 โต๊ะทำงาน</h2><div class="sub">สำหรับพนักงานบริษัท นั่งในเวลางาน ${hhmm(G.shift.start)}–${hhmm(G.shift.end)} เพื่อรับค่าแรง</div>${needCareer('office')}`;
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
          return itemRow(id, `<div class="col2">${B(n ? `ซื้อ ${money(m2.best)}` : 'ไม่มีของ', { t: 'act', st, a: 'buy', item: id, qty: 1 }, 'good', !n)}${B(`NPC ${money(m2.sell || 0)}`, { t: 'act', st, a: 'npcbuy', item: id, qty: 1 })}</div>`, `${pl} · ร้าน NPC ${money(m2.sell || 0)}`);
        }).join('');
        body = `<div class="sub">ซื้อจากผู้เล่นถูกที่สุดก่อนเสมอ · ร้าน NPC มีของตลอดแต่<b>แพงมาก</b></div>${search}${cats}<div class="list">${body || '<div class="sub">ไม่พบสินค้า</div>'}</div>`;
      } else if (tab === 'sell') {
        const inv = Object.entries(me.inv).filter(([id, q]) => q > 0 && match(id));
        body = inv.map(([id, q]) => {
          const it = G.items[id], m2 = mk[id] || {}, sug = m2.n ? Math.max(1, m2.best - 1) : Math.round(m2.ref || it.base);
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
    case 'warehouse': {
      const rows = Object.entries(G.items).filter(([, it]) => it.wholesale).map(([id, it]) =>
        itemRow(id, `<div>${B('ซื้อ 1', { t: 'act', st, a: 'buy', item: id, qty: 1 })}${B('x5', { t: 'act', st, a: 'buy', item: id, qty: 5 })}${B('x10', { t: 'act', st, a: 'buy', item: id, qty: 10 })}</div>`,
          `ราคาส่ง ${money(it.wholesale)} · ราคาตลาด ~${money(it.base)} · สต็อก ${wd?.stock[id] ?? '-'}`)).join('');
      return `<h2>📦 คลังสินค้าราคาส่ง</h2><div class="sub">${hoursTxt('warehouse')} · สต็อกจำกัด ทุกคนแย่งกัน · ซื้อแต่ละครั้งเสีย ⚡4 · เอาไปวางขายที่ตลาดกลาง</div>${applyBox('merchant', st)}${me.career === 'merchant' ? `<div class="list">${rows}</div>` : ''}`;
    }
    case 'rider': return `<h2>🛵 ศูนย์ไรเดอร์ส่งอาหาร</h2><div class="sub">${hoursTxt('rider')} · ต้องมีใบขับขี่และมอเตอร์ไซค์ · รับออเดอร์ผ่านแอพในมือถือ 📱</div>${applyBox('rider', st)}${me.career === 'rider' ? riderJobs() : ''}`;
    case 'restaurant': {
      const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, B(`กินเลย ${money(it.base)}`, { t: 'act', st, a: 'eat', item: id }, 'good'), eatText(it.eat))).join('');
      const pick = me.career === 'rider' ? (() => { const n = (me.jobs || []).filter(j => j.mine && j.state === 'taken').length; return `<div class="jobbox">${B(n ? `🥡 รับอาหาร ${n} ออเดอร์` : 'ยังไม่มีออเดอร์ให้รับ', { t: 'act', st, a: 'pickup' }, 'primary big', !n)}</div>`; })() : '';
      return `<h2>🍜 ร้านอาหาร</h2><div class="sub">${hoursTxt('restaurant')} · สั่งให้มาส่งได้ผ่านแอพในมือถือ 📱 · ของราคาถูกอาจทำให้🤢อาหารเป็นพิษ</div>${pick}<div class="list">${rows}</div>`;
    }
    case 'kitchen': {
      const rows = G.recipes.map(r => {
        const out = G.items[r.id]; const ok = Object.entries(r.in).every(([i, q]) => (me.inv[i] || 0) >= q);
        const ing = Object.entries(r.in).map(([i, q]) => `${G.items[i].icon}${q} (มี ${me.inv[i] || 0})`).join(' + ');
        return itemRow(r.id, B('ปรุง ⚡12', { t: 'act', st, a: 'cook', rid: r.id }, ok ? 'good' : '', !ok), `${ing} · ขาย ~${money(out.base)} · ${eatText(out.eat)}`);
      }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">${hoursTxt('kitchen')} · ปรุงอาหารขายได้แพงกว่าวัตถุดิบหลายเท่า · ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง</div>${applyBox('chef', st)}${me.career === 'chef' ? `<div class="list">${rows}</div>` : ''}`;
    }
    case 'hospital': {
      const dz = me.dz || [], price = dz.length ? 1500 + 500 * (dz.length - 1) : 800, waiting = (wd?.beds || []).filter(Boolean).length;
      const mine = dz.map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, `${G.diseases[d].sym.join(' · ')}<br>${G.diseases[d].self}`, '')).join('');
      return `<h2>🏥 โรงพยาบาล</h2><div class="sub">เปิด 24 ชม. · สุขภาพ ${Math.floor(me.health)}/100 · <b>ถูกกว่า:</b> นอนที่ <b>เตียงคนไข้</b> รอหมอรักษา (~฿300) · ตอนนี้มีคนไข้ ${waiting} เตียง</div>
        ${mine ? `<div class="list">${mine}</div>` : '<div class="sub">✅ ตอนนี้คุณไม่ได้ป่วย</div>'}
        ${B(`💉 ให้พยาบาล NPC รักษาทันที ${money(price)}${dz.length ? ' (หายทุกโรค)' : ' (❤️ +40)'}`, { t: 'act', st, a: 'heal' }, 'big')}
        ${me.career === 'doctor' ? '<div class="jobbox ok">🩺 คุณเป็นแพทย์ · เดินไปที่เตียงที่มีคนไข้ (ทั้งผู้เล่นและชาวเมือง) แล้ววินิจฉัยจากอาการ</div>' : applyBox('doctor', st)}`;
    }
    case 'bed': {
      const s = STN(st), b = wd?.beds?.[s.idx];
      if (me.career === 'doctor' && b && b[1] !== myId) {
        const [name, , sym, hp, n, npc, dn] = b;
        if (dn) return `<h2>🚨 ${esc(name)} หมดสติ!</h2><div class="sub">ต้องช่วยให้ฟื้นก่อน แล้วค่อยวินิจฉัยโรค</div>${B('💓 ปั๊มหัวใจ / ช่วยให้ฟื้น (⚡8)', { t: 'act', st, a: 'revive' }, 'primary big pulse')}`;
        const opts = n ? Object.entries(G.treatments).map(([k, tr]) => B(`${tr.icon} ${tr.name}`, { t: 'act', st, a: 'treat', tx: k }, 'good')).join('') : B('🩺 ตรวจร่างกาย + ให้ยาบำรุง', { t: 'act', st, a: 'treat', tx: 'checkup' }, 'good');
        return `<h2>🛏️ คนไข้: ${esc(name)}${npc ? ' <span class="tag">ชาวเมือง</span>' : ''}</h2><div class="sub">สุขภาพ ${hp}/100 ${n > 1 ? `· ป่วย ${n} โรค (รักษาทีละโรค)` : ''}</div>
          <div class="item" style="display:block"><b>อาการที่พบ:</b><br>${sym.length ? sym.map(x => '• ' + esc(x)).join('<br>') : 'ไม่มีอาการป่วย แค่อ่อนแรง'}</div>
          <div class="sub" style="margin-top:10px">${n ? 'วินิจฉัยจากอาการแล้วเลือกการรักษาที่ถูกต้อง (⚡8) ถูก = ได้ค่ารักษา · ผิด = คนไข้สุขภาพลด' : ''}</div><div class="list">${opts}</div>`;
      }
      if (b && b[1] === myId) return `<h2>🛏️ คุณนอนรอหมออยู่</h2><div class="sub">หมอออนไลน์จะได้รับแจ้งเตือน · เดินออกเพื่อลุกจากเตียง</div>${(me.dz || []).map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, G.diseases[d].sym.join(' · '), '')).join('')}`;
      if (b) return `<h2>🛏️ เตียงนี้มีคนไข้แล้ว</h2><div class="sub">${esc(b[0])} นอนรอหมออยู่</div>`;
      return `<h2>🛏️ เตียงคนไข้</h2><div class="sub">นอนรอให้หมอผู้เล่นมาวินิจฉัยและรักษา (ถูกกว่าเคาน์เตอร์มาก)</div>${B('🛏️ นอนรอหมอ', { t: 'act', st, a: 'lie' }, 'primary big')}`;
    }
    case 'hbed': {
      const s = STN(st), h = wd?.houses?.[s.idx], own = me.house === s.idx && !(h && h[5]), rent = me.rent && me.rent.idx === s.idx;
      return own || rent ? `<h2>🛏️ เตียงนอน</h2><div class="sub">นอนแล้วได้พลังงาน หายง่วง หายอ่อนเพลีย (ทุก 2 นาที)</div>${B(`😴 นอนพัก (+${50 + (own ? me.comfort * 2 : 0)}⚡)`, { t: 'act', st, a: 'sleep' }, 'primary big')}` : '<h2>🛏️ เตียงนอน</h2><div class="sub">นอนได้เฉพาะเจ้าของบ้านหรือผู้เช่า</div>';
    }
    case 'school': {
      const L = G.licenses, deg = lic('degree');
      const degRow = deg ? itemRowRaw('🎓', 'ปริญญาตรี', 'เรียนจบแล้ว ✓', '<span class="tag">จบแล้ว</span>')
        : me.enrolled ? itemRowRaw('📖', `ปริญญาตรี (เรียนอยู่ ${me.classes}/${L.degree.classes} คาบ)`, `<div class="qbar"><i style="width:${me.classes / L.degree.classes * 100}%"></i></div>คาบละ ⚡15 · เข้าได้ทุก 1 ชั่วโมงในเกม`, B('📖 เข้าเรียน', { t: 'act', st, a: 'class' }, 'good'))
        : itemRowRaw('🎓', 'ปริญญาตรี', `ค่าเทอม ${money(L.degree.price)} · เรียน ${L.degree.classes} คาบ · ปลดล็อกงานบริษัท และเรียนต่อแพทย์`, B(`ลงทะเบียน ${money(L.degree.price)}`, { t: 'act', st, a: 'enroll' }, 'good'));
      const rows = ['cooking', 'medicine'].map(id => {
        const l = L[id], has = lic(id), blocked = l.need && !lic(l.need);
        const c = Object.values(G.careers).find(c => (c.need || []).includes(id));
        return itemRowRaw(l.icon, l.name, `ปลดล็อกอาชีพ ${c.name}${l.need ? ` · ต้องจบ${L[l.need].name}ก่อน` : ''}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(l.price), { t: 'act', st, a: 'learn', lic: id }, 'good', blocked));
      }).join('');
      return `<h2>🎓 มหาวิทยาลัย</h2><div class="sub">${hoursTxt('school')} · เรียนให้จบเพื่อสมัครงานที่ดีขึ้น</div><div class="list">${degRow}${rows}</div>`;
    }
    case 'bag': {
      const rows = Object.entries(me.inv).map(([id, q]) => { const it = G.items[id]; return itemRow(id, it.eat ? B('ใช้', { t: 'use', item: id }, 'good') : '', `x${q} · ~${money(it.base)}${it.eat ? ' · ' + eatText(it.eat) : ''}`); }).join('');
      const licTxt = me.licenses.map(l => G.licenses[l].icon + G.licenses[l].name).join(', ') || 'ไม่มี';
      const veh = (me.vehicles || []).map(v => G.shop.vehicles[v].icon).join(' ') || '—';
      const tools = Object.entries(me.tools || {}).map(([c, t]) => `${G.shop.tools[c]?.icon || ''}${'★'.repeat(t)}`).join(' ') || '—';
      const home = me.house >= 0 ? `บ้านเลขที่ ${me.house + 1} ⭐${me.comfort}` : me.rent ? `เช่าบ้านเลขที่ ${me.rent.idx + 1}` : 'ยังไม่มี';
      const own = `<div class="grid2" style="margin:6px 0"><div class="item"><div class="nm">🚗 ยานพาหนะ<small>${veh}</small></div></div><div class="item"><div class="nm">🛠️ อุปกรณ์<small>${tools}</small></div></div><div class="item"><div class="nm">🏠 บ้าน<small>${home}</small></div>${me.house >= 0 || me.rent ? B('📍', { fn: 'guide', key: 'door_house' + (me.house >= 0 ? me.house : me.rent.idx) }) : ''}</div><div class="item"><div class="nm">🌾 สวน<small>${me.garden ? `แปลงที่ ${me.garden.lot + 1} · ${me.garden.n} แปลงปลูก` : 'ยังไม่มี'}</small></div>${me.garden ? B('📍', { fn: 'guide', key: 'lot' + me.garden.lot }) : ''}</div><div class="item"><div class="nm">🏦 ธนาคาร<small>${money(me.bank)}${me.loan ? ` · หนี้ ${money(me.loan)}` : ''}</small></div></div><div class="item"><div class="nm">📱 เบอร์ของฉัน<small>${me.phone}</small></div></div></div>`;
      return `<h2>🎒 กระเป๋า</h2><div class="sub">ใบรับรอง: ${licTxt} · ทรัพย์สินรวม ${money(me.worth)}</div>${own}<div class="list">${rows || '<div class="sub">ยังไม่มีของ</div>'}</div>`;
    }
    case 'career': {
      const cur = G.careers[me.career];
      const rows = Object.entries(G.careers).filter(([id]) => id !== 'none').map(([id, c]) => {
        const where = STN(c.where);
        const miss = (c.need || []).filter(l => !lic(l)).map(l => G.licenses[l].name);
        if (c.vehicle && !(me.vehicles || []).some(v => v === c.vehicle || v === 'car')) miss.push(G.shop.vehicles[c.vehicle].name);
        return itemRowRaw(c.icon, `${c.name}${me.career === id ? ' <span class="tag">ปัจจุบัน</span>' : ''}`, `สมัครที่: <b>${where?.label || '-'}</b>${miss.length ? ` · <span style="color:var(--bad)">ต้องมี ${miss.join(', ')}</span>` : ''}<br>${c.desc}`, B('📍 ไป', { fn: 'guide', key: c.where }, 'good'));
      }).join('');
      return `<h2>💼 งานของฉัน</h2>
        <div class="jobbox ${me.career === 'none' ? '' : 'ok'}">${me.career === 'none' ? '🙂 ตอนนี้ยัง<b>ว่างงาน</b> — เดินเข้าไปสมัครงานในอาคารต่างๆ ได้เลย' : `${cur.icon} <b>${cur.name}</b> · Lv.${me.lv}`}
        ${me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ สมัครงานใหม่ได้ในอีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : ''}
        ${me.career !== 'none' ? B('📦 ลาออก', { t: 'resign' }, 'warn') : ''}</div>
        <div class="sub" style="margin-top:8px">⚠️ เปลี่ยนงานบ่อยต้องรอนานขึ้นเรื่อยๆ (10 นาที → 30 → 1 ชม. → 2 ชม. ...)</div><div class="list">${rows}</div>`;
    }
    case 'toolshop': {
      const order = [me.career, ...Object.keys(G.shop.tools).filter(c => c !== me.career)].filter(c => G.shop.tools[c]);
      const rows = order.map(c => {
        const d = G.shop.tools[c], t = (me.tools || {})[c] || 0, cc = G.careers[c];
        const sub = t >= 3 ? `สูงสุดแล้ว · ${d.fx[2]}` : `ถัดไป: ${d.fx[t]}${t ? ` · ตอนนี้: ${d.fx[t - 1]}` : ''}`;
        return itemRowRaw(d.icon, `${d.name} <span class="tag">${cc.icon} ${cc.name}</span> <span style="color:var(--acc)">${'★'.repeat(t)}${'☆'.repeat(3 - t)}</span>`, sub,
          t >= 3 ? '<span class="tag">MAX</span>' : B(money(G.shop.toolPrices[t]), { t: 'act', st, a: 'buy', career: c }, c === me.career ? 'good' : ''));
      }).join('');
      return `<h2>🛠️ ร้านอุปกรณ์</h2><div class="sub">${hoursTxt('toolshop')} · อัปเกรดอุปกรณ์ให้หาเงินได้มากขึ้น · อัปได้ 3 ระดับ</div><div class="list">${rows}</div>`;
    }
    case 'dealer': {
      const best = Object.entries(G.shop.vehicles).filter(([k]) => (me.vehicles || []).includes(k)).sort((a, b) => b[1].speed - a[1].speed)[0]?.[0];
      const rows = Object.entries(G.shop.vehicles).map(([k, v]) => {
        const has = (me.vehicles || []).includes(k), needL = v.license && !lic(v.license);
        return itemRowRaw(v.icon, `${v.name}${best === k ? ' <span class="tag">กำลังใช้</span>' : ''}`, `เร็วขึ้น x${v.speed}${v.license ? ' · ต้องมีใบขับขี่' : ''}`, has ? '<span class="tag">มีแล้ว ✓</span>' : B(money(v.price), { t: 'act', st, a: 'buy', veh: k }, 'good', needL));
      }).join('');
      return `<h2>🚗 โชว์รูมรถ & สอบใบขับขี่</h2><div class="sub">${hoursTxt('dealer')}</div>
        ${lic('driving') ? '<div class="jobbox ok">🪪 คุณมีใบขับขี่แล้ว</div>' : `<div class="jobbox"><b>🪪 สอบใบขับขี่</b> ค่าสอบ ${money(G.licenses.driving.price)} · ตอบคำถามจราจร 3 ข้อ ต้องถูกทุกข้อ${B('📝 เริ่มสอบ', { t: 'act', st, a: 'test' }, 'primary big')}</div>`}
        <div class="list">${rows}</div>`;
    }
    case 'bank': {
      const bk = G.shop.bank;
      return `<h2>🏦 ธนาคาร</h2><div class="sub">${hoursTxt('bank')} · ดอกเบี้ย <b>${bk.rate * 100}% ต่อวัน</b> (บนยอดไม่เกิน ${money(bk.cap)})</div>
        <div class="grid2"><div class="item"><div class="nm">💵 เงินสด<small><b style="color:var(--acc);font-size:16px">${money(me.money)}</b></small></div></div><div class="item"><div class="nm">🏦 เงินฝาก<small><b style="color:var(--ok);font-size:16px">${money(me.bank)}</b></small></div></div></div>
        <div class="rowf" style="margin-top:10px"><input id="bankAmt" type="number" min="1" value="1000" inputmode="numeric"></div>
        <div class="grid2" style="margin-top:8px">${B('⬇️ ฝาก', { fn: 'bank', st, op: 'deposit' }, 'good')}${B('⬆️ ถอน', { fn: 'bank', st, op: 'withdraw' })}${B('ฝากทั้งหมด', { fn: 'bank', st, op: 'deposit', all: Math.floor(me.money) })}${B('ถอนทั้งหมด', { fn: 'bank', st, op: 'withdraw', all: me.bank })}</div>
        <div class="sub" style="margin-top:14px"><b>💳 กู้เงิน</b> · สูงสุด ${money(bk.loanMax)} ค่าธรรมเนียม ${bk.loanFee * 100}% · ระหว่างเป็นหนี้ ${bk.repayShare * 100}% ของรายได้ถูกหักใช้หนี้อัตโนมัติ</div>
        <div class="item"><div class="nm">หนี้คงเหลือ<small><b style="color:${me.loan ? 'var(--bad)' : 'var(--ok)'};font-size:16px">${money(me.loan)}</b></small></div>${B('กู้', { fn: 'bank', st, op: 'borrow' })}${B('ใช้คืน', { fn: 'bank', st, op: 'repay' }, me.loan ? 'good' : '', !me.loan)}</div>`;
    }
    case 'pier': {
      const s = STN(st), c = me.cast, pool = G.fish[s.pool] || [];
      let btn;
      if (!c) btn = B('🎣 เหวี่ยงเบ็ด (⚡8)', { t: 'act', st, a: 'cast' }, 'primary big');
      else if (c.state === 'wait') btn = `<div class="sub" style="text-align:center;font-size:16px;margin:14px 0">⏳ รอปลากินเบ็ด... อย่าเพิ่งดึง!</div>${B('ดึงเบ็ด', { t: 'act', st, a: 'reel' }, 'big')}`;
      else btn = B('‼️ ปลากินเบ็ด! ดึงเลย!', { t: 'act', st, a: 'reel' }, 'big pulse');
      const fishes = pool.filter(([id]) => id).map(([id]) => `${G.items[id].icon}${G.items[id].name}`).join(' · ');
      return `<h2>🎣 ${esc(s.label)}</h2><div class="sub">ปลาแถวนี้: ${fishes} · ปลากินเบ็ดแล้วกดดึงให้ทันใน 1.7 วิ</div>${needCareer('fisher')}${btn}`;
    }
    case 'fishclub': {
      const fish = Object.entries(me.inv).filter(([id, q]) => q > 0 && G.items[id].kind === 'fish');
      const rows = fish.map(([id, q]) => itemRow(id, B(`ขาย ${money((wd?.mk[id]?.farm || 0) * q)}`, { t: 'act', st, a: 'sell', item: id, qty: 'all' }, 'good'), `มี ${q} · รับซื้อ ${money(wd?.mk[id]?.farm || 0)}/ตัว`)).join('');
      return `<h2>🎣 สมาคมประมง</h2><div class="sub">${hoursTxt('fishclub')} · แหล่งตกปลา: 🏞️ ทะเลสาบ (ใต้เมือง) · 🌊 ทะเล (ฝั่งตะวันออก) · 🐟 แม่น้ำ (ไร่ชานเมือง)</div>${applyBox('fisher', st)}
        ${fish.length ? `<div class="sub" style="margin-top:10px"><b>รับซื้อปลา</b> (ดีกว่าร้าน NPC ในตลาด แต่ถูกกว่าขายให้ผู้เล่น)</div><div class="list">${rows}</div>` : ''}`;
    }
    case 'coop':
      return `<h2>🧑‍🌾 สหกรณ์การเกษตร</h2><div class="sub">${hoursTxt('coop')} · เกษตรกรต้องมี<b>สวนของตัวเอง</b> ซื้อได้ที่ป้ายหน้าสวนแต่ละแปลง (${money(G.garden.lotPrice)} ได้ ${G.garden.startPlots} แปลงปลูก ขยายได้ถึง ${G.garden.maxPlots})</div>${applyBox('farmer', st)}
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
    case 'gate': return `<h2>${STN(st).icon} ${STN(st).label}</h2>${B('เดินทาง', { t: 'act', st, a: 'go' }, 'primary big')}`;
    case 'seat': return `<h2>🪑 ที่นั่ง</h2>${B('นั่งพัก', { t: 'act', st, a: 'sit' }, 'primary big')}`;
    case 'quests': {
      const q = me.quests; if (!q) return '';
      const rows = q.list.map((x, i) => {
        const c = x.career ? G.careers[x.career] : null, wrong = c && me.career !== x.career;
        const icon = x.done ? '✅' : c ? c.icon : { trade: '🤝', chat: '💬', eat: '🍛', sell: '🏪', earn: '💰', sit: '🪑' }[x.type] || '📜';
        const tgt = x.type === 'earn' ? CAREER_TARGET[me.career] : QUEST_TARGET[x.type];
        const btn = x.done ? '<span class="tag">สำเร็จ</span>' : `<div class="col2">${tgt ? B('📍 ไป', { fn: 'guide', key: tgt }, 'good') : ''}${B('🔄', { t: 'quest_reroll', i }, '', q.rerolled)}</div>`;
        return `<div class="item ${x.done ? 'done' : ''}"><div class="em">${icon}</div><div class="nm">${esc(x.text)}<small>${x.p.toLocaleString()}/${x.n.toLocaleString()} · รางวัล <b style="color:var(--acc)">${money(x.reward)}</b>${wrong ? ` · ต้องเป็น${c.name}` : ''}</small><div class="qbar"><i style="width:${Math.round(x.p / x.n * 100)}%"></i></div></div>${btn}</div>`;
      }).join('');
      return `<h2>📜 เควสต์ประจำวัน</h2><div class="sub">เควสต์ใหม่ในอีก <b class="qcd" data-t="${q.resetAt}"></b> (เที่ยงคืนเวลาไทย)${q.streak ? ` · 🔥 ทำครบติดต่อกัน ${q.streak} วัน` : ''}</div>
        <div class="list">${rows}</div>
        <div class="item ${q.bonus ? 'done' : ''}" style="margin-top:10px"><div class="em">🏆</div><div class="nm">ทำครบทั้ง 3 ข้อ<small>โบนัส <b style="color:var(--acc)">${money(q.bonusAmount)}</b> · ทำครบติดต่อกันทุกวัน โบนัส +10%/วัน</small></div>${q.bonus ? '<span class="tag">ได้แล้ว</span>' : ''}</div>`;
    }
    case 'ach': {
      const rows = G.ach.map(a => {
        const has = (me.ach || []).includes(a.id), c = a.c ? G.careers[a.c] : null, prog = Math.min(a.n, me.stats?.[a.stat] || 0);
        const on = me.title === a.id;
        return `<div class="item ${has ? 'done' : ''}"><div class="em">${has ? '🏅' : '🔒'}</div><div class="nm">«${esc(a.title)}» ${c ? `<span class="tag">${c.icon} ${c.name}</span>` : ''}<small>${a.desc} · ${prog.toLocaleString()}/${a.n.toLocaleString()}</small></div>${has ? B(on ? 'ใช้อยู่ ✓' : 'ใช้ฉายานี้', { t: 'title', id: on ? '' : a.id }, on ? 'primary' : 'good') : ''}</div>`;
      }).join('');
      return `<h2>🏅 ความสำเร็จ & ฉายา</h2><div class="sub">ทำความสำเร็จของแต่ละอาชีพเพื่อปลดล็อก<b>ฉายาบนหัว</b> ทุกคนในเมืองจะเห็น · ปลดล็อกแล้ว ${(me.ach || []).length}/${G.ach.length}</div><div class="list">${rows}</div>`;
    }
    case 'phone': return phonePanel(p);
    case 'rank': {
      const rows = (wd?.lb || []).map((r, i) => itemRowRaw(['🥇', '🥈', '🥉'][i] || `${i + 1}.`, `${esc(r.name)} <span class="tag">${CAREER_ICON(r.c)}</span>${r.on ? ' 🟢' : ''}${r.ti ? ` <small style="display:inline;color:var(--acc)">«${esc(r.ti)}»</small>` : ''}`, '', `<b>${money(r.w)}</b>`)).join('');
      return `<h2>🏆 อันดับเศรษฐี</h2><div class="sub">นับเงินสด + เงินฝาก + ทรัพย์สิน</div><div class="list">${rows}</div>`;
    }
    case 'chat':
      return `<h2>💬 คุยกับคนใกล้ๆ</h2><div class="sub">ข้อความจะลอยเป็นบับเบิ้ลบนหัว เฉพาะคนที่อยู่ใกล้คุณ (~14 ช่อง) เท่านั้นที่เห็น · คุยไกลๆ ใช้ 📱 โทรหา</div><div id="chatMsgs">${chatHtml()}</div><form id="chatForm" class="rowf"><input id="chatIn" maxlength="120" placeholder="พิมพ์ข้อความ..." autocomplete="off"><button class="primary" type="submit">ส่ง</button></form>`;
    case 'help':
      return `<h2>❔ วิธีเล่น</h2><div class="sub" style="font-size:14px;line-height:1.7">
        👣 <b>เดิน</b>: มือถือแตะค้างแล้วลาก · คอม WASD/ลูกศร<br>
        🚪 <b>เข้าอาคาร/ใช้งาน</b>: เดินไปหน้าประตูหรือจุดที่มีไอคอน แล้วกด<b>ปุ่มกลมสีเหลือง</b> (คอม: E)<br>
        💼 <b>หางาน</b>: เริ่มต้นว่างงาน เดินเข้าไปสมัครงานในอาคาร (เมนู 💼 บอกว่าแต่ละงานสมัครที่ไหน)<br>
        🕐 <b>เวลา</b>: 1 วันในเกม = 24 นาที · ร้านต่างๆ มีเวลาเปิด-ปิด · ออฟฟิศเข้างาน 08:00<br>
        😌 <b>พัก</b>: ไม่มีบ้านก็นั่งพักหลับตาได้ทุกที่ (ปุ่ม 😌 / R) พลังงานฟื้นเร็ว 3 เท่า<br>
        ❤️ <b>สุขภาพ</b>: หิวนานเลือดลด · ป่วยต้องหาหมอ · เลือดหมด = หมดสติถูกส่งโรงพยาบาล (หิวจนหมด = ล้มนอนเป็นผัก)<br>
        📱 <b>มือถือ</b>: บันทึกเบอร์เพื่อน โทรหา สั่งอาหาร · 🏅 ทำความสำเร็จได้ฉายาบนหัว</div>
        <div class="grid2">${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'good' : '')}${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🎵 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'good' : '')}</div>
        <div class="grid2" style="margin-top:8px">${B('📖 ดูบทช่วยสอน', { fn: 'tut' })}${B('🗺️ เปิดแผนที่', { fn: 'map' })}</div>
        ${B('🚪 ออกจากระบบ', { fn: 'logout' }, 'warn big')}`;
    case 'player': {
      const o = P.get(p.pid); if (!o) return '';
      const m = P.get(myId); const d = Math.hypot(o.x - m.x, o.y - m.y), far = d > 5.5;
      const fee = `<input id="feeIn" type="number" value="200" min="0" max="1000" style="width:90px">`;
      return `<h2>${esc(o.name)} <span class="tag">${CAREER_ICON(o.c)} ${G.careers[o.c]?.name || ''}</span></h2>${o.title ? `<div class="sub" style="color:var(--acc)">«${esc(o.title)}»</div>` : ''}
        <div class="sub">${far ? '⚠️ อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน' : 'อยู่ใกล้พอที่จะติดต่อกันได้'}</div>
        ${B('🤝 ขอแลกเปลี่ยน (ของ/เงิน)', { fn: 'tradeReq', to: o.id }, 'primary big', far)}
        ${me.career === 'doctor' ? `<div class="rowf" style="margin-top:8px">ค่ารักษา ${fee} ${B('💉 เสนอปฐมพยาบาล', { fn: 'heal', to: o.id }, 'good', far)}</div>` : ''}
        <div class="sub" style="margin-top:10px">📱 ขอเบอร์โทรได้จากเจ้าตัว แล้วบันทึกในแอพรายชื่อ</div>`;
    }
  }
  return '';
}
function houseDoor(s, st) {
  const i = s.house, h = wd?.houses?.[i]; if (!h) return '';
  const [owner, cf, furn, sale, rentP, tenant, until] = h, price = G.shop.housePrices[i], rent = G.shop.houseRent[i];
  const mine = me.house === i, iRent = me.rent && me.rent.idx === i;
  const enter = B('🚪 เข้าบ้าน', { t: 'enter', st }, 'primary big');
  const days = r => `<div class="grid3">${[1, 3, 7].map(d => B(`${d} วัน ${money(r * d)}`, { t: 'act', st, a: 'rent', days: d }, 'good')).join('')}</div>`;
  const left = until ? Math.max(0, Math.round((until - Date.now() - clockOff) / G.dayMs * 10) / 10) : 0;
  if (mine) {
    const rows = Object.entries(G.shop.furniture).map(([k, f]) => itemRowRaw(f.icon, f.name, `ความสบาย +${f.comfort}`, me.furniture.includes(k) ? '<span class="tag">มีแล้ว ✓</span>' : B(money(f.price), { t: 'act', st, a: 'furnish', item: k }, 'good'))).join('');
    return `<h2>🏠 บ้านของคุณ (เลขที่ ${i + 1})</h2><div class="sub">ความสบาย ⭐ <b>${me.comfort}</b> → พลังงานฟื้นเร็วขึ้น +${me.comfort * 3}% · ${tenant ? `ผู้เช่า: ${esc(tenant)} (อีก ${left} วัน)` : 'ไม่มีผู้เช่า'}</div>${enter}
      <div class="sub" style="margin-top:12px"><b>🪧 ประกาศขายให้ผู้เล่น</b> ${me.houseSale ? `(ตอนนี้ ${money(me.houseSale)})` : ''}</div>
      <div class="rowf"><input id="saleIn" type="number" value="${me.houseSale || price}">${B('ประกาศขาย', { fn: 'price', st, op: 'list', inp: 'saleIn' }, 'good')}${me.houseSale ? B('ยกเลิก', { fn: 'price', st, op: 'list', zero: 1 }) : ''}</div>
      <div class="sub" style="margin-top:8px"><b>🔑 ปล่อยเช่า</b> ต่อวัน ${me.houseRent ? `(ตอนนี้ ${money(me.houseRent)})` : ''}</div>
      <div class="rowf"><input id="rentIn" type="number" value="${me.houseRent || rent}">${B('ปล่อยเช่า', { fn: 'price', st, op: 'rentout', inp: 'rentIn' }, 'good')}${me.houseRent ? B('ยกเลิก', { fn: 'price', st, op: 'rentout', zero: 1 }) : ''}</div>
      <div class="sub" style="margin-top:12px"><b>🛋️ แต่งบ้าน</b></div><div class="list">${rows}</div>
      <div style="margin-top:14px">${B('ขายบ้านคืนโครงการ (ได้คืน ~70%)', { t: 'act', st, a: 'sell' }, 'warn')}</div>`;
  }
  let body = `<div class="sub">ความสบาย ⭐ ${cf} ${furn.length ? furn.map(k => G.shop.furniture[k].icon).join('') : ''}</div>`;
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
  const tabs = `<div class="tabs">${[['contacts', '📇 รายชื่อ'], ['call', call ? '📞 กำลังคุย' : '📞 โทร'], ['food', '🍔 สั่งอาหาร'], ...(me.career === 'rider' ? [['rider', '🛵 ไรเดอร์']] : [])].map(([k, l]) => B(l, { fn: 'mtab', set: { tab: k } }, tab === k ? 'primary' : '')).join('')}</div>`;
  let body = '';
  if (tab === 'contacts') {
    const online = new Set([...P.values()].map(x => x.name));
    const rows = (me.contacts || []).map(c => itemRowRaw(online.has(c.n) ? '🟢' : '⚪', esc(c.n), c.p, `<div class="rowf">${B('📞', { t: 'call', phone: c.p }, 'good', !!call)}${B('🗑️', { t: 'contact_del', phone: c.p })}</div>`)).join('');
    body = `<div class="jobbox">📱 เบอร์ของคุณ: <b style="font-size:18px;letter-spacing:2px">${me.phone}</b><div class="sub">บอกเบอร์นี้ให้เพื่อน แล้วเพื่อนจะบันทึกและโทรหาคุณได้</div></div>
      <div class="rowf" style="margin:10px 0"><input id="phIn" inputmode="numeric" maxlength="6" placeholder="เบอร์เพื่อน 6 หลัก">${B('บันทึก', { fn: 'addContact' }, 'good')}</div>
      <div class="list">${rows || '<div class="sub">ยังไม่มีรายชื่อ</div>'}</div>`;
  } else if (tab === 'call') {
    if (!call) body = '<div class="sub">ยังไม่มีสาย — โทรหาเพื่อนจากแท็บรายชื่อ (เพื่อนต้องออนไลน์)</div>';
    else body = `<div class="jobbox ok">📞 กำลังคุยกับ <b>${esc(call.with)}</b></div><div id="callMsgs">${callLog.map(m => `<div class="${m.me ? 'me' : ''}"><b>${m.me ? 'คุณ' : esc(m.name)}</b>: ${esc(m.text)}</div>`).join('')}</div>
      <form id="callForm" class="rowf"><input id="callIn" maxlength="120" placeholder="พิมพ์คุยในสาย..." autocomplete="off"><button class="primary" type="submit">ส่ง</button></form>${B('📵 วางสาย', { t: 'call_end' }, 'warn big')}`;
  } else if (tab === 'food') {
    const open = isOpen('restaurant');
    const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, B(`สั่ง ${money(it.base)}+ส่ง`, { fn: 'order', item: id }, 'good', !open), eatText(it.eat))).join('');
    const mine = (me.myOrders || []).map(o => itemRowRaw(G.items[o.item].icon, esc(G.items[o.item].name), o.state === 'open' ? '⏳ รอไรเดอร์รับออเดอร์' : o.state === 'taken' ? `🏃 ${esc(o.rider)} กำลังไปรับที่ร้าน` : `🛵 ${esc(o.rider)} กำลังมาส่ง`, o.state === 'open' ? B('ยกเลิก', { t: 'order_cancel', id: o.id }, 'warn') : '')).join('');
    body = `<div class="sub">${open ? 'ร้านอาหารเปิดอยู่' : '🔒 ร้านอาหารปิด (07:00–23:00)'} · ค่าส่งคิดตามระยะทาง · ไรเดอร์ผู้เล่นมาส่งถึงตัว (ถ้าไม่มีไรเดอร์ ร้านส่งเองแต่ช้า)</div>
      ${mine ? `<div class="sub"><b>ออเดอร์ของฉัน</b></div><div class="list">${mine}</div>` : ''}
      <div class="rowf" style="margin:8px 0">ทิปไรเดอร์ <input id="tipIn" type="number" min="0" max="500" value="0" style="width:90px"> ฿</div><div class="list">${rows}</div>`;
  } else if (tab === 'rider') body = riderJobs();
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
  ctx.font = `700 ${fs}px 'Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fs * .9, h = fs * 1.55;
  ctx.fillStyle = o.bg || 'rgba(18,22,28,.88)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.fillStyle = o.color || '#fff'; ctx.fillText(text, x, y + fs * .04);
}
const STN = id => G.stations.find(s => s.id === id);
let atlas = null, atlasImg = null;
fetch('assets/atlas.json').then(r => r.json()).then(j => { atlas = j; const im = new Image(); im.onload = () => { atlasImg = im; }; im.src = 'assets/atlas.webp'; });
function spr(name, cx, by, X, Y, scale = 1) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const w = s[2] / atlas.tile * TS * scale, h = s[3] / atlas.tile * TS * scale;
  ctx.drawImage(atlasImg, s[0], s[1], s[2], s[3], Math.round(cx * TS + X - w / 2), Math.round(by * TS + Y - h), Math.round(w), Math.round(h));
  return true;
}
function tex(name, tx, ty, px, py) {
  const s = atlas && atlasImg && atlas.sprites[name]; if (!s) return false;
  const q = atlas.tile;
  ctx.drawImage(atlasImg, s[0] + (tx & 1) * q, s[1] + (ty & 1) * q, q, q, Math.floor(px), Math.floor(py), Math.ceil(TS) + 1, Math.ceil(TS) + 1);
  return true;
}
const FLOOR = { office: 'fl_checker', market: 'fl_beige', warehouse: 'g_pavers', rider: 'fl_stone', dealer: 'fl_white', toolshop: 'fl_brick',
  restaurant: 'fl_checker', kitchen: 'fl_bluecheck', hospital: 'fl_white', school: 'fl_wood', bank: 'fl_beige', house: 'fl_wood' };
const WALL = { office: '#c9d3dc', market: '#f1e3c4', warehouse: '#8d7a5e', rider: '#3f6b63', dealer: '#dfe6ec', toolshop: '#b9a17f',
  restaurant: '#e9cfa4', kitchen: '#f3f3f3', hospital: '#e6f1f6', school: '#cfe0c4', bank: '#efe2bb', house: '#ecd2b2' };
function under(tx, ty) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) { const c = tileAt(tx + dx, ty + dy); if (',=kmspc'.includes(c)) return c; }
  return '.';
}
function drawTile(ch, tx, ty, px, py, tm) {
  if (ch === 'B' || ch === 'T' || ch === 'o' && !roomGrid[ty * G.map.w + tx]) ch = under(tx, ty);
  if (ch === 'o') ch = 'i';
  const S = Math.ceil(TS) + 1;
  switch (ch) {
    case '.': { const v = hash(tx >> 1, ty >> 1); tex(v < .84 ? 'g_grass' : v < .92 ? 'g_grass_dots' : 'g_grass_flowers', tx, ty, px, py); return; }
    case 'm': tex(hash(tx >> 1, ty >> 1) < .9 ? 'g_grass3' : 'g_grass_dots', tx, ty, px, py); return;
    case 's': tex('g_sand', tx, ty, px, py); return;
    case 'k': tex('g_terracotta', tx, ty, px, py); return;
    case 'c': tex('g_cobble', tx, ty, px, py); return;
    case 'p': tex('g_planks', tx, ty, px, py); return;
    case 'f': tex('g_dirt', tx, ty, px, py); ctx.fillStyle = 'rgba(96,52,24,.55)'; ctx.fillRect(px, py, S, S); ctx.fillStyle = 'rgba(50,26,10,.45)'; for (let i = 1; i < 4; i++) ctx.fillRect(px + 3, py + i * TS / 4, TS - 6, Math.max(2, TS / 18)); return;
    case ',': {
      tex('g_sidewalk', tx, ty, px, py);
      const hz = tileAt(tx - 1, ty) === '=' && tileAt(tx + 1, ty) === '=', vt = tileAt(tx, ty - 1) === '=' && tileAt(tx, ty + 1) === '=';
      if (hz || vt) { ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S); ctx.fillStyle = '#eef0f2'; for (let i = 0; i < 4; i++) hz ? ctx.fillRect(px + 2, py + i * TS / 4 + 2, TS - 4, TS / 8) : ctx.fillRect(px + i * TS / 4 + 2, py + 2, TS / 8, TS - 4); }
      return;
    }
    case '=': {
      ctx.fillStyle = '#41464e'; ctx.fillRect(px, py, S, S);
      const v = hash(tx, ty); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(px + v * TS * .7, py + (1 - v) * TS * .7, 3, 3);
      ctx.fillStyle = '#f2d25c';
      const up = tileAt(tx, ty - 1) === '=', dn = tileAt(tx, ty + 1) === '=', left = tileAt(tx - 1, ty) === '=', right = tileAt(tx + 1, ty) === '=';
      if (up && !dn && left && right && tx % 2 === 0 && tileAt(tx, ty - 2) !== '=') ctx.fillRect(px + TS * .15, py - 2, TS * .7, 4);
      if (left && !right && up && dn && ty % 2 === 0 && tileAt(tx - 2, ty) !== '=') ctx.fillRect(px - 2, py + TS * .15, 4, TS * .7);
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
    case 'i': { const rm = roomGrid[ty * G.map.w + tx]; if (!tex(FLOOR[rm?.rk] || 'fl_wood', tx, ty, px, py)) { ctx.fillStyle = '#b89a78'; ctx.fillRect(px, py, S, S); } return; }
    case 'D': { tex('fl_wood', tx, ty, px, py); ctx.fillStyle = 'rgba(160,40,40,.55)'; ctx.fillRect(px + 2, py + TS * .2, TS - 4, TS * .6); return; }
    case '#': {
      const rm = roomGrid[ty * G.map.w + tx];
      if (rm && ty === rm.y && tx > rm.x && tx < rm.x + rm.w - 1) {
        ctx.fillStyle = WALL[rm.rk] || '#ddd'; ctx.fillRect(px, py, S, S);
        ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(px + TS / 2, py, 2, TS * .8);
        ctx.fillStyle = shade(WALL[rm.rk] || '#dddddd', -.35); ctx.fillRect(px, py + TS * .82, S, TS * .18);
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
  if (b.deco) { ctx.globalAlpha = .75; sign(`${b.icon} ${b.label}`, cx, top - TS * .1, { size: TS * .26 }); ctx.globalAlpha = 1; return; }
  const open = isOpen(b.id);
  sign(`${b.icon} ${b.label}${open ? '' : ' · ปิด'}`, cx, top - TS * .15, { size: TS * .34, bg: open ? 'rgba(18,22,28,.9)' : 'rgba(90,30,30,.92)', border: '#ffc94d88' });
  const o = G.hours[b.id]; if (o && o[1] - o[0] < 24) sign(`${hhmm(o[0])}–${hhmm(o[1])}`, cx, top + TS * .32, { size: TS * .22, bg: 'rgba(0,0,0,.55)' });
}
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

// ------------------------------------------------------------------ navigation across maps
let guide = null;
const GATE_TO = { farm_in: 'farm', town_from_farm: 'town', housing_in: 'housing', town_from_housing: 'town' };
function targetOf(key) {
  if (key && key[0] === 'p' && /^p\d+$/.test(key)) { const p = P.get(+key.slice(1)); return p && { player: p.id, label: p.name }; }
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, area: s.area };
}
const CAREER_TARGET = { none: 'door_office', office: 'office', farmer: 'coop', fisher: 'fishclub', merchant: 'warehouse', chef: 'kitchen', doctor: 'hospital', rider: 'rider' };
const QUEST_TARGET = { work: 'office', harvest: 'coop', fish: 'fishclub', buy: 'warehouse', cook: 'kitchen', treat: 'hospital', deliver: 'rider', sell: 'market', eat: 'restaurant', sit: 'seat45_27.6' };
function setGuide(key, quiet) {
  const g = targetOf(key); if (!g) return;
  guide = g;
  if (!quiet) { toast(`นำทางไป ${g.label} — เดินตามลูกศรสีเหลือง`, '📍'); FX.play('notice'); }
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
  const tg = nextHop(m, guide); if (!tg) { guide = null; return; }
  const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy);
  if (tg.final && d < 2) { guide = null; FX.play('ding'); toast('ถึงแล้ว! กดปุ่มกลมสีเหลืองเพื่อใช้งาน', '📍'); return; }
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

// full-screen map of one outdoor area: tap a place to navigate there
function openMap(mapId) {
  const m = P.get(myId);
  mapId = mapId || mapOf(areaOf(m.x, m.y)?.id);
  const A = AREA[mapId];
  const v = $('#mapView'); v.classList.remove('hidden');
  $('#mapTabs').innerHTML = G.areas.filter(a => a.kind === 'map').map(a => `<button data-map="${a.id}" class="${a.id === mapId ? 'primary' : ''}">${a.name}</button>`).join('');
  $('#mapTabs').querySelectorAll('[data-map]').forEach(b => b.onclick = () => openMap(b.dataset.map));
  const c = $('#bigMap'), W = A.w, H = A.h;
  const k = Math.min((Math.min(innerWidth, 1100) - 24) / W, (innerHeight - 150) / H);
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = W * k * dpr; c.height = H * k * dpr; c.style.width = W * k + 'px'; c.style.height = H * k + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { g.fillStyle = MINI_COLORS[G.map.tiles[A.y + y][A.x + x]] || '#5e9b57'; g.fillRect(x * k, y * k, k + .5, k + .5); }
  const hits = [];
  const label = (text, x, y, size, bg, maxW = 1e9) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (; size > 8; size -= .5) { g.font = `700 ${size}px 'Noto Sans Thai',sans-serif`; if (g.measureText(text).width + size * .8 <= maxW) break; }
    const w = g.measureText(text).width + size * .8, h = size * 1.5;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = '#fff'; g.fillText(text, x, y + 1);
  };
  const fs = clamp(k * .9, 9, 14), L = (x, y) => [(x - A.x) * k, (y - A.y) * k];
  for (const b of G.map.buildings) {
    if (b.x < A.x || b.x >= A.x + A.w) continue;
    const sp = atlas?.sprites[b.sprite], [bx, by] = L(b.x, b.y);
    if (sp && atlasImg) { const w = sp[2] / atlas.tile * k, h = sp[3] / atlas.tile * k; g.drawImage(atlasImg, sp[0], sp[1], sp[2], sp[3], bx + b.w * k / 2 - w / 2, by + b.h * k - h, w, h); }
    const cx = bx + b.w * k / 2, cy = by + b.h * k / 2;
    if (b.house !== undefined) { const h = houseInfo(b); label(`#${b.house + 1}`, cx, cy, fs * .8, h.mine ? 'rgba(200,140,20,.95)' : h.forSale ? 'rgba(40,120,70,.95)' : 'rgba(18,22,28,.9)'); hits.push({ x: bx, y: by, w: b.w * k, h: b.h * k, key: 'door_' + b.id }); continue; }
    if (b.deco && !b.label) continue;
    if (b.deco) { g.globalAlpha = .6; label(b.label, cx, cy, fs * .8, 'rgba(18,22,28,.8)', b.w * k + 4); g.globalAlpha = 1; continue; }
    label(`${b.icon} ${b.label}`, cx, cy, fs, isOpen(b.id) ? 'rgba(18,22,28,.9)' : 'rgba(90,30,30,.9)', b.w * k + 8);
    hits.push({ x: bx, y: by, w: b.w * k, h: b.h * k, key: b.st });
  }
  for (const s of G.stations) {
    if (s.area !== A.id || !/^(pier|gate|coop|farmbuy|estate|fishclub|lot)$/.test(s.type)) continue;
    if (s.type === 'lot' && !(me.garden && me.garden.lot === s.lot) && wd?.lots?.[s.lot]) continue;
    const [x, y] = L(s.x, s.y);
    label(s.type === 'lot' ? (me.garden?.lot === s.lot ? '⭐ สวนของฉัน' : `🪧${s.lot + 1}`) : `${s.icon} ${s.type === 'pier' ? 'ตกปลา' : s.label}`, x, y, fs * .85, s.type === 'gate' ? 'rgba(40,90,150,.95)' : 'rgba(26,62,88,.94)');
    hits.push({ x: x - 3 * k, y: y - 1.5 * k, w: 6 * k, h: 3 * k, key: s.id });
  }
  if (mapId === 'town') { const [x, y] = L(50, 32); label('⛲ จัตุรัสกลางเมือง', x, y - 3 * k, fs, 'rgba(160,90,40,.92)'); hits.push({ x: x - 7 * k, y: y - 7 * k, w: 14 * k, h: 14 * k, key: 'seat45_27.6' }); }
  for (const p of P.values()) {
    const q = outPos(p.x, p.y); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    const mine = p.id === myId, [x, y] = L(q.x, q.y);
    g.fillStyle = mine ? '#fff' : COLORS[p.av]; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, mine ? k * .9 : k * .55, 0, 7); g.fill(); g.stroke();
    if (mine) label(roomOf(p.x, p.y) ? `คุณอยู่ใน${roomOf(p.x, p.y).label}` : 'คุณอยู่ที่นี่', x, y - fs * 1.4, fs * .85, 'rgba(255,120,60,.95)');
  }
  c.onclick = e => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    if (h) { closeMap(); setGuide(h.key); }
  };
}
function closeMap() { $('#mapView').classList.add('hidden'); }

// first-time tutorial
const TUT = () => [
  ['👋', 'ยินดีต้อนรับสู่เมือง!', 'ตัวคุณคือตัวละครที่มีป้ายชื่อ<b>สีเหลือง</b> ผู้เล่นคนอื่นก็อยู่ในเมืองเดียวกัน'],
  ['👣', 'วิธีเดิน', 'มือถือ: <b>แตะค้างตรงไหนก็ได้แล้วลากนิ้ว</b><br>คอม: ปุ่ม <b>W A S D</b> หรือลูกศร'],
  ['🚪', 'เข้าอาคาร', 'เดินไปหน้าประตู แล้วกด<b>ปุ่มกลมสีเหลือง</b> (คอม: E) · ร้านต่างๆ มี<b>เวลาเปิด-ปิด</b> ดูได้ที่ป้าย'],
  ['💼', 'หางานทำ', 'คุณเริ่มต้น<b>ว่างงาน</b> · เข้าไป<b>สมัครงานในอาคาร</b> เช่น ชาวประมง (สมาคมประมง), พ่อค้า (คลังสินค้า), เกษตรกร (สหกรณ์ในไร่) · งานบริษัท/หมอต้องเรียนจบที่มหาวิทยาลัยก่อน'],
  ['❤️', 'ดูแลตัวเอง', 'กินให้อิ่ม ป่วยต้องหาหมอ ไม่มีบ้านก็<b>นั่งพักหลับตา</b> (ปุ่ม 😌) ได้ทุกที่ · 📱 มือถือไว้โทรหาเพื่อนและสั่งอาหาร'],
  ['🗺️', 'หลงทาง?', 'แตะ<b>แผนที่เล็ก</b>มุมขวาบน แล้วแตะสถานที่ จะมี<b>ลูกศรสีเหลือง</b>พาไป · เมนู 💼 บอกว่าแต่ละงานสมัครที่ไหน'],
];
let tutStep = 0, tutPending = false, pendingDaily = null;
function showTut(i = 0) {
  tutStep = i; const steps = TUT(), [icon, title, body] = steps[i];
  $('#tut').classList.remove('hidden');
  $('#tutBody').innerHTML = `<div class="tutIcon">${icon}</div><h2>${esc(title)}</h2><p>${body}</p><div class="dots">${steps.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>`;
  $('#tutNext').textContent = i === steps.length - 1 ? '🚀 เริ่มเล่น! (ดูงานที่สมัครได้)' : 'ถัดไป →';
}
$('#tutNext').onclick = () => { FX.play('click'); if (tutStep < TUT().length - 1) return showTut(tutStep + 1); endTut(); };
$('#tutSkip').onclick = endTut;
function endTut() {
  tutPending = false; if (pendingDaily) { const d = pendingDaily; pendingDaily = null; setTimeout(() => showDaily(d), 600); }
  $('#tut').classList.add('hidden'); try { localStorage.setItem('lt_tut2', '1'); } catch { }
  if (me && me.career === 'none') openPanel({ kind: 'career' });
}
function showDaily(d) {
  const box = $('#daily');
  box.innerHTML = `<div class="tutIcon">🎁</div><h2>โบนัสเข้าเกมวันที่ ${d.streak}</h2><p>เข้าเล่นทุกวันติดต่อกัน รางวัลจะเพิ่มขึ้นเรื่อยๆ</p>
    <div class="days">${d.table.map((v, i) => `<div class="${i + 1 < Math.min(d.streak, 7) ? 'got' : i + 1 === Math.min(d.streak, 7) ? 'now' : ''}"><small>วัน ${i + 1}</small><b>฿${v.toLocaleString()}</b></div>`).join('')}</div>
    <div class="big-reward">+${money(d.reward)}</div><button class="primary big" id="dailyOk">รับเลย!</button>`;
  $('#dailyWrap').classList.remove('hidden');
  $('#dailyOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); FX.play('coin', true); };
}
// driving test
function showDriveTest(qs) {
  const box = $('#daily'), ans = [];
  box.innerHTML = `<div class="tutIcon">🪪</div><h2>สอบใบขับขี่</h2><p>ตอบให้ถูกทุกข้อ</p>${qs.map((q, i) => `<div class="dq"><b>${i + 1}. ${esc(q.q)}</b>${q.a.map((a, j) => `<button data-q="${i}" data-a="${j}">${esc(a)}</button>`).join('')}</div>`).join('')}<button class="primary big" id="dtOk" disabled>ส่งคำตอบ</button>`;
  $('#dailyWrap').classList.remove('hidden');
  box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const i = +b.dataset.q; ans[i] = +b.dataset.a;
    box.querySelectorAll(`[data-q="${i}"]`).forEach(x => x.classList.toggle('good', x === b));
    $('#dtOk').disabled = qs.some((_, k) => ans[k] === undefined);
  });
  $('#dtOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); const s = STN('dealer'); doAct(s.id, 'answer', { ans }); };
}

// ------------------------------------------------------------------ areas, interiors
let roomGrid = [], roomFurniture = [];
const FURN_SPRITE = { plant: 'f_plant', sofa: 'f_sofa_red', tv: 'f_tv', bed: 'f_bed_pink', aqua: 'f_aquarium', art: 'f_pictures', piano: 'f_guitar', jacuzzi: 'f_bath' };
const FURN_SLOTS = [[10.4, 7.6], [8, 2.6], [10, 2.6], [10.2, 5.2], [4.5, 1.05], [1.8, 6.2], [5, 2.6], [1.8, 7.8]];
function buildAreas() {
  AREA = Object.fromEntries(G.areas.map(a => [a.id, a]));
  roomGrid = new Array(G.map.w * G.map.h);
  for (const r of G.areas) if (r.kind === 'room') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomGrid[y * G.map.w + x] = r;
  buildMini(); layoutFurniture();
}
function layoutFurniture() {
  roomFurniture = [];
  for (const r of G.areas) {
    if (r.kind !== 'room') continue;
    for (const f of r.furniture || []) roomFurniture.push(f);
    if (r.rk === 'house') { const h = wd?.houses?.[r.house]; if (h) h[2].forEach((k, i) => FURN_SLOTS[i] && roomFurniture.push([FURN_SPRITE[k], r.x + FURN_SLOTS[i][0], r.y + FURN_SLOTS[i][1]])); }
  }
}
function drawRoomLabels(r, X, Y, t) {
  const px = r.x * TS + X, py = r.y * TS + Y;
  const h = r.rk === 'house' ? wd?.houses?.[r.house] : null;
  sign(r.rk === 'house' ? (h && h[0] ? `🏠 บ้านของ ${h[0]}` : `🏠 บ้านเลขที่ ${r.house + 1}`) : `${r.icon} ${r.label}`, px + r.w * TS / 2, py - TS * .1, { size: TS * .34, border: '#ffc94d88' });
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${Math.round(TS * .3)}px 'Noto Sans Thai',sans-serif`;
  ctx.fillText('⬇ ทางออก', px + Math.floor(r.w / 2) * TS, py + (r.h + .45) * TS + Math.sin(t / 300) * 2);
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
  if (id === '_hungry') return toast('หิวมาก หิวนานๆ เลือดจะลด ถ้าหมดหลอดจะล้มนอนเป็นผัก รีบหาอะไรกิน', '🍗', false);
  const d = G.diseases[id];
  toast(`${d.name}: ${d.sym.join(', ')} · สาเหตุ: ${d.cause} · ${d.self}`, d.icon, false);
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
  const gained = [];
  for (const [k, q] of Object.entries(b.inv)) { const d = q - (a.inv[k] || 0); if (d > 0) gained.push(`+${d}${G.items[k].icon}`); }
  if (gained.length) { FX.play('pop'); FX.float(x - .3, y - .4, gained.join(' '), '#ffffff', .5); FX.burst(x, y, '#ffffff', 6); }
  if (b.career === a.career && b.lv > a.lv) { FX.play('levelup'); FX.ring(x, y, '#ffd34d', 900, 1.6); FX.float(x, y - .6, `LEVEL UP! Lv.${b.lv}`, '#ffd34d', .55); FX.burst(x, y, '#ffd34d', 20); }
  if (a.energy < 99.5 && b.energy >= 100) toast('พลังงานเต็มแล้ว!', '⚡');
  if (b.energy - a.energy >= 8) FX.float(x + .5, y + .2, `+${Math.round(b.energy - a.energy)}⚡`, '#f2c94c', .34);
  if (b.health - a.health >= 8) { FX.float(x - .5, y + .2, `+${Math.round(b.health - a.health)}❤️`, '#ff8a8a', .34); FX.ring(x, y, '#8fe3a6', 700, 1); }
  if (b.hunger - a.hunger >= 8) FX.float(x, y + .4, `+${Math.round(b.hunger - a.hunger)}🍗`, '#8fe3a6', .34);
  if (!a.cast && b.cast) { bobber = findWater(s.x, s.y); FX.play('whoosh'); if (bobber) setTimeout(() => { FX.play('splash'); FX.ring(bobber.x, bobber.y, '#fff', 800, 1); }, 250); }
  if (!b.cast) bobber = null;
  if (!a.down && b.down) { FX.play('fail'); closePanel(); }
  if (a.down && !b.down) FX.play('heal');
}
const ICON_SFX = { '🍳': 'sizzle', '🍛': 'munch', '🍜': 'munch', '🍲': 'munch', '🥗': 'munch', '😴': 'sleep', '😌': 'sleep', '🏥': 'heal', '💉': 'heal', '💓': 'heal', '🎓': 'levelup', '🌱': 'pop', '📦': 'pop', '🔔': 'ding', '🛵': 'notice' };
function toastSfx(m) { if (!m.ok) return FX.play('fail'); if (ICON_SFX[m.icon]) FX.play(ICON_SFX[m.icon]); }
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
})();
