const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getEffectiveBranchId } = require('../utils/branchFilter');
const { sqlOperatingExpensesOnly } = require('../utils/operatingExpenses');
const { getBusinessTodayYmd, assertNotFutureBusinessDate, toSqlDateString } = require('../utils/businessDate');
const {
  isReconciledFlag,
  deliverDirectorDailyReport,
} = require('../utils/dailyClosingReport');
const { notifyCashShort, notifyReconciledDay } = require('../utils/adminInbox');

function requireAdminForForceRecalc(req, res, next) {
  const force = req.body?.force === true || req.query?.force === '1' || req.query?.force === 'true';
  if (!force) return next();
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({
    error: 'Only an admin can force-recalculate a reconciled day. Unreconcile first, or ask an admin.',
    code: 'force_requires_admin',
  });
}

// All cash-management routes require branch feature 'cash_management' (admin bypasses)
router.use(authenticate, requireBranchFeature('cash_management'));

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Expected cash opening for `date` = the prior calendar day's ending cash.
 * For reconciled days, use reconciled_closing_balance (frozen at reconcile) so later
 * recomputes of closing_balance cannot drift the chain or create false opening variance.
 */
async function getExpectedOpeningBalance(date, branchId) {
  const day = toSqlDateString(date);
  if (!day) return 0;
  const row = await db.get(
    `SELECT COALESCE(reconciled_closing_balance, closing_balance) AS anchor_close
     FROM daily_cash_summaries
     WHERE date < ? AND branch_id = ?
     ORDER BY date DESC
     LIMIT 1`,
    [day, branchId]
  );
  return row ? num(row.anchor_close) : 0;
}

async function upsertDailySummaryFromComputed(date, branchId, computed, notes = null, force = false) {
  const day = toSqlDateString(date);
  if (!day) {
    throw new Error('Invalid date for daily cash summary');
  }
  const existing = await db.get(
    'SELECT id, is_reconciled, notes, reconciled_closing_balance FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [day, branchId]
  );

  // Never overwrite reconciled rows automatically unless force=true (payment backdate correction).
  if (!force && existing && isReconciledFlag(existing.is_reconciled)) {
    return db.get('SELECT * FROM daily_cash_summaries WHERE id = ?', [existing.id]);
  }

  const payload = {
    opening_balance: num(computed.opening_balance),
    opening_cash_declared: computed.opening_cash_declared != null ? computed.opening_cash_declared : null,
    opening_variance: num(computed.opening_variance),
    cash_sales: num(computed.cash_sales),
    book_sales: num(computed.book_sales),
    card_sales: num(computed.card_sales),
    mobile_money_sales: num(computed.mobile_money_sales),
    credit_sales: num(computed.credit_sales),
    bank_deposits: num(computed.bank_deposits),
    bank_payments: num(computed.bank_payments),
    mpesa_received: num(computed.mpesa_received),
    mpesa_paid: num(computed.mpesa_paid),
    expenses_from_cash: num(computed.expenses_from_cash),
    expenses_from_bank: num(computed.expenses_from_bank),
    expenses_from_mpesa: num(computed.expenses_from_mpesa),
    cash_in_hand: num(computed.cash_in_hand),
    closing_balance: num(computed.closing_balance)
  };

  const nextReconciledSnap =
    existing && isReconciledFlag(existing.is_reconciled) && force ? payload.closing_balance : existing?.reconciled_closing_balance ?? null;

  if (existing) {
    await db.run(
      `UPDATE daily_cash_summaries SET
        opening_balance = ?,
        opening_cash_declared = ?,
        opening_variance = ?,
        cash_sales = ?,
        book_sales = ?,
        card_sales = ?,
        mobile_money_sales = ?,
        credit_sales = ?,
        bank_deposits = ?,
        bank_payments = ?,
        mpesa_received = ?,
        mpesa_paid = ?,
        expenses_from_cash = ?,
        expenses_from_bank = ?,
        expenses_from_mpesa = ?,
        cash_in_hand = ?,
        closing_balance = ?,
        reconciled_closing_balance = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        payload.opening_balance,
        payload.opening_cash_declared,
        payload.opening_variance,
        payload.cash_sales,
        payload.book_sales,
        payload.card_sales,
        payload.mobile_money_sales,
        payload.credit_sales,
        payload.bank_deposits,
        payload.bank_payments,
        payload.mpesa_received,
        payload.mpesa_paid,
        payload.expenses_from_cash,
        payload.expenses_from_bank,
        payload.expenses_from_mpesa,
        payload.cash_in_hand,
        payload.closing_balance,
        nextReconciledSnap,
        notes != null ? notes : existing.notes || null,
        existing.id
      ]
    );
    return db.get('SELECT * FROM daily_cash_summaries WHERE id = ?', [existing.id]);
  }

  await db.run(
    `INSERT INTO daily_cash_summaries (
      date, branch_id, opening_balance, opening_cash_declared, opening_variance, cash_sales, book_sales, card_sales, mobile_money_sales,
      credit_sales, bank_deposits, bank_payments, mpesa_received, mpesa_paid,
      expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
      cash_in_hand, closing_balance, notes, is_reconciled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
    [
      day,
      branchId,
      payload.opening_balance,
      payload.opening_cash_declared,
      payload.opening_variance,
      payload.cash_sales,
      payload.book_sales,
      payload.card_sales,
      payload.mobile_money_sales,
      payload.credit_sales,
      payload.bank_deposits,
      payload.bank_payments,
      payload.mpesa_received,
      payload.mpesa_paid,
      payload.expenses_from_cash,
      payload.expenses_from_bank,
      payload.expenses_from_mpesa,
      payload.cash_in_hand,
      payload.closing_balance,
      notes
    ]
  );

  return db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [day, branchId]);
}

/**
 * Build daily cash summary from source data (orders, transactions, expenses, deposits) and persist.
 * Used when the day has no row yet, or exists but is not reconciled (so expenses/backfills update totals).
 */
async function computeAndPersistDailySummary(date, branchId, force = false) {
  const day = toSqlDateString(date);
  if (!day) {
    throw new Error('Invalid date for daily cash summary');
  }
  const openingBalance = await getExpectedOpeningBalance(day, branchId);
  const existingRow = await db.get(
    'SELECT opening_cash_declared FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [day, branchId]
  );

  const cashSalesRow = await db.all(`
    SELECT SUM(paid_amount) as cash_sales
    FROM orders
    WHERE DATE(order_date) = ?
    AND payment_status = 'paid_full'
    AND payment_method = 'cash'
    AND paid_amount > 0
    AND branch_id = ?
    AND COALESCE(is_voided, FALSE) = FALSE
  `, [day, branchId]);
  const cashSales = num(cashSalesRow[0]?.cash_sales);

  const { calculateBookSales, calculateCreditSales } = require('../utils/cashValidation');
  let bookSales = 0;
  let creditSales = 0;
  try {
    bookSales = await calculateBookSales(day, branchId);
  } catch (err) {
    console.error('Error calculating book sales for daily summary:', err);
  }
  try {
    creditSales = await calculateCreditSales(day, branchId);
  } catch (err) {
    console.error('Error calculating credit sales for daily summary:', err);
  }

  const calculated = await calculateRemaining(
    day,
    openingBalance,
    cashSales,
    bookSales,
    branchId,
    existingRow?.opening_cash_declared,
    creditSales
  );
  return upsertDailySummaryFromComputed(day, branchId, calculated, null, force);
}

/**
 * Recalculate and save daily summary for a date unless that day is already reconciled (audit lock).
 * Call after expense create/update/delete so backdated expenses flow into the correct day.
 * @returns {Promise<{ skipped: boolean, reason?: string, row?: object }>}
 */
async function refreshUnreconciledDailySummary(date, branchId) {
  const day = toSqlDateString(date);
  if (!day) {
    return { skipped: true, reason: 'invalid_date', row: null };
  }
  const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [day, branchId]);
  if (row && isReconciledFlag(row.is_reconciled)) {
    return { skipped: true, reason: 'reconciled', row };
  }
  const persisted = await computeAndPersistDailySummary(day, branchId);
  return { skipped: false, row: persisted };
}

