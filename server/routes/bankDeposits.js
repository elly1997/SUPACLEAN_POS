const express = require('express');
const router = express.Router();
const db = require('../database/query');

// Get all bank deposits
router.get('/', async (req, res) => {
  const { start_date, end_date } = req.query;
  
  let query = 'SELECT * FROM bank_deposits WHERE 1=1';
  const params = [];
  
  if (start_date) {
    query += ' AND date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND date <= ?';
    params.push(end_date);
  }
  
  query += ' ORDER BY date DESC, created_at DESC';
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get deposit by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const row = await db.get('SELECT * FROM bank_deposits WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new bank deposit
router.post('/', async (req, res) => {
  const {
    date,
    amount,
    reference_number,
    bank_name,
    notes,
    created_by
  } = req.body;
  
  if (!date || !amount) {
    return res.status(400).json({ error: 'Date and amount are required' });
  }
  
  try {
    const result = await db.run(
      `INSERT INTO bank_deposits (date, amount, reference_number, bank_name, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [date, amount, reference_number || null, bank_name || null, notes || null, created_by || null]
    );
    
    const deposit = await db.get('SELECT * FROM bank_deposits WHERE id = ?', [result.lastID]);
    res.status(201).json(deposit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update bank deposit
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    date,
    amount,
    reference_number,
    bank_name,
    notes
  } = req.body;
  
  try {
    const result = await db.run(
      `UPDATE bank_deposits 
       SET date = ?, amount = ?, reference_number = ?, bank_name = ?, notes = ?
       WHERE id = ?`,
      [date, amount, reference_number || null, bank_name || null, notes || null, id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    
    const deposit = await db.get('SELECT * FROM bank_deposits WHERE id = ?', [id]);
    res.json(deposit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete bank deposit
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await db.run('DELETE FROM bank_deposits WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    res.json({ message: 'Deposit deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get total deposits by date range
router.get('/summary/total', async (req, res) => {
  const { start_date, end_date } = req.query;
  
  let query = 'SELECT SUM(amount) as total FROM bank_deposits WHERE 1=1';
  const params = [];
  
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
