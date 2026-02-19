const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

// List all bank accounts (admin only; used for dropdown when recording deposits)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT id, name, account_number, is_active, created_at FROM bank_accounts ORDER BY name',
      []
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List active bank accounts only (for deposit dropdown – any authenticated user with cash permission)
router.get('/active', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT id, name, account_number FROM bank_accounts WHERE is_active = true ORDER BY name',
      []
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create bank account (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, account_number } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bank account name is required' });
  }
  try {
    const result = await db.run(
      'INSERT INTO bank_accounts (name, account_number, is_active) VALUES (?, ?, 1) RETURNING id',
      [name.trim(), (account_number && account_number.trim()) || null]
    );
    const newId = result.lastID ?? result.row?.id;
    const row = newId ? await db.get('SELECT * FROM bank_accounts WHERE id = ?', [newId]) : null;
    res.status(201).json(row || { id: newId, name: name.trim(), account_number: (account_number && account_number.trim()) || null, is_active: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update bank account (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, account_number, is_active } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bank account name is required' });
  }
  try {
    const result = await db.run(
      'UPDATE bank_accounts SET name = ?, account_number = ?, is_active = ? WHERE id = ?',
      [name.trim(), (account_number && account_number.trim()) || null, is_active !== false ? 1 : 0, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bank account not found' });
    }
    const row = await db.get('SELECT * FROM bank_accounts WHERE id = ?', [id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete bank account (admin only; only if no deposits reference it)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const refs = await db.get('SELECT COUNT(*) as c FROM bank_deposits WHERE bank_account_id = ?', [id]);
    if (refs && refs.c > 0) {
      return res.status(400).json({
        error: 'Cannot delete: this bank account is used by existing deposits. Deactivate it instead.'
      });
    }
    const result = await db.run('DELETE FROM bank_accounts WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bank account not found' });
    }
    res.json({ message: 'Bank account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
