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

module.exports = {
  validateCashBalance,
  calculateBookSales,
  calculateMobileMoneyReceived,
  calculateCardReceived,
  getPaymentHistory
};
