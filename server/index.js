'use strict';
// Authoritative multiplayer server: HTTP (static client) + WebSocket (game).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./data');
const store = require('./store');
const Q = require('./quests');

const PORT = process.env.PORT || 3000;
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
  for (const d of a.dz || []) m *= D.DISEASES[d]?.income || 1;
  return m;
}
// ---- diseases
const DZ = D.DISEASES;
const dzProd = (a, key) => (a.dz || []).reduce((m, d) => m * (DZ[d]?.[key] || 1), 1);
function infect(a, id, chance = 1) {
  if (Math.random() > chance || !DZ[id] || (a.dz || []).includes(id) || (a.dz || []).length >= 3) return false;
  if ((a.immune?.[id] || 0) > now()) return false;
  a.dz = [...(a.dz || []), id];
  const d = DZ[id];
  toast(a, `คุณป่วยเป็น${d.name}! อาการ: ${d.sym.slice(0, 2).join(', ')} · ${d.self}`, d.icon, false);
  markMe(a); sendRoster(); return true;
}
function cure(a, id) {
  if (!(a.dz || []).includes(id)) return false;
  a.dz = a.dz.filter(x => x !== id);
  a.immune = { ...(a.immune || {}), [id]: now() + 180000 };
  markMe(a); sendRoster(); return true;
}
function sleepWell(a) { a.awake = 0; cure(a, 'insomnia'); cure(a, 'exhaust'); }

// ---- rooms (building interiors)
const ROOM = Object.fromEntries(D.ROOMS.map(r => [r.id, r]));
function teleport(a, x, y) { a.x = x; a.y = y; a.mvb = 1.2; a.moved = true; a.lastPosT = now(); a.cast = null; send(a, { t: 'fix', x, y, tp: 1 }); leaveBed(a); }
function enterRoom(a, m) {
  const s = ST[m.st]; if (!s) return;
  const room = ROOM[s.to || s.door]; if (!room) return;
  if (Math.hypot(a.x - s.x, a.y - s.y) > s.r + 1.6 && Math.hypot(a.x - room.doorPt.x, a.y - room.doorPt.y) > 1.2) return;
  teleport(a, room.spawn.x, room.spawn.y);
}
function exitRoom(a) {
  const room = D.roomAt(a.x, a.y);
  if (!room || Math.hypot(a.x - room.exit.x, a.y - room.exit.y) > 2.2) return;
  teleport(a, room.outside.x, room.outside.y);
}

