const express = require('express');
const router = express.Router();
const db = require('../database/query');

const MANAGER_WHATSAPP_DEFAULT = '+255752757635';

// Get all settings
router.get('/', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM settings ORDER BY setting_key', []);
    const settingsObj = {};
    rows.forEach(row => {
      settingsObj[row.setting_key] = {
        value: row.setting_value,
        description: row.description
      };
    });
    // Ensure director WhatsApp number exists (Daily Closing Report on reconcile)
    if (!settingsObj.manager_whatsapp_number) {
      settingsObj.manager_whatsapp_number = {
        value: MANAGER_WHATSAPP_DEFAULT,
        description: 'Director WhatsApp number – receives Daily Closing Report when a branch reconciles the day'
      };
    }
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

// Update setting (creates row if key is allowed and missing, e.g. manager_whatsapp_number)
router.put('/:key', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
