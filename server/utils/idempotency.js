/**
 * Idempotency store for mutation endpoints (offline replay / timeout retries).
 */
const db = require('../database/query');

const TTL_HOURS = 24;

function readIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

async function pruneExpiredIdempotencyKeys() {
  await db.run(
    `DELETE FROM idempotency_keys WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${TTL_HOURS} hours'`,
    []
  );
}

async function getStoredIdempotencyResponse(route, idempotencyKey) {
  if (!idempotencyKey) return null;
  const row = await db.get(
    `SELECT response_status, response_body FROM idempotency_keys
     WHERE idempotency_key = ? AND route = ?
     AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${TTL_HOURS} hours'`,
    [idempotencyKey, route]
  );
  if (!row) return null;
  let body = row.response_body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = row.response_body;
    }
  }
  return { status: Number(row.response_status) || 200, body };
}

async function storeIdempotencyResponse(route, idempotencyKey, status, body) {
  if (!idempotencyKey) return;
  const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  await db.run(
    `INSERT INTO idempotency_keys (idempotency_key, route, response_status, response_body)
     VALUES (?, ?, ?, ?::jsonb)
     ON CONFLICT (idempotency_key, route) DO UPDATE SET
       response_status = EXCLUDED.response_status,
       response_body = EXCLUDED.response_body,
       created_at = CURRENT_TIMESTAMP`,
    [idempotencyKey, route, status, payload]
  );
}

module.exports = {
  readIdempotencyKey,
  pruneExpiredIdempotencyKeys,
  getStoredIdempotencyResponse,
  storeIdempotencyResponse,
};
