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
const SPEED = 3.0;                          // tiles / second on foot
const TICK = 100;
const VERSION = 2;                          // save-format version (2 = new world)

// ------------------------------------------------------------------ state
const accounts = new Map();                 // lowercase name -> account
const byPhone = new Map();                  // phone number -> account
const online = new Map();                   // id -> account
const ST = Object.fromEntries(D.STATIONS.map(s => [s.id, s]));
const market = {};                          // item -> { mult, target }
const stock = {};                           // wholesale stock
for (const [k, it] of Object.entries(D.ITEMS)) {
  market[k] = { mult: 1, target: 1 };
  if (it.wholesale) stock[k] = it.stock;
}
let event = null;                           // { id, text, until }
let nextEventAt = Date.now() + 120_000;
const chatLog = [];                         // town-wide announcements only
const reqs = new Map();                     // pending requests (trade / heal / call)
let nextId = 1, dirty = false;

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const ev = id => event && event.id === id;
const lvl = (a, c = a.career) => 1 + Math.floor((a.xp[c] || 0) / (c === 'office' ? 3 : 10));
const money = n => '฿' + Math.round(n).toLocaleString('en-US');
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const hourNow = () => D.hourAt(now());
const hhmm = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const areaId = a => D.areaAt(a.x, a.y)?.id;

function send(a, obj) { if (a.ws && a.ws.readyState === 1) a.ws.send(JSON.stringify(obj)); }
function broadcast(obj) { const s = JSON.stringify(obj); for (const a of online.values()) if (a.ws.readyState === 1) a.ws.send(s); }
function toast(a, msg, icon = '✅', ok = true) { send(a, { t: 'toast', msg, icon, ok }); }
function feed(text) {
  const m = { t: 'chat', sys: true, text, ts: now() };
  chatLog.push(m); if (chatLog.length > 40) chatLog.shift();
  broadcast(m);
}
function markMe(a) { a.meDirty = true; dirty = true; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function wellbeing(a) {
  let m = 1;
  if (a.hunger < 15) m *= 0.7;
  if (a.health < 30) m *= 0.6;
  for (const d of a.dz || []) m *= D.DISEASES[d]?.income || 1;
  return m;
}

// ------------------------------------------------------------------ achievements
function stat(a, key, n = 1, absolute = false) {
  a.stats = a.stats || {};
  a.stats[key] = absolute ? Math.max(a.stats[key] || 0, n) : (a.stats[key] || 0) + n;
  for (const ac of D.ACHIEVEMENTS) {
    if (ac.stat !== key || (a.ach || []).includes(ac.id) || a.stats[key] < ac.n) continue;
    a.ach = [...(a.ach || []), ac.id];
    if (!a.title) a.title = ac.id;
    toast(a, `ปลดล็อกความสำเร็จ "${ac.title}" — ${ac.desc} (ตั้งเป็นฉายาบนหัวได้ที่เมนู 🏅)`, '🏅');
    send(a, { t: 'ach', id: ac.id });
    feed(`🏅 ${a.name} ได้รับฉายา "${ac.title}"`);
    sendRoster();
  }
  markMe(a);
}
const titleOf = a => D.ACHIEVEMENTS.find(x => x.id === a.title)?.title || '';

// ------------------------------------------------------------------ diseases
const DZ = D.DISEASES;
const dzProd = (a, key) => (a.dz || []).reduce((m, d) => m * (DZ[d]?.[key] || 1), 1);
function infect(a, id, chance = 1) {
  if (Math.random() > chance || !DZ[id] || (a.dz || []).includes(id) || (a.dz || []).length >= 3 || a.down) return false;
  if ((a.immune?.[id] || 0) > now()) return false;
  a.dz = [...(a.dz || []), id];
  const d = DZ[id];
  toast(a, `คุณป่วยเป็น${d.name}! อาการ: ${d.sym.slice(0, 2).join(', ')} · ${d.self}`, d.icon, false);
  markMe(a); sendRoster(); return true;
}
function cure(a, id) {
  if (!(a.dz || []).includes(id)) return false;
  a.dz = a.dz.filter(x => x !== id);
  a.immune = { ...(a.immune || {}), [id]: now() + 240000 };
  markMe(a); sendRoster(); return true;
}
function sleepWell(a) { a.awake = 0; cure(a, 'insomnia'); cure(a, 'exhaust'); }

// ------------------------------------------------------------------ positions, rooms, seats
const ROOM = Object.fromEntries(D.ROOMS.map(r => [r.id, r]));
const chairs = new Array(8).fill(null);        // office chairs -> account
const beds = new Array(6).fill(null);          // hospital beds -> account | npc patient
function standUp(a) {
  if (a.chair >= 0) { if (chairs[a.chair] === a) chairs[a.chair] = null; a.chair = -1; }
  if (a.bed >= 0) { if (beds[a.bed] === a) beds[a.bed] = null; a.bed = -1; wdAt = 0; }
  if (a.pose) { a.pose = null; a.seat = null; }
  sendRoster();
}
function place(a, x, y, tp) {
  a.x = x; a.y = y; a.mvb = 2.5; a.moved = true; a.lastPosT = now();
  send(a, { t: 'fix', x, y, tp: tp ? 1 : 0 });
}
function teleport(a, x, y) { a.cast = null; standUp(a); place(a, x, y, true); markMe(a); }
function buildingOpen(bid, h = hourNow()) { return D.isOpen(bid, h); }
function enterRoom(a, m) {
  if (a.down) return;
  const s = ST[m.st]; if (!s || s.type !== 'door') return;
  const room = ROOM[s.to]; if (!room) return;
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 1.2) return toast(a, 'เดินไปที่ประตูก่อน', '🚪', false);
  if (s.house === undefined && !buildingOpen(s.bld)) {
    const o = D.HOURS[s.bld];
    return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false);
  }
  if (!cd(a, 'door', 1200, true)) return;
  teleport(a, room.spawn.x, room.spawn.y);
}
function exitRoom(a) {
  if (a.down === 'hosp' || a.down?.kind) return;
  const room = D.roomAt(a.x, a.y);
  if (!room || Math.hypot(a.x - room.exit.x, a.y - room.exit.y) > 2.4) return;
  if (!cd(a, 'door', 1200, true)) return;
  teleport(a, room.outside.x, room.outside.y);
}

// ------------------------------------------------------------------ money
function earn(a, amount) {
  amount = Math.round(amount); a.money += amount; a.earned += amount; markMe(a);
  if (amount > 0) {
    quest(a, 'earn', amount);
    if (a.loan > 0) { const r = Math.min(a.loan, Math.ceil(amount * D.BANK.repayShare)); a.money -= r; a.loan -= r; }   // loans auto-repay from income
  }
  return amount;
}
function credit(o, amount) {          // pay someone who may be offline
  amount = Math.round(amount); o.money += amount; o.earned += amount; o.sd = true; dirty = true;
  if (o.ws) { quest(o, 'earn', amount); markMe(o); }
}
const tier = (a, c) => (a.tools && a.tools[c]) || 0;
const BOOST = [0, .15, .3, .5];
const houseOf = a => (a.house >= 0 ? a.house : -1);
const comfort = a => houseOf(a) >= 0 ? (a.furniture || []).reduce((s, k) => s + (D.FURNITURE[k]?.comfort || 0), 0) : 0;
const speedOf = a => Math.max(1, ...(a.vehicles || []).map(v => D.VEHICLES[v]?.speed || 1)) * dzProd(a, 'speed');
const bestVehicle = a => (a.vehicles || []).reduce((b, v) => !b || D.VEHICLES[v].speed > D.VEHICLES[b].speed ? v : b, null);
function accrue(a) {
  const t = now(), days = (t - (a.bankT || t)) / 86400e3; a.bankT = t;
  if (a.bank > 0 && days > 0) a.bank += Math.min(a.bank, D.BANK.cap) * (Math.pow(1 + D.BANK.rate, days) - 1);
}
function quest(a, type, n = 1) {
  for (const e of Q.progress(a, type, n)) {
    send(a, { t: 'quest', ...e });
    if (e.kind === 'all') feed(`📜 ${a.name} ทำเควสต์ประจำวันครบทั้ง 3 ข้อ! (ติดต่อกัน ${e.streak} วัน)`);
  }
  markMe(a);
}
function spend(a, e) {
  if (a.energy < e) { toast(a, `พลังงานไม่พอ (ต้องใช้ ${e}) กินอาหารหรือนั่งพักก่อน`, '😴', false); return false; }
  a.energy -= e;
  a.hunger = Math.max(0, a.hunger - e * 0.12);
  if (a.energy < 20) infect(a, 'exhaust', 0.1);
  return true;
}
function pay(a, amount) {
  if (a.money < amount) { toast(a, `เงินไม่พอ (ต้องใช้ ${money(amount)})`, '💸', false); return false; }
  a.money -= amount; return true;
}
function cd(a, key, ms, quiet) {
  const t = now();
  if ((a.cd[key] || 0) > t) { if (!quiet) toast(a, `รออีก ${Math.ceil((a.cd[key] - t) / 1000)} วินาที`, '⏳', false); return false; }
  a.cd[key] = t + ms; return true;
}
function addItem(a, id, n) { a.inv[id] = (a.inv[id] || 0) + n; if (a.inv[id] <= 0) delete a.inv[id]; }
function need(a, career) {
  if (a.career !== career) {
    const c = D.CAREERS[career], w = c.where && ST[c.where];
    toast(a, `ต้องเป็น${c.name}ก่อน — ไปสมัครงานที่ ${w ? w.label : '-'}`, '🚫', false); return false;
  }
  return true;
}
function addXp(a, n = 1) { a.xp[a.career] = (a.xp[a.career] || 0) + n; }

const NPC_BUY = 0.35;                         // NPC shops buy at a fraction of what players pay each other
const NPC_SELL = 2.5;                         // ...and sell at a big markup
function marketPrice(id) {
  const it = D.ITEMS[id];
  let p = it.base * market[id].mult;
  if (ev('festival') && (it.kind === 'meal' || it.kind === 'goods')) p *= 1.2;
  if (ev('drought') && it.kind === 'crop') p *= 1.3;
  return p;
}
function npcBuyPrice(a, id, rate = NPC_BUY) {
  const it = D.ITEMS[id];
  let b = 1;
  if (a.career === 'merchant') b += 0.08 + Math.min(0.1, 0.01 * (lvl(a, 'merchant') - 1));
  if (a.career === 'chef' && it.kind === 'meal') b += 0.08;
  if (a.career === 'farmer' && it.kind === 'crop') b += 0.08;
  if (a.career === 'fisher' && it.kind === 'fish') b += 0.08;
  return marketPrice(id) * rate * b;
}
const npcSellPrice = id => Math.ceil(D.ITEMS[id].base * NPC_SELL);
function worth(a) {
  let w = a.money + (a.bank || 0) - (a.loan || 0);
  for (const [k, q] of Object.entries(a.inv)) w += (D.ITEMS[k]?.base || 0) * q * 0.5;
  for (const L of a.listings || []) w += (D.ITEMS[L.item]?.base || 0) * L.qty * 0.5;
  for (const v of a.vehicles || []) w += (D.VEHICLES[v]?.price || 0) * 0.5;
  for (const [, t] of Object.entries(a.tools || {})) for (let i = 0; i < t; i++) w += D.TOOL_PRICES[i] * 0.5;
  if (a.house >= 0) { w += D.HOUSE_PRICES[a.house] * 0.7; for (const f of a.furniture || []) w += (D.FURNITURE[f]?.price || 0) * 0.5; }
  if (a.garden) w += D.GARDEN.lotPrice * 0.6;
  return w;
}

// ------------------------------------------------------------------ persistence
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
const SAVE_KEYS = ['v', 'name', 'salt', 'hash', 'avatar', 'money', 'energy', 'hunger', 'health', 'career', 'licenses', 'xp', 'inv', 'x', 'y', 'earned',
  'created', 'quests', 'qStreak', 'lastLogin', 'loginStreak', 'tools', 'vehicles', 'house', 'furniture', 'bank', 'bankT', 'loan', 'dz', 'awake', 'listings',
  'phone', 'contacts', 'stats', 'ach', 'title', 'jobChanges', 'enrolled', 'classes', 'office', 'garden', 'rent', 'houseSale', 'houseRent', 'down'];
