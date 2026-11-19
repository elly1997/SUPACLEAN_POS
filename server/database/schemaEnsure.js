/**
 * Guard + sequential runner for boot-time schema routines (server/database/ensure*.js).
 *
 * Long-running servers (local dev, Render) run them on every boot. On a
 * serverless runtime (Vercel) a cold start would otherwise fire every routine
 * concurrently at PostgreSQL, exhausting the connection pool and timing out the
 * very request that triggered the cold start, so they are skipped there.
 *
 * Force them on with RUN_SCHEMA_ENSURE=1 (useful for a brand new database) or
 * off with RUN_SCHEMA_ENSURE=0.
 *
 * Neon/Supabase session poolers often cap at ~15 clients. Requiring every
 * ensure*.js at once used to stampede that limit (EMAXCONNSESSION). The runner
 * below loads modules with SCHEMA_ENSURE_CONTROLLED=1 and awaits each ensure()
 * one at a time.
 */

const path = require('path');
const { agentDebugLog } = require('../utils/agentDebugLog');

function shouldRunSchemaEnsure() {
  if (process.env.RUN_SCHEMA_ENSURE === '1') return true;
  if (process.env.RUN_SCHEMA_ENSURE === '0') return false;
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  return !isServerless;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve paths listed in server/index.js (e.g. './database/ensurePosCoreSchema')
 * from the server root — not from this file's directory.
 */
function resolveFromServerRoot(modulePath) {
  if (path.isAbsolute(modulePath)) return modulePath;
  return path.resolve(__dirname, '..', modulePath);
}

/**
 * @param {string[]} modulePaths - require paths relative to server/index.js (e.g. './database/ensurePosCoreSchema')
 * @param {{ staggerMs?: number }} [options]
 */
async function runSchemaEnsureModules(modulePaths, options = {}) {
  const staggerMs = Number.isFinite(options.staggerMs)
    ? options.staggerMs
    : parseInt(process.env.SCHEMA_ENSURE_STAGGER_MS || '50', 10) || 50;

  // Suppress auto-run IIFEs / bare ensure() on require; we await explicitly.
  process.env.SCHEMA_ENSURE_CONTROLLED = '1';

  // #region agent log
  agentDebugLog({
    hypothesisId: 'A',
    location: 'schemaEnsure.js:runSchemaEnsureModules',
    message: 'schema ensure runner start',
    data: { count: modulePaths.length, staggerMs },
  });
  // #endregion

  let ok = 0;
  let failed = 0;
  for (const modulePath of modulePaths) {
    try {
      const absolutePath = resolveFromServerRoot(modulePath);
      delete require.cache[absolutePath];
      delete require.cache[`${absolutePath}.js`];
      const mod = require(absolutePath);
      if (mod && typeof mod.ensure === 'function') {
        await mod.ensure();
        ok += 1;
        // #region agent log
        agentDebugLog({
          hypothesisId: 'A',
          location: 'schemaEnsure.js:module-ok',
          message: 'schema ensure module ok',
          data: { modulePath, hasEnsure: true },
        });
        // #endregion
      } else {
        failed += 1;
        console.warn(`Schema ensure module missing ensure(): ${modulePath}`);
        // #region agent log
        agentDebugLog({
          hypothesisId: 'A',
          location: 'schemaEnsure.js:module-missing-ensure',
          message: 'schema ensure module missing ensure()',
          data: { modulePath },
        });
        // #endregion
      }
    } catch (err) {
      failed += 1;
      console.error(`Schema ensure failed to load: ${modulePath}`, err.message);
      // #region agent log
      agentDebugLog({
        hypothesisId: 'A',
        location: 'schemaEnsure.js:module-fail',
        message: 'schema ensure module failed',
        data: { modulePath, error: String(err && err.message), code: err && err.code },
      });
      // #endregion
    }
    if (staggerMs > 0) await delay(staggerMs);
  }

  // #region agent log
  agentDebugLog({
    hypothesisId: 'A',
    location: 'schemaEnsure.js:runner-done',
    message: 'schema ensure runner done',
    data: { ok, failed, total: modulePaths.length },
  });
  // #endregion
}

module.exports = { shouldRunSchemaEnsure, runSchemaEnsureModules };
