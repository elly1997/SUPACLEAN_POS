const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Get all settings (authenticated staff)
router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM settings ORDER BY setting_key', []);
    const settingsObj = {};
    rows.forEach((row) => {
      settingsObj[row.setting_key] = {
        value: row.setting_value,
        description: row.description,
      };
    });
    res.json(settingsObj);
  } catch (err) {
    console.error('Settings list error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
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
    console.error('Settings get error:', err);
    res.status(500).json({ error: 'Failed to load setting' });
  }
});

// Update setting — admin only
router.put('/:key', requireRole('admin'), async (req, res) => {
  const { key } = req.params;
  const { value, description } = req.body;
  const allowedUpsertKeys = ['manager_whatsapp_number'];

  try {
    let result = await db.run(
      'UPDATE settings SET setting_value = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [value, description || null, key]
    );
    if (result.changes === 0 && allowedUpsertKeys.includes(key)) {
      await db.run(
        'INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
        [key, value, description || null]
      );
    } else if (result.changes === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ message: 'Setting updated successfully' });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

module.exports = router;
