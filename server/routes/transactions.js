const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');
const { sqlActiveTransactionsOnly } = require('../utils/orderVoidFilter');

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
    ${sqlActiveTransactionsOnly('t')}
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
  const branchFilterTx = getBranchFilter(req, 't');
  const branchFilterCash = getBranchFilter(req, 'd');

  try {
    // Source-of-truth financial totals from daily_cash_summaries (same as Cash Management).
    const cashRow = await db.get(
      `SELECT
         COALESCE(SUM(COALESCE(d.cash_sales,0) + COALESCE(d.book_sales,0) + COALESCE(d.card_sales,0) + COALESCE(d.mobile_money_sales,0)), 0) AS total_income,
         COALESCE(SUM(COALESCE(d.cash_sales,0) + COALESCE(d.book_sales,0)), 0) AS cash_income,
         COALESCE(SUM(COALESCE(d.card_sales,0) + COALESCE(d.mobile_money_sales,0)), 0) AS non_cash_income,
         COALESCE(SUM(COALESCE(d.expenses_from_cash,0) + COALESCE(d.expenses_from_bank,0) + COALESCE(d.expenses_from_mpesa,0)), 0) AS total_expenses
       FROM daily_cash_summaries d
       WHERE d.date = ?
       ${branchFilterCash.clause}`,
      [targetDate, ...branchFilterCash.params]
    );
    const txCountRow = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('payment', 'payment_received') THEN 1 ELSE 0 END), 0) as total_transactions
       FROM transactions t
       WHERE DATE(t.transaction_date) = ?
       ${branchFilterTx.clause}`,
      [targetDate, ...branchFilterTx.params]
    );
    const row = {
      total_transactions: Number(txCountRow?.total_transactions || 0),
      total_income: Number(cashRow?.total_income || 0),
      total_expenses: Number(cashRow?.total_expenses || 0),
      cash_income: Number(cashRow?.cash_income || 0),
      non_cash_income: Number(cashRow?.non_cash_income || 0)
    };
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
