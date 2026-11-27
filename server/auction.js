'use strict';
// 🏆 weekly auction of one-of-a-kind furniture, paid in baht (a money sink). One lot per week (Mon–Sun, Thai time);
// the money is taken when you bid and handed back when someone outbids you. Pure: index.js does the paying and mailing.
// state = { w, lot, bid, by, name, done: [] }
const MIN = 10000;
const key = a => String(a.login).toLowerCase();
const next = s => s.bid ? Math.ceil(s.bid * 1.05 / 100) * 100 : MIN;

function roll(s, week, lots) {
  if (s && s.w === week) return { state: s, ended: null };
  const done = [...(s?.done || [])];
  let ended = null;
  if (s && s.lot && s.bid > 0) { ended = { lot: s.lot, login: s.by, name: s.name, bid: s.bid }; done.push(s.lot); }
  const lot = ended || !s ? lots.find(l => !done.includes(l)) ?? null : s.lot;
  return { state: { w: week, lot, bid: 0, by: null, name: null, done }, ended };
}

function bid(s, a, amt) {
  amt = Number(amt);
  if (!s?.lot) return { ok: false, msg: 'ตอนนี้ไม่มีของประมูล' };
  if (!Number.isFinite(amt) || amt !== Math.floor(amt)) return { ok: false, msg: 'ใส่ราคาเป็นตัวเลข' };
  if (s.by === key(a)) return { ok: false, msg: 'คุณเป็นผู้นำการประมูลอยู่แล้ว' };
  if (amt < next(s)) return { ok: false, msg: `ต้องเสนออย่างน้อย ${next(s).toLocaleString('en-US')} LC` };
  const refund = s.by ? { login: s.by, amt: s.bid } : null;
  s.bid = amt; s.by = key(a); s.name = a.name;
  return { ok: true, refund };
}

module.exports = { roll, bid, next, MIN };
