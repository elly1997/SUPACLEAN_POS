/**
 * Long-term POS resilience: partial indexes (active rows only), idempotency store,
 * normalized customer phone column for deduplication at scale.
 */
const db = require('./query');
const { normalizePhoneDigits } = require('../utils/customerPhone');

async function backfillPhoneNormalizedBatch(limit = 5000) {
  const rows = await db.all(
    `SELECT id, phone, primary_branch_id FROM customers
     WHERE (phone_normalized IS NULL OR phone_normalized = '')
       AND phone IS NOT NULL
       AND TRIM(phone) <> ''
       AND phone NOT LIKE 'NO-PHONE:%'
     ORDER BY id ASC
     LIMIT ?`,
    [limit]
  );

  let updated = 0;
  let skipped = 0;

  for (const row of rows || []) {
    const normalized = normalizePhoneDigits(String(row.phone || '').trim());
    if (!normalized) continue;

    const existing = await db.get(
      `SELECT id FROM customers
       WHERE phone_normalized = ?
         AND primary_branch_id IS NOT DISTINCT FROM ?
       LIMIT 1`,
      [normalized, row.primary_branch_id ?? null]
    );
    if (existing && Number(existing.id) !== Number(row.id)) {
      skipped += 1;
      continue;
    }

    await db.run('UPDATE customers SET phone_normalized = ? WHERE id = ?', [normalized, row.id]);
    updated += 1;
  }

  return { updated, skipped, pending: (rows || []).length };
}

async function countDuplicateNormalizedPhones() {
  const row = await db.get(
    `SELECT COUNT(*) AS groups, COALESCE(SUM(cnt - 1), 0) AS extra_rows
     FROM (
       SELECT phone_normalized, COUNT(*) AS cnt
       FROM customers
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
       GROUP BY phone_normalized
       HAVING COUNT(*) > 1
     ) dupes`,
    []
  );
  return {
    groups: Number(row?.groups || 0),
    extra_rows: Number(row?.extra_rows || 0),
  };
}

async function releaseCompanyWidePhoneLock() {
  // The same phone may be saved again at another branch. Only one copy per branch.
  await db.run('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key', []).catch(() => {});
  await db.run('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_normalized_key', []).catch(() => {});
  await db.run('DROP INDEX IF EXISTS customers_phone_key', []).catch(() => {});
  await db.run('DROP INDEX IF EXISTS idx_customers_phone_normalized', []).catch(() => {});
  await db.run(
    `DO $$
     DECLARE r record;
     BEGIN
       FOR r IN
         SELECT c.conname
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'customers'
           AND c.contype = 'u'
           AND pg_get_constraintdef(c.oid) ILIKE '%phone%'
           AND pg_get_constraintdef(c.oid) NOT ILIKE '%primary_branch_id%'
       LOOP
         EXECUTE format('ALTER TABLE customers DROP CONSTRAINT IF EXISTS %I', r.conname);
       END LOOP;

       FOR r IN
         SELECT indexname
         FROM pg_indexes
         WHERE tablename = 'customers'
           AND indexdef ILIKE 'CREATE UNIQUE%'
           AND indexdef ILIKE '%phone%'
           AND indexdef NOT ILIKE '%primary_branch_id%'
       LOOP
         EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
       END LOOP;
     END $$`,
    []
  ).catch((err) => {
    console.error('Could not drop company-wide customer phone lock:', err.message);
  });
}

async function ensurePhoneNormalizedIndexes() {
  await releaseCompanyWidePhoneLock();

  await db.run(
    `UPDATE customers c
     SET primary_branch_id = src.branch_id
     FROM (
       SELECT customer_id, MIN(branch_id) AS branch_id
       FROM orders
       WHERE branch_id IS NOT NULL
         AND COALESCE(is_voided, FALSE) = FALSE
       GROUP BY customer_id
       HAVING COUNT(DISTINCT branch_id) = 1
     ) src
     WHERE c.id = src.customer_id
       AND c.primary_branch_id IS NULL`,
    []
  ).catch((err) => {
    console.error('Could not attach older customers to their branch:', err.message);
  });

  const dupes = await db.get(
    `SELECT COUNT(*) AS groups
     FROM (
       SELECT primary_branch_id, phone_normalized
       FROM customers
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> '' AND primary_branch_id IS NOT NULL
       GROUP BY primary_branch_id, phone_normalized
       HAVING COUNT(*) > 1
     ) dupes`,
    []
  );
  if (Number(dupes?.groups || 0) === 0) {
    await db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_per_branch
       ON customers(primary_branch_id, phone_normalized)
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> '' AND primary_branch_id IS NOT NULL`,
      []
    );
    console.log('✅ customers phone unique per branch');
  } else {
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized_lookup
       ON customers(phone_normalized)
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''`,
      []
    );
    console.warn(
      `⚠️ Skipping per-branch unique phone index: ${dupes.groups} duplicate phone group(s) inside a branch.`
    );
  }
}

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

    // Re-normalize legacy values (e.g. 0762665356 stored before TZ fix).
    const legacyRows = await db.all(
      `SELECT id, phone, phone_normalized, primary_branch_id FROM customers
       WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
       LIMIT 5000`,
      []
    );
    for (const row of legacyRows || []) {
      const expected = normalizePhoneDigits(String(row.phone || '').trim());
      if (!expected || expected === row.phone_normalized) continue;
      const owner = await db.get(
        `SELECT id FROM customers
         WHERE phone_normalized = ?
           AND primary_branch_id IS NOT DISTINCT FROM ?
         LIMIT 1`,
        [expected, row.primary_branch_id ?? null]
      );
      if (owner && Number(owner.id) !== Number(row.id)) {
        await db.run('UPDATE customers SET phone_normalized = NULL WHERE id = ?', [row.id]);
        continue;
      }
      await db.run('UPDATE customers SET phone_normalized = ? WHERE id = ?', [expected, row.id]);
    }

    let totalUpdated = 0;
    let totalSkipped = 0;
    for (let i = 0; i < 20; i += 1) {
      const batch = await backfillPhoneNormalizedBatch(5000);
      totalUpdated += batch.updated;
      totalSkipped += batch.skipped;
      if (batch.pending === 0) break;
    }

    await ensurePhoneNormalizedIndexes();

    if (totalUpdated > 0 || totalSkipped > 0) {
      console.log(
        `✅ Longevity schema ready (phone_normalized backfill: ${totalUpdated} updated, ${totalSkipped} duplicate(s) skipped)`
      );
    } else {
      console.log('✅ Longevity schema ready');
    }
  } catch (err) {
    console.error('ensureLongevitySchema failed:', err.message);
  }
})();

module.exports = {
  backfillPhoneNormalizedBatch,
  countDuplicateNormalizedPhones,
  releaseCompanyWidePhoneLock,
};
