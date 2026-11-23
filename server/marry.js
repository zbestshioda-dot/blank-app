'use strict';
// 💞 marriage: closeness grows while two friends (each has the other's number) spend time near each other; at 100 they
// are close friends and one with a ring can propose. Pure: index.js runs the proposal, the ceremony and the messages.
// a.bond = { otherLogin: { v, d, n } } (n = points today) · a.spouse = { login, name, ring, since } · a.divAt = last divorce
const BOND_NEED = 100, BOND_DAY = 30, REWED_MS = 7 * 864e5;
const key = a => String(a.login).toLowerCase();

const bond = (a, b) => a.bond?.[key(b)]?.v || 0;
function bondAdd(a, b, day) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const e = (x.bond ||= {})[key(y)] ||= { v: 0, d: '', n: 0 };
    if (e.d !== day) { e.d = day; e.n = 0; }
    if (e.n < BOND_DAY) { e.n++; e.v++; }
  }
  return bond(a, b);
}

function canPropose(a, b, t) {
  if (!b || key(a) === key(b)) return 'เลือกคนที่จะขอก่อนนะ';
  if (!a.ring) return 'ต้องมีแหวนก่อน ซื้อได้ที่ซุ้มแต่งงานในวัด 💍';
  if (a.spouse) return 'คุณแต่งงานแล้ว';
  if (b.spouse) return `${b.name}แต่งงานแล้ว`;
  if (bond(a, b) < BOND_NEED) return `ยังสนิทกันไม่พอ (${bond(a, b)}/${BOND_NEED} ❤️) อยู่ด้วยกันบ่อยๆ ก่อนนะ`;
  for (const x of [a, b]) if (x.divAt && t - x.divAt < REWED_MS) return `${x === a ? 'คุณ' : x.name}เพิ่งหย่า ต้องรอครบ 7 วันก่อนแต่งใหม่`;
  return '';
}

function marry(a, b, ring, t) {
  a.spouse = { login: key(b), name: b.name, ring, since: t };
  b.spouse = { login: key(a), name: a.name, ring, since: t };
}

function divorce(a, b, t) {
  a.spouse = null; a.divAt = t;
  if (b && b.spouse?.login === key(a)) { b.spouse = null; b.divAt = t; }
}

// 💞 love points for married couples (both records move together), their tier, and the weekly couple ranking
const LOVE_DAY = 30, TIERS = [[0, 'คู่ข้าวใหม่'], [100, 'คู่ทอง'], [500, 'คู่ตำนาน']];
const tier = lp => { let i = 0; while (i + 1 < TIERS.length && lp >= TIERS[i + 1][0]) i++; return { i, name: TIERS[i][1], next: TIERS[i + 1]?.[0] || 0 }; };
function loveAdd(a, b, day, wk) {
  for (const s of [a.spouse, b.spouse]) {
    if (s.ld !== day) { s.ld = day; s.ln = 0; }
    if (s.ln >= LOVE_DAY) continue;
    if (s.wl?.w !== wk) { if (s.wl && !s.wl.paid) s.wlp = s.wl; s.wl = { w: wk, n: 0 }; }
    s.ln++; s.lp = (s.lp || 0) + 1; s.wl.n++;
  }
  return a.spouse.lp;
}
// every finished, unpaid week: rank couples (each counted once), mark all paid, return the top 3 [{a, b, w, n, rank}]
function coupleAwards(accts, wk, get) {
  const weeks = new Map();
  for (const a of accts) for (const f of ['wlp', 'wl']) {
    const e = a.spouse?.[f]; if (!e || e.paid || !(e.w < wk) || !(e.n > 0)) continue;
    e.paid = 1; const b = get(a.spouse.login); if (!b || b.spouse?.login !== key(a)) continue;
    const k = [key(a), key(b)].sort().join('|'), L = weeks.get(e.w) || new Map(); weeks.set(e.w, L);
    if (!L.has(k)) L.set(k, { a, b, w: e.w, n: e.n });
  }
  const out = [];
  for (const L of weeks.values()) [...L.values()].sort((x, y) => y.n - x.n).slice(0, 3).forEach((x, i) => out.push({ ...x, rank: i + 1 }));
  return out;
}
module.exports = { bond, bondAdd, canPropose, marry, divorce, BOND_NEED, BOND_DAY, LOVE_DAY, TIERS, tier, loveAdd, coupleAwards };
