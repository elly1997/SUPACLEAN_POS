const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requireCleaningAccess } = require('../middleware/auth');

// All routes: require cleaning access (admin or branch with cleaning_services)
router.use(authenticate, requireBranchAccess(), requireCleaningAccess());

const { getBranchFilter } = require('../utils/branchFilter');

// List cleaning customers (independent from laundry customers)
router.get('/', async (req, res) => {
  const branchFilter = getBranchFilter(req, 'cc');
  const query = `
    SELECT cc.*
    FROM cleaning_customers cc
    WHERE 1=1 ${branchFilter.clause}
    ORDER BY cc.name
  `;
  try {
    const rows = await db.all(query, branchFilter.params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching cleaning customers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get one
router.get('/:id', async (req, res) => {
  const branchFilter = getBranchFilter(req, 'cc');
  try {
    const row = await db.get(
      'SELECT * FROM cleaning_customers WHERE id = ? ' + branchFilter.clause,
      [req.params.id, ...branchFilter.params]
    );
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    res.json(row);
  } catch (err) {
    console.error('Error fetching cleaning customer:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create (record new customer for cleaning services)
router.post('/', async (req, res) => {
  const { name, phone, email, address, tin } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  const branchId = req.user?.branchId ?? req.effectiveBranchId ?? null;
  try {
    const r = await db.run(
      `INSERT INTO cleaning_customers (name, phone, email, address, tin, branch_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [name.trim(), phone.trim(), (email || '').trim() || null, (address || '').trim() || null, (tin || '').trim() || null, branchId]
    );
    const created = await db.get('SELECT * FROM cleaning_customers WHERE id = ?', [r.lastID]);
    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating cleaning customer:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
