/**
 * PostgreSQL Query Helper Functions
 * Provides wrapper functions that convert SQLite-style queries to PostgreSQL
 * This allows gradual migration from SQLite callback pattern to PostgreSQL promises
 */

const { Pool } = require('pg');
require('dotenv').config();

// Pool size: Neon/Supabase session mode often caps at ~15 total clients for the
// project. Stay well under that so boot schema + live traffic do not hit
// EMAXCONNSESSION. Override with DATABASE_POOL_MAX (1–15 recommended).
const poolMax = (() => {
  const n = parseInt(process.env.DATABASE_POOL_MAX || '', 10);
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  return 8;
})();

// Create PostgreSQL connection pool
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL for all connections
  ssl: process.env.DATABASE_URL?.includes('supabase') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false } 
    : false,
  max: poolMax,
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  // Generous connect timeout: managed Postgres (Neon/Supabase) can be slow to
  // accept the first connection when the compute has scaled down to zero.
  connectionTimeoutMillis: 30000,
});

// Log first pool connection only (each schema module triggers its own query on startup).
let loggedPoolConnect = false;
dbPool.on('connect', (client) => {
  // Release a stuck query so one slow screen cannot hold a pool slot forever.
  client.query('SET statement_timeout = 25000').catch(() => {});
  if (loggedPoolConnect) return;
  loggedPoolConnect = true;
  console.log('OK:  Connected to PostgreSQL database');
});

dbPool.on('error', (err) => {
  console.error('ERROR:  Unexpected error on idle PostgreSQL client', err);
  // Keep API process alive on transient pool/client faults.
  // Individual queries will still fail fast and surface meaningful errors.
  // #region agent log
  try {
    const { agentDebugLog } = require('../utils/agentDebugLog');
    agentDebugLog({
      hypothesisId: 'B',
      location: 'query.js:pool-error',
      message: 'postgres pool idle client error',
      data: {
        error: String(err && err.message),
        code: err && err.code,
        totalCount: dbPool.totalCount,
        idleCount: dbPool.idleCount,
        waitingCount: dbPool.waitingCount,
      },
    });
  } catch (_) { /* ignore */ }
  // #endregion
});

/**
 * Convert SQLite query (with ? placeholders) to PostgreSQL ($1, $2, etc.)
 * @param {string} query - SQL query with ? placeholders
 * @param {Array} params - Array of parameters
 * @returns {Object} { query: converted query, params: params array }
 */
function convertQuery(query, params = []) {
  let paramIndex = 1;
  const convertedQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
  return { query: convertedQuery, params };
}

/**
 * Execute query and return all rows (replaces db.all)
 * @param {string} sql - SQL query
 * @param {Array} params - Parameters
 * @returns {Promise<Array>} Rows array
 */
function all(sql, params = []) {
  const { query, params: convertedParams } = convertQuery(sql, params);
  return dbPool.query(query, convertedParams)
    .then(result => result.rows)
    .catch(err => {
      console.error('Database query error (all):', err);
      throw err;
    });
}

/**
 * Execute query and return first row (replaces db.get)
 * @param {string} sql - SQL query
 * @param {Array} params - Parameters
 * @returns {Promise<Object|null>} First row or null
 */
function get(sql, params = []) {
  const { query, params: convertedParams } = convertQuery(sql, params);
  return dbPool.query(query, convertedParams)
    .then(result => result.rows[0] || null)
    .catch(err => {
      console.error('Database query error (get):', err);
      throw err;
    });
}

/**
 * Execute query (replaces db.run for INSERT/UPDATE/DELETE)
 * @param {string} sql - SQL query
 * @param {Array} params - Parameters
 * @returns {Promise<Object>} Result with lastID, changes, row
 */
function run(sql, params = []) {
  const { query, params: convertedParams } = convertQuery(sql, params);
  return dbPool.query(query, convertedParams)
    .then(result => {
      // For INSERT, try to get the ID from RETURNING clause or result.rows[0]
      let lastID = null;
      if (result.rows && result.rows.length > 0 && result.rows[0].id) {
        lastID = result.rows[0].id;
      } else if (result.rows && result.rows.length > 0) {
        // Try common ID column names
        const firstRow = result.rows[0];
        lastID = firstRow.id || firstRow.ID || null;
      }
      
      return {
        lastID: lastID,
        changes: result.rowCount || 0,
        row: result.rows[0] || null
      };
    })
    .catch(err => {
      console.error('Database query error (run):', err);
      // #region agent log
      if (String(err && err.message || '').includes('EMAXCONNSESSION') || err?.code === 'XX000') {
        try {
          const { agentDebugLog } = require('../utils/agentDebugLog');
          agentDebugLog({
            hypothesisId: 'B',
            location: 'query.js:run-emax',
            message: 'EMAXCONNSESSION or XX000 on db.run',
            data: {
              error: String(err && err.message),
              code: err && err.code,
              totalCount: dbPool.totalCount,
              idleCount: dbPool.idleCount,
              waitingCount: dbPool.waitingCount,
              sqlPreview: String(sql || '').slice(0, 80),
            },
          });
        } catch (_) { /* ignore */ }
      }
      // #endregion
      throw err;
    });
}

/**
 * Execute a raw query (advanced use)
 * @param {string} sql - SQL query (can use $1, $2, etc. directly)
 * @param {Array} params - Parameters
 * @returns {Promise<Object>} Query result
 */
function query(sql, params = []) {
  return dbPool.query(sql, params)
    .catch(err => {
      console.error('Database query error (query):', err);
      throw err;
    });
}

/**
 * Get the pool instance (for advanced use)
 * @returns {Pool} PostgreSQL pool instance
 */
function getPool() {
  return dbPool;
}

module.exports = {
  all,
  get,
  run,
  query,
  getPool,
  convertQuery,
  pool: dbPool
};
