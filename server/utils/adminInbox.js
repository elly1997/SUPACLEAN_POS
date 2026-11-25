/**
 * Admin inbox helpers: create items, void approval, cash-short alerts.
 */
const db = require('../database/query');

const TYPES = {
  VOID_RECEIPT: 'void_receipt',
  CASH_SHORT: 'cash_short',
  AI_SUGGESTION: 'ai_suggestion',
  DEPOSIT_DELETE: 'deposit_delete',
  SYSTEM: 'system',
};

function safeJson(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function resolveBranchMeta(branchId) {
  if (branchId == null) return { branch_id: null, branch_name: null, branch_code: null };
  const row = await db.get('SELECT id, name, code FROM branches WHERE id = ?', [branchId]);
  return {
    branch_id: row?.id ?? branchId,
    branch_name: row?.name || `Branch ${branchId}`,
    branch_code: row?.code || null,
  };
}

/**
 * Insert an inbox row. If dedupe_key already exists, returns the existing row (no error).
 */
async function createInboxItem(input = {}) {
  const {
    type,
    title,
    body = null,
    branchId = null,
    status = 'unread',
    actionStatus = null,
    priority = 'normal',
    dedupeKey = null,
    payload = {},
    requestedBy = null,
    requestedByUserId = null,
    reviewedBy = null,
    reviewedByUserId = null,
    reviewedAt = null,
    reviewNote = null,
  } = input;

  if (!type || !title) {
    const err = new Error('Inbox item requires type and title');
    err.status = 400;
    throw err;
  }

  if (dedupeKey) {
    const existing = await db.get('SELECT * FROM admin_inbox WHERE dedupe_key = ?', [dedupeKey]);
    if (existing) return { item: existing, created: false };
  }

  const branch = await resolveBranchMeta(branchId);
  const result = await db.run(
    `INSERT INTO admin_inbox (
       type, title, body, branch_id, branch_name, branch_code,
       status, action_status, priority, dedupe_key, payload,
       requested_by, requested_by_user_id,
       reviewed_by, reviewed_by_user_id, reviewed_at, review_note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      type,
      title,
      body,
      branch.branch_id,
      branch.branch_name,
      branch.branch_code,
      status,
      actionStatus,
      priority,
      dedupeKey,
      JSON.stringify(payload || {}),
      requestedBy,
      requestedByUserId,
      reviewedBy,
      reviewedByUserId,
      reviewedAt,
      reviewNote,
    ]
  );

  return { item: result.row, created: true };
}

async function listInboxItems({
  limit = 50,
  offset = 0,
  status = null,
  actionStatus = null,
  type = null,
  branchId = null,
  includeDismissed = false,
} = {}) {
  const clauses = [];
  const params = [];

  if (!includeDismissed) {
    clauses.push(`status != 'dismissed'`);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (actionStatus) {
    clauses.push('action_status = ?');
    params.push(actionStatus);
  }
  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (branchId != null && branchId !== '') {
    clauses.push('branch_id = ?');
    params.push(Number(branchId));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT * FROM admin_inbox
     ${where}
     ORDER BY
       CASE WHEN action_status = 'pending' THEN 0 ELSE 1 END,
       CASE WHEN status = 'unread' THEN 0 ELSE 1 END,
       CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Math.min(Math.max(Number(limit) || 50, 1), 100), Math.max(Number(offset) || 0, 0)]
  );

  return (rows || []).map((row) => ({
    ...row,
    payload: safeJson(row.payload),
  }));
}

async function getInboxCounts({ branchId = null } = {}) {
  const params = [];
  let branchClause = '';
  if (branchId != null && branchId !== '') {
    branchClause = ' AND branch_id = ?';
    params.push(Number(branchId));
  }

  const row = await db.get(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'dismissed')::int AS total,
       COUNT(*) FILTER (WHERE status = 'unread')::int AS unread,
       COUNT(*) FILTER (WHERE action_status = 'pending')::int AS pending_actions
     FROM admin_inbox
     WHERE 1=1${branchClause}`,
    params
  );

  return {
    total: row?.total || 0,
    unread: row?.unread || 0,
    pending_actions: row?.pending_actions || 0,
  };
}

async function getInboxItem(id) {
  const row = await db.get('SELECT * FROM admin_inbox WHERE id = ?', [id]);
  if (!row) return null;
  return { ...row, payload: safeJson(row.payload) };
}

async function markInboxRead(id) {
  const result = await db.run(
    `UPDATE admin_inbox
     SET status = CASE WHEN status = 'dismissed' THEN status ELSE 'read' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
     RETURNING *`,
    [id]
  );
  return result.row ? { ...result.row, payload: safeJson(result.row.payload) } : null;
}

async function dismissInboxItem(id) {
  const result = await db.run(
    `UPDATE admin_inbox
     SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
     RETURNING *`,
    [id]
  );
  return result.row ? { ...result.row, payload: safeJson(result.row.payload) } : null;
}

function voidDedupeKey(receiptNumber) {
  return `void_receipt:pending:${String(receiptNumber || '').trim().toUpperCase()}`;
}

async function getPendingVoidForReceipt(receiptNumber) {
  if (!receiptNumber) return null;
  const row = await db.get(
    `SELECT * FROM admin_inbox
     WHERE type = ?
       AND action_status = 'pending'
       AND dedupe_key = ?`,
    [TYPES.VOID_RECEIPT, voidDedupeKey(receiptNumber)]
  );
  return row ? { ...row, payload: safeJson(row.payload) } : null;
}

async function assertNoPendingVoid(receiptNumber) {
  const pending = await getPendingVoidForReceipt(receiptNumber);
  if (pending) {
    const err = new Error('A void request for this receipt is already awaiting admin approval');
    err.status = 409;
    err.code = 'void_pending';
    err.inboxItem = pending;
    throw err;
  }
}

/**
 * Staff (or manager) requests a void — appears in admin inbox for approve/decline.
 */
async function createVoidReceiptRequest({
  receiptNumber,
  voidReason,
  requestedBy,
  requestedByUserId,
  branchFilterClause = '',
  branchFilterParams = [],
  acknowledgeReconciledDay = false,
}) {
  const reason = String(voidReason || '').trim();
  if (!reason) {
    const err = new Error('A void reason is required');
    err.status = 400;
    throw err;
  }

  const orders = await db.all(
    `SELECT o.*, c.name AS customer_name
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE UPPER(o.receipt_number) = UPPER(?)
     ${branchFilterClause}
     ORDER BY o.id`,
    [receiptNumber, ...branchFilterParams]
  );

  if (!orders?.length) {
    const err = new Error('Receipt not found or access denied');
    err.status = 404;
    throw err;
  }
  if (orders.some((o) => o.is_voided)) {
    const err = new Error('This receipt has already been voided');
    err.status = 400;
    throw err;
  }
  if (orders.some((o) => o.archived_at)) {
    const err = new Error('Archived receipts cannot be voided');
    err.status = 400;
    throw err;
  }

  await assertNoPendingVoid(receiptNumber);

  const branchId = orders[0].branch_id;
  const totalAmount = orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
  const paidAmount = orders.reduce((s, o) => s + (parseFloat(o.paid_amount) || 0), 0);
  const customerName = orders[0].customer_name || 'Walk-in';

  const { item, created } = await createInboxItem({
    type: TYPES.VOID_RECEIPT,
    title: `Void request: ${String(receiptNumber).toUpperCase()}`,
    body: `${requestedBy} requested to void receipt ${String(receiptNumber).toUpperCase()} (${customerName}). Reason: ${reason}`,
    branchId,
    status: 'unread',
    actionStatus: 'pending',
    priority: 'high',
    dedupeKey: voidDedupeKey(receiptNumber),
    payload: {
      receipt_number: orders[0].receipt_number,
      void_reason: reason,
      customer_name: customerName,
      item_count: orders.length,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      order_ids: orders.map((o) => o.id),
      acknowledge_reconciled_day: !!acknowledgeReconciledDay,
    },
    requestedBy,
    requestedByUserId,
  });

  return { item: { ...item, payload: safeJson(item.payload) }, created };
}

/**
 * Admin approved a void request — execute void and mark inbox item.
 */
async function approveVoidRequest(inboxId, {
  reviewedBy,
  reviewedByUserId,
  reviewNote = null,
  acknowledgeReconciledDay = false,
  branchFilterClause = '',
  branchFilterParams = [],
} = {}) {
  const item = await getInboxItem(inboxId);
  if (!item) {
    const err = new Error('Inbox item not found');
    err.status = 404;
    throw err;
  }
  if (item.type !== TYPES.VOID_RECEIPT) {
    const err = new Error('This inbox item is not a void request');
    err.status = 400;
    throw err;
  }
  if (item.action_status !== 'pending') {
    const err = new Error(`Void request is already ${item.action_status || 'closed'}`);
    err.status = 409;
    throw err;
  }

  const payload = item.payload || {};
  const receiptNumber = payload.receipt_number;
  const voidReason = payload.void_reason || 'Approved void request';

  const shouldAcknowledge = acknowledgeReconciledDay === true || !!payload.acknowledge_reconciled_day;

  // Lazy require — avoids circular: orders.js→adminInbox→orderVoid→cashManagement
  const { voidReceiptByNumber, refreshDailyClosingForOrderDates, normalizeDate } = require('./orderVoid');

  // Collect affected dates WITHOUT running the expensive chain refresh yet
  // so we can respond quickly and run the refresh in the background.
  const voidReason2 = `[Approved] ${voidReason}`;
  const voidedBy2 = reviewedBy || 'Admin';

  const result = await voidReceiptByNumber(receiptNumber, {
    voidReason: voidReason2,
    voidedBy: voidedBy2,
    acknowledgeReconciledDay: shouldAcknowledge,
    branchFilterClause,
    branchFilterParams,
    // Skip the chain refresh inside voidReceiptByNumber; we run it in the background below
    _skipChainRefresh: true,
  });

  // Store only a compact summary — avoid circular refs or large objects in JSON.stringify
  const executionSummary = {
    items_voided: result.items_voided,
    transactions_voided: result.transactions_voided,
    loyalty_points_reversed: result.loyalty_points_reversed,
    reconciled_days_refreshed: result.reconciled_days_refreshed || [],
    acknowledged_reconciled_day: shouldAcknowledge,
    voided_at: new Date().toISOString(),
  };

  await db.run(
    `UPDATE admin_inbox
     SET action_status = 'approved',
         status = 'read',
         reviewed_by = ?,
         reviewed_by_user_id = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         review_note = ?,
         payload = payload || ?::jsonb,
         dedupe_key = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      reviewedBy,
      reviewedByUserId,
      reviewNote || null,
      JSON.stringify({ execution_result: executionSummary }),
      inboxId,
    ]
  );

  // Run chain refresh in background so the HTTP response is not blocked
  if (result._affectedDates && result._branchId != null) {
    setImmediate(async () => {
      try {
        await refreshDailyClosingForOrderDates(result._branchId, ...result._affectedDates);
      } catch (err) {
        console.error('[adminInbox] background chain refresh failed:', err.message);
      }
    });
  }

  return { result, item: await getInboxItem(inboxId) };
}

async function rejectVoidRequest(inboxId, {
  reviewedBy,
  reviewedByUserId,
  reviewNote = null,
} = {}) {
  const item = await getInboxItem(inboxId);
  if (!item) {
    const err = new Error('Inbox item not found');
    err.status = 404;
    throw err;
  }
  if (item.type !== TYPES.VOID_RECEIPT) {
    const err = new Error('This inbox item is not a void request');
    err.status = 400;
    throw err;
  }
  if (item.action_status !== 'pending') {
    const err = new Error(`Void request is already ${item.action_status || 'closed'}`);
    err.status = 409;
    throw err;
  }

  await db.run(
    `UPDATE admin_inbox
     SET action_status = 'rejected',
         status = 'read',
         reviewed_by = ?,
         reviewed_by_user_id = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         review_note = ?,
         dedupe_key = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [reviewedBy, reviewedByUserId, reviewNote, inboxId]
  );

  return { item: await getInboxItem(inboxId) };
}

/* ---------- Bank deposit delete: manager request → admin approval ---------- */

function depositDeleteDedupeKey(depositId) {
  return `deposit_delete:pending:${Number(depositId)}`;
}

/**
 * Non-admin asks to delete a bank deposit. Creates a pending inbox item; the deposit is only
 * removed when an admin approves it (see approveDepositDeleteRequest).
 */
async function createDepositDeleteRequest({ deposit, reason, requestedBy, requestedByUserId }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    const err = new Error('A reason is required to request a deposit deletion');
    err.status = 400;
    throw err;
  }

  const dedupeKey = depositDeleteDedupeKey(deposit.id);
  const existing = await db.get('SELECT * FROM admin_inbox WHERE dedupe_key = ?', [dedupeKey]);
  if (existing) {
    const err = new Error('A delete request for this deposit is already awaiting admin approval');
    err.status = 409;
    err.code = 'deposit_delete_pending';
    err.inboxItem = { ...existing, payload: safeJson(existing.payload) };
    throw err;
  }

  const day = String(deposit.date).trim().slice(0, 10);
  const amount = parseFloat(deposit.amount) || 0;
  const amountLabel = amount.toLocaleString();
  const bankLabel = deposit.bank_account_name || deposit.bank_name || 'bank not specified';

  const { item } = await createInboxItem({
    type: TYPES.DEPOSIT_DELETE,
    title: `Delete deposit: TSh ${amountLabel} (${day})`,
    body: `${requestedBy} requested to delete a bank deposit of TSh ${amountLabel} to ${bankLabel} dated ${day}. Reason: ${cleanReason}`,
    branchId: deposit.branch_id,
    status: 'unread',
    actionStatus: 'pending',
    priority: 'high',
    dedupeKey,
    payload: {
      deposit_id: Number(deposit.id),
      date: day,
      amount,
      bank_name: bankLabel,
      reference_number: deposit.reference_number || null,
      notes: deposit.notes || null,
      reason: cleanReason,
    },
    requestedBy,
    requestedByUserId,
  });

  return { item: { ...item, payload: safeJson(item.payload) } };
}

