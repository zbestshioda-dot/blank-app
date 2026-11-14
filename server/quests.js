'use strict';
// Daily quests: 3 per real day (reset at midnight Thailand time), tracked on the server.
const DEFS = {
  // career quests: [min,max] target, reward per unit (kept small: quests should not flood the town with money)
  work:    { cat: 'career', career: 'office',   text: 'นั่งทำงานที่บริษัท {n} ชั่วโมง', n: [4, 8], per: 30 },
  harvest: { cat: 'career', career: 'farmer',   text: 'เก็บเกี่ยวผลผลิต {n} ครั้ง', n: [3, 6], per: 60 },
  fish:    { cat: 'general', text: 'ตกปลาให้ได้ {n} ตัว', n: [4, 8], per: 25 },
  buy:     { cat: 'career', career: 'merchant', text: 'ซื้อสินค้าจากคลัง {n} ชิ้น', n: [10, 20], per: 12 },
  cook:    { cat: 'career', career: 'chef',     text: 'ปรุงอาหาร {n} จาน', n: [3, 6], per: 60 },
  treat:   { cat: 'career', career: 'doctor',   text: 'รักษาคนไข้หาย {n} คน', n: [2, 4], per: 120 },
  deliver: { cat: 'career', career: 'rider',    text: 'ส่งอาหารสำเร็จ {n} ออเดอร์', n: [3, 6], per: 60 },
  // social / daily life
  trade:   { cat: 'social', text: 'แลกเปลี่ยนกับผู้เล่นอื่น {n} ครั้ง', n: [1, 2], per: 200 },
  chat:    { cat: 'social', text: 'คุยกับคนที่อยู่ใกล้ๆ {n} ครั้ง', n: [1, 3], per: 40 },
  eat:     { cat: 'social', text: 'กินอาหาร {n} ครั้ง', n: [2, 4], per: 40 },
  sit:     { cat: 'social', text: 'นั่งเล่นที่จัตุรัสกลางเมือง {n} ครั้ง', n: [1, 2], per: 60 },
  // general
  sell:    { cat: 'general', text: 'ขายของ {n} ชิ้น', n: [5, 15], per: 15 },
  earn:    { cat: 'general', text: 'หาเงินให้ได้ ฿{n}', n: [800, 2000], step: 100, per: 0.1 },
};
const BONUS = 600;          // all three done; +10% per streak day (max +50%)

const dayKey = (t = Date.now()) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
function nextReset(t = Date.now()) { const d = new Date(t + 7 * 3600e3); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 7 * 3600e3; }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function make(type) {
  const d = DEFS[type];
  const step = d.step || 1;
  const n = Math.round((d.n[0] + Math.random() * (d.n[1] - d.n[0])) / step) * step;
  const reward = Math.max(50, Math.round(n * d.per / 10) * 10);
  return { type, n, p: 0, reward, done: false };
}
function careerType(career) { return Object.keys(DEFS).find(k => DEFS[k].career === career) || null; }

function generate(a) {
  const social = pick(Object.keys(DEFS).filter(k => DEFS[k].cat === 'social'));
  const general = pick(Object.keys(DEFS).filter(k => DEFS[k].cat === 'general'));
  const ct = careerType(a.career);
  const extra = pick(Object.keys(DEFS).filter(k => DEFS[k].cat === 'general' && k !== general));
  return [make(ct || extra), make(social), make(general)];
}

// call before reading/updating; handles the daily rollover and streaks
function ensure(a) {
  const today = dayKey();
  const q = a.quests;
  if (q && q.day === today && q.list.every(x => DEFS[x.type])) return false;
  const yesterday = dayKey(Date.now() - 86400e3);
  // the streak survives only if every quest was finished yesterday
  if (!(q && q.day === yesterday && q.bonus)) a.qStreak = 0;
  a.quests = { day: today, list: generate(a), bonus: false, rerolled: false };
  return true;
}

function view(a) {
  ensure(a);
  const q = a.quests, streak = a.qStreak || 0;
  return {
    list: q.list.map(x => ({ text: DEFS[x.type].text.replace('{n}', x.type === 'earn' ? x.n.toLocaleString('en-US') : x.n), type: x.type, n: x.n, p: Math.min(x.n, Math.floor(x.p)), reward: x.reward, done: x.done, career: DEFS[x.type].career || null })),
    bonus: q.bonus, bonusAmount: Math.round(BONUS * (1 + Math.min(streak, 5) * 0.1)), streak, rerolled: q.rerolled, resetAt: nextReset(),
  };
}

// returns events [{kind:'done'|'all', text, reward}] so the caller can notify the player
function progress(a, type, amount = 1) {
  ensure(a);
  const q = a.quests, out = [];
  for (const x of q.list) {
    if (x.done || x.type !== type) continue;
    x.p += amount;
    if (x.p >= x.n) {
      x.done = true; x.p = x.n;
      a.money += x.reward; a.earned += x.reward;
      out.push({ kind: 'done', text: DEFS[x.type].text.replace('{n}', x.type === 'earn' ? x.n.toLocaleString('en-US') : x.n), reward: x.reward });
    }
  }
  if (!q.bonus && q.list.every(x => x.done)) {
    q.bonus = true;
    const amt = Math.round(BONUS * (1 + Math.min(a.qStreak || 0, 5) * 0.1));
    a.qStreak = (a.qStreak || 0) + 1;
    a.money += amt; a.earned += amt;
    out.push({ kind: 'all', reward: amt, streak: a.qStreak });
    out.push(...wprogress(a, 'dailyall', 1));
  }
  out.push(...wprogress(a, type, amount));
  return out;
}

