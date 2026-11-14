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
// admins (lower-case login IDs). Admins play with normal stats; the god-mode menu can switch on
// "no cooldowns" / "locked full stats" and top up money. Extra admins via ADMINS=a,b
const ADMINS = new Set(['james2324', ...String(process.env.ADMINS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)]);
const isAdmin = a => !!a && ADMINS.has(String(a.login || a.name).toLowerCase());
const godLock = a => isAdmin(a) && !!a.god?.lock;          // god mode: stats locked full, never sick / knocked out / jailed
const godNoCd = a => isAdmin(a) && !!a.god?.nocd;          // god mode: every cooldown skipped
const ADMIN_NAME = 'อนุทิน', ADMIN_TITLE = 'นายกเทศมนตรี';
// names nobody else may use (or imitate) for their character
const RESERVED = ['อนุทิน', 'นายกเทศ', 'แอดมิน', 'ผู้ดูแลระบบ', 'ทีมงาน', 'gamemaster', 'admin', 'moderator', 'official', 'gm', 'mod'];
// compare names loosely: no spaces/punctuation/zero-width/tone marks, look-alike digits folded into letters
const nameKey = n => String(n).normalize('NFKC').toLowerCase().replace(/[\s._\-\u200b-\u200d\u2060\ufeff]/g, '').replace(/[่้๊๋็์ํ]/g, '')
  .replace(/[0@]/g, 'o').replace(/[1!|l]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
const impersonates = n => { const k = nameKey(n); return RESERVED.some(r => { const rk = nameKey(r); return rk.length <= 3 ? k === rk : k.includes(rk); }); };
const VERSION = 4;                          // save-format version (2 = new world, 3 = happiness/bills/ม.6, 4 = no thief/fisher jobs, no vehicles)
// a hash of the client files: when it changes (a new deploy) open games are told to refresh
const BUILD = crypto.createHash('sha1').update(['index.html', 'game.js', 'style.css', 'fx.js'].map(f => { try { return fs.readFileSync(path.join(__dirname, '..', 'public', f)); } catch { return ''; } }).join('|')).digest('hex').slice(0, 10);

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
let nextEventAt = Date.now() + (process.env.EVENT_NOW ? 2000 : 120_000);   // EVENT_NOW=1 starts an event right away (testing)
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
    send(a, { t: 'ach', id: ac.id }); joy(a, 10);
    feed(`🏅 ${a.name} ได้รับฉายา "${ac.title}"`);
    sendRoster();
  }
  markMe(a);
}
const titleOf = a => isAdmin(a) ? ADMIN_TITLE : D.ACHIEVEMENTS.find(x => x.id === a.title)?.title || '';

// ------------------------------------------------------------------ diseases
const DZ = D.DISEASES;
const dzProd = (a, key) => (a.dz || []).reduce((m, d) => m * (DZ[d]?.[key] || 1), 1);
function infect(a, id, chance = 1) {
  if (godLock(a)) return false;
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
const desks = new Array(8).fill(null);         // university desks -> account
const beds = new Array(6).fill(null);          // hospital beds -> account | npc patient
function standUp(a) {
  if (a.chair >= 0) { if (chairs[a.chair] === a) chairs[a.chair] = null; a.chair = -1; }
  if (a.desk >= 0) { if (desks[a.desk] === a) desks[a.desk] = null; a.desk = -1; }
  if (a.bed >= 0) { if (beds[a.bed] === a) beds[a.bed] = null; a.bed = -1; wdAt = 0; }
  if (a.pose) { a.pose = null; a.seat = null; }
  sendRoster();
}
function place(a, x, y, tp) {
  a.x = x; a.y = y; a.mvb = moveCap(a); a.moved = true; a.lastPosT = now();
  a.fixId = (a.fixId || 0) + 1;
  send(a, { t: 'fix', x, y, tp: tp ? 1 : 0, fx: a.fixId });
}
function teleport(a, x, y) { a.cast = null; standUp(a); place(a, x, y, true); markMe(a); }
function buildingOpen(bid, h = hourNow()) { return D.isOpen(bid, h); }
function enterRoom(a, m) {
  if (a.down) return;
  const s = ST[m.st]; if (!s || s.type !== 'door') return;
  const room = ROOM[s.to]; if (!room) return;
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 1.2) return toast(a, 'เดินไปที่ประตูก่อน', '🚪', false);
  if (s.renov) return toast(a, `${s.label} ปิดปรับปรุงชั่วคราว 🚧`, '🚧', false);
  if (s.house === undefined && !buildingOpen(s.bld)) {
    const o = D.HOURS[s.bld];
    return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false);
  }
  if (s.house !== undefined) {
    const i = s.house, o = houses[i], tn = tenants[i];
    if (o !== a && tn !== a) return toast(a, o || tn ? `บ้านหลังนี้เป็นของ${tn ? 'ผู้เช่า' : ''} ${(tn || o).name} เข้าได้เฉพาะเจ้าของบ้านและผู้เช่า` : 'บ้านว่าง ห้ามเข้า — ซื้อหรือเช่าก่อนถึงจะเข้าได้', '🔒', false);
  }
  if (!cd(a, 'door', 1200, true)) return;
  teleport(a, room.spawn.x, room.spawn.y);
}
function exitRoom(a) {
  if (a.down) return;
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
const speedOf = a => dzProd(a, 'speed');           // vehicles were removed from the game
const runMul = a => a.run && a.energy > D.RUN.minEnergy ? D.RUN.mul : 1;
const moveCap = a => Math.max(2.5, SPEED * speedOf(a) * D.RUN.mul * 1.35 * 4);   // up to ~4 s of walking can arrive in one burst (mobile networks stall)
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
  if (godNoCd(a)) { a.cd[key] = 0; return true; }
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
// licences that expire: the driving licence must be renewed every in-game year (1 real day)
const LICENSE_YEAR = 12 * D.MONTH_DAYS * D.DAY_MS;
const licExpired = (a, id) => (a.licenses || []).includes(id) && !!D.LICENSES[id]?.renew && (a.licExp?.[id] || 0) < now();
const hasLic = (a, id) => (a.licenses || []).includes(id) && !licExpired(a, id);
// fishing is open to everyone; its own level comes from catches (stored as xp.fisher)
const fishLv = a => Math.min(D.FISHING.maxLv, 1 + Math.floor((a.xp?.fisher || 0) / D.FISHING.xpPerLv));

const NPC_BUY = 0.3;                         // NPC shops buy at a fraction of what players pay each other
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
  if (a.career === 'merchant' && it.kind === 'goods') rate = 0.7 + Math.min(0.08, 0.01 * (lvl(a, 'merchant') - 1));   // shops restock from merchants
  else if (a.career === 'merchant') b += 0.05;
  if (a.career === 'chef' && it.kind === 'meal') rate = Math.max(rate, 0.5);                                      // restaurants buy chefs' dishes
  if (a.career === 'farmer' && it.kind === 'crop') b += 0.08;
  if (it.kind === 'fish') b += 0.01 * Math.min(8, fishLv(a) - 1);       // experienced anglers know the buyers
  return marketPrice(id) * rate * b;
}
const npcSellPrice = id => Math.ceil(D.ITEMS[id].base * NPC_SELL);
function worth(a) {
  let w = a.money + (a.bank || 0) - (a.loan || 0);
  for (const [k, q] of Object.entries(a.inv)) w += (D.ITEMS[k]?.base || 0) * q * 0.5;
  for (const L of a.listings || []) w += (D.ITEMS[L.item]?.base || 0) * L.qty * 0.5;
  for (const [, t] of Object.entries(a.tools || {})) for (let i = 0; i < t; i++) w += D.TOOL_PRICES[i] * 0.5;
  if (a.house >= 0) { w += D.HOUSE_PRICES[a.house] * 0.7; for (const f of a.furniture || []) w += (D.FURNITURE[f]?.price || 0) * 0.5; }
  if (a.garden) w += D.GARDEN.lotPrice * 0.6;
  return w;
}

// ------------------------------------------------------------------ persistence
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
const SAVE_KEYS = ['v', 'login', 'name', 'salt', 'hash', 'avatar', 'money', 'energy', 'hunger', 'health', 'career', 'licenses', 'xp', 'inv', 'x', 'y', 'earned',
  'created', 'quests', 'qStreak', 'lastLogin', 'loginStreak', 'tools', 'vehicles', 'house', 'furniture', 'bank', 'bankT', 'loan', 'dz', 'awake', 'listings',
  'phone', 'contacts', 'stats', 'ach', 'title', 'jobChanges', 'enrolled', 'classes', 'office', 'garden', 'rent', 'houseSale', 'houseRent', 'down', 'happy', 'bills', 'billMonth', 'usage', 'utilOff', 'wanted', 'crimes', 'craving', 'gender', 'look', 'wardrobe',
  'god', 'rod', 'hideJob', 'outfit', 'outfits', 'licExp', 'phoneAsk', 'school'];
