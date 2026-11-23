'use strict';
// node server/homes.test.js — house-contest rules (no server, no DB needed)
const assert = require('node:assert/strict');
const H = require('./homes');

const DAY = 864e5, NOW = Date.parse('2026-11-25T12:00:00Z');
const ctx = (o = {}) => ({ day: '2026-11-25', week: '2026-11-23', now: NOW, ...o });
const A = (login, o = {}) => ({ login, created: NOW - 30 * DAY, ...o });
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };

T('like: counts a heart from an old account', () => {
  const o = A('owner'), v = A('Visitor');
  const r = H.like(o, v, ctx());
  assert.equal(r.ok, true); assert.equal(r.counted, true);
  assert.equal(o.hl.n, 1); assert.equal(o.hl.w, '2026-11-23');
});
T('like: once per visitor per house per day', () => {
  const o = A('owner'), v = A('v');
  H.like(o, v, ctx());
  assert.equal(H.like(o, v, ctx()).ok, false);
  assert.equal(o.hl.n, 1);
  assert.equal(H.like(o, v, ctx({ day: '2026-11-26' })).ok, true);
  assert.equal(o.hl.n, 2);
});
T('like: your own house is refused', () => {
  const o = A('owner');
  assert.equal(H.like(o, o, ctx()).ok, false);
  assert.equal(o.hl, undefined);
});
T('like: accounts younger than 3 days are accepted but not counted', () => {
  const o = A('owner'), v = A('new', { created: NOW - 2 * DAY });
  const r = H.like(o, v, ctx());
  assert.equal(r.ok, true); assert.equal(r.counted, false);
  assert.equal(o.hl?.n || 0, 0);
  assert.equal(H.like(o, v, ctx()).ok, false, 'still once a day');
});
T('like: a new week starts from 0 and keeps last week for the prizes', () => {
  const o = A('owner');
  H.like(o, A('v1'), ctx());
  H.like(o, A('v2'), ctx({ week: '2026-11-30', day: '2026-11-30' }));
  assert.equal(o.hl.w, '2026-11-30'); assert.equal(o.hl.n, 1);
  assert.deepEqual([o.hlp.w, o.hlp.n], ['2026-11-23', 1]);
});

T('awards: top 3 of a finished week, most hearts first, once only', () => {
  const mk = (login, n, t) => A(login, { hl: { w: '2026-11-23', n, t, by: {} } });
  const list = [mk('a', 5, 3), mk('b', 9, 1), mk('c', 5, 1), mk('d', 2, 1), mk('e', 0, 1)];
  const res = H.awards(list, '2026-11-30');
  assert.deepEqual(res.map(x => [x.a.login, x.rank]), [['b', 1], ['c', 2], ['a', 3]]);   // tie on 5: who got there first
  assert.deepEqual(res[0].prize, H.PRIZES[0]);
  assert.deepEqual(H.awards(list, '2026-11-30'), [], 'never paid twice');
});
T('awards: the running week is not paid', () => {
  const list = [A('a', { hl: { w: '2026-11-30', n: 4, t: 1, by: {} } })];
  assert.deepEqual(H.awards(list, '2026-11-30'), []);
});
T('awards: last week kept in hlp is paid after the owner already liked into a new week', () => {
  const o = A('owner', { hl: { w: '2026-11-30', n: 1, t: 2, by: {} }, hlp: { w: '2026-11-23', n: 3, t: 1 } });
  const res = H.awards([o], '2026-11-30');
  assert.equal(res.length, 1); assert.equal(res[0].rank, 1);
});
T('board: this week, most hearts first', () => {
  const list = [A('a', { name: 'A', hl: { w: '2026-11-23', n: 2, t: 1 } }), A('b', { name: 'B', hl: { w: '2026-11-23', n: 7, t: 1 } }), A('c', { name: 'C', hl: { w: '2026-11-16', n: 99, t: 1 } })];
  assert.deepEqual(H.board(list, '2026-11-23').map(x => [x.n, x.hearts]), [['B', 7], ['A', 2]]);
});