/**
 * Force-refresh a day even when reconciled (used for explicitly backdated payment booking).
 * This keeps selected paid date totals/book-sales/closing in sync with transactions.
 */
async function refreshDailySummaryForce(date, branchId) {
  const day = toSqlDateString(date);
  if (!day) {
    throw new Error('Invalid date for daily cash summary');
  }
  const persisted = await computeAndPersistDailySummary(day, branchId, true);
  return { forced: true, row: persisted };
}

/**
 * After a backdated expense (or any change to an earlier day), recompute this day and every
 * later unreconciled day so opening/closing chains stay correct on Pending reconciliations.
 */
async function refreshUnreconciledSummariesFromDate(branchId, startDate) {
  const day = toSqlDateString(startDate);
  if (branchId == null || !day) {
    return { expenseDayRefresh: { skipped: true, reason: 'invalid' }, daysRefreshed: 0 };
  }
  const rowDates = await db.all(
    `SELECT date::text AS d FROM daily_cash_summaries
     WHERE branch_id = ? AND date >= ?::date AND COALESCE(is_reconciled, FALSE) = FALSE
     ORDER BY date ASC`,
    [branchId, day]
  );
  const unique = new Set([day]);
  for (const r of rowDates || []) {
    if (r?.d) unique.add(toSqlDateString(r.d) || String(r.d).trim().slice(0, 10));
  }
  const sorted = [...unique].sort();
  let expenseDayRefresh = null;
  for (const d of sorted) {
    const res = await refreshUnreconciledDailySummary(d, branchId);
    if (d === day) expenseDayRefresh = res;
  }
  return { expenseDayRefresh: expenseDayRefresh || { skipped: false }, daysRefreshed: sorted.length };
}

/** In-flight background refresh keys — avoids duplicate heavy recalcs on rapid page loads. */
const bgRefreshInFlight = new Set();

/**
 * Queue a non-blocking daily summary recalc (debounced per branch+date).
 * Use after payments, orders, expenses — not on every GET.
 */
