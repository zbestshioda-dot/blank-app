'use strict';
// Daily quests: 3 per real day (reset at midnight Thailand time), tracked on the server.
const DEFS = {
  // career quests: [min,max] target, reward per unit
  work:    { cat: 'career', career: 'office',     text: 'ทำงานที่บริษัท {n} ครั้ง', n: [4, 8], per: 150 },
  harvest: { cat: 'career', career: 'farmer',     text: 'เก็บเกี่ยวผลผลิต {n} ครั้ง', n: [3, 6], per: 220 },
  fish:    { cat: 'career', career: 'fisher',     text: 'ตกปลาให้ได้ {n} ตัว', n: [5, 10], per: 110 },
  buy:     { cat: 'career', career: 'merchant',   text: 'ซื้อสินค้าจากคลัง {n} ชิ้น', n: [10, 20], per: 55 },
  stream:  { cat: 'career', career: 'streamer',   text: 'ไลฟ์สด {n} ครั้ง', n: [3, 6], per: 220 },
  code:    { cat: 'career', career: 'programmer', text: 'ส่งงานโค้ดผ่าน {n} ครั้ง', n: [3, 5], per: 320 },
  cook:    { cat: 'career', career: 'chef',       text: 'ปรุงอาหาร {n} จาน', n: [3, 6], per: 230 },
  shift:   { cat: 'career', career: 'doctor',     text: 'เข้าเวรโรงพยาบาล {n} ครั้ง', n: [2, 4], per: 420 },
  // social / daily life
  trade:   { cat: 'social', text: 'แลกเปลี่ยนกับผู้เล่นอื่น {n} ครั้ง', n: [1, 2], per: 700 },
  chat:    { cat: 'social', text: 'ทักทายในแชท {n} ครั้ง', n: [1, 3], per: 120 },
  eat:     { cat: 'social', text: 'กินอาหาร {n} ครั้ง', n: [2, 4], per: 150 },
  // general
  sell:    { cat: 'general', text: 'ขายของที่ตลาดกลาง {n} ชิ้น', n: [5, 15], per: 60 },
  earn:    { cat: 'general', text: 'หาเงินให้ได้ ฿{n}', n: [2000, 5000], step: 500, per: 0.25 },
};
const BONUS = 1500;          // all three done; +10% per streak day (max +50%)

const dayKey = (t = Date.now()) => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
function nextReset(t = Date.now()) { const d = new Date(t + 7 * 3600e3); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 7 * 3600e3; }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function make(type) {
  const d = DEFS[type];
  const step = d.step || 1;
  const n = Math.round((d.n[0] + Math.random() * (d.n[1] - d.n[0])) / step) * step;
  const reward = Math.max(100, Math.round(n * d.per / 50) * 50);
  return { type, n, p: 0, reward, done: false };
}
function careerType(career) { return Object.keys(DEFS).find(k => DEFS[k].career === career) || 'work'; }

function generate(a) {
  const social = pick(Object.keys(DEFS).filter(k => DEFS[k].cat === 'social'));
  const general = pick(Object.keys(DEFS).filter(k => DEFS[k].cat === 'general'));
  return [make(careerType(a.career)), make(social), make(general)];
}

// call before reading/updating; handles the daily rollover and streaks
function ensure(a) {
  const today = dayKey();
  const q = a.quests;
  if (q && q.day === today) return false;
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
  }
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
  if (cat === 'career' && careerType(a.career) !== x.type) pool = [careerType(a.career)];   // changed career: follow the new one
  else pool = Object.keys(DEFS).filter(k => DEFS[k].cat === (cat === 'career' ? 'general' : cat) && unused(k));
  if (!pool.length) pool = Object.keys(DEFS).filter(k => DEFS[k].cat !== 'career' && unused(k));
  if (!pool.length) return 'ไม่มีเควสต์อื่นให้เปลี่ยน';
  q.list[i] = make(pick(pool));
  q.rerolled = true;
  return null;
}

module.exports = { ensure, view, progress, reroll, dayKey, DEFS };
