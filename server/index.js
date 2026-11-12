'use strict';
// Authoritative multiplayer server: HTTP (static client) + WebSocket (game).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./data');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SAVE_FILE = path.join(DATA_DIR, 'players.json');
const PUBLIC = path.join(__dirname, '..', 'public');
const DAY_MS = 8 * 60 * 1000;               // one in-game day
const SPEED = 4.2;                          // tiles / second (client)
const TICK = 100;

// ------------------------------------------------------------------ state
const accounts = new Map();                 // lowercase name -> account
const online = new Map();                   // id -> account
const ST = Object.fromEntries(D.STATIONS.map(s => [s.id, s]));
const plots = D.STATIONS.filter(s => s.type === 'plot').map(() => null);
const market = {};                          // item -> { mult, target }
const stock = {};                           // wholesale stock
for (const [k, it] of Object.entries(D.ITEMS)) {
  market[k] = { mult: 1, target: 1 };
  if (it.wholesale) stock[k] = it.stock;
}
let event = null;                           // { id, text, until }
let nextEventAt = Date.now() + 90_000;
const chatLog = [];
const reqs = new Map();                     // pending requests (trade / heal)
let nextId = 1, dirty = false;

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ev = id => event && event.id === id;
const lvl = (a, c = a.career) => 1 + Math.floor((a.xp[c] || 0) / 10);
const money = n => '฿' + Math.round(n).toLocaleString('en-US');
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

function send(a, obj) {
  if (a.ws && a.ws.readyState === 1) a.ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const a of online.values()) if (a.ws.readyState === 1) a.ws.send(s);
}
function toast(a, msg, icon = '✅', ok = true) { send(a, { t: 'toast', msg, icon, ok }); }
function feed(text) {
  const m = { t: 'chat', sys: true, text, ts: now() };
  chatLog.push(m); if (chatLog.length > 40) chatLog.shift();
  broadcast(m);
}
function markMe(a) { a.meDirty = true; dirty = true; }

function wellbeing(a) {
  let m = 1;
  if (a.hunger < 15) m *= 0.7;
  if (a.health < 30) m *= 0.6;
  return m;
}
function earn(a, amount) { amount = Math.round(amount); a.money += amount; a.earned += amount; markMe(a); return amount; }
function spend(a, e) {
  if (a.energy < e) { toast(a, `พลังงานไม่พอ (ต้องใช้ ${e}) กินอาหารหรือพักผ่อนก่อน`, '😴', false); return false; }
  a.energy -= e; return true;
}
function pay(a, amount) {
  if (a.money < amount) { toast(a, `เงินไม่พอ (ต้องใช้ ${money(amount)})`, '💸', false); return false; }
  a.money -= amount; return true;
}
function cd(a, key, ms) {
  const t = now();
  if ((a.cd[key] || 0) > t) { toast(a, `รออีก ${Math.ceil((a.cd[key] - t) / 1000)} วินาที`, '⏳', false); return false; }
  a.cd[key] = t + ms; return true;
}
function addItem(a, id, n) { a.inv[id] = (a.inv[id] || 0) + n; if (a.inv[id] <= 0) delete a.inv[id]; }
function need(a, career) {
  if (a.career !== career) { toast(a, `ต้องเปลี่ยนอาชีพเป็น ${D.CAREERS[career].name} ก่อน (เมนู 💼)`, '🚫', false); return false; }
  return true;
}
function addXp(a, n = 1) { a.xp[a.career] = (a.xp[a.career] || 0) + n; }

function sellPrice(a, id) {
  const it = D.ITEMS[id];
  let p = it.base * market[id].mult;
  if (ev('festival') && (it.kind === 'meal' || it.kind === 'goods')) p *= 1.3;
  if (ev('drought') && it.kind === 'crop') p *= 1.4;
  let b = 1;
  if (a.career === 'merchant') b += 0.12;
  if (a.career === 'chef' && it.kind === 'meal') b += 0.10;
  if (a.career === 'farmer' && it.kind === 'crop') b += 0.08;
  if (a.career === 'fisher' && it.kind === 'fish') b += 0.08;
  return p * b;
}
function worth(a) {
  let w = a.money;
  for (const [k, q] of Object.entries(a.inv)) w += (D.ITEMS[k]?.base || 0) * q * 0.7;
  return w;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ------------------------------------------------------------------ persistence
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
const SAVE_KEYS = ['name', 'salt', 'hash', 'avatar', 'money', 'energy', 'hunger', 'health', 'career', 'licenses',
  'xp', 'followers', 'inv', 'x', 'y', 'earned', 'created'];
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    for (const r of raw) accounts.set(r.name.toLowerCase(), hydrate(r));
    console.log(`loaded ${accounts.size} players`);
  } catch { /* first run */ }
}
function hydrate(r) {
  return Object.assign({
    avatar: 0, money: 2000, energy: 100, hunger: 100, health: 100, career: 'office', licenses: [], xp: {},
    followers: 0, inv: {}, x: D.SPAWN.x, y: D.SPAWN.y, earned: 0, created: now(),
  }, r, { ws: null, id: null, f: 0, cd: {}, task: null, cast: null, trade: null, lastPosT: now(), moved: false, meDirty: false });
}
function save() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = [...accounts.values()].map(a => Object.fromEntries(SAVE_KEYS.map(k => [k, a[k]])));
    fs.writeFileSync(SAVE_FILE + '.tmp', JSON.stringify(out));
    fs.renameSync(SAVE_FILE + '.tmp', SAVE_FILE);
  } catch (e) { console.error('save failed', e.message); }
}