let nextListing = 1;
async function load() {
  const rows = await store.loadAll();
  for (const r of rows) if (r && r.name) accounts.set(r.name.toLowerCase(), hydrate(r));
  for (const a of accounts.values()) {
    for (const L of a.listings || []) nextListing = Math.max(nextListing, L.id + 1);
    if (a.house >= 0) { if (houses[a.house]) a.house = -1; else houses[a.house] = a; }
    if (a.garden) { if (lots[a.garden.lot]) a.garden = null; else lots[a.garden.lot] = a; }
    if (a.rent && a.rent.until > now()) tenants[a.rent.idx] = a; else a.rent = null;
    byPhone.set(a.phone, a);
  }
  console.log(`loaded ${accounts.size} players`);
}
function newPhone() { let p; do p = String(rint(100000, 999999)); while (byPhone.has(p)); return p; }
function hydrate(r) {
  const a = Object.assign({
    avatar: 0, money: 1000, energy: 100, hunger: 100, health: 100, career: 'none', licenses: [], xp: {},
    inv: {}, x: D.SPAWN.x, y: D.SPAWN.y, earned: 0, created: now(), quests: null, qStreak: 0, lastLogin: '', loginStreak: 0, tools: {}, vehicles: [], house: -1,
    furniture: [], bank: 0, bankT: now(), loan: 0, dz: [], awake: 0, listings: [], contacts: [], stats: {}, ach: [], title: '', jobChanges: [],
    enrolled: false, classes: 0, office: null, garden: null, rent: null, houseSale: 0, houseRent: 0, down: null,
  }, r, { ws: null, id: null, f: 0, bed: -1, chair: -1, pose: null, seat: null, immune: {}, cd: {}, cast: null, trade: null, call: null, lastPosT: now(), moved: false, meDirty: false });
  if ((a.v || 1) < VERSION) {                      // migrate saves from the old single-map town
    if (!D.CAREERS[a.career]) a.career = 'none';
    a.licenses = (a.licenses || []).filter(l => D.LICENSES[l]);
    if (a.licenses.includes('medicine') || a.career === 'office') a.licenses = [...new Set([...a.licenses, 'degree'])];
    if (a.house >= 0) { a.money += 30000; a.house = -1; a.furniture = []; }   // the old houses were demolished: refund
    a.x = D.SPAWN.x; a.y = D.SPAWN.y; a.v = VERSION;
  }
  if (!a.phone || byPhone.has(a.phone) && byPhone.get(a.phone) !== a) a.phone = newPhone();
  byPhone.set(a.phone, a);
  return a;
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

// ------------------------------------------------------------------ world objects owned by players
const houses = D.HOUSE_PRICES.map(() => null);    // house idx -> owner account
const tenants = D.HOUSE_PRICES.map(() => null);   // house idx -> tenant account
const lots = D.LOTS.map(() => null);              // garden lot idx -> owner account

// ------------------------------------------------------------------ food delivery
const orders = new Map();                          // id -> order
let nextOrder = 1, npcOrderAt = 0;
const MENU = Object.keys(D.ITEMS).filter(k => D.ITEMS[k].menu);
const PICKUP = ST.restaurant;                      // the restaurant counter (inside)
const RESTO_OUT = D.ROOMS.find(r => r.bld === 'restaurant').outside;
function deliveryFee(x, y) {
  const area = D.areaAt(x, y)?.id || 'town';
  const pos = area === 'town' ? { x, y } : area === 'housing' ? { x: 50, y: 4 } : area === 'farm' ? { x: 3, y: 32 } : D.ROOMS.find(r => r.id === area)?.outside || { x, y };
  const d = Math.hypot(pos.x - RESTO_OUT.x, pos.y - RESTO_OUT.y) + (area === 'housing' || area === 'farm' ? 25 : 0);
  return Math.round(D.RIDER.baseFee + d * D.RIDER.perTile);
}
const ridersOnline = () => [...online.values()].filter(r => r.career === 'rider' && !r.down);
function orderView(o) {
  return { id: o.id, item: o.item, state: o.state, fee: o.fee, tip: o.tip, cust: o.custName, npc: !!o.npc, rider: o.riderName || '', t: o.t,
    dest: o.npc ? { x: o.npc.x, y: o.npc.y } : null, area: o.npc ? o.npc.area : null };
}
function ordersChanged() { for (const a of online.values()) if (a.career === 'rider' || [...orders.values()].some(o => o.cust === a)) markMe(a); }
function placeOrder(a, m) {
  const id = m.item, it = D.ITEMS[id];
  if (!it || !it.menu) return;
  if (!buildingOpen('restaurant')) return toast(a, 'ร้านอาหารปิดแล้ว (เปิด 07:00–23:00)', '🔒', false);
  if ([...orders.values()].filter(o => o.cust === a).length >= 2) return toast(a, 'สั่งได้ทีละไม่เกิน 2 ออเดอร์', '🛵', false);
  const fee = Math.round(deliveryFee(a.x, a.y) * (ev('hungry') ? 1.3 : 1)), tip = clamp(Math.floor(+m.tip) || 0, 0, 500);
  const total = it.base + fee + tip;
  if (!pay(a, total)) return;
  const o = { id: nextOrder++, cust: a, custName: a.name, item: id, price: it.base, fee, tip, state: 'open', t: now(), rider: null };
  orders.set(o.id, o); markMe(a);
  const rs = ridersOnline();
  rs.forEach(r => toast(r, `🛵 ออเดอร์ใหม่! ${it.icon}${it.name} ส่งให้ ${a.name} ค่าส่ง ${money(fee)}${tip ? ` + ทิป ${money(tip)}` : ''} (เปิดแอพไรเดอร์ใน 📱)`, '🔔'));
  toast(a, rs.length ? `สั่ง ${it.icon}${it.name} แล้ว ${money(total)} รอไรเดอร์รับออเดอร์ (มีไรเดอร์ออนไลน์ ${rs.length} คน)` : `สั่ง ${it.icon}${it.name} แล้ว ${money(total)} — ตอนนี้ไม่มีไรเดอร์ ร้านจะส่งเองแต่ช้ากว่า`, '🛵');
  ordersChanged();
}
function spawnNpcOrder() {
  const spots = [...D.STATIONS.filter(s => s.type === 'door' && s.house !== undefined), ...D.STATIONS.filter(s => s.type === 'seat')];
  const s = pick(spots), id = pick(MENU);
  const fee = Math.round(deliveryFee(s.x, s.y) * 1.2 * (ev('hungry') ? 1.3 : 1));
  const o = { id: nextOrder++, cust: null, custName: pick(D.NPC_NAMES), item: id, price: 0, fee, tip: rint(0, 3) ? 0 : rint(10, D.RIDER.tipMax),
    state: 'open', t: now(), rider: null, npc: { x: s.x, y: s.y + (s.type === 'door' ? .4 : 0), area: s.area } };
  orders.set(o.id, o); ordersChanged();
}
function cancelOrder(o, why) {
  orders.delete(o.id);
  if (o.cust) { o.cust.money += o.price + o.fee + o.tip; o.cust.sd = true; markMe(o.cust); toast(o.cust, `ออเดอร์ ${D.ITEMS[o.item].name} ถูกยกเลิก (${why}) คืนเงินแล้ว`, '↩️', false); }
  if (o.rider) toast(o.rider, `ออเดอร์ของ ${o.custName} ถูกยกเลิก (${why})`, '↩️', false);
  ordersChanged();
}
function finishOrder(o, rider) {
  orders.delete(o.id);
  if (o.cust) { addItem(o.cust, o.item, 1); markMe(o.cust); o.cust.sd = true; }
  if (rider) {
    const got = earn(rider, (o.fee * (1 + [0, .1, .2, .35][tier(rider, 'rider')]) + o.tip) * wellbeing(rider));
    addXp(rider); stat(rider, 'delivered'); quest(rider, 'deliver');
    toast(rider, `ส่งอาหารให้ ${o.custName} สำเร็จ! ได้ ${money(got)}${o.tip ? ` (รวมทิป ${money(o.tip)})` : ''}`, '🛵');
    if (o.cust) toast(o.cust, `${rider.name} มาส่ง ${D.ITEMS[o.item].icon}${D.ITEMS[o.item].name} แล้ว! (อยู่ในกระเป๋า 🎒)`, '🛵');
  } else if (o.cust) toast(o.cust, `ร้านมาส่ง ${D.ITEMS[o.item].icon}${D.ITEMS[o.item].name} แล้ว (อยู่ในกระเป๋า 🎒)`, '🛵');
  ordersChanged();
}
function riderAct(a, m) {
  const o = orders.get(+m.id);
  if (m.t === 'order_cancel') { if (o && o.cust === a && o.state === 'open') cancelOrder(o, 'ลูกค้ายกเลิก'); return; }
  if (!need(a, 'rider')) return;
  if (!o) return toast(a, 'ออเดอร์นี้ไม่มีแล้ว', '🛵', false);
  if (m.t === 'order_take') {
    if (o.state !== 'open') return toast(a, 'มีไรเดอร์คนอื่นรับไปแล้ว', '🛵', false);
    if (o.cust === a) return toast(a, 'รับออเดอร์ของตัวเองไม่ได้', '🛵', false);
    if ([...orders.values()].filter(x => x.rider === a).length >= 3) return toast(a, 'รับได้ทีละไม่เกิน 3 ออเดอร์', '🛵', false);
    if (!(a.vehicles || []).some(v => v === 'scooter' || v === 'car')) return toast(a, 'ต้องมีมอเตอร์ไซค์ก่อน (โชว์รูมรถ)', '🛵', false);
    o.state = 'taken'; o.rider = a; o.riderName = a.name; o.takenAt = now();
    if (o.cust) toast(o.cust, `${a.name} รับออเดอร์แล้ว กำลังไปรับอาหารที่ร้าน`, '🛵');
    toast(a, 'รับออเดอร์แล้ว! ไปรับอาหารที่เคาน์เตอร์ร้านอาหารก่อน', '🛵');
    return ordersChanged();
  }
  if (m.t === 'order_drop') { if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; ordersChanged(); } return; }
  if (m.t === 'order_deliver') {
    if (o.rider !== a || o.state !== 'picked') return toast(a, 'ยังไม่ได้รับอาหารจากร้าน', '🛵', false);
    const tgt = o.cust ? o.cust : o.npc, ok = tgt && areaId(a) === (o.cust ? areaId(o.cust) : o.npc.area) && Math.hypot(a.x - tgt.x, a.y - tgt.y) < 2.5;
    if (o.cust && !o.cust.ws) return cancelOrder(o, 'ลูกค้าออฟไลน์');
    if (!ok) return toast(a, `ต้องไปให้ถึงตัวลูกค้าก่อน (${o.custName})`, '📍', false);
    return finishOrder(o, a);
  }
}

// ------------------------------------------------------------------ NPC patients (so doctors always have work)
let npcPatientAt = now() + 30000, npcSeq = 1;
function spawnPatient() {
  const free = beds.map((b, i) => b ? -1 : i).filter(i => i >= 0);
  if (free.length < 2) return;
  const d = pick(Object.keys(DZ).filter(k => k !== 'insomnia'));
  beds[pick(free)] = { npc: true, id: 'npc' + npcSeq++, name: pick(D.NPC_NAMES), dz: [d], health: rint(35, 70), until: now() + 300000 };
  wdAt = 0;
  for (const a of online.values()) if (a.career === 'doctor') toast(a, `🛏️ มีคนไข้ใหม่มารอที่โรงพยาบาล`, '🩺');
}

