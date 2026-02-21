const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/query');
const crypto = require('crypto');

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Login endpoint
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  console.log('🔐 Login attempt:', { username, hasPassword: !!password });

  if (!username || !password) {
    console.log('❌ Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find user by username (case-insensitive); check active separately for clearer error
    const userByUsername = await db.get(
      'SELECT * FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))',
      [username]
    );

    if (!userByUsername) {
      console.log('❌ User not found:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!userByUsername.is_active || userByUsername.is_active === 0) {
      console.log('❌ User deactivated:', username);
      return res.status(401).json({ error: 'This account is deactivated. Contact your administrator.' });
    }

    const user = userByUsername;

    console.log('✅ User found:', { id: user.id, username: user.username, hasPasswordHash: !!user.password_hash });

    // Verify password
    if (!user.password_hash) {
      console.error('❌ User has no password hash!');
      return res.status(500).json({ error: 'User account is not properly configured. Please contact administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      console.log('❌ Password mismatch for user:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log('✅ Password verified successfully for user:', username);

    // Generate session token
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Create session
    const sessionResult = await db.run(
      'INSERT INTO user_sessions (user_id, session_token, branch_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, sessionToken, user.branch_id, expiresAt.toISOString()]
    );

    console.log('✅ Session created successfully for user:', username);

    // Update last login (fire and forget)
    db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]).catch(err => {
      console.error('Error updating last_login:', err);
    });

    // Get branch info if user has a branch
    if (user.branch_id) {
      try {
        const branch = await db.get('SELECT * FROM branches WHERE id = $1', [user.branch_id]);
        res.json({
          success: true,
          sessionToken,
          user: {
            id: user.id,
            username: user.username,
            fullName: user.full_name,
            role: user.role,
            branchId: user.branch_id,
            branch: branch || null
          }
        });
      } catch (branchErr) {
        console.error('Error fetching branch info:', branchErr);
        return res.status(500).json({ error: 'Error fetching branch info' });
      }
    } else {
      // Admin user (no branch)
      res.json({
        success: true,
        sessionToken,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          branchId: null,
          branch: null
        }
      });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');

  if (!sessionToken) {
    return res.status(400).json({ error: 'Session token required' });
  }

  try {
    await db.run('DELETE FROM user_sessions WHERE session_token = $1', [sessionToken]);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify session endpoint
router.get('/verify', async (req, res) => {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');

  if (!sessionToken) {
    return res.status(401).json({ error: 'No session token provided' });
  }

  try {
    const session = await db.get(
      `SELECT us.*, u.username, u.full_name, u.role, u.branch_id, b.id as branch_table_id, b.name, b.code, b.branch_type
       FROM user_sessions us
       JOIN users u ON us.user_id = u.id
       LEFT JOIN branches b ON us.branch_id = b.id
       WHERE us.session_token = $1 AND us.expires_at > CURRENT_TIMESTAMP AND COALESCE(u.is_active::int, 0) != 0`,
      [sessionToken]
    );

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    res.json({
      valid: true,
      user: {
        id: session.user_id,
        username: session.username,
        fullName: session.full_name,
        role: session.role,
        branchId: session.branch_id,
        branch: session.branch_id ? {
          id: session.branch_table_id ?? session.branch_id,
          name: session.name,
          code: session.code,
          branchType: session.branch_type
        } : null
      }
    });
  } catch (err) {
    console.error('Verify session error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
