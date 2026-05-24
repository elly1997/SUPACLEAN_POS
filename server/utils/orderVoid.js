/**
 * Void an entire receipt (all line items) and reverse related payment transactions + loyalty.
 */
const db = require('../database/query');
const cashManagement = require('../routes/cashManagement');
const { logPaymentChange } = require('./paymentTransactions');

const LOYALTY_TIERS = {
  Platinum: { minPoints: 5000 },
  Gold: { minPoints: 2000 },
  Silver: { minPoints: 500 },
  Bronze: { minPoints: 0 }
};

function calculateTier(lifetimePoints) {
  if (lifetimePoints >= LOYALTY_TIERS.Platinum.minPoints) return 'Platinum';
  if (lifetimePoints >= LOYALTY_TIERS.Gold.minPoints) return 'Gold';
  if (lifetimePoints >= LOYALTY_TIERS.Silver.minPoints) return 'Silver';
  return 'Bronze';
}

function normalizeDate(d) {
  if (d == null || d === '') return null;
  const s = String(d).trim();
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

async function isReconciledDay(date, branchId) {
  if (branchId == null || !date) return false;
  const row = await db.get(
    'SELECT is_reconciled FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [date, branchId]
  );
  return !!(row && row.is_reconciled);
}

async function refreshDailyClosingForOrderDates(branchId, ...dates) {
  if (branchId == null) {
    return { reconciledDaysForced: [], anchor: null };
  }
  const normalized = [...new Set(dates.map(normalizeDate).filter(Boolean))].sort();
  if (!normalized.length) {
    return { reconciledDaysForced: [], anchor: null };
  }
  const anchor = normalized[0];
  const reconciledDaysForced = [];
  try {
    for (const d of normalized) {
      if (await isReconciledDay(d, branchId)) {
        await cashManagement.refreshDailySummaryForce(d, branchId);
        reconciledDaysForced.push(d);
      }
    }
    await cashManagement.refreshUnreconciledSummariesFromDate(branchId, anchor);
  } catch (err) {
    console.error('refreshDailyClosingForOrderDates failed:', anchor, err.message);
  }
  return { reconciledDaysForced, anchor };
}

async function reverseLoyaltyForOrder(customerId, orderId, voidedBy) {
  const earnedRows = await db.all(
    `SELECT * FROM loyalty_transactions
     WHERE customer_id = ? AND order_id = ? AND transaction_type = 'earned'`,
    [customerId, orderId]
  );
  if (!earnedRows?.length) return 0;

  const alreadyReversed = await db.get(
    `SELECT id FROM loyalty_transactions
     WHERE customer_id = ? AND order_id = ? AND transaction_type = 'reversed'
     LIMIT 1`,
    [customerId, orderId]
  );
  if (alreadyReversed) return 0;

  let totalReversed = 0;
  const loyalty = await db.get('SELECT * FROM loyalty_points WHERE customer_id = ?', [customerId]);
  if (!loyalty) return 0;

  let currentPoints = loyalty.current_points;
  let lifetimePoints = loyalty.lifetime_points;

  for (const row of earnedRows) {
    const points = Number(row.points) || 0;
    if (points <= 0) continue;
    totalReversed += points;
    currentPoints = Math.max(0, currentPoints - points);
    lifetimePoints = Math.max(0, lifetimePoints - points);
  }

  if (totalReversed <= 0) return 0;

  const newTier = calculateTier(lifetimePoints);
  await db.run(
    `UPDATE loyalty_points
     SET current_points = ?, lifetime_points = ?, tier = ?, updated_at = CURRENT_TIMESTAMP
     WHERE customer_id = ?`,
    [currentPoints, lifetimePoints, newTier, customerId]
  );
  await db.run(
    `INSERT INTO loyalty_transactions
     (customer_id, order_id, transaction_type, points, description, balance_after)
     VALUES (?, ?, 'reversed', ?, ?, ?)`,
    [
      customerId,
      orderId,
      -totalReversed,
      `Points reversed — receipt voided by ${voidedBy}`,
      currentPoints
    ]
  );
  return totalReversed;
}

/**
 * Void all orders on a receipt and reverse payment transactions + loyalty effects.
 * @param {string} receiptNumber
 * @param {object} options
 * @returns {Promise<object>}
 */
async function voidReceiptByNumber(receiptNumber, options = {}) {
  const {
    voidReason = 'Voided by user',
    voidedBy = 'User',
    acknowledgeReconciledDay = false,
    branchFilterClause = '',
    branchFilterParams = []
  } = options;

  const allOrders = await db.all(
    `SELECT o.*
     FROM orders o
     WHERE UPPER(o.receipt_number) = UPPER(?)
     ${branchFilterClause}
     ORDER BY o.id`,
    [receiptNumber, ...branchFilterParams]
  );

  if (!allOrders?.length) {
    const err = new Error('Receipt not found or access denied');
    err.status = 404;
    throw err;
  }

  if (allOrders.some((o) => o.is_voided)) {
    const err = new Error('This receipt has already been voided');
    err.status = 400;
    throw err;
  }

  const orderIds = allOrders.map((o) => o.id);
  const branchId = allOrders[0].branch_id;
  const customerId = allOrders[0].customer_id;
  const receiptPaid = allOrders.reduce((s, o) => s + (parseFloat(o.paid_amount) || 0), 0);

  const placeholders = orderIds.map(() => '?').join(', ');
  const transactions = await db.all(
    `SELECT * FROM transactions
     WHERE order_id IN (${placeholders})
       AND transaction_type = 'payment_received'
       AND COALESCE(is_voided, FALSE) = FALSE`,
    orderIds
  );

  const affectedDates = new Set();
  for (const o of allOrders) {
    const d = normalizeDate(o.order_date);
    if (d) affectedDates.add(d);
  }
  for (const t of transactions || []) {
    const d = normalizeDate(t.transaction_date);
    if (d) affectedDates.add(d);
  }

  if (!acknowledgeReconciledDay && branchId != null) {
    for (const d of affectedDates) {
      if (await isReconciledDay(d, branchId)) {
        const err = new Error(
          'This receipt touches a reconciled day. Confirm again to void and recalculate the locked daily summary (send acknowledge_reconciled_day).'
        );
        err.status = 409;
        err.code = 'reconciled_day';
        throw err;
      }
    }
  }

  await db.run(
    `UPDATE orders
     SET is_voided = TRUE,
         void_reason = ?,
         voided_by = ?,
         voided_at = CURRENT_TIMESTAMP,
         status = 'voided',
         payment_status = 'voided',
         paid_amount = 0
     WHERE id IN (${placeholders})`,
    [voidReason, voidedBy, ...orderIds]
  );

  let transactionsVoided = 0;
  if (transactions?.length) {
    const txResult = await db.run(
      `UPDATE transactions
       SET is_voided = TRUE,
           void_reason = ?,
           voided_by = ?,
           voided_at = CURRENT_TIMESTAMP
       WHERE order_id IN (${placeholders})
         AND transaction_type = 'payment_received'
         AND COALESCE(is_voided, FALSE) = FALSE`,
      [voidReason, voidedBy, ...orderIds]
    );
    transactionsVoided = txResult?.changes ?? transactions.length;
  }

  let loyaltyPointsReversed = 0;
  for (const orderId of orderIds) {
    loyaltyPointsReversed += await reverseLoyaltyForOrder(customerId, orderId, voidedBy);
  }

  await logPaymentChange({
    order_id: allOrders[0].id,
    action: 'voided',
    old_payment_status: allOrders[0].payment_status,
    new_payment_status: 'voided',
    old_paid_amount: receiptPaid,
    new_paid_amount: 0,
    old_payment_method: allOrders[0].payment_method,
    new_payment_method: allOrders[0].payment_method,
    changed_by: voidedBy,
    notes: voidReason
  });

  const closingRefresh = branchId != null
    ? await refreshDailyClosingForOrderDates(branchId, ...affectedDates)
    : { reconciledDaysForced: [] };

  return {
    message: `Receipt voided successfully (${allOrders.length} item${allOrders.length === 1 ? '' : 's'})`,
    receipt_number: receiptNumber,
    items_voided: allOrders.length,
    transactions_voided: transactionsVoided,
    loyalty_points_reversed: loyaltyPointsReversed,
    reconciled_days_refreshed: closingRefresh.reconciledDaysForced || []
  };
}

module.exports = {
  voidReceiptByNumber,
  normalizeDate,
  isReconciledDay,
  refreshDailyClosingForOrderDates
};