// ------------------------------------------------------------------ knocked out
function knockOut(a) {
  a.cast = null; standUp(a);
  if (a.trade) tradeClose(a.trade, `${a.name} หมดสติ`);
  if (a.hunger <= 5) {               // starving: collapse right where you are
    a.down = { kind: 'veg', t: now() };
    toast(a, 'คุณหิวจนหมดแรง ล้มลงนอนเป็นผัก... รอสักพักร่างกายจะฟื้นขึ้นมาเอง', '🥬', false);
    feed(`🥬 ${a.name} หิวจนล้มลงข้างทาง`);
  } else {                           // otherwise an ambulance takes you to hospital
    a.down = { kind: 'hosp', t: now() };
    let i = beds.findIndex(b => !b);
    if (i < 0) i = beds.findIndex(b => b && b.npc);
    if (i >= 0) { beds[i] = a; a.bed = i; const s = ST['bed' + i]; place(a, s.x, s.y, true); }
    else { const r = ROOM.r_hospital; place(a, r.x + 5, r.y + 6, true); }
    const docs = [...online.values()].filter(o => o.career === 'doctor' && o !== a && !o.down);
    toast(a, `คุณหมดสติ! รถพยาบาลพามาส่งโรงพยาบาล ทำอะไรไม่ได้จนกว่าหมอจะช่วย${docs.length ? ` (หมอออนไลน์ ${docs.length} คน)` : ' (ไม่มีหมอออนไลน์ เจ้าหน้าที่จะช่วยในไม่ช้า แต่ค่ารักษาแพง)'}`, '🚑', false);
    feed(`🚑 ${a.name} หมดสติถูกส่งโรงพยาบาล`);
    for (const d of docs) toast(d, `🚑 ${a.name} หมดสติอยู่ที่โรงพยาบาล รีบไปช่วยด่วน!`, '🚨');
    wdAt = 0;
  }
  markMe(a); sendRoster();
}
function revive(a, hp, by) {
  a.down = null; a.health = Math.max(a.health, hp);
  if (a.hunger < 15) a.hunger = 15;
  markMe(a); sendRoster();
  toast(a, by ? `${by} ช่วยให้คุณฟื้นแล้ว` : 'คุณฟื้นขึ้นมาแล้ว รีบหาอะไรกินและดูแลสุขภาพด้วย', '💓');
}

// ------------------------------------------------------------------ office work (shift 08:00–17:00, sit at a desk)
function officeTick(a, t, h, dt) {
  const day = D.dayAt(t), o = a.office || (a.office = { strikes: 0, day: -1, late: false, pend: 0, hours: 0, closed: -1, absent: -1 });
  const seated = a.chair >= 0;
  if (seated && h >= D.SHIFT.start - 1 && h < D.SHIFT.end && o.day !== day) {
    o.day = day; o.late = h > D.SHIFT.grace; o.pend = 0; o.hours = 0;
    if (o.late) {
      o.strikes++;
      toast(a, `มาสาย! (${hhmm(h)}) ค่าแรงวันนี้ลด 30% · ถูกบันทึกมาสาย ${o.strikes} ครั้ง${o.strikes >= 2 ? ' ⚠️ ระวังถูกเลิกจ้าง' : ''}`, '⏰', false);
      if (fireCheck(a)) return;
    } else {
      o.strikes = Math.max(0, o.strikes - 1); stat(a, 'ontime');
      toast(a, `ลงเวลาเข้างาน ${hhmm(h)} ตรงเวลา 👍 นั่งทำงานไปจนถึง 17:00`, '🕗');
    }
  }
  if (seated && o.day === day && h >= D.SHIFT.start && h < D.SHIFT.end) {
    const l = Math.min(lvl(a, 'office'), D.OFFICE_WAGE.length);
    const gh = dt / 60;                                   // game hours (1 game hour = 60 s)
    o.pend += D.OFFICE_WAGE[l - 1] * gh * (o.late ? 0.7 : 1) * wellbeing(a) * (1 + [0, .1, .2, .3][tier(a, 'office')]);
    o.hours += gh;
    a.energy = Math.max(0, a.energy - 0.06 * dt);
    if (a.energy <= 1) { toast(a, 'หมดแรง! ลุกไปพักกินอะไรก่อน', '😵', false); infect(a, 'exhaust', 0.3); standUp(a); }
    if (o.pend >= D.OFFICE_WAGE[l - 1]) { earn(a, o.pend); o.pend = 0; quest(a, 'work'); }
  }
  if (o.day === day && h >= D.SHIFT.end && o.closed !== day) {
    o.closed = day;
    if (o.pend > 0) { earn(a, o.pend); o.pend = 0; }
    const before = lvl(a, 'office');
    if (o.hours >= 4) { addXp(a); stat(a, 'shifts'); }
    let msg = `เลิกงานแล้ว! วันนี้ทำงาน ${o.hours.toFixed(1)} ชม.`;
    if (lvl(a, 'office') > before && lvl(a, 'office') <= D.OFFICE_TITLES.length) {
      msg += ` 🎊 เลื่อนเป็น${D.OFFICE_TITLES[lvl(a, 'office') - 1]}`; stat(a, 'promo');
      feed(`🎊 ${a.name} ได้เลื่อนตำแหน่งเป็น${D.OFFICE_TITLES[lvl(a, 'office') - 1]}`);
    }
    toast(a, msg + ' · ไฟในออฟฟิศปิดแล้ว ตึกปิด 21:00', '🏢');
    if (a.chair >= 0) standUp(a);
  }
  // online during the shift but never showed up -> absent
  if (h >= 12 && h < D.SHIFT.end && o.day !== day && o.absent !== day && (now() - (a.loginAt || 0)) > 4 * 60000) {
    o.absent = day; o.strikes++;
    toast(a, `วันนี้คุณขาดงาน! (ต้องเข้างานก่อน 08:15 และนั่งที่โต๊ะทำงาน) ถูกบันทึก ${o.strikes} ครั้ง`, '📋', false);
    fireCheck(a);
  }
}
function fireCheck(a) {
  const o = a.office;
  if (o.strikes < 3 || Math.random() > 0.25 + 0.15 * (o.strikes - 3)) return false;
  standUp(a);
  a.career = 'none'; a.xp.office = 0; a.office = null; markMe(a); sendRoster();
  toast(a, 'คุณถูกเลิกจ้างเพราะมาสาย/ขาดงานบ่อย! ต้องไปสมัครงานใหม่ และเงินเดือนจะเริ่มนับใหม่', '📦', false);
  feed(`📦 ${a.name} ถูกบริษัทเลิกจ้าง`);
  return true;
}

// ------------------------------------------------------------------ careers
function jobCooldown(a) {
  const t = now(), recent = (a.jobChanges || []).filter(x => t - x < 86400e3);
  if (!recent.length) return 0;
  const mins = D.JOB_COOLDOWN_MIN[Math.min(recent.length, D.JOB_COOLDOWN_MIN.length - 1)];
  return Math.max(0, Math.max(...recent) + mins * 60000 - t);
}
function apply(a, career) {
  const c = D.CAREERS[career]; if (!c || career === 'none') return;
  if (a.career === career) return toast(a, `คุณเป็น${c.name}อยู่แล้ว`, 'ℹ️', false);
  for (const l of c.need || []) if (!a.licenses.includes(l)) return toast(a, `ต้องมี${D.LICENSES[l].name}ก่อน (${l === 'driving' ? 'สอบที่โชว์รูมรถ' : 'ที่มหาวิทยาลัย'})`, '🎓', false);
  if (c.vehicle && !(a.vehicles || []).some(v => v === c.vehicle || v === 'car')) return toast(a, `ต้องมี${D.VEHICLES[c.vehicle].name}ก่อน (โชว์รูมรถ)`, '🛵', false);
  const wait = jobCooldown(a);
  if (wait > 0) return toast(a, `เพิ่งเปลี่ยนงานไป ต้องรออีก ${Math.ceil(wait / 60000)} นาทีถึงจะสมัครงานใหม่ได้ (ยิ่งเปลี่ยนบ่อย ยิ่งรอนาน)`, '⏳', false);
  if (a.career === 'office') { a.xp.office = 0; a.office = null; }
  if (a.career !== 'none' || (a.jobChanges || []).length) a.jobChanges = [...(a.jobChanges || []).filter(x => now() - x < 86400e3), now()];
  else a.jobChanges = [now() - 86400e3 + 1000];             // the very first job does not count against you
  standUp(a); a.career = career; a.cast = null; markMe(a); sendRoster();
  feed(`💼 ${a.name} ได้งานเป็น${c.name}`);
  const tips = {
    office: 'เข้างาน 08:00 (สายได้ไม่เกิน 08:15) นั่งที่โต๊ะทำงานว่างตัวไหนก็ได้ ได้ค่าแรงตามชั่วโมงที่นั่ง เลิก 17:00',
    farmer: 'ซื้อสวนของตัวเองได้ที่ป้ายหน้าแปลงในไร่ แล้วเริ่มปลูกได้เลย',
    fisher: 'ตกปลาได้ที่ท่าตกปลาทุกแห่ง แม่น้ำ ทะเลสาบ ทะเล ได้ปลาต่างกัน', merchant: 'ซื้อของจากคลังสินค้าราคาส่ง แล้ววางขายที่ตลาดกลาง',
    chef: 'ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง แล้วมาปรุงที่ครัวใหญ่', doctor: 'เดินไปที่เตียงคนไข้ในโรงพยาบาล วินิจฉัยจากอาการแล้วรักษา',
    rider: 'เปิดแอพไรเดอร์ในมือถือ 📱 รับออเดอร์ ไปรับอาหารที่ร้านอาหาร แล้วไปส่งลูกค้า',
  };
  toast(a, `ยินดีด้วย! ได้งานเป็น ${c.icon} ${c.name} · ${tips[career]}`, c.icon);
}
function resign(a) {
  if (a.career === 'none') return;
  const c = D.CAREERS[a.career];
  if (a.career === 'office') { a.xp.office = 0; a.office = null; }
  standUp(a); a.career = 'none'; a.cast = null; markMe(a); sendRoster();
  for (const o of orders.values()) if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; }
  toast(a, `ลาออกจากงาน${c.name}แล้ว`, '📦');
}

// ------------------------------------------------------------------ fishing
function rollFish(a, pool) {
  const l = lvl(a, 'fisher'), T = tier(a, 'fisher');
  const table = D.FISH[pool] || D.FISH.lake;
  const ws = table.map(([id, w]) => {
    if (id === null) w = Math.max(5, w - l) * [1, .6, .35, .15][T];
    if (D.BIG_FISH.includes(id)) w *= [1, 1.3, 1.7, 2.2][T] * (ev('bloom') ? 2 : 1);
    return w;
  });
  let r = Math.random() * ws.reduce((s, v) => s + v, 0);
  for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return table[i][0]; }
  return 'sfish';
}