// ------------------------------------------------------------------ public views
function pubInfo(a) {
  return { id: a.id, name: a.name, av: a.avatar, c: a.career, fol: a.followers, lv: lvl(a) };
}
function sendRoster() {
  broadcast({ t: 'roster', players: [...online.values()].map(a => ({ ...pubInfo(a), x: a.x, y: a.y, f: a.f })) });
}
function meView(a) {
  return {
    t: 'me', id: a.id, name: a.name, money: Math.round(a.money), energy: a.energy, hunger: a.hunger, health: a.health,
    career: a.career, licenses: a.licenses, lv: lvl(a), xp: a.xp, followers: a.followers, inv: a.inv,
    cast: a.cast ? { state: a.cast.state } : null, task: a.task ? { code: a.task.code } : null,
    earned: a.earned, worth: Math.round(worth(a)),
  };
}
function worldView() {
  const t = now();
  const lb = [...accounts.values()].map(a => ({ name: a.name, av: a.avatar, c: a.career, w: Math.round(worth(a)), on: !!a.ws }))
    .sort((x, y) => y.w - x.w).slice(0, 10);
  const mk = {};
  for (const k in market) mk[k] = Math.round(sellPriceFor(k) * 10) / 10;
  return {
    t: 'wd', now: t, phase: (t % DAY_MS) / DAY_MS, on: online.size,
    mk, stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, Math.floor(v)])),
    plots: plots.map(p => p ? [p.crop, p.owner, p.ownerName, p.readyAt] : 0),
    ev: event ? { id: event.id, text: event.text, until: event.until } : null, lb,
  };
}
function sellPriceFor(id) { return sellPrice({ career: '' }, id); }

// ------------------------------------------------------------------ quiz
function newTask(a) {
  const l = lvl(a, 'programmer');
  const x = rint(3, 9 + l * 2), y = rint(2, 9 + l), z = rint(1, 40);
  const k = rint(0, 2);
  let code, answer;
  if (k === 0) { code = `x = ${x} * ${y} + ${z}\nprint(x)`; answer = x * y + z; }
  else if (k === 1) { const n = rint(3, 5 + l); code = `s = 0\nfor i in range(${n}):\n    s += i * ${y}\nprint(s)`; answer = [...Array(n).keys()].reduce((s, i) => s + i * y, 0); }
  else { code = `print((${x * y + z}) % ${y})`; answer = (x * y + z) % y; }
  a.task = { code, answer, at: now() };
}

// ------------------------------------------------------------------ actions
function rollFish(a) {
  const l = lvl(a, 'fisher');
  const ws = D.FISH.map(f => {
    let w = f.w;
    if (f.id === null) w = Math.max(5, w - l);
    if (ev('bloom') && ['seabass', 'tuna', 'shark', 'chest'].includes(f.id)) w *= 2;
    return w;
  });
  let r = Math.random() * ws.reduce((s, v) => s + v, 0);
  for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return D.FISH[i].id; }
  return 'sfish';
}

