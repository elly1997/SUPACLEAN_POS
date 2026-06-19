/**
 * Long-term POS resilience: partial indexes (active rows only), idempotency store,
 * normalized customer phone column for deduplication at scale.
 */
const db = require('./query');
const { normalizePhoneDigits } = require('../utils/customerPhone');

(async () => {
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        idempotency_key TEXT NOT NULL,
        route TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (idempotency_key, route)
      )`,
      []
    );
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at)',
      []
    );

    await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_normalized TEXT', []);

    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_orders_active_branch_date
       ON orders(branch_id, order_date DESC)
       WHERE archived_at IS NULL AND COALESCE(is_voided, FALSE) = FALSE`,
      []
    );
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_orders_active_branch_status
       ON orders(branch_id, status, order_date DESC)
       WHERE archived_at IS NULL AND COALESCE(is_voided, FALSE) = FALSE`,
      []
    );
    await db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_normalized
       ON customers(phone_normalized)
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''`,
      []
    );

    const rows = await db.all(
      `SELECT id, phone FROM customers
       WHERE phone_normalized IS NULL OR phone_normalized = ''
       LIMIT 5000`,
      []
    );
    for (const row of rows || []) {
      const normalized = normalizePhoneDigits(String(row.phone || '').trim());
      if (!normalized) continue;
      await db.run('UPDATE customers SET phone_normalized = ? WHERE id = ?', [normalized, row.id]);
    }
  } catch (err) {
    console.error('ensureLongevitySchema failed:', err.message);
  }
})();
