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
 * @param {string[]} modulePaths - require paths relative to server/index.js (e.g. './database/ensurePosCoreSchema')
 * @param {{ staggerMs?: number }} [options]
 */
async function runSchemaEnsureModules(modulePaths, options = {}) {
  const staggerMs = Number.isFinite(options.staggerMs)
    ? options.staggerMs
    : parseInt(process.env.SCHEMA_ENSURE_STAGGER_MS || '50', 10) || 50;

  // Suppress auto-run IIFEs / bare ensure() on require; we await explicitly.
  process.env.SCHEMA_ENSURE_CONTROLLED = '1';

  for (const modulePath of modulePaths) {
    try {
      // Clear cache so a previous accidental load cannot skip ensure().
      const resolved = require.resolve(modulePath);
      delete require.cache[resolved];
      const mod = require(modulePath);
      if (mod && typeof mod.ensure === 'function') {
        await mod.ensure();
      } else {
        console.warn(`Schema ensure module missing ensure(): ${modulePath}`);
      }
    } catch (err) {
      console.error(`Schema ensure failed to load: ${modulePath}`, err.message);
    }
    if (staggerMs > 0) await delay(staggerMs);
  }
}

module.exports = { shouldRunSchemaEnsure, runSchemaEnsureModules };
