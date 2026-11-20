/**
 * Shared reconciled-day lock checks for orders, expenses, and bank deposits.
 */
const db = require('../database/query');
const { getBusinessTodayYmd, toSqlDateString } = require('./businessDate');
const { isReconciledFlag } = require('./dailyClosingReport');

async function isReconciledDay(date, branchId) {
  const ymd = toSqlDateString(date);
  if (!ymd || branchId == null || branchId === '') return false;
  const row = await db.get(
    'SELECT is_reconciled FROM daily_cash_summaries WHERE date = ? AND branch_id = ?',
    [ymd, branchId]
  );
  return !!(row && isReconciledFlag(row.is_reconciled));
}

/**
 * Reject writes onto a locked (reconciled) day unless the caller acknowledges.
 * @returns {Promise<boolean>} false if response already sent
 */
async function assertWritableBusinessDay(date, branchId, res, opts = {}) {
  const ymd = toSqlDateString(date);
  if (!ymd) {
    res.status(400).json({ error: `Invalid ${opts.fieldName || 'date'}` });
    return false;
  }
  if (!(await isReconciledDay(ymd, branchId))) return true;
  if (opts.acknowledge === true) return true;
  res.status(409).json({
    error:
      opts.errorMessage ||
      'This date is already reconciled. Unreconcile it (admin) or pick an unreconciled day to record catch-up work.',
    code: 'reconciled_day',
    date: ymd,
  });
  return false;
}

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Workable days for a branch:
 * - today (always, unless somehow reconciled — then omitted)
 * - every unreconciled daily_cash_summaries row for the branch
 * - recent calendar days with no summary (still open for catch-up)
 */
async function listWorkableBusinessDays(branchId, lookbackDays = 45) {
  const today = getBusinessTodayYmd();
  const lookback = Math.min(Math.max(Number(lookbackDays) || 45, 1), 90);
  const start = addDaysYmd(today, -lookback);

  if (branchId == null || branchId === '') {
    return { today, lookback_days: lookback, days: [{ date: today, is_today: true, has_summary: false, is_reconciled: false }] };
  }

  const [rangeRows, openRows] = await Promise.all([
    db.all(
      `SELECT date::text AS date, is_reconciled
       FROM daily_cash_summaries
       WHERE branch_id = ?
         AND date >= ?::date
         AND date <= ?::date`,
      [branchId, start, today]
    ).catch(() => []),
    db.all(
      `SELECT date::text AS date, is_reconciled
       FROM daily_cash_summaries
       WHERE branch_id = ?
         AND COALESCE(is_reconciled, FALSE) = FALSE
         AND date <= ?::date
       ORDER BY date DESC
       LIMIT 120`,
      [branchId, today]
    ).catch(() => []),
  ]);

  const byDate = new Map();
  for (const row of [...(rangeRows || []), ...(openRows || [])]) {
    const key = toSqlDateString(row.date);
    if (!key || key > today) continue;
    byDate.set(key, row);
  }

  // Ensure recent calendar days exist as candidates (missing summary = open).
  for (let i = 0; i <= lookback; i++) {
    const date = addDaysYmd(today, -i);
    if (!byDate.has(date)) byDate.set(date, null);
  }

  const days = [];
  const sorted = [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  for (const date of sorted) {
    const row = byDate.get(date);
    const reconciled = !!(row && isReconciledFlag(row.is_reconciled));
    if (reconciled) continue;
    days.push({
      date,
      is_today: date === today,
      has_summary: !!row,
      is_reconciled: false,
    });
  }

  return { today, lookback_days: lookback, days };
}

module.exports = {
  isReconciledDay,
  assertWritableBusinessDay,
  listWorkableBusinessDays,
  addDaysYmd,
};
