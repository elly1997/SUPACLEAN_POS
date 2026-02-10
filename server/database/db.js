/**
 * Single database entry point: use PostgreSQL when DATABASE_URL is set (e.g. Render, Supabase),
 * otherwise SQLite for local development. This ensures production never touches SQLite.
 * When using PostgreSQL, get/all/run support optional callback as last arg (SQLite-style) for compatibility.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (process.env.DATABASE_URL) {
  console.log('📍 Using PostgreSQL (DATABASE_URL set)');
  const query = require('./query');
  const wrap = (fn) => function (sql, ...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const params = Array.isArray(args[0]) ? args[0] : args;
    const p = fn(sql, params);
    if (cb) {
      p.then((res) => cb(null, res)).catch((err) => cb(err, null));
      return;
    }
    return p;
  };
  const runCb = (fn) => function (sql, ...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const params = Array.isArray(args[0]) ? args[0] : args;
    const p = fn(sql, params);
    if (cb) {
      p.then((result) => {
        const ctx = { lastID: result?.row?.id ?? result?.lastID, changes: result?.changes ?? 0 };
        cb.call(ctx, null);
      }).catch((err) => cb.call({}, err));
      return;
    }
    return p;
  };
  module.exports = {
    ...query,
    get: wrap(query.get),
    all: wrap(query.all),
    run: runCb(query.run),
  };
} else {
  module.exports = require('./init');
}
