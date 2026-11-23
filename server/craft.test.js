'use strict';
// node server/craft.test.js — crafting rules (no server, no DB needed)
const assert = require('node:assert/strict');
const D = require('./data');
const C = require('./craft');

const P = (o = {}) => ({ inv: {}, gems: 0, furniture: [], keep: [], hown: { tier: 0 }, ...o });
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };

T('data: every recipe input is an item, every output is craft-only furniture', () => {
  assert.ok(D.CRAFTS.length >= 6);
  for (const r of D.CRAFTS) {
    for (const k of Object.keys(r.in)) assert.ok(D.ITEMS[k], `${r.id}: unknown input ${k}`);
    assert.equal(D.FURNITURE[r.id]?.craft, 1, `${r.id} not craft furniture`);
  }
  assert.ok(D.CRAFTS.some(r => r.in.gshard && D.FURNITURE[r.id].glow), 'a legend recipe with a glow');
  assert.equal(D.ITEMS.gshard.nosell, 1);
});

T('drop: a roll under the chance gives the material', () => {
  const a = P();
  const got = C.drop(a, 'fish', D, () => 0);
  assert.ok(got.includes('shell'));
  assert.equal(a.inv.shell, 1);
});
T('drop: a high roll gives nothing; unknown keys give nothing', () => {
  const a = P();
  assert.deepEqual(C.drop(a, 'fish', D, () => .99), []);
  assert.deepEqual(C.drop(a, 'casino', D, () => 0), []);
  assert.deepEqual(a.inv, {});
});

const r0 = () => D.CRAFTS[0];
const fill = r => Object.fromEntries(Object.entries(r.in));
T('craft: takes the inputs and gives the piece (to the home)', () => {
  const r = r0(), a = P({ inv: fill(r) });
  const res = C.craft(a, r.id, D);
  assert.equal(res.ok, true);
  assert.ok(a.furniture.includes(r.id));
  assert.deepEqual(a.inv, {});
});
T('craft: no home -> the piece goes to storage (keep)', () => {
  const r = r0(), a = P({ inv: fill(r), hown: null });
  assert.equal(C.craft(a, r.id, D).ok, true);
  assert.ok(a.keep.includes(r.id) && !a.furniture.includes(r.id));
});
T('craft: one input short -> refused, nothing taken', () => {
  const r = r0(), inv = fill(r), k = Object.keys(inv)[0]; inv[k] -= 1;
  const a = P({ inv: { ...inv } });
  assert.equal(C.craft(a, r.id, D).ok, false);
  assert.deepEqual(a.inv, Object.fromEntries(Object.entries(inv).filter(([, q]) => q > 0)));
  assert.deepEqual(a.furniture, []);
});
T('craft: already own it -> refused, inputs kept', () => {
  const r = r0(), a = P({ inv: fill(r), furniture: [r.id] });
  assert.equal(C.craft(a, r.id, D).ok, false);
  assert.deepEqual(a.inv, fill(r));
});
T('craft: unknown recipe -> refused', () => assert.equal(C.craft(P(), 'nope', D).ok, false));

T('buyShard: pays gems, gives shards, clamps 1..10', () => {
  const a = P({ gems: 1000 });
  assert.equal(C.buyShard(a, 50, D).ok, true);
  assert.equal(a.inv.gshard, 10);
  assert.equal(a.gems, 1000 - 10 * D.SHARD_GEMS);
  const b = P({ gems: 1000 });
  C.buyShard(b, 'x', D); assert.equal(b.inv.gshard, 1);
});
T('buyShard: not enough gems -> refused, gems unchanged', () => {
  const a = P({ gems: D.SHARD_GEMS - 1 });
  assert.equal(C.buyShard(a, 1, D).ok, false);
  assert.equal(a.gems, D.SHARD_GEMS - 1);
  assert.equal(a.inv.gshard, undefined);
});

// ❄️ December-only materials and recipes
T('drop: a December-only material drops only in December', () => {
  const a = P(), b = P();
  assert.ok(!C.drop(a, 'fish', D, () => 0, 11).includes('snow'));
  assert.ok(C.drop(b, 'fish', D, () => 0, 12).includes('snow'));
});
T('craft: a December recipe is refused in other months, nothing taken', () => {
  const r = D.CRAFTS.find(x => x.season === 12); assert.ok(r, 'a December recipe exists');
  const a = P({ inv: fill(r) });
  assert.equal(C.craft(a, r.id, D, 11).ok, false);
  assert.deepEqual(a.inv, fill(r));
  assert.equal(C.craft(a, r.id, D, 12).ok, true);
});
