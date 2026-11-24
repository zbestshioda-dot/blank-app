'use strict';
// node server/banguard.test.js — a banned scripter cannot simply sign up again (no server, no DB needed)
const assert = require('node:assert/strict');
const G = require('./banguard');
const T = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e.message); process.exitCode = 1; } };
const DAY = 864e5, NOW = Date.parse('2026-11-24T12:00:00Z');

T('seen: keeps the last 5 devices and IPs, newest first, no repeats', () => {
  const a = {};
  for (let i = 0; i < 7; i++) G.seen(a, 'device00' + i, 'ip' + i, NOW + i);
  G.seen(a, 'device006', 'ip6', NOW + 9);
  assert.deepEqual(a.devs, ['device006', 'device005', 'device004', 'device003', 'device002']);
  assert.equal(a.ips.length, 5); assert.equal(a.ips[0][0], 'ip6');
});
T('seen: ignores empty or junk device ids', () => {
  const a = {}; G.seen(a, '', '', NOW); G.seen(a, 'x'.repeat(200), '1.2.3.4', NOW);
  assert.deepEqual(a.devs || [], []); assert.equal(a.ips.length, 1);
});
T('mark: a ban blocks its devices for good and its recent IPs for 3 days', () => {
  const S = G.store(), x = { login: 'cheat' }; G.seen(x, 'devAAAAA', '9.9.9.9', NOW - DAY); G.seen(x, 'devBBBBB', '8.8.8.8', NOW - 20 * DAY);
  G.mark(S, x, NOW);
  assert.equal(S.dev.devAAAAA, 'cheat'); assert.equal(S.dev.devBBBBB, 'cheat');
  assert.deepEqual(S.ip['9.9.9.9'], [NOW + 3 * DAY, 'cheat']);
  assert.equal(S.ip['8.8.8.8'], undefined);   // an IP last seen weeks ago is not blocked (mobile IPs get reused)
});
T('newBlocked: a new account from a banned device or a fresh banned IP is refused', () => {
  const S = G.store(), x = { login: 'cheat' }; G.seen(x, 'devAAAAA', '9.9.9.9', NOW); G.mark(S, x, NOW);
  assert.equal(G.newBlocked(S, 'devAAAAA', '1.1.1.1', NOW), 'cheat');
  assert.equal(G.newBlocked(S, 'devZZZZZ', '9.9.9.9', NOW + DAY), 'cheat');
  assert.equal(G.newBlocked(S, 'devZZZZZ', '9.9.9.9', NOW + 4 * DAY), null);
  assert.equal(G.newBlocked(S, 'devZZZZZ', '1.1.1.1', NOW), null);
});
T('unmark: unbanning frees the devices and IPs of that account', () => {
  const S = G.store(), x = { login: 'cheat' }; G.seen(x, 'devAAAAA', '9.9.9.9', NOW); G.mark(S, x, NOW);
  G.unmark(S, x);
  assert.equal(G.newBlocked(S, 'devAAAAA', '9.9.9.9', NOW), null);
});
T('sameDevice: lists other accounts that used a device of this one', () => {
  const a = { login: 'a' }, b = { login: 'b' }, c = { login: 'c' };
  G.seen(a, 'dev11111', 'ip', NOW); G.seen(b, 'dev11111', 'ip', NOW); G.seen(c, 'dev22222', 'ip', NOW);
  assert.deepEqual(G.sameDevice(a, [a, b, c]).map(x => x.login), ['b']);
});