// ------------------------------------------------------------------ station actions
function act(a, m) {
  const s = ST[m.st];
  if (!s) return;
  if (a.down) return toast(a, 'คุณหมดสติอยู่ ทำอะไรไม่ได้', '💤', false);
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 0.9) return toast(a, 'อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน', '⚠️', false);
  const h = hourNow();
  if (!D.isOpen(s.type, h)) { const o = D.HOURS[s.type]; return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
  const key = (s.type === 'door' && s.house !== undefined ? 'house' : s.type) + '.' + m.a;
  const wb = wellbeing(a);
  if (m.a === 'apply') { if (D.CAREERS[m.career]?.where !== s.type) return; return apply(a, m.career); }
  switch (key) {
    // ---------------- getting around
    case 'gate.go': {
      const g = D.GATES[s.to]; if (!g || !cd(a, 'door', 1200, true)) return;
      return teleport(a, g.x, g.y);
    }
    case 'seat.sit': {
      for (const o of online.values()) if (o !== a && o.seat === s.id) return toast(a, 'ที่นั่งนี้มีคนนั่งแล้ว', '🪑', false);
      standUp(a); a.pose = 'seat'; a.seat = s.id; place(a, s.x, s.y); quest(a, 'sit'); sendRoster();
      return toast(a, 'นั่งพักที่โต๊ะ พลังงานฟื้นเร็วขึ้น คุยกับคนรอบๆ ได้ (เดินเพื่อลุก)', '🪑');
    }
    // ---------------- office
    case 'chair.sit': {
      if (!need(a, 'office')) return;
      if (chairs[s.idx] && chairs[s.idx] !== a) return toast(a, 'โต๊ะนี้มีคนนั่งแล้ว', '💺', false);
      if (h >= D.SHIFT.end || h < D.SHIFT.start - 1) return toast(a, `ตอนนี้ไม่ใช่เวลางาน (เข้างาน ${hhmm(D.SHIFT.start)}–${hhmm(D.SHIFT.end)})`, '🕗', false);
      if (a.office?.closed === D.dayAt(now())) return toast(a, 'วันนี้เลิกงานแล้ว พรุ่งนี้ค่อยมาใหม่', '🏢', false);
      standUp(a); chairs[s.idx] = a; a.chair = s.idx; a.pose = 'chair'; place(a, s.x, s.y); sendRoster(); markMe(a);
      return toast(a, h < D.SHIFT.start ? 'นั่งรอเข้างาน 08:00 เมื่อถึงเวลาจะเริ่มนับชั่วโมงอัตโนมัติ' : 'นั่งทำงานแล้ว ได้ค่าแรงทุกชั่วโมงที่นั่ง (เดินเพื่อลุก)', '💺');
    }
    case 'office.resign': return resign(a);
    // ---------------- market
    case 'market.list': {
      const id = m.item, it = D.ITEMS[id];
      const q = Math.floor(+m.qty), price = Math.floor(+m.price);
      if (!it || !(q > 0) || !(price > 0)) return toast(a, 'ใส่จำนวนและราคาให้ถูกต้อง', '⚠️', false);
      if ((a.inv[id] || 0) < q) return toast(a, 'มีของไม่พอ', '⚠️', false);
      if (price > it.base * 5) return toast(a, `ตั้งราคาได้ไม่เกิน ${money(it.base * 5)} ต่อชิ้น`, '⚠️', false);
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
    case 'market.buy': {
      const id = m.item, it = D.ITEMS[id]; if (!it) return;
      let want = clamp(Math.floor(+m.qty) || 1, 1, 50), bought = 0, spent = 0;
      const soldBy = new Map(), offers = [];
      for (const o of accounts.values()) if (o !== a) for (const L of o.listings || []) if (L.item === id) offers.push([L, o]);
      offers.sort((x, y) => x[0].price - y[0].price);
      if (!offers.length) return toast(a, 'ตอนนี้ไม่มีผู้เล่นวางขายของชิ้นนี้', '🏪', false);
      for (const [L, o] of offers) {
        while (want > 0 && L.qty > 0 && a.money >= L.price) {
          a.money -= L.price; L.qty--; want--; bought++; spent += L.price; soldBy.set(o, (soldBy.get(o) || 0) + 1);
          credit(o, Math.floor(L.price * 0.95));                     // 5% market fee
        }
        if (L.qty <= 0) o.listings = o.listings.filter(x => x !== L);
        if (want <= 0 || a.money < L.price) break;
      }
      for (const [o, n] of soldBy) { stat(o, 'psold', n); if (o.ws) { quest(o, 'sell', n); toast(o, `${a.name} ซื้อ ${it.icon}${it.name} ของคุณ ${n} ชิ้น`, '💰'); } }
      if (!bought) return toast(a, 'เงินไม่พอ', '💸', false);
      addItem(a, id, bought); markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${it.icon}${it.name} x${bought} จากผู้เล่น รวม ${money(spent)}`, '🛍️');
    }
    case 'market.npcbuy': {
      const id = m.item, it = D.ITEMS[id]; if (!it || it.kind === 'fish' && it.base >= 1000 || it.menu) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), unit = npcSellPrice(id);
      if (!pay(a, unit * q)) return;
      addItem(a, id, q); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} จากร้าน NPC ${money(unit * q)} (แพงกว่าซื้อจากผู้เล่น)`, '🏪');
    }
    case 'market.sell': case 'farmbuy.sell': case 'fishclub.sell': {
      const id = m.item, it = D.ITEMS[id];
      if (s.type === 'farmbuy' && it?.kind !== 'crop') return toast(a, 'จุดนี้รับซื้อเฉพาะพืชผล', '⚖️', false);
      if (s.type === 'fishclub' && it?.kind !== 'fish') return toast(a, 'สมาคมรับซื้อเฉพาะปลา', '🎣', false);
      const have = a.inv[id] || 0;
      let q = m.qty === 'all' ? have : Math.floor(+m.qty);
      if (!it || !(q > 0)) return toast(a, 'ไม่มีของชิ้นนี้', '⚠️', false);
      q = Math.min(q, have, 500);
      if (q <= 0) return toast(a, 'ไม่มีของชิ้นนี้', '⚠️', false);
      if (!cd(a, 'sell', 300)) return;
      const rate = s.type === 'market' ? NPC_BUY : 0.45;
      let total = 0;
      for (let i = 0; i < q; i++) { total += npcBuyPrice(a, id, rate); market[id].mult = Math.max(0.4, market[id].mult * 0.985); }
      addItem(a, id, -q);
      const got = earn(a, total); quest(a, 'sell', q);
      return toast(a, `ขาย ${it.icon}${it.name} x${q} ให้ NPC ได้ ${money(got)} (วางขายให้ผู้เล่นที่ตลาดกลางได้ราคาดีกว่ามาก)`, '💰');
    }
    // ---------------- merchant
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
      stock[id] -= q; addItem(a, id, q); addXp(a, 0.5); markMe(a); quest(a, 'buy', q); stat(a, 'wholesale', q);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคาส่ง ${money(unit * q)}`, '📦');
    }
    // ---------------- food
    case 'restaurant.eat': {
      const it = D.ITEMS[m.item]; if (!it || !it.menu) return;
      if (!cd(a, 'eat', 4000)) return;
      if (!pay(a, it.base)) { a.cd.eat = 0; return; }
      a.hunger = Math.min(100, a.hunger + it.eat.hunger); a.energy = Math.min(100, a.energy + (it.eat.energy || 0));
      if (it.base < 100) infect(a, 'poison', 0.03);
      markMe(a); quest(a, 'eat');
      return toast(a, `กิน${it.name} อิ่ม +${it.eat.hunger}`, it.icon);
    }
    case 'restaurant.pickup': {
      if (!need(a, 'rider')) return;
      const mine = [...orders.values()].filter(o => o.rider === a && o.state === 'taken');
      if (!mine.length) return toast(a, 'ไม่มีออเดอร์ที่ต้องรับ (รับออเดอร์ในแอพไรเดอร์ 📱 ก่อน)', '🛵', false);
      mine.forEach(o => { o.state = 'picked'; if (o.cust) toast(o.cust, `${a.name} รับอาหารแล้ว กำลังไปส่ง`, '🛵'); });
      ordersChanged();
      return toast(a, `รับอาหาร ${mine.length} ออเดอร์แล้ว! ไปส่งให้ลูกค้า (ดูทางในแอพ)`, '🥡');
    }
    case 'kitchen.cook': {
      if (!need(a, 'chef')) return;
      const r = D.RECIPES.find(x => x.id === m.rid); if (!r) return;
      for (const [k, q] of Object.entries(r.in)) if ((a.inv[k] || 0) < q) return toast(a, 'วัตถุดิบไม่พอ', '🥬', false);
      if (!cd(a, 'cook', 1500) || !spend(a, 12)) return;
      for (const [k, q] of Object.entries(r.in)) addItem(a, k, -q);
      const extra = Math.random() < 0.2 * tier(a, 'chef') ? 1 : 0;
      addItem(a, r.id, 1 + extra); addXp(a); markMe(a); quest(a, 'cook'); stat(a, 'cooked', 1 + extra);
      if (Math.random() < 0.02) infect(a, 'injury');
      return toast(a, `ปรุง ${D.ITEMS[r.id].icon}${D.ITEMS[r.id].name} สำเร็จ${extra ? ' — ฝีมือดี ได้เพิ่มอีก 1 จาน!' : ''}`, '🍳');
    }
    case 'kitchen.buy': {
      if (!need(a, 'chef')) return;
      const id = m.item, it = D.ITEMS[id];
      if (!it || !D.RECIPES.some(r => id in r.in)) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), cost = npcSellPrice(id) * q;
      if (!pay(a, cost)) return;
      addItem(a, id, q); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคา ${money(cost)} (แพงกว่าซื้อจากผู้เล่นมาก)`, '🛒');
    }
    // ---------------- shops
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
      if (v.license && !a.licenses.includes(v.license)) return toast(a, `ต้องสอบใบขับขี่ก่อนถึงจะซื้อ${v.name}ได้`, '🪪', false);
      if (!pay(a, v.price)) return;
      a.vehicles = [...a.vehicles, m.veh]; markMe(a); sendRoster();
      if (v.price >= 18000) feed(`${v.icon} ${a.name} ถอย${v.name}ป้ายแดง!`);
      return toast(a, `ได้ ${v.icon}${v.name} แล้ว! เดินทางเร็วขึ้น x${speedOf(a)}`, v.icon);
    }
    case 'dealer.test': {
      if (a.licenses.includes('driving')) return toast(a, 'คุณมีใบขับขี่แล้ว', 'ℹ️', false);
      if (!cd(a, 'dtest', 20000)) return;
      if (!pay(a, D.LICENSES.driving.price)) { a.cd.dtest = 0; return; }
      const qs = [...D.DRIVING_TEST].sort(() => Math.random() - .5).slice(0, 3);
      a.dtest = qs; markMe(a);
      return send(a, { t: 'dtest', qs: qs.map(q => ({ q: q.q, a: q.a })) });
    }
    case 'dealer.answer': {
      const qs = a.dtest; if (!qs) return;
      a.dtest = null;
      const ans = Array.isArray(m.ans) ? m.ans : [];
      const right = qs.filter((q, i) => +ans[i] === q.ok).length;
      if (right < qs.length) return toast(a, `สอบไม่ผ่าน ตอบถูก ${right}/${qs.length} ข้อ ต้องจ่ายค่าสอบใหม่`, '❌', false);
      a.licenses = [...a.licenses, 'driving']; markMe(a);
      return toast(a, 'สอบใบขับขี่ผ่าน! ซื้อมอเตอร์ไซค์/รถยนต์ได้แล้ว และสมัครไรเดอร์ได้', '🪪');
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
    // ---------------- university
    case 'school.enroll': {
      if (a.licenses.includes('degree')) return toast(a, 'คุณจบปริญญาตรีแล้ว', 'ℹ️', false);
      if (a.enrolled) return toast(a, 'คุณลงทะเบียนเรียนแล้ว กด "เข้าเรียน" ได้เลย', 'ℹ️', false);
      if (!pay(a, D.LICENSES.degree.price)) return;
      a.enrolled = true; a.classes = 0; markMe(a);
      return toast(a, `ลงทะเบียนเรียนปริญญาตรีแล้ว! ต้องเข้าเรียน ${D.LICENSES.degree.classes} คาบ (คาบละ 1 ชั่วโมงในเกม)`, '🎓');
    }
    case 'school.class': {
      if (!a.enrolled) return toast(a, 'ต้องลงทะเบียนเรียนก่อน', '🎓', false);
      if (!cd(a, 'class', 60000) || !spend(a, 15)) return;
      a.classes = (a.classes || 0) + 1; markMe(a);
      if (a.classes >= D.LICENSES.degree.classes) {
        a.enrolled = false; a.licenses = [...a.licenses, 'degree']; stat(a, 'degree', 1, true);
        feed(`🎓 ${a.name} เรียนจบปริญญาตรีแล้ว!`);
        return toast(a, 'ยินดีด้วย! เรียนจบปริญญาตรีแล้ว สมัครงานบริษัทได้ และเรียนต่อหมอได้', '🎓');
      }
      return toast(a, `เข้าเรียนคาบที่ ${a.classes}/${D.LICENSES.degree.classes} แล้ว (คาบถัดไปอีก 1 ชั่วโมงในเกม)`, '📖');
    }
    case 'school.learn': {
      const l = D.LICENSES[m.lic]; if (!l || m.lic === 'degree' || l.where !== 'school') return;
      if (a.licenses.includes(m.lic)) return toast(a, 'คุณมีใบนี้แล้ว', 'ℹ️', false);
      if (l.need && !a.licenses.includes(l.need)) return toast(a, `ต้องจบ${D.LICENSES[l.need].name}ก่อน`, '🎓', false);
      if (!pay(a, l.price)) return;
      a.licenses = [...a.licenses, m.lic]; markMe(a);
      return toast(a, `ได้รับ ${l.name} แล้ว! ไปสมัครงานได้เลย`, '🎓');
    }
    // ---------------- hospital
    case 'hospital.heal': {
      if (a.health >= 98 && !(a.dz || []).length) return toast(a, 'คุณสุขภาพดีอยู่แล้ว', 'ℹ️', false);
      const price = (a.dz || []).length ? 1500 + 500 * (a.dz.length - 1) : 800;
      if (!pay(a, price)) return;
      a.health = Math.min(100, a.health + 40); for (const d of [...(a.dz || [])]) cure(a, d); markMe(a);
      return toast(a, `พยาบาล NPC รักษา ${money(price)} — หายป่วยแล้ว (นอนรอหมอผู้เล่นที่เตียงถูกกว่ามาก)`, '🏥');
    }
    case 'bed.lie': {
      if (beds[s.idx] && beds[s.idx] !== a) return toast(a, 'เตียงนี้มีคนนอนอยู่แล้ว', '🛏️', false);
      if (a.career === 'doctor' && !(a.dz || []).length) return toast(a, 'คุณเป็นหมอ เดินไปที่เตียงที่มีคนไข้แล้วรักษาได้เลย', 'ℹ️', false);
      standUp(a); beds[s.idx] = a; a.bed = s.idx; a.pose = 'bed'; place(a, s.x, s.y);
      sendRoster(); wdAt = 0; markMe(a);
      const docs = [...online.values()].filter(o => o.career === 'doctor' && o !== a);
      for (const d of docs) toast(d, `🛏️ ${a.name} นอนรอหมออยู่ที่โรงพยาบาล เตียง ${s.idx + 1}`, '🩺');
      return toast(a, docs.length ? `นอนรอหมอแล้ว (หมอออนไลน์ ${docs.length} คน) ค่ารักษาประมาณ ฿300` : 'นอนรอหมอแล้ว แต่ตอนนี้ไม่มีหมอออนไลน์ อาจต้องไปที่เคาน์เตอร์ (แพงกว่า)', '🛏️');
    }
    case 'bed.revive': case 'bed.treat': {
      if (!need(a, 'doctor')) return;
      const pt = beds[s.idx];
      if (!pt || pt === a) return toast(a, 'เตียงนี้ยังไม่มีคนไข้', '🛏️', false);
      if (!cd(a, 'treat', 1500) || !spend(a, 8)) return;
      const boost = (1 + BOOST[tier(a, 'doctor')]) * (1 + 0.04 * (lvl(a, 'doctor') - 1)) * wb;
      if (m.a === 'revive') {
        if (!pt.down) return toast(a, 'คนไข้รู้สึกตัวดีอยู่แล้ว', 'ℹ️', false);
        const fee = Math.min(400, Math.floor(pt.money)); pt.money -= fee;
        const got = earn(a, (fee + 200) * boost); revive(pt, 35, `หมอ${a.name}`); addXp(a, 2); stat(a, 'revived');
        feed(`💓 หมอ${a.name} ช่วยชีวิต ${pt.name} สำเร็จ`);
        return toast(a, `ช่วยให้ ${pt.name} ฟื้นแล้ว ได้ ${money(got)} · ต่อไปวินิจฉัยโรคที่ป่วยอยู่`, '💓');
      }
      if (pt.down) return toast(a, 'คนไข้หมดสติอยู่ ต้องช่วยให้ฟื้นก่อน', '💓', false);
      const target = (pt.dz || [])[0];
      if (!target) {                                    // check-up only
        let fee = 120;
        if (!pt.npc) { const f = Math.min(150, Math.floor(pt.money)); pt.money -= f; fee = f + 80; markMe(pt); toast(pt, `หมอ${a.name}ตรวจร่างกายให้ สุขภาพ +25`, '🩺'); }
        pt.health = Math.min(100, pt.health + 25);
        const got = earn(a, fee * boost); addXp(a);
        if (pt.npc) beds[s.idx] = null; wdAt = 0;
        return toast(a, `ตรวจร่างกาย ${pt.name} เรียบร้อย ได้ ${money(got)}`, '🩺');
      }
      if (DZ[target].cure !== m.tx) {
        pt.health = Math.max(1, pt.health - 5); if (!pt.npc) { markMe(pt); toast(pt, `หมอ${a.name}วินิจฉัยผิด! อาการยังไม่ดีขึ้น (สุขภาพ -5)`, '😣', false); }
        wdAt = 0;
        return toast(a, 'วินิจฉัยผิด! คนไข้ไม่ได้เป็นโรคที่รักษานี้ ลองดูอาการอีกครั้ง', '❌', false);
      }
      let fee = 260;
      if (pt.npc) pt.dz = pt.dz.filter(x => x !== target);
      else { cure(pt, target); const f = Math.min(300, Math.floor(pt.money)); pt.money -= f; fee = f + 120; markMe(pt); toast(pt, `หมอ${a.name}รักษา${DZ[target].name}หายแล้ว! (ค่ารักษา ${money(f)})`, '💉'); }
      pt.health = Math.min(100, pt.health + 20);
      const got = earn(a, fee * boost); addXp(a, 2); quest(a, 'treat'); stat(a, 'treated');
      if (!pt.dz.length) { if (pt.npc) beds[s.idx] = null; else standUp(pt); }
      wdAt = 0;
      if (!pt.npc) feed(`🩺 หมอ${a.name} รักษา${DZ[target].name}ให้ ${pt.name} สำเร็จ`);
      return toast(a, `วินิจฉัยถูกต้อง! รักษา${DZ[target].name}หาย ได้ ${money(got)}`, '💉');
    }
    // ---------------- fishing
    case 'fishclub.info': return;
    case 'pier.cast': {
      if (!need(a, 'fisher')) return;
      if (a.cast) return;
      if (!spend(a, 8)) return;
      const bite = now() + rnd(2500, 7000);
      a.cast = { state: 'wait', bite, expire: bite + 1700, st: s.id }; markMe(a);
      return;
    }
    case 'pier.reel': {
      if (!a.cast) return;
      if (a.cast.state === 'wait') { a.cast = null; markMe(a); return toast(a, 'ดึงเร็วเกินไป ปลาตกใจหนีไปแล้ว', '💨', false); }
      a.cast = null;
      const id = rollFish(a, s.pool); addXp(a);
      infect(a, 'injury', 0.02);
      if (ev('rain')) infect(a, 'cold', 0.03);
      if (!id) { markMe(a); return toast(a, 'ได้ขยะ 🥫 ... ไม่มีราคา', '🥫', false); }
      addItem(a, id, 1); markMe(a); quest(a, 'fish'); stat(a, 'fish');
      if (id === 'shark') stat(a, 'shark'); if (id === 'chest') stat(a, 'chest');
      const it = D.ITEMS[id];
      if (it.base >= 1000) feed(`${it.icon} ${a.name} ตกได้ ${it.name}!!`);
      return toast(a, `ได้ ${it.icon}${it.name} (~${money(it.base)})`, it.icon);
    }
    // ---------------- gardens
    case 'lot.buy': {
      if (!need(a, 'farmer')) return;
      if (lots[s.lot]) return toast(a, `สวนนี้เป็นของ ${lots[s.lot].name} แล้ว`, '🪧', false);
      if (a.garden) return toast(a, 'คุณมีสวนแล้ว (ขายสวนเดิมก่อนถึงจะซื้อใหม่ได้)', '🪧', false);
      if (!pay(a, D.GARDEN.lotPrice)) return;
      a.garden = { lot: s.lot, n: D.GARDEN.startPlots, crops: new Array(D.GARDEN.maxPlots).fill(null) };
      lots[s.lot] = a; markMe(a); wdAt = 0; stat(a, 'plots', a.garden.n, true);
      feed(`🌾 ${a.name} ซื้อสวนแปลงที่ ${s.lot + 1} ที่ไร่ชานเมือง`);
      return toast(a, `ได้สวนแล้ว! มี ${a.garden.n} แปลงปลูก ขยายเพิ่มได้ที่ป้ายนี้`, '🌾');
    }
    case 'lot.expand': {
      const g = a.garden; if (!g || g.lot !== s.lot) return toast(a, 'นี่ไม่ใช่สวนของคุณ', '🔒', false);
      if (g.n >= D.GARDEN.maxPlots) return toast(a, 'สวนของคุณขยายเต็มแล้ว', 'ℹ️', false);
      if (!pay(a, D.GARDEN.expand[g.n])) return;
      g.n++; markMe(a); wdAt = 0; stat(a, 'plots', g.n, true);
      return toast(a, `ขยายสวนแล้ว ตอนนี้มี ${g.n} แปลง`, '🌱');
    }
    case 'lot.sell': {
      const g = a.garden; if (!g || g.lot !== s.lot) return toast(a, 'นี่ไม่ใช่สวนของคุณ', '🔒', false);
      const back = Math.round((D.GARDEN.lotPrice + D.GARDEN.expand.slice(0, g.n).reduce((x, y) => x + y, 0)) * 0.6);
      lots[g.lot] = null; a.garden = null; a.money += back; markMe(a); wdAt = 0;
      return toast(a, `ขายสวนคืนสหกรณ์ได้ ${money(back)}`, '🪧');
    }
    case 'gplot.plant': {
      if (!need(a, 'farmer')) return;
      const g = a.garden; if (!g || g.lot !== s.lot) return toast(a, lots[s.lot] ? `สวนของ ${lots[s.lot].name}` : 'สวนนี้ยังไม่มีเจ้าของ ซื้อได้ที่ป้ายหน้าสวน', '🔒', false);
      if (s.n >= g.n) return toast(a, 'แปลงนี้ยังไม่ได้ขยาย (ขยายที่ป้ายหน้าสวน)', '🔒', false);
      const c = D.CROPS[m.crop]; if (!c) return;
      if (g.crops[s.n]) return toast(a, 'แปลงนี้ปลูกอยู่แล้ว', '⚠️', false);
      if (!pay(a, c.seed)) return;
      if (!spend(a, 5)) { a.money += c.seed; return; }
      const f = (ev('rain') ? 0.5 : ev('drought') ? 1.6 : 1) * (1 - 0.15 * tier(a, 'farmer'));
      g.crops[s.n] = [m.crop, now() + c.grow * 1000 * f, false];
      markMe(a); wdAt = 0;
      if (ev('rain')) infect(a, 'cold', 0.02);
      return toast(a, `ปลูก${D.ITEMS[m.crop].name}แล้ว`, '🌱');
    }
    case 'gplot.harvest': {
      if (!need(a, 'farmer')) return;
      const g = a.garden; if (!g || g.lot !== s.lot) return toast(a, 'นี่ไม่ใช่สวนของคุณ', '🔒', false);
      const p = g.crops[s.n];
      if (!p) return toast(a, 'แปลงว่าง', '⚠️', false);
      if (p[1] > now()) return toast(a, 'พืชยังไม่โต', '🌱', false);
      if (!spend(a, 6)) return;
      const c = D.CROPS[p[0]];
      const n = rint(c.min, c.max) + Math.floor(lvl(a) / 3) + tier(a, 'farmer');
      addItem(a, p[0], n); g.crops[s.n] = null; addXp(a); markMe(a); quest(a, 'harvest'); stat(a, 'harvest'); wdAt = 0;
      if (p[0] === 'durian') stat(a, 'durian');
      infect(a, 'injury', 0.015);
      return toast(a, `เก็บเกี่ยว ${D.ITEMS[p[0]].icon}${D.ITEMS[p[0]].name} ได้ ${n} หน่วย`, '🧺');
    }
    // ---------------- houses
    case 'house.buy': {
      const i = s.house, o = houses[i];
      if (o === a) return toast(a, 'บ้านหลังนี้เป็นของคุณแล้ว', 'ℹ️', false);
      if (a.house >= 0) return toast(a, 'คุณมีบ้านแล้ว (ขายหลังเดิมก่อน)', '🏠', false);
      if (tenants[i] && tenants[i] !== a) return toast(a, 'บ้านหลังนี้มีคนเช่าอยู่', '🏠', false);
      if (o && !o.houseSale) return toast(a, `บ้านของ ${o.name} ไม่ได้ประกาศขาย`, '🏠', false);
      const price = o ? o.houseSale : D.HOUSE_PRICES[i];
      if (!pay(a, price)) return;
      if (o) { credit(o, price); o.house = -1; o.furniture = []; o.houseSale = 0; o.houseRent = 0; if (o.ws) toast(o, `${a.name} ซื้อบ้านของคุณแล้ว ได้ ${money(price)}`, '🏠'); }
      if (tenants[i] === a) { tenants[i] = null; a.rent = null; }
      houses[i] = a; a.house = i; a.furniture = []; a.houseSale = 0; a.houseRent = 0; markMe(a); wdAt = 0;
      feed(`🏠 ${a.name} ซื้อบ้านหลังใหม่ในหมู่บ้านจัดสรร!`);
      return toast(a, 'ยินดีด้วย! ได้บ้านแล้ว แต่งบ้านเพื่อเพิ่มความสบาย และนอนที่นี่ได้', '🏠');
    }
    case 'house.rent': {
      const i = s.house, o = houses[i], days = [1, 3, 7].includes(+m.days) ? +m.days : 1;
      if (o === a) return toast(a, 'นี่บ้านของคุณเอง', 'ℹ️', false);
      if (a.house >= 0) return toast(a, 'คุณมีบ้านอยู่แล้ว', 'ℹ️', false);
      if (tenants[i] && tenants[i] !== a) return toast(a, `${tenants[i].name} เช่าอยู่`, '🏠', false);
      if (a.rent && a.rent.idx !== i) return toast(a, 'คุณเช่าบ้านหลังอื่นอยู่', '🏠', false);
      if (o && !o.houseRent) return toast(a, `${o.name} ไม่ได้ปล่อยเช่า`, '🏠', false);
      const perDay = o ? o.houseRent : D.HOUSE_RENT[i], cost = perDay * days;
      if (!pay(a, cost)) return;
      if (o) { credit(o, cost); if (o.ws) toast(o, `${a.name} เช่าบ้านของคุณ ${days} วัน ได้ ${money(cost)}`, '🏠'); }
      const from = a.rent && a.rent.idx === i ? Math.max(now(), a.rent.until) : now();
      a.rent = { idx: i, until: from + days * D.DAY_MS }; tenants[i] = a; markMe(a); wdAt = 0;
      return toast(a, `เช่าบ้านหลังนี้ ${days} วัน (${money(cost)}) นอนในบ้านได้แล้ว`, '🔑');
    }
    case 'house.sell': {
      if (houses[s.house] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      if (tenants[s.house]) return toast(a, 'มีผู้เช่าอยู่ ขายไม่ได้จนกว่าจะหมดสัญญา', '🏠', false);
      const back = Math.round(D.HOUSE_PRICES[s.house] * 0.7 + (a.furniture || []).reduce((t, k) => t + D.FURNITURE[k].price * 0.4, 0));
      houses[s.house] = null; a.house = -1; a.furniture = []; a.houseSale = 0; a.houseRent = 0; a.money += back; markMe(a); wdAt = 0;
      return toast(a, `ขายบ้านคืนโครงการได้ ${money(back)}`, '🏠');
    }
    case 'house.list': case 'house.rentout': {
      if (houses[s.house] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      const p = Math.max(0, Math.floor(+m.price) || 0);
      if (m.a === 'list') { a.houseSale = Math.min(p, D.HOUSE_PRICES[s.house] * 4); toast(a, p ? `ประกาศขายบ้าน ${money(a.houseSale)}` : 'ยกเลิกประกาศขายแล้ว', '🪧'); }
      else { a.houseRent = Math.min(p, D.HOUSE_RENT[s.house] * 4); toast(a, p ? `ปล่อยเช่า ${money(a.houseRent)}/วัน (ระหว่างมีผู้เช่า คุณนอนบ้านนี้ไม่ได้)` : 'ยกเลิกปล่อยเช่าแล้ว', '🔑'); }
      markMe(a); wdAt = 0; return;
    }
    case 'house.furnish': {
      if (houses[s.house] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      const f = D.FURNITURE[m.item]; if (!f) return;
      if (a.furniture.includes(m.item)) return toast(a, `มี${f.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, f.price)) return;
      a.furniture = [...a.furniture, m.item]; markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${f.icon}${f.name} ความสบาย +${f.comfort} (รวม ${comfort(a)})`, f.icon);
    }
    case 'hbed.sleep': {
      const i = s.idx, own = houses[i] === a && !tenants[i], rent = tenants[i] === a;
      if (!own && !rent) return toast(a, houses[i] === a ? 'บ้านนี้ปล่อยเช่าอยู่ คุณนอนไม่ได้' : 'นอนได้เฉพาะเจ้าของบ้านหรือผู้เช่า', '🔒', false);
      if (!cd(a, 'homesleep', 120000)) return;
      const e = 50 + (own ? comfort(a) * 2 : 0);
      a.energy = Math.min(100, a.energy + e); a.health = Math.min(100, a.health + 5); sleepWell(a); markMe(a);
      return toast(a, `นอนหลับสบาย พลังงาน +${e} หายง่วงแล้ว`, '😴');
    }
  }
}

function useItem(a, id) {
  const it = D.ITEMS[id];
  if (a.down || !it || !it.eat || !a.inv[id]) return;
  if (!cd(a, 'use', 400)) return;
  addItem(a, id, -1);
  const e = it.eat;
  if (e.hunger) { a.hunger = Math.min(100, a.hunger + e.hunger); quest(a, 'eat'); }
  if (e.energy) a.energy = Math.min(100, a.energy + e.energy);
  if (e.health) a.health = Math.min(100, a.health + e.health);
  if (id === 'medkit') cure(a, 'injury');
  if (id === 'snack') infect(a, 'poison', 0.04);
  if (it.kind === 'crop') infect(a, 'poison', 0.12);          // raw produce
  markMe(a);
  toast(a, `ใช้ ${it.icon}${it.name}`, it.icon);
}

// ------------------------------------------------------------------ player-to-player
const playerById = id => online.get(id);
function nearPlayer(a, id, r) {
  const o = playerById(id);
  if (!o || o === a || areaId(o) !== areaId(a)) return null;
  return dist(a, o) <= r ? o : null;
}
function tradeState(a) {
  const tr = a.trade; if (!tr) return;
  const other = tr.a === a ? tr.b : tr.a;
  const mine = tr.a === a ? tr.oa : tr.ob, theirs = tr.a === a ? tr.ob : tr.oa;
  send(a, { t: 'trade', open: true, with: pubInfo(other), mine, theirs });
}
function tradeClose(tr, reason) { for (const p of [tr.a, tr.b]) if (p.trade === tr) { p.trade = null; send(p, { t: 'trade', open: false, reason }); } }
function tradeOffer(a, m) {
  const tr = a.trade; if (!tr) return;
  const o = { money: clamp(Math.floor(+m.money) || 0, 0, Math.floor(a.money)), items: {}, ok: false };
  let n = 0;
  for (const [k, q] of Object.entries(m.items || {})) { const qq = Math.min(Math.floor(+q) || 0, a.inv[k] || 0); if (D.ITEMS[k] && qq > 0 && n++ < 12) o.items[k] = qq; }
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
  const move = (from, to, o) => { from.money -= o.money; to.money += o.money; for (const [k, q] of Object.entries(o.items)) { addItem(from, k, -q); addItem(to, k, q); } };
  move(tr.a, tr.b, tr.oa); move(tr.b, tr.a, tr.ob);
  quest(tr.a, 'trade'); quest(tr.b, 'trade'); stat(tr.a, 'trades'); stat(tr.b, 'trades');
  markMe(tr.a); markMe(tr.b);
  tradeClose(tr, '✅ แลกเปลี่ยนสำเร็จ!');
}
function request(a, m) {
  if (a.down) return;
  const o = nearPlayer(a, m.to, 6);
  if (!o) return toast(a, 'เดินเข้าไปใกล้ผู้เล่นคนนั้นก่อน', '⚠️', false);
  if (m.kind === 'trade') {
    if (a.trade || o.trade) return toast(a, 'ฝ่ายใดฝ่ายหนึ่งกำลังแลกเปลี่ยนอยู่', '⚠️', false);
  } else if (m.kind === 'heal') {
    if (a.career !== 'doctor') return toast(a, 'ต้องเป็นแพทย์เท่านั้น', '🚫', false);
    if (o.health >= 95) return toast(a, `${o.name} สุขภาพดีอยู่แล้ว`, 'ℹ️', false);
  } else return;
  for (const r of reqs.values()) if (r.from === a && r.to === o && r.kind === m.kind) return toast(a, 'ส่งคำขอไปแล้ว รอสักครู่', '⏳', false);
  const fee = m.kind === 'heal' ? clamp(Math.floor(+m.fee) || 0, 0, 1000) : 0;
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
  if (r.kind === 'call') return answerCall(a, f, m.ok);
  if (!m.ok) return toast(f, `${a.name} ปฏิเสธ`, '🙅', false);
  if (!online.has(f.id) || dist(a, f) > 7 || areaId(a) !== areaId(f)) return toast(a, 'อีกฝ่ายอยู่ไกลเกินไปแล้ว', '⚠️', false);
  if (r.kind === 'trade') {
    if (a.trade || f.trade) return toast(a, 'กำลังแลกเปลี่ยนอยู่', '⚠️', false);
    const tr = { a: f, b: a, oa: { money: 0, items: {}, ok: false }, ob: { money: 0, items: {}, ok: false } };
    f.trade = a.trade = tr; tradeState(f); tradeState(a);
  } else if (r.kind === 'heal') {
    if (a.money < r.fee) return toast(a, 'เงินไม่พอจ่ายค่ารักษา', '💸', false);
    a.money -= r.fee; earn(f, r.fee);
    const heal = 25 + 4 * lvl(f, 'doctor') + 8 * tier(f, 'doctor');
    a.health = Math.min(100, a.health + heal); f.xp.doctor = (f.xp.doctor || 0) + 1;
    markMe(a); markMe(f);
    toast(a, `${f.name} ปฐมพยาบาลให้ สุขภาพ +${heal} (จ่าย ${money(r.fee)})`, '💉');
    toast(f, `ปฐมพยาบาล ${a.name} สำเร็จ ได้ค่ารักษา ${money(r.fee)}`, '💉');
  }
}

// ------------------------------------------------------------------ phone: contacts and calls
function phoneAct(a, m) {
  if (m.t === 'contact_add') {
    const num = String(m.phone || '').replace(/\D/g, '');
    const o = byPhone.get(num);
    if (!o) return toast(a, 'ไม่พบเบอร์นี้', '📵', false);
    if (o === a) return toast(a, 'นี่เบอร์ของคุณเอง', '📱', false);
    if ((a.contacts || []).some(c => c.p === num)) return toast(a, `มี ${o.name} ในรายชื่อแล้ว`, '📇', false);
    if ((a.contacts || []).length >= 30) return toast(a, 'รายชื่อเต็มแล้ว (30)', '📇', false);
    a.contacts = [...(a.contacts || []), { p: num, n: o.name }]; markMe(a);
    return toast(a, `บันทึกเบอร์ ${o.name} แล้ว`, '📇');
  }
  if (m.t === 'contact_del') { a.contacts = (a.contacts || []).filter(c => c.p !== String(m.phone)); return markMe(a); }
  if (m.t === 'call') {
    if (a.down) return toast(a, 'คุณหมดสติอยู่ โทรไม่ได้', '📵', false);
    const o = byPhone.get(String(m.phone));
    if (!o || !o.ws) return toast(a, 'เลขหมายที่ท่านเรียก ไม่สามารถติดต่อได้ในขณะนี้ (ออฟไลน์)', '📵', false);
    if (a.call || o.call) return toast(a, 'สายไม่ว่าง', '📵', false);
    for (const r of reqs.values()) if (r.kind === 'call' && (r.from === a || r.to === o)) return toast(a, 'กำลังโทรอยู่...', '📞', false);
    const id = nextId++;
    reqs.set(id, { id, kind: 'call', from: a, to: o, exp: now() + 25000 });
    const known = (o.contacts || []).find(c => c.p === a.phone);
    send(o, { t: 'ring', id, name: a.name, phone: a.phone, known: !!known });
    return toast(a, `กำลังโทรหา ${o.name}...`, '📞');
  }
  if (m.t === 'call_msg') {
    const c = a.call; if (!c) return;
    const text = cleanText(m.text, 120); if (!text || !cd(a, 'chat', 600, true)) return;
    send(a, { t: 'call_msg', me: true, text }); send(c.peer, { t: 'call_msg', me: false, name: a.name, text });
    return;
  }
  if (m.t === 'call_end') return endCall(a, 'วางสายแล้ว');
}
function answerCall(a, f, ok) {
  if (!ok) return toast(f, `${a.name} ไม่รับสาย`, '📵', false);
  if (!f.ws || f.call || a.call) return;
  f.call = { peer: a }; a.call = { peer: f };
  send(f, { t: 'call', open: true, with: a.name, phone: a.phone }); send(a, { t: 'call', open: true, with: f.name, phone: f.phone });
  stat(f, 'calls');
}
function endCall(a, why) {
  const c = a.call; if (!c) return;
  a.call = null; send(a, { t: 'call', open: false, why });
  if (c.peer.call?.peer === a) { c.peer.call = null; send(c.peer, { t: 'call', open: false, why: `${a.name} ${why}` }); }
}

// ------------------------------------------------------------------ public views
function pubInfo(a) {
  return { id: a.id, name: a.name, av: a.avatar, c: a.career, lv: lvl(a), veh: bestVehicle(a), dz: (a.dz || []).map(d => DZ[d].icon),
    pose: a.down ? a.down.kind : a.pose, title: titleOf(a) };
}
function sendRoster() { broadcast({ t: 'roster', players: [...online.values()].map(a => ({ ...pubInfo(a), x: a.x, y: a.y, f: a.f })) }); }
function meView(a) {
  const isRider = a.career === 'rider';
  const myOrders = [...orders.values()].filter(o => o.cust === a).map(orderView);
  const jobs = isRider ? [...orders.values()].filter(o => o.state === 'open' || o.rider === a).map(o => ({ ...orderView(o), mine: o.rider === a, custId: o.cust?.id || 0 })) : [];
  return {
    t: 'me', id: a.id, name: a.name, avatar: a.avatar, x: +a.x.toFixed(2), y: +a.y.toFixed(2), money: Math.round(a.money), energy: a.energy, hunger: a.hunger, health: a.health,
    career: a.career, licenses: a.licenses, lv: lvl(a), xp: a.xp, inv: a.inv, phone: a.phone, contacts: a.contacts || [],
    tools: a.tools, vehicles: a.vehicles, house: a.house, furniture: a.furniture, comfort: comfort(a), speed: speedOf(a), rent: a.rent, houseSale: a.houseSale, houseRent: a.houseRent,
    bank: Math.floor(a.bank), loan: Math.ceil(a.loan), listings: a.listings || [], dz: a.dz || [], awake: Math.floor(a.awake || 0), bed: a.bed ?? -1, chair: a.chair,
    pose: a.pose, down: a.down, cast: a.cast ? { state: a.cast.state } : null, garden: a.garden, enrolled: a.enrolled, classes: a.classes || 0,
    office: a.office ? { strikes: a.office.strikes, day: a.office.day, late: a.office.late, hours: +(a.office.hours || 0).toFixed(2), closed: a.office.closed } : null,
    jobWait: jobCooldown(a), stats: a.stats || {}, ach: a.ach || [], title: a.title || '', myOrders, jobs,
    earned: a.earned, worth: Math.round(worth(a)), quests: Q.view(a),
  };
}
function worldView() {
  const t = now();
  const lb = [...accounts.values()].map(a => ({ name: a.name, av: a.avatar, c: a.career, w: Math.round(worth(a)), on: !!a.ws, ti: titleOf(a) }))
    .sort((x, y) => y.w - x.w).slice(0, 10);
  return {
    t: 'wd', now: t, toff: D.TIME_OFF, on: online.size, mk: marketView(),
    stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, Math.floor(v)])),
    lots: lots.map(o => o && o.garden ? [o.name, o.garden.n, o.garden.crops.map(c => c ? [c[0], c[1]] : 0), o.id || 0] : 0),
    beds: beds.map(p => p ? [p.name, p.id, p.dz.length ? DZ[p.dz[0]].sym : [], Math.floor(p.health), p.dz.length, p.npc ? 1 : 0, p.down ? 1 : 0] : 0),
    houses: houses.map((h, i) => [h ? h.name : '', h ? comfort(h) : 0, h ? (h.furniture || []).slice(0, 8) : [], h ? h.houseSale || 0 : 0, h ? h.houseRent || 0 : 0, tenants[i] ? tenants[i].name : '', tenants[i] ? tenants[i].rent.until : 0]),
    chairs: chairs.map(c => c ? c.name : ''),
    ev: event ? { id: event.id, text: event.text, until: event.until } : null, lb,
  };
}
function marketView() {
  const best = {};
  for (const o of accounts.values()) for (const L of o.listings || []) {
    const b = best[L.item] || (best[L.item] = { p: Infinity, n: 0 });
    b.p = Math.min(b.p, L.price); b.n += L.qty;
  }
  const out = {};
  for (const k in D.ITEMS) out[k] = { npc: Math.round(npcBuyPrice({ career: '' }, k)), farm: Math.round(npcBuyPrice({ career: '' }, k, 0.45)), sell: npcSellPrice(k), ref: Math.round(marketPrice(k)), best: best[k] ? best[k].p : 0, n: best[k] ? best[k].n : 0 };
  return out;
}

