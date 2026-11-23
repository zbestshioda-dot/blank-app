'use strict';
// node server/auction.test.js — weekly one-of-a-kind auction rules (no server, no DB needed)
const assert = require('node:assert/strict');
const AU = require('./auction');

const LOTS = ['auc_a', 'auc_b'];
const P = login => ({ login, name: login.toUpperCase() });
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };

T('roll: a fresh auction opens on the first lot', () => {
  const r = AU.roll(null, 'w1', LOTS);
  assert.equal(r.state.lot, 'auc_a'); assert.equal(r.state.w, 'w1'); assert.equal(r.state.bid, 0); assert.equal(r.ended, null);
});
T('bid: below the minimum is refused', () => {
  const s = AU.roll(null, 'w1', LOTS).state;
  assert.equal(AU.bid(s, P('a'), AU.MIN - 1).ok, false);
  assert.equal(s.bid, 0);
});
T('bid: a valid bid leads; the next must be 5% higher; the old leader is refunded', () => {
  const s = AU.roll(null, 'w1', LOTS).state;
  const r1 = AU.bid(s, P('a'), AU.MIN);
  assert.equal(r1.ok, true); assert.equal(r1.refund, null); assert.equal(s.by, 'a');
  assert.equal(AU.next(s), Math.ceil(AU.MIN * 1.05 / 100) * 100);
  assert.equal(AU.bid(s, P('b'), AU.next(s) - 1).ok, false);
  const r2 = AU.bid(s, P('B'), AU.next(s));
  assert.equal(r2.ok, true); assert.deepEqual(r2.refund, { login: 'a', amt: AU.MIN }); assert.equal(s.by, 'b');
});
T('bid: the leader cannot outbid themself', () => {
  const s = AU.roll(null, 'w1', LOTS).state; AU.bid(s, P('a'), AU.MIN);
  assert.equal(AU.bid(s, P('A'), 999999).ok, false);
});
T('bid: junk amounts are refused', () => {
  const s = AU.roll(null, 'w1', LOTS).state;
  for (const x of [NaN, 'abc', -5, Infinity]) assert.equal(AU.bid(s, P('a'), x).ok, false);
  assert.equal(s.bid, 0);
});
T('roll: a new week sells the lot to the leader and opens the next lot', () => {
  const s = AU.roll(null, 'w1', LOTS).state; AU.bid(s, P('a'), 20000);
  const r = AU.roll(s, 'w2', LOTS);
  assert.deepEqual(r.ended, { lot: 'auc_a', login: 'a', name: 'A', bid: 20000 });
  assert.equal(r.state.lot, 'auc_b'); assert.equal(r.state.bid, 0); assert.deepEqual(r.state.done, ['auc_a']);
});
T('roll: no bids -> the same lot runs again next week', () => {
  const s = AU.roll(null, 'w1', LOTS).state;
  const r = AU.roll(s, 'w2', LOTS);
  assert.equal(r.ended, null); assert.equal(r.state.lot, 'auc_a'); assert.equal(r.state.w, 'w2');
});
T('roll: same week changes nothing', () => {
  const s = AU.roll(null, 'w1', LOTS).state; AU.bid(s, P('a'), AU.MIN);
  const r = AU.roll(s, 'w1', LOTS); assert.equal(r.ended, null); assert.equal(r.state.by, 'a');
});
T('all lots sold -> nothing on sale, bids refused', () => {
  let s = AU.roll(null, 'w1', LOTS).state; AU.bid(s, P('a'), AU.MIN);
  s = AU.roll(s, 'w2', LOTS).state; AU.bid(s, P('b'), AU.MIN);
  s = AU.roll(s, 'w3', LOTS).state;
  assert.equal(s.lot, null); assert.equal(AU.bid(s, P('c'), AU.MIN).ok, false);
});
