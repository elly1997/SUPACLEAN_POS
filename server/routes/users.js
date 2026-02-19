const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

// Get all users (admin only)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.is_active, 
              u.created_at, u.last_login, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       ORDER BY u.created_at DESC`,
      []
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get user by ID (admin only)
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  try {
    const row = await db.get(
      `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.is_active, 
              u.created_at, u.last_login, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = $1`,
      [id]
    );

    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(row);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create new user (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { username, password, full_name, role, branch_id, is_active } = req.body;

  // Validation
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ 
      error: 'Username, password, full_name, and role are required' 
    });
  }

  // Validate role
  const validRoles = ['admin', 'manager', 'cashier', 'processor'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ 
      error: `Role must be one of: ${validRoles.join(', ')}` 
    });
  }

  // If branch_id is provided, verify it exists
  if (branch_id) {
    try {
      const branch = await db.get('SELECT id FROM branches WHERE id = $1', [branch_id]);
      if (!branch) {
        return res.status(400).json({ error: 'Branch not found' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Error validating branch' });
    }
  }

  // Admin users should not have a branch_id
  if (role === 'admin' && branch_id) {
    return res.status(400).json({ 
      error: 'Admin users cannot be assigned to a branch' 
    });
  }

  // Non-admin users must have a branch_id
  if (role !== 'admin' && !branch_id) {
    return res.status(400).json({ 
      error: 'Non-admin users must be assigned to a branch' 
    });
  }

  try {
    // Check if username already exists
    const existingUser = await db.get('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await db.run(
      'INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [username, passwordHash, full_name, role, role === 'admin' ? null : branch_id, is_active !== undefined ? is_active : true]
    );

    // Get the created user with branch info
    const user = await db.get(
      `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.is_active, 
              u.created_at, u.last_login, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = $1`,
      [result.lastID]
    );

    res.status(201).json(user);
  } catch (err) {
    console.error('Error creating user:', err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update user (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { username, password, full_name, role, branch_id, is_active } = req.body;

  try {
    // Get existing user
    const existingUser = await db.get('SELECT * FROM users WHERE id = $1', [id]);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If username is being changed, check for conflicts
    if (username && username !== existingUser.username) {
      const usernameExists = await db.get('SELECT id FROM users WHERE username = $1 AND id != $2', [username, id]);
      if (usernameExists) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    // Validate role if being changed
    if (role) {
      const validRoles = ['admin', 'manager', 'cashier', 'processor'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ 
          error: `Role must be one of: ${validRoles.join(', ')}` 
        });
      }

      // Admin users should not have a branch_id
      if (role === 'admin' && branch_id) {
        return res.status(400).json({ 
          error: 'Admin users cannot be assigned to a branch' 
        });
      }

      // Non-admin users must have a branch_id
      if (role !== 'admin' && !branch_id && !existingUser.branch_id) {
        return res.status(400).json({ 
          error: 'Non-admin users must be assigned to a branch' 
        });
      }
    }

    // Validate branch_id if provided
    if (branch_id) {
      const branch = await db.get('SELECT id FROM branches WHERE id = $1', [branch_id]);
      if (!branch) {
        return res.status(400).json({ error: 'Branch not found' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (username !== undefined) {
      updates.push(`username = $${paramIndex++}`);
      params.push(username);
    }

    if (full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(full_name);
    }

    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(role);
      
      // Update branch_id based on role
      if (role === 'admin') {
        updates.push(`branch_id = NULL`);
      } else if (branch_id !== undefined) {
        updates.push(`branch_id = $${paramIndex++}`);
        params.push(branch_id);
      }
    } else if (branch_id !== undefined) {
      // If role is not being changed, only update branch_id if user is not admin
      if (existingUser.role !== 'admin') {
        updates.push(`branch_id = $${paramIndex++}`);
        params.push(branch_id);
      }
    }

    // Only hash and update password if a non-empty new password was provided
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      updates.push(`password_hash = $${paramIndex++}`);
      params.push(passwordHash);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;

    const result = await db.run(query, params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get updated user
    const user = await db.get(
      `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.is_active, 
              u.created_at, u.last_login, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       WHERE u.id = $1`,
      [id]
    );

    res.json(user);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete/Deactivate user (admin only)
// Query ?permanent=true: permanently remove user (only if already inactive). Otherwise: soft delete (deactivate).
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const permanent = req.query.permanent === 'true' || req.query.permanent === '1';

  try {
    const user = await db.get('SELECT id, username, role, is_active FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    if (sessionToken) {
      const session = await db.get('SELECT user_id FROM user_sessions WHERE session_token = $1', [sessionToken]);
      if (session && session.user_id === parseInt(id)) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
      }
    }

    if (permanent) {
      // Permanent delete: only allowed for inactive users
      if (user.is_active !== false && user.is_active !== 0) {
        return res.status(400).json({
          error: 'Only inactive users can be permanently deleted. Deactivate the user first, then delete.'
        });
      }
      await db.run('DELETE FROM user_sessions WHERE user_id = $1', [id]);
      const result = await db.run('DELETE FROM users WHERE id = $1', [id]);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json({ message: 'User permanently deleted' });
    }

    // Soft delete: deactivate
    const result = await db.run('UPDATE users SET is_active = FALSE WHERE id = $1', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deactivated successfully' });
  } catch (err) {
    console.error('Error in user delete:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
