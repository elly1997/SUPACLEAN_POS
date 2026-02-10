const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

// Get all branches (admin only, or user's own branch)
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admin can see all branches
      let rows = await db.all('SELECT * FROM branches ORDER BY code', []);
      // If no branches exist (e.g. fresh DB), create a default so the branch dropdown has at least one option
      if (!rows || rows.length === 0) {
        try {
          await db.run(
            'INSERT INTO branches (name, code, branch_type, address, is_active) VALUES (?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING',
            ['Main Branch', 'AR01', 'workshop', 'Arusha, Tanzania', true]
          );
          rows = await db.all('SELECT * FROM branches ORDER BY code', []);
        } catch (seedErr) {
          console.error('Error seeding default branch:', seedErr);
        }
      }
      res.json(rows || []);
    } else {
      // Regular users only see their own branch
      if (!req.user.branchId) {
        return res.status(403).json({ error: 'No branch assigned' });
      }
      const row = await db.get('SELECT * FROM branches WHERE id = $1', [req.user.branchId]);
      if (!row) {
        return res.status(404).json({ error: 'Branch not found' });
      }
      res.json([row]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get branch by ID
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Admin can access any branch, others only their own
    if (req.user.role !== 'admin' && req.user.branchId !== parseInt(id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const row = await db.get('SELECT * FROM branches WHERE id = $1', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new branch (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, code, branch_type, address, phone, manager_name } = req.body;

  if (!name || !code || !branch_type) {
    return res.status(400).json({ error: 'Name, code, and branch_type are required' });
  }

  if (!['collection', 'workshop'].includes(branch_type)) {
    return res.status(400).json({ error: 'branch_type must be "collection" or "workshop"' });
  }

  try {
    const result = await db.run(
      'INSERT INTO branches (name, code, branch_type, address, phone, manager_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, code, branch_type, address || null, phone || null, manager_name || null]
    );

    const branchId = result.lastID;

    // Get the created branch
    const branch = await db.get('SELECT * FROM branches WHERE id = $1', [branchId]);

    // Set default feature flags based on branch type
    try {
      await setDefaultFeatures(branchId, branch_type);
    } catch (featureErr) {
      console.error('Error setting default features:', featureErr);
    }

    res.json(branch);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Branch name or code already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update branch (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, code, branch_type, address, phone, manager_name, is_active } = req.body;

  try {
    const result = await db.run(
      'UPDATE branches SET name = $1, code = $2, branch_type = $3, address = $4, phone = $5, manager_name = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8',
      [name, code, branch_type, address, phone, manager_name, is_active !== undefined ? is_active : true, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    res.json({ message: 'Branch updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get branch features
router.get('/:id/features', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    if (req.user.role !== 'admin' && req.user.branchId !== parseInt(id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const rows = await db.all('SELECT * FROM branch_features WHERE branch_id = $1', [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update branch features (admin only)
router.put('/:id/features', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { features } = req.body; // Array of {feature_key, is_enabled}

  if (!Array.isArray(features)) {
    return res.status(400).json({ error: 'Features must be an array' });
  }

  try {
    // Use ON CONFLICT for upsert - PostgreSQL handles this atomically
    for (const feature of features) {
      await db.run(
        `INSERT INTO branch_features (branch_id, feature_key, is_enabled) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (branch_id, feature_key) 
         DO UPDATE SET is_enabled = $3`,
        [id, feature.feature_key, feature.is_enabled ? true : false]
      );
    }
    
    res.json({ message: 'Features updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to set default features based on branch type
async function setDefaultFeatures(branchId, branchType) {
  const defaultFeatures = branchType === 'collection' 
    ? [
        { feature_key: 'new_order', is_enabled: true },
        { feature_key: 'collection', is_enabled: true },
        { feature_key: 'customers', is_enabled: true },
        { feature_key: 'price_list_view', is_enabled: true },
        { feature_key: 'cash_management', is_enabled: true },
        { feature_key: 'reports_basic', is_enabled: true },
        { feature_key: 'order_processing', is_enabled: false },
        { feature_key: 'expenses', is_enabled: false },
        { feature_key: 'bank_deposits', is_enabled: false },
        { feature_key: 'service_management', is_enabled: false }
      ]
    : [
        { feature_key: 'new_order', is_enabled: true },
        { feature_key: 'collection', is_enabled: true },
        { feature_key: 'customers', is_enabled: true },
        { feature_key: 'price_list_view', is_enabled: true },
        { feature_key: 'cash_management', is_enabled: true },
        { feature_key: 'reports_basic', is_enabled: true },
        { feature_key: 'order_processing', is_enabled: true },
        { feature_key: 'expenses', is_enabled: true },
        { feature_key: 'bank_deposits', is_enabled: true },
        { feature_key: 'service_management', is_enabled: true }
      ];

  for (const feature of defaultFeatures) {
    await db.run(
      'INSERT INTO branch_features (branch_id, feature_key, is_enabled) VALUES ($1, $2, $3) ON CONFLICT (branch_id, feature_key) DO NOTHING',
      [branchId, feature.feature_key, feature.is_enabled]
    );
  }
}

module.exports = router;