// ---- hospital beds
const beds = [null, null, null, null];
function leaveBed(a) { if (a.bed >= 0 && beds[a.bed] === a) beds[a.bed] = null; if (a.bed >= 0) { a.bed = -1; sendRoster(); wdAt = 0; } }
function earn(a, amount) {
  amount = Math.round(amount); a.money += amount; a.earned += amount; markMe(a);
  if (amount > 0) {
    quest(a, 'earn', amount);
    if (a.loan > 0) { const r = Math.min(a.loan, Math.ceil(amount * D.BANK.repayShare)); a.money -= r; a.loan -= r; }   // loans auto-repay from income
  }
  return amount;
}
// ---- possessions
const houses = D.HOUSE_PRICES.map(() => null);       // house index -> owner account
const tier = (a, c) => (a.tools && a.tools[c]) || 0;
const BOOST = [0, .15, .3, .5];
const comfort = a => a.house >= 0 ? (a.furniture || []).reduce((s, k) => s + (D.FURNITURE[k]?.comfort || 0), 0) : 0;
const speedOf = a => Math.max(1, ...(a.vehicles || []).map(v => D.VEHICLES[v]?.speed || 1)) * dzProd(a, 'speed');
const bestVehicle = a => (a.vehicles || []).reduce((b, v) => !b || D.VEHICLES[v].speed > D.VEHICLES[b].speed ? v : b, null);
function accrue(a) {
  const t = now(), days = (t - (a.bankT || t)) / 86400e3; a.bankT = t;
  if (a.bank > 0 && days > 0) a.bank += Math.min(a.bank, D.BANK.cap) * (Math.pow(1 + D.BANK.rate, days) - 1);
}
// advance a daily quest and tell the player about anything completed
function quest(a, type, n = 1) {
  for (const e of Q.progress(a, type, n)) {
    send(a, { t: 'quest', ...e });
    if (e.kind === 'all') feed(`📜 ${a.name} ทำเควสต์ประจำวันครบทั้ง 3 ข้อ! (ติดต่อกัน ${e.streak} วัน)`);
  }
  markMe(a);
}
function spend(a, e) {
  if (a.energy < e) { toast(a, `พลังงานไม่พอ (ต้องใช้ ${e}) กินอาหารหรือพักผ่อนก่อน`, '😴', false); return false; }
  a.energy -= e;
  a.hunger = Math.max(0, a.hunger - e * 0.12);            // working makes you hungry
  if (a.energy < 20) infect(a, 'exhaust', 0.06);          // pushing on while drained
  return true;
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
  if (a.career === 'merchant') b += 0.12 + Math.min(0.13, 0.01 * (lvl(a, 'merchant') - 1));
  if (a.career === 'chef' && it.kind === 'meal') b += 0.10;
  if (a.career === 'farmer' && it.kind === 'crop') b += 0.08;
  if (a.career === 'fisher' && it.kind === 'fish') b += 0.08;
  return p * b;
}
function worth(a) {
  let w = a.money + (a.bank || 0) - (a.loan || 0);
  for (const [k, q] of Object.entries(a.inv)) w += (D.ITEMS[k]?.base || 0) * q * 0.7;
  for (const L of a.listings || []) w += (D.ITEMS[L.item]?.base || 0) * L.qty * 0.7;
  for (const v of a.vehicles || []) w += (D.VEHICLES[v]?.price || 0) * 0.5;
  for (const [, t] of Object.entries(a.tools || {})) for (let i = 0; i < t; i++) w += D.TOOL_PRICES[i] * 0.5;
  if (a.house >= 0) { w += D.HOUSE_PRICES[a.house] * 0.7; for (const f of a.furniture || []) w += (D.FURNITURE[f]?.price || 0) * 0.5; }
  return w;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ------------------------------------------------------------------ persistence
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
const SAVE_KEYS = ['name', 'salt', 'hash', 'avatar', 'money', 'energy', 'hunger', 'health', 'career', 'licenses',
  'xp', 'followers', 'inv', 'x', 'y', 'earned', 'created', 'quests', 'qStreak', 'lastLogin', 'loginStreak', 'tools', 'vehicles', 'house', 'furniture', 'bank', 'bankT', 'loan', 'dz', 'awake', 'listings'];
async function load() {
  const rows = await store.loadAll();
  for (const r of rows) if (r && r.name) accounts.set(r.name.toLowerCase(), hydrate(r));
  for (const a of accounts.values()) for (const L of a.listings || []) nextListing = Math.max(nextListing, L.id + 1);
  for (const a of accounts.values()) if (a.house >= 0) { if (houses[a.house]) a.house = -1; else houses[a.house] = a; }
  console.log(`loaded ${accounts.size} players`);
}
function hydrate(r) {
  return Object.assign({
    avatar: 0, money: 2000, energy: 100, hunger: 100, health: 100, career: 'office', licenses: [], xp: {},
    followers: 0, inv: {}, x: D.SPAWN.x, y: D.SPAWN.y, earned: 0, created: now(), quests: null, qStreak: 0, lastLogin: '', loginStreak: 0, tools: {}, vehicles: [], house: -1, furniture: [], bank: 0, bankT: now(), loan: 0, dz: [], awake: 0, listings: [],
  }, r, { ws: null, id: null, f: 0, bed: -1, immune: {}, cd: {}, task: null, cast: null, trade: null, lastPosT: now(), moved: false, meDirty: false });
}
let saving = false;
async function save(force) {
  if ((!dirty && !force) || saving) return;
  saving = true; dirty = false;
  const rec = a => Object.fromEntries(SAVE_KEYS.map(k => [k, a[k]]));
  const changed = [...accounts.values()].filter(a => a.ws || a.sd);
  try {
    await store.save(changed.map(rec), [...accounts.values()].map(rec));
    changed.forEach(a => { if (!a.ws) a.sd = false; });
  } catch (e) { dirty = true; console.error('save failed:', e.message); }
  saving = false;
}

// ------------------------------------------------------------------ public views
function pubInfo(a) {
  return { id: a.id, name: a.name, av: a.avatar, c: a.career, fol: a.followers, lv: lvl(a), veh: bestVehicle(a), dz: (a.dz || []).map(d => DZ[d].icon), bed: a.bed >= 0 };
}
function sendRoster() {
  broadcast({ t: 'roster', players: [...online.values()].map(a => ({ ...pubInfo(a), x: a.x, y: a.y, f: a.f })) });
}
function meView(a) {
  return {
    t: 'me', id: a.id, name: a.name, avatar: a.avatar, x: +a.x.toFixed(2), y: +a.y.toFixed(2), money: Math.round(a.money), energy: a.energy, hunger: a.hunger, health: a.health,
    career: a.career, licenses: a.licenses, lv: lvl(a), xp: a.xp, followers: a.followers, inv: a.inv,
    tools: a.tools, vehicles: a.vehicles, house: a.house, furniture: a.furniture, comfort: comfort(a), speed: speedOf(a),
    bank: Math.floor(a.bank), loan: Math.ceil(a.loan), listings: a.listings || [], dz: a.dz || [], awake: Math.floor(a.awake || 0), bed: a.bed ?? -1,
    cast: a.cast ? { state: a.cast.state } : null, task: a.task ? { code: a.task.code } : null,
    earned: a.earned, worth: Math.round(worth(a)), quests: Q.view(a),
  };
}
function worldView() {
  const t = now();
  const lb = [...accounts.values()].map(a => ({ name: a.name, av: a.avatar, c: a.career, w: Math.round(worth(a)), on: !!a.ws }))
    .sort((x, y) => y.w - x.w).slice(0, 10);
  const mk = {};
  Object.assign(mk, marketView());
  return {
    t: 'wd', now: t, phase: (t % DAY_MS) / DAY_MS, on: online.size,
    mk, stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, Math.floor(v)])),
    plots: plots.map(p => p ? [p.crop, p.owner, p.ownerName, p.readyAt] : 0),
    beds: beds.map(p => p ? [p.name, p.id, p.dz.length ? DZ[p.dz[0]].sym : [], Math.floor(p.health), p.dz.length] : 0),
    houses: houses.map(h => h ? [h.name, comfort(h), h.avatar, (h.furniture || []).slice(0, 8)] : 0),
    ev: event ? { id: event.id, text: event.text, until: event.until } : null, lb,
  };
}
function sellPriceFor(id) { return sellPrice({ career: '' }, id); }
const NPC_BUY = 0.7, NPC_SELL = 2.5;
const npcSellPrice = id => Math.ceil(D.ITEMS[id].base * NPC_SELL);
let nextListing = 1;
function marketView() {
  const best = {};
  for (const o of accounts.values()) for (const L of o.listings || []) {
    const b = best[L.item] || (best[L.item] = { p: Infinity, n: 0 });
    b.p = Math.min(b.p, L.price); b.n += L.qty;
  }
  const out = {};
  for (const k in D.ITEMS) out[k] = { npc: Math.round(sellPriceFor(k) * NPC_BUY), sell: npcSellPrice(k), best: best[k] ? best[k].p : 0, n: best[k] ? best[k].n : 0 };
  return out;
}

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
    if (f.id === null) w = Math.max(5, w - l) * [1, .6, .35, .15][tier(a, 'fisher')];
    if (['seabass', 'tuna', 'shark', 'chest'].includes(f.id)) w *= [1, 1.3, 1.7, 2.2][tier(a, 'fisher')];
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
      let p = (450 + 100 * (l - 1)) * (ot ? 2.6 : 1) * wb * (ev('boom') ? 1.25 : 1) * (1 + [0, .1, .22, .35][tier(a, 'office')]);
      const got = earn(a, p);
      if (ot) { a.health = Math.max(0, a.health - 3); infect(a, 'exhaust', 0.1); infect(a, 'injury', 0.02); }
      const before = lvl(a); addXp(a); quest(a, 'work');
      let msg = `${ot ? 'ทำโอที' : 'ทำงาน'}เสร็จ ได้ ${money(got)}`;
      if (lvl(a) > before && lvl(a) <= D.OFFICE_TITLES.length) {
        msg += ` 🎊 เลื่อนเป็น ${D.OFFICE_TITLES[lvl(a) - 1]}`;
        feed(`🎊 ${a.name} ได้เลื่อนตำแหน่งเป็น${D.OFFICE_TITLES[lvl(a) - 1]}`);
      }
      return toast(a, msg, ot ? '🌙' : '💼');
    }
    case 'market.list': {     // put items up for sale at your own price (items are held by the market)
      const id = m.item, it = D.ITEMS[id];
      const q = Math.floor(+m.qty), price = Math.floor(+m.price);
      if (!it || !(q > 0) || !(price > 0)) return toast(a, 'ใส่จำนวนและราคาให้ถูกต้อง', '⚠️', false);
      if ((a.inv[id] || 0) < q) return toast(a, 'มีของไม่พอ', '⚠️', false);
      if (price > it.base * 20) return toast(a, `ตั้งราคาได้ไม่เกิน ${money(it.base * 20)} ต่อชิ้น`, '⚠️', false);
      if ((a.listings || []).length >= 8) return toast(a, 'วางขายได้พร้อมกันไม่เกิน 8 รายการ', '⚠️', false);
      addItem(a, id, -q);
      a.listings = [...(a.listings || []), { id: nextListing++, item: id, qty: q, price }];
      markMe(a); wdAt = 0;
      return toast(a, `วางขาย ${it.icon}${it.name} x${q} ราคา ${money(price)}/ชิ้น`, '🏷️');
    }
    case 'market.unlist': {
      const L = (a.listings || []).find(x => x.id === +m.id); if (!L) return;
      a.listings = a.listings.filter(x => x !== L); addItem(a, L.item, L.qty); markMe(a); wdAt = 0;
      return toast(a, `เก็บ ${D.ITEMS[L.item].name} x${L.qty} กลับเข้ากระเป๋า`, '📦');
    }
    case 'market.buy': {      // buy from players, cheapest first
      const id = m.item, it = D.ITEMS[id]; if (!it) return;
      let want = clamp(Math.floor(+m.qty) || 1, 1, 50), bought = 0, spent = 0;
      const soldBy = new Map();
      const offers = [];
      for (const o of accounts.values()) if (o !== a) for (const L of o.listings || []) if (L.item === id) offers.push([L, o]);
      offers.sort((x, y) => x[0].price - y[0].price);
      if (!offers.length) return toast(a, 'ตอนนี้ไม่มีผู้เล่นวางขายของชิ้นนี้', '🏪', false);
      for (const [L, o] of offers) {
        while (want > 0 && L.qty > 0 && a.money >= L.price) {
          a.money -= L.price; L.qty--; want--; bought++; spent += L.price; soldBy.set(o, (soldBy.get(o) || 0) + 1);
          const net = Math.floor(L.price * 0.95);          // 5% market fee
          o.money += net; o.earned += net; o.sd = true;
          if (o.ws) { quest(o, 'earn', net); markMe(o); }
        }
        if (L.qty <= 0) o.listings = o.listings.filter(x => x !== L);
        if (want <= 0 || a.money < L.price) break;
      }
      for (const [o, n] of soldBy) if (o.ws) { quest(o, 'sell', n); toast(o, `${a.name} ซื้อ ${it.icon}${it.name} ของคุณ ${n} ชิ้น`, '💰'); }
      if (!bought) return toast(a, 'เงินไม่พอ', '💸', false);
      addItem(a, id, bought); markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${it.icon}${it.name} x${bought} จากผู้เล่น รวม ${money(spent)}`, '🛍️');
    }
    case 'market.npcbuy': {   // NPC stock is always available but very expensive
      const id = m.item, it = D.ITEMS[id]; if (!it || it.kind === 'fish' && it.base >= 2000) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), unit = npcSellPrice(id);
      if (!pay(a, unit * q)) return;
      addItem(a, id, q); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} จากร้าน NPC ${money(unit * q)} (แพงกว่าซื้อจากผู้เล่น)`, '🏪');
    }
    case 'market.sell': {
      const id = m.item, it = D.ITEMS[id];
      const have = a.inv[id] || 0;
      let q = m.qty === 'all' ? have : Math.floor(+m.qty);   // 'all' must be resolved before validating
      if (!it || !(q > 0)) return toast(a, 'ไม่มีของชิ้นนี้', '⚠️', false);
      q = Math.min(q, have, 500);
      if (q <= 0) return toast(a, 'ไม่มีของชิ้นนี้', '⚠️', false);
      if (!cd(a, 'sell', 300)) return;
      let total = 0;
      for (let i = 0; i < q; i++) { total += sellPrice(a, id) * NPC_BUY; market[id].mult = Math.max(0.4, market[id].mult * 0.985); }
      addItem(a, id, -q);
      const got = earn(a, total); quest(a, 'sell', q);
      if (got >= 3000) feed(`💰 ${a.name} ขาย${it.name}ล็อตใหญ่ได้ ${money(got)}`);
      return toast(a, `ขาย ${it.icon}${it.name} x${q} ได้ ${money(got)}`, '💰');
    }
    case 'warehouse.buy': {
      if (!need(a, 'merchant')) return;
      const id = m.item, it = D.ITEMS[id];
      if (!it || !it.wholesale) return;
      let q = clamp(Math.floor(+m.qty) || 1, 1, 10);
      if (stock[id] < q) q = Math.floor(stock[id]);
      if (q <= 0) return toast(a, 'สินค้าหมดสต็อก รอเติมของหน่อย', '📦', false);
      const unit = Math.round(it.wholesale * (1 - 0.06 * tier(a, 'merchant')));
      if (a.money < unit * q) return toast(a, `เงินไม่พอ (ต้องใช้ ${money(unit * q)})`, '💸', false);
      if (!spend(a, 4)) return;
      a.money -= unit * q;
      stock[id] -= q; addItem(a, id, q); addXp(a, 0.5); markMe(a); quest(a, 'buy', q);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคาส่ง ${money(unit * q)}`, '📦');
    }
    case 'studio.stream': {
      if (!need(a, 'streamer')) return;
      if (!cd(a, 'stream', 3000) || !spend(a, 20)) return;
      const base = 350 + a.followers * 0.5;
      let views = Math.round(base * Math.exp(rnd(-0.5, 0.6)));
      const viral = Math.random() < (ev('viral') ? 0.12 : 0.04);
      if (viral) views *= rint(8, 20);
      const tb = 1 + BOOST[tier(a, 'streamer')];
      const got = earn(a, views * 0.9 * wb * tb);
      const nf = Math.round(views * rnd(0.04, 0.08) * tb); a.followers += nf; addXp(a); quest(a, 'stream');
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
      const got = earn(a, (700 + 180 * (lvl(a) - 1)) * (fast ? 1.2 : 1) * wb * (1 + BOOST[tier(a, 'programmer')])); addXp(a); quest(a, 'code');
      return toast(a, `ส่งงานผ่าน! ได้ ${money(got)}${fast ? ' (โบนัสส่งไว)' : ''}`, '💻');
    }
    case 'restaurant.eat': {
      const buffet = m.kind === 'buffet';
      if (!cd(a, 'eat', buffet ? 20000 : 6000)) return;
      if (!pay(a, buffet ? 900 : 200)) { a.cd.eat = 0; return; }
      a.hunger = Math.min(100, a.hunger + (buffet ? 70 : 25));
      if (buffet) a.energy = Math.min(100, a.energy + 10); else infect(a, 'poison', 0.04);
      markMe(a); quest(a, 'eat');
      return toast(a, buffet ? 'บุฟเฟต์ชาบู! อิ่มแปล้' : 'กินข้าวมันไก่ อิ่มแล้ว', buffet ? '🍲' : '🍛');
    }
    case 'kitchen.cook': {
      if (!need(a, 'chef')) return;
      const r = D.RECIPES.find(x => x.id === m.rid); if (!r) return;
      for (const [k, q] of Object.entries(r.in)) if ((a.inv[k] || 0) < q) return toast(a, 'วัตถุดิบไม่พอ', '🥬', false);
      if (!cd(a, 'cook', 1200) || !spend(a, 12)) return;
      for (const [k, q] of Object.entries(r.in)) addItem(a, k, -q);
      const extra = Math.random() < 0.2 * tier(a, 'chef') ? 1 : 0;
      addItem(a, r.id, 1 + extra); addXp(a); markMe(a); quest(a, 'cook');
      return toast(a, `ปรุง ${D.ITEMS[r.id].icon}${D.ITEMS[r.id].name} สำเร็จ${extra ? ' — ฝีมือดี ได้เพิ่มอีก 1 จาน!' : ''}`, '🍳');
    }
    case 'kitchen.buy': {
      if (!need(a, 'chef')) return;
      const id = m.item, it = D.ITEMS[id];
      if (!it || !D.RECIPES.some(r => id in r.in)) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), cost = npcSellPrice(id) * q;
      if (!pay(a, cost)) return;
      addItem(a, id, q); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคา ${money(cost)} (แพงกว่าซื้อจากชาวไร่/ชาวประมงโดยตรง)`, '🛒');
    }
    case 'toolshop.buy': {
      const c = m.career, def = D.TOOLS[c]; if (!def) return;
      const cur = tier(a, c);
      if (cur >= 3) return toast(a, `${def.name}ของคุณอัปเกรดสูงสุดแล้ว`, 'ℹ️', false);
      if (!pay(a, D.TOOL_PRICES[cur])) return;
      a.tools = { ...a.tools, [c]: cur + 1 }; markMe(a);
      if (cur + 1 === 3) feed(`🛠️ ${a.name} อัปเกรด${def.name}ถึงระดับสูงสุด!`);
      return toast(a, `อัปเกรด ${def.icon}${def.name} เป็นระดับ ${cur + 1}: ${def.fx[cur]}`, '🛠️');
    }
    case 'dealer.buy': {
      const v = D.VEHICLES[m.veh]; if (!v) return;
      if (a.vehicles.includes(m.veh)) return toast(a, `คุณมี${v.name}อยู่แล้ว`, 'ℹ️', false);
      if (!pay(a, v.price)) return;
      a.vehicles = [...a.vehicles, m.veh]; markMe(a); sendRoster();
      if (v.price >= 25000) feed(`${v.icon} ${a.name} ถอย${v.name}ป้ายแดง!`);
      return toast(a, `ได้ ${v.icon}${v.name} แล้ว! เดินเร็วขึ้น x${speedOf(a)}`, v.icon);
    }
    case 'bank.deposit': case 'bank.withdraw': case 'bank.borrow': case 'bank.repay': {
      accrue(a);
      let amt = Math.floor(+m.amt) || 0;
      if (amt <= 0) return toast(a, 'ใส่จำนวนเงินก่อน', '⚠️', false);
      if (m.a === 'deposit') { amt = Math.min(amt, Math.floor(a.money)); if (amt <= 0) return toast(a, 'ไม่มีเงินสดให้ฝาก', '💸', false); a.money -= amt; a.bank += amt; toast(a, `ฝากเงิน ${money(amt)}`, '🏦'); }
      if (m.a === 'withdraw') { amt = Math.min(amt, Math.floor(a.bank)); if (amt <= 0) return toast(a, 'ไม่มีเงินในบัญชี', '💸', false); a.bank -= amt; a.money += amt; toast(a, `ถอนเงิน ${money(amt)}`, '🏦'); }
      if (m.a === 'borrow') {
        const room = Math.floor((D.BANK.loanMax - a.loan) / (1 + D.BANK.loanFee)); amt = Math.min(amt, room);
        if (amt <= 0) return toast(a, `กู้ได้สูงสุด ${money(D.BANK.loanMax)} (รวมดอกเบี้ย) ใช้คืนก่อนนะ`, '🏦', false);
        a.money += amt; a.loan += Math.ceil(amt * (1 + D.BANK.loanFee)); toast(a, `กู้เงิน ${money(amt)} (ต้องคืน ${money(amt * (1 + D.BANK.loanFee))})`, '🏦');
      }
      if (m.a === 'repay') { amt = Math.min(amt, Math.floor(a.money), Math.ceil(a.loan)); if (amt <= 0) return toast(a, a.loan > 0 ? 'เงินสดไม่พอ' : 'คุณไม่มีหนี้', 'ℹ️', false); a.money -= amt; a.loan -= amt; toast(a, `ชำระหนี้ ${money(amt)}${a.loan <= 0 ? ' — ปลดหนี้แล้ว! 🎉' : ''}`, '🏦'); }
      a.loan = Math.max(0, a.loan); return markMe(a);
    }
    case 'house.buy': {
      if (houses[s.idx]) return toast(a, `บ้านหลังนี้เป็นของ ${houses[s.idx].name} แล้ว`, '🏠', false);
      if (a.house >= 0) return toast(a, 'คุณมีบ้านแล้ว (ขายบ้านเดิมก่อนถึงจะซื้อใหม่ได้)', '🏠', false);
      if (!pay(a, D.HOUSE_PRICES[s.idx])) return;
      houses[s.idx] = a; a.house = s.idx; a.furniture = []; markMe(a); wdAt = 0;
      feed(`🏠 ${a.name} ซื้อบ้านหลังใหม่ในหมู่บ้าน!`);
      return toast(a, 'ยินดีด้วย! ได้บ้านแล้ว แต่งบ้านเพื่อเพิ่มความสบาย และนอนฟรีที่นี่ได้', '🏠');
    }
    case 'house.sell': case 'house.sleep': case 'house.furnish': {
      if (houses[s.idx] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      if (m.a === 'sell') {
        const back = Math.round(D.HOUSE_PRICES[s.idx] * 0.7 + (a.furniture || []).reduce((t, k) => t + D.FURNITURE[k].price * 0.4, 0));
        houses[s.idx] = null; a.house = -1; a.furniture = []; a.money += back; markMe(a); wdAt = 0;
        return toast(a, `ขายบ้านได้ ${money(back)}`, '🏠');
      }

      const f = D.FURNITURE[m.item]; if (!f) return;
      if (a.furniture.includes(m.item)) return toast(a, `มี${f.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, f.price)) return;
      a.furniture = [...a.furniture, m.item]; markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${f.icon}${f.name} ความสบาย +${f.comfort} (รวม ${comfort(a)})`, f.icon);
    }
    case 'hbed.sleep': {
      if (houses[s.idx] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ นอนได้แค่บ้านตัวเอง', '🔒', false);
      if (!cd(a, 'homesleep', 60000)) return;
      const e = 40 + comfort(a) * 2; a.energy = Math.min(100, a.energy + e); a.health = Math.min(100, a.health + 5); sleepWell(a); markMe(a);
      return toast(a, `นอนหลับสบายที่บ้าน พลังงาน +${e} หายง่วงแล้ว`, '😴');
    }
    case 'hospital.heal': {
      if (a.health >= 98 && !(a.dz || []).length) return toast(a, 'คุณสุขภาพดีอยู่แล้ว', 'ℹ️', false);
      const price = (a.dz || []).length ? 1500 + 500 * (a.dz.length - 1) : 1200;
      if (!pay(a, price)) return;
      a.health = Math.min(100, a.health + 40); for (const d of [...(a.dz || [])]) cure(a, d); markMe(a);
      return toast(a, `รักษาที่เคาน์เตอร์ ${money(price)} — หายป่วยแล้ว สุขภาพ +40 (หาหมอผู้เล่นจะถูกกว่ามาก)`, '🏥');
    }
    case 'bed.lie': {
      if (beds[s.idx] && beds[s.idx] !== a) return toast(a, 'เตียงนี้มีคนนอนอยู่แล้ว', '🛏️', false);
      if (a.career === 'doctor' && !(a.dz || []).length) return toast(a, 'คุณเป็นหมอ เดินไปที่เตียงที่มีคนไข้แล้วรักษาเขาได้เลย', 'ℹ️', false);
      leaveBed(a); beds[s.idx] = a; a.bed = s.idx; a.x = s.x; a.y = s.y; send(a, { t: 'fix', x: a.x, y: a.y }); a.moved = true;
      sendRoster(); wdAt = 0; markMe(a);
      const docs = [...online.values()].filter(o => o.career === 'doctor' && o !== a);
      for (const d of docs) toast(d, `🛏️ ${a.name} นอนรอหมออยู่ที่โรงพยาบาล เตียง ${s.idx + 1}`, '🩺');
      return toast(a, docs.length ? `นอนรอหมอแล้ว (หมอออนไลน์ ${docs.length} คน) ค่ารักษา ฿600` : 'นอนรอหมอแล้ว แต่ตอนนี้ไม่มีหมอออนไลน์ อาจต้องไปที่เคาน์เตอร์ (แพงกว่า)', '🛏️');
    }
    case 'bed.treat': {
      if (!need(a, 'doctor')) return;
      const pt = beds[s.idx];
      if (!pt || pt === a) return toast(a, 'เตียงนี้ยังไม่มีคนไข้', '🛏️', false);
      if (!cd(a, 'treat', 1500) || !spend(a, 10)) return;
      const target = (pt.dz || [])[0];
      if (!target) {   // just a check-up / health top-up
        const fee = Math.min(300, Math.floor(pt.money)); pt.money -= fee; earn(a, fee + 150);
        pt.health = Math.min(100, pt.health + 30); addXp(a); markMe(pt);
        toast(pt, `หมอ${a.name}ตรวจร่างกายให้ สุขภาพ +30 (ค่าตรวจ ${money(fee)})`, '🩺');
        return toast(a, `ตรวจร่างกาย ${pt.name} เรียบร้อย ได้ ${money(fee + 150)}`, '🩺');
      }
      if (DZ[target].cure !== m.tx) {
        pt.health = Math.max(1, pt.health - 5); markMe(pt);
        toast(pt, `หมอ${a.name}วินิจฉัยผิด! อาการยังไม่ดีขึ้น (สุขภาพ -5)`, '😣', false);
        return toast(a, `วินิจฉัยผิด! คนไข้ไม่ได้เป็นโรคที่รักษานี้ ลองดูอาการอีกครั้ง`, '❌', false);
      }
      cure(pt, target); pt.health = Math.min(100, pt.health + 20);
      const fee = Math.min(600, Math.floor(pt.money)); pt.money -= fee;
      const got = earn(a, (fee + 300) * (1 + BOOST[tier(a, 'doctor')])); addXp(a, 2); quest(a, 'shift');
      if (!pt.dz.length) leaveBed(pt);
      markMe(pt);
      toast(pt, `หมอ${a.name}รักษา${DZ[target].name}หายแล้ว! (ค่ารักษา ${money(fee)})`, '💉');
      feed(`🩺 หมอ${a.name} รักษา${DZ[target].name}ให้ ${pt.name} สำเร็จ`);
      return toast(a, `วินิจฉัยถูกต้อง! รักษา${DZ[target].name}หาย ได้ ${money(got)}`, '💉');
    }
    case 'hospital.shift': {
      if (!need(a, 'doctor')) return;
      if (!cd(a, 'shift', 2000) || !spend(a, 28)) return;
      const got = earn(a, (1100 + 200 * (lvl(a) - 1)) * wb * (ev('boom') ? 1.25 : 1) * (ev('flu') ? 1.4 : 1) * (1 + BOOST[tier(a, 'doctor')]));
      a.health = Math.max(0, a.health - 2); addXp(a); quest(a, 'shift');
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
      if (!cd(a, 'rest', 90000)) return;
      a.energy = Math.min(100, a.energy + 25); a.awake = Math.max(0, (a.awake || 0) - 480); markMe(a);
      return toast(a, 'งีบหลับ พลังงาน +25', '😴');
    }
    case 'home.inn': {
      if (!cd(a, 'inn', 60000)) return;
      if (!pay(a, 400)) { a.cd.inn = 0; return; }
      a.energy = Math.min(100, a.energy + 40); a.health = Math.min(100, a.health + 10); sleepWell(a); markMe(a);
      return toast(a, 'นอนห้องพัก พลังงาน +40 สุขภาพ +10', '🛏️');
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
      infect(a, 'injury', 0.02);
      if (!id) { markMe(a); return toast(a, 'ได้ขยะทะเล 🥫 ... ไม่มีราคา', '🥫', false); }
      addItem(a, id, 1); markMe(a); quest(a, 'fish');
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
      const f = (ev('rain') ? 0.5 : ev('drought') ? 1.6 : 1) * (1 - 0.15 * tier(a, 'farmer'));
      plots[s.idx] = { crop: m.crop, owner: a.id, ownerName: a.name, readyAt: now() + c.grow * 1000 * f };
      markMe(a);
      return toast(a, `ปลูก${D.ITEMS[m.crop].name}แล้ว`, '🌱');
    }
    case 'plot.harvest': {
      if (!need(a, 'farmer')) return;
      infect(a, 'injury', 0.015);
      const p = plots[s.idx];
      if (!p) return toast(a, 'แปลงว่าง', '⚠️', false);
      if (p.readyAt > now()) return toast(a, 'พืชยังไม่โต', '🌱', false);
      const stealing = p.owner !== a.id;
      if (stealing && now() < p.readyAt + 60000) return toast(a, `ของ ${p.ownerName} เขามีสิทธิ์เก็บก่อน (อีก ${Math.ceil((p.readyAt + 60000 - now()) / 1000)} วิ)`, '🔒', false);
      if (!spend(a, 8)) return;
      const c = D.CROPS[p.crop];
      const n = rint(c.min, c.max) + Math.floor(lvl(a) / 3) + tier(a, 'farmer');
      addItem(a, p.crop, n); plots[s.idx] = null; addXp(a); markMe(a); quest(a, 'harvest');
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
  if (e.hunger) { a.hunger = Math.min(100, a.hunger + e.hunger); quest(a, 'eat'); }
  if (e.energy) a.energy = Math.min(100, a.energy + e.energy);
  if (e.health) a.health = Math.min(100, a.health + e.health);
  if (id === 'medkit') cure(a, 'injury');
  if (id === 'snack') infect(a, 'poison', 0.03);
  if (it.kind === 'crop') infect(a, 'poison', 0.08);          // raw produce
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
  quest(tr.a, 'trade'); quest(tr.b, 'trade');
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
    const heal = 35 + 5 * lvl(f, 'doctor') + 10 * tier(f, 'doctor');
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
  if (!/^\d{4,8}$/.test(pin)) return fail(ws, 'PIN ต้องเป็นตัวเลข 4-8 หลัก');
  const lname = name.toLowerCase(), t = now();
  const lock = loginFails.get('n:' + lname), ipLock = loginFails.get('i:' + ws.ip);
  if (lock && lock.until > t) return fail(ws, `ใส่ PIN ผิดหลายครั้ง ลองใหม่ในอีก ${Math.ceil((lock.until - t) / 60000)} นาที`);
  if (ipLock && ipLock.until > t) return fail(ws, `ลองเข้าสู่ระบบผิดบ่อยเกินไป ลองใหม่ในอีก ${Math.ceil((ipLock.until - t) / 60000)} นาที`);
  let a = accounts.get(lname), isNew = false;
  if (a) {
    if (hashPin(pin, a.salt) !== a.hash) {
      loginFail('n:' + lname, 5, 5 * 60000); loginFail('i:' + ws.ip, 15, 10 * 60000);
      return fail(ws, 'ชื่อนี้มีคนใช้แล้ว หรือ PIN ไม่ถูกต้อง');
    }
    loginFails.delete('n:' + lname);
    if (a.ws) { send(a, { t: 'kicked', msg: 'มีการเข้าสู่ระบบจากที่อื่น' }); a.ws.close(); detach(a); }
  } else {
    const salt = crypto.randomBytes(8).toString('hex');
    const career = ['office', 'farmer', 'fisher', 'merchant', 'streamer'].includes(m.career) ? m.career : 'office';
    a = hydrate({ name, salt, hash: hashPin(pin, salt), avatar: clamp(Math.floor(+m.avatar) || 0, 0, 9), career });
    accounts.set(lname, a); isNew = true;
  }
  Q.ensure(a);
  const daily = dailyLogin(a);
  a.ws = ws; ws.acct = a; a.id = nextId++; a.lastPosT = now(); a.moved = true;
  if (D.blocked(a.x, a.y)) { a.x = D.SPAWN.x; a.y = D.SPAWN.y; }
  online.set(a.id, a);
  dirty = true;
  send(a, {
    t: 'init', id: a.id,
    map: { w: D.W, h: D.H, tiles: D.TILES, buildings: D.BUILDINGS }, stations: D.STATIONS,
    items: D.ITEMS, crops: D.CROPS, recipes: D.RECIPES, careers: D.CAREERS, licenses: D.LICENSES,
    titles: D.OFFICE_TITLES, speed: SPEED, radius: D.RADIUS, chat: chatLog.slice(-25), isNew,
    rooms: D.ROOMS, tw: D.TW, diseases: D.DISEASES, treatments: D.TREATMENTS,
    shop: { vehicles: D.VEHICLES, tools: D.TOOLS, toolPrices: D.TOOL_PRICES, housePrices: D.HOUSE_PRICES, furniture: D.FURNITURE, bank: D.BANK },
  });
  send(a, meView(a)); send(a, worldView());
  if (daily) send(a, { t: 'daily', ...daily });
  sendRoster();
  feed(`👋 ${a.name} เข้าเมือง`);
}
function fail(ws, msg) { ws.send(JSON.stringify({ t: 'loginfail', msg })); }

// brute-force protection: too many wrong PINs locks that name (and that IP) for a while
const loginFails = new Map();
function loginFail(key, max, ms) {
  const t = now(), r = loginFails.get(key);
  const e = r && r.reset > t ? r : { n: 0, reset: t + ms, until: 0 };
  if (++e.n >= max) { e.until = t + ms; e.n = 0; }
  loginFails.set(key, e);
}
setInterval(() => { const t = now(); for (const [k, v] of loginFails) if (v.reset < t && v.until < t) loginFails.delete(k); }, 60000).unref();

// daily login bonus: grows each consecutive day, capped at day 7
const LOGIN_BONUS = [300, 500, 700, 900, 1200, 1500, 2500];
function dailyLogin(a) {
  const today = Q.dayKey(), yesterday = Q.dayKey(now() - 86400e3);
  if (a.lastLogin === today) return null;
  a.loginStreak = a.lastLogin === yesterday ? (a.loginStreak || 0) + 1 : 1;
  a.lastLogin = today;
  const reward = LOGIN_BONUS[Math.min(a.loginStreak, 7) - 1];
  a.money += reward; a.earned += reward; dirty = true;
  return { streak: a.loginStreak, reward, table: LOGIN_BONUS };
}

function detach(a) {
  if (!a.id) return;
  if (a.trade) tradeClose(a.trade, `${a.name} ออกจากเกม`);
  for (const [id, r] of reqs) if (r.from === a || r.to === a) reqs.delete(id);
  leaveBed(a);
  online.delete(a.id);
  a.ws = null; a.cast = null; a.sd = true; dirty = true;
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
      // movement budget: refills with real time at the player's speed (+25% for jitter), small cap for bursts
      const t = now(), dt = Math.min(1, (t - a.lastPosT) / 1000);
      a.lastPosT = t;
      a.mvb = Math.min(1.2, (a.mvb ?? 1.2) + SPEED * speedOf(a) * 1.25 * dt);
      const d = Math.hypot(x - a.x, y - a.y);
      if (d > a.mvb + 0.05 || D.blocked(x, y)) return send(a, { t: 'fix', x: a.x, y: a.y });
      a.mvb -= d;
      if (x !== a.x || y !== a.y) { a.x = x; a.y = y; a.moved = true; dirty = true; }
      a.f = clamp(Math.floor(+m.f) || 0, 0, 7);
      if (a.bed >= 0 && Math.hypot(a.x - ST['bed' + a.bed].x, a.y - ST['bed' + a.bed].y) > 1.2) leaveBed(a);
      if (a.cast && Math.hypot(a.x - ST[a.cast.st].x, a.y - ST[a.cast.st].y) > ST[a.cast.st].r + 1.2) { a.cast = null; markMe(a); }
      return;
    }
    case 'chat': {
      const text = cleanText(m.text, 120); if (!text) return;
      if (!cd(a, 'chat', 800)) return;
      const msg = { t: 'chat', id: a.id, name: a.name, av: a.avatar, c: a.career, text, ts: now() };
      chatLog.push(msg); if (chatLog.length > 40) chatLog.shift();
      broadcast(msg); return quest(a, 'chat');
    }
    case 'act': return act(a, m);
    case 'enter': return enterRoom(a, m);
    case 'exit': return exitRoom(a);
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
    case 'quest_reroll': {
      const err = Q.reroll(a, Math.floor(+m.i));
      if (err) return toast(a, err, '📜', false);
      markMe(a); return toast(a, 'เปลี่ยนเควสต์แล้ว', '📜');
    }
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

  const passive = t > passiveAt; if (passive) { passiveAt = t + 30000; for (const a of online.values()) if (a.bank > 0) { accrue(a); markMe(a); } }
  for (const a of online.values()) {
    a.energy = Math.min(100, a.energy + 0.25 * (1 + 0.03 * comfort(a)) * dzProd(a, 'regen') * dt);
    a.hunger = Math.max(0, a.hunger - 0.1 * dzProd(a, 'hunger') * (ev('flu') ? 1.4 : 1) * dt);
    if (a.hunger <= 0) a.health = Math.max(0, a.health - 0.15 * dt);
    else if (a.hunger > 60 && a.health < 100 && !(a.dz || []).length) a.health = Math.min(100, a.health + 0.05 * dt);
    for (const d of a.dz || []) a.health = Math.max(0, a.health - (DZ[d].drain || 0) * dt);
    // ways to get sick
    const outdoors = !D.roomAt(a.x, a.y);
    a.awake = (a.awake || 0) + dt;
    if (a.awake > 25 * 60) infect(a, 'insomnia', 0.01 * dt);
    if (ev('rain') && outdoors) { a.wet = (a.wet || 0) + dt; if (a.wet > 45) infect(a, 'cold', 0.006 * dt); } else a.wet = Math.max(0, (a.wet || 0) - dt * 2);
    if (ev('flu')) infect(a, 'cold', 0.0015 * dt);
    if (a.hunger <= 0) { a.starve = (a.starve || 0) + dt; if (a.starve > 90) infect(a, 'malnut'); } else a.starve = 0;
    if (a.hunger >= 80) cure(a, 'malnut');
    if (a.health <= 0) {
      const fine = Math.min(Math.round(a.money * 0.15), 1500); a.money -= fine;
      a.health = 40; a.energy = 20; a.hunger = Math.max(a.hunger, 40);
      const h = ST.hospital; a.x = h.x; a.y = h.y + 1.2; a.cast = null; a.moved = true; a.mvb = 1.2; leaveBed(a);
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
  for (const p of plots) if (p && !p.told && p.readyAt <= t) {
    p.told = true;
    const o = online.get(p.owner);
    if (o) toast(o, `${D.ITEMS[p.crop].name}ที่คุณปลูกไว้โตแล้ว! รีบไปเก็บก่อนคนอื่นเก็บตัดหน้า (60 วิ)`, '🌾');
  }
  for (const [id, r] of reqs) if (t > r.exp) { reqs.delete(id); toast(r.from, `${r.to.name} ไม่ตอบรับ`, '⌛', false); }

  // positions
  const ps = [];
  for (const a of online.values()) if (a.moved) { a.moved = false; ps.push([a.id, +a.x.toFixed(2), +a.y.toFixed(2), a.f]); }
  if (ps.length) broadcast({ t: 'ps', p: ps });

  if (t > wdAt) { wdAt = t + 1000; broadcast(worldView()); }
  if (t > saveAt) { saveAt = t + 15000; save(); }
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
wss.on('connection', (ws, req) => {
  ws.ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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

// keep a free-tier host awake by requesting our own public URL while running
const SELF_URL = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => { fetch(SELF_URL.replace(/\/$/, '') + '/healthz').catch(() => {}); }, 9 * 60 * 1000);
  console.log('keep-alive ping enabled for', SELF_URL);
}

let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  setTimeout(() => process.exit(0), 5000).unref();
  await save(true); await store.close(); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

async function main() {
  await store.init();
  await load();
  setInterval(tick, TICK);
  server.listen(PORT, () => console.log(`Life Town running on http://localhost:${PORT}`));
}
if (require.main === module) main().catch(e => { console.error('fatal:', e); process.exit(1); });
module.exports = { server };