// ------------------------------------------------------------------ connection
function login(ws, m) {
  const name = cleanText(m.name, 16);
  // new characters: English letters and digits only (older characters with Thai names can still log in)
  if (!accounts.has(name.toLowerCase())) {
    if (/[^\x20-\x7e]/.test(name)) return fail(ws, 'ชื่อตัวละครใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น (A-Z, 0-9, _ - .)');
    if (!/^[A-Za-z0-9_.-]{2,16}$/.test(name)) return fail(ws, 'ชื่อต้องยาว 2-16 ตัว ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข และ _ - . (ห้ามเว้นวรรค)');
  }
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
    a = hydrate({ v: VERSION, name, salt, hash: hashPin(pin, salt), avatar: clamp(Math.floor(+m.avatar) || 0, 0, 9) });
    accounts.set(lname, a); isNew = true;
  }
  Q.ensure(a);
  const daily = dailyLogin(a);
  a.ws = ws; ws.acct = a; a.id = nextId++; a.lastPosT = now(); a.moved = true; a.loginAt = now();
  if (!D.areaAt(a.x, a.y) || D.blocked(a.x, a.y)) { a.x = D.SPAWN.x; a.y = D.SPAWN.y; }
  if (a.down && a.down.kind === 'hosp') { a.down = null; a.health = Math.max(a.health, 25); a.x = ROOM.r_hospital.spawn.x; a.y = ROOM.r_hospital.spawn.y; }
  online.set(a.id, a);
  dirty = true;
  send(a, {
    t: 'init', id: a.id,
    map: { w: D.W, h: D.H, tiles: D.TILES, buildings: D.BUILDINGS }, stations: D.STATIONS, areas: D.AREAS, solid: D.SOLID,
    items: D.ITEMS, cats: D.CATEGORIES, crops: D.CROPS, recipes: D.RECIPES, careers: D.CAREERS, licenses: D.LICENSES,
    titles: D.OFFICE_TITLES, wages: D.OFFICE_WAGE, speed: SPEED, radius: D.RADIUS, chat: chatLog.slice(-25), isNew, dayMs: D.DAY_MS, hours: D.HOURS, shift: D.SHIFT,
    props: D.PROPS, trees: D.TREES, lotsDef: D.LOTS, garden: D.GARDEN, diseases: D.DISEASES, treatments: D.TREATMENTS, ach: D.ACHIEVEMENTS, fish: D.FISH,
    shop: { vehicles: D.VEHICLES, tools: D.TOOLS, toolPrices: D.TOOL_PRICES, housePrices: D.HOUSE_PRICES, houseRent: D.HOUSE_RENT, furniture: D.FURNITURE, bank: D.BANK },
  });
  send(a, meView(a)); send(a, worldView());
  if (daily) send(a, { t: 'daily', ...daily });
  sendRoster();
  feed(`👋 ${a.name} เข้าเมือง`);
}
function fail(ws, msg) { ws.send(JSON.stringify({ t: 'loginfail', msg })); }

