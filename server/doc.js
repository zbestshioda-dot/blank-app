'use strict';
// 🩺 doctor answer timing for admins. a.docLog = last 40 answers [ms after the exam finished, right? 1/0].
// sus: nearly all right and nearly all instant (a sharp player can do this too).
// bot: nearly all right with almost the same reaction time every case; people are uneven, scripts are not.
function docFlag(a) {
  const L = a.docLog || []; if (L.length < 20) return null;
  const v = L.map(x => x[0]), ms = [...v].sort((p, q) => p - q), med = ms[Math.floor(ms.length / 2)], acc = L.filter(x => x[1]).length / L.length;
  const mean = v.reduce((p, q) => p + q, 0) / v.length, sd = Math.round(Math.sqrt(v.reduce((p, q) => p + (q - mean) ** 2, 0) / v.length));
  return { n: L.length, med, sd, acc: Math.round(acc * 100), sus: acc >= .97 && med < 1200 ? 1 : 0, bot: acc >= .9 && med < 2000 && sd < 150 ? 1 : 0 };
}
module.exports = { docFlag };
