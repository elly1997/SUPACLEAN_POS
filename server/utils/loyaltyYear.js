/**
 * Yearly token counter (calendar year, Africa/Dar_es_Salaam, EAT = UTC+3).
 *
 * "Tokens this year" = tokens EARNED since 1 Jan 00:00 EAT (net of void reversals).
 * It is derived from loyalty_transactions, so it rolls back to 0 automatically when a
 * new year begins — no cron job or reset script, and the redeemable wallet balance
 * (current_points) and lifetime tier points are never touched.
 */
const EAT_OFFSET_HOURS = 3;

/** Current calendar year in EAT (e.g. 2026). */
function currentYearEat(now = new Date()) {
  return new Date(now.getTime() + EAT_OFFSET_HOURS * 3600 * 1000).getUTCFullYear();
}

/** UTC instant of 1 Jan 00:00 EAT for the given year, as an ISO string. */
function yearStartIso(year = currentYearEat()) {
  return new Date(Date.UTC(year, 0, 1, -EAT_OFFSET_HOURS, 0, 0)).toISOString();
}

/**
 * Scalar SQL subquery: tokens earned this year for the customer id expression
 * (e.g. 'c.id' or 'o.customer_id'). Safe to inline — value is generated, not user input.
 */
function sqlYearTokens(customerIdExpr) {
  const start = yearStartIso().replace('T', ' ').replace('Z', '+00');
  return `COALESCE((
    SELECT GREATEST(SUM(lt_y.points), 0)
    FROM loyalty_transactions lt_y
    WHERE lt_y.customer_id = ${customerIdExpr}
      AND lt_y.transaction_type IN ('earned', 'reversed')
      AND lt_y.created_at >= '${start}'
  ), 0)`;
}

async function getYearTokens(db, customerId) {
  const row = await db.get(`SELECT ${sqlYearTokens('?')} AS year_tokens`, [customerId]);
  return Math.max(0, Number(row?.year_tokens) || 0);
}

module.exports = { currentYearEat, yearStartIso, sqlYearTokens, getYearTokens };
