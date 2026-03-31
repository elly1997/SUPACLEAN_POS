const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
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

function omitBranchId(row) {
  if (!row || typeof row !== 'object') return row;
  const { branch_id: _b, ...rest } = row;
  return rest;
}

function estimateMonthlyPAYE(taxableIncome) {
  const x = Math.max(0, parseMoney(taxableIncome));
  // Tanzania monthly resident employment PAYE bands
  if (x <= 270000) return 0;
  if (x <= 520000) return (x - 270000) * 0.08;
  if (x <= 760000) return 20000 + (x - 520000) * 0.20;
  if (x <= 1000000) return 68000 + (x - 760000) * 0.25;
  return 128000 + (x - 1000000) * 0.30;
}

async function monthAdvanceMap(monthKey) {
  const rows = await db.all(
    `SELECT employee_id, COALESCE(SUM(amount), 0) AS total
     FROM salary_advances
     WHERE to_char(advance_date::date, 'YYYY-MM') = ?
     GROUP BY employee_id`,
    [monthKey]
  );
  const map = new Map();
  (rows || []).forEach((r) => map.set(Number(r.employee_id), parseMoney(r.total)));
  return map;
}

router.get('/employees', requirePermission('canManagePayroll'), async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT e.*
       FROM employees e
       ORDER BY e.full_name ASC`,
      []
    );
    res.json((rows || []).map(omitBranchId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees/for-advances', requirePermission('canManageExpenses'), async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, full_name, employee_code
       FROM employees
       WHERE is_active = TRUE
       ORDER BY full_name ASC`,
      []
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
    tin_number,
    phone,
    gross_salary,
    default_allowances = 0,
    default_bonuses = 0,
    default_other_deductions = 0,
    nssf_enabled = true,
    nssf_employee_rate = 10,
    nssf_employer_rate = 10,
    paye_enabled = true
  } = req.body;
  if (!full_name || gross_salary == null) {
    return res.status(400).json({ error: 'full_name and gross_salary are required' });
  }
  try {
    const result = await db.run(
      `INSERT INTO employees
      (full_name, employee_code, tin_number, phone, branch_id, gross_salary, default_allowances, default_bonuses, default_other_deductions, nssf_enabled, nssf_employee_rate, nssf_employer_rate, paye_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        String(full_name).trim(),
        employee_code ? String(employee_code).trim() : null,
        tin_number ? String(tin_number).trim() : null,
        phone ? String(phone).trim() : null,
        null,
        parseMoney(gross_salary),
        parseMoney(default_allowances),
        parseMoney(default_bonuses),
        parseMoney(default_other_deductions),
        !!nssf_enabled,
        parseMoney(nssf_employee_rate, 10),
        parseMoney(nssf_employer_rate, 10),
        !!paye_enabled
      ]
    );
    const row = await db.get('SELECT * FROM employees WHERE id = ?', [result.lastID]);
    res.status(201).json(omitBranchId(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/employees/:id', requirePermission('canManagePayroll'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid employee id' });
  const {
    full_name,
    employee_code,
    tin_number,
    phone,
    gross_salary,
    default_allowances,
    default_bonuses,
    default_other_deductions,
    nssf_enabled,
    nssf_employee_rate,
    nssf_employer_rate,
    paye_enabled,
    is_active
  } = req.body || {};
  try {
    const existing = await db.get('SELECT id FROM employees WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });
    await db.run(
      `UPDATE employees SET
         full_name = COALESCE($1, full_name),
         employee_code = COALESCE($2, employee_code),
         tin_number = COALESCE($3, tin_number),
         phone = COALESCE($4, phone),
         branch_id = NULL,
         gross_salary = COALESCE($5, gross_salary),
         default_allowances = COALESCE($6, default_allowances),
         default_bonuses = COALESCE($7, default_bonuses),
         default_other_deductions = COALESCE($8, default_other_deductions),
         nssf_enabled = COALESCE($9, nssf_enabled),
         nssf_employee_rate = COALESCE($10, nssf_employee_rate),
         nssf_employer_rate = COALESCE($11, nssf_employer_rate),
         paye_enabled = COALESCE($12, paye_enabled),
         is_active = COALESCE($13, is_active),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $14`,
      [
        full_name != null ? String(full_name).trim() : null,
        employee_code != null ? String(employee_code).trim() : null,
        tin_number != null ? String(tin_number).trim() : null,
        phone != null ? String(phone).trim() : null,
        gross_salary != null ? parseMoney(gross_salary) : null,
        default_allowances != null ? parseMoney(default_allowances) : null,
        default_bonuses != null ? parseMoney(default_bonuses) : null,
        default_other_deductions != null ? parseMoney(default_other_deductions) : null,
        nssf_enabled != null ? !!nssf_enabled : null,
        nssf_employee_rate != null ? parseMoney(nssf_employee_rate, 10) : null,
        nssf_employer_rate != null ? parseMoney(nssf_employer_rate, 10) : null,
        paye_enabled != null ? !!paye_enabled : null,
        is_active != null ? !!is_active : null,
        id
      ]
    );
    const row = await db.get(
      `SELECT * FROM employees WHERE id = $1`,
      [id]
    );
    res.json(omitBranchId(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/advances', requirePermission('canRecordSalaryAdvances'), async (req, res) => {
  const { employee_id, advance_date, amount, notes } = req.body;
  if (!employee_id || !advance_date || !amount) {
    return res.status(400).json({ error: 'employee_id, advance_date, amount are required' });
  }
  try {
    const emp = await db.get('SELECT id FROM employees WHERE id = ? AND is_active = TRUE', [employee_id]);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const r = await db.run(
      `INSERT INTO salary_advances (employee_id, advance_date, amount, notes, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [Number(employee_id), advance_date, parseMoney(amount), notes || null, null, req.user?.fullName || req.user?.username || 'User']
    );
    const row = await db.get('SELECT * FROM salary_advances WHERE id = ?', [r.lastID]);
    res.status(201).json(omitBranchId(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/advances', requirePermission('canRecordSalaryAdvances'), async (req, res) => {
  const month = monthKeyOrNow(req.query.month);
  try {
    const rows = await db.all(
      `SELECT a.*, e.full_name, e.employee_code
       FROM salary_advances a
       JOIN employees e ON e.id = a.employee_id
       WHERE to_char(a.advance_date::date, 'YYYY-MM') = ?
       ORDER BY a.advance_date DESC, a.id DESC`,
      [month]
    );
    res.json((rows || []).map(omitBranchId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapSavedPayrollRowToLine(r) {
  const gross = parseMoney(r.gross_salary);
  const allowances = parseMoney(r.allowances);
  const bonuses = parseMoney(r.bonuses);
  const nssfEmployeeAmount = parseMoney(r.nssf_amount);
  const nssfEmployerAmount = parseMoney(r.employer_nssf_amount);
  const taxable = parseMoney(r.taxable_income);
  const paye = parseMoney(r.paye_amount);
  const totalDeductions = parseMoney(r.total_deductions);
  const net = parseMoney(r.net_salary);
  return {
    employee_id: r.employee_id,
    full_name: r.full_name,
    employee_code: r.employee_code,
    gross_salary: gross,
    allowances,
    bonuses,
    nssf_enabled: r.nssf_enabled !== false,
    paye_enabled: r.paye_enabled !== false,
    nssf_employee_rate: parseMoney(r.nssf_employee_rate, 10),
    nssf_employer_rate: parseMoney(r.nssf_employer_rate, 10),
    nssf_amount: nssfEmployeeAmount,
    employer_nssf_amount: nssfEmployerAmount,
    taxable_income: taxable,
    paye_estimate: paye,
    paye_amount: paye,
    other_deductions: parseMoney(r.other_deductions),
    salary_advances: parseMoney(r.salary_advances),
    total_deductions: totalDeductions,
    net_salary: net,
    total_employer_cost: gross + allowances + bonuses + nssfEmployerAmount
  };
}

router.get('/monthly', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.query.month);
  try {
    const periodRow = await db.get('SELECT month_key, status, completed_on FROM payroll_periods WHERE month_key = ?', [month]);
    const isClosed = periodRow && String(periodRow.status).toLowerCase() === 'closed';

    if (isClosed) {
      const rows = await db.all(
        `SELECT pm.*, e.full_name, e.employee_code
         FROM payroll_monthly pm
         JOIN employees e ON e.id = pm.employee_id
         WHERE pm.month_key = $1
         ORDER BY e.full_name ASC`,
        [month]
      );
      const lines = (rows || []).map(mapSavedPayrollRowToLine);
      return res.json({
        month_key: month,
        lines,
        period: {
          status: 'closed',
          completed_on: periodRow.completed_on ? String(periodRow.completed_on).slice(0, 10) : null
        }
      });
    }

    const employees = await db.all(
      `SELECT * FROM employees
       WHERE is_active = TRUE
       ORDER BY full_name ASC`,
      []
    );
    const advMap = await monthAdvanceMap(month);
    const lines = (employees || []).map((e) => {
      const gross = parseMoney(e.gross_salary);
      const allowances = parseMoney(e.default_allowances);
      const bonuses = parseMoney(e.default_bonuses);
      const otherDeductions = parseMoney(e.default_other_deductions);
      const advances = advMap.get(Number(e.id)) || 0;
      const nssfEmployeeRate = parseMoney(e.nssf_employee_rate, 10);
      const nssfEmployerRate = parseMoney(e.nssf_employer_rate, 10);
      const nssfEmployeeAmount = e.nssf_enabled ? (gross * nssfEmployeeRate) / 100 : 0;
      const nssfEmployerAmount = e.nssf_enabled ? (gross * nssfEmployerRate) / 100 : 0;
      const taxable = Math.max(0, gross + allowances + bonuses - nssfEmployeeAmount);
      const paye = e.paye_enabled ? estimateMonthlyPAYE(taxable) : 0;
      const totalDeductions = nssfEmployeeAmount + paye + otherDeductions + advances;
      const net = gross + allowances + bonuses - totalDeductions;
      return {
        employee_id: e.id,
        full_name: e.full_name,
        employee_code: e.employee_code,
        gross_salary: gross,
        allowances,
        bonuses,
        nssf_enabled: !!e.nssf_enabled,
        paye_enabled: !!e.paye_enabled,
        nssf_employee_rate: nssfEmployeeRate,
        nssf_employer_rate: nssfEmployerRate,
        nssf_amount: nssfEmployeeAmount,
        employer_nssf_amount: nssfEmployerAmount,
        taxable_income: taxable,
        paye_estimate: paye,
        other_deductions: otherDeductions,
        salary_advances: advances,
        total_deductions: totalDeductions,
        net_salary: net,
        total_employer_cost: gross + allowances + bonuses + nssfEmployerAmount
      };
    });
    res.json({
      month_key: month,
      lines,
      period: {
        status: 'open',
        completed_on: null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monthly/saved', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.query.month);
  try {
    const rows = await db.all(
      `SELECT pm.*, e.full_name, e.employee_code
       FROM payroll_monthly pm
       JOIN employees e ON e.id = pm.employee_id
       WHERE pm.month_key = ?
       ORDER BY e.full_name ASC`,
      [month]
    );
    res.json({ month_key: month, lines: (rows || []).map(omitBranchId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', requirePermission('canManagePayroll'), async (req, res) => {
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 60) : 24;
  const currentMonth = monthKeyOrNow();
  try {
    const rows = await db.all(
      `SELECT
         pm.month_key,
         COUNT(*)::int AS processed_employees,
         COUNT(DISTINCT to_char(pm.computed_at, 'YYYY-MM-DD HH24:MI:SS'))::int AS payroll_runs,
         MAX(pm.computed_at) AS last_run_at,
         COALESCE(SUM(pm.net_salary), 0) AS total_net_salary,
         COALESCE(SUM(pm.paye_amount), 0) AS total_paye,
         COALESCE(SUM(pm.nssf_amount), 0) AS total_nssf,
         MAX(pp.status) AS period_status,
         MAX(pp.completed_on) AS completed_on
       FROM payroll_monthly pm
       LEFT JOIN payroll_periods pp ON pp.month_key = pm.month_key
       GROUP BY pm.month_key
       ORDER BY pm.month_key DESC
       LIMIT ?`,
      [limit]
    );
    const history = (rows || []).map((r) => {
      const rawStatus = r.period_status ? String(r.period_status).toLowerCase() : null;
      let payrollStatus = 'Open';
      if (rawStatus === 'closed') payrollStatus = 'Closed';
      else if (rawStatus === 'open') payrollStatus = 'Open';
      else if (r.month_key < currentMonth) payrollStatus = 'Closed';
      else payrollStatus = 'Open';
      const completedOn = r.completed_on
        ? String(r.completed_on).slice(0, 10)
        : null;
      return {
        ...r,
        payroll_status: payrollStatus,
        completed_on: completedOn,
        salary_statement_status: payrollStatus === 'Closed' ? 'Ready' : 'Draft',
        bank_transfer_status: payrollStatus === 'Closed' ? 'Ready' : 'Pending'
      };
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/monthly/save', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.body.month_key);
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const markClosed = !!req.body.mark_closed;
  const completedOnRaw = req.body.completed_on != null ? String(req.body.completed_on).trim() : '';
  if (lines.length === 0) return res.status(400).json({ error: 'No payroll lines provided' });
  if (markClosed && !/^\d{4}-\d{2}-\d{2}$/.test(completedOnRaw)) {
    return res.status(400).json({ error: 'completed_on is required when closing payroll (YYYY-MM-DD)' });
  }
  try {
    const periodRow = await db.get('SELECT status FROM payroll_periods WHERE month_key = ?', [month]);
    if (periodRow && String(periodRow.status).toLowerCase() === 'closed' && !markClosed) {
      return res.status(400).json({ error: 'This payroll month is closed. Reopen it before saving changes.' });
    }

    for (const line of lines) {
      await db.run(
        `INSERT INTO payroll_monthly
          (month_key, employee_id, gross_salary, allowances, bonuses, nssf_amount, nssf_employee_rate, nssf_employer_rate, employer_nssf_amount, taxable_income, paye_amount, other_deductions, salary_advances, total_deductions, net_salary, branch_id, computed_by, nssf_enabled, paye_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (month_key, employee_id) DO UPDATE SET
          gross_salary = EXCLUDED.gross_salary,
          allowances = EXCLUDED.allowances,
          bonuses = EXCLUDED.bonuses,
          nssf_amount = EXCLUDED.nssf_amount,
          nssf_employee_rate = EXCLUDED.nssf_employee_rate,
          nssf_employer_rate = EXCLUDED.nssf_employer_rate,
          employer_nssf_amount = EXCLUDED.employer_nssf_amount,
          taxable_income = EXCLUDED.taxable_income,
          paye_amount = EXCLUDED.paye_amount,
          other_deductions = EXCLUDED.other_deductions,
          salary_advances = EXCLUDED.salary_advances,
          total_deductions = EXCLUDED.total_deductions,
          net_salary = EXCLUDED.net_salary,
          branch_id = EXCLUDED.branch_id,
          computed_by = EXCLUDED.computed_by,
          nssf_enabled = EXCLUDED.nssf_enabled,
          paye_enabled = EXCLUDED.paye_enabled,
          computed_at = CURRENT_TIMESTAMP`,
        [
          month,
          Number(line.employee_id),
          parseMoney(line.gross_salary),
          parseMoney(line.allowances),
          parseMoney(line.bonuses),
          parseMoney(line.nssf_amount),
          parseMoney(line.nssf_employee_rate, 10),
          parseMoney(line.nssf_employer_rate, 10),
          parseMoney(line.employer_nssf_amount),
          parseMoney(line.taxable_income),
          parseMoney(line.paye_estimate ?? line.paye_amount),
          parseMoney(line.other_deductions),
          parseMoney(line.salary_advances),
          parseMoney(line.total_deductions),
          parseMoney(line.net_salary),
          null,
          req.user?.fullName || req.user?.username || 'Admin',
          line.nssf_enabled !== false,
          line.paye_enabled !== false
        ]
      );
    }

    if (markClosed) {
      await db.run(
        `INSERT INTO payroll_periods (month_key, status, completed_on, closed_at, closed_by)
         VALUES ($1, 'closed', $2::date, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (month_key) DO UPDATE SET
           status = 'closed',
           completed_on = EXCLUDED.completed_on,
           closed_at = CURRENT_TIMESTAMP,
           closed_by = EXCLUDED.closed_by`,
        [month, completedOnRaw, req.user?.fullName || req.user?.username || 'Admin']
      );
    }

    res.json({
      success: true,
      message: markClosed ? `Payroll closed for ${month}` : `Payroll saved for ${month}`,
      count: lines.length,
      period: markClosed
        ? { status: 'closed', completed_on: completedOnRaw }
        : { status: 'open', completed_on: null }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/monthly/reopen', requirePermission('canManagePayroll'), async (req, res) => {
  const month = monthKeyOrNow(req.body.month_key);
  try {
    const n = await db.run('DELETE FROM payroll_periods WHERE month_key = ?', [month]);
    if (!n.changes) {
      return res.json({
        success: true,
        message: `Payroll month ${month} is already open`,
        period: { status: 'open', completed_on: null }
      });
    }
    res.json({ success: true, message: `Payroll month ${month} reopened`, period: { status: 'open', completed_on: null } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
