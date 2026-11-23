'use strict';
// node server/doc.test.js — doctor answer-timing flags shown to admins
const assert = require('node:assert/strict');
const { docFlag } = require('./doc');
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
const log = (n, ms, ok = 1) => Array.from({ length: n }, (_, i) => [typeof ms === 'function' ? ms(i) : ms, ok]);

T('fewer than 20 answers: no verdict', () => assert.equal(docFlag({ docLog: log(19, 500) }), null));
T('fast, right and human-uneven: suspicious, not robotic', () => {
  const f = docFlag({ docLog: log(40, i => 300 + (i * 137) % 700) });
  assert.equal(f.sus, 1); assert.equal(f.bot, 0); assert.ok(f.sd >= 150);
});
T('the same reaction time every case: robotic', () => {
  const f = docFlag({ docLog: log(40, i => 500 + (i % 3) * 20) });
  assert.equal(f.bot, 1); assert.ok(f.sd < 150);
});
T('slow or often wrong players are never flagged', () => {
  assert.equal(docFlag({ docLog: log(40, 3000) }).sus, 0);
  const half = [...log(20, 500, 1), ...log(20, 500, 0)];
  const f = docFlag({ docLog: half }); assert.equal(f.sus, 0); assert.equal(f.bot, 0);
});
