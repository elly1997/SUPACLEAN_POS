/**
 * Prevent duplicate SMS for the same logical event (e.g. one receipt, one ready blast).
 * Uses notifications.dedupe_key + notification_type + customer_id within a time window.
 */
const DEFAULT_WINDOW_HOURS = Math.min(
  168,
  Math.max(1, parseInt(process.env.SMS_DEDUPE_WINDOW_HOURS || '48', 10) || 48)
);

function normalizeReceipt(r) {
  return String(r || '').trim().toUpperCase();
}

/**
 * @param {Object} options
 * @param {string} [options.dedupeKey] - explicit key (overrides computed)
 * @param {number} [options.customerId]
 * @param {string} [options.notificationType]
 * @param {string} [options.receiptNumber]
 * @param {string} [options.invoiceNumber]
 */
function computeDedupeKey(options = {}) {
  if (options.dedupeKey != null && String(options.dedupeKey).trim() !== '') {
    return String(options.dedupeKey).trim();
  }
  const { customerId, notificationType, receiptNumber, invoiceNumber } = options;
  const t = String(notificationType || '');
  if (invoiceNumber && t === 'invoice_reminder') {
    return `inv:${String(invoiceNumber).trim().toUpperCase()}`;
  }
  if (receiptNumber && ['ready', 'reminder', 'receipt_sms'].includes(t)) {
    return `rcpt:${normalizeReceipt(receiptNumber)}`;
  }
  if (t === 'balance_reminder' && customerId != null) {
    return `bal:${customerId}`;
  }
  if (t === 'google_review' && customerId != null) {
    return `review:${customerId}`;
  }
  return null;
}

/**
 * @param {object} db - database/db (PostgreSQL: get returns Promise; SQLite: callback)
 */
async function dbGetAsync(db, sql, params) {
  const ret = db.get(sql, params);
  if (ret != null && typeof ret.then === 'function') return ret;
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function hasRecentDuplicate(db, { customerId, notificationType, dedupeKey, hours = DEFAULT_WINDOW_HOURS }) {
  if (!customerId || !dedupeKey || !notificationType) return false;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const row = await dbGetAsync(
    db,
    `SELECT id FROM notifications
     WHERE customer_id = ?
       AND notification_type = ?
       AND channel = 'sms'
       AND dedupe_key = ?
       AND status IN ('sent', 'logged')
       AND COALESCE(sent_at, created_at) > ?`,
    [customerId, notificationType, dedupeKey, cutoff]
  );
  return !!row;
}

module.exports = {
  computeDedupeKey,
  hasRecentDuplicate,
  DEFAULT_WINDOW_HOURS
};
