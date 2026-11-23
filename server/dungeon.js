'use strict';
// 🗝️ the treasure cave: a push-your-luck dungeon, all on the server (the client only shows it and sends choices).
// Each floor: pick one of 3 doors (each has a hint that is right 70% of the time). Every 5th floor is a boss.
// Between floors you may leave with the whole bag; fall in a fight and you keep only 30% of the money.
const KINDS = { gold: 'ห้องสมบัติ', mon: 'มอนสเตอร์', trap: 'กับดัก', spring: 'น้ำพุ', myst: 'ห้องลึกลับ', boss: 'บอส' };
const HINT = { gold: '✨ แสงระยิบระยับ', mon: '👣 รอยเท้าแปลกๆ', trap: '💨 ลมเย็นวาบ', spring: '💧 เสียงน้ำไหล', myst: '❓ เงียบสนิท', boss: '🔥 ไอร้อนแผ่ออกมา' };
const WEIGHT = [['gold', 28], ['mon', 36], ['trap', 13], ['spring', 10], ['myst', 13]];
// monsters by depth (hp, atk at floor 1 of their band; they grow 15% a floor)
const MONS = [
  { from: 1, list: [['slime', 'สไลม์เขียว', '🟢', 14, 4], ['bat', 'ค้างคาวถ้ำ', '🦇', 10, 5], ['rat', 'หนูยักษ์', '🐀', 12, 4]] },
  { from: 6, list: [['skel', 'โครงกระดูกนักรบ', '💀', 22, 7], ['spider', 'แมงมุมพิษ', '🕷️', 18, 8], ['golem', 'โกเลมหิน', '🗿', 30, 6]] },
  { from: 11, list: [['ghost', 'ผีถ้ำ', '👻', 26, 10], ['naga', 'นาคน้อย', '🐍', 34, 9], ['knight', 'อัศวินมืด', '⚔️', 38, 10]] },
];
const BOSSES = [['kingslime', 'ราชาสไลม์', '👑', 48, 7], ['minotaur', 'มิโนทอร์', '🐂', 60, 9], ['dragon', 'มังกรเฝ้าสมบัติ', '🐉', 95, 12]];
const RELICS = { sword: ['ดาบเพลิง', '🗡️', 'โจมตี +3'], shield: ['โล่ไม้โอ๊ค', '🛡️', 'ป้องกัน +2'], heart: ['หัวใจหิน', '❤️', 'พลังชีวิตสูงสุด +12'],
  luck: ['เครื่องรางนำโชค', '🍀', 'เงินที่เก็บได้ +25%'], boots: ['รองเท้าแมว', '🐾', 'ไม่โดนกับดัก'], lamp: ['ตะเกียงวิเศษ', '🏮', 'คำใบ้ที่ประตูถูกเสมอ'], blood: ['ลูกแก้วโลหิต', '🔮', 'ชนะมอนสเตอร์ ฟื้นพลัง 4'] };
const GOLD = 30, KEEP_DEAD = 0.3;

const roll = (r, ws) => { let x = r() * ws.reduce((t, w) => t + w[1], 0); for (const [k, w] of ws) if ((x -= w) < 0) return k; return ws[0][0]; };
const pickOf = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const has = (g, id) => g.relics.includes(id);
const say = (g, s) => { g.log = [s, ...(g.log || [])].slice(0, 6); };

