const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');

// Get all transactions
router.get('/', authenticate, requireBranchAccess(), async (req, res) => {
  const { date, type } = req.query;
  const branchFilter = getBranchFilter(req, 't');
  
  let query = `
    SELECT t.*, o.receipt_number, c.name as customer_name
    FROM transactions t
    LEFT JOIN orders o ON t.order_id = o.id
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE 1=1
    ${branchFilter.clause}
  `;
  let params = [...branchFilter.params];

  if (date) {
    query += ' AND DATE(t.transaction_date) = ?';
    params.push(date);
  }

  if (type) {
    query += ' AND t.transaction_type = ?';
    params.push(type);
  }

  query += ' ORDER BY t.transaction_date DESC';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get daily summary
router.get('/daily-summary', authenticate, requireBranchAccess(), async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const branchFilter = getBranchFilter(req, 't');

  // Include both 'payment' (legacy/import) and 'payment_received' (receive-payment, collect, new order cash)
  // so Today's Income reflects all amounts collected by the cashier (book + cash sales).
  const query = `
    SELECT 
      SUM(CASE WHEN transaction_type IN ('payment', 'payment_received') THEN 1 ELSE 0 END) as total_transactions,
      SUM(CASE WHEN transaction_type IN ('payment', 'payment_received') THEN amount ELSE 0 END) as total_income,
      SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) as total_expenses,
      SUM(CASE WHEN transaction_type IN ('payment', 'payment_received') AND payment_method = 'cash' THEN amount ELSE 0 END) as cash_income,
      SUM(CASE WHEN transaction_type IN ('payment', 'payment_received') AND (payment_method IS NULL OR payment_method != 'cash') THEN amount ELSE 0 END) as non_cash_income
    FROM transactions t
    WHERE DATE(t.transaction_date) = ?
    ${branchFilter.clause}
  `;

  try {
    const row = await db.get(query, [targetDate, ...branchFilter.params]);
    res.json({
      date: targetDate,
      ...row,
      net_income: (row?.total_income || 0) - (row?.total_expenses || 0)
    });
  } catch (err) {
    console.error('Error fetching daily summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add manual transaction (for expenses, etc.)
router.post('/', authenticate, requireBranchAccess(), async (req, res) => {
  const { transaction_type, amount, payment_method, description, created_by } = req.body;

  if (!transaction_type || !amount) {
    return res.status(400).json({ error: 'Transaction type and amount are required' });
  }

  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to record transactions' });
  }
  try {
    const result = await db.run(
      'INSERT INTO transactions (transaction_type, amount, payment_method, description, created_by, branch_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      [transaction_type, amount, payment_method || 'cash', description || null, created_by || null, branchId]
    );
    res.json({ id: result.lastID, message: 'Transaction recorded successfully' });
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
