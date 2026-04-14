const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');
const cashManagement = require('./cashManagement');
const { sqlOperatingExpensesOnly } = require('../utils/operatingExpenses');
const { assertNotFutureBusinessDate } = require('../utils/businessDate');

/** Normalize expense date to YYYY-MM-DD for consistent daily closing buckets */
function normalizeExpenseDate(d) {
  if (d == null || d === '') return null;
  const s = String(d).trim();
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

/** When true, allow create/update/void that touches a reconciled day and force-refresh that locked summary. */
function wantsReconciledDayAcknowledgement(req) {
  const v = req.body?.acknowledge_reconciled_day;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * Recompute daily closing for affected dates: force-refresh any reconciled days in the set,
 * then refresh the cash chain from the earliest date for all later unreconciled days.
 */
async function refreshDailyClosingForExpenseDates(branchId, ...dates) {
  if (branchId == null) {
    return { reconciledDaysForced: [], anchor: null, expenseDayRefresh: { skipped: true, reason: 'invalid' } };
  }
  const normalized = [...new Set(dates.map(normalizeExpenseDate).filter(Boolean))].sort();
  if (!normalized.length) {
    return { reconciledDaysForced: [], anchor: null, expenseDayRefresh: { skipped: true, reason: 'invalid' } };
  }
  const anchor = normalized[0];
  const reconciledDaysForced = [];
  let expenseDayRefresh = { skipped: false };
  try {
    for (const d of normalized) {
      if (await isReconciledDay(d, branchId)) {
        await cashManagement.refreshDailySummaryForce(d, branchId);
        reconciledDaysForced.push(d);
      }
    }
    const out = await cashManagement.refreshUnreconciledSummariesFromDate(branchId, anchor);
    expenseDayRefresh = out.expenseDayRefresh || expenseDayRefresh;
  } catch (err) {
    console.error('refreshDailyClosingForExpenseDates failed:', anchor, err.message);
  }
  return { reconciledDaysForced, anchor, expenseDayRefresh };
}

async function isReconciledDay(date, branchId) {
  const row = await db.get(
    'SELECT is_reconciled FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [date, branchId]
  );
  return !!(row && row.is_reconciled);
}

async function writeExpenseAudit(action, expenseId, oldData, newData, reason, req) {
  try {
    await db.run(
      `INSERT INTO expense_audit_log (expense_id, action, old_data, new_data, reason, changed_by)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        expenseId || null,
        action,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        reason || null,
        req.user?.fullName || req.user?.username || 'User'
      ]
    );
  } catch (err) {
    console.error('Failed to write expense audit log:', err.message);
  }
}

function isSalaryAdvanceCategory(category) {
  return String(category || '').trim().toLowerCase() === 'salary advance';
}

async function upsertLinkedSalaryAdvance({ expenseId, employeeId, date, amount, notes, req }) {
  if (!expenseId) return;
  const existing = await db.get('SELECT id FROM salary_advances WHERE source_expense_id = $1', [expenseId]);
  if (!employeeId) {
    throw new Error('employee_id is required for Salary Advance expense category');
  }
  const employee = await db.get(
    'SELECT id FROM employees WHERE id = $1 AND is_active = TRUE',
    [Number(employeeId)]
  );
  if (!employee) {
    throw new Error('Selected employee is not active');
  }
  if (existing) {
    await db.run(
      `UPDATE salary_advances
       SET employee_id = $1, advance_date = $2, amount = $3, notes = $4, branch_id = NULL
       WHERE source_expense_id = $5`,
      [Number(employeeId), date, amount, notes || null, expenseId]
    );
    return;
  }
  await db.run(
    `INSERT INTO salary_advances (employee_id, advance_date, amount, notes, branch_id, created_by, source_expense_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      Number(employeeId),
      date,
      amount,
      notes || null,
      null,
      req.user?.fullName || req.user?.username || 'User',
      expenseId
    ]
  );
}

async function removeLinkedSalaryAdvance(expenseId) {
  if (!expenseId) return;
  await db.run('DELETE FROM salary_advances WHERE source_expense_id = $1', [expenseId]);
}

/** Built-in categories (Salary Advance has special handling). Bank deposits are recorded under Cash Management → Bank deposits, not here. */
const BUILTIN_EXPENSE_CATEGORIES = [
  'Lunch',
  'Breakfast',
  'Car Fuel',
  'Rent',
  'Salaries',
  'Salary Advance',
  'Maintenance & Repairs',
  'Water Bill',
  'Electricity',
  'Office Supplies',
  'Transport',
  'Other'
];

/** Cannot be added as a custom category (reserved / use other flows). */
const RESERVED_EXPENSE_CATEGORY_NAMES = new Set(['bank deposit']);

function normalizeCustomCategoryName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

router.use(authenticate, requireBranchFeature('expenses'));

// Custom + built-in category list for the expense form (register before /:id)
router.get('/categories', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? null;
  if (!branchId) {
    return res.status(400).json({
      error:
        req.user?.role === 'admin'
          ? 'Select a branch in the header to load categories.'
          : 'Your account has no branch assigned; contact an administrator.'
    });
  }
  try {
    const rows = await db.all(
      'SELECT id, name FROM expense_categories WHERE branch_id = $1 ORDER BY lower(name)',
      [branchId]
    );
    res.json({ built_in: BUILTIN_EXPENSE_CATEGORIES, custom: rows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const name = normalizeCustomCategoryName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? null;
  if (!branchId) {
    return res.status(400).json({
      error:
        req.user?.role === 'admin'
          ? 'Select a branch in the header to add a category.'
          : 'Your account has no branch assigned; contact an administrator.'
    });
  }
  if (BUILTIN_EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'This name matches a built-in category. Use the list as-is.' });
  }
  if (RESERVED_EXPENSE_CATEGORY_NAMES.has(name.toLowerCase())) {
    return res.status(400).json({
      error: 'This name is reserved. Record bank deposits under Cash Management → Bank deposits.'
    });
  }
  try {
    const result = await db.run(
      'INSERT INTO expense_categories (name, branch_id) VALUES ($1, $2) RETURNING id, name',
      [name, branchId]
    );
    res.status(201).json({ id: result.lastID, name: result.row?.name || name });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists for this branch.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get expense summary by category (register before /:id so "summary" is not captured as id)
router.get('/summary/by-category', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchFilter = getBranchFilter(req, 'e');

  let query = `
    SELECT 
      e.category,
      e.payment_source,
      SUM(e.amount) as total_amount,
      COUNT(*) as count
    FROM expenses e
    WHERE 1=1
      ${sqlOperatingExpensesOnly()}
  `;
  const params = [];
  let paramIndex = 1;

  if (branchFilter.clause) {
    query += ` ${branchFilter.clause}`;
    params.push(...branchFilter.params);
    paramIndex += branchFilter.params.length;
  }

  if (start_date) {
    query += ` AND e.date >= $${paramIndex++}`;
    params.push(start_date);
  }

  if (end_date) {
    query += ` AND e.date <= $${paramIndex++}`;
    params.push(end_date);
  }

  query += ' GROUP BY e.category, e.payment_source ORDER BY total_amount DESC';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all expenses (managers and admins can view), with bank account name for Bank Deposit category
router.get('/', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { start_date, end_date, category } = req.query;
  const branchFilter = getBranchFilter(req, 'e');
  
  let query = `SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name,
      sa.employee_id as salary_advance_employee_id, emp.full_name as salary_advance_employee_name
    FROM expenses e
    LEFT JOIN bank_accounts b ON e.bank_account_id = b.id
    LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id
    LEFT JOIN salary_advances sa ON sa.source_expense_id = e.id
    LEFT JOIN employees emp ON emp.id = sa.employee_id
    WHERE 1=1 AND COALESCE(e.is_voided, FALSE) = FALSE`;
  const params = [];
  let paramIndex = 1;
  
  // Add branch filter
  if (branchFilter.clause) {
    query += ` ${branchFilter.clause}`;
    params.push(...branchFilter.params);
    paramIndex += branchFilter.params.length;
  }
  
  if (start_date) {
    query += ` AND e.date >= $${paramIndex++}`;
    params.push(start_date);
  }
  
  if (end_date) {
    query += ` AND e.date <= $${paramIndex++}`;
    params.push(end_date);
  }
  
  if (category) {
    query += ` AND e.category = $${paramIndex++}`;
    params.push(category);
  }
  
  query += ' ORDER BY e.date DESC, e.created_at DESC';
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get expense by ID (managers and admins can view); branch users only their branch
router.get('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  const branchFilter = getBranchFilter(req, 'e');
  const params = [id];
  const whereClause = branchFilter.clause ? ` AND ${branchFilter.clause.replace(/^AND\s+/, '').replace(/e\./g, 'e.')}` : '';
  
  try {
    const row = await db.get(
      `SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name,
          sa.employee_id as salary_advance_employee_id, emp.full_name as salary_advance_employee_name
       FROM expenses e
       LEFT JOIN bank_accounts b ON e.bank_account_id = b.id
       LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id
       LEFT JOIN salary_advances sa ON sa.source_expense_id = e.id
       LEFT JOIN employees emp ON emp.id = sa.employee_id
       WHERE e.id = ? AND COALESCE(e.is_voided, FALSE) = FALSE ${whereClause}`,
      branchFilter.params.length ? [...params, ...branchFilter.params] : params
    );
    if (!row) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new expense (managers and admins only). Bank deposits use Cash Management → bank_deposits only.
router.post('/', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number,
    created_by,
    bank_account_id,
    deposit_reference_number,
    bank_name: deposit_bank_name,
    employee_id
  } = req.body;
  
  if (!date || !category || !amount || !payment_source) {
    return res.status(400).json({ error: 'Date, category, amount, and payment_source are required' });
  }

  const expenseDate = normalizeExpenseDate(date);

  if (!assertNotFutureBusinessDate(expenseDate, res, 'date')) {
    return;
  }
  
  const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? req.branch?.id ?? null;
  if (!branchId) {
    return res.status(400).json({
      error: req.user?.role === 'admin'
        ? 'Select a branch in the header to record expenses, or ensure branch is set.'
        : 'Your account is not assigned to a branch. Contact the administrator to assign your account to a branch before recording expenses.'
    });
  }

  if (category === 'Bank Deposit') {
    return res.status(400).json({
      error: 'Bank deposits are not recorded as expenses. Use Cash Management → Bank deposits.'
    });
  }

  if (isSalaryAdvanceCategory(category) && !employee_id) {
    return res.status(400).json({ error: 'employee_id is required when category is Salary Advance' });
  }
  
  try {
    const bankDepositId = null;

    if (await isReconciledDay(expenseDate, branchId) && !wantsReconciledDayAcknowledgement(req)) {
      return res.status(409).json({
        error:
          'This date is already reconciled. Tick “Adjust reconciled day” on the expense form to book on this date and refresh the locked daily summary, or choose another date.',
        code: 'reconciled_day'
      });
    }

    const result = await db.run(
      `INSERT INTO expenses (date, category, amount, payment_source, description, receipt_number, created_by, branch_id, bank_account_id, deposit_reference_number, bank_deposit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        expenseDate,
        category,
        amount,
        payment_source,
        description || null,
        receipt_number || null,
        created_by || req.user?.fullName || req.user?.username || null,
        branchId,
        (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null,
        deposit_reference_number || null,
        bankDepositId
      ]
    );
    if (isSalaryAdvanceCategory(category)) {
      await upsertLinkedSalaryAdvance({
        expenseId: result.lastID,
        employeeId: employee_id,
        date: expenseDate,
        amount,
        notes: description,
        req
      });
    }
    
    const expense = await db.get(
      `SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name,
          sa.employee_id as salary_advance_employee_id, emp.full_name as salary_advance_employee_name
       FROM expenses e
       LEFT JOIN bank_accounts b ON e.bank_account_id = b.id
       LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id
       LEFT JOIN salary_advances sa ON sa.source_expense_id = e.id
       LEFT JOIN employees emp ON emp.id = sa.employee_id
       WHERE e.id = $1`,
      [result.lastID]
    );

    await writeExpenseAudit('create', result.lastID, null, expense, req.body?.update_reason || null, req);
    const closingRefresh = await refreshDailyClosingForExpenseDates(branchId, expenseDate);
    const refresh = closingRefresh.expenseDayRefresh || {};
    const forced = closingRefresh.reconciledDaysForced || [];
    const reconciledRefreshed = forced.includes(expenseDate);
    res.status(201).json({
      ...expense,
      daily_closing_updated: reconciledRefreshed || !refresh.skipped,
      daily_closing_locked: !reconciledRefreshed && !!refresh.skipped && refresh.reason === 'reconciled',
      reconciled_day_refreshed: reconciledRefreshed
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update expense (managers and admins only). If expense has bank_deposit_id, updates the linked bank_deposit.
router.put('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  const {
    date,
    category,
    amount,
    payment_source,
    description,
    receipt_number,
    bank_account_id,
    deposit_reference_number,
    bank_name: deposit_bank_name,
    employee_id
  } = req.body;
  
  try {
    const existing = await db.get('SELECT * FROM expenses WHERE id = $1 AND COALESCE(is_voided, FALSE) = FALSE', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    const newDate = normalizeExpenseDate(date);
    const oldDate = normalizeExpenseDate(existing.date);
    const branchId = existing.branch_id != null ? existing.branch_id : (getEffectiveBranchId(req) ?? req.user?.branchId ?? null);

    if (!assertNotFutureBusinessDate(newDate, res, 'date')) {
      return;
    }
    
    const oldReconciled = await isReconciledDay(oldDate, branchId);
    const newReconciled = await isReconciledDay(newDate, branchId);
    if ((oldReconciled || newReconciled) && !wantsReconciledDayAcknowledgement(req)) {
      return res.status(409).json({
        error:
          'This change affects a reconciled day. Tick “Adjust reconciled day” to save and refresh the locked daily summary.',
        code: 'reconciled_day'
      });
    }

    if (category === 'Bank Deposit' && existing.category !== 'Bank Deposit') {
      return res.status(400).json({
        error: 'Bank deposits are not recorded as expenses. Use Cash Management → Bank deposits.'
      });
    }
    if (existing.bank_deposit_id && category !== 'Bank Deposit') {
      return res.status(400).json({
        error: 'This line is linked to a bank deposit. Keep category as Bank Deposit or void the expense; use Cash Management for new deposits.'
      });
    }

    if (isSalaryAdvanceCategory(category) && !employee_id) {
      return res.status(400).json({ error: 'employee_id is required when category is Salary Advance' });
    }

    const result = await db.run(
      `UPDATE expenses 
       SET date = $1, category = $2, amount = $3, payment_source = $4, description = $5, receipt_number = $6,
           bank_account_id = $7, deposit_reference_number = $8, updated_by = $9, update_reason = $10
       WHERE id = $11`,
      [
        newDate,
        category,
        amount,
        payment_source,
        description || null,
        receipt_number || null,
        (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null,
        deposit_reference_number || null,
        req.user?.fullName || req.user?.username || null,
        req.body?.update_reason || null,
        id
      ]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    
    if (existing.bank_deposit_id) {
      const accountId = (bank_account_id != null && bank_account_id !== '') ? Number(bank_account_id) : null;
      const otherName = deposit_bank_name && String(deposit_bank_name).trim() ? String(deposit_bank_name).trim() : null;
        await db.run(
        `UPDATE bank_deposits SET date = $1, amount = $2, reference_number = $3, bank_name = $4, bank_account_id = $5, notes = $6 WHERE id = $7`,
        [newDate, amount, deposit_reference_number || null, otherName, accountId, description || null, existing.bank_deposit_id]
      );
    }
    if (isSalaryAdvanceCategory(category)) {
      await upsertLinkedSalaryAdvance({
        expenseId: Number(id),
        employeeId: employee_id,
        date: newDate,
        amount,
        notes: description,
        req
      });
    } else if (isSalaryAdvanceCategory(existing.category)) {
      await removeLinkedSalaryAdvance(Number(id));
    }
    
    const expense = await db.get(
      `SELECT e.*, b.name as bank_account_name, d.bank_name as deposit_bank_name,
          sa.employee_id as salary_advance_employee_id, emp.full_name as salary_advance_employee_name
       FROM expenses e
       LEFT JOIN bank_accounts b ON e.bank_account_id = b.id
       LEFT JOIN bank_deposits d ON e.bank_deposit_id = d.id
       LEFT JOIN salary_advances sa ON sa.source_expense_id = e.id
       LEFT JOIN employees emp ON emp.id = sa.employee_id
       WHERE e.id = $1`,
      [id]
    );

    await writeExpenseAudit('update', Number(id), existing, expense, req.body?.update_reason || null, req);
    const closingRefresh = await refreshDailyClosingForExpenseDates(branchId, oldDate, newDate);
    res.json({
      ...expense,
      reconciled_days_refreshed: closingRefresh.reconciledDaysForced || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Void expense (managers and admins only). Keeps audit trail and avoids hard-delete.
router.delete('/:id', requireBranchAccess(), requirePermission('canManageExpenses'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const existing = await db.get('SELECT * FROM expenses WHERE id = $1 AND COALESCE(is_voided, FALSE) = FALSE', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    const delDate = normalizeExpenseDate(existing.date);
    const branchId = existing.branch_id != null ? existing.branch_id : (getEffectiveBranchId(req) ?? req.user?.branchId ?? null);
    if (await isReconciledDay(delDate, branchId) && !wantsReconciledDayAcknowledgement(req)) {
      return res.status(409).json({
        error:
          'This expense is on a reconciled day. Confirm again to void and recalculate the locked daily summary (send acknowledge_reconciled_day).',
        code: 'reconciled_day'
      });
    }
    const result = await db.run(
      `UPDATE expenses
       SET is_voided = TRUE, void_reason = $1, voided_by = $2, voided_at = CURRENT_TIMESTAMP, updated_by = $2, update_reason = $1
       WHERE id = $3`,
      [
        req.body?.void_reason || 'Voided by user',
        req.user?.fullName || req.user?.username || 'User',
        id
      ]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    if (isSalaryAdvanceCategory(existing.category)) {
      await removeLinkedSalaryAdvance(Number(id));
    }
    await writeExpenseAudit('void', Number(id), existing, null, req.body?.void_reason || null, req);
    const closingRefresh = await refreshDailyClosingForExpenseDates(branchId, delDate);
    res.json({
      message: 'Expense voided successfully',
      reconciled_days_refreshed: closingRefresh.reconciledDaysForced || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
