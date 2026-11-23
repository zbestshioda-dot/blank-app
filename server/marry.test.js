'use strict';
// node server/marry.test.js — closeness, proposing, marrying, divorcing
const assert = require('node:assert/strict');
const M = require('./marry');
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
const P = (login, o = {}) => ({ login, name: login.toUpperCase(), ...o });
const DAY = 864e5;

T('bondAdd: both sides grow together, capped per day', () => {
  const a = P('a'), b = P('b');
  for (let i = 0; i < 50; i++) M.bondAdd(a, b, 'd1');
  assert.equal(M.bond(a, b), M.BOND_DAY); assert.equal(M.bond(b, a), M.BOND_DAY);
  M.bondAdd(a, b, 'd2'); assert.equal(M.bond(a, b), M.BOND_DAY + 1);
});
const close = () => { const a = P('a', { ring: 'gold' }), b = P('b'); a.bond = { b: { v: M.BOND_NEED } }; b.bond = { a: { v: M.BOND_NEED } }; return [a, b]; };
T('canPropose: a ring and close friends -> ok', () => { const [a, b] = close(); assert.equal(M.canPropose(a, b, 0), ''); });
T('canPropose: refuses without a ring, not close, married, self, or too soon after a divorce', () => {
  let [a, b] = close(); a.ring = null; assert.notEqual(M.canPropose(a, b, 0), '');
  [a, b] = close(); a.bond.b.v = M.BOND_NEED - 1; assert.notEqual(M.canPropose(a, b, 0), '');
  [a, b] = close(); b.spouse = { login: 'c' }; assert.notEqual(M.canPropose(a, b, 0), '');
  [a, b] = close(); assert.notEqual(M.canPropose(a, a, 0), '');
  [a, b] = close(); b.divAt = 10; assert.notEqual(M.canPropose(a, b, 10 + 6 * DAY), '');
  assert.equal(M.canPropose(a, b, 10 + 7 * DAY + 1), '');
});
T('marry: both get each other, the ring tier and the day', () => {
  const [a, b] = close(); M.marry(a, b, 'gold', 5);
  assert.deepEqual(a.spouse, { login: 'b', name: 'B', ring: 'gold', since: 5 });
  assert.deepEqual(b.spouse, { login: 'a', name: 'A', ring: 'gold', since: 5 });
});
T('divorce: one side is enough; both are free and wait 7 days', () => {
  const [a, b] = close(); M.marry(a, b, 'silver', 0);
  M.divorce(a, b, 100);
  assert.equal(a.spouse, null); assert.equal(b.spouse, null); assert.equal(a.divAt, 100); assert.equal(b.divAt, 100);
});
T('divorce: works even if the partner account is gone', () => {
  const a = P('a', { spouse: { login: 'x', name: 'X', ring: 'silver', since: 0 } });
  M.divorce(a, null, 5); assert.equal(a.spouse, null);
});

// 💞 love points: married pairs near each other; tiers; the weekly couple ranking
const wed = () => { const a = P('a'), b = P('b'); M.marry(a, b, 'silver', 0); return [a, b]; };
T('loveAdd: both grow, 30 a day, weekly count kept', () => {
  const [a, b] = wed();
  for (let i = 0; i < 40; i++) M.loveAdd(a, b, 'd1', 'w1');
  assert.equal(a.spouse.lp, M.LOVE_DAY); assert.equal(b.spouse.lp, M.LOVE_DAY);
  assert.equal(a.spouse.wl.n, M.LOVE_DAY);
  M.loveAdd(a, b, 'd2', 'w1'); assert.equal(a.spouse.lp, M.LOVE_DAY + 1); assert.equal(a.spouse.wl.n, M.LOVE_DAY + 1);
});
T('loveAdd: a new week keeps last week (unpaid) for the awards', () => {
  const [a, b] = wed(); M.loveAdd(a, b, 'd1', 'w1'); M.loveAdd(a, b, 'd8', 'w2');
  assert.deepEqual(a.spouse.wlp, { w: 'w1', n: 1 }); assert.deepEqual(a.spouse.wl, { w: 'w2', n: 1 });
});
T('tier: 0 / 100 / 500', () => {
  assert.equal(M.tier(0).i, 0); assert.equal(M.tier(99).i, 0); assert.equal(M.tier(100).i, 1); assert.equal(M.tier(500).i, 2);
});
T('coupleAwards: past week ranked once per couple, top 3, paid once', () => {
  const cs = [5, 9, 7, 3].map((n, i) => { const a = P('a' + i), b = P('b' + i); M.marry(a, b, 'silver', 0); for (const x of [a, b]) x.spouse.wl = { w: 'w1', n }; return [a, b]; });
  const all = cs.flat(), get = l => all.find(x => x.login === l);
  const r = M.coupleAwards(all, 'w2', get);
  assert.deepEqual(r.map(x => [x.rank, x.n]), [[1, 9], [2, 7], [3, 5]]);
  assert.ok(r[0].a && r[0].b && r[0].a !== r[0].b);
  assert.ok(all.every(x => x.spouse.wl.paid));
  assert.equal(M.coupleAwards(all, 'w2', get).length, 0);
  assert.equal(M.coupleAwards(all, 'w1', get).length, 0);   // the current week is not judged yet
});
