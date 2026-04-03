/**
 * Cash Validation Utilities
 * Validates cash balances and reconciles transactions
 */

const db = require('../database/query');

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
       AND transaction_type = 'payment_received'`,
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
 * Calculate book sales: cash received from receive-payment / collection on the given date.
 * This feeds daily sales report so amounts the cashier receives at collection reflect in book sales.
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number|null} branchId - Branch ID; null for admin / no branch
 * @returns {Promise<number>} Book sales amount
 */
async function calculateBookSales(date, branchId = null) {
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
       AND payment_method = 'cash'` + branchClause,
      params
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
       AND payment_method = 'mobile_money'` + branchClause,
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
       AND payment_method = 'card'` + branchClause,
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
       AND (payment_method = 'bank' OR payment_method = 'bank_transfer')` + branchClause,
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
 * Must match the query in cashManagement.computeAndPersistDailySummary.
 */
async function listCashSalesOrdersForDate(date, branchId) {
  if (branchId == null) return [];
  const rows = await db.all(
    `SELECT o.id AS order_id, o.receipt_number, c.name AS customer_name, c.phone AS customer_phone,
            o.paid_amount, o.total_amount, o.order_date, o.payment_status, o.payment_method
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE DATE(o.order_date) = ?
       AND o.payment_status = 'paid_full'
       AND o.payment_method = 'cash'
       AND o.paid_amount > 0
       AND o.branch_id = ?
     ORDER BY o.order_date DESC, o.id DESC`,
    [date, branchId]
  );
  return rows || [];
}

/**
 * Cash payment_received transactions on a calendar day (book sales / collections).
 * Must match calculateBookSales branch filter.
 */
async function listBookSalesCashTransactionsForDate(date, branchId) {
  const params = [date];
  let branchClause = '';
  if (branchId != null) {
    branchClause = ' AND (t.branch_id = ? OR t.branch_id IS NULL)';
    params.push(branchId);
  }
  const rows = await db.all(
    `SELECT t.id AS transaction_id, t.order_id, t.amount, t.payment_method, t.description,
            t.transaction_date, t.created_by, t.branch_id,
            o.receipt_number, c.name AS customer_name, c.phone AS customer_phone
     FROM transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE DATE(t.transaction_date) = ?
       AND t.transaction_type = 'payment_received'
       AND t.payment_method = 'cash'` +
      branchClause +
      ` ORDER BY t.transaction_date DESC, t.id DESC`,
    params
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
