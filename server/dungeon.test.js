'use strict';
// node server/dungeon.test.js — the treasure cave: doors, fights, traps, cashing out, dying, weekly ranking
const assert = require('node:assert/strict');
const DG = require('./dungeon');
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.stack); process.exitCode = 1; } };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };   // scripted dice
const R = () => Math.random();

T('start: floor 1, full hp, 3 doors with hints, 2 potions', () => {
  const g = DG.start(R); assert.equal(g.f, 1); assert.equal(g.hp, g.mhp); assert.equal(g.doors.length, 3); assert.equal(g.pot, 2);
  for (const d of g.doors) { assert.ok(DG.KINDS[d.k]); assert.ok(DG.HINT[d.h]); }
});
T('every 5th floor is a single boss door', () => {
  const g = DG.start(R); g.f = 5; DG.newDoors(g, R); assert.equal(g.doors.length, 1); assert.equal(g.doors[0].k, 'boss');
});
T('treasure: money goes in the bag, next floor', () => {
  const g = DG.start(R); g.doors = [{ k: 'gold', h: 'gold' }]; const m0 = g.bag.money;
  DG.pick(g, 0, seq(.5)); assert.ok(g.bag.money > m0); assert.equal(g.f, 2); assert.equal(g.doors.length, 3);
});
T('monster: a fight until it falls; loot; next floor', () => {
  const g = DG.start(R); g.doors = [{ k: 'mon', h: 'mon' }]; DG.pick(g, 0, R); assert.ok(g.mon);
  g.atk = 999; DG.act(g, 'atk', seq(.5)); assert.equal(g.mon, null); assert.equal(g.f, 2); assert.ok(g.bag.money > 0);
});
T('monster hits back; dying ends the run and keeps 30% of the money', () => {
  const g = DG.start(R); g.bag.money = 1000; g.doors = [{ k: 'mon', h: 'mon' }]; DG.pick(g, 0, R);
  g.atk = 0; g.hp = 1; g.mon.atk = 50; DG.act(g, 'atk', seq(.5)); assert.equal(g.over, 'dead');
  assert.deepEqual(DG.payout(g), { money: 300, shard: 0, coin: 0, crystal: 0 });
});
T('defend takes much less damage than attacking', () => {
  const g = DG.start(R); g.doors = [{ k: 'mon', h: 'mon' }]; DG.pick(g, 0, R); g.mon.hp = 9999; g.mon.atk = 20; g.def = 0;
  const h0 = g.hp; DG.act(g, 'def', seq(.5)); const lostDef = h0 - g.hp;
  g.hp = h0; DG.act(g, 'atk', seq(.5)); const lostAtk = h0 - g.hp; assert.ok(lostDef < lostAtk, `${lostDef} < ${lostAtk}`);
});
T('potion heals and is used up; no potion -> nothing', () => {
  const g = DG.start(R); g.hp = 1; DG.act(g, 'pot', R); assert.ok(g.hp > 1); assert.equal(g.pot, 1);
  g.pot = 0; const h = g.hp; DG.act(g, 'pot', R); assert.equal(g.hp, h);
});
T('trap hurts (never below 1); cat boots dodge it', () => {
  const g = DG.start(R); g.doors = [{ k: 'trap', h: 'trap' }]; DG.pick(g, 0, seq(.5)); assert.ok(g.hp < g.mhp && g.hp >= 1);
  const h = DG.start(R); h.relics = ['boots']; h.doors = [{ k: 'trap', h: 'trap' }]; DG.pick(h, 0, seq(.5)); assert.equal(h.hp, h.mhp);
});
T('leave: only between fights; the whole bag is paid', () => {
  const g = DG.start(R); g.bag = { money: 500, shard: 2, coin: 3, crystal: 1 }; assert.ok(DG.leave(g)); assert.equal(g.over, 'out');
  assert.deepEqual(DG.payout(g), { money: 500, shard: 2, coin: 3, crystal: 1 });
  const h = DG.start(R); h.doors = [{ k: 'mon', h: 'mon' }]; DG.pick(h, 0, R); assert.equal(DG.leave(h), false);
});
T('no actions after the run is over', () => {
  const g = DG.start(R); DG.leave(g); const f = g.f; DG.pick(g, 0, R); assert.equal(g.f, f);
});
T('weekly: best floor per player, top 3 of a finished week, paid once', () => {
  const P = (login, f) => ({ login, name: login, dgw: { w: 'w1', f } });
  const ps = [P('a', 4), P('b', 12), P('c', 9), P('d', 7)];
  const r = DG.weekly(ps, 'w2'); assert.deepEqual(r.map(x => [x.rank, x.a.login]), [[1, 'b'], [2, 'c'], [3, 'd']]);
  assert.equal(DG.weekly(ps, 'w2').length, 0); assert.equal(DG.weekly([P('z', 3)], 'w1').length, 0);
});