async function loadPendingDepositDeleteItem(inboxId) {
  const item = await getInboxItem(inboxId);
  if (!item) {
    const err = new Error('Inbox item not found');
    err.status = 404;
    throw err;
  }
  if (item.type !== TYPES.DEPOSIT_DELETE) {
    const err = new Error('This inbox item is not a deposit delete request');
    err.status = 400;
    throw err;
  }
  if (item.action_status !== 'pending') {
    const err = new Error(`Deposit delete request is already ${item.action_status || 'closed'}`);
    err.status = 409;
    throw err;
  }
  return item;
}

/**
 * Admin approved: delete the deposit and refresh the day chain. Blocked if the day is reconciled
 * (admin must reverse the reconciliation first, then approve again).
 */
async function approveDepositDeleteRequest(inboxId, { reviewedBy, reviewedByUserId, reviewNote = null } = {}) {
  const item = await loadPendingDepositDeleteItem(inboxId);
  const depositId = Number(item.payload?.deposit_id);

  const deposit = await db.get('SELECT id, date, branch_id FROM bank_deposits WHERE id = ?', [depositId]);
  if (!deposit) {
    const err = new Error('This deposit no longer exists. Decline this request instead.');
    err.status = 404;
    throw err;
  }
  const day = String(deposit.date).trim().slice(0, 10);

  // Lazy require: avoids a circular import (cashManagement → adminInbox).
  const { isReconciledDay } = require('./reconciledDay');
  if (await isReconciledDay(day, deposit.branch_id)) {
    const err = new Error(
      'This deposit is on a reconciled day. Reverse the reconciliation first, then approve again.'
    );
    err.status = 409;
    err.code = 'deposit_day_reconciled';
    throw err;
  }

  await db.run('DELETE FROM bank_deposits WHERE id = ?', [depositId]);

  let daysRefreshed = 0;
  try {
    const { refreshUnreconciledSummariesFromDate } = require('../routes/cashManagement');
    const chain = await refreshUnreconciledSummariesFromDate(deposit.branch_id, day);
    daysRefreshed = chain?.daysRefreshed ?? 0;
  } catch (refreshErr) {
    console.error('[adminInbox] refresh after deposit delete failed:', refreshErr.message);
  }

  await db.run(
    `UPDATE admin_inbox
     SET action_status = 'approved',
         status = 'read',
         reviewed_by = ?,
         reviewed_by_user_id = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         review_note = ?,
         dedupe_key = NULL,
         payload = payload || ?::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      reviewedBy,
      reviewedByUserId,
      reviewNote || null,
      JSON.stringify({ execution_result: { deposit_deleted: true, date: day, days_refreshed: daysRefreshed, deleted_at: new Date().toISOString() } }),
      inboxId,
    ]
  );

  return { item: await getInboxItem(inboxId) };
}

async function rejectDepositDeleteRequest(inboxId, { reviewedBy, reviewedByUserId, reviewNote = null } = {}) {
  await loadPendingDepositDeleteItem(inboxId);
  await db.run(
    `UPDATE admin_inbox
     SET action_status = 'rejected',
         status = 'read',
         reviewed_by = ?,
         reviewed_by_user_id = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         review_note = ?,
         dedupe_key = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [reviewedBy, reviewedByUserId, reviewNote, inboxId]
  );
  return { item: await getInboxItem(inboxId) };
}

