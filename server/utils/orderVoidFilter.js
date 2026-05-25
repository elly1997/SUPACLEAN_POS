/** SQL fragments to exclude soft-voided/archived rows from operational views. */

function sqlActiveOrdersOnly(alias = 'o') {
  return `AND COALESCE(${alias}.is_voided, FALSE) = FALSE`;
}

function sqlActiveTransactionsOnly(alias = 't') {
  return `AND COALESCE(${alias}.is_voided, FALSE) = FALSE`;
}

function sqlUnarchivedOrdersOnly(alias = 'o') {
  return `AND ${alias}.archived_at IS NULL`;
}

module.exports = {
  sqlActiveOrdersOnly,
  sqlActiveTransactionsOnly,
  sqlUnarchivedOrdersOnly
};