const loginFails = new Map();
function loginFail(key, max, ms) {
  const t = now(), r = loginFails.get(key);
  const e = r && r.reset > t ? r : { n: 0, reset: t + ms, until: 0 };
  if (++e.n >= max) { e.until = t + ms; e.n = 0; }
  loginFails.set(key, e);
}
setInterval(() => { const t = now(); for (const [k, v] of loginFails) if (v.reset < t && v.until < t) loginFails.delete(k); }, 60000).unref();

// daily login bonus: grows each consecutive day, capped at day 7 (kept small to fight inflation)
const LOGIN_BONUS = [100, 150, 200, 250, 300, 400, 600];
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
  if (a.call) endCall(a, 'ออฟไลน์');
  for (const [id, r] of reqs) if (r.from === a || r.to === a) reqs.delete(id);
  for (const o of [...orders.values()]) { if (o.cust === a && o.state === 'open') cancelOrder(o, 'ลูกค้าออฟไลน์'); else if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; } }
  standUp(a);
  online.delete(a.id);
  a.ws = null; a.cast = null; a.sd = true; dirty = true;
  sendRoster();
}

// movement: the client simulates, the server checks the step against the same tile map
function move(a, m) {
  const x = +m.x, y = +m.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (a.down) return send(a, { t: 'fix', x: a.x, y: a.y });
  const t = now(), dt = Math.min(1, (t - a.lastPosT) / 1000);
  a.lastPosT = t;
  // budget refills at the player's speed (+30% slack for network jitter); generous cap so bursts don't snap you back
  a.mvb = Math.min(2.5, (a.mvb ?? 2.5) + SPEED * speedOf(a) * 1.3 * dt);
  const d = Math.hypot(x - a.x, y - a.y);
  if (d > a.mvb + 0.05 || !pathClear(a.x, a.y, x, y)) return send(a, { t: 'fix', x: a.x, y: a.y });
  a.mvb -= d;
  if (d > 0.04 && (a.pose || a.chair >= 0 || a.bed >= 0)) standUp(a);
  if (x !== a.x || y !== a.y) { a.x = x; a.y = y; a.moved = true; dirty = true; }
  a.f = clamp(Math.floor(+m.f) || 0, 0, 7);
  if (a.cast && Math.hypot(a.x - ST[a.cast.st].x, a.y - ST[a.cast.st].y) > ST[a.cast.st].r + 1.2) { a.cast = null; markMe(a); }
}
// the step must not cross a wall (sampled); a tiny radius slack absorbs the client's rounding to 2 decimals
function pathClear(x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2));
  for (let i = 1; i <= n; i++) if (D.blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, D.RADIUS - 0.04)) return false;
  return D.areaAt(x1, y1)?.id === D.areaAt(x0, y0)?.id;
}

function onMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const a = ws.acct;
  if (m.t === 'login') { if (!a) login(ws, m); return; }
  if (!a || a.ws !== ws) return;
  switch (m.t) {
    case 'p': return move(a, m);
    case 'chat': {                          // local chat: only people near you see it (bubble over your head)
      const text = cleanText(m.text, 120); if (!text) return;
      if (!cd(a, 'chat', 800)) return;
      const msg = { t: 'chat', id: a.id, name: a.name, av: a.avatar, c: a.career, text, ts: now() };
      const here = areaId(a);
      let heard = 0;
      for (const o of online.values()) if (areaId(o) === here && dist(o, a) <= 14) { send(o, msg); if (o !== a) heard++; }
      if (!heard) toast(a, 'ไม่มีใครอยู่ใกล้พอจะได้ยิน (โทรหาเพื่อนได้ใน 📱)', '💬', false);
      return quest(a, 'chat');
    }
    case 'act': return act(a, m);
    case 'enter': return enterRoom(a, m);
    case 'exit': return exitRoom(a);
    case 'use': return useItem(a, m.item);
    case 'rest': {
      if (a.down) return;
      if (m.on === false) { if (a.pose === 'rest') { a.pose = null; sendRoster(); markMe(a); } return; }
      standUp(a); a.pose = 'rest'; markMe(a); sendRoster();
      return toast(a, 'นั่งพักหลับตา... พลังงานฟื้นเร็วขึ้น 3 เท่า (เดินเพื่อลุก)', '😌');
    }
    case 'resign': return resign(a);
    case 'title': { if (!m.id || (a.ach || []).includes(m.id)) { a.title = m.id || ''; markMe(a); sendRoster(); } return; }
    case 'order': return placeOrder(a, m);
    case 'order_take': case 'order_drop': case 'order_deliver': case 'order_cancel': return riderAct(a, m);
    case 'contact_add': case 'contact_del': case 'call': case 'call_msg': case 'call_end': return phoneAct(a, m);
    case 'req': return request(a, m);
    case 'req_ans': return answerReq(a, m);
    case 'trade_offer': return tradeOffer(a, m);
    case 'trade_confirm': return tradeConfirm(a);
    case 'trade_cancel': if (a.trade) tradeClose(a.trade, `${a.name} ยกเลิกการแลกเปลี่ยน`); return;
    case 'quest_reroll': {
      const err = Q.reroll(a, Math.floor(+m.i));
      if (err) return toast(a, err, '📜', false);
      markMe(a); return toast(a, 'เปลี่ยนเควสต์แล้ว', '📜');
    }
  }
}

