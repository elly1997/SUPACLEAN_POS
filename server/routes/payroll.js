const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getEffectiveBranchId } = require('../utils/branchFilter');

router.use(authenticate, requireBranchAccess());

function monthKeyOrNow(v) {
  if (v && /^\d{4}-\d{2}$/.test(String(v))) return String(v);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseMoney(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function estimateMonthlyPAYE(taxableIncome) {
  const x = Math.max(0, parseMoney(taxableIncome));
  if (x <= 270000) return 0;
  if (x <= 520000) return (x - 270000) * 0.08;
  if (x <= 760000) return 20000 + (x - 520000) * 0.20;
  if (x <= 1000000) return 68000 + (x - 760000) * 0.25;
  return 128000 + (x - 1000000) * 0.30;
}

async function monthAdvanceMap(monthKey, branchId) {
  const start = `${monthKey}-01`;
  const rows = await db.all(
    `SELECT employee_id, COALESCE(SUM(amount), 0) AS total
     FROM salary_advances
     WHERE to_char(advance_date::date, 'YYYY-MM') = ?
       AND (?::int IS NULL OR branch_id = ?)
     GROUP BY employee_id`,
    [monthKey, branchId, branchId]
  );
  const map = new Map();
  (rows || []).forEach((r) => map.set(Number(r.employee_id), parseMoney(r.total)));
  return map;
}

router.get('/employees', requirePermission('canManagePayroll'), async (req, res) => {
  const branchId = getEffectiveBranchId(req);
  try {
    const rows = await db.all(
      `SELECT e.*, b.name AS branch_name
       FROM employees e
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE (?::int IS NULL OR e.branch_id = ?)
       ORDER BY e.full_name ASC`,
      [branchId, branchId]
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/employees', requirePermission('canManagePayroll'), async (req, res) => {
  const {
    full_name,
    employee_code,
    phone,
    branch_id,
    gross_salary,
    default_allowances = 0,
    default_bonuses = 0,
    default_other_deductions = 0,
    nssf_enabled = true,
    paye_enabled = true
  } = req.body;
  if (!full_name || gross_salary == null) {
    return res.status(400).json({ error: 'full_name and gross_salary are required' });
  }
  try {
    const result = await db.run(
      `INSERT INTO employees
      (full_name, employee_code, phone, branch_id, gross_salary, default_allowances, default_bonuses, default_other_deductions, nssf_enabled, paye_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        String(full_name).trim(),
        employee_code ? String(employee_code).trim() : null,
        phone ? String(phone).trim() : null,
        branch_id ? Number(branch_id) : null,
        parseMoney(gross_salary),
        parseMoney(default_allowances),
        parseMoney(default_bonuses),
        parseMoney(default_other_deductions),
        !!nssf_enabled,
        !!paye_enabled
      ]
    );
    const row = await db.get('SELECT * FROM employees WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/advances', requirePermission('canRecordSalaryAdvances'), async (req, res) => {
  const { employee_id, advance_date, amount, notes } = req.body;
  const branchId = getEffectiveBranchId(req);
  if (!employee_id || !advance_date || !amount) {
    return res.status(400).json({ error: 'employee_id, advance_date, amount are required' });
  }
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch before recording salary advances' });
  }
  try {
    const emp = await db.get('SELECT id FROM employees WHERE id = ? AND is_active = TRUE', [employee_id]);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const r = await db.run(
      `INSERT INTO salary_advances (employee_id, advance_date, amount, notes, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [Number(employee_id), advance_date, parseMoney(amount), notes || null, branchId, req.user?.fullName || req.user?.username || 'User']
    );
    const row = await db.get('SELECT * FROM salary_advances WHERE id = ?', [r.lastID]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/advances', requirePermission('canRecordSalaryAdvances'), async (req, res) => {
  const month = monthKeyOrNow(req.query.month);
  const branchId = getEffectiveBranchId(req);
  try {
    const rows = await db.all(
      `SELECT a.*, e.full_name, e.employee_code
       FROM salary_advances a
       JOIN employees e ON e.id = a.employee_id
       WHERE to_char(a.advance_date::date, 'YYYY-MM') = ?
         AND (?::int IS NULL OR a.branch_id = ?)
       ORDER BY a.advance_date DESC, a.id DESC`,
      [month, branchId, branchId]
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monthly', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.query.month);
  const branchId = getEffectiveBranchId(req);
  try {
    const employees = await db.all(
      `SELECT * FROM employees
       WHERE is_active = TRUE
       AND (?::int IS NULL OR branch_id = ?)
       ORDER BY full_name ASC`,
      [branchId, branchId]
    );
    const advMap = await monthAdvanceMap(month, branchId);
    const lines = (employees || []).map((e) => {
      const gross = parseMoney(e.gross_salary);
      const allowances = parseMoney(e.default_allowances);
      const bonuses = parseMoney(e.default_bonuses);
      const otherDeductions = parseMoney(e.default_other_deductions);
      const advances = advMap.get(Number(e.id)) || 0;
      const nssf = e.nssf_enabled ? gross * 0.1 : 0;
      const taxable = Math.max(0, gross + allowances + bonuses - nssf);
      const paye = e.paye_enabled ? estimateMonthlyPAYE(taxable) : 0;
      const totalDeductions = nssf + paye + otherDeductions + advances;
      const net = gross + allowances + bonuses - totalDeductions;
      return {
        employee_id: e.id,
        full_name: e.full_name,
        employee_code: e.employee_code,
        gross_salary: gross,
        allowances,
        bonuses,
        nssf_amount: nssf,
        paye_estimate: paye,
        other_deductions: otherDeductions,
        salary_advances: advances,
        total_deductions: totalDeductions,
        net_salary: net
      };
    });
    res.json({ month_key: month, lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/monthly/save', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.body.month_key);
  const branchId = getEffectiveBranchId(req);
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (lines.length === 0) return res.status(400).json({ error: 'No payroll lines provided' });
  try {
    for (const line of lines) {
      await db.run(
        `INSERT INTO payroll_monthly
          (month_key, employee_id, gross_salary, allowances, bonuses, nssf_amount, paye_amount, other_deductions, salary_advances, total_deductions, net_salary, branch_id, computed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (month_key, employee_id) DO UPDATE SET
          gross_salary = EXCLUDED.gross_salary,
          allowances = EXCLUDED.allowances,
          bonuses = EXCLUDED.bonuses,
          nssf_amount = EXCLUDED.nssf_amount,
          paye_amount = EXCLUDED.paye_amount,
          other_deductions = EXCLUDED.other_deductions,
          salary_advances = EXCLUDED.salary_advances,
          total_deductions = EXCLUDED.total_deductions,
          net_salary = EXCLUDED.net_salary,
          branch_id = EXCLUDED.branch_id,
          computed_by = EXCLUDED.computed_by,
          computed_at = CURRENT_TIMESTAMP`,
        [
          month,
          Number(line.employee_id),
          parseMoney(line.gross_salary),
          parseMoney(line.allowances),
          parseMoney(line.bonuses),
          parseMoney(line.nssf_amount),
          parseMoney(line.paye_estimate ?? line.paye_amount),
          parseMoney(line.other_deductions),
          parseMoney(line.salary_advances),
          parseMoney(line.total_deductions),
          parseMoney(line.net_salary),
          branchId,
          req.user?.fullName || req.user?.username || 'Admin'
        ]
      );
    }
    res.json({ success: true, message: `Payroll saved for ${month}`, count: lines.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
