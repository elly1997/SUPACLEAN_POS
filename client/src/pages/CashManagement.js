import React, { useState, useEffect } from 'react';
import { getTodayCashSummary, createDailyCashSummary, reconcileDailyCash, getBankDeposits, createBankDeposit, getActiveBankAccounts } from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import './CashManagement.css';

const CashManagement = () => {
  const { showToast, ToastContainer } = useToast();
  const { user, selectedBranchId, isAdmin } = useAuth();
  const [summary, setSummary] = useState(null);
  const [bankDeposits, setBankDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [depositForm, setDepositForm] = useState({
    amount: '',
    reference_number: '',
    bank_account_id: '',
    bank_name: '',
    notes: ''
  });
  const [activeBankAccounts, setActiveBankAccounts] = useState([]);
  const [manualWhatsAppReport, setManualWhatsAppReport] = useState(null);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  useEffect(() => {
    getActiveBankAccounts().then((res) => setActiveBankAccounts(res.data || [])).catch(() => setActiveBankAccounts([]));
  }, []);

  const loadData = async () => {
    setErrorMessage(null);
    if (isAdmin && (selectedBranchId == null || selectedBranchId === '')) {
      setSummary(null);
      setBankDeposits([]);
      setLoading(false);
      setErrorMessage('Please select a branch from the dropdown above to view cash management.');
      return;
    }
    setLoading(true);
    try {
      const [summaryRes, depositsRes] = await Promise.all([
        getTodayCashSummary(),
        getBankDeposits({ start_date: today, end_date: today })
      ]);
      setSummary(summaryRes.data);
      setBankDeposits(depositsRes.data || []);
      setErrorMessage(null);
      if (summaryRes.fromCache && summaryRes.syncedAt) setLastSyncedAt(summaryRes.syncedAt);
      else if (depositsRes.fromCache && depositsRes.syncedAt) setLastSyncedAt(depositsRes.syncedAt);
      else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading cash summary:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Network Error';
      if (errorMsg.includes('Select a branch')) {
        setErrorMessage('Please select a branch from the dropdown above to view cash management.');
      } else {
        setErrorMessage(errorMsg);
      }
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running.', 'error');
      } else if (!errorMsg.includes('Select a branch')) {
        showToast('Error loading cash summary: ' + errorMsg, 'error');
      }
      setSummary(null);
      setBankDeposits([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSummary = async () => {
    setSaving(true);
    try {
      const res = await createDailyCashSummary({
        date: today,
        bank_deposits: summary.bank_deposits || 0,
        notes: summary.notes || ''
      });
      setSummary(res.data);
      showToast('Cash summary saved successfully', 'success');
      loadData();
    } catch (error) {
      showToast('Error saving cash summary: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async () => {
    if (!window.confirm('Reconcile and send report to director? Cannot be undone.')) return;
    setManualWhatsAppReport(null);
    try {
      const cashierName = user?.fullName || user?.username || 'Cashier';
      const result = await reconcileDailyCash(today, { reconciled_by: cashierName });
      const data = result?.data || result;
      if (data.report_sent) {
        showToast('Reconciled. Report sent to director.', 'success');
      } else if (data.report_text && data.director_phone_wa) {
        const url = `https://wa.me/${data.director_phone_wa}?text=${encodeURIComponent(data.report_text)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        showToast('Reconciled. Send the message in WhatsApp to the director.', 'success');
        setManualWhatsAppReport({ reportText: data.report_text, directorPhoneWa: data.director_phone_wa });
      } else {
        showToast('Reconciled. Set Director WhatsApp in Admin → Branches to send report.', 'info');
      }
      loadData();
    } catch (error) {
      showToast('Error: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const openWhatsAppToSendReport = () => {
    if (!manualWhatsAppReport?.directorPhoneWa || !manualWhatsAppReport?.reportText) return;
    window.open(`https://wa.me/${manualWhatsAppReport.directorPhoneWa}?text=${encodeURIComponent(manualWhatsAppReport.reportText)}`, '_blank', 'noopener,noreferrer');
  };

  const handleAddDeposit = async (e) => {
    e.preventDefault();
    try {
      await createBankDeposit({
        date: today,
        amount: depositForm.amount,
        reference_number: depositForm.reference_number || null,
        bank_account_id: (depositForm.bank_account_id && depositForm.bank_account_id !== 'other') ? Number(depositForm.bank_account_id) : null,
        bank_name: (depositForm.bank_account_id === '' || depositForm.bank_account_id === 'other') ? (depositForm.bank_name || null) : null,
        notes: depositForm.notes || null,
        created_by: 'Cashier'
      });
      showToast('Bank deposit added', 'success');
      setShowDepositForm(false);
      setDepositForm({ amount: '', reference_number: '', bank_account_id: '', bank_name: '', notes: '' });
      loadData();
    } catch (error) {
      showToast('Error adding deposit: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  if (loading) {
    return <div className="loading">Loading cash summary...</div>;
  }

  if (!summary) {
    return (
      <div className="cash-management-page">
        <ToastContainer />
        <div className="error-message">
          {errorMessage || 'Unable to load cash summary'}
        </div>
        {errorMessage && (isAdmin && (selectedBranchId == null || selectedBranchId === '') ? null : (
          <button onClick={loadData} className="btn-secondary" type="button" style={{ marginTop: '1rem' }}>
            🔄 Try again
          </button>
        ))}
      </div>
    );
  }

  const cashInHand = (summary.opening_balance || 0) + 
                     (summary.cash_sales || 0) + 
                     (summary.book_sales || 0) - 
                     (summary.expenses_from_cash || 0) - 
                     (summary.bank_deposits || 0);

  return (
    <div className="cash-management-page">
      <ToastContainer />
      {lastSyncedAt && (
        <div className="sync-cache-banner" role="status">
          Showing data from last sync — {new Date(lastSyncedAt).toLocaleString()}
        </div>
      )}
      {manualWhatsAppReport && (
        <div className="manual-whatsapp-banner" role="alert">
          <span>Send report to director again?</span>
          <button type="button" className="btn-link" onClick={openWhatsAppToSendReport}>Open WhatsApp</button>
          <button type="button" className="btn-link muted" onClick={() => setManualWhatsAppReport(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>💵 Cash Management</h1>
          <p className="subtitle">Daily cash summary - {new Date(today).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="header-actions">
          <button onClick={loadData} className="btn-secondary" type="button">
            🔄 Refresh
          </button>
          {!summary.is_reconciled && (
            <button onClick={handleReconcile} className="btn-success" type="button">
              ✅ Reconcile & send to director
            </button>
          )}
        </div>
      </div>

      <div className="cash-summary-grid">
        {/* Opening Balance */}
        <div className="summary-card opening">
          <div className="card-icon">🌅</div>
          <div className="card-content">
            <h3>Opening Balance</h3>
            <div className="amount">TSh {parseFloat(summary.opening_balance || 0).toLocaleString()}</div>
            <small>From previous day's closing balance</small>
          </div>
        </div>

        {/* Cash Sales */}
        <div className="summary-card income">
          <div className="card-icon">💰</div>
          <div className="card-content">
            <h3>Cash Sales</h3>
            <div className="amount">TSh {parseFloat(summary.cash_sales || 0).toLocaleString()}</div>
            <small>Paid in full with cash today</small>
          </div>
        </div>

        {/* Book Sales */}
        <div className="summary-card income">
          <div className="card-icon">📖</div>
          <div className="card-content">
            <h3>Book Sales</h3>
            <div className="amount">TSh {parseFloat(summary.book_sales || 0).toLocaleString()}</div>
            <small>Collections from unpaid orders</small>
          </div>
        </div>

        {/* Other Payments */}
        <div className="summary-card info">
          <div className="card-icon">💳</div>
          <div className="card-content">
            <h3>Card & M-Pesa</h3>
            <div className="amount">TSh {parseFloat((summary.card_sales || 0) + (summary.mobile_money_sales || 0)).toLocaleString()}</div>
            <small>Card: {parseFloat(summary.card_sales || 0).toLocaleString()} | M-Pesa: {parseFloat(summary.mobile_money_sales || 0).toLocaleString()}</small>
          </div>
        </div>

        {/* Expenses from Cash */}
        <div className="summary-card expense">
          <div className="card-icon">📝</div>
          <div className="card-content">
            <h3>Expenses (Cash)</h3>
            <div className="amount">TSh {parseFloat(summary.expenses_from_cash || 0).toLocaleString()}</div>
            <small>Paid from cash</small>
          </div>
        </div>

        {/* Bank Deposits */}
        <div className="summary-card expense">
          <div className="card-icon">🏦</div>
          <div className="card-content">
            <h3>Bank Deposits</h3>
            <div className="amount">TSh {parseFloat(summary.bank_deposits || 0).toLocaleString()}</div>
            <small>Deposited to bank</small>
          </div>
        </div>

        {/* Cash in Hand */}
        <div className="summary-card total">
          <div className="card-icon">💵</div>
          <div className="card-content">
            <h3>Cash in Hand</h3>
            <div className="amount-large">TSh {parseFloat(cashInHand).toLocaleString()}</div>
            <small>Opening + Sales - Expenses - Deposits</small>
          </div>
        </div>

        {/* Closing Balance */}
        <div className="summary-card total">
          <div className="card-icon">🏁</div>
          <div className="card-content">
            <h3>Closing Balance</h3>
            <div className="amount-large">TSh {parseFloat(summary.closing_balance || cashInHand).toLocaleString()}</div>
            <small>{summary.is_reconciled ? '✅ Reconciled' : 'Pending reconciliation'}</small>
          </div>
        </div>
      </div>

      {/* Calculation Breakdown */}
      <div className="breakdown-card">
        <h2>Calculation Breakdown</h2>
        <div className="breakdown-list">
          <div className="breakdown-item">
            <span>Opening Balance</span>
            <span className="value positive">+ {parseFloat(summary.opening_balance || 0).toLocaleString()}</span>
          </div>
          <div className="breakdown-item">
            <span>Cash Sales</span>
            <span className="value positive">+ {parseFloat(summary.cash_sales || 0).toLocaleString()}</span>
          </div>
          <div className="breakdown-item">
            <span>Book Sales (Collections)</span>
            <span className="value positive">+ {parseFloat(summary.book_sales || 0).toLocaleString()}</span>
          </div>
          <div className="breakdown-item">
            <span>Expenses from Cash</span>
            <span className="value negative">- {parseFloat(summary.expenses_from_cash || 0).toLocaleString()}</span>
          </div>
          <div className="breakdown-item">
            <span>Bank Deposits</span>
            <span className="value negative">- {parseFloat(summary.bank_deposits || 0).toLocaleString()}</span>
          </div>
          <div className="breakdown-item total-line">
            <span><strong>Cash in Hand</strong></span>
            <span className="value total"><strong>TSh {parseFloat(cashInHand).toLocaleString()}</strong></span>
          </div>
        </div>
      </div>

      {/* Bank Deposits Section */}
      <div className="deposits-section">
        <div className="section-header">
          <h2>🏦 Bank Deposits</h2>
          <button 
            onClick={() => setShowDepositForm(!showDepositForm)} 
            className="btn-primary btn-small"
            type="button"
          >
            {showDepositForm ? 'Cancel' : '+ Add Deposit'}
          </button>
        </div>

        {showDepositForm && (
          <form onSubmit={handleAddDeposit} className="deposit-form">
            <div className="form-row">
              <div className="form-group">
                <label>Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={depositForm.amount}
                  onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Reference Number</label>
                <input
                  type="text"
                  value={depositForm.reference_number}
                  onChange={(e) => setDepositForm({ ...depositForm, reference_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="form-group">
                <label>Bank / Account</label>
                <select
                  value={depositForm.bank_account_id}
                  onChange={(e) => setDepositForm({ ...depositForm, bank_account_id: e.target.value, bank_name: e.target.value === 'other' ? depositForm.bank_name : '' })}
                >
                  <option value="">Select bank...</option>
                  {activeBankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>{acc.name}{acc.account_number ? ` (${acc.account_number})` : ''}</option>
                  ))}
                  <option value="other">Other (type below)</option>
                </select>
                {(depositForm.bank_account_id === 'other' || !depositForm.bank_account_id) && (
                  <input
                    type="text"
                    className="bank-name-other"
                    value={depositForm.bank_name}
                    onChange={(e) => setDepositForm({ ...depositForm, bank_name: e.target.value })}
                    placeholder="Bank name if not in list"
                    style={{ marginTop: 8 }}
                  />
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={depositForm.notes}
                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                rows="2"
                placeholder="Additional notes..."
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">Save Deposit</button>
              <button type="button" onClick={() => setShowDepositForm(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        )}

        {bankDeposits.length > 0 ? (
          <div className="deposits-list">
            {bankDeposits.map(deposit => (
              <div key={deposit.id} className="deposit-item">
                <div className="deposit-info">
                  <strong>TSh {parseFloat(deposit.amount).toLocaleString()}</strong>
                  {(deposit.bank_account_name || deposit.bank_name) && <span>{deposit.bank_account_name || deposit.bank_name}</span>}
                  {deposit.reference_number && <span className="reference">Ref: {deposit.reference_number}</span>}
                </div>
                {deposit.notes && <div className="deposit-notes">{deposit.notes}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No bank deposits recorded today</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {!summary.is_reconciled && (
        <div className="action-buttons">
          <button onClick={handleSaveSummary} className="btn-primary btn-large" disabled={saving}>
            {saving ? 'Saving...' : '💾 Save Summary'}
          </button>
        </div>
      )}

      {summary.is_reconciled && (
        <div className="reconciled-badge">
          <span>✅ This day has been reconciled</span>
          <small>Reconciled by: {summary.reconciled_by || 'Cashier'}</small>
        </div>
      )}
    </div>
  );
};

export default CashManagement;
