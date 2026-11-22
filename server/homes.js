'use strict';
// 🏡 house contest: visitors give a heart (once per house per day); the most hearts of the week (Mon–Sun, Thai time) win.
// Pure (no sockets/DB) so homes.test.js can run it. a.hl = this week { w, n, t, by: { visitor: day } }, a.hlp = last week { w, n, t }.
const MIN_AGE = 3 * 864e5;                         // accounts younger than this can like, but the heart does not count
const PRIZES = [{ money: 10000, gshard: 3 }, { money: 5000, gshard: 2 }, { money: 2500, gshard: 1 }];
const key = a => String(a.login).toLowerCase();

function like(o, v, { day, week, now }) {
  if (!o || !v || key(o) === key(v)) return { ok: false, msg: 'ถูกใจบ้านตัวเองไม่ได้นะ' };
  if (o.hl && o.hl.w !== week) { if (o.hl.n > 0) o.hlp = { w: o.hl.w, n: o.hl.n, t: o.hl.t, ...(o.hl.paid ? { paid: 1 } : {}) }; o.hl = null; }
  o.hl = o.hl || { w: week, n: 0, t: 0, by: {} };
  if (o.hl.by[key(v)] === day) return { ok: false, msg: 'วันนี้ถูกใจบ้านนี้ไปแล้ว พรุ่งนี้มาใหม่นะ' };
  o.hl.by[key(v)] = day;
  const counted = now - (v.created || now) >= MIN_AGE;
  if (counted) { o.hl.n++; o.hl.t = now; }
  return { ok: true, counted, msg: counted ? `❤️ ถูกใจบ้าน${o.name || ''}แล้ว` : '❤️ ถูกใจแล้ว (ไอดีใหม่ยังไม่ถึง 3 วัน หัวใจยังไม่นับคะแนน)' };
}

// finished weeks not paid yet -> [{ a, w, rank, n, prize }] (rank 1..3); every entry of those weeks is marked paid
function awards(list, curWeek) {
  const weeks = new Map();
  for (const a of list) for (const e of [a.hl, a.hlp]) if (e && e.w && e.w < curWeek && e.n > 0 && !e.paid) (weeks.get(e.w) || weeks.set(e.w, []).get(e.w)).push([a, e]);
  const out = [];
  for (const [w, rows] of weeks) {
    rows.sort((x, y) => y[1].n - x[1].n || x[1].t - y[1].t);
    rows.forEach(([a, e], i) => { e.paid = 1; if (i < PRIZES.length) out.push({ a, w, rank: i + 1, n: e.n, prize: PRIZES[i] }); });
  }
  return out;
}

const board = (list, week, top = 10) => list.filter(a => a.hl?.w === week && a.hl.n > 0)
  .sort((x, y) => y.hl.n - x.hl.n || x.hl.t - y.hl.t).slice(0, top).map(a => ({ n: a.name, hearts: a.hl.n }));

module.exports = { like, awards, board, PRIZES, MIN_AGE };
