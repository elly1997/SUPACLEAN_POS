const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/query');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');

const WEAK_DEFAULT_PASSWORDS = new Set(['admin123', 'password', '12345678', 'changeme']);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || v === 't' || v === 'true';
}

function buildUserPayload(user, branch = null) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    branchId: user.branch_id != null ? user.branch_id : null,
    branch: branch || null,
    mustChangePassword: isTruthyFlag(user.must_change_password),
  };
}

// Login endpoint
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const userByUsername = await db.get(
      'SELECT * FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))',
      [username]
    );

    if (!userByUsername) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!userByUsername.is_active || userByUsername.is_active === 0) {
      return res.status(401).json({ error: 'This account is deactivated. Contact your administrator.' });
    }

    const user = userByUsername;

    if (!user.password_hash) {
      console.error('User has no password hash:', username);
      return res.status(500).json({ error: 'User account is not properly configured. Please contact administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const mustChangePassword =
      isTruthyFlag(user.must_change_password) || WEAK_DEFAULT_PASSWORDS.has(String(password));

    // Flag weak passwords in DB so verify/session also sees it
    if (mustChangePassword && !isTruthyFlag(user.must_change_password)) {
      db.run('UPDATE users SET must_change_password = TRUE WHERE id = $1', [user.id]).catch(() => {});
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.run(
      'INSERT INTO user_sessions (user_id, session_token, branch_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, sessionToken, user.branch_id, expiresAt.toISOString()]
    );

    db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]).catch(() => {});

    user.must_change_password = mustChangePassword;

    if (user.branch_id) {
      try {
        const branch = await db.get('SELECT * FROM branches WHERE id = $1', [user.branch_id]);
        return res.json({
          success: true,
          sessionToken,
          user: buildUserPayload(user, branch || null),
        });
      } catch (branchErr) {
        console.error('Error fetching branch info:', branchErr);
        return res.status(500).json({ error: 'Error fetching branch info' });
      }
    }

    return res.json({
      success: true,
      sessionToken,
      user: buildUserPayload(user, null),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Change password (authenticated) — clears must_change_password and optionally revokes other sessions
router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (WEAK_DEFAULT_PASSWORDS.has(String(new_password).toLowerCase())) {
    return res.status(400).json({ error: 'Choose a stronger password (not a common default)' });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user?.password_hash) {
      return res.status(500).json({ error: 'User account is not properly configured' });
    }
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(String(new_password), 12);
    await db.run(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, req.user.id]
    );

    // Keep current session; drop others
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await db.run('DELETE FROM user_sessions WHERE user_id = $1 AND session_token <> $2', [
        req.user.id,
        token,
      ]);
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to update password' });
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
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Verify session endpoint
router.get('/verify', async (req, res) => {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');

  if (!sessionToken) {
    return res.status(401).json({ error: 'No session token provided' });
  }

  try {
    let session;
    try {
      session = await db.get(
        `SELECT us.*, u.username, u.full_name, u.role, u.branch_id AS user_branch_id, u.must_change_password,
                b.id AS branch_table_id, b.name AS branch_name, b.code AS branch_code, b.branch_type AS branch_branch_type
         FROM user_sessions us
         JOIN users u ON us.user_id = u.id
         LEFT JOIN branches b ON b.id = COALESCE(us.branch_id, u.branch_id)
         WHERE us.session_token = $1 AND us.expires_at > CURRENT_TIMESTAMP AND COALESCE(u.is_active::int, 0) != 0`,
        [sessionToken]
      );
    } catch (colErr) {
      session = await db.get(
        `SELECT us.*, u.username, u.full_name, u.role, u.branch_id AS user_branch_id,
                b.id AS branch_table_id, b.name AS branch_name, b.code AS branch_code, b.branch_type AS branch_branch_type
         FROM user_sessions us
         JOIN users u ON us.user_id = u.id
         LEFT JOIN branches b ON b.id = COALESCE(us.branch_id, u.branch_id)
         WHERE us.session_token = $1 AND us.expires_at > CURRENT_TIMESTAMP AND COALESCE(u.is_active::int, 0) != 0`,
        [sessionToken]
      );
    }

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const resolvedBranchId =
      session.user_branch_id != null ? session.user_branch_id : session.branch_id;

    res.json({
      valid: true,
      user: {
        id: session.user_id,
        username: session.username,
        fullName: session.full_name,
        role: session.role,
        branchId: resolvedBranchId != null ? resolvedBranchId : null,
        mustChangePassword: isTruthyFlag(session.must_change_password),
        branch:
          resolvedBranchId != null
            ? {
                id: session.branch_table_id ?? resolvedBranchId,
                name: session.branch_name,
                code: session.branch_code,
                branchType: session.branch_branch_type,
              }
            : null,
      },
    });
  } catch (err) {
    console.error('Verify session error:', err);
    res.status(500).json({ error: 'Session verification failed' });
  }
});

module.exports = router;
