'use strict';
// 🔨 crafting rules: material drops, the workshop recipes, gem shards. Pure (no sockets/DB) so craft.test.js can run it.
const thMonth = () => new Date(Date.now() + 7 * 3600e3).getUTCMonth() + 1;   // Thai calendar month 1..12
const add = (a, id, n) => { a.inv[id] = (a.inv[id] || 0) + n; if (a.inv[id] <= 0) delete a.inv[id]; };

// one roll per material listed for this stat key; returns the ids that dropped
function drop(a, key, D, rnd = Math.random, month = thMonth()) {
  const got = [];
  for (const [id, p, only] of D.MAT_DROPS[key] || []) if ((!only || only === month) && rnd() < p) { add(a, id, 1); got.push(id); }
  return got;
}

function craft(a, rid, D, month = thMonth()) {
  const r = D.CRAFTS.find(x => x.id === rid), f = D.FURNITURE[rid];
  if (!r || !f) return { ok: false, msg: 'ไม่มีสูตรนี้' };
  if (r.season && r.season !== month) return { ok: false, msg: 'สูตรนี้คราฟได้เฉพาะเดือนธันวาคม 🎄' };
  if ([...(a.furniture || []), ...(a.keep || [])].includes(rid)) return { ok: false, msg: `มี${f.name}แล้ว` };
  const miss = Object.entries(r.in).filter(([k, q]) => (a.inv[k] || 0) < q);
  if (miss.length) return { ok: false, msg: 'วัตถุดิบไม่พอ: ' + miss.map(([k, q]) => `${D.ITEMS[k].icon}${D.ITEMS[k].name} ${a.inv[k] || 0}/${q}`).join(' · ') };
  for (const [k, q] of Object.entries(r.in)) add(a, k, -q);
  if (a.hown) a.furniture = [...(a.furniture || []), rid];
  else a.keep = [...(a.keep || []), rid];   // no home yet: kept until they buy one
  return { ok: true, msg: `คราฟ ${f.icon}${f.name} สำเร็จ!`, f };
}

function buyShard(a, n, D) {
  n = Math.min(10, Math.max(1, Math.floor(+n) || 1));
  const cost = n * D.SHARD_GEMS;
  if ((a.gems || 0) < cost) return { ok: false, msg: `เพชรไม่พอ ต้องใช้ 💎${cost} (มี 💎${a.gems || 0})` };
  a.gems -= cost; add(a, 'gshard', n);
  return { ok: true, msg: `ได้ 💎 ชิ้นส่วนเพชร x${n}`, n };
}

module.exports = { drop, craft, buyShard, thMonth };
