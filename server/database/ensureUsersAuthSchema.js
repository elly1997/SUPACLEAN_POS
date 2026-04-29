/**
 * Users: optional work email for login + Google Sign-In matching (PostgreSQL only).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');

async function ensure() {
  try {
    await db.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT', []);
    await db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
       ON users (lower(trim(email)))
       WHERE email IS NOT NULL AND length(trim(email)) > 0`,
      []
    );
    console.log('✅ Users auth schema (email) ready');
  } catch (err) {
    console.error('❌ Users auth schema error:', err.message);
  }
}

ensure();
