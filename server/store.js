'use strict';
// Player storage. Uses Postgres when DATABASE_URL is set (survives redeploys),
// otherwise falls back to a local JSON file.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'players.json');
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
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

// records: array of plain objects with .name. In file mode `all` (every player) is written instead.
async function save(records, all) {
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all));
  fs.renameSync(FILE + '.tmp', FILE);
}

async function close() { if (pool) await pool.end().catch(() => {}); }
module.exports = { init, loadAll, save, close };
