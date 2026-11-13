'use strict';
(() => {
const $ = s => document.querySelector(s);
const COLORS = ['#4aa3d1', '#7ac96b', '#e2b13c', '#d9907a', '#4fc3a1', '#4aa3d1', '#6b7fe0', '#a56be0', '#e06bb4', '#9aa4ad'];
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
let guide = null;                       // the yellow guide arrow's target
try { creds = JSON.parse(localStorage.getItem('lt_creds') || 'null'); } catch { }

// ------------------------------------------------------------------ login UI
// new characters pick a gender and a starter shirt; everyone starts with the same hairstyle
let avatar = clamp(creds?.avatar ?? 0, 0, 3), gender = creds?.gender || 'm';
const SHIRT_IDS = ['white', 'blue', 'green', 'red'];
const sw = $('#swatches');
function paintSw() {
  sw.innerHTML = '';
  const row = document.createElement('div'); row.className = 'genders';
  for (const [g, l] of [['m', '👦 ชาย'], ['f', '👧 หญิง']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.className = g === gender ? 'primary' : ''; b.onclick = () => { gender = g; paintSw(); }; row.appendChild(b); }
  sw.appendChild(row);
  const shirts = document.createElement('div'); shirts.className = 'shirts';
  SHIRT_IDS.forEach((id, i) => {
    const c = document.createElement('canvas'); c.width = 84; c.height = 120; c.className = i === avatar ? 'on' : '';
    c.onclick = () => { avatar = i; paintSw(); }; shirts.appendChild(c);
    whenChars(() => { const g = c.getContext('2d'); drawCharTo(g, { g: gender, lk: { hair: 'brown', shirt: id, pants: 'gray' } }, 42, 112, 100 / CH_ATLAS.h, 'front', 0); });
  });
  sw.appendChild(shirts);
}
// ---- pixel character (public/assets/pchar.webp, built by tools/build_pixel_chars.py)
// every frame has 4 layers: base (outline, skin, shoes) + shirt / pants / hair stored as grey shading and tinted per player
let CH_ATLAS = null, chImg = null; const chWait = [], chCache = new Map();
const whenChars = fn => { if (chImg) fn(); else chWait.push(fn); };
fetch('assets/pchar.json').then(r => r.json()).then(j => { const im = new Image(); im.onload = () => { CH_ATLAS = { ...j, canvas: [j.w, j.h] }; chImg = im; chWait.splice(0).forEach(f => f()); }; im.src = 'assets/pchar.webp'; });
const DEFAULT_LOOK = { hair: 'brown', shirt: 'white', pants: 'gray' };
// starter colours are known before login (the creator screen); everything else comes from the server
const STARTER_COLORS = { shirt: { white: '#ffffff', blue: '#5aa0e0', green: '#7cc06a', red: '#e0645a' }, hair: { brown: '#6e4528' }, pants: { gray: '#bdbdbd' } };
const lookColor = (cat, id) => G?.looks?.[cat]?.[id]?.color || STARTER_COLORS[cat][id] || STARTER_COLORS[cat][Object.keys(STARTER_COLORS[cat])[0]];
// one tinted frame, cached per (frame, colours)
function charFrame(frame, lk) {
  const key = `${frame}|${lk.shirt}|${lk.pants}|${lk.hair}`; let c = chCache.get(key); if (c) return c;
  const { w, h, rows } = CH_ATLAS, row = rows[frame] ?? 0;
  c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.drawImage(chImg, 0, row * h, w, h, 0, 0, w, h);
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const t = tmp.getContext('2d');
  [['shirt', 1], ['pants', 2], ['hair', 3]].forEach(([cat, col]) => {
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h);
    t.drawImage(chImg, col * w, row * h, w, h, 0, 0, w, h);
    t.globalCompositeOperation = 'multiply'; t.fillStyle = lookColor(cat, lk[cat]); t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(chImg, col * w, row * h, w, h, 0, 0, w, h);
    g.drawImage(tmp, 0, 0);
  });
  chCache.set(key, c); if (chCache.size > 400) chCache.delete(chCache.keys().next().value);
  return c;
}
// draw one character with its feet at (fx, fy), k = scale per sprite pixel; view = front | side | back; step = walk step 0-3; faceLeft for the side view
const OUTFIT_SHEET = { doctor: 'doctor', police: 'police', farmer: 'farmer', chef: 'chef', merchant: 'merchant', office: 'office', fisher: 'fisher', fishing: 'fisher', rider: 'rider', beggar: 'beggar', thief: 'thief' };
const WALK = { front: ['down0', 'down1', 'down0', 'down2'], back: ['up0', 'up1', 'up0', 'up1'], side: ['left0', 'left1', 'left0', 'left2'] };
function drawCharTo(g, p, fx, fy, k, view, step, faceLeft) {
  // outfits (job clothes, the thief outfit, reward outfits) are whole sheets; only the hair colour is applied on top
  const sheet = OUTFIT_SHEET[p.of], outfit = sheet && CH_ATLAS.rows[`${sheet}:down0`] !== undefined ? sheet + ':' : '';
  const lk = { ...DEFAULT_LOOK, ...(p.lk || {}) }, fr = charFrame(outfit + WALK[view][step % 4], lk), [ax, ay] = CH_ATLAS.feet;
  g.save(); g.translate(fx, fy); if (view === 'side' && !faceLeft) g.scale(-1, 1);
  g.imageSmoothingEnabled = false; g.drawImage(fr, -ax * k, -ay * k, CH_ATLAS.w * k, CH_ATLAS.h * k);
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
  $('#createErr').textContent = ''; creds = { ...creds, create: 1, cname, gender, shirt: SHIRT_IDS[avatar] }; wantLogin = true; connect();
};
$('#loginForm').onsubmit = e => {
  e.preventDefault();
  // the server has the final say: new characters must use English/digits, old Thai-named characters still log in
  creds = { name: $('#inName').value.trim(), pin: $('#inPin').value };
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
let fixId = 0;                          // the server's last position correction we have applied
const doAct = (st, a, extra = {}) => send({ t: 'act', st, a, ...extra });

function handle(m) {
  switch (m.t) {
    case 'loginfail': $('#loginErr').textContent = m.msg; $('#createErr').textContent = m.msg; wantLogin = false; break;
    case 'newchar':     // new ID: pick gender + first shirt once
      wantLogin = false; $('#loginForm').classList.add('hidden'); $('#createBox').classList.remove('hidden');
      $('#createName').textContent = 'ID: ' + m.name; $('#inCname').value = ''; paintSw(); setTimeout(() => $('#inCname').focus(), 50); break;
    case 'kicked': wantLogin = false; toast(m.msg, '⚠️', false); break;
    case 'init':
      if (G && G.build && m.build !== G.build) $('#updBar').classList.remove('hidden');     // a new version was deployed
      G = m; myId = m.id; P.clear(); buildAreas(); chCache.clear(); buildStaff(); fixId = 0; afkSent = false; running = false; $('#actBtn').classList.remove('run'); lastInput = performance.now();
      creds = { name: creds.name, pin: creds.pin }; localStorage.setItem('lt_creds', JSON.stringify(creds));
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
        Object.assign(s, { id: p.id, name: p.name, av: p.av, c: p.c, lv: p.lv, dz: p.dz || [], pose: p.pose, title: p.title, tr: p.tr, g: p.g, lk: p.lk, npc: p.npc, adm: p.adm, w: p.w, sad: p.sad, of: p.of || '', th: p.th, afk: p.afk, wk: p.wk });
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
    case 'mypic': myPic = m.pic || ''; paintPortrait(); if (panel?.kind === 'profile') refreshPanel(true); break;
    case 'mail': mailList = m.list || []; if (panel?.kind === 'mail') refreshPanel(true); break;
    case 'info': infoCache.set(m.id, m); if (panel?.kind === 'player' && panel.pid === m.id) refreshPanel(true); break;
    case 'tchat': tradeChat.push(m); if (tradeChat.length > 30) tradeChat.shift(); paintTradeChat(); if (!m.mine) FX.play('pop'); break;
    case 'chat': {
      chatLog.push(m); if (chatLog.length > 60) chatLog.shift();
      logLine(m.sys ? m.text : `${m.w ? '🌐 ' : ''}<b>${esc(m.name)}</b>: ${esc(m.text)}`, m.sys ? 'sys' : '', !m.sys);
      const s = P.get(m.id); if (s && !m.sys && !m.w) { s.bubble = m.text; s.bt = performance.now() + 6500; }
      if (m.sys) { if (/🦈|💎|🎊|🏅|🎓/.test(m.text)) FX.play('notice'); } else if (m.id !== myId) FX.play('pop');
      if (panel?.kind === 'chat') refreshPanel(true);
      break;
    }
    case 'bite': fishBite = { t: performance.now(), zone: m.zone, speed: m.speed || 1 }; if (panel?.kind !== 'pier' && near?.type === 'pier') openPanel({ kind: 'pier', st: near.id }); FX.play('bite'); if (bobber) { FX.ring(bobber.x, bobber.y, '#fff', 600, 0.9); FX.float(bobber.x, bobber.y - .3, '‼️', '#fff', .6); } if (navigator.vibrate) navigator.vibrate(200); break;
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
    case 'dtest': showDriveTest(m); break;
    case 'emo': { const s = P.get(m.id); if (s) { s.emo = m.e; s.emoT = performance.now() + 4200; } if (m.id !== myId) FX.play('pop'); break; }
    case 'bugs': bugList = m.list; if (panel?.kind === 'god') refreshPanel(true); break;
    case 'reset': try { localStorage.removeItem('lt_tut2'); } catch { } guide = null; setTimeout(() => showTut(0), 600); break;
    case 'crave': FX.play('ding'); break;
    case 'witness':
      popup(`👀 คุณเห็น <b>${esc(m.thief)}</b> ล้วงกระเป๋า <b>${esc(m.victim)}</b>!`, [['📞 แจ้งตำรวจ 191', 'warn', () => send({ t: 'report', crime: m.crime })], ['ปล่อยไป', '', () => {}]], 25000);
      FX.play('notice'); break;
    case 'robbed':
      popup(m.thief ? `😠 <b>${esc(m.thief)}</b> พยายามล้วงกระเป๋าคุณ!` : `😱 มีคนล้วงกระเป๋าคุณไป <b>${money(m.amt)}</b>`, [['📞 แจ้งตำรวจ 191', 'warn', () => send({ t: 'report', crime: m.crime })], ['ช่างมัน', '', () => {}]], 25000);
      FX.play('fail'); if (navigator.vibrate) navigator.vibrate(300); break;
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
const recentToasts = new Map();
function toast(msg, icon = '✅', ok = true) {
  // never stack the same message: identical text within 8 s is dropped
  const key = icon + msg, t0 = performance.now();
  if (recentToasts.get(key) > t0 - 8000) return;
  recentToasts.set(key, t0); if (recentToasts.size > 50) recentToasts.delete(recentToasts.keys().next().value);
  const d = document.createElement('div'); d.className = 'toast' + (ok ? '' : ' bad'); d.textContent = `${icon} ${msg}`;
  const t = $('#toasts'); t.appendChild(d); while (t.children.length > (innerWidth < 600 ? 2 : 4)) t.firstChild.remove();
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
  const what = r.kind === 'trade' ? 'ขอแลกเปลี่ยนของกับคุณ 🤝' : r.kind === 'phone' ? 'ขอเบอร์โทรของคุณ 📱 (ตกลง = แลกเบอร์กัน)' : `เสนอปฐมพยาบาลให้คุณ 💉 ค่ารักษา <b>${money(r.fee)}</b>`;
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
  $('#card').classList.toggle('admin', !!me.admin);
  $('#meCareer').textContent = me.career === 'none' ? '🙂 ว่างงาน' : `${c.icon} Lv.${me.lv}`;
  // status pills (icons from the UI sheet where we have one)
  const ic = (f, alt) => f ? `<img src="assets/ui/${f}.png" alt="">` : alt;
  const DZ_IC = { cold: 'i_cold', flu: 'i_cold', poison: 'i_belly', insomnia: 'i_sleepy', exhaust: 'i_sad', malnut: 'i_meal' };
  const chips = (me.dz || []).map(d => `<span class="chip bad" data-dz="${d}">${ic(DZ_IC[d], G.diseases[d].icon)} ${G.diseases[d].name}</span>`);
  if (me.awake > 32 * 60 && !(me.dz || []).includes('insomnia')) chips.push(`<span class="chip warnc" data-dz="_sleepy">${ic('i_sleepy')} ง่วงนอน</span>`);
  if (me.hunger < 20) chips.push(`<span class="chip warnc" data-dz="_hungry">${ic('i_leg')} หิวมาก</span>`);
  if (me.happy < 20) chips.push(`<span class="chip bad" data-dz="_sad">${ic('i_sad')} ซึมเศร้า</span>`);
  if (me.craving) chips.push(`<span class="chip crave" data-dz="_crave">${ic('i_bulb')} อยากกิน${G.items[me.craving.item].icon}${esc(G.items[me.craving.item].name)}</span>`);
  if (me.desk >= 0 && me.enrolled) chips.push(`<span class="chip study" data-dz="_study">📖 เรียนอยู่ ${Math.round((me.study || 0) * 100)}%</span>`);
  if (me.docShift && isInside('r_hospital') && hourNow() >= G.doctor.start && hourNow() < G.doctor.end) chips.push(`<span class="chip duty" data-dz="_duty">🩺 เข้าเวร ${me.docShift.hours.toFixed(1)} ชม.</span>`);
  if (me.licExp?.driving && me.licExp.driving < Date.now() + clockOff) chips.push('<span class="chip bad" data-dz="_lic">🪪 ใบขับขี่หมดอายุ</span>');
  if (me.utilOff) chips.push('<span class="chip bad" data-dz="_bills">🔌 ถูกตัดน้ำไฟ</span>');
  else if ((me.bills || []).length) chips.push(`<span class="chip warnc" data-dz="_bills">🧾 ค้างบิล ${money(me.bills.reduce((s, b) => s + b.water + b.elec, 0))}</span>`);
  $('#statusBox').classList.toggle('hidden', !chips.length);
  paintPortrait(); $('#mailBtn').classList.toggle('has', (me.mailN || 0) > 0);
  const dzBox = $('#dzChips'); const html = chips.join('');
  if (dzBox.dataset.h !== html) { dzBox.dataset.h = html; dzBox.innerHTML = html; dzBox.querySelectorAll('[data-dz]').forEach(c => c.onclick = () => dzInfo(c.dataset.dz)); }
  $('#meMoney').textContent = Math.round(me.money).toLocaleString('en-US');
  const qs = me.quests; if (qs) { const d = qs.list.filter(x => x.done).length; const ql = $('#qline'); ql.textContent = d === 3 ? 'เควสต์ครบแล้ว ✅' : `เควสต์ ${d}/3 · กดดู`; ql.classList.toggle('all', d === 3); $('#qBtn').classList.toggle('has', d < 3); }
  $('#bJ').style.width = (me.happy ?? 80) + '%'; $('#vJ').textContent = Math.floor(me.happy ?? 80);
  $('#bJ').style.background = me.happy < 20 ? '#7d7d9c' : me.happy < 45 ? '#d9a94a' : '#f08ad0';
  $('#bE').style.width = me.energy + '%'; $('#bH').style.width = me.hunger + '%'; $('#bL').style.width = me.health + '%';
  $('#vE').textContent = Math.floor(me.energy); $('#vH').textContent = Math.floor(me.hunger); $('#vL').textContent = Math.floor(me.health);
  $('#card').style.borderLeftColor = COLORS[me.avatar ?? 0] || '#999';
  placeLog();
  $('#restBtn').classList.toggle('on', me.pose === 'rest');
  $('#restBtn').innerHTML = me.pose === 'rest' ? '<span>🧍</span><small>ลุก</small>' : '<span>😌</span><small>พัก</small>';
  $('#begBtn').classList.toggle('hidden', me.career !== 'beggar');
  $('#begBtn').classList.toggle('on', me.pose === 'beg');
  $('#begBtn').innerHTML = me.pose === 'beg' ? '<span>🧍</span><small>ลุก</small>' : '<span>🥣</span><small>ขอทาน</small>';
  $('#godBtn').classList.toggle('hidden', !me.admin);
  paintNav();
  $('#phoneBtn').classList.toggle('has', me.career === 'rider' && (me.jobs || []).some(j => j.state === 'open'));
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
    : `<b>🚑 หมดสติอยู่บนเตียงโรงพยาบาล</b><span>รอหมอมาช่วย... ทำอะไรไม่ได้</span><span>ถ้าไม่มีหมอ เจ้าหน้าที่จะช่วยให้ฟื้นในอีก <b class="big-cd">${mm}</b></span>`;
}
setInterval(() => { if (me?.down) paintDown(); }, 500);
function paintEvent() {
  const e = $('#eventBar');
  if (wd?.ev) { e.textContent = wd.ev.text; e.classList.remove('hidden'); } else e.classList.add('hidden');
  document.body.classList.toggle('hasEvent', !!wd?.ev);
}
// same clock as the server: days are slow, nights run twice as fast (server/data.js CLOCK)
const hourOfPhase = m => { const c = G.clock || { dawn: 0, dusk: 24, dayMin: 24 }, dayH = c.dusk - c.dawn; return m < c.dayMin ? c.dawn + m * dayH / c.dayMin : (c.dusk + (m - c.dayMin) * (24 - dayH) / (24 - c.dayMin)) % 24; };
const hourNow = () => FORCE_PHASE !== null ? +FORCE_PHASE * 24 : hourOfPhase(((((Date.now() + clockOff + (wd?.toff || 0)) % G.dayMs) + G.dayMs) % G.dayMs) / 60000);
const dayNow = () => { const c = G.clock || { dawn: 0, dusk: 24, dayMin: 24 }, mid = (c.dayMin + (24 - c.dusk) * (24 - c.dayMin) / (24 - (c.dusk - c.dawn))) * 60000; return Math.floor((Date.now() + clockOff + (wd?.toff || 0) + G.dayMs - mid) / G.dayMs); };
const isInside = rid => { const m = P.get(myId); return !!m && roomOf(m.x, m.y)?.id === rid; };
const FORCE_PHASE = new URLSearchParams(location.search).get('phase');   // ?phase=0.95 previews a time of day
const isOpen = (kind, h = hourNow()) => { const o = G?.hours[kind]; return !o || (h >= o[0] && h < o[1]); };
setInterval(() => {
  if (!wd || !G) return;
  const h = hourNow();
  const dt = me?.date; $('#clock').innerHTML = `${dt ? `<span>📅 ${dt.day}/${G.monthDays} ${G.months[dt.month]}</span><i> · </i>` : ''}<span>🕐 ${hhmm(h)} · 👥 ${wd.on}</span>`;
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
$('#mini').onclick = () => { if (!G) return; mapZoom = 1; openMap(); };
// the status card folds down to a small strip (face, money, slim bars); folded by default on phones
const placeLog = () => { const cd = $('#card'); $('#log').style.top = (cd.offsetTop + cd.offsetHeight + (guide ? 36 : 6)) + 'px'; document.body.style.setProperty('--cardW', (cd.offsetLeft + cd.offsetWidth) + 'px'); };
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
function setRun(on) { if (on && !canRun()) { if (me) toast('เหนื่อยเกินไป วิ่งไม่ไหว พักหรือกินอะไรก่อน', '🥵', false); on = false; } if (on === running) return; running = on; runSetT = performance.now(); send({ t: 'run', on }); $('#actBtn').classList.toggle('run', on); }
$('#begBtn').onclick = () => { if (!me || me.down) return; FX.play('click'); send({ t: 'beg', on: me.pose !== 'beg' }); };
$('#talkBtn').onclick = () => talk();
$('#updBtn').onclick = () => location.reload();
// emoji over your head
const EMOJIS = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '👋', '🙏', '❤️', '🎉', '💤', '❓', '🤔', '😱', '🔥'];
$('#emoPick').innerHTML = EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('');
$('#emoPick').querySelectorAll('[data-e]').forEach(b => b.onclick = () => { send({ t: 'emo', e: b.dataset.e }); $('#emoPick').classList.add('hidden'); });
$('#emoBtn').onclick = () => { FX.play('click'); $('#emoPick').classList.toggle('hidden'); };
// the CBT notice scrolls across the top now and then
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
  if (e.key === 'f') talk();
  if (e.key === 'Shift' && !running) { shiftRun = true; setRun(true); }
  if (e.key === 'c' || e.key === 't') { e.preventDefault(); openPanel({ kind: 'chat' }); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.key === 'Shift' && shiftRun) { shiftRun = false; setRun(false); } });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const cv = $('#cv'), ctx = cv.getContext('2d');
let TS = 40, VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  TS = Math.round(clamp(Math.min(VW, VH) / 9.5, 34, 54));   // whole pixels: tile seams stay put while scrolling
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
  const target = panel && !trade && !(VW > VH && VH <= 520) ? VH * 0.24 : 0;   // landscape popups sit in the middle, no lift
  camLift += (target - camLift) * 0.18;
  const a = m ? areaOf(m.x, m.y) : null;
  if (a) {   // keep the view inside the current map/room (you never see past its edge)
    const fit = (pos, lo, size, view) => size * TS + TS * 2 <= view ? lo + size / 2 : clamp(pos, lo + view / TS / 2 - 1, lo + size - view / TS / 2 + 1);
    x = fit(x, a.x, a.w, VW); y = fit(y, a.y - (a.kind === 'room' ? .6 : 0), a.h + (a.kind === 'room' ? 1.2 : 0), VH - camLift * 2);
  }
  return { x: x * TS - VW / 2, y: y * TS - VH / 2 + camLift };
}
// tap the map: a person under your finger opens their profile, anywhere else walks you there
function onTap(sx, sy) {
  $('#emoPick').classList.add('hidden');
  if (!G || !me || sx == null) return;
  const c = camera(), wx = (sx + c.x) / TS, wy = (sy + c.y) / TS, m = P.get(myId); if (!m) return;
  const here = areaOf(m.x, m.y)?.id;
  let hit = null, hd = .8;
  for (const p of P.values()) {
    if (p.id === myId || areaOf(p.x, p.y)?.id !== here) continue;
    const d = Math.hypot(p.rx - wx, (p.ry - .35) - wy); if (d < hd) { hd = d; hit = p; }
  }
  if (hit) { FX.play('click'); return openPanel({ kind: 'player', pid: hit.id }); }
  walkTo(wx, wy);
}
// ---- tap-to-walk: breadth-first path over free tiles of the current area, followed by the movement loop
let autoPath = null;
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
  const p = nearestPerson();
  if (p) return openPanel({ kind: 'player', pid: p.id });
  if (near && STAFF_AT[near.id]) return onAction();
  toast('ไม่มีใครอยู่ใกล้ๆ เดินเข้าไปใกล้คนที่อยากคุยก่อน', '💬', false);
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
  if (near.type === 'door' && near.renov) return toast(`${near.label} ปิดปรับปรุงชั่วคราว 🚧`, '🚧', false);
  if (near.type === 'door' && near.house === undefined) {
    if (t < actCd) return; actCd = t + 1300;
    if (!isOpen(near.bld)) { const o = G.hours[near.bld]; return toast(`${near.label} ปิดอยู่ (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
    return send({ t: 'enter', st: near.id });
  }
  if (near.type === 'exit') { if (t < actCd) return; actCd = t + 1300; return send({ t: 'exit' }); }
  if (near.type === 'gate') { if (t < actCd) return; actCd = t + 1300; return doAct(near.id, 'go'); }
  if (near.type === 'deliver') return send({ t: 'order_deliver', id: near.oid });
  if (near.type === 'seat') return doAct(near.id, 'sit');
  if (near.type === 'begspot' && me.career === 'beggar') return doAct(near.id, 'beg');
  if (near.type === 'chair' && me.career === 'office') return doAct(near.id, 'sit');
  if (near.type === 'sdesk' && me.enrolled) return doAct(near.id, 'sit');
  if (near.type === 'pier' && me.cast) return reel();                // the big button reels in too
  if (near.type === 'pier' && !me.cast && me.rod && panel?.st === near.id) return doAct(near.id, 'cast');
  if (panel?.st === near.id) { closePanel(); return; }
  openPanel({ kind: near.type, st: near.id });
}
// the big button: tap = use / enter, press and hold = run while held
{
  const ab = $('#actBtn'); let hold = null;
  ab.addEventListener('pointerdown', e => { e.preventDefault(); ab.setPointerCapture?.(e.pointerId); hold = { id: e.pointerId, ran: false, tm: setTimeout(() => { if (hold) { hold.ran = true; setRun(true); if (navigator.vibrate) navigator.vibrate(20); } }, 320) }; });
  const up = e => { if (!hold || hold.id !== e.pointerId) return; clearTimeout(hold.tm); const ran = hold.ran; hold = null; if (ran) setRun(false); else if (e.type === 'pointerup') onAction(); };
  ab.addEventListener('pointerup', up); ab.addEventListener('pointercancel', up);
  ab.addEventListener('contextmenu', e => e.preventDefault());
}

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
    if (dx || dy) autoPath = null;
    else if (autoPath && !me.down) { const st = autoStep(m, dt); if (st) [dx, dy] = st; }
    const ox0 = m.x, oy0 = m.y;
    if (holdAfterTp) { if (!dx && !dy && !joy) holdAfterTp = false; else { dx = 0; dy = 0; } }
    if (me.down) { dx = 0; dy = 0; }
    const l = Math.hypot(dx, dy); meMoving = false;
    if (l > 0.01) {
      if (l > 1) { dx /= l; dy /= l; }
      if (running && (!canRun() || me.run === false && performance.now() - runSetT > 1500)) setRun(false);
      const sp = G.speed * (me.speed || 1) * (running ? G.run.mul : 1) * dt;
      // round to what we send so client and server always agree
      const r2 = v => Math.round(v * 100) / 100;
      const nx = r2(m.x + dx * sp); if (!blockedAt(nx, m.y)) m.x = nx;
      const ny = r2(m.y + dy * sp); if (!blockedAt(m.x, ny)) m.y = ny;
      m.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8; meMoving = Math.hypot(m.x - m.rx, m.y - m.ry) > 0.001;
      stepAcc += Math.hypot(m.x - m.rx, m.y - m.ry);
      if (stepAcc > 0.62) { stepAcc = 0; FX.play('step', tileAt(Math.floor(m.x), Math.floor(m.y))); if (Math.random() < .5) FX.dust(m.x, m.y); }
    }
    if (autoPath) autoPath.stuck = Math.hypot(m.x - ox0, m.y - oy0) < .004 ? autoPath.stuck + dt : 0;
    // walking down onto the door mat takes you outside, no button needed
    if (dy > .3 && near?.type === 'exit' && Math.hypot(near.x - m.x, near.y - m.y) < Math.max(.7, near.r * .6) && performance.now() > actCd) { actCd = performance.now() + 1500; autoPath = null; send({ t: 'exit' }); }
    m.rx = m.x; m.ry = m.y;
    m.ox *= 0.8; m.oy *= 0.8; if (Math.abs(m.ox) < .002) m.ox = 0; if (Math.abs(m.oy) < .002) m.oy = 0;
    sendT += dt;
    const sig = m.x.toFixed(2) + ',' + m.y.toFixed(2);
    if (sendT > 0.066 && sig !== lastSent) { sendT = 0; lastSent = sig; send({ t: 'p', x: +m.x.toFixed(2), y: +m.y.toFixed(2), f: m.f, fx: fixId }); }
  }
  for (const p of P.values()) if (p.id !== myId) { const k = Math.min(1, dt * 12); p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }

  near = findNear();
  const ab = $('#actBtn');
  if (near) {
    ab.classList.remove('idle'); $('#actIcon').textContent = near.icon;
    const closed = near.type === 'door' && near.house === undefined && (near.renov || !isOpen(near.bld));
    const stf = STAFF_AT[near.id];
    if (stf) { $('#actIcon').textContent = '💬'; staffGreet(stf); }
    if (near.type === 'pier' && me.cast) $('#actIcon').textContent = me.cast.state === 'bite' ? '‼️' : '⏳';
    $('#actLabel').textContent = stf ? `คุยกับ${stf.short}` : near.type === 'door' ? (near.house !== undefined ? `บ้าน #${near.house + 1}` : near.renov ? '🚧 ปิดปรับปรุง' : closed ? '🔒 ปิดอยู่' : 'เข้า ' + near.label)
      : near.type === 'exit' ? 'ออกจากอาคาร' : near.type === 'gate' ? near.label : near.type === 'seat' ? 'นั่ง' : near.type === 'sdesk' ? 'นั่งเรียน'
      : near.type === 'pier' && me.cast ? (me.cast.state === 'bite' ? 'กดตอนเข้าเขียว!' : 'รอปลา...') : near.label;
    ab.classList.toggle('closed', closed);
  } else { ab.classList.add('idle'); ab.classList.remove('closed'); $('#actIcon').textContent = '👆'; $('#actLabel').textContent = 'ใช้งาน'; }
  if (panel?.st && (!near || near.id !== panel.st)) closePanel();
  if (panel?.kind === 'player' && !P.get(panel.pid)) closePanel();
  drawFishBar();
  draw(t);
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
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawTile(G.map.tiles[ty][tx], tx, ty, tx * TS + X, ty * TS + Y, tm);
  if (!myRoom) for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) drawEdges(tx, ty, tx * TS + X, ty * TS + Y);
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
  for (const n of STAFF) if (vis(n.rx, n.ry, 3)) ents.push([n.ry + .3, 4, n]);
  if (myRoom?.rk === 'hospital') (wd?.beds || []).forEach((b, i) => { if (b && b[5]) { const s = STN('bed' + i); ents.push([s.y + .3, 4, npcPatient(b, s)]); } });
  ents.sort((a, b) => a[0] - b[0]);
  if (!myRoom) drawCastShadows(ents, X, Y, night);
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
    if (/^(door|exit|bed|hbed|chair|seat|staff|sdesk)$/.test(s.type) && !isNear) continue;
    if (s.type === 'door' && s.house !== undefined) continue;
    ctx.font = `${Math.round(TS * (isNear ? .7 : .55))}px serif`; ctx.fillStyle = '#fff';
    ctx.fillText(s.type === 'door' ? '🚪' : s.icon, px, py - TS * (s.type === 'lot' || s.type === 'gate' ? 1.1 : 1.7) + Math.sin(t / 380 + s.x) * 3);
    if (s.type === 'gate') sign(`${s.icon} ${s.label}`, px, py - TS * 1.8, { size: TS * .3, bg: 'rgba(40,90,150,.92)' });
  }
  drawBobber(X, Y, t);
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
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py, TS * (lying ? .55 : .32), TS * .11, 0, 0, 7); ctx.fill();
  ctx.save();
  if (lying) { ctx.translate(px, py - TS * .25); ctx.rotate(-Math.PI / 2); drawCharTo(ctx, p, H * .45, TS * .25, k, 'front', 0); }
  else if (sitting) {   // seated: legs tucked away, body lowered a little
    ctx.beginPath(); ctx.rect(px - H, py - H * 1.2, H * 2, H * 1.2 - H * .2); ctx.clip();
    drawCharTo(ctx, p, px, py + H * .12, k, 'front', 0);
  } else drawCharTo(ctx, p, px, py - bob, k, view, frame, dir === 'left');
  ctx.restore();
  const mine = p.id === myId, top = lying ? py0 - TS * .9 : py - H * .97 - bob + (sitting ? H * .12 : 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (pose === 'beg') { ctx.font = `${Math.round(TS * .45)}px serif`; ctx.fillText('🥣', px, py0 - TS * .05); }
  if (p.w && me?.career === 'police') { ctx.font = `${Math.round(TS * .55)}px serif`; ctx.fillText('🚨', px - TS * .45, top + Math.sin(t / 120) * 3); }
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
const STAFF_DEF = {
  office:   { name: 'คุณนภา (ฝ่ายบุคคล)', short: 'คุณนภา', lk: { hair: 'black' }, hi: 'สวัสดีค่ะ สนใจร่วมงานกับไทยเทคไหมคะ?', yes: 'ทำงานให้ตรงเวลานะคะ เข้างาน 8 โมง!' },
  farmer:   { name: 'ลุงคำ (ประธานสหกรณ์)', short: 'ลุงคำ', hi: 'มาทำไร่ด้วยกันไหมหลาน ได้กินผักสดทุกวัน', yes: 'ดูแลแปลงดีๆ นะหลาน' },
  fishing:  { name: 'น้าเล็ก (สมาคมประมง)', short: 'น้าเล็ก', hi: 'มือใหม่ยังไม่มีเงิน? ซื้อเบ็ดคันละ ฿150 ไปตกปลาขายสิ หาเงินง่ายสุดแล้ว!', yes: 'ปลากินเบ็ดแล้วกดให้ตรงแถบเขียวนะ!' },
  merchant: { name: 'เฮียชัย (เจ้าของคลังสินค้า)', short: 'เฮียชัย', lk: { hair: 'black' }, hi: 'ของถูกเอาไปขายแพง กำไรงามนะ สนใจไหม?', yes: 'ซื้อถูกขายแพง จำไว้!' },
  chef:     { name: 'เชฟหมี (หัวหน้าครัว)', short: 'เชฟหมี', hi: 'อยากเป็นเชฟต้องมีใบรับรองนะ แล้วมาปรุงด้วยกัน', yes: 'วัตถุดิบดี อาหารก็อร่อย!' },
  doctor:   { name: 'หมอวิทย์ (ผอ.โรงพยาบาล)', short: 'หมอวิทย์', lk: { hair: 'silver' }, hi: 'โรงพยาบาลขาดหมอ ถ้าเรียนจบแพทย์แล้วมาช่วยกันนะ', yes: 'อยู่ในโรงพยาบาลช่วงเวรได้เงินเดือนทุกชั่วโมงนะ' },
  rider:    { name: 'พี่ต่อ (หัวหน้าไรเดอร์)', short: 'พี่ต่อ', hi: 'มีใบขับขี่ไหม? มาวิ่งส่งอาหารกัน', yes: 'ออเดอร์เข้าเยอะ ดูแอพด้วยนะ! ใบขับขี่ต้องต่ออายุทุกปีด้วย' },
  police:   { name: 'ผู้กองเอก (สถานีตำรวจ)', short: 'ผู้กองเอก', hi: 'เมืองนี้ต้องการผู้พิทักษ์ จบ ม.6 แล้วมาสอบนายสิบนะ', yes: 'ถ้ามีแจ้งเหตุ 191 รีบไปนะ' },
  beggar:   { name: 'ป้าจุก (ศาลาประชาคม)', short: 'ป้าจุก', lk: { hair: 'silver', shirt: 'white', pants: 'brown' }, hi: 'ไม่มีงานทำก็มานั่งขอทานกับป้าได้นะลูก นั่งตรงไหนก็ได้', yes: 'ใครบริจาคก็ขอบคุณเขาด้วยนะลูก' },
};
let STAFF = [], STAFF_AT = {};
function buildStaff() {
  STAFF = []; STAFF_AT = {};
  for (const s of G.stations.filter(x => x.type === 'staff')) {
    const d = STAFF_DEF[s.career]; if (!d) continue;
    const x = s.x, y = s.y - 0.35;
    const n = { id: 'staff_' + s.career, staff: 1, career: s.career, c: s.career, of: s.career, name: d.name, short: d.short, st: s.id, at: s.at, lk: { hair: 'brown', shirt: 'white', pants: 'gray', ...(d.lk || {}) },
      x, y, rx: x, ry: y, f: 6, dz: [], line: m => (m.career === s.career || s.career === 'fishing' && m.rod) ? ` ${d.yes}` : ` ${d.hi}`, greetT: 0 };
    STAFF.push(n); STAFF_AT[s.id] = n;
  }
}
function staffGreet(n) {
  const t = performance.now(); if (t - n.greetT < 20000) return;
  n.greetT = t; n.bubble = n.line(me).trim(); n.bt = t + 5000;
}
function nameAndBubble(p, px, top, mine, t = performance.now()) {
  const icon = p.staff || p.wk ? CAREER_ICON(p.c) || '💬' : p.npc ? '🏘️' : CAREER_ICON(p.c);
  const label = `${p.adm ? '👑 ' : ''}${icon} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`;
  if (p.adm) premiumName(label, px, top - TS * .22, t);
  else sign(label, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,214,110,.96)' : p.npc ? 'rgba(80,70,50,.62)' : 'rgba(58,36,20,.82)', color: mine ? '#222' : '#fff' });
  if (p.afk) sign('💤 ไม่อยู่', px, top + TS * .12, { size: TS * .2, bg: 'rgba(60,60,80,.85)' });
  if (p.title) {
    ctx.font = `800 ${Math.round(TS * .22)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, top - TS * .58);
    // title colour = rarity; legendary titles (and the mayor's) shimmer
    if (p.adm || p.tr >= 5) { const c0 = p.adm ? '#ffd34d' : RAR_COL[5], w = ctx.measureText(`«${p.title}»`).width, g = ctx.createLinearGradient(px - w / 2, 0, px + w / 2, 0), sh = (t / 1400) % 1; g.addColorStop(0, c0); g.addColorStop(Math.max(0, sh - .15), c0); g.addColorStop(sh, '#fffbe6'); g.addColorStop(Math.min(1, sh + .15), c0); g.addColorStop(1, p.adm ? '#ffb52e' : '#ff8a1e'); ctx.fillStyle = g; }
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
    const w = ctx.measureText(txt).width + 16, by = top - TS * (p.title ? 1.12 : .86), bh = TS * .5;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.beginPath(); ctx.roundRect(px - w / 2, by - bh / 2, w, bh, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 6, by + bh / 2 - 1); ctx.lineTo(px + 6, by + bh / 2 - 1); ctx.lineTo(px, by + bh / 2 + 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillText(txt, px, by + 1);
  }
}
// the admin's name tag: a rainbow that keeps flowing, with a soft glow
function premiumName(text, x, y, t) {
  const fs = Math.max(10, Math.round(TS * .29));
  ctx.font = `800 ${fs}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fs * 1.1, h = fs * 1.6;
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
  if (p.w && me?.career === 'police') { ctx.font = `${Math.round(TS * .55)}px serif`; ctx.fillText('🚨', px - 7 * u, top + Math.sin(t / 120) * 3); }
  const badge = pose === 'veg' ? '🥬' : pose === 'hosp' ? '🚑' : pose === 'jail' ? '⛓️' : pose === 'rest' || pose === 'bed' ? '💤' : p.sad ? '😞' : '';
  if (badge) { ctx.font = `${Math.round(TS * .42)}px serif`; ctx.fillText(badge, px + 7 * u, top + Math.sin(t / 300) * 3); }
  sign(`${CAREER_ICON(p.c)} ${p.name}${(p.dz || []).length ? ' ' + p.dz.join('') : ''}`, px, top - TS * .22, { size: TS * .27, bg: mine ? 'rgba(255,201,77,.95)' : 'rgba(18,22,28,.78)', color: mine ? '#222' : '#fff' });
  if (p.title) { ctx.font = `800 ${Math.round(TS * .22)}px 'Mitr','Noto Sans Thai',sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(`«${p.title}»`, px, top - TS * .58); ctx.fillStyle = RAR_COL[p.tr] || '#ffd34d'; ctx.fillText(`«${p.title}»`, px, top - TS * .58); }
  if (p.bubble && performance.now() < p.bt) {
    const txt = p.bubble.length > 30 ? p.bubble.slice(0, 29) + '…' : p.bubble;
    ctx.font = `${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
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
    if (p.npc) continue;
    const q = outPos(p.rx, p.ry); if (mapOf(areaOf(q.x, q.y)?.id) !== mapId) continue;
    const s = p.id === myId ? 6 : 5, mx = (q.x - A.x) * 2, my = (q.y - A.y) * 2;
    g.fillStyle = '#fff'; g.fillRect(mx - s / 2 - 1, my - s / 2 - 1, s + 2, s + 2);
    g.fillStyle = p.id === myId ? '#ff6b3d' : p.adm ? `hsl(${(performance.now() / 8) % 360},90%,55%)` : COLORS[(p.id * 7 + (p.av || 0)) % COLORS.length]; g.fillRect(mx - s / 2, my - s / 2, s, s);
  }
  if (me?.career === 'police') for (const rp of me.reports || []) { const q = AREA[rp.area]?.kind === 'room' ? AREA[rp.area].outside : rp; if (mapOf(rp.area) !== mapId) continue; g.fillStyle = (performance.now() / 300 | 0) % 2 ? '#ff2b2b' : '#fff'; g.fillRect((q.x - A.x) * 2 - 4, (q.y - A.y) * 2 - 4, 8, 8); }
  $('#miniName').textContent = `🗺️ ${A.name}`;
}

// ------------------------------------------------------------------ panels
function openPanel(p) {
  if (p.kind === 'chat') p.sig = 'x';
  if (p.kind === 'player') { const o = P.get(p.pid); if (o && !o.npc) send({ t: 'info', id: p.pid }); }
  panel = p; panelSig = ''; $('#panel').classList.remove('hidden'); refreshPanel(true);
  if (p.kind === 'chat') setTimeout(() => $('#chatIn')?.focus(), 50);
}
function closePanel() { panel = null; $('#panel').classList.add('hidden'); }
function refreshPanel(force) {
  if (!panel || !me) return;
  let html = renderPanel(panel);
  const stf = panel.st && STAFF_AT[panel.st];
  if (stf) html = html.replace('</h2>', `</h2><div class="npcSay"><canvas class="npcFace" data-staff="${stf.career}" width="48" height="56"></canvas><div><b>${esc(stf.name)}</b>${esc(stf.line(me))}</div></div>`);
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
  const f = root.querySelector('#chatForm'); if (f) f.onsubmit = e => { e.preventDefault(); const i = $('#chatIn'); if (i.value.trim()) send({ t: 'chat', text: i.value, ch: chatTab }); i.value = ''; };
  const cf = root.querySelector('#callForm'); if (cf) cf.onsubmit = e => { e.preventDefault(); const i = $('#callIn'); if (i.value.trim()) send({ t: 'call_msg', text: i.value }); i.value = ''; };
  root.querySelectorAll('[data-staff]').forEach(c => whenChars(() => {
    const n = STAFF.find(x => x.career === c.dataset.staff); if (!n) return;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); drawCharTo(g, n, 24, 98, 100 / CH_ATLAS.h, 'front', 0);
  }));
  root.querySelectorAll('[data-look]').forEach(c => whenChars(() => {
    const [cat, id] = c.dataset.look.split(':'), lk = { ...(me.look || {}), [cat]: id }, g = c.getContext('2d');
    drawCharTo(g, { g: me.gender, lk }, 36, 92, 86 / CH_ATLAS.h, 'front', 0);
  }));
  const ms = root.querySelector('#mSearch'); if (ms) ms.oninput = () => { panel.q = ms.value; refreshPanel(true); };
}
const B = (label, m, cls = '', dis = false) => `<button class="${cls}" data-m="${esc(JSON.stringify(m))}" ${dis ? 'disabled' : ''}>${label}</button>`;
const FN = {
  photo: () => pickPhoto(),
  photoDel: () => send({ t: 'pic', data: '' }),
  chatTab: m => { chatTab = m.tab; panel.sig = 'x' + m.tab; refreshPanel(true); setTimeout(() => $('#chatIn')?.focus(), 30); },
  mailSend: () => { const to = $('#mailTo').value.trim(), text = $('#mailText').value.trim(); if (!to || !text) return toast('ใส่ชื่อผู้รับและข้อความ', '✉️', false); send({ t: 'mail', to, text }); $('#mailText').value = ''; },
  mailReply: m => { panel.to = m.to; refreshPanel(true); $('#mailText')?.focus(); },
  mtab(m) { Object.assign(panel, m.set); refreshPanel(true); },
  list(m, root) { const v = Math.floor(+root.querySelector('#lp_' + m.item).value || 0); send({ t: 'act', st: m.st, a: 'list', item: m.item, qty: m.qty, price: v }); },
  bank(m, root) { const v = m.all ? m.all : +root.querySelector('#bankAmt').value || 0; send({ t: 'act', st: m.st, a: m.op, amt: v }); },
  price(m, root) { send({ t: 'act', st: m.st, a: m.op, price: m.zero ? 0 : +root.querySelector('#' + m.inp).value || 0 }); },
  guide(m) { closePanel(); setGuide(m.key); },
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
  share() { shareGame(); },
  look(m) { send({ t: 'look', ...m.set }); },
  reel() { reel(); },
  bug(m, root) { const v = root.querySelector('#bugIn').value.trim(); if (v.length < 5) return toast('เขียนรายละเอียดอีกนิด', '🐞', false); send({ t: 'bug', text: v, ua: navigator.userAgent.slice(0, 160) + ` ${innerWidth}x${innerHeight}` }); root.querySelector('#bugIn').value = ''; },
  reset(m, root) {
    const pin = root.querySelector('#resetPin').value, ok = root.querySelector('#resetOk').value.trim();
    if (ok !== 'รีเซ็ต') return toast('พิมพ์คำว่า "รีเซ็ต" ในช่องยืนยันก่อน', '⚠️', false);
    if (!confirm('ยืนยันรีเซ็ตตัวละคร? เงิน ของ บ้าน สวน งาน และความสำเร็จทั้งหมดจะหายไป (ID/PIN/ชื่อ/เบอร์โทรยังอยู่)')) return;
    send({ t: 'reset', pin }); closePanel();
  },
  god(m) { send({ t: 'god', op: m.op }); },
  stealP(m) { send({ t: 'steal', to: m.to }); },
};
let bugList = null;
const itemRow = (id, right, sub = '') => { const it = G.items[id]; return `<div class="item"><div class="em">${it.icon}</div><div class="nm">${esc(it.name)}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; };
function itemRowRaw(icon, name, sub, right) { return `<div class="item"><div class="em">${icon}</div><div class="nm">${name}${sub ? `<small>${sub}</small>` : ''}</div>${right}</div>`; }
const eatText = e => [e.hunger && `อิ่ม+${e.hunger}`, e.energy && `⚡+${e.energy}`, e.health && `❤️+${e.health}`].filter(Boolean).join(' ');
let chatTab = 'near';
const chatHtml = () => chatLog.filter(m => m.sys || (chatTab === 'world' ? m.w : !m.w)).map(m => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div class="${m.w ? 'w' : ''}"><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');
// ---- profile photo, titles by rarity, mail
let myPic = '', mailList = [], tradeChat = [];
const infoCache = new Map();
const facePng = () => `assets/ui/face_${me?.gender === 'f' ? 'f' : 'm'}.png`;
function paintPortrait() { const im = $('#mePortrait'); const src = myPic || facePng(); if (im.getAttribute('src') !== src) im.src = src; }
const RAR = ['', 'ธรรมดา', 'ไม่ธรรมดา', 'หายาก', 'มหากาพย์', 'ตำนาน', 'พิเศษ'];
const RAR_COL = ['#ffd34d', '#e8e8e8', '#7be07b', '#62b8ff', '#d08cff', '#ffb43c', '#ffd34d'];
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
    im.onload = () => {
      const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
      const k = Math.min(im.width, im.height); g.drawImage(im, (im.width - k) / 2, (im.height - k) / 2, k, k, 0, 0, S, S);
      let q = .82, d = c.toDataURL('image/jpeg', q); while (d.length > 22000 && q > .3) { q -= .12; d = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(url); send({ t: 'pic', data: d });
    };
    im.onerror = () => toast('เปิดรูปนี้ไม่ได้', '🖼️', false);
    im.src = url;
  };
  inp.click();
}
function achRows() {
  return G.ach.slice().sort((x, y) => (x.r || 1) - (y.r || 1)).map(a => {
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
  const c = G.careers[career], n = STAFF.find(x => x.career === career);
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
const needCareer = c => me.career === c ? '' : `<div class="sub" style="color:var(--bad)">⚠️ ต้องเป็น ${G.careers[c].icon} ${G.careers[c].name} ก่อน</div>`;

function renderPanel(p) {
  const k = p.kind, st = p.st;
  switch (k) {
    case 'office': {
      const l = Math.min(me.career === 'office' ? me.lv : 1, G.titles.length), wage = G.wages[l - 1];
      const o = me.office, today = dayNow();
      let status = '';
      if (me.career === 'office') {
        const state = o && o.day === today ? (o.closed === today ? '✅ เลิกงานแล้ว' : `🟢 เข้างานแล้ว${o.late ? ' (สาย)' : ''} · ${o.hours.toFixed(1)} ชม.`) : '⚪ ยังไม่ลงเวลาเข้างาน';
        status = `<div class="item" style="display:block">ตำแหน่ง <b>${G.titles[l - 1]}</b> · ค่าแรง <b>${money(wage)}</b>/ชม.<br>วันนี้: ${state}<br>มาสาย/ขาดงานสะสม: <b style="color:${(o?.strikes || 0) >= 2 ? 'var(--bad)' : 'inherit'}">${o?.strikes || 0}</b> ครั้ง (3 ครั้งขึ้นไปมีโอกาสถูกเลิกจ้าง)</div>
          <div class="sub" style="margin-top:8px">💺 เดินไปที่ <b>โต๊ะทำงาน</b> ตัวไหนก็ได้แล้วกดนั่ง · เข้างาน ${hhmm(G.shift.start)} (สายได้ถึง ${hhmm(G.shift.grace)}) · เลิก ${hhmm(G.shift.end)}</div>
          ${B('📦 ลาออก', { t: 'resign' }, 'warn')}`;
      }
      return `<h2>🏢 บริษัท ไทยเทค · ฝ่ายบุคคล</h2><div class="sub">${hoursTxt('office')} · เวลางาน ${hhmm(G.shift.start)}–${hhmm(G.shift.end)} · ได้เงินตามชั่วโมงที่นั่งทำงาน (ต้องจบปริญญาตรี)</div>${status}${me.career === 'office' ? '' : staffHint('office')}`;
    }
    case 'sdesk': {
      const L = me.enrolled && G.licenses[me.enrolled];
      return `<h2>📖 โต๊ะเรียน</h2>${L ? `<div class="sub">กำลังเรียน${L.name} ${me.classes}/${L.classes} คาบ · นั่งครบ 1 ชั่วโมงในเกม = 1 คาบ</div>${B('📖 นั่งเรียน', { t: 'act', st, a: 'sit' }, 'primary big')}` : '<div class="sub">ต้องลงทะเบียนเรียนที่เคาน์เตอร์มหาวิทยาลัยก่อน (ม.6 / ปริญญาตรี)</div>'}`;
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
      return `<h2>📦 คลังสินค้าราคาส่ง</h2><div class="sub">${hoursTxt('warehouse')} · สต็อกจำกัด ทุกคนแย่งกัน · ซื้อแต่ละครั้งเสีย ⚡4 · เอาไปวางขายที่ตลาดกลาง</div>${staffHint('merchant')}${me.career === 'merchant' ? `<div class="list">${rows}</div>` : ''}`;
    }
    case 'rider': return `<h2>🛵 ศูนย์ไรเดอร์ส่งอาหาร</h2><div class="sub">${hoursTxt('rider')} · ต้องมีใบขับขี่และมอเตอร์ไซค์ · รับออเดอร์ผ่านแอพในมือถือ 📱</div>${staffHint('rider')}${me.career === 'rider' ? riderJobs() : ''}`;
    case 'restaurant': {
      const rows = Object.entries(G.items).filter(([, it]) => it.menu).map(([id, it]) => itemRow(id, `<div class="col2">${B(`กินเลย ${money(it.base)}`, { t: 'act', st, a: 'eat', item: id }, 'good')}${B('🥡 ใส่กระเป๋า', { t: 'act', st, a: 'buy', item: id, qty: 1 })}</div>`, `${eatText(it.eat)} · มีในกระเป๋า ${me.inv[id] || 0}`)).join('');
      const pick = me.career === 'rider' ? (() => { const n = (me.jobs || []).filter(j => j.mine && j.state === 'taken').length; return `<div class="jobbox">${B(n ? `🥡 รับอาหาร ${n} ออเดอร์` : 'ยังไม่มีออเดอร์ให้รับ', { t: 'act', st, a: 'pickup' }, 'primary big', !n)}</div>`; })() : '';
      return `<h2>🍜 ร้านอาหาร</h2><div class="sub">${hoursTxt('restaurant')} · <b>ซื้อตุนใส่กระเป๋า</b>ไว้กินทีหลังได้ (กดใช้ในกระเป๋า 🎒) · สั่งให้มาส่งได้ผ่านแอพในมือถือ 📱 · ของราคาถูกอาจทำให้🤢อาหารเป็นพิษ</div>${pick}<div class="list">${rows}</div>`;
    }
    case 'kitchen': {
      const rows = G.recipes.map(r => {
        const out = G.items[r.id]; const ok = Object.entries(r.in).every(([i, q]) => (me.inv[i] || 0) >= q);
        const ing = Object.entries(r.in).map(([i, q]) => `${G.items[i].icon}${q} (มี ${me.inv[i] || 0})`).join(' + ');
        return itemRow(r.id, B('ปรุง ⚡12', { t: 'act', st, a: 'cook', rid: r.id }, ok ? 'good' : '', !ok), `${ing} · ขาย ~${money(out.base)} · ${eatText(out.eat)}`);
      }).join('');
      const ings = [...new Set(G.recipes.flatMap(r => Object.keys(r.in)))].map(i => { const it = G.items[i], c = Math.ceil(it.base * 1.3); return itemRow(i, `<div class="col2">${B(`ซื้อ ${money(c)}`, { t: 'act', st, a: 'buy', item: i, qty: 1 }, '', me.money < c)}${B('x5', { t: 'act', st, a: 'buy', item: i, qty: 5 }, '', me.money < c * 5)}</div>`, `มีในกระเป๋า ${me.inv[i] || 0}`); }).join('');
      return `<h2>🍳 ครัวใหญ่</h2><div class="sub">${hoursTxt('kitchen')} · ปรุงอาหารขายได้แพงกว่าวัตถุดิบหลายเท่า · ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง (ถูกกว่า) หรือซื้อที่ครัวนี้ (แพงกว่า 30%)</div>${staffHint('chef')}${me.career === 'chef' ? `<h3>🍳 เมนู</h3><div class="list">${rows}</div><h3>🛒 วัตถุดิบ</h3><div class="list">${ings}</div>` : ''}`;
    }
    case 'hospital': {
      const dz = me.dz || [], price = dz.length ? 1500 + 500 * (dz.length - 1) : 800, waiting = (wd?.beds || []).filter(Boolean).length;
      const mine = dz.map(d => itemRowRaw(G.diseases[d].icon, G.diseases[d].name, `${G.diseases[d].sym.join(' · ')}<br>${G.diseases[d].self}`, '')).join('');
      const shift = me.career === 'doctor' ? `<div class="jobbox ok">🩺 เวรหมอ ${hhmm(G.doctor.start)}–${hhmm(G.doctor.end)} · อยู่ในโรงพยาบาลช่วงนี้ได้เงินเดือน <b>${money(G.doctor.wage[Math.min(me.lv, G.doctor.wage.length) - 1])}</b>/ชม. · วันนี้ ${(me.docShift?.hours || 0).toFixed(1)} ชม.</div>` : '';
      return `<h2>🏥 โรงพยาบาล</h2><div class="sub">เปิด 24 ชม. · สุขภาพ ${Math.floor(me.health)}/100 · <b>ถูกกว่า:</b> นอนที่ <b>เตียงคนไข้</b> รอหมอรักษา (~฿300) · ตอนนี้มีคนไข้ ${waiting} เตียง</div>${shift}
        ${mine ? `<div class="list">${mine}</div>` : '<div class="sub">✅ ตอนนี้คุณไม่ได้ป่วย</div>'}
        <h3>💊 ร้านขายยา</h3><div class="sub">ซื้อยาให้ตรงกับอาการ แล้วกดใช้ในกระเป๋า 🎒 (ถูกกว่าให้พยาบาลรักษา)</div><div class="list">${Object.entries(G.items).filter(([, it]) => it.pharmacy).map(([id, it]) => itemRow(id, B(`ซื้อ ${money(it.base)}`, { t: 'act', st, a: 'medbuy', item: id }, it.cures?.some(d => dz.includes(d)) ? 'good pulse' : '', me.money < it.base), `${it.cures ? `รักษา <b>${it.cures.map(d => G.diseases[d].icon + G.diseases[d].name).join(', ')}</b>${it.cures.some(d => dz.includes(d)) ? ' ✅ ตรงอาการคุณ' : ''} · ` : ''}${eatText(it.eat)} · มีในกระเป๋า ${me.inv[id] || 0}`)).join('')}</div>
        ${B(`💉 ให้พยาบาล NPC รักษาทันที ${money(price)}${dz.length ? ' (หายทุกโรค)' : ' (❤️ +40)'}`, { t: 'act', st, a: 'heal' }, 'big')}
        ${me.career === 'doctor' ? '<div class="sub">🩺 เดินไปที่เตียงที่มีคนไข้ (ทั้งผู้เล่นและชาวเมือง) แล้ววินิจฉัยจากอาการ</div>' : staffHint('doctor')}`;
    }
    case 'bed': {
      const s = STN(st), b = wd?.beds?.[s.idx];
      if (me.career === 'doctor' && b && b[1] !== myId) {
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
    case 'bag': {
      const rows = Object.entries(me.inv).map(([id, q]) => { const it = G.items[id]; return itemRow(id, it.eat ? B('ใช้', { t: 'use', item: id }, 'good') : '', `x${q} · ~${money(it.base)}${it.eat ? ' · ' + eatText(it.eat) : ''}`); }).join('');
      const licTxt = me.licenses.map(l => G.licenses[l].icon + G.licenses[l].name).join(', ') || 'ไม่มี';
      const rod = me.rod ? `🎣 เบ็ด${'★'.repeat((me.tools || {}).fisher || 0) || ' ธรรมดา'} · ตกปลา Lv.${me.fishLv}` : 'ยังไม่มีเบ็ด (ซื้อที่สมาคมประมง)';
      const tools = Object.entries(me.tools || {}).map(([c, t]) => `${G.shop.tools[c]?.icon || ''}${'★'.repeat(t)}`).join(' ') || '—';
      const home = me.house >= 0 ? `บ้านเลขที่ ${me.house + 1} ⭐${me.comfort}` : me.rent ? `เช่าบ้านเลขที่ ${me.rent.idx + 1}` : 'ยังไม่มี';
      const own = `<div class="grid2" style="margin:6px 0"><div class="item"><div class="nm">🎣 ตกปลา<small>${rod}</small></div></div><div class="item"><div class="nm">🛠️ อุปกรณ์<small>${tools}</small></div></div><div class="item"><div class="nm">🏠 บ้าน<small>${home}</small></div>${me.house >= 0 || me.rent ? B('📍', { fn: 'guide', key: 'door_house' + (me.house >= 0 ? me.house : me.rent.idx) }) : ''}</div><div class="item"><div class="nm">🌾 สวน<small>${me.garden ? `แปลงที่ ${me.garden.lot + 1} · ${me.garden.n} แปลงปลูก` : 'ยังไม่มี'}</small></div>${me.garden ? B('📍', { fn: 'guide', key: 'lot' + me.garden.lot }) : ''}</div><div class="item"><div class="nm">🏦 ธนาคาร<small>${money(me.bank)}${me.loan ? ` · หนี้ ${money(me.loan)}` : ''}</small></div></div><div class="item"><div class="nm">📱 เบอร์ของฉัน<small>${me.phone}</small></div></div></div>`;
      const job = me.career !== 'none' && G.careers[me.career]?.where;
      const outfits = (me.outfits || []).map(id => `<div class="setRow"><span><b>🎽 ${esc(G.outfitDefs[id]?.name || id)}</b><small>${esc(G.outfitDefs[id]?.how || '')}</small></span>${B(me.outfit === id ? 'ใส่อยู่ ✓' : 'ใส่', { fn: 'look', set: { outfit: me.outfit === id ? '' : id } }, me.outfit === id ? 'primary' : 'good')}</div>`).join('');
      return `<h2>🎒 กระเป๋า</h2><div class="sub">ใบรับรอง: ${licTxt} · ทรัพย์สินรวม ${money(me.worth)}</div>${own}<div class="list">${rows || '<div class="sub">ยังไม่มีของ</div>'}</div>
        <div class="secT">👕 ชุด</div>
        <div class="setRow"><span><b>ซ่อนชุดอาชีพ</b><small>${job ? `ใส่เสื้อผ้าของตัวเองแทนชุด${G.careers[me.career].name}` : 'ตอนนี้ยังไม่มีชุดอาชีพ'}</small></span>${B(me.hideJob ? 'ซ่อนอยู่' : 'แสดงอยู่', { fn: 'look', set: { hideJob: !me.hideJob } }, me.hideJob ? 'good' : '')}</div>
        ${outfits || '<div class="sub">ชุดพิเศษ (รางวัล) จะมาอยู่ตรงนี้ เช่น 🎽 ชุดนักตกปลา (ตกปลาถึงเลเวลสูงสุด) · ชุดแฟชั่นจะมาเพิ่มในอนาคต</div>'}`;
    }
    case 'career': {
      const cur = G.careers[me.career];
      const rows = Object.entries(G.careers).filter(([id]) => id !== 'none').map(([id, c]) => {
        const where = STN(c.where), stf = STAFF.find(x => x.career === id);
        const miss = (c.need || []).filter(l => !licOk(l)).map(l => G.licenses[l].name + (licExp(l) ? ' (หมดอายุ)' : ''));
        return itemRowRaw(c.icon, `${c.name}${me.career === id ? ' <span class="tag">ปัจจุบัน</span>' : ''}`, `สมัคร: คุยกับ <b>${esc(stf?.short || 'เจ้าหน้าที่')}</b> ที่${where?.label || '-'}${miss.length ? ` · <span style="color:var(--bad)">ต้องมี ${miss.join(', ')}</span>` : ''}<br>${c.desc}`, B('📍 ไป', { fn: 'guide', key: stf ? stf.st : c.where }, 'good'));
      }).join('');
      const starter = `<div class="jobbox">💡 <b>เพิ่งเริ่มเล่น ยังไม่มีเงิน?</b> ไปซื้อเบ็ด ${money(G.fishing.rod)} กับน้าเล็กที่สมาคมประมง แล้ว<b>ตกปลาขาย</b> ทำได้ทุกคนทุกเวลาไม่ต้องสมัครงาน ${me.rod ? '' : B('🎣 ไปซื้อเบ็ด', { fn: 'guide', key: 'staff_fishing' }, 'good')}</div>`;
      return `<h2>💼 งานของฉัน</h2>
        <div class="jobbox ${me.career === 'none' ? '' : 'ok'}">${me.career === 'none' ? '🙂 ตอนนี้ยัง<b>ว่างงาน</b> — เดินเข้าไปสมัครงานในอาคารต่างๆ ได้เลย' : `${cur.icon} <b>${cur.name}</b> · Lv.${me.lv}`}
        ${me.jobWait > 0 ? `<div class="sub" style="color:var(--bad)">⏳ สมัครงานใหม่ได้ในอีก ${Math.ceil(me.jobWait / 60000)} นาที</div>` : ''}
        ${me.career !== 'none' ? B('📦 ลาออก', { t: 'resign' }, 'warn') : ''}</div>
        ${starter}<div class="sub" style="margin-top:8px">⏳ เปลี่ยนงานแล้วต้องรอ 5 นาทีถึงจะสมัครงานใหม่ได้ · 🎣 ตกปลา และ 🕶️ ล้วงกระเป๋า ทำได้ทุกคน ไม่ต้องสมัคร</div><div class="list">${rows}</div>`;
    }
    case 'toolshop': {
      const order = [me.career, ...Object.keys(G.shop.tools).filter(c => c !== me.career)].filter(c => G.shop.tools[c]);
      const rows = order.map(c => {
        const d = G.shop.tools[c], t = (me.tools || {})[c] || 0, cc = G.careers[c] || { fisher: { icon: '🎣', name: 'ตกปลา (ทุกคน)' }, thief: { icon: '🕶️', name: 'ล้วงกระเป๋า (ทุกคน)' } }[c] || { icon: '', name: c };
        const sub = t >= 3 ? `สูงสุดแล้ว · ${d.fx[2]}` : `ถัดไป: ${d.fx[t]}${t ? ` · ตอนนี้: ${d.fx[t - 1]}` : ''}`;
        return itemRowRaw(d.icon, `${d.name} <span class="tag">${cc.icon} ${cc.name}</span> <span style="color:var(--acc)">${'★'.repeat(t)}${'☆'.repeat(3 - t)}</span>`, sub,
          t >= 3 ? '<span class="tag">MAX</span>' : B(money(G.shop.toolPrices[t]), { t: 'act', st, a: 'buy', career: c }, c === me.career ? 'good' : ''));
      }).join('');
      return `<h2>🛠️ ร้านอุปกรณ์</h2><div class="sub">${hoursTxt('toolshop')} · อัปเกรดอุปกรณ์ให้หาเงินได้มากขึ้น · อัปได้ 3 ระดับ</div><div class="list">${rows}</div>`;
    }
    case 'dealer': return `<h2>🚧 โชว์รูมรถ</h2><div class="sub">ปิดปรับปรุงชั่วคราว · สอบ/ต่ออายุใบขับขี่ได้ที่มหาวิทยาลัย</div>`;
    case 'bank': {
      const bk = G.shop.bank;
      return `<h2>🏦 ธนาคาร</h2>${billsBox()}<div class="sub">${hoursTxt('bank')} · ดอกเบี้ย <b>${bk.rate * 100}% ต่อวัน</b> (บนยอดไม่เกิน ${money(bk.cap)})</div>
        <div class="grid2"><div class="item"><div class="nm">💵 เงินสด<small><b style="color:var(--acc);font-size:16px">${money(me.money)}</b></small></div></div><div class="item"><div class="nm">🏦 เงินฝาก<small><b style="color:var(--ok);font-size:16px">${money(me.bank)}</b></small></div></div></div>
        <div class="rowf" style="margin-top:10px"><input id="bankAmt" type="number" min="1" value="1000" inputmode="numeric"></div>
        <div class="grid2" style="margin-top:8px">${B('⬇️ ฝาก', { fn: 'bank', st, op: 'deposit' }, 'good')}${B('⬆️ ถอน', { fn: 'bank', st, op: 'withdraw' })}${B('ฝากทั้งหมด', { fn: 'bank', st, op: 'deposit', all: Math.floor(me.money) })}${B('ถอนทั้งหมด', { fn: 'bank', st, op: 'withdraw', all: me.bank })}</div>
        <div class="sub" style="margin-top:14px"><b>💳 กู้เงิน</b> · สูงสุด ${money(bk.loanMax)} ค่าธรรมเนียม ${bk.loanFee * 100}% · ระหว่างเป็นหนี้ ${bk.repayShare * 100}% ของรายได้ถูกหักใช้หนี้อัตโนมัติ</div>
        <div class="item"><div class="nm">หนี้คงเหลือ<small><b style="color:${me.loan ? 'var(--bad)' : 'var(--ok)'};font-size:16px">${money(me.loan)}</b></small></div>${B('กู้', { fn: 'bank', st, op: 'borrow' })}${B('ใช้คืน', { fn: 'bank', st, op: 'repay' }, me.loan ? 'good' : '', !me.loan)}</div>`;
    }
    case 'pier': {
      const s = STN(st), c = me.cast, pool = G.fish[s.pool] || [];
      const fishes = pool.filter(([id]) => id).map(([id]) => `${G.items[id].icon}${G.items[id].name}`).join(' · ');
      const head = `<h2>🎣 ${esc(s.label)}</h2><div class="sub">ปลาแถวนี้: ${fishes} · ตกปลา Lv.${me.fishLv}${me.fishLv >= G.fishing.maxLv ? ' (สูงสุด)' : ` (${me.fishXp % G.fishing.xpPerLv}/${G.fishing.xpPerLv})`}</div>`;
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
      return `<h2>🎣 สมาคมประมง · ร้านขายปลา</h2><div class="sub">${hoursTxt('fishclub')} · แหล่งตกปลา: 🏞️ ทะเลสาบ (ใต้เมือง) · 🌊 ทะเล (ฝั่งตะวันออก) · 🐟 แม่น้ำ (ไร่ชานเมือง)</div>
        <div class="jobbox">💬 ซื้อเบ็ด/อัปเกรดเบ็ด คุยกับ <b>น้าเล็ก</b> ที่ยืนอยู่ข้างๆ</div>
        ${fish.length ? `<div class="sub" style="margin-top:10px"><b>รับซื้อปลา</b> (ดีกว่าร้าน NPC ในตลาด แต่ถูกกว่าขายให้ผู้เล่น)</div><div class="list">${rows}</div>` : '<div class="sub">ยังไม่มีปลาในกระเป๋า</div>'}`;
    }
    case 'staff': {
      const S = STN(st), key = S.career;
      if (key === 'fishing') {
        const T = (me.tools || {}).fisher || 0, d = G.shop.tools.fisher;
        const rod = me.rod ? itemRowRaw('🎣', 'เบ็ดตกปลาของคุณ', `ตกปลา Lv.${me.fishLv}/${G.fishing.maxLv} · ${T ? `อัปเกรดแล้ว ${'★'.repeat(T)}` : 'เบ็ดธรรมดา'}`, '<span class="tag">มีแล้ว ✓</span>')
          : itemRowRaw('🎣', 'เบ็ดตกปลา', 'ตกปลาได้ทุกท่า ทุกเวลา ไม่ต้องสมัครงาน · ปลาขายได้ที่นี่หรือตลาดกลาง', B(`ซื้อ ${money(G.fishing.rod)}`, { t: 'act', st, a: 'rod' }, 'primary'));
        const up = me.rod && T < 3 ? itemRowRaw(d.icon, `${d.name} ระดับ ${T + 1}`, d.fx[T], B(money(G.shop.toolPrices[T]), { t: 'act', st: 'toolshop', a: 'buy', career: 'fisher' }, 'good', true)) + '<div class="sub">อัปเกรดเบ็ดได้ที่ 🛠️ ร้านอุปกรณ์</div>' : '';
        const outfit = (me.outfits || []).includes('fisher') ? `<div class="jobbox ok">🎽 คุณได้ชุดนักตกปลาแล้ว! ใส่ได้ที่ ⚙️ ตั้งค่า</div>` : `<div class="sub">🏆 ตกปลาจนถึง Lv.${G.fishing.maxLv} ได้รางวัล <b>ชุดนักตกปลา</b></div>`;
        return `<h2>🎣 น้าเล็ก · สมาคมประมง</h2><div class="list">${rod}</div>${up}${outfit}
          <div class="sub" style="margin-top:8px">วิธีตก: ไปที่ท่าตกปลา 🎣 → เหวี่ยงเบ็ด → พอปลากินเบ็ด ขีดขาวจะวิ่งไปมา <b>กดตอนอยู่ในแถบเขียว</b></div>`;
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
    case 'fashion': {
      const W = { hair: [], shirt: [], pants: [], ...(me.wardrobe || {}) }, lk = me.look || {};
      const sec = (cat, title) => `<div class="sub" style="margin-top:10px"><b>${title}</b></div><div class="looks">${Object.entries(G.looks[cat]).map(([id, it]) => {
        const has = W[cat].includes(id), on = lk[cat] === id;
        return `<div class="look ${on ? 'on' : ''}"><canvas data-look="${cat}:${id}" width="72" height="96"></canvas><small>${esc(it.name)}</small>${on ? '<span class="tag">ใส่อยู่</span>' : has ? B('ใส่', { t: 'wear', cat, id }, 'good') : B(money(it.price), { t: 'act', st, a: 'buy', cat, id }, '')}</div>`;
      }).join('')}</div>`;
      return `<h2>💇 ร้านแฟชั่น & ทำผม</h2><div class="sub">${hoursTxt('fashion')} · ทุกคนเริ่มด้วยผมสีน้ำตาลเหมือนกัน มาย้อมผม เปลี่ยนเสื้อ และกางเกงได้ที่นี่ (แต่งตัวใหม่แล้วมีความสุขเพิ่ม) · ของที่ซื้อแล้วเปลี่ยนกลับไปใส่ได้ฟรี</div>
        ${sec('hair', '💇 ย้อมสีผม')}${sec('shirt', '👕 เสื้อ')}${sec('pants', '👖 กางเกง')}`;
    }
    case 'police': return `<h2>👮 สถานีตำรวจ</h2><div class="sub">เปิด 24 ชม. · ตำรวจได้เบี้ยเลี้ยงตอนลาดตระเวนนอกอาคาร + ค่าหัวเมื่อจับโจร · ต้องจบ ม.6 และสอบนายสิบตำรวจที่มหาวิทยาลัย</div>${staffHint('police')}${me.career === 'police' ? policeReports() : ''}`;
    case 'square': return `<h2>📋 ศาลาประชาคม</h2><div class="sub">${hoursTxt('square')} · ขอทานนั่งได้ทุกที่ (ปุ่ม 🥣) ที่คนพลุกพล่านอย่างหน้าร้าน/จัตุรัสได้เงินบ่อยกว่า</div>${staffHint('beggar')}`;
    case 'begspot': return `<h2>🥣 ${esc(STN(st).label)}</h2><div class="sub">ทำเลดี คนผ่านเยอะ</div>${me.career === 'beggar' ? B(me.pose === 'beg' ? 'ลุกขึ้น' : '🥣 นั่งขอทานตรงนี้', { t: 'act', st, a: 'beg' }, 'primary big') : '<div class="sub">ถ้าเจอขอทาน กด 💬 คุย เพื่อบริจาค</div>'}`;
    case 'crowd': return `<h2>👥 ${esc(STN(st).label)}</h2><div class="sub">ผู้คนพลุกพล่าน · ใครก็ล้วงกระเป๋าได้ (ทุก 1 นาที) ตอนล้วงจะใส่ชุดโจรทันที คนเห็นแจ้งตำรวจได้ และสายตรวจจะวิ่งไล่จับ · ถ้าพลาดอาจถูกจับคาหนังคาเขา</div>${me.career === 'police' ? '<div class="sub">👮 ตำรวจล้วงกระเป๋าไม่ได้</div>' : B('🕶️ ล้วงกระเป๋าในฝูงชน (⚡8)', { t: 'act', st, a: 'pick' }, 'warn big')}`;
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
    case 'ach':
    case 'profile': {
      const ti = G.ach.find(x => x.id === me.title), got = (me.ach || []).length;
      return `<h2>🪪 ข้อมูลผู้เล่น</h2>
        <div class="prof"><img class="ph" src="${myPic || facePng()}" alt=""><div class="pi"><b>${me.admin ? '👑 ' : ''}${esc(me.name)}</b><div>${CAREER_ICON(me.career)} ${G.careers[me.career]?.name || 'ว่างงาน'} · Lv.${me.lv}</div><div>${me.admin ? titleHtml(G.adminTitle || 'นายกเทศมนตรี', 6) : ti ? titleHtml(ti.title, ti.r) : '<small>ยังไม่ได้ตั้งฉายา</small>'}</div>
          <div class="grid2" style="margin-top:6px">${B('🖼️ เปลี่ยนรูปจากอัลบั้ม', { fn: 'photo' }, 'good')}${myPic ? B('ลบรูป', { fn: 'photoDel' }) : ''}</div></div></div>
        <div class="grid2"><div class="item"><div class="nm">💰 ทรัพย์สินรวม<small>${money(me.worth)}</small></div></div><div class="item"><div class="nm">🎣 ตกปลา<small>Lv.${me.fishLv}</small></div></div><div class="item"><div class="nm">📱 เบอร์<small>${me.phone}</small></div></div><div class="item"><div class="nm">🏅 ฉายา<small>${got}/${G.ach.length}</small></div></div></div>
        <div class="secT">🏅 ฉายา · สีบอกความหายาก: ${[1, 2, 3, 4, 5].map(r => `<span class="rtag r${r}">${RAR[r]}</span>`).join('')}</div>
        <div class="sub">ตั้งฉายาที่ปลดล็อกแล้วให้ลอยบนหัว ทุกคนในเมืองเห็น</div><div class="list">${achRows()}</div>`;
    }
    case 'mail': {
      if (!p.read) { p.read = 1; if ((me.mailN || 0) > 0) send({ t: 'mailread' }); }
      const rows = mailList.map(x => `<div class="mailItem ${x.read ? '' : 'new'}"><small>${x.read ? '' : '🆕 '}จาก <b>${esc(x.from)}</b> · ${new Date(x.t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</small><p>${esc(x.text)}</p>
        <div class="rowf" style="margin-top:4px">${B('↩️ ตอบกลับ', { fn: 'mailReply', to: x.from })}${B('🗑️', { t: 'maildel', id: x.id }, 'warn')}</div></div>`).join('');
      const names = [...new Set([...(me.friends || []).map(f => f.n), ...[...P.values()].filter(x => !x.npc && x.id !== myId).map(x => x.name)])];
      return `<h2>📬 กล่องจดหมาย</h2><div class="sub">ส่งถึงผู้เล่นคนไหนก็ได้ด้วยชื่อตัวละคร แม้เขาจะออฟไลน์ เก็บได้ 50 ฉบับล่าสุด</div>
        <div class="secT">✍️ เขียนจดหมาย</div>
        <input id="mailTo" maxlength="16" list="mailNames" placeholder="ชื่อผู้รับ" value="${esc(p.to || '')}"><datalist id="mailNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <textarea id="mailText" maxlength="500" placeholder="ข้อความ..."></textarea>${B('📨 ส่งจดหมาย', { fn: 'mailSend' }, 'primary big')}
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
    case 'help':
      return `<h2>❔ วิธีเล่น</h2><div class="sub" style="font-size:14px;line-height:1.7">
        👣 <b>เดิน</b>: มือถือแตะค้างแล้วลาก หรือ<b>แตะพื้น</b>ให้ตัวละครเดินไปเอง (มีเส้นนำทาง) · แตะตัวคนอื่นเพื่อดูข้อมูล · คอม WASD/ลูกศร<br>
        🟡 <b>ปุ่มใหญ่ขวาล่าง</b>: แตะ = เข้าอาคาร/ใช้งาน/ดึงเบ็ด (คอม: E) · <b>กดค้าง = วิ่ง</b> (คอม: Shift) · ออกจากอาคารแค่เดินลงไปที่พรมหน้าประตู · 💬 <b>คุย</b> กับคนใกล้ๆ (F) · 😌 <b>พัก</b> (R) · 😀 อิโมจิบนหัว<br>
        💰 <b>เริ่มต้นไม่มีเงิน?</b> ซื้อเบ็ดที่สมาคมประมงแล้ว<b>ตกปลาขาย</b> · กดตอนขีดขาวอยู่ในแถบเขียว<br>
        💼 <b>หางาน</b>: คุยกับ NPC เจ้าหน้าที่ (💬) ที่ยืนข้างเคาน์เตอร์ของแต่ละที่ · เปลี่ยนงานแล้วรอ 5 นาที<br>
        🎓 <b>เรียน</b>: ลงทะเบียนที่มหาวิทยาลัย แล้วนั่งที่โต๊ะเรียน 1 ชั่วโมงในเกม = 1 คาบ · ใบขับขี่ต้องต่ออายุทุกปี<br>
        🕐 <b>เวลา</b>: 1 วันในเกม = 24 นาที (กลางคืน 19:00–07:00 ผ่านไปใน 3 นาที) · ร้านต่างๆ มีเวลาเปิด-ปิด<br>
        😌 <b>พัก</b>: นั่งพักได้ทุกที่ พลังงานฟื้นเร็ว 3 เท่า และเลือดค่อยๆ ฟื้น (ถ้าไม่หิว)<br>
        ❤️ <b>สุขภาพ</b>: หิวนานเลือดลด · ป่วยต้องหาหมอ · แตะแถบสถานะเพื่อดูวิธีเพิ่ม<br>
        🍱 <b>ตุนอาหาร</b>: ซื้อใส่กระเป๋าที่ร้านอาหาร แล้วกด "ใช้" ในกระเป๋าตอนหิว<br>
        🕶️ <b>ล้วงกระเป๋า</b>: ใครก็ทำได้ (ยกเว้นตำรวจ) จะใส่ชุดโจรทันที คนเห็นแจ้ง 191 ได้ สายตรวจ NPC จะวิ่งไล่จับ<br>
        👥 <b>เพื่อน</b>: คุยกับคนอื่นแล้ว "📱 ขอเบอร์" (ปฏิเสธ 2 ครั้ง ต้องรอ 10 นาที) · ดูเพื่อนที่ออนไลน์ที่เมนู 👥<br>
        💤 ไม่ได้แตะจอ 2 นาที จะขึ้นว่า "ไม่อยู่"</div>
        <div class="grid2" style="margin-top:8px">${B('📖 ดูบทช่วยสอน', { fn: 'tut' })}${B('🗺️ เปิดแผนที่', { fn: 'map' })}</div>`;
    case 'player': {
      const o = P.get(p.pid); if (!o) return '';
      const m = P.get(myId), d = Math.hypot(o.x - m.x, o.y - m.y), far = d > 5.5, canSteal = me.career !== 'police';
      const stealBtn = canSteal ? B('🕶️ ล้วงกระเป๋า (ต้องประชิดตัว · ใส่ชุดโจร)', { fn: 'stealP', to: o.id }, 'warn', d > 1.8) : '';
      if (o.npc) {
        if (o.wk) return `<h2>${CAREER_ICON(o.c)} ${esc(o.name)} <span class="tag">NPC</span></h2><div class="sub">ทำงาน${G.careers[o.c]?.name || ''}แทน เพราะตอนนี้ไม่มีผู้เล่นทำงานนี้ออนไลน์${o.c === 'police' ? ' · สายตรวจจะวิ่งไล่จับคนที่ถูกแจ้งความ' : ''}</div>`;
        return `<h2>🏘️ ${esc(o.name)} <span class="tag">ชาวเมือง</span></h2><div class="sub">ชาวบ้านที่เดินไปมาในเมือง ทักทายกันได้ในแชท</div>${stealBtn}`;
      }
      const fee = `<input id="feeIn" type="number" value="200" min="0" max="1000" style="width:90px">`;
      const known = (me.contacts || []).some(c => c.n === o.name);
      const inf = infoCache.get(o.id);
      const prof = `<div class="prof"><img class="ph" src="${inf?.pic || `assets/ui/face_${o.g === 'f' ? 'f' : 'm'}.png`}" alt=""><div class="pi">
        <div>${CAREER_ICON(o.c)} ${G.careers[o.c]?.name || 'ว่างงาน'} · Lv.${o.lv || 1}</div><div>${titleHtml(o.title, o.tr)}</div>
        ${inf ? `<small>💰 ${money(inf.worth)} · 🎣 Lv.${inf.fishLv} · อยู่ในเมือง ${inf.days} วัน${inf.home ? ` · 🏠 บ้าน #${inf.home}` : ''}${inf.degree ? ' · 🎓' : ''}${inf.phone ? ` · 📱 ${inf.phone}` : ''}</small>` : '<small>กำลังโหลด...</small>'}</div></div>
        ${inf?.ach?.length ? `<div class="tchips">${inf.ach.slice(0, 12).map(([t, r]) => `<span class="rar${r}">🏅 ${esc(t)}</span>`).join('')}</div>` : ''}`;
      return `<h2>${o.adm ? '👑 ' : ''}${esc(o.name)}${o.afk ? ' <span class="tag">💤 ไม่อยู่</span>' : ''}</h2>${prof}
        <div class="grid2" style="margin-bottom:6px">${B('✉️ ส่งจดหมาย', { fn: 'open', kind: 'mail', set: { to: o.name } })}</div>
        <div class="sub">${far ? '⚠️ อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน' : 'อยู่ใกล้พอที่จะติดต่อกันได้'}</div>
        <div class="grid2">${B('🤝 แลกเปลี่ยน', { fn: 'tradeReq', to: o.id }, 'primary', far)}${B(known ? '📇 มีเบอร์แล้ว' : '📱 ขอเบอร์', { t: 'req', kind: 'phone', to: o.id }, 'good', far || known)}</div>
        ${me.career === 'doctor' ? `<div class="rowf" style="margin-top:8px">ค่ารักษา ${fee} ${B('💉 เสนอปฐมพยาบาล', { fn: 'heal', to: o.id }, 'good', far)}</div>` : ''}
        ${o.c === 'beggar' ? `<div class="jobbox">🥣 ขอทาน · บริจาคแล้วอิ่มบุญ ความสุขเพิ่ม<div class="rowf" style="margin-top:6px"><input id="donIn" type="number" value="20" min="1" style="width:90px"> ${B('🙏 บริจาค', { fn: 'donate', to: o.id }, 'good', far)}</div></div>` : ''}
        ${o.th ? `<div class="jobbox">🕶️ ${esc(o.name)} ใส่ชุดโจร! ${B('📞 แจ้งตำรวจ 191', { t: 'report', thief: o.id }, 'warn')}</div>` : ''}
        ${me.career === 'police' ? (o.w ? B('👮 จับกุม! (มีการแจ้งความ)', { t: 'arrest', to: o.id }, 'warn big pulse', d > 2) : '<div class="sub">👮 ไม่มีการแจ้งความเกี่ยวกับคนนี้</div>') : `<div style="margin-top:8px">${stealBtn}</div>`}`;
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
      const bl = bugList ? (bugList.length ? bugList.map(b => `<div class="bugItem">${esc(b.text)}<small>${esc(b.by)} · ${esc(b.where)} · ${new Date(b.t).toLocaleString('th-TH')}</small></div>`).join('') : '<div class="sub">ไม่มีรายงานบัค</div>') : '';
      return `<h2>👑 God mode</h2><div class="sub">เฉพาะแอดมิน · ปกติเล่นด้วยค่าสเตตัสธรรมดา</div>
        <div class="setRow"><span><b>⚡ ไม่มีคูลดาวน์</b><small>ทุกอย่างไม่ต้องรอ (เปลี่ยนงาน ล้วง ตกปลา ฯลฯ)</small></span>${B(g.nocd ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'nocd' }, g.nocd ? 'good' : '')}</div>
        <div class="setRow"><span><b>🛡️ ล็อกสเตตัสเต็ม</b><small>ไม่หิว ไม่ป่วย ไม่หมดสติ</small></span>${B(g.lock ? 'เปิดอยู่' : 'ปิดอยู่', { fn: 'god', op: 'lock' }, g.lock ? 'good' : '')}</div>
        <div class="grid2">${B('💯 สเตตัสเต็ม', { fn: 'god', op: 'fill' }, 'primary')}${B('💰 เงิน 999,999', { fn: 'god', op: 'money' }, 'primary')}</div>
        <div class="secT">🐞 รายงานบัคจากผู้เล่น</div><div class="grid2">${B('📥 โหลดรายงาน', { fn: 'god', op: 'bugs' })}${B('🗑️ ล้างทั้งหมด', { fn: 'god', op: 'bugclear' }, 'warn', !bugList?.length)}</div>${bl}`;
    }
    case 'settings': {
      const fsOn = !!document.fullscreenElement, canFs = !!document.documentElement.requestFullscreen;
      return `<h2>⚙️ ตั้งค่า</h2>
        <div class="secT">🔊 เสียง</div><div class="grid2">${B(FX.opts.sfx ? '🔊 เสียงเอฟเฟกต์: เปิด' : '🔇 เสียงเอฟเฟกต์: ปิด', { fn: 'toggle', k: 'sfx' }, FX.opts.sfx ? 'good' : '')}${B(FX.opts.music ? '🎵 เพลง: เปิด' : '🎵 เพลง: ปิด', { fn: 'toggle', k: 'music' }, FX.opts.music ? 'good' : '')}</div>
        <div class="secT">⛶ หน้าจอ</div><div class="grid2">${B(fsOn ? '↙️ ออกจากเต็มจอ' : '⛶ เต็มจอ', { fn: 'fs', mode: fsOn ? 'exit' : 'full' }, fsOn ? '' : 'primary', !canFs)}${B('🔄 เต็มจอ + แนวนอน', { fn: 'fs', mode: 'landscape' }, 'good', !canFs)}</div>
        ${canFs ? '' : '<div class="sub">iPhone/iPad: กดแชร์ ⬆️ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดเกมจากไอคอนจะเต็มจอ</div>'}
        ${me.admin ? `<div class="secT">👑 แอดมิน</div>${B('👑 เปิด God mode', { fn: 'open', kind: 'god' }, 'primary big')}` : ''}
        <div class="secT">🎮 อื่นๆ</div>
        <div class="grid2">${B('📤 ชวนเพื่อน', { fn: 'share' }, 'good')}${B('🐞 แจ้งบัค', { fn: 'open', kind: 'bug' })}${B('❔ วิธีเล่น', { fn: 'open', kind: 'help' })}${B('📖 บทช่วยสอน', { fn: 'tut' })}</div>
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
function policeReports() {
  const r = me.reports || [];
  if (!r.length) return '<div class="sub" style="margin-top:10px">ยังไม่มีการแจ้งเหตุ · เมื่อมีคนโทร 191 ตำแหน่งโจรจะขึ้นที่นี่และบนแผนที่ (เฉพาะตำรวจ)</div>';
  return `<div class="list">${r.map(c => itemRowRaw('🚨', `${esc(c.thief)} ล้วงกระเป๋า${c.victim ? ` ${esc(c.victim)}` : ''}`, `${c.amt ? `เงินที่หายไป ${money(c.amt)} · ` : ''}แจ้งเมื่อ ${Math.max(0, Math.round((Date.now() + clockOff - c.t) / 1000))} วิที่แล้ว · ${AREA[c.area]?.name || ''}`,
    `<div class="col2">${B('📍 จุดที่เห็น', { fn: 'guidePt', x: c.x, y: c.y, area: c.area, label: `จุดที่เห็น ${c.thief}` }, 'good')}${P.get(c.tid) ? B('🎯 ตามตัว', { fn: 'guide', key: 'p' + c.tid }, 'warn') : ''}</div>`)).join('')}</div>
    <div class="sub">เข้าใกล้โจรแล้วแตะที่ตัวเพื่อจับกุม (โจรที่มีการแจ้งความจะมี 🚨 บนหัว)</div>`;
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
  const tabs = `<div class="tabs">${[['contacts', '📇 รายชื่อ'], ['call', call ? '📞 กำลังคุย' : '📞 โทร'], ['food', '🍔 อาหาร'], ['bills', (me.bills || []).length ? '🧾 บิล ❗' : '🧾 บิล'], ...(me.career === 'rider' ? [['rider', '🛵 ไรเดอร์']] : []), ...(me.career === 'police' ? [['police', '🚨 แจ้งเหตุ']] : [])].map(([k, l]) => B(l, { fn: 'mtab', set: { tab: k } }, tab === k ? 'primary' : '')).join('')}</div>`;
  let body = '';
  if (tab === 'contacts') {
    const onl = new Set((me.friends || []).filter(f => f.on).map(f => f.p));
    const rows = (me.contacts || []).map(c => itemRowRaw(onl.has(c.p) ? '🟢' : '⚪', esc(c.n), c.p, `<div class="rowf">${B('📞', { t: 'call', phone: c.p }, 'good', !!call)}${B('🗑️', { t: 'contact_del', phone: c.p })}</div>`)).join('');
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
  else if (tab === 'bills') body = billsBox();
  else if (tab === 'police') body = policeReports();
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
  const w = ctx.measureText(text).width + fs * .9, h = fs * 1.55;
  ctx.fillStyle = o.bg || 'rgba(58,36,20,.88)';
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
const FLOOR = { fashion: 'fl_beige', police: 'fl_wood', office: 'fl_checker', market: 'fl_beige', warehouse: 'g_pavers', rider: 'fl_stone', dealer: 'fl_white', toolshop: 'fl_brick',
  restaurant: 'fl_checker', kitchen: 'fl_bluecheck', hospital: 'fl_white', school: 'fl_wood', bank: 'fl_beige', house: 'fl_wood' };
const WALL = { fashion: '#f6d6e4', police: '#c7d3e6', office: '#c9d3dc', market: '#f1e3c4', warehouse: '#8d7a5e', rider: '#3f6b63', dealer: '#dfe6ec', toolshop: '#b9a17f',
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
  if (b.renov) { sign(`🚧 ${b.label} · ปิดปรับปรุง`, cx, top - TS * .15, { size: TS * .32, bg: 'rgba(150,90,10,.92)', border: '#ffc94d88' }); return; }
  if (b.deco) { ctx.globalAlpha = .75; sign(`${b.icon} ${b.label}`, cx, top - TS * .1, { size: TS * .26 }); ctx.globalAlpha = 1; return; }
  const open = isOpen(b.id);
  sign(`${b.icon} ${b.label}${open ? '' : ' · ปิด'}`, cx, top - TS * .15, { size: TS * .34, bg: open ? 'rgba(18,22,28,.9)' : 'rgba(90,30,30,.92)', border: '#ffc94d88' });
  const o = G.hours[b.id]; if (o && o[1] - o[0] < 24) sign(`${hhmm(o[0])}–${hhmm(o[1])}`, cx, top + TS * .32, { size: TS * .22, bg: 'rgba(0,0,0,.55)' });
}
// ------------------------------------------------------------------ depth: soft tile edges, cast shadows, sunlight
// material of a tile for edge blending (trees and buildings stand on grass)
const MAT = c => c === '=' ? 'road' : ',ckp'.includes(c) ? 'pave' : c === 's' ? 'sand' : c === 'w' ? 'water' : c === 'f' ? 'soil' : c === ' ' || c === '#' || c === 'i' || c === 'D' || c === 'o' ? null : 'grass';
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
  const me = MAT(tileAt(tx, ty)); if (!me || me === 'water') return;
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
const FLAT = /^(f_rug|flowerbed|fl_|g_|pond|grass_tuft|sign_walk)/;
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
    else if (kind === 1) one(e.s, e.x, e.y);
    else if (kind === 2) one(e[2], e[0] + .5, e[1] + 1.05);
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
const GATE_TO = { farm_in: 'farm', town_from_farm: 'town', housing_in: 'housing', town_from_housing: 'town' };
function targetOf(key) {
  if (key && key[0] === 'p' && /^p\d+$/.test(key)) { const p = P.get(+key.slice(1)); return p && { player: p.id, label: p.name }; }
  const s = STN(key); return s && { x: s.x, y: s.y, label: s.label, area: s.area };
}
const CAREER_TARGET = { police: 'police', beggar: 'square', none: 'staff_fishing', office: 'office', farmer: 'coop', merchant: 'warehouse', chef: 'kitchen', doctor: 'hospital', rider: 'rider' };
const QUEST_TARGET = { work: 'office', harvest: 'coop', fish: 'pier_l1', buy: 'warehouse', cook: 'kitchen', treat: 'hospital', deliver: 'rider', sell: 'market', eat: 'restaurant', sit: 'seatb43.6', study: 'school' };
function setGuide(key, quiet) {
  const g = targetOf(key); if (!g) return;
  guide = g;
  if (g.label === 'เจ้าหน้าที่' && STAFF_AT[key]) g.label = STAFF_AT[key].short;
  if (!quiet) { toast(`นำทางไป ${g.label} — เดินตามลูกศรสีเหลือง (ยกเลิกได้ที่ปุ่มใต้สถานะ)`, '📍'); FX.play('notice'); }
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
  mapId = mapId || mapOf(areaOf(m.x, m.y)?.id);
  if (mapId !== mapCur && !keepScroll) mapZoom = Math.min(mapZoom, 5);
  mapCur = mapId;
  const A = AREA[mapId];
  $('#mapView').classList.remove('hidden');
  $('#mapTabs').innerHTML = G.areas.filter(a => a.kind === 'map').map(a => `<button data-map="${a.id}" class="${a.id === mapId ? 'primary' : ''}">${a.name}</button>`).join('');
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
    g.fillStyle = b.deco ? '#b9a48f' : b.house !== undefined ? (mineHouse ? '#f2b636' : '#d98f6a') : isOpen(b.id) ? '#4d5b7a' : '#7a4a4a';
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
    if (s.type === 'lot' && !(me.garden?.lot === s.lot) && !(!wd?.lots?.[s.lot] && me.career === 'farmer')) continue;
    const [x, y] = L(s.x, s.y);
    places.push({ key: s.id, icon: s.icon, label: s.type === 'lot' ? (me.garden?.lot === s.lot ? 'สวนของฉัน' : `สวนว่าง #${s.lot + 1}`) : s.label, sub: s.type === 'gate' ? 'ทางไปแผนที่อื่น' : s.type === 'pier' ? 'จุดตกปลา' : '', x, y, hl: me.garden?.lot === s.lot, kind: s.type === 'gate' ? 'gate' : 'spot' });
  }
  if (mapId === 'town') { const [x, y] = L(50, 32); places.push({ key: 'seatb43.6', icon: '⛲', label: 'จัตุรัสกลางเมือง', sub: 'นั่งเล่น พูดคุย', x, y, kind: 'spot' }); }
  // job staff (where you apply / change jobs) are their own markers, kept apart from the places
  const staffPl = [];
  for (const n of STAFF) {
    const s = STN(n.st); if (!s) continue;
    const room = AREA[s.area]?.kind === 'room' ? AREA[s.area] : null, q = room ? room.doorPt : s;
    if (mapOf(s.area) !== mapId) continue;
    const [x, y] = L(q.x + (room ? 1.4 : 0), q.y + (room ? -1.2 : 0)), c = G.careers[n.career];
    staffPl.push({ key: n.st, icon: '👤', label: n.short, sub: n.career === 'fishing' ? '🎣 ซื้อเบ็ด (ตกปลาได้ทุกคน)' : `${c?.icon || ''} สมัคร/เปลี่ยนเป็น${c?.name || ''}${room ? ` · ใน${room.label}` : ''}`, x, y, kind: 'staff', hl: me.career === n.career, ci: n.career === 'fishing' ? '🎣' : c?.icon || '👤' });
  }
  // numbered markers (job staff are person pins with their career's symbol)
  const r = clamp(k * .95, 8, 13);
  places.forEach((pl, i) => {
    pl.n = i + 1;
    dot(pl.x, pl.y, r + 2, 'rgba(0,0,0,.45)');
    dot(pl.x, pl.y, r, pl.hl ? '#ffc94d' : pl.kind === 'gate' ? '#2f7fd1' : pl.kind === 'home' ? '#c0623e' : pl.kind === 'spot' ? '#2e8a57' : '#1f2630');
    g.fillStyle = pl.hl ? '#222' : '#fff'; g.font = `800 ${Math.round(r * 1.05)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(pl.n, pl.x, pl.y + 1);
  });
  staffPl.forEach((pl, i) => {
    pl.n = pl.ci;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.moveTo(pl.x, pl.y + r * 1.5); g.arc(pl.x, pl.y - r * .2, r + 2, Math.PI * .8, Math.PI * 2.2); g.fill();
    g.fillStyle = pl.hl ? '#ffc94d' : '#8b4fc4'; g.beginPath(); g.moveTo(pl.x, pl.y + r * 1.3); g.arc(pl.x, pl.y - r * .2, r, Math.PI * .8, Math.PI * 2.2); g.fill();
    g.font = `${Math.round(r * 1.15)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pl.n, pl.x, pl.y - r * .15);
  });
  // police only: where reported thieves were seen
  if (me.career === 'police') for (const rp of me.reports || []) if (mapOf(rp.area) === mapId) {
    const q = AREA[rp.area]?.kind === 'room' ? AREA[rp.area].outside : rp, [x, y] = L(q.x, q.y);
    g.strokeStyle = '#ff3b3b'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 1.6, 0, 7); g.stroke();
    g.font = `${Math.round(r * 1.6)}px serif`; g.fillText('🚨', x, y);
  }
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
  const row = pl => `<button data-key="${esc(pl.key)}" class="${pl.hl ? 'hl' : ''}"><i class="k-${pl.kind}">${pl.n}</i><span>${pl.kind === 'staff' ? '' : pl.icon + ' '}${esc(pl.label)}${pl.sub ? `<small>${esc(pl.sub)}</small>` : ''}</span></button>`;
  $('#mapLegend').innerHTML = `<div class="lgHead">⚪ คุณอยู่${here ? `ใน${esc(here.label)}` : 'ที่วงสีส้ม'} · 🟢 ผู้เล่นออนไลน์บนแผนที่นี้ ${onHere} คน · แตะชื่อเพื่อนำทาง</div>`
    + (staffPl.length ? `<div class="lgSec">👤 NPC สมัครงาน / เปลี่ยนอาชีพ</div>${staffPl.map(row).join('')}` : '')
    + `<div class="lgSec">📍 สถานที่</div>${places.map(row).join('')}`;
  places.push(...staffPl);
  $('#mapLegend').querySelectorAll('[data-key]').forEach(b => b.onclick = () => { closeMap(); setGuide(b.dataset.key); });
  if (!keepScroll && mapZoom > 1) { const q = outPos(m.x, m.y), [x, y] = L(q.x, q.y), box = $('#mapScroll'); box.scrollLeft = x - box.clientWidth / 2; box.scrollTop = y - box.clientHeight / 2; }
  c.onclick = e => {
    const rc = c.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
    const hit = places.map(pl => [pl, Math.hypot(pl.x - x, pl.y - y)]).sort((a, b) => a[1] - b[1])[0];
    if (hit && hit[1] < r * 2.2) { closeMap(); setGuide(hit[0].key); }
  };
}
function closeMap() { $('#mapView').classList.add('hidden'); }

// first-time tutorial
const TUT = () => [
  ['👋', 'ยินดีต้อนรับสู่เมือง!', 'ตัวคุณคือตัวละครที่มีป้ายชื่อ<b>สีเหลือง</b> ผู้เล่นคนอื่นก็อยู่ในเมืองเดียวกัน'],
  ['👣', 'วิธีเดิน', 'มือถือ: <b>แตะค้างตรงไหนก็ได้แล้วลากนิ้ว</b><br>คอม: ปุ่ม <b>W A S D</b> หรือลูกศร'],
  ['🚪', 'เข้าอาคาร', 'เดินไปหน้าประตู แล้วกด<b>ปุ่มกลมสีเหลือง</b> (คอม: E) · ร้านต่างๆ มี<b>เวลาเปิด-ปิด</b> ดูได้ที่ป้าย'],
  ['🎣', 'หาเงินก้อนแรก', 'แนะนำให้<b>ตกปลา</b>ก่อน! ซื้อเบ็ดกับ<b>น้าเล็ก</b>ที่สมาคมประมง (ริมทะเลสาบ) แล้วไปท่าตกปลา · พอปลากินเบ็ด <b>กดตอนขีดขาวอยู่ในแถบเขียว</b> · เอาปลาไปขายได้เลย'],
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
  box.innerHTML = `<div class="tutIcon">🎁</div><h2>โบนัสเข้าเกมวันที่ ${d.streak}</h2><p>เข้าเล่นทุกวันติดต่อกัน รางวัลจะเพิ่มขึ้นเรื่อยๆ</p>
    <div class="days">${d.table.map((v, i) => `<div class="${i + 1 < Math.min(d.streak, 7) ? 'got' : i + 1 === Math.min(d.streak, 7) ? 'now' : ''}"><small>วัน ${i + 1}</small><b>฿${v.toLocaleString()}</b></div>`).join('')}</div>
    <div class="big-reward">+${money(d.reward)}</div><button class="primary big" id="dailyOk">รับเลย!</button>`;
  $('#dailyWrap').classList.remove('hidden');
  $('#dailyOk').onclick = () => { $('#dailyWrap').classList.add('hidden'); FX.play('coin', true); };
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
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${Math.round(TS * .3)}px 'Mitr','Noto Sans Thai',sans-serif`;
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

// ------------------------------------------------------------------ fishing timing game
// after a bite a white marker sweeps the bar; press while it is inside the green zone
let fishBite = null;
const fishPos = () => { if (!fishBite) return -1; const ph = ((performance.now() - fishBite.t) / 1000 * fishBite.speed * 0.95) % 2; return ph < 1 ? ph : 2 - ph; };
function reel() {
  if (!me?.cast) return;
  const st = near?.type === 'pier' ? near.id : panel?.kind === 'pier' ? panel.st : null; if (!st) return;
  const pos = me.cast.state === 'bite' && fishBite ? +fishPos().toFixed(3) : -1;
  FX.play('click'); doAct(st, 'reel', { pos });
  if (pos >= 0) { const z = fishBite.zone, hit = pos >= z[0] - .02 && pos <= z[1] + .02; FX.play(hit ? 'splash' : 'fail'); }
  fishBite = null;
}
function drawFishBar() {
  const mk = document.getElementById('fMark'); if (!mk || !fishBite) return;
  const zn = document.getElementById('fZone'), z = fishBite.zone || [0.4, 0.6];
  if (!zn.dataset.set) { zn.dataset.set = 1; zn.style.left = z[0] * 100 + '%'; zn.style.width = (z[1] - z[0]) * 100 + '%'; const bar = document.getElementById('fBar'); bar.onpointerdown = e => { e.preventDefault(); reel(); }; }
  mk.style.left = fishPos() * 100 + '%';
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
  if (!a.cast && b.cast) { bobber = findWater(s.x, s.y); FX.play('whoosh'); if (bobber) setTimeout(() => { FX.play('splash'); FX.ring(bobber.x, bobber.y, '#fff', 800, 1); }, 250); }
  if (!b.cast) { bobber = null; fishBite = null; }
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
window.__lt = { P, camera, get me() { return me; }, get myId() { return myId; }, get running() { return running; }, get TS() { return TS; }, openPanel };   // read-only hooks for automated UI tests
$('#tchatForm').onsubmit = e => { e.preventDefault(); const i = $('#tchatIn'); if (i.value.trim()) send({ t: 'trade_chat', text: i.value }); i.value = ''; };
})();
