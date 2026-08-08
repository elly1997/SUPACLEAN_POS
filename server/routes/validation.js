/**
 * Validation Routes
 * Endpoints for testing and validating payment records (branch-scoped).
 */

const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { validateCashBalance, calculateBookSales, getPaymentHistory } = require('../utils/cashValidation');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');

router.use(authenticate, requireBranchAccess());

// Validate cash balance for a date
router.get(
  '/cash-balance/:date',
  requirePermission('canManageCash'),
  async (req, res) => {
    const { date } = req.params;
    const { expected_amount } = req.query;

    if (!expected_amount) {
      return res.status(400).json({ error: 'Expected amount is required as query parameter' });
    }

    try {
      const result = await validateCashBalance(date, parseFloat(expected_amount));
      res.json(result);
    } catch (err) {
      console.error('cash-balance validation error:', err);
      res.status(500).json({ error: 'Validation failed' });
    }
  }
);

// Get payment history for an order (must belong to caller's branch unless admin all-branches)
router.get(
  '/payment-history/:orderId',
  requireAnyPermission('canManageCash', 'canManageOrders'),
  async (req, res) => {
    const { orderId } = req.params;
    const branchFilter = getBranchFilter(req, 'o');

    try {
      const order = await db.get(
        `SELECT o.id FROM orders o WHERE o.id = ? ${branchFilter.clause}`,
        [orderId, ...branchFilter.params]
      );
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      const history = await getPaymentHistory(parseInt(orderId, 10));
      res.json({ orderId: parseInt(orderId, 10), payments: history });
    } catch (err) {
      console.error('payment-history error:', err);
      res.status(500).json({ error: 'Failed to load payment history' });
    }
  }
);

// Calculate book sales for a date (scoped to effective branch)
router.get('/book-sales/:date', requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);

  try {
    const amount = await calculateBookSales(date, branchId);
    res.json({ date, bookSales: amount, branch_id: branchId });
  } catch (err) {
    console.error('book-sales error:', err);
    res.status(500).json({ error: 'Failed to calculate book sales' });
  }
});

// Get payment audit log for an order
router.get(
  '/audit-log/:orderId',
  requireAnyPermission('canManageCash', 'canManageOrders'),
  async (req, res) => {
    const { orderId } = req.params;
    const branchFilter = getBranchFilter(req, 'o');

    try {
      const order = await db.get(
        `SELECT o.id FROM orders o WHERE o.id = ? ${branchFilter.clause}`,
        [orderId, ...branchFilter.params]
      );
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      const rows = await db.all(
        `SELECT * FROM payment_audit_log
         WHERE order_id = ?
         ORDER BY changed_at DESC`,
        [orderId]
      );
      res.json({ orderId: parseInt(orderId, 10), auditLog: rows });
    } catch (err) {
      console.error('audit-log error:', err);
      res.status(500).json({ error: 'Failed to load audit log' });
    }
  }
);

// Validate orders payment consistency (branch-scoped)
router.get('/validate-orders', requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.query;
  const branchFilter = getBranchFilter(req, 'o');

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
    ${branchFilter.clause}
  `;

  const params = [...branchFilter.params];
  if (date) {
    query += ' AND DATE(o.order_date) = ?';
    params.push(date);
  }

  query += ' GROUP BY o.id, o.receipt_number, o.total_amount, o.paid_amount, o.payment_status';

  try {
    const rows = await db.all(query, params);

    const inconsistencies = rows.filter((row) => {
      const paidAmount = parseFloat(row.paid_amount || 0);
      const transactionTotal = parseFloat(row.transaction_total || 0);
      return Math.abs(paidAmount - transactionTotal) > 0.01;
    });

    res.json({
      totalOrders: rows.length,
      inconsistentOrders: inconsistencies.length,
      inconsistencies: inconsistencies.map((row) => ({
        orderId: row.id,
        receiptNumber: row.receipt_number,
        orderPaidAmount: parseFloat(row.paid_amount || 0),
        transactionTotal: parseFloat(row.transaction_total || 0),
        difference: Math.abs(parseFloat(row.paid_amount || 0) - parseFloat(row.transaction_total || 0)),
      })),
    });
  } catch (err) {
    console.error('validate-orders error:', err);
    res.status(500).json({ error: 'Failed to validate orders' });
  }
});

module.exports = router;
