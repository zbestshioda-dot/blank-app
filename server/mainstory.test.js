'use strict';
// node server/mainstory.test.js — walks every choice path of the main story (run 1 and run 2) and checks all 6 endings can be reached.
const assert = require('assert'), M = require('./mainstory');
const D = require('./data'), ST = new Set(D.STATIONS.map(s => s.id));
// data sanity: stations, items, speakers
const FOLK = new Set([...D.FOLK.town, ...D.FOLK.housing, ...require('./deskfolk')].map(p => p.id));
for (const c of M.CH) for (const st of c.steps) {
  if (st.k === 'go') assert(ST.has(st.at), 'station ' + st.at);
  if (st.k === 'give') assert(D.ITEMS[st.item], 'item ' + st.item);
  if (st.npc) assert(FOLK.has(st.npc), 'npc ' + st.npc);
  const all = [...(st.lines || []), ...(st.opts || []).flatMap(o => o.lines)].map(l => Array.isArray(l) ? l[1] : l);
  for (const l of all) { const m = l.match(/^@(\w+):/); if (m) assert(FOLK.has(m[1]), 'speaker ' + m[1]); }
}
for (const k of M.LOVE) assert(FOLK.has(k));
const seen = new Set();
function walk(ms, ci, si, seenN) {
  const ch = M.CH[ci]; if (!ch) return;
  const st = ch.steps[si]; if (!st) return walk(ms, ci + 1, 0, seenN);
  if (st.k !== 'choice') { M.lines(st.lines, ms, seenN); return walk(ms, ci, si + 1, seenN); }
  for (const { o } of M.optsOf(st, ms, seenN)) {
    const m2 = JSON.parse(JSON.stringify(ms)); M.apply(m2, o); M.lines(o.lines, m2, seenN);
    if (o.end) { seen.add(`${ms.run}:` + M.endingOf(m2, o.end)); continue; }
    walk(m2, ci, si + 1, seenN);
  }
}
walk(M.fresh(1), 0, 0, 0);
walk(M.fresh(2), 0, 0, 3);
const got = new Set([...seen].map(x => x.split(':')[1]));
for (const k of M.END_ORDER) assert(got.has(k), 'ending not reachable: ' + k);
assert(![...seen].includes('1:secret'), 'secret must need a 2nd run');
assert(M.lines(['@{love}:hi {love}'], { f: { love: 'may' }, b: {}, run: 1 }, 0, () => 'เมย์')[0] === '@may:hi เมย์');
console.log('mainstory ok', [...seen].sort().join(' '));