function scheduleBackgroundDailySummaryRefresh(date, branchId, { force = false } = {}) {
  const day = toSqlDateString(date);
  if (!day || branchId == null) return;
  const key = `${branchId}:${day}:${force ? 'force' : 'normal'}`;
  if (bgRefreshInFlight.has(key)) return;
  bgRefreshInFlight.add(key);
  setImmediate(async () => {
    try {
      if (force) {
        await refreshDailySummaryForce(day, branchId);
      } else {
        await refreshUnreconciledDailySummary(day, branchId);
      }
    } catch (err) {
      console.error('Background daily summary refresh failed:', day, branchId, err.message);
    } finally {
      bgRefreshInFlight.delete(key);
    }
  });
}

/**
 * Fast read: return persisted summary immediately; refresh unreconciled days in background.
 * Sync compute only when no row exists yet (first visit for that branch/day).
 */
async function readDailySummaryForView(date, branchId, { scheduleRefresh = true } = {}) {
  const day = toSqlDateString(date);
  if (!day) {
    throw new Error('Invalid date for daily cash summary');
  }
  const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [day, branchId]);
  if (row) {
    if (scheduleRefresh && !row.is_reconciled) {
      scheduleBackgroundDailySummaryRefresh(day, branchId);
    }
    return row;
  }
  return computeAndPersistDailySummary(day, branchId);
}

async function readTodayConsolidatedForView(today, branchIds, { scheduleRefresh = true } = {}) {
  if (!branchIds.length) {
    return emptyDailySummary(today, true);
  }
  const placeholders = branchIds.map(() => '?').join(',');
  const stored = await db.all(
    `SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id IN (${placeholders})`,
    [today, ...branchIds]
  );
  const byBranch = new Map((stored || []).map((r) => [Number(r.branch_id), r]));
  const results = [];
  for (const bid of branchIds) {
    const row = byBranch.get(Number(bid));
    if (row) {
      results.push(row);
      if (scheduleRefresh && !row.is_reconciled) {
        scheduleBackgroundDailySummaryRefresh(today, bid);
      }
    } else {
      results.push(await computeAndPersistDailySummary(today, bid));
    }
  }
  const consolidated = consolidateSummaries(results, today);
  consolidated.all_branches = true;
  return consolidated;
}

// Line-level detail for cash sales on a date (matches daily summary cash_sales)
router.get('/details/cash-sales/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash sales detail' });
  }
  try {
    const {
      listCashSalesOrdersForDate
    } = require('../utils/cashValidation');
    const lines = await listCashSalesOrdersForDate(date, branchId);
    const total = lines.reduce((s, r) => s + num(r.paid_amount), 0);
    res.json({ date, branch_id: branchId, lines, total });
  } catch (err) {
    console.error('Error listing cash sales detail:', err);
    res.status(500).json({ error: err.message });
  }
});