/**
 * Log an admin-executed void into the inbox (awareness, not actionable).
 */
async function logAdminExecutedVoid({
  receiptNumber,
  voidReason,
  voidedBy,
  voidedByUserId,
  branchId,
  result = {},
}) {
  return createInboxItem({
    type: TYPES.VOID_RECEIPT,
    title: `Void executed: ${String(receiptNumber).toUpperCase()}`,
    body: `${voidedBy} voided receipt ${String(receiptNumber).toUpperCase()}. ${voidReason || ''}`.trim(),
    branchId,
    status: 'unread',
    actionStatus: 'executed',
    priority: 'normal',
    dedupeKey: `void_receipt:executed:${String(receiptNumber).trim().toUpperCase()}:${Date.now()}`,
    payload: {
      receipt_number: receiptNumber,
      void_reason: voidReason,
      execution_result: result,
    },
    requestedBy: voidedBy,
    requestedByUserId: voidedByUserId,
    reviewedBy: voidedBy,
    reviewedByUserId: voidedByUserId,
    reviewedAt: new Date().toISOString(),
  });
}

/**
 * Notify admin when a branch opening session reports a cash short.
 */
async function notifyCashShort({
  branchId,
  date,
  openingVariance,
  openingCashDeclared,
  expectedOpening,
  reportedBy,
} = {}) {
  const shortAmount = Math.abs(Number(openingVariance) || 0);
  if (!(Number(openingVariance) < -0.009)) {
    return { created: false, item: null };
  }

  const ymd = String(date || '').slice(0, 10);
  const amountLabel = shortAmount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const dedupeKey = `cash_short:${branchId}:${ymd}`;
  const existing = await db.get('SELECT * FROM admin_inbox WHERE dedupe_key = ?', [dedupeKey]);
  if (existing) {
    const result = await db.run(
      `UPDATE admin_inbox
       SET title = ?,
           body = ?,
           status = 'unread',
           priority = 'high',
           payload = ?::jsonb,
           requested_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`,
      [
        `Cash short at opening — ${ymd}`,
        `${reportedBy || 'Cashier'} reported opening cash short by ${amountLabel} on ${ymd}. Declared ${openingCashDeclared}; expected ${expectedOpening}.`,
        JSON.stringify({
          date: ymd,
          opening_variance: Number(openingVariance),
          opening_short: shortAmount,
          opening_cash_declared: Number(openingCashDeclared),
          expected_opening: Number(expectedOpening),
          reported_by: reportedBy || null,
        }),
        reportedBy || null,
        existing.id,
      ]
    );
    return { created: false, item: result.row, updated: true };
  }

  return createInboxItem({
    type: TYPES.CASH_SHORT,
    title: `Cash short at opening — ${ymd}`,
    body: `${reportedBy || 'Cashier'} reported opening cash short by ${amountLabel} on ${ymd}. Declared ${openingCashDeclared}; expected ${expectedOpening}.`,
    branchId,
    status: 'unread',
    actionStatus: null,
    priority: 'high',
    dedupeKey,
    payload: {
      date: ymd,
      opening_variance: Number(openingVariance),
      opening_short: shortAmount,
      opening_cash_declared: Number(openingCashDeclared),
      expected_opening: Number(expectedOpening),
      reported_by: reportedBy || null,
    },
    requestedBy: reportedBy || null,
  });
}

