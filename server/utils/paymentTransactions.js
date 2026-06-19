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
 * @param {string|null} paymentTimestampIso - Optional ISO timestamp for transaction_date
 * @returns {Promise<number>} Transaction ID
 */
async function recordPaymentTransactionClient(client, order, paymentAmount, paymentMethod, createdBy = 'System', paymentTimestampIso = null) {
  const result = await client.query(
    `INSERT INTO transactions
       (order_id, transaction_type, amount, payment_method, description, transaction_date, created_by, branch_id)
     VALUES ($1, 'payment_received', $2, $3, $4, COALESCE($5::timestamp, CURRENT_TIMESTAMP), $6, $7)
     RETURNING id`,
    [
      order.id,
      paymentAmount,
      paymentMethod || 'cash',
      `Payment for order ${order.receipt_number || order.id}`,
      paymentTimestampIso,
      createdBy,
      order.branch_id != null ? order.branch_id : null,
    ]
  );
  const id = result.rows?.[0]?.id;
  if (id == null) throw new Error('Failed to get transaction id from INSERT');
  return id;
}

async function recordPaymentTransaction(order, paymentAmount, paymentMethod, createdBy = 'System', paymentTimestampIso = null) {
  const client = await db.getPool().connect();
  try {
    return await recordPaymentTransactionClient(client, order, paymentAmount, paymentMethod, createdBy, paymentTimestampIso);
  } finally {
    client.release();
  }
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
     AND COALESCE(is_voided, FALSE) = FALSE
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
     AND transaction_type = 'payment_received'
     AND COALESCE(is_voided, FALSE) = FALSE`,
    [orderId]
  );
  return parseFloat(row?.total || 0);
}

/**
 * Log payment change to audit log
 * @param {Object} auditData - Audit log data
 * @returns {Promise<number>} Audit log ID
 */
async function logPaymentChangeClient(client, auditData) {
  const result = await client.query(
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
      auditData.notes ?? null,
    ]
  );
  return result.rows?.[0]?.id;
}

async function logPaymentChange(auditData) {
  const client = await db.getPool().connect();
  try {
    return await logPaymentChangeClient(client, auditData);
  } finally {
    client.release();
  }
}

module.exports = {
  recordPaymentTransaction,
  recordPaymentTransactionClient,
  checkDuplicatePayment,
  getTotalPaymentsForOrder,
  logPaymentChange,
  logPaymentChangeClient,
};