let nextListing = 1;
async function load() {
  const rows = await store.loadAll();
  const meta = rows.find(r => r && r.login === '__meta'); if (meta) bugs = meta.bugs || [];
  for (const r of rows) if (r && r.name) { const a = hydrate(r); accounts.set(a.login.toLowerCase(), a); }
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
    avatar: 0, money: 600, energy: 100, hunger: 100, health: 100, career: 'none', licenses: [], xp: {},
    inv: {}, x: D.SPAWN.x, y: D.SPAWN.y, earned: 0, created: now(), quests: null, qStreak: 0, lastLogin: '', loginStreak: 0, tools: {}, vehicles: [], house: -1,
    furniture: [], bank: 0, bankT: now(), loan: 0, dz: [], awake: 0, listings: [], contacts: [], stats: {}, ach: [], title: '', jobChanges: [],
    enrolled: false, classes: 0, office: null, garden: null, rent: null, houseSale: 0, houseRent: 0, down: null,
    gender: 'm', look: null, wardrobe: null, god: null, rod: 0, hideJob: false, outfit: '', outfits: [], licExp: {}, phoneAsk: {}, school: null,
    happy: 80, bills: [], billMonth: null, usage: { sleep: 0 }, utilOff: false, wanted: 0, crimes: [], craving: null,
  }, r, { ws: null, id: null, f: 0, bed: -1, chair: -1, pose: null, seat: null, immune: {}, cd: {}, cast: null, trade: null, call: null, lastPosT: now(), moved: false, meDirty: false, desk: -1, afk: false, emo: null, thiefUntil: 0 });
  if ((a.v || 1) < 2) {                            // migrate saves from the old single-map town
    if (!D.CAREERS[a.career]) a.career = 'none';
    a.licenses = (a.licenses || []).filter(l => D.LICENSES[l]);
    if (a.licenses.includes('medicine') || a.career === 'office') a.licenses = [...new Set([...a.licenses, 'degree'])];
    if (a.house >= 0) { a.money += 30000; a.house = -1; a.furniture = []; }   // the old houses were demolished: refund
    a.x = D.SPAWN.x; a.y = D.SPAWN.y; a.v = 2;
  }
  if (!a.look || !a.look.pants) {                   // looks moved to the pixel character: refund the old hairstyles/hats, keep the shirt colour
    const OLD = { swept: 900, m: 600, pony: 1400, bun: 1400, braid: 1800, beanie: 900, straw: 700, beret: 1600, green: 1600, hood: 2500 };
    const W = a.wardrobe || {}; a.money += [...(W.hair || []), ...(W.hat || [])].reduce((t, k) => t + (OLD[k] || 0), 0) + Math.max(0, (W.shirt || []).length - 1) * 500;
    const sh = { blue: 'blue', green: 'green', yellow: 'yellow' }[a.look?.shirt] || D.SHIRTS[(a.avatar || 0) % 4];
    a.look = { hair: 'brown', shirt: sh, pants: 'gray' }; a.wardrobe = { hair: ['brown'], shirt: [sh], pants: ['gray'] };
  }
  if (a.v < 3) {                                   // ม.6 became a requirement for the degree
    if (a.licenses.includes('degree')) a.licenses = [...new Set([...a.licenses, 'hs'])];
    if (a.enrolled === true) a.enrolled = 'degree';
    a.v = 3;
  }
  if ((a.v || 3) < 4) {                           // thief and fisher stopped being jobs; vehicles were removed (refunded in full)
    if (a.career === 'thief' || a.career === 'fisher') { if (a.career === 'fisher') a.rod = 1; a.career = 'none'; }
    if ((a.xp?.fisher || 0) > 0) a.rod = Math.max(a.rod || 0, 1);
    a.money += (a.vehicles || []).reduce((t, v) => t + (D.VEHICLES[v]?.price || 0), 0); a.vehicles = [];
    if ((a.licenses || []).includes('driving')) a.licExp = { ...(a.licExp || {}), driving: now() + LICENSE_YEAR };
    a.v = 4;
  }
  if (!a.login) a.login = a.name;                    // older saves: the name was the login ID
  // fixed character names for special accounts (login ID -> character name)
  const RENAME = isAdmin(a) && String(a.login).toLowerCase() === 'james2324' ? ADMIN_NAME : null;
  if (RENAME && a.name !== RENAME) { a.name = RENAME; a.sd = true; }
  if (!isAdmin(a) && impersonates(a.name)) { a.name = 'ชาวเมือง' + String(a.login).slice(0, 8); a.sd = true; }   // nobody else may look like the admin
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
  const meta = { login: '__meta', bugs }, wroteBugs = bugsDirty; bugsDirty = false;
  try {
    await store.save(changed.map(rec).concat(wroteBugs ? [meta] : []), [...accounts.values()].map(rec).concat([meta]));
    changed.forEach(a => { if (!a.ws) a.sd = false; });
  } catch (e) { dirty = true; if (wroteBugs) bugsDirty = true; console.error('save failed:', e.message); }
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
  const fee = Math.round(deliveryFee(s.x, s.y) * (ev('hungry') ? 1.3 : 1));
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
    if (!hasLic(a, 'driving')) return toast(a, licExpired(a, 'driving') ? 'ใบขับขี่หมดอายุแล้ว! ต่ออายุที่มหาวิทยาลัย (ปีละครั้ง)' : 'ต้องมีใบขับขี่ก่อน', '🪪', false);
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
  if (godLock(a)) { a.health = 100; return; }
  a.cast = null; standUp(a);
  if (a.trade) tradeClose(a.trade, `${a.name} หมดสติ`);
  if (a.hunger <= 5) {               // starving: collapse right where you are
    a.down = { kind: 'veg', t: now() };
    toast(a, 'คุณหิวจนหมดแรง ล้มลงนอนเป็นผัก... รอสักพักร่างกายจะฟื้นขึ้นมาเอง', '🥬', false);
    feed(`🥬 ${a.name} หิวจนล้มลงข้างทาง`);
  } else {                           // otherwise an ambulance takes you to hospital
    const docsOn = [...online.values()].some(o => o.career === 'doctor' && o !== a && !o.down);
    a.down = { kind: 'hosp', t: now(), until: now() + (docsOn ? 120000 : 60000) };
    let i = beds.findIndex(b => !b);
    if (i < 0) i = beds.findIndex(b => b && b.npc);
    if (i >= 0) { beds[i] = a; a.bed = i; const s = ST['bed' + i]; place(a, s.x, s.y, true); }
    else { const r = ROOM.r_hospital; place(a, r.x + 5, r.y + 6, true); }
    const docs = [...online.values()].filter(o => o.career === 'doctor' && o !== a && !o.down);
    toast(a, `คุณหมดสติ! รถพยาบาลพามาส่งเตียงโรงพยาบาล${docs.length ? ` รอหมอช่วย (หมอออนไลน์ ${docs.length} คน) ถ้าไม่มีใครช่วย เจ้าหน้าที่จะช่วยใน 2 นาที` : ' ไม่มีหมอออนไลน์ เจ้าหน้าที่จะช่วยให้ฟื้นใน 1 นาที (ค่ารักษาแพง)'}`, '🚑', false);
    joy(a, -15);
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
  if (seated && depressed(a)) { standUp(a); toast(a, 'ไม่มีจิตใจจะทำงานต่อ... (ความสุขต่ำมาก) ไปทำอะไรให้มีความสุขก่อน', '😞', false); return; }
  if (seated && o.day === day && h >= D.SHIFT.start && h < D.SHIFT.end) {
    const l = Math.min(lvl(a, 'office'), D.OFFICE_WAGE.length);
    const gh = dt * D.gameRate(h);                        // game hours that passed (nights run faster)
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
// doctors: paid for every game hour spent inside the hospital during the shift (patients' fees come on top)
function doctorTick(a, t, h, dt) {
  const inside = D.roomAt(a.x, a.y)?.id === 'r_hospital', day = D.dayAt(t);
  const o = a.doc && a.doc.day === day ? a.doc : (a.doc = { day, hours: 0, pend: 0, on: false });
  const onDuty = inside && !a.down && h >= D.DOCTOR.start && h < D.DOCTOR.end;
  if (onDuty && depressed(a)) { if (o.on) { o.on = false; toast(a, 'ซึมเศร้า ทำงานไม่ได้... (ความสุขต่ำมาก)', '😞', false); } return; }
  if (onDuty !== o.on) {
    o.on = onDuty;
    if (onDuty) toast(a, `เข้าเวรแล้ว 🩺 อยู่ในโรงพยาบาลจนถึง ${hhmm(D.DOCTOR.end)} ได้เงินเดือนทุกชั่วโมง (+ค่ารักษาคนไข้)`, '🩺');
    else if (inside && h >= D.DOCTOR.end) toast(a, `หมดเวรแล้ว วันนี้ทำงาน ${o.hours.toFixed(1)} ชม.`, '🏥');
    else if (!inside && h >= D.DOCTOR.start && h < D.DOCTOR.end) toast(a, 'ออกจากโรงพยาบาล = หยุดนับเวลางาน (กลับเข้าไปเพื่อรับเงินเดือนต่อ)', '🩺', false);
    markMe(a);
  }
  if (!onDuty) return;
  const l = Math.min(lvl(a, 'doctor'), D.DOCTOR.wage.length), gh = dt * D.gameRate(h);
  o.pend += D.DOCTOR.wage[l - 1] * gh * wellbeing(a) * (1 + BOOST[tier(a, 'doctor')]);
  o.hours += gh;
  if (o.pend >= D.DOCTOR.wage[l - 1]) { earn(a, o.pend); o.pend = 0; if (o.hours >= 4 && !o.xp) { o.xp = 1; addXp(a); } }
}
// university: sit at a desk; one game hour seated = one class
function studyTick(a, h, dt) {
  const id = a.enrolled, L = id && D.LICENSES[id];
  if (!L) { standUp(a); return; }
  if (!D.isOpen('school', h)) { standUp(a); return toast(a, 'มหาวิทยาลัยปิดแล้ว พรุ่งนี้มาเรียนต่อ', '🎓', false); }
  if (depressed(a)) { standUp(a); return toast(a, 'ไม่มีจิตใจจะเรียน... (ความสุขต่ำมาก)', '😞', false); }
  a.energy = Math.max(0, a.energy - 0.05 * dt);
  if (a.energy <= 1) { standUp(a); return toast(a, 'หมดแรง! ไปกินอะไรแล้วค่อยกลับมาเรียน', '😵', false); }
  const S = a.school && a.school.id === id ? a.school : (a.school = { id, p: 0 });
  S.p += dt * D.gameRate(h);
  if (S.p < 1) { if (Math.random() < 0.2) markMe(a); return; }
  S.p = 0; a.classes = (a.classes || 0) + 1; markMe(a); quest(a, 'study');
  if (a.classes >= L.classes) {
    standUp(a);
    a.enrolled = false; a.school = null; a.licenses = [...a.licenses, id]; joy(a, 15);
    if (id === 'degree') stat(a, 'degree', 1, true);
    feed(`🎓 ${a.name} เรียนจบ${L.name}แล้ว!`);
    return toast(a, id === 'hs' ? 'จบ ม.6 แล้ว! เรียนต่อปริญญาตรี หรือสอบนายสิบตำรวจได้' : 'ยินดีด้วย! จบปริญญาตรีแล้ว สมัครงานบริษัทได้ และเรียนต่อหมอได้', '🎓');
  }
  toast(a, `เรียนจบคาบที่ ${a.classes}/${L.classes} แล้ว นั่งต่อเพื่อเรียนคาบถัดไป`, '📖');
}
function fireCheck(a) {
  const o = a.office;
  if (o.strikes < 3 || Math.random() > 0.25 + 0.15 * (o.strikes - 3)) return false;
  standUp(a);
  a.career = 'none'; a.xp.office = 0; a.office = null; joy(a, -20); markMe(a); sendRoster();
  toast(a, 'คุณถูกเลิกจ้างเพราะมาสาย/ขาดงานบ่อย! ต้องไปสมัครงานใหม่ และเงินเดือนจะเริ่มนับใหม่', '📦', false);
  feed(`📦 ${a.name} ถูกบริษัทเลิกจ้าง`);
  return true;
}

// ------------------------------------------------------------------ careers
function jobCooldown(a) {
  if (godNoCd(a)) return 0;
  const t = now(), recent = (a.jobChanges || []).filter(x => t - x < 86400e3);
  if (!recent.length) return 0;
  const mins = D.JOB_COOLDOWN_MIN[Math.min(recent.length, D.JOB_COOLDOWN_MIN.length - 1)];
  return Math.max(0, Math.max(...recent) + mins * 60000 - t);
}
function apply(a, career) {
  const c = D.CAREERS[career]; if (!c || career === 'none') return;
  if (a.career === career) return toast(a, `คุณเป็น${c.name}อยู่แล้ว`, 'ℹ️', false);
  for (const l of c.need || []) if (!hasLic(a, l)) return toast(a, licExpired(a, l) ? `${D.LICENSES[l].name}หมดอายุแล้ว ต่ออายุที่มหาวิทยาลัยก่อน` : `ต้องมี${D.LICENSES[l].name}ก่อน (ที่มหาวิทยาลัย)`, '🎓', false);
  const wait = jobCooldown(a);
  if (wait > 0) return toast(a, `เพิ่งเปลี่ยนงานไป ต้องรออีก ${Math.ceil(wait / 60000)} นาทีถึงจะสมัครงานใหม่ได้`, '⏳', false);
  if (a.career === 'office') { a.xp.office = 0; a.office = null; }
  if (a.career !== 'none' || (a.jobChanges || []).length) a.jobChanges = [...(a.jobChanges || []).filter(x => now() - x < 86400e3), now()];
  else a.jobChanges = [now() - 86400e3 + 1000];             // the very first job does not count against you
  standUp(a); a.career = career; a.cast = null; markMe(a); sendRoster();
  feed(`💼 ${a.name} ได้งานเป็น${c.name}`);
  const tips = {
    office: 'เข้างาน 08:00 (สายได้ไม่เกิน 08:15) นั่งที่โต๊ะทำงานว่างตัวไหนก็ได้ ได้ค่าแรงตามชั่วโมงที่นั่ง เลิก 17:00',
    farmer: 'ซื้อสวนของตัวเองได้ที่ป้ายหน้าแปลงในไร่ แล้วเริ่มปลูกได้เลย',
    merchant: 'ซื้อของจากคลังสินค้าราคาส่ง แล้ววางขายที่ตลาดกลาง',
    chef: 'ซื้อวัตถุดิบจากผู้เล่นที่ตลาดกลาง แล้วมาปรุงที่ครัวใหญ่',
    doctor: `อยู่ในโรงพยาบาลช่วง ${hhmm(D.DOCTOR.start)}–${hhmm(D.DOCTOR.end)} ได้เงินเดือนทุกชั่วโมง + เดินไปที่เตียงคนไข้ วินิจฉัยจากอาการแล้วรักษา`,
    rider: 'เปิดแอพไรเดอร์ในมือถือ 📱 รับออเดอร์ ไปรับอาหารที่ร้านอาหาร แล้วไปส่งลูกค้า',
    police: 'ลาดตระเวนนอกอาคารได้เบี้ยเลี้ยง รับแจ้งเหตุ 191 แล้วตามจับโจรได้ค่าหัว',
    beggar: 'กดปุ่ม 🥣 เพื่อนั่งขอทานตรงไหนก็ได้ ที่คนพลุกพล่านได้เงินบ่อยกว่า',
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
  const l = fishLv(a), T = tier(a, 'fisher');
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
  if (a.down) return toast(a, a.down.kind === 'jail' ? 'คุณติดคุกอยู่ ทำอะไรไม่ได้' : 'คุณหมดสติอยู่ ทำอะไรไม่ได้', a.down.kind === 'jail' ? '⛓️' : '💤', false);
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 0.9) return toast(a, 'อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน', '⚠️', false);
  const h = hourNow();
  if (!D.isOpen(s.type, h)) { const o = D.HOURS[s.type]; return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
  const key = (s.type === 'door' && s.house !== undefined ? 'house' : s.type) + '.' + m.a;
  if (WORK.has(key) && depressed(a)) return toast(a, 'คุณซึมเศร้า ไม่มีจิตใจจะทำอะไรเลย... ลองกินของที่อยากกิน นั่งเล่นที่จัตุรัส หรือโทรคุยกับเพื่อน', '😞', false);
  const wb = wellbeing(a);
  if (m.a === 'apply') { if (s.type !== 'staff' && D.CAREERS[m.career]?.where !== s.type || s.type === 'staff' && s.career !== m.career) return; return apply(a, m.career); }
  switch (key) {
    // ---------------- getting around
    case 'gate.go': {
      const g = D.GATES[s.to]; if (!g || !cd(a, 'door', 1200, true)) return;
      return teleport(a, g.x, g.y);
    }
    case 'seat.sit': {
      for (const o of online.values()) if (o !== a && o.seat === s.id) return toast(a, 'ที่นั่งนี้มีคนนั่งแล้ว', '🪑', false);
      standUp(a); a.pose = 'seat'; a.seat = s.id; place(a, s.x, s.y); quest(a, 'sit'); sendRoster(); joy(a, 3);
      return toast(a, 'นั่งพักที่โต๊ะ พลังงานฟื้นเร็วขึ้น คุยกับคนรอบๆ ได้ (เดินเพื่อลุก)', '🪑');
    }
    // ---------------- beggars and pickpockets
    case 'begspot.beg': {
      if (!need(a, 'beggar')) return;
      if (a.pose === 'beg' && a.seat === s.id) { standUp(a); return toast(a, 'เลิกนั่งขอทานแล้ว', '🥣'); }
      for (const o of online.values()) if (o !== a && o.seat === s.id) return toast(a, 'จุดนี้มีคนนั่งแล้ว', '🥣', false);
      standUp(a); a.pose = 'beg'; a.seat = s.id; place(a, s.x, s.y); sendRoster(); markMe(a);
      return toast(a, 'นั่งขอทานแล้ว คนเดินผ่านจะหยอดเงินให้เป็นระยะ ผู้เล่นแตะที่ตัวคุณเพื่อบริจาคได้ (เดินเพื่อลุก)', '🥣');
    }
    case 'crowd.pick': {
      if (a.career === 'police') return toast(a, 'ตำรวจล้วงกระเป๋าไม่ได้!', '👮', false);
      if (!cd(a, 'crowd', 60000) || !spend(a, 8)) return;
      thiefMode(a);
      if (Math.random() < 0.6 + 0.08 * tier(a, 'thief')) {
        const amt = rint(20, 80); earn(a, amt); stat(a, 'stolen');
        if (Math.random() < 0.25) { const c = newCrime(a, '', amt); makeWanted(c, 'ชาวบ้านโทรแจ้ง'); return toast(a, `ล้วงได้ ${money(amt)} แต่มีชาวบ้านเห็นแล้วโทรแจ้งตำรวจ! รีบหลบไป`, '🚨', false); }
        return toast(a, `ล้วงกระเป๋าคนในฝูงชนได้ ${money(amt)}`, '🕶️');
      }
      if (Math.random() < 0.3) {
        const fine = Math.min(Math.floor(a.money), 100); a.money -= fine;
        standUp(a); a.down = { kind: 'jail', t: now(), until: now() + 60000 };
        const r = ROOM.r_police; place(a, r.x + 10.5, r.y + 7.8, true); joy(a, -15); markMe(a); sendRoster();
        feed(`👮 ${a.name} ถูกชาวบ้านจับได้คาหนังคาเขาขณะล้วงกระเป๋า`);
        return toast(a, `ถูกจับได้คาหนังคาเขา! ปรับ ${money(fine)} และติดคุก 1 นาที`, '⛓️', false);
      }
      return toast(a, 'ล้วงพลาด! คนรู้ตัวทัน รีบเดินหนีไป', '😰', false);
    }
    case 'bank.bills': return payBills(a);
    case 'fashion.buy': {
      const cat = D.LOOKS[m.cat], it = cat && cat[m.id]; if (!it) return;
      const W = a.wardrobe; if (W[m.cat].includes(m.id)) return wear(a, m);
      if (!pay(a, it.price)) return;
      W[m.cat] = [...W[m.cat], m.id]; joy(a, 8); wear(a, m);
      return toast(a, `ซื้อ${it.name}แล้ว ใส่ให้เลย!`, '💇');
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
          credit(o, Math.floor(L.price * 0.92));                     // 8% market fee
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
      const rate = s.type === 'market' ? NPC_BUY : 0.38;
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
      ate(a, m.item);
      markMe(a); quest(a, 'eat');
      return toast(a, `กิน${it.name} อิ่ม +${it.eat.hunger}`, it.icon);
    }
    case 'restaurant.buy': {                         // take-away: keep it in your bag for later
      const it = D.ITEMS[m.item]; if (!it || !it.menu) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 10);
      if (!pay(a, it.base * q)) return;
      addItem(a, m.item, q); markMe(a);
      return toast(a, `ซื้อ${it.icon}${it.name} x${q} ใส่กระเป๋าแล้ว ${money(it.base * q)} (กินได้ทุกเมื่อในกระเป๋า 🎒)`, '🥡');
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
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), cost = Math.ceil(D.ITEMS[id].base * 1.3) * q;
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
    case 'school.dtest': return startTest(a, 'driving', s);
    case 'school.ptest': return startTest(a, 'policeExam', s);
    case 'school.answer': {
      const T = a.dtest; if (!T) return;
      a.dtest = null;
      const ans = Array.isArray(m.ans) ? m.ans : [];
      const right = T.qs.filter((q, i) => +ans[i] === q.ok).length;
      if (right < T.qs.length) return toast(a, `สอบไม่ผ่าน ตอบถูก ${right}/${T.qs.length} ข้อ ต้องจ่ายค่าสอบใหม่`, '❌', false);
      if (!a.licenses.includes(T.lic)) a.licenses = [...a.licenses, T.lic];
      if (D.LICENSES[T.lic].renew) a.licExp = { ...(a.licExp || {}), [T.lic]: now() + LICENSE_YEAR };
      markMe(a); joy(a, 10);
      return toast(a, T.lic === 'driving' ? 'สอบใบขับขี่ผ่าน! สมัครไรเดอร์ได้แล้ว (ต้องต่ออายุทุกปีในเกม = ทุก 1 วันจริง)' : 'สอบนายสิบตำรวจผ่าน! ไปสมัครเป็นตำรวจได้ที่สถานีตำรวจ', T.lic === 'driving' ? '🪪' : '👮');
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
      const id = m.lic === 'hs' ? 'hs' : 'degree', L = D.LICENSES[id];
      if (a.licenses.includes(id)) return toast(a, `คุณจบ${L.name}แล้ว`, 'ℹ️', false);
      if (L.need && !a.licenses.includes(L.need)) return toast(a, `ต้องจบ${D.LICENSES[L.need].name}ก่อน`, '🎓', false);
      if (a.enrolled) return toast(a, `คุณกำลังเรียน${D.LICENSES[a.enrolled].name}อยู่ กด "เข้าเรียน" ได้เลย`, 'ℹ️', false);
      if (!pay(a, L.price)) return;
      a.enrolled = id; a.classes = 0; markMe(a);
      return toast(a, `ลงทะเบียนเรียน${L.name}แล้ว! ต้องเข้าเรียน ${L.classes} คาบ (คาบละ 1 ชั่วโมงในเกม)`, '🎓');
    }
    case 'school.class': return toast(a, 'เดินไปนั่งที่ 📖 โต๊ะเรียนตัวไหนก็ได้ นั่งเรียนครบ 1 ชั่วโมงในเกม = 1 คาบ', '📖');
    case 'sdesk.sit': {
      const id = a.enrolled; if (!id || !D.LICENSES[id]) return toast(a, 'ต้องลงทะเบียนเรียนที่เคาน์เตอร์มหาวิทยาลัยก่อน', '🎓', false);
      if (desks[s.idx] && desks[s.idx] !== a) return toast(a, 'โต๊ะนี้มีคนนั่งแล้ว', '📖', false);
      if (a.energy < 5) return toast(a, 'เหนื่อยเกินไป กินอะไรหรือพักก่อนค่อยมาเรียน', '😴', false);
      standUp(a); desks[s.idx] = a; a.desk = s.idx; a.pose = 'study'; place(a, s.x, s.y); sendRoster(); markMe(a);
      const L = D.LICENSES[id];
      return toast(a, `นั่งเรียน${L.name}แล้ว (คาบที่ ${(a.classes || 0) + 1}/${L.classes}) นั่งครบ 1 ชั่วโมงในเกมจะได้ 1 คาบ · เดินเพื่อลุก`, '📖');
    }
    case 'school.renew': {
      const L = D.LICENSES.driving;
      if (!(a.licenses || []).includes('driving')) return toast(a, 'ยังไม่มีใบขับขี่ ต้องสอบก่อน', '🪪', false);
      const left = (a.licExp?.driving || 0) - now();
      if (left > LICENSE_YEAR / 4) return toast(a, `ใบขับขี่ยังไม่หมดอายุ (ต่ออายุได้เมื่อเหลือไม่ถึง 3 เดือนในเกม)`, '🪪', false);
      if (!pay(a, L.renew)) return;
      a.licExp = { ...(a.licExp || {}), driving: Math.max(now(), a.licExp?.driving || 0) + LICENSE_YEAR }; markMe(a);
      return toast(a, `ต่ออายุใบขับขี่แล้ว ${money(L.renew)} ใช้ได้อีก 1 ปีในเกม`, '🪪');
    }
    case 'school.learn': {
      const l = D.LICENSES[m.lic]; if (!l || l.classes || l.test || l.where !== 'school') return;
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
      return toast(a, docs.length ? `นอนรอหมอแล้ว (หมอออนไลน์ ${docs.length} คน) ค่ารักษาประมาณ ฿300` : 'นอนรอหมอแล้ว ตอนนี้ไม่มีหมอผู้เล่น หมอเวร NPC จะเดินมารักษาให้ (~฿450)', '🛏️');
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
        let fee = 25;
        if (!pt.npc) { const f = Math.min(150, Math.floor(pt.money)); pt.money -= f; fee = f + 40; markMe(pt); toast(pt, `หมอ${a.name}ตรวจร่างกายให้ สุขภาพ +25`, '🩺'); }
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
      let fee = 55;
      if (pt.npc) pt.dz = pt.dz.filter(x => x !== target);
      else { cure(pt, target); const f = Math.min(300, Math.floor(pt.money)); pt.money -= f; fee = f + 60; markMe(pt); toast(pt, `หมอ${a.name}รักษา${DZ[target].name}หายแล้ว! (ค่ารักษา ${money(f)})`, '💉'); }
      pt.health = Math.min(100, pt.health + 20);
      const got = earn(a, fee * boost); addXp(a, 2); quest(a, 'treat'); stat(a, 'treated');
      if (!pt.dz.length) { if (pt.npc) beds[s.idx] = null; else standUp(pt); }
      wdAt = 0;
      if (!pt.npc) feed(`🩺 หมอ${a.name} รักษา${DZ[target].name}ให้ ${pt.name} สำเร็จ`);
      return toast(a, `วินิจฉัยถูกต้อง! รักษา${DZ[target].name}หาย ได้ ${money(got)}`, '💉');
    }
    // ---------------- fishing (anyone with a rod)
    case 'fishclub.info': return;
    case 'fishclub.rod': case 'staff.rod': {
      if (a.rod) return toast(a, 'คุณมีเบ็ดแล้ว (อัปเกรดได้ที่สมาคมประมงหรือร้านอุปกรณ์)', 'ℹ️', false);
      if (!pay(a, D.FISHING.rod)) return;
      a.rod = 1; markMe(a); joy(a, 4);
      return toast(a, `ได้เบ็ดตกปลาแล้ว! ไปที่ท่าตกปลา 🎣 แล้วเหวี่ยงเบ็ด รอปลากินเบ็ดแล้วกดให้ตรงจังหวะ`, '🎣');
    }
    case 'pier.cast': {
      if (!a.rod) return toast(a, `ต้องมีเบ็ดตกปลาก่อน — ซื้อได้ที่สมาคมประมง (${money(D.FISHING.rod)})`, '🎣', false);
      if (a.cast) return;
      if (!spend(a, 8)) return;
      const bite = now() + rnd(2500, 7000), T = tier(a, 'fisher');
      // timing game: a marker sweeps the bar; the catch zone is wider with a better rod and a higher level
      const w = D.FISHING.zone[T] + 0.008 * (fishLv(a) - 1), z0 = rnd(0.05, 0.95 - w);
      a.cast = { state: 'wait', bite, expire: bite + 5200, st: s.id, zone: [+z0.toFixed(3), +(z0 + w).toFixed(3)], speed: +rnd(0.75, 1.15).toFixed(2) }; markMe(a);
      return;
    }
    case 'pier.reel': {
      if (!a.cast) return;
      if (a.cast.state === 'wait') { a.cast = null; markMe(a); return toast(a, 'ดึงเร็วเกินไป ปลาตกใจหนีไปแล้ว', '💨', false); }
      const zone = a.cast.zone, pos = +m.pos;
      a.cast = null;
      if (!(pos >= zone[0] - 0.02 && pos <= zone[1] + 0.02)) { markMe(a); return toast(a, 'กดไม่ตรงจังหวะ ปลาหลุดไปแล้ว! ลองใหม่', '💨', false); }
      const before = fishLv(a);
      const id = rollFish(a, s.pool); a.xp.fisher = (a.xp.fisher || 0) + 1;
      if (fishLv(a) > before) {
        toast(a, `เลเวลตกปลาเพิ่มเป็น Lv.${fishLv(a)}!${fishLv(a) >= D.FISHING.maxLv ? '' : ` (เลเวลสูงสุด ${D.FISHING.maxLv} ได้ชุดนักตกปลา)`}`, '🎣');
        if (fishLv(a) >= D.FISHING.maxLv && !(a.outfits || []).includes('fisher')) {
          a.outfits = [...(a.outfits || []), 'fisher']; joy(a, 15);
          toast(a, 'ตกปลาถึงเลเวลสูงสุด! ได้รับรางวัล 🎽 ชุดนักตกปลา ใส่ได้ที่ ⚙️ ตั้งค่า → ชุด', '🏆');
          feed(`🎣 ${a.name} เป็นนักตกปลาระดับสูงสุด ได้รับชุดนักตกปลา!`);
        }
      }
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
      if (a.utilOff) return toast(a, 'ถูกตัดน้ำตัดไฟเพราะค้างค่าน้ำค่าไฟ! จ่ายบิลที่ธนาคารหรือในแอพมือถือก่อน', '🔌', false);
      if (!cd(a, 'homesleep', 120000)) return;
      const e = 50 + (own ? comfort(a) * 2 : 0);
      a.energy = Math.min(100, a.energy + e); a.health = Math.min(100, a.health + 5); sleepWell(a);
      a.usage = { sleep: (a.usage?.sleep || 0) + 1 }; joy(a, 6 + (own ? comfort(a) : 0));
      markMe(a);
      return toast(a, `นอนหลับสบาย พลังงาน +${e} หายง่วงแล้ว 😊`, '😴');
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
  ate(a, id);
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
  } else if (m.kind === 'phone') {
    if ((a.contacts || []).some(c => c.p === o.phone)) return toast(a, `มีเบอร์ ${o.name} อยู่แล้ว`, '📇', false);
    const ask = (a.phoneAsk || {})[o.login];
    if (ask && ask.until > now() && !godNoCd(a)) return toast(a, `${o.name} ปฏิเสธไป 2 ครั้งแล้ว ขอเบอร์คนนี้ได้อีกใน ${Math.ceil((ask.until - now()) / 60000)} นาที`, '⏳', false);
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
  if (r.kind === 'phone') return answerPhone(a, f, m.ok);
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

// asking someone for their number: yes saves both numbers; two no's in a row = 10 minutes before you can ask them again
function answerPhone(a, f, ok) {
  f.phoneAsk = f.phoneAsk || {};
  if (!ok) {
    const prev = f.phoneAsk[a.login] || { n: 0, until: 0 }, n = prev.until > now() ? 1 : prev.n + 1;
    f.phoneAsk[a.login] = n >= 2 ? { n: 0, until: now() + 10 * 60000 } : { n, until: 0 }; markMe(f);
    return toast(f, n >= 2 ? `${a.name} ไม่ให้เบอร์อีกแล้ว — ขอคนนี้ได้อีกใน 10 นาที` : `${a.name} ไม่ให้เบอร์`, '🙅', false);
  }
  delete f.phoneAsk[a.login];
  const add = (x, y) => { if (!(x.contacts || []).some(c => c.p === y.phone) && (x.contacts || []).length < 30) x.contacts = [...(x.contacts || []), { p: y.phone, n: y.name }]; markMe(x); };
  add(f, a); add(a, f);
  toast(f, `${a.name} ให้เบอร์แล้ว 📇 ${a.phone} (บันทึกในรายชื่อให้แล้ว)`, '📱'); toast(a, `แลกเบอร์กับ ${f.name} แล้ว (บันทึกในรายชื่อให้แล้ว)`, '📱');
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
  stat(f, 'calls'); joy(f, 8); joy(a, 8);
}
function endCall(a, why) {
  const c = a.call; if (!c) return;
  a.call = null; send(a, { t: 'call', open: false, why });
  if (c.peer.call?.peer === a) { c.peer.call = null; send(c.peer, { t: 'call', open: false, why: `${a.name} ${why}` }); }
}

function startTest(a, lic, s) {
  const L = D.LICENSES[lic];
  if (a.licenses.includes(lic)) return toast(a, `คุณมี${L.name}แล้ว`, 'ℹ️', false);
  if (L.need && !a.licenses.includes(L.need)) return toast(a, `ต้องจบ${D.LICENSES[L.need].name}ก่อนถึงจะสอบได้`, '🎓', false);
  if (!cd(a, 'dtest', 20000)) return;
  if (!pay(a, L.price)) { a.cd.dtest = 0; return; }
  const qs = [...(lic === 'driving' ? D.DRIVING_TEST : D.POLICE_TEST)].sort(() => Math.random() - .5).slice(0, 3);
  a.dtest = { lic, qs }; markMe(a);
  return send(a, { t: 'dtest', lic, st: s.id, title: L.name, qs: qs.map(q => ({ q: q.q, a: q.a })) });
}

// ------------------------------------------------------------------ happiness
const depressed = a => (a.happy ?? 80) < D.HAPPY.low;
function joy(a, n) {
  if (godLock(a)) { a.happy = 100; return; }
  const was = depressed(a);
  a.happy = clamp((a.happy ?? 80) + n, 0, 100); markMe(a);
  if (!was && depressed(a)) { toast(a, 'คุณรู้สึกซึมเศร้า ไม่มีจิตใจจะทำอะไร... ทำงานไม่ได้จนกว่าจะมีความสุขขึ้น', '😞', false); sendRoster(); }
  if (was && !depressed(a)) { toast(a, 'รู้สึกดีขึ้นแล้ว! กลับมามีแรงใจทำงาน', '😊'); sendRoster(); }
}
// things you can be craving: everything edible
const CRAVE = Object.keys(D.ITEMS).filter(k => D.ITEMS[k].eat && D.ITEMS[k].kind !== 'goods' || k === 'snack');
function ate(a, id) {
  joy(a, D.ITEMS[id].kind === 'meal' ? 3 : 1);
  if (a.craving && a.craving.item === id) {
    joy(a, D.HAPPY.crave); stat(a, 'cravings');
    toast(a, `ได้กิน${D.ITEMS[id].name}ที่อยากกินแล้ว! มีความสุขมาก 😋 (+${D.HAPPY.crave})`, '😋');
    a.craving = null; a.craveNext = now() + rnd(5, 10) * 60000;
  }
}
const WORK = new Set(['chair.sit', 'warehouse.buy', 'kitchen.cook', 'pier.cast', 'gplot.plant', 'gplot.harvest', 'bed.treat', 'bed.revive', 'restaurant.pickup', 'crowd.pick', 'sdesk.sit']);
function holdsHome(a) {
  if (a.house >= 0 && !tenants[a.house]) return a.house;
  if (a.rent && a.rent.until > now()) return a.rent.idx;
  return -1;
}
function moodTick(a, t, indoors) {
  // happiness drifts down; good things push it up, hardship pushes it down
  let d = -D.HAPPY.decay;
  if (a.hunger < 20) d -= 0.02;
  d -= 0.01 * (a.dz || []).length;
  if (a.down) d -= 0.02;
  if (a.utilOff) d -= 0.01;
  if (a.pose === 'seat') d += 0.09;
  if (a.pose === 'rest') d += 0.01;
  if (a.afk) d = Math.max(d, 0);                  // away from the screen: nothing drifts down
  if (a.call) d += 0.04;
  if (holdsHome(a) >= 0 && D.roomAt(a.x, a.y)?.house === holdsHome(a)) d += 0.03 + 0.005 * comfort(a);
  joy(a, d);
  // cravings: "I really want to eat X" (admins have no needs)
  if (!a.down && !godLock(a)) {
    if (!a.craving && t > (a.craveNext || 0)) {
      if (!a.craveNext) a.craveNext = t + rnd(1, 3) * 60000;
      else { const id = pick(CRAVE); a.craving = { item: id, until: t + 6 * 60000 }; send(a, { t: 'crave', item: id }); toast(a, `อยากกิน${D.ITEMS[id].icon}${D.ITEMS[id].name}จัง! กินภายใน 6 นาทีจะมีความสุขเพิ่มมาก`, '🤤'); markMe(a); }
    } else if (a.craving && t > a.craving.until) {
      toast(a, `ไม่ได้กิน${D.ITEMS[a.craving.item].name}ที่อยากกิน... เศร้าจัง`, '😔', false); joy(a, -5);
      a.craving = null; a.craveNext = t + rnd(5, 10) * 60000;
    }
  }
  // monthly water & electricity bills
  billUp(a);
  // begging: passers-by drop coins now and then
  if (a.pose === 'beg' && a.career === 'beggar' && Math.random() < 0.025 * (1 + BOOST[tier(a, 'beggar')]) * begSpot(a)) {
    const c = rint(2, 12); earn(a, c); stat(a, 'alms'); toast(a, `${pick(D.NPC_NAMES)} หยอดเงินให้ ${money(c)}`, '🪙');
  }
  // police on patrol (outside, on their feet) earn a small allowance
  if (a.career === 'police' && !indoors && !a.pose && t - (a.lastMoveT || 0) < 15000) {
    a.patrol = (a.patrol || 0) + D.POLICE.patrolWage / 60 * (1 + BOOST[tier(a, 'police')]);
    if (a.patrol >= D.POLICE.patrolWage) { earn(a, a.patrol); a.patrol = 0; }
  }
}

// how good a place is for begging: busy streets near shops > quiet corners > indoors; night is slow
function begSpot(a) {
  const area = areaId(a); if (area !== 'town' && area !== 'housing' && area !== 'farm') return 0.3;
  let m = area === 'town' ? 0.7 : 0.45;
  if (D.STATIONS.some(s => s.type === 'begspot' && Math.hypot(s.x - a.x, s.y - a.y) < 4)) m = 1.2;
  else if (D.STATIONS.some(s => (s.type === 'door' && s.house === undefined || s.type === 'crowd') && s.area === area && Math.hypot(s.x - a.x, s.y - a.y) < 6)) m = 1;
  const h = hourNow(); if (h >= 22 || h < 6) m *= 0.4;
  return m;
}

// ------------------------------------------------------------------ water & electricity (billed every in-game month)
function billUp(a) {
  const cur = D.monthIdx(now());
  if (a.billMonth == null) { a.billMonth = cur; return; }
  if (a.billMonth >= cur) return;
  let n = 0;
  while (a.billMonth < cur && n < 3) {
    a.billMonth++; n++;
    const home = holdsHome(a);
    // an unpaid bill from before last month: water and power get cut, plus a late fee
    for (const b of a.bills || []) if (!b.late && a.billMonth > b.m + 1) {
      b.late = true; const fee = Math.round((b.water + b.elec) * D.UTIL.lateFee); b.elec += fee; a.utilOff = true;
      toast(a, `ค้างค่าน้ำค่าไฟเกินกำหนด! ถูกตัดน้ำตัดไฟ + ค่าปรับ ${money(fee)} (นอนที่บ้านไม่ได้)`, '🔌', false); joy(a, -10);
    }
    if (home < 0) continue;
    const sl = Math.min(20, a.usage?.sleep || 0), cf = houses[home] === a ? comfort(a) : 0;
    const bill = { m: a.billMonth - 1, home, water: D.UTIL.water + D.UTIL.waterPerSleep * sl, elec: D.UTIL.elec + D.UTIL.elecPerComfort * cf + D.UTIL.elecPerSleep * sl };
    a.bills = [...(a.bills || []), bill]; a.usage = { sleep: 0 };
    const dt = D.MONTHS[(bill.m) % 12];
    toast(a, `📬 บิลค่าน้ำ ${money(bill.water)} + ค่าไฟ ${money(bill.elec)} ประจำเดือน${dt} มาแล้ว จ่ายภายในสิ้นเดือนหน้า (ธนาคาร / แอพมือถือ)`, '🧾');
  }
  a.billMonth = cur; markMe(a);
}
function payBills(a) {
  const due = (a.bills || []).reduce((s, b) => s + b.water + b.elec, 0);
  if (!due) return toast(a, 'ไม่มีบิลค้างจ่าย', '🧾');
  if (!pay(a, due)) return;
  a.bills = []; const was = a.utilOff; a.utilOff = false; markMe(a);
  toast(a, `จ่ายค่าน้ำค่าไฟ ${money(due)} เรียบร้อย${was ? ' — ต่อน้ำต่อไฟให้แล้ว' : ''}`, '🧾');
}

// ------------------------------------------------------------------ beggars, thieves and police
function donate(a, m) {
  if (a.down) return;
  const o = nearPlayer(a, m.to, 5);
  if (!o) return toast(a, 'เดินเข้าไปใกล้ก่อน', '⚠️', false);
  if (o.career !== 'beggar') return toast(a, `${o.name} ไม่ได้เป็นขอทาน`, '⚠️', false);
  const amt = clamp(Math.floor(+m.amt) || 0, 1, 100000);
  if (!pay(a, amt)) return;
  earn(o, amt); stat(o, 'alms'); stat(a, 'donated'); joy(o, 4);
  const j = Math.min(D.HAPPY.donateMax, 4 + Math.floor(amt / 15)); joy(a, j);
  toast(a, `บริจาค ${money(amt)} ให้ ${o.name} อิ่มบุญ มีความสุข +${j}`, '🙏'); toast(o, `${a.name} บริจาคให้คุณ ${money(amt)}`, '🙏');
  if (amt >= 500) feed(`🙏 ${a.name} ใจบุญ บริจาคให้ขอทาน ${money(amt)}`);
}
const crimes = new Map();               // id -> crime
let crimeSeq = 1;
function newCrime(thief, victim, amt) {
  const c = { id: crimeSeq++, thief, thiefName: thief.name, victim, amt, t: now(), x: thief.x, y: thief.y, area: areaId(thief), reported: 0 };
  crimes.set(c.id, c); thief.crimes = [...(thief.crimes || []).filter(x => now() - x.t < 10 * 60000), { id: c.id, amt, victim, t: c.t }];
  return c;
}
function makeWanted(c, by) {
  if (!c || c.reported) { if (c) c.thief.wanted = now() + D.POLICE.wantedMin * 60000; return; }
  c.reported = now(); c.x = c.thief.x; c.y = c.thief.y; c.area = areaId(c.thief);
  c.thief.wanted = now() + D.POLICE.wantedMin * 60000; c.thief.sd = true; sendRoster();
  for (const p of online.values()) if (p.career === 'police') { toast(p, `🚨 แจ้งเหตุ 191: ${c.thiefName} ล้วงกระเป๋า${c.victim ? ` ${c.victim}` : ''} (${by}) ดูตำแหน่งบนแผนที่ตำรวจ`, '🚨'); markMe(p); }
}
// pickpocketing is a side activity anyone (but the police) can try; you pull on the thief outfit while doing it
function thiefMode(a) {
  const was = a.thiefUntil > now();
  a.thiefUntil = now() + D.POLICE.outfitMin * 60000;
  if (!was) sendRoster();
}
function steal(a, m) {
  if (a.down) return;
  if (a.career === 'police') return toast(a, 'ตำรวจล้วงกระเป๋าไม่ได้!', '👮', false);
  if (depressed(a)) return toast(a, 'ไม่มีจิตใจจะทำอะไร...', '😞', false);
  if (+m.to < 0) return stealNpc(a, +m.to);
  const o = nearPlayer(a, m.to, 1.8);
  if (!o) return toast(a, 'ต้องเข้าไปใกล้ๆ เป้าหมาย (ประชิดตัว)', '🕶️', false);
  if (godLock(o)) return toast(a, `${o.name} ระวังตัวแจ ล้วงไม่ได้`, '👑', false);
  if (o.down) return toast(a, 'เป้าหมายไม่อยู่ในสภาพที่จะล้วงได้', '🕶️', false);
  if (!cd(a, 'steal', 45000) || !spend(a, 8)) return;
  thiefMode(a);
  let chance = 0.55 + 0.1 * tier(a, 'thief') + (o.pose ? 0.2 : 0) - (o.career === 'police' ? 0.35 : 0);
  const ok = Math.random() < chance;
  let c = null;
  if (ok) {
    const amt = Math.min(600, Math.floor(o.money * rnd(0.05, 0.14)));
    if (amt < 10) return toast(a, `กระเป๋า${o.name}ว่างเปล่า ไม่มีอะไรให้ล้วง`, '🕶️', false);
    o.money -= amt; earn(a, amt); stat(a, 'stolen'); markMe(o); joy(o, -15);
    c = newCrime(a, o.name, amt);
    toast(a, `ล้วงกระเป๋า ${o.name} สำเร็จ ได้ ${money(amt)} รีบหนีไปก่อนมีคนแจ้งตำรวจ!`, '🕶️');
    send(o, { t: 'robbed', amt, crime: c.id, thief: null });
    toast(o, `กระเป๋าเบาลง! มีคนล้วงเงินคุณไป ${money(amt)}`, '😱', false);
  } else {
    c = newCrime(a, o.name, 0);
    toast(a, `${o.name} รู้ตัว! ล้วงไม่สำเร็จ รีบหนี!`, '😰', false);
    send(o, { t: 'robbed', amt: 0, crime: c.id, thief: a.name });
  }
  // anyone close enough sees it; police who see it can arrest right away
  for (const w of online.values()) {
    if (w === a || areaId(w) !== areaId(a) || dist(w, a) > 7) continue;
    if (w.career === 'police') { makeWanted(c, `ตำรวจ ${w.name} เห็นเหตุการณ์`); toast(w, `คุณเห็น ${a.name} ล้วงกระเป๋า ${o.name}! แตะที่ตัวโจรเพื่อจับกุม`, '👮'); }
    else if (w !== o) send(w, { t: 'witness', crime: c.id, thief: a.name, victim: o.name });
  }
}
function report(a, m) {
  // reporting someone you saw in the thief outfit (from their profile): their latest crime
  if (m.thief != null && m.crime == null) {
    const th = online.get(+m.thief);
    const last = th && [...crimes.values()].filter(c => c.thief === th && now() - c.t < 10 * 60000).sort((x, y) => y.t - x.t)[0];
    if (!last) return toast(a, th && th.thiefUntil > now() ? `ยังไม่มีหลักฐานว่า ${th.name} ล้วงกระเป๋าใคร` : 'ไม่มีเหตุให้แจ้ง', '📵', false);
    m = { crime: last.id };
  }
  const c = crimes.get(+m.crime);
  if (!c || now() - c.t > 10 * 60000) return toast(a, 'เหตุการณ์นี้นานเกินไปแล้ว', '📵', false);
  if (!cd(a, 'report', 5000, true)) return;
  const cops = [...online.values()].filter(p => p.career === 'police').length;
  makeWanted(c, `${a.name} โทรแจ้ง`);
  toast(a, `📞 191 รับแจ้งแล้ว ${cops ? `ตำรวจออนไลน์ ${cops} นาย และ` : ''}สายตรวจ NPC กำลังตามตัว ${c.thiefName}`, '🚓');
}
function arrest(a, m) {
  if (a.down || a.career !== 'police') return;
  if (depressed(a)) return toast(a, 'ไม่มีจิตใจจะทำอะไร...', '😞', false);
  const o = nearPlayer(a, m.to, 2);
  if (!o) return toast(a, 'ต้องเข้าไปใกล้ผู้ต้องสงสัยก่อน', '👮', false);
  if (godLock(o)) return toast(a, `${o.name} มีภูมิคุ้มกัน`, '👑', false);
  if (!(o.wanted > now())) return toast(a, `ไม่มีหลักฐานหรือการแจ้งความเกี่ยวกับ ${o.name} จับไม่ได้`, '👮', false);
  if (!cd(a, 'arrest', 3000)) return;
  const back = jail(o, `ตำรวจ${a.name}`);
  const got = earn(a, D.POLICE.bounty * (1 + BOOST[tier(a, 'police')]) + Math.max(0, back) * 0.3); stat(a, 'arrests'); addXp(a, 2); joy(a, 6);
  return toast(a, `จับกุม ${o.name} สำเร็จ! ได้ค่าหัว ${money(got)}`, '👮');
}
// fine the thief, give the loot back to the victims and lock them up; returns what is left of the fine
function jail(o, by) {
  const recent = (o.crimes || []).filter(c => now() - c.t < 10 * 60000);
  const stolen = recent.reduce((s, c) => s + c.amt, 0);
  const fine = Math.min(Math.floor(o.money), stolen + D.POLICE.fineBase);
  o.money -= fine;
  // give the loot back to the victims
  let back = fine;
  for (const c of recent) { const v = byName(c.victim); const r = Math.min(back, c.amt); if (v && r > 0) { credit(v, r); back -= r; if (v.ws) toast(v, `${by}จับ${o.name}ได้ คืนเงินที่ถูกล้วง ${money(r)}`, '👮'); } }
  for (const c of recent) crimes.delete(c.id);
  o.crimes = []; o.wanted = 0; o.thiefUntil = 0;
  standUp(o); o.cast = null; if (o.trade) tradeClose(o.trade, `${o.name} ถูกจับ`);
  o.down = { kind: 'jail', t: now(), until: now() + D.POLICE.jailSec * 1000 };
  const r = ROOM.r_police; place(o, r.x + 10.5, r.y + 7.8, true); joy(o, -20); markMe(o); sendRoster();
  toast(o, `ถูก${by}จับกุม! ปรับ ${money(fine)} และติดคุก ${Math.round(D.POLICE.jailSec / 60 * 10) / 10} นาที`, '⛓️', false);
  feed(`👮 ${by} จับกุม ${o.name} ข้อหาล้วงกระเป๋า`);
  return back;
}

// ------------------------------------------------------------------ looks
function wear(a, m) {
  const cat = m.cat; if (!D.LOOKS[cat]) return;
  if (m.id && !a.wardrobe[cat].includes(m.id)) return toast(a, 'ยังไม่มีชิ้นนี้ ซื้อที่ร้านแฟชั่นก่อน', '💇', false);
  if (!m.id) return;
  a.look = { ...a.look, [cat]: m.id || '' }; markMe(a); sendRoster();
}

// ------------------------------------------------------------------ NPCs: townsfolk, job workers, the patrol and the hospital doctor
// All NPCs walk tile paths (BFS inside their own area). Townsfolk wander the village; a worker NPC for every job
// shows up and does that job whenever no player in that job is online; the patrol chases reported thieves.
const npcs = [];
const walkCache = {};
function walkableIn(areaId) {
  if (walkCache[areaId]) return walkCache[areaId];
  const A = D.AREAS.find(r => r.id === areaId), out = [];
  for (let y = A.y + 1; y < A.y + A.h - 1; y++) for (let x = A.x + 1; x < A.x + A.w - 1; x++) if (!D.blocked(x + .5, y + .5) && D.TILES[y][x] !== 'D') out.push([x, y]);
  return (walkCache[areaId] = out);
}
// shortest tile walk from n to goal [x, y] inside area A (null = unreachable)
function routeTo(n, goal, areaId) {
  const A = D.AREAS.find(r => r.id === areaId), sx = Math.floor(n.x), sy = Math.floor(n.y), gx = Math.floor(goal[0]), gy = Math.floor(goal[1]);
  const key = (x, y) => y * D.W + x, prev = new Map([[key(sx, sy), -1]]), q = [[sx, sy]];
  for (let h = 0; h < q.length && q.length < 12000; h++) {
    const [x, y] = q[h]; if (x === gx && y === gy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || nx < A.x || ny < A.y || nx >= A.x + A.w || ny >= A.y + A.h || D.blocked(nx + .5, ny + .5)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return null;
  const out = []; let k = key(gx, gy);
  while (k !== -1) { out.push([k % D.W + .5, Math.floor(k / D.W) + .5]); k = prev.get(k); }
  out.reverse(); out.shift();
  if (out.length) out[out.length - 1] = [goal[0], goal[1]];
  return out;
}
const HAIRS = Object.keys(D.LOOKS.hair), SH = Object.keys(D.LOOKS.shirt), PA = Object.keys(D.LOOKS.pants);
const randLook = () => ({ hair: pick(['brown', 'brown', 'black', 'black', ...HAIRS]), shirt: pick(SH), pants: pick(PA) });
let npcRosterDirty = false;
{
  const spots = D.STATIONS.filter(s => s.area === 'town' && /^(door|seat|begspot|crowd|pier|square|fishclub)$/.test(s.type)).map(s => [Math.floor(s.x) + .5, Math.floor(s.y + (s.type === 'door' ? .6 : 0)) + .5]).filter(([x, y]) => !D.blocked(x, y));
  for (let i = 0; i < 12; i++) {
    const [x, y] = pick(walkableIn('town'));
    npcs.push({ id: -(i + 1), folk: 1, name: D.NPC_NAMES[i % D.NPC_NAMES.length], area: 'town', x: x + .5, y: y + .5, f: 6, path: [], wait: rnd(0, 4),
      g: i % 2 ? 'f' : 'm', look: randLook(), speed: rnd(1.1, 1.6), pickedAt: 0,
      next: () => Math.random() < .7 ? pick(spots) : pick(walkableIn('town')).map(v => v + .5), stay: () => rnd(4, 14) });
  }
}
// worker NPCs: where they walk and what they do there (only while no player has that job)
const ST_XY = id => { const s = ST[id]; return s ? [s.x, s.y] : null; };
const roomPts = (rid, pts) => { const r = ROOM[rid]; return pts.map(([dx, dy]) => [r.x + dx, r.y + dy]).filter(([x, y]) => !D.blocked(x, y)); };
const WORKERS = [
  { career: 'office', name: 'คุณเก่ง (พนักงาน)', area: 'r_office', look: { hair: 'black', shirt: 'white', pants: 'black' },
    pts: () => D.STATIONS.filter(s => s.type === 'chair' && !chairs[s.idx]).map(s => [s.x, s.y]), pose: () => (hourNow() >= D.SHIFT.start && hourNow() < D.SHIFT.end ? 'chair' : null), stay: () => rnd(40, 90) },
  { career: 'farmer', name: 'ลุงสม (ชาวไร่)', area: 'farm', pts: () => D.STATIONS.filter(s => s.type === 'gplot' && !lots[s.lot]).map(s => [s.x, s.y + 1.1]).filter(([x, y]) => !D.blocked(x, y)), stay: () => rnd(6, 12) },
  { career: 'merchant', name: 'เจ๊หมวย (แม่ค้า)', area: 'r_market', pts: () => roomPts('r_market', [[7, 3.4], [4, 4.6], [10, 4.6], [7, 7.6]]), stay: () => rnd(5, 12) },
  { career: 'chef', name: 'เชฟต้อม', area: 'r_kitchen', pts: () => roomPts('r_kitchen', [[4.9, 3.4], [9.6, 3.4], [7, 3.4], [7, 5.4]]), stay: () => rnd(4, 9) },
  { career: 'doctor', name: 'หมอแนน (แพทย์เวร)', area: 'r_hospital', always: true, pts: () => D.STATIONS.filter(s => s.type === 'bed').map(s => [s.x, s.y + .95]).concat(roomPts('r_hospital', [[5, 5]])).filter(([x, y]) => !D.blocked(x, y)), stay: () => rnd(4, 8), job: npcDoctor },
  { career: 'rider', name: 'พี่บอย (ไรเดอร์)', area: 'town', pts: () => [ST_XY('door_restaurant'), ...D.STATIONS.filter(s => s.type === 'door' && s.area === 'town' && s.house === undefined).map(s => [s.x, s.y + .3])].filter(p => p && !D.blocked(p[0], p[1])), stay: () => rnd(3, 6), speed: 2.4 },
  { career: 'beggar', name: 'ตาผล (ขอทาน)', area: 'town', pts: () => D.STATIONS.filter(s => s.type === 'begspot' && ![...online.values()].some(o => o.seat === s.id)).map(s => [s.x, s.y]), pose: () => 'beg', stay: () => rnd(60, 160) },
  { career: 'police', name: 'ดาบชัย (สายตรวจ)', area: 'town', always: true, cop: true, pts: () => D.STATIONS.filter(s => s.area === 'town' && /^(crowd|begspot|door)$/.test(s.type) && s.house === undefined).map(s => [s.x, s.y + (s.type === 'door' ? .3 : 0)]).filter(([x, y]) => !D.blocked(x, y)), stay: () => rnd(4, 10), speed: 1.6 },
];
WORKERS.forEach((w, i) => {
  const [x, y] = pick(w.pts().length ? w.pts() : walkableIn(w.area).map(p => [p[0] + .5, p[1] + .5]));
  npcs.push({ id: -(100 + i), worker: w, name: w.name, c: w.career, area: w.area, x, y, f: 6, path: [], wait: rnd(0, 3), on: false,
    g: i % 3 ? 'm' : 'f', look: { ...randLook(), ...(w.look || {}) }, speed: w.speed || 1.3, pose: null,
    next: () => { const p = w.pts(); return p.length ? pick(p) : null; }, stay: w.stay });
});
const workerOn = n => !!n.worker && (n.worker.always || ![...online.values()].some(a => a.career === n.worker.career && !a.down));
// the NPC doctor: treats waiting patients when no player doctor is around
function npcDoctor(n) {
  if (n.busyT > now() || [...online.values()].some(a => a.career === 'doctor' && !a.down)) return;   // player doctors get the patients
  const i = beds.findIndex(b => b && (b.npc || !b.down && (b.dz || []).length) && Math.hypot(ST['bed' + beds.indexOf(b)].x - n.x, ST['bed' + beds.indexOf(b)].y + .95 - n.y) < 1.6);
  if (i < 0) return;
  const pt = beds[i]; n.busyT = now() + 9000;
  if (pt.npc) { if (Math.random() < .5) { beds[i] = null; wdAt = 0; } else pt.health = Math.min(100, pt.health + 20); return; }
  const d = pt.dz[0], fee = Math.min(450, Math.floor(pt.money));
  pt.money -= fee; cure(pt, d); pt.health = Math.min(100, pt.health + 15); markMe(pt);
  toast(pt, `${n.name} รักษา${DZ[d].name}ให้แล้ว ค่ารักษา ${money(fee)} (หมอผู้เล่นถูกกว่า)`, '🩺');
  if (!(pt.dz || []).length) standUp(pt);
}
// the patrol: chases the nearest reported thief in town and arrests on contact
function copTick(n) {
  const t = now();
  const wanted = [...online.values()].filter(a => a.wanted > t && !a.down && areaId(a) === 'town');
  const tgt = wanted.sort((x, y) => dist(x, n) - dist(y, n))[0];
  if (!tgt) { if (n.chase) { n.chase = null; n.speed = n.worker.speed; n.path = []; } return; }
  if (n.chase !== tgt) { n.chase = tgt; n.repath = 0; n.wait = 0; n.say = '🚨 หยุดนะ! ตำรวจ!'; toast(tgt, `🚓 ${n.name} กำลังวิ่งไล่จับคุณ! หนีเข้าตึกหรือออกนอกเมือง`, '🚨', false); }
  n.speed = D.POLICE.npcSpeed * (0.97 + 0.03 * Math.sin(t / 900));
  if (dist(tgt, n) < 0.9) {
    if (godLock(tgt)) return;
    jail(tgt, n.name); n.chase = null; n.speed = n.worker.speed; n.path = []; n.wait = 3; return;
  }
  if (t > (n.repath || 0)) { n.repath = t + 700; n.path = routeTo(n, [tgt.x, tgt.y], 'town') || []; n.wait = 0; }
}
function npcTick(dt, ps) {
  for (const n of npcs) {
    if (n.worker) {
      const on = workerOn(n);
      if (on !== n.on) { n.on = on; npcRosterDirty = true; if (!on) { n.chase = null; n.pose = null; } }
      if (!on) continue;
      if (n.worker.cop) copTick(n);
      if (n.worker.job && !n.path.length) n.worker.job(n);
    }
    if (n.wait > 0) { n.wait -= dt; if (n.say && Math.random() < dt / 20) n.say = null; continue; }
    if (!n.path.length) {
      if (n.pose) { n.pose = null; npcRosterDirty = true; }
      const goal = n.next(); n.path = goal ? routeTo(n, goal, n.area) || [] : [];
      n.wait = n.path.length ? 0 : 2; if (!n.path.length) continue;
    }
    const [tx, ty] = n.path[0], dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy), st = n.speed * dt;
    if (d <= st) {
      n.x = tx; n.y = ty; n.path.shift();
      if (!n.path.length && !n.chase) { n.wait = n.stay(); const pose = n.worker?.pose?.(); if (pose) { n.pose = pose; n.f = 6; npcRosterDirty = true; } }
    } else { n.x += dx / d * st; n.y += dy / d * st; }
    if (d > 0.01) n.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8;
    ps.push([n.id, +n.x.toFixed(2), +n.y.toFixed(2), n.f]);
  }
  if (npcRosterDirty) { npcRosterDirty = false; sendRoster(); }
  // now and then a villager near someone says something (bubble over their head)
  if (Math.random() < dt / 12) {
    const n = pick(npcs.filter(x => x.folk)), near = [...online.values()].filter(o => areaId(o) === 'town' && dist(o, n) <= 14);
    if (near.length) { const msg = { t: 'chat', id: n.id, name: n.name, text: pick(D.NPC_LINES), ts: now(), npc: 1 }; near.forEach(o => send(o, msg)); }
  }
  for (const n of npcs) if (n.say && n.chase) {
    const near = [...online.values()].filter(o => areaId(o) === 'town' && dist(o, n) <= 14);
    const msg = { t: 'chat', id: n.id, name: n.name, text: n.say, ts: now(), npc: 1 }; near.forEach(o => send(o, msg)); n.say = null;
  }
}
const npcVisible = n => !n.worker || n.on;
const npcInfo = n => ({ id: n.id, npc: 1, name: n.name, c: n.c || 'none', lv: 1, dz: [], pose: n.pose || null, g: n.g, lk: n.look, x: n.x, y: n.y, f: n.f, title: '',
  of: n.c && D.CAREERS[n.c] ? n.c : '', wk: n.worker ? 1 : 0 });
function stealNpc(a, id) {
  const n = npcs.find(x => x.id === id && x.folk);
  if (!n || areaId(a) !== 'town' || Math.hypot(a.x - n.x, a.y - n.y) > 1.8) return toast(a, 'ต้องเข้าไปใกล้ๆ เป้าหมาย (ประชิดตัว)', '🕶️', false);
  if (now() - n.pickedAt < 5 * 60000) return toast(a, `${n.name} ระวังตัวแจ ล้วงไม่ได้ (เพิ่งโดนล้วงไป)`, '🕶️', false);
  if (!cd(a, 'steal', 45000) || !spend(a, 8)) return;
  n.pickedAt = now(); thiefMode(a);
  if (Math.random() < 0.6 + 0.08 * tier(a, 'thief')) {
    const amt = rint(15, 60); earn(a, amt); stat(a, 'stolen');
    if (Math.random() < 0.3) { const c = newCrime(a, n.name, amt); makeWanted(c, `${n.name} ร้องโวยวาย`); return toast(a, `ล้วงได้ ${money(amt)} แต่${n.name}รู้ตัวแล้วโทรแจ้งตำรวจ!`, '🚨', false); }
    return toast(a, `ล้วงกระเป๋า${n.name}ได้ ${money(amt)}`, '🕶️');
  }
  const c = newCrime(a, n.name, 0); makeWanted(c, `${n.name} จับได้ว่าถูกล้วง`);
  return toast(a, `${n.name} จับได้! ร้องเรียกตำรวจแล้ว รีบหนี!`, '😰', false);
}

// ------------------------------------------------------------------ public views
// what you are wearing: the thief outfit while pickpocketing, else a reward outfit you picked, else your job's clothes (unless hidden)
function outfitOf(a) {
  if (a.thiefUntil > now()) return 'thief';
  if (a.outfit && (a.outfits || []).includes(a.outfit)) return a.outfit;
  if (!a.hideJob && D.CAREERS[a.career]?.where) return a.career;
  return '';
}
function pubInfo(a) {
  return { id: a.id, name: a.name, av: a.avatar, c: a.career, lv: lvl(a), dz: (a.dz || []).map(d => DZ[d].icon),
    pose: a.down ? a.down.kind : a.pose, title: titleOf(a), w: a.wanted > now() ? 1 : 0, sad: depressed(a) ? 1 : 0, g: a.gender, lk: a.look, adm: isAdmin(a) ? 1 : 0,
    of: outfitOf(a), th: a.thiefUntil > now() ? 1 : 0, afk: a.afk ? 1 : 0 };
}
function sendRoster() { broadcast({ t: 'roster', players: [...online.values()].map(a => ({ ...pubInfo(a), x: a.x, y: a.y, f: a.f })).concat(npcs.filter(npcVisible).map(npcInfo)) }); }
function meView(a) {
  const isRider = a.career === 'rider';
  const myOrders = [...orders.values()].filter(o => o.cust === a).map(orderView);
  const jobs = isRider ? [...orders.values()].filter(o => o.state === 'open' || o.rider === a).map(o => ({ ...orderView(o), mine: o.rider === a, custId: o.cust?.id || 0 })) : [];
  return {
    t: 'me', id: a.id, name: a.name, avatar: a.avatar, x: +a.x.toFixed(2), y: +a.y.toFixed(2), money: Math.round(a.money), energy: a.energy, hunger: a.hunger, health: a.health,
    career: a.career, licenses: a.licenses, lv: lvl(a), xp: a.xp, inv: a.inv, phone: a.phone, contacts: a.contacts || [],
    tools: a.tools, house: a.house, furniture: a.furniture, comfort: comfort(a), speed: speedOf(a), rent: a.rent, houseSale: a.houseSale, houseRent: a.houseRent,
    bank: Math.floor(a.bank), loan: Math.ceil(a.loan), listings: a.listings || [], dz: a.dz || [], awake: Math.floor(a.awake || 0), bed: a.bed ?? -1, chair: a.chair,
    pose: a.pose, down: a.down, cast: a.cast ? { state: a.cast.state, zone: a.cast.state === 'bite' ? a.cast.zone : null, speed: a.cast.speed } : null, garden: a.garden, enrolled: a.enrolled, classes: a.classes || 0,
    office: a.office ? { strikes: a.office.strikes, day: a.office.day, late: a.office.late, hours: +(a.office.hours || 0).toFixed(2), closed: a.office.closed } : null,
    gender: a.gender, look: a.look, wardrobe: a.wardrobe, admin: isAdmin(a), god: isAdmin(a) ? (a.god || {}) : null,
    run: !!a.run, rod: a.rod || 0, fishLv: fishLv(a), fishXp: a.xp?.fisher || 0, hideJob: !!a.hideJob, outfit: a.outfit || '', outfits: a.outfits || [], wearing: outfitOf(a),
    licExp: a.licExp || {}, desk: a.desk ?? -1, study: a.school ? +(a.school.p || 0).toFixed(3) : 0,
    docShift: a.career === 'doctor' && a.doc ? { day: a.doc.day, hours: +(a.doc.hours || 0).toFixed(2) } : null,
    friends: (a.contacts || []).map(c => { const o = byPhone.get(c.p); return { p: c.p, n: o ? o.name : c.n, on: !!(o && o.ws), afk: !!(o && o.afk), where: o && o.ws ? (D.areaAt(o.x, o.y)?.name || D.areaAt(o.x, o.y)?.label || '') : '' }; }),
    happy: a.happy, craving: a.craving, bills: a.bills || [], utilOff: !!a.utilOff, home: holdsHome(a), date: D.dateAt(now()), month: D.monthIdx(now()),
    reports: a.career === 'police' ? [...crimes.values()].filter(c => c.reported && now() - c.reported < D.POLICE.wantedMin * 60000).map(c => ({ id: c.id, thief: c.thiefName, victim: c.victim, amt: c.amt, x: c.x, y: c.y, area: c.area, t: c.reported, tid: c.thief.id || 0 })) : [],
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
const byName = n => { n = String(n || '').toLowerCase(); for (const a of accounts.values()) if (a.name.toLowerCase() === n) return a; return null; };
function login(ws, m) {
  // m.name is the login ID; the character's display name (a.name) is chosen once at creation
  const name = cleanText(m.name, 16);
  if (!accounts.has(name.toLowerCase())) {     // new IDs: English letters and digits only (older Thai IDs still log in)
    if (/[^\x20-\x7e]/.test(name)) return fail(ws, 'ID ใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น (A-Z, 0-9, _ - .)');
    if (!/^[A-Za-z0-9_.-]{2,16}$/.test(name)) return fail(ws, 'ID ต้องยาว 2-16 ตัว ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข และ _ - . (ห้ามเว้นวรรค)');
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
      return fail(ws, 'ID นี้มีคนใช้แล้ว หรือ PIN ไม่ถูกต้อง');
    }
    loginFails.delete('n:' + lname);
    if (a.ws) { send(a, { t: 'kicked', msg: 'มีการเข้าสู่ระบบจากที่อื่น' }); a.ws.close(); detach(a); }
  } else {
    // a brand-new ID: the client first shows the one-time character creator, then logs in again with create:1
    if (!m.create) return ws.send(JSON.stringify({ t: 'newchar', name }));
    const cname = String(m.cname ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!/^[\p{L}\p{M}\p{N}_. -]{2,16}$/u.test(cname)) return send({ ws }, { t: 'loginfail', msg: 'ชื่อตัวละครต้องยาว 2-16 ตัว (ไทย/อังกฤษ/ตัวเลข)', create: 1 });
    if (byName(cname)) return send({ ws }, { t: 'loginfail', msg: `ชื่อตัวละคร "${cname}" มีคนใช้แล้ว`, create: 1 });
    if (impersonates(cname)) return send({ ws }, { t: 'loginfail', msg: 'ห้ามตั้งชื่อเลียนแบบแอดมินหรือทีมงาน ลองชื่ออื่นนะ', create: 1 });
    const salt = crypto.randomBytes(8).toString('hex');
    const sh = D.SHIRTS.includes(m.shirt) ? m.shirt : 'white';
    a = hydrate({ v: VERSION, login: name, name: cname, salt, hash: hashPin(pin, salt), avatar: D.SHIRTS.indexOf(sh), gender: m.gender === 'f' ? 'f' : 'm',
      look: { hair: 'brown', shirt: sh, pants: 'gray' }, wardrobe: { hair: ['brown'], shirt: [sh], pants: ['gray'] } });
    accounts.set(lname, a); isNew = true;
  }
  Q.ensure(a);
  const daily = dailyLogin(a);
  a.ws = ws; ws.acct = a; a.id = nextId++; a.lastPosT = now(); a.moved = true; a.loginAt = now();
  if (!D.areaAt(a.x, a.y) || D.blocked(a.x, a.y)) { a.x = D.SPAWN.x; a.y = D.SPAWN.y; }
  if (a.down && a.down.kind === 'jail') { const r = ROOM.r_police; a.x = r.x + 10.5; a.y = r.y + 7.8; }
  if (a.down && a.down.kind === 'hosp') { a.down = null; a.health = Math.max(a.health, 25); a.x = ROOM.r_hospital.spawn.x; a.y = ROOM.r_hospital.spawn.y; }
  a.afk = false; a.fixId = 0; a.mvb = moveCap(a);
  online.set(a.id, a);
  dirty = true;
  setTimeout(() => a.ws === ws && billUp(a), 1500);
  send(a, {
    t: 'init', id: a.id,
    map: { w: D.W, h: D.H, tiles: D.TILES, buildings: D.BUILDINGS }, stations: D.STATIONS, areas: D.AREAS, looks: D.LOOKS, shirts: D.SHIRTS, solid: D.SOLID,
    items: D.ITEMS, cats: D.CATEGORIES, crops: D.CROPS, recipes: D.RECIPES, careers: D.CAREERS, licenses: D.LICENSES,
    titles: D.OFFICE_TITLES, wages: D.OFFICE_WAGE, speed: SPEED, clock: D.CLOCK, run: D.RUN, build: BUILD, fishing: D.FISHING, outfitDefs: D.OUTFITS, doctor: D.DOCTOR, adminName: ADMIN_NAME, radius: D.RADIUS, chat: chatLog.slice(-25), isNew, dayMs: D.DAY_MS, hours: D.HOURS, shift: D.SHIFT, months: D.MONTHS, monthDays: D.MONTH_DAYS,
    props: D.PROPS, trees: D.TREES, lotsDef: D.LOTS, garden: D.GARDEN, diseases: D.DISEASES, treatments: D.TREATMENTS, ach: D.ACHIEVEMENTS, fish: D.FISH,
    shop: { tools: D.TOOLS, toolPrices: D.TOOL_PRICES, housePrices: D.HOUSE_PRICES, houseRent: D.HOUSE_RENT, furniture: D.FURNITURE, bank: D.BANK },
  });
  send(a, meView(a)); send(a, worldView());
  if (daily) send(a, { t: 'daily', ...daily });
  if (!a.rod && a.career === 'none') setTimeout(() => a.ws === ws && toast(a, `💡 ยังไม่มีเงิน? ซื้อเบ็ด ${money(D.FISHING.rod)} กับน้าเล็กที่สมาคมประมง แล้วตกปลาขาย — วิธีหาเงินที่ง่ายที่สุดสำหรับมือใหม่!`, '🎣'), 6000);
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
const LOGIN_BONUS = [50, 80, 100, 120, 150, 200, 300];
const LOGIN_CYCLE = 30, LOGIN_MILESTONE = 2000;   // day 30 of each cycle pays the milestone bonus
function dailyLogin(a) {
  const today = Q.dayKey(), yesterday = Q.dayKey(now() - 86400e3);
  if (a.lastLogin === today) return null;
  a.loginStreak = a.lastLogin === yesterday ? (a.loginStreak || 0) + 1 : 1;
  a.lastLogin = today;
  const streak = a.loginStreak, cycleDay = ((streak - 1) % LOGIN_CYCLE) + 1;
  const milestone = cycleDay === LOGIN_CYCLE;               // every 30 days: big reward on top of the normal bonus
  const reward = LOGIN_BONUS[Math.min(cycleDay, 7) - 1] + (milestone ? LOGIN_MILESTONE : 0);
  a.money += reward; a.earned += reward; dirty = true;
  return { streak, reward, table: LOGIN_BONUS, cycleDay, cycle: LOGIN_CYCLE, milestone: LOGIN_MILESTONE,
    daysToMilestone: LOGIN_CYCLE - cycleDay, nextReward: LOGIN_BONUS[Math.min(cycleDay + 1 > LOGIN_CYCLE ? 1 : cycleDay + 1, 7) - 1] };
}

function detach(a) {
  if (!a.id) return;
  if (a.trade) tradeClose(a.trade, `${a.name} ออกจากเกม`);
  if (a.call) endCall(a, 'ออฟไลน์');
  for (const [id, r] of reqs) if (r.from === a || r.to === a) reqs.delete(id);
  for (const o of [...orders.values()]) { if (o.cust === a && o.state === 'open') cancelOrder(o, 'ลูกค้าออฟไลน์'); else if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; } }
  standUp(a);
  online.delete(a.id);
  a.ws = null; a.cast = null; a.sd = true; a.afk = false; dirty = true;
  sendRoster();
}

// movement: the client simulates, the server checks the step against the same tile map
function move(a, m) {
  const x = +m.x, y = +m.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  // moves sent before the client saw our last correction are stale: drop them quietly instead of correcting again
  if ((+m.fx || 0) < (a.fixId || 0)) return;
  if (a.down) return place(a, a.x, a.y);
  const t = now(), dt = Math.min(4, (t - a.lastPosT) / 1000);
  a.lastPosT = t;
  // budget refills at the player's speed (+35% slack); it can bank ~4 s of walking, so a phone that stalls and then
  // sends a burst of moves is not pulled back to where it was
  a.mvb = Math.min(moveCap(a), (a.mvb ?? moveCap(a)) + SPEED * speedOf(a) * Math.max(runMul(a), a.runT > t - 1500 ? D.RUN.mul : 1) * 1.35 * dt);
  const d = Math.hypot(x - a.x, y - a.y);
  if (d > a.mvb + 0.05 || !pathClear(a.x, a.y, x, y)) return place(a, a.x, a.y);
  a.mvb -= d;
  if (d > 0.04 && (a.pose || a.chair >= 0 || a.bed >= 0 || a.desk >= 0)) standUp(a);
  if (d > 0.04 && a.afk) { a.afk = false; sendRoster(); }
  if (a.run && !godLock(a)) {               // running burns energy; too tired = back to walking
    a.energy = Math.max(0, a.energy - d * D.RUN.energyPerTile); a.runT = t;
    if (a.energy <= D.RUN.minEnergy) { a.run = false; markMe(a); toast(a, 'เหนื่อยเกินไป วิ่งไม่ไหวแล้ว พักหรือกินอะไรก่อน', '🥵', false); }
  }
  if (x !== a.x || y !== a.y) { a.x = x; a.y = y; a.moved = true; dirty = true; a.lastMoveT = t; }
  a.f = clamp(Math.floor(+m.f) || 0, 0, 7);
  if (a.cast && Math.hypot(a.x - ST[a.cast.st].x, a.y - ST[a.cast.st].y) > ST[a.cast.st].r + 1.2) { a.cast = null; markMe(a); }
}
// the step must not cross a wall (sampled); a tiny radius slack absorbs the client's rounding to 2 decimals
function pathClear(x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2));
  // the client slides along walls one axis at a time; checking with a smaller radius keeps corner cuts legal
  for (let i = 1; i <= n; i++) if (D.blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, i === n ? D.RADIUS - 0.04 : D.RADIUS - 0.12)) return false;
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
      else if (cd(a, 'chatjoy', 20000, true)) joy(a, 2);
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
      return toast(a, 'นั่งพักหลับตา... พลังงานฟื้นเร็วขึ้น 3 เท่า และเลือดค่อยๆ ฟื้น (ถ้าไม่หิว) · เดินเพื่อลุก', '😌');
    }
    case 'beg': {                           // beggars can sit down anywhere
      if (a.down || !need(a, 'beggar')) return;
      if (m.on === false || a.pose === 'beg') { if (a.pose === 'beg') { standUp(a); markMe(a); toast(a, 'เลิกนั่งขอทานแล้ว', '🥣'); } return; }
      if (depressed(a)) return toast(a, 'ไม่มีจิตใจจะทำอะไร...', '😞', false);
      standUp(a); a.pose = 'beg'; a.seat = null; markMe(a); sendRoster();
      const m2 = begSpot(a);
      return toast(a, `นั่งขอทานตรงนี้แล้ว ${m2 >= 1.1 ? '— ทำเลดี คนผ่านเยอะ 👍' : m2 >= 0.9 ? '— คนผ่านพอสมควร' : '— ที่นี่คนผ่านน้อย ลองไปหน้าร้านหรือจัตุรัส'} (เดินเพื่อลุก)`, '🥣');
    }
    case 'run': {
      const on = !!m.on && a.energy > D.RUN.minEnergy;
      if (m.on && !on) toast(a, 'เหนื่อยเกินไป วิ่งไม่ไหว พักหรือกินอะไรก่อน', '🥵', false);
      if (a.run && !on) a.runT = now();        // moves already in flight were sent at running speed
      a.run = on; return markMe(a);
    }
    case 'afk': { const on = !!m.on; if (a.afk !== on) { a.afk = on; sendRoster(); } return; }
    case 'emo': {                           // an emoji over your head for everyone nearby
      const e = EMOJIS.includes(m.e) ? m.e : null; if (!e || !cd(a, 'emo', 1500, true)) return;
      const msg = { t: 'emo', id: a.id, e }, here = areaId(a);
      for (const o of online.values()) if (areaId(o) === here && dist(o, a) <= 16) send(o, msg);
      if (a.afk) { a.afk = false; sendRoster(); }
      return;
    }
    case 'look': {                          // hide your job clothes / wear a reward outfit
      if ('hideJob' in m) a.hideJob = !!m.hideJob;
      if ('outfit' in m) a.outfit = (a.outfits || []).includes(m.outfit) ? m.outfit : '';
      markMe(a); return sendRoster();
    }
    case 'bug': return bugReport(a, m);
    case 'god': return godAct(a, m);
    case 'reset': return resetChar(a, m);
    case 'resign': return resign(a);
    case 'paybills': return payBills(a);
    case 'donate': return donate(a, m);
    case 'steal': return steal(a, m);
    case 'wear': return wear(a, m);
    case 'report': return report(a, m);
    case 'arrest': return arrest(a, m);
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

const EMOJIS = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '👋', '🙏', '❤️', '🎉', '💤', '❓', '🤔', '😱', '🔥'];

// ------------------------------------------------------------------ bug reports (kept with the saves; admins read them in god mode)
let bugs = [], bugsDirty = false;
function bugReport(a, m) {
  const text = cleanText(m.text, 600); if (text.length < 5) return toast(a, 'เขียนรายละเอียดอีกนิด (อย่างน้อย 5 ตัวอักษร)', '🐞', false);
  if (!cd(a, 'bug', 60000)) return;
  const area = D.areaAt(a.x, a.y);
  bugs.push({ t: now(), by: a.name, login: a.login, text, where: `${area?.name || area?.label || '?'} (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`, ua: cleanText(m.ua, 160), build: BUILD });
  if (bugs.length > 300) bugs = bugs.slice(-300);
  bugsDirty = true; dirty = true;
  console.log(`[bug] ${a.name}: ${text}`);
  for (const o of online.values()) if (isAdmin(o) && o !== a) toast(o, `🐞 แจ้งบัคใหม่จาก ${a.name}`, '🐞');
  toast(a, 'ส่งรายงานบัคแล้ว ขอบคุณมากที่ช่วยกันทำให้เกมดีขึ้น 🙏', '🐞');
}

// ------------------------------------------------------------------ god mode (admins only)
function godAct(a, m) {
  if (!isAdmin(a)) return;
  a.god = a.god || {};
  if (m.op === 'nocd') { a.god.nocd = !a.god.nocd; if (a.god.nocd) a.cd = {}; toast(a, a.god.nocd ? 'God mode: ไม่มีคูลดาวน์' : 'ปิด: ไม่มีคูลดาวน์', '⚡'); }
  else if (m.op === 'lock') { a.god.lock = !a.god.lock; toast(a, a.god.lock ? 'God mode: ล็อกสเตตัสเต็ม (ไม่ป่วย/ไม่หมดสติ)' : 'ปิด: ล็อกสเตตัส', '🛡️'); }
  else if (m.op === 'fill') {
    a.energy = a.hunger = a.health = a.happy = 100; a.awake = 0; a.lowFood = a.starve = a.wet = 0;
    for (const d of [...(a.dz || [])]) cure(a, d);
    if (a.down && a.down.kind !== 'jail') revive(a, 100);
    toast(a, 'สเตตัสเต็มแล้ว', '💯');
  } else if (m.op === 'money') { a.money = 999999; toast(a, 'เงิน ฿999,999', '💰'); }
  else if (m.op === 'bugs') return send(a, { t: 'bugs', list: bugs.slice(-60).reverse() });
  else if (m.op === 'bugclear') { bugs = []; bugsDirty = true; dirty = true; return send(a, { t: 'bugs', list: [] }); }
  markMe(a); sendRoster();
}

// ------------------------------------------------------------------ start over: wipe the character's progress (keeps ID, PIN, name, phone number, looks)
function resetChar(a, m) {
  if (hashPin(String(m.pin ?? ''), a.salt) !== a.hash) return toast(a, 'PIN ไม่ถูกต้อง ยังไม่ได้รีเซ็ต', '🔒', false);
  if (a.trade) tradeClose(a.trade, `${a.name} รีเซ็ตตัวละคร`);
  if (a.call) endCall(a, 'วางสาย');
  standUp(a);
  for (const o of [...orders.values()]) { if (o.cust === a) cancelOrder(o, 'ลูกค้ารีเซ็ตตัวละคร'); else if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; } }
  if (a.house >= 0 && houses[a.house] === a) houses[a.house] = null;
  if (a.rent && tenants[a.rent.idx] === a) tenants[a.rent.idx] = null;
  if (a.garden && lots[a.garden.lot] === a) lots[a.garden.lot] = null;
  const keep = { v: VERSION, login: a.login, name: a.name, salt: a.salt, hash: a.hash, phone: a.phone, gender: a.gender, avatar: a.avatar, contacts: a.contacts, god: a.god,
    look: { hair: 'brown', shirt: a.look?.shirt && D.SHIRTS.includes(a.look.shirt) ? a.look.shirt : 'white', pants: 'gray' } };
  keep.wardrobe = { hair: ['brown'], shirt: [keep.look.shirt], pants: ['gray'] };
  byPhone.delete(a.phone);
  const fresh = hydrate(keep);
  for (const k of SAVE_KEYS) a[k] = fresh[k];
  byPhone.set(a.phone, a);
  a.cd = {}; a.thiefUntil = 0; a.wanted = 0; a.crimes = []; a.office = null; a.doc = null;
  Q.ensure(a);
  place(a, D.SPAWN.x, D.SPAWN.y, true); markMe(a); sendRoster(); wdAt = 0; dirty = true; a.sd = true;
  send(a, { t: 'reset' });
  toast(a, 'รีเซ็ตตัวละครแล้ว เริ่มต้นชีวิตใหม่ในเมือง! 🌱', '🌱');
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
    if (godLock(a)) {   // god mode: locked stats
      a.energy = a.hunger = a.health = a.happy = 100; a.awake = 0; a.lowFood = a.starve = a.wet = 0;
      if ((a.dz || []).length) { a.dz = []; sendRoster(); }
      if (a.down) { a.down = null; sendRoster(); }
      a.craving = null; a.utilOff = false; a.wanted = 0;
    }
    // ---- energy, hunger, health
    const restMul = a.pose === 'rest' ? 3 : a.pose === 'seat' ? 2 : a.pose === 'bed' ? 2 : 1;
    if (a.pose !== 'chair' && a.pose !== 'study') a.energy = Math.min(100, a.energy + 0.15 * (depressed(a) ? 0.6 : 1) * restMul * (1 + 0.03 * comfort(a)) * dzProd(a, 'regen') * dt);
    a.hunger = Math.max(0, a.hunger - 0.045 * dzProd(a, 'hunger') * (flu ? 1.3 : 1) * (a.down ? 0.2 : 1) * dt);
    if (!a.down) {
      if (a.hunger < 15) { a.lowFood = (a.lowFood || 0) + dt; if (a.lowFood > 60) a.health -= 0.08 * dt; } else a.lowFood = 0;
      if (a.hunger <= 0) a.health -= 0.25 * dt;
      else if (a.hunger > 60 && a.health < 100 && !(a.dz || []).length) a.health = Math.min(100, a.health + 0.05 * dt);
      // sitting down to rest heals (slowly while sick, not at all while starving)
      if ((a.pose === 'rest' || a.pose === 'seat') && a.hunger > 25 && a.health < 100) a.health = Math.min(100, a.health + ((a.dz || []).length ? 0.06 : 0.18) * dt);
      for (const d of a.dz || []) a.health -= (DZ[d].drain || 0) * (flu && (d === 'flu' || d === 'cold') ? 2.5 : 1) * dt;
      a.health = Math.max(0, a.health);
    }
    // ---- sleepiness
    if (a.pose === 'rest' || a.pose === 'bed') { a.awake = Math.max(0, (a.awake || 0) - 4 * dt); if (a.awake === 0 && (a.dz || []).some(d => d === 'insomnia' || d === 'exhaust') && a.pose === 'rest') sleepWell(a); }
    else a.awake = (a.awake || 0) + dt;
    if (slow) moodTick(a, t, indoors);
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
      if (a.career === 'doctor') doctorTick(a, t, h, 1);
      if (a.desk >= 0) studyTick(a, h, 1);
      if (a.thiefUntil && a.thiefUntil < t) { a.thiefUntil = 0; sendRoster(); }
      if ((a.licenses || []).includes('driving') && a.licExp?.driving) {
        const left = a.licExp.driving - t;
        if (left < 0 && !a.licWarned2) { a.licWarned2 = true; toast(a, 'ใบขับขี่หมดอายุแล้ว! ต่ออายุได้ที่มหาวิทยาลัย (ไรเดอร์รับออเดอร์ไม่ได้จนกว่าจะต่อ)', '🪪', false); }
        else if (left > 0 && left < LICENSE_YEAR / 12 && !a.licWarned) { a.licWarned = true; toast(a, 'ใบขับขี่ใกล้หมดอายุ (เหลือไม่ถึง 1 เดือนในเกม) ต่ออายุได้ที่มหาวิทยาลัย', '🪪'); }
      }
    }
    // ---- knocked out
    if (!a.down && a.health <= 0) knockOut(a);
    if (a.down && a.down.kind === 'jail' && a.health <= 0) a.health = 1;
    else if (a.down) {
      if (a.down.kind === 'jail') {
        if (t > a.down.until) { a.down = null; const r = ROOM.r_police; place(a, r.outside.x, r.outside.y, true); markMe(a); sendRoster(); toast(a, 'พ้นโทษแล้ว! อย่ากลับไปทำผิดอีกนะ', '🔓'); }
      } else if (a.down.kind === 'veg') {
        a.health = Math.min(100, a.health + 0.12 * dt);
        if (a.health >= 15) revive(a, 15);
      } else if (a.down.kind === 'hosp') {
        if (t > (a.down.until || a.down.t + 60000)) {
          const fee = Math.min(1200, Math.round(a.money * 0.25)); a.money -= fee;
          revive(a, 30); toast(a, `เจ้าหน้าที่โรงพยาบาลช่วยให้คุณฟื้น เสียค่ารักษา ${money(fee)} (ยังต้องรักษาโรคที่เป็นอยู่)`, '🏥', false);
        }
      }
    }
    if (a.cast) {
      if (a.cast.state === 'wait' && t >= a.cast.bite) { a.cast.state = 'bite'; send(a, { t: 'bite', zone: a.cast.zone, speed: a.cast.speed }); markMe(a); }
      else if (a.cast.state === 'bite' && t > a.cast.expire) { a.cast = null; markMe(a); toast(a, 'ปลาหนีไปแล้ว ช้าเกิน!', '💨', false); }
    }
    if (a.trade && (dist(a.trade.a, a.trade.b) > 8 || areaId(a.trade.a) !== areaId(a.trade.b))) tradeClose(a.trade, 'อยู่ไกลกันเกินไป ยกเลิกการแลกเปลี่ยน');
    if (godLock(a)) a.energy = a.hunger = a.health = a.happy = 100;
    if (a.meDirty || t % 2000 < TICK) { a.meDirty = false; send(a, meView(a)); }
  }
  if (slow) {
    // garden: tell owners their crops are ready
    for (const o of lots) if (o && o.garden && o.ws) o.garden.crops.forEach(c => { if (c && !c[2] && c[1] <= t) { c[2] = true; toast(o, `${D.ITEMS[c[0]].name}ในสวนของคุณโตแล้ว! ไปเก็บเกี่ยวได้`, '🌾'); } });
    for (const [id, c] of crimes) if (t - c.t > 15 * 60000) crimes.delete(id);
    // rentals expire
    tenants.forEach((a, i) => { if (a && a.rent && a.rent.until < t) { tenants[i] = null; a.rent = null; a.sd = true; if (a.ws) { toast(a, 'สัญญาเช่าบ้านหมดแล้ว ต่อสัญญาได้ที่หน้าบ้าน', '🔑', false); markMe(a); } wdAt = 0; } });
    // NPC patients
    for (let i = 0; i < beds.length; i++) { const b = beds[i]; if (b && b.npc && b.until < t) { beds[i] = null; wdAt = 0; } }
    if (t > npcPatientAt) { const docs = [...online.values()].some(o => o.career === 'doctor'); npcPatientAt = t + (docs ? rnd(60000, 120000) : rnd(150000, 300000)); spawnPatient(); }
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
  if (online.size) npcTick(dt, ps);
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
