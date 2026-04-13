/**
 * Business calendar (timezone) for POS: prevents future-dated sales/expenses/cash actions
 * that skew reports. Override with ALLOW_FUTURE_BUSINESS_DATES=true for rare maintenance.
 */
const DEFAULT_TZ = process.env.BUSINESS_TIMEZONE || 'Africa/Dar_es_Salaam';

function partsYmdInTz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function getBusinessTodayYmd() {
  return partsYmdInTz(new Date(), DEFAULT_TZ);
}

/** Calendar day in business TZ for an instant (e.g. order_date). */
function getBusinessYmdForInstant(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  return partsYmdInTz(d, DEFAULT_TZ);
}

function allowFutureDates() {
  return process.env.ALLOW_FUTURE_BUSINESS_DATES === 'true' || process.env.ALLOW_FUTURE_BUSINESS_DATES === '1';
}

/**
 * @param {string|Date} input - YYYY-MM-DD string, or Date / parseable ISO for an instant
 * @returns {boolean} false if validation failed (response already sent)
 */
function assertNotFutureBusinessDate(input, res, fieldName = 'date') {
  if (allowFutureDates()) return true;
  let ymd;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    ymd = input.trim();
  } else {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: `Invalid ${fieldName}` });
      return false;
    }
    ymd = getBusinessYmdForInstant(d);
  }
  if (!ymd) {
    res.status(400).json({ error: `Invalid ${fieldName}` });
    return false;
  }
  const today = getBusinessTodayYmd();
  if (ymd > today) {
    res.status(400).json({
      error: `${fieldName} cannot be after today (${today} — business calendar).`
    });
    return false;
  }
  return true;
}

module.exports = {
  DEFAULT_TZ,
  getBusinessTodayYmd,
  getBusinessYmdForInstant,
  assertNotFutureBusinessDate,
  allowFutureDates
};
