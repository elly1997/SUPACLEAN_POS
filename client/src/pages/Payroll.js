import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createPayrollEmployee,
  getMonthlyPayroll,
  getPayrollEmployees,
  getPayrollHistory,
  getSavedMonthlyPayroll,
  getSalaryAdvances,
  reopenPayrollMonth,
  saveMonthlyPayroll,
  updatePayrollEmployee
} from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import useHorizontalScrollRegion from '../hooks/useHorizontalScrollRegion';
import './Payroll.css';

const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const estimateMonthlyPAYE = (x) => {
  const income = Math.max(0, Number(x || 0));
  // Tanzania monthly resident employment PAYE bands.
  if (income <= 270000) return 0;
  if (income <= 520000) return (income - 270000) * 0.08;
  if (income <= 760000) return 20000 + (income - 520000) * 0.2;
  if (income <= 1000000) return 68000 + (income - 760000) * 0.25;
  return 128000 + (income - 1000000) * 0.3;
};

const clampRate = (v, fallback = 10) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
};

const Payroll = () => {
  const { hasPermission } = useAuth();
  const { showToast, ToastContainer } = useToast();
  const canManagePayroll = hasPermission('canManagePayroll');
  const canRecordAdvances = hasPermission('canRecordSalaryAdvances');
  const [activeStep, setActiveStep] = useState(canManagePayroll ? 'verification' : 'inputs');
  const [monthKey, setMonthKey] = useState(monthNow());
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState('');
  const [selectedEmployeeStatement, setSelectedEmployeeStatement] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [staffDraft, setStaffDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);
  const [periodStatus, setPeriodStatus] = useState('open');
  const [completedOn, setCompletedOn] = useState('');
  const [markCompleted, setMarkCompleted] = useState(false);
  const tableScrollHandlers = useHorizontalScrollRegion();
  const verificationWrapRef = useRef(null);

  const [employeeForm, setEmployeeForm] = useState({
    full_name: '',
    employee_code: '',
    phone: '',
    gross_salary: '',
    default_allowances: '',
    default_bonuses: '',
    default_other_deductions: '',
    nssf_enabled: true,
    nssf_employee_rate: '10',
    nssf_employer_rate: '10',
    paye_enabled: true
  });

  const recomputeLine = (line) => {
    const gross = Number(line.gross_salary || 0);
    const allowances = Number(line.allowances || 0);
    const bonuses = Number(line.bonuses || 0);
    const advancesAmt = Number(line.salary_advances || 0);
    const other = Number(line.other_deductions || 0);
    const nssfEnabled = line.nssf_enabled !== false;
    const payeEnabled = line.paye_enabled !== false;
    const nssfEmployeeRate = clampRate(line.nssf_employee_rate, 10);
    const nssfEmployerRate = clampRate(line.nssf_employer_rate, 10);
    const nssfEmployeeAmount = nssfEnabled ? (gross * nssfEmployeeRate) / 100 : 0;
    const nssfEmployerAmount = nssfEnabled ? (gross * nssfEmployerRate) / 100 : 0;
    const taxableIncome = Math.max(0, gross + allowances + bonuses - nssfEmployeeAmount);
    const paye = payeEnabled ? estimateMonthlyPAYE(taxableIncome) : 0;
    const total = nssfEmployeeAmount + paye + advancesAmt + other;
    return {
      ...line,
      nssf_employee_rate: nssfEmployeeRate,
      nssf_employer_rate: nssfEmployerRate,
      nssf_amount: nssfEmployeeAmount,
      employer_nssf_amount: nssfEmployerAmount,
      taxable_income: taxableIncome,
      paye_estimate: paye,
      total_deductions: total,
      net_salary: gross + allowances + bonuses - total,
      total_employer_cost: gross + allowances + bonuses + nssfEmployerAmount
    };
  };

  const load = async () => {
    if (!canManagePayroll && !canRecordAdvances) return;
    setLoading(true);
    try {
      const calls = [];
      if (canManagePayroll) calls.push(getPayrollEmployees(), getMonthlyPayroll(monthKey), getPayrollHistory({ limit: 48 }));
      if (canRecordAdvances) calls.push(getSalaryAdvances({ month: monthKey }));
      const results = await Promise.all(calls);
      let idx = 0;
      if (canManagePayroll) {
        setEmployees(results[idx++].data || []);
        const monthlyRes = results[idx++];
        const monthlyData = monthlyRes.data || {};
        setPayroll((monthlyData.lines || []).map(recomputeLine));
        const p = monthlyData.period;
        setPeriodStatus(p?.status === 'closed' ? 'closed' : 'open');
        setCompletedOn(p?.completed_on ? String(p.completed_on).slice(0, 10) : '');
        setMarkCompleted(false);
        const h = results[idx++].data || [];
        setPayrollHistory(h);
        if (h.length > 0) setSelectedHistoryMonth((prev) => (prev && h.some((x) => x.month_key === prev) ? prev : h[0].month_key));
      }
      if (canRecordAdvances) {
        setAdvances(results[idx++].data || []);
      }
    } catch (err) {
      showToast(`Error loading payroll: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [monthKey, canManagePayroll, canRecordAdvances]);

  const employeeOptions = useMemo(() => employees.map((e) => ({ id: e.id, name: e.full_name })), [employees]);
  const filteredEmployees = useMemo(() => {
    const q = String(staffSearch || '').trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const fullName = String(e.full_name || '').toLowerCase();
      const code = String(e.employee_code || '').toLowerCase();
      const phone = String(e.phone || '').toLowerCase();
      return fullName.includes(q) || code.includes(q) || phone.includes(q);
    });
  }, [employees, staffSearch]);
  const totalEmployees = employees.length;
  const processedEmployees = payroll.length;
  const remainingEmployees = Math.max(0, totalEmployees - processedEmployees);
  const advancesTotal = advances.reduce((sum, a) => sum + Number(a.amount || 0), 0);

  const submitEmployee = async (e) => {
    e.preventDefault();
    try {
      await createPayrollEmployee({
        ...employeeForm,
        tin_number: employeeForm.employee_code || null,
        gross_salary: Number(employeeForm.gross_salary || 0),
        default_allowances: Number(employeeForm.default_allowances || 0),
        default_bonuses: Number(employeeForm.default_bonuses || 0),
        default_other_deductions: Number(employeeForm.default_other_deductions || 0),
        nssf_employee_rate: clampRate(employeeForm.nssf_employee_rate, 10),
        nssf_employer_rate: clampRate(employeeForm.nssf_employer_rate, 10)
      });
      showToast('Employee added', 'success');
      setEmployeeForm({
        full_name: '',
        employee_code: '',
        phone: '',
        gross_salary: '',
        default_allowances: '',
        default_bonuses: '',
        default_other_deductions: '',
        nssf_enabled: true,
        nssf_employee_rate: '10',
        nssf_employer_rate: '10',
        paye_enabled: true
      });
      load();
    } catch (err) {
      showToast(`Error adding employee: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const startEditStaff = (emp) => {
    setEditingStaffId(emp.id);
    setStaffDraft({
      full_name: emp.full_name || '',
      employee_code: emp.employee_code || '',
      phone: emp.phone || '',
      gross_salary: Number(emp.gross_salary || 0),
      nssf_enabled: !!emp.nssf_enabled,
      paye_enabled: !!emp.paye_enabled,
      is_active: !!emp.is_active
    });
  };

  const cancelEditStaff = () => {
    setEditingStaffId(null);
    setStaffDraft({});
  };

  const saveEditStaff = async () => {
    if (!editingStaffId) return;
    setSavingStaff(true);
    try {
      await updatePayrollEmployee(editingStaffId, {
        ...staffDraft,
        tin_number: staffDraft.employee_code || null
      });
      showToast('Staff details updated', 'success');
      cancelEditStaff();
      load();
    } catch (err) {
      showToast(`Error updating staff: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSavingStaff(false);
    }
  };

  const savePayroll = async () => {
    if (periodStatus === 'closed') return;
    if (markCompleted && !completedOn) {
      showToast('Choose the payroll completion date before saving as closed', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveMonthlyPayroll({
        month_key: monthKey,
        lines: payroll,
        mark_closed: markCompleted,
        completed_on: markCompleted ? completedOn : undefined
      });
      showToast(markCompleted ? 'Payroll saved and marked closed' : 'Monthly payroll saved', 'success');
      setMarkCompleted(false);
      load();
    } catch (err) {
      showToast(`Error saving payroll: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const reopenPayroll = async () => {
    if (periodStatus !== 'closed') return;
    if (!window.confirm('Reopen this payroll month? You can edit figures again; saving will update the stored payroll.')) return;
    setReopening(true);
    try {
      await reopenPayrollMonth(monthKey);
      showToast('Payroll month reopened', 'success');
      load();
    } catch (err) {
      showToast(`Error reopening: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setReopening(false);
    }
  };

  const downloadFile = (filename, content, mime = 'text/plain;charset=utf-8') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionLoadLines = async () => {
    const month = selectedHistoryMonth || monthKey;
    const res = await getSavedMonthlyPayroll(month);
    return res?.data?.lines || [];
  };

  const handleSalaryStatement = async () => {
    try {
      const lines = await actionLoadLines();
      if (!lines.length) return showToast('No saved payroll lines for selected month', 'error');
      const totalNet = lines.reduce((s, r) => s + Number(r.net_salary || 0), 0);
      const totalPaye = lines.reduce((s, r) => s + Number(r.paye_amount || 0), 0);
      const text = [
        `SUPACLEAN Payroll Statement (${selectedHistoryMonth || monthKey})`,
        `Employees: ${lines.length}`,
        `Total Net: TSh ${totalNet.toLocaleString()}`,
        `Total PAYE: TSh ${totalPaye.toLocaleString()}`,
        '',
        ...lines.map((r) => `${r.full_name} | Gross ${Number(r.gross_salary || 0).toLocaleString()} | Net ${Number(r.net_salary || 0).toLocaleString()}`)
      ].join('\n');
      downloadFile(`payroll-statement-${selectedHistoryMonth || monthKey}.txt`, text);
      showToast('Salary statement exported', 'success');
    } catch (err) {
      showToast(`Error generating statement: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const handleBankTransfer = async () => {
    try {
      const lines = await actionLoadLines();
      if (!lines.length) return showToast('No saved payroll lines for selected month', 'error');
      const csv = [
        'Employee,Employee Code,Net Salary',
        ...lines.map((r) => `"${(r.full_name || '').replace(/"/g, '""')}","${r.employee_code || ''}","${Number(r.net_salary || 0).toFixed(2)}"`)
      ].join('\n');
      downloadFile(`bank-transfer-${selectedHistoryMonth || monthKey}.csv`, csv, 'text/csv;charset=utf-8');
      showToast('Bank transfer file generated', 'success');
    } catch (err) {
      showToast(`Error generating transfer: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const handlePayslips = async () => {
    try {
      const lines = await actionLoadLines();
      if (!lines.length) return showToast('No saved payroll lines for selected month', 'error');
      const slips = lines.map((r) => ([
        '--- PAYSLIP ---',
        `Month: ${selectedHistoryMonth || monthKey}`,
        `Employee: ${r.full_name}`,
        `Gross: TSh ${Number(r.gross_salary || 0).toLocaleString()}`,
        `Allowances: TSh ${Number(r.allowances || 0).toLocaleString()}`,
        `Bonuses: TSh ${Number(r.bonuses || 0).toLocaleString()}`,
        `Employee NSSF: TSh ${Number(r.nssf_amount || 0).toLocaleString()}`,
        `Employer NSSF: TSh ${Number(r.employer_nssf_amount || 0).toLocaleString()}`,
        `PAYE: TSh ${Number(r.paye_amount || r.paye_estimate || 0).toLocaleString()}`,
        `Advances: TSh ${Number(r.salary_advances || 0).toLocaleString()}`,
        `Other Deductions: TSh ${Number(r.other_deductions || 0).toLocaleString()}`,
        `Net Salary: TSh ${Number(r.net_salary || 0).toLocaleString()}`,
        ''
      ].join('\n'))).join('\n');
      downloadFile(`payslips-${selectedHistoryMonth || monthKey}.txt`, slips);
      showToast('Payslips exported', 'success');
    } catch (err) {
      showToast(`Error generating payslips: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const handlePayrollSpreadsheet = async () => {
    try {
      const lines = await actionLoadLines();
      if (!lines.length) return showToast('No saved payroll lines for selected month', 'error');
      const month = selectedHistoryMonth || monthKey;
      const ExcelJS = (await import(/* webpackChunkName: "lib-exceljs" */ 'exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Payroll');
      sheet.addRow([
        'Employee',
        'Employee Code',
        'Gross Salary',
        'Allowances',
        'Bonuses',
        'Employee NSSF',
        'Employer NSSF',
        'PAYE',
        'Salary Advances',
        'Other Deductions',
        'Net Salary',
        'Employer Total Cost'
      ]);
      lines.forEach((r) => {
        sheet.addRow([
          r.full_name || '',
          r.employee_code || '',
          Number(r.gross_salary || 0),
          Number(r.allowances || 0),
          Number(r.bonuses || 0),
          Number(r.nssf_amount || 0),
          Number(r.employer_nssf_amount || 0),
          Number(r.paye_amount || r.paye_estimate || 0),
          Number(r.salary_advances || 0),
          Number(r.other_deductions || 0),
          Number(r.net_salary || 0),
          Number(r.total_employer_cost || 0)
        ]);
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-spreadsheet-${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Payroll spreadsheet exported (Excel)', 'success');
    } catch (err) {
      showToast(`Error exporting spreadsheet: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const handleEmployeeStatement = async () => {
    try {
      if (!selectedEmployeeStatement) {
        showToast('Select an employee first', 'error');
        return;
      }
      const lines = await actionLoadLines();
      if (!lines.length) return showToast('No saved payroll lines for selected month', 'error');
      const line = lines.find((r) => String(r.employee_id) === String(selectedEmployeeStatement));
      if (!line) return showToast('No payroll line for selected employee in this month', 'error');
      const month = selectedHistoryMonth || monthKey;
      const employeeAdvances = advances.filter(
        (a) => String(a.employee_id) === String(selectedEmployeeStatement)
      );
      const text = [
        `SUPACLEAN Employee Salary Statement (${month})`,
        `Employee: ${line.full_name}`,
        `Employee Code: ${line.employee_code || '-'}`,
        '',
        `Gross Salary: TSh ${Number(line.gross_salary || 0).toLocaleString()}`,
        `Allowances: TSh ${Number(line.allowances || 0).toLocaleString()}`,
        `Bonuses: TSh ${Number(line.bonuses || 0).toLocaleString()}`,
        `Employee NSSF: TSh ${Number(line.nssf_amount || 0).toLocaleString()}`,
        `Employer NSSF: TSh ${Number(line.employer_nssf_amount || 0).toLocaleString()}`,
        `PAYE: TSh ${Number(line.paye_amount || line.paye_estimate || 0).toLocaleString()}`,
        `Salary Advances: TSh ${Number(line.salary_advances || 0).toLocaleString()}`,
        `Other Deductions: TSh ${Number(line.other_deductions || 0).toLocaleString()}`,
        `Net Salary: TSh ${Number(line.net_salary || 0).toLocaleString()}`,
        '',
        'Advances Detail:',
        ...(employeeAdvances.length
          ? employeeAdvances.map((a) => `- ${a.advance_date}: TSh ${Number(a.amount || 0).toLocaleString()}${a.notes ? ` (${a.notes})` : ''}`)
          : ['- No advances recorded for this month'])
      ].join('\n');
      const safeName = String(line.full_name || 'employee').replace(/\s+/g, '-').toLowerCase();
      downloadFile(`salary-statement-${safeName}-${month}.txt`, text);
      showToast('Employee statement exported', 'success');
    } catch (err) {
      showToast(`Error generating employee statement: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const exportStaffDirectory = () => {
    if (!employees.length) {
      showToast('No staff to export', 'error');
      return;
    }
    const csv = [
      'Full Name,Employee Code,Phone,Gross Salary,NSSF,PAYE,Status',
      ...employees.map((e) => [
        `"${String(e.full_name || '').replace(/"/g, '""')}"`,
        `"${String(e.employee_code || '').replace(/"/g, '""')}"`,
        `"${String(e.phone || '').replace(/"/g, '""')}"`,
        Number(e.gross_salary || 0).toFixed(2),
        e.nssf_enabled ? 'Enabled' : 'Disabled',
        e.paye_enabled ? 'Enabled' : 'Disabled',
        e.is_active ? 'Active' : 'Inactive'
      ].join(','))
    ].join('\n');
    downloadFile(`staff-directory-${monthKey}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('Staff directory exported', 'success');
  };

  const updateLineField = (employeeId, key, value, numeric = true) => {
    setPayroll((prev) =>
      prev.map((row) => {
        if (row.employee_id !== employeeId) return row;
        const next = { ...row, [key]: numeric ? Number(value || 0) : value };
        return recomputeLine(next);
      })
    );
  };

  const stopDragBubbling = (e) => e.stopPropagation();

  const scrollVerificationX = (delta) => {
    const el = verificationWrapRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  if (!canManagePayroll && !canRecordAdvances) {
    return <div className="page-card"><h2>Payroll</h2><p>You do not have payroll access.</p></div>;
  }

  return (
    <div className="payroll-page">
      <ToastContainer />
      <div className="payroll-header">
        <div className="payroll-header-text">
          <h1>Payroll Process</h1>
          <p className="subtitle">Manage salary inputs, advances, and monthly run outputs</p>
        </div>
        <input className="payroll-month-input" type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
      </div>

      <div className="payroll-steps">
        <button type="button" className={`payroll-step ${activeStep === 'inputs' ? 'active' : ''}`} onClick={() => setActiveStep('inputs')}>
          Payroll Inputs
        </button>
        {canManagePayroll && (
          <>
            <button type="button" className={`payroll-step ${activeStep === 'verification' ? 'active' : ''}`} onClick={() => setActiveStep('verification')}>
              Data Verification
            </button>
            <button type="button" className={`payroll-step ${activeStep === 'run' ? 'active' : ''}`} onClick={() => setActiveStep('run')}>
              Run Payroll
            </button>
          </>
        )}
      </div>

      <div className="payroll-summary-grid">
        <div className="payroll-summary-card">
          <div className="label">Payroll Month</div>
          <div className="value">{monthKey}</div>
        </div>
        <div className="payroll-summary-card">
          <div className="label">Payroll Status</div>
          <div className="value payroll-status-value">
            <span className={`payroll-badge ${periodStatus === 'closed' ? 'closed' : 'open'}`}>
              {loading ? '…' : periodStatus === 'closed' ? 'Closed' : 'Open'}
            </span>
            {periodStatus === 'closed' && completedOn && (
              <div className="payroll-completed-date">Completed {completedOn}</div>
            )}
          </div>
        </div>
        <div className="payroll-summary-card">
          <div className="label">Processed Employees</div>
          <div className="value">{processedEmployees}</div>
        </div>
        <div className="payroll-summary-card">
          <div className="label">Remaining Employees</div>
          <div className="value">{remainingEmployees}</div>
        </div>
        <div className="payroll-summary-card">
          <div className="label">Salary Advances ({monthKey})</div>
          <div className="value">TSh {advancesTotal.toLocaleString()}</div>
        </div>
      </div>

      {canManagePayroll && activeStep === 'inputs' && (
        <div className="payroll-card">
          <h3>Add Employee</h3>
          <form onSubmit={submitEmployee} className="payroll-form-grid">
            <input required placeholder="Full name" value={employeeForm.full_name} onChange={(e) => setEmployeeForm({ ...employeeForm, full_name: e.target.value })} />
            <input placeholder="Employee code" value={employeeForm.employee_code} onChange={(e) => setEmployeeForm({ ...employeeForm, employee_code: e.target.value })} />
            <input placeholder="Phone" value={employeeForm.phone} onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })} />
            <input type="number" required placeholder="Gross salary" value={employeeForm.gross_salary} onChange={(e) => setEmployeeForm({ ...employeeForm, gross_salary: e.target.value })} />
            <input type="number" placeholder="Allowances" value={employeeForm.default_allowances} onChange={(e) => setEmployeeForm({ ...employeeForm, default_allowances: e.target.value })} />
            <input type="number" placeholder="Bonuses" value={employeeForm.default_bonuses} onChange={(e) => setEmployeeForm({ ...employeeForm, default_bonuses: e.target.value })} />
            <input type="number" placeholder="Other deductions" value={employeeForm.default_other_deductions} onChange={(e) => setEmployeeForm({ ...employeeForm, default_other_deductions: e.target.value })} />
            <div className="payroll-toggle-wrap">
              <label><input type="checkbox" checked={employeeForm.nssf_enabled} onMouseDown={stopDragBubbling} onClick={stopDragBubbling} onChange={(e) => setEmployeeForm({ ...employeeForm, nssf_enabled: e.target.checked })} /> NSSF</label>
              <input type="number" min="0" max="100" step="0.01" placeholder="NSSF employee %" value={employeeForm.nssf_employee_rate} onChange={(e) => setEmployeeForm({ ...employeeForm, nssf_employee_rate: e.target.value })} />
              <input type="number" min="0" max="100" step="0.01" placeholder="NSSF employer %" value={employeeForm.nssf_employer_rate} onChange={(e) => setEmployeeForm({ ...employeeForm, nssf_employer_rate: e.target.value })} />
              <label><input type="checkbox" checked={employeeForm.paye_enabled} onMouseDown={stopDragBubbling} onClick={stopDragBubbling} onChange={(e) => setEmployeeForm({ ...employeeForm, paye_enabled: e.target.checked })} /> PAYE</label>
            </div>
            <button className="btn-primary payroll-submit-btn" type="submit">Add employee</button>
          </form>
        </div>
      )}

      {canManagePayroll && activeStep === 'inputs' && (
        <div className="payroll-card">
          <div className="payroll-card-head">
            <h3>All Staff Directory</h3>
            <div className="payroll-staff-controls">
              <input
                className="payroll-search-input"
                type="search"
                placeholder="Search name / code / TIN / phone"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                aria-label="Search staff"
              />
              <button type="button" className="payroll-action-btn transfer" onClick={exportStaffDirectory}>
                Export Staff CSV
              </button>
              <span className="payroll-count-chip">{filteredEmployees.length} staff</span>
            </div>
          </div>
          <div
            className="payroll-table-wrap staff-wrap interactive-scroll-region"
            tabIndex={0}
            role="region"
            aria-label="All staff details table"
            {...tableScrollHandlers}
          >
            <table className="payroll-table payroll-table--staff">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Employee Code</th>
                  <th>Phone</th>
                  <th className="num">Gross Salary</th>
                  <th>NSSF</th>
                  <th>PAYE</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      {editingStaffId === emp.id ? (
                        <input
                          type="text"
                          value={staffDraft.full_name || ''}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, full_name: e.target.value }))}
                        />
                      ) : emp.full_name}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <input
                          type="text"
                          value={staffDraft.employee_code || ''}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, employee_code: e.target.value }))}
                        />
                      ) : (emp.employee_code || '-')}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <input
                          type="text"
                          value={staffDraft.phone || ''}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, phone: e.target.value }))}
                        />
                      ) : (emp.phone || '-')}
                    </td>
                    <td className="num">
                      {editingStaffId === emp.id ? (
                        <input
                          type="number"
                          value={staffDraft.gross_salary ?? 0}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, gross_salary: Number(e.target.value || 0) }))}
                        />
                      ) : Number(emp.gross_salary || 0).toLocaleString()}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <input
                          type="checkbox"
                          checked={!!staffDraft.nssf_enabled}
                          onMouseDown={stopDragBubbling}
                          onClick={stopDragBubbling}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, nssf_enabled: e.target.checked }))}
                        />
                      ) : (emp.nssf_enabled ? 'Enabled' : 'Disabled')}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <input
                          type="checkbox"
                          checked={!!staffDraft.paye_enabled}
                          onMouseDown={stopDragBubbling}
                          onClick={stopDragBubbling}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, paye_enabled: e.target.checked }))}
                        />
                      ) : (emp.paye_enabled ? 'Enabled' : 'Disabled')}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <select
                          value={staffDraft.is_active ? 'active' : 'inactive'}
                          onChange={(e) => setStaffDraft((p) => ({ ...p, is_active: e.target.value === 'active' }))}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (emp.is_active ? 'Active' : 'Inactive')}
                    </td>
                    <td>
                      {editingStaffId === emp.id ? (
                        <div className="staff-row-actions">
                          <button type="button" className="btn-primary" disabled={savingStaff} onClick={saveEditStaff}>
                            {savingStaff ? 'Saving...' : 'Save'}
                          </button>
                          <button type="button" className="btn-secondary" onClick={cancelEditStaff}>Cancel</button>
                        </div>
                      ) : (
                        <button type="button" className="btn-secondary" onClick={() => startEditStaff(emp)}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={9}>{loading ? 'Loading staff...' : 'No staff recorded yet'}</td>
                  </tr>
                )}
                {employees.length > 0 && filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={9}>No staff matched your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManagePayroll && activeStep === 'verification' && (
        <div className="payroll-card">
          <div className="payroll-card-head">
            <h3>Monthly Payroll ({monthKey})</h3>
            <div className="verification-head-actions">
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => scrollVerificationX(-320)}
                title="Scroll left"
              >
                ◀ Left
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => scrollVerificationX(320)}
                title="Scroll right"
              >
                Right ▶
              </button>
              {periodStatus === 'closed' ? (
                <button type="button" className="btn-secondary" onClick={reopenPayroll} disabled={reopening || loading}>
                  {reopening ? 'Reopening…' : 'Reopen payroll'}
                </button>
              ) : (
                <button className="btn-primary" onClick={savePayroll} disabled={saving || loading}>
                  {saving ? 'Saving…' : markCompleted ? 'Save & close payroll' : 'Save payroll'}
                </button>
              )}
            </div>
          </div>
          {periodStatus === 'closed' && (
            <div className="payroll-period-banner">
              This month is closed and figures are frozen from the last save. Reopen above to change amounts.
            </div>
          )}
          {periodStatus === 'open' && (
            <div className="payroll-close-row">
              <label className="payroll-mark-complete">
                <input
                  type="checkbox"
                  checked={markCompleted}
                  onMouseDown={stopDragBubbling}
                  onClick={stopDragBubbling}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setMarkCompleted(v);
                    if (v && !completedOn) setCompletedOn(todayYmd());
                  }}
                />
                Mark payroll completed (requires completion date)
              </label>
              {markCompleted && (
                <label className="payroll-inline-date">
                  Payroll date
                  <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
                </label>
              )}
            </div>
          )}
          <div className="payroll-note">
            Open months auto-generate from active staff and advances. Saving stores a snapshot; closing locks the month for exports.
            PAYE follows Tanzania monthly bands on taxable income after employee NSSF. NSSF amounts use each employee&apos;s profile rates (shown as Emp NSSF / Er NSSF).
          </div>
          <div
            className="payroll-table-wrap verification-wrap interactive-scroll-region"
            ref={verificationWrapRef}
            tabIndex={0}
            role="region"
            aria-label="Monthly payroll table"
            {...tableScrollHandlers}
          >
            <table className="payroll-table payroll-table--verification payroll-table--compact">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Gross</th>
                  <th className="num">Bonus</th>
                  <th>NSSF On</th>
                  <th className="num">Emp NSSF</th>
                  <th className="num">Er NSSF</th>
                  <th className="num">Taxable</th>
                  <th>PAYE On</th>
                  <th className="num">PAYE Est.</th>
                  <th className="num">Advances</th>
                  <th className="num">Other Ded.</th>
                  <th className="num">Net</th>
                  <th className="num">Employer Cost</th>
                </tr>
              </thead>
              <tbody>
                {payroll.map((r) => (
                  <tr key={r.employee_id}>
                    <td>{r.full_name}</td>
                    <td className="num"><input type="number" disabled={periodStatus === 'closed'} value={r.gross_salary || 0} onChange={(e) => updateLineField(r.employee_id, 'gross_salary', e.target.value)} /></td>
                    <td className="num"><input type="number" disabled={periodStatus === 'closed'} value={r.bonuses || 0} onChange={(e) => updateLineField(r.employee_id, 'bonuses', e.target.value)} /></td>
                    <td><input type="checkbox" disabled={periodStatus === 'closed'} checked={r.nssf_enabled !== false} onMouseDown={stopDragBubbling} onClick={stopDragBubbling} onChange={(e) => updateLineField(r.employee_id, 'nssf_enabled', e.target.checked, false)} /></td>
                    <td className="num">{Number(r.nssf_amount || 0).toLocaleString()}</td>
                    <td className="num">{Number(r.employer_nssf_amount || 0).toLocaleString()}</td>
                    <td className="num">{Number(r.taxable_income || 0).toLocaleString()}</td>
                    <td><input type="checkbox" disabled={periodStatus === 'closed'} checked={r.paye_enabled !== false} onMouseDown={stopDragBubbling} onClick={stopDragBubbling} onChange={(e) => updateLineField(r.employee_id, 'paye_enabled', e.target.checked, false)} /></td>
                    <td className="num">{Number(r.paye_estimate || 0).toLocaleString()}</td>
                    <td className="num">{Number(r.salary_advances || 0).toLocaleString()}</td>
                    <td className="num"><input type="number" disabled={periodStatus === 'closed'} value={r.other_deductions || 0} onChange={(e) => updateLineField(r.employee_id, 'other_deductions', e.target.value)} /></td>
                    <td className="num"><strong>{Number(r.net_salary || 0).toLocaleString()}</strong></td>
                    <td className="num"><strong>{Number(r.total_employer_cost || 0).toLocaleString()}</strong></td>
                  </tr>
                ))}
                {payroll.length === 0 && <tr><td colSpan={13}>{loading ? 'Loading payroll rows...' : 'No payroll rows'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManagePayroll && activeStep === 'run' && (
        <div className="payroll-card">
          <div className="payroll-card-head">
            <h3>Run Payroll History</h3>
            <div className="payroll-history-month-picker">
              <label className="payroll-history-month-label" htmlFor="payroll-history-month">
                Month with saved payroll
              </label>
              <select
                id="payroll-history-month"
                value={selectedHistoryMonth}
                onChange={(e) => setSelectedHistoryMonth(e.target.value)}
              >
                <option value="">Select month...</option>
                {payrollHistory.map((h) => (
                  <option key={h.month_key} value={h.month_key}>
                    {h.month_key}
                    {h.payroll_status === 'Closed' ? ' — Closed' : ' — Open'}
                    {h.completed_on ? ` (${h.completed_on})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="payroll-table-wrap history-wrap interactive-scroll-region"
            tabIndex={0}
            role="region"
            aria-label="Payroll history table"
            {...tableScrollHandlers}
          >
            <table className="payroll-table payroll-table--history">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Payroll Runs</th>
                  <th className="num">Processed Employees</th>
                  <th className="num">Total Net</th>
                  <th>Payroll Status</th>
                  <th>Completed on</th>
                  <th>Salary Statement</th>
                  <th>Bank Transfer</th>
                </tr>
              </thead>
              <tbody>
                {payrollHistory.map((h) => (
                  <tr key={h.month_key}>
                    <td>{h.month_key}</td>
                    <td className="num">{Number(h.payroll_runs || 0)}</td>
                    <td className="num">{Number(h.processed_employees || 0)}</td>
                    <td className="num">TSh {Number(h.total_net_salary || 0).toLocaleString()}</td>
                    <td><span className={`payroll-badge ${String(h.payroll_status).toLowerCase()}`}>{h.payroll_status}</span></td>
                    <td>{h.completed_on || '—'}</td>
                    <td><span className="payroll-badge approved">{h.salary_statement_status}</span></td>
                    <td><span className="payroll-badge pending">{h.bank_transfer_status}</span></td>
                  </tr>
                ))}
                {payrollHistory.length === 0 && <tr><td colSpan={8}>No payroll history yet — save payroll in Data Verification to create a month.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="payroll-action-bar">
            <button type="button" className="payroll-action-btn statement" onClick={handleSalaryStatement}>Salary Statement</button>
            <button type="button" className="payroll-action-btn transfer" onClick={handleBankTransfer}>Generate Bank Transfer</button>
            <button type="button" className="payroll-action-btn slips" onClick={handlePayslips}>Get Payslips</button>
            <button type="button" className="payroll-action-btn transfer" onClick={handlePayrollSpreadsheet}>Export Payroll (Excel)</button>
          </div>
          <div className="payroll-card-head" style={{ marginTop: 12 }}>
            <h3>Employee Statement</h3>
            <div className="employee-statement-controls">
              <select value={selectedEmployeeStatement} onChange={(e) => setSelectedEmployeeStatement(e.target.value)}>
                <option value="">Select employee...</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
              <button type="button" className="payroll-action-btn statement" onClick={handleEmployeeStatement}>Export Employee Statement</button>
            </div>
          </div>
        </div>
      )}

      {canRecordAdvances && (
        <div className="payroll-card">
          <h3>Salary Advances ({monthKey})</h3>
          <div
            className="payroll-table-wrap advances-wrap interactive-scroll-region"
            tabIndex={0}
            role="region"
            aria-label="Salary advances table"
            {...tableScrollHandlers}
          >
            <table className="payroll-table payroll-table--advances">
              <thead><tr><th>Date</th><th>Employee</th><th className="num">Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {advances.map((a) => (
                  <tr key={a.id}>
                    <td>{a.advance_date}</td>
                    <td>{a.full_name}</td>
                    <td className="num">{Number(a.amount || 0).toLocaleString()}</td>
                    <td>{a.notes || '-'}</td>
                  </tr>
                ))}
                {advances.length === 0 && <tr><td colSpan={4}>{loading ? 'Loading salary advances...' : 'No advances recorded'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payroll;