function start(r) {
  const g = { f: 1, hp: 40, mhp: 40, atk: 7, def: 0, pot: 2, relics: [], bag: { money: 0, shard: 0, coin: 0, crystal: 0 }, mon: null, doors: [], over: '', guard: 0, log: [] };
  newDoors(g, r); say(g, '🕯️ คุณจุดคบเพลิงแล้วเดินลงไปในถ้ำ...'); return g;
}
function newDoors(g, r) {
  if (g.f % 5 === 0) { g.doors = [{ k: 'boss', h: 'boss' }]; return; }
  g.doors = [0, 1, 2].map(() => { const k = roll(r, WEIGHT); return { k, h: has(g, 'lamp') || r() < 0.7 ? k : roll(r, WEIGHT) }; });
}
const scale = (f, from) => 1 + 0.12 * (f - from);
function spawn(g, r, boss) {
  const band = [...MONS].reverse().find(b => g.f >= b.from) || MONS[0];
  const [id, name, icon, hp, atk] = boss ? BOSSES[Math.min(BOSSES.length - 1, g.f / 5 - 1)] : pickOf(r, band.list);
  const k = boss ? 1 + 0.25 * Math.max(0, g.f / 5 - BOSSES.length) : scale(g.f, band.from);
  g.mon = { id, name, icon, hp: Math.round(hp * k), mhp: Math.round(hp * k), atk: Math.round(atk * k), boss: !!boss };
  say(g, `${icon} ${name}${boss ? ' (บอส!)' : ''} โผล่ออกมา!`);
}
const cash = (g, n) => Math.round(n * (has(g, 'luck') ? 1.25 : 1));
function nextFloor(g, r) { g.f++; g.mon = null; g.guard = 0; newDoors(g, r); }
function relic(g, r) {
  const left = Object.keys(RELICS).filter(k => !has(g, k)); if (!left.length) { g.pot++; return say(g, '🧪 เจอยาฟื้นพลัง +1'); }
  const k = pickOf(r, left); g.relics.push(k);
  if (k === 'sword') g.atk += 3; if (k === 'shield') g.def += 2; if (k === 'heart') { g.mhp += 12; g.hp += 12; }
  say(g, `${RELICS[k][1]} ได้ ${RELICS[k][0]}: ${RELICS[k][2]}`);
}

function pick(g, i, r) {
  if (g.over || g.mon) return false; const d = g.doors[i]; if (!d) return false;
  if (d.k === 'mon') { spawn(g, r, false); return true; }
  if (d.k === 'boss') { spawn(g, r, true); return true; }
  if (d.k === 'gold') { const n = cash(g, GOLD * g.f * (0.8 + 0.4 * r())); g.bag.money += n; say(g, `💰 เจอหีบสมบัติ ได้ ฿${n}`); const x = r(); if (x < 0.04) { g.bag.shard++; say(g, '💎 ในหีบมีชิ้นส่วนเพชร!'); } else if (x < 0.3) { g.bag.crystal++; say(g, '💠 ในหีบมีเศษคริสตัล!'); } }
  else if (d.k === 'trap') {
    if (has(g, 'boots')) say(g, '🐾 รองเท้าแมวพาคุณกระโดดข้ามกับดัก!');
    else { const n = Math.round(g.mhp * (0.15 + 0.1 * r())); g.hp = Math.max(1, g.hp - n); say(g, `🪤 เหยียบกับดัก! เสียพลัง ${n}`); }
  } else if (d.k === 'spring') { const n = Math.round(g.mhp * 0.5); g.hp = Math.min(g.mhp, g.hp + n); say(g, `⛲ ดื่มน้ำพุ ฟื้นพลัง ${n}`); }
  else {
    const x = r();
    if (x < 0.35) relic(g, r);
    else if (x < 0.6) { g.pot++; say(g, '🧪 เจอยาฟื้นพลัง +1'); }
    else if (x < 0.8) { const n = Math.round(g.mhp * 0.2); g.hp = Math.max(1, g.hp - n); say(g, `👻 คำสาปในห้องมืด! เสียพลัง ${n}`); }
    else { g.bag.coin++; const n = cash(g, GOLD * g.f * 1.5); g.bag.money += n; say(g, `🪙 เจอเหรียญโบราณกับเงิน ฿${n}`); }
  }
  nextFloor(g, r); return true;
}

