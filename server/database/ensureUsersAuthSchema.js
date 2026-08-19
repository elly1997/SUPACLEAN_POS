/**
 * Users auth columns: email + must_change_password (PostgreSQL only).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');

async function ensure() {
  try {
    await db.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT', []);
    await db.run(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE',
      []
    );
    await db.run(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      []
    );
    await db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
       ON users (lower(trim(email)))
       WHERE email IS NOT NULL AND length(trim(email)) > 0`,
      []
    );
    await db
      .run(
        `UPDATE users SET must_change_password = TRUE
         WHERE LOWER(TRIM(username)) = 'admin'
           AND COALESCE(must_change_password, FALSE) = FALSE
           AND password_hash IS NOT NULL`,
        []
      )
      .catch(() => {});
    console.log('✅ Users auth schema (email, must_change_password) ready');
  } catch (err) {
    console.error('❌ Users auth schema error:', err.message);
  }
}

ensure();
