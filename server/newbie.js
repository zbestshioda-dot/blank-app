'use strict';
// 🌱 newcomers (v2, from the "first ten minutes" update): who counts, what they did first, the funnel for the admin stats.
// Pure (no sockets/DB) so newbie.test.js can run it. State lives in a.nb = { p, t0, v, ev, egg, g2, f1, done } (saved with nb).
const NBV = 2;
const CLIENT_EV = ['tut', 'talk', 'card'];                                     // only the phone knows these (sent as 'nbev')
const SERVER_EV = ['move', 'fish1', 'egg', 'day2', 's0', 's1', 's2', 's3', 's4', 's5'];
const STEP_NAMES = ['ซื้อเบ็ด', 'ตกปลา 3 ตัว', 'ขายปลา', 'ทักทายในแชท', 'ซื้อของชิ้นแรก', 'ส่งอีโมจิ/แลกเบอร์'];

const start = t => ({ p: [], t0: t, v: NBV, ev: {} });
const isV2 = a => !!a?.nb && a.nb.v === NBV;

function mark(a, key, t) {
  if (!isV2(a) || !(CLIENT_EV.includes(key) || SERVER_EV.includes(key))) return false;
  const ev = a.nb.ev || (a.nb.ev = {});
  if (ev[key]) return false;
  ev[key] = t; return true;
}

const realMove = (a, t) => t - (a.loginAt || 0) >= 3000;   // the first moves after login are the spawn being placed, not the player

// the admin funnel: of the v2 newcomers, how many reached each moment; back = came again on a later day
function funnel(list, dayNumOf) {
  const L = list.filter(isV2), has = k => L.filter(a => a.nb.ev?.[k]).length;
  const rows = [['สมัคร', L.length], ['ปิดบทสอน', has('tut')], ['เดินครั้งแรก', has('move')], ['คุย NPC', has('talk')],
    ...STEP_NAMES.map((n, i) => [n, has('s' + i)]), ['ได้ไข่ (รอพรุ่งนี้)', has('egg')], ['เห็นการ์ดพรุ่งนี้', has('card')]];
  const back = L.filter(a => (a.seen || []).some(d => d > dayNumOf(a.nb.t0))).length;
  return { n: L.length, rows, back };
}

module.exports = { NBV, CLIENT_EV, SERVER_EV, start, isV2, mark, funnel, realMove };
