/**
 * Pre-launch DB migrations: order_item_photos + multi-branch indexes.
 * Run: node scripts/run-pre-launch.js
 * With DATABASE_URL: PostgreSQL. Without: SQLite (database/supaclean.db).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const FILES = [
  { name: 'Order item photos (thermal POS)', file: 'add-order-item-photos.sql' },
  { name: 'Multi-branch indexes', file: 'indexes-multi-branch-scale.sql' }
];

async function runPostgres() {

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
  });

  console.log('🚀 Pre-launch DB migrations\n');

  for (const { name, file } of FILES) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.log(`⏭️  Skip ${name}: ${file} not found`);
      continue;
    }
    let sql = fs.readFileSync(filePath, 'utf8');
    sql = sql.replace(/--[^\n]*/g, '').trim();
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 5);
    let ok = 0;
    for (const stmt of statements) {
      try {
        await pool.query(stmt + ';');
        ok++;
      } catch (err) {
        const msg = err.message || '';
        if (/already exists|duplicate/i.test(msg)) {
          ok++;
        } else {
          console.error(`❌ ${name}: ${msg.split('\n')[0]}`);
          await pool.end();
          process.exit(1);
        }
      }
    }
    console.log(`✅ ${name} (${ok}/${statements.length} statements)`);
  }

  await pool.end();
  console.log('\n✅ Pre-launch migrations done. You can run npm run dev.\n');
}

async function run() {
  if (process.env.DATABASE_URL) {
    await runPostgres();
  } else {
    console.log('ℹ️  No DATABASE_URL — running SQLite pre-launch migrations.\n');
    const { runSqlite } = require('./pre-launch-sqlite.js');
    await runSqlite();
  }
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
