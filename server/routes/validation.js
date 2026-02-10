/**
 * Validation Routes
 * Endpoints for testing and validating payment records
 */

const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { validateCashBalance, calculateBookSales, getPaymentHistory } = require('../utils/cashValidation');
const { authenticate } = require('../middleware/auth');

// Validate cash balance for a date
router.get('/cash-balance/:date', authenticate, async (req, res) => {
  const { date } = req.params;
  const { expected_amount } = req.query;
  
  if (!expected_amount) {
    return res.status(400).json({ error: 'Expected amount is required as query parameter' });
  }
  
  try {
    const result = await validateCashBalance(date, parseFloat(expected_amount));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get payment history for an order
router.get('/payment-history/:orderId', authenticate, async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const history = await getPaymentHistory(parseInt(orderId));
    res.json({ orderId: parseInt(orderId), payments: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calculate book sales for a date
router.get('/book-sales/:date', authenticate, async (req, res) => {
  const { date } = req.params;
  
  try {
    const amount = await calculateBookSales(date);
    res.json({ date, bookSales: amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get payment audit log for an order
router.get('/audit-log/:orderId', authenticate, async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const rows = await db.all(
      `SELECT * FROM payment_audit_log
       WHERE order_id = ?
       ORDER BY changed_at DESC`,
      [orderId]
    );
    res.json({ orderId: parseInt(orderId), auditLog: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate all orders payment consistency
router.get('/validate-orders', authenticate, async (req, res) => {
  const { date } = req.query;
  
  let query = `
    SELECT 
      o.id,
      o.receipt_number,
      o.total_amount,
      o.paid_amount,
      o.payment_status,
      COALESCE(SUM(t.amount), 0) as transaction_total
    FROM orders o
    LEFT JOIN transactions t ON o.id = t.order_id AND t.transaction_type = 'payment_received'
    WHERE 1=1
  `;
  
  const params = [];
  if (date) {
    query += ' AND DATE(o.order_date) = ?';
    params.push(date);
  }
  
  query += ' GROUP BY o.id';
  
  try {
    const rows = await db.all(query, params);
    
    const inconsistencies = rows.filter(row => {
      const paidAmount = parseFloat(row.paid_amount || 0);
      const transactionTotal = parseFloat(row.transaction_total || 0);
      return Math.abs(paidAmount - transactionTotal) > 0.01; // Allow 0.01 tolerance
    });
    
    res.json({
      totalOrders: rows.length,
      inconsistentOrders: inconsistencies.length,
      inconsistencies: inconsistencies.map(row => ({
        orderId: row.id,
        receiptNumber: row.receipt_number,
        orderPaidAmount: parseFloat(row.paid_amount || 0),
        transactionTotal: parseFloat(row.transaction_total || 0),
        difference: Math.abs(parseFloat(row.paid_amount || 0) - parseFloat(row.transaction_total || 0))
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
