/**
 * Cash Validation Utilities
 * Validates cash balances and reconciles transactions
 */

const db = require('../database/query');
const { sqlActiveOrdersOnly, sqlActiveTransactionsOnly } = require('./orderVoidFilter');

/**
 * Validate cash balance for a date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} expectedCashInHand - Expected cash in hand
 * @returns {Promise<Object>} Validation result
 */
async function validateCashBalance(date, expectedCashInHand) {
  try {
    // Get all cash transactions for the day
    const row = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE DATE(transaction_date) = ?
       AND payment_method = 'cash'
       AND transaction_type = 'payment_received'
       ${sqlActiveTransactionsOnly()}`,
      [date]
    );
    
    const actualCash = parseFloat(row?.total || 0);
    const difference = Math.abs(actualCash - expectedCashInHand);
    const tolerance = 0.01; // Allow 0.01 tolerance for rounding
    
    return {
      valid: difference <= tolerance,
      difference,
      expected: expectedCashInHand,
      actual: actualCash,
      message: difference <= tolerance 
        ? 'Cash balance is valid' 
        : `Cash balance discrepancy: Expected ${expectedCashInHand.toFixed(2)}, Actual ${actualCash.toFixed(2)}, Difference: ${difference.toFixed(2)}`
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Calculate book sales: cash from payment_received transactions that are NOT already represented
 * in same-day cash_sales. Cash sales = orders booked that day, paid_full, cash; those amounts
 * must not also appear in book_sales or daily cash-in-hand is double-counted.
 * Excludes any cash txn linked to a receipt where every line that day is paid_full+cash.
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number|null} branchId - Branch ID; null for admin / no branch
 * @returns {Promise<number>} Book sales amount
 */
async function calculateBookSales(date, branchId = null) {
  try {
    if (branchId == null) {
      const row = await db.get(
        `WITH cash_sale_receipts AS (
           SELECT o.receipt_number, o.branch_id
           FROM orders o
           WHERE DATE(o.order_date) = ?::date
           ${sqlActiveOrdersOnly('o')}
           GROUP BY o.receipt_number, o.branch_id
           HAVING BOOL_AND(o.payment_status = 'paid_full' AND o.payment_method = 'cash')
         )
         SELECT COALESCE(SUM(t.amount), 0) AS total
         FROM transactions t
         LEFT JOIN orders o ON o.id = t.order_id
         WHERE DATE(t.transaction_date) = ?::date
           AND t.transaction_type = 'payment_received'
           AND t.payment_method = 'cash'
           ${sqlActiveTransactionsOnly('t')}
           AND (
             t.order_id IS NULL OR o.id IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM cash_sale_receipts r
               WHERE r.receipt_number = o.receipt_number
                 AND r.branch_id IS NOT DISTINCT FROM o.branch_id
             )
           )`,
        [date, date]
      );
      return parseFloat(row?.total || 0);
    }
    const row = await db.get(
      `WITH cash_sale_receipts AS (
         SELECT o.receipt_number, o.branch_id
         FROM orders o
         WHERE DATE(o.order_date) = ?::date
           AND (o.branch_id = ? OR o.branch_id IS NULL)
           ${sqlActiveOrdersOnly('o')}
         GROUP BY o.receipt_number, o.branch_id
         HAVING BOOL_AND(o.payment_status = 'paid_full' AND o.payment_method = 'cash')
       )
       SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE DATE(t.transaction_date) = ?::date
         AND t.transaction_type = 'payment_received'
         AND t.payment_method = 'cash'
         ${sqlActiveTransactionsOnly('t')}
         AND (t.branch_id = ? OR t.branch_id IS NULL)
         AND (
           t.order_id IS NULL OR o.id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM cash_sale_receipts r
             WHERE r.receipt_number = o.receipt_number
               AND r.branch_id IS NOT DISTINCT FROM o.branch_id
           )
         )`,
      [date, branchId, date, branchId]
    );
    return parseFloat(row?.total || 0);
  } catch (err) {
    throw err;
  }
}

/**
 * Calculate mobile money received from transactions on a given date (advance payments, receive-payment).
 * Used so M-Pesa payments recorded at collection/advance show in Cash Management.
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number|null} branchId - Branch ID; null for admin / no branch
 * @returns {Promise<number>} Total mobile money received
 */
async function calculateMobileMoneyReceived(date, branchId = null) {
  try {
    const params = [date];
    let branchClause = '';
    if (branchId != null) {
      branchClause = ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branchId);
    }
    const row = await db.get(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE DATE(transaction_date) = ?
       AND transaction_type = 'payment_received'
       AND payment_method = 'mobile_money'` + branchClause + sqlActiveTransactionsOnly(),
      params
    );
    return parseFloat(row?.total || 0);
  } catch (err) {
    throw err;
  }
}

/**
 * Calculate card received from transactions on a given date (advance payments, receive-payment).
 * Used so card payments recorded at collection/advance show in Cash Management.
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number|null} branchId - Branch ID; null for admin / no branch
 * @returns {Promise<number>} Total card received
 */