function act(a, m) {
  const s = ST[m.st];
  if (!s) return;
  if (Math.hypot(a.x - s.x, a.y - s.y) > s.r + 0.9) return toast(a, 'อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน', '⚠️', false);
  const key = s.type + '.' + m.a;
  const wb = wellbeing(a);
  switch (key) {
    case 'office.work': case 'office.ot': {
      if (!need(a, 'office')) return;
      const ot = m.a === 'ot';
      if (!cd(a, 'work', 1500) || !spend(a, ot ? 30 : 15)) return;
      const l = Math.min(lvl(a), D.OFFICE_TITLES.length);
      let p = (450 + 160 * (l - 1)) * (ot ? 1.9 : 1) * wb * (ev('boom') ? 1.25 : 1);
      const got = earn(a, p);
      if (ot) a.health = Math.max(0, a.health - 3);
      const before = lvl(a); addXp(a);
      let msg = `${ot ? 'ทำโอที' : 'ทำงาน'}เสร็จ ได้ ${money(got)}`;
      if (lvl(a) > before && lvl(a) <= D.OFFICE_TITLES.length) {
        msg += ` 🎊 เลื่อนเป็น ${D.OFFICE_TITLES[lvl(a) - 1]}`;
        feed(`🎊 ${a.name} ได้เลื่อนตำแหน่งเป็น${D.OFFICE_TITLES[lvl(a) - 1]}`);
      }
      return toast(a, msg, ot ? '🌙' : '💼');
    }
    case 'market.sell': {
      const id = m.item, it = D.ITEMS[id];
      let q = Math.floor(+m.qty);
      if (!it || !(q > 0)) return;
      const have = a.inv[id] || 0;
      if (m.qty === 'all') q = have;
      q = Math.min(q, have, 500);
      if (q <= 0) return toast(a, 'ไม่มีของชิ้นนี้', '⚠️', false);
      if (!cd(a, 'sell', 300)) return;
      let total = 0;
      for (let i = 0; i < q; i++) { total += sellPrice(a, id); market[id].mult = Math.max(0.4, market[id].mult * 0.985); }
      addItem(a, id, -q);
      const got = earn(a, total);
      if (got >= 3000) feed(`💰 ${a.name} ขาย${it.name}ล็อตใหญ่ได้ ${money(got)}`);
      return toast(a, `ขาย ${it.icon}${it.name} x${q} ได้ ${money(got)}`, '💰');
    }
    case 'warehouse.buy': {
      if (!need(a, 'merchant')) return;
      const id = m.item, it = D.ITEMS[id];
      if (!it || !it.wholesale) return;
      let q = clamp(Math.floor(+m.qty) || 1, 1, 50);
      if (stock[id] < q) q = Math.floor(stock[id]);
      if (q <= 0) return toast(a, 'สินค้าหมดสต็อก รอเติมของหน่อย', '📦', false);
      if (!pay(a, it.wholesale * q)) return;
      stock[id] -= q; addItem(a, id, q); addXp(a, 0.2); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคาส่ง ${money(it.wholesale * q)}`, '📦');
    }
    case 'studio.stream': {
      if (!need(a, 'streamer')) return;
      if (!cd(a, 'stream', 3000) || !spend(a, 20)) return;
      const base = 250 + a.followers * 0.5;
      let views = Math.round(base * Math.exp(rnd(-0.5, 0.6)));
      const viral = Math.random() < (ev('viral') ? 0.12 : 0.04);
      if (viral) views *= rint(8, 20);
      const got = earn(a, views * 0.9 * wb);
      const nf = Math.round(views * rnd(0.04, 0.08)); a.followers += nf; addXp(a);
      if (viral) { feed(`🔥 คลิปของ ${a.name} ไวรัล! ${views.toLocaleString()} วิว`); }
      sendRoster();
      return toast(a, `${viral ? 'ไวรัล!! ' : 'ไลฟ์จบ '}${views.toLocaleString()} วิว ได้ ${money(got)} ผู้ติดตาม +${nf.toLocaleString()}`, viral ? '🔥' : '🎥');
    }
    case 'cowork.new': {
      if (!need(a, 'programmer')) return;
      if (!cd(a, 'task', 1500)) return;
      newTask(a); return markMe(a);
    }
    case 'cowork.submit': {
      if (!need(a, 'programmer')) return;
      if (!a.task) return toast(a, 'ยังไม่มีงาน กด "รับงานใหม่" ก่อน', '⚠️', false);
      if (!spend(a, 18)) return;
      const ok = String(m.ans).trim() === String(a.task.answer);
      const fast = now() - a.task.at < 25000;
      const ans = a.task.answer; a.task = null; markMe(a);
      if (!ok) return toast(a, `โค้ดมีบั๊ก! คำตอบที่ถูกคือ ${ans} ลูกค้าไม่จ่าย`, '🐛', false);
      const got = earn(a, (900 + 220 * (lvl(a) - 1)) * (fast ? 1.2 : 1) * wb); addXp(a);
      return toast(a, `ส่งงานผ่าน! ได้ ${money(got)}${fast ? ' (โบนัสส่งไว)' : ''}`, '💻');
    }
    case 'restaurant.eat': {
      const buffet = m.kind === 'buffet';
      if (!cd(a, 'eat', buffet ? 20000 : 6000)) return;
      if (!pay(a, buffet ? 350 : 80)) { a.cd.eat = 0; return; }
      a.hunger = Math.min(100, a.hunger + (buffet ? 70 : 25));
      if (buffet) a.energy = Math.min(100, a.energy + 10);
      markMe(a);
      return toast(a, buffet ? 'บุฟเฟต์ชาบู! อิ่มแปล้' : 'กินข้าวมันไก่ อิ่มแล้ว', buffet ? '🍲' : '🍛');
    }
    case 'kitchen.cook': {
      if (!need(a, 'chef')) return;
      const r = D.RECIPES.find(x => x.id === m.rid); if (!r) return;
      for (const [k, q] of Object.entries(r.in)) if ((a.inv[k] || 0) < q) return toast(a, 'วัตถุดิบไม่พอ', '🥬', false);
      if (!cd(a, 'cook', 1200) || !spend(a, 12)) return;
      for (const [k, q] of Object.entries(r.in)) addItem(a, k, -q);
      addItem(a, r.id, 1); addXp(a); markMe(a);
      return toast(a, `ปรุง ${D.ITEMS[r.id].icon}${D.ITEMS[r.id].name} สำเร็จ`, '🍳');
    }
    case 'hospital.heal': {
      if (a.health >= 98) return toast(a, 'คุณสุขภาพดีอยู่แล้ว', 'ℹ️', false);
      if (!pay(a, 800)) return;
      a.health = Math.min(100, a.health + 40); markMe(a);
      return toast(a, 'รักษาตัว สุขภาพ +40', '🏥');
    }
    case 'hospital.shift': {
      if (!need(a, 'doctor')) return;
      if (!cd(a, 'shift', 2000) || !spend(a, 28)) return;
      const got = earn(a, (1400 + 220 * (lvl(a) - 1)) * wb * (ev('boom') ? 1.25 : 1) * (ev('flu') ? 1.4 : 1));
      a.health = Math.max(0, a.health - 2); addXp(a);
      return toast(a, `เข้าเวรเสร็จ ได้ ${money(got)}`, '🩺');
    }
    case 'school.learn': {
      const l = D.LICENSES[m.lic]; if (!l) return;
      if (a.licenses.includes(m.lic)) return toast(a, 'คุณมีใบรับรองนี้แล้ว', 'ℹ️', false);
      if (!pay(a, l.price)) return;
      a.licenses.push(m.lic); markMe(a);
      return toast(a, `ได้รับ ${l.name} แล้ว! เปลี่ยนอาชีพได้ในเมนู 💼`, '🎓');
    }
    case 'home.rest': {
      if (!cd(a, 'rest', 30000)) return;
      a.energy = Math.min(100, a.energy + 25); markMe(a);
      return toast(a, 'งีบหลับ พลังงาน +25', '😴');
    }
    case 'home.inn': {
      if (!cd(a, 'inn', 20000)) return;
      if (!pay(a, 150)) { a.cd.inn = 0; return; }
      a.energy = Math.min(100, a.energy + 60); a.health = Math.min(100, a.health + 10); markMe(a);
      return toast(a, 'นอนเต็มอิ่ม พลังงาน +60 สุขภาพ +10', '🛏️');
    }
    case 'pier.cast': {
      if (!need(a, 'fisher')) return;
      if (a.cast) return;
      if (!spend(a, 8)) return;
      const bite = now() + rnd(2000, 6000);
      a.cast = { state: 'wait', bite, expire: bite + 1700, st: s.id }; markMe(a);
      return;
    }
    case 'pier.reel': {
      if (!a.cast) return;
      if (a.cast.state === 'wait') { a.cast = null; markMe(a); return toast(a, 'ดึงเร็วเกินไป ปลาตกใจหนีไปแล้ว', '💨', false); }
      a.cast = null;
      const id = rollFish(a); addXp(a);
      if (!id) { markMe(a); return toast(a, 'ได้ขยะทะเล 🥫 ... ไม่มีราคา', '🥫', false); }
      addItem(a, id, 1); markMe(a);
      const it = D.ITEMS[id];
      if (it.base >= 2000) feed(`${it.icon} ${a.name} ตกได้ ${it.name}!! (มูลค่า ~${money(it.base)})`);
      return toast(a, `ได้ ${it.icon}${it.name} (~${money(it.base)})`, it.icon);
    }
    case 'plot.plant': {
      if (!need(a, 'farmer')) return;
      const c = D.CROPS[m.crop]; if (!c) return;
      if (plots[s.idx]) return toast(a, 'แปลงนี้ปลูกอยู่แล้ว', '⚠️', false);
      if (!pay(a, c.seed)) return;
      if (!spend(a, 6)) { a.money += c.seed; return; }
      const f = ev('rain') ? 0.5 : ev('drought') ? 1.6 : 1;
      plots[s.idx] = { crop: m.crop, owner: a.id, ownerName: a.name, readyAt: now() + c.grow * 1000 * f };
      markMe(a);
      return toast(a, `ปลูก${D.ITEMS[m.crop].name}แล้ว`, '🌱');
    }
    case 'plot.harvest': {
      if (!need(a, 'farmer')) return;
      const p = plots[s.idx];
      if (!p) return toast(a, 'แปลงว่าง', '⚠️', false);
      if (p.readyAt > now()) return toast(a, 'พืชยังไม่โต', '🌱', false);
      const stealing = p.owner !== a.id;
      if (stealing && now() < p.readyAt + 60000) return toast(a, `ของ ${p.ownerName} เขามีสิทธิ์เก็บก่อน (อีก ${Math.ceil((p.readyAt + 60000 - now()) / 1000)} วิ)`, '🔒', false);
      if (!spend(a, 8)) return;
      const c = D.CROPS[p.crop];
      const n = rint(c.min, c.max) + Math.floor(lvl(a) / 3);
      addItem(a, p.crop, n); plots[s.idx] = null; addXp(a); markMe(a);
      if (stealing) { const o = [...online.values()].find(x => x.id === p.owner); if (o) toast(o, `${a.name} เก็บ${D.ITEMS[p.crop].name}ที่คุณปลูกไว้ไปแล้ว!`, '😱', false); }
      return toast(a, `เก็บเกี่ยว ${D.ITEMS[p.crop].icon}${D.ITEMS[p.crop].name} ได้ ${n} หน่วย${stealing ? ' (ของคนอื่นที่ทิ้งไว้)' : ''}`, '🧺');
    }
  }
}

function useItem(a, id) {
  const it = D.ITEMS[id];
  if (!it || !it.eat || !a.inv[id]) return;
  if (!cd(a, 'use', 400)) return;
  addItem(a, id, -1);
  const e = it.eat;
  if (e.hunger) a.hunger = Math.min(100, a.hunger + e.hunger);
  if (e.energy) a.energy = Math.min(100, a.energy + e.energy);
  if (e.health) a.health = Math.min(100, a.health + e.health);
  markMe(a);
  toast(a, `ใช้ ${it.icon}${it.name}`, it.icon);
}

// ------------------------------------------------------------------ player-to-player
function playerById(id) { return online.get(id); }
function nearPlayer(a, id, r) {
  const o = playerById(id);
  if (!o || o === a) return null;
  return dist(a, o) <= r ? o : null;
}

function tradeState(a) {
  const tr = a.trade; if (!tr) return;
  const other = tr.a === a ? tr.b : tr.a;
  const mine = tr.a === a ? tr.oa : tr.ob, theirs = tr.a === a ? tr.ob : tr.oa;
  send(a, { t: 'trade', open: true, with: pubInfo(other), mine, theirs });
}
function tradeClose(tr, reason) {
  for (const p of [tr.a, tr.b]) { if (p.trade === tr) { p.trade = null; send(p, { t: 'trade', open: false, reason }); } }
}
function tradeOffer(a, m) {
  const tr = a.trade; if (!tr) return;
  const o = { money: clamp(Math.floor(+m.money) || 0, 0, Math.floor(a.money)), items: {}, ok: false };
  let n = 0;
  for (const [k, q] of Object.entries(m.items || {})) {
    const qq = Math.min(Math.floor(+q) || 0, a.inv[k] || 0);
    if (D.ITEMS[k] && qq > 0 && n++ < 12) o.items[k] = qq;
  }
  if (tr.a === a) tr.oa = o; else tr.ob = o;
  tr.oa.ok = false; tr.ob.ok = false;
  tradeState(tr.a); tradeState(tr.b);
}
function tradeConfirm(a) {
  const tr = a.trade; if (!tr) return;
  (tr.a === a ? tr.oa : tr.ob).ok = true;
  if (!(tr.oa.ok && tr.ob.ok)) { tradeState(tr.a); tradeState(tr.b); return; }
  const valid = (p, o) => p.money >= o.money && Object.entries(o.items).every(([k, q]) => (p.inv[k] || 0) >= q);
  if (!valid(tr.a, tr.oa) || !valid(tr.b, tr.ob)) return tradeClose(tr, 'ของไม่ครบแล้ว ยกเลิกการแลกเปลี่ยน');
  const move = (from, to, o) => {
    from.money -= o.money; to.money += o.money;
    for (const [k, q] of Object.entries(o.items)) { addItem(from, k, -q); addItem(to, k, q); }
  };
  move(tr.a, tr.b, tr.oa); move(tr.b, tr.a, tr.ob);
  markMe(tr.a); markMe(tr.b);
  const total = tr.oa.money + tr.ob.money;
  if (total >= 3000) feed(`🤝 ${tr.a.name} และ ${tr.b.name} แลกเปลี่ยนกัน (เงินหมุนเวียน ${money(total)})`);
  tradeClose(tr, '✅ แลกเปลี่ยนสำเร็จ!');
}

function request(a, m) {
  const o = nearPlayer(a, m.to, 6);
  if (!o) return toast(a, 'เดินเข้าไปใกล้ผู้เล่นคนนั้นก่อน', '⚠️', false);
  if (m.kind === 'trade') {
    if (a.trade || o.trade) return toast(a, 'ฝ่ายใดฝ่ายหนึ่งกำลังแลกเปลี่ยนอยู่', '⚠️', false);
  } else if (m.kind === 'heal') {
    if (a.career !== 'doctor') return toast(a, 'ต้องเป็นแพทย์เท่านั้น', '🚫', false);
    if (o.health >= 95) return toast(a, `${o.name} สุขภาพดีอยู่แล้ว`, 'ℹ️', false);
  } else return;
  for (const r of reqs.values()) if (r.from === a && r.to === o && r.kind === m.kind) return toast(a, 'ส่งคำขอไปแล้ว รอสักครู่', '⏳', false);
  const fee = m.kind === 'heal' ? clamp(Math.floor(+m.fee) || 0, 0, 3000) : 0;
  const id = nextId++;
  reqs.set(id, { id, kind: m.kind, from: a, to: o, fee, exp: now() + 20000 });
  send(o, { t: 'req', id, kind: m.kind, from: pubInfo(a), fee });
  toast(a, `ส่งคำขอให้ ${o.name} แล้ว`, '📨');
}
function answerReq(a, m) {
  const r = reqs.get(m.id);
  if (!r || r.to !== a) return;
  reqs.delete(r.id);
  const f = r.from;
  if (!m.ok) return toast(f, `${a.name} ปฏิเสธ`, '🙅', false);
  if (!online.has(f.id) || dist(a, f) > 7) return toast(a, 'อีกฝ่ายอยู่ไกลเกินไปแล้ว', '⚠️', false);
  if (r.kind === 'trade') {
    if (a.trade || f.trade) return toast(a, 'กำลังแลกเปลี่ยนอยู่', '⚠️', false);
    const tr = { a: f, b: a, oa: { money: 0, items: {}, ok: false }, ob: { money: 0, items: {}, ok: false } };
    f.trade = a.trade = tr; tradeState(f); tradeState(a);
  } else if (r.kind === 'heal') {
    if (a.money < r.fee) return toast(a, 'เงินไม่พอจ่ายค่ารักษา', '💸', false);
    a.money -= r.fee; earn(f, r.fee);
    const heal = 35 + 5 * lvl(f, 'doctor');
    a.health = Math.min(100, a.health + heal); f.xp.doctor = (f.xp.doctor || 0) + 2;
    markMe(a); markMe(f);
    toast(a, `${f.name} รักษาคุณ สุขภาพ +${heal} (จ่าย ${money(r.fee)})`, '💉');
    toast(f, `รักษา ${a.name} สำเร็จ ได้ค่ารักษา ${money(r.fee)}`, '💉');
    if (r.fee >= 1000) feed(`🩺 หมอ${f.name} รักษา ${a.name} (ค่ารักษา ${money(r.fee)})`);
  }
}
function donate(a, m) {
  const o = nearPlayer(a, m.to, 6);
  if (!o) return toast(a, 'เดินเข้าไปใกล้ก่อน', '⚠️', false);
  if (o.career !== 'streamer') return toast(a, `${o.name} ไม่ได้เป็นสตรีมเมอร์`, '⚠️', false);
  const amt = clamp(Math.floor(+m.amt) || 0, 10, 1_000_000);
  if (!pay(a, amt)) return;
  earn(o, amt); o.followers += Math.max(1, Math.floor(amt / 60)); markMe(a);
  toast(a, `โดเนท ${money(amt)} ให้ ${o.name}`, '💝'); toast(o, `${a.name} โดเนท ${money(amt)} ให้คุณ!`, '💝');
  if (amt >= 1000) feed(`💝 ${a.name} โดเนท ${money(amt)} ให้สตรีมเมอร์ ${o.name}`);
  sendRoster();
}

// ------------------------------------------------------------------ connection
function login(ws, m) {
  const name = cleanText(m.name, 16);
  if (!/^[\p{L}\p{N}_ .-]{2,16}$/u.test(name)) return fail(ws, 'ชื่อต้องยาว 2-16 ตัว (ตัวอักษร ตัวเลข _ - .)');
  const pin = String(m.pin ?? '');
  if (!/^\d{4}$/.test(pin)) return fail(ws, 'PIN ต้องเป็นตัวเลข 4 หลัก');
  let a = accounts.get(name.toLowerCase());
  if (a) {
    if (hashPin(pin, a.salt) !== a.hash) return fail(ws, 'ชื่อนี้มีคนใช้แล้ว หรือ PIN ไม่ถูกต้อง');
    if (a.ws) { send(a, { t: 'kicked', msg: 'มีการเข้าสู่ระบบจากที่อื่น' }); a.ws.close(); detach(a); }
  } else {
    const salt = crypto.randomBytes(8).toString('hex');
    const career = ['office', 'farmer', 'fisher', 'merchant', 'streamer'].includes(m.career) ? m.career : 'office';
    a = hydrate({ name, salt, hash: hashPin(pin, salt), avatar: clamp(Math.floor(+m.avatar) || 0, 0, 9), career });
    accounts.set(name.toLowerCase(), a);
  }
  a.ws = ws; ws.acct = a; a.id = nextId++; a.lastPosT = now(); a.moved = true;
  if (D.blocked(a.x, a.y)) { a.x = D.SPAWN.x; a.y = D.SPAWN.y; }
  online.set(a.id, a);
  dirty = true;
  send(a, {
    t: 'init', id: a.id,
    map: { w: D.W, h: D.H, tiles: D.TILES, buildings: D.BUILDINGS }, stations: D.STATIONS,
    items: D.ITEMS, crops: D.CROPS, recipes: D.RECIPES, careers: D.CAREERS, licenses: D.LICENSES,
    titles: D.OFFICE_TITLES, speed: SPEED, radius: D.RADIUS, chat: chatLog.slice(-25),
  });
  send(a, meView(a)); send(a, worldView());
  sendRoster();
  feed(`👋 ${a.name} เข้าเมือง`);
}
function fail(ws, msg) { ws.send(JSON.stringify({ t: 'loginfail', msg })); }

function detach(a) {
  if (!a.id) return;
  if (a.trade) tradeClose(a.trade, `${a.name} ออกจากเกม`);
  for (const [id, r] of reqs) if (r.from === a || r.to === a) reqs.delete(id);
  online.delete(a.id);
  a.ws = null; a.cast = null; dirty = true;
  sendRoster();
}

function onMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const a = ws.acct;
  if (m.t === 'login') { if (!a) login(ws, m); return; }
  if (!a || a.ws !== ws) return;
  switch (m.t) {
    case 'p': {
      const x = +m.x, y = +m.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const t = now(), dt = Math.min(0.7, (t - a.lastPosT) / 1000);
      a.lastPosT = t;
      if (Math.hypot(x - a.x, y - a.y) > SPEED * 1.35 * dt + 0.5 || D.blocked(x, y)) return send(a, { t: 'fix', x: a.x, y: a.y });
      if (x !== a.x || y !== a.y) { a.x = x; a.y = y; a.moved = true; dirty = true; }
      a.f = clamp(Math.floor(+m.f) || 0, 0, 7);
      if (a.cast && Math.hypot(a.x - ST[a.cast.st].x, a.y - ST[a.cast.st].y) > ST[a.cast.st].r + 1.2) { a.cast = null; markMe(a); }
      return;
    }
    case 'chat': {
      const text = cleanText(m.text, 120); if (!text) return;
      if (!cd(a, 'chat', 800)) return;
      const msg = { t: 'chat', id: a.id, name: a.name, av: a.avatar, c: a.career, text, ts: now() };
      chatLog.push(msg); if (chatLog.length > 40) chatLog.shift();
      return broadcast(msg);
    }
    case 'act': return act(a, m);
    case 'use': return useItem(a, m.item);
    case 'career': {
      const c = D.CAREERS[m.career]; if (!c) return;
      if (c.license && !a.licenses.includes(c.license)) return toast(a, `ต้องมี ${D.LICENSES[c.license].name} จากโรงเรียนก่อน`, '🎓', false);
      if (a.career === m.career) return;
      a.career = m.career; a.cast = null; a.task = null; markMe(a); sendRoster();
      return toast(a, `เปลี่ยนอาชีพเป็น ${c.icon} ${c.name}`, c.icon);
    }
    case 'req': return request(a, m);
    case 'req_ans': return answerReq(a, m);
    case 'donate': return donate(a, m);
    case 'trade_offer': return tradeOffer(a, m);
    case 'trade_confirm': return tradeConfirm(a);
    case 'trade_cancel': if (a.trade) tradeClose(a.trade, `${a.name} ยกเลิกการแลกเปลี่ยน`); return;
  }
}

// ------------------------------------------------------------------ simulation
let lastTick = now(), wdAt = 0, saveAt = 0, passiveAt = 0, marketAt = 0;
function tick() {
  const t = now(), dt = Math.min(1, (t - lastTick) / 1000); lastTick = t;

  // events
  if (event && t > event.until) { event = null; feed('🌤️ เหตุการณ์พิเศษจบลงแล้ว'); wdAt = 0; }
  if (!event && t > nextEventAt) {
    const e = D.EVENTS[rint(0, D.EVENTS.length - 1)];
    event = { ...e, until: t + rnd(120, 200) * 1000 };
    nextEventAt = event.until + rnd(120, 240) * 1000;
    feed(e.text); wdAt = 0;
  }

  // market recovery + wholesale refill
  for (const k in market) {
    const mk = market[k];
    mk.mult += (mk.target - mk.mult) * 0.012 * dt * 10 * 0.1;
    const it = D.ITEMS[k];
    if (it.wholesale && stock[k] < it.stock) stock[k] = Math.min(it.stock, stock[k] + dt / it.refill);
  }
  if (t > marketAt) {
    marketAt = t + 45000;
    for (const k in market) market[k].target = clamp(market[k].target + rnd(-0.08, 0.08) + (1 - market[k].target) * 0.2, 0.8, 1.25);
  }

  const passive = t > passiveAt; if (passive) passiveAt = t + 30000;
  for (const a of online.values()) {
    a.energy = Math.min(100, a.energy + 0.25 * dt);
    a.hunger = Math.max(0, a.hunger - (ev('flu') ? 0.1 : 0.05) * dt);
    if (a.hunger <= 0) a.health = Math.max(0, a.health - 0.15 * dt);
    else if (a.hunger > 60 && a.health < 100) a.health = Math.min(100, a.health + 0.05 * dt);
    if (ev('flu')) a.health = Math.max(0, a.health - 0.02 * dt);
    if (a.health <= 0) {
      const fine = Math.min(Math.round(a.money * 0.15), 1500); a.money -= fine;
      a.health = 40; a.energy = 20; a.hunger = Math.max(a.hunger, 40);
      const h = ST.hospital; a.x = h.x; a.y = h.y + 0.5; a.cast = null; a.moved = true;
      send(a, { t: 'fix', x: a.x, y: a.y });
      toast(a, `คุณเป็นลมและถูกหามส่งโรงพยาบาล เสียค่ารักษา ${money(fine)}`, '🚑', false);
      feed(`🚑 ${a.name} เป็นลมเพราะดูแลตัวเองไม่ดี`);
    }
    if (passive && a.followers > 0) {
      const inc = a.followers * (a.career === 'streamer' ? 0.12 : 0.05);
      earn(a, inc);
      if (a.career !== 'streamer') a.followers = Math.floor(a.followers * 0.98);
    }
    if (a.cast) {
      if (a.cast.state === 'wait' && t >= a.cast.bite) { a.cast.state = 'bite'; send(a, { t: 'bite' }); markMe(a); }
      else if (a.cast.state === 'bite' && t > a.cast.expire) { a.cast = null; markMe(a); toast(a, 'ปลาหนีไปแล้ว ช้าเกิน!', '💨', false); }
    }
    if (a.trade && dist(a.trade.a, a.trade.b) > 8) tradeClose(a.trade, 'อยู่ไกลกันเกินไป ยกเลิกการแลกเปลี่ยน');
    if (a.meDirty || t % 2000 < TICK) { a.meDirty = false; send(a, meView(a)); }
  }
  for (const [id, r] of reqs) if (t > r.exp) { reqs.delete(id); toast(r.from, `${r.to.name} ไม่ตอบรับ`, '⌛', false); }

  // positions
  const ps = [];
  for (const a of online.values()) if (a.moved) { a.moved = false; ps.push([a.id, +a.x.toFixed(2), +a.y.toFixed(2), a.f]); }
  if (ps.length) broadcast({ t: 'ps', p: ps });

  if (t > wdAt) { wdAt = t + 1000; broadcast(worldView()); }
  if (t > saveAt) { saveAt = t + 20000; save(); }
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  let count = 0, winStart = now();
  ws.on('message', raw => {
    const t = now();
    if (t - winStart > 1000) { winStart = t; count = 0; }
    if (++count > 60) return;
    onMessage(ws, raw.toString());
  });
  ws.on('close', () => { if (ws.acct && ws.acct.ws === ws) detach(ws.acct); });
  ws.on('error', () => {});
  const ka = setInterval(() => { if (ws.readyState === 1) ws.ping(); }, 25000);
  ws.on('close', () => clearInterval(ka));
});

load();
setInterval(tick, TICK);
function shutdown() { dirty = true; save(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
if (require.main === module) server.listen(PORT, () => console.log(`Life Town running on http://localhost:${PORT}`));
module.exports = { server };
