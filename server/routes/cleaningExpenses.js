const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requireCleaningAccess } = require('../middleware/auth');

router.use(authenticate, requireBranchAccess(), requireCleaningAccess());

const { getBranchFilter } = require('../utils/branchFilter');

const CATEGORIES = ['rugs', 'soap', 'equipment', 'tools', 'other'];

// List cleaning expenses
router.get('/', async (req, res) => {
  const { date_from, date_to } = req.query;
  const branchFilter = getBranchFilter(req, 'ce');
  let query = `
    SELECT ce.*
    FROM cleaning_expenses ce
    WHERE 1=1 ${branchFilter.clause}
  `;
  const params = [...branchFilter.params];
  if (date_from) {
    query += ' AND ce.date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    query += ' AND ce.date <= ?';
    params.push(date_to);
  }
  query += ' ORDER BY ce.date DESC, ce.id DESC';
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching cleaning expenses:', err);
    res.status(500).json({ error: err.message });
  }
});

// Categories for dropdown
router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

// Create expense
router.post('/', async (req, res) => {
  const { date, category, description, amount } = req.body;
  if (!date || !category || amount == null || amount === '') {
    return res.status(400).json({ error: 'Date, category, and amount are required' });
  }
  const amt = Math.round(parseFloat(amount) * 100) / 100;
  if (Number.isNaN(amt) || amt < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const cat = String(category).toLowerCase().trim();
  if (!CATEGORIES.includes(cat)) {
    return res.status(400).json({ error: 'Invalid category. Use: ' + CATEGORIES.join(', ') });
  }
  const branchId = req.user?.branchId ?? req.effectiveBranchId ?? null;
  try {
    const r = await db.run(
      `INSERT INTO cleaning_expenses (date, category, description, amount, branch_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [date, cat, (description || '').trim() || null, amt, branchId, req.user?.username || null]
    );
    const row = await db.get('SELECT * FROM cleaning_expenses WHERE id = ?', [r.lastID]);
    res.status(201).json(row);
  } catch (err) {
    console.error('Error creating cleaning expense:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