/**
 * Notify when a day is reconciled — especially useful when there was an opening short.
 */
async function notifyReconciledDay({
  branchId,
  date,
  reconciledBy,
  openingVariance = 0,
  closingBalance = null,
} = {}) {
  const ymd = String(date || '').slice(0, 10);
  const variance = Number(openingVariance) || 0;
  const isShort = variance < -0.009;
  const shortAmt = Math.abs(variance).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return createInboxItem({
    type: isShort ? TYPES.CASH_SHORT : TYPES.SYSTEM,
    title: isShort
      ? `Reconciled with opening short — ${ymd}`
      : `Day reconciled — ${ymd}`,
    body: isShort
      ? `${reconciledBy || 'Manager'} reconciled ${ymd} with an opening short of ${shortAmt}. Closing balance: ${closingBalance ?? 'n/a'}.`
      : `${reconciledBy || 'Manager'} reconciled ${ymd}. Closing balance: ${closingBalance ?? 'n/a'}.`,
    branchId,
    status: 'unread',
    actionStatus: null,
    priority: isShort ? 'high' : 'normal',
    dedupeKey: `reconciled:${branchId}:${ymd}`,
    payload: {
      date: ymd,
      opening_variance: variance,
      closing_balance: closingBalance,
      reconciled_by: reconciledBy || null,
      has_opening_short: isShort,
    },
    requestedBy: reconciledBy || null,
  });
}

async function createAiSuggestion({
  title,
  body,
  branchId = null,
  payload = {},
  dedupeKey = null,
  priority = 'low',
} = {}) {
  return createInboxItem({
    type: TYPES.AI_SUGGESTION,
    title,
    body,
    branchId,
    status: 'unread',
    actionStatus: null,
    priority,
    dedupeKey: dedupeKey || `ai_suggestion:${Date.now()}`,
    payload: { ...payload, source: 'ai' },
  });
}

module.exports = {
  TYPES,
  createInboxItem,
  listInboxItems,
  getInboxCounts,
  getInboxItem,
  markInboxRead,
  dismissInboxItem,
  getPendingVoidForReceipt,
  assertNoPendingVoid,
  createVoidReceiptRequest,
  approveVoidRequest,
  rejectVoidRequest,
  createDepositDeleteRequest,
  approveDepositDeleteRequest,
  rejectDepositDeleteRequest,
  logAdminExecutedVoid,
  notifyCashShort,
  notifyReconciledDay,
  createAiSuggestion,
  voidDedupeKey,
};
