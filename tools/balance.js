// Balance snapshot: job XP curve + price ladders from the real game data.
// Run: node tools/balance.js   (formulas mirror server/index.js: xpNeed, xpGain, jobPay, TAX, LOGIN_BONUS)
const D = require('../server/data.js');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../server/index.js', 'utf8');
const grab = re => (src.match(re) || [])[1];
const JOB_MAX = +grab(/const JOB_MAX = (\d+)/);
const xpNeed = eval(grab(/const xpNeed = (L => [^;]+);/));
const xpGain = eval(grab(/const xpGain = (L => [^;]+);/));
const payMul = L => 1 + +grab(/const jobPay = a => 1 \+ ([\d.]+)/) * (L - 1);
const TAX = eval(grab(/const TAX = (\[\[.*?\]\]);/));
const LOGIN = eval(grab(/const LOGIN_BONUS = (\[[^\]]+\]);/));
const baht = n => '฿' + Math.round(n).toLocaleString();

console.log('== Job levels (actions = job tasks done, XP 1 each before the xpGain cut) ==');
let acts = 0;
for (let L = 1; L < JOB_MAX; L++) {
  acts += xpNeed(L) / xpGain(L);
  if ([2, 5, 10, 15, 20, 30, 40, 49].includes(L)) console.log(`Lv${L + 1}: ~${Math.round(acts)} actions total · pay x${payMul(L + 1).toFixed(2)}`);
}
console.log('\n== Tax (per real day) ==', TAX.map(([hi, r]) => `${hi === Infinity ? 'above' : '≤' + baht(hi)}: ${r * 100}%`).join(' · '));
console.log('== Login bonus days 1-7 ==', LOGIN.map(baht).join(' '), '· week total', baht(LOGIN.reduce((a, b) => a + b, 0)));

const ladder = (title, rows) => { console.log(`\n== ${title} ==`); rows.sort((a, b) => a[1] - b[1]).forEach(([n, p]) => console.log(`${baht(p).padStart(12)}  ${n}`)); };
ladder('Homes', D.HOME_TIERS.map(h => [h.name, h.price]));
ladder('Vehicles', Object.values(D.VEHICLES).filter(v => v.price).map(v => [`${v.name} (speed ${v.speed})`, v.price]));
if (D.LUX_TITLES) ladder('Lux titles', D.LUX_TITLES.filter(t => t.price).map(t => [t.title || t.id, t.price]));
const fp = Object.values(D.FURNITURE || {}).map(f => f.price).filter(p => p > 0).sort((a, b) => a - b);
if (fp.length) console.log(`\n== Furniture == ${fp.length} items · min ${baht(fp[0])} · median ${baht(fp[fp.length >> 1])} · max ${baht(fp[fp.length - 1])}`);
