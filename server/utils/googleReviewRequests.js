/**
 * Send Google review requests ~24h after collection.
 * Invoked by Render cron: POST /api/admin/maintenance/cron/google-review-requests
 */
const db = require('../database/query');
const { sendSmsWithWhatsAppFallback } = require('./notifications');
const { isPlaceholderPhone } = require('./customerPhone');

const DEFAULT_REVIEW_URL = 'https://g.page/r/CShuaKhhqyYcEBE/review';

function getReviewUrl() {
  return (process.env.GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL).trim();
}

function generateGoogleReviewRequest(customerName, reviewUrl = getReviewUrl()) {
  const name = (customerName || 'Customer').trim();
  return (
    `Habari ${name}, asante kwa kutumia Supa Clean! Ikiwa umeridhika na huduma yetu, ` +
    `tafadhali tuachie maoni kwenye Google: ${reviewUrl} — Asante sana! ` +
    `Hi ${name}, thank you for choosing Supa Clean! If you were happy with our service, ` +
    `please leave us a Google review: ${reviewUrl} Thank you!`
  );
}

async function findDueReviewCustomers({ limit = 50 } = {}) {
  const delayHours = Math.max(1, parseInt(process.env.GOOGLE_REVIEW_DELAY_HOURS || '24', 10) || 24);
  const lookbackDays = Math.max(1, parseInt(process.env.GOOGLE_REVIEW_LOOKBACK_DAYS || '7', 10) || 7);
  const cooldownDays = Math.max(7, parseInt(process.env.GOOGLE_REVIEW_COOLDOWN_DAYS || '60', 10) || 60);

  const collectedBefore = new Date(Date.now() - delayHours * 3600000).toISOString();
  const collectedAfter = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const cooldownAfter = new Date(Date.now() - cooldownDays * 86400000).toISOString();

  const rows = await db.all(
    `SELECT DISTINCT ON (c.id)
       c.id AS customer_id,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.sms_notifications_enabled,
       o.id AS order_id,
       o.collected_date
     FROM customers c
     INNER JOIN orders o ON o.customer_id = c.id
     WHERE o.status = 'collected'
       AND o.collected_date IS NOT NULL
       AND o.collected_date <= ?
       AND o.collected_date >= ?
       AND c.phone IS NOT NULL
       AND TRIM(c.phone) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.customer_id = c.id
           AND n.notification_type = 'google_review'
           AND n.status IN ('sent', 'logged')
           AND COALESCE(n.sent_at, n.created_at) > ?
       )
     ORDER BY c.id, o.collected_date DESC
     LIMIT ?`,
    [collectedBefore, collectedAfter, cooldownAfter, limit]
  );

  return rows.filter((row) => !isPlaceholderPhone(row.customer_phone));
}

/**
 * @param {{ dryRun?: boolean, limit?: number }} options
 */
async function processDueGoogleReviewRequests(options = {}) {
  const dryRun = options.dry_run === true || options.dryRun === true;
  const limit = Math.min(200, Math.max(1, parseInt(options.limit || '50', 10) || 50));
  const reviewUrl = getReviewUrl();
  const candidates = await findDueReviewCustomers({ limit });

  if (dryRun) {
    return {
      dry_run: true,
      review_url: reviewUrl,
      eligible: candidates.length,
      customers: candidates.map((c) => ({
        customer_id: c.customer_id,
        name: c.customer_name,
        order_id: c.order_id,
        collected_date: c.collected_date,
      })),
    };
  }

  const results = [];
  for (const row of candidates) {
    if (row.sms_notifications_enabled === 0) {
      results.push({
        customer_id: row.customer_id,
        skipped: true,
        reason: 'sms_notifications_disabled',
      });
      continue;
    }

    const message = generateGoogleReviewRequest(row.customer_name, reviewUrl);
    try {
      const sent = await sendSmsWithWhatsAppFallback(row.customer_phone, message, {
        customerId: row.customer_id,
        orderId: row.order_id,
        notificationType: 'google_review',
        dedupeKey: `review:${row.customer_id}`,
      });
      results.push({
        customer_id: row.customer_id,
        order_id: row.order_id,
        success: !!sent?.success && !sent?.smsSuppressed,
        channel: sent?.channel || null,
        skippedDuplicate: !!sent?.skippedDuplicate,
        error: sent?.error || null,
      });
    } catch (err) {
      results.push({
        customer_id: row.customer_id,
        order_id: row.order_id,
        success: false,
        error: err.message,
      });
    }
  }

  const sentCount = results.filter((r) => r.success).length;
  return {
    dry_run: false,
    review_url: reviewUrl,
    eligible: candidates.length,
    sent: sentCount,
    results,
  };
}

module.exports = {
  DEFAULT_REVIEW_URL,
  generateGoogleReviewRequest,
  findDueReviewCustomers,
  processDueGoogleReviewRequests,
};
