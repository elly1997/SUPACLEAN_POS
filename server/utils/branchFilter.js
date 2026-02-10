/**
 * Branch Filtering Utilities
 * Provides helper functions for filtering data by branch_id
 */

/**
 * Get branch filter SQL clause and parameters
 * @param {Object} req - Express request object (must have req.user from authenticate middleware)
 * @param {string} tableAlias - Table alias for branch_id column (e.g., 'o' for orders)
 * @returns {Object} { clause: string, params: array }
 */
function getBranchFilter(req, tableAlias = '') {
  const alias = tableAlias ? `${tableAlias}.` : '';
  // Use effective branch when set (admin with branch selected, or non-admin's branch)
  const branchId = req.effectiveBranchId != null ? req.effectiveBranchId : (req.user?.branchId ?? null);
  if (branchId != null) {
    return { clause: `AND ${alias}branch_id = ?`, params: [branchId] };
  }
  // Admin with no branch selected: see all branches (no filter)
  if (req.user && req.user.role === 'admin') {
    return { clause: '', params: [] };
  }
  // User with no branch: match nothing (safety)
  return { clause: `AND ${alias}branch_id IS NULL`, params: [] };
}

/**
 * Get branch filter for WHERE clause (without AND prefix)
 * @param {Object} req - Express request object
 * @param {string} tableAlias - Table alias
 * @returns {Object} { clause: string, params: array }
 */
function getBranchWhereClause(req, tableAlias = '') {
  const filter = getBranchFilter(req, tableAlias);
  // Remove 'AND' prefix if it exists
  const clause = filter.clause.replace(/^AND\s+/, '');
  return { clause: clause || '1=1', params: filter.params };
}

/**
 * Get branch filter for JOIN conditions
 * @param {Object} req - Express request object
 * @param {string} tableAlias - Table alias
 * @returns {Object} { clause: string, params: array }
 */
function getBranchJoinFilter(req, tableAlias = '') {
  return getBranchFilter(req, tableAlias);
}

function getEffectiveBranchId(req) {
  return req.effectiveBranchId != null ? req.effectiveBranchId : (req.user?.branchId ?? null);
}

module.exports = {
  getBranchFilter,
  getBranchWhereClause,
  getBranchJoinFilter,
  getEffectiveBranchId
};
