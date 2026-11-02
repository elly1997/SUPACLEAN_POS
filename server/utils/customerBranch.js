/**
 * A customer belongs to the branch where they were saved (primary_branch_id).
 * Older rows never stored that field; those stay visible at each branch that
 * already has their orders, until a branch adds its own separate record.
 */

function branchCustomerMatchSql(alias = 'c') {
  return `(
    ${alias}.primary_branch_id = ?
    OR (
      ${alias}.primary_branch_id IS NULL
      AND EXISTS (
        SELECT 1 FROM orders ob
        WHERE ob.customer_id = ${alias}.id
          AND ob.branch_id = ?
          AND COALESCE(ob.is_voided, FALSE) = FALSE
      )
    )
  )`;
}

async function customerBelongsToBranch(db, customer, branchId) {
  if (!customer || branchId == null) return false;
  if (customer.primary_branch_id != null && Number(customer.primary_branch_id) === Number(branchId)) {
    return true;
  }
  if (customer.primary_branch_id != null) return false;
  const row = await db.get(
    `SELECT 1 AS ok FROM orders
     WHERE customer_id = ? AND branch_id = ?
       AND COALESCE(is_voided, FALSE) = FALSE
     LIMIT 1`,
    [customer.id, branchId]
  );
  return !!row;
}

module.exports = {
  branchCustomerMatchSql,
  customerBelongsToBranch,
};
