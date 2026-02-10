const express = require('express');
const router = express.Router();
const db = require('../database/query');

// Get all settings
router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM settings ORDER BY setting_key', []);
    // Convert to object format for easier access
    const settingsObj = {};
    rows.forEach(row => {
      settingsObj[row.setting_key] = {
        value: row.setting_value,
        description: row.description
      };
    });
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single setting
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const row = await db.get('SELECT * FROM settings WHERE setting_key = ?', [key]);
    if (!row) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update setting
router.put('/:key', async (req, res) => {
  const { key } = req.params;
  const { value, description } = req.body;

  try {
    const result = await db.run(
      'UPDATE settings SET setting_value = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [value, description || null, key]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ message: 'Setting updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
