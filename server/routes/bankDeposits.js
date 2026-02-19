const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getEffectiveBranchId } = require('../utils/branchFilter');

router.use(authenticate, requireBranchFeature('bank_deposits'));

// Get all bank deposits (filtered by branch when not admin or when branch selected)
router.get('/', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchId = getEffectiveBranchId(req);
  
  let query = `SELECT d.*, b.name as bank_account_name 
    FROM bank_deposits d 
    LEFT JOIN bank_accounts b ON d.bank_account_id = b.id 
    WHERE 1=1`;
  const params = [];
  
  if (branchId != null) {
    query += ' AND d.branch_id = ?';
    params.push(branchId);
  }
  if (start_date) {
    query += ' AND d.date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND d.date <= ?';
    params.push(end_date);
  }
  
  query += ' ORDER BY d.date DESC, d.created_at DESC';
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get deposit by ID
router.get('/:id', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { id } = req.params;
  const branchId = getEffectiveBranchId(req);
  
  try {
    let query = `SELECT d.*, b.name as bank_account_name FROM bank_deposits d LEFT JOIN bank_accounts b ON d.bank_account_id = b.id WHERE d.id = ?`;
    const params = [id];
    if (branchId != null) {
      query += ' AND d.branch_id = ?';
      params.push(branchId);
    }
    const row = await db.get(query, params);
    if (!row) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new bank deposit
router.post('/', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const {
    date,
    amount,
    reference_number,
    bank_name,
    bank_account_id,
    notes,
    created_by
  } = req.body;
  const branchId = getEffectiveBranchId(req);
  
  if (!date || amount == null || amount === '') {
    return res.status(400).json({ error: 'Date and amount are required' });
  }
  
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to record a bank deposit' });
  }
  
  const displayName = bank_name && bank_name.trim() ? bank_name.trim() : null;
  
  try {
    const result = await db.run(
      `INSERT INTO bank_deposits (date, amount, reference_number, bank_name, bank_account_id, notes, created_by, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, amount, reference_number || null, displayName, bank_account_id || null, notes || null, created_by || null, branchId]
    );
    
    const deposit = await db.get(
      `SELECT d.*, b.name as bank_account_name FROM bank_deposits d LEFT JOIN bank_accounts b ON d.bank_account_id = b.id WHERE d.id = ?`,
      [result.lastID]
    );
    res.status(201).json(deposit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update bank deposit
router.put('/:id', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { id } = req.params;
  const {
    date,
    amount,
    reference_number,
    bank_name,
    bank_account_id,
    notes
  } = req.body;
  const branchId = getEffectiveBranchId(req);
  
  try {
    let query = `UPDATE bank_deposits SET date = ?, amount = ?, reference_number = ?, bank_name = ?, bank_account_id = ?, notes = ? WHERE id = ?`;
    const params = [date, amount, reference_number || null, (bank_name && bank_name.trim()) || null, bank_account_id || null, notes || null, id];
    if (branchId != null) {
      query += ' AND branch_id = ?';
      params.push(branchId);
    }
    const result = await db.run(query, params);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    
    const deposit = await db.get(
      `SELECT d.*, b.name as bank_account_name FROM bank_deposits d LEFT JOIN bank_accounts b ON d.bank_account_id = b.id WHERE d.id = ?`,
      [id]
    );
    res.json(deposit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete bank deposit
router.delete('/:id', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { id } = req.params;
  const branchId = getEffectiveBranchId(req);
  
  try {
    let query = 'DELETE FROM bank_deposits WHERE id = ?';
    const params = [id];
    if (branchId != null) {
      query += ' AND branch_id = ?';
      params.push(branchId);
    }
    const result = await db.run(query, params);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    res.json({ message: 'Deposit deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get total deposits by date range
router.get('/summary/total', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchId = getEffectiveBranchId(req);
  
  let query = 'SELECT SUM(amount) as total FROM bank_deposits WHERE 1=1';
  const params = [];
  if (branchId != null) {
    query += ' AND branch_id = ?';
    params.push(branchId);
  }
  if (start_date) {
    query += ' AND date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND date <= ?';
    params.push(end_date);
  }
  
  try {
    const row = await db.get(query, params);
    res.json({ total: parseFloat(row?.total || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
