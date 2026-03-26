import React, { useEffect, useMemo, useState } from 'react';
import {
  createPayrollEmployee,
  createSalaryAdvance,
  getMonthlyPayroll,
  getPayrollEmployees,
  getPayrollHistory,
  getSavedMonthlyPayroll,
  getSalaryAdvances,
  saveMonthlyPayroll
} from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import './Payroll.css';

const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const estimateMonthlyPAYE = (x) => {
  const income = Math.max(0, Number(x || 0));
  if (income <= 270000) return 0;
  if (income <= 520000) return (income - 270000) * 0.08;
  if (income <= 760000) return 20000 + (income - 520000) * 0.2;
  if (income <= 1000000) return 68000 + (income - 760000) * 0.25;
  return 128000 + (income - 1000000) * 0.3;
};

const Payroll = () => {
  const { hasPermission } = useAuth();
  const { showToast, ToastContainer } = useToast();
  const canManagePayroll = hasPermission('canManagePayroll');
  const canRecordAdvances = hasPermission('canRecordSalaryAdvances');
  const [monthKey, setMonthKey] = useState(monthNow());
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [employeeForm, setEmployeeForm] = useState({
    full_name: '',
    employee_code: '',
    phone: '',
    gross_salary: '',
    default_allowances: '',
    default_bonuses: '',
    default_other_deductions: '',
    nssf_enabled: true,
    paye_enabled: true
  });

  const [advanceForm, setAdvanceForm] = useState({
    employee_id: '',
    advance_date: new Date().toISOString().split('T')[0],
    amount: '',
    notes: ''
  });

  const recomputeLine = (line) => {
    const gross = Number(line.gross_salary || 0);
    const allowances = Number(line.allowances || 0);
    const bonuses = Number(line.bonuses || 0);
    const advancesAmt = Number(line.salary_advances || 0);
    const other = Number(line.other_deductions || 0);
    const nssf = Number(line.nssf_amount || 0);
    const paye = estimateMonthlyPAYE(Math.max(0, gross + allowances + bonuses - nssf));
    const total = nssf + paye + advancesAmt + other;
    return { ...line, paye_estimate: paye, total_deductions: total, net_salary: gross + allowances + bonuses - total };
  };

  const load = async () => {
    if (!canManagePayroll && !canRecordAdvances) return;
    setLoading(true);
    try {
      const calls = [];
      if (canManagePayroll) calls.push(getPayrollEmployees(), getMonthlyPayroll(monthKey), getPayrollHistory({ limit: 24 }));
      if (canRecordAdvances) calls.push(getSalaryAdvances({ month: monthKey }));
      const results = await Promise.all(calls);
      let idx = 0;
      if (canManagePayroll) {
        setEmployees(results[idx++].data || []);
        setPayroll(results[idx++].data?.lines || []);
        const h = results[idx++].data || [];
        setPayrollHistory(h);
        if (h.length > 0) setSelectedHistoryMonth((prev) => prev || h[0].month_key);
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
  const totalEmployees = employees.length;
  const processedEmployees = payroll.length;
  const remainingEmployees = Math.max(0, totalEmployees - processedEmployees);
  const advancesTotal = advances.reduce((sum, a) => sum + Number(a.amount || 0), 0);

  const submitEmployee = async (e) => {
    e.preventDefault();
    try {
      await createPayrollEmployee({
        ...employeeForm,
        gross_salary: Number(employeeForm.gross_salary || 0),
        default_allowances: Number(employeeForm.default_allowances || 0),
        default_bonuses: Number(employeeForm.default_bonuses || 0),
        default_other_deductions: Number(employeeForm.default_other_deductions || 0)
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
        paye_enabled: true
      });
      load();
    } catch (err) {
      showToast(`Error adding employee: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const submitAdvance = async (e) => {
    e.preventDefault();
    try {
      await createSalaryAdvance({
        employee_id: Number(advanceForm.employee_id),
        advance_date: advanceForm.advance_date,
        amount: Number(advanceForm.amount || 0),
        notes: advanceForm.notes
      });
      showToast('Salary advance recorded', 'success');
      setAdvanceForm((s) => ({ ...s, amount: '', notes: '' }));
      load();
    } catch (err) {
      showToast(`Error recording advance: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  const savePayroll = async () => {
    setSaving(true);
    try {
      await saveMonthlyPayroll({ month_key: monthKey, lines: payroll });
      showToast('Monthly payroll saved', 'success');
    } catch (err) {
      showToast(`Error saving payroll: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSaving(false);
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
        `NSSF: TSh ${Number(r.nssf_amount || 0).toLocaleString()}`,
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

  const updateLineMoney = (employeeId, key, value) => {
    setPayroll((prev) =>
      prev.map((row) => {
        if (row.employee_id !== employeeId) return row;
        const next = { ...row, [key]: Number(value || 0) };
        return recomputeLine(next);
      })
    );
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
        <span className={`payroll-step ${canManagePayroll ? 'active' : ''}`}>Payroll Inputs</span>
        <span className={`payroll-step ${canManagePayroll ? 'active' : ''}`}>Data Verification</span>
        <span className={`payroll-step ${canManagePayroll ? 'active' : ''}`}>Run Payroll</span>
      </div>

      <div className="payroll-summary-grid">
        <div className="payroll-summary-card">
          <div className="label">Payroll Month</div>
          <div className="value">{monthKey}</div>
        </div>
        <div className="payroll-summary-card">
          <div className="label">Payroll Status</div>
          <div className="value">
            <span className="payroll-badge open">{saving ? 'Saving' : 'Open'}</span>
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

      {canManagePayroll && (
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
              <label><input type="checkbox" checked={employeeForm.nssf_enabled} onChange={(e) => setEmployeeForm({ ...employeeForm, nssf_enabled: e.target.checked })} /> NSSF</label>
              <label><input type="checkbox" checked={employeeForm.paye_enabled} onChange={(e) => setEmployeeForm({ ...employeeForm, paye_enabled: e.target.checked })} /> PAYE</label>
            </div>
            <button className="btn-primary payroll-submit-btn" type="submit">Add employee</button>
          </form>
        </div>
      )}

      {canManagePayroll && (
        <div className="payroll-card">
          <div className="payroll-card-head">
            <h3>Run Payroll History</h3>
            <select value={selectedHistoryMonth} onChange={(e) => setSelectedHistoryMonth(e.target.value)}>
              <option value="">Select month...</option>
              {payrollHistory.map((h) => (
                <option key={h.month_key} value={h.month_key}>{h.month_key}</option>
              ))}
            </select>
          </div>
          <div className="payroll-table-wrap">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Payroll Runs</th>
                  <th className="num">Processed Employees</th>
                  <th className="num">Total Net</th>
                  <th>Payroll Status</th>
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
                    <td><span className="payroll-badge approved">{h.salary_statement_status}</span></td>
                    <td><span className="payroll-badge pending">{h.bank_transfer_status}</span></td>
                  </tr>
                ))}
                {payrollHistory.length === 0 && <tr><td colSpan={7}>No payroll history yet</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="payroll-action-bar">
            <button type="button" className="payroll-action-btn statement" onClick={handleSalaryStatement}>Salary Statement</button>
            <button type="button" className="payroll-action-btn transfer" onClick={handleBankTransfer}>Generate Bank Transfer</button>
            <button type="button" className="payroll-action-btn slips" onClick={handlePayslips}>Get Payslips</button>
          </div>
        </div>
      )}

      {canRecordAdvances && (
        <div className="payroll-card">
          <h3>Record Salary Advance</h3>
          <form onSubmit={submitAdvance} className="payroll-form-grid">
            <select required value={advanceForm.employee_id} onChange={(e) => setAdvanceForm({ ...advanceForm, employee_id: e.target.value })}>
              <option value="">Select employee</option>
              {employeeOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input type="date" required value={advanceForm.advance_date} onChange={(e) => setAdvanceForm({ ...advanceForm, advance_date: e.target.value })} />
            <input type="number" required placeholder="Amount" value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })} />
            <input placeholder="Notes" value={advanceForm.notes} onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })} />
            <button className="btn-primary payroll-submit-btn" type="submit">Save advance</button>
          </form>
        </div>
      )}

      {canManagePayroll && (
        <div className="payroll-card">
          <div className="payroll-card-head">
            <h3>Monthly Payroll ({monthKey})</h3>
            <button className="btn-primary" onClick={savePayroll} disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save payroll'}
            </button>
          </div>
          <div className="payroll-table-wrap">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Employee</th><th className="num">Gross</th><th className="num">Allow.</th><th className="num">Bonus</th>
                  <th className="num">NSSF</th><th className="num">PAYE Est.</th><th className="num">Advances</th><th className="num">Other Ded.</th><th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {payroll.map((r) => (
                  <tr key={r.employee_id}>
                    <td>{r.full_name}</td>
                    <td className="num">{Number(r.gross_salary || 0).toLocaleString()}</td>
                    <td className="num">
                      <input type="number" value={r.allowances || 0} onChange={(e) => updateLineMoney(r.employee_id, 'allowances', e.target.value)} />
                    </td>
                    <td className="num">
                      <input type="number" value={r.bonuses || 0} onChange={(e) => updateLineMoney(r.employee_id, 'bonuses', e.target.value)} />
                    </td>
                    <td className="num">{Number(r.nssf_amount || 0).toLocaleString()}</td>
                    <td className="num">{Number(r.paye_estimate || 0).toLocaleString()}</td>
                    <td className="num">{Number(r.salary_advances || 0).toLocaleString()}</td>
                    <td className="num">
                      <input type="number" value={r.other_deductions || 0} onChange={(e) => updateLineMoney(r.employee_id, 'other_deductions', e.target.value)} />
                    </td>
                    <td className="num"><strong>{Number(r.net_salary || 0).toLocaleString()}</strong></td>
                  </tr>
                ))}
                {payroll.length === 0 && <tr><td colSpan={9}>{loading ? 'Loading payroll rows...' : 'No payroll rows'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canRecordAdvances && (
        <div className="payroll-card">
          <h3>Salary Advances ({monthKey})</h3>
          <div className="payroll-table-wrap">
            <table className="payroll-table">
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
