const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getEffectiveBranchId } = require('../utils/branchFilter');
const { sqlOperatingExpensesOnly } = require('../utils/operatingExpenses');

// All cash-management routes require branch feature 'cash_management' (admin bypasses)
router.use(authenticate, requireBranchFeature('cash_management'));

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

async function getExpectedOpeningBalance(date, branchId) {
  const row = await db.get(
    `SELECT closing_balance
     FROM daily_cash_summaries
     WHERE date < ? AND branch_id = ?
     ORDER BY date DESC
     LIMIT 1`,
    [date, branchId]
  );
  return row ? num(row.closing_balance) : 0;
}

async function upsertDailySummaryFromComputed(date, branchId, computed, notes = null, force = false) {
  const existing = await db.get(
    'SELECT id, is_reconciled, notes FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [date, branchId]
  );

  // Never overwrite reconciled rows automatically unless force=true (payment backdate correction).
  if (!force && existing && existing.is_reconciled) {
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
      WHERE id = ?`,
      [
        payload.opening_balance,
        payload.opening_cash_declared,
        payload.opening_variance,
        payload.cash_sales,
        payload.book_sales,
        payload.card_sales,
        payload.mobile_money_sales,
        payload.bank_deposits,
        payload.bank_payments,
        payload.mpesa_received,
        payload.mpesa_paid,
        payload.expenses_from_cash,
        payload.expenses_from_bank,
        payload.expenses_from_mpesa,
        payload.cash_in_hand,
        payload.closing_balance,
        notes != null ? notes : existing.notes || null,
        existing.id
      ]
    );
    return db.get('SELECT * FROM daily_cash_summaries WHERE id = ?', [existing.id]);
  }

  await db.run(
    `INSERT INTO daily_cash_summaries (
      date, branch_id, opening_balance, opening_cash_declared, opening_variance, cash_sales, book_sales, card_sales, mobile_money_sales,
      bank_deposits, bank_payments, mpesa_received, mpesa_paid,
      expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
      cash_in_hand, closing_balance, notes, is_reconciled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
    [
      date,
      branchId,
      payload.opening_balance,
      payload.opening_cash_declared,
      payload.opening_variance,
      payload.cash_sales,
      payload.book_sales,
      payload.card_sales,
      payload.mobile_money_sales,
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

  return db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
}

/**
 * Build daily cash summary from source data (orders, transactions, expenses, deposits) and persist.
 * Used when the day has no row yet, or exists but is not reconciled (so expenses/backfills update totals).
 */
async function computeAndPersistDailySummary(date, branchId, force = false) {
  const openingBalance = await getExpectedOpeningBalance(date, branchId);
  const existingRow = await db.get(
    'SELECT opening_cash_declared FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [date, branchId]
  );

  const cashSalesRow = await db.all(`
    SELECT SUM(paid_amount) as cash_sales
    FROM orders
    WHERE DATE(order_date) = ?
    AND payment_status = 'paid_full'
    AND payment_method = 'cash'
    AND paid_amount > 0
    AND branch_id = ?
  `, [date, branchId]);
  const cashSales = num(cashSalesRow[0]?.cash_sales);

  const { calculateBookSales } = require('../utils/cashValidation');
  let bookSales = 0;
  try {
    bookSales = await calculateBookSales(date, branchId);
  } catch (err) {
    console.error('Error calculating book sales for daily summary:', err);
  }

  const calculated = await calculateRemaining(
    date,
    openingBalance,
    cashSales,
    bookSales,
    branchId,
    existingRow?.opening_cash_declared
  );
  return upsertDailySummaryFromComputed(date, branchId, calculated, null, force);
}

/**
 * Recalculate and save daily summary for a date unless that day is already reconciled (audit lock).
 * Call after expense create/update/delete so backdated expenses flow into the correct day.
 * @returns {Promise<{ skipped: boolean, reason?: string, row?: object }>}
 */
async function refreshUnreconciledDailySummary(date, branchId) {
  const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
  if (row && row.is_reconciled) {
    return { skipped: true, reason: 'reconciled', row };
  }
  const persisted = await computeAndPersistDailySummary(date, branchId);
  return { skipped: false, row: persisted };
}

/**
 * Force-refresh a day even when reconciled (used for explicitly backdated payment booking).
 * This keeps selected paid date totals/book-sales/closing in sync with transactions.
 */
async function refreshDailySummaryForce(date, branchId) {
  const persisted = await computeAndPersistDailySummary(date, branchId, true);
  return { forced: true, row: persisted };
}

/**
 * After a backdated expense (or any change to an earlier day), recompute this day and every
 * later unreconciled day so opening/closing chains stay correct on Pending reconciliations.
 */
async function refreshUnreconciledSummariesFromDate(branchId, startDate) {
  const day = String(startDate || '').trim().slice(0, 10);
  if (branchId == null || !day || day.length < 10) {
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
    if (r?.d) unique.add(String(r.d).slice(0, 10));
  }
  const sorted = [...unique].sort();
  let expenseDayRefresh = null;
  for (const d of sorted) {
    const res = await refreshUnreconciledDailySummary(d, branchId);
    if (d === day) expenseDayRefresh = res;
  }
  return { expenseDayRefresh: expenseDayRefresh || { skipped: false }, daysRefreshed: sorted.length };
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
  try {
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    const force = !!(row && row.is_reconciled);
    const persisted = await computeAndPersistDailySummary(date, branchId, force);
    return res.json(persisted);
  } catch (err) {
    console.error('Error fetching daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Recalculate daily closing from live data. Use body.force / query force=1 to update reconciled days (recomputes sales/closing; keeps reconciliation lock).
router.post('/daily/recalculate/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to recalculate daily closing' });
  }
  const force = req.body?.force === true || req.query?.force === '1' || req.query?.force === 'true';
  try {
    if (force) {
      const out = await refreshDailySummaryForce(date, branchId);
      return res.json(out.row);
    }
    const result = await refreshUnreconciledDailySummary(date, branchId);
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

// Record opening session cash declaration and compare with previous closing balance.
router.post('/opening-session/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const openingCash = parseFloat(req.body?.opening_cash);
  const notes = req.body?.notes || null;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to start opening session' });
  }
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return res.status(400).json({ error: 'opening_cash must be a valid non-negative number' });
  }
  try {
    const existing = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    if (existing?.is_reconciled) {
      return res.status(409).json({ error: 'This day is already reconciled and cannot be changed.' });
    }
    const expectedOpening = await getExpectedOpeningBalance(date, branchId);
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
        [date, branchId, expectedOpening, openingCash, openingVariance, req.user?.fullName || req.user?.username || 'Cashier', notes]
      );
    }
    // Recompute today's rolling values using declared opening cash
    await refreshUnreconciledDailySummary(date, branchId);
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
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
  const today = new Date().toISOString().split('T')[0];
  const isAdminAllBranches = req.user?.role === 'admin' && (branchId == null || branchId === '');

  if (!isAdminAllBranches && branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash management' });
  }

  if (isAdminAllBranches) {
    try {
      const branchRows = await db.all('SELECT id FROM branches ORDER BY id');
      const branchIds = (branchRows || []).map((r) => r.id);
      if (branchIds.length === 0) {
        return res.json(emptyDailySummary(today, true));
      }
      const results = [];
      for (const bid of branchIds) {
        const openingBalance = await getExpectedOpeningBalance(today, bid);
        const existingToday = await db.get(
          'SELECT opening_cash_declared, is_reconciled FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
          [today, bid]
        );
        const cashSalesRow = await db.all(`
          SELECT SUM(paid_amount) as cash_sales FROM orders
          WHERE DATE(order_date) = ? AND payment_status = 'paid_full' AND payment_method = 'cash' AND paid_amount > 0 AND branch_id = ?
        `, [today, bid]);
    const cashSales = num(cashSalesRow[0]?.cash_sales);
        const { calculateBookSales } = require('../utils/cashValidation');
        let bookSales = 0;
        try {
          bookSales = await calculateBookSales(today, bid);
        } catch (err) {
          bookSales = 0;
        }
        const result = await calculateRemaining(today, openingBalance, cashSales, bookSales, bid, existingToday?.opening_cash_declared);
        const force = !!(existingToday && existingToday.is_reconciled);
        const persisted = await upsertDailySummaryFromComputed(today, bid, result, null, force);
        results.push(persisted || result);
      }
      const consolidated = consolidateSummaries(results, today);
      consolidated.all_branches = true;
      return res.json(consolidated);
    } catch (err) {
      console.error('Error calculating consolidated today summary:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const openingBalance = await getExpectedOpeningBalance(today, branchId);
    const existingToday = await db.get(
      'SELECT opening_cash_declared, is_reconciled FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
      [today, branchId]
    );
    const cashSalesRow = await db.all(`
      SELECT SUM(paid_amount) as cash_sales
      FROM orders
      WHERE DATE(order_date) = ?
      AND payment_status = 'paid_full'
      AND payment_method = 'cash'
      AND paid_amount > 0
      AND branch_id = ?
    `, [today, branchId]);
        const cashSales = num(cashSalesRow[0]?.cash_sales);
    const { calculateBookSales } = require('../utils/cashValidation');
    let bookSales = 0;
    try {
      bookSales = await calculateBookSales(today, branchId);
    } catch (err) {
      console.error('Error calculating book sales:', err);
      bookSales = 0;
    }
    const result = await calculateRemaining(today, openingBalance, cashSales, bookSales, branchId, existingToday?.opening_cash_declared);
    const force = !!(existingToday && existingToday.is_reconciled);
    const persisted = await upsertDailySummaryFromComputed(today, branchId, result, null, force);
    res.json(persisted || result);
  } catch (err) {
    console.error('Error calculating today\'s cash summary:', err);
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

async function calculateRemaining(date, openingBalance, cashSales, bookSales, branchId, declaredOpeningCash = null) {
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
  
  // Calculate bank deposits
  const depositsRow = await db.get('SELECT COALESCE(SUM(amount), 0) as total FROM bank_deposits WHERE date = ? AND branch_id = ?', [date, branchId]);
  
  const bankDeposits = num(depositsRow?.total);
  
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
  const today = date || new Date().toISOString().split('T')[0];
  
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
    `, [today, branchId]);
    
    const cashSales = num(cashSalesRow[0]?.cash_sales);
    
    // Book sales = cash received from receive-payment / collection (daily sales report)
    const { calculateBookSales } = require('../utils/cashValidation');
    let bookSales = 0;
    try {
      bookSales = await calculateBookSales(today, branchId);
    } catch (err) {
      console.error('Error calculating book sales:', err);
      bookSales = 0;
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
         bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
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
          bank_deposits, bank_payments, mpesa_received, mpesa_paid,
          expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
          cash_in_hand, closing_balance, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [today, branchId, openingBalance, declaredOpening, openingVariance, cashSales, bookSales, cardSales, mobileMoneySales,
         bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
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
router.post('/reconcile/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const { reconciled_by } = req.body;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to reconcile' });
  }
  try {
    // Always refresh from source data right before locking to ensure closing balance is correct.
    const refresh = await refreshUnreconciledDailySummary(date, branchId);
    let row = refresh.row || await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    if (!row) return res.status(404).json({ error: 'Daily summary not found' });
    if (refresh.skipped) {
      return res.status(409).json({ error: 'This date is already reconciled and cannot be reconciled again.', row });
    }
    
    const result = await db.run(
      `UPDATE daily_cash_summaries 
       SET is_reconciled = TRUE, reconciled_by = ?, reconciled_at = CURRENT_TIMESTAMP
       WHERE date = ? AND branch_id = ?`,
      [reconciled_by || 'Cashier', date, branchId]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Daily summary not found' });
    }

    row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    const branchRow = await db.get('SELECT name FROM branches WHERE id = ?', [branchId]);
    const branchName = branchRow?.name || `Branch ${branchId}`;

    // Daily Closing Report (SUPACLEAN format) – send to director WhatsApp (or return for manual send)
    let reportSent = false;
    let reportText = null;
    let directorPhoneForWa = null;
    try {
      const settingsRows = await db.all('SELECT setting_key, setting_value FROM settings WHERE setting_key = ?', ['manager_whatsapp_number']);
      const directorPhone = (settingsRows && settingsRows[0] && settingsRows[0].setting_value) ? settingsRows[0].setting_value.trim() : null;
      if (!directorPhone) {
        console.warn('Reconcile: No director WhatsApp number in settings – daily report not sent.');
      } else {
        const opening = parseFloat(row.opening_balance) || 0;
        const openingDeclared = row.opening_cash_declared != null ? parseFloat(row.opening_cash_declared) : opening;
        const openingVariance = parseFloat(row.opening_variance || 0);
        const openingShortage = openingVariance < 0 ? Math.abs(openingVariance) : 0;
        const openingOverage = openingVariance > 0 ? openingVariance : 0;
        const cashSales = parseFloat(row.cash_sales) || 0;
        const bookSales = parseFloat(row.book_sales) || 0;
        const cardSales = parseFloat(row.card_sales) || 0;
        const mobileSales = parseFloat(row.mobile_money_sales) || 0;
        const totalSales = cashSales + bookSales + cardSales + mobileSales;
        const expensesCash = parseFloat(row.expenses_from_cash) || 0;
        const expensesBank = parseFloat(row.expenses_from_bank) || 0;
        const expensesMpesa = parseFloat(row.expenses_from_mpesa) || 0;
        const totalExpenses = expensesCash + expensesBank + expensesMpesa;
        const bankDepositsDay = parseFloat(row.bank_deposits) || 0;
        const closing = parseFloat(row.closing_balance) || 0;
        // Cash drawer: operating cash expenses + cash banked (deposits), not double-counted in totalExpenses.
        const cashOutDrawer = expensesCash + bankDepositsDay;
        const expectedCash = opening + cashSales + bookSales - cashOutDrawer;
        const actualCash = openingDeclared + cashSales + bookSales - cashOutDrawer;
        const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const cashierName = reconciled_by || 'Cashier';

        // P&L: Revenue = total sales; discounts/COGS from schema if available, else 0
        const revenue = totalSales;
        const discounts = 0;
        const costOfGoods = 0;
        const grossProfit = revenue - discounts - costOfGoods;
        const operatingExpenses = totalExpenses;
        const netProfit = grossProfit - operatingExpenses;
        const adjustedNetProfit = netProfit - openingShortage;

        const fmt = (n) => Number(n).toLocaleString();
        const report = [
          '*SUPACLEAN*',
          '*Daily Closing Report*',
          '━━━━━━━━━━━━━━━━',
          `📅 ${dateFormatted}`,
          `👤 Cashier: ${cashierName}`,
          '',
          '💰 *OPENING CASH*',
          `Expected (Prev Closing): TZS ${fmt(opening)}`,
          `Declared (Session Start): TZS ${fmt(openingDeclared)}`,
          `Variance: ${openingVariance < 0 ? '-' : '+'}TZS ${fmt(Math.abs(openingVariance))}`,
          '',
          '📈 *SALES BREAKDOWN*',
          `• Cash Sales: TZS ${fmt(cashSales)}`,
          `• M-Pesa: TZS ${fmt(mobileSales)}`,
          `• Bank: TZS ${fmt(cardSales)}`,
          `• Credit Sales: TZS ${fmt(0)}`,
          `*Total Sales: TZS ${fmt(totalSales)}*`,
          '',
          '📥 *CREDIT COLLECTIONS*',
          `Received Today: TZS ${fmt(bookSales)}`,
          '',
          '📤 *OUTFLOWS*',
          `• Operating expenses: TZS ${fmt(totalExpenses)}`,
          `• Bank deposits (cash to bank, not P&L): TZS ${fmt(bankDepositsDay)}`,
          `• Stock Purchases: TZS 0`,
          '',
          '📊 *PROFIT & LOSS*',
          `• Revenue: TZS ${fmt(revenue)}`,
          `• Less Discounts: (TZS ${fmt(discounts)})`,
          `• Cost of Goods: (TZS ${fmt(costOfGoods)})`,
          `• *Gross Profit: TZS ${fmt(grossProfit)}*`,
          `• Operating Expenses: (TZS ${fmt(operatingExpenses)})`,
          `• Opening Shortage Loss: (TZS ${fmt(openingShortage)})`,
          openingOverage > 0 ? `• Opening Overage: +TZS ${fmt(openingOverage)}` : null,
          `*💰 NET PROFIT (Adjusted): TZS ${fmt(adjustedNetProfit)}*`,
          '',
          '💵 *CASH POSITION*',
          `Opening (Expected): TZS ${fmt(opening)}`,
          `Opening (Declared): TZS ${fmt(openingDeclared)}`,
          `+ Cash Sales: TZS ${fmt(cashSales)}`,
          `+ Collections: TZS ${fmt(bookSales)}`,
          `- Cash expenses: TZS ${fmt(expensesCash)}`,
          `- Bank deposits: TZS ${fmt(bankDepositsDay)}`,
          `*Expected Cash: TZS ${fmt(expectedCash)}*`,
          `*Actual Cash: TZS ${fmt(actualCash)}*`,
          '━━━━━━━━━━━━━━━━',
          branchName ? `📍 ${branchName}` : ''
        ].filter(Boolean).join('\n');

        const { sendWhatsApp, formatPhoneNumber } = require('../utils/whatsapp');
        const waResult = await sendWhatsApp(directorPhone, report, {});
        reportSent = !!(waResult && waResult.success);
        if (!reportSent) {
          reportText = report;
          directorPhoneForWa = formatPhoneNumber(directorPhone).replace(/\D/g, '');
        }
      }
    } catch (waErr) {
      console.error('Reconcile: failed to send daily report WhatsApp:', waErr.message);
    }

    res.json({
      ...row,
      report_sent: reportSent,
      report_text: reportText || undefined,
      director_phone_wa: directorPhoneForWa || undefined
    });
  } catch (err) {
    console.error('Error reconciling daily cash:', err);
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

  try {
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
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
       SET is_reconciled = FALSE, reconciled_by = NULL, reconciled_at = NULL, notes = ?
       WHERE date = ? AND branch_id = ?`,
      [newNotes, date, branchId]
    );

    const chain = await refreshUnreconciledSummariesFromDate(branchId, date);
    const updated = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);

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
         ORDER BY dcs.date DESC, dcs.id DESC
         LIMIT ?`,
        [limit]
      );
      rows = await Promise.all((rows || []).map(async (r) => {
        const refreshed = await refreshUnreconciledDailySummary(r.date, r.branch_id);
        return refreshed.row ? { ...refreshed.row, branch_name: r.branch_name } : r;
      }));
      return res.json(rows || []);
    }

    let rows = await db.all(
      `SELECT dcs.*, b.name as branch_name
       FROM daily_cash_summaries dcs
       LEFT JOIN branches b ON b.id = dcs.branch_id
       WHERE COALESCE(dcs.is_reconciled, FALSE) = FALSE
       AND dcs.branch_id = ?
       ORDER BY dcs.date DESC, dcs.id DESC
       LIMIT ?`,
      [branchId, limit]
    );
    rows = await Promise.all((rows || []).map(async (r) => {
      const refreshed = await refreshUnreconciledDailySummary(r.date, branchId);
      return refreshed.row ? { ...refreshed.row, branch_name: r.branch_name } : r;
    }));
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
        bank_deposits: r.bank_deposits,
        expenses_from_cash: r.expenses_from_cash,
        closing_balance: r.closing_balance,
        is_reconciled: !!r.is_reconciled,
        all_branches: true
      }));
      return res.json(normalized);
    }
    let rows = await db.all(
      'SELECT * FROM daily_cash_summaries WHERE date >= ? AND date <= ? AND branch_id = ? ORDER BY date DESC',
      [start_date, end_date, branchId]
    );
    rows = await Promise.all((rows || []).map(async (r) => {
      if (r?.is_reconciled) {
        const out = await refreshDailySummaryForce(r.date, branchId);
        return out.row || r;
      }
      const refreshed = await refreshUnreconciledDailySummary(r.date, branchId);
      return refreshed.row || r;
    }));
    res.json(rows);
  } catch (err) {
    console.error('Error fetching cash summary range:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.refreshUnreconciledDailySummary = refreshUnreconciledDailySummary;
module.exports.refreshUnreconciledSummariesFromDate = refreshUnreconciledSummariesFromDate;
module.exports.refreshDailySummaryForce = refreshDailySummaryForce;
