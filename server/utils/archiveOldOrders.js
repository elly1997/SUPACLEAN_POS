/**
 * Soft-archive completed orders older than N months.
 * Archived rows stay in the DB for audit/cash history but leave active operational lists.
 */
const db = require('../database/query');

function parseArchiveOptions(body = {}) {
  const monthsRaw = Number(body.months ?? 7);
  const months = Number.isFinite(monthsRaw) ? Math.max(1, Math.min(120, Math.round(monthsRaw))) : 7;
  const dryRun = body.dry_run === true || body.dry_run === 'true';
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = cutoff.toISOString();
  return {
    months,
    dryRun,
    cutoffIso,
    archiveReason: body.archive_reason || `Auto-archived completed orders older than ${months} months`,
    archivedBy: body.archived_by || 'System',
  };
}

function buildArchiveWhere(branchFilter) {
  return {
    clause: `
    archived_at IS NULL
    AND (
      status = 'collected'
      OR status = 'voided'
      OR COALESCE(is_voided, FALSE) = TRUE
    )
    AND COALESCE(collected_date, voided_at, order_date) < ?
    ${branchFilter.clause || ''}
  `,
  };
}

/**
 * @param {{ clause: string, params: any[] }} branchFilter
 * @param {object} options from parseArchiveOptions
 */
async function archiveOldOrders(branchFilter, options) {
  const { months, dryRun, cutoffIso, archiveReason, archivedBy } = options;
  const { clause: whereClause } = buildArchiveWhere(branchFilter);
  const whereParams = [cutoffIso, ...(branchFilter.params || [])];

  const summary = await db.get(
    `SELECT COUNT(*) AS items, COUNT(DISTINCT UPPER(receipt_number)) AS receipts
     FROM orders
     WHERE ${whereClause}`,
    whereParams
  );

  if (!dryRun) {
    await db.run(
      `UPDATE orders
       SET archived_at = CURRENT_TIMESTAMP,
           archived_by = ?,
           archive_reason = ?
       WHERE ${whereClause}`,
      [archivedBy, archiveReason, ...whereParams]
    );
  }

  return {
    message: dryRun ? 'Archive preview completed' : 'Old completed orders archived successfully',
    dry_run: dryRun,
    cutoff_date: cutoffIso.slice(0, 10),
    months,
    receipts_matched: Number(summary?.receipts || 0),
    items_matched: Number(summary?.items || 0),
  };
}

module.exports = {
  parseArchiveOptions,
  archiveOldOrders,
};
