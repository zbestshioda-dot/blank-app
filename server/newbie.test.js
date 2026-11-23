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
