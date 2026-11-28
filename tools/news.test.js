'use strict';
// node tools/news.test.js — the update pop-up only shows when NEWS[0].v is new to the player:
// a reused id means players who saw the old entry never see the new one.
const src = require('fs').readFileSync(require('path').join(__dirname, '../public/game.js'), 'utf8');
const i = src.indexOf('const NEWS = ['), ids = [...src.slice(i).matchAll(/\{ v: '([^']+)'/g)].map(m => m[1]);
const dup = ids[0] && ids.indexOf(ids[0]) !== ids.lastIndexOf(ids[0]) ? [ids[0]] : [];
if (!ids.length) { console.log('FAIL NEWS not found'); process.exit(1); }
if (dup.length) { console.log('FAIL NEWS ids reused (pick a new id):', [...new Set(dup)].join(', ')); process.exit(1); }
console.log('ok   NEWS top id', ids[0], 'is unique');