// ------------------------------------------------------------------ simulation
let lastTick = now(), wdAt = 0, saveAt = 0, slowAt = 0, marketAt = 0, lastHour = hourNow();
function tick() {
  const t = now(), dt = Math.min(1, (t - lastTick) / 1000); lastTick = t;
  const h = hourNow();

  // events
  if (event && t > event.until) { event = null; feed('🌤️ เหตุการณ์พิเศษจบลงแล้ว'); wdAt = 0; }
  if (!event && t > nextEventAt) {
    const e = D.EVENTS[rint(0, D.EVENTS.length - 1)];
    event = { ...e, until: t + rnd(150, 240) * 1000 };
    nextEventAt = event.until + rnd(150, 300) * 1000;
    feed(e.text); wdAt = 0;
  }
  // market recovery + wholesale refill
  for (const k in market) {
    const mk = market[k];
    mk.mult += (mk.target - mk.mult) * 0.0012 * dt * 10;
    const it = D.ITEMS[k];
    if (it.wholesale && stock[k] < it.stock) stock[k] = Math.min(it.stock, stock[k] + dt / it.refill);
  }
  if (t > marketAt) { marketAt = t + 45000; for (const k in market) market[k].target = clamp(market[k].target + rnd(-0.08, 0.08) + (1 - market[k].target) * 0.2, 0.8, 1.25); }

  // closing time: buildings throw everybody out (houses and the hospital never close)
  const crossed = (x) => lastHour < x && h >= x || (lastHour > h && (x > lastHour || x <= h));
  for (const [kind, [open, close]] of Object.entries(D.HOURS)) if (close < 24 && crossed(close)) {
    const room = D.ROOMS.find(r => r.rk === kind);
    if (room) for (const a of online.values()) if (D.roomAt(a.x, a.y) === room) { teleport(a, room.outside.x, room.outside.y); toast(a, `${room.label}ปิดทำการแล้ว (${hhmm(close)}) เปิดอีกครั้ง ${hhmm(open)}`, '🔒'); }
  }
  if (crossed(D.SHIFT.end)) feed('🏢 17:00 เลิกงานแล้ว ไฟในออฟฟิศปิด');
  if (crossed(D.SHIFT.start - 0.5)) for (const a of online.values()) if (a.career === 'office') toast(a, 'อีก 30 นาทีเข้างาน (08:00) ไปนั่งที่โต๊ะทำงานในบริษัทให้ทัน', '⏰');
  lastHour = h;

  const slow = t > slowAt; if (slow) slowAt = t + 1000;
  const flu = ev('flu');
  for (const a of online.values()) {
    const indoors = !!D.roomAt(a.x, a.y);
    // ---- energy, hunger, health
    const restMul = a.pose === 'rest' ? 3 : a.pose === 'seat' ? 2 : a.pose === 'bed' ? 2 : 1;
    if (a.pose !== 'chair') a.energy = Math.min(100, a.energy + 0.15 * restMul * (1 + 0.03 * comfort(a)) * dzProd(a, 'regen') * dt);
    a.hunger = Math.max(0, a.hunger - 0.06 * dzProd(a, 'hunger') * (flu ? 1.3 : 1) * (a.down ? 0.2 : 1) * dt);
    if (!a.down) {
      if (a.hunger < 15) { a.lowFood = (a.lowFood || 0) + dt; if (a.lowFood > 60) a.health -= 0.08 * dt; } else a.lowFood = 0;
      if (a.hunger <= 0) a.health -= 0.25 * dt;
      else if (a.hunger > 60 && a.health < 100 && !(a.dz || []).length) a.health = Math.min(100, a.health + 0.05 * dt);
      for (const d of a.dz || []) a.health -= (DZ[d].drain || 0) * (flu && (d === 'flu' || d === 'cold') ? 2.5 : 1) * dt;
      a.health = Math.max(0, a.health);
    }
    // ---- sleepiness
    if (a.pose === 'rest' || a.pose === 'bed') { a.awake = Math.max(0, (a.awake || 0) - 4 * dt); if (a.awake === 0 && (a.dz || []).some(d => d === 'insomnia' || d === 'exhaust') && a.pose === 'rest') sleepWell(a); }
    else a.awake = (a.awake || 0) + dt;
    if (slow && !a.down) {
      // ---- ways to get sick (often enough that doctors have work)
      if (a.awake > 40 * 60) infect(a, 'insomnia', 0.02);
      if (ev('rain') && !indoors) { a.wet = (a.wet || 0) + 1; if (a.wet > 40) infect(a, 'cold', 0.01); } else a.wet = Math.max(0, (a.wet || 0) - 2);
      if (flu) { infect(a, 'flu', indoors ? 0.002 : 0.004); infect(a, 'cold', 0.002); }
      if (!indoors) infect(a, 'cold', 0.0007);
      if (a.hunger <= 0) { a.starve = (a.starve || 0) + 1; if (a.starve > 60) infect(a, 'malnut'); } else a.starve = 0;
      if (a.hunger >= 80) cure(a, 'malnut');
      // contagion: standing next to someone with a cold or the flu
      if ((a.dz || []).some(d => d === 'cold' || d === 'flu')) for (const o of online.values()) if (o !== a && areaId(o) === areaId(a) && dist(o, a) < 2.5) infect(o, a.dz.includes('flu') ? 'flu' : 'cold', 0.01);
      if (a.career === 'office') officeTick(a, t, h, 1);
    }
    // ---- knocked out
    if (!a.down && a.health <= 0) knockOut(a);
    else if (a.down) {
      if (a.down.kind === 'veg') {
        a.health = Math.min(100, a.health + 0.12 * dt);
        if (a.health >= 15) revive(a, 15);
      } else if (a.down.kind === 'hosp') {
        const docs = [...online.values()].some(o => o.career === 'doctor' && o !== a && !o.down);
        if (t - a.down.t > (docs ? 120000 : 45000)) {
          const fee = Math.min(1200, Math.round(a.money * 0.25)); a.money -= fee;
          revive(a, 30); toast(a, `เจ้าหน้าที่โรงพยาบาลช่วยให้คุณฟื้น เสียค่ารักษา ${money(fee)} (ยังต้องรักษาโรคที่เป็นอยู่)`, '🏥', false);
        }
      }
    }
    if (a.cast) {
      if (a.cast.state === 'wait' && t >= a.cast.bite) { a.cast.state = 'bite'; send(a, { t: 'bite' }); markMe(a); }
      else if (a.cast.state === 'bite' && t > a.cast.expire) { a.cast = null; markMe(a); toast(a, 'ปลาหนีไปแล้ว ช้าเกิน!', '💨', false); }
    }
    if (a.trade && (dist(a.trade.a, a.trade.b) > 8 || areaId(a.trade.a) !== areaId(a.trade.b))) tradeClose(a.trade, 'อยู่ไกลกันเกินไป ยกเลิกการแลกเปลี่ยน');
    if (a.meDirty || t % 2000 < TICK) { a.meDirty = false; send(a, meView(a)); }
  }
  if (slow) {
    // garden: tell owners their crops are ready
    for (const o of lots) if (o && o.garden && o.ws) o.garden.crops.forEach(c => { if (c && !c[2] && c[1] <= t) { c[2] = true; toast(o, `${D.ITEMS[c[0]].name}ในสวนของคุณโตแล้ว! ไปเก็บเกี่ยวได้`, '🌾'); } });
    // rentals expire
    tenants.forEach((a, i) => { if (a && a.rent && a.rent.until < t) { tenants[i] = null; a.rent = null; a.sd = true; if (a.ws) { toast(a, 'สัญญาเช่าบ้านหมดแล้ว ต่อสัญญาได้ที่หน้าบ้าน', '🔑', false); markMe(a); } wdAt = 0; } });
    // NPC patients
    for (let i = 0; i < beds.length; i++) { const b = beds[i]; if (b && b.npc && b.until < t) { beds[i] = null; wdAt = 0; } }
    if (t > npcPatientAt) { npcPatientAt = t + rnd(35000, 70000); if ([...online.values()].some(o => o.career === 'doctor')) spawnPatient(); }
    // food delivery
    for (const o of [...orders.values()]) {
      if (o.state === 'open' && !o.npc && t - o.t > (ridersOnline().length ? 90000 : 60000)) finishOrder(o, null);
      else if (o.state === 'open' && o.npc && t - o.t > 240000) { orders.delete(o.id); ordersChanged(); }
      else if (o.state !== 'open' && o.takenAt && t - o.takenAt > 360000) { const r = o.rider; o.state = 'open'; o.rider = null; o.riderName = ''; o.takenAt = 0; if (r) toast(r, `ส่งออเดอร์ของ ${o.custName} ช้าเกินไป ออเดอร์ถูกส่งต่อให้คนอื่น`, '⌛', false); ordersChanged(); }
    }
    if (t > npcOrderAt) {
      npcOrderAt = t + D.RIDER.npcEvery * 1000 / (ev('hungry') ? 1.5 : 1);
      const rs = ridersOnline().length;
      if (rs && buildingOpen('restaurant') && [...orders.values()].filter(o => o.npc && o.state === 'open').length < 2 + rs) spawnNpcOrder();
    }
    for (const a of online.values()) if (a.stats) { const w = Math.round(worth(a)); if (w >= 100000 && !(a.ach || []).includes('gen2')) stat(a, 'worth', w, true); }
  }
  for (const [id, r] of reqs) if (t > r.exp) { reqs.delete(id); toast(r.from, r.kind === 'call' ? `${r.to.name} ไม่รับสาย` : `${r.to.name} ไม่ตอบรับ`, '⌛', false); }
  // bank interest
  if (slow && t % 30000 < 1000) for (const a of online.values()) if (a.bank > 0) { accrue(a); markMe(a); }

  // positions
  const ps = [];
  for (const a of online.values()) if (a.moved) { a.moved = false; ps.push([a.id, +a.x.toFixed(2), +a.y.toFixed(2), a.f]); }
  if (ps.length) broadcast({ t: 'ps', p: ps });

  if (t > wdAt) { wdAt = t + 1000; broadcast(worldView()); }
  if (t > saveAt) { saveAt = t + 15000; save(); }
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };
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
