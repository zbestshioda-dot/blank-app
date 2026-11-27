'use strict';
// node tools/hud.test.js — which HUD buttons a v2 newcomer sees (reads NB_HUD + hudVisible straight out of public/game.js)
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(require('path').join(__dirname, '../public/game.js'), 'utf8');
const i = src.indexOf('// ---- NB_HUD start'), j = src.indexOf('// ---- NB_HUD end');
if (i < 0 || j < 0) { console.log('FAIL NB_HUD block not found'); process.exit(1); }
const { NB_HUD, hudVisible } = new Function(src.slice(i, j) + '; return { NB_HUD, hudVisible };')();
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };

T('start: run hidden, act-only buttons are not in the table', () => {
  assert.equal(hudVisible('runBtn', [], false), false);
  assert.equal(NB_HUD.actBtn, undefined);
  assert.equal(hudVisible('actBtn', [], false), true);
});
T('run appears once the rod step is done', () => {
  assert.equal(hudVisible('runBtn', [1], false), true);
});
T('emoji only after the path', () => {
  assert.equal(hudVisible('emoBtn', [1, 3, 1, 1, 1, 1], false), false);
  assert.equal(hudVisible('emoBtn', [1], true), true);
});
T('the current step shows its button (chat when it is step 4)', () => {
  assert.equal(hudVisible('cbOpen', [1, 3, 1], false), true);
  assert.equal(hudVisible('cbOpen', [1, 3], false), false);
});
T("'end' buttons only after the path", () => {
  assert.equal(hudVisible('ev7Btn', [1, 3, 1, 1, 1, 1], false), false);
  assert.equal(hudVisible('ev7Btn', [1, 3, 1, 1, 1, 1], true), true);
});
