/**
 * Unified activity audit export for enterprise owners / accountants.
 * GET /api/admin/audit-export?start_date=&end_date=&format=json|csv
 */
const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole('admin'));

function toYmd(v) {
  if (!v) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
}

router.get('/audit-export', async (req, res) => {
  const start = toYmd(req.query.start_date) || toYmd(new Date(Date.now() - 30 * 86400000).toISOString());
  const end = toYmd(req.query.end_date) || toYmd(new Date().toISOString());
  const format = String(req.query.format || 'json').toLowerCase();

  try {
    const paymentRowsRaw = await db.all(
      `SELECT
         pal.id,
         pal.order_id,
         o.receipt_number,
         o.branch_id,
         b.name AS branch_name,
         pal.action,
         pal.old_payment_status,
         pal.new_payment_status,
         pal.old_paid_amount,
         pal.new_paid_amount,
         pal.old_payment_method,
         pal.new_payment_method,
         pal.changed_by,
         pal.notes,
         pal.changed_at
       FROM payment_audit_log pal
       LEFT JOIN orders o ON o.id = pal.order_id
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE pal.changed_at::date >= $1::date AND pal.changed_at::date <= $2::date
       ORDER BY pal.changed_at DESC
       LIMIT 5000`,
      [start, end]
    );

    const paymentRows = (paymentRowsRaw || []).map((r) => ({
      source: 'payment',
      id: r.id,
      changed_at: r.changed_at,
      branch_name: r.branch_name || '',
      receipt_number: r.receipt_number || '',
      action: r.action,
      changed_by: r.changed_by,
      detail: `${r.old_payment_status || ''} → ${r.new_payment_status || ''} | ${r.old_paid_amount ?? ''} → ${r.new_paid_amount ?? ''} | ${r.old_payment_method || ''} → ${r.new_payment_method || ''}`,
      notes: r.notes || '',
    }));

    let expenseRows = [];
    try {
      const expenseRaw = await db.all(
        `SELECT
           eal.id,
           eal.expense_id,
           e.branch_id,
           b.name AS branch_name,
           eal.action,
           eal.old_data,
           eal.new_data,
           eal.reason,
           eal.changed_by,
           eal.changed_at
         FROM expense_audit_log eal
         LEFT JOIN expenses e ON e.id = eal.expense_id
         LEFT JOIN branches b ON b.id = e.branch_id
         WHERE eal.changed_at::date >= $1::date AND eal.changed_at::date <= $2::date
         ORDER BY eal.changed_at DESC
         LIMIT 5000`,
        [start, end]
      );
      expenseRows = (expenseRaw || []).map((r) => {
        const oldD = parseJson(r.old_data);
        const newD = parseJson(r.new_data);
        const amount =
          oldD || newD
            ? `${oldD?.amount ?? ''} → ${newD?.amount ?? ''}`
            : '';
        return {
          source: 'expense',
          id: r.id,
          changed_at: r.changed_at,
          branch_name: r.branch_name || '',
          receipt_number: r.expense_id != null ? `EXP-${r.expense_id}` : '',
          action: r.action,
          changed_by: r.changed_by,
          detail: amount,
          notes: r.reason || '',
        };
      });
    } catch (err) {
      console.warn('expense audit export skipped:', err.message);
    }

    const rows = [...paymentRows, ...expenseRows].sort((a, b) => {
      const ta = new Date(a.changed_at || 0).getTime();
      const tb = new Date(b.changed_at || 0).getTime();
      return tb - ta;
    });

    if (format === 'csv') {
      const headers = [
        'source',
        'changed_at',
        'branch_name',
        'receipt_or_ref',
        'action',
        'changed_by',
        'detail',
        'notes',
      ];
      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push(
          [r.source, r.changed_at, r.branch_name, r.receipt_number, r.action, r.changed_by, r.detail, r.notes]
            .map(csvEscape)
            .join(',')
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-export-${start}-to-${end}.csv"`);
      return res.send(lines.join('\n'));
    }

    res.json({
      start_date: start,
      end_date: end,
      count: rows.length,
      rows,
    });
  } catch (err) {
    console.error('audit-export error:', err);
    res.status(500).json({ error: 'Failed to export audit log' });
  }
});

module.exports = router;
