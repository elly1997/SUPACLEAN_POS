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

/** A 'pending' row means an SMS is being handed to the carrier right now — counts as sent for a few minutes. */
const PENDING_CLAIM_MINUTES = 5;

/** Same text to the same phone within this window is always treated as a duplicate. */
const IDENTICAL_MESSAGE_WINDOW_MINUTES = 15;

async function hasRecentDuplicate(db, { customerId, notificationType, dedupeKey, hours = DEFAULT_WINDOW_HOURS }) {
  if (!customerId || !dedupeKey || !notificationType) return false;
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const pendingCutoff = new Date(Date.now() - PENDING_CLAIM_MINUTES * 60000).toISOString();
  const row = await dbGetAsync(
    db,
    `SELECT id FROM notifications
     WHERE customer_id = ?
       AND notification_type = ?
       AND channel = 'sms'
       AND dedupe_key = ?
       AND (
         (status IN ('sent', 'logged') AND COALESCE(sent_at, created_at) > ?)
         OR (status = 'pending' AND created_at > ?)
       )`,
    [customerId, notificationType, dedupeKey, cutoff, pendingCutoff]
  );
  return !!row;
}

/**
 * Hard cap: a customer may receive at most ONE SMS per category in any rolling 24 hours,
 * regardless of receipt/invoice. Categories:
 *  - reminder: collection/ready notices and balance/invoice reminders
 *  - receipt:  receipt / order confirmation SMS
 */
const RATE_LIMIT_HOURS = Math.max(1, parseInt(process.env.SMS_CATEGORY_LIMIT_HOURS || '24', 10) || 24);
const CATEGORY_TYPES = {
  reminder: ['ready', 'reminder', 'balance_reminder', 'invoice_reminder'],
  receipt: ['receipt_sms', 'confirmation']
};

function categoryForType(notificationType) {
  const t = String(notificationType || '');
  for (const [category, types] of Object.entries(CATEGORY_TYPES)) {
    if (types.includes(t)) return category;
  }
  return null;
}

/** True if the customer already got (or is getting) an SMS of the same category within the window. */
async function hasRecentCategorySms(db, { customerId, notificationType, hours = RATE_LIMIT_HOURS }) {
  const category = categoryForType(notificationType);
  if (!customerId || !category) return false;
  const types = CATEGORY_TYPES[category];
  const placeholders = types.map(() => '?').join(', ');
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const pendingCutoff = new Date(Date.now() - PENDING_CLAIM_MINUTES * 60000).toISOString();
  const row = await dbGetAsync(
    db,
    `SELECT id FROM notifications
     WHERE customer_id = ?
       AND channel = 'sms'
       AND notification_type IN (${placeholders})
       AND (
         (status IN ('sent', 'logged') AND COALESCE(sent_at, created_at) > ?)
         OR (status = 'pending' AND created_at > ?)
       )
     LIMIT 1`,
    [customerId, ...types, cutoff, pendingCutoff]
  );
  return !!row;
}

/** True if this exact text already went (or is going) to this number moments ago. */
async function hasRecentIdenticalMessage(db, { recipient, message, minutes = IDENTICAL_MESSAGE_WINDOW_MINUTES }) {
  if (!recipient || !message) return false;
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  const row = await dbGetAsync(
    db,
    `SELECT id FROM notifications
     WHERE recipient = ?
       AND channel = 'sms'
       AND message = ?
       AND status IN ('pending', 'sent', 'logged')
       AND COALESCE(sent_at, created_at) > ?`,
    [recipient, message, cutoff]
  );
  return !!row;
}

/**
 * Serialise async work per key (in-process FIFO mutex). Used so the "already sent?" check and
 * the claim for the same recipient cannot interleave between concurrent requests.
 */
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => gate);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

module.exports = {
  computeDedupeKey,
  hasRecentDuplicate,
  hasRecentIdenticalMessage,
  hasRecentCategorySms,
  categoryForType,
  withLock,
  DEFAULT_WINDOW_HOURS
};