function reroll(a, i) {
  ensure(a);
  const q = a.quests, x = q.list[i];
  if (!x) return 'ไม่พบเควสต์นี้';
  if (q.rerolled) return 'วันนี้เปลี่ยนเควสต์ไปแล้ว (เปลี่ยนได้วันละ 1 ครั้ง)';
  if (x.done) return 'เควสต์นี้ทำสำเร็จแล้ว';
  const cat = DEFS[x.type].cat, unused = k => !q.list.some(y => y.type === k);
  let pool;
  if (cat === 'career' && careerType(a.career) && careerType(a.career) !== x.type) pool = [careerType(a.career)];   // changed career: follow the new one
  else pool = Object.keys(DEFS).filter(k => DEFS[k].cat === (cat === 'career' ? 'general' : cat) && unused(k));
  if (!pool.length) pool = Object.keys(DEFS).filter(k => DEFS[k].cat !== 'career' && unused(k));
  if (!pool.length) return 'ไม่มีเควสต์อื่นให้เปลี่ยน';
  q.list[i] = make(pick(pool));
  q.rerolled = true;
  return null;
}

// ---------------- weekly quests: three long goals per week (Monday 00:00 Thai time), built on the same actions as the daily ones
const WDEFS = {
  dailyall: { cat: 'core', text: 'ทำเควสต์ประจำวันครบทั้ง 3 ข้อ {n} วัน', n: [4, 5], per: 700 },
  work:    { cat: 'career', career: 'office',   text: 'นั่งทำงานที่บริษัท {n} ชั่วโมง', n: [25, 35], per: 90 },
  harvest: { cat: 'career', career: 'farmer',   text: 'เก็บเกี่ยวผลผลิต {n} ครั้ง', n: [20, 30], per: 110 },
  buy:     { cat: 'career', career: 'merchant', text: 'ซื้อสินค้าจากคลัง {n} ชิ้น', n: [80, 120], per: 25 },
  cook:    { cat: 'career', career: 'chef',     text: 'ปรุงอาหาร {n} จาน', n: [20, 30], per: 110 },
  treat:   { cat: 'career', career: 'doctor',   text: 'รักษาคนไข้หาย {n} คน', n: [10, 15], per: 220 },
  deliver: { cat: 'career', career: 'rider',    text: 'ส่งอาหารสำเร็จ {n} ออเดอร์', n: [20, 30], per: 110 },
  earn:    { cat: 'money', text: 'หาเงินให้ได้ ฿{n}', n: [8000, 15000], step: 500, per: 0.25 },
  fish:    { cat: 'life', text: 'ตกปลาให้ได้ {n} ตัว', n: [25, 40], per: 70 },
  eat:     { cat: 'life', text: 'กินอาหาร {n} ครั้ง', n: [12, 20], per: 90 },
  chat:    { cat: 'life', text: 'คุยกับคนที่อยู่ใกล้ๆ {n} ครั้ง', n: [10, 15], per: 90 },
  sell:    { cat: 'life', text: 'ขายของ {n} ชิ้น', n: [40, 80], per: 35 },
};
const WBONUS = 4000;
// Monday of this week (Thai time) as the week's key
function weekKey(t = Date.now()) { const d = new Date(t + 7 * 3600e3); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
function nextWeek(t = Date.now()) { const d = new Date(weekKey(t) + 'T00:00:00Z'); return d.getTime() - 7 * 3600e3 + 7 * 86400e3; }
function wmake(type) {
  const d = WDEFS[type], step = d.step || 1;
  const n = Math.round((d.n[0] + Math.random() * (d.n[1] - d.n[0])) / step) * step;
  return { type, n, p: 0, reward: Math.max(500, Math.round(n * d.per / 50) * 50), done: false };
}
function wensure(a) {
  const wk = weekKey();
  if (a.wquests && a.wquests.week === wk && a.wquests.list.every(x => WDEFS[x.type])) return false;
  const ct = Object.keys(WDEFS).find(k => WDEFS[k].career === a.career);
  a.wquests = { week: wk, list: [wmake('dailyall'), wmake(ct || 'earn'), wmake(pick(Object.keys(WDEFS).filter(k => WDEFS[k].cat === 'life')))], bonus: false };
  return true;
}
const wtext = x => WDEFS[x.type].text.replace('{n}', x.type === 'earn' ? x.n.toLocaleString('en-US') : x.n);
function wview(a) {
  wensure(a); const w = a.wquests;
  return { list: w.list.map(x => ({ text: wtext(x), type: x.type, n: x.n, p: Math.min(x.n, Math.floor(x.p)), reward: x.reward, done: x.done, career: WDEFS[x.type].career || null })),
    bonus: w.bonus, bonusAmount: WBONUS, resetAt: nextWeek() };
}
function wprogress(a, type, amount) {
  wensure(a); const w = a.wquests, out = [];
  for (const x of w.list) {
    if (x.done || x.type !== type) continue;
    x.p += amount;
    if (x.p >= x.n) { x.done = true; x.p = x.n; a.money += x.reward; a.earned += x.reward; out.push({ kind: 'wdone', text: wtext(x), reward: x.reward }); }
  }
  if (!w.bonus && w.list.every(x => x.done)) { w.bonus = true; a.money += WBONUS; a.earned += WBONUS; out.push({ kind: 'wall', reward: WBONUS }); }
  return out;
}

module.exports = { ensure, view, progress, reroll, dayKey, DEFS, wview, wprogress, weekKey };
