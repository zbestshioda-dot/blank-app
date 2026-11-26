'use strict';
// 🤖 "are you a person?" checks against auto-play tools (macros, auto-clickers, scripts). Pure: index.js sends and gates.
// A check is a button at a random spot on screen; until it is tapped, work-type actions are held (nothing is taken away).
// Asked when: bot-like tap rhythm, robot-even doctor answers, or 2 hours of nonstop actions (at most once an hour).
const RUN_MS = 2 * 3600e3, GAP_MS = 10 * 60e3, ANSWER_MS = 90e3, QUIET_MS = 3600e3, HUMAN_MS = 400;

// call on every action; true = time to ask (the run restarts after any 10-minute break)
function run(a, t) {
  if (!a.gdRun || t - a.gdRun.last > GAP_MS) a.gdRun = { start: t, last: t };
  a.gdRun.last = t;
  return t - a.gdRun.start >= RUN_MS && t - (a.hcOk ?? -Infinity) >= QUIET_MS && !a.hc;
}

function ask(a, why, t, rnd = Math.random) {
  if (a.hc) return null;
  const tok = Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, '0') + Math.floor(Math.random() * 1e6).toString(36);
  a.hc = { tok, why, at: t, until: t + ANSWER_MS, x: .15 + rnd() * .7, y: .25 + rnd() * .5 };
  return { tok, x: a.hc.x, y: a.hc.y };
}

function answer(a, tok, t) {
  if (!a.hc || String(tok) !== a.hc.tok) return { ok: false };
  const fast = t - a.hc.at < HUMAN_MS;
  a.hc = null; a.hcOk = t; if (a.gdRun) a.gdRun.start = t;
  return { ok: true, fast };
}

const blocked = (a, t) => !a.hc ? null : t > a.hc.until ? 'late' : 'wait';

// 💤 daily soft cap: an auto-player that never stops should earn little more than a person. a.wk = { d: day, m: work minutes, last: minute }
const CAP = [[Infinity, 1]];   // turned off at the owner's request: full pay all day (was 3 h full, then 50%, after 5 h 20%)
const mulAt = m => CAP.find(([lim]) => m <= lim)[1];
function workMin(a, t, day) {   // count one minute of work; returns the new pay step when one is crossed
  const mi = Math.floor(t / 60e3);
  if (!a.wk || a.wk.d !== day) a.wk = { d: day, m: 0, last: -1 };
  if (a.wk.last === mi) return null;
  const before = mulAt(a.wk.m); a.wk.last = mi; a.wk.m++;
  const after = mulAt(a.wk.m); return after !== before ? after : null;
}
const payMul = (a, day) => a.wk?.d === day ? mulAt(a.wk.m) : 1;

module.exports = { run, ask, answer, blocked, workMin, payMul, CAP, RUN_MS, ANSWER_MS };
