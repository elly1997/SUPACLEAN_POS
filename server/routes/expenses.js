const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter } = require('../utils/branchFilter');

// Get all expenses (managers and admins can view)
router.get('/', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { start_date, end_date, category } = req.query;
  const branchFilter = getBranchFilter(req, 'e');
  
  let query = 'SELECT * FROM expenses e WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  // Add branch filter
  if (branchFilter.clause) {
    query += ' ' + branchFilter.clause.replace('e.', '');
    params.push(...branchFilter.params);
    paramIndex += branchFilter.params.length;
  }
  
  if (start_date) {
    query += ` AND e.date >= $${paramIndex++}`;
    params.push(start_date);
  }
  
  if (end_date) {
    query += ` AND e.date <= $${paramIndex++}`;
    params.push(end_date);
  }
  
  if (category) {
    query += ` AND e.category = $${paramIndex++}`;
    params.push(category);
  }
  
  query += ' ORDER BY e.date DESC, e.created_at DESC';
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get expense by ID (managers and admins can view)
router.get('/:id', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const row = await db.get('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new expense (managers and admins only)
router.post('/', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number,
    created_by
  } = req.body;
  
  if (!date || !category || !amount || !payment_source) {
    return res.status(400).json({ error: 'Date, category, amount, and payment_source are required' });
  }
  
  // Get branch_id from user (required for multi-branch support)
  const branchId = req.user?.branchId || null;
  if (!branchId && req.user?.role !== 'admin') {
    return res.status(400).json({ error: 'Branch assignment required for expense creation' });
  }
  
  try {
    const result = await db.run(
      `INSERT INTO expenses (date, category, amount, payment_source, description, receipt_number, created_by, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [date, category, amount, payment_source, description || null, receipt_number || null, created_by || null, branchId]
    );
    
    const expense = await db.get('SELECT * FROM expenses WHERE id = $1', [result.lastID]);
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update expense (managers and admins only)
router.put('/:id', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number
  } = req.body;
  
  try {
    const result = await db.run(
      `UPDATE expenses 
       SET date = $1, category = $2, amount = $3, payment_source = $4, description = $5, receipt_number = $6
       WHERE id = $7`,
      [date, category, amount, payment_source, description || null, receipt_number || null, id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    const expense = await db.get('SELECT * FROM expenses WHERE id = $1', [id]);
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete expense (managers and admins only)
router.delete('/:id', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await db.run('DELETE FROM expenses WHERE id = $1', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get expense summary by category (managers and admins can view)
router.get('/summary/by-category', authenticate, requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchFilter = getBranchFilter(req, 'e');
  
  let query = `
    SELECT 
      e.category,
      e.payment_source,
      SUM(e.amount) as total_amount,
      COUNT(*) as count
    FROM expenses e
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  // Add branch filter
  if (branchFilter.clause) {
    query += ' ' + branchFilter.clause.replace('e.', '');
    params.push(...branchFilter.params);
    paramIndex += branchFilter.params.length;
  }
  
  if (start_date) {
    query += ` AND e.date >= $${paramIndex++}`;
    params.push(start_date);
  }
  
  if (end_date) {
    query += ` AND e.date <= $${paramIndex++}`;
    params.push(end_date);
  }
  
  query += ' GROUP BY e.category, e.payment_source ORDER BY total_amount DESC';
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
