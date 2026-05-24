/** SQL fragments to exclude soft-voided orders and transactions from active totals/lists. */

function sqlActiveOrdersOnly(alias = 'o') {
  return `AND COALESCE(${alias}.is_voided, FALSE) = FALSE`;
}

function sqlActiveTransactionsOnly(alias = 't') {
  return `AND COALESCE(${alias}.is_voided, FALSE) = FALSE`;
}

module.exports = {
  sqlActiveOrdersOnly,
  sqlActiveTransactionsOnly
};
