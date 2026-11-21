'use strict';
// Player storage. Uses Postgres when DATABASE_URL is set (survives redeploys),
// otherwise falls back to a local JSON file.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'players.json');
// One-time restore: if the save file doesn't exist yet (a fresh volume), start from seed/players.json
// when it was deployed alongside the code. Kept out of git (.gitignore) because it holds every player's PIN.
const SEED = path.join(__dirname, '..', 'seed', 'players.json');
const URL = process.env.DATABASE_URL;
let pool = null;

async function init() {
  if (!URL) { console.log('storage: local file (' + FILE + ') — set DATABASE_URL for permanent storage'); return; }
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(URL);
  pool = new Pool({ connectionString: URL, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
  pool.on('error', e => console.error('db pool error', e.message));
  await pool.query(`CREATE TABLE IF NOT EXISTS players (
    name_lc text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  console.log('storage: Postgres');
}

async function loadAll() {
  if (pool) { const r = await pool.query('SELECT data FROM players'); return r.rows.map(x => x.data); }
  if (!fs.existsSync(FILE) && fs.existsSync(SEED)) {
    try { const rows = JSON.parse(fs.readFileSync(SEED, 'utf8')); console.log('storage: restored ' + rows.length + ' records from ' + SEED); return rows; }
    catch (e) { console.error('seed unreadable:', e.message); }
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

// records: array of plain objects with .name. In file mode `all` (every player) is written instead.
async function save(records, all, full) {
  if (pool) {
    if (!records.length) return;
    const names = records.map(r => (r.login || r.name).toLowerCase());   // the login ID is the key
    const datas = records.map(r => JSON.stringify(r));
    await pool.query(
      `INSERT INTO players (name_lc, data, updated_at)
       SELECT n, d::jsonb, now() FROM unnest($1::text[], $2::text[]) AS t(n, d)
       ON CONFLICT (name_lc) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [names, datas]);
    return;
  }
  // file mode: keep each player's JSON text cached and only re-encode the ones that changed, then write without blocking
  // the game (encoding every player at once froze the server for a moment every save = lag for everyone).
  // Everything is re-encoded from scratch every few minutes in case something changed an offline player quietly.
  const t = Date.now();
  if (full || !cache.size || t - fullAt > 5 * 60e3) {
    cache.clear(); fullAt = t;
    for (const r of (typeof all === 'function' ? all() : all)) cache.set(String(r.login || r.name).toLowerCase(), JSON.stringify(r));
  } else for (const r of records) cache.set(String(r.login || r.name).toLowerCase(), JSON.stringify(r));
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.writeFile(FILE + '.tmp', '[' + [...cache.values()].join(',') + ']');
  await fs.promises.rename(FILE + '.tmp', FILE);
}
const cache = new Map(); let fullAt = 0;

async function close() { if (pool) await pool.end().catch(() => {}); }
module.exports = { init, loadAll, save, close };
