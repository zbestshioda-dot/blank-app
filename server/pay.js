// Real-money top-up: PromptPay QR + transfer-slip check through Slip2Go (https://slip2go.com).
// Keys live only in the server's environment (Fly.io secrets):
//   SLIP2GO_SECRET   the Secret Key from the Slip2Go dashboard (API)
//   PROMPTPAY_ID     where players pay: phone (0812345678), national/tax id (13 digits) or e-wallet id (15 digits)
//   PAY_NAME         the account name players see before paying, e.g. "สมชาย ใจดี"
//   SLIP_RECEIVER    a piece of the receiver name exactly as it shows on a slip (e.g. "สมชาย" or "SOMCHAI");
//                    without it, slips can't be matched to your account, so every slip waits for an admin instead
//   SLIP2GO_API      optional, default https://connect.slip2go.com
// Flow: the player picks a pack -> the game shows a PromptPay QR with the exact price -> they pay in their bank app
// -> they upload the slip -> the game reads the slip's QR -> the server asks Slip2Go about it -> only a real slip, made
// after the order, to our account, for at least the price, and never used before, adds the item (once).
// Anything odd is not credited: the order goes to "review" for an admin to check against the bank app.
const crypto = require('crypto');

const SK = (process.env.SLIP2GO_SECRET || '').trim();
const API = (process.env.SLIP2GO_API || 'https://connect.slip2go.com').replace(/\/+$/, '');
const PP = String(process.env.PROMPTPAY_ID || '').replace(/\D/g, '');
const NAME = (process.env.PAY_NAME || '').trim();
const RECV = (process.env.SLIP_RECEIVER || '').trim();
const BASE = (process.env.PUBLIC_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '')).replace(/\/+$/, '');
const ON = !!(SK && /^(\d{10}|\d{13}|\d{15})$/.test(PP));
const SANDBOX = false;

// packs: price in baht -> diamonds, or a special item (kind title / outfit). The first diamond top-up of each account gets +50%.
const PACKS = [
  { id: 'month', kind: 'card', gems: 100, thb: 39, name: 'บัตรรายเดือน 30 วัน', tag: 'คุ้มสุด', daily: 20, days: 30, total: 700, worth: 160 },   // 💳 100 now + 20 a day you claim it
  { id: 'tpass', kind: 'pass', gems: 0, thb: 59, name: 'พาสเมืองเดือนนี้', tag: 'รางวัลเยอะสุด' },   // 🎟️ premium track of this month's Town Pass
  { id: 'starter', kind: 'starter', gems: 120, eggs: 2, thb: 19, name: 'แพ็กมือใหม่', tag: 'ซื้อได้ครั้งเดียว' },   // 🎁 once per account, not a gift
  { id: 'vip', kind: 'title', gems: 0, thb: 49, name: 'ฉายาพิเศษ 30 วัน', tag: 'ฉายาวิ้งวับ' },
  { id: 'angel', kind: 'outfit', of: 'angel', gems: 0, thb: 99, name: 'ชุดเทวดา / นางฟ้า', tag: 'ชุดพิเศษ' },
  { id: 'p50', gems: 50, thb: 19 },
  { id: 'p100', gems: 100, thb: 29 },
  { id: 'p300', gems: 300, thb: 79, tag: 'คุ้ม' },
  { id: 'p1000', gems: 1000, thb: 229, tag: 'คุ้มสุด' },
];
const FIRST_BONUS = .5;
const METHODS = {}, BANKS = {};

const newRef = () => String(Date.now()).slice(-10) + String(crypto.randomInt(0, 1e5)).padStart(5, '0');

// ---- PromptPay "Tag 30/29" EMV QR with a fixed amount
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
function crc16(s) {
  let c = 0xFFFF;
  for (const b of Buffer.from(s, 'utf8')) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1; c &= 0xFFFF; }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
function promptPayQR(amount) {
  const acc = PP.length === 10 ? tlv('01', '0066' + PP.slice(1)) : PP.length === 13 ? tlv('02', PP) : tlv('03', PP);
  const s = tlv('00', '01') + tlv('01', '12') + tlv('29', tlv('00', 'A000000677010111') + acc) + tlv('58', 'TH') + tlv('53', '764') + tlv('54', (+amount).toFixed(2)) + '6304';
  return s + crc16(s);
}
const ppShow = () => PP.length === 10 ? PP.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : PP;

async function call(path, body, auth) {
  const r = await fetch(API + path, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const flat = v => JSON.stringify(v || '').replace(/\s+/g, '').toLowerCase();
// ask Slip2Go about the QR printed on a slip -> { ok, amount, transRef, when, recvOk, why, dup, code, raw }
async function checkSlip(qrCode) {
  const body = { payload: { qrCode, checkCondition: { checkDuplicate: true } } };
  let res;
  try {
    res = await call('/api/verify-slip/qr-code/info', body, 'Bearer ' + SK);
    if (res.status === 401 || res.status === 403) res = await call('/api/verify-slip/qr-code/info', body, SK);   // in case the key is meant to be sent bare
  } catch (e) { return { ok: false, why: 'ติดต่อระบบตรวจสลิปไม่ได้ ' + (e.message || e), retry: true }; }
  const j = res.j || {}, code = String(j.code ?? ''), d = j.data || {};
  // 200501 = Slip2Go has seen this slip before. That is also what a re-check of OUR OWN earlier check says (a timeout, a retry,
  // the admin's "check again"), so when the slip's details come back the game decides itself whether one of its orders used it.
  if (code === '200501') {
    if (!d.transRef) return { ok: false, dup: true, why: 'สลิปนี้เคยถูกใช้แล้ว', code, raw: j };
    const recvOk = RECV ? flat(d.receiver).includes(RECV.replace(/\s+/g, '').toLowerCase()) : null;
    return { ok: true, dup: true, amount: +d.amount || 0, transRef: String(d.transRef), when: Date.parse(d.dateTime || d.transDate || '') || 0, recvOk, code, raw: j };
  }
  if (code === '200404' || code === '200500') return { ok: false, bad: true, why: 'สลิปไม่ถูกต้อง หรือไม่พบรายการโอนนี้ในระบบธนาคาร', code, raw: j };
  if (!/^2000(00|01)$|^200200$/.test(code) || !d.transRef) return { ok: false, why: `ตรวจสลิปไม่ผ่าน (${code || 'HTTP ' + res.status} ${j.message || ''})`.trim(), retry: res.status >= 500 || res.status === 429, code, raw: j };
  const amount = +d.amount || 0, when = Date.parse(d.dateTime || d.transDate || '') || 0;
  const recvOk = RECV ? flat(d.receiver).includes(RECV.replace(/\s+/g, '').toLowerCase()) : null;
  return { ok: true, amount, transRef: String(d.transRef), when, recvOk, code, raw: j };
}

module.exports = { ON, SANDBOX, PACKS, FIRST_BONUS, METHODS, BANKS, newRef, promptPayQR, ppShow, checkSlip, BASE, NAME, RECV: !!RECV, PP: !!PP, SK: !!SK };