function win(g, r) {
  const M = g.mon; let n = cash(g, GOLD * g.f * (M.boss ? 3 : 0.9) * (0.8 + 0.4 * r())); g.bag.money += n;
  let s = `🏆 ชนะ ${M.name}! ได้ ฿${n}`;
  if (M.boss) { const sh = Math.floor(g.f / 10), c = 2 + Math.floor(g.f / 5); g.bag.shard += sh; g.bag.coin += c; g.bag.crystal += 2; s += `${sh ? ` · 💎x${sh}` : ''} · 🪙x${c} · 💠x2`; }
  g.mhp += 2; g.hp = Math.min(g.mhp, g.hp + 2 + (has(g, 'blood') ? 4 : 0));   // every win makes you a little tougher
  say(g, s); if (M.boss || r() < 0.15) relic(g, r);
  nextFloor(g, r);
}
function hitMe(g, r, mul) {
  const M = g.mon; if (r() < 0.12) return say(g, `${M.icon} ${M.name}โจมตีพลาด!`);
  const n = Math.max(1, Math.round((M.atk * (0.85 + 0.3 * r()) - g.def) * mul)); g.hp -= n; say(g, `${M.icon} ${M.name}โจมตีคุณ ${n}`);
  if (g.hp <= 0) { g.hp = 0; g.over = 'dead'; g.mon = null; say(g, '💫 คุณหมดแรงล้มลง... หน่วยกู้ภัยลากคุณออกจากถ้ำ'); }
}
function act(g, a, r) {
  if (g.over) return false;
  if (a === 'pot') { if (g.pot < 1 || g.hp >= g.mhp) return false; g.pot--; const n = Math.round(g.mhp * 0.4); g.hp = Math.min(g.mhp, g.hp + n); say(g, `🧪 ดื่มยา ฟื้นพลัง ${n}`); if (g.mon) hitMe(g, r, 1); return true; }
  const M = g.mon; if (!M) return false;
  if (a === 'atk') {
    const crit = r() < 0.12, n = Math.max(1, Math.round(g.atk * (0.85 + 0.3 * r()) * (crit ? 2 : 1) * (g.guard ? 1.5 : 1))); g.guard = 0;
    M.hp -= n; say(g, `⚔️ คุณโจมตี ${n}${crit ? ' (คริติคอล!)' : ''}`);
    if (M.hp <= 0) return win(g, r), true;
    hitMe(g, r, 1); return true;
  }
  if (a === 'def') { g.guard = 1; say(g, '🛡️ ตั้งท่าป้องกัน (ตาหน้าตีแรงขึ้น)'); hitMe(g, r, 0.35); return true; }
  if (a === 'run') {
    if (M.boss) return say(g, 'หนีบอสไม่ได้!'), false;
    if (r() < 0.55) { say(g, '🏃 หนีพ้น! แต่ไม่ได้อะไรจากห้องนี้'); g.mon = null; newDoors(g, r); return true; }
    say(g, '🏃 หนีไม่พ้น!'); hitMe(g, r, 1); return true;
  }
  return false;
}
function leave(g) { if (g.over || g.mon) return false; g.over = 'out'; return true; }
function payout(g) {
  if (g.over === 'dead') return { money: Math.floor(g.bag.money * KEEP_DEAD), shard: 0, coin: 0, crystal: 0 };
  return g.over === 'out' ? { ...g.bag } : { money: 0, shard: 0, coin: 0, crystal: 0 };
}
// the deepest floor reached in a finished week: top 3, each week paid once (a.dgw = { w, f, paid })
function weekly(accts, wk) {
  const due = accts.filter(a => a.dgw && !a.dgw.paid && a.dgw.w < wk && a.dgw.f > 0); due.forEach(a => { a.dgw.paid = 1; });
  return due.sort((x, y) => y.dgw.f - x.dgw.f).slice(0, 3).map((a, i) => ({ a, f: a.dgw.f, rank: i + 1 }));
}
// what the client sees (the doors' real contents stay on the server)
const view = g => ({ f: g.f, hp: g.hp, mhp: g.mhp, atk: g.atk, def: g.def, pot: g.pot, relics: g.relics, bag: g.bag, over: g.over, log: g.log,
  mon: g.mon && { name: g.mon.name, icon: g.mon.icon, hp: g.mon.hp, mhp: g.mon.mhp, atk: g.mon.atk, boss: g.mon.boss, id: g.mon.id }, doors: g.mon ? [] : g.doors.map(d => d.h) });

module.exports = { KINDS, HINT, RELICS, relic, start, newDoors, pick, act, leave, payout, weekly, view };
