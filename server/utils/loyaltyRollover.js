/**
 * Yearly token reset.
 *
 * Every customer's token wallet (current_points), lifetime tokens and tier go back to
 * 0 / Bronze when a new calendar year (Africa/Dar_es_Salaam) begins. Each wallet with a
 * balance gets an 'expired' loyalty_transactions row so history stays auditable.
 *
 * Mechanism: loyalty_points.token_year records the year a wallet belongs to. The first
 * API request (or boot) in a new year resets all wallets whose token_year is older, in
 * ONE atomic statement, so it is safe on serverless / spun-down hosts (no cron needed)
 * and idempotent if several instances race.
 */
const db = require('../database/query');
const { currentYearEat } = require('./loyaltyYear');

let columnsReady = null;
let lastRolloverYear = null;
let inFlight = null;

/** Add token_year (defaults to the current year for existing + new rows) and redeem audit columns. */
function ensureLoyaltyYearColumns() {
  if (!columnsReady) {
    columnsReady = (async () => {
      await db.run(
        `ALTER TABLE loyalty_points ADD COLUMN IF NOT EXISTS token_year INTEGER
         DEFAULT (EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Africa/Dar_es_Salaam'))::int)`,
        []
      );
      await db.run('ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS redeem_purpose TEXT', []);
      await db.run('ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS value_tsh DOUBLE PRECISION', []);
    })().catch((err) => {
      columnsReady = null; // retry on next call
      throw err;
    });
  }
  return columnsReady;
}

/** Reset every wallet that still belongs to a previous year. Returns number of wallets reset. */
async function runYearRollover() {
  const year = currentYearEat();
  if (lastRolloverYear === year) return 0;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await ensureLoyaltyYearColumns();
    const description = `Tokens expired — yearly reset (1 Jan ${year})`;
    const result = await db.run(
      `WITH old AS (
         SELECT customer_id, COALESCE(current_points, 0) AS current_points
         FROM loyalty_points
         WHERE COALESCE(token_year, 0) < $1::int
         FOR UPDATE
       ), upd AS (
         UPDATE loyalty_points lp
         SET current_points = 0,
             lifetime_points = 0,
             tier = 'Bronze',
             token_year = $1::int,
             updated_at = CURRENT_TIMESTAMP
         FROM old
         WHERE lp.customer_id = old.customer_id
         RETURNING lp.customer_id, old.current_points AS expired_points
       )
       INSERT INTO loyalty_transactions
         (customer_id, order_id, transaction_type, points, description, balance_after)
       SELECT customer_id, NULL, 'expired', -expired_points, $2::text, 0
       FROM upd
       WHERE expired_points > 0`,
      [year, description]
    );
    lastRolloverYear = year;
    if (result.changes > 0) {
      console.log(`OK:  Loyalty yearly reset ${year}: ${result.changes} wallet(s) with tokens expired`);
    }
    return result.changes;
  })();

  return inFlight.finally(() => {
    inFlight = null;
  });
}

/** Express middleware: cheap in-memory check; triggers the reset on the first request of a new year. */
function loyaltyRolloverMiddleware(req, res, next) {
  if (!process.env.DATABASE_URL || lastRolloverYear === currentYearEat()) return next();
  runYearRollover()
    .catch((err) => console.error('Loyalty yearly rollover failed:', err.message))
    .finally(() => next());
}

module.exports = { ensureLoyaltyYearColumns, runYearRollover, loyaltyRolloverMiddleware };