async function calculateCardReceived(date, branchId = null) {
  try {
    const params = [date];
    let branchClause = '';
    if (branchId != null) {
      branchClause = ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branchId);
    }
    const row = await db.get(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE DATE(transaction_date) = ?
       AND transaction_type = 'payment_received'
       AND payment_method = 'card'` + branchClause + sqlActiveTransactionsOnly(),
      params
    );
    return parseFloat(row?.total || 0);
  } catch (err) {
    throw err;
  }
}

/**
 * Calculate bank payments received from transactions on a given date (bank transfer / bank payments).
 * Used so bank payments recorded at collection/advance show in Cash Management.
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number|null} branchId - Branch ID; null for admin / no branch
 * @returns {Promise<number>} Total bank received
 */
async function calculateBankReceived(date, branchId = null) {
  try {
    const params = [date];
    let branchClause = '';
    if (branchId != null) {
      branchClause = ' AND (branch_id = ? OR branch_id IS NULL)';
      params.push(branchId);
    }
    const row = await db.get(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE DATE(transaction_date) = ?
       AND transaction_type = 'payment_received'
       AND (payment_method = 'bank' OR payment_method = 'bank_transfer')` + branchClause + sqlActiveTransactionsOnly(),
      params
    );
    return parseFloat(row?.total || 0);
  } catch (err) {
    throw err;
  }
}

/**
 * Get payment history for an order
 * @param {number} orderId - Order ID
 * @returns {Promise<Array>} Array of payment transactions
 */
async function getPaymentHistory(orderId) {
  try {
    const rows = await db.all(
      `SELECT * FROM transactions
       WHERE order_id = ?
       AND transaction_type = 'payment_received'
       ${sqlActiveTransactionsOnly()}
       ORDER BY transaction_date ASC`,
      [orderId]
    );
    return rows || [];
  } catch (err) {
    throw err;
  }
}

/**
 * Line items for daily cash sales total (paid-in-full cash orders on order_date).
 * One row per receipt: `orders` stores one row per garment/line item, so the same
 * receipt_number appears on multiple rows; we aggregate paid_amount to match how
 * cash_sales is summed in cashManagement.computeAndPersistDailySummary.
 */
async function listCashSalesOrdersForDate(date, branchId) {
  if (branchId == null) return [];
  const rows = await db.all(
    `SELECT MIN(o.id) AS order_id, o.receipt_number,
            MAX(c.name) AS customer_name, MAX(c.phone) AS customer_phone,
            SUM(o.paid_amount) AS paid_amount, SUM(o.total_amount) AS total_amount,
            CAST(SUM(COALESCE(o.quantity, 1)) AS INTEGER) AS item_count,
            MAX(o.order_date) AS order_date, MAX(o.payment_status) AS payment_status,
            MAX(o.payment_method) AS payment_method
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE DATE(o.order_date) = ?
       AND o.payment_status = 'paid_full'
       AND o.payment_method = 'cash'
       AND o.paid_amount > 0
       AND o.branch_id = ?
       ${sqlActiveOrdersOnly('o')}
     GROUP BY o.branch_id, o.receipt_number
     ORDER BY MAX(o.order_date) DESC, MIN(o.id) DESC`,
    [date, branchId]
  );
  return rows || [];
}

/**
 * Cash payment_received rows that count toward book_sales for the day (matches calculateBookSales).
 */
async function listBookSalesCashTransactionsForDate(date, branchId) {
  if (branchId == null) {
    const rows = await db.all(
      `WITH cash_sale_receipts AS (
         SELECT o.receipt_number, o.branch_id
         FROM orders o
         WHERE DATE(o.order_date) = ?::date
         ${sqlActiveOrdersOnly('o')}
         GROUP BY o.receipt_number, o.branch_id
         HAVING BOOL_AND(o.payment_status = 'paid_full' AND o.payment_method = 'cash')
       )
       SELECT t.id AS transaction_id, t.order_id, t.amount, t.payment_method, t.description,
              t.transaction_date, t.created_by, t.branch_id,
              o.receipt_number, c.name AS customer_name, c.phone AS customer_phone
       FROM transactions t
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE DATE(t.transaction_date) = ?::date
         AND t.transaction_type = 'payment_received'
         AND t.payment_method = 'cash'
         ${sqlActiveTransactionsOnly('t')}
         AND (
           t.order_id IS NULL OR o.id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM cash_sale_receipts r
             WHERE r.receipt_number = o.receipt_number
               AND r.branch_id IS NOT DISTINCT FROM o.branch_id
           )
         )
       ORDER BY t.transaction_date DESC, t.id DESC`,
      [date, date]
    );
    return rows || [];
  }
  const rows = await db.all(
    `WITH cash_sale_receipts AS (
       SELECT o.receipt_number, o.branch_id
       FROM orders o
       WHERE DATE(o.order_date) = ?::date
         AND (o.branch_id = ? OR o.branch_id IS NULL)
         ${sqlActiveOrdersOnly('o')}
       GROUP BY o.receipt_number, o.branch_id
       HAVING BOOL_AND(o.payment_status = 'paid_full' AND o.payment_method = 'cash')
     )
     SELECT t.id AS transaction_id, t.order_id, t.amount, t.payment_method, t.description,
            t.transaction_date, t.created_by, t.branch_id,
            o.receipt_number, c.name AS customer_name, c.phone AS customer_phone
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE DATE(t.transaction_date) = ?::date
       AND t.transaction_type = 'payment_received'
       AND t.payment_method = 'cash'
       ${sqlActiveTransactionsOnly('t')}
       AND (t.branch_id = ? OR t.branch_id IS NULL)
       AND (
         t.order_id IS NULL OR o.id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM cash_sale_receipts r
           WHERE r.receipt_number = o.receipt_number
             AND r.branch_id IS NOT DISTINCT FROM o.branch_id
         )
       )
     ORDER BY t.transaction_date DESC, t.id DESC`,
    [date, branchId, date, branchId]
  );
  return rows || [];
}

module.exports = {
  validateCashBalance,
  calculateBookSales,
  calculateMobileMoneyReceived,
  calculateCardReceived,
  calculateBankReceived,
  getPaymentHistory,
  listCashSalesOrdersForDate,
  listBookSalesCashTransactionsForDate
};
