/**
 * Expense deletion flow shared by the Expenses page and Cash Management.
 *
 * - Admins void immediately (with the existing "reconciled day" confirmation).
 * - Everyone else sends a request with a reason; an admin approves or declines it in the inbox.
 *
 * @param {object} expense - row with id, amount
 * @param {{ isAdmin: boolean, deleteExpense: Function }} deps
 * @returns {Promise<{status: 'cancelled'|'voided'|'requested', reconciledRefreshed?: string[], message?: string}>}
 */
export async function voidOrRequestExpenseDeletion(expense, { isAdmin, deleteExpense }) {
  const amountLabel = parseFloat(expense?.amount || 0).toLocaleString();

  if (isAdmin) {
    if (!window.confirm(`Void this expense of TSh ${amountLabel}?`)) return { status: 'cancelled' };
    try {
      const res = await deleteExpense(expense.id);
      return { status: 'voided', reconciledRefreshed: res?.data?.reconciled_days_refreshed || [] };
    } catch (error) {
      const code = error.response?.data?.code;
      if (error.response?.status === 409 && code === 'reconciled_day') {
        if (
          !window.confirm(
            'This day is reconciled. Voiding will recalculate the locked daily summary and refresh later pending days. Continue?'
          )
        ) {
          return { status: 'cancelled' };
        }
        const res2 = await deleteExpense(expense.id, {
          void_reason: 'Voided by admin',
          acknowledge_reconciled_day: true
        });
        return { status: 'voided', reconciledRefreshed: res2?.data?.reconciled_days_refreshed || [] };
      }
      throw error;
    }
  }

  const reason = window.prompt(
    `Why should the TSh ${amountLabel} expense be deleted? An admin must approve this request.`,
    ''
  );
  if (reason == null) return { status: 'cancelled' };
  if (!reason.trim()) {
    throw new Error('A reason is required to request a deletion');
  }
  const res = await deleteExpense(expense.id, { void_reason: reason.trim() });
  return { status: 'requested', message: res?.data?.message };
}
