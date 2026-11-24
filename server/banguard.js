'use strict';
// 🚫 ban evasion: remember the devices (a random id the phone keeps) and IPs each account logs in from. Banning an account blocks
// its devices for good and its recent IPs for 3 days, so a scripter cannot just make a new account. IPs only block NEW accounts
// and only briefly: mobile networks share and reuse IPs, so an innocent player on the same IP is never locked out for long.
// Pure (no sockets/DB) so banguard.test.js can run it. Store S = { dev: { devId: login }, ip: { ip: [until, login] } } (saved in __meta).
const KEEP = 5, IP_MS = 3 * 864e5, IP_RECENT = 7 * 864e5;
const okDev = d => typeof d === 'string' && /^[a-z0-9]{8,40}$/i.test(d);

const store = (o = {}) => ({ dev: { ...(o.dev || {}) }, ip: { ...(o.ip || {}) } });

function seen(a, dev, ip, t) {
  if (okDev(dev)) a.devs = [dev, ...(a.devs || []).filter(d => d !== dev)].slice(0, KEEP);
  if (ip) a.ips = [[String(ip).slice(0, 64), t], ...(a.ips || []).filter(([i]) => i !== ip)].slice(0, KEEP);
}
function mark(S, x, t) {
  for (const d of x.devs || []) S.dev[d] = x.login;
  for (const [i, at] of x.ips || []) if (t - at < IP_RECENT) S.ip[i] = [t + IP_MS, x.login];
}
function unmark(S, x) {
  for (const d of x.devs || []) if (S.dev[d] === x.login) delete S.dev[d];
  for (const [i] of x.ips || []) delete S.ip[i];
}
function newBlocked(S, dev, ip, t) {
  if (okDev(dev) && S.dev[dev]) return S.dev[dev];
  if (ip && S.ip[ip]?.[0] > t) return S.ip[ip][1];
  return null;
}
const sameDevice = (a, list) => list.filter(o => o !== a && (o.devs || []).some(d => (a.devs || []).includes(d)));
function prune(S, t) { for (const [i, v] of Object.entries(S.ip)) if (!(v?.[0] > t)) delete S.ip[i]; }

module.exports = { store, seen, mark, unmark, newBlocked, sameDevice, prune };
