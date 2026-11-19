/**
 * Adds notifications.dedupe_key for SMS de-duplication (PostgreSQL).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');

async function ensure() {
  try {
    await db.run('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT', []);
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_notifications_sms_dedupe ON notifications (customer_id, notification_type, channel, dedupe_key)',
      []
    );
    console.log('OK:  notifications.dedupe_key ready');
  } catch (err) {
    console.error('ERROR:  notifications dedupe_key migration error:', err.message);
  }
}

if (require.main === module || process.env.SCHEMA_ENSURE_CONTROLLED !== '1') {
  ensure();
}

module.exports = { ensure };
