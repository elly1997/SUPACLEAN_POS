/**
 * Admin notification inbox — void approvals, cash shorts, AI suggestions.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireBranchAccess } = require('../middleware/auth');
const {
  listInboxItems,
  getInboxCounts,
  getInboxItem,
  markInboxRead,
  dismissInboxItem,
  approveVoidRequest,
  rejectVoidRequest,
  TYPES,
} = require('../utils/adminInbox');

router.use(authenticate, requireRole('admin'));

router.get('/', async (req, res) => {
  try {
    const items = await listInboxItems({
      limit: req.query.limit,
      offset: req.query.offset,
      status: req.query.status || null,
      actionStatus: req.query.action_status || null,
      type: req.query.type || null,
      branchId: req.query.branch_id ?? req.effectiveBranchId ?? null,
      includeDismissed: req.query.include_dismissed === 'true',
    });
    const counts = await getInboxCounts({
      branchId: req.query.branch_id ?? req.effectiveBranchId ?? null,
    });
    res.json({ items, counts, types: Object.values(TYPES) });
  } catch (err) {
    console.error('admin inbox list error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/counts', async (req, res) => {
  try {
    const counts = await getInboxCounts({
      branchId: req.query.branch_id ?? req.effectiveBranchId ?? null,
    });
    res.json(counts);
  } catch (err) {
    console.error('admin inbox counts error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await getInboxItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inbox item not found' });
    res.json(item);
  } catch (err) {
    console.error('admin inbox get error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const item = await markInboxRead(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inbox item not found' });
    res.json(item);
  } catch (err) {
    console.error('admin inbox read error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    const item = await dismissInboxItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Inbox item not found' });
    res.json(item);
  } catch (err) {
    console.error('admin inbox dismiss error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve', requireBranchAccess(), async (req, res) => {
  const acknowledgeReconciledDay = req.body?.acknowledge_reconciled_day === true
    || req.body?.acknowledge_reconciled_day === 'true'
    || req.body?.acknowledge_reconciled_day === 1
    || req.body?.acknowledge_reconciled_day === '1';

  try {
    // Admins approving voids should not be blocked by a selected branch switcher —
    // use empty branch filter so the receipt can be found regardless of X-Branch-Id.
    const branchFilter = { clause: '', params: [] };
    const reviewedBy = req.user?.fullName || req.user?.username || 'Admin';
    const out = await approveVoidRequest(req.params.id, {
      reviewedBy,
      reviewedByUserId: req.user?.id,
      reviewNote: req.body?.review_note || null,
      acknowledgeReconciledDay,
      branchFilterClause: branchFilter.clause,
      branchFilterParams: branchFilter.params,
    });
    res.json({
      message: 'Void request approved and receipt voided',
      item: out.item,
      void_result: out.result,
    });
  } catch (err) {
    if (err.status === 409 && err.code === 'reconciled_day') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    const status = err.status || 500;
    console.error('admin inbox approve error:', err);
    res.status(status).json({ error: err.message || 'Failed to approve' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const out = await rejectVoidRequest(req.params.id, {
      reviewedBy: req.user?.fullName || req.user?.username || 'Admin',
      reviewedByUserId: req.user?.id,
      reviewNote: req.body?.review_note || req.body?.reason || null,
    });
    res.json({
      message: 'Void request declined',
      item: out.item,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error('admin inbox reject error:', err);
    res.status(status).json({ error: err.message || 'Failed to reject' });
  }
});

module.exports = router;
