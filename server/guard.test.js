'use strict';
// node server/guard.test.js — "are you a person?" checks against auto-play tools
const assert = require('node:assert/strict');
const G = require('./guard');
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
const MIN = 60e3;

T('run: 2 hours of nonstop actions asks for a check', () => {
  const a = {}; let ask = false;
  for (let t = 0; t <= G.RUN_MS; t += MIN) ask = G.run(a, t) || ask;
  assert.equal(ask, true);
});
T('run: a 10-minute break starts the count again', () => {
  const a = {}; let ask = false;
  for (let t = 0; t < G.RUN_MS - 5 * MIN; t += MIN) ask = G.run(a, t) || ask;
  for (let t = G.RUN_MS + 6 * MIN; t < G.RUN_MS * 1.5; t += MIN) ask = G.run(a, t) || ask;
  assert.equal(ask, false);
});
T('run: after passing a check, no new one for an hour', () => {
  const a = { hcOk: 0 }; let asks = 0;
  for (let t = 0; t <= G.RUN_MS + 30 * MIN; t += MIN) if (G.run(a, t)) { asks++; a.hcOk = t; }
  assert.equal(asks, 1);
});
T('ask: makes a token with an on-screen spot and a deadline', () => {
  const a = {}, q = G.ask(a, 'bot', 1000, () => .5);
  assert.ok(q.tok && q.x > 0 && q.x < 1 && q.y > 0 && q.y < 1);
  assert.equal(a.hc.until, 1000 + G.ANSWER_MS);
  assert.equal(G.ask(a, 'bot', 2000), null, 'one check at a time');
});
T('answer: the right token clears it; a wrong one does not', () => {
  const a = {}; const q = G.ask(a, 'bot', 0, () => .5);
  assert.equal(G.answer(a, 'nope', 3000).ok, false); assert.ok(a.hc);
  const r = G.answer(a, q.tok, 3000); assert.equal(r.ok, true); assert.equal(r.fast, false);
  assert.equal(a.hc, null); assert.equal(a.hcOk, 3000);
});
T('answer: a tap faster than a person can see it is marked', () => {
  const a = {}; const q = G.ask(a, 'bot', 0, () => .5);
  assert.equal(G.answer(a, q.tok, 150).fast, true);
});
T('blocked: work is held while a check waits, and after it runs out', () => {
  const a = {}; G.ask(a, 'bot', 0, () => .5);
  assert.equal(G.blocked(a, 1000), 'wait');
  assert.equal(G.blocked(a, G.ANSWER_MS + 1), 'late');
  assert.equal(G.blocked({}, 0), null);
});

// 💤 daily soft cap: full pay for the first 3 hours of work a day, then less
T('payMul: full pay for the first 3 hours of the day', () => {
  const a = {};
  for (let i = 0; i < 180; i++) G.workMin(a, i * MIN, 'd1');
  assert.equal(G.payMul(a, 'd1'), 1);
});
T('payMul: half after 3 hours, a fifth after 5 hours', () => {
  const a = {};
  for (let i = 0; i < 181; i++) G.workMin(a, i * MIN, 'd1');
  assert.equal(G.payMul(a, 'd1'), .5);
  for (let i = 181; i < 301; i++) G.workMin(a, i * MIN, 'd1');
  assert.equal(G.payMul(a, 'd1'), .2);
});
T('workMin: many actions in one minute count once; a new day starts over', () => {
  const a = {};
  for (let i = 0; i < 50; i++) G.workMin(a, 1000 + i, 'd1');
  assert.equal(a.wk.m, 1);
  for (let i = 0; i < 400; i++) G.workMin(a, i * MIN, 'd1');
  assert.equal(G.payMul(a, 'd2'), 1);
  G.workMin(a, 999 * MIN, 'd2'); assert.equal(a.wk.m, 1);
});
T('workMin: says when a step is crossed (once)', () => {
  const a = {}; const steps = [];
  for (let i = 0; i < 400; i++) { const s = G.workMin(a, i * MIN, 'd1'); if (s) steps.push(s); }
  assert.deepEqual(steps, [.5, .2]);
});
