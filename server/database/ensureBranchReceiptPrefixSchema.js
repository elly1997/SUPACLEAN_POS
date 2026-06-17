/**
 * Adds branches.receipt_prefix for per-branch receipt / customer IDs (e.g. UH 1-17-6).
 */
const db = require('./query');

async function ensureBranchReceiptPrefixSchema() {
  try {
    await db.run(
      `ALTER TABLE branches ADD COLUMN IF NOT EXISTS receipt_prefix VARCHAR(10)`,
      []
    );
  } catch (e) {
    const msg = String(e.message || '');
    if (!/duplicate column|already exists/i.test(msg)) {
      console.warn('ensureBranchReceiptPrefixSchema:', msg);
    }
  }
}

module.exports = { ensureBranchReceiptPrefixSchema };
