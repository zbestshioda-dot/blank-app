// Real-money top-up through Stripe Checkout (cards, PromptPay and whatever else is switched on in the Stripe dashboard).
// Keys live only in the server's environment (Fly.io secrets):
//   STRIPE_SECRET_KEY       sk_test_... while testing, sk_live_... for real money (Stripe dashboard > Developers > API keys)
//   STRIPE_WEBHOOK_SECRET   whsec_... of the webhook endpoint  <PUBLIC_URL>/pay/stripe/hook  (optional but recommended)
//   PUBLIC_URL              the game's address, e.g. https://newlifetownth.fly.dev (defaults to the Fly app name)
// Flow: the player picks a pack -> the server opens a Checkout Session -> the player pays on Stripe's page and comes back
// -> Stripe calls our webhook and/or the game asks again -> we always re-read the session from Stripe with the secret key
// and only a session that Stripe says is paid, for the right amount, adds the item (once).
const crypto = require('crypto');

const SK = process.env.STRIPE_SECRET_KEY || '', WH = process.env.STRIPE_WEBHOOK_SECRET || '';
const API = process.env.STRIPE_API || 'https://api.stripe.com';
const BASE = (process.env.PUBLIC_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '')).replace(/\/+$/, '');
const ON = !!(SK && BASE);
const SANDBOX = SK.startsWith('sk_test_') || SK.startsWith('rk_test_');

// packs: price in baht -> diamonds, or a special item (kind title / outfit). The first diamond top-up of each account gets +50%.
const PACKS = [
  { id: 'vip', kind: 'title', gems: 0, thb: 49, name: 'ฉายาพิเศษ 30 วัน', tag: 'ฉายาวิ้งวับ' },
  { id: 'angel', kind: 'outfit', of: 'angel', gems: 0, thb: 99, name: 'ชุดเทวดา / นางฟ้า', tag: 'ชุดพิเศษ' },
  { id: 'p50', gems: 50, thb: 19 },
  { id: 'p100', gems: 100, thb: 29 },
  { id: 'p300', gems: 300, thb: 79, tag: 'คุ้ม' },
  { id: 'p1000', gems: 1000, thb: 229, tag: 'คุ้มสุด' },
];
const FIRST_BONUS = .5;
const METHODS = {};   // Stripe's own page lets the player pick (card / PromptPay ...), so the game shows no method buttons
const BANKS = {};

const newRef = () => String(Date.now()).slice(-10) + String(crypto.randomInt(0, 1e5)).padStart(5, '0');

async function stripe(method, path, form) {
  const r = await fetch(API + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + SK, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j;
}

// -> { url, sid }
async function createCheckout(o, label) {
  const s = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'thb',
    'line_items[0][price_data][unit_amount]': String(Math.round(o.thb * 100)),   // satang
    'line_items[0][price_data][product_data][name]': `Life Town · ${label}`.slice(0, 120),
    client_reference_id: o.ref,
    'metadata[ref]': o.ref, 'metadata[login]': o.l, 'metadata[pack]': o.pack,
    'payment_intent_data[metadata][ref]': o.ref,
    locale: 'th',
    success_url: `${BASE}/?paid=${o.ref}`,
    cancel_url: `${BASE}/?paycancel=${o.ref}`,
  });
  return { url: s.url, sid: s.id };
}

// ask Stripe what really happened. -> { ok: true, amount } | { ok: false, why, pending }
async function checkStatus(o) {
  if (!o.sid) return { ok: false, why: 'no session' };
  try {
    const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(o.sid));
    if (s.client_reference_id !== o.ref) return { ok: false, why: 'ref mismatch' };
    if (s.payment_status === 'paid' && s.currency === 'thb') return { ok: true, amount: s.amount_total / 100, gbp: s.payment_intent || s.id };
    if (s.status === 'expired') return { ok: false, why: 'expired', expired: true };
    return { ok: false, why: `status ${s.status}/${s.payment_status}`, pending: true };
  } catch (e) { return { ok: false, why: 'network ' + (e.message || e), pending: true }; }
}

// Stripe-Signature: t=...,v1=...  (HMAC-SHA256 of "t.body" with the webhook secret, within 5 minutes)
function verifyHook(raw, header) {
  if (!WH) return null;   // no webhook secret: the event is only used as a hint, the session is re-read anyway
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')).filter(x => x.length === 2 && x[0] !== 'v1'));
  const sigs = String(header || '').split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  const t = +parts.t; if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', WH).update(`${t}.${raw}`).digest('hex');
  return sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

module.exports = { ON, SANDBOX, PACKS, FIRST_BONUS, METHODS, BANKS, newRef, createCheckout, checkStatus, verifyHook, BASE, HOOK: !!WH };
