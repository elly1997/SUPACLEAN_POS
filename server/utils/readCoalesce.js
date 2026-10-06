/**
 * Collapse identical reads that arrive together (many POS screens polling
 * the same branch) into one database query, and reuse that result briefly.
 */
const inflight = new Map();
const stored = new Map();
const MAX_STORED = 300;

function pruneStored(now = Date.now()) {
  if (stored.size <= MAX_STORED) return;
  for (const [key, entry] of stored) {
    if (entry.expires <= now) stored.delete(key);
  }
}

function coalesceRead(key, ttlMs, loader) {
  const now = Date.now();
  const hit = stored.get(key);
  if (hit && hit.expires > now) {
    return Promise.resolve(hit.value);
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const pendingLoad = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (ttlMs > 0) {
        stored.set(key, { value, expires: Date.now() + ttlMs });
        pruneStored();
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, pendingLoad);
  return pendingLoad;
}

module.exports = { coalesceRead };
