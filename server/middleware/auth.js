const db = require('../database/query');

// Authentication middleware
function authenticate(req, res, next) {
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');

  if (!sessionToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  console.log('Auth middleware: Checking session token');
  
  (async () => {
    try {
      const session = await db.get(
        `SELECT us.*, u.username, u.full_name, u.role, u.branch_id, u.is_active, b.* 
         FROM user_sessions us
         JOIN users u ON us.user_id = u.id
         LEFT JOIN branches b ON us.branch_id = b.id
         WHERE us.session_token = ? AND us.expires_at > CURRENT_TIMESTAMP AND COALESCE(u.is_active::int, 0) != 0`,
        [sessionToken]
      );

      if (!session) {
        console.log('Auth middleware: Invalid or expired session');
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      
      console.log('Auth middleware: Session valid for user:', session.username);

      // Attach user and branch info to request
      req.user = {
        id: session.user_id,
        username: session.username,
        fullName: session.full_name,
        role: session.role,
        branchId: session.branch_id
      };

      if (session.branch_id) {
        req.branch = {
          id: session.branch_id,
          name: session.name,
          code: session.code,
          branchType: session.branch_type
        };
      }

      // Effective branch for data isolation: admin can send X-Branch-Id or ?branch_id to view one branch; else all branches (admin) or user's branch
      if (req.user.role === 'admin') {
        const headerBranch = req.headers['x-branch-id'];
        const queryBranch = req.query.branch_id;
        const bid = headerBranch ? parseInt(headerBranch, 10) : (queryBranch ? parseInt(queryBranch, 10) : null);
        req.effectiveBranchId = (bid != null && !Number.isNaN(bid)) ? bid : null;
      } else {
        req.effectiveBranchId = req.user.branchId || null;
      }

      next();
    } catch (err) {
      console.error('Auth middleware: Database error:', err);
      return res.status(500).json({ error: err.message });
    }
  })();
}

// Role-based authorization middleware
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

// Branch access check (users can only access their branch's data unless admin)
function requireBranchAccess() {
  return (req, res, next) => {
    console.log('requireBranchAccess: Checking access for user:', req.user?.username, 'role:', req.user?.role);
    if (!req.user) {
      console.log('requireBranchAccess: No user found');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admin can access all branches
    if (req.user.role === 'admin') {
      console.log('requireBranchAccess: Admin user, allowing access');
      return next();
    }

    // Other users must have a branch assigned
    if (!req.user.branchId) {
      console.log('requireBranchAccess: User has no branch assigned');
      return res.status(403).json({ error: 'No branch assigned' });
    }

    console.log('requireBranchAccess: User has branch, allowing access');
    next();
  };
}

// Cleaning services: only admin or branches with cleaning_services feature
function requireCleaningAccess() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role === 'admin') {
      return next();
    }
    if (!req.user.branchId) {
      return res.status(403).json({ error: 'Cleaning services not enabled for your branch' });
    }
    db.get(
      'SELECT 1 FROM branch_features WHERE branch_id = ? AND feature_key = ? AND is_enabled = true',
      [req.user.branchId, 'cleaning_services']
    )
      .then((row) => {
        if (row) next();
        else res.status(403).json({ error: 'Cleaning services not enabled for your branch' });
      })
      .catch((err) => {
        console.error('requireCleaningAccess:', err);
        res.status(500).json({ error: err.message });
      });
  };
}

module.exports = {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireCleaningAccess
};
