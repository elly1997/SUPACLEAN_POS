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
 * Calendar days from (today - lookback) .. today that are still writable (not reconciled).
 * Days with no daily_cash_summaries row count as unreconciled.
 */
async function listWorkableBusinessDays(branchId, lookbackDays = 14) {
  const today = getBusinessTodayYmd();
  const lookback = Math.min(Math.max(Number(lookbackDays) || 14, 1), 60);
  const start = addDaysYmd(today, -lookback);

  const rows =
    branchId == null || branchId === ''
      ? []
      : await db.all(
          `SELECT date::text AS date, is_reconciled
           FROM daily_cash_summaries
           WHERE branch_id = ?
             AND date >= ?::date
             AND date <= ?::date`,
          [branchId, start, today]
        ).catch(() => []);

  const byDate = new Map();
  for (const row of rows || []) {
    const key = toSqlDateString(row.date);
    if (key) byDate.set(key, row);
  }

  const days = [];
  for (let i = 0; i <= lookback; i++) {
    const date = addDaysYmd(today, -i);
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
