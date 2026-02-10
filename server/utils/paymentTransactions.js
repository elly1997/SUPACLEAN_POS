/**
 * Payment Transaction Utilities
 * Handles automatic transaction recording and payment tracking
 * Uses PostgreSQL (query) to match orders DB — fixes FK constraint errors.
 */

const db = require('../database/query');

/**
 * Record payment transaction in transactions table
 * @param {Object} order - Order object { id, receipt_number, branch_id }
 * @param {number} paymentAmount - Payment amount
 * @param {string} paymentMethod - Payment method
 * @param {string} createdBy - User who created the transaction
 * @returns {Promise<number>} Transaction ID
 */
async function recordPaymentTransaction(order, paymentAmount, paymentMethod, createdBy = 'System') {
  const result = await db.run(
    `INSERT INTO transactions 
     (order_id, transaction_type, amount, payment_method, description, created_by, branch_id)
     VALUES ($1, 'payment_received', $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      order.id,
      paymentAmount,
      paymentMethod || 'cash',
      `Payment for order ${order.receipt_number || order.id}`,
      createdBy,
      order.branch_id != null ? order.branch_id : null
    ]
  );
  const id = result?.row?.id ?? result?.lastID;
  if (id == null) throw new Error('Failed to get transaction id from INSERT');
  return id;
}

/**
 * Check for duplicate payments (same order, amount, within 1 minute)
 * @param {number} orderId - Order ID
 * @param {number} amount - Payment amount
 * @param {string} timestamp - ISO timestamp
 * @returns {Promise<boolean>} True if duplicate found
 */
async function checkDuplicatePayment(orderId, amount, timestamp) {
  const row = await db.get(
    `SELECT id FROM transactions
     WHERE order_id = $1
     AND amount = $2
     AND transaction_type = 'payment_received'
     AND transaction_date >= $3::timestamp - INTERVAL '1 minute'
     AND transaction_date <= $3::timestamp + INTERVAL '1 minute'`,
    [orderId, amount, timestamp]
  );
  return !!row;
}

/**
 * Get total payments for an order
 * @param {number} orderId - Order ID
 * @returns {Promise<number>} Total paid amount
 */
async function getTotalPaymentsForOrder(orderId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE order_id = $1
     AND transaction_type = 'payment_received'`,
    [orderId]
  );
  return parseFloat(row?.total || 0);
}

/**
 * Log payment change to audit log
 * @param {Object} auditData - Audit log data
 * @returns {Promise<number>} Audit log ID
 */
async function logPaymentChange(auditData) {
  const result = await db.run(
    `INSERT INTO payment_audit_log 
     (order_id, action, old_payment_status, new_payment_status, 
      old_paid_amount, new_paid_amount, old_payment_method, new_payment_method, 
      changed_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      auditData.order_id,
      auditData.action || 'updated',
      auditData.old_payment_status ?? null,
      auditData.new_payment_status ?? null,
      auditData.old_paid_amount ?? null,
      auditData.new_paid_amount ?? null,
      auditData.old_payment_method ?? null,
      auditData.new_payment_method ?? null,
      auditData.changed_by || 'System',
      auditData.notes ?? null
    ]
  );
  return result?.row?.id ?? result?.lastID;
}

module.exports = {
  recordPaymentTransaction,
  checkDuplicatePayment,
  getTotalPaymentsForOrder,
  logPaymentChange
};
