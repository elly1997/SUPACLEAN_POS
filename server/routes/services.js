const express = require('express');
const router = express.Router();
const db = require('../database/query');

// Get all services
router.get('/', async (req, res) => {
  try {
    const { include_inactive } = req.query;
    let query = 'SELECT * FROM services';
    let params = [];
    
    if (include_inactive !== 'true') {
      query += ' WHERE is_active = $1';
      params.push(true);
    }
    query += ' ORDER BY name';
    
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get service by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db.get('SELECT * FROM services WHERE id = $1', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new service
router.post('/', async (req, res) => {
  const { name, description, base_price, price_per_item, price_per_kg } = req.body;

  if (!name || base_price === undefined) {
    return res.status(400).json({ error: 'Name and base_price are required' });
  }

  try {
    const result = await db.run(
      'INSERT INTO services (name, description, base_price, price_per_item, price_per_kg) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, description || null, base_price, price_per_item || 0, price_per_kg || 0]
    );
    res.json({ id: result.lastID, name, description, base_price, price_per_item, price_per_kg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update service
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, base_price, price_per_item, price_per_kg, is_active } = req.body;

  try {
    const result = await db.run(
      'UPDATE services SET name = $1, description = $2, base_price = $3, price_per_item = $4, price_per_kg = $5, is_active = $6 WHERE id = $7',
      [name, description, base_price, price_per_item || 0, price_per_kg || 0, is_active !== undefined ? is_active : true, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json({ message: 'Service updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
