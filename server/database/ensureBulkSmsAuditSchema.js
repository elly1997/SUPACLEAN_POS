/**
 * Bulk SMS audit log (PostgreSQL). Records who sent what scope, message fingerprint, and counts.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');

async function ensure() {
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS bulk_sms_audit_log (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER,
        username TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL,
        effective_branch_id INTEGER,
        respect_sms_opt_out BOOLEAN NOT NULL DEFAULT TRUE,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        message_length INTEGER NOT NULL,
        message_sha256 CHAR(64) NOT NULL,
        recipients_targeted INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        truncated_to_max BOOLEAN NOT NULL DEFAULT FALSE,
        error_message TEXT
      )`,
      []
    );
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_bulk_sms_audit_created ON bulk_sms_audit_log(created_at DESC)',
      []
    );
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_bulk_sms_audit_user ON bulk_sms_audit_log(user_id, created_at DESC)',
      []
    );
    console.log('✅ Bulk SMS audit schema ready');
  } catch (err) {
    console.error('❌ Bulk SMS audit schema error:', err.message);
  }
}

ensure();
