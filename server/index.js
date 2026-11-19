'use strict';
// Authoritative multiplayer server: HTTP (static client) + WebSocket (game).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const D = require('./data');
const store = require('./store');
const Q = require('./quests');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, '..', 'public');
const SPEED = 3.0;                          // tiles / second on foot
const TICK = 100;
// admins (lower-case login IDs). Admins play with normal stats; the god-mode menu can switch on
// "no cooldowns" / "locked full stats" and top up money. Extra admins via ADMINS=a,b
const ADMINS = new Set(['james2324', ...String(process.env.ADMINS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)]);
const isAdmin = a => !!a && ADMINS.has(String(a.login || a.name).toLowerCase());
const godInf = a => isAdmin(a) && a.god?.inf !== false;   // admins: unlimited money + gems unless switched off
const INF_MONEY = 1e9;
function godTop(a) { if (!godInf(a)) return; a.god = a.god || {}; if (a.god.real === undefined) { a.god.real = Math.min(a.money, INF_MONEY - 1); a.god.realG = a.gems || 0; } if (a.money < INF_MONEY) a.money = INF_MONEY; if ((a.gems || 0) < 1e6) a.gems = 1e6; }   // the real wallet is kept aside for when it is switched off
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
const BUILD = crypto.createHash('sha1').update(['index.html', 'game.js', 'style.css', 'fx.js', 'assets/atlas.json'].map(f => { try { return fs.readFileSync(path.join(__dirname, '..', 'public', f)); } catch { return ''; } }).join('|')).digest('hex').slice(0, 10);

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
let announceText = '📢 จะอัปเดตอีกครั้งในวันศุกร์ · แมพใหม่ สวนสนุกที่จะเพิ่มพลังใจ ยะฮู้! ❤️';                      // the admin's notice in the red ticker at the top ('' = the default CBT notice); chat "all <text>"
const reqs = new Map();                     // pending requests (trade / heal / call)
let nextId = 1, dirty = false;

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const ev = id => event && event.id === id;
// job levels: each level needs more experience than the last, and each action gives less the higher you are
// (office keeps its own ladder: 3 good shifts per promotion)
const JOB_MAX = 50;
const xpNeed = L => Math.round(10 + 4 * Math.pow(L - 1, 1.4));
function jobXp(xp) { let L = 1; xp = +xp || 0; while (L < JOB_MAX && xp >= xpNeed(L)) { xp -= xpNeed(L); L++; } return { L, cur: xp, need: xpNeed(L) }; }
const lvl = (a, c = a.career) => c === 'office' ? 1 + Math.floor((a.xp[c] || 0) / 3) : jobXp(a.xp[c] || 0).L;
const xpGain = L => 1 / (1 + 0.08 * (L - 1));          // Lv1 100% · Lv5 76% · Lv10 58% · Lv20 40%
const jobPay = a => 1 + 0.06 * (lvl(a) - 1);            // every level pays 6% more
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
  if (!absolute) try { repFrom(a, key, n); } catch {}
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
// admins: every job unlocked unless they switch it off; the mayor title can be switched off too (then their own title shows)
const allJobs = a => isAdmin(a) && a.god?.alljobs !== false;
const adminTitle = a => isAdmin(a) && !a.god?.notitle;
const titleDef = id => D.ACHIEVEMENTS.find(x => x.id === id) || D.LUX_TITLES.find(x => x.id === id);
const titleOf = a => adminTitle(a) ? ADMIN_TITLE : isMayor(a) ? '🏛️ นายกเมือง' : titleDef(a.title)?.title || '';
const titleRar = a => adminTitle(a) ? 6 : isMayor(a) ? 5 : titleDef(a.title)?.r || 0;

// ------------------------------------------------------------------ diseases
const DZ = D.DISEASES;
const dzProd = (a, key) => (a.dz || []).reduce((m, d) => m * (DZ[d]?.[key] || 1), 1);
const newbie = a => now() - (a.created || now()) < 3 * 3600e3 || (a.earned || 0) < 3000;
function infect(a, id, chance = 1) {
  if (godLock(a)) return false;
  if (Math.random() > chance || !DZ[id] || (a.dz || []).includes(id) || (a.dz || []).length >= 3 || a.down) return false;
  if ((a.immune?.[id] || 0) > now()) return false;
  if (newbie(a)) return false;                       // new players (first 3 hours) do not catch anything yet
  a.dz = [...(a.dz || []), id];
  const d = DZ[id];
  toast(a, `คุณป่วยเป็น${d.name}! อาการ: ${d.sym.slice(0, 2).join(', ')} · ${d.self}`, d.icon, false);
  markMe(a); sendRoster(); return true;
}
function cure(a, id) {
  if (!(a.dz || []).includes(id)) return false;
  a.dz = a.dz.filter(x => x !== id);
  a.immune = { ...(a.immune || {}), [id]: now() + 20 * 60000 };   // 20 minutes of immunity after recovering
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
  const wasSwim = a.fun?.k === 'pool'; a.fun = null;
  if (wasSwim && D.POOL.x0 && nearPool(a.x, a.y)) { const s = D.STATIONS.find(x => x.id === 'ride_pool'); if (s) place(a, s.x, s.y, true); }   // out of the water onto the deck
  sendRoster();
}
function place(a, x, y, tp) {
  a.x = x; a.y = y; a.mvb = moveCap(a); a.moved = true; a.lastPosT = now();
  a.fixId = (a.fixId || 0) + 1;
  send(a, { t: 'fix', x, y, tp: tp ? 1 : 0, fx: a.fixId });
}
// off a park ride; out of the bumper car arena too (its wall is closed)
function rideOff(a) { const k = a.fun?.k; standUp(a); if (k === 'bumper' || k === 'pool') { const s = D.STATIONS.find(x => x.id === 'ride_' + k); if (s) place(a, s.x, s.y, true); } }
// the pool: swimmers stay inside the water; everyone else (on foot or in a vehicle) stays out of it
const inPoolWater = (x, y) => { const P = D.POOL; return x > P.x0 + .4 && x < P.x1 - .4 && y > P.y0 + .7 && y < P.y1 - .1; };
const nearPool = (x, y) => { const P = D.POOL; return x > P.x0 - .35 && x < P.x1 + .35 && y > P.y0 - .1 && y < P.y1 + .45; };
function teleport(a, x, y) { a.cast = null; standUp(a); place(a, x, y, true); markMe(a); }
function buildingOpen(bid, h = hourNow()) { return D.isOpen(bid, h); }
function enterRoom(a, m) {
  if (a.down) return;
  const s = ST[m.st]; if (!s || s.type !== 'door') return;
  const room = ROOM[s.to]; if (!room) return;
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 1.2) return toast(a, 'เดินไปที่ประตูก่อน', '🚪', false);
  const master = isAdmin(a) && a.god?.doors;              // god mode: every door opens
  if (s.renov && !master) return toast(a, `${s.label} ปิดปรับปรุงชั่วคราว 🚧`, '🚧', false);
  if (znAlive(a) || zn?.ph === 'warn') return toast(a, 'ประตูถูกปิดตาย! ข้างในมีซอมบี้ อยู่นอกอาคารแล้วหนีให้รอด', '🧟', false);
  const riderIn = s.bld === 'restaurant' && [...orders.values()].some(o => o.rider === a && o.state === 'taken');   // a rider with food to collect may slip in the back door
  if (s.house === undefined && !buildingOpen(s.bld) && !master && !riderIn) {
    const o = D.HOURS[s.bld];
    return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false);
  }
  if (s.house !== undefined) {
    const i = s.house, o = houses[i], tn = null;
    if (!o && !master) return toast(a, 'ที่ดินแปลงนี้ว่างอยู่ · อยากมีบ้าน ซื้อได้ที่คุณจิ๋ม สำนักงานอสังหาฯ 🏡', '🌱', false);
    if (o !== a && !master && friendOf(o, a)) { if (!cd(a, 'door', 1200, true)) return; if (s.yspawn) return teleport(a, s.yspawn.x, s.yspawn.y); return teleport(a, room.spawn.x, room.spawn.y); }   // friends may come in
    if (o === a && tn && tn !== a && !master) return toast(a, `บ้านของคุณปล่อยให้ ${tn.name} เช่าอยู่ เข้าได้อีกครั้งเมื่อหมดสัญญาเช่า`, '🔑', false);
    if (o !== a && tn !== a && !master) return toast(a, o || tn ? `บ้านหลังนี้เป็นของ${tn ? 'ผู้เช่า' : ''} ${(tn || o).name} เข้าได้เฉพาะเจ้าของบ้านและผู้เช่า` : 'บ้านว่าง ห้ามเข้า — ซื้อหรือเช่าก่อนถึงจะเข้าได้', '🔒', false);
  }
  if (!cd(a, 'door', 1200, true)) return;
  if (s.yspawn) return teleport(a, s.yspawn.x, s.yspawn.y);   // the estate-street door opens onto the house's own yard
  teleport(a, room.spawn.x, room.spawn.y);
}
// vegetable fields in your own yard: anyone with a house can farm here
// soil crops need water: a dry crop grows at half speed until it is watered (watering can, a sprinkler in range, or rain)
const DRY = 2;
const soilCell = (a, o) => { const p = a.fpos?.[o]; return p && p[0] === YARD_FL && D.FURNITURE[fbase(o)]?.tile ? `${Math.floor(p[1])},${Math.round(p[2]) - 1}` : null; };
function wetCells(a) {                     // every soil cell a placed sprinkler reaches
  const out = new Set();
  for (const o of furnOf(a)) {
    const r = D.FURNITURE[fbase(o)]?.sprk, p = a.fpos?.[o]; if (!r || !p || p[0] !== YARD_FL) continue;
    const cx = Math.floor(p[1]), cy = Math.round(p[2]) - 1;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.add(`${cx + dx},${cy + dy}`);
  }
  return out;
}
function waterCrop(pl, t) { if (pl[2] !== 0) return false; if (pl[1] > t) pl[1] = t + (pl[1] - t) / DRY; pl[2] = 1; return true; }
function ySprinkle(a, all) {               // sprinklers (or rain: all) water every dry crop they reach
  if (!a.ycrops) return 0;
  const wet = all ? null : wetCells(a), t = now(); let n = 0;
  for (const [o, pl] of Object.entries(a.ycrops)) if (pl[2] === 0 && (all || wet.has(soilCell(a, o))) && waterCrop(pl, t)) n++;
  if (n) { a.sd = true; markMe(a); wdAt = 0; }
  return n;
}
function yardFarm(a, m) {
  if (a.down) return;
  const i = a.house; if (i < 0 || houses[i] !== a) return toast(a, 'ต้องเป็นเจ้าของบ้านก่อน', '🏡', false);
  const k = String(m.k || ''), f = D.FURNITURE[fbase(k)], pos = a.fpos?.[k], yard = D.YARDS[i];
  if (!f?.field || !furnOf(a).includes(k) || !pos || pos[0] !== YARD_FL) return;
  if (Math.hypot(a.x - (yard.x + pos[1]), a.y - (yard.y + pos[2] - .5)) > 2.2) return toast(a, 'เดินเข้าไปใกล้แปลงผักก่อน', '⚠️', false);
  a.ycrops = { ...(a.ycrops || {}) }; const pl = a.ycrops[k];
  if (f.tile) return soilFarm(a, k, m);
  if (m.op === 'plant') {
    const c = D.CROPS[m.crop]; if (!c) return;
    if (pl) return toast(a, 'แปลงนี้ปลูกอยู่แล้ว', '⚠️', false);
    if (!pay(a, c.seed)) return;
    if (!spend(a, 5)) { a.money += c.seed; return; }
    const g = (ev('rain') ? 0.5 : ev('drought') ? 1.6 : 1) * (1 - 0.15 * tier(a, 'farmer'));
    a.ycrops[k] = [m.crop, now() + c.grow * 1000 * g]; markMe(a); wdAt = 0;
    return toast(a, `ปลูก${D.ITEMS[m.crop].name}แล้ว`, '🌱');
  }
  if (m.op === 'harvest') {
    if (!pl) return toast(a, 'แปลงว่าง', '⚠️', false);
    if (pl[1] > now()) return toast(a, 'พืชยังไม่โต', '🌱', false);
    if (!spend(a, 6)) return;
    const c = D.CROPS[pl[0]], n = rint(c.min, c.max) + Math.floor(lvl(a) / 3) + tier(a, 'farmer');
    addItem(a, pl[0], n); delete a.ycrops[k]; addXp(a); markMe(a); quest(a, 'harvest'); stat(a, 'harvest'); wdAt = 0;
    if (pl[0] === 'durian') stat(a, 'durian');
    return toast(a, `เก็บเกี่ยว ${D.ITEMS[pl[0]].icon}${D.ITEMS[pl[0]].name} ได้ ${n} หน่วย`, '🧺');
  }
}
// soil tiles: each cell grows one plant; 'all' works on the whole connected bed the tapped cell belongs to
function soilBed(a, k) {
  const cell = o => { const p = a.fpos[o]; return p && p[0] === YARD_FL && D.FURNITURE[fbase(o)]?.tile ? `${Math.floor(p[1])},${Math.round(p[2]) - 1}` : null; };
  const at = new Map(); for (const o of furnOf(a)) { const c = cell(o); if (c) at.set(c, o); }
  const out = [k], seen = new Set([cell(k)]);
  for (let i = 0; i < out.length; i++) { const [x, y] = cell(out[i]).split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = `${x + dx},${y + dy}`; if (at.has(c) && !seen.has(c)) { seen.add(c); out.push(at.get(c)); } } }
  return out;
}
function soilFarm(a, k, m) {
  const keys = m.all ? soilBed(a, k) : [k];
  if (m.op === 'plant') {
    const c = D.CROPS[m.crop]; if (!c) return;
    const empty = keys.filter(o => !a.ycrops[o]); if (!empty.length) return toast(a, 'แปลงนี้ปลูกเต็มแล้ว', '⚠️', false);
    const seed = Math.ceil(c.seed / 3), cost = seed * empty.length, energy = Math.max(2, Math.ceil(empty.length * .8));
    if (a.money < cost) return toast(a, `เงินไม่พอ (ค่าเมล็ด ${money(cost)})`, '💸', false);
    if (!spend(a, energy)) return;
    a.money -= cost;
    const g = (ev('rain') ? 0.5 : ev('drought') ? 1.6 : 1) * (1 - 0.15 * tier(a, 'farmer')), wet = wetCells(a);
    for (const o of empty) { const w = ev('rain') || wet.has(soilCell(a, o)) ? 1 : 0; a.ycrops[o] = [m.crop, now() + c.grow * 1000 * g * (w ? 1 : DRY), w]; }
    markMe(a); wdAt = 0;
    const dry = empty.filter(o => a.ycrops[o][2] === 0).length;
    return toast(a, `ปลูก${D.ITEMS[m.crop].name} ${empty.length} ช่อง (ค่าเมล็ด ${money(cost)})${dry ? ` · อย่าลืมรดน้ำ 💧 ${dry} ช่อง` : ' · สปริงเกลอร์รดน้ำให้แล้ว 💦'}`, '🌱');
  }
  if (m.op === 'water') {
    const t = now(), dry = keys.filter(o => a.ycrops[o]?.[2] === 0); if (!dry.length) return toast(a, 'ไม่มีช่องที่ต้องรดน้ำ', '💧', false);
    if (!spend(a, Math.max(1, Math.ceil(dry.length / 4)))) return;
    for (const o of dry) waterCrop(a.ycrops[o], t);
    markMe(a); wdAt = 0;
    return toast(a, `รดน้ำแล้ว ${dry.length} ช่อง ผักโตเร็วขึ้นเท่าตัว 💧`, '💧');
  }
  if (m.op === 'harvest') {
    const ripe = keys.filter(o => a.ycrops[o] && a.ycrops[o][1] <= now()); if (!ripe.length) return toast(a, 'ยังไม่มีอะไรสุก', '🌱', false);
    if (!spend(a, Math.max(2, Math.ceil(ripe.length * .8)))) return;
    const got = {};
    for (const o of ripe) { const id = a.ycrops[o][0]; got[id] = (got[id] || 0) + rint(1, 2) + (Math.random() < .15 * tier(a, 'farmer') ? 1 : 0); delete a.ycrops[o]; }
    for (const [id, n] of Object.entries(got)) { addItem(a, id, n); if (id === 'durian') stat(a, 'durian'); }
    addXp(a); markMe(a); quest(a, 'harvest'); stat(a, 'harvest'); wdAt = 0;
    return toast(a, `เก็บเกี่ยว ${Object.entries(got).map(([id, n]) => `${D.ITEMS[id].icon}${D.ITEMS[id].name} ${n}`).join(' · ')}`, '🧺');
  }
}
function exitRoom(a) {
  if (a.down) return;
  const room = D.roomAt(a.x, a.y);
  if (!room || Math.hypot(a.x - room.exit.x, a.y - room.exit.y) > 2.4) return;
  if (!cd(a, 'door', 1200, true)) return;
  teleport(a, room.outside.x, room.outside.y);
}

// ------------------------------------------------------------------ money
// ---- money history: every change of a player's cash is written to a.ledger [time, amount, what, balance after], newest last.
// Explicit entries come from ledAdd; anything else is caught by ledSweep (after each message, and every tick) and named after
// what the player was doing (a.ledCtx) so nothing goes missing.
const LED_MAX = 200;
const LED_T = { god: '👑 แอดมิน', chat: 'แชท', trade_confirm: 'แลกของกับผู้เล่น', stock: 'ซื้อขายหุ้น', bankop: 'ธนาคาร', lotto: 'ลอตเตอรี่', luxbuy: 'ซื้อฉายาเศรษฐี', frame: 'กรอบรูป', wear: 'ชุด',
  use: 'ใช้ของ', ride: 'ซื้อ/ใช้ยานพาหนะ', p: 'เดินทาง', taxi: 'แท็กซี่', order: 'สั่งอาหาร', morder: 'สั่งของจากตลาด', donate: 'บริจาค', alms_give: 'ใส่บาตร', beg: 'ขอทาน',
  gang: 'แก๊ง', hplace: 'แต่งบ้าน', hstyle: 'แต่งบ้าน', decor: 'แต่งบ้าน', yfarm: 'สวนผัก', mailclaim: 'รับของจากจดหมาย', achclaim: 'รางวัลความสำเร็จ', mission: 'ภารกิจ',
  minigame: 'มินิเกม', jg: 'มินิเกม', paybills: 'ค่าน้ำค่าไฟ', rod: 'เบ็ดตกปลา', quest_reroll: 'เควสต์', quizans: 'ควิซในห้องเรียน', mayor: 'เลือกตั้งนายก', rest: 'พักผ่อน',
  work: 'ทำงาน', collect: 'เก็บเงิน', look: 'ชุด/หน้าตา', reset: 'รีเซ็ตตัวละคร', escort: 'คุ้มกัน', chase: 'ไล่จับ', refcode: 'ชวนเพื่อน', adreward: 'ดูโฆษณา', visit: 'เยี่ยมบ้าน',
  npctalk: 'คุยกับชาวเมือง', go: 'เดินทาง', rename: 'บัตรเปลี่ยนชื่อ', gift: 'ของขวัญ', run: 'วิ่ง', title: 'ฉายา', req_ans: 'คำขอจากผู้เล่น', enter: 'เข้าอาคาร', exit: 'ออกจากอาคาร' };
const LED_A = { buy: 'ซื้อ', sell: 'ขาย', cook: 'รับออเดอร์อาหาร', serve: 'เสิร์ฟอาหาร', heal: 'รักษา', treat: 'รักษา', start: 'เริ่มงาน', go: 'เดินทาง', rent: 'เช่า', pay: 'จ่าย' };
function ledLabel(a, m) {
  if (m.t === 'act') { const s0 = m.st === 'water' ? { icon: '🎣', label: 'ตกปลา' } : ST[m.st]; if (s0) return `${s0.icon || ''} ${s0.label || s0.type}${LED_A[m.a] ? ' · ' + LED_A[m.a] : ''}`.trim(); }
  return LED_T[m.t] || m.t;
}
function ledPush(a, d, what, bal) {
  if (!d) return;
  const L = a.ledger || (a.ledger = []), t = now(), last = L[L.length - 1];
  if (last && last[2] === what && Math.sign(last[1]) === Math.sign(d) && t - last[0] < 90e3) { last[1] += d; last[3] = bal; last[0] = t; }   // merge a run of the same thing
  else { L.push([t, d, what, bal]); if (L.length > LED_MAX) L.splice(0, L.length - LED_MAX); }
  a.sd = true;
}
function ledSweep(a, what) {
  if (!isFinite(a.money)) return;
  if (a.ledBal == null || !isFinite(a.ledBal)) { a.ledBal = a.money; return; }
  const d = Math.round(a.money - a.ledBal); if (d) ledPush(a, d, what || a.ledCtx || 'อื่นๆ', a.money); a.ledBal = a.money;
}
function ledAdd(a, d, what) {   // call right after changing a.money by d
  if (!isFinite(a.money)) return;
  if (a.ledBal == null) a.ledBal = a.money - d;
  const res = Math.round(a.money - d - a.ledBal); if (res) ledPush(a, res, a.ledCtx || 'อื่นๆ', a.money - d);
  ledPush(a, Math.round(d), what, a.money); a.ledBal = a.money;
}
function earn(a, amount) {
  if (amount > 0 && (a.bless || 0) > now()) amount *= D.TEMPLEQ.blessMul;   // 🙏 blessed at the temple: a little extra on everything you earn
  if (amount > 0 && mayor?.pol === 'tax') amount *= 1 + MAYOR.tax;   // the mayor's low-tax policy
  if (amount > 0 && a.gang) { const g0 = gangOf(a); if (g0) amount *= 1 + GANG.lv[g0.lvl - 1].inc; }   // a bigger gang house pays its members a little extra
  ledSweep(a);
  amount = Math.round(amount); const tx = amount > 0 ? taxOf(a, amount) : 0; amount -= tx; a.money += amount; a.earned += amount; markMe(a);
  ledPush(a, amount + tx, a.ledCtx || 'รายได้', a.money + tx); ledPush(a, -tx, '🧾 ภาษีรายได้', a.money); a.ledBal = a.money;
  let rp = 0;
  if (amount > 0) {
    quest(a, 'earn', amount); gangPts(a, amount);
    if (a.loan > 0) { rp = Math.min(a.loan, Math.ceil(amount * D.BANK.repayShare)); a.money -= rp; a.loan -= rp; ledAdd(a, -rp, '🏦 ผ่อนเงินกู้อัตโนมัติ'); }   // loans auto-repay from income
  }
  a.lastDed = { tax: tx, loan: rp, net: amount - rp };
  if (tx + rp > 0) {   // say where the missing money went (batched so small earnings don't spam)
    const p = a.dedPend || (a.dedPend = { tax: 0, loan: 0 }); p.tax += tx; p.loan += rp;
    if (cd(a, 'dedT', 8000, true)) { toast(a, `หัก${p.tax ? `ภาษี ${money(p.tax)}` : ''}${p.tax && p.loan ? ' · ' : ''}${p.loan ? `ผ่อนเงินกู้อัตโนมัติ ${money(p.loan)}` : ''}`, '🧾', false); a.dedPend = null; }
  }
  return amount;
}
// ---- the economy: fuel prices move day by day like a real pump board (a slow wave plus a little noise, never more than ±15%),
// and in a slow economy the government halves income tax. Taxes never go above the normal rates.
const econCache = new Map();
function econ(dk = dayKey()) {
  if (econCache.has(dk)) return econCache.get(dk);
  const n = Math.round(Date.parse(dk) / 864e5);
  let x = Math.imul(n * 31 + 7, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; const r = (x >>> 0) / 4294967296;
  const f = Math.max(.85, Math.min(1.15, 1 + .1 * Math.sin(n * 2 * Math.PI / 9) + (r - .5) * .08));
  const cyc = Math.sin(n * 2 * Math.PI / 14 + 1), mood = cyc > .55 ? 'boom' : cyc < -.55 ? 'slow' : 'normal';
  const e = { fuel: Math.round(f * 100) / 100, taxMul: mood === 'slow' ? .5 : 1, mood };
  if (econCache.size > 20) econCache.clear(); econCache.set(dk, e); return e;
}
const nextDayKey = () => new Date(Date.parse(dayKey()) + 864e5).toISOString().slice(0, 10);
const FUEL_BAHT = 32;   // the pump board price on a normal day (just for show: the real cost scales with the same factor)
const econView = () => { const e = econ(), n = econ(nextDayKey()); return { fuel: e.fuel, litre: +(FUEL_BAHT * e.fuel).toFixed(2), next: +(FUEL_BAHT * n.fuel).toFixed(2), taxMul: e.taxMul, mood: e.mood }; };
let econDay = '';
setInterval(() => {
  const dk = dayKey(); if (dk === econDay) return; const first = !econDay; econDay = dk; if (first) return;
  const v = econView(), d = v.next - v.litre;
  feed(`⛽ ราคาน้ำมันวันนี้ ฿${v.litre.toFixed(2)}/ลิตร${v.mood === 'slow' ? ' · 📉 เศรษฐกิจซบเซา รัฐลดภาษีรายได้ครึ่งหนึ่งวันนี้' : v.mood === 'boom' ? ' · 📈 เศรษฐกิจคึกคัก' : ''}`);
}, 60000);
// fuel: your own vehicles cost a little per tile driven (faster = thirstier); company vehicles (delivery bike, patrol car) are free
function fuel(a, d) {
  const v = riding(a); if (!v || a.ride === 'delivery' || a.ride === 'police' || !(d > 0) || d > 20 || godInf(a)) return;
  a.fuelDue = (a.fuelDue || 0) + d * 0.008 * v.speed * v.speed * econ().fuel;   // a bit cheaper than before, times today's pump price
  if (a.fuelDue < 5) return;
  const c = Math.floor(a.fuelDue);
  if (a.money < c) { a.fuelDue = 0; a.ride = ''; a.mvb = moveCap(a); markMe(a); sendRoster(); return toast(a, 'เงินไม่พอเติมน้ำมัน ⛽ ต้องลงเดินก่อน', '⛽', false); }
  a.money -= c; ledAdd(a, -c, '⛽ ค่าน้ำมัน'); a.fuelDue -= c; a.fuelDay = a.fuelDay?.d === dayKey() ? a.fuelDay : { d: dayKey(), c: 0 }; a.fuelDay.c += c; markMe(a);
}
// income tax by the real (Bangkok) day: the first ฿20,000 is free, then 10%, and 20% above ฿60,000
const TAX = [[30000, 0], [100000, .05], [Infinity, .1]];   // lowered: ฿30k free, then 5%, 10% above ฿100k
function taxOf(a, amount) {
  if (!(amount > 0) || isAdmin(a)) return 0;
  const d = dayKey(), T = a.tax?.d === d ? a.tax : (a.tax = { d, e: 0, paid: 0 });
  let rest = amount, e = T.e, due = 0, lo = 0; const tm = econ().taxMul;
  for (const [hi, r] of TAX) { if (e < hi && rest > 0) { const part = Math.min(rest, hi - e); due += part * r * tm; rest -= part; e += part; } lo = hi; }
  const first = T.paid === 0 && due > 0;
  T.e += amount; due = Math.round(due); T.paid += due;
  if (first && a.ws) toast(a, `💸 วันนี้รายได้เกิน ${money(TAX[0][0])} แล้ว เริ่มเสียภาษี ${tm < 1 ? '2.5% (ลดครึ่งหนึ่ง เศรษฐกิจซบเซา)' : '5%'} · รีเซ็ตทุกเที่ยงคืน`, '🧾');
  return due;
}
function credit(o, amount) {          // pay someone who may be offline
  amount = Math.round(amount); o.money += amount; o.earned += amount; o.sd = true; dirty = true;
  if (o.ws) { quest(o, 'earn', amount); markMe(o); }
}

// ------------------------------------------------------------------ gangs / clubs
// A gang is a team: members' income earns gang points, a daily team mission pays everyone, the bank
// funds a bigger gang house (more members, a bonus on income, a quick energy refill).
const gangs = new Map();   // id -> gang; saved inside the __meta record
let gangSeq = 1;
const GANG = {
  create: 20000, dayCap: 300, perPt: 40, msnPer: 150, msnPay: 800, msnBank: 500, restMs: 30 * 60e3,
  icons: ['🐉', '🦅', '🌸', '⚡', '🔥', '🐯', '🐺', '🦈', '🌙', '👑'],
  colors: ['#e0584a', '#e8913a', '#e8c83a', '#5cb85c', '#3aa6c9', '#5b6fd8', '#a65bd8', '#e86fa6'],
  lv: [{ n: 'กระท่อม', cap: 10, inc: 0, rest: 30, cost: 0, pts: 0 }, { n: 'บ้านแก๊ง', cap: 15, inc: .02, rest: 50, cost: 30000, pts: 1000 },
    { n: 'คลับเฮาส์', cap: 20, inc: .03, rest: 70, cost: 150000, pts: 6000 }, { n: 'คฤหาสน์', cap: 30, inc: .05, rest: 100, cost: 600000, pts: 25000 }],
};
const gdirty = () => { bugsDirty = true; dirty = true; };
const weekKey = () => { const d = new Date(now() + 7 * 3600e3), day = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - day * 86400e3).toISOString().slice(0, 10); };
const lk = a => String(a.login).toLowerCase();
function gangOf(a) {
  if (!a.gang) return null;
  const g = gangs.get(a.gang);
  if (!g || !g.mem[lk(a)]) { a.gang = ''; a.sd = true; return null; }   // the gang is gone or I was removed
  return g;
}
function gangRoll(g) {                       // new week: weekly points restart; new day: a fresh team mission
  const w = weekKey(); if (g.week !== w) { g.week = w; g.wpts = 0; for (const m of Object.values(g.mem)) m.p = 0; gdirty(); }
  const d = dayKey(); if (!g.msn || g.msn.d !== d) { g.msn = { d, prog: 0, done: 0 }; gdirty(); }
}
const gangGoal = g => GANG.msnPer * Math.max(2, Object.keys(g.mem).length);
function gangAdd(g, login, n) {
  gangRoll(g); g.pts += n; g.wpts += n; const m = g.mem[login]; if (m) m.p = (m.p || 0) + n;
  g.msn.prog += n;
  if (!g.msn.done && g.msn.prog >= gangGoal(g)) {
    g.msn.done = 1; g.bank += GANG.msnBank;
    for (const l of Object.keys(g.mem)) { const o = accounts.get(l); if (!o) continue; credit(o, GANG.msnPay); if (o.ws) toast(o, `🏴 ภารกิจแก๊งวันนี้สำเร็จ! ได้ ${GANG.msnPay} บาท`, '🎉'); }
  }
  gdirty();
}
function gangPts(a, amount) {
  const g = gangOf(a); if (!g || amount <= 0) return;
  const d = dayKey(); if (!a.gpd || a.gpd.d !== d) a.gpd = { d, p: 0 };
  const n = Math.min(Math.max(1, Math.round(amount / GANG.perPt)), GANG.dayCap - a.gpd.p); if (n <= 0) return;
  a.gpd.p += n; gangAdd(g, lk(a), n);
}
function gangView(a) {
  const g = gangOf(a); if (!g) return null; gangRoll(g);
  const L = GANG.lv[g.lvl - 1], N = GANG.lv[g.lvl], my = g.mem[lk(a)], role = my.r;
  const rk = { boss: 0, vice: 1, mem: 2 };
  const mem = Object.entries(g.mem).map(([l, v]) => { const o = accounts.get(l); return { l, n: o?.name || l, r: v.r, p: v.p || 0, on: o?.ws ? 1 : 0 }; }).sort((x, y) => rk[x.r] - rk[y.r] || y.p - x.p);
  const rank = 1 + [...gangs.values()].filter(o => o.wpts > g.wpts).length;
  return { my: lk(a), id: g.id, name: g.name, icon: g.icon, color: g.color, role, lvl: g.lvl, ln: L.n, cap: L.cap, pts: g.pts, wpts: g.wpts, bank: g.bank, inc: L.inc, rest: L.rest, restLeft: Math.max(0, Math.ceil(((a.cd?.gangrest || 0) - now()) / 1000)),
    next: N ? { n: N.n, cost: N.cost, pts: N.pts, cap: N.cap, inc: N.inc, rest: N.rest } : null, mem, req: role === 'mem' ? [] : g.req, rank, msn: { goal: gangGoal(g), prog: g.msn.prog, done: g.msn.done, pay: GANG.msnPay }, mine: my.p || 0 };
}
function gangList(a) {
  const list = [...gangs.values()].map(g => { gangRoll(g); return { id: g.id, name: g.name, icon: g.icon, color: g.color, n: Object.keys(g.mem).length, cap: GANG.lv[g.lvl - 1].cap, wpts: g.wpts, pts: g.pts, lvl: g.lvl, ln: GANG.lv[g.lvl - 1].n, boss: accounts.get(g.boss)?.name || '', asked: g.req.some(r => r.l === lk(a)) ? 1 : 0 }; })
    .sort((x, y) => y.wpts - x.wpts || y.pts - x.pts).slice(0, 40).map((g, i) => ({ ...g, rank: i + 1 }));
  send(a, { t: 'gangs', list, create: GANG.create, icons: GANG.icons, colors: GANG.colors });
}
function gangOp(a, m) {
  const op = m.op, me = lk(a);
  if (op === 'list') return gangList(a);
  if (op === 'create') {
    if (a.gang && gangOf(a)) return toast(a, 'คุณอยู่ในแก๊งอยู่แล้ว ต้องออกก่อน', '🏴', false);
    const name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (name.length < 2) return toast(a, 'ตั้งชื่อแก๊งอย่างน้อย 2 ตัวอักษร', '🏴', false);
    if (impersonates(name) || [...gangs.values()].some(g => nameKey(g.name) === nameKey(name))) return toast(a, 'ชื่อนี้ใช้ไม่ได้หรือมีคนใช้แล้ว', '🏴', false);
    if (a.money < GANG.create) return toast(a, `ตั้งแก๊งใช้เงิน ${GANG.create.toLocaleString()} บาท`, '💸', false);
    const icon = GANG.icons.includes(m.icon) ? m.icon : GANG.icons[0], color = GANG.colors.includes(m.color) ? m.color : GANG.colors[0];
    a.money -= GANG.create; const id = 'g' + gangSeq++;
    gangs.set(id, { id, name, icon, color, boss: me, mem: { [me]: { r: 'boss', p: 0 } }, req: [], pts: 0, wpts: 0, bank: 0, lvl: 1, week: weekKey(), t: now(), msn: null });
    a.gang = id; a.sd = true; gdirty(); markMe(a);
    return toast(a, `ตั้งแก๊ง ${icon} ${name} แล้ว! ชวนเพื่อนมาเข้าร่วมได้เลย`, '🏴');
  }
  if (op === 'req') {
    if (gangOf(a)) return toast(a, 'คุณอยู่ในแก๊งอยู่แล้ว', '🏴', false);
    const g = gangs.get(m.id); if (!g) return toast(a, 'ไม่พบแก๊งนี้', '🏴', false);
    if (Object.keys(g.mem).length >= GANG.lv[g.lvl - 1].cap) return toast(a, 'แก๊งนี้เต็มแล้ว', '🏴', false);
    if (g.req.some(r => r.l === me)) return toast(a, 'ขอเข้าไปแล้ว รอหัวหน้าตอบรับ', '⏳', false);
    if (g.req.length >= 20) return toast(a, 'มีคนขอเข้าเยอะอยู่ ลองใหม่ภายหลัง', '🏴', false);
    g.req.push({ l: me, n: a.name, t: now() }); gdirty();
    for (const l of Object.keys(g.mem)) { const o = accounts.get(l); if (o?.ws && g.mem[l].r !== 'mem') { toast(o, `${a.name} ขอเข้าแก๊ง`, '🏴'); markMe(o); } }
    gangList(a); return toast(a, `ส่งคำขอเข้า ${g.name} แล้ว`, '📨');
  }
  const g = gangOf(a); if (!g) return toast(a, 'คุณยังไม่มีแก๊ง', '🏴', false);
  const role = g.mem[me].r, staff = role !== 'mem', tl = String(m.l || '').toLowerCase(), tm = g.mem[tl], to = accounts.get(tl);
  if (op === 'accept' || op === 'deny') {
    if (!staff) return toast(a, 'เฉพาะหัวหน้า/รองหัวหน้า', '🏴', false);
    const i = g.req.findIndex(r => r.l === tl); if (i < 0) return;
    g.req.splice(i, 1);
    if (op === 'accept') {
      if (!to || to.gang && gangOf(to)) { gdirty(); markMe(a); return toast(a, 'คนนี้เข้าแก๊งอื่นไปแล้ว', '🏴', false); }
      if (Object.keys(g.mem).length >= GANG.lv[g.lvl - 1].cap) { g.req.unshift({ l: tl, n: to.name, t: now() }); return toast(a, 'แก๊งเต็มแล้ว อัปเกรดบ้านแก๊งเพื่อรับเพิ่ม', '🏴', false); }
      g.mem[tl] = { r: 'mem', p: 0 }; to.gang = g.id; to.sd = true;
      if (to.ws) { toast(to, `ยินดีด้วย! คุณเข้าแก๊ง ${g.icon} ${g.name} แล้ว`, '🏴'); markMe(to); }
      toast(a, `รับ ${to.name} เข้าแก๊งแล้ว`, '✅');
    }
    gdirty(); return markMe(a);
  }
  if (op === 'leave') {
    if (role === 'boss' && Object.keys(g.mem).length > 1) return toast(a, 'หัวหน้าต้องส่งต่อตำแหน่งให้คนอื่นก่อนออก', '🏴', false);
    if (role === 'boss') { a.money += g.bank; gangs.delete(g.id); toast(a, `ยุบแก๊งแล้ว คืนเงินคลัง ${Math.round(g.bank).toLocaleString()} บาท`, '🏴'); }
    else { delete g.mem[me]; toast(a, `ออกจากแก๊ง ${g.name} แล้ว`, '🏴'); }
    a.gang = ''; a.sd = true; gdirty(); return markMe(a);
  }
  if (op === 'donate') {
    const amt = Math.floor(+m.amt) || 0;
    if (amt < 100) return toast(a, 'บริจาคขั้นต่ำ 100 บาท', '🏴', false);
    if (a.money < amt) return toast(a, 'เงินสดไม่พอ', '💸', false);
    a.money -= amt; g.bank += amt; gangAdd(g, me, Math.floor(amt / 50)); markMe(a);
    return toast(a, `บริจาค ${amt.toLocaleString()} บาทเข้าคลังแก๊ง`, '💰');
  }
  if (op === 'rest') {
    const L = GANG.lv[g.lvl - 1];
    if (!cd(a, 'gangrest', GANG.restMs)) return;
    a.energy = Math.min(100, a.energy + L.rest); markMe(a);
    return toast(a, `พักที่${L.n}แก๊ง พลังงาน +${L.rest}`, '🛋️');
  }
  if (op === 'upgrade') {
    if (role !== 'boss') return toast(a, 'เฉพาะหัวหน้าแก๊ง', '🏴', false);
    const N = GANG.lv[g.lvl]; if (!N) return toast(a, 'บ้านแก๊งอัปเกรดสูงสุดแล้ว', '🏴', false);
    if (g.bank < N.cost) return toast(a, `เงินคลังไม่พอ ต้องใช้ ${N.cost.toLocaleString()} บาท`, '💸', false);
    if (g.pts < N.pts) return toast(a, `แต้มแก๊งไม่พอ ต้องมี ${N.pts.toLocaleString()} แต้ม`, '🏴', false);
    g.bank -= N.cost; g.lvl++; gdirty();
    for (const l of Object.keys(g.mem)) { const o = accounts.get(l); if (o?.ws) { toast(o, `บ้านแก๊งอัปเป็น ${N.n}! 🎉`, '🏠'); markMe(o); } }
    return;
  }
  if (op === 'disband') {
    if (role !== 'boss') return toast(a, 'เฉพาะหัวหน้าแก๊ง', '🏴', false);
    for (const l of Object.keys(g.mem)) { const o = accounts.get(l); if (o) { o.gang = ''; o.sd = true; if (o.ws) { toast(o, `แก๊ง ${g.name} ถูกยุบ`, '🏴'); markMe(o); } } }
    a.money += g.bank; gangs.delete(g.id); gdirty(); return markMe(a);
  }
  if (!tm || !to) return;
  if (op === 'kick') {
    if (!staff || tm.r === 'boss' || (tm.r === 'vice' && role !== 'boss')) return toast(a, 'ไม่มีสิทธิ์ไล่คนนี้ออก', '🏴', false);
    delete g.mem[tl]; to.gang = ''; to.sd = true; gdirty();
    if (to.ws) { toast(to, `คุณถูกให้ออกจากแก๊ง ${g.name}`, '🏴', false); markMe(to); }
    return markMe(a);
  }
  if (op === 'vice') {
    if (role !== 'boss' || tm.r === 'boss') return;
    tm.r = tm.r === 'vice' ? 'mem' : 'vice'; gdirty(); if (to.ws) markMe(to); return markMe(a);
  }
  if (op === 'boss') {
    if (role !== 'boss') return toast(a, 'เฉพาะหัวหน้าแก๊ง', '🏴', false);
    tm.r = 'boss'; g.mem[me].r = 'vice'; g.boss = tl; gdirty();
    if (to.ws) { toast(to, `คุณเป็นหัวหน้าแก๊ง ${g.name} แล้ว`, '👑'); markMe(to); } return markMe(a);
  }
}




// ------------------------------------------------------------------ system letters (with gifts you claim in the mailbox)
function sysMail(o, text, gift) {
  o.mail = [{ id: now() + '' + Math.floor(Math.random() * 1000), from: '🏙️ เมือง Life Town', text, t: now(), read: 0, ...(gift ? { gift, got: 0 } : {}) }, ...(o.mail || [])].slice(0, 50);
  o.sd = true; dirty = true;
  if (o.ws) { markMe(o); send(o, { t: 'mail', list: o.mail }); toast(o, '📬 มีจดหมายใหม่ เปิดอ่านที่ ✉️', '📬'); }
}
function mailClaim(a, id) {
  const x = (a.mail || []).find(y => y.id === id); if (!x || !x.gift || x.got) return;
  x.got = 1; x.read = 1; const g = x.gift;
  if (g.eggs) addItem(a, 'petegg', g.eggs);
  if (g.gems) a.gems = (a.gems || 0) + g.gems;
  if (g.money) credit(a, g.money);
  if (g.outfit && D.OUTFITS[g.outfit] && !(a.outfits || []).includes(g.outfit)) { a.outfits = [...(a.outfits || []), g.outfit]; a.outfit = g.outfit; sendRoster(); }
  a.sd = true; markMe(a); send(a, { t: 'mail', list: a.mail });
  toast(a, `รับของขวัญแล้ว:${g.eggs ? ` 🥚 ไข่สัตว์เลี้ยง x${g.eggs}` : ''}${g.gems ? ` 💎${g.gems}` : ''}${g.money ? ` ${money(g.money)}` : ''}${g.outfit ? ` 🎽 ${a.gender === 'f' && D.OUTFITS[g.outfit]?.nf || D.OUTFITS[g.outfit]?.name} (ใส่ให้แล้ว)` : ''}${g.eggs ? ' · เปิดไข่ได้ในกระเป๋า 🎒' : ''}`, '🎁');
}
// New Year 2570 gift: everyone who joined by 31 Dec 2569 (Bangkok) gets the Santa outfit by mail, once
const SANTA_END = Date.parse('2027-01-01T00:00:00+07:00');
function santaGift(a) {
  if (a.santa || (a.created || 0) >= SANTA_END || !a.login || a.login === '__meta') return;
  a.santa = 1;
  sysMail(a, `🎄 ถึง ${a.name} ชาวเมืองที่รัก\n\nขอบคุณจากใจที่เลือกมาใช้ชีวิตอยู่ในเมืองเล็กๆ แห่งนี้ ทุกก้าวที่คุณเดิน ทุกงานที่คุณทำ ทุกคำทักทายที่คุณมอบให้เพื่อนบ้าน คือสิ่งที่ทำให้เมืองนี้มีชีวิต\n\nปีนี้เมืองของเราเติบโตขึ้นได้ก็เพราะมีคุณอยู่ด้วย เราจึงขอมอบ ชุดซานต้า ชุดพิเศษที่มีเฉพาะชาวเมืองรุ่นแรกเท่านั้น เป็นของขวัญแทนคำขอบคุณ\n\nขอให้ปีใหม่นี้ของคุณเต็มไปด้วยรอยยิ้ม ความสุข และเรื่องดีๆ ทั้งในเมืองนี้และในชีวิตจริง แล้วมาสร้างความทรงจำด้วยกันต่อนะ ❤️\n\nสวัสดีปีใหม่ 2570 🎁\nด้วยรัก จากทีมงานเมืองชีวิตนี้เลือกได้`, { outfit: 'santa' });
}
// a mystery egg: hatches into a pet you do not have yet (rarer ones less often)
function hatchEgg(a) {
  if (!(a.inv.petegg > 0)) return;
  const pool = Object.entries(D.PETS).filter(([k]) => !(a.pets || []).includes(k));
  addItem(a, 'petegg', -1);
  if (!pool.length) { a.gems = (a.gems || 0) + 30; markMe(a); return toast(a, 'คุณมีสัตว์เลี้ยงครบทุกตัวแล้ว! ไข่กลายเป็น 💎30', '💎'); }
  const W = { 1: 50, 2: 25, 3: 12, 4: 5, 5: 1.5 }, tot = pool.reduce((t, [, p]) => t + (W[p.rar] || 1), 0);
  let r = Math.random() * tot, id = pool[0][0];
  for (const [k, p] of pool) { r -= W[p.rar] || 1; if (r <= 0) { id = k; break; } }
  const P = D.PETS[id]; a.pets = [...(a.pets || []), id]; a.pet = id; markMe(a); sendRoster(); joy(a, 8 + P.rar * 3);
  send(a, { t: 'hatch', id, rar: P.rar });
  if (P.rar >= 4) feed(`🥚 ${a.name} ฟักไข่ได้ ${P.icon}${P.name} สุดหายาก!`);
  return toast(a, `🐣 ไข่ฟักแล้ว! ได้ ${P.icon}${P.name} มาเลี้ยง เดินตามคุณอยู่`, '🐣');
}
// ------------------------------------------------------------------ invite friends: a code to share; the new player gets an egg, the inviter an egg + 10 gems (in the mailbox)
const REF = { gems: 10, max: 20, newHours: 72, needMin: 30 };   // the inviter is paid once the friend has really played 30 minutes
function refCode(a) {
  if (a.rcode) return a.rcode;
  const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c;
  do { c = ''; for (let i = 0; i < 6; i++) c += C[Math.floor(Math.random() * C.length)]; } while ([...accounts.values()].some(o => o.rcode === c));
  a.rcode = c; a.sd = true; return c;
}
function refUse(a, code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a.refBy) return toast(a, 'คุณใส่โค้ดเพื่อนไปแล้ว', '🎟️', false);
  if (now() - (a.created || 0) > REF.newHours * 3600e3) return toast(a, `ใส่โค้ดเพื่อนได้เฉพาะผู้เล่นใหม่ภายใน ${REF.newHours / 24} วันแรก`, '🎟️', false);
  const o = [...accounts.values()].find(x => x.rcode === code);
  if (!o) return toast(a, 'ไม่พบโค้ดนี้ ตรวจดูอีกครั้งนะ', '🎟️', false);
  if (o === a) return toast(a, 'ใส่โค้ดของตัวเองไม่ได้', '🎟️', false);
  a.refBy = lk(o); a.sd = true; o.refN = (o.refN || 0) + 1; o.sd = true;
  sysMail(a, `🎉 ยินดีต้อนรับ! คุณใส่โค้ดของ ${o.name} รับไข่สัตว์เลี้ยงปริศนา 1 ใบ แล้วเปิดในกระเป๋าเพื่อฟักเลย`, { eggs: 1 });
  a.refPend = 1;
  sysMail(o, `🎟️ ${a.name} ใช้โค้ดชวนเพื่อนของคุณแล้ว! เมื่อเพื่อนเล่นครบ ${REF.needMin} นาที คุณจะได้ไข่สัตว์เลี้ยงสุ่ม 1 ใบ และ 💎${REF.gems}`);
  markMe(a); toast(a, `ใช้โค้ดของ ${o.name} แล้ว! ไปรับไข่ที่จดหมาย ✉️`, '🎟️');
}
// ------------------------------------------------------------------ market: unsold listings are bought by the town at a fair price
const LIST_AUTO = 2 * 3600e3, LIST_AUTO_RATE = 0.4;   // after 2 hours on the stall, at 40% of the market price
function listingsTick() {
  const t = now();
  for (const o of accounts.values()) {
    const L0 = o.listings || []; if (!L0.length) continue;
    let total = 0, n = 0, keep = [];
    for (const L of L0) {
      if (!L.t) { L.t = t; o.sd = true; }
      if (t - L.t < LIST_AUTO) { keep.push(L); continue; }
      // the town pays a little more than an NPC shop (40% of market vs 30%), never above the asking price, and like an NPC sale it presses the price down
      for (let i = 0; i < L.qty; i++) {
        if (!market[L.item] || !D.ITEMS[L.item]) break;
        total += Math.max(1, Math.min(L.price, marketPrice(L.item) * LIST_AUTO_RATE)); market[L.item].mult = Math.max(0.4, market[L.item].mult * 0.985);
      }
      n += L.qty;
    }
    if (!n) continue;
    o.listings = keep; o.sd = true; dirty = true; wdAt = 0;
    const got = Math.floor(total); credit(o, got); stat(o, 'psold', n);
    if (o.ws) { quest(o, 'sell', n); toast(o, `🏪 ของที่วางขายครบ 2 ชั่วโมง ตลาดรับซื้อให้ ${n} ชิ้น ได้ ${money(got)}`, '💰'); markMe(o); }
    else { sysMail(o, `🏪 ของที่คุณวางขายไว้ครบ 2 ชั่วโมงแล้ว ตลาดกลางรับซื้อให้ ${n} ชิ้น (40% ของราคาตลาด) ได้เงิน ${money(got)} เข้ากระเป๋าแล้ว`); }
  }
}
// every minute: count real play (moved in the last 2 minutes) and pay the inviter once the friend reaches REF.needMin
function refTick() {
  const t = now();
  for (const a of online.values()) {
    if (!a.refPend || t - (a.lastMoveT || 0) > 120e3) continue;
    a.actMin = (a.actMin || 0) + 1; a.sd = true;
    if (a.actMin < REF.needMin) continue;
    a.refPend = 0;
    const o = accounts.get(a.refBy) || [...accounts.values()].find(x => lk(x) === a.refBy); if (!o) continue;
    o.refPaid = (o.refPaid || 0) + 1; o.sd = true; dirty = true;
    if (o.refPaid <= REF.max) sysMail(o, `🎉 ${a.name} เล่นครบ ${REF.needMin} นาทีแล้ว! รับไข่สัตว์เลี้ยงสุ่ม 1 ใบ และ 💎${REF.gems}`, { eggs: 1, gems: REF.gems });
  }
}
setInterval(() => { try { refTick(); } catch (e) { console.error('refTick', e); } }, 60e3).unref?.();
setInterval(() => { try { listingsTick(); } catch (e) { console.error('listingsTick', e); } }, 60e3).unref?.();
// ------------------------------------------------------------------ government lottery (phone app 🎫): draws on the 1st and 16th at 16:00 Bangkok time
// a money sink: tickets cost ฿100, about 40% comes back as prizes. Prizes go out by mail (claim the gift).
const LOTTO = { price: 100, max: 100, first: 3000000, l3: 4000, l2: 2000 };
let lotto = { cur: '', last: null };
function lottoNext(t = now()) {   // the next draw: [key 'YYYY-MM-DD', time]
  const b = new Date(t + 7 * 3600e3);
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + i));
    if (d.getUTCDate() !== 1 && d.getUTCDate() !== 16) continue;
    const at = d.getTime() + 16 * 3600e3 - 7 * 3600e3;
    if (at > t) return [d.toISOString().slice(0, 10), at];
  }
}
const lottoNum = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
function lottoView(a) {
  const [key, at] = lottoNext(), my = a.lotto?.key === key ? a.lotto.nums : [];
  send(a, { t: 'lotto', key, at, price: LOTTO.price, max: LOTTO.max, prize: { first: LOTTO.first, l3: LOTTO.l3, l2: LOTTO.l2 }, my, last: lotto.last, myLast: a.lottoRes || null });
}
function lottoOp(a, m) {
  if (m.op === 'view') return lottoView(a);
  const [key] = lottoNext();
  if (a.lotto?.key !== key) a.lotto = { key, nums: [] };
  const L = a.lotto;
  if (m.op === 'buy') {
    let nums = [];
    if (m.num != null) { const n = String(m.num).replace(/\D/g, ''); if (n.length !== 6) return toast(a, 'ใส่เลข 6 หลัก', '🎫', false); nums = [n]; }
    else { const q = clamp(Math.floor(+m.qty) || 1, 1, 50); for (let i = 0; i < q; i++) nums.push(lottoNum()); }
    if (L.nums.length + nums.length > LOTTO.max) return toast(a, `ซื้อได้งวดละไม่เกิน ${LOTTO.max} ใบ`, '🎫', false);
    if (!pay(a, nums.length * LOTTO.price)) return;
    L.nums.push(...nums); a.sd = true; stat(a, 'lotto', nums.length);
    toast(a, `ซื้อลอตเตอรี่ ${nums.length} ใบ (${money(nums.length * LOTTO.price)}) ลุ้นงวด ${thDate(key)}`, '🎫');
    return lottoView(a);
  }
}
const thDate = k => { const [y, mo, d] = k.split('-').map(Number); return `${d} ${D.MONTHS ? ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][mo - 1] : mo} ${y + 543}`; };
function lottoTick() {
  const [key] = lottoNext();
  if (!lotto.cur) { lotto.cur = key; gdirty(); return; }
  if (lotto.cur === key) return;
  // the current draw time has passed: draw it
  const k = lotto.cur, first = lottoNum(), l3 = [lottoNum().slice(3), lottoNum().slice(3)], l2 = lottoNum().slice(4);
  let winners = 0, firstBy = [];
  for (const a of accounts.values()) {
    if (a.lotto?.key !== k) continue;
    let won = 0, hits = [];
    for (const n of a.lotto.nums) {
      if (n === first) { won += LOTTO.first; hits.push(`🥇 ${n}`); firstBy.push(a.name); }
      if (l3.includes(n.slice(3))) { won += LOTTO.l3; hits.push(`3 ตัวท้าย ${n}`); }
      if (n.slice(4) === l2) { won += LOTTO.l2; hits.push(`2 ตัวท้าย ${n}`); }
    }
    a.lottoRes = { key: k, n: a.lotto.nums.length, won }; a.lotto = null; a.sd = true;
    if (won) { winners++; sysMail(a, `🎫 ยินดีด้วย! ลอตเตอรี่งวด ${thDate(k)} ถูกรางวัล\n${hits.slice(0, 8).join('\n')}${hits.length > 8 ? `\n...อีก ${hits.length - 8} รางวัล` : ''}\nรวม ${money(won)} กดรับเงินได้เลย`, { money: won }); }
    else if (a.ws) toast(a, `ลอตเตอรี่งวด ${thDate(k)} ออกแล้ว: รางวัลที่ 1 ${first} · ไม่ถูกรางวัล เสียดายจัง`, '🎫', false);
  }
  lotto.last = { key: k, first, l3, l2, winners, firstBy };
  lotto.cur = key; gdirty();
  feed(`🎫 ผลลอตเตอรี่งวด ${thDate(k)} · รางวัลที่ 1: ${first} · 3 ตัวท้าย: ${l3.join(', ')} · 2 ตัวท้าย: ${l2}${firstBy.length ? ` · 🎉 ${firstBy.join(', ')} ถูกรางวัลที่ 1!` : ''}`);
}
setInterval(() => { try { lottoTick(); } catch (e) { console.error('lottoTick', e); } }, 60e3).unref?.();
setTimeout(() => { try { lottoTick(); } catch (e) { console.error('lottoTick', e); } }, 5000);
// ------------------------------------------------------------------ ZOMBIE NIGHT: every 13th (Bangkok) at 20:00, the dead rise
// 60s warning to get out of buildings -> anyone still inside is overrun (dead, back at the square); zombies come in waves
// wherever living players are and chase them; survive to the end = a reward by mail. Buildings stay unsafe (doors sealed) all wave.
const ZN = { day: 13, hour: 20, warn: 60e3, dur: 5 * 60e3, waveEvery: 70e3, cap: 60,
  prize: { money: 5000, gems: 5 },
  kinds: { walk: { speed: 1.6, r: .7, name: 'ซอมบี้' }, girl: { speed: 1.8, r: .7, name: 'ซอมบี้สาว' }, run: { speed: 3.2, r: .7, name: 'ซอมบี้วิ่ง' }, brute: { speed: 1.3, r: 1.05, name: 'ซอมบี้ยักษ์' } } };
let zn = null, znDone = '', znSeq = 0, znAnnounced = '';
const znAlive = a => zn?.ph === 'on' && zn.alive.has(a.id);
const zombies = () => npcs.filter(n => n.zb);
function znState(a) {
  if (!zn) return { t: 'zn', ph: 'off' };
  const names = zn.ph === 'on' ? [...zn.alive].map(id => online.get(id)?.name).filter(Boolean).slice(0, 30) : [];
  return { t: 'zn', ph: zn.ph, end: zn.ph === 'warn' ? zn.t0 : zn.end, wave: zn.wave || 0, alive: zn.alive?.size || 0, names, me: zn.ph === 'on' ? (zn.alive.has(a.id) ? 'alive' : zn.dead.has(a.id) ? 'dead' : 'out') : '' };
}
function znSendAll() { for (const o of online.values()) send(o, znState(o)); }
function znStart(t, test) {
  zn = { ph: 'warn', t0: t + (test ? 15e3 : ZN.warn), alive: new Set(), dead: new Set(), wave: 0, test };
  if (!test) { znDone = dayKey(); dirty = true; }
  feed('🧟 คืนปล่อยผี! ซอมบี้กำลังบุกเมือง ออกจากอาคารด่วน!');
  for (const o of online.values()) toast(o, `🧟 ซอมบี้กำลังบุกเมือง! ออกจากอาคารภายใน ${Math.round((zn.t0 - t) / 1000)} วินาที คนที่อยู่ในอาคารจะโดนรุมกิน`, '☣️', false);
  znSendAll();
}
// zombie night is fought in town: the park, the housing estate (and its yards) and the temple are closed
const ZN_NOGO = id => id === 'park' || id === 'housing' || id === 'temple' || /^yard\d+$/.test(id);
const ZN_BACK = { park: 'town_from_park', housing: 'town_from_housing', temple: 'town_from_temple' };
function znEvict(a) {
  const id = areaId(a); if (!ZN_NOGO(id)) return;
  if (a.fun) rideOff(a);
  const g = D.GATES[ZN_BACK[id] || 'town_from_housing'] || D.SPAWN; teleport(a, g.x, g.y);
  toast(a, '🧟 คืนปล่อยผี: พาคุณกลับเข้าเมืองแล้ว สวนสนุก หมู่บ้านจัดสรร และวัด ปิดชั่วคราว', '🚧', false);
}
function znKill(a, why) {
  if (!znAlive(a)) return;
  zn.alive.delete(a.id); zn.dead.add(a.id);
  if (!a.down) { if (a.fun) rideOff(a); const s = ST.square; const p = standNear('town', s.x + rnd(-2, 2), s.y + rnd(1, 3)) || [D.SPAWN.x, D.SPAWN.y]; teleport(a, p[0], p[1]); }
  send(a, { t: 'zdie', why });
  feed(`🧟 ${a.name} ${why === 'in' ? 'โดนซอมบี้รุมในอาคาร' : 'โดนซอมบี้กัด'} · เหลือผู้รอด ${zn.alive.size} คน`);
  znSendAll();
}
function znSpawn(t) {
  zn.wave++; const pts = [], last = t + ZN.waveEvery >= zn.end;
  const areas = new Map();
  for (const o of online.values()) if (znAlive(o)) { const id = areaId(o); if (D.AREAS.find(r => r.id === id)?.kind === 'map') (areas.get(id) || areas.set(id, []).get(id)).push(o); }
  for (const [area, ps] of areas) {
    const n = Math.min(14, 2 + zn.wave * 2 + ps.length), tiles = walkableIn(area);
    for (let i = 0; i < n && zombies().length < ZN.cap; i++) {
      let p = null;
      for (let k = 0; k < 30 && !p; k++) { const [x, y] = pick(tiles), d = Math.min(...ps.map(o => Math.hypot(o.x - x - .5, o.y - y - .5))); if (d > 9 && d < 26) p = [x + .5, y + .5]; }
      if (!p) { const [x, y] = pick(tiles); if (Math.min(...ps.map(o => Math.hypot(o.x - x - .5, o.y - y - .5))) > 6) p = [x + .5, y + .5]; }
      if (!p) continue;
      const r = Math.random(), kind = last && i < 2 ? 'brute' : zn.wave >= 2 && r < .25 ? 'run' : r < .6 ? 'walk' : 'girl', K = ZN.kinds[kind];
      const z = { id: -(9000 + (znSeq++ % 900)), zb: kind, name: K.name, area, x: p[0], y: p[1], f: 2, path: [], wait: 1.2, speed: K.speed * rnd(.92, 1.08), zt: 0, g: 'm', look: {},
        next: () => znGoal(z), stay: () => .15 };
      npcs.push(z); pts.push([area, +p[0].toFixed(1), +p[1].toFixed(1)]);
    }
  }
  npcRosterDirty = true;
  if (pts.length) broadcast({ t: 'zspawn', p: pts, wave: zn.wave });
  for (const o of online.values()) if (znAlive(o)) toast(o, `🧟 ซอมบี้ระลอก ${zn.wave}${last ? ' (ระลอกสุดท้าย! ซอมบี้ยักษ์มาแล้ว)' : ''} โผล่มาแล้ว วิ่งหนีให้รอด!`, '🧟', false);
}
// who a zombie goes for: the nearest living player in its area, else it shuffles about
function znGoal(z) {
  let best = null, bd = 1e9;
  for (const o of online.values()) if (znAlive(o) && areaId(o) === z.area) { const d = Math.hypot(o.x - z.x, o.y - z.y); if (d < bd) { bd = d; best = o; } }
  z.tgt = best;
  if (best) return [best.x, best.y];
  const [x, y] = pick(walkableIn(z.area)); return [x + .5, y + .5];
}
function znEnd(t) {
  const alive = [...zn.alive].map(id => online.get(id)).filter(Boolean);
  for (const a of alive) { sysMail(a, `📜 จดหมายผู้รอดชีวิต\n\nถึง ${a.name}\n\nคืนนี้เมืองของเราเผชิญกับฝูงซอมบี้ แต่คุณเอาตัวรอดมาได้จนฟ้าสาง! ความกล้าหาญและไหวพริบของคุณทำให้ทุกคนมีความหวัง\n\nทางเมืองขอมอบรางวัลผู้รอดชีวิตเป็นของขวัญ แล้วเจอกันใหม่คืนวันที่ 13 เดือนหน้า... ถ้ากล้า 🧟`, { ...ZN.prize }); stat(a, 'zsurvive'); joy(a, 10); }
  for (const z of zombies()) npcs.splice(npcs.indexOf(z), 1);
  npcRosterDirty = true;
  feed(alive.length ? `🌅 ฟ้าสางแล้ว ซอมบี้หายไปหมด · ผู้รอดชีวิต ${alive.length} คน: ${alive.slice(0, 8).map(a => a.name).join(', ')}${alive.length > 8 ? ' ...' : ''}` : '🌅 ฟ้าสางแล้ว ซอมบี้หายไปหมด · คืนนี้ไม่มีใครรอดเลย!');
  const was = zn; zn = null;
  for (const o of online.values()) { send(o, { t: 'zn', ph: 'end', won: was.alive.has(o.id) ? 1 : 0, n: alive.length, names: alive.map(a => a.name).slice(0, 30), ids: alive.map(a => a.id) }); }
}
function znTick() {
  const t = now(), bk = new Date(t + 7 * 3600e3), day = dayKey();
  if (!zn && bk.getUTCDate() === ZN.day && znDone !== day) {
    const h = bk.getUTCHours() + bk.getUTCMinutes() / 60;
    if (h >= ZN.hour - 1 && h < ZN.hour && znAnnounced !== day + (h >= ZN.hour - .5 ? 'b' : 'a')) {
      znAnnounced = day + (h >= ZN.hour - .5 ? 'b' : 'a');
      feed(`🌕 คืนนี้วันที่ 13 คืนปล่อยผี! ซอมบี้จะบุกเมืองเวลา ${ZN.hour}:00 น. เตรียมตัวให้พร้อม`);
      for (const o of online.values()) toast(o, `🌕 คืนนี้ ${ZN.hour}:00 น. ซอมบี้จะบุกเมือง! อยู่นอกอาคารแล้วเอาตัวรอดให้ได้ รับรางวัลผู้รอดชีวิต`, '🧟');
    }
    if (h >= ZN.hour && h < ZN.hour + .5) znStart(t);
  }
  if (!zn) return;
  if (zn.ph === 'warn' && t >= zn.t0) {
    zn.ph = 'on'; zn.end = t + (zn.test ? 150e3 : ZN.dur); zn.next = t;
    for (const o of online.values()) if (!hidden(o) && o.login) zn.alive.add(o.id);
    for (const o of online.values()) if (znAlive(o) && (D.areaAt(o.x, o.y)?.kind === 'room' || o.down)) znKill(o, 'in');
    znSendAll();
  }
  if (zn.ph !== 'on') return;
  if (!zn.alive.size && !zn.allDead) zn.allDead = t;
  if (t >= zn.end || zn.allDead && t - zn.allDead > 8000) return znEnd(t);
  if (t >= zn.next && t < zn.end - 25e3) { zn.next = t + (zn.test ? 40e3 : ZN.waveEvery); znSpawn(t); }
  for (const o of online.values()) if (znAlive(o) && (D.areaAt(o.x, o.y)?.kind === 'room' || o.down)) znKill(o, 'in');
  for (const o of online.values()) if (znAlive(o)) znEvict(o);
  for (const z of zombies()) {
    if (z.wait > 0) continue;
    const tg = z.tgt;
    if (tg && znAlive(tg) && areaId(tg) === z.area && Math.hypot(tg.x - z.x, tg.y - z.y) < ZN.kinds[z.zb].r) { znKill(tg, 'bite'); z.wait = 1.5; z.path = []; continue; }
    if (t > z.zt) { z.zt = t + 700 + Math.random() * 300; z.path = []; }   // re-aim at a moving target
    else if (tg && Math.hypot(tg.x - z.x, tg.y - z.y) < 1.6) z.path = [[tg.x, tg.y]];
  }
  if (t % 5000 < 250) znSendAll();
}
setInterval(() => { try { if (online.size || zn) znTick(); } catch (e) { console.error('znTick', e); } }, 250).unref?.();
// ------------------------------------------------------------------ idea board (phone app): players post game ideas, like and comment
let ideas = [], ideaSeq = 1;
function ideaView(a, sort) {
  const me = lk(a), L = [...ideas].sort(sort === 'top' ? (x, y) => Object.keys(y.lk).length - Object.keys(x.lk).length || y.t - x.t : (x, y) => y.t - x.t).slice(0, 60);
  send(a, { t: 'ideas', sort, list: L.map(i => ({ id: i.id, n: i.n, text: i.text, t: i.t, likes: Object.keys(i.lk).length, liked: i.lk[me] ? 1 : 0, mine: i.l === me || isAdmin(a) ? 1 : 0, cm: i.cm.slice(-30) })) });
}
function ideaOp(a, m) {
  const me = lk(a), i = ideas.find(x => x.id === +m.id);
  if (m.op === 'post') {
    const text = cleanText(m.text, 300); if (text.length < 5) return toast(a, 'เขียนไอเดียอย่างน้อย 5 ตัวอักษร', '💡', false);
    const d = dayKey(); if (!a.idd || a.idd.d !== d) a.idd = { d, n: 0 };
    if (a.idd.n >= 3 && !isAdmin(a)) return toast(a, 'วันนี้โพสต์ไอเดียครบ 3 โพสต์แล้ว พรุ่งนี้มาใหม่นะ', '💡', false);
    a.idd.n++; a.sd = true; ideas.push({ id: ideaSeq++, l: me, n: a.name, text, t: now(), lk: {}, cm: [] }); if (ideas.length > 300) ideas.shift();
    toast(a, 'โพสต์ไอเดียแล้ว ขอบคุณที่ช่วยออกแบบเมือง! 💡', '💡');
    for (const o of online.values()) if (isAdmin(o) && o !== a) toast(o, `💡 ไอเดียใหม่จาก ${a.name}`, '💡');
  } else if (!i) return ideaView(a, m.sort);
  else if (m.op === 'like') { if (i.lk[me]) delete i.lk[me]; else i.lk[me] = 1; }
  else if (m.op === 'cm') {
    const text = cleanText(m.text, 150); if (text.length < 1) return;
    if (!cd(a, 'ideacm', 5000)) return;
    i.cm.push({ n: a.name, text, t: now(), a: isAdmin(a) ? 1 : 0 }); if (i.cm.length > 60) i.cm.shift();
    const o = accounts.get(i.l); if (o?.ws && o !== a) toast(o, `💬 ${a.name} คอมเมนต์ไอเดียของคุณ`, '💡');
  } else if (m.op === 'del') { if (i.l !== me && !isAdmin(a)) return; ideas = ideas.filter(x => x !== i); }
  gdirty(); ideaView(a, m.sort);
}
// ------------------------------------------------------------------ leaderboard rivals
// Phantom rich folk who only exist on the leaderboard. Each one shadows a real player's rank like a rival with moods:
//  chase - creeps up (over a day or so, never in one jump) until it sits a few percent above that player
//  lead  - stays just ahead, following the player's growth
//  rest  - once the player overtakes it, it lets them enjoy the lead for 2-3 days (grows only a little), then chases again
// Ghosts never lose money (that would look fake), and each one's rest length is random so they don't all wake together.
let ghosts = [];
// [name, career, rank slot, margin, title] - names and titles look like ordinary players'
const GHOST = [['Bankky', 'merchant', 0, .035, 'mer2'], ['มิ้นท์ชอบนอน', 'doctor', 1, .05, 'doc1'], ['KaoHom', 'merchant', 2, .03, 'far3'], ['NoeyNoey', 'merchant', 4, .06, 'gen2'], ['ต้นกล้า', 'rider', 6, .04, 'rid1'], ['Pond_zz', 'doctor', 9, .05, 'fis1']];
function ghostLook() {   // keep the saved money, always show the current names/titles (old saves had other names)
  ghosts.forEach((g, i) => { const G = GHOST[i]; if (!G) return; g.n = accounts.has(G[0].toLowerCase()) ? G[0] + '_' : G[0]; g.c = G[1]; g.ti = G[4]; });
}
const ghostTi = g => D.ACHIEVEMENTS.find(x => x.id === g.ti)?.title || '';
const GH = { tick: 5 * 60e3, restMin: 48 * 3600e3, restMax: 72 * 3600e3, restGrow: .02, chase: .012, follow: .04, lazy: .3 };
function ghostTick() {
  const R = [...accounts.values()].filter(a => !isAdmin(a)).map(a => worth(a)).sort((x, y) => y - x);
  const real = g => R[g.k];
  const want = g => real(g) !== undefined ? real(g) * (1 + g.m) : (R[R.length - 1] ?? 20000) * (.92 - g.k * .04);   // few players: the extra rivals sit below everyone
  if (ghosts.length !== GHOST.length) ghosts = GHOST.map(([n, c, k, m], i) => ({ n, c, k, m, w: ghosts[i]?.w || Math.max(3000, want({ k, m })) }));
  const t = now(), perTick = r => Math.pow(1 + r, GH.tick / 86400e3) - 1;   // a daily rate spread over the 5-minute ticks
  ghostLook();
  for (const g of ghosts) {
    g.st = g.st || 'chase';
    const tgt = Math.max(3000, want(g)), p = real(g);
    if (p !== undefined && g.w > p) g.ahead = 1;
    if (p !== undefined && p > g.w && g.ahead && g.st !== 'rest') {   // the player just overtook: let them have it for a while
      g.st = 'rest'; g.ahead = 0; g.until = t + GH.restMin + Math.random() * (GH.restMax - GH.restMin);
    }
    if (g.st === 'rest') {
      g.w *= 1 + perTick(GH.restGrow);
      if (t >= g.until) { if (Math.random() < GH.lazy) g.until = t + 24 * 3600e3; else g.st = 'chase'; }   // sometimes it stays lazy one more day
    } else if (g.st === 'chase') {
      if (g.w < tgt) g.w += Math.max((tgt - g.w) * GH.chase, g.w * perTick(.05));
      if (g.w >= tgt * .995) g.st = 'lead';
    } else {                                                        // lead: keep a nose ahead, never pull away
      if (g.w < tgt) g.w += (tgt - g.w) * GH.follow;
      else g.w *= 1 + perTick(.01);
    }
  }
  gdirty();
}
setInterval(() => { try { ghostTick(); } catch (e) { console.error('ghostTick', e); } }, 5 * 60e3).unref?.();
setTimeout(() => { try { ghostTick(); } catch { } }, 4000);
// ------------------------------------------------------------------ city mayor (elected)
// Every 4 weeks the town votes. Candidates pay to run and can campaign (reputation); one vote per player per cycle.
// The winner serves the next cycle: a title, a daily salary, one city policy and a daily announcement. Two terms in a row at most.
const MAYOR = { minLv: 8, voteLv: 5, fee: 50000, camp: 10000, campDay: 4, salary: 3000, care: 400, tax: .03, maxTerms: 2, weeks: 4,
  pol: { tax: { n: '💹 ลดภาษี', d: 'รายได้ของทุกคนในเมือง +3%' }, care: { n: '🎁 เบี้ยเมือง', d: 'ทุกคนรับเบี้ยเมือง 400 บาททุกวัน' } } };
let mayor = null;                // { l, n, pol, terms, at, ann, annD, salD }
let elect = { cy: '', c: {} };   // c: login -> { n, rep, v: { voter: 1 }, t, rd: { d, n } }
// candidates also earn reputation by doing good for the town (free, capped per day); paid campaigning stays on top
const REP_SRC = { donated: [1, 'ให้ทานผู้อื่น'], treated: [.5, 'รักษาคนไข้'], revived: [1, 'ช่วยชีวิตคน'], missions: [.5, 'ทำภารกิจช่วยเมือง'],
  delivered: [.5, 'ส่งของให้ชาวเมือง'], trash: [.05, 'เก็บขยะให้เมือง'], pray: [.25, 'ทำบุญที่วัด'], zsurvive: [3, 'รอดจากคืนปล่อยผี'], quizOk: [.2, 'ตั้งใจเรียน'] };
const REP_DAY = 6;
function repFrom(a, key, n) {
  const src = REP_SRC[key]; if (!src || !a?.login) return;
  const c = elect.c[lk(a)]; if (!c) return;
  const d = dayKey(); if (!c.ad || c.ad.d !== d) c.ad = { d, n: 0 };
  if (c.ad.n >= REP_DAY) return;
  c.fr = (c.fr || 0) + src[0] * n;
  const g = Math.min(Math.floor(c.fr), REP_DAY - c.ad.n); if (g <= 0) return;
  c.fr -= Math.floor(c.fr); c.rep += g; c.ad.n += g; gdirty();
  toast(a, `ชื่อเสียง +${g} จาก${src[1]} (รวม ${c.rep})${c.ad.n >= REP_DAY ? ' · วันนี้ได้ครบแล้ว' : ''}`, '🌟');
}
const cycleKey = () => String(Math.floor(Date.parse(weekKey()) / 604800e3 / MAYOR.weeks));
const isMayor = a => !!mayor && mayor.l === lk(a);
const votesOf = c => Object.keys(c.v).length;
function mayorRoll() {
  const cy = cycleKey(); if (elect.cy === cy) return;
  if (elect.cy) {                                   // the last election just ended
    const old = mayor, win = Object.entries(elect.c).map(([l, c]) => ({ l, n: c.n, t: c.t, vt: votesOf(c), s: votesOf(c) * 10 + c.rep }))
      .filter(c => c.vt > 0 && !(old && c.l === old.l && (old.terms || 1) >= MAYOR.maxTerms)).sort((x, y) => y.s - x.s || x.t - y.t)[0];
    if (win) {
      const o = accounts.get(win.l);
      mayor = { l: win.l, n: o?.name || win.n, pol: '', terms: old && old.l === win.l ? (old.terms || 1) + 1 : 1, at: now(), ann: '', annD: '', salD: '' };
      feed(`🏛️ ผลเลือกตั้ง: ${mayor.n} ได้เป็นนายกเมืองคนใหม่ ด้วย ${win.vt} คะแนนเสียง!`);
      if (o?.ws) toast(o, 'คุณได้เป็นนายกเมือง! เปิดแอป 🏛️ เลือกนโยบายและรับเงินเดือนได้เลย', '🏛️');
    } else if (old) { mayor = null; feed('🏛️ สิ้นสุดวาระนายกเมือง ไม่มีผู้ชนะการเลือกตั้งรอบนี้ ตำแหน่งว่างลง'); }
    sendRoster();
  }
  elect = { cy, c: {} }; gdirty();
}
setInterval(() => { try { mayorRoll(); } catch (e) { console.error('mayorRoll', e); } }, 60e3).unref?.();
function mayorView(a) {
  mayorRoll(); const me = lk(a), d = dayKey(), tw = Math.floor(Date.parse(weekKey()) / 604800e3), dow = (new Date(now() + 7 * 3600e3).getUTCDay() + 6) % 7;
  const cands = Object.entries(elect.c).map(([l, c]) => ({ l, n: c.n, v: votesOf(c), rep: c.rep, s: votesOf(c) * 10 + c.rep })).sort((x, y) => y.s - x.s);
  const mc = elect.c[me];
  return { t: 'mayor', my: me, cur: mayor ? { l: mayor.l, n: mayor.n, pol: mayor.pol, terms: mayor.terms, ann: mayor.ann } : null, isMe: isMayor(a) ? 1 : 0, left: (MAYOR.weeks - (tw % MAYOR.weeks)) * 7 - dow, cands,
    voted: Object.entries(elect.c).find(([, c]) => c.v[me])?.[0] || '', run: mc ? { rep: mc.rep, left: Math.max(0, MAYOR.campDay - (mc.rd?.d === d ? mc.rd.n : 0)), act: mc.ad?.d === d ? mc.ad.n : 0, actMax: REP_DAY } : null,
    claimed: a.mpd === d ? 1 : 0, salDone: mayor?.salD === d ? 1 : 0, annDone: mayor?.annD === d ? 1 : 0, lv: lvl(a), K: { ...MAYOR, pol: undefined }, pol: MAYOR.pol };
}
function mayorOp(a, m) {
  mayorRoll(); const op = m.op, me = lk(a), d = dayKey();
  if (op === 'view') return send(a, mayorView(a));
  if (op === 'run') {
    if (lvl(a) < MAYOR.minLv) return toast(a, `ต้องเลเวล ${MAYOR.minLv} ขึ้นไปจึงลงสมัครได้`, '🏛️', false);
    if (elect.c[me]) return toast(a, 'คุณลงสมัครแล้ว', '🏛️', false);
    if (mayor && mayor.l === me && (mayor.terms || 1) >= MAYOR.maxTerms) return toast(a, `เป็นนายกครบ ${MAYOR.maxTerms} วาระติดแล้ว ต้องพักหนึ่งสมัย`, '🏛️', false);
    if (a.money < MAYOR.fee) return toast(a, `ค่าสมัคร ${MAYOR.fee.toLocaleString()} บาท`, '💸', false);
    a.money -= MAYOR.fee; elect.c[me] = { n: a.name, rep: 0, v: {}, t: now(), rd: null }; gdirty(); markMe(a);
    feed(`🗳️ ${a.name} ลงสมัครรับเลือกตั้งนายกเมือง!`); toast(a, 'ลงสมัครแล้ว! หาเสียงเพื่อเพิ่มชื่อเสียงได้ทุกวัน', '🗳️');
  } else if (op === 'camp') {
    const c = elect.c[me]; if (!c) return toast(a, 'ต้องลงสมัครก่อน', '🏛️', false);
    if (!c.rd || c.rd.d !== d) c.rd = { d, n: 0 };
    if (c.rd.n >= MAYOR.campDay) return toast(a, `วันนี้หาเสียงครบ ${MAYOR.campDay} ครั้งแล้ว`, '📣', false);
    if (a.money < MAYOR.camp) return toast(a, `หาเสียงใช้เงิน ${MAYOR.camp.toLocaleString()} บาท`, '💸', false);
    a.money -= MAYOR.camp; c.rd.n++; c.rep++; gdirty(); markMe(a); toast(a, `หาเสียงสำเร็จ ชื่อเสียง +1 (รวม ${c.rep})`, '📣');
  } else if (op === 'vote') {
    const l = String(m.l || '').toLowerCase(), c = elect.c[l];
    if (lvl(a) < MAYOR.voteLv) return toast(a, `ต้องเลเวล ${MAYOR.voteLv} ขึ้นไปจึงโหวตได้`, '🗳️', false);
    if (!c) return toast(a, 'ไม่พบผู้สมัครคนนี้', '🗳️', false);
    if (l === me) return toast(a, 'โหวตให้ตัวเองไม่ได้', '🗳️', false);
    if (Object.values(elect.c).some(x => x.v[me])) return toast(a, 'คุณโหวตไปแล้วในรอบนี้', '🗳️', false);
    c.v[me] = 1; gdirty(); toast(a, `โหวตให้ ${c.n} แล้ว`, '🗳️');
  } else if (op === 'claim') {
    if (mayor?.pol !== 'care') return toast(a, 'ตอนนี้ไม่มีนโยบายเบี้ยเมือง', '🎁', false);
    if (a.mpd === d) return toast(a, 'วันนี้รับเบี้ยเมืองไปแล้ว', '🎁', false);
    a.mpd = d; a.sd = true; credit(a, MAYOR.care); toast(a, `รับเบี้ยเมือง ${MAYOR.care} บาท`, '🎁');
  } else if (isMayor(a)) {
    if (op === 'pol') {
      if (!MAYOR.pol[m.k]) return; mayor.pol = m.k; gdirty();
      feed(`🏛️ นายกเมือง ${mayor.n} ประกาศนโยบาย ${MAYOR.pol[m.k].n}: ${MAYOR.pol[m.k].d}`);
    } else if (op === 'ann') {
      if (mayor.annD === d) return toast(a, 'วันนี้ประกาศไปแล้ว พรุ่งนี้ประกาศใหม่ได้', '📢', false);
      const t = cleanText(m.text, 70); if (t.length < 3) return toast(a, 'พิมพ์ประกาศอย่างน้อย 3 ตัวอักษร', '📢', false);
      mayor.annD = d; mayor.ann = t; gdirty(); feed(`🏛️ นายกเมือง ${mayor.n}: ${t}`);
    } else if (op === 'sal') {
      if (mayor.salD === d) return toast(a, 'วันนี้รับเงินเดือนไปแล้ว', '💰', false);
      mayor.salD = d; gdirty(); credit(a, MAYOR.salary); toast(a, `รับเงินเดือนนายกเมือง ${MAYOR.salary.toLocaleString()} บาท`, '🏛️');
    }
  }
  send(a, mayorView(a));
}
const tier = (a, c) => (a.tools && a.tools[c]) || 0;
const BOOST = [0, .15, .3, .5];
const houseOf = a => (a.house >= 0 ? a.house : -1);
const furnOf = a => [...(a.hown ? ['sbed'] : []), ...(a.furniture || []), ...(a.keep || [])];   // sbed: the bed every home comes with (movable, cannot be stored)
const inOwnHome = a => { const r = D.areaAt(a.x, a.y); return !!r && r.house !== undefined && r.house === a.house && (r.rk === 'house' || r.yard); };
// the sleep spot follows the owner's bed when they move it
function syncBed(a) {
  const i = a.house; if (!(i >= 0)) return; const s = ST['hbed' + i]; if (!s) return;
  const room = D.ROOMS.find(r => r.id === s.room); if (!room) return;
  const p = a.fpos?.sbed, fl = p?.[0] || 1;
  if (fl !== 1) return;   // only the ground floor carries the sleep spot
  const x = p ? p[1] : 3.4, y = p ? p[2] : 3.3;
  s.x = room.x + x; s.y = room.y + y + .4;
}
const fbase = k => String(k).split('#')[0];   // partition pieces can be owned many times: wdoor, wdoor#2, wdoor#3 ...
const FURN_MULTI_MAX = 40;
const YARD_FL = 9;                                   // fpos floor number that means "out in the yard"
// every new home comes with two vegetable fields already laid out either side of the path
function starterYard(a) {
  a.yfree = 1; a.fpos = { ...(a.fpos || {}) };
  for (const [k, x] of [['gfield', 12.5], ['gfield#2', 19.5]]) if (!(a.furniture || []).includes(k)) { a.furniture = [...(a.furniture || []), k]; a.fpos[k] = [YARD_FL, x, 16]; }
}
const yardOpen = (a, z) => D.YARD.start.includes(z) || (a.yz || []).includes(z);   // bought furniture + login-reward pieces (kept even without a house)
const COMFORT_MAX = 30;   // a big catalogue: comfort stops adding up past this
const comfort = a => a.hown ? Math.min(COMFORT_MAX, furnOf(a).reduce((s, k) => s + (D.FURNITURE[fbase(k)]?.comfort || 0), 0)) : 0;
const godSpeed = a => isAdmin(a) && a.god?.speed > 1 ? Math.min(5, a.god.speed) : 1;
const hidden = a => isAdmin(a) && !!a.god?.invis;     // god mode: invisible to everyone else
const riding = a => a.ride && (a.vehicles || []).includes(a.ride) && !a.pose && !a.down && D.areaAt(a.x, a.y)?.kind !== 'room' ? D.VEHICLES[a.ride] : null;
const speedOf = a => dzProd(a, 'speed') * godSpeed(a) * (riding(a)?.speed || 1);   // riding a vehicle outdoors
const runMul = a => a.run && a.energy > D.RUN.minEnergy ? D.RUN.mul : 1;
const moveCap = a => Math.max(2.5, SPEED * speedOf(a) * D.RUN.mul * 1.35 * 4);   // up to ~4 s of walking can arrive in one burst (mobile networks stall)
function accrue(a) {
  const t = now(), days = Math.min(D.BANK.offlineDays, (t - (a.bankT || t)) / D.DAY_MS); a.bankT = t;
  if (a.bank > 0 && days > 0) a.bank += Math.min(a.bank, D.BANK.cap) * (Math.pow(1 + D.BANK.rate, days) - 1);
  if (a.loan > 0 && days > 0) a.loan += a.loan * (Math.pow(1 + D.BANK.loanRate, days) - 1);
}
function quest(a, type, n = 1) {
  ledSweep(a);
  const evs = Q.progress(a, type, n); ledSweep(a, '📜 รางวัลเควสต์');
  for (const e of evs) {
    send(a, { t: 'quest', ...e });
    if (e.kind === 'all') feed(`📜 ${a.name} ทำเควสต์ประจำวันครบทั้ง 3 ข้อ! (ติดต่อกัน ${e.streak} วัน)`);
    if (e.kind === 'wall') { feed(`🗓️ ${a.name} ทำเควสต์รายสัปดาห์ครบทั้งหมด!`); stat(a, 'weekAll'); }
  }
  markMe(a);
}
// each merchant has their own allocation at the warehouse that refills over time, so merchants never empty the shelves on each other
function wstock(a, id) {
  const it = D.ITEMS[id], t = now(); a.wst = a.wst || {};
  const e = a.wst[id] || (a.wst[id] = [it.stock, t]);
  e[0] = Math.min(it.stock, e[0] + (t - e[1]) / 1000 / it.refill); e[1] = t;
  return e[0];
}
const wstockView = a => Object.fromEntries(Object.keys(D.ITEMS).filter(k => D.ITEMS[k].wholesale).map(k => [k, Math.floor(wstock(a, k))]));
// shops get tired of the same goods from the same seller: each merchant has their own price pressure per item (recovers ~0.4%/s)
function msat(a, id) {
  const t = now(); a.msat = a.msat || {}; const e = a.msat[id] || (a.msat[id] = [1, t]);
  e[0] = Math.min(1, e[0] + (t - e[1]) / 1000 * 0.004); e[1] = t; return e;
}
// what the market's buyers pay this player per unit for their own trade's goods (merchant goods, chef dishes): shown in the sell tab
function tradePrices(a) {
  const kind = { merchant: 'goods', chef: 'meal' }[a.career]; if (!kind) return null;
  const out = {}; for (const id in a.inv) if (a.inv[id] > 0 && D.ITEMS[id]?.kind === kind) out[id] = Math.round(npcBuyPrice(a, id, NPC_BUY) * msat(a, id)[0] * jobPay(a));
  return out;
}
function spend(a, e) {
  e = Math.ceil(e * D.ENERGY_MUL);   // work and quests tire you more: the amusement park is where you get it back
  if (a.energy < e) { toast(a, `พลังงานไม่พอ (ต้องใช้ ${e}) ไปเล่นสวนสนุก 🎡 หรือนอนพักที่เตียงในบ้าน 🛏️`, '😴', false); return false; }
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
  if (allJobs(a)) return true;                       // admins can do every job's work (switchable)
  if (a.career !== career) {
    const c = D.CAREERS[career], w = c.where && ST[c.where];
    toast(a, `ต้องเป็น${c.name}ก่อน — ไปสมัครงานที่ ${w ? w.label : '-'}`, '🚫', false); return false;
  }
  return true;
}
function addXp(a, n = 1) {
  const c = a.career; if (!c || c === 'none') return;
  const before = lvl(a), g = c === 'office' ? n : n * xpGain(before);
  a.xp[c] = +((a.xp[c] || 0) + g).toFixed(3); markMe(a);
  if (c !== 'office' && lvl(a) > before) { toast(a, `🎉 เลเวลอาชีพ${D.CAREERS[c].name}อัปเป็น Lv.${lvl(a)}! ได้เงินจากงานเพิ่มเป็น +${Math.round((jobPay(a) - 1) * 100)}%`, '⭐'); if (lvl(a) % 5 === 0) feed(`⭐ ${a.name} เลเวล${D.CAREERS[c].name}ถึง Lv.${lvl(a)}`); }
}
// licences that expire: the driving licence must be renewed every in-game year (1 real day)
const LICENSE_YEAR = 12 * D.MONTH_DAYS * D.DAY_MS;
const licExpired = (a, id) => (a.licenses || []).includes(id) && !!D.LICENSES[id]?.renew && (a.licExp?.[id] || 0) < now();
const hasLic = (a, id) => (a.licenses || []).includes(id) && !licExpired(a, id);
// fishing is open to everyone; its own level comes from catches (stored as xp.fisher)
const rodOf = a => D.RODS[(a.rods || []).includes(a.rodEq) ? a.rodEq : (a.rods || [])[0]] || null;   // the rod in hand
const fishLv = a => Math.min(D.FISHING.maxLv, 1 + Math.floor((a.xp?.fisher || 0) / D.FISHING.xpPerLv));

const NPC_BUY = 0.3;                         // NPC shops buy at a fraction of what players pay each other
const NPC_SELL = 2.5;
const FISH_RATE = 0.45;
// chefs: a dish sells to the restaurants for what its ingredients cost at the kitchen counter + a cook's fee
// (12 energy a dish, ~0.75 dishes a minute on natural energy => ~฿55/min at Lv.1, on par with police; cheaper ingredients bought from players are extra profit)
const CHEF_MARGIN = 72;
const CHEF_COST = Object.fromEntries(D.RECIPES.map(r => [r.id, Object.entries(r.in).reduce((s, [k, q]) => s + Math.ceil(D.ITEMS[k].base * 1.3) * q, 0)]));                       // the fish club pays this share of the market price (fishing sits just above begging on the pay ladder)                         // ...and sell at a big markup
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
  if (a.career === 'merchant' && it.kind === 'goods') rate = 0.74 + Math.min(0.08, 0.01 * (lvl(a, 'merchant') - 1));   // shops restock from merchants
  else if (a.career === 'merchant') b += 0.05;
  if (a.career === 'chef' && it.kind === 'meal' && CHEF_COST[id]) return (CHEF_COST[id] + CHEF_MARGIN) * marketPrice(id) / it.base;   // restaurants pay chefs the ingredients (kitchen price) plus a fixed cook's fee, so every recipe pays about the same
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
  if (a.house >= 0) { w += D.HOUSE_PRICES[a.house] * 0.7; for (const f of a.furniture || []) w += (D.FURNITURE[fbase(f)]?.price || 0) * 0.5; }
  for (const f of a.keep || []) w += (D.FURNITURE[f]?.price || 0) * 0.5;
  w += stockValue(a);
  if (a.garden) w += D.GARDEN.lotPrice * 0.6;
  return w;
}

// ------------------------------------------------------------------ persistence
function hashPin(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
const PET_LEASH = 800;
const SAVE_KEYS = ['ledger', 'ledBal', 'lastOff', 'hfl', 'hwl', 'hdeco', 'koDay', 'luxT', 'useDay', 'tax', 'fuelDay', 'fuelDue', 'lotto', 'lottoRes', 'jgDay', 'santa', 'rcode', 'refBy', 'refN', 'refPend', 'refPaid', 'actMin', 'pnames', 'leash', 'leashOn', 'gang', 'gpd', 'mpd', 'idd', 'v', 'login', 'name', 'salt', 'hash', 'avatar', 'money', 'energy', 'hunger', 'health', 'career', 'licenses', 'xp', 'inv', 'x', 'y', 'earned',
  'created', 'quests', 'qStreak', 'lastLogin', 'loginStreak', 'loginDays', 'wquests', 'keep', 'achGot', 'tools', 'vehicles', 'ride', 'gems', 'house', 'furniture', 'hlv', 'fpos', 'yz', 'ycrops', 'yfree', 'wst', 'msat', 'stocks', 'bank', 'bankT', 'loan', 'dz', 'awake', 'listings',
  'phone', 'contacts', 'stats', 'ach', 'title', 'jobChanges', 'enrolled', 'classes', 'office', 'garden', 'rent', 'houseSale', 'houseRent', 'down', 'happy', 'bills', 'billMonth', 'usage', 'utilOff', 'wanted', 'crimes', 'craving', 'gender', 'look', 'wardrobe',
  'god', 'rod', 'rods', 'rodEq', 'hideJob', 'outfit', 'outfits', 'licExp', 'phoneAsk', 'school', 'pic', 'mail', 'fishdex', 'pets', 'pet', 'frames', 'frame', 'egg', 'riderBike', 'policeCar', 'gsub', 'gmail', 'stok', 'hown', 'bless', 'almsDay', 'adDay', 'adN'];
let nextListing = 1, botCap = 6;   // AI townsfolk still in town (counts down to 0, saved)
async function load() {
  const rows = await store.loadAll();
  const meta = rows.find(r => r && r.login === '__meta'); if (meta) { if (meta.mayor !== undefined) mayor = meta.mayor; if (meta.ghosts) ghosts = meta.ghosts; if (meta.lotto) lotto = meta.lotto; if (meta.znDone) znDone = meta.znDone; if (meta.ideas) { ideas = meta.ideas; ideaSeq = 1 + Math.max(0, ...ideas.map(x => x.id)); } if (meta.elect) elect = meta.elect; for (const g of meta.gangs || []) { gangs.set(g.id, g); gangSeq = Math.max(gangSeq, (+String(g.id).slice(1) || 0) + 1); } bugs = meta.bugs || []; if (meta.botCap != null) botCap = meta.botCap; if (meta.ann != null) announceText = meta.ann; }
  for (const r of rows) if (r && r.name) { const a = hydrate(r); accounts.set(a.login.toLowerCase(), a); }
  for (const a of accounts.values()) {
    for (const L of a.listings || []) nextListing = Math.max(nextListing, L.id + 1);
    if (a.house >= 0 && !a.hown) {                     // the old fixed houses become the owner's own home (it now stands wherever there is room)
      const sp = D.BUILDINGS.find(b => b.house === a.house)?.sprite, st = Math.max(0, D.HOME_STYLES.findIndex(h => h[0] === sp));
      a.hown = { style: st, tier: Math.min(2, a.hlv || 0) }; a.sd = true;
    }
    a.house = -1;                                       // plots are handed out again while players are online
    if (a.garden) { if (lots[a.garden.lot]) a.garden = null; else lots[a.garden.lot] = a; }
    if (a.rent) {                                       // renting is gone (anyone can own a home now): give back the days left
      const left = Math.max(0, Math.ceil((a.rent.until - now()) / D.DAY_MS)); if (left > 0) a.money += left * (D.HOUSE_RENT[a.rent.idx] || 0);
      a.rent = null; a.sd = true;
    }
    a.houseSale = 0; a.houseRent = 0;
    byPhone.set(a.phone, a);
  }
  console.log(`loaded ${accounts.size} players`);
  for (const a of accounts.values()) santaGift(a);
}
function newPhone() { let p; do p = String(rint(100000, 999999)); while (byPhone.has(p)); return p; }
function hydrate(r) {
  const a = Object.assign({
    avatar: 0, money: 1000, energy: 100, hunger: 100, health: 100, career: 'none', licenses: [], xp: {},
    inv: {}, x: D.SPAWN.x, y: D.SPAWN.y, earned: 0, created: now(), quests: null, qStreak: 0, lastLogin: '', loginStreak: 0, tools: {}, vehicles: [], house: -1, hlv: 0, fpos: {}, yz: [], ycrops: {},
    furniture: [], bank: 0, bankT: now(), loan: 0, dz: [], awake: 0, listings: [], contacts: [], stats: {}, ach: [], title: '', jobChanges: [],
    enrolled: false, classes: 0, office: null, garden: null, rent: null, houseSale: 0, houseRent: 0, down: null,
    gender: 'm', look: null, wardrobe: null, god: null, rod: 0, hideJob: false, outfit: '', outfits: [], pets: [], pet: '', frames: [], frame: -1, licExp: {}, phoneAsk: {}, school: null,
    happy: 80, bills: [], billMonth: null, usage: { sleep: 0 }, utilOff: false, craving: null,
  }, r, { ws: null, id: null, f: 0, bed: -1, chair: -1, pose: null, seat: null, immune: {}, cd: {}, cast: null, trade: null, call: null, lastPosT: now(), moved: false, meDirty: false, desk: -1, afk: false, emo: null, thiefUntil: 0 });
  if ((a.v || 1) < 2) {                            // migrate saves from the old single-map town
    if (!D.CAREERS[a.career]) a.career = 'none';
    a.licenses = (a.licenses || []).filter(l => D.LICENSES[l]);
    if (a.licenses.includes('medicine') || a.career === 'office') a.licenses = [...new Set([...a.licenses, 'degree'])];
    if (a.house >= 0) { a.money += 30000; a.house = -1; a.furniture = []; a.hlv = 0; a.fpos = {}; a.yz = []; a.ycrops = {}; }   // the old houses were demolished: refund
    a.x = D.SPAWN.x; a.y = D.SPAWN.y; a.v = 2;
  }
  if (a.hown && !a.yfree) starterYard(a);    // homes bought before yards existed get their two starter fields too
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
    a.money += (a.vehicles || []).reduce((t, v) => t + ({ skate: 2000, bike: 6500, scooter: 22000, car: 75000 }[v] || 0), 0); a.vehicles = [];
    if ((a.licenses || []).includes('driving')) a.licExp = { ...(a.licExp || {}), driving: now() + LICENSE_YEAR };
    a.v = 4;
  }
  if (a.career === 'rider' && !a.riderBike && !(a.vehicles || []).includes('delivery')) { a.vehicles = [...(a.vehicles || []), 'delivery']; a.riderBike = 1; }
  if (a.career === 'police' && !a.policeCar && !(a.vehicles || []).includes('police')) { a.vehicles = [...(a.vehicles || []), 'police']; a.policeCar = 1; }   // riders already on the job get the company bike too
  if (!a.login) a.login = a.name;                    // older saves: the name was the login ID
  // fixed character names for special accounts (login ID -> character name)
  const RENAME = isAdmin(a) && !a.god?.renamed && String(a.login).toLowerCase() === 'james2324' ? ADMIN_NAME : null;
  if (RENAME && a.name !== RENAME) { a.name = RENAME; a.sd = true; }
  if (!isAdmin(a) && impersonates(a.name)) { a.name = 'ชาวเมือง' + String(a.login).slice(0, 8); a.sd = true; }   // nobody else may look like the admin
  if (!a.phone || byPhone.has(a.phone) && byPhone.get(a.phone) !== a) a.phone = newPhone();
  byPhone.set(a.phone, a);
  if (a.rod && !(a.rods || []).length) {         // the old single rod + its three toolshop upgrades become rods in the bag
    const T = (a.tools || {}).fisher || 0, top = [0, 2, 3, 4][T];
    a.rods = D.ROD_ORDER.slice(0, top + 1); a.rodEq = D.ROD_ORDER[top];
  }
  return a;
}
let saving = false;
async function save(force) {
  if ((!dirty && !force) || saving) return;
  saving = true; dirty = false;
  const rec = a => Object.fromEntries(SAVE_KEYS.map(k => [k, a[k]]));
  const changed = [...accounts.values()].filter(a => a.ws || a.sd);
  const meta = { login: '__meta', bugs, botCap, ann: announceText, gangs: [...gangs.values()], mayor, elect, ghosts, ideas, lotto, znDone }, wroteBugs = bugsDirty; bugsDirty = false;
  try {
    await store.save(changed.map(rec).concat(wroteBugs ? [meta] : []), [...accounts.values()].map(rec).concat([meta]));
    changed.forEach(a => { if (!a.ws) a.sd = false; });
  } catch (e) { dirty = true; if (wroteBugs) bugsDirty = true; console.error('save failed:', e.message); }
  saving = false;
}

// ------------------------------------------------------------------ stock market
const sHash = (i, k) => { let h = Math.imul(i, 374761393) ^ Math.imul(k + 1, 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const sGauss = (i, k) => Math.sqrt(-2 * Math.log(Math.max(1e-9, sHash(i, k)))) * Math.cos(2 * Math.PI * sHash(i, k + 7919));
const mkt = D.STOCKS.map(s => ({ ...s, lp: Math.log(s.base), hist: [] }));
let stockI = 0;                                         // index of the last finished candle
function stockCandle(i, bias) {
  for (let si = 0; si < mkt.length; si++) {
    const s = mkt[si], fair = Math.log(s.base) + 0.3 * Math.sin(i / 1700 + si * 2.1) + 0.12 * Math.sin(i / 370 + si);
    const trend = (sHash(Math.floor(i / 160), si * 13 + 3) - 0.5) * s.vol * 0.35;
    const o = Math.exp(s.lp); let hi = o, lo = o;
    for (let k = 0; k < 5; k++) {
      s.lp += 0.004 * (fair - s.lp) + (trend + (bias?.[si] || 0)) / 5 + s.vol / 2.236 * sGauss(i * 5 + k, si * 101);
      const p = Math.exp(s.lp); hi = Math.max(hi, p); lo = Math.min(lo, p);
    }
    if (sHash(i, si * 31 + 5) < 0.003) { s.lp += (sHash(i, si * 31 + 6) < 0.5 ? -1 : 1) * s.vol * (4 + 4 * sHash(i, si * 31 + 7)); const p = Math.exp(s.lp); hi = Math.max(hi, p); lo = Math.min(lo, p); }   // news
    s.lp = Math.max(Math.log(s.base * 0.12), Math.min(Math.log(s.base * 8), s.lp));
    const c = Math.exp(s.lp), v = Math.round(1000 * (0.5 + sHash(i, si * 57)) * (1 + Math.abs(Math.log(c / o)) * 60));
    s.hist.push([+o.toFixed(2), +hi.toFixed(2), +lo.toFixed(2), +c.toFixed(2), v]); if (s.hist.length > D.STOCK.keep) s.hist.shift();
  }
}
{ const n = Math.floor((Date.now() - D.STOCK.epoch) / D.STOCK.candleMs); for (let i = 1; i <= n; i++) stockCandle(i); stockI = n; }
const stockPrice = id => { const s = mkt.find(x => x.id === id); return s ? s.hist[s.hist.length - 1][3] : 0; };
function stockTick() {
  const n = Math.floor((Date.now() - D.STOCK.epoch) / D.STOCK.candleMs);
  while (stockI < n) { stockI++; stockCandle(stockI, mkt.map(s => (event && s.ev?.[event.id]) || 0)); wdAt = 0; }
}
const stockView = () => ({ i: stockI, ms: D.STOCK.candleMs, l: mkt.map(s => { const h = s.hist, c = h[h.length - 1][3], p = h[Math.max(0, h.length - 49)][3]; return [s.id, c, +((c / p - 1) * 100).toFixed(2), h.slice(-24).map(x => x[3])]; }) });
const stockValue = a => Object.entries(a.stocks || {}).reduce((t, [id, [q]]) => t + q * stockPrice(id), 0);
function bankOp(a, m) {   // deposit / withdraw / borrow / repay: at the bank counter or from the phone
  accrue(a);
  let amt = Math.floor(+m.amt) || 0;
  if (amt <= 0) return toast(a, 'ใส่จำนวนเงินก่อน', '⚠️', false);
  if (m.a === 'deposit') { amt = Math.min(amt, Math.floor(a.money)); if (amt <= 0) return toast(a, 'ไม่มีเงินสดให้ฝาก', '💸', false); a.money -= amt; a.bank += amt; toast(a, `ฝากเงิน ${money(amt)}`, '🏦'); }
  if (m.a === 'withdraw') { amt = Math.min(amt, Math.floor(a.bank)); if (amt <= 0) return toast(a, 'ไม่มีเงินในบัญชี', '💸', false); a.bank -= amt; a.money += amt; toast(a, `ถอนเงิน ${money(amt)}`, '🏦'); }
  if (m.a === 'borrow') {
    const room = Math.floor((D.BANK.loanMax - a.loan) / (1 + D.BANK.loanFee)); amt = Math.min(amt, room);
    if (amt <= 0) return toast(a, `กู้ได้สูงสุด ${money(D.BANK.loanMax)} (รวมค่าธรรมเนียมและดอกเบี้ย) ใช้คืนก่อนนะ`, '🏦', false);
    a.money += amt; a.loan += Math.ceil(amt * (1 + D.BANK.loanFee)); toast(a, `กู้เงิน ${money(amt)} (ยอดหนี้ ${money(amt * (1 + D.BANK.loanFee))} · ดอกเบี้ย ${D.BANK.loanRate * 100}% ต่อวันเกม ใช้คืนเร็วเสียน้อย)`, '🏦');
  }
  if (m.a === 'repay') { amt = Math.min(amt, Math.floor(a.money), Math.ceil(a.loan)); if (amt <= 0) return toast(a, a.loan > 0 ? 'เงินสดไม่พอ' : 'คุณไม่มีหนี้', 'ℹ️', false); a.money -= amt; a.loan -= amt; toast(a, `ชำระหนี้ ${money(amt)}${a.loan <= 0 ? ' — ปลดหนี้แล้ว! 🎉' : ''}`, '🏦'); }
  a.loan = Math.max(0, a.loan); return markMe(a);
}
function stockTrade(a, m) {
  const s = mkt.find(x => x.id === m.id); if (!s) return;
  const p = stockPrice(s.id), q = Math.floor(+m.qty);
  if (!(q > 0) || q > 100000) return toast(a, 'ใส่จำนวนหุ้นให้ถูกต้อง', '📈', false);
  const gross = p * q, fee = Math.max(D.STOCK.feeMin, Math.round(gross * D.STOCK.fee));
  a.stocks = { ...(a.stocks || {}) }; const cur = a.stocks[s.id] || [0, 0];
  if (m.op === 'buy') {
    if (!pay(a, Math.ceil(gross) + fee)) return;
    a.stocks[s.id] = [cur[0] + q, +((cur[0] * cur[1] + gross) / (cur[0] + q)).toFixed(4)]; stat(a, 'trades');
    toast(a, `ซื้อ ${s.icon}${s.id} ${q.toLocaleString()} หุ้น @${p.toFixed(2)} รวม ${money(Math.ceil(gross) + fee)} (ค่าธรรมเนียม ${money(fee)})`, '📈');
  } else {
    if (cur[0] < q) return toast(a, `มี ${s.id} แค่ ${cur[0].toLocaleString()} หุ้น`, '📉', false);
    const get = Math.floor(gross) - fee, pl = Math.round(gross - q * cur[1]) - fee;
    a.money += get; if (cur[0] - q > 0) a.stocks[s.id] = [cur[0] - q, cur[1]]; else delete a.stocks[s.id]; stat(a, 'trades');
    if (pl >= 5000) feed(`📈 ${a.name} ขายหุ้น ${s.id} กำไร ${money(pl)}!`);
    toast(a, `ขาย ${s.icon}${s.id} ${q.toLocaleString()} หุ้น @${p.toFixed(2)} ได้ ${money(get)} · ${pl >= 0 ? 'กำไร' : 'ขาดทุน'} ${money(Math.abs(pl))}`, pl >= 0 ? '💹' : '📉');
  }
  markMe(a); dirty = true;
}

// ------------------------------------------------------------------ world objects owned by players
const houses = D.HOUSE_PRICES.map(() => null);    // house idx -> owner account
const tenants = D.HOUSE_PRICES.map(() => null);   // (renting was removed; kept empty so old checks stay harmless)
// 🏘️ the village is made of the homes of the players who are online: each owner gets a free plot while around,
// and the plot is freed when they leave (once their guests have gone too)
const PLOT_AREAS = D.HOUSE_PRICES.map((_, i) => new Set([...D.ROOMS.filter(r => r.rk === 'house' && r.house === i).map(r => r.id), 'yard' + i]));
const plotBusy = (i, but) => [...online.values()].some(o => o !== but && o.ws && PLOT_AREAS[i].has(areaId(o)));
const friendOf = (o, a) => !!o && (o.contacts || []).some(c => c.p === a.phone);
const canVisit = (a, i) => houses[i] === a || isAdmin(a) && a.god?.doors || friendOf(houses[i], a);
function plotGive(a) {
  if (!a.hown || a.house >= 0) return a.house;
  const free = houses.map((h, i) => i).filter(i => !houses[i] && !plotBusy(i));
  if (!free.length) return -1;
  const i = pick(free); houses[i] = a; a.house = i; a.fixYard = 1; markMe(a); wdAt = 0;
  return i;
}
function plotTick() {
  houses.forEach((o, i) => { if (o && (!o.ws || !o.hown) && !plotBusy(i, o)) { houses[i] = null; o.house = -1; wdAt = 0; } });
  for (const a of online.values()) if (a.ws && a.hown && a.house < 0 && plotGive(a) >= 0 && a.wakeHome) { a.wakeHome = 0; const y = D.YARDS[a.house]; if (y) teleport(a, y.spawn.x, y.spawn.y); }
}
function goHome(a, o = a) {
  if (o !== a && !canVisit(a, o.house)) return toast(a, `${o.name} ยังไม่ได้บันทึกเบอร์คุณเป็นเพื่อน เข้าบ้านไม่ได้`, '🔒', false);
  const i = o === a ? plotGive(a) : o.house;
  if (i < 0) return toast(a, o === a ? 'หมู่บ้านเต็มชั่วคราว รอสักครู่จะมีที่ว่าง' : `${o.name} ยังไม่มีบ้านตั้งในหมู่บ้านตอนนี้`, '🏘️', false);
  const y = D.YARDS[i]; if (!y) return;
  if (!cd(a, 'door', 1200, true)) return;
  teleport(a, y.spawn.x, y.spawn.y);
  if (o !== a && o.ws) toast(o, `🏡 ${a.name} มาเยี่ยมบ้านคุณ`, '🏡');
}
const lots = D.LOTS.map(() => null);              // garden lot idx -> owner account

// ------------------------------------------------------------------ food delivery
const orders = new Map();                          // id -> order
let nextOrder = 1, npcOrderAt = 0;
const MENU = Object.keys(D.ITEMS).filter(k => D.ITEMS[k].menu);
const PICKUP = ST.restaurant;                      // the restaurant counter (inside)
const RESTO_OUT = D.ROOMS.find(r => r.bld === 'restaurant').outside;
// 🚕 taxi: call it on the phone (or dial its number), pick where to go; it drives up to you and drops you at the door
const TAXI = { phone: '888888', base: 35, perTile: 1.6, far: 40, wait: 3500 };
const TAXI_DEST = [
  ...D.STATIONS.filter(s => s.type === 'door' && s.area === 'town' && s.house === undefined && !s.renov).map(s => ({ id: s.id, label: s.label, icon: s.icon, x: s.x, y: s.y + .9 })),
  { id: 'park', label: 'สวนสนุก', icon: '🎡', ...D.GATES.park_in },
  { id: 'temple', label: 'วัดเมืองชีวิต', icon: '🛕', ...D.GATES.temple_in },
  { id: 'housing', label: 'หมู่บ้านจัดสรร', icon: '🏘️', ...D.GATES.housing_in },
  { id: 'square', label: 'จัตุรัสกลางเมือง', icon: '⛲', x: 50, y: 34.5 },
].filter(d => d.x !== undefined);
function taxiFee(a, d) {
  let area = areaId(a) || 'town'; if (area.startsWith('yard')) area = 'housing';
  const OUT = { housing: { x: 50, y: 4 }, park: { x: 54, y: 57.4 }, temple: { x: 74, y: 73.8 } };
  const here = OUT[area] || { x: a.x, y: a.y }, there = OUT[d.id] || d;
  return Math.round(TAXI.base + Math.hypot(here.x - there.x, here.y - there.y) * TAXI.perTile + (area !== 'town' ? TAXI.far : 0) + (OUT[d.id] ? TAXI.far : 0));
}
function taxiCall(a, m) {
  if (a.down) return toast(a, 'คุณหมดสติอยู่ เรียกแท็กซี่ไม่ได้', '🚕', false);
  const ar = areaId(a);
  if (!ar || ROOM[ar] || ar === 'farm') return toast(a, 'ออกไปรอริมถนนข้างนอกก่อน แล้วค่อยเรียกแท็กซี่', '🚕', false);
  if (a.taxi) return toast(a, 'แท็กซี่กำลังมารับ รอแป๊บนึงนะ', '🚕', false);
  const d = TAXI_DEST.find(x => x.id === m.dest); if (!d) return;
  if (Math.hypot(a.x - d.x, a.y - d.y) < 3) return toast(a, 'คุณอยู่ตรงนั้นแล้ว', '🚕', false);
  const fee = taxiFee(a, d);
  if (!pay(a, fee)) return;
  a.taxi = d.id; standUp(a); if (a.ride) a.ride = ''; markMe(a);
  send(a, { t: 'taxi', phase: 'come', x: a.x, y: a.y, wait: TAXI.wait });
  toast(a, `🚕 เรียกแท็กซี่แล้ว ไป${d.label} ค่าโดยสาร ${money(fee)} · รถกำลังมารับ...`, '🚕');
  setTimeout(() => {
    if (a.taxi !== d.id) return; a.taxi = null;
    if (a.down) { a.money += fee; markMe(a); return toast(a, 'เรียกแท็กซี่ไม่สำเร็จ คืนเงินแล้ว', '🚕', false); }
    teleport(a, d.x, d.y);
    send(a, { t: 'taxi', phase: 'drop', x: d.x, y: d.y });
    toast(a, `🚕 ถึง${d.label}แล้ว ขอบคุณที่ใช้บริการแท็กซี่เมืองชีวิตครับ`, '🚕');
  }, TAXI.wait);
}
function deliveryFee(x, y) {
  let area = D.areaAt(x, y)?.id || 'town'; if (area.startsWith('yard')) area = 'housing';   // a home yard is reached through the estate street
  const pos = area === 'town' ? { x, y } : area === 'housing' ? { x: 50, y: 4 } : area === 'farm' ? { x: 3, y: 32 } : area === 'park' ? { x: 55, y: 56.6 } : area === 'temple' ? { x: 74, y: 73.8 } : D.ROOMS.find(r => r.id === area)?.outside || { x, y };
  const d = Math.hypot(pos.x - RESTO_OUT.x, pos.y - RESTO_OUT.y) + (area === 'housing' || area === 'farm' || area === 'park' || area === 'temple' ? 25 : 0);
  return Math.round(D.RIDER.baseFee + d * D.RIDER.perTile);
}
const ridersOnline = () => [...online.values()].filter(r => r.career === 'rider' && !r.down);
function orderView(o) {
  return { id: o.id, item: o.item, qty: o.qty || 1, src: o.src || 'food', state: o.state, fee: o.fee, tip: o.tip, cust: o.custName, npc: !!o.npc, rider: o.riderName || '', t: o.t,
    dest: o.npc ? { x: o.npc.x, y: o.npc.y } : null, area: o.npc ? o.npc.area : null };
}
function ordersChanged() { for (const a of online.values()) if (a.career === 'rider' || allJobs(a) || [...orders.values()].some(o => o.cust === a)) markMe(a); }
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
// order goods from the central market from the phone: bought from players' stalls now, a rider fetches them from the market
function placeMarketOrder(a, m) {
  const id = m.item, it = D.ITEMS[id]; if (!it) return;
  if ([...orders.values()].filter(o => o.cust === a).length >= 2) return toast(a, 'สั่งได้ทีละไม่เกิน 2 ออเดอร์', '🛵', false);
  let want = clamp(Math.floor(+m.qty) || 1, 1, 10);
  const offers = []; for (const o of accounts.values()) if (o !== a) for (const L of o.listings || []) if (L.item === id) offers.push([L, o]);
  offers.sort((x, y) => x[0].price - y[0].price);
  let n = 0, cost = 0; for (const [L] of offers) { const k = Math.min(L.qty, want - n); n += k; cost += k * L.price; if (n >= want) break; }
  if (!n) return toast(a, 'ตอนนี้ไม่มีผู้เล่นวางขายของชิ้นนี้', '🏪', false);
  const fee = Math.round(deliveryFee(a.x, a.y) * .9), tip = clamp(Math.floor(+m.tip) || 0, 0, 500);
  if (!pay(a, cost + fee + tip)) return;
  let left = n; const soldBy = new Map();
  for (const [L, o] of offers) { while (left > 0 && L.qty > 0) { L.qty--; left--; credit(o, Math.floor(L.price * 0.92)); soldBy.set(o, (soldBy.get(o) || 0) + 1); } if (L.qty <= 0) o.listings = o.listings.filter(x => x !== L); if (!left) break; }
  for (const [o, k] of soldBy) { stat(o, 'psold', k); if (o.ws) { quest(o, 'sell', k); toast(o, `${a.name} สั่ง ${it.icon}${it.name} ของคุณ ${k} ชิ้น (ไรเดอร์กำลังมารับ)`, '💰'); } }
  const o = { id: nextOrder++, cust: a, custName: a.name, item: id, qty: n, price: cost, fee, tip, state: 'open', t: now(), rider: null, src: 'market' };
  orders.set(o.id, o); markMe(a); wdAt = 0;
  const rs = ridersOnline();
  rs.forEach(r => toast(r, `🛵 ออเดอร์ใหม่จากตลาดกลาง! ${it.icon}${it.name} x${n} ส่งให้ ${a.name} ค่าส่ง ${money(fee)}${tip ? ` + ทิป ${money(tip)}` : ''}`, '🛵'));
  toast(a, `สั่ง ${it.icon}${it.name} x${n} แล้ว ${money(cost + fee + tip)} · ${rs.length ? `รอไรเดอร์ไปรับที่ตลาด (ออนไลน์ ${rs.length} คน)` : 'ยังไม่มีไรเดอร์ออนไลน์ ถ้าไม่มีใครรับใน 10 นาที ของจะส่งเข้ากระเป๋าให้เอง'}`, '🛵');
  ordersChanged();
}
function spawnNpcOrder() {
  const spots = [...D.STATIONS.filter(s => s.type === 'door' && s.house !== undefined && s.area === 'housing'), ...D.STATIONS.filter(s => s.type === 'seat' && (s.area === 'town' || s.area === 'housing'))];
  const s = pick(spots), id = pick(MENU);
  const fee = Math.round(deliveryFee(s.x, s.y) * (ev('hungry') ? 1.3 : 1));
  const o = { id: nextOrder++, cust: null, custName: pick(D.NPC_NAMES), item: id, price: 0, fee, tip: rint(0, 3) ? 0 : rint(10, D.RIDER.tipMax),
    state: 'open', t: now(), rider: null, npc: { x: s.x, y: s.y + (s.type === 'door' ? .4 : 0), area: s.area } };
  orders.set(o.id, o); ordersChanged();
}
// an NPC customer waits at the delivery spot (in front of their house / on a bench) while a rider has their order
function custNpcAdd(o) {
  if (!o.npc || npcs.some(n => n.custOf === o.id)) return;
  const sp = D.blocked(o.npc.x, o.npc.y) ? (standNear(o.npc.area, o.npc.x, o.npc.y) || [o.npc.x, o.npc.y]) : [o.npc.x, o.npc.y];
  o.npc.x = sp[0]; o.npc.y = sp[1];
  npcs.push({ id: -(2000 + o.id), custOf: o.id, name: `${o.custName} (รออาหาร)`, area: o.npc.area, x: sp[0], y: sp[1], f: 6, path: [], wait: 1e9, look: randLook(), g: Math.random() < .5 ? 'f' : 'm', speed: 1, next: () => null, stay: () => 1e9 });
  npcRosterDirty = true;
}
function custNpcDel(o) { const i = npcs.findIndex(n => n.custOf === o.id); if (i >= 0) { npcs.splice(i, 1); npcRosterDirty = true; } }
function cancelOrder(o, why) {
  orders.delete(o.id); custNpcDel(o);
  if (o.cust && o.src === 'market') { addItem(o.cust, o.item, o.qty || 1); o.cust.money += o.fee + o.tip; o.cust.sd = true; markMe(o.cust); toast(o.cust, `ส่งของจากตลาดไม่สำเร็จ (${why}) · ${D.ITEMS[o.item].name} x${o.qty || 1} ใส่กระเป๋าให้แล้ว คืนค่าส่ง`, '↩️', false); }
  else if (o.cust) { o.cust.money += o.price + o.fee + o.tip; o.cust.sd = true; markMe(o.cust); toast(o.cust, `ออเดอร์ ${D.ITEMS[o.item].name} ถูกยกเลิก (${why}) คืนเงินแล้ว`, '↩️', false); }
  if (o.rider) toast(o.rider, `ออเดอร์ของ ${o.custName} ถูกยกเลิก (${why})`, '↩️', false);
  ordersChanged();
}
function finishOrder(o, rider) {
  orders.delete(o.id); custNpcDel(o);
  if (o.cust) { addItem(o.cust, o.item, o.qty || 1); markMe(o.cust); o.cust.sd = true; }
  if (rider) {
    const got = earn(rider, (o.fee * 1.25 * (1 + [0, .1, .2, .35][tier(rider, 'rider')]) * jobPay(rider) + o.tip) * wellbeing(rider));
    addXp(rider); stat(rider, 'delivered'); quest(rider, 'deliver');
    toast(rider, `ส่ง${o.src === 'market' ? 'ของ' : 'อาหาร'}ให้ ${o.custName} สำเร็จ! ได้ ${money(got)}${o.tip ? ` (รวมทิป ${money(o.tip)})` : ''}`, '🛵');
    if (o.cust) toast(o.cust, `${rider.name} มาส่ง ${D.ITEMS[o.item].icon}${D.ITEMS[o.item].name} แล้ว! (อยู่ในกระเป๋า 🎒)`, '🛵');
  } else if (o.cust) toast(o.cust, `${o.src === 'market' ? 'ตลาดกลางส่งของให้เอง' : 'ร้านมาส่ง'} ${D.ITEMS[o.item].icon}${D.ITEMS[o.item].name}${o.qty > 1 ? ' x' + o.qty : ''} แล้ว (อยู่ในกระเป๋า 🎒)`, '🛵');
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
    if (!hasLic(a, 'driving')) return toast(a, licExpired(a, 'driving') ? 'ใบขับขี่หมดอายุแล้ว! ต่ออายุที่โชว์รูมรถ (ปีละครั้ง)' : 'ต้องมีใบขับขี่ก่อน', '🪪', false);
    if (!spend(a, 5)) return;                       // every job / quest costs energy
    o.state = 'taken'; o.rider = a; o.riderName = a.name; o.takenAt = now(); custNpcAdd(o);
    if (o.cust) toast(o.cust, `${a.name} รับออเดอร์แล้ว กำลังไปรับ${o.src === 'market' ? 'ของที่ตลาด' : 'อาหารที่ร้าน'}`, '🛵');
    toast(a, o.src === 'market' ? 'รับออเดอร์แล้ว! ไปรับของที่ตลาดกลางก่อน' : 'รับออเดอร์แล้ว! ไปรับอาหารที่เคาน์เตอร์ร้านอาหารก่อน', '🛵');
    return ordersChanged();
  }
  if (m.t === 'order_drop') { if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; custNpcDel(o); ordersChanged(); } return; }
  if (m.t === 'order_deliver') {
    if (o.rider !== a || o.state !== 'picked') return toast(a, o.src === 'market' ? 'ยังไม่ได้รับของจากตลาดกลาง' : 'ยังไม่ได้รับอาหารจากร้าน', '🛵', false);
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
    a.down = { kind: 'veg', t: now(), until: now() + 6000 };
    toast(a, 'คุณหิวจนหมดแรง ล้มลงนอนเป็นผัก... รอสักพักร่างกายจะฟื้นขึ้นมาเอง', '🥬', false);
    feed(`🥬 ${a.name} หิวจนล้มลงข้างทาง`);
  } else {                           // otherwise an ambulance takes you to hospital
    // people nearby see an ambulance come for you (you are already at the hospital on your own screen)
    const here = D.areaAt(a.x, a.y);
    if (here && here.kind === 'map') { const ev = { t: 'amb', id: a.id, x: +a.x.toFixed(2), y: +a.y.toFixed(2), area: here.id }; for (const o of online.values()) if (o !== a && areaId(o) === here.id) send(o, ev); }
    const docsOn = [...online.values()].some(o => o.career === 'doctor' && o !== a && !o.down);
    // the first knock-out of the day waits the normal time; from the second one it is 10s, then +5s each time, up to 30s
    const kd = dayKey(); a.koDay = a.koDay?.d === kd ? a.koDay : { d: kd, n: 0 }; a.koDay.n++; a.sd = true;
    const wait = a.koDay.n <= 1 ? (docsOn ? 60000 : 25000) : Math.min(30000, 10000 + (a.koDay.n - 2) * 5000);
    a.down = { kind: 'hosp', t: now(), until: now() + wait, free: newbie(a) || a.money < 500 };
    let i = beds.findIndex(b => !b);
    if (i < 0) i = beds.findIndex(b => b && b.npc);
    if (i >= 0) { beds[i] = a; a.bed = i; const s = ST['bed' + i]; place(a, s.x, s.y, true); }
    else { const r = ROOM.r_hospital; place(a, r.x + 5, r.y + 6, true); }
    const docs = [...online.values()].filter(o => o.career === 'doctor' && o !== a && !o.down);
    if (a.koDay.n > 1) toast(a, `คุณหมดสติ! รถพยาบาลพามาส่งโรงพยาบาล เจ้าหน้าที่จะช่วยให้ฟื้นใน ${Math.round(wait / 1000)} วินาที`, '🚑', false); else
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

// ------------------------------------------------------------------ office work: run documents around town (shift 08:00–17:00, overtime to 21:00)
// Pick up an envelope at the office's front desk, carry it to the building it is addressed to, come back for the next one.
// Each run pays by distance from the level's wage; the first pick-up of the day is the clock-in (late after 08:15 = -30%).
const DOC_DESTS = D.STATIONS.filter(s => s.type === 'door' && s.house === undefined && s.area === 'town' && !s.renov && s.bld !== 'office' && D.ROOMS.some(r => r.bld === s.bld))
  .concat(D.STATIONS.filter(s => s.type === 'market'));
const OFFICE_DOOR = ST.door_office || D.STATIONS.find(s => s.id === 'door_office');
function officeDay(a, day) { return a.office || (a.office = { strikes: 0, day: -1, late: false, pend: 0, hours: 0, n: 0, closed: -1, absent: -1 }); }
function docPickup(a) {
  const h = hourNow(), t = now(), day = D.dayAt(t), o = officeDay(a, day);
  if (h >= D.SHIFT.ot || h < D.SHIFT.start - 1) return toast(a, `ตอนนี้ไม่ใช่เวลางาน (${hhmm(D.SHIFT.start)}–${hhmm(D.SHIFT.end)} · โอทีถึง ${hhmm(D.SHIFT.ot)})`, '🕗', false);
  if (h >= D.SHIFT.end && o.day !== day) return toast(a, 'โอทีทำได้เฉพาะคนที่เข้างานวันนี้แล้ว', '🕗', false);
  if (o.closed === day) return toast(a, 'วันนี้เลิกงานแล้ว พรุ่งนี้ค่อยมาใหม่', '🏢', false);
  if (a.docjob) return toast(a, `ยังมีเอกสารต้องไปส่งที่ ${ST[a.docjob.dest]?.label || ''}`, '📄', false);
  if (h < D.SHIFT.start) return toast(a, `รอเข้างาน ${hhmm(D.SHIFT.start)} ก่อนนะ`, '🕗', false);
  if (depressed(a)) return toast(a, 'ไม่มีจิตใจจะทำงาน... (ความสุขต่ำมาก)', '😞', false);
  if (!spend(a, 2)) return;
  if (o.day !== day) {                                 // first envelope of the day = clocking in
    o.day = day; o.late = false; o.pend = 0; o.hours = 0; o.n = 0; o.strikes = 0; stat(a, 'ontime');   // no clock-in time: start whenever you like during work hours
  }
  const pool = DOC_DESTS.filter(s => s.id !== a.lastDoc), dest = pick(pool);
  const l = Math.min(lvl(a, 'office'), D.OFFICE_WAGE.length), d = Math.hypot(dest.x - OFFICE_DOOR.x, dest.y - OFFICE_DOOR.y);
  a.docjob = { dest: dest.id, pay: Math.round(D.OFFICE_WAGE[l - 1] * (0.2 + d / 100) * 1.25), day, t };   // ~฿45/min of walking at Lv.1
  a.lastDoc = dest.id; markMe(a);
  return toast(a, `📄 รับเอกสารแล้ว ส่งที่ ${dest.label} · ค่าส่ง ~${money(a.docjob.pay)}${h >= D.SHIFT.end ? ` (โอที x${D.SHIFT.otMul})` : ''}`, '📄');
}
function officeTick(a, t, h, dt) {
  const day = D.dayAt(t), o = officeDay(a, day), j = a.docjob;
  if (j) {
    const s = ST[j.dest];
    if (j.day !== day || h >= D.SHIFT.ot || !s) { a.docjob = null; markMe(a); toast(a, 'หมดเวลางาน เอกสารที่ยังไม่ได้ส่งถูกเก็บคืนบริษัท', '📄', false); }
    else if (D.roomAt(a.x, a.y)?.bld === s.bld || areaId(a) === s.area && Math.hypot(a.x - s.x, a.y - s.y) < 2.2) {
      const ot = h >= D.SHIFT.end;
      const got = earn(a, j.pay * (ot ? D.SHIFT.otMul : 1) * (o.late ? 0.7 : 1) * wellbeing(a) * (1 + [0, .1, .2, .3][tier(a, 'office')]));
      a.docjob = null; o.n = (o.n || 0) + 1; o.hours += 1; quest(a, 'work'); stat(a, 'docs'); joy(a, 1); markMe(a);
      toast(a, `ส่งเอกสารที่ ${s.label} เรียบร้อย ได้ ${money(got)}${ot ? ' (โอที)' : ''} · กลับไปรับงานต่อที่บริษัท (วันนี้ ${o.n} งาน)`, '✅');
    }
  }
  if (o.day === day && h >= D.SHIFT.ot && o.closed !== day) {
    o.closed = day;
    const before = lvl(a, 'office');
    if ((o.n || 0) >= 4) { addXp(a); stat(a, 'shifts'); }
    let msg = `เลิกงานแล้ว! วันนี้ส่งเอกสาร ${o.n || 0} งาน`;
    if (lvl(a, 'office') > before && lvl(a, 'office') <= D.OFFICE_TITLES.length) {
      msg += ` 🎊 เลื่อนเป็น${D.OFFICE_TITLES[lvl(a, 'office') - 1]}`; stat(a, 'promo');
      feed(`🎊 ${a.name} ได้เลื่อนตำแหน่งเป็น${D.OFFICE_TITLES[lvl(a, 'office') - 1]}`);
    }
    toast(a, msg, '🏢');
  }
  // (no lateness or absence penalties for document runners)
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
  if (!onDuty || a.afk) return;   // away from the screen: no salary
  const l = Math.min(lvl(a, 'doctor'), D.DOCTOR.wage.length), gh = dt * D.gameRate(h);
  o.pend += D.DOCTOR.wage[l - 1] * gh * wellbeing(a) * (1 + BOOST[tier(a, 'doctor')]);
  o.hours += gh;
  if (o.pend >= D.DOCTOR.wage[l - 1]) { earn(a, o.pend); o.pend = 0; if (o.hours >= 4 && !o.xp) { o.xp = 1; addXp(a); } }
}
// university: sit at a desk; one game hour seated = one class
// something to do while sitting in class: pop quizzes, the teacher calling on you, and small random happenings
function classroomFun(a, id) {
  const t = now();
  if (a.quiz && t > a.quiz.until) { a.quiz = null; send(a, { t: 'quiz', end: 1 }); }
  if (a.quiz) return;
  if (!a.nextQuiz || t - a.nextQuiz > 120000) a.nextQuiz = t + 10000;
  if (t < a.nextQuiz) return;
  a.nextQuiz = t + 25000 + Math.random() * 20000;
  const r = Math.random();
  if (r < .75) {
    const teacher = r > .6, pool = D.QUIZ.filter(q => q.lv === (id === 'degree' ? 'uni' : 'hs')), q = pool[Math.floor(Math.random() * pool.length)];
    const opts = q.o.map((txt, i) => ({ txt, ok: i === 0 })).sort(() => Math.random() - .5), sec = teacher ? 12 : 20;
    a.quiz = { ans: opts.findIndex(o => o.ok), right: q.o[0], teacher, until: t + sec * 1000 };
    return send(a, { t: 'quiz', q: q.q, o: opts.map(o => o.txt), teacher, sec });
  }
  const e = Math.floor(Math.random() * 4);
  if (e === 0) { joy(a, 2); toast(a, 'นกบินเข้ามาในห้องเรียน เพื่อนๆ หัวเราะกันใหญ่', '🐦'); }
  else if (e === 1) { earn(a, 20); toast(a, 'เจอเหรียญใต้โต๊ะเรียน +฿20', '🪙'); }
  else if (e === 2) { joy(a, 3); toast(a, 'เพื่อนส่งโน้ตตลกมาให้ ยิ้มออกเลย', '📝'); }
  else { a.energy = Math.min(100, a.energy + 6); toast(a, 'เพื่อนข้างๆ แบ่งขนมให้ พลังงานเพิ่มขึ้น', '🍪'); }
  markMe(a);
}
function studyTick(a, h, dt) {
  const id = a.enrolled, L = id && D.LICENSES[id];
  if (!L) { standUp(a); return; }
  if (!D.isOpen('school', h)) { standUp(a); return toast(a, 'มหาวิทยาลัยปิดแล้ว พรุ่งนี้มาเรียนต่อ', '🎓', false); }
  if (depressed(a)) { standUp(a); return toast(a, 'ไม่มีจิตใจจะเรียน... (ความสุขต่ำมาก)', '😞', false); }
  a.energy = Math.max(0, a.energy - 0.05 * dt);
  if (a.energy <= 1) { standUp(a); return toast(a, 'หมดแรง! ไปกินอะไรแล้วค่อยกลับมาเรียน', '😵', false); }
  const S = a.school && a.school.id === id ? a.school : (a.school = { id, p: 0 });
  classroomFun(a, id);
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
// riders get a company delivery bike for free; it goes back to the rider hub when they change job
function riderBikeGive(a) {
  if ((a.vehicles || []).includes('delivery')) return;
  a.vehicles = [...(a.vehicles || []), 'delivery']; a.riderBike = 1;
  toast(a, '🛵 ศูนย์ไรเดอร์ให้ยืม "มอไซค์ส่งอาหาร" ฟรี 1 คัน! กดปุ่ม 🛵 เพื่อขี่ · ถ้าเปลี่ยนอาชีพ บริษัทจะยึดรถคืน', '🛵');
}
function riderBikeTake(a) {
  if (!a.riderBike) return;
  a.riderBike = 0; a.vehicles = (a.vehicles || []).filter(x => x !== 'delivery'); if (a.ride === 'delivery') a.ride = '';
  toast(a, '🛵 ศูนย์ไรเดอร์ยึดรถมอไซค์ส่งอาหารคืนแล้ว (เพราะเปลี่ยนอาชีพ)', '🛵', false);
}
function policeCarGive(a) {
  if ((a.vehicles || []).includes('police')) return;
  a.vehicles = [...(a.vehicles || []), 'police']; a.policeCar = 1;
  toast(a, '🚓 สถานีตำรวจให้ยืม "รถสายตรวจ" ฟรี 1 คัน! กดปุ่มรถเพื่อขับ · ถ้าเปลี่ยนอาชีพ สถานีจะยึดรถคืน', '🚓');
}
function policeCarTake(a) {
  if (!a.policeCar) return;
  a.policeCar = 0; a.vehicles = (a.vehicles || []).filter(x => x !== 'police'); if (a.ride === 'police') a.ride = '';
  toast(a, '🚓 สถานีตำรวจยึดรถสายตรวจคืนแล้ว (เพราะเปลี่ยนอาชีพ)', '🚓', false);
}
function apply(a, career) {
  const c = D.CAREERS[career]; if (!c || career === 'none') return;
  if (a.career === career) return toast(a, `คุณเป็น${c.name}อยู่แล้ว`, 'ℹ️', false);
  for (const l of c.need || []) if (!hasLic(a, l)) return toast(a, licExpired(a, l) ? `${D.LICENSES[l].name}หมดอายุแล้ว ต่ออายุที่มหาวิทยาลัยก่อน` : `ต้องมี${D.LICENSES[l].name}ก่อน (ที่มหาวิทยาลัย)`, '🎓', false);
  if (career === 'beggar' && a.money + (a.bank || 0) > 2000) return toast(a, `มีเงินเกิน ${money(2000)} (รวมเงินฝาก) เป็นขอทานไม่ได้แล้ว`, '🥣', false);
  const wait = jobCooldown(a);
  if (wait > 0) return toast(a, `เพิ่งเปลี่ยนงานไป ต้องรออีก ${Math.ceil(wait / 60000)} นาทีถึงจะสมัครงานใหม่ได้`, '⏳', false);
  if (a.career === 'office') { a.xp.office = 0; a.office = null; }
  if (a.career !== 'none' || (a.jobChanges || []).length) a.jobChanges = [...(a.jobChanges || []).filter(x => now() - x < 86400e3), now()];
  else a.jobChanges = [now() - 86400e3 + 1000];             // the very first job does not count against you
  if (a.career === 'rider' && career !== 'rider') riderBikeTake(a);
  if (a.career === 'police' && career !== 'police') policeCarTake(a);
  standUp(a); a.career = career; a.cast = null;
  if (career === 'rider') riderBikeGive(a);
  if (career === 'police') policeCarGive(a);
  markMe(a); sendRoster();
  feed(`💼 ${a.name} ได้งานเป็น${c.name}`);
  const tips = {
    office: 'เข้างาน 08:00 (สายได้ไม่เกิน 08:15) นั่งที่โต๊ะทำงานว่างตัวไหนก็ได้ ได้ค่าแรงตามชั่วโมงที่นั่ง เลิก 17:00',
    farmer: 'ซื้อสวนของตัวเองได้ที่ป้ายหน้าแปลงในไร่ แล้วเริ่มปลูกได้เลย',
    merchant: 'ประมูลสินค้าที่โรงประมูล เดาราคาแข่งกับคู่แข่ง ซื้อได้ต่ำกว่ามูลค่าจริง = กำไร',
    doctor: 'ไปที่ ICU ในโรงพยาบาล รับเคสฉุกเฉิน (กู้ชีพ ผ่าตัด ห้ามเลือด ฯลฯ ลงมือทำในห้องจริง) ได้ค่ารักษาทุกเคส + เดินไปที่เตียงคนไข้ วินิจฉัยจากอาการแล้วรักษา',
    monk: 'ตื่นเช้ามาออกบิณฑบาต (กดที่หน้าโบสถ์ช่วง 05:00–10:00) แล้วฉันเช้าก่อนเที่ยงนะ',
    cashier: 'ไปที่ร้านสะดวกซื้อสาขาไหนก็ได้ เปิดหน้าร้านแล้วกด "เข้ากะแคชเชียร์" คิดเงินทอนให้ลูกค้าให้ถูก',
    rider: 'เปิดแอพไรเดอร์ในมือถือ 📱 รับออเดอร์ ไปรับอาหารที่ร้านอาหาร แล้วไปส่งลูกค้า',
    police: 'ที่สถานีตำรวจ: รับเคสหมาหาย เคสตามจับโจร เล่นจับผิดภาพหาโจร และซ้อมยิงเป้า · ได้รถสายตรวจขับฟรี',
    beggar: 'กดปุ่ม 🥣 เพื่อนั่งขอทานตรงไหนก็ได้ ที่คนพลุกพล่านได้เงินบ่อยกว่า',
  };
  toast(a, `ยินดีด้วย! ได้งานเป็น ${c.icon} ${c.name} · ${tips[career]}`, c.icon);
}
function resign(a) {
  if (a.career === 'none') return;
  const c = D.CAREERS[a.career];
  if (a.career === 'office') { a.xp.office = 0; a.office = null; }
  if (a.career === 'rider') riderBikeTake(a);
  if (a.career === 'police') policeCarTake(a);
  standUp(a); a.career = 'none'; a.cast = null; markMe(a); sendRoster();
  for (const o of orders.values()) if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; }
  toast(a, `ลาออกจากงาน${c.name}แล้ว`, '📦');
}

// ------------------------------------------------------------------ fishing
function rollFish(a, pool) {
  const l = fishLv(a), rod = rodOf(a) || D.RODS.bamboo;
  const table = D.FISH[pool] || D.FISH.lake;
  const ws = table.map(([id, w]) => {
    if (id === null) return Math.max(5, w - l) * rod.junk;
    const r = D.ITEMS[id].rar || 1;
    if (r >= 3) w *= rod.luck * (r >= 4 ? rod.luck : 1) ** .5 * (ev('bloom') ? 2 : 1);   // rarer fish gain the most from a good rod
    else if (r === 2) w *= Math.sqrt(rod.luck);
    return w;
  });
  let r = Math.random() * ws.reduce((s, v) => s + v, 0);
  for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return table[i][0]; }
  return 'sfish';
}

// ------------------------------------------------------------------ station actions
// fishing from any water's edge: a spot made on the fly where the player stands
function waterSpot(a) {
  const pool = D.waterPool(a.x, a.y); if (!pool) return null;
  return { id: 'water', type: 'pier', pool, label: 'ตกปลา', icon: '🎣', x: a.x, y: a.y, r: 3, area: areaId(a) };
}
// ------------------------------------------------------------------ easter eggs
const dayKey = () => new Date(now() + 7 * 3600e3).toISOString().slice(0, 10);   // Thai calendar day
const eggOf = a => { a.egg = a.egg || {}; a.egg.s = a.egg.s || []; return a.egg; };
// the legendary fish: the east corner of the lake, around midnight in game, once a day per player
function legendRoll(a, c) {
  const L = D.EGG.legend, h = c.ch ?? hourNow();   // the hour you cast at
  if (c.pool !== 'lake' || Math.hypot(c.x - L.x, c.y - L.y) > L.r || !(h >= 23.75 || h < 1.25)) return null;
  if (eggOf(a).ld === dayKey() || Math.random() >= L.odds) return null;
  return 'mayorkoi';
}
// the mayor walks around disguised as one of the AI townsfolk; whoever spots them (talks to them up close) wins today's prize
let mayorBot = null, mayorDayK = '';
const mayorPool = () => npcs.filter(n => n.area === 'town' && (n.folk || n.bot));   // townsfolk walking around town
function mayorNow() {
  const d = dayKey();
  if (d !== mayorDayK || !mayorPool().some(n => n.id === mayorBot)) { mayorDayK = d; const bs = mayorPool(); mayorBot = bs.length ? pick(bs).id : null; }
  return mayorBot;
}
function eggMayor(a, bn) {
  if (bn.id !== mayorNow() || bn.area !== areaId(a) || dist(a, bn) > 4) return;
  const e = eggOf(a), d = dayKey();
  if (e.md === d) return send(a, { t: 'egg', k: 'mayor', name: bn.name, again: 1 });
  e.md = d; a.gems = (a.gems || 0) + D.EGG.mayorGems; stat(a, 'mayorfound'); joy(a, 8); markMe(a);
  feed(`🕵️ ${a.name} จับได้ว่านายกฯ ปลอมตัวเป็น "${bn.name}" มาเดินเล่นในเมือง!`);
  send(a, { t: 'egg', k: 'mayor', name: bn.name, gems: D.EGG.mayorGems });
  const bs = mayorPool().filter(n => n.id !== bn.id); if (bs.length) mayorBot = pick(bs).id;   // the mayor slips away into someone else
}
function act(a, m) {
  if (/^hbed\d+$/.test(m.st || '')) { const o = houses[ST[m.st]?.idx]; if (o) syncBed(o); }   // the bed may have been moved
  const s = m.st === 'water' ? waterSpot(a) : ST[m.st];
  if (!s && m.st === 'water') { if (a.cast) { a.cast = null; markMe(a); } return toast(a, 'ต้องยืนติดริมน้ำก่อนถึงจะตกปลาได้', '🎣', false); }
  if (!s) return;
  if (a.down) return toast(a, 'คุณหมดสติอยู่ ทำอะไรไม่ได้', '💤', false);
  if (areaId(a) !== s.area || Math.hypot(a.x - s.x, a.y - s.y) > s.r + 0.9) return toast(a, 'อยู่ไกลเกินไป เดินเข้าไปใกล้ๆ ก่อน', '⚠️', false);
  const h = hourNow();
  if (!D.isOpen(s.type, h) && !(s.type === 'restaurant' && m.a === 'pickup')) { const o = D.HOURS[s.type]; return toast(a, `${s.label} ปิดแล้ว (เปิด ${hhmm(o[0])}–${hhmm(o[1])})`, '🔒', false); }
  const key = (s.type === 'door' && s.house !== undefined ? 'house' : s.type) + '.' + m.a;
  if (WORK.has(key) && depressed(a)) return toast(a, 'คุณซึมเศร้า ไม่มีจิตใจจะทำอะไรเลย... ลองกินของที่อยากกิน นั่งเล่นที่จัตุรัส หรือโทรคุยกับเพื่อน', '😞', false);
  const wb = wellbeing(a);
  if (m.a === 'apply') { if (s.type !== 'staff' && D.CAREERS[m.career]?.where !== s.type || s.type === 'staff' && s.career !== m.career) return; return apply(a, m.career); }
  switch (key) {
    // ---------------- getting around
    case 'gate.go': {
      const g = D.GATES[s.to]; if (!g) return;
      if (s.renov && !(isAdmin(a) && a.god?.doors)) return toast(a, 'ไร่ชานเมืองปิดปรับปรุงชั่วคราว 🚧', '🚧', false);
      if (zn && ['park_in', 'housing_in', 'temple_in'].includes(s.to)) return toast(a, '🧟 คืนปล่อยผี: สวนสนุก หมู่บ้านจัดสรร และวัด ปิดชั่วคราว เอาตัวรอดในเมืองให้ได้!', '🚧', false);
      if (!cd(a, 'door', 1200, true)) return;
      return teleport(a, g.x, g.y);
    }
    case 'ride.play': {                    // amusement park: buy a ticket and get on (walking away gets you off)
      const R = D.RIDES[s.k]; if (!R) return;
      if (a.fun?.k === s.k) return toast(a, `คุณเล่น${R.name}อยู่แล้ว เดินออกเพื่อลง`, 'ℹ️', false);
      const riders = [...online.values()].filter(o => o !== a && o.fun?.k === s.k);
      if (riders.length >= R.cap) return toast(a, `${R.name}เต็มแล้ว (${R.cap} คน) รอคิวสักครู่`, '⏳', false);
      if (R.price && !pay(a, R.price)) return;   // the park is free now
      const used = new Set(riders.map(o => o.fun.slot)); let slot = 0; while (used.has(slot)) slot++;
      standUp(a); a.cast = null; a.pose = 'fun'; a.fun = { k: s.k, slot, until: now() + R.mins * 60000 };
      if (s.k === 'bumper') place(a, s.cx - 3 + (slot % 4) * 2, s.cy + .3, true); else if (s.k === 'pool') place(a, s.cx - 5 + (slot % 5) * 2.5, s.cy - .6 + Math.floor(slot / 5) * 2.4, true); else place(a, s.x, s.y);   // bumper cars: you drive it yourself inside the arena
      markMe(a); sendRoster(); joy(a, 2); stat(a, 'rides');
      return toast(a, s.k === 'bumper' ? `🚗 ขึ้นรถบั๊มพ์แล้ว! ขับไปชนคนอื่นได้เลย ได้พลังงาน เลือด และความสุขทุกวินาที (${R.mins} นาที) · กดปุ่ม "ลงจากรถ" เพื่อออก` : `${R.icon} ขึ้น${R.name}แล้ว! ได้พลังงาน เลือด และความสุขทุกวินาที (${R.mins} นาที) · เดินออกเพื่อลง`, R.icon);
    }
    case 'ride.stop': { if (a.fun) { rideOff(a); markMe(a); } return; }
    case 'seat.sit': {
      for (const o of online.values()) if (o !== a && o.seat === s.id) return toast(a, 'ที่นั่งนี้มีคนนั่งแล้ว', '🪑', false);
      standUp(a); a.pose = 'seat'; a.seat = s.id; place(a, s.x, s.y); quest(a, 'sit'); sendRoster(); if (cd(a, 'sitjoy', 10 * 60e3, true)) joy(a, 3);   // once per 10 min: sitting up and down no longer farms happiness
      return toast(a, 'นั่งเล่นที่โต๊ะ คุยกับคนรอบๆ ได้ (เดินเพื่อลุก) · อยากได้พลังงานคืนไปสวนสนุกหรือนอนที่เตียงในบ้าน', '🪑');
    }
    case 'bank.bills': return payBills(a);
    case 'fashion.buy': case 'barber.buy': {
      if ((s.type === 'barber') !== (m.cat === 'hair')) return toast(a, s.type === 'barber' ? 'ร้านทำผมทำได้แค่ผม' : 'ย้อมผมได้ที่ร้านทำผม 💈', '💈', false);
      const cat = D.LOOKS[m.cat], it = cat && cat[m.id]; if (!it) return;
      const W = a.wardrobe; if (W[m.cat].includes(m.id)) return wear(a, m);
      if (!pay(a, it.price)) return;
      W[m.cat] = [...W[m.cat], m.id]; joy(a, 8); wear(a, m);
      return toast(a, `ซื้อ${it.name}แล้ว ใส่ให้เลย!`, '💇');
    }
    case 'fashion.outfit': {                // whole outfits: bought once, then worn / taken off from here or the settings
      const it = D.OUTFITS[m.id]; if (!it) return;
      if ((a.outfits || []).includes(m.id)) { a.outfit = a.outfit === m.id ? '' : m.id; markMe(a); return sendRoster(); }
      if (!it.price && !it.gems) return;
      if (it.g && it.g !== a.gender) return toast(a, `ชุดนี้สำหรับ${it.g === 'f' ? 'ผู้หญิง' : 'ผู้ชาย'}เท่านั้น`, '👗', false);
      const nm = a.gender === 'f' && it.nf ? it.nf : it.name;
      if (it.gems) { if (!godInf(a) && (a.gems || 0) < it.gems) return toast(a, `เพชรไม่พอ ต้องใช้ 💎${it.gems}`, '💎', false); if (!godInf(a)) a.gems -= it.gems; }
      else if (!pay(a, it.price)) return;
      a.outfits = [...(a.outfits || []), m.id]; a.outfit = m.id; joy(a, 15); markMe(a); sendRoster();
      if (it.price >= 250000 || it.gems) feed(`👗 ${a.name} ถอย${nm}มาใส่ ${it.gems ? `💎${it.gems}` : `ราคา ${money(it.price)}`}!`);
      return toast(a, `ซื้อ${nm}แล้ว ใส่ให้เลย! (ถอด/ใส่ได้ที่ ⚙️ ตั้งค่า หรือที่ร้านนี้)`, '👗');
    }
    // ---------------- office
    case 'trash.run': case 'trash.dig': {   // beggars: an endless run through the street picking up rubbish (played on the client)
      if (a.career !== 'beggar' && !allJobs(a)) return toast(a, 'วิ่งเก็บขยะได้เฉพาะขอทาน', '🗑️', false);
      if (now() < (a.runNext || 0)) return toast(a, `เหนื่อยอยู่ พักอีก ${Math.ceil((a.runNext - now()) / 1000)} วินาทีค่อยวิ่งใหม่`, '😮‍💨', false);
      if (!spend(a, 6)) return;
      a.run0 = now(); markMe(a); return send(a, { t: 'trashrun', seed: rint(1, 1e9) });
    }
    case 'chair.sit': {                       // the desks are just furniture now: office work is running documents
      return toast(a, 'งานบริษัทตอนนี้คือส่งเอกสาร 📄 รับงานได้ที่ฝ่ายบุคคล (เคาน์เตอร์หน้าออฟฟิศ)', '📄', false);
    }
    case 'office.resign': return resign(a);
    case 'office.job': if (!need(a, 'office')) return; return docPickup(a);
    // ---------------- market
    case 'market.list': {
      const id = m.item, it = D.ITEMS[id];
      const q = Math.floor(+m.qty), price = Math.floor(+m.price);
      if (!it || !(q > 0) || !(price > 0)) return toast(a, 'ใส่จำนวนและราคาให้ถูกต้อง', '⚠️', false);
      if ((a.inv[id] || 0) < q) return toast(a, 'มีของไม่พอ', '⚠️', false);
      if (it.egg) return toast(a, 'ไข่สัตว์เลี้ยงขายไม่ได้', '🥚', false);
      if (price > it.base * 5) return toast(a, `ตั้งราคาได้ไม่เกิน ${money(it.base * 5)} ต่อชิ้น`, '⚠️', false);
      if ((a.listings || []).length >= 8) return toast(a, 'วางขายได้พร้อมกันไม่เกิน 8 รายการ', '⚠️', false);
      addItem(a, id, -q);
      a.listings = [...(a.listings || []), { id: nextListing++, item: id, qty: q, price, t: now() }];
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
    case 'cstore.buy': {                      // the 24-hour convenience store: always stocked, a little dearer than the market
      const id = m.item, it = D.ITEMS[id]; if (!it || !D.CSTORE.items.includes(id)) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), unit = Math.ceil(it.base * D.CSTORE.markup);
      if (!pay(a, unit * q)) return;
      addItem(a, id, q); markMe(a); quest(a, 'buy', q);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ${money(unit * q)} · ขอบคุณที่ใช้บริการ 🙏`, '🏪');
    }
    case 'market.npcbuy': return toast(a, 'ร้าน NPC ที่ตลาดกลางเลิกขายแล้ว · ซื้อจากผู้เล่นได้ หรือสั่งให้ไรเดอร์ไปรับมาส่งในแอพ 📱 เดลิเวอรี', '🏪', false);
    case 'market.npcbuy_old': {
      const id = m.item, it = D.ITEMS[id]; if (!it || it.kind === 'fish' && (it.base >= 1000 || it.rar >= 3) || it.menu) return;
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
      const rate = s.type === 'market' ? NPC_BUY : s.type === 'fishclub' ? FISH_RATE : 0.5;   // the fish club and the farm buyer pay far better than the market's NPC
      let total = 0;
      const own = a.career === 'merchant' && it.kind === 'goods' || a.career === 'chef' && it.kind === 'meal' ? msat(a, id) : null;   // a merchant's restock sales only press their own price, not everyone's
      for (let i = 0; i < q; i++) { if (own) { total += npcBuyPrice(a, id, rate) * own[0]; own[0] = Math.max(0.55, own[0] * 0.985); } else { total += npcBuyPrice(a, id, rate); market[id].mult = Math.max(0.4, market[id].mult * 0.985); } }
      addItem(a, id, -q);
      if ({ merchant: 'goods', farmer: 'crop', chef: 'meal' }[a.career] === it.kind) total *= jobPay(a);   // your own trade's goods sell better the higher your job level
      const got = earn(a, total); quest(a, 'sell', q);
      return toast(a, `ขาย ${it.icon}${it.name} x${q} ให้ NPC ได้ ${money(got)} (วางขายให้ผู้เล่นที่ตลาดกลางได้ราคาดีกว่ามาก)`, '💰');
    }
    // ---------------- merchant
    case 'warehouse.auction': return aucStart(a);
    case 'warehouse.bid': return aucBid(a, m);
    case 'warehouse.buy': {
      if (!need(a, 'merchant')) return;
      const id = m.item, it = D.ITEMS[id];
      if (!it || !it.wholesale) return;
      let q = clamp(Math.floor(+m.qty) || 1, 1, 10);
      const myStock = wstock(a, id);
      if (myStock < q) q = Math.floor(myStock);
      if (q <= 0) return toast(a, 'สินค้าหมดสต็อก รอเติมของหน่อย', '📦', false);
      const unit = Math.round(it.wholesale * (1 - 0.06 * tier(a, 'merchant')));
      if (a.money < unit * q) return toast(a, `เงินไม่พอ (ต้องใช้ ${money(unit * q)})`, '💸', false);
      if (!spend(a, 4)) return;
      a.money -= unit * q;
      a.wst[id][0] -= q; addItem(a, id, q); addXp(a, 0.5); markMe(a); quest(a, 'buy', q); stat(a, 'wholesale', q);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ราคาส่ง ${money(unit * q)}`, '📦');
    }
    // ---------------- food
    case 'restaurant.eat': {
      const it = D.ITEMS[m.item]; if (!it || !it.menu) return;
      if (monkFast(a)) return;
      if (!cd(a, 'eat', 4000)) return;
      if (!pay(a, it.base)) { a.cd.eat = 0; return; }
      a.hunger = Math.min(100, a.hunger + it.eat.hunger);
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
    case 'market.pickup': {
      if (!need(a, 'rider')) return;
      const mine = [...orders.values()].filter(o => o.rider === a && o.state === 'taken' && o.src === 'market');
      if (!mine.length) return toast(a, 'ไม่มีออเดอร์ของจากตลาดที่ต้องรับ', '🛵', false);
      mine.forEach(o => { o.state = 'picked'; if (o.cust) toast(o.cust, `${a.name} รับของจากตลาดแล้ว กำลังไปส่ง`, '🛵'); });
      ordersChanged();
      return toast(a, `รับของ ${mine.length} ออเดอร์จากตลาดแล้ว! ไปส่งให้ลูกค้า`, '📦');
    }
    case 'restaurant.pickup': {
      if (!need(a, 'rider')) return;
      const mine = [...orders.values()].filter(o => o.rider === a && o.state === 'taken' && o.src !== 'market');
      if (!mine.length) return toast(a, 'ไม่มีออเดอร์อาหารที่ต้องรับ (ของจากตลาดไปรับที่ตลาดกลาง)', '🛵', false);
      mine.forEach(o => { o.state = 'picked'; if (o.cust) toast(o.cust, `${a.name} รับอาหารแล้ว กำลังไปส่ง`, '🛵'); });
      ordersChanged();
      return toast(a, `รับอาหาร ${mine.length} ออเดอร์แล้ว! ไปส่งให้ลูกค้า (ดูทางในแอพ)`, '🥡');
    }
    case 'kitchen.cook': {                  // start a cooking battle: the ingredients come out of your bag onto the counter
      if (a.cook) return toast(a, 'กำลังทำออเดอร์อยู่ ทำให้เสร็จก่อนนะ', '🍳', false);
      const r = D.RECIPES.find(x => x.id === m.rid); if (!r) return;
      for (const [k, q] of Object.entries(r.in)) if ((a.inv[k] || 0) < q) return toast(a, 'วัตถุดิบไม่พอ', '🥬', false);
      if (!cd(a, 'cook', 1500) || !spend(a, 12)) return;
      for (const [k, q] of Object.entries(r.in)) addItem(a, k, -q);
      const comps = Object.keys(r.in).map(ing => ({ ing, ops: r.ops[ing] || [], k: 0, at: 'pantry', t: 0, prog: 0, ready: false, burnt: false }));
      const sec = 20 + comps.reduce((s0, c) => s0 + 9 + c.ops.reduce((x, o) => x + D.COOK[o] + 7, 0), 0);
      const limit = Math.round(sec * 1.35 * 1000), t = now();
      a.cook = { rid: r.id, comps, hand: -1, plated: false, t0: t, limit, until: t + limit, ckAt: 0 };
      markMe(a); return toast(a, `🔥 ออเดอร์เข้า! ${D.ITEMS[r.id].icon}${D.ITEMS[r.id].name} ภายใน ${Math.round(limit / 1000)} วินาที — เริ่มที่ 🧺 ตู้วัตถุดิบ`, '🍳');
    }
    case 'kitchen.serve': {
      const c = a.cook; if (!c || c.hand !== 'plate') return toast(a, 'ยังไม่มีจานพร้อมเสิร์ฟ', 'ℹ️', false);
      a.cook = null;
      const it = D.ITEMS[c.rid], left = Math.max(0, (c.until - now()) / c.limit), extra = Math.random() < 0.2 * tier(a, 'chef') + (left > .4 ? .25 : 0) ? 1 : 0;
      const tip = Math.round(it.base * .35 * left * jobPay(a));
      addItem(a, c.rid, 1 + extra); addXp(a); quest(a, 'cook'); stat(a, 'cooked', 1 + extra); if (tip > 0) earn(a, tip); markMe(a);
      if (Math.random() < 0.02) infect(a, 'injury');
      send(a, { t: 'kfx', kind: 'serve' });
      return toast(a, `🛎️ เสิร์ฟ ${it.icon}${it.name} สำเร็จ! เหลือเวลา ${Math.round(left * 100)}%${extra ? ' · ทำไว ได้เพิ่มอีก 1 จาน!' : ''}${tip ? ` · ทิป ${money(tip)}` : ''}`, '🍳');
    }
    case 'kpantry.use': case 'kboard.use': case 'kpan.use': case 'kpot.use': case 'kgrill.use': case 'kplate.use': return cookUse(a, s);
    case 'kitchen.buy': {                   // anyone can cook now (the chef career is closed)
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
    case 'dealer.dtest': return startTest(a, 'driving', s);
    case 'school.ptest': return startTest(a, 'policeExam', s);
    case 'school.answer': case 'dealer.answer': {
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
    case 'bank.stock': return stockTrade(a, m);
    case 'bank.deposit': case 'bank.withdraw': case 'bank.borrow': case 'bank.repay': return bankOp(a, m);
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
    case 'dealer.renew': {
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
    case 'hospital.medbuy': {
      const it = D.ITEMS[m.item]; if (!it || !it.pharmacy) return;
      if (!pay(a, it.base)) return;
      addItem(a, m.item, 1); markMe(a);
      return toast(a, `ซื้อ ${it.icon}${it.name} ${money(it.base)} ใส่กระเป๋าแล้ว (กดใช้ในกระเป๋า 🎒)`, '💊');
    }
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
      const boost = (1 + BOOST[tier(a, 'doctor')]) * jobPay(a) * wb;
      if (m.a === 'revive') {
        if (!pt.down) return toast(a, 'คนไข้รู้สึกตัวดีอยู่แล้ว', 'ℹ️', false);
        const fee = Math.min(400, Math.floor(pt.money)); pt.money -= fee;
        const got = earn(a, (fee + 120) * boost); revive(pt, 35, `หมอ${a.name}`); addXp(a, 2); stat(a, 'revived');
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
    // ---------------- ICU: emergency cases (doctors). A random case: CPR (press on the beat) or surgery (stop the marker in the zone)
    case 'police.dog': {
      if (!need(a, 'police')) return;
      if (a.dogq) return toast(a, 'คุณมีเคสหมาหายอยู่แล้ว', 'ℹ️', false);
      if ((a.dogNext || 0) > now()) return toast(a, `ยังไม่มีเคสใหม่ รออีก ${Math.ceil((a.dogNext - now()) / 1000)} วินาที`, '⏳', false);
      if (areaId(a) !== 'town' && !D.roomAt(a.x, a.y)) return;
      const out = D.roomAt(a.x, a.y)?.outside, from = out ? { x: out.x, y: out.y } : a, sp = dogSpot({ x: from.x, y: from.y, area: 'town' });
      if (!sp) return toast(a, 'ยังไม่มีเคสหมาหายในตอนนี้ ลองใหม่อีกครั้ง', 'ℹ️', false);
      if (!spend(a, D.DOGQ.energy)) return;
      const limit = Math.round(Math.max(150, Math.min(420, sp[2] / SPEED * 2.5 + 75)) * 1000), t = now();
      const bl = D.BUILDINGS.filter(b => b.label && (!b.area || b.area === 'town')).map(b => [b, Math.hypot(b.x + b.w / 2 - sp[0], b.y + b.h - sp[1])]).sort((p, q) => p[1] - q[1])[0];
      const jit = () => rnd(-6, 6);
      a.dogq = { dog: pick(D.DOGQ.dogs), name: pick(D.DOGQ.names), owner: pick(D.DOGQ.owners), x: sp[0] + .5, y: sp[1] + .5, t0: t, limit, until: t + limit, wm: sp[2] / SPEED / 60,
        hint: bl && bl[1] < 14 ? `ใกล้ ${bl[0].label}` : (D.areaAt(sp[0], sp[1])?.name || 'ในเมือง'), hc: [Math.round(sp[0] + jit()), Math.round(sp[1] + jit()), 12] };
      markMe(a); return toast(a, `🐕 ${a.dogq.owner}แจ้งว่า "น้อง${a.dogq.name}" หายไป! ตามหาให้เจอภายใน ${Math.round(limit / 60000 * 10) / 10} นาที`, '🐕');
    }
    case 'police.thief': {                 // a thief was seen somewhere in town: drive out and catch him (red name, red dot on the map)
      if (!need(a, 'police')) return;
      if (a.dogq) return toast(a, 'คุณมีเคสค้างอยู่แล้ว ทำให้จบก่อน', 'ℹ️', false);
      if ((a.thiefNext || 0) > now() && !godNoCd(a)) return toast(a, `ยังไม่มีแจ้งเหตุใหม่ รออีก ${Math.ceil((a.thiefNext - now()) / 1000)} วินาที`, '⏳', false);
      const out = D.roomAt(a.x, a.y)?.outside, from = out ? { x: out.x, y: out.y } : a, sp = dogSpot({ x: from.x, y: from.y, area: 'town' });
      if (!sp) return toast(a, 'ยังไม่มีแจ้งเหตุ ลองใหม่อีกครั้ง', 'ℹ️', false);
      if (!spend(a, D.THIEFQ.energy)) return;
      const limit = Math.round(Math.max(150, Math.min(360, sp[2] / SPEED * 2 + 60)) * 1000), t = now();
      const stole = pick(D.THIEFQ.stole);
      a.dogq = { kind: 'thief', dog: '', name: pick(D.THIEFQ.names), owner: `เจ้าของ${stole}`, stole, x: sp[0] + .5, y: sp[1] + .5, t0: t, limit, until: t + limit, wm: sp[2] / SPEED / 60, hint: D.areaAt(sp[0], sp[1])?.name || 'ในเมือง', hc: null };
      markMe(a); return toast(a, `🚨 แจ้งเหตุ! โจร "${a.dogq.name}" ฉก${a.dogq.stole}แล้วหนี · ดูจุดแดงบนมินิแมพ ขับรถสายตรวจไปจับให้ทันภายใน ${Math.round(limit / 6000) / 10} นาที`, '🚨');
    }
    case 'police.dogquit': { if (a.dogq) { if (a.dogq.kind === 'thief') a.thiefNext = now() + D.THIEFQ.next; else a.dogNext = now() + D.DOGQ.next; a.dogq = null; markMe(a); toast(a, 'ยกเลิกเคสหมาหายแล้ว', 'ℹ️', false); } return; }
    case 'icu.start': {                     // an emergency case, played out in the hospital: fetch what is needed, work on the patient
      if (!need(a, 'doctor')) return;
      if (a.mis) return toast(a, 'คุณมีเคส/ภารกิจค้างอยู่แล้ว', 'ℹ️', false);
      if ((a.icuNext || 0) > now() && !(isAdmin(a) && a.god?.nocd)) return toast(a, `เคสถัดไปยังไม่เข้า รออีก ${Math.ceil((a.icuNext - now()) / 1000)} วินาที`, '⏳', false);
      if (!spend(a, D.ICU.energy)) return;
      const l = lvl(a, 'doctor'), base = D.ICU.pay[Math.min(l, D.ICU.pay.length) - 1];
      a.mis = icuCase(a, pick(ICU_CASES), base * 2.2); markMe(a);
      return toast(a, `🚨 ${a.mis.title} — ${a.mis.story}`, '🚑');
    }
    case 'icu.quit': { if (a.mis?.kind === 'icu') { a.mis = null; a.icuNext = now() + D.ICU.next / 2; markMe(a); toast(a, 'ส่งต่อเคสให้หมอคนอื่นแล้ว', '🚑', false); } return; }
    case 'fishclub.info': return;
    case 'petshop.buy': {                                  // adopt a pet at a pet shop (kept forever) and bring it out
      m.id = m.pet; const P = D.PETS[m.id]; if (!P) return;
      a.pets = a.pets || [];
      if (a.pets.includes(m.id)) return toast(a, `คุณมี${P.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, P.price)) return;
      a.pets.push(m.id); a.pet = m.id; markMe(a); joy(a, 6 + P.rar * 3); sendRoster();
      return toast(a, `${P.icon} รับ${P.name}มาเลี้ยงแล้ว! มันเดินตามคุณไปทุกที่ — แตะที่ตัวมันเพื่อเล่นด้วย`, '🐾');
    }
    case 'petshop.leash': {                                // a leash: walk your pet on a lead (switch it on / off in the 🐾 app)
      if (a.leash) return toast(a, 'คุณมีสายจูงแล้ว เปิด/ปิดได้ในแอพ 🐾 สัตว์เลี้ยง', 'ℹ️', false);
      if (!pay(a, PET_LEASH)) return;
      a.leash = 1; a.leashOn = 1; markMe(a); sendRoster();
      return toast(a, '🦮 ซื้อสายจูงแล้ว! ใส่ให้สัตว์เลี้ยงเรียบร้อย (ถอดได้ในแอพ 🐾)', '🦮');
    }
    case 'fishclub.rod': case 'staff.rod': {                 // buy a rod (it goes into the bag and into your hand)
      const id = D.RODS[m.rod] ? m.rod : 'bamboo', r = D.RODS[id];
      a.rods = a.rods || [];
      if (a.rods.includes(id)) return toast(a, `คุณมี${r.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, r.price)) return;
      a.rods.push(id); a.rodEq = id; a.rod = 1; markMe(a); joy(a, 4);
      return toast(a, `ได้${r.icon}${r.name}แล้ว! ถือไว้ในมือแล้ว · เดินไปริมน้ำที่ไหนก็ได้ (ทะเลสาบ บ่อ ทะเล) แล้วกดปุ่มใหญ่เพื่อเหวี่ยงเบ็ด`, '🎣');
    }
    case 'wish.toss': {                    // the wishing fountain: a ฿10 coin, a fortune, and once a day maybe ฿1,000 back
      const E = D.EGG, e = eggOf(a), d = dayKey(); if (e.d !== d) { e.d = d; e.wn = 0; e.ww = 0; }
      if (!cd(a, 'wish', 1200, true)) return;
      if (e.wn >= E.wishDay) return toast(a, `วันนี้โยนเหรียญครบ ${E.wishDay} ครั้งแล้ว น้ำพุขอพักก่อน พรุ่งนี้มาใหม่นะ`, '⛲', false);
      if (!pay(a, E.wishCost)) return;
      e.wn++; const win = !e.ww && Math.random() < 1 / E.wishOdds, f = pick(D.FORTUNES);
      if (win) { e.ww = 1; a.money += E.wishWin; a.earned += E.wishWin; stat(a, 'wishwin'); joy(a, 8); feed(`⛲✨ ${a.name} โยนเหรียญที่น้ำพุแล้วได้ ${money(E.wishWin)}!`); }
      markMe(a); send(a, { t: 'egg', k: 'wish', win: win ? E.wishWin : 0, f });
      return;
    }
    case 'secret.read': {                  // one of the five little signs in the corners of town
      const E = D.EGG, e = eggOf(a);
      if (e.s.includes(s.n)) return toast(a, `🪧 "คุณเจอที่ลับแล้ว!" · ป้ายนี้คุณเจอไปแล้ว (${e.s.length}/5)`, '🪧', false);
      e.s.push(s.n); a.gems = (a.gems || 0) + E.secretGems; stat(a, 'secrets', e.s.length, true); joy(a, 6);
      let frame = false;
      if (e.s.length >= 5) { a.frames = a.frames || []; if (!a.frames.includes(E.secretFrame)) { a.frames.push(E.secretFrame); frame = true; } }
      feed(e.s.length >= 5 ? `🗺️ ${a.name} เจอที่ลับครบทั้ง 5 จุดในเมือง!` : `🪧 ${a.name} เจอที่ลับในเมือง! (${e.s.length}/5)`);
      markMe(a); send(a, { t: 'egg', k: 'secret', n: e.s.length, gems: E.secretGems, frame: frame ? D.FRAMES[E.secretFrame].name : '' });
      return;
    }
    case 'pier.cast': {                    // cast from the water's edge (the big button); the float lands a couple of tiles out
      if (!rodOf(a)) return toast(a, `ต้องมีเบ็ดตกปลาก่อน — ซื้อได้ที่สมาคมประมง (เริ่ม ${money(D.RODS.bamboo.price)})`, '🎣', false);
      if (a.cast) return;
      if (riding(a)) return toast(a, 'ลงจากรถก่อนถึงจะตกปลาได้', '🎣', false);
      if (!spend(a, 8)) return;
      const bite = now() + rnd(2500, 7000) / Math.sqrt(rodOf(a).luck), r = rodOf(a);
      a.cast = { state: 'wait', ch: hourNow(), bite, win: Math.round(2200 + r.zone * 3000 + 30 * fishLv(a)), st: s.id, pool: s.pool, x: a.x, y: a.y }; markMe(a);
      return;
    }
    case 'pier.reel': case 'pier.hook': {   // strike: too early (only a nibble) scares the fish, inside the bite window hooks it and the fight starts
      const c = a.cast; if (!c) return;
      if (c.state === 'wait') { c.bite = Math.max(c.bite, now() + 1500); markMe(a); return toast(a, 'ยังไม่ใช่! ทุ่นแค่ไหว รอให้ทุ่นจมก่อนค่อยตวัด', '⏳', false); }
      if (c.state !== 'bite') return;
      const id = legendRoll(a, c) || rollFish(a, c.pool), it = id ? D.ITEMS[id] : null, rar = it ? it.rar || 1 : 0, r = rodOf(a) || D.RODS.bamboo;
      const pow = id ? clamp(.14 + .085 * rar + (it.base >= 1500 ? .04 : 0), .12, .62) : .1;
      c.state = 'fight'; c.fish = id; c.t0 = now(); c.min = Math.round((0.6 + rar * 0.6) * 1000);
      c.fight = { pow: +pow.toFixed(2), str: +(1 + (r.zone - .2) * 2.6 + .02 * fishLv(a)).toFixed(2), land: Math.round(1100 + r.zone * 1300), seed: rint(1, 1e9), min: c.min };
      markMe(a); return send(a, { t: 'hooked', fight: c.fight });
    }
    case 'pier.land': {                     // the fish was played out and lifted at the right moment
      const c = a.cast; if (!c || c.state !== 'fight') return;
      if (now() - c.t0 < c.min) { a.cast = null; markMe(a); return toast(a, 'ดึงแรงเกินไป ปลาหลุด!', '💨', false); }
      a.cast = null; return giveCatch(a, c.fish);
    }
    case 'pier.lose': {                     // the line snapped, the fish ran off with it or the hook slipped
      if (!a.cast) return;
      const why = { snap: '💥 สายขาด! ดึงตอนปลากำลังสู้แรงเกินไป', run: '🐟 ปลาลากสายออกไปไกลจนหลุด', slack: '〰️ สายหย่อนนานไป เบ็ดหลุดจากปากปลา', miss: '💦 ยกไม่ทันจังหวะ ปลาดิ้นหลุดไปแล้ว' }[m.why] || 'ปลาหลุดไปแล้ว';
      a.cast = null; markMe(a); return toast(a, why, '🎣', false);
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
    // ---------------- the temple
    case 'wpray.pray': {
      if (!cd(a, 'pray', 60000)) return;
      const has = (a.inv.offering || 0) > 0;
      if (has) addItem(a, 'offering', -1); else if (!pay(a, D.TEMPLEQ.pray)) return;
      const amu = (a.inv.amulet || 0) > 0, mins = D.TEMPLEQ.blessMin * (amu ? 2 : 1);
      a.bless = now() + mins * 60000; joy(a, has ? 12 : 8); stat(a, 'pray'); markMe(a);
      send(a, { t: 'tfx', kind: 'pray' });
      return toast(a, `🙏 ไหว้พระขอพร${has ? 'ด้วยชุดธูปเทียนดอกไม้' : ` (ค่าธูปเทียน ${money(D.TEMPLEQ.pray)})`} · ได้รับพร ${mins} นาที${amu ? ' (ผ้ายันต์นำโชค 🧧 x2)' : ''}: รายได้ทุกอย่าง +5% ✨ ความสุขเพิ่ม`, '🙏');
    }
    case 'wpray.alms': {                    // monks: the morning alms round through town
      if (!need(a, 'monk')) return;
      if (a.alms) return toast(a, 'กำลังบิณฑบาตอยู่ ไปตามจุดสีทองบนแผนที่', '🙏', false);
      const h = hourNow(); if (h < D.TEMPLEQ.almsFrom || h >= D.TEMPLEQ.almsTo) return toast(a, `ออกบิณฑบาตได้ช่วงเช้า ${hhmm(D.TEMPLEQ.almsFrom)}–${hhmm(D.TEMPLEQ.almsTo)}`, '🌅', false);
      if ((a.almsDay || -1) === D.dayAt(now())) return toast(a, 'วันนี้ออกบิณฑบาตไปแล้ว พรุ่งนี้เช้าค่อยออกใหม่', '🙏', false);
      if (!spend(a, 6)) return;
      const doors = D.STATIONS.filter(x => x.type === 'door' && x.area === 'town' && x.house === undefined && !x.renov).sort(() => Math.random() - .5);
      const pts = []; for (const d of doors) { if (pts.length >= D.TEMPLEQ.almsStops) break; if (pts.every(p => Math.hypot(p[0] - d.x, p[1] - d.y) > 12)) pts.push([d.x, d.y + 1.2, d.label]); }
      a.alms = { pts, got: pts.map(() => 0), t0: now() }; a.almsDay = D.dayAt(now()); markMe(a);
      return toast(a, `🙏 ออกบิณฑบาต ไปรับบาตรหน้า ${pts.length} ที่ (จุดสีทองบนแผนที่) แล้วกลับมาที่โบสถ์`, '🙏');
    }
    case 'siamsi.shake': {
      if (!cd(a, 'siamsi', 20000)) return;
      if (!pay(a, 10)) return;
      const n = rint(1, 28), f = D.FORTUNES[(n * 7 + D.dayAt(now())) % D.FORTUNES.length];
      joy(a, 2); markMe(a);
      return send(a, { t: 'siamsi', n, text: f, luck: ['ดีมาก', 'ดี', 'ปานกลาง', 'ดีมาก', 'ดี'][n % 5] });
    }
    case 'wbell.ring': {
      if (!cd(a, 'bell', 3000, true)) return;
      for (const o of online.values()) if (o.ws && areaId(o) === 'temple') send(o, { t: 'tfx', kind: 'bell', x: s.x, y: s.y - 2.2, by: a.id });
      if (cd(a, 'bellJoy', 60000, true)) { joy(a, 2); markMe(a); }
      return;
    }
    case 'pshop.buy': {
      const id = m.item, it = D.ITEMS[id]; if (!it || !D.PSHOP.items.includes(id)) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), unit = Math.ceil(it.base * D.PSHOP.markup);
      if (!pay(a, unit * q)) return;
      addItem(a, id, q); markMe(a); quest(a, 'buy', q); joy(a, 1);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ${money(unit * q)} · ใส่กระเป๋าแล้ว (กดใช้ในกระเป๋า 🎒)`, it.icon);
    }
    case 'tshop.buy': {
      const id = m.item, it = D.ITEMS[id]; if (!it || !D.TSHOP.items.includes(id)) return;
      const q = clamp(Math.floor(+m.qty) || 1, 1, 20), unit = Math.ceil(it.base * D.TSHOP.markup);
      if (!pay(a, unit * q)) return;
      addItem(a, id, q); markMe(a); quest(a, 'buy', q);
      return toast(a, `ซื้อ ${it.icon}${it.name} x${q} ${money(unit * q)} · อนุโมทนาบุญ 🙏`, '🪔');
    }
    case 'house.buy': case 'house.rent': return toast(a, 'ซื้อบ้านได้ที่คุณจิ๋ม สำนักงานอสังหาฯ (ทางเข้าหมู่บ้าน) 🏡', '🏡', false);
    case 'house.sell': case 'estate.sell': {
      if (!a.hown) return toast(a, 'คุณยังไม่มีบ้าน', '🏠', false);
      if (m.a === 'sell' && s.type !== 'estate' && houses[s.house] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      const back = Math.round(D.HOME_TIERS[a.hown.tier || 0].price * 0.6 + (a.furniture || []).reduce((t, k) => t + (D.FURNITURE[fbase(k)]?.price || 0) * 0.4, 0) + (a.yz || []).reduce((t, z, n) => t + D.YARD.price[n] * 0.5, 0));
      if (a.house >= 0 && houses[a.house] === a) { const r = D.roomAt(a.x, a.y), y = D.areaAt(a.x, a.y); if (r?.house === a.house || y?.yard && y.house === a.house) teleport(a, D.GATES.housing_in.x, D.GATES.housing_in.y); houses[a.house] = null; }
      a.hown = null; a.house = -1; a.furniture = []; a.hlv = 0; a.fpos = {}; a.yz = []; a.ycrops = {}; a.money += back; markMe(a); wdAt = 0;
      return toast(a, `ขายบ้านคืนโครงการได้ ${money(back)}`, '🏠');
    }
    case 'estate.buy': {                    // buy a home from the agent: a size and a look; it stands in the village whenever you are online
      const T = D.HOME_TIERS[+m.tier], st = clamp(Math.floor(+m.style) || 0, 0, D.HOME_STYLES.length - 1); if (!T) return;
      if (a.hown) return toast(a, 'คุณมีบ้านแล้ว (ต่อเติมชั้นและขยายสวนได้ที่บ้าน)', '🏠', false);
      if (!pay(a, T.price)) return;
      a.hown = { style: st, tier: +m.tier }; a.furniture = (a.furniture || []).filter(k => !D.FURNITURE[fbase(k)]?.field); a.fpos = {}; a.ycrops = {};
      a.hlv = T.floors; a.yz = [0, 2].slice(0, T.zones); a.yfree = 0; starterYard(a);
      plotGive(a); markMe(a); wdAt = 0; joy(a, 20);
      feed(`🏠 ${a.name} ซื้อ${T.name}หลังใหม่!`);
      return toast(a, `ยินดีด้วย! ได้${T.name}แล้ว 🎉 บ้านของคุณจะตั้งอยู่ในหมู่บ้านตอนที่คุณออนไลน์ · กด "🏠 ไปบ้านฉัน" กับคุณจิ๋มได้เลย`, '🏠');
    }
    case 'estate.style': {                  // repaint the outside
      if (!a.hown) return; const st = clamp(Math.floor(+m.style) || 0, 0, D.HOME_STYLES.length - 1); if (st === a.hown.style) return;
      if (!pay(a, 3000)) return;
      a.hown = { ...a.hown, style: st }; markMe(a); wdAt = 0;
      return toast(a, `เปลี่ยนแบบบ้านเป็น "${D.HOME_STYLES[st][1]}" แล้ว`, '🎨');
    }
    case 'estate.home': return a.hown ? goHome(a) : toast(a, 'คุณยังไม่มีบ้าน ซื้อกับคุณจิ๋มได้เลย', '🏠', false);
    case 'estate.visit': { const o = online.get(+m.id); if (!o || !o.hown) return toast(a, 'ไม่พบบ้านของคนนี้ตอนนี้', '🏘️', false); return goHome(a, o); }
    case 'house.list': case 'house.rentout': {
      return toast(a, 'ระบบประกาศขาย/ปล่อยเช่าบ้านปิดแล้ว ตอนนี้ทุกคนซื้อบ้านของตัวเองได้ที่คุณจิ๋ม', '🏡', false);
      const p = Math.max(0, Math.floor(+m.price) || 0);
      if (m.a === 'list') { a.houseSale = Math.min(p, D.HOUSE_PRICES[s.house] * 4); toast(a, p ? `ประกาศขายบ้าน ${money(a.houseSale)}` : 'ยกเลิกประกาศขายแล้ว', '🪧'); }
      else { a.houseRent = Math.min(p, D.HOUSE_RENT[s.house] * 4); toast(a, p ? `ปล่อยเช่า ${money(a.houseRent)}/วัน (ระหว่างมีผู้เช่า คุณนอนบ้านนี้ไม่ได้)` : 'ยกเลิกปล่อยเช่าแล้ว', '🔑'); }
      markMe(a); wdAt = 0; return;
    }
    case 'house.furnish': {
      if (houses[s.house] !== a) return toast(a, 'นี่ไม่ใช่บ้านของคุณ', '🔒', false);
      const f = D.FURNITURE[m.item]; if (!f || f.gift) return;
      if (a.furniture.includes(m.item)) return toast(a, `มี${f.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, f.price)) return;
      a.furniture = [...a.furniture, m.item]; markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${f.icon}${f.name} ความสบาย +${f.comfort} (รวม ${comfort(a)})`, f.icon);
    }
    case 'furnshop.buy': case 'plantshop.buy': {                  // the furniture shop (and the plant nursery: garden pieces and potted plants only): delivered to your own house
      if (!a.hown) return toast(a, 'ต้องมีบ้านของตัวเองก่อน ซื้อบ้านได้ที่คุณจิ๋ม สำนักงานอสังหาฯ 🏡', '🛋️', false);
      if ((m.hfloor || m.hwall) && s.type === 'furnshop') {             // a floor or a wallpaper for the house: bought once, then chosen per storey in the home menu
        const fl = !!m.hfloor, id = String(m.hfloor || m.hwall), def = (fl ? D.HOME_FLOORS : D.HOME_WALLS)[id], key = fl ? 'hfl' : 'hwl';
        if (!def) return; if (!def.price || (a[key] || []).includes(id)) return toast(a, `มี${def.name}แล้ว`, 'ℹ️', false);
        if (!pay(a, def.price)) return;
        a[key] = [...(a[key] || []), id]; joy(a, 3); markMe(a);
        return toast(a, `ซื้อ${fl ? 'พื้น' : 'วอลเปเปอร์'} "${def.name}" แล้ว · เปลี่ยนได้ที่ 🛋️ จัดบ้าน › แท็บพื้น/ผนัง`, fl ? '🟫' : '🎨');
      }
      const f = D.FURNITURE[m.item]; if (!f || f.gift) return;
      if (s.type === 'plantshop' && f.cat !== 'garden' && !D.PLANT_INDOOR.includes(m.item)) return toast(a, 'ร้านต้นไม้ขายแต่ต้นไม้และของแต่งสวนนะ', '🌳', false);
      let key = m.item;
      if (f.multi) {                        // walls, doors, screens, garden pieces: buy as many as you need (up to 20 at a time)
        const max = f.max || FURN_MULTI_MAX, have = a.furniture.filter(k => fbase(k) === m.item).length, q = Math.min(clamp(Math.floor(+m.qty) || 1, 1, 20), max - have);
        if (q <= 0) return toast(a, `มี${f.name}ครบ ${max} ชิ้นแล้ว`, 'ℹ️', false);
        if (!pay(a, f.price * q)) return;
        const add = []; for (let n = 1, made = 0; made < q; n++) { const k = n === 1 ? m.item : `${m.item}#${n}`; if (!a.furniture.includes(k)) { add.push(k); made++; } }
        a.furniture = [...a.furniture, ...add]; joy(a, 1); markMe(a); wdAt = 0;
        return toast(a, `ซื้อ ${f.icon}${f.name} x${q} แล้ว (มี ${have + q} ชิ้น) · วางได้ด้วยปุ่ม 🛋️ จัดบ้าน`, f.icon);
      } else if (a.furniture.includes(m.item)) return toast(a, `มี${f.name}แล้ว`, 'ℹ️', false);
      if (!pay(a, f.price)) return;
      a.furniture = [...a.furniture, key]; joy(a, 5); markMe(a); wdAt = 0;
      return toast(a, `ซื้อ ${f.icon}${f.name} ส่งไปที่บ้านเลขที่ ${a.house + 1} แล้ว · ความสบาย +${f.comfort} (รวม ${comfort(a)}) · จัดวางได้ด้วยปุ่ม 🛋️ จัดบ้าน`, f.icon);
    }
    case 'dealer.buy': case 'dealer.sell': {   // the car showroom
      const v = D.VEHICLES[m.v]; if (!v) return;
      const own = (a.vehicles || []).includes(m.v);
      if (v.hidden && !own) return toast(a, 'รุ่นนี้เลิกขายแล้ว', '🚗', false);
      if (m.a === 'sell') {
        if (!own) return; if (v.gem) return toast(a, 'รถพิเศษ (เพชร) ขายคืนไม่ได้', '💎', false);
        if (m.v === 'police' && a.policeCar) return toast(a, 'รถสายตรวจเป็นของสถานีตำรวจ (ยืมใช้) ขายไม่ได้', '🚓', false);
        if (m.v === 'delivery' && a.riderBike) return toast(a, 'รถคันนี้เป็นของศูนย์ไรเดอร์ (ยืมใช้) ขายไม่ได้', '🛵', false); const back = Math.round(v.price * .6);
        a.vehicles = a.vehicles.filter(x => x !== m.v); if (a.ride === m.v) a.ride = ''; a.money += back; markMe(a); sendRoster();
        return toast(a, `ขาย${v.name}ให้โชว์รูม ได้ ${money(back)} (60%)`, '💰');
      }
      if (own) return toast(a, `มี${v.name}แล้ว`, 'ℹ️', false);
      if (v.job && a.career !== v.job) return toast(a, `${v.name} ขายเฉพาะตำรวจ`, '🚓', false);
      if (v.license && !(a.licenses || []).includes(v.license)) return toast(a, 'ต้องมีใบขับขี่ก่อน สอบได้ที่โชว์รูมรถ 🪪', '🪪', false);
      if (v.gem && isAdmin(a)) { /* admins: unlimited diamonds */ }
      else if (v.gem) { if ((a.gems || 0) < v.gem) return toast(a, `เพชรไม่พอ ต้องใช้ 💎${v.gem} (มี 💎${a.gems || 0})`, '💎', false); a.gems -= v.gem; }
      else if (!pay(a, v.price)) return;
      a.vehicles = [...(a.vehicles || []), m.v]; a.ride = m.v; joy(a, 15); a.mvb = moveCap(a); markMe(a); sendRoster();
      if (v.gem || v.price >= 250000) feed(`${v.gem ? '💎' : ''}${v.icon} ${a.name} ถอย${v.name}${v.gem ? ' รุ่นพิเศษ!' : 'ป้ายแดง!'}`);
      return toast(a, `ได้${v.name}แล้ว! กดปุ่ม ${v.icon} ขี่/ลงรถ ได้ทุกที่นอกอาคาร`, v.icon);
    }
    case 'yzone.unlock': {                    // home yard: open up one more zone of ground
      const i = s.idx; if (houses[i] !== a) return toast(a, 'เฉพาะเจ้าของบ้านเท่านั้นที่ขยายสวนได้', '🔒', false);
      if (yardOpen(a, s.z)) return toast(a, 'พื้นที่นี้ปลดล็อกแล้ว', 'ℹ️', false);
      const price = D.YARD.price[(a.yz || []).length]; if (!pay(a, price)) return;
      a.yz = [...(a.yz || []), s.z]; markMe(a); wdAt = 0; joy(a, 6);
      feed(`🌳 ${a.name} ขยายสวนรอบบ้านเป็น ${3 + a.yz.length}/9 ส่วน`);
      return toast(a, `ปลดล็อกพื้นที่สวนแล้ว! (${3 + a.yz.length}/9) จัดวางของและแปลงผักได้ด้วยปุ่ม 🛋️ จัดบ้าน`, '🌳');
    }
    case 'hstair.go': case 'hstair.build': {   // house floors: stairs up/down, and building the next floor
      const i = s.idx, o = houses[i], tn = tenants[i], master = isAdmin(a) && a.god?.doors;
      const to = s.down ? s.fl - 1 : s.fl + 1;
      if (m.a === 'build') {
        if (o !== a) return toast(a, 'ขยายบ้านได้เฉพาะเจ้าของบ้าน', '🔒', false);
        if (to !== 2 + (a.hlv || 0) || to > D.HOUSE_FLOORS) return;
        if (!pay(a, D.FLOOR_PRICE[to])) return;
        a.hlv = (a.hlv || 0) + 1; joy(a, 20); markMe(a); wdAt = 0;
        feed(`🏗️ ${a.name} ต่อเติมบ้านเป็น ${to} ชั้นแล้ว!`);
        toast(a, `สร้างชั้น ${to} เสร็จแล้ว! ขึ้นบันไดไปจัดห้องใหม่ได้เลย`, '🏗️');
      }
      if (!s.down) {
        if (!master && o !== a && !friendOf(o, a)) return toast(a, 'ขึ้นชั้นบนได้เฉพาะเจ้าของบ้านและเพื่อน', '🔒', false);
        if (!master && to > 1 + ((o && o.hlv) || 0)) return toast(a, o === a ? `ยังไม่มีชั้น ${to} — ต่อเติมได้ ${money(D.FLOOR_PRICE[to])}` : `บ้านหลังนี้ยังไม่มีชั้น ${to}`, '🏗️', false);
      }
      const r = D.floorRoom(i, to); if (!r) return;
      if (!cd(a, 'door', 800, true)) return;
      standUp(a);
      const st = D.STATIONS.find(x => x.type === 'hstair' && x.idx === i && x.fl === to && (s.down ? !x.down : x.down));
      return st ? teleport(a, st.x + (s.down ? (st.x < r.x + 7 ? 1.3 : -1.3) : -1.4), st.y - .1) : teleport(a, r.spawn.x, r.spawn.y);
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

// 🙏 monks eat only between dawn and noon
function monkFast(a) {
  if (a.career !== 'monk') return false;
  const h = hourNow(); if (h >= 5 && h < 12) return false;
  toast(a, 'พระฉันอาหารได้ตั้งแต่เช้าถึงเที่ยงวันเท่านั้น 🙏 (ดื่มน้ำได้)', '🙏', false); return true;
}
function useItem(a, id) {
  const it = D.ITEMS[id];
  if (a.down || !it || !it.eat || !a.inv[id]) return;
  if (it.eat.hunger > 3 && monkFast(a)) return;
  if (!cd(a, 'use', 400)) return;
  if (it.dayMax) { const d = dayKey(), u = a.useDay?.d === d ? a.useDay : (a.useDay = { d }); if ((u[id] || 0) >= it.dayMax) return toast(a, `${it.name}ดื่มได้วันละ ${it.dayMax} ขวด พรุ่งนี้ค่อยดื่มใหม่`, it.icon, false); u[id] = (u[id] || 0) + 1; a.sd = true; }
  addItem(a, id, -1);
  const e = it.eat;
  if (e.hunger) { a.hunger = Math.min(100, a.hunger + e.hunger); quest(a, 'eat'); }
  if (e.energy) a.energy = Math.min(100, a.energy + e.energy);
  if (e.health) a.health = Math.min(100, a.health + e.health);
  if (e.happy) joy(a, e.happy);
  const healed = (it.cures || []).filter(d => cure(a, d));
  if (healed.length) toast(a, `หายจาก${healed.map(d => DZ[d].name).join(', ')}แล้ว`, '💊');
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
// 🛵 passengers: ride pillion on a friend's bike, or in their car. The passenger just follows the driver around.
const seatsOf = k => { const v = D.VEHICLES[k]; return !v ? 0 : v.kind === 'moto' ? (k === 'escoot' ? 0 : 1) : v.kind === 'car' ? (k === 'van' ? 5 : k === 'sports' || D.VEHICLES[k].gem ? 1 : 3) : 0; };
const passengersOf = d => [...online.values()].filter(p => p.pass === d.id);
function hopOff(p, why) {
  const d = online.get(p.pass); p.pass = null;
  const out = d && D.areaAt(d.x, d.y)?.kind !== 'room' && !D.blocked(d.x, d.y + .9) ? { x: d.x, y: d.y + .9 } : p.passOut || { x: p.x, y: p.y };
  place(p, out.x, out.y, true); markMe(p); sendRoster();
  if (why) toast(p, why, '🚶', false);
}
function passTick() {           // passengers sit where their driver is; off when the driver stops riding or leaves
  for (const p of online.values()) {
    if (!p.pass) continue;
    const d = online.get(p.pass);
    if (!d || !d.ws || !riding(d) || d.down || p.down) { hopOff(p, d ? `${d.name} ลงจากรถแล้ว` : 'คนขับออกจากเกมแล้ว'); continue; }
    if (p.x !== d.x || p.y !== d.y) { p.x = d.x; p.y = d.y; p.f = d.f; p.moved = true; dirty = true; p.lastMoveT = now(); p.passOut = { x: d.x, y: d.y }; }
  }
}
// job mini-games: start (energy, cooldown) -> play on the client -> end (score checked against time, then paid)
function jobGame(a, m) {
  const k = String(m.k || ''), J = D.JOBGAMES[k]; if (!J) return;
  if (m.op === 'start') {
    if (a.down) return;
    if (J.career && a.career !== J.career && !allJobs(a)) return toast(a, `เกมนี้สำหรับ${D.CAREERS[J.career].name}`, '🚫', false);
    const nx = (a.jgNext || {})[k] || 0; if (nx > now() && !godNoCd(a)) return toast(a, `พักก่อน อีก ${Math.ceil((nx - now()) / 1000)} วินาทีค่อยเล่นรอบใหม่`, '⏳', false);
    if (a.jg && now() - a.jg.t0 < 120000) return send(a, { t: 'jg', k: a.jg.k, seed: a.jg.seed });   // still playing
    if (depressed(a)) return toast(a, 'ไม่มีจิตใจจะทำงาน... (ความสุขต่ำมาก)', '😞', false);
    if (!spend(a, J.energy)) return;
    a.jg = { k, t0: now(), seed: rint(1, 1e9) }; markMe(a);
    return send(a, { t: 'jg', k, seed: a.jg.seed });
  }
  if (m.op === 'end') {
    const g = a.jg; if (!g || g.k !== k) return;
    a.jg = null; a.jgNext = { ...(a.jgNext || {}), [k]: now() + J.cd * 1000 };
    const secs = (now() - g.t0) / 1000;
    const score = Math.max(0, Math.min(J.max, Math.floor(+m.score) || 0, Math.ceil(secs * J.rate) + 1));
    let pay = Math.round(score * J.per * (J.career ? jobPay(a) * (1 + BOOST[tier(a, J.career)] || 1) : 1));
    if (J.dayCap) {   // side gigs anyone can play: capped per real day so they never beat a real job
      const d = new Date(now() + 7 * 3600e3).toISOString().slice(0, 10), u = a.jgDay?.d === d ? a.jgDay : (a.jgDay = { d, paid: 0 });
      pay = Math.max(0, Math.min(pay, J.dayCap - u.paid)); u.paid += pay; a.sd = true;
      if (!pay) toast(a, `วันนี้ได้เงินจาก${J.name}ครบ ${money(J.dayCap)} แล้ว พรุ่งนี้มาใหม่ (ไปทำอาชีพหลักได้เงินมากกว่า)`, J.icon, false);
    }
    if (pay > 0) { earn(a, pay); addXp(a, score >= J.max * .5 ? 1 : .5); joy(a, score >= J.max * .7 ? 4 : 1); if (J.career) quest(a, 'work'); }
    markMe(a);
    return toast(a, pay > 0 ? `${J.icon} ${J.name}: ได้ ${score} คะแนน · ค่าแรง ${money(pay)}` : `${J.icon} ${J.name}: รอบนี้ยังไม่ได้คะแนน ลองใหม่นะ`, J.icon, pay > 0);
  }
}
function request(a, m) {
  if (a.down) return;
  const bn = botById(+m.to);
  if (bn) { if (dist(a, bn) > 6) return toast(a, 'เดินเข้าไปใกล้ผู้เล่นคนนั้นก่อน', '⚠️', false); botSay(bn, pick(['ขอโทษนะ ตอนนี้ไม่ว่าง 🙏', 'ไว้ทีหลังนะ กำลังทำงานอยู่', 'ยังไม่สะดวกอะ'])); return toast(a, `${bn.name} ปฏิเสธคำขอ (ไม่ว่าง)`, '🙅', false); }
  const o = nearPlayer(a, m.to, 6);
  if (!o) return toast(a, 'เดินเข้าไปใกล้ผู้เล่นคนนั้นก่อน', '⚠️', false);
  if (m.kind === 'trade') {
    if (a.trade || o.trade) return toast(a, 'ฝ่ายใดฝ่ายหนึ่งกำลังแลกเปลี่ยนอยู่', '⚠️', false);
  } else if (m.kind === 'heal') {
    if (a.career !== 'doctor' && !allJobs(a)) return toast(a, 'ต้องเป็นแพทย์เท่านั้น', '🚫', false);
    if (o.health >= 95) return toast(a, `${o.name} สุขภาพดีอยู่แล้ว`, 'ℹ️', false);
  } else if (m.kind === 'hop') {
    const v = riding(o);
    if (!v || !seatsOf(o.ride)) return toast(a, `${o.name} ไม่ได้ขี่มอไซค์หรือขับรถที่มีที่นั่งให้ซ้อนอยู่`, '🛵', false);
    if (a.pass) return toast(a, 'คุณนั่งรถคันอื่นอยู่แล้ว', '🛵', false);
    if (passengersOf(o).length >= seatsOf(o.ride)) return toast(a, 'รถคันนั้นเต็มแล้ว', '🛵', false);
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
  if (r.kind === 'hop') {
    if (!m.ok) return toast(f, `${a.name} ไม่ให้ซ้อน`, '🙅', false);
    if (!riding(a) || passengersOf(a).length >= seatsOf(a.ride) || f.pass || f.down || dist(a, f) > 6) return toast(f, 'ขึ้นรถไม่ได้แล้ว (รถออกไปแล้วหรือเต็ม)', '🛵', false);
    standUp(f); f.ride = ''; f.cast = null; f.pass = a.id; f.passOut = { x: f.x, y: f.y }; place(f, a.x, a.y, true); markMe(f); sendRoster();
    const moto = D.VEHICLES[a.ride].kind === 'moto';
    toast(f, `${moto ? '🛵 ซ้อนท้าย' : '🚗 ขึ้นรถ'} ${a.name} แล้ว! กดปุ่ม "ลงรถ" เพื่อลง`, moto ? '🛵' : '🚗');
    return toast(a, `${f.name} ${moto ? 'ซ้อนท้าย' : 'ขึ้นรถ'}คุณแล้ว`, moto ? '🛵' : '🚗');
  }
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
  if (m.t === 'contact_pin') { const c = (a.contacts || []).find(c => c.p === String(m.phone)); if (c) { c.fav = !c.fav; markMe(a); } return; }
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
const CALL_FEE = 5;                 // ฿ per started minute, paid by whoever dialled
function callBill(a) {
  const c = a.call; if (!c || !c.payer) return;
  if (now() - c.t < c.billed * 60000) return;
  if (a.money < CALL_FEE) return endCall(a, 'เงินไม่พอจ่ายค่าโทร');
  a.money -= CALL_FEE; c.billed++; markMe(a);
  send(a, { t: 'call_fee', mins: c.billed, paid: c.billed * CALL_FEE });
}
function answerCall(a, f, ok) {
  if (!ok) return toast(f, `${a.name} ไม่รับสาย`, '📵', false);
  if (!f.ws || f.call || a.call) return;
  f.call = { peer: a, payer: true, t: now(), billed: 0 }; a.call = { peer: f, t: now() };          // the caller pays per started minute
  send(f, { t: 'call', open: true, with: a.name, phone: a.phone, fee: CALL_FEE, payer: 1 }); send(a, { t: 'call', open: true, with: f.name, phone: f.phone, fee: CALL_FEE, payer: 0 });
  callBill(f);
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
const WORK = new Set(['icu.start', 'chair.sit', 'warehouse.buy', 'warehouse.auction', 'kitchen.cook', 'pier.cast', 'gplot.plant', 'gplot.harvest', 'bed.treat', 'bed.revive', 'restaurant.pickup', 'sdesk.sit']);
function holdsHome(a) {
  if (a.house >= 0 && !tenants[a.house]) return a.house;
  if (a.rent && a.rent.until > now()) return a.rent.idx;
  return -1;
}
// ---- riders: "steal the customer" - an orange rival rider shows up in town; walk into them and it is a turn-based battle
const RB_NAMES = ['บอย', 'แจ็ค', 'ต้อม', 'เบียร์', 'ก้อง', 'นัท', 'ปอนด์', 'ตี๋'];
const RB_CUST = ['ป้าแดง', 'คุณนายใจดี', 'พี่ต้นออฟฟิศ', 'น้องข้าวหอม', 'ลุงจุก', 'คุณแพร'];
const RB_MOVES = { dash: ['บิดคันเร่ง', 22, .95], cut: ['มุดทางลัด', 34, .72], honk: ['บีบแตรข่ม', 0, .9], smile: ['ยิ้มหวานให้ลูกค้า', 0, 1] };
const RB_FOE = { block: ['ปาดหน้า', 24, .9], corner: ['เลี้ยวมุมแคบ', 32, .7], shout: ['ตะโกนข่ม', 0, .85], call: ['โทรหาลูกค้าก่อน', 0, 1] };
function rbStats(L, bonus = 0) { return { lv: L, max: 60 + 8 * L, hp: 60 + 8 * L, atk: 10 + 2 * L + bonus, def: 8 + L + bonus * .5, spd: 10 + L + bonus, deb: 0, cd: 0 }; }
function rivalSpawn(a, force) {
  if (a.career !== 'rider' && !allJobs(a) || a.rb || a.rival || areaId(a) !== 'town') return false;
  const opts = reachFrom(a.x, a.y, 16, 45, 9); if (!opts.length) return false;
  const c = pick(opts), L = Math.max(1, lvl(a) + rint(-1, 1));
  a.rival = { x: c[0] + .5, y: c[1] + .5, until: now() + 180000, name: `ไรเดอร์ส้ม${pick(RB_NAMES)}`, lv: L, cust: pick(RB_CUST) };
  markMe(a); send(a, { t: 'rbfx', kind: 'spawn' });
  toast(a, `📣 ${a.rival.name} กำลังจะไปแย่งลูกค้า (${a.rival.cust}) ของคุณ! ตามไปขวางเลย (จุดสีส้มบนมินิแมพ)`, '🧡');
  return true;
}
function rivalTick(a, t) {
  if (a.career !== 'rider' && !allJobs(a)) { if (a.rival) { a.rival = null; markMe(a); } return; }
  if (a.career === 'rider' && !a.rival && !a.rb && t > (a.rivalNext || (a.rivalNext = t + rnd(45, 90) * 1000))) { a.rivalNext = t + rnd(100, 200) * 1000; rivalSpawn(a); }
  const r = a.rival; if (!r) return;
  if (t > r.until) { a.rival = null; markMe(a); return toast(a, `${r.name} แย่งลูกค้าไปส่งแล้ว... ช้าไปนิด`, '🧡', false); }
  if (areaId(a) === 'town' && Math.hypot(a.x - r.x, a.y - r.y) < 1.5) {          // caught up: battle!
    if (a.energy < 4 * D.ENERGY_MUL) { a.rival = null; markMe(a); return toast(a, `ทันตัว${r.name}แล้ว แต่หมดแรงจะแข่ง (ต้องมีพลังงาน ⚡) — มันแย่งลูกค้าไปแล้ว`, '😵', false); }
    spend(a, 4);
    const bike = a.ride && D.VEHICLES[a.ride] ? 3 : 0;
    a.rb = { foe: { ...rbStats(r.lv), name: r.name }, me: { ...rbStats(lvl(a), bike), name: a.name, drinks: 2 }, cust: r.cust, turn: 0 };
    a.rival = null; markMe(a); send(a, { t: 'rb', start: 1, st: rbView(a) });
  }
}
const rbView = a => a.rb && { foe: a.rb.foe, me: a.rb.me, cust: a.rb.cust };
function rbHit(att, dfn, pow, ev, who, mvName) {
  const crit = Math.random() < 1 / 12, d = Math.max(1, Math.round(pow * (att.atk * (att.deb > 0 ? .75 : 1)) / dfn.def * rnd(.85, 1) * (crit ? 1.5 : 1)));
  dfn.hp = Math.max(0, dfn.hp - d); ev.push({ who, text: crit ? 'ได้ผลดีเยี่ยม! (คริติคอล)' : `ได้ผล! ${dfn.name} เสียแรงใจ ${d}`, dmg: d, tgt: who === 'me' ? 'foe' : 'me', crit });
}
function rbAct(a, m) {
  const b = a.rb; if (!b) return;
  const me = b.me, foe = b.foe, ev = [];
  if (m.mv === 'run') { a.rb = null; joy(a, -2); markMe(a); return send(a, { t: 'rb', end: 'run', ev: [{ who: 'me', text: `${me.name} ยอมถอย... ${foe.name} แย่งลูกค้าไปได้` }] }); }
  const myTurn = () => {
    if (m.mv === 'drink') {
      if (me.drinks <= 0) { ev.push({ who: 'me', text: 'เครื่องดื่มชูกำลังหมดแล้ว!' }); return; }
      me.drinks--; const h = Math.min(me.max - me.hp, 35); me.hp += h; ev.push({ who: 'me', text: `${me.name} ดื่มเครื่องดื่มชูกำลัง! แรงใจ +${h}`, heal: h, tgt: 'me' }); return;
    }
    const mv = RB_MOVES[m.mv]; if (!mv) return;
    ev.push({ who: 'me', text: `${me.name} ใช้ ${mv[0]}!`, mv: m.mv });
    if (m.mv === 'smile') {
      if (me.cd > 0) { ev.push({ who: 'me', text: 'ยิ้มบ่อยไปลูกค้าเริ่มเขิน... ไม่ได้ผล' }); return; }
      const h = Math.min(me.max - me.hp, Math.round(me.max * .28)); me.hp += h; me.cd = 2; ev.push({ who: 'me', text: `ลูกค้าประทับใจ! แรงใจ +${h}`, heal: h, tgt: 'me' }); return;
    }
    if (Math.random() > mv[2]) { ev.push({ who: 'me', text: 'แต่พลาด!', miss: 1 }); return; }
    if (m.mv === 'honk') { foe.deb = 3; ev.push({ who: 'me', text: `${foe.name} ตกใจ! พลังโจมตีลดลง`, tgt: 'foe', debuff: 1 }); return; }
    rbHit(me, foe, mv[1], ev, 'me');
  };
  const foeTurn = () => {
    let k = 'block'; const r = Math.random();
    if (foe.hp < foe.max * .35 && foe.cd <= 0) k = 'call'; else if (me.deb <= 0 && r < .22) k = 'shout'; else k = r < .62 ? 'block' : 'corner';
    const mv = RB_FOE[k]; ev.push({ who: 'foe', text: `${foe.name} ใช้ ${mv[0]}!`, mv: k });
    if (k === 'call') { const h = Math.min(foe.max - foe.hp, Math.round(foe.max * .3)); foe.hp += h; foe.cd = 3; ev.push({ who: 'foe', text: `ลูกค้าใจอ่อน! ${foe.name} แรงใจ +${h}`, heal: h, tgt: 'foe' }); return; }
    if (Math.random() > mv[2]) { ev.push({ who: 'foe', text: 'แต่พลาด!', miss: 1 }); return; }
    if (k === 'shout') { me.deb = 3; ev.push({ who: 'foe', text: `${me.name} เสียขวัญ! พลังโจมตีลดลง`, tgt: 'me', debuff: 1 }); return; }
    rbHit(foe, me, mv[1], ev, 'foe');
  };
  const first = me.spd > foe.spd || me.spd === foe.spd && Math.random() < .5;
  for (const f of first ? [myTurn, foeTurn] : [foeTurn, myTurn]) { f(); if (me.hp <= 0 || foe.hp <= 0) break; }
  for (const x of [me, foe]) { if (x.deb > 0) x.deb--; if (x.cd > 0) x.cd--; }
  b.turn++;
  if (foe.hp <= 0 || me.hp <= 0) {
    const won = foe.hp <= 0; a.rb = null;
    if (won) {
      const pay = Math.round((120 + 40 * lvl(a)) * jobPay(a) * (1 + (BOOST[tier(a, 'rider')] || 0)));
      earn(a, pay); addXp(a, 1); stat(a, 'rbwin'); joy(a, 6);
      ev.push({ who: 'me', text: `${foe.name} หมดแรงใจ! ${b.cust} เลือกคุณ · ได้ค่าส่ง+ทิป ${money(pay)}`, win: 1 });
    } else { a.energy = Math.max(0, a.energy - 5); joy(a, -3); ev.push({ who: 'foe', text: `${me.name} หมดแรงใจ... ${foe.name} แย่งลูกค้าไปได้`, lose: 1 }); }
    markMe(a); return send(a, { t: 'rb', end: won ? 'win' : 'lose', ev, st: { foe, me } });
  }
  send(a, { t: 'rb', ev, st: rbView(a) });
}
// ---- the auction house (merchants): a lot comes up, you and three rival bidders each hand in one sealed bid (a guess of
// what it is worth); the highest bid wins and pays it. The house buys the lot back from the winner at its true value,
// so bidding under the true value is profit and bidding over it is a loss. An appraiser gives a rough range.
const AUC_BOTS = [['เสี่ยเฮง', 'ใจถึง', .82, 1.08], ['เจ๊หมวย', 'เขี้ยว', .62, .92], ['ลุงชาญ', 'ระวังตัว', .55, .88], ['คุณหญิงมาลี', 'รวยแต่ไม่รู้ราคา', .6, 1.2], ['เฮียหมง', 'นักเก็ง', .7, 1.02], ['พี่บอย', 'มือใหม่', .45, 1.15]];
const AUC_LOTS = [['ลังสินค้าจากโกดังปิดกิจการ', '📦', 'goods'], ['ของสดล็อตใหญ่จากสหกรณ์', '🧺', 'crop'], ['ปลาจากเรือประมงเช้านี้', '🐟', 'fish'], ['อาหารเหลือจากงานเลี้ยง', '🍱', 'meal'], ['กล่องปริศนาของสะสม', '🎁', 'mix']];
const AUC_COND = [['ดีมาก', 1.15], ['ดี', 1], ['พอใช้', .85], ['มีตำหนิ', .65]];
function aucStart(a) {
  if (!need(a, 'merchant')) return;
  if (a.auc && a.auc.stage === 'bid') return;
  if ((a.aucNext || 0) > now()) return toast(a, 'ล็อตถัดไปกำลังขึ้นเวที รอแป๊บ', '⏳', false);
  if (!spend(a, 4)) return;
  const [name, icon, kind] = pick(AUC_LOTS), pool = Object.entries(D.ITEMS).filter(([, it]) => it.base >= 6 && (kind === 'mix' ? true : it.kind === kind));
  const n = kind === 'mix' ? rint(2, 4) : rint(1, 3), items = {};
  for (let i = 0; i < n; i++) { const [id, it] = pick(pool); items[id] = (items[id] || 0) + Math.max(1, Math.round(rnd(1, 12) * Math.min(1, 300 / it.base))); }
  const [cond, cm] = pick(AUC_COND), mk = id => market[id]?.mult || 1;
  const real = Math.max(50, Math.round(Object.entries(items).reduce((s0, [id, q]) => s0 + D.ITEMS[id].base * q * mk(id), 0) * cm / 10) * 10);
  const err = [.3, .22, .15, .09][tier(a, 'merchant')], c0 = real * rnd(1 - err * .6, 1 + err * .6);
  const t = now(), bots = [...AUC_BOTS].sort(() => Math.random() - .5).slice(0, 3).map(([bn, style, lo, hi]) => ({ name: bn, style, bid: Math.round(real * rnd(lo, hi) / 10) * 10, at: t + rint(3000, 17000) }));
  a.auc = { stage: 'bid', name, icon, items, cond, real, lo: Math.round(c0 * (1 - err) / 10) * 10, hi: Math.round(c0 * (1 + err) / 10) * 10, t0: t, until: t + 20000, bots, my: 0 };
  markMe(a); send(a, { t: 'afx', kind: 'gavel' });
}
function aucBid(a, m) {
  const c = a.auc; if (!c || c.stage !== 'bid' || now() > c.until) return;
  const v = Math.round(+m.amt || 0); if (!(v > 0)) return toast(a, 'ใส่ราคาที่จะประมูลก่อน', 'ℹ️', false);
  if (v > a.money) return toast(a, `เงินสดไม่พอ (มี ${money(a.money)})`, '💸', false);
  c.my = v; markMe(a); send(a, { t: 'afx', kind: 'bid' });
}
function aucTick(a, t) {
  const c = a.auc; if (c.stage !== 'bid') return;
  for (const b of c.bots) if (!b.sent && t >= b.at) { b.sent = true; markMe(a); }
  if (t < c.until) return;
  const all = [...c.bots.map(b => ({ name: b.name, bid: b.bid, at: b.at })), ...(c.my ? [{ name: a.name, bid: c.my, at: 0, me: 1 }] : [])].sort((x, y) => y.bid - x.bid || x.at - y.at);
  const win = all[0]; c.stage = 'done'; c.result = all.map(x => [x.name, x.bid, x.me ? 1 : 0]); c.win = win.name;
  a.aucNext = t + 2500;
  if (win.me) {
    const net = c.real - win.bid; a.money -= win.bid; earn(a, c.real); addXp(a, .6); quest(a, 'buy', 1); stat(a, 'wholesale', Object.values(c.items).reduce((x, y) => x + y, 0));
    if (net > 0) joy(a, 3); c.net = net;
    toast(a, net >= 0 ? `🔨 ชนะประมูล! จ่าย ${money(win.bid)} ของจริงมีค่า ${money(c.real)} กำไร ${money(net)}` : `🔨 ชนะประมูล... แต่จ่าย ${money(win.bid)} ของมีค่าแค่ ${money(c.real)} ขาดทุน ${money(-net)}`, net >= 0 ? '💰' : '📉', net >= 0);
  } else toast(a, `🔨 ${win.name} ชนะไปที่ ${money(win.bid)} (มูลค่าจริง ${money(c.real)})`, '🔨', false);
  send(a, { t: 'afx', kind: win.me ? (c.net >= 0 ? 'win' : 'lose') : 'other' }); markMe(a);
}
// ---- the cooking battle: carry each ingredient around the kitchen (pantry -> board / pan / pot / grill -> plate -> serve)
const OP_AT = { chop: 'board', fry: 'pan', boil: 'pot', grill: 'grill' };
const AT_NAME = { board: 'เขียง', pan: 'กระทะ', pot: 'หม้อ', grill: 'เตาย่าง' };
function cookUse(a, s) {
  const c = a.cook; if (!c) return toast(a, 'ยังไม่มีออเดอร์ · รับออเดอร์ที่เคาน์เตอร์ครัว (ปรุงอาหาร)', '🍳', false);
  const where = s.type.slice(1), held = typeof c.hand === 'number' && c.hand >= 0 ? c.comps[c.hand] : null, I = id => D.ITEMS[id];
  const nextOp = cp => cp.ops[cp.k];
  if (where === 'pantry') {
    if (held && held.k === 0 && !held.ready) { held.at = 'pantry'; c.hand = -1; markMe(a); return; }       // put it back
    if (held || c.hand === 'plate') return toast(a, 'มือเต็มแล้ว วางของในมือก่อน', '✋', false);
    const i = c.comps.findIndex(cp => cp.at === 'pantry'); if (i < 0) return toast(a, 'หยิบวัตถุดิบครบแล้ว', 'ℹ️', false);
    c.hand = i; c.comps[i].at = 'hand'; markMe(a); return send(a, { t: 'kfx', kind: 'pick' });
  }
  if (where === 'plate') {
    if (held) {
      if (held.k < held.ops.length) return toast(a, `${I(held.ing).name}ยังไม่พร้อม ต้อง${{ chop: 'สับ', fry: 'ผัด', boil: 'ต้ม', grill: 'ย่าง' }[nextOp(held)]}ก่อน`, '⚠️', false);
      held.at = 'plate'; c.hand = -1;
      if (c.comps.every(cp => cp.at === 'plate')) { c.plated = true; send(a, { t: 'kfx', kind: 'plated' }); toast(a, `จัดจาน ${I(c.rid).icon}${I(c.rid).name} เสร็จ! ยกไปเสิร์ฟที่เคาน์เตอร์ด้านบน`, '🍽️'); }
      else send(a, { t: 'kfx', kind: 'drop' });
      markMe(a); return;
    }
    if (c.plated && c.hand === -1) { c.hand = 'plate'; markMe(a); return send(a, { t: 'kfx', kind: 'pick' }); }
    return toast(a, c.plated ? 'มือเต็มแล้ว' : 'เอาวัตถุดิบที่ทำเสร็จแล้วมาวางจัดจาน', 'ℹ️', false);
  }
  // board / pan / pot / grill
  const here = c.comps.map((cp, i) => [cp, i]).filter(([cp]) => cp.at === where);
  if (held) {
    if (OP_AT[nextOp(held)] !== where) return toast(a, held.k >= held.ops.length ? `${I(held.ing).name}พร้อมแล้ว เอาไปวางที่ 🍽️ โต๊ะจัดจาน` : `${I(held.ing).name}ต้องไปที่${AT_NAME[OP_AT[nextOp(held)]]}`, '⚠️', false);
    if ((where === 'board' || where === 'pan') && here.length) return toast(a, `${AT_NAME[where]}ไม่ว่าง`, '✋', false);
    if (where === 'grill' && here.length >= D.COOK.grillMax) return toast(a, 'เตาย่างเต็มแล้ว', '✋', false);
    held.at = where; held.t = now(); held.prog = 0; held.ready = false; held.burnt = false; c.hand = -1; markMe(a);
    return send(a, { t: 'kfx', kind: where });
  }
  if (c.hand === 'plate') return toast(a, 'ถือจานอยู่ เอาไปเสิร์ฟที่เคาน์เตอร์', '🍽️', false);
  if (!here.length) return toast(a, `${AT_NAME[where]}ว่างอยู่`, 'ℹ️', false);
  const [cp, i] = here.find(([x]) => x.ready || x.burnt) || here[0];
  if (cp.burnt) {                                       // ruined: throw it out and start that ingredient again (if you still have one)
    if ((a.inv[cp.ing] || 0) < 1) { a.cook = null; markMe(a); send(a, { t: 'kfx', kind: 'fail' }); return toast(a, `💀 ${I(cp.ing).name}${where === 'grill' ? 'ไหม้' : 'เละ'} และไม่มีวัตถุดิบสำรอง ออเดอร์ล้มเหลว!`, '🍳', false); }
    addItem(a, cp.ing, -1); Object.assign(cp, { k: 0, at: 'pantry', t: 0, prog: 0, ready: false, burnt: false }); markMe(a);
    return toast(a, `🗑️ ทิ้ง${I(cp.ing).name}ที่${where === 'grill' ? 'ไหม้' : 'เละ'} ใช้วัตถุดิบสำรองจากกระเป๋าเริ่มใหม่ (หยิบที่ตู้วัตถุดิบ)`, '🍳', false);
  }
  if (!cp.ready) return toast(a, where === 'board' || where === 'pan' ? `ยืนอยู่ตรงนี้เพื่อ${where === 'board' ? 'สับ' : 'ผัด'}ให้เสร็จก่อน` : `${I(cp.ing).name}ยังไม่สุก รออีกนิด`, '⏳', false);
  cp.k++; cp.ready = false; cp.at = 'hand'; c.hand = i; markMe(a); return send(a, { t: 'kfx', kind: 'pick' });
}
function cookTick(a, t, dt) {
  const c = a.cook;
  if (t > c.until) { a.cook = null; markMe(a); send(a, { t: 'kfx', kind: 'fail' }); return toast(a, `⏰ หมดเวลา! ลูกค้ารอ${D.ITEMS[c.rid].name}ไม่ไหว ออเดอร์ล้มเหลว`, '😢', false); }
  const room = D.roomAt(a.x, a.y); if (room?.rk !== 'kitchen') return;
  let live = false, changed = false;
  for (const cp of c.comps) {
    const op = cp.ops[cp.k];
    if ((cp.at === 'board' || cp.at === 'pan') && !cp.ready) {        // chopping / stir-frying: only while you stand there
      const st = ST[cp.at === 'board' ? 'k_board' : 'k_pan'];
      if (Math.hypot(a.x - st.x, a.y - st.y) < 1.5) { cp.prog += dt; live = true; if (cp.prog >= D.COOK[op]) { cp.ready = true; changed = true; send(a, { t: 'kfx', kind: 'ready' }); } }
    }
    if ((cp.at === 'pot' || cp.at === 'grill') && !cp.burnt) {          // boiling / grilling: on their own, but don't forget them
      const el = (t - cp.t) / 1000;
      if (!cp.ready && el >= D.COOK[op]) { cp.ready = true; changed = true; send(a, { t: 'kfx', kind: 'ready' }); }
      if (el >= D.COOK[op] + D.COOK.window[op]) { cp.burnt = true; cp.ready = false; changed = true; send(a, { t: 'kfx', kind: 'burnt' }); toast(a, `🔥 ${D.ITEMS[cp.ing].name}${cp.at === 'grill' ? 'ไหม้' : 'เละ'}แล้ว! รีบเอาไปทิ้งแล้วทำใหม่`, '💀', false); }
    }
  }
  if (changed) markMe(a);
  if (live && t > c.ckAt) { c.ckAt = t + 200; send(a, { t: 'ck', prog: c.comps.map(cp => +cp.prog.toFixed(2)) }); }
}
// ---- job missions (server/missions.js): a short story per career played out in town, step by step
const MIS = require('./missions');
// reachable town tiles from (x, y): [x, y, steps] with min..max steps of walking and at least minE straight-line distance
function reachFrom(x0, y0, min, max, minE = 0) {
  const A = D.AREAS.find(r => r.id === 'town'), sx = Math.floor(x0), sy = Math.floor(y0), out = [];
  const dist = new Map([[sy * 4096 + sx, 0]]), q = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], d = dist.get(y * 4096 + x);
    if (d >= min && d <= max && Math.hypot(x - sx, y - sy) >= minE && D.TILES[y][x] !== 'D' && !D.roomAt(x + .5, y + .5)) out.push([x, y, d]);
    if (d >= max) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * 4096 + nx;
      if (nx <= A.x || ny <= A.y || nx >= A.x + A.w - 1 || ny >= A.y + A.h - 1 || dist.has(k) || D.blocked(nx + .5, ny + .5)) continue;
      dist.set(k, d + 1); q.push([nx, ny]);
    }
  }
  return out;
}
const misLook = who => {
  const [kind, name] = who.includes(':') ? who.split(':') : ['m', who], h = [...name].reduce((s, c) => s * 31 + c.charCodeAt(0) >>> 0, 7);
  const hair = kind === 'o' ? 'silver' : ['brown', 'black', 'blonde', 'red', 'brown'][h % 5], shirt = D.SHIRTS[h % D.SHIRTS.length];
  return { name, g: kind === 'f' || (kind === 'o' && h % 2) || (kind === 'k' && h % 2) ? 'f' : 'm', lk: { hair, shirt, pants: ['gray', 'blue', 'black', 'brown'][(h >> 3) % 4] }, kid: kind === 'k' };
};
function misPlace(where, prev) {
  if (where === 'here') return { x: prev.x, y: prev.y, d: 0 };
  if (where === 'far' || where === 'near') {
    const opts = where === 'far' ? reachFrom(prev.x, prev.y, 30, 90, 16) : reachFrom(prev.x, prev.y, 6, 18, 4);
    const c = opts.length ? pick(opts) : [Math.floor(prev.x), Math.floor(prev.y), 0];
    return { x: c[0] + .5, y: c[1] + .5, d: c[2] };
  }
  const st = ST[MIS.PLACES[where] || where]; if (!st) return { x: prev.x, y: prev.y, d: 0 };
  let x = st.x, y = st.y;
  if (D.blocked(x, y)) { const n = standNear('town', x, y + .6); if (n) [x, y] = n; }
  return { x, y, d: Math.round(Math.hypot(x - prev.x, y - prev.y) * 1.4), label: st.label };
}
function misBuild(a, car, force) {
  const list = MIS.M[car]; if (!list) return null;
  a.misRecent = (a.misRecent || []).filter(i => i < list.length);
  let idx; do idx = rint(0, list.length - 1); while (a.misRecent.includes(idx) && a.misRecent.length < list.length - 1);
  if (force != null && list[force]) idx = force;                    // (admins can pick one, for testing)
  a.misRecent = [...a.misRecent, idx].slice(-6);
  const [title, icon, story, raw] = list[idx];
  const out = D.roomAt(a.x, a.y)?.outside; let prev = out ? { x: out.x, y: out.y } : { x: a.x, y: a.y };
  let est = 40; const steps = [];
  for (const r of raw) {
    const k = r[0], pl = misPlace(r[1], prev), st = { k, x: pl.x, y: pl.y };
    est += (pl.d || Math.hypot(pl.x - prev.x, pl.y - prev.y) * 1.4) / SPEED * 2.3;
    if (k === 'go') st.label = r[2];
    else if (k === 'find') { st.icon = r[2]; st.label = r[3]; st.hc = [Math.round(pl.x + rnd(-5, 5)), Math.round(pl.y + rnd(-5, 5)), 10]; est += 25; }
    else if (k === 'collect') {
      st.icon = r[3]; st.label = r[4]; const pool = reachFrom(pl.x, pl.y, 0, 10), items = [];
      for (let i = 0; i < 40 && items.length < r[2] && pool.length; i++) { const c = pick(pool); if (items.every(([x, y]) => Math.hypot(x - c[0] - .5, y - c[1] - .5) >= 2)) items.push([c[0] + .5, c[1] + .5, 0]); }
      st.items = items; st.hc = [Math.round(pl.x), Math.round(pl.y), 9]; est += items.length * 6;
    }
    else if (k === 'deliver') { st.who = misLook(r[2]); st.label = r[3]; }
    else if (k === 'work') { st.sec = r[2]; st.icon = r[3]; st.label = r[4]; st.prog = 0; est += r[2] * 1.3; }
    else if (k === 'chase') { st.animal = r[2]; st.label = r[3]; st.cx = pl.x; st.cy = pl.y; st.flee = 0; est += 40; }
    else if (k === 'escort') {
      st.who = misLook(r[3]); st.label = r[4]; const to = misPlace(r[2], pl); st.to = { x: to.x, y: to.y }; st.fx = pl.x; st.fy = pl.y; st.phase = 0;
      est += (to.d || Math.hypot(to.x - pl.x, to.y - pl.y) * 1.4) / 2.4 * 2 + 10; prev = to; steps.push(st); continue;
    }
    else if (k === 'talk') { st.who = misLook(r[2]); st.q = r[3]; st.ans = r[4]; st.right = r[5]; st.label = `คุยกับ${st.who.name}`; est += 20; }
    steps.push(st); prev = { x: st.x, y: st.y };
  }
  const limit = Math.round(clamp(est, 120, 720) * 1000), t = now();
  return { car, idx, title, icon, story, steps, i: 0, t0: t, limit, until: t + limit, trail: [], mtAt: 0 };
}
// ICU cases: steps at spots in the hospital (x, y relative to the hospital room); 'bed' = the ICU bed
const ICU_CASES = [
  ['หัวใจหยุดเต้น!', '💓', 'คนไข้หมดสติ ชีพจรหาย ต้องกู้ชีพด่วน', [['go', 'cab', 'หยิบเครื่องกระตุกหัวใจ (AED) ที่ตู้ยา'], ['work', 'bed', 12, '💓', 'ปั๊มหัวใจและช็อกไฟฟ้าจนชีพจรกลับมา'], ['go', 'fridge', 'หยิบยาอะดรีนาลีนจากตู้เย็นยา'], ['work', 'bed', 5, '💉', 'ฉีดยาและเฝ้าดูสัญญาณชีพ']]],
  ['ไส้ติ่งแตก', '🔪', 'คนไข้ปวดท้องขวาล่างรุนแรง ต้องผ่าตัดทันที', [['go', 'cab', 'เตรียมชุดเครื่องมือผ่าตัด'], ['work', 'fridge', 4, '🧼', 'ล้างมือ ใส่ถุงมือและชุดผ่าตัด'], ['work', 'bed', 14, '🔪', 'ผ่าตัดไส้ติ่ง'], ['work', 'bed', 6, '🧵', 'เย็บแผล'], ['go', 'desk', 'ส่งรายงานผ่าตัดให้พยาบาล']]],
  ['หอบหืดกำเริบ', '🫁', 'เด็กหายใจไม่ออก ริมฝีปากเริ่มเขียว', [['go', 'fridge', 'หยิบยาพ่นขยายหลอดลม'], ['go', 'iv', 'เข็นถังออกซิเจนมา'], ['work', 'bed', 9, '🫁', 'ให้ออกซิเจนและพ่นยา']]],
  ['กระดูกขาหัก', '🦴', 'คนงานตกนั่งร้าน ขาผิดรูป', [['work', 'xray', 6, '🩻', 'เอกซเรย์ดูแนวกระดูก'], ['go', 'cab', 'หยิบเฝือกและผ้าพัน'], ['work', 'bed', 10, '🦴', 'จัดกระดูกและใส่เฝือก']]],
  ['เสียเลือดมาก', '🩸', 'อุบัติเหตุรถชน เลือดออกไม่หยุด', [['work', 'bed', 6, '🩹', 'กดห้ามเลือด'], ['go', 'fridge', 'หยิบถุงเลือดกรุ๊ปโอ'], ['go', 'iv', 'เตรียมเสาน้ำเกลือ'], ['work', 'bed', 8, '💉', 'ให้เลือดและน้ำเกลือ']]],
  ['แพ้อาหารรุนแรง', '⚠️', 'คนไข้กินกุ้งแล้วหน้าบวม หายใจลำบาก', [['go', 'fridge', 'หยิบยาฉีดแก้แพ้'], ['work', 'bed', 5, '💉', 'ฉีดยาแก้แพ้'], ['work', 'monitor', 6, '📈', 'เฝ้าดูชีพจรและความดัน']]],
  ['ไข้เลือดออกช็อก', '🦟', 'เด็กไข้สูงหลายวัน ความดันตก', [['work', 'desk', 4, '📋', 'อ่านประวัติและผลเลือด'], ['go', 'iv', 'เตรียมน้ำเกลือ'], ['work', 'bed', 10, '💧', 'ให้สารน้ำทางหลอดเลือด'], ['work', 'monitor', 5, '📈', 'เช็กความดันจนคงที่']]],
  ['ถูกของมีคมบาด', '🩹', 'แผลลึกที่แขน ต้องเย็บด่วน', [['go', 'cab', 'หยิบชุดเย็บแผล'], ['work', 'bed', 5, '🧴', 'ล้างแผลและฉีดยาชา'], ['work', 'bed', 8, '🧵', 'เย็บแผล']]],
];
function icuCase(a, def, pay) {
  const R = D.AREAS.find(r => r.id === 'r_hospital'), P = { cab: [1.6, 3.9], fridge: [5.6, 3.8], xray: [14.2, 4.6], iv: [13.6, 6.6], desk: [3.5, 3.6], monitor: [12.25, 4.0] };
  const at = w => { if (w === 'bed') return [ST.icu.x, ST.icu.y - .6]; const [x, y] = P[w]; const n = D.blocked(R.x + x, R.y + y) ? standNear('r_hospital', R.x + x, R.y + y) : [R.x + x, R.y + y]; return n; };
  const [title, icon, story, raw] = def, steps = raw.map(r => { const [x, y] = at(r[1]); return r[0] === 'go' ? { k: 'go', x, y, label: r[2], area: 'r_hospital' } : { k: 'work', x, y, sec: r[2], icon: r[3], label: r[4], prog: 0, area: 'r_hospital' }; });
  const limit = Math.round((25 + steps.reduce((s0, st) => s0 + (st.sec || 0) + 6, 0)) * 1.45 * 1000), t = now();
  return { kind: 'icu', car: 'doctor', idx: -1, title, icon, story: `${pick(D.ICU.patients)} · ${story}`, steps, i: 0, t0: t, limit, until: t + limit, trail: [], mtAt: 0, payFixed: Math.round(pay) };
}
function misView(a) {
  const m = a.mis; if (!m) return null;
  const c = m.steps[m.i];
  const cur = c && { area: c.area || 'town', k: c.k, x: c.x, y: c.y, label: c.label, icon: c.icon, who: c.who, items: c.items, sec: c.sec, prog: c.prog, hc: c.hc, animal: c.animal, to: c.to, phase: c.phase, fx: c.fx, fy: c.fy, cx: c.cx, cy: c.cy };
  return { kind: m.kind || '', title: m.title, icon: m.icon, story: m.story, i: m.i, until: m.until, t0: m.t0, steps: m.steps.map((s, j) => ({ k: s.k, label: s.label, done: j < m.i })), cur };
}
function misNext(a) {
  const m = a.mis; m.i++;
  if (m.i < m.steps.length) { FX0(a, 'step'); markMe(a); return; }
  const t = now(), min = (t - m.t0) / 60000, early = t - m.t0 < m.limit * .5;
  const pay = m.payFixed ? Math.round(m.payFixed * (early ? 1.25 : 1) * jobPay(a) * (1 + (BOOST[tier(a, m.car)] || 0))) : Math.round((110 + 80 * min) * (MIS.PAY[m.car] || 1) * (early ? 1.25 : 1) * jobPay(a) * (1 + (BOOST[tier(a, m.car)] || 0)));
  a.mis = null; if (m.kind === 'icu') { a.icuNext = t + D.ICU.next; quest(a, 'treat'); stat(a, 'treated'); feed(`🚑 หมอ${a.name} ช่วยชีวิตคนไข้ในเคส "${m.title}" สำเร็จ`); } else a.misNext = t + 18000; earn(a, pay); addXp(a, 1.5); stat(a, 'missions'); joy(a, 6); markMe(a);
  const dd = a.lastDed || { tax: 0, loan: 0, net: pay }, ded = [dd.tax ? `ภาษี ${money(dd.tax)}` : '', dd.loan ? `ผ่อนกู้ ${money(dd.loan)}` : ''].filter(Boolean).join(' · ');
  toast(a, `${m.icon} ภารกิจ "${m.title}" สำเร็จ! ใช้เวลา ${Math.floor(min)} นาที ${Math.round(min % 1 * 60)} วิ${early ? ' · ทำเร็ว โบนัส +25%' : ''} · ค่าจ้าง ${money(pay)}${ded ? ` (หัก${ded}) เข้ากระเป๋า ${money(dd.net)}` : ''}`, '🏅');
}
const FX0 = (a, kind) => send(a, { t: 'mfx', kind });
function misTick(a, t, dt) {
  const m = a.mis, c = m.steps[m.i];
  if (t > m.until) { a.mis = null; if (m.kind === 'icu') a.icuNext = t + D.ICU.next; else a.misNext = t + 36000; joy(a, -3); markMe(a); return toast(a, `⏰ หมดเวลา! ภารกิจ "${m.title}" ล้มเหลว`, '😢', false); }
  if (!c || areaId(a) !== (c.area || 'town')) return;
  const d = Math.hypot(a.x - c.x, a.y - c.y);
  const last = m.trail[m.trail.length - 1]; if (!last || Math.hypot(a.x - last[0], a.y - last[1]) > .35) { m.trail.push([a.x, a.y]); if (m.trail.length > 80) m.trail.shift(); }
  let live = false;
  switch (c.k) {
    case 'go': case 'deliver': if (d < 1.6) misNext(a); return;
    case 'find': if (d < 1.4) misNext(a); return;
    case 'talk':
      if (d < 1.8 && !c.asked && t > (c.askAt || 0)) { c.asked = true; send(a, { t: 'mq', who: c.who, q: c.q, ans: c.ans }); }
      if (d > 4) c.asked = false;
      return;
    case 'collect': {
      let got = false;
      for (const it of c.items) if (!it[2] && Math.hypot(a.x - it[0], a.y - it[1]) < 1.2) { it[2] = 1; got = true; }
      if (got) { FX0(a, 'pick'); if (c.items.every(it => it[2])) misNext(a); else markMe(a); }
      return;
    }
    case 'work':
      if (d < 1.9 && !a.down) { c.prog = Math.min(c.sec, c.prog + dt); live = true; if (c.prog >= c.sec) return misNext(a); }
      break;
    case 'chase': {
      const pd = Math.hypot(a.x - c.cx, a.y - c.cy);
      if (pd < 1.05) { FX0(a, 'catch'); return misNext(a); }
      let tx = 0, ty = 0, sp;
      if (pd < 6) { c.flee += dt; sp = c.flee > 9 ? 1.7 : 2.5; tx = (c.cx - a.x) / pd; ty = (c.cy - a.y) / pd; }
      else { sp = .55; if (!c.wd || t > c.wdT) { const an = rnd(0, 6.28); c.wd = [Math.cos(an), Math.sin(an)]; c.wdT = t + rnd(1500, 3500); } [tx, ty] = c.wd; }
      let best = null, bs = -1e9;
      for (let k = 0; k < 12; k++) {                     // pick the free direction closest to "away"
        const an = Math.atan2(ty, tx) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * .45 + rnd(-.15, .15), nx = c.cx + Math.cos(an) * sp * dt, ny = c.cy + Math.sin(an) * sp * dt;
        if (D.blocked(nx, ny) || D.areaAt(nx, ny)?.id !== 'town') continue;
        const sc = -Math.abs(k) * .3 + (pd < 6 ? Math.hypot(nx - a.x, ny - a.y) * 3 : 0);
        if (sc > bs) { bs = sc; best = [nx, ny]; }
      }
      if (best) { c.cx = best[0]; c.cy = best[1]; } else if (c.wd) c.wdT = 0;
      live = true; break;
    }
    case 'escort': {
      if (c.phase === 0) { if (Math.hypot(a.x - c.fx, a.y - c.fy) < 1.6) { c.phase = 1; m.trail = [[a.x, a.y]]; markMe(a); } live = true; break; }
      const fd = Math.hypot(a.x - c.fx, a.y - c.fy); c.wait = fd > 9;
      if (fd > 1.4 && !c.wait) {                         // follow your footsteps (never through walls)
        while (m.trail.length > 1 && Math.hypot(m.trail[0][0] - c.fx, m.trail[0][1] - c.fy) < .3) m.trail.shift();
        const tgt = m.trail[0] || [a.x, a.y];
        const dx = tgt[0] - c.fx, dy = tgt[1] - c.fy, l = Math.hypot(dx, dy) || 1, st = Math.min(l, 2.5 * dt);
        c.fx += dx / l * st; c.fy += dy / l * st;
      }
      if (Math.hypot(c.fx - c.to.x, c.fy - c.to.y) < 2.2) return misNext(a);
      live = true; break;
    }
  }
  if (live && t > m.mtAt) { m.mtAt = t + 200; send(a, { t: 'mt', k: c.k, prog: c.prog, cx: c.cx, cy: c.cy, fx: c.fx, fy: c.fy, wait: c.wait ? 1 : 0, phase: c.phase }); }
}
function misAct(a, m) {
  if (m.op === 'start') {
    const car = allJobs(a) && MIS.M[m.car] ? m.car : a.career;
    if (!car || car === 'none' || !MIS.M[car]) return toast(a, 'ต้องมีอาชีพก่อน ถึงจะรับภารกิจได้', 'ℹ️', false);
    if (a.mis) return toast(a, 'คุณมีภารกิจค้างอยู่แล้ว', 'ℹ️', false);
    if (!isAdmin(a)) {                                    // missions are handed out by the job's NPC (farmers: at the farm gate while the farm is closed)
      const st = ST[m.st], ok = st && (st.id === 'staff_' + car || car === 'farmer' && st.id === 'gate_farm') && areaId(a) === st.area && Math.hypot(a.x - st.x, a.y - st.y) < (st.r || 1.5) + 2.5;
      if (!ok) return toast(a, 'รับภารกิจได้ที่ NPC ของอาชีพคุณ', '📋', false);
    }
    if ((a.misNext || 0) > now() && !(isAdmin(a) && a.god?.nocd)) return toast(a, `ยังไม่มีงานใหม่ รออีก ${Math.ceil((a.misNext - now()) / 1000)} วินาที`, '⏳', false);
    const out = D.roomAt(a.x, a.y)?.outside, where = out ? D.areaAt(out.x, out.y)?.id : areaId(a);
    if (where !== 'town') return toast(a, 'ภารกิจอาชีพทำในตัวเมือง กลับเข้าเมืองก่อนนะ', '🏙️', false);
    if (a.down) return;
    if (!spend(a, 5)) return;
    a.mis = misBuild(a, car, isAdmin(a) && m.idx != null ? +m.idx : null); markMe(a);
    return toast(a, `${a.mis.icon} ภารกิจใหม่: ${a.mis.title} — ${a.mis.story} (เวลา ${Math.round(a.mis.limit / 6000) / 10} นาที)`, '📋');
  }
  if (!a.mis) return;
  if (m.op === 'quit') { if (a.mis.kind === 'icu') a.icuNext = now() + D.ICU.next / 2; else a.misNext = now() + 30000; a.mis = null; markMe(a); return toast(a, 'ยกเลิกภารกิจแล้ว', 'ℹ️', false); }
  if (m.op === 'answer') {
    const c = a.mis.steps[a.mis.i]; if (!c || c.k !== 'talk' || !c.asked) return;
    if (+m.i === c.right) { toast(a, `✅ ${c.who.name}: ขอบคุณมาก เข้าใจแล้ว!`, '💬'); return misNext(a); }
    a.mis.until -= 20000; c.asked = false; c.askAt = now() + 2500; markMe(a);
    return toast(a, `❌ ${c.who.name} ดูไม่ค่อยพอใจคำตอบนี้... (เสียเวลา 20 วิ) ลองคุยใหม่อีกครั้ง`, '💬', false);
  }
}
// ---- lost-dog cases (police): a dog hides somewhere reachable in town; find it (walk up to it) before the time limit
function dogSpot(a) {
  const A = D.AREAS.find(r => r.id === 'town'), sx = Math.floor(a.x), sy = Math.floor(a.y);
  if (areaId(a) !== 'town') return null;
  const dist = new Map([[sy * 4096 + sx, 0]]), q = [[sx, sy]], far = [];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i], d = dist.get(y * 4096 + x);
    if (d >= D.DOGQ.minSteps && d <= D.DOGQ.maxSteps && Math.hypot(x - sx, y - sy) >= 28 && D.TILES[y][x] !== 'D' && !D.roomAt(x + .5, y + .5)) far.push([x, y, d]);
    if (d >= D.DOGQ.maxSteps) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * 4096 + nx;
      if (nx <= A.x || ny <= A.y || nx >= A.x + A.w - 1 || ny >= A.y + A.h - 1 || dist.has(k) || D.blocked(nx + .5, ny + .5)) continue;
      dist.set(k, d + 1); q.push([nx, ny]);
    }
  }
  return far.length ? pick(far) : null;
}
function almsTick(a, t) {
  const A = a.alms; if (a.career !== 'monk') { a.alms = null; markMe(a); return; }
  if (hourNow() >= D.TEMPLEQ.almsTo + 2) { a.alms = null; markMe(a); return toast(a, 'สายแล้ว จบการบิณฑบาตวันนี้ (ยังไม่ครบทุกจุด)', '🙏', false); }
  if (areaId(a) === 'town') A.pts.forEach((p, i) => {
    if (A.got[i] || Math.hypot(a.x - p[0], a.y - p[1]) > 2.4) return;
    A.got[i] = 1; const f = pick(D.TEMPLEQ.almsFood), tip = rint(...D.TEMPLEQ.almsTip);
    addItem(a, f, 1); earn(a, tip); markMe(a); send(a, { t: 'tfx', kind: 'alms', x: p[0], y: p[1] });
    toast(a, `🙏 ญาติโยมหน้า${p[2]}ใส่บาตร ${D.ITEMS[f].icon}${D.ITEMS[f].name} + ปัจจัย ${money(tip)} (${A.got.filter(Boolean).length}/${A.pts.length})`, '🙏');
  });
  const w = ST.wat_pray;
  if (A.got.every(Boolean) && areaId(a) === 'temple' && Math.hypot(a.x - w.x, a.y - w.y) < 3) {
    const pay = Math.round(D.TEMPLEQ.almsPay * jobPay(a)); a.alms = null; earn(a, pay); addXp(a, 1); joy(a, 8); markMe(a);
    feed(`🙏 ${a.name} บิณฑบาตครบทุกจุดแล้ว`);
    return toast(a, `🙏 กลับถึงวัด บิณฑบาตเสร็จเรียบร้อย ได้ปัจจัยจากวัด ${money(pay)} · อย่าลืมฉันเช้าก่อนเที่ยงนะ`, '🙏');
  }
}
function dogTick(a, t) {
  const c = a.dogq;
  if (c.kind === 'thief') {
    if (areaId(a) === 'town' && Math.hypot(a.x - c.x, a.y - c.y) < 2.2) {
      const min = (t - c.t0) / 60000, early = t - c.t0 < c.limit * .5;
      const pay = Math.round((D.THIEFQ.base + D.THIEFQ.perMin * (c.wm ?? min / 2)) * (early ? 1.25 : 1) * jobPay(a) * (1 + BOOST[tier(a, 'police')]));
      a.dogq = null; a.thiefNext = t + D.THIEFQ.next; earn(a, pay); addXp(a, 1.2); joy(a, 8); markMe(a); send(a, { t: 'caught' });
      feed(`🚓 ${a.name} จับโจร "${c.name}" ได้แล้ว!`);
      return toast(a, `🚓 จับ "${c.name}" ได้แล้ว! ได้${c.stole}คืนเจ้าของ · รางวัล ${money(pay)}${early ? ' (จับไว โบนัส +25%)' : ''}`, '🚓');
    }
    if (t > c.until) { a.dogq = null; a.thiefNext = t + D.THIEFQ.next * 2; markMe(a); joy(a, -4); toast(a, `⏰ ช้าไป! "${c.name}" หนีออกนอกเมืองไปแล้ว`, '😤', false); }
    return;
  }
  if (areaId(a) === 'town' && Math.hypot(a.x - c.x, a.y - c.y) < 1.5) {          // found!
    const min = (t - c.t0) / 60000, early = t - c.t0 < c.limit * .5;
    const pay = Math.round((D.DOGQ.base + D.DOGQ.perMin * (c.wm ?? min / 2)) * (early ? 1 + D.DOGQ.early : 1) * jobPay(a) * (1 + BOOST[tier(a, 'police')]));
    a.dogq = null; a.dogNext = t + D.DOGQ.next; earn(a, pay); addXp(a, 1); stat(a, 'dogs'); joy(a, 6); markMe(a);
    return toast(a, `🐕 เจอ "น้อง${c.name}" แล้ว! ส่งคืน${c.owner} ใช้เวลา ${Math.floor(min)} นาที ${Math.round((min % 1) * 60)} วิ${early ? ' · เจอเร็ว โบนัส +25%' : ''} · ได้ ${money(pay)}`, '🐕');
  }
  if (t > c.until) { a.dogq = null; a.dogNext = t + D.DOGQ.next * 2; markMe(a); toast(a, `⏰ หมดเวลา! ตามหา "น้อง${c.name}" ไม่ทัน ${c.owner}เสียใจมาก เคสล้มเหลว`, '😢', false); joy(a, -4); }
}
// a fish (or junk) landed: xp, the bag, the fish book, the news feed
function giveCatch(a, id) {
  const before = fishLv(a);
  a.xp.fisher = (a.xp.fisher || 0) + 1;
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
  if (id === 'shark') stat(a, 'shark'); if (id === 'chest') stat(a, 'chest'); if (id === 'goldenfish') stat(a, 'goldenfish');
  const it = D.ITEMS[id], rar = it.rar || 1, rn = D.FISH_RARITY[rar] || '';
  if (rar >= 4) stat(a, 'epicfish');
  a.fishdex = a.fishdex || {}; const first = !a.fishdex[id]; a.fishdex[id] = (a.fishdex[id] || 0) + 1;
  stat(a, 'fishdex', Object.keys(a.fishdex).filter(k => D.ITEMS[k]?.rar).length, true);
  if (it.legend) { eggOf(a).ld = dayKey(); stat(a, 'legendfish'); feed(`🎉 ${a.name} พบปลาในตำนาน! ${it.icon} ${it.name}`); send(a, { t: 'egg', k: 'legend' }); }
  else if (rar >= 4 || it.base >= 1000) feed(`${it.icon} ${a.name} ตกได้ ${it.name} [${rn}]!!`);

  send(a, { t: 'catch', item: id, first });
  return toast(a, `ได้ ${it.icon}${it.name} [${rn}] (~${money(it.base)})${first ? ' · ชนิดใหม่! 📖' : ''}`, it.icon);
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
  if (a.pose === 'beg' && (a.career === 'beggar' || allJobs(a)) && Math.random() < 0.025 * (1 + BOOST[tier(a, 'beggar')]) * begSpot(a)) {
    const c = Math.round(rint(4, 14) * jobPay(a)); earn(a, c); if (Math.random() < .5) addXp(a, .5); stat(a, 'alms'); toast(a, `${pick(D.NPC_NAMES)} หยอดเงินให้ ${money(c)}`, '🪙');
  }
  if (a.dogq) dogTick(a, t);
  if (a.alms) almsTick(a, t);
}

// how good a place is for begging: busy streets near shops > quiet corners > indoors; night is slow
function begSpot(a) {
  const area = areaId(a); if (area !== 'town' && area !== 'housing' && area !== 'farm') return 0.3;
  let m = area === 'town' ? 0.7 : 0.45;
  if (D.STATIONS.some(s => s.type === 'door' && s.house === undefined && s.area === area && Math.hypot(s.x - a.x, s.y - a.y) < 6)) m = 1;
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
  const bn = botById(+m.to);
  if (bn && bn.c === 'beggar' && dist(a, bn) <= 5) { const amt = clamp(Math.floor(+m.amt) || 0, 1, 100000); if (a.money < amt) return toast(a, 'เงินไม่พอ', '💸', false); a.money -= amt; markMe(a); joy(a, 4); botSay(bn, pick(['ขอบคุณมากครับ 🙏', 'ขอให้รวยๆ นะ', 'บุญรักษานะครับ'])); return toast(a, `บริจาคให้ ${bn.name} ${money(amt)} อิ่มบุญ 😇`, '🥣'); }
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
// ------------------------------------------------------------------ looks
function wear(a, m) {
  const cat = m.cat; if (!D.LOOKS[cat]) return;
  if (m.id && !a.wardrobe[cat].includes(m.id)) return toast(a, 'ยังไม่มีชิ้นนี้ ซื้อที่ร้านแฟชั่น (ผมที่ร้านทำผม) ก่อน', '💇', false);
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
      if (prev.has(k) || nx < A.x || ny < A.y || nx >= A.x + A.w || ny >= A.y + A.h || D.blocked(nx + .5, ny + .5) && !(n.zb && D.POOL.x0 && nx >= D.POOL.x0 && nx < D.POOL.x1 && ny >= D.POOL.y0 && ny < D.POOL.y1)) continue;   // zombies wade through the park pool
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
  const spots = D.STATIONS.filter(s => s.area === 'town' && /^(door|seat|pier|square|fishclub)$/.test(s.type)).map(s => [Math.floor(s.x) + .5, Math.floor(s.y + (s.type === 'door' ? .6 : 0)) + .5]).filter(([x, y]) => !D.blocked(x, y));
  D.FOLK.town.forEach((p, i) => {
    const [x, y] = pick(walkableIn('town'));
    npcs.push({ id: -(i + 1), folk: 1, name: p.name, face: p.face, area: 'town', x: x + .5, y: y + .5, f: 6, path: [], wait: rnd(0, 4),
      g: p.g, look: { ...p.look }, speed: p.kid ? rnd(1.4, 1.8) : rnd(1.1, 1.6), pickedAt: 0,
      next: function () { return folkNext(this, spots); }, stay: () => rnd(4, 14) });
  });
}
// people living in the housing estate stroll around it too
{
  const hs = walkableIn('housing');
  D.FOLK.housing.forEach((p, i) => {
    const [x, y] = pick(hs);
    npcs.push({ id: -(40 + i), folk: 1, name: p.name, face: p.face, area: 'housing', x: x + .5, y: y + .5, f: 6, path: [], wait: rnd(0, 4),
      g: p.g, look: { ...p.look }, speed: rnd(1.1, 1.5), pickedAt: 0, next: () => pick(hs).map(v => v + .5), stay: () => rnd(4, 14) });
  });
}
// townsfolk go in and out of open shops through the front door, just like players
const PUBLIC_DOORS = D.STATIONS.filter(s => s.type === 'door' && s.area === 'town' && s.house === undefined && !s.renov && ROOM[s.to]);
function folkNext(n, spots) {
  if (n.inside) {
    if (n.inside.left-- > 0) { const w = walkableIn(n.area); return w.length ? pick(w).map(v => v + .5) : [n.inside.room.exit.x, n.inside.room.exit.y]; }
    n.leaving = true; return [n.inside.room.exit.x, n.inside.room.exit.y];
  }
  if (Math.random() < .3) {
    const d = pick(PUBLIC_DOORS.filter(s => buildingOpen(s.bld)));
    if (d) { n.goingIn = d; return [d.x, d.y]; }
  }
  return Math.random() < .7 ? pick(spots) : pick(walkableIn('town')).map(v => v + .5);
}
// called when a townsperson reaches the end of its walk: step through a door if that was the plan
function folkArrive(n) {
  if (n.goingIn) {
    const room = ROOM[n.goingIn.to]; n.goingIn = null;
    if (!room) return false;
    n.x = room.spawn.x; n.y = room.spawn.y; n.area = room.id; n.inside = { room, left: 1 + Math.floor(Math.random() * 3) }; n.wait = rnd(1, 3);
    return true;
  }
  if (n.leaving) {
    const room = n.inside?.room; n.leaving = false; n.inside = null;
    if (!room) return false;
    n.x = room.outside.x; n.y = room.outside.y; n.area = 'town'; n.wait = rnd(2, 5);
    return true;
  }
  return false;
}
// ------------------------------------------------------------------ AI players
// 3–6 make-believe townspeople who behave like players: they come and go, walk to a job's staff to apply,
// go to work, fish, shop, take a break, chat (and answer when you talk to them). They show up as ordinary
// online players everywhere (roster, map, online count, profiles); they just never trade or take calls.
const BOT_NAMES = ['มิ้นท์ตี้', 'BossKung', 'น้องพลอย', 'ต้นกล้า99', 'JayZ_TH', 'ปลาทูน่า', 'KaiJeaw', 'แพรวา', 'NongBam', 'อาร์มแกร่ง', 'Fern.ny', 'บอสหนุ่ม',
  'PimPim', 'โอ๊ตคุง', 'MaxPower', 'จุ๊บแจง', 'Toey_Nara', 'เก่งกาจ', 'บีมมี่', 'Kanomtom', 'ไอซ์ซี่', 'Nutty_99', 'ฟ้าใส', 'GolfGG'];
const BOT_SAY = {
  any: ['มีใครว่างบ้าง', 'วันนี้เงินเข้าดีมาก 555', 'เหนื่อยจัง', 'ใครรู้ที่ตกปลาดีๆ บ้าง', 'หิวแล้วอะ', 'เดินหลงอีกแล้ว 😅', 'สวัสดีทุกคน', 'เมืองนี้น่าอยู่ดี', 'ใกล้จะเลเวลอัปแล้ว!', 'ใครอยู่แถวนี้บ้าง'],
  none: ['หางานอยู่ มีงานไหนดีบ้าง', 'ว่างงานอะ ไปสมัครงานก่อนดีกว่า'],
  rider: ['ส่งของรอบที่สิบแล้ว 🛵', 'ทิปวันนี้ดีมาก'], farmer: ['ผักโตไวมากวันนี้', 'เดี๋ยวไปรดน้ำผักก่อน'], merchant: ['ของราคาส่งขึ้นอีกแล้ว', 'ใครอยากซื้อของบ้าง ราคาดี'],
  chef: ['ทำต้มยำขายดีมาก', 'วัตถุดิบหมดอีกแล้ว'], doctor: ['ใครป่วยมาหาหมอได้นะ', 'เวรวันนี้ยาวมาก'], police: [ 'ลาดตระเวนอยู่ 👮'],
  office: ['ประชุมอีกแล้ว', 'เงินเดือนออกพอดี'], beggar: ['ขอเศษเงินหน่อยครับ 🙏', 'วันนี้ได้นิดเดียวเอง'],
};
const BOT_REPLY = [
  [/สวัสดี|หวัดดี|ดีจ้า|hello|hi\b|ทัก/i, ['สวัสดีครับ 😄', 'หวัดดีจ้า', 'ดีครับบ', 'ทักทายย 👋']],
  [/งาน|สมัคร|อาชีพ/, ['ไปคุยกับเจ้าหน้าที่ตามตึกได้เลย', 'ไรเดอร์เงินดีนะ แต่ต้องมีใบขับขี่', 'ลองเป็นชาวไร่ดู ไม่ต้องมีวุฒิ']],
  [/เงิน|รวย|จน/, ['ตกปลาขายก็ได้เงินนะ', 'ทำงานไปเรื่อยๆ เดี๋ยวก็รวย 555', 'จนเหมือนกัน 😭']],
  [/ปลา|ตก/, ['ท่าตกปลาริมทะเลได้ปลาใหญ่', 'ทุ่นจมแล้วค่อยตวัดนะ']],
  [/หิว|กิน|ข้าว/, ['ร้านอาหารอยู่ใจกลางเมือง', 'ไปกินด้วยกันมั้ย']],
  [/เพื่อน|แอด/, ['ได้เลย 😊', 'ยินดีที่ได้รู้จักนะ']],
  [/555|ฮา|lol/i, ['555+', 'ขำ 😂']],
  [/บาย|ไปก่อน|bye/i, ['บายย 👋', 'ไว้เจอกันใหม่']],
];
const BOT_DEFAULT = ['อืมๆ', 'จริงด้วย', 'ใช่ๆ', 'โอเคเลย 👍', 'งั้นเหรอ', '😄'];
const BOT_JOBS = Object.keys(D.CAREERS).filter(k => k !== 'none' && ST['staff_' + k] && (D.AREAS.find(r => r.id === ST['staff_' + k].area)?.kind === 'room' || ST['staff_' + k].area === 'town'));
let botSeq = 0, botEventAt = now() + 60000, botWorldAt = now() + 90000;
const bots = () => npcs.filter(n => n.bot);
const botById = id => npcs.find(n => n.bot && n.id === id);
// nearest free tile to a point inside an area (somewhere a bot can stand)
function standNear(area, x, y) {
  let best = null, bd = 1e9;
  for (const [tx, ty] of walkableIn(area)) { const d = Math.hypot(tx + .5 - x, ty + .5 - y); if (d < bd && d > .6) { bd = d; best = [tx + .5, ty + .5]; } }
  return best;
}
const stepAt = (st, d, stay, say) => { const s = ST[st]; if (!s) return null; const p = standNear(s.area, s.x, s.y + .8); return p && { area: s.area, x: p[0], y: p[1], d, stay, say, st }; };
// what a bot does next: get a job first, then mostly work, with breaks for fishing, shopping and hanging around
function botPlan(n) {
  const b = n.bot, plan = [];
  if (n.c === 'none' || Math.random() < .04) {
    const job = pick(BOT_JOBS.filter(j => j !== n.c));
    const s = job && stepAt('staff_' + job, 'apply', rnd(3, 6)); if (s) { s.job = job; plan.push(s); }
  }
  const r = Math.random(), work = D.CAREERS[plan[0]?.job || n.c]?.where;
  if (work && r < .55) { const s = stepAt(work, 'work', rnd(40, 110)); if (s) plan.push(s); }
  else if (r < .72) { const s = stepAt(pick(['pier_l1', 'pier_l2', 'pier_s1', 'pier_s2']), 'fish', rnd(30, 70)); if (s) plan.push(s); }
  else if (r < .9) {
    const d = pick(PUBLIC_DOORS.filter(s => buildingOpen(s.bld)));
    const rm = d && ROOM[d.to], w = rm && walkableIn(rm.id); if (w?.length) { const [x, y] = pick(w); plan.push({ area: rm.id, x: x + .5, y: y + .5, d: 'shop', stay: rnd(8, 20) }); }
  }
  if (!plan.length) { const [x, y] = pick(walkableIn('town')); plan.push({ area: 'town', x: x + .5, y: y + .5, d: 'idle', stay: rnd(5, 15) }); }
  b.plan = plan;
}
function botNext(n) {
  const b = n.bot; if (!b.plan.length) botPlan(n);
  const s = b.plan[0];
  if (n.area === s.area) return [s.x, s.y];
  if (n.inside) { n.leaving = true; return [n.inside.room.exit.x, n.inside.room.exit.y]; }
  const door = PUBLIC_DOORS.find(d => d.to === s.area && buildingOpen(d.bld));
  if (!door) { b.plan.shift(); return null; }
  n.goingIn = door; return [door.x, door.y];
}
// reached the end of a walk: if it was the plan's spot, do the thing there and stay a while
function botArrive(n) {
  const b = n.bot, s = b.plan[0];
  if (!s || n.area !== s.area || Math.hypot(n.x - s.x, n.y - s.y) > 1) return .4;
  b.plan.shift();
  if (s.d === 'apply') { n.c = s.job; b.xp = 0; b.lv = 1; botSay(n, pick([`สมัครเป็น${D.CAREERS[s.job].name}แล้ว!`, `ได้งาน${D.CAREERS[s.job].name}แล้ว เย้`, 'สมัครงานเรียบร้อย'])); npcRosterDirty = true; }
  if (s.d === 'work' || s.d === 'fish') b.busy = { d: s.d, until: now() + s.stay * 1000 };
  return s.stay;
}
const BOTS_TALK = false;   // AI players keep quiet: no chat lines, no replies, no join/leave greetings in chat
function botSay(n, text) {
  if (!BOTS_TALK) return;
  const msg = { t: 'chat', id: n.id, name: n.name, c: n.c, text, ts: now() };
  for (const o of online.values()) if (areaId(o) === n.area && dist(o, n) <= 14) send(o, msg);
}
function botJoin(quiet) {
  const used = new Set(bots().map(n => n.name)), free = BOT_NAMES.filter(x => !used.has(x)), name = pick(free.length ? free : BOT_NAMES);
  if (!name) return;
  const sp = standNear('town', D.SPAWN.x + rnd(-3, 3), D.SPAWN.y + rnd(-2, 2)) || [D.SPAWN.x, D.SPAWN.y];
  const g = Math.random() < .5 ? 'f' : 'm', lv = rint(1, 9);
  const n = { id: -(500 + botSeq++), bot: { plan: [], xp: rnd(0, 1), lv, days: rint(1, 40), worth: rint(800, 25000), fishLv: rint(1, 6), title: Math.random() < .5 ? pick(D.ACHIEVEMENTS.filter(x => x.r <= 2)) : null },
    name, area: 'town', x: sp[0], y: sp[1], f: 6, path: [], wait: rnd(1, 3), g, look: randLook(), speed: rnd(1.5, 2.1), pickedAt: 0,
    c: Math.random() < .5 ? 'none' : pick(BOT_JOBS) };
  if (n.c === 'none') n.bot.lv = 1;
  n.next = () => botNext(n); n.stay = () => botArrive(n);
  npcs.push(n); npcRosterDirty = true;
  if (!quiet) feed(`👋 ${name} เข้าเมือง`);
}
function botLeave(n, quiet) {
  const i = npcs.indexOf(n); if (i < 0) return;
  npcs.splice(i, 1); npcRosterDirty = true; if (!quiet) feed(`🚪 ${n.name} ออกจากเมือง`);
}
// every so often someone logs off or a new one arrives, keeping 3–6 around; bots level up and chat
let botLastT = now();
function botTick(t) {
  const dt = Math.min(2, (t - botLastT) / 1000); botLastT = t;
  for (const n of bots()) {
    const b = n.bot;
    if (b.busy && t > b.busy.until) b.busy = null;
    if (b.busy?.d === 'work' && n.c !== 'none' && Math.random() < dt / 60) {                 // about one bit of work a minute, levels slow down like a player's
      b.xp += 1 / (4 + 1.5 * (b.lv - 1));
      if (b.xp >= 1) { b.xp = 0; b.lv++; npcRosterDirty = true; if (Math.random() < .5) botSay(n, pick(['เลเวลอัปแล้ว! 🎉', `Lv.${b.lv} แล้ว เย้`, 'อัปเลเวลอีกแล้ว 😆'])); }
    }
    if (Math.random() < dt / 150) botSay(n, pick(Math.random() < .5 ? BOT_SAY.any : BOT_SAY[n.c] || BOT_SAY.any));
  }
  if (t > botWorldAt) {
    botWorldAt = t + rnd(120, 300) * 1000;
    const n = pick(bots());
    if (BOTS_TALK && n && online.size) { const wm = { t: 'chat', w: 1, id: n.id, name: n.name, c: n.c, text: pick([...BOT_SAY.any, ...(BOT_SAY[n.c] || [])]), ts: now() }; chatLog.push(wm); if (chatLog.length > 40) chatLog.shift(); broadcast(wm); }
  }
  if (t > botEventAt) {
    botEventAt = t + rnd(150, 420) * 1000;
    // the AI townsfolk are being retired: one slips away now and then (never right next to a player, no message), none come back
    const away = bots().filter(n => !n.inside && ![...online.values()].some(o => areaId(o) === n.area && dist(o, n) < 16));
    if (away.length) { botLeave(pick(away), true); botCap = bots().length; bugsDirty = true; dirty = true; }
  }
}
// a player said something near a bot (or named it in world chat): it answers after a moment, like a person typing
function botHear(a, text, world) {
  if (!BOTS_TALK) return;
  const cand = world ? bots().filter(n => text.includes(n.name)) : bots().filter(n => n.area === areaId(a) && dist(n, a) <= 8);
  const n = pick(cand); if (!n || n.bot.replyAt > now() || (!world && Math.random() < .35)) return;
  n.bot.replyAt = now() + 6000;
  const hit = BOT_REPLY.find(([re]) => re.test(text)), line = pick(hit ? hit[1] : BOT_DEFAULT);
  setTimeout(() => {
    if (!npcs.includes(n)) return;
    if (world) { const wm = { t: 'chat', w: 1, id: n.id, name: n.name, c: n.c, text: `@${a.name} ${line}`, ts: now() }; chatLog.push(wm); if (chatLog.length > 40) chatLog.shift(); broadcast(wm); }
    else botSay(n, line);
  }, rnd(1500, 4000));
}
const botPub = n => ({ id: n.id, name: n.name, av: 0, c: n.c, lv: n.bot.lv, dz: [], pose: null, title: n.bot.title?.title || '', tr: n.bot.title?.r || 0, pic: 0, w: 0, sad: 0, g: n.g, lk: n.look, adm: 0,
  of: D.CAREERS[n.c]?.where ? n.c : '', th: 0, afk: 0, x: n.x, y: n.y, f: n.f });

// worker NPCs: where they walk and what they do there (only while no player has that job)
const ST_XY = id => { const s = ST[id]; return s ? [s.x, s.y] : null; };
const roomPts = (rid, pts) => { const r = ROOM[rid]; return pts.map(([dx, dy]) => [r.x + dx, r.y + dy]).filter(([x, y]) => !D.blocked(x, y)); };
const WORKERS = [
  { career: 'office', name: 'คุณเก่ง (พนักงาน)', area: 'r_office', look: { hair: 'black', shirt: 'white', pants: 'black' },
    pts: () => D.STATIONS.filter(s => s.type === 'chair' && !chairs[s.idx]).map(s => [s.x, s.y]), pose: () => (hourNow() >= D.SHIFT.start && hourNow() < D.SHIFT.end ? 'chair' : null), stay: () => rnd(40, 90) },
  { career: 'merchant', name: 'เจ๊หมวย (แม่ค้า)', area: 'town', pts: () => { const m = ST.market; return [[m.x - 2.4, m.y], [m.x + 2.4, m.y], [m.x - 1.2, m.y + .3], [m.x + 1.2, m.y + .3]].filter(([x, y]) => !D.blocked(x, y)); }, stay: () => rnd(5, 12) },
  { career: 'doctor', name: 'หมอแนน (แพทย์เวร)', area: 'r_hospital', always: true, pts: () => D.STATIONS.filter(s => s.type === 'bed').map(s => [s.x, s.y + .95]).concat(roomPts('r_hospital', [[5, 5]])).filter(([x, y]) => !D.blocked(x, y)), stay: () => rnd(4, 8), job: npcDoctor },
  { career: 'rider', name: 'พี่บอย (ไรเดอร์)', area: 'town', pts: () => [ST_XY('door_restaurant'), ...D.STATIONS.filter(s => s.type === 'door' && s.area === 'town' && s.house === undefined).map(s => [s.x, s.y + .3])].filter(p => p && !D.blocked(p[0], p[1])), stay: () => rnd(3, 6), speed: 2.4 },
  { career: 'beggar', name: 'ตาผล (ขอทาน)', area: 'town', pts: () => [[53.5, 38.6], [64.5, 33.5], [76.5, 33.5], [27, 33.5]].filter(([x, y]) => !D.blocked(x, y) && ![...online.values()].some(o => Math.hypot(o.x - x, o.y - y) < 1)), pose: () => 'beg', stay: () => rnd(60, 160) },
  { career: 'police', name: 'ดาบชัย (สายตรวจ)', area: 'town', always: true, cop: true, pts: () => D.STATIONS.filter(s => s.area === 'town' && /^(crowd|door)$/.test(s.type) && s.house === undefined).map(s => [s.x, s.y + (s.type === 'door' ? .3 : 0)]).filter(([x, y]) => !D.blocked(x, y)), stay: () => rnd(4, 10), speed: 1.6 },
];
// the restaurant waiter (always there), and police patrols for the farm and the housing estate too
const areaPts = id => walkableIn(id).map(p => [p[0] + .5, p[1] + .5]);
WORKERS.push(
  { career: 'waiter', name: 'น้องฝน (เด็กเสิร์ฟ)', area: 'r_restaurant', always: true, desc: 'เด็กเสิร์ฟร้านอาหาร เดินเสิร์ฟอาหารและเก็บโต๊ะทั้งวัน', look: { hair: 'black', shirt: 'white', pants: 'black' }, pts: () => areaPts('r_restaurant'), stay: () => rnd(1.5, 4), speed: 1.7 },
  { career: 'police', name: 'จ่าแดง (สายตรวจ)', area: 'town', always: true, cop: true, pts: () => areaPts('town').filter(() => Math.random() < .05), stay: () => rnd(4, 10), speed: 1.6 },
  { career: 'police', name: 'ดาบเอก (สายตรวจไร่)', area: 'farm', always: true, cop: true, pts: () => areaPts('farm').filter(() => Math.random() < .08), stay: () => rnd(5, 12), speed: 1.6 },
  { career: 'police', name: 'จ่าต้น (สายตรวจหมู่บ้าน)', area: 'housing', always: true, cop: true, pts: () => areaPts('housing').filter(() => Math.random() < .08), stay: () => rnd(5, 12), speed: 1.6 },
);
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
function npcTick(dt, ps) {
  for (const n of npcs) {
    if (n.worker) {
      const on = workerOn(n);
      if (on !== n.on) { n.on = on; npcRosterDirty = true; if (!on) { n.chase = null; n.pose = null; } }
      if (!on) continue;
      if (n.worker.job && !n.path.length) n.worker.job(n);
    }
    if (n.wait > 0) { n.wait -= dt; if (n.say && Math.random() < dt / 20) n.say = null; continue; }
    if (!n.path.length) {
      if (n.pose) { n.pose = null; npcRosterDirty = true; }
      const goal = n.next(); n.path = goal ? routeTo(n, goal, n.area) || [] : [];
      if (!n.path.length && (n.folk || n.bot)) { n.goingIn = null; if (n.leaving) folkArrive(n); else if (n.bot && goal) n.bot.plan.shift(); }   // could not reach the door: give up (or just step outside)
      n.wait = n.path.length ? 0 : 2; if (!n.path.length) continue;
    }
    const [tx, ty] = n.path[0], dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy), st = n.speed * dt;
    if (d <= st) {
      n.x = tx; n.y = ty; n.path.shift();
      if (!n.path.length && (n.folk || n.bot) && folkArrive(n)) { ps.push([n.id, +n.x.toFixed(2), +n.y.toFixed(2), n.f]); continue; }
      if (!n.path.length && !n.chase) { n.wait = n.stay(); const pose = n.worker?.pose?.(); if (pose) { n.pose = pose; n.f = 6; npcRosterDirty = true; } }
    } else { n.x += dx / d * st; n.y += dy / d * st; }
    if (d > 0.01) n.f = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))) % 8;
    ps.push([n.id, +n.x.toFixed(2), +n.y.toFixed(2), n.f]);
  }
  if (npcRosterDirty) { npcRosterDirty = false; sendRoster(); }
  // now and then a villager near someone says something (bubble over their head)
  if (Math.random() < dt / 40) {
    const n = pick(npcs.filter(x => x.folk)), near = [...online.values()].filter(o => areaId(o) === n.area && dist(o, n) <= 14);
    if (near.length) { const msg = { t: 'chat', id: n.id, name: n.name, text: pick(D.NPC_LINES), ts: now(), npc: 1 }; near.forEach(o => send(o, msg)); }
  }
}
const npcVisible = n => !n.worker || n.on;
const npcInfo = n => n.bot ? botPub(n) : n.zb ? ({ id: n.id, npc: 1, zb: n.zb, name: n.name, c: 'none', lv: 1, dz: [], pose: null, x: n.x, y: n.y, f: n.f, title: '' }) : ({ id: n.id, npc: 1, name: n.name, c: n.c || 'none', lv: 1, dz: [], pose: n.pose || null, g: n.g, lk: n.look, face: n.face, x: n.x, y: n.y, f: n.f, title: '',
  of: n.c && D.CAREERS[n.c] ? n.c : '', wk: n.worker ? 1 : 0, desc: n.worker?.desc || '' });
// what you are wearing: a reward outfit you picked, else your job's clothes (unless hidden)
function outfitOf(a) {
  if (a.god?.cloak && isAdmin(a)) return 'admin';           // admin-only cloak + aura (god mode)
  if (a.outfit && (a.outfits || []).includes(a.outfit)) return a.outfit;
  if (!a.hideJob && D.CAREERS[a.career]?.where) return a.career;
  return '';
}
function frameOf(a) { const f = D.FRAMES[a.frame]; return f && ((a.frames || []).includes(f.id) || f.locked && isAdmin(a)) ? f.id : -1; }
function pubInfo(a) {
  return { id: a.id, name: a.name, av: a.avatar, c: a.career, lv: lvl(a), dz: (a.dz || []).map(d => DZ[d].icon),
    pose: a.down ? a.down.kind : a.pose, title: titleOf(a), tr: titleRar(a), pic: a.pic ? 1 : 0, sad: depressed(a) ? 1 : 0, g: a.gender, lk: a.look, adm: isAdmin(a) ? 1 : 0,
    of: outfitOf(a), afk: a.afk ? 1 : 0, fn: a.fun ? `${a.fun.k}:${a.fun.slot}` : '', veh: a.ride || '', ps: a.pass || 0, pt: a.pet && (a.pets || []).includes(a.pet) ? a.pet : '', pn: a.pet ? a.pnames?.[a.pet] || '' : '', pl: a.leash && a.leashOn ? 1 : 0, fc: castPub(a), gg: (() => { const g = gangOf(a); return g ? [g.icon, g.name, g.color] : 0; })() };
}
// others see you fishing: 1 waiting, 2 a bite, 3 fighting a fish
const castPub = a => a.cast ? ({ wait: 1, bite: 2, fight: 3 })[a.cast.state] || 1 : 0;
function sendRoster() {
  const all = [...online.values()].map(a => ({ ...pubInfo(a), x: a.x, y: a.y, f: a.f, _h: hidden(a) })), npc = npcs.filter(npcVisible).map(npcInfo);
  const pub = JSON.stringify({ t: 'roster', players: all.filter(p => !p._h).concat(npc) });
  for (const o of online.values()) {
    if (o.ws.readyState !== 1) continue;
    if (hidden(o)) o.ws.send(JSON.stringify({ t: 'roster', players: all.filter(p => !p._h || p.id === o.id).concat(npc) }));   // you still see yourself
    else o.ws.send(pub);
  }
}
function jobView(a) {
  const c = a.career; if (!c || c === 'none') return null;
  if (c === 'office') { const x = a.xp.office || 0; return { L: lvl(a), cur: x % 3, need: 3, gain: 100, pay: 0 }; }
  const j = jobXp(a.xp[c] || 0); return { L: j.L, cur: +j.cur.toFixed(2), need: j.need, gain: Math.round(xpGain(j.L) * 100), pay: Math.round((jobPay(a) - 1) * 100), max: j.L >= JOB_MAX ? 1 : 0 };
}
function meView(a) {
  const isRider = a.career === 'rider' || allJobs(a);
  const myOrders = [...orders.values()].filter(o => o.cust === a).map(orderView);
  const jobs = isRider ? [...orders.values()].filter(o => o.state === 'open' || o.rider === a).map(o => ({ ...orderView(o), mine: o.rider === a, custId: o.cust?.id || 0 })) : [];
  return {
    t: 'me', gang: gangView(a), id: a.id, name: a.name, avatar: a.avatar, x: +a.x.toFixed(2), y: +a.y.toFixed(2), money: Math.round(a.money), energy: a.energy, hunger: a.hunger, health: a.health,
    career: a.career, licenses: a.licenses, lv: lvl(a), xp: a.xp, jx: jobView(a), inv: a.inv, phone: a.phone, contacts: a.contacts || [],
    tools: a.tools, gems: a.gems || 0, gemInf: godInf(a) ? 1 : 0, monInf: godInf(a) ? 1 : 0, vehicles: a.vehicles || [], ride: a.ride || '', pass: a.pass || 0, gmail: a.gsub ? a.gmail || 'linked' : '', hown: a.hown || null, bless: a.bless || 0, alms: a.alms ? { pts: a.alms.pts, got: a.alms.got } : null, almsDay: a.almsDay ?? -1, adLeft: ADS_GAME ? Math.max(0, ADS.daily - (a.adDay === new Date(now() + 7 * 3600e3).toISOString().slice(0, 10) ? a.adN || 0 : 0)) : 0, house: a.house, furniture: a.furniture, hlv: a.hlv || 0, fpos: a.fpos || {}, yz: a.yz || [], wstock: a.career === 'merchant' ? wstockView(a) : null, stocks: a.stocks || {}, docjob: a.docjob ? { dest: a.docjob.dest, pay: a.docjob.pay } : null, npcp: tradePrices(a), comfort: comfort(a), speed: speedOf(a), speedBase: dzProd(a, 'speed') * godSpeed(a), rent: a.rent, houseSale: a.houseSale, houseRent: a.houseRent,
    bank: Math.floor(a.bank), loan: Math.ceil(a.loan), listings: a.listings || [], dz: a.dz || [], awake: Math.floor(a.awake || 0), bed: a.bed ?? -1, chair: a.chair,
    pose: a.pose, down: a.down, cast: a.cast ? { state: a.cast.state, x: a.cast.x, y: a.cast.y, fight: a.cast.state === 'fight' ? a.cast.fight : null } : null, garden: a.garden, enrolled: a.enrolled, classes: a.classes || 0,
    office: a.office ? { n: a.office.n || 0, strikes: a.office.strikes, day: a.office.day, late: a.office.late, hours: +(a.office.hours || 0).toFixed(2), closed: a.office.closed } : null,
    gender: a.gender, look: a.look, wardrobe: a.wardrobe, admin: isAdmin(a), god: isAdmin(a) ? (a.god || {}) : null,
    run: !!a.run, rod: a.rod || 0, fishLv: fishLv(a), fishXp: a.xp?.fisher || 0, hideJob: !!a.hideJob, outfit: a.outfit || '', pets: a.pets || [], pet: a.pet || '', pnames: a.pnames || {}, leash: a.leash ? 1 : 0, leashOn: a.leashOn ? 1 : 0, leashPrice: PET_LEASH, frames: a.frames || [], frame: frameOf(a), rods: a.rods || [], rodEq: rodOf(a) ? (a.rods.includes(a.rodEq) ? a.rodEq : a.rods[0]) : '', outfits: a.outfits || [], fishdex: a.fishdex || {}, wearing: outfitOf(a),
    licExp: a.licExp || {}, desk: a.desk ?? -1, study: a.school ? +(a.school.p || 0).toFixed(3) : 0,
    mis: misView(a), misNext: a.misNext || 0, rival: a.rival ? { x: a.rival.x, y: a.rival.y, name: a.rival.name, until: a.rival.until, lv: a.rival.lv } : null, rb: a.rb ? 1 : 0,
    auc: a.auc ? { stage: a.auc.stage, name: a.auc.name, icon: a.auc.icon, items: a.auc.items, cond: a.auc.cond, lo: a.auc.lo, hi: a.auc.hi, until: a.auc.until, my: a.auc.my, bots: a.auc.bots.map(b => ({ name: b.name, style: b.style, sent: !!b.sent })), real: a.auc.stage === 'done' ? a.auc.real : null, result: a.auc.result || null, win: a.auc.win || null, net: a.auc.net ?? null } : null, aucNext: a.aucNext || 0,
    cook: a.cook ? { rid: a.cook.rid, hand: a.cook.hand, plated: a.cook.plated, until: a.cook.until, limit: a.cook.limit, comps: a.cook.comps.map(c => ({ ing: c.ing, ops: c.ops, k: c.k, at: c.at, t: c.t, prog: c.prog, ready: c.ready, burnt: c.burnt })) } : null,
    dogq: a.dogq ? { kind: a.dogq.kind || 'dog', stole: a.dogq.stole, dog: a.dogq.dog, name: a.dogq.name, owner: a.dogq.owner, x: a.dogq.x, y: a.dogq.y, t0: a.dogq.t0, until: a.dogq.until, hint: a.dogq.hint, hc: a.dogq.hc } : null, dogNext: a.dogNext || 0, thiefNext: a.thiefNext || 0, jgNext: a.jgNext || {},
    icu: null, icuNext: a.icuNext || 0,
    friends: (a.contacts || []).map(c => { const o = byPhone.get(c.p); return { p: c.p, fav: c.fav ? 1 : 0, n: o ? o.name : c.n, home: o && o.ws && o.hown ? (friendOf(o, a) ? 1 : 2) : 0, on: !!(o && o.ws && !hidden(o)), afk: !!(o && o.afk), where: o && o.ws ? (D.areaAt(o.x, o.y)?.name || D.areaAt(o.x, o.y)?.label || '') : '' }; }),
    happy: a.happy, craving: a.craving, bills: a.bills || [], utilOff: !!a.utilOff, home: holdsHome(a), date: D.dateAt(now()), month: D.monthIdx(now()),
    mailN: (a.mail || []).filter(x => !x.read).length, hasPic: a.pic ? 1 : 0, taxT: a.tax?.d === dayKey() ? { e: a.tax.e, paid: a.tax.paid } : null, fuelT: a.fuelDay?.d === dayKey() ? a.fuelDay.c : 0, econ: econView(),
    jobWait: jobCooldown(a), stats: a.stats || {}, ach: a.ach || [], luxT: a.luxT || [], title: a.title || '', myOrders, jobs,
    earned: a.earned, worth: Math.round(worth(a)), quests: Q.view(a), wquests: Q.wview(a), login: loginView(a), keep: a.keep || [], hfl: a.hfl || [], hwl: a.hwl || [], achGot: a.achGot || [], achReward: ACH_GEMS,
  };
}
function worldView() {
  const t = now();
  const lb = [...accounts.values()].filter(a => !isAdmin(a)).map(a => ({ name: a.name, av: a.avatar, c: a.career, w: Math.round(worth(a)), on: !!a.ws && !hidden(a), ti: titleOf(a) }))
    .concat((ghostLook(), ghosts).map(g => ({ name: g.n, c: g.c, w: Math.round(g.w), on: 0, ti: ghostTi(g) })))
    .sort((x, y) => y.w - x.w).slice(0, 10);
  return {
    t: 'wd', now: t, toff: D.TIME_OFF, ann: announceText, on: [...online.values()].filter(o => !hidden(o)).length + bots().length, mk: marketView(),
    stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k, Math.floor(v)])),
    lots: lots.map(o => o && o.garden ? [o.name, o.garden.n, o.garden.crops.map(c => c ? [c[0], c[1]] : 0), o.id || 0] : 0),
    beds: beds.map(p => p ? [p.name, p.id, p.dz.length ? DZ[p.dz[0]].sym : [], Math.floor(p.health), p.dz.length, p.npc ? 1 : 0, p.down ? 1 : 0] : 0),
    houses: houses.map((h, i) => [h ? h.name : '', h ? comfort(h) : 0, h ? furnOf(h).slice(0, 150) : [], h ? h.houseSale || 0 : 0, h ? h.houseRent || 0 : 0, tenants[i] ? tenants[i].name : '', tenants[i] ? tenants[i].rent.until : 0, h ? h.fpos || {} : {}, h ? h.hlv || 0 : 0, h ? h.yz || [] : [], h ? h.ycrops || {} : {}, h?.hown ? h.hown.style : -1, h?.hown ? h.hown.tier : 0, h ? h.id : 0, h ? h.hdeco || {} : {}]),
    chairs: chairs.map(c => c ? c.name : ''),
    ev: event ? { id: event.id, text: event.text, until: event.until } : null, lb, sk: stockView(),
  };
}
function marketView() {
  const best = {};
  for (const o of accounts.values()) for (const L of o.listings || []) {
    const b = best[L.item] || (best[L.item] = { p: Infinity, n: 0 });
    b.p = Math.min(b.p, L.price); b.n += L.qty;
  }
  const out = {};
  for (const k in D.ITEMS) out[k] = { npc: Math.round(npcBuyPrice({ career: '' }, k)), farm: Math.round(npcBuyPrice({ career: '' }, k, D.ITEMS[k].kind === 'fish' ? FISH_RATE : 0.5)), sell: npcSellPrice(k), ref: Math.round(marketPrice(k)), best: best[k] ? best[k].p : 0, n: best[k] ? best[k].n : 0 };
  return out;
}

// ------------------------------------------------------------------ connection
const byName = n => { n = String(n || '').toLowerCase(); for (const a of accounts.values()) if (a.name.toLowerCase() === n) return a; return null; };
// 🔑 Google sign-in: the browser gets an ID token from Google; we ask Google whether it is genuine and meant for us
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
// 💰 Google AdSense (H5 Games Ads). Off until the owner sets the Fly secret ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX; ADSENSE_TEST=1 shows Google's test ads only.
const ADS_CLIENT = /^ca-pub-\d{10,20}$/.test(process.env.ADSENSE_CLIENT || '') ? process.env.ADSENSE_CLIENT : '', ADS_TEST = process.env.ADSENSE_TEST === '1';
// two switches: ADSENSE_CLIENT alone = the AdSense code on the page + ads.txt, so Google can check and approve the site;
// ADSENSE_GAME=1 as well = the ads inside the game (rewarded app on the phone, full-screen between places), once H5 Games Ads is approved
const ADS_GAME = !!ADS_CLIENT && process.env.ADSENSE_GAME === '1';
const ADS_HEAD = ADS_CLIENT ? `<meta name="google-adsense-account" content="${ADS_CLIENT}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}" crossorigin="anonymous"${ADS_GAME ? ' data-ad-frequency-hint="360s"' : ''}${ADS_TEST ? ' data-adbreak-test="on"' : ''}></script>` : '';
const ADS = { daily: 5, gems: 2, energy: 20, gap: 40000 };   // a rewarded ad: 💎2 + energy, at most 5 a day, 40 s apart
async function googleCheck(cred) {
  if (!GOOGLE_ID || typeof cred !== 'string' || cred.length > 4096) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
    if (!r.ok) return null;
    const j = await r.json();
    if (j.aud !== GOOGLE_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(j.iss) || String(j.email_verified) !== 'true' || +j.exp * 1000 < Date.now()) return null;
    return { sub: String(j.sub), email: String(j.email || '') };
  } catch { return null; }
}
const byGsub = sub => { for (const a of accounts.values()) if (a.gsub === sub) return a; return null; };
async function googleLogin(ws, m) {
  const g = await googleCheck(m.google);
  if (!g) return fail(ws, 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่อีกครั้ง');
  const a = byGsub(g.sub);
  if (!a) return fail(ws, `บัญชี Google (${g.email}) ยังไม่ได้ผูกกับตัวละคร · เข้าเกมด้วย ID/PIN ก่อน แล้วไปที่ ตั้งค่า → ผูกบัญชี Google`);
  if (!a.stok) a.stok = crypto.randomBytes(16).toString('hex');
  return login(ws, { name: a.login }, a);
}
async function googleLink(a, m) {
  if (m.off) { a.gsub = ''; a.gmail = ''; a.stok = ''; markMe(a); dirty = true; return toast(a, 'ยกเลิกการผูกบัญชี Google แล้ว', '🔑'); }
  const g = await googleCheck(m.google);
  if (!g) return toast(a, 'ผูกบัญชี Google ไม่สำเร็จ ลองใหม่อีกครั้ง', '🔑', false);
  const o = byGsub(g.sub); if (o && o !== a) return toast(a, 'บัญชี Google นี้ผูกกับตัวละครอื่นไปแล้ว', '🔑', false);
  a.gsub = g.sub; a.gmail = g.email; a.sd = true; dirty = true; markMe(a);
  toast(a, `ผูกบัญชี Google (${g.email}) แล้ว! ครั้งหน้ากด "เข้าสู่ระบบด้วย Google" ได้เลย ไม่ต้องจำ PIN`, '🔑');
}
function login(ws, m, pre) {
  if (m.google && !pre) { googleLogin(ws, m); return; }
  if (!pre && m.tok && typeof m.tok === 'string') {          // the session key a Google sign-in left on this device
    const t0 = accounts.get(cleanText(m.name, 16).toLowerCase());
    if (t0 && t0.stok && t0.gsub && t0.stok === m.tok) pre = t0; else return fail(ws, 'การเข้าสู่ระบบหมดอายุ กด "เข้าสู่ระบบด้วย Google" อีกครั้ง');
  }
  // m.name is the login ID; the character's display name (a.name) is chosen once at creation
  const name = pre ? pre.login : cleanText(m.name, 16);
  if (!accounts.has(name.toLowerCase())) {     // new IDs: English letters and digits only (older Thai IDs still log in)
    if (/[^\x20-\x7e]/.test(name)) return fail(ws, 'ID ใช้ได้เฉพาะภาษาอังกฤษและตัวเลขเท่านั้น (A-Z, 0-9, _ - .)');
    if (!/^[A-Za-z0-9_.-]{2,16}$/.test(name)) return fail(ws, 'ID ต้องยาว 2-16 ตัว ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข และ _ - . (ห้ามเว้นวรรค)');
  }
  const pin = String(m.pin ?? '');
  if (!pre && !/^\d{4,8}$/.test(pin)) return fail(ws, 'PIN ต้องเป็นตัวเลข 4-8 หลัก');
  const lname = name.toLowerCase(), t = now();
  const lock = loginFails.get('n:' + lname), ipLock = loginFails.get('i:' + ws.ip);
  if (!pre && lock && lock.until > t) return fail(ws, `ใส่ PIN ผิดหลายครั้ง ลองใหม่ในอีก ${Math.ceil((lock.until - t) / 60000)} นาที`);
  if (!pre && ipLock && ipLock.until > t) return fail(ws, `ลองเข้าสู่ระบบผิดบ่อยเกินไป ลองใหม่ในอีก ${Math.ceil((ipLock.until - t) / 60000)} นาที`);
  let a = pre || accounts.get(lname), isNew = false;
  if (a) {
    if (!pre && hashPin(pin, a.salt) !== a.hash) {
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
  Q.ensure(a); santaGift(a);
  if (a.career && a.career !== 'none' && !D.CAREERS[a.career]) {   // a career that has been closed
    const was = a.career; a.career = 'none'; a.cook = null;
    const msg = was === 'farmer' ? 'อาชีพเกษตรกรปิดแล้ว คุณกลับมาว่างงาน เลือกอาชีพใหม่ได้เลย · ตอนนี้ทุกคนปลูกผักในสวนบ้านได้ (ร้านเฟอร์นิเจอร์ › สวน › แปลงดิน) 🌱'
      : 'อาชีพเชฟปิดแล้ว คุณกลับมาว่างงาน เลือกอาชีพใหม่ได้เลย · ที่ครัวใหญ่มีเกมหั่นผักผลไม้ให้ทุกคนเล่นหาเงินแทน 🔪';
    setTimeout(() => a.ws === ws && toast(a, msg, was === 'farmer' ? '🌱' : '🍳'), 4000);
  }
  if (a.garden && !D.CAREERS.farmer) {     // farmers' plots at the (closed) farm: refunded in full
    const g = a.garden, back = D.GARDEN.lotPrice + D.GARDEN.expand.slice(0, g.n).reduce((x, y) => x + y, 0);
    if (lots[g.lot] === a || lots[g.lot]?.name === a.name) lots[g.lot] = null;
    a.garden = null; a.money += back; a.sd = true;
    setTimeout(() => a.ws === ws && toast(a, `ไร่ชานเมืองปิดแล้ว คืนค่าสวนของคุณเต็มจำนวน ${money(back)} 💰`, '🌾'), 6000);
  }
  const daily = dailyLogin(a);
  ledSweep(a, '📬 ตอนออฟไลน์ (เช่น ของในตลาดขายได้)'); a.ws = ws; ws.acct = a; a.id = nextId++; a.lastPosT = now(); a.moved = true; a.loginAt = now();
  if (!D.areaAt(a.x, a.y) || D.blocked(a.x, a.y)) { a.x = D.SPAWN.x; a.y = D.SPAWN.y; }
  { const ar = D.areaAt(a.x, a.y); if (ar?.yard || ar?.rk === 'house') { const g = D.GATES.housing_in; a.x = g.x; a.y = g.y; a.wakeHome = 1; } }   // homes move between plots: wake up on the village street
  if (D.areaAt(a.x, a.y)?.id === 'farm' && !isAdmin(a)) { const g = D.GATES.town_from_farm; a.x = g.x; a.y = g.y; }   // the farm is closed for renovation: back to the town gate
  if (a.down && a.down.kind === 'hosp') { a.down = null; a.health = Math.max(a.health, 25); a.x = ROOM.r_hospital.spawn.x; a.y = ROOM.r_hospital.spawn.y; }
  a.afk = false; a.fixId = 0; a.mvb = moveCap(a);
  online.set(a.id, a);
  dirty = true;
  setTimeout(() => a.ws === ws && billUp(a), 1500);
  send(a, {
    t: 'init', id: a.id, relog: pre && a.stok ? { name: a.login, tok: a.stok } : null, gid: GOOGLE_ID,
    map: { w: D.W, h: D.H, tiles: D.TILES, buildings: D.BUILDINGS }, stations: D.STATIONS.filter(s => s.type !== 'fishspot'), areas: D.AREAS, looks: D.LOOKS, shirts: D.SHIRTS, solid: D.SOLID,
    items: D.ITEMS, cats: D.CATEGORIES, crops: D.CROPS, recipes: D.RECIPES, cook: D.COOK, careers: D.CAREERS, licenses: D.LICENSES,
    titles: D.OFFICE_TITLES, wages: D.OFFICE_WAGE, speed: SPEED, clock: D.CLOCK, run: D.RUN, build: BUILD, fishing: D.FISHING, rides: D.RIDES, pool: D.POOL, pshop: D.PSHOP, energyMul: D.ENERGY_MUL, ads: ADS_GAME ? { client: ADS_CLIENT, test: ADS_TEST ? 1 : 0, daily: ADS.daily, gems: ADS.gems, energy: ADS.energy } : null, tshop: D.TSHOP, templeq: { pray: D.TEMPLEQ.pray }, homeTiers: D.HOME_TIERS, homeStyles: D.HOME_STYLES, jobGames: D.JOBGAMES, taxi: { phone: TAXI.phone, base: TAXI.base, perTile: TAXI.perTile, far: TAXI.far, dest: TAXI_DEST }, outfitDefs: D.OUTFITS, doctor: D.DOCTOR, icu: D.ICU, adminName: ADMIN_NAME, adminTitle: ADMIN_TITLE, radius: D.RADIUS, chat: [...chatLog.filter(m => !(m.id < 0)).slice(-25), ...(gangOf(a)?.chat || []).slice(-15)].sort((x, y) => (x.ts || 0) - (y.ts || 0)), isNew, dayMs: D.DAY_MS, hours: D.HOURS, shift: D.SHIFT, months: D.MONTHS, monthDays: D.MONTH_DAYS,
    props: D.PROPS, trees: D.TREES, lotsDef: D.LOTS, garden: D.GARDEN, yard: D.YARD, cstore: D.CSTORE, stocks: D.STOCKS.map(({ id, name, icon, desc }) => ({ id, name, icon, desc })), stockFee: [D.STOCK.fee, D.STOCK.feeMin], diseases: D.DISEASES, treatments: D.TREATMENTS, ach: D.ACHIEVEMENTS, lux: D.LUX_TITLES, fish: D.FISH, fishRarity: D.FISH_RARITY, pets: D.PETS, frameDefs: D.FRAMES, rods: D.RODS, rodOrder: D.ROD_ORDER,
    shop: { vehicles: D.VEHICLES, tools: D.TOOLS, toolPrices: D.TOOL_PRICES, housePrices: D.HOUSE_PRICES, houseRent: D.HOUSE_RENT, furniture: D.FURNITURE, plantIndoor: D.PLANT_INDOOR, hfloors: D.HOME_FLOORS, hwalls: D.HOME_WALLS, floorPrice: D.FLOOR_PRICE, floors: D.HOUSE_FLOORS, bank: D.BANK },
  });
  send(a, meView(a)); send(a, worldView());
  send(a, { t: 'mypic', pic: a.pic || '' }); send(a, { t: 'mail', list: a.mail || [] });
  if (daily) send(a, { t: 'daily', ...daily });
  if (!a.rod && a.career === 'none') setTimeout(() => a.ws === ws && toast(a, `💡 ยังไม่มีเงิน? ซื้อเบ็ด ${money(D.FISHING.rod)} กับน้าเล็กที่สมาคมประมง แล้วตกปลาขาย — วิธีหาเงินที่ง่ายที่สุดสำหรับมือใหม่!`, '🎣'), 6000);
  sendRoster();
  if (!hidden(a)) feed(`👋 ${a.name} เข้าเมือง`);
}
function fail(ws, msg) { try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'loginfail', msg })); } catch { } }

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
// daily bonus grows for 7 days in a row, then keeps rising slowly (+฿10 a day up to ฿500);
// every 30 days you have logged in (in total, a missed day does not reset it) there is a big reward:
// cash plus a piece of gift furniture you can only get this way (cash instead once you own them all)
const loginReward = s => s <= 7 ? LOGIN_BONUS[s - 1] : Math.min(500, 300 + 10 * (s - 7));
const BIG_EVERY = 30, BIG_ITEMS = ['bookcase', 'gclock', 'teddy', 'flamp', 'vase'];
function bigReward(a, n) {        // the n-th big reward (1, 2, ...)
  const item = BIG_ITEMS.find(k => !(a.keep || []).includes(k)) || null;
  return { cash: 3000 + 1000 * Math.min(n - 1, 5) + (item ? 0 : 5000), item };
}
function loginView(a) {
  const days = a.loginDays || 0, s = a.loginStreak || 0, next = BIG_EVERY - (days % BIG_EVERY);
  const nb = bigReward(a, Math.floor(days / BIG_EVERY) + 1);
  return { streak: s, days, today: a.lastLogin === Q.dayKey() ? loginReward(Math.max(1, s)) : 0, tomorrow: loginReward(s + 1), toBig: next === BIG_EVERY && a.lastLogin === Q.dayKey() && days ? BIG_EVERY : next,
    big: { cash: nb.cash, item: nb.item }, table: LOGIN_BONUS, every: BIG_EVERY, keep: a.keep || [] };
}
function dailyLogin(a) {
  const today = Q.dayKey(), yesterday = Q.dayKey(now() - 86400e3);
  if (a.loginDays == null) a.loginDays = a.loginStreak || 0;     // older saves: start the total from the streak
  if (a.lastLogin === today) return null;
  a.loginStreak = a.lastLogin === yesterday ? (a.loginStreak || 0) + 1 : 1;
  a.lastLogin = today; a.loginDays = (a.loginDays || 0) + 1;
  const reward = loginReward(a.loginStreak), gems = a.loginStreak % 7 === 0 ? 10 : 2;
  a.money += reward; a.earned += reward; a.gems = (a.gems || 0) + gems; dirty = true;
  let big = null;
  if (a.loginDays % BIG_EVERY === 0) {
    big = bigReward(a, a.loginDays / BIG_EVERY); a.gems += 50; big.gems = 50;
    a.money += big.cash; a.earned += big.cash;
    if (big.item) a.keep = [...(a.keep || []), big.item];
    setTimeout(() => feed(`🎉 ${a.name} เข้าเกมครบ ${a.loginDays} วัน ได้รางวัลใหญ่${big.item ? ` ${D.FURNITURE[big.item].icon}${D.FURNITURE[big.item].name}` : ''}!`), 2000);
  }
  setTimeout(() => a.ws && stat(a, 'loginDays', a.loginDays, true), 2500);
  return { streak: a.loginStreak, reward, gems, table: LOGIN_BONUS, days: a.loginDays, big, login: loginView(a) };
}
// achievements: each one has a cash reward by rarity, collected from the achievements page
const ACH_GEMS = [0, 5, 7, 10, 12, 15, 15, 20];   // achievements pay 💎 diamonds by rarity (no cash)
function achClaim(a, id) {
  const got = a.achGot || [], todo = (a.ach || []).filter(x => !got.includes(x) && (id === 'all' || x === id));
  if (!todo.length) return toast(a, 'ไม่มีรางวัลให้รับ', '🏅', false);
  let gem = 0;
  for (const x of todo) { const ac = D.ACHIEVEMENTS.find(y => y.id === x); if (ac) gem += ACH_GEMS[ac.r || 1]; }
  a.achGot = [...got, ...todo]; a.gems = (a.gems || 0) + gem; markMe(a); dirty = true;
  toast(a, `รับรางวัลความสำเร็จ ${todo.length} รายการ ได้ 💎${gem}`, '💎');
}

function detach(a) {
  if (!a.id) return;
  if (a.trade) tradeClose(a.trade, `${a.name} ออกจากเกม`);
  if (a.call) endCall(a, 'ออฟไลน์');
  for (const [id, r] of reqs) if (r.from === a || r.to === a) reqs.delete(id);
  for (const o of [...orders.values()]) { if (o.cust === a && o.state === 'open') cancelOrder(o, 'ลูกค้าออฟไลน์'); else if (o.rider === a) { o.state = 'open'; o.rider = null; o.riderName = ''; } }
  standUp(a);
  if (zn?.alive?.delete(a.id)) zn.dead.add(a.id);   // logging off mid-wave does not count as surviving
  online.delete(a.id); a.lastOff = now();
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
  if (a.pass) return;                                       // a passenger goes where the driver goes
  const t = now(), dt = Math.min(4, (t - a.lastPosT) / 1000);
  a.lastPosT = t;
  // budget refills at the player's speed (+35% slack); it can bank ~4 s of walking, so a phone that stalls and then
  // sends a burst of moves is not pulled back to where it was
  a.mvb = Math.min(moveCap(a), (a.mvb ?? moveCap(a)) + SPEED * speedOf(a) * Math.max(runMul(a), a.runT > t - 1500 ? D.RUN.mul : 1) * 1.35 * dt);
  const d = Math.hypot(x - a.x, y - a.y);
  const swim = a.pose === 'fun' && a.fun?.k === 'pool';
  const trapped = d > 0.01 && D.blocked(a.x, a.y, D.RADIUS - 0.04) && !D.blocked(x, y, D.RADIUS - 0.04) && D.areaAt(x, y)?.id === D.areaAt(a.x, a.y)?.id && !swim;   // standing inside a wall margin (a bad seat spot): any step out to open ground is allowed
  if (d > a.mvb + 0.05 || (swim ? !inPoolWater(x, y) : !trapped && !(riding(a)?.fly ? flyClear(a.x, a.y, x, y) : pathClear(a.x, a.y, x, y)) || D.POOL.x0 && nearPool(x, y) && !nearPool(a.x, a.y))) return place(a, a.x, a.y);
  a.mvb -= d;
  if (d > 0.04 && (a.pose || a.chair >= 0 || a.bed >= 0 || a.desk >= 0) && a.fun?.k !== 'bumper' && !swim) standUp(a);   // (bumper cars are driven, swimmers swim: moving keeps you on)
  if (d > 0.04 && a.afk) { a.afk = false; sendRoster(); }
  if (a.run && !godLock(a) && !riding(a)) {               // running burns energy; too tired = back to walking
    a.energy = Math.max(0, a.energy - d * D.RUN.energyPerTile); a.runT = t;
    if (a.energy <= D.RUN.minEnergy) { a.run = false; markMe(a); toast(a, 'เหนื่อยเกินไป วิ่งไม่ไหวแล้ว พักหรือกินอะไรก่อน', '🥵', false); }
  }
  if (x !== a.x || y !== a.y) { fuel(a, Math.hypot(x - a.x, y - a.y)); a.x = x; a.y = y; a.moved = true; dirty = true; a.lastMoveT = t; }
  a.f = clamp(Math.floor(+m.f) || 0, 0, 7);
  if (a.cast && Math.hypot(a.x - a.cast.x, a.y - a.cast.y) > 1.2) { a.cast = null; markMe(a); toast(a, 'เดินออกมา เก็บเบ็ดแล้ว', '🎣', false); }
}
// helicopters fly over buildings and walls, but stay inside the map they are on (same margins as the client)
function flyClear(x0, y0, x1, y1) {
  const A = D.areaAt(x0, y0);
  return !!A && D.areaAt(x1, y1)?.id === A.id && x1 > A.x + .55 && y1 > A.y + .75 && x1 < A.x + A.w - .55 && y1 < A.y + A.h - .35;
}
// the step must not cross a wall (sampled); a tiny radius slack absorbs the client's rounding to 2 decimals
function pathClear(x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2));
  // the client slides along walls one axis at a time; checking with a smaller radius keeps corner cuts legal
  for (let i = 1; i <= n; i++) if (D.blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, i === n ? D.RADIUS - 0.04 : D.RADIUS - 0.12)) return false;
  return D.areaAt(x1, y1)?.id === D.areaAt(x0, y0)?.id;
}

function onMessage(ws, raw) {
  const a = ws.acct; if (a && a.ws === ws) ledSweep(a, 'อื่นๆ');
  onMessage0(ws, raw);
  const b = ws.acct; if (b && b.ledCtx) { ledSweep(b); b.ledCtx = null; }
}
function onMessage0(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const a = ws.acct;
  if (m.t === 'login') { if (!a) login(ws, m); return; }
  if (!a || a.ws !== ws) return;
  godTop(a);
  a.ledCtx = ledLabel(a, m);
  switch (m.t) {
    case 'p': return move(a, m);
    case 'chat': {                          // local chat: only people near you see it (bubble over your head)
      const text = cleanText(m.text, 120); if (!text) return;
      if (isAdmin(a) && /^all(\s|$)/i.test(text)) {   // admin: "all <text>" replaces the ticker notice for everyone, "all" alone restores the CBT notice
        announceText = text.slice(3).trim();
        broadcast({ t: 'announce', text: announceText }); bugsDirty = true; dirty = true;   // kept across restarts
        return toast(a, announceText ? 'ตั้งประกาศแถบด้านบนให้ทุกคนแล้ว' : 'กลับไปใช้ประกาศ CBT เดิมแล้ว', '📢');
      }
      if (m.ch === 'gang') {                  // gang chat: only members read it (orange), kept per gang
        const g = gangOf(a); if (!g) return toast(a, 'คุณยังไม่มีแก๊ง เข้าร่วมหรือตั้งแก๊งได้ในแอป 🏴', '🏴', false);
        if (!cd(a, 'gchat', 1200)) return;
        const gm = { t: 'chat', g: 1, gn: g.name, id: a.id, name: a.name, c: a.career, text, ts: now() };
        g.chat = [...(g.chat || []), gm].slice(-30); gdirty();
        for (const o of online.values()) if (o.gang === g.id && g.mem[lk(o)]) send(o, gm);
        return quest(a, 'chat');
      }
      if (m.ch === 'world') {                 // town-wide chat: everyone reads it in the chat box, no bubble over the head
        if (!cd(a, 'wchat', 3000)) return;
        const wm = { t: 'chat', w: 1, id: a.id, name: a.name, c: a.career, text, ts: now() };
        chatLog.push(wm); if (chatLog.length > 40) chatLog.shift();
        broadcast(wm); return botHear(a, text, true);
      }
      if (!cd(a, 'chat', 800)) return;
      const msg = { t: 'chat', id: a.id, name: a.name, av: a.avatar, c: a.career, text, ts: now() };
      const here = areaId(a);
      let heard = 0;
      for (const o of online.values()) if (areaId(o) === here && dist(o, a) <= 14) { send(o, msg); if (o !== a) heard++; }
      const nb = bots().filter(n => n.area === here && dist(n, a) <= 14).length; heard += nb; botHear(a, text, false);
      if (!heard) toast(a, 'ไม่มีใครอยู่ใกล้พอจะได้ยิน (โทรหาเพื่อนได้ใน 📱)', '💬', false);
      else if (cd(a, 'chatjoy', 20000, true)) joy(a, 2);
      return quest(a, 'chat');
    }
    case 'act': return act(a, m);
    case 'ledger': { ledSweep(a); return send(a, { t: 'ledger', list: (a.ledger || []).slice(-150) }); }
    case 'rename': {                        // the name-change card: 💎10
      if (!cd(a, 'rename', 5000)) return;
      const nm = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
      if (nm.length < 2 || nm.length > 16) return toast(a, 'ชื่อต้องยาว 2–16 ตัวอักษร', '✏️', false);
      if (nm === a.name) return toast(a, 'ชื่อนี้คือชื่อเดิมของคุณ', '✏️', false);
      if ([...accounts.values()].some(o => o !== a && String(o.name).toLowerCase() === nm.toLowerCase()) || ghosts?.some?.(g => String(g.name).toLowerCase() === nm.toLowerCase())) return toast(a, 'ชื่อนี้มีคนใช้แล้ว', '✏️', false);
      const cost = 10; if (!godInf(a) && (a.gems || 0) < cost) return toast(a, `เพชรไม่พอ บัตรเปลี่ยนชื่อใช้ 💎${cost} (มี 💎${a.gems || 0})`, '💎', false);
      if (!godInf(a)) a.gems -= cost;
      const old = a.name; a.name = nm; a.sd = true; dirty = true; markMe(a); sendRoster();
      feed(`✏️ ${old} เปลี่ยนชื่อเป็น ${nm}`);
      return toast(a, `เปลี่ยนชื่อเป็น "${nm}" แล้ว · ใช้ 💎${cost}`, '✏️');
    }
    case 'gang': { if (a.down) return; if (!cd(a, 'gang', 300, true)) return; gangOp(a, m); if (['create', 'accept', 'leave', 'kick', 'disband'].includes(m.op)) sendRoster(); return; }
    case 'visit': { if (a.down) return; const o = byPhone.get(String(m.p || '')); if (!o || !o.ws || !o.hown || hidden(o)) return toast(a, 'เพื่อนคนนี้ไม่ได้ออนไลน์อยู่ หรือยังไม่มีบ้าน', '🏡', false); return goHome(a, o); }
    case 'morder': { if (!cd(a, 'morder', 1500, true)) return; return placeMarketOrder(a, m); }
    case 'mailclaim': return mailClaim(a, m.id);
    case 'refcode': return send(a, { t: 'refcode', code: refCode(a), n: a.refN || 0, paid: a.refPaid || 0, max: REF.max, need: REF.needMin, by: a.refBy ? 1 : 0, canUse: !a.refBy && now() - (a.created || 0) < REF.newHours * 3600e3 ? 1 : 0, gems: REF.gems });
    case 'refuse': { if (!cd(a, 'refuse', 2000, true)) return; refUse(a, m.code); return send(a, { t: 'refcode', code: refCode(a), n: a.refN || 0, paid: a.refPaid || 0, max: REF.max, need: REF.needMin, by: a.refBy ? 1 : 0, canUse: 0, gems: REF.gems }); }
    case 'lotto': { if (!cd(a, 'lotto', 400, true)) return; return lottoOp(a, m); }
    case 'idea': { if (!cd(a, 'idea', 300, true)) return; if (m.op === 'list') return ideaView(a, m.sort); return ideaOp(a, m); }
    case 'mayor': { if (a.down) return; if (!cd(a, 'mayor', 400, true)) return; return mayorOp(a, m); }
    case 'bankop': { if (a.down) return; if (!cd(a, 'bankop', 400, true)) return; if (!['deposit', 'withdraw', 'borrow', 'repay'].includes(m.op)) return; return bankOp(a, { a: m.op, amt: m.amt }); }   // banking from the phone app
    case 'rideoff': { if (a.fun) { rideOff(a); markMe(a); } return; }
    case 'stock': { if (a.down) return; if (!cd(a, 'stock', 400, true)) return; return stockTrade(a, m); }   // trading from the phone app
    case 'npctalk': { const n = npcs.find(x => x.id === m.id); if (n) eggMayor(a, n); return; }

    case 'achclaim': return achClaim(a, String(m.id || 'all'));
    case 'minigame': {                      // (mini-games were removed from the game)
      return;
      const max = { math: 40, mail: 45, memo: 30 }[m.game]; if (!max) return;
      if (a.desk >= 0) {                    // students: just something to break the boredom (a little happiness, no money)
        if (!cd(a, 'minigame', 15000, true)) return;
        const sc = clamp(Math.floor(+m.score) || 0, 0, max); joy(a, sc >= 10 ? 4 : 2);
        return toast(a, `🎮 คะแนน ${sc} · หายเบื่อแล้ว ความสุข +${sc >= 10 ? 4 : 2}`, '🎮');
      }
      if (a.career !== 'office' || !(a.chair >= 0) || !cd(a, 'minigame', 15000, true)) return;
      const sc = clamp(Math.floor(+m.score) || 0, 0, max), day = D.dayAt(now());
      if (a.mgDay !== day) { a.mgDay = day; a.mgPaid = 0; }
      const bonus = Math.min(300 - a.mgPaid, Math.round(sc * 2 * jobPay(a)));
      joy(a, sc >= 10 ? 3 : 1);
      if (bonus > 0) { a.mgPaid += bonus; earn(a, bonus); return toast(a, `🎮 คะแนน ${sc} · โบนัส ${money(bonus)} ความสุข +${sc >= 10 ? 3 : 1}${a.mgPaid >= 300 ? ' (ครบโบนัสวันนี้แล้ว)' : ''}`, '🎮'); }
      return toast(a, `🎮 คะแนน ${sc} · ความสุขเพิ่มขึ้น (โบนัสเงินวันนี้ครบแล้ว)`, '🎮');
    }
    case 'enter': return enterRoom(a, m);
    case 'exit': return exitRoom(a);
    case 'use': return m.item === 'petegg' ? (cd(a, 'use', 600) && hatchEgg(a)) : useItem(a, m.item);
    case 'pet.leash': { if (!a.leash) return toast(a, 'ซื้อสายจูงได้ที่ร้านสัตว์เลี้ยง', '🦮', false); a.leashOn = a.leashOn ? 0 : 1; markMe(a); sendRoster(); return toast(a, a.leashOn ? 'ใส่สายจูงแล้ว' : 'ถอดสายจูงแล้ว', '🦮'); }
    case 'pet.name': {
      if (!(a.pets || []).includes(m.id)) return;
      const nm = cleanText(m.name, 12); if (nm && impersonates(nm)) return toast(a, 'ชื่อนี้ใช้ไม่ได้', '🐾', false);
      a.pnames = { ...(a.pnames || {}) }; if (nm) a.pnames[m.id] = nm; else delete a.pnames[m.id];
      markMe(a); sendRoster(); return toast(a, nm ? `ตั้งชื่อว่า "${nm}" แล้ว` : 'ลบชื่อแล้ว', '🐾');
    }
    case 'pet.call': {                                     // bring one out (or put it away with an empty id)
      if (m.id && !(a.pets || []).includes(m.id)) return;
      a.pet = m.id || ''; markMe(a); sendRoster();
      return toast(a, a.pet ? `เรียก${D.PETS[a.pet].icon}${D.PETS[a.pet].name}ออกมาแล้ว` : 'เก็บสัตว์เลี้ยงแล้ว', '🐾', false);
    }
    case 'rod': {                                          // hold another rod from the bag
      if (!(a.rods || []).includes(m.id) || a.cast) return;
      a.rodEq = m.id; markMe(a); return toast(a, `ถือ${D.RODS[m.id].icon}${D.RODS[m.id].name}แล้ว`, '🎣');
    }
    case 'rest': {
      if (a.down) return;
      if (m.on === false) { if (a.pose === 'rest') { a.pose = null; sendRoster(); markMe(a); } return; }
      standUp(a); a.pose = 'rest'; markMe(a); sendRoster();
      return toast(a, 'นั่งพักหลับตา ช่วยแก้ง่วง · อยากได้พลังงานและเลือดคืน ไปเล่นสวนสนุก 🎡 หรือนอนที่เตียงในบ้าน 🛏️ · เดินเพื่อลุก', '😌');
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
    case 'unstick': {                         // the client could not walk for a while: drop anything that pins the player, resync the position
      if (!cd(a, 'unstick', 3000, true)) return;
      if (a.cast) a.cast = null; if (a.pose && a.pose !== 'jail' && !a.down) standUp(a);
      if (D.blocked(a.x, a.y)) { const n = standNear(areaId(a), a.x, a.y); if (n) { a.x = n[0]; a.y = n[1]; } }
      console.log(`[unstick] ${a.name} at ${a.x.toFixed(1)},${a.y.toFixed(1)} ${cleanText(m.why || '', 160)}`);
      place(a, a.x, a.y); markMe(a); return;
    }
    case 'god': return godAct(a, m);
    case 'trashrun.end': {                  // the run is over (crashed or quit): pay for what was picked up, if it is plausible
      if (!a.run0 || a.career !== 'beggar' && !allJobs(a)) return;
      const sec = (now() - a.run0) / 1000; a.run0 = 0; a.runNext = now() + 15000;
      // plausibility, from how the run is built: at most 30 m/s, at most ~6 pieces of rubbish per 8 m row, one coin per row
      const n = k => clamp(Math.floor(+m[k] || 0), 0, 9999), cups = n('cups'), cans = n('cans'), bottles = n('bottles'), coins = n('coins'), dist = n('dist'), items = cups + cans + bottles + coins;
      const why = dist > sec * 31 + 40 ? `ระยะทาง ${dist} ม. เกินกว่าที่วิ่งได้ใน ${Math.round(sec)} วินาที` : items > dist * .8 + 8 ? `เก็บของ ${items} ชิ้น มากเกินกว่าที่มีบนถนน ${dist} ม.` : coins > dist / 8 + 2 ? `เหรียญ ${coins} เหรียญ มากเกินกว่าที่มีบนถนน ${dist} ม.` : '';
      if (why) { markMe(a); return toast(a, `⚠️ ผลการวิ่งผิดปกติ ไม่ได้รับเงิน: ${why} (ถ้าเล่นปกติแล้วเจอแบบนี้ กด 🐞 แจ้งบัคได้เลย)`, '⚠️', false); }
      const raw = Math.round((cups * 2 + cans * 3 + bottles * 3 + coins * 8 + Math.floor(dist / 100) * 2) * (1 + (BOOST[tier(a, 'beggar')] || 0))), pay = Math.min(400, raw);
      if (pay > 0) earn(a, pay); addXp(a, Math.min(2, (cups + cans + bottles) / 25)); stat(a, 'trash', cups + cans + bottles); joy(a, 3); markMe(a);
      if (dist > (a.stats?.runBest || 0)) stat(a, 'runBest', dist, true);
      return toast(a, `🗑️ วิ่งได้ ${dist} ม. เก็บขยะ ${cups + cans + bottles} ชิ้น เหรียญ ${coins} · ขายได้ ${money(pay)}${raw > pay ? ` (เต็มเพดาน ฿400 ต่อรอบ จากที่คิดได้ ${money(raw)})` : ''}`, '♻️');
    }
    case 'quizans': {                       // an answer to a classroom pop quiz
      const q = a.quiz; if (!q) return; a.quiz = null;
      if (a.desk < 0 || !a.school) return;
      if (+m.i === q.ans) {
        a.school.p = Math.min(.99, a.school.p + (q.teacher ? .6 : .4)); joy(a, q.teacher ? 3 : 1); stat(a, 'quizOk', 1);
        if (q.teacher) earn(a, 40);
        return toast(a, q.teacher ? 'ตอบถูก! อาจารย์ชม ได้โบนัส ฿40 และเรียนเร็วขึ้น' : 'ตอบถูก! เรียนเร็วขึ้น', '🎓');
      }
      return toast(a, `ตอบผิด คำตอบที่ถูกคือ "${q.right}"`, '📖', false);
    }
    case 'frame': {                         // profile frames: buy one, wear it (or take it off with -1)
      const f = D.FRAMES[+m.id];
      if (m.op === 'wear') { if (+m.id === -1) { a.frame = -1; markMe(a); return; } if (!f || !(a.frames || []).includes(f.id) && !(f.locked && isAdmin(a))) return; a.frame = f.id; markMe(a); return toast(a, `ใส่${f.name}แล้ว`, '🖼️'); }
      if (m.op === 'buy') {
        if (!f) return; if (f.locked) return toast(a, 'กรอบพิเศษยังล็อกอยู่ เร็วๆ นี้!', '🔒', false);
        a.frames = a.frames || []; if (a.frames.includes(f.id)) return;
        if (!pay(a, f.price)) return;
        a.frames.push(f.id); a.frame = f.id; joy(a, 4); markMe(a); return toast(a, `ได้${f.name}แล้ว! ใส่ให้แล้ว`, '🖼️');
      }
      return;
    }
    case 'questquit': {   // the ✕ on the quest chip: drop a lost-dog / thief case from anywhere
      if (!a.dogq || !cd(a, 'qquit', 800, true)) return;
      const th = a.dogq.kind === 'thief'; if (th) a.thiefNext = now() + D.THIEFQ.next; else a.dogNext = now() + D.DOGQ.next;
      a.dogq = null; markMe(a); return toast(a, th ? 'ยกเลิกเคสจับโจรแล้ว' : 'ยกเลิกเคสหมาหายแล้ว', 'ℹ️', false);
    }
    case 'decor': { a.decor = m.on && inOwnHome(a) ? 1 : 0; return; }
    case 'mission': return misAct(a, m);
    case 'rb': return rbAct(a, m);
    case 'rbseek': { if (a.career !== 'rider' && !allJobs(a)) return; if (a.rival || a.rb) return toast(a, 'มีไรเดอร์ส้มอยู่แล้ว ตามจุดสีส้มบนมินิแมพ', '🧡', false); if (now() < (a.rbSeekAt || 0)) return toast(a, `ยังไม่มีข่าว รออีก ${Math.ceil((a.rbSeekAt - now()) / 1000)} วินาที`, '⏳', false); a.rbSeekAt = now() + 60000; if (!rivalSpawn(a, 1)) toast(a, 'ออกไปข้างนอกในตัวเมืองก่อนนะ', '🏙️', false); return; }
    case 'reset': return resetChar(a, m);
    case 'resign': return resign(a);
    case 'paybills': return payBills(a);
    case 'donate': return donate(a, m);

    case 'jg': return jobGame(a, m);
    case 'adreward': {                       // the player chose to watch a rewarded ad and watched it to the end
      if (!ADS_GAME) return;
      const day = new Date(now() + 7 * 3600e3).toISOString().slice(0, 10);
      if (a.adDay !== day) { a.adDay = day; a.adN = 0; }
      if (a.adN >= ADS.daily) return toast(a, `วันนี้รับรางวัลจากโฆษณาครบ ${ADS.daily} ครั้งแล้ว พรุ่งนี้มาใหม่นะ`, '🎁', false);
      if (!cd(a, 'adrw', ADS.gap)) return;
      a.adN++; a.gems = (a.gems || 0) + ADS.gems; a.energy = Math.min(100, a.energy + ADS.energy); markMe(a); stat(a, 'adsWatched');
      return toast(a, `🎁 ขอบคุณที่ดูโฆษณา! ได้ 💎${ADS.gems} และพลังงาน +${ADS.energy} (วันนี้ ${a.adN}/${ADS.daily})`, '🎁');
    }
    case 'alms_give': {                     // put food in a monk's bowl
      const o = nearPlayer(a, m.to, 5), id = String(m.item || ''), it = D.ITEMS[id];
      if (!o || o.career !== 'monk') return toast(a, 'เดินเข้าไปใกล้พระก่อน', '🙏', false);
      if (!it?.eat || !(a.inv[id] > 0)) return toast(a, 'ไม่มีอาหารชิ้นนี้ในกระเป๋า', '🎒', false);
      if (!cd(a, 'almsg', 8000)) return;
      addItem(a, id, -1); addItem(o, id, 1); joy(a, 6); a.bless = Math.max(a.bless || 0, now()) + 10 * 60000; markMe(a); markMe(o);
      if (cd(o, 'almsxp', 30000, true)) addXp(o, .3);
      send(a, { t: 'tfx', kind: 'pray' });
      toast(o, `🙏 ${a.name} ใส่บาตร ${it.icon}${it.name}`, '🙏');
      return toast(a, `🙏 ใส่บาตร ${it.icon}${it.name} ให้${o.name}แล้ว ได้บุญ ความสุขเพิ่ม และได้รับพร 10 นาที (รายได้ +5%)`, '🙏');
    }
    case 'glink': googleLink(a, m); return;
    case 'hopoff': if (a.pass) hopOff(a); return;
    case 'wheelie': {                        // pop a wheelie on your bike (just for show, and a little fun)
      const v = riding(a); if (!v || v.kind !== 'moto' || a.ride === 'escoot' || !cd(a, 'whl', 1800, true)) return;
      for (const o of online.values()) if (o.ws && dist(o, a) < 30) send(o, { t: 'whl', id: a.id });
      if (cd(a, 'whlJoy', 20000, true)) joy(a, 1);
      return;
    }
    case 'ride': {                           // get on / off one of your vehicles
      const k = String(m.v || '');
      if (!k || a.ride === k && !m.on) { if (D.VEHICLES[a.ride]?.fly && D.blocked(a.x, a.y)) return toast(a, 'หาที่โล่งลงจอดก่อน 🚁', '🚁', false); a.ride = ''; }
      else {
        const v = D.VEHICLES[k]; if (!v || !(a.vehicles || []).includes(k)) return;
        if (a.cast) return toast(a, 'เก็บเบ็ดก่อนถึงจะขึ้นรถได้', '🎣', false);
        if (a.pass) hopOff(a);
        if (v.license && !hasLic(a, v.license)) return toast(a, licExpired(a, 'driving') ? 'ใบขับขี่หมดอายุ! ต่ออายุที่โชว์รูมรถก่อนขับ' : 'ต้องมีใบขับขี่ก่อน', '🪪', false);
        a.ride = k;
      }
      a.mvb = moveCap(a); markMe(a); return sendRoster();
    }
    case 'wear': return wear(a, m);
    case 'yfarm': return yardFarm(a, m);
    case 'hstyle': {                        // put a floor / wallpaper you own on one storey of your house
      if (!a.hown) return toast(a, 'ต้องมีบ้านของตัวเองก่อน', '🏡', false);
      const fl = Math.round(+m.fl) || 1; if (fl < 1 || fl > 1 + (a.hlv || 0)) return;
      const cur = [...((a.hdeco || {})[fl] || ['fl_wood', 'cream'])];
      if (m.floor) { const d = D.HOME_FLOORS[m.floor]; if (!d || d.price && !(a.hfl || []).includes(m.floor)) return; cur[0] = m.floor; }
      if (m.wall) { const d = D.HOME_WALLS[m.wall]; if (!d || d.price && !(a.hwl || []).includes(m.wall)) return; cur[1] = m.wall; }
      a.hdeco = { ...(a.hdeco || {}), [fl]: cur }; a.sd = true; markMe(a); wdAt = 0; return;
    }
    case 'hplace': {                        // arrange your own furniture: put a piece on a floor of your house, or put it away
      const i = a.house; if (i < 0 || houses[i] !== a) return toast(a, 'ต้องมีบ้านของตัวเองก่อน', '🏡', false);
      const k = String(m.k || ''); if (!furnOf(a).includes(k)) return;
      a.fpos = { ...(a.fpos || {}) };
      const fd = D.FURNITURE[fbase(k)];
      if (m.del) {                          // throw away a spare partition piece for half its price back
        if (!fd?.multi || !a.furniture.includes(k)) return;
        a.furniture = a.furniture.filter(x => x !== k); delete a.fpos[k]; if (a.ycrops) delete a.ycrops[k]; credit(a, Math.round(fd.price / 2));
        toast(a, `ขาย${fd.name}คืน ได้ ${money(Math.round(fd.price / 2))}`, '♻️');
      } else if (m.store) { if (k === 'sbed') return toast(a, 'เตียงประจำบ้านเก็บเข้าคลังไม่ได้ ย้ายตำแหน่งได้อย่างเดียว', '🛏️', false); a.fpos[k] = [0]; if (fd?.tile) { if (a.ycrops) delete a.ycrops[k]; } else toast(a, `เก็บ${fd?.name || ''}เข้าคลังแล้ว`, '📦'); }
      else {
        const fl = Math.round(+m.fl) || 1, x = +m.x, y = +m.y;
        if (fl === YARD_FL) {                 // out in the yard: only on ground that has been unlocked
          if (!(x >= .7 && x <= D.YARD.w - .7 && y >= 1.5 && y <= D.YARD.h - .8)) return toast(a, 'วางตรงนี้ไม่ได้', '⚠️', false);
          if (fd?.tile) {                     // soil tiles sit on the grid, one per cell, and join up with their neighbours
            const cx = Math.floor(x), cy = Math.round(y) - 1;
            if (!yardOpen(a, D.yardZone(cx + .5, cy + .5))) return toast(a, 'พื้นที่นี้ยังไม่ได้ปลดล็อก', '🔒', false);
            if (Object.entries(a.fpos).some(([o, p]) => o !== k && p[0] === YARD_FL && D.FURNITURE[fbase(o)]?.sprk && Math.floor(p[1]) === cx && Math.round(p[2]) - 1 === cy)) return toast(a, 'ช่องนี้มีสปริงเกลอร์อยู่', '💦', false);
            if (Object.entries(a.fpos).some(([o, p]) => o !== k && p[0] === YARD_FL && D.FURNITURE[fbase(o)]?.tile && Math.floor(p[1]) === cx && Math.round(p[2]) - 1 === cy)) return toast(a, 'ช่องนี้มีแปลงดินแล้ว', '🟫', false);
            a.fpos[k] = [fl, cx + .5, cy + 1]; markMe(a); wdAt = 0; return;
          }
          if (!yardOpen(a, D.yardZone(x, y))) return toast(a, 'พื้นที่นี้ยังไม่ได้ปลดล็อก', '🔒', false);
          if (fd?.sprk) {                     // sprinklers sit on a grid cell between the soil and water the cells around them
            const cx = Math.floor(x), cy = Math.round(y) - 1;
            if (Object.entries(a.fpos).some(([o, p]) => o !== k && p[0] === YARD_FL && (D.FURNITURE[fbase(o)]?.tile || D.FURNITURE[fbase(o)]?.sprk) && Math.floor(p[1]) === cx && Math.round(p[2]) - 1 === cy)) return toast(a, 'ช่องนี้มีของวางอยู่แล้ว', '💦', false);
            a.fpos[k] = [fl, cx + .5, cy + 1];
            const n = ySprinkle(a); if (n) toast(a, `สปริงเกลอร์รดน้ำผักให้แล้ว ${n} ช่อง 💦`, '💦');
            markMe(a); wdAt = 0; return;
          }
        } else if (fl < 1 || fl > 1 + (a.hlv || 0) || !(x >= .7 && x <= 13.3 && y >= 1.2 && y <= 9.5)) return toast(a, 'วางตรงนี้ไม่ได้', '⚠️', false);
        if (k === 'sbed' && fl !== 1) return toast(a, 'เตียงประจำบ้านวางได้เฉพาะชั้น 1', '🛏️', false);
        a.fpos[k] = [fl, Math.round(x * 20) / 20, Math.round(y * 20) / 20, m.flip ? 1 : 0];
        if (k === 'sbed') syncBed(a);
      }
      markMe(a); wdAt = 0; return;
    }


    case 'title': { if (!m.id || (a.ach || []).includes(m.id) || (a.luxT || []).includes(m.id)) { a.title = m.id || ''; markMe(a); sendRoster(); } return; }
    case 'luxbuy': {
      const T = D.LUX_TITLES.find(x => x.id === m.id); if (!T || (a.luxT || []).includes(T.id) || !cd(a, 'luxbuy', 1500, true)) return;
      if (!pay(a, T.price)) return;
      a.luxT = [...(a.luxT || []), T.id]; a.title = T.id; a.sd = true; markMe(a); sendRoster();
      feed(`👑 ${a.name} ทุ่ม ${money(T.price)} ซื้อฉายา «${T.title}»!`);
      return toast(a, `ได้ฉายา «${T.title}» แล้ว ตั้งให้ลอยบนหัวเรียบร้อย`, '👑');
    }
    case 'order': return placeOrder(a, m);
    case 'order_take': case 'order_drop': case 'order_deliver': case 'order_cancel': return riderAct(a, m);
    case 'taxi': return taxiCall(a, m);
    case 'contact_add': case 'contact_del': case 'contact_pin': case 'call': case 'call_msg': case 'call_end': return phoneAct(a, m);
    case 'req': return request(a, m);
    case 'req_ans': return answerReq(a, m);
    case 'trade_offer': return tradeOffer(a, m);
    case 'trade_chat': {                    // chatting inside the trade window
      const tr = a.trade, text = cleanText(m.text, 120); if (!tr || !text || !cd(a, 'tchat', 600, true)) return;
      for (const p of [tr.a, tr.b]) send(p, { t: 'tchat', name: a.name, mine: p === a, text });
      return;
    }
    case 'pic': {                           // profile photo from the phone's album (already shrunk to a small JPEG by the client)
      const d = String(m.data || '');
      if (d && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 80000)) return toast(a, 'รูปใหญ่เกินไปหรือไม่ใช่ไฟล์รูป', '🖼️', false);
      if (!cd(a, 'pic', 8000)) return;
      a.pic = d || ''; markMe(a); sendRoster(); send(a, { t: 'mypic', pic: a.pic });
      return toast(a, d ? 'เปลี่ยนรูปโปรไฟล์แล้ว' : 'ลบรูปโปรไฟล์แล้ว', '🖼️');
    }
    case 'info': {                          // someone's profile: tap a player
      const bn = botById(+m.id);
      if (bn) eggMayor(a, bn);
      if (bn) { const b = bn.bot; return send(a, { t: 'info', id: bn.id, name: bn.name, pic: '', c: bn.c, lv: b.lv, title: b.title?.title || '', tr: b.title?.r || 0, adm: 0, ach: b.title ? [[b.title.title, b.title.r]] : [], worth: b.worth, days: b.days, fishLv: b.fishLv, home: 0, degree: 0, phone: '' }); }
      const o = playerById(m.id); if (!o || o.npc) return;
      const ach = (o.ach || []).map(id => D.ACHIEVEMENTS.find(x => x.id === id)).filter(Boolean).sort((x, y) => y.r - x.r);
      return send(a, { t: 'info', id: o.id, name: o.name, pic: o.pic || '', fr: frameOf(o), c: o.career, lv: lvl(o), title: titleOf(o), tr: titleRar(o), adm: isAdmin(o) ? 1 : 0,
        ach: ach.map(x => [x.title, x.r]), worth: Math.round(worth(o)), days: Math.max(1, Math.ceil((now() - (o.created || now())) / 86400e3)), fishLv: fishLv(o),
        home: o.hown ? 1 : 0, hslot: o.hown && o.house >= 0 ? 1 : 0, degree: (o.licenses || []).includes('degree') ? 1 : 0, phone: (a.contacts || []).some(c => c.n === o.name) ? o.phone : '' });
    }
    case 'mail': {                          // letters: reach anyone, online or not
      const text = cleanText(m.text, 500), to = cleanText(m.to, 16);
      if (!text || !to) return toast(a, 'ใส่ชื่อผู้รับและข้อความ', '✉️', false);
      const bm = bots().find(x => x.name === to);
      if (bm) { if (!cd(a, 'mail', 5000)) return; stat(a, 'mails'); if (Math.random() < .6) setTimeout(() => { if (!a.ws) return; a.mail = [{ id: now() + '' + Math.floor(Math.random() * 1000), from: bm.name, text: pick(['ได้รับจดหมายแล้วนะ ขอบคุณที่ทักมา 😊', 'สวัสดีครับ ไว้เจอกันในเมืองนะ', 'ขอบคุณจ้า ว่างๆ ไปตกปลาด้วยกัน']), t: now(), read: 0 }, ...(a.mail || [])].slice(0, 50); markMe(a); send(a, { t: 'mail', list: a.mail }); toast(a, `📬 จดหมายใหม่จาก ${bm.name}`, '📬'); }, rnd(20, 60) * 1000); send(a, { t: 'mailsent', to: bm.name }); return toast(a, `ส่งข้อความถึง ${bm.name} แล้ว`, '✅'); }
      const o = [...accounts.values()].find(x => x.name === to);
      if (!o) return toast(a, `ไม่พบผู้เล่นชื่อ "${to}"`, '✉️', false);
      if (o === a) return toast(a, 'ส่งจดหมายถึงตัวเองไม่ได้', '✉️', false);
      if (!cd(a, 'mail', 5000)) return;
      o.mail = [{ id: now() + '' + Math.floor(Math.random() * 1000), from: a.name, text, t: now(), read: 0 }, ...(o.mail || [])].slice(0, 50);
      markMe(o); stat(a, 'mails'); dirty = true; send(o, { t: 'mail', list: o.mail });
      if (o.ws) toast(o, `📬 จดหมายใหม่จาก ${a.name}`, '📬');
      send(a, { t: 'mailsent', to: o.name });
      return toast(a, `ส่งข้อความถึง ${o.name} แล้ว`, '✅');
    }
    case 'stockhist': { const s = mkt.find(x => x.id === m.id); if (s) send(a, { t: 'stockhist', id: s.id, i: stockI, c: s.hist }); return; }
    case 'mailget': return send(a, { t: 'mail', list: a.mail || [] });
    case 'mailread': { let ch = false; for (const x of a.mail || []) if (!x.read) { x.read = 1; ch = true; } if (ch) markMe(a); return; }
    case 'maildel': { a.mail = (a.mail || []).filter(x => x.id !== m.id); markMe(a); return send(a, { t: 'mail', list: a.mail }); }
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
  bugs.push({ t: now(), by: a.name, login: a.login, text, where: `${area?.name || area?.label || '?'} (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`, ua: cleanText(m.ua, 160), st: cleanText(m.st, 300), build: BUILD });
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
  if (m.op === 'find') {                    // look a player up by login ID, display name or phone number
    const q = String(m.q || '').trim().toLowerCase(); if (q.length < 2) return toast(a, 'พิมพ์อย่างน้อย 2 ตัวอักษร', '🔎', false);
    const hits = [...accounts.values()].filter(x => x.login && (x.login.toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q) || String(x.phone || '') === q))
      .sort((x, y) => (x.login.toLowerCase() === q ? -1 : 0) - (y.login.toLowerCase() === q ? -1 : 0)).slice(0, 15);
    return send(a, { t: 'godfind', q, list: hits.map(x => ({ login: x.login, name: x.name, phone: x.phone, money: x.money, bank: x.bank || 0, gems: x.gems || 0, career: D.CAREERS[x.career]?.name || 'ว่างงาน',
      on: !!x.ws, last: x.ws ? 0 : x.lastOff || 0, created: x.created || 0, days: x.loginDays || 0, lastDay: x.lastLogin || '', gmail: x.gmail ? 1 : 0, house: x.house >= 0 ? x.house + 1 : 0 })) });
  }
  if (m.op === 'ledger') {                  // a player's money history (support)
    const x = accounts.get(String(m.login || '').toLowerCase()); if (!x) return toast(a, 'ไม่พบไอดีนี้', '🔎', false);
    if (x.ws) ledSweep(x);
    return send(a, { t: 'ledger', who: `${x.name} (${x.login})`, money: x.money, list: (x.ledger || []).slice(-150) });
  }
  if (m.op === 'setpin') {                  // give a player a new PIN (they asked support for help logging in)
    const x = accounts.get(String(m.login || '').toLowerCase()), pin = String(m.pin || '');
    if (!x) return toast(a, 'ไม่พบไอดีนี้', '🔎', false);
    if (!/^\d{4,8}$/.test(pin)) return toast(a, 'PIN ใหม่ต้องเป็นตัวเลข 4–8 หลัก', '🔒', false);
    x.hash = hashPin(pin, x.salt); x.sd = true; dirty = true;
    return toast(a, `ตั้ง PIN ใหม่ให้ ${x.login} แล้ว แจ้งผู้เล่นให้เปลี่ยนเองอีกครั้งหลังเข้าเกม`, '🔑');
  }
  if (m.op === 'zombie') { if (zn) { for (const z of zombies()) npcs.splice(npcs.indexOf(z), 1); zn = null; npcRosterDirty = true; znSendAll(); return toast(a, 'หยุดคืนปล่อยผีแล้ว', '🧟'); } znDone = ''; return znStart(now(), true); }
  if (m.op === 'nocd') { a.god.nocd = !a.god.nocd; if (a.god.nocd) a.cd = {}; toast(a, a.god.nocd ? 'God mode: ไม่มีคูลดาวน์' : 'ปิด: ไม่มีคูลดาวน์', '⚡'); }
  else if (m.op === 'lock') { a.god.lock = !a.god.lock; toast(a, a.god.lock ? 'God mode: ล็อกสเตตัสเต็ม (ไม่ป่วย/ไม่หมดสติ)' : 'ปิด: ล็อกสเตตัส', '🛡️'); }
  else if (m.op === 'fill') {
    a.energy = a.hunger = a.health = a.happy = 100; a.awake = 0; a.lowFood = a.starve = a.wet = 0;
    for (const d of [...(a.dz || [])]) cure(a, d);
    if (a.down) revive(a, 100);
    toast(a, 'สเตตัสเต็มแล้ว', '💯');
  } else if (m.op === 'cloak') { a.god.cloak = !a.god.cloak; markMe(a); sendRoster(); toast(a, a.god.cloak ? 'สวมชุดคลุมแอดมิน + ออร่า' : 'ถอดชุดคลุมแอดมิน', '🌑'); }
  else if (m.op === 'money') { a.money = 999999; toast(a, 'เงิน ฿999,999', '💰'); }
  else if (m.op === 'inf') {
    a.god.inf = a.god.inf === false;
    if (a.god.inf) { a.god.real = Math.min(a.money, INF_MONEY - 1); a.god.realG = a.gems || 0; godTop(a); }
    else { a.money = a.god.real ?? 0; a.gems = a.god.realG ?? 0; }
    toast(a, a.god.inf ? 'เปิดเงิน/เพชรไม่จำกัด' : 'ปิดเงินไม่จำกัด กลับไปใช้เงินจริง', '💰');
  }
  else if (m.op === 'submoney') { if (godInf(a)) return toast(a, 'ปิดเงินไม่จำกัดก่อน จึงลดเงินได้', '💰', false); const v = Math.floor(+m.v); if (!Number.isSafeInteger(v) || v <= 0) return toast(a, 'ใส่จำนวนเงินให้ถูกต้อง', '💰', false); a.money = Math.max(0, a.money - v); toast(a, `ลดเงิน ${money(v)} แล้ว`, '💰'); }
  else if (m.op === 'setmoney') { if (godInf(a)) return toast(a, 'ปิดเงินไม่จำกัดก่อน', '💰', false); const v = Math.floor(+m.v); if (!Number.isSafeInteger(v) || v < 0) return toast(a, 'ใส่จำนวนเงินให้ถูกต้อง', '💰', false); a.money = v; toast(a, `ตั้งเงินเป็น ${money(v)} แล้ว`, '💰'); }
  else if (m.op === 'addmoney') { const v = Math.floor(+m.v); if (!Number.isSafeInteger(v) || v <= 0 || a.money + v > Number.MAX_SAFE_INTEGER) return toast(a, 'ใส่จำนวนเงินให้ถูกต้อง', '💰', false); a.money += v; toast(a, `เพิ่มเงิน ${money(v)} แล้ว`, '💰'); }
  else if (m.op === 'alljobs') { a.god.alljobs = a.god.alljobs === false; ordersChanged(); toast(a, a.god.alljobs === false ? 'ปิดแล้ว: ทำได้เฉพาะงานของอาชีพตัวเอง' : 'เปิดแล้ว: ทำงานได้ทุกอาชีพ', '💼'); }
  else if (m.op === 'notitle') { a.god.notitle = !a.god.notitle; sendRoster(); toast(a, a.god.notitle ? 'ซ่อนฉายานายกเทศมนตรีแล้ว (ใช้ฉายาของตัวเองแทน)' : 'แสดงฉายานายกเทศมนตรีแล้ว', '🏅'); }
  else if (m.op === 'rename') {
    const nm = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    if (nm.length < 2 || nm.length > 16) return toast(a, 'ชื่อต้องยาว 2–16 ตัวอักษร', '✏️', false);
    if ([...accounts.values()].some(o => o !== a && String(o.name).toLowerCase() === nm.toLowerCase())) return toast(a, 'ชื่อนี้มีคนใช้แล้ว', '✏️', false);
    a.name = nm; a.god.renamed = true; a.sd = true; sendRoster(); toast(a, `เปลี่ยนชื่อเป็น "${nm}" แล้ว`, '✏️');
  }
  else if (m.op === 'speed') { a.god.speed = clamp(+m.v || 1, 1, 5); a.mvb = moveCap(a); }
  else if (m.op === 'warp') { a.god.warp = !a.god.warp; toast(a, a.god.warp ? 'วาร์ป: เปิดแผนที่แล้วแตะจุดที่ต้องการ' : 'ปิดวาร์ป', '✨'); }
  else if (m.op === 'warpto') {
    const x = +m.x, y = +m.y; if (!a.god.warp || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const ar = D.areaAt(x, y); if (!ar || D.blocked(x, y)) return toast(a, 'วาร์ปไปตรงนั้นไม่ได้ (ติดสิ่งกีดขวาง)', '✨', false);
    if (a.down) return; teleport(a, x, y); sendRoster(); return;
  }
  else if (m.op === 'doors') { a.god.doors = !a.god.doors; toast(a, a.god.doors ? 'God mode: เข้าได้ทุกอาคาร แม้ปิดแล้ว' : 'ปิด: เข้าได้ทุกอาคาร', '🚪'); }
  else if (m.op === 'invis') { a.god.invis = !a.god.invis; toast(a, a.god.invis ? 'God mode: ล่องหน คนอื่นมองไม่เห็นคุณ' : 'ปิดล่องหน คนอื่นเห็นคุณแล้ว', '👻'); }
  else if (m.op === 'bugs') return send(a, { t: 'bugs', list: bugs.slice(-60).reverse() });
  else if (m.op === 'bugreply') {   // tell the player who reported a bug that it is fixed (a letter in their mailbox)
    const b = bugs.find(x => x.t === +m.bt && (x.login || '') === (m.login || '')); if (!b) return toast(a, 'ไม่พบรายงานนี้แล้ว', '🐞', false);
    const o = accounts.get(String(b.login || '').toLowerCase()) || [...accounts.values()].find(x => x.login === b.login || x.name === b.by);
    if (!o) return toast(a, `ไม่พบผู้เล่น ${b.by}`, '🐞', false);
    const text = cleanText(m.text, 500) || `🛠️ บัคที่คุณแจ้งมา "${b.text.slice(0, 80)}${b.text.length > 80 ? '…' : ''}" ทีมงานแก้ไขเรียบร้อยแล้วครับ ขอบคุณมากที่ช่วยแจ้งนะครับ 🙏`;
    o.mail = [{ id: now() + '' + Math.floor(Math.random() * 1000), from: '🛠️ ทีมงาน Life Town', text, t: now(), read: 0 }, ...(o.mail || [])].slice(0, 50);
    markMe(o); dirty = true; send(o, { t: 'mail', list: o.mail }); if (o.ws) toast(o, '📬 จดหมายใหม่จากทีมงาน: บัคที่คุณแจ้งแก้แล้ว', '📬');
    b.done = 1; bugsDirty = true;
    toast(a, `ส่งจดหมายแจ้ง ${o.name} แล้ว`, '✅'); return send(a, { t: 'bugs', list: bugs.slice(-60).reverse() });
  }
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
  a.hown = null;
  if (a.rent && tenants[a.rent.idx] === a) tenants[a.rent.idx] = null;
  if (a.garden && lots[a.garden.lot] === a) lots[a.garden.lot] = null;
  const keep = { v: VERSION, login: a.login, name: a.name, salt: a.salt, hash: a.hash, phone: a.phone, gender: a.gender, avatar: a.avatar, contacts: a.contacts, god: a.god, pic: a.pic, mail: a.mail,
    look: { hair: 'brown', shirt: a.look?.shirt && D.SHIRTS.includes(a.look.shirt) ? a.look.shirt : 'white', pants: 'gray' } };
  keep.wardrobe = { hair: ['brown'], shirt: [keep.look.shirt], pants: ['gray'] };
  byPhone.delete(a.phone);
  const fresh = hydrate(keep);
  for (const k of SAVE_KEYS) a[k] = fresh[k];
  byPhone.set(a.phone, a);
  a.cd = {}; a.office = null; a.doc = null;
  Q.ensure(a);
  place(a, D.SPAWN.x, D.SPAWN.y, true); markMe(a); sendRoster(); wdAt = 0; dirty = true; a.sd = true;
  send(a, { t: 'reset' });
  toast(a, 'รีเซ็ตตัวละครแล้ว เริ่มต้นชีวิตใหม่ในเมือง! 🌱', '🌱');
}

// ------------------------------------------------------------------ simulation
let lastTick = now(), wdAt = 0, saveAt = 0, slowAt = 0, marketAt = 0, lastHour = hourNow();
function tick() {
  stockTick(); passTick();
  for (const a of online.values()) ledSweep(a, 'อื่นๆ');
  { let ch = false; for (const a of online.values()) { const v = castPub(a); if (v !== (a._fc || 0)) { a._fc = v; ch = true; } } if (ch) sendRoster(); }
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
    if (room) for (const a of online.values()) if (D.roomAt(a.x, a.y) === room && !(isAdmin(a) && a.god?.doors)) { teleport(a, room.outside.x, room.outside.y); toast(a, `${room.label}ปิดทำการแล้ว (${hhmm(close)}) เปิดอีกครั้ง ${hhmm(open)}`, '🔒'); }
  }
  if (crossed(D.SHIFT.end)) feed('🏢 17:00 หมดเวลางานปกติ พนักงานที่ยังส่งเอกสารต่อได้ค่าโอที x1.25 ถึง 21:00');
  if (crossed(D.SHIFT.start - 0.5)) for (const a of online.values()) if (a.career === 'office') toast(a, 'อีก 30 นาทีเข้างาน (08:00) ไปรับงานส่งเอกสารที่บริษัทให้ทัน', '⏰');
  lastHour = h;

  const slow = t > slowAt; if (slow) slowAt = t + 1000;
  if (slow) plotTick();
  if (slow && ev('rain')) for (const a of online.values()) ySprinkle(a, true);   // rain waters every garden
  const flu = ev('flu');
  for (const a of online.values()) {
    const indoors = !!D.roomAt(a.x, a.y);
    if (a.mis) misTick(a, t, dt);
    if (a.cook) cookTick(a, t, dt);
    if (a.auc) aucTick(a, t);
    if (a.career === 'rider' || a.rival) rivalTick(a, t);
    if (godLock(a)) {   // god mode: locked stats
      a.energy = a.hunger = a.health = a.happy = 100; a.awake = 0; a.lowFood = a.starve = a.wet = 0;
      if ((a.dz || []).length) { a.dz = []; sendRoster(); }
      if (a.down) { a.down = null; sendRoster(); }
      a.craving = null; a.utilOff = false;
    }
    // ---- energy, hunger, health
    const frozen = a.decor && inOwnHome(a) ? [a.energy, a.hunger, a.health, a.happy] : (a.decor = 0, null);   // arranging the home: stats hold still
    // energy comes back properly in a bed or at the amusement park; everyone gets a slow trickle
    // sitting (bench, seat, the rest button) for 10s+ doubles the trickle, but only up to half a bar: a full bar still needs a bed or the park
    const sitting = a.pose === 'seat' || a.pose === 'rest';
    a.sitFor = sitting ? (a.sitFor || 0) + dt : 0;
    const restMul = a.pose === 'bed' ? 2 : sitting && a.sitFor >= 10 && a.energy < 50 ? 0.56 : 0.27;
    if (a.pose === 'fun' && a.fun) {          // on a park ride: energy, health and happiness come back every second
      const R = D.RIDES[a.fun.k];
      if (!R || D.areaAt(a.x, a.y)?.id !== 'park') standUp(a);
      else if (t > a.fun.until) { rideOff(a); markMe(a); toast(a, `หมดเวลา${R.name}แล้ว กดเล่นใหม่ได้เลย (ฟรี) เพื่อเล่นต่อได้เลย`, R.icon); }
      else { a.energy = Math.min(100, a.energy + R.gain.energy * dt); if (!a.down) a.health = Math.min(100, a.health + R.gain.health * dt); a.happy = Math.min(100, (a.happy ?? 80) + R.gain.happy * dt); }
    }
    if (a.pose !== 'chair' && a.pose !== 'study') a.energy = Math.min(100, a.energy + 0.15 * (depressed(a) ? 0.6 : 1) * restMul * (1 + 0.03 * comfort(a)) * dzProd(a, 'regen') * dt);
    a.hunger = Math.max(0, a.hunger - 0.045 * (a.career === 'monk' ? .55 : 1) * dzProd(a, 'hunger') * (flu ? 1.3 : 1) * (a.down ? 0.2 : 1) * dt);
    if (!a.down) {
      if (a.hunger < 15) { a.lowFood = (a.lowFood || 0) + dt; if (a.lowFood > 60) a.health -= 0.08 * dt; } else a.lowFood = 0;
      if (a.hunger <= 0) a.health -= 0.25 * dt;
      else if (a.hunger > 60 && a.health < 100 && !(a.dz || []).length) a.health = Math.min(100, a.health + 0.05 * dt);
      // sitting down to rest heals (slowly while sick, not at all while starving)
      for (const d of a.dz || []) a.health -= (DZ[d].drain || 0) * (flu && (d === 'flu' || d === 'cold') ? 2.5 : 1) * dt;
      a.health = Math.max(0, a.health);
    }
    // ---- sleepiness
    if (a.pose === 'rest' || a.pose === 'bed') { a.awake = Math.max(0, (a.awake || 0) - 4 * dt); if (a.awake === 0 && (a.dz || []).some(d => d === 'insomnia' || d === 'exhaust') && a.pose === 'rest') sleepWell(a); }
    else a.awake = (a.awake || 0) + dt;
    if (slow) moodTick(a, t, indoors);
    if (frozen) { a.energy = Math.max(a.energy, frozen[0]); a.hunger = Math.max(a.hunger, frozen[1]); a.health = Math.max(a.health, frozen[2]); a.happy = Math.max(a.happy ?? 0, frozen[3] ?? 0); }
    if (slow && !isAdmin(a)) {               // beggars: out of poverty past ฿2,000
      if (a.career === 'beggar' && a.money + (a.bank || 0) > 2000) { a.career = 'none'; a.pose === 'beg' && standUp(a); markMe(a); sendRoster(); toast(a, '🎉 มีเงินเกิน ฿2,000 แล้ว! พ้นจากการเป็นขอทาน ไปสมัครงานใหม่ได้เลย', '🎉'); feed(`🎉 ${a.name} พ้นจากการเป็นขอทานแล้ว!`); }
    }
    if (slow && !a.down) {
      // ---- ways to get sick (often enough that doctors have work)
      if (a.awake > 40 * 60) infect(a, 'insomnia', 0.01);
      if (ev('rain') && !indoors) {
        a.wet = (a.wet || 0) + 1;
        if (a.wet === 30 && !(a.dz || []).includes('cold')) toast(a, 'ฝนตก ตัวเริ่มเปียกแล้ว! รีบหลบเข้าที่ร่มก่อนจะเป็นหวัด', '🌧️', false);
        if (a.wet > 40) infect(a, 'cold', 0.005);
      } else a.wet = Math.max(0, (a.wet || 0) - 2);
      if (flu) { infect(a, 'flu', indoors ? 0.001 : 0.002); infect(a, 'cold', 0.001); }
      if (!indoors) infect(a, 'cold', 0.0004);
      if (a.hunger <= 0) { a.starve = (a.starve || 0) + 1; if (a.starve > 60) infect(a, 'malnut'); } else a.starve = 0;
      if (a.hunger >= 80) cure(a, 'malnut');
      // contagion: standing next to someone with a cold or the flu
      if ((a.dz || []).some(d => d === 'cold' || d === 'flu')) for (const o of online.values()) if (o !== a && areaId(o) === areaId(a) && dist(o, a) < 2.5) {
        if (!(o.dz || []).length && cd(o, 'sickwarn', 60000, true)) toast(o, `${a.name || 'คนข้างๆ'} ป่วยอยู่ ถอยห่างหน่อยจะได้ไม่ติด`, '🤧', false);
        infect(o, a.dz.includes('flu') ? 'flu' : 'cold', 0.005);
      }
      // a light cold clears by itself after a good rest (sitting or lying down indoors for a minute)
      if ((a.dz || []).includes('cold') && indoors && (a.pose === 'seat' || a.pose === 'bed' || a.pose === 'rest')) { a.rest = (a.rest || 0) + 1; if (a.rest >= 60) { a.rest = 0; cure(a, 'cold'); toast(a, 'พักผ่อนเต็มที่ ไข้หวัดหายเองแล้ว', '😌'); } } else a.rest = 0;
      if (a.career === 'office') officeTick(a, t, h, 1);
      if (a.desk >= 0) studyTick(a, h, 1);
      if (a.call?.payer) callBill(a);
      // (leaving begging is handled with the ฿2,000 rule above)
      if ((a.licenses || []).includes('driving') && a.licExp?.driving) {
        const left = a.licExp.driving - t;
        if (left < 0 && !a.licWarned2) { a.licWarned2 = true; toast(a, 'ใบขับขี่หมดอายุแล้ว! ต่ออายุได้ที่โชว์รูมรถ (ไรเดอร์รับออเดอร์ไม่ได้จนกว่าจะต่อ)', '🪪', false); }
        else if (left > 0 && left < LICENSE_YEAR / 12 && !a.licWarned) { a.licWarned = true; toast(a, 'ใบขับขี่ใกล้หมดอายุ (เหลือไม่ถึง 1 เดือนในเกม) ต่ออายุได้ที่โชว์รูมรถ', '🪪'); }
      }
    }
    // ---- knocked out
    if (!a.down && a.health <= 0) knockOut(a);
    else if (a.down) {
      if (a.down.kind === 'veg') {
        if (t > (a.down.until || a.down.t + 6000)) revive(a, 15);
      } else if (a.down.kind === 'hosp') {
        if (t > (a.down.until || a.down.t + 60000)) {
          // the staff patch you up properly: illnesses treated, a decent amount of health back; free for new / broke players
          const fee = a.down.free ? 0 : Math.min(600, Math.round(a.money * 0.1)); a.money -= fee;
          a.dz = []; a.immune = a.immune || {}; for (const k of Object.keys(DZ)) a.immune[k] = now() + 30 * 60000;
          revive(a, 70); sendRoster(); toast(a, `🏥 ฟื้นแล้ว! เจ้าหน้าที่รักษาโรคให้หายหมด (กันป่วยซ้ำ 10 นาที) · ${fee ? `ค่ารักษา ${money(fee)}` : 'รักษาฟรี 💚'}`, '🏥');
        }
      }
    }
    if (a.cast) {
      if (a.cast.state === 'wait' && t >= a.cast.bite) { a.cast.state = 'bite'; a.cast.expire = t + a.cast.win + 300; send(a, { t: 'bite', win: a.cast.win }); markMe(a); }
      else if (a.cast.state === 'bite' && t > a.cast.expire) { a.cast = null; markMe(a); toast(a, 'ตวัดไม่ทัน ปลาฉกเหยื่อแล้วหนีไป', '💨', false); }
      else if (a.cast.state === 'fight' && t > a.cast.t0 + 150000) { a.cast = null; markMe(a); }
    }
    if (a.trade && (dist(a.trade.a, a.trade.b) > 8 || areaId(a.trade.a) !== areaId(a.trade.b))) tradeClose(a.trade, 'อยู่ไกลกันเกินไป ยกเลิกการแลกเปลี่ยน');
    if (godLock(a)) a.energy = a.hunger = a.health = a.happy = 100;
    if (a.meDirty || t % 2000 < TICK) { a.meDirty = false; send(a, meView(a)); }
  }
  if (slow) {
    // garden: tell owners their crops are ready
    for (const o of lots) if (o && o.garden && o.ws) o.garden.crops.forEach(c => { if (c && !c[2] && c[1] <= t) { c[2] = true; toast(o, `${D.ITEMS[c[0]].name}ในสวนของคุณโตแล้ว! ไปเก็บเกี่ยวได้`, '🌾'); } });
    // rentals expire
    tenants.forEach((a, i) => { if (a && a.rent && a.rent.until < t) { tenants[i] = null; a.rent = null; a.sd = true; if (a.ws) { toast(a, 'สัญญาเช่าบ้านหมดแล้ว ต่อสัญญาได้ที่หน้าบ้าน', '🔑', false); markMe(a); } wdAt = 0; } });
    // NPC patients
    for (let i = 0; i < beds.length; i++) { const b = beds[i]; if (b && b.npc && b.until < t) { beds[i] = null; wdAt = 0; } }
    if (t > npcPatientAt) { const docs = [...online.values()].some(o => o.career === 'doctor'); npcPatientAt = t + (docs ? rnd(60000, 120000) : rnd(150000, 300000)); spawnPatient(); }
    // food delivery
    for (const o of [...orders.values()]) {
      if (o.state === 'open' && !o.npc && t - o.t > (o.src === 'market' ? (ridersOnline().length ? 600000 : 180000) : ridersOnline().length ? 90000 : 60000)) finishOrder(o, null);
      else if (o.state === 'open' && o.npc && t - o.t > 240000) { orders.delete(o.id); custNpcDel(o); ordersChanged(); }
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
  if (slow && t % 30000 < 1000) for (const a of online.values()) if (a.bank > 0 || a.loan > 0) { accrue(a); markMe(a); }

  // positions
  const ps = [];
  for (const a of online.values()) if (a.moved) { a.moved = false; ps.push([a.id, +a.x.toFixed(2), +a.y.toFixed(2), a.f]); }
    if (online.size) { botTick(t); npcTick(dt, ps); }
  if (ps.length) {
    const hid = new Set([...online.values()].filter(hidden).map(a => a.id));
    if (!hid.size) broadcast({ t: 'ps', p: ps });
    else { const pub = JSON.stringify({ t: 'ps', p: ps.filter(q => !hid.has(q[0])) }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(hid.has(o.id) ? JSON.stringify({ t: 'ps', p: ps.filter(q => !hid.has(q[0]) || q[0] === o.id) }) : pub); }
  }

  if (t > wdAt) { wdAt = t + 1000; broadcast(worldView()); }
  if (t > saveAt) { saveAt = t + 15000; save(); }
}

// ------------------------------------------------------------------ http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const STATIC = new Map();
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/ads.txt') { res.writeHead(ADS_CLIENT ? 200 : 404, { 'Content-Type': 'text/plain' }); return res.end(ADS_CLIENT ? `google.com, ${ADS_CLIENT.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n` : ''); }   // AdSense checks this file
  if (url === '/api/gcfg') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ gid: GOOGLE_ID })); }
  if (url === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ online: online.size })); }   // login screen: how many real players are in town
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (path.extname(file) === '.mp4') {            // video: streamed with Range support (Safari/iOS refuse to play video without it)
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
      const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (!m) { res.writeHead(200, { ...h, 'Content-Length': st.size }); return fs.createReadStream(file).pipe(res); }
      let a = m[1] === '' ? Math.max(0, st.size - +m[2]) : +m[1], b = m[1] === '' || m[2] === '' ? st.size - 1 : Math.min(+m[2], st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
    });
  }
  // Static files are read once and kept in memory with an ETag (a phone that already has the file gets a tiny "304 not changed"
  // instead of downloading it again), text is sent gzipped, and files asked for with ?v= never change, so phones keep them for a year.
  // (Before this every visit downloaded the whole game again, ~11 MB.)
  const send1 = f => {
    const ext = path.extname(file), versioned = /[?&]v=/.test(req.url || ''), h = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: f.etag, Vary: 'Accept-Encoding',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, h); return res.end(); }
    const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { ...h, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': (gz ? f.gz : f.buf).length });
    res.end(req.method === 'HEAD' ? undefined : gz ? f.gz : f.buf);
  };
  const hit = STATIC.get(file); if (hit) return send1(hit);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    if (ADS_HEAD && path.basename(file) === 'index.html') buf = Buffer.from(buf.toString('utf8').replace('</head>', ADS_HEAD + '</head>'));   // AdSense code in the page head (site check)
    const text = /\.(html|js|css|json|svg|webmanifest)$/.test(file), f = { buf, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64').slice(0, 16) + '"', gz: text ? zlib.gzipSync(buf, { level: 9 }) : null };
    STATIC.set(file, f); send1(f);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 131072 });
wss.on('connection', (ws, req) => {
  ws.ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  let count = 0, winStart = now();
  ws.on('message', raw => {
    const t = now();
    if (t - winStart > 1000) { winStart = t; count = 0; }
    if (++count > 60) return;
    const str = raw.toString();
    if (str.length > 4096 && !str.startsWith('{"t":"pic"')) return;   // only a profile photo may be large
    onMessage(ws, str);
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
  for (let i = Math.min(botCap, rint(3, 6)); i > 0; i--) botJoin(true);   // only as many as are still left
  setInterval(tick, TICK);
  server.listen(PORT, () => console.log(`Life Town running on http://localhost:${PORT}`));
}
if (require.main === module) main().catch(e => { console.error('fatal:', e); process.exit(1); });
module.exports = { server };
