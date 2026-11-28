'use strict';
// node tools/play.js [--login id] [--set key=val,...] [--phone] [--out shot.png] [--wait ms]
// Boots the game on a scratch data dir (never /data), makes a test account, optionally edits its save
// (e.g. --set career=police,virtue=1000,x=26.5,y=50.6), logs in with a real browser, clears the
// anti-bot check and the newcomer tutorial with trusted clicks, then screenshots and prints page errors.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const WS = require('ws'), { chromium, devices } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const LOGIN = arg('login', 'tester1'), PIN = '1234', PORT = +arg('port', 3999), OUT = arg('out', path.join(os.tmpdir(), 'play.png'));
const DIR = arg('dir', fs.mkdtempSync(path.join(os.tmpdir(), 'lt-'))), ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let srv = null;
async function boot() {
  srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 60 && !/running on/.test(log); i++) await sleep(250);
  if (!/running on/.test(log)) throw new Error('server did not boot:\n' + log);
  srv.log = () => log;
}
async function stop() { if (!srv) return; srv.kill('SIGINT'); await new Promise(r => srv.on('exit', r)); srv = null; }
function makeAccount() {   // the character creator flow over the socket
  return new Promise((res, rej) => {
    const w = new WS(`ws://localhost:${PORT}/ws`, { headers: { Origin: `http://localhost:${PORT}` } }), go = c => w.send(JSON.stringify({ t: 'login', name: LOGIN, pin: PIN, create: c, cname: LOGIN, gender: 'm', shirt: 0 }));
    w.on('open', () => go(0)); w.on('error', rej);
    w.on('message', d => { const m = JSON.parse(d); if (m.t === 'newchar') go(1); if (m.t === 'me') { w.close(); res(); } if (m.t === 'fail') { w.close(); rej(new Error(m.msg)); } });
  });
}
(async () => {
  try {
    await boot(); await makeAccount(); await sleep(300); await stop();
    const set = arg('set', '');
    if (set) {   // edit the save while the server is down
      const f = path.join(DIR, 'players.json'), all = JSON.parse(fs.readFileSync(f)), a = all.find(x => x.login === LOGIN);
      for (const kv of String(set).split(',')) { const [k, v] = kv.split('='); a[k] = v === '' ? '' : isNaN(+v) ? v : +v; }
      if (!set.includes('created=')) a.created = 1;   // an "old" account (crimes and similar need 1 day)
      fs.writeFileSync(f, JSON.stringify(all));
    }
    await boot();
    const b = await chromium.launch(), ctx = await b.newContext(arg('phone') ? { ...devices['Pixel 7'] } : { viewport: { width: 1100, height: 650 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2000);
    if (await p.locator('#otherAcct').isVisible().catch(() => false)) await p.click('#otherAcct');
    await p.fill('#inName', LOGIN); await p.fill('#inPin', PIN); await p.click('#loginGo');
    await p.waitForTimeout(4000);
    for (let i = 0; i < 6; i++) {   // trusted clicks: the anti-bot button and the tutorial's skip
      const hc = p.locator('#hcBox button'); if (await hc.isVisible().catch(() => false)) await hc.click().catch(() => { });
      const sk = p.locator('button:text-is("ข้าม")').first(); if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => { });
      await p.waitForTimeout(500);
    }
    await p.waitForTimeout(+arg('wait', 1000));
    await p.screenshot({ path: OUT });
    console.log(`screenshot: ${OUT}\ndata dir: ${DIR}\npage errors: ${errs.length ? '\n  ' + errs.join('\n  ') : 'none'}`);
    const se = srv.log().split('\n').filter(l => /error|\[msg\]|\[tick\]/i.test(l)); if (se.length) console.log('server errors:\n  ' + se.join('\n  '));
    await b.close(); await stop(); process.exitCode = errs.length ? 1 : 0;
  } catch (e) { console.error('FAIL', e.message); await stop(); process.exitCode = 1; }
})();
