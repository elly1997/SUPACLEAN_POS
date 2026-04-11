/**
 * Operating vs transfer expenses
 *
 * "Bank Deposit" expenses exist as an audit mirror: each creates/updates a row in
 * `bank_deposits`. Cash leaving the drawer for the bank must be counted only once
 * (via `bank_deposits`), not again in expenses_from_cash — otherwise cash in hand
 * and P&L are wrong.
 *
 * Exclude: voided rows, the built-in Bank Deposit category, and any expense row
 * linked to bank_deposits (belt-and-suspenders for legacy data).
 */
const BANK_DEPOSIT_TRANSFER_CATEGORY = 'Bank Deposit';

/** Append to WHERE on alias `e` (expenses). */
function sqlOperatingExpensesOnly() {
  return `AND COALESCE(e.is_voided, FALSE) = FALSE
    AND e.bank_deposit_id IS NULL
    AND TRIM(COALESCE(e.category, '')) <> '${BANK_DEPOSIT_TRANSFER_CATEGORY}'`;
}

module.exports = {
  BANK_DEPOSIT_TRANSFER_CATEGORY,
  sqlOperatingExpensesOnly
};
