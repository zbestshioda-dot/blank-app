// 🔔 browser push notifications (Web Push): reach players who are not in the game right now.
// Each account keeps up to 3 device subscriptions in a.push.
const webpush = require('web-push');
let keys = null;
// the key pair comes from the env (VAPID_PUBLIC / VAPID_PRIVATE) or from the saved town data (made once on first start and saved
// with it, so it survives deploys: the server's own disk does not). init() returns the pair to save.
function init(saved) {
  try {
    keys = process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE ? { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE }
      : saved?.publicKey && saved?.privateKey ? saved : webpush.generateVAPIDKeys();
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://newlifetownth.fly.dev', keys.publicKey, keys.privateKey);
  } catch (e) { console.error('push: notifications off', e.message); keys = null; }
  return keys;
}
const MAX_DAY = 4;   // pushes per player per day (the game should never feel spammy)
const dayKey = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

// a new or refreshed subscription from the client
function subscribe(a, sub) {
  if (!keys || !sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 600 || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  const s = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } };
  a.push = [s, ...(a.push || []).filter(x => x.endpoint !== s.endpoint)].slice(0, 3); a.sd = true;
  return true;
}
function unsubscribe(a, endpoint) { a.push = (a.push || []).filter(x => x.endpoint !== endpoint); a.sd = true; }

// send to every device of one player; `force` skips the daily cap (only for things they asked for)
function send(a, title, body, opt = {}) {
  if (!keys || !a?.push?.length) return false;
  const d = dayKey(); if (!a.pushDay || a.pushDay.d !== d) a.pushDay = { d, n: 0 };
  if (!opt.force && a.pushDay.n >= MAX_DAY) return false;
  if (opt.tag) { a.pushDay.tags = a.pushDay.tags || []; if (a.pushDay.tags.includes(opt.tag)) return false; a.pushDay.tags.push(opt.tag); }
  a.pushDay.n++; a.sd = true;
  const payload = JSON.stringify({ title, body, tag: opt.tag || '', url: opt.url || '/' });
  for (const s of [...a.push]) webpush.sendNotification(s, payload, { TTL: opt.ttl || 3600 }).catch(e => {
    if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(a, s.endpoint);   // the browser dropped it
  });
  return true;
}
module.exports = { init, publicKey: () => keys?.publicKey || '', subscribe, unsubscribe, send };
