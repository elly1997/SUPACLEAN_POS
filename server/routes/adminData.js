/**
 * Admin-only data operations (e.g. clear all customer/order data for fresh start).
 */
const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

// Clear all customer and related transaction data (admin only). Requires confirmation body.
router.post('/clear-customer-data', authenticate, requireRole('admin'), async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'CLEAR') {
    return res.status(400).json({
      error: 'Confirmation required. Send { "confirm": "CLEAR" } to clear all customers, orders, and related data.',
    });
  }

  try {
    // Delete in order that respects foreign keys (child tables first).
    await db.run('DELETE FROM loyalty_transactions', []);
    await db.run('DELETE FROM loyalty_points', []);
    await db.run('DELETE FROM payment_audit_log', []);
    await db.run('DELETE FROM transactions', []);
    await db.run('DELETE FROM notifications', []);
    try {
      await db.run('DELETE FROM order_item_photos', []);
    } catch (e) {
      if (!e.message || !/does not exist|relation.*order_item_photos/i.test(e.message)) throw e;
    }
    try {
      await db.run('DELETE FROM order_transfers', []);
    } catch (e) {
      if (!e.message || !/does not exist|relation.*order_transfers/i.test(e.message)) throw e;
    }
    await db.run('DELETE FROM orders', []);
    const customersResult = await db.run('DELETE FROM customers', []);
    const deletedCustomers = customersResult?.changes ?? customersResult?.rowCount ?? 0;

    console.log('Admin clear-customer-data: completed. Customers (and related data) cleared.');
    res.json({
      success: true,
      message: 'All customer and order data has been cleared. You can start fresh with real customers.',
      deletedCustomers,
    });
  } catch (err) {
    console.error('Clear customer data error:', err);
    res.status(500).json({ error: err.message || 'Failed to clear data' });
  }
});

module.exports = router;