// Line-level detail for book sales (cash collections) on a date (matches daily summary book_sales)
router.get('/details/book-sales/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view book sales detail' });
  }
  try {
    const {
      listBookSalesCashTransactionsForDate
    } = require('../utils/cashValidation');
    const lines = await listBookSalesCashTransactionsForDate(date, branchId);
    const total = lines.reduce((s, r) => s + num(r.amount), 0);
    res.json({ date, branch_id: branchId, lines, total });
  } catch (err) {
    console.error('Error listing book sales detail:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get daily cash summary by date (cashiers, managers, admins can view)
router.get('/daily/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash management' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }
  try {
    const row = await readDailySummaryForView(ymd, branchId);
    return res.json(row);
  } catch (err) {
    console.error('Error fetching daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Recalculate daily closing from live data. Use body.force / query force=1 to update reconciled days (recomputes sales/closing; keeps reconciliation lock).
router.post('/daily/recalculate/:date', requireBranchAccess(), requirePermission('canManageCash'), requireAdminForForceRecalc, async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to recalculate daily closing' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }
  const force = req.body?.force === true || req.query?.force === '1' || req.query?.force === 'true';
  try {
    if (force) {
      const out = await refreshDailySummaryForce(ymd, branchId);
      return res.json(out.row);
    }
    const result = await refreshUnreconciledDailySummary(ymd, branchId);
    if (result.skipped) {
      return res.status(409).json({
        error: 'This date is already reconciled. Use “Refresh totals” in Cash Management (or send force: true) to reload sales figures from live data without unlocking the day.',
        row: result.row
      });
    }
    res.json(result.row);
  } catch (err) {
    console.error('Error recalculating daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Recompute this date and every later unreconciled day (same as after a backdated expense).
 * Use after bank deposits or corrections so opening/closing chain matches for following days.
 */
router.post('/daily/refresh-chain/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to refresh the cash chain' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }
  try {
    const out = await refreshUnreconciledSummariesFromDate(branchId, ymd);
    res.json({
      success: true,
      days_refreshed: out.daysRefreshed ?? 0,
      anchor: ymd,
      start_day_refresh: out.expenseDayRefresh
    });
  } catch (err) {
    console.error('Error refreshing cash chain:', err);
    res.status(500).json({ error: err.message });
  }
});

// Record opening session cash declaration and compare with previous closing balance.
router.post('/opening-session/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const openingCash = parseFloat(req.body?.opening_cash);
  const notes = req.body?.notes || null;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to start opening session' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return res.status(400).json({ error: 'opening_cash must be a valid non-negative number' });
  }
  try {
    const existing = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
    if (existing && isReconciledFlag(existing.is_reconciled)) {
      return res.status(409).json({ error: 'This day is already reconciled and cannot be changed.' });
    }
    const expectedOpening = await getExpectedOpeningBalance(ymd, branchId);
    const openingVariance = openingCash - expectedOpening;

    if (existing) {
      await db.run(
        `UPDATE daily_cash_summaries
         SET opening_balance = ?, opening_cash_declared = ?, opening_variance = ?, opening_session_by = ?, opening_session_at = CURRENT_TIMESTAMP, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [expectedOpening, openingCash, openingVariance, req.user?.fullName || req.user?.username || 'Cashier', notes, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO daily_cash_summaries (date, branch_id, opening_balance, opening_cash_declared, opening_variance, opening_session_by, opening_session_at, notes, is_reconciled)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, FALSE)`,
        [ymd, branchId, expectedOpening, openingCash, openingVariance, req.user?.fullName || req.user?.username || 'Cashier', notes]
      );
    }
    await refreshUnreconciledSummariesFromDate(branchId, ymd);
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);

    try {
      await notifyCashShort({
        branchId,
        date: ymd,
        openingVariance: parseFloat(row.opening_variance || 0),
        openingCashDeclared: parseFloat(row.opening_cash_declared || 0),
        expectedOpening: parseFloat(row.opening_balance || 0),
        reportedBy: req.user?.fullName || req.user?.username || 'Cashier',
      });
    } catch (inboxErr) {
      console.error('Failed to notify cash short to admin inbox:', inboxErr.message);
    }

    res.json({
      ...row,
      opening_balanced: Math.abs(parseFloat(row.opening_variance || 0)) < 0.01,
      opening_short: parseFloat(row.opening_variance || 0) < 0 ? Math.abs(parseFloat(row.opening_variance || 0)) : 0,
      opening_over: parseFloat(row.opening_variance || 0) > 0 ? parseFloat(row.opening_variance || 0) : 0
    });
  } catch (err) {
    console.error('Error saving opening session:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get today's cash summary (with automatic calculations) (cashiers, managers, admins can view)
// When admin and no branch selected: return consolidated totals across all branches
router.get('/today', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const branchId = getEffectiveBranchId(req);
  const today = getBusinessTodayYmd();
  const isAdminAllBranches = req.user?.role === 'admin' && (branchId == null || branchId === '');

  if (!isAdminAllBranches && branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash management' });
  }

  if (isAdminAllBranches) {
    try {
      const branchRows = await db.all('SELECT id FROM branches ORDER BY id');
      const branchIds = (branchRows || []).map((r) => r.id);
      const consolidated = await readTodayConsolidatedForView(today, branchIds);
      return res.json(consolidated);
    } catch (err) {
      console.error('Error fetching consolidated today summary:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const row = await readDailySummaryForView(today, branchId);
    res.json(row);
  } catch (err) {
    console.error('Error fetching today\'s cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

function emptyDailySummary(date, allBranches = false) {
  return {
    date,
    opening_balance: 0,
    cash_sales: 0,
    book_sales: 0,
    card_sales: 0,
    mobile_money_sales: 0,
    credit_sales: 0,
    bank_deposits: 0,
    bank_payments: 0,
    mpesa_received: 0,
    mpesa_paid: 0,
    expenses_from_cash: 0,
    expenses_from_bank: 0,
    expenses_from_mpesa: 0,
    closing_balance: 0,
    is_reconciled: false,
    all_branches: allBranches
  };
}

function consolidateSummaries(results, date) {
  const sum = (key) => results.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0);
  const anyReconciled = results.some((r) => r.is_reconciled);
  return {
    date,
    opening_balance: sum('opening_balance'),
    cash_sales: sum('cash_sales'),
    book_sales: sum('book_sales'),
    card_sales: sum('card_sales'),
    mobile_money_sales: sum('mobile_money_sales'),
    credit_sales: sum('credit_sales'),
    bank_deposits: sum('bank_deposits'),
    bank_payments: sum('bank_payments'),
    mpesa_received: sum('mpesa_received'),
    mpesa_paid: sum('mpesa_paid'),
    expenses_from_cash: sum('expenses_from_cash'),
    expenses_from_bank: sum('expenses_from_bank'),
    expenses_from_mpesa: sum('expenses_from_mpesa'),
    cash_in_hand: sum('cash_in_hand'),
    closing_balance: sum('closing_balance'),
    is_reconciled: anyReconciled
  };
}

async function calculateRemaining(date, openingBalance, cashSales, bookSales, branchId, declaredOpeningCash = null, creditSales = 0) {
  const { calculateMobileMoneyReceived, calculateCardReceived, calculateBankReceived } = require('../utils/cashValidation');

  // Card, M-Pesa, and bank from transactions (advance + full payments on this date)
  let cardSales = 0;
  let mobileMoneySales = 0;
  let bankPaymentsFromTx = 0;
  try {
    const [cardFromTx, mpesaFromTx, bankFromTx] = await Promise.all([
      calculateCardReceived(date, branchId),
      calculateMobileMoneyReceived(date, branchId),
      calculateBankReceived(date, branchId)
    ]);
    cardSales = cardFromTx;
    mobileMoneySales = mpesaFromTx;
    bankPaymentsFromTx = bankFromTx;
  } catch (err) {
    console.error('Error calculating card/M-Pesa/bank from transactions:', err);
  }
  
  // Calculate expenses (normalize to calendar day; NULL branch_id legacy rows)
  const expensesRow = await db.all(`
    SELECT 
      SUM(CASE WHEN e.payment_source = 'cash' THEN e.amount ELSE 0 END) as expenses_from_cash,
      SUM(CASE WHEN e.payment_source = 'bank' THEN e.amount ELSE 0 END) as expenses_from_bank,
      SUM(CASE WHEN e.payment_source = 'mpesa' THEN e.amount ELSE 0 END) as expenses_from_mpesa
    FROM expenses e
    WHERE e.date::date = $1::date
    AND (e.branch_id = $2 OR e.branch_id IS NULL)
    ${sqlOperatingExpensesOnly()}
  `, [date, branchId]);
  
  const expensesFromCash = num(expensesRow[0]?.expenses_from_cash);
  const expensesFromBank = num(expensesRow[0]?.expenses_from_bank);
  const expensesFromMpesa = num(expensesRow[0]?.expenses_from_mpesa);
  
  // Bank deposits: match calendar day; prefer explicit branch_id, then legacy NULL branch rows
  let depositsRow = await db.get(
    `SELECT COALESCE(SUM(amount), 0) as total FROM bank_deposits WHERE date::date = $1::date AND branch_id = $2`,
    [date, branchId]
  );
  let bankDeposits = num(depositsRow?.total);
  if (bankDeposits === 0) {
    const legacyDep = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bank_deposits WHERE date::date = $1::date AND branch_id IS NULL`,
      [date]
    );
    bankDeposits = num(legacyDep?.total);
  }
  
  const effectiveOpening = declaredOpeningCash != null ? num(declaredOpeningCash) : num(openingBalance);
  const openingVariance = effectiveOpening - openingBalance;
  // Cash in hand starts from declared opening cash (if provided), else previous day closing.
  const cashInHand = effectiveOpening + num(cashSales) + num(bookSales) - expensesFromCash - bankDeposits;
  const closingBalance = cashInHand;
  
  return {
    date,
    opening_balance: openingBalance,
    opening_cash_declared: declaredOpeningCash != null ? effectiveOpening : null,
    opening_variance: openingVariance,
    cash_sales: cashSales,
    book_sales: bookSales,
    card_sales: cardSales,
    mobile_money_sales: mobileMoneySales,
    credit_sales: num(creditSales),
    bank_deposits: bankDeposits,
    bank_payments: bankPaymentsFromTx,
    mpesa_received: mobileMoneySales,
    mpesa_paid: 0,
    expenses_from_cash: expensesFromCash,
    expenses_from_bank: expensesFromBank,
    expenses_from_mpesa: expensesFromMpesa,
    cash_in_hand: cashInHand,
    closing_balance: closingBalance,
    is_reconciled: false
  };
}

// Create or update daily cash summary
router.post('/daily', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const {
    date,
    bank_deposits,
    bank_payments,
    mpesa_received,
    mpesa_paid,
    notes
  } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to save cash summary' });
  }
  const today = toSqlDateString(date) || toSqlDateString(new Date().toISOString().split('T')[0]);
  if (!today || !assertNotFutureBusinessDate(today, res, 'date')) {
    return;
  }
  
  try {
    const openingBalance = await getExpectedOpeningBalance(today, branchId);
    const existingRow = await db.get(
      'SELECT opening_cash_declared, opening_variance, opening_session_by, opening_session_at FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
      [today, branchId]
    );
    
    // Calculate cash sales (orders paid in full with cash on order date)
    const cashSalesRow = await db.all(`
      SELECT SUM(paid_amount) as cash_sales
      FROM orders
      WHERE DATE(order_date) = ?
      AND payment_status = 'paid_full'
      AND payment_method = 'cash'
      AND paid_amount > 0
      AND branch_id = ?
      AND COALESCE(is_voided, FALSE) = FALSE
    `, [today, branchId]);
    
    const cashSales = num(cashSalesRow[0]?.cash_sales);
    
    // Book sales = cash received from receive-payment / collection (daily sales report)
    const { calculateBookSales, calculateCreditSales } = require('../utils/cashValidation');
    let bookSales = 0;
    let creditSales = 0;
    try {
      bookSales = await calculateBookSales(today, branchId);
    } catch (err) {
      console.error('Error calculating book sales:', err);
      bookSales = 0;
    }
    try {
      creditSales = await calculateCreditSales(today, branchId);
    } catch (err) {
      console.error('Error calculating credit sales:', err);
      creditSales = 0;
    }
    
    // Card and M-Pesa from transactions only (includes advance + full payments on this date)
    const { calculateMobileMoneyReceived, calculateCardReceived } = require('../utils/cashValidation');
    let cardSales = 0;
    let mobileMoneySales = 0;
    try {
      const [cardFromTx, mpesaFromTx] = await Promise.all([
        calculateCardReceived(today, branchId),
        calculateMobileMoneyReceived(today, branchId)
      ]);
      cardSales = cardFromTx;
      mobileMoneySales = mpesaFromTx;
    } catch (err) {
      console.error('Error calculating card/M-Pesa from transactions:', err);
    }

    // Calculate expenses (calendar day; NULL branch_id legacy rows)
    const expensesRow = await db.all(`
      SELECT 
        SUM(CASE WHEN e.payment_source = 'cash' THEN e.amount ELSE 0 END) as expenses_from_cash,
        SUM(CASE WHEN e.payment_source = 'bank' THEN e.amount ELSE 0 END) as expenses_from_bank,
        SUM(CASE WHEN e.payment_source = 'mpesa' THEN e.amount ELSE 0 END) as expenses_from_mpesa
      FROM expenses e
      WHERE e.date::date = $1::date
      AND (e.branch_id = $2 OR e.branch_id IS NULL)
      ${sqlOperatingExpensesOnly()}
    `, [today, branchId]);
    
    const expensesFromCash = num(expensesRow[0]?.expenses_from_cash);
    const expensesFromBank = num(expensesRow[0]?.expenses_from_bank);
    const expensesFromMpesa = num(expensesRow[0]?.expenses_from_mpesa);
    
    const bankDepositsAmount = num(bank_deposits);
    const bankPayments = num(bank_payments);
    const mpesaReceived = mpesa_received != null ? num(mpesa_received) : num(mobileMoneySales);
    const mpesaPaid = num(mpesa_paid);
    
    const declaredOpening = existingRow?.opening_cash_declared != null
      ? num(existingRow.opening_cash_declared)
      : openingBalance;
    const openingVariance = declaredOpening - openingBalance;
    // Cash in hand = declared opening (or expected opening) + sales - cash outflows.
    const cashInHand = declaredOpening + cashSales + bookSales - expensesFromCash - bankDepositsAmount;
    const closingBalance = cashInHand;
    
    // Check if record exists
    const existing = await db.get('SELECT id FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
    
    if (existing) {
      // Update existing record
      await db.run(
        `UPDATE daily_cash_summaries SET
          opening_balance = ?,
          opening_cash_declared = ?,
          opening_variance = ?,
          cash_sales = ?,
          book_sales = ?,
          card_sales = ?,
          mobile_money_sales = ?,
          credit_sales = ?,
          bank_deposits = ?,
          bank_payments = ?,
          mpesa_received = ?,
          mpesa_paid = ?,
          expenses_from_cash = ?,
          expenses_from_bank = ?,
          expenses_from_mpesa = ?,
          cash_in_hand = ?,
          closing_balance = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE date = ? AND branch_id = ?`,
        [openingBalance, declaredOpening, openingVariance, cashSales, bookSales, cardSales, mobileMoneySales,
         creditSales, bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
         expensesFromCash, expensesFromBank, expensesFromMpesa,
         cashInHand, closingBalance, notes || null, today, branchId]
      );
      
      const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
      res.json(row);
    } else {
      // Insert new record
      await db.run(
        `INSERT INTO daily_cash_summaries (
          date, branch_id, opening_balance, opening_cash_declared, opening_variance, cash_sales, book_sales, card_sales, mobile_money_sales,
          credit_sales, bank_deposits, bank_payments, mpesa_received, mpesa_paid,
          expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
          cash_in_hand, closing_balance, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [today, branchId, openingBalance, declaredOpening, openingVariance, cashSales, bookSales, cardSales, mobileMoneySales,
         creditSales, bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
         expensesFromCash, expensesFromBank, expensesFromMpesa,
         cashInHand, closingBalance, notes || null]
      );
      
      const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
      res.json(row);
    }
  } catch (err) {
    console.error('Error creating/updating daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reconcile daily cash (managers and admins only)
// If no daily summary exists for the date, create it from calculated values first, then mark reconciled.
router.post('/reconcile/:date', requireBranchAccess(), requirePermission('canReconcile'), async (req, res) => {
  const { date } = req.params;
  const { reconciled_by } = req.body;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to reconcile' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }
  try {
    // Always refresh from source data right before locking to ensure closing balance is correct.
    const refresh = await refreshUnreconciledDailySummary(ymd, branchId);
    let row = refresh.row || await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
    if (!row) return res.status(404).json({ error: 'Daily summary not found' });
    if (refresh.skipped && refresh.reason === 'reconciled') {
      return res.status(409).json({
        error: 'This branch has already reconciled this date. Use Send to director to resend the WhatsApp report.',
        code: 'already_reconciled',
        row,
      });
    }
    
    const snapClosing = num(row.closing_balance);
    const result = await db.run(
      `UPDATE daily_cash_summaries 
       SET is_reconciled = TRUE,
           reconciled_by = ?,
           reconciled_at = CURRENT_TIMESTAMP,
           reconciled_closing_balance = ?
       WHERE date = ? AND branch_id = ? AND COALESCE(is_reconciled, FALSE) = FALSE`,
      [reconciled_by || 'Cashier', snapClosing, ymd, branchId]
    );
    
    if (result.changes === 0) {
      const locked = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
      if (locked && isReconciledFlag(locked.is_reconciled)) {
        return res.status(409).json({
          error: 'This branch has already reconciled this date. Use Send to director to resend the WhatsApp report.',
          code: 'already_reconciled',
          row: locked,
        });
      }
      return res.status(404).json({ error: 'Daily summary not found for this branch' });
    }

    row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
    const branchRow = await db.get('SELECT name FROM branches WHERE id = ?', [branchId]);
    const branchName = branchRow?.name || `Branch ${branchId}`;

    try {
      await notifyReconciledDay({
        branchId,
        date: ymd,
        reconciledBy: reconciled_by || req.user?.fullName || req.user?.username || 'Cashier',
        openingVariance: parseFloat(row.opening_variance || 0),
        closingBalance: row.closing_balance ?? row.reconciled_closing_balance ?? null,
      });
    } catch (inboxErr) {
      console.error('Failed to notify reconcile to admin inbox:', inboxErr.message);
    }

    const delivery = await deliverDirectorDailyReport(row, branchName, reconciled_by || 'Cashier', ymd);

    res.json({
      ...row,
      branch_id: branchId,
      branch_name: branchName,
      report_sent: delivery.report_sent,
      report_text: delivery.report_text || undefined,
      director_phone_wa: delivery.director_phone_wa || undefined,
      report_error: delivery.error || undefined,
    });
  } catch (err) {
    console.error('Error reconciling daily cash:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send daily closing report to director WhatsApp for one branch/date (independent per branch).
 */
router.post('/send-report/:date', requireBranchAccess(), requirePermission('canReconcile'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to send the daily closing report' });
  }
  const ymd = toSqlDateString(date);
  if (!ymd || !assertNotFutureBusinessDate(ymd, res, 'date')) {
    return;
  }

  try {
    let row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
    if (!row) {
      const refresh = await refreshUnreconciledDailySummary(ymd, branchId);
      row = refresh.row;
    }
    if (!row) {
      return res.status(404).json({
        error: 'No daily closing summary for this branch and date. Save opening session or refresh totals first.',
      });
    }

    const branchRow = await db.get('SELECT name FROM branches WHERE id = ?', [branchId]);
    const branchName = branchRow?.name || `Branch ${branchId}`;
    const cashierName =
      req.body?.sent_by || req.body?.reconciled_by || req.user?.fullName || req.user?.username || 'Cashier';

    const delivery = await deliverDirectorDailyReport(row, branchName, cashierName, ymd);

    res.json({
      ...row,
      branch_id: branchId,
      branch_name: branchName,
      report_sent: delivery.report_sent,
      report_text: delivery.report_text || undefined,
      director_phone_wa: delivery.director_phone_wa || undefined,
      report_error: delivery.error || undefined,
    });
  } catch (err) {
    console.error('Error sending daily closing report:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Admin only: unlock a reconciled day so branch staff can add expenses, payments, book sales, etc., then reconcile again.
 * Appends an audit line to daily_cash_summaries.notes and refreshes this day and later unreconciled days in the chain.
 */
router.post('/unreconcile/:date', requireBranchAccess(), requireRole('admin'), async (req, res) => {
  const { date } = req.params;
  const { reason, branch_id: bodyBranchId } = req.body || {};
  let branchId = getEffectiveBranchId(req);
  if (branchId == null && req.user?.role === 'admin') {
    const bid = bodyBranchId != null ? parseInt(bodyBranchId, 10) : NaN;
    if (!Number.isFinite(bid)) {
      return res.status(400).json({
        error: 'When viewing all branches, pass branch_id in the request body to identify which branch to unlock.',
      });
    }
    branchId = bid;
  }
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch in the header or pass branch_id in the request body.' });
  }

  const ymd = toSqlDateString(date);
  if (!ymd) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  try {
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);
    if (!row) {
      return res.status(404).json({ error: 'No daily cash summary for this date and branch.' });
    }
    const reconciled =
      row.is_reconciled === true ||
      row.is_reconciled === 1 ||
      row.is_reconciled === 'true' ||
      row.is_reconciled === '1';
    if (!reconciled) {
      return res.status(409).json({ error: 'This day is not marked reconciled; nothing to reverse.' });
    }

    const adminLabel = req.user?.username || req.user?.fullName || 'admin';
    const auditLine = `[${new Date().toISOString()}] Unreconciled by ${adminLabel}${reason && String(reason).trim() ? `: ${String(reason).trim().slice(0, 500)}` : ''}`;
    const newNotes = row.notes ? `${row.notes}\n${auditLine}` : auditLine;

    await db.run(
      `UPDATE daily_cash_summaries
       SET is_reconciled = FALSE,
           reconciled_by = NULL,
           reconciled_at = NULL,
           reconciled_closing_balance = NULL,
           notes = ?
       WHERE date = ? AND branch_id = ?`,
      [newNotes, ymd, branchId]
    );

    const chain = await refreshUnreconciledSummariesFromDate(branchId, ymd);
    const updated = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [ymd, branchId]);

    res.json({
      success: true,
      message: 'Reconciliation reversed. The branch can edit this day and reconcile again when ready.',
      row: updated,
      days_refreshed: chain.daysRefreshed ?? 0,
    });
  } catch (err) {
    console.error('Error unreconciling daily cash:', err);
    res.status(500).json({ error: err.message });
  }
});

// List daily closings that were saved but not yet reconciled
router.get('/unreconciled', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const branchId = getEffectiveBranchId(req);
  const isAdminAllBranches = req.user?.role === 'admin' && (branchId == null || branchId === '');
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 365) : 60;
  const businessToday = getBusinessTodayYmd();

  if (!isAdminAllBranches && branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view unreconciled closings' });
  }

  try {
    if (isAdminAllBranches) {
      let rows = await db.all(
        `SELECT dcs.*, b.name as branch_name
         FROM daily_cash_summaries dcs
         LEFT JOIN branches b ON b.id = dcs.branch_id
         WHERE COALESCE(dcs.is_reconciled, FALSE) = FALSE
         AND dcs.date <= ?
         ORDER BY dcs.date DESC, dcs.id DESC
         LIMIT ?`,
        [businessToday, limit]
      );
      for (const r of rows || []) {
        if (r?.date && r.branch_id != null && !r.is_reconciled) {
          scheduleBackgroundDailySummaryRefresh(r.date, r.branch_id);
        }
      }
      return res.json(rows || []);
    }

    let rows = await db.all(
      `SELECT dcs.*, b.name as branch_name
       FROM daily_cash_summaries dcs
       LEFT JOIN branches b ON b.id = dcs.branch_id
       WHERE COALESCE(dcs.is_reconciled, FALSE) = FALSE
       AND dcs.branch_id = ?
       AND dcs.date <= ?
       ORDER BY dcs.date DESC, dcs.id DESC
       LIMIT ?`,
      [branchId, businessToday, limit]
    );
    for (const r of rows || []) {
      if (r?.date && !r.is_reconciled) {
        scheduleBackgroundDailySummaryRefresh(r.date, branchId);
      }
    }
    return res.json(rows || []);
  } catch (err) {
    console.error('Error fetching unreconciled daily closings:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Get cash summary range (single branch or consolidated for admin when no branch)
router.get('/range', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchId = getEffectiveBranchId(req);
  const isAdminAllBranches = req.user?.role === 'admin' && (branchId == null || branchId === '');

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  if (!isAdminAllBranches && branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash range' });
  }

  try {
    if (isAdminAllBranches) {
      const rows = await db.all(
        `SELECT date,
          SUM(COALESCE(opening_balance, 0)) as opening_balance,
          SUM(COALESCE(opening_variance, 0)) as opening_variance,
          SUM(COALESCE(cash_sales, 0)) as cash_sales,
          SUM(COALESCE(book_sales, 0)) as book_sales,
          SUM(COALESCE(card_sales, 0)) as card_sales,
          SUM(COALESCE(mobile_money_sales, 0)) as mobile_money_sales,
          SUM(COALESCE(credit_sales, 0)) as credit_sales,
          SUM(COALESCE(bank_deposits, 0)) as bank_deposits,
          SUM(COALESCE(expenses_from_cash, 0)) as expenses_from_cash,
          SUM(COALESCE(closing_balance, 0)) as closing_balance,
          MAX(CASE WHEN is_reconciled = 1 THEN 1 ELSE 0 END) as is_reconciled
         FROM daily_cash_summaries
         WHERE date >= ? AND date <= ?
         GROUP BY date
         ORDER BY date DESC`,
        [start_date, end_date]
      );
      const normalized = (rows || []).map((r) => ({
        date: r.date,
        opening_balance: r.opening_balance,
        opening_variance: r.opening_variance,
        cash_sales: r.cash_sales,
        book_sales: r.book_sales,
        card_sales: r.card_sales,
        mobile_money_sales: r.mobile_money_sales,
        credit_sales: r.credit_sales,
        bank_deposits: r.bank_deposits,
        expenses_from_cash: r.expenses_from_cash,
        closing_balance: r.closing_balance,
        is_reconciled: !!r.is_reconciled,
        all_branches: true
      }));
      return res.json(normalized);
    }
    const rows = await db.all(
      'SELECT * FROM daily_cash_summaries WHERE date >= ? AND date <= ? AND branch_id = ? ORDER BY date DESC',
      [start_date, end_date, branchId]
    );
    const businessToday = getBusinessTodayYmd();
    for (const r of rows || []) {
      if (r?.date && !r.is_reconciled && toSqlDateString(r.date) === businessToday) {
        scheduleBackgroundDailySummaryRefresh(r.date, branchId);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error fetching cash summary range:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.refreshUnreconciledDailySummary = refreshUnreconciledDailySummary;
module.exports.refreshUnreconciledSummariesFromDate = refreshUnreconciledSummariesFromDate;
module.exports.refreshDailySummaryForce = refreshDailySummaryForce;
module.exports.scheduleBackgroundDailySummaryRefresh = scheduleBackgroundDailySummaryRefresh;
