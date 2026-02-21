const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');

router.use(authenticate, requireBranchFeature('expenses'));

// Get all expenses (managers and admins can view), with bank account name for Bank Deposit category
router.get('/', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { start_date, end_date, category } = req.query;
  const branchFilter = getBranchFilter(req, 'e');
  
  let query = 'SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name FROM expenses e LEFT JOIN bank_accounts b ON e.bank_account_id = b.id LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id WHERE 1=1';
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

// Get expense by ID (managers and admins can view); branch users only their branch
router.get('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  const branchFilter = getBranchFilter(req, 'e');
  const params = [id];
  const whereClause = branchFilter.clause ? ` AND ${branchFilter.clause.replace(/^AND\s+/, '').replace(/e\./g, 'e.')}` : '';
  
  try {
    const row = await db.get(
      `SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name FROM expenses e LEFT JOIN bank_accounts b ON e.bank_account_id = b.id LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id WHERE e.id = ? ${whereClause}`,
      branchFilter.params.length ? [...params, ...branchFilter.params] : params
    );
    if (!row) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new expense (managers and admins only). If category is "Bank Deposit", also creates a bank_deposits row.
router.post('/', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number,
    created_by,
    bank_account_id,
    deposit_reference_number,
    bank_name: deposit_bank_name
  } = req.body;
  
  if (!date || !category || !amount || !payment_source) {
    return res.status(400).json({ error: 'Date, category, amount, and payment_source are required' });
  }
  
  const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? req.branch?.id ?? null;
  if (!branchId) {
    return res.status(400).json({
      error: req.user?.role === 'admin'
        ? 'Select a branch in the header to record expenses, or ensure branch is set.'
        : 'Your account is not assigned to a branch. Contact the administrator to assign your account to a branch before recording expenses.'
    });
  }
  
  if (category === 'Bank Deposit') {
    const accountId = bank_account_id != null && bank_account_id !== '' ? Number(bank_account_id) : null;
    const otherName = deposit_bank_name && String(deposit_bank_name).trim() ? String(deposit_bank_name).trim() : null;
    if (!accountId && !otherName) {
      return res.status(400).json({ error: 'For Bank Deposit, select a bank account or enter bank name (Other)' });
    }
  }
  
  try {
    let bankDepositId = null;
    if (category === 'Bank Deposit' && branchId) {
      const accountId = bank_account_id != null && bank_account_id !== '' ? Number(bank_account_id) : null;
      const otherName = deposit_bank_name && String(deposit_bank_name).trim() ? String(deposit_bank_name).trim() : null;
      const depResult = await db.run(
        `INSERT INTO bank_deposits (date, amount, reference_number, bank_name, bank_account_id, notes, created_by, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          date,
          amount,
          deposit_reference_number || null,
          otherName || null,
          accountId,
          description || null,
          created_by || null,
          branchId
        ]
      );
      bankDepositId = depResult.lastID ?? depResult.row?.id;
    }
    
    const result = await db.run(
      `INSERT INTO expenses (date, category, amount, payment_source, description, receipt_number, created_by, branch_id, bank_account_id, deposit_reference_number, bank_deposit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        date,
        category,
        amount,
        payment_source,
        description || null,
        receipt_number || null,
        created_by || null,
        branchId,
        (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null,
        deposit_reference_number || null,
        bankDepositId
      ]
    );
    
    const expense = await db.get(
      'SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name FROM expenses e LEFT JOIN bank_accounts b ON e.bank_account_id = b.id LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id WHERE e.id = $1',
      [result.lastID]
    );
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update expense (managers and admins only). If expense has bank_deposit_id, updates the linked bank_deposit.
router.put('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number,
    bank_account_id,
    deposit_reference_number,
    bank_name: deposit_bank_name
  } = req.body;
  
  try {
    const existing = await db.get('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    const result = await db.run(
      `UPDATE expenses 
       SET date = $1, category = $2, amount = $3, payment_source = $4, description = $5, receipt_number = $6,
           bank_account_id = $7, deposit_reference_number = $8
       WHERE id = $9`,
      [
        date,
        category,
        amount,
        payment_source,
        description || null,
        receipt_number || null,
        (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null,
        deposit_reference_number || null,
        id
      ]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    if (existing.bank_deposit_id) {
      const accountId = (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null;
      const otherName = deposit_bank_name && String(deposit_bank_name).trim() ? String(deposit_bank_name).trim() : null;
      await db.run(
        `UPDATE bank_deposits SET date = $1, amount = $2, reference_number = $3, bank_name = $4, bank_account_id = $5, notes = $6 WHERE id = $7`,
        [date, amount, deposit_reference_number || null, otherName, accountId, description || null, existing.bank_deposit_id]
      );
    }
    
    const expense = await db.get(
      'SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name FROM expenses e LEFT JOIN bank_accounts b ON e.bank_account_id = b.id LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id WHERE e.id = $1',
      [id]
    );
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete expense (managers and admins only). If expense has linked bank_deposit, deletes it first.
router.delete('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const existing = await db.get('SELECT bank_deposit_id FROM expenses WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    if (existing.bank_deposit_id) {
      await db.run('DELETE FROM bank_deposits WHERE id = $1', [existing.bank_deposit_id]);
    }
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
router.get('/summary/by-category', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
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
