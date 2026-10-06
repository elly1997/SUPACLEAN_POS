/**
 * Short-lived per-token session cache.
 * Each login stays independent (keyed by its own token) while repeated API
 * calls from the same screen skip the session JOIN that was saturating the
 * database when every cashier was signed in.
 */
const TTL_MS = 20_000;
const MAX_ENTRIES = 400;

const byToken = new Map();

function prune(now = Date.now()) {
  if (byToken.size <= MAX_ENTRIES) return;
  for (const [token, entry] of byToken) {
    if (entry.expires <= now) byToken.delete(token);
  }
  if (byToken.size <= MAX_ENTRIES) return;
  const overflow = byToken.size - MAX_ENTRIES;
  let dropped = 0;
  for (const token of byToken.keys()) {
    byToken.delete(token);
    dropped += 1;
    if (dropped >= overflow) break;
  }
}

function get(token) {
  if (!token) return null;
  const entry = byToken.get(token);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    byToken.delete(token);
    return null;
  }
  return entry.value;
}

function set(token, value) {
  if (!token || !value) return;
  byToken.set(token, { expires: Date.now() + TTL_MS, value });
  prune();
}

function invalidate(token) {
  if (token) byToken.delete(token);
}

function invalidateUser(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return;
  for (const [token, entry] of byToken) {
    if (Number(entry.value?.user?.id) === id) byToken.delete(token);
  }
}

module.exports = {
  get,
  set,
  invalidate,
  invalidateUser,
};
