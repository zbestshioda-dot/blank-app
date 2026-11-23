'use strict';
// node server/newbie.test.js — newcomer (v2) rules: event log, funnel, egg, day-2 gift, first fish (no server, no DB needed)
const assert = require('node:assert/strict');
const N = require('./newbie');

const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
const v2 = (o = {}) => ({ nb: { ...N.start(1000), ...o } });

// ---- Task 1: event log + funnel
T('start: v2 shape', () => {
  assert.deepEqual(N.start(5), { p: [], t0: 5, v: 2, ev: {} });
});
T('isV2: only v2 newcomers', () => {
  assert.equal(N.isV2(v2()), true);
  assert.equal(N.isV2({ nb: { p: [] } }), false);
  assert.equal(N.isV2({}), false);
});
T('mark: first time only', () => {
  const a = v2();
  assert.equal(N.mark(a, 'move', 10), true);
  assert.equal(N.mark(a, 'move', 20), false);
  assert.equal(a.nb.ev.move, 10);
});
T('mark: rejects unknown key and v1', () => {
  const a = v2();
  assert.equal(N.mark(a, 'xyz', 1), false);
  assert.equal(N.mark({ nb: { p: [] } }, 'move', 1), false);
  assert.equal(N.mark(a, 's3', 1), true);
  assert.equal(N.mark(a, 'tut', 1), true);
});
T('funnel: counts v2 accounts in order', () => {
  const dayNumOf = t => Math.floor(t / 86400e3) + 1;   // t0 = 1000 → day 1
  const a = v2({ ev: { tut: 1, move: 2 } }), b = v2({ ev: { tut: 1 } }), c = v2();
  a.seen = [1, 2]; b.seen = [1];
  const f = N.funnel([a, b, c, { nb: { p: [] } }, {}], dayNumOf);
  assert.equal(f.n, 3);
  assert.deepEqual(f.rows.find(r => r[0] === 'ปิดบทสอน'), ['ปิดบทสอน', 2]);
  assert.deepEqual(f.rows.find(r => r[0] === 'เดินครั้งแรก'), ['เดินครั้งแรก', 1]);
  assert.equal(f.rows[0][1], 3);
  assert.equal(f.back, 1);
});
T('realMove: ignores the spawn nudge right after login', () => {
  assert.equal(N.realMove({ loginAt: 1000 }, 1800), false);
  assert.equal(N.realMove({ loginAt: 1000 }, 4500), true);
});

// ---- Task 2: egg tomorrow, day-2 gift, what the phone is sent
T('egg: needs steps 0-2', () => {
  assert.equal(N.eggDue(v2({ p: [1, 3, 0] })), false);
  assert.equal(N.eggDue(v2({ p: [1, 3, 1] })), true);
});
T('egg out of order: chat undone still gets it, never twice', () => {
  const a = v2({ p: [1, 3, 1, 0, 0, 0] });
  assert.equal(N.eggDue(a), true);
  a.nb.egg = { d: '2026-11-23' };
  assert.equal(N.eggDue(a), false);
});
T('eggReady: next Thai day only, once', () => {
  const a = v2({ egg: { d: '2026-11-23' } });
  assert.equal(N.eggReady(a, '2026-11-23'), false);
  assert.equal(N.eggReady(a, '2026-11-24'), true);
  a.nb.egg.h = '2026-11-24';
  assert.equal(N.eggReady(a, '2026-11-25'), false);
});
T('gift2: once, on any later day', () => {
  const a = v2();
  assert.equal(N.giftDue(a, '2026-11-23', '2026-11-23'), false);
  assert.equal(N.giftDue(a, '2026-11-27', '2026-11-23'), true);
  a.nb.g2 = '2026-11-27';
  assert.equal(N.giftDue(a, '2026-11-28', '2026-11-23'), false);
  assert.deepEqual(N.GIFT2, { money: 500, items: { bento: 2 } });
});
T('v1 untouched', () => {
  const a = { nb: { p: [1, 3, 1] } };
  assert.equal(N.eggDue(a), false);
  assert.equal(N.giftDue(a, '2026-11-30', '2026-11-23'), false);
  assert.deepEqual(N.view(a, '2026-11-23', '2026-11-23'), { p: [1, 3, 1] });
  assert.equal(N.view({ nb: { p: [1], done: 5 } }, '2026-11-23', '2026-11-23'), null);
});
T('nbView keeps day 1', () => {
  const a = v2({ p: [1, 3, 1, 1, 1, 1], done: 2000, egg: { d: '2026-11-23' } });
  const v = N.view(a, '2026-11-23', '2026-11-23');
  assert.equal(v.v, 2); assert.equal(v.done, 2000); assert.deepEqual(v.egg, { d: '2026-11-23' });
  assert.notEqual(N.view(a, '2026-11-24', '2026-11-23'), null);           // the egg has not hatched yet
  a.nb.egg.h = '2026-11-24';
  assert.equal(N.view(a, '2026-11-24', '2026-11-23'), null);
  assert.equal(N.view({}, '2026-11-24', '2026-11-23'), null);
});
