import React, { useState, useEffect } from 'react';
import { getExpenses, createExpense, updateExpense, deleteExpense, getExpenseSummary, getActiveBankAccounts } from '../api/api';
import { useToast } from '../hooks/useToast';
import './Expenses.css';

const EXPENSE_CATEGORIES = [
  'Bank Deposit',
  'Lunch',
  'Breakfast',
  'Car Fuel',
  'Rent',
  'Salaries',
  'Salary Advance',
  'Maintenance & Repairs',
  'Water Bill',
  'Electricity',
  'Office Supplies',
  'Transport',
  'Other'
];

const PAYMENT_SOURCES = [
  { value: 'cash', label: '💵 Cash in Hand' },
  { value: 'bank', label: '🏦 Cash at Bank' },
  { value: 'mpesa', label: '📱 M-Pesa' }
];

const Expenses = () => {
  const { showToast, ToastContainer } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    category: '',
    amount: '',
    payment_source: 'cash',
    description: '',
    receipt_number: '',
    bank_account_id: '',
    deposit_reference_number: '',
    bank_name: ''
  });
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);

  useEffect(() => {
    loadExpenses();
  }, [filterDate]);

  useEffect(() => {
    getActiveBankAccounts().then((res) => setBankAccounts(res.data || [])).catch(() => setBankAccounts([]));
  }, []);

  const loadExpenses = async () => {
    try {
      const [expensesRes, summaryRes] = await Promise.all([
        getExpenses({ start_date: filterDate, end_date: filterDate }),
        getExpenseSummary({ start_date: filterDate, end_date: filterDate })
      ]);
      setExpenses(expensesRes.data || []);
      setSummary(summaryRes.data || []);
      if (expensesRes.fromCache && expensesRes.syncedAt) setLastSyncedAt(expensesRes.syncedAt);
      else if (summaryRes.fromCache && summaryRes.syncedAt) setLastSyncedAt(summaryRes.syncedAt);
      else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading expenses:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Network Error';
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running.', 'error');
      } else {
        showToast('Error loading expenses: ' + errorMsg, 'error');
      }
      setExpenses([]);
      setSummary([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateExpense(editingId, formData);
        showToast('Expense updated successfully', 'success');
      } else {
        await createExpense({
          ...formData,
          created_by: 'Cashier',
          ...(formData.category === 'Bank Deposit' && {
            bank_account_id: formData.bank_account_id === 'other' ? '' : formData.bank_account_id,
            deposit_reference_number: formData.deposit_reference_number || undefined,
            bank_name: formData.bank_account_id === 'other' ? formData.bank_name : undefined
          })
        });
        showToast('Expense added successfully', 'success');
      }
      resetForm();
      loadExpenses();
    } catch (error) {
      showToast('Error saving expense: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const handleEdit = (expense) => {
    const hasOtherBank = expense.category === 'Bank Deposit' && !expense.bank_account_id && (expense.deposit_bank_name || expense.bank_name);
    setEditingId(expense.id);
    setFormData({
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      payment_source: expense.payment_source,
      description: expense.description || '',
      receipt_number: expense.receipt_number || '',
      bank_account_id: hasOtherBank ? 'other' : (expense.bank_account_id != null ? String(expense.bank_account_id) : ''),
      deposit_reference_number: expense.deposit_reference_number || '',
      bank_name: expense.deposit_bank_name || expense.bank_name || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) {
      return;
    }
    try {
      await deleteExpense(id);
      showToast('Expense deleted successfully', 'success');
      loadExpenses();
    } catch (error) {
      showToast('Error deleting expense: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      category: '',
      amount: '',
      payment_source: 'cash',
      description: '',
      receipt_number: '',
      bank_account_id: '',
      deposit_reference_number: '',
      bank_name: ''
    });
    setEditingId(null);
    setShowForm(false);
  };

  const totalBySource = {
    cash: expenses.filter(e => e.payment_source === 'cash').reduce((sum, e) => sum + parseFloat(e.amount), 0),
    bank: expenses.filter(e => e.payment_source === 'bank').reduce((sum, e) => sum + parseFloat(e.amount), 0),
    mpesa: expenses.filter(e => e.payment_source === 'mpesa').reduce((sum, e) => sum + parseFloat(e.amount), 0)
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  if (loading) {
    return <div className="loading">Loading expenses...</div>;
  }

  return (
    <div className="expenses-page">
      <ToastContainer />
      <div className="page-header">
        <div>
          <h1>📝 Expenses</h1>
          <p className="subtitle">Track daily business expenses</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)} 
          className="btn-primary"
          type="button"
        >
          {showForm ? 'Cancel' : '+ Add Expense'}
        </button>
      </div>

      {lastSyncedAt && (
        <div className="sync-cache-banner" role="status">
          Showing data from last sync — {new Date(lastSyncedAt).toLocaleString()}
        </div>
      )}

      {/* Date Filter */}
      <div className="filter-section">
        <label>View Expenses for:</label>
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="date-filter"
        />
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card total">
          <h3>Total Expenses</h3>
          <div className="amount">TSh {totalExpenses.toLocaleString()}</div>
          <small>{expenses.length} expense{expenses.length !== 1 ? 's' : ''} recorded</small>
        </div>
        <div className="summary-card cash">
          <h3>From Cash</h3>
          <div className="amount">TSh {totalBySource.cash.toLocaleString()}</div>
        </div>
        <div className="summary-card bank">
          <h3>From Bank</h3>
          <div className="amount">TSh {totalBySource.bank.toLocaleString()}</div>
        </div>
        <div className="summary-card mpesa">
          <h3>From M-Pesa</h3>
          <div className="amount">TSh {totalBySource.mpesa.toLocaleString()}</div>
        </div>
      </div>

      {/* Expense Form */}
      {showForm && (
        <div className="expense-form-card">
          <h2>{editingId ? 'Edit Expense' : 'Add New Expense'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                  const cat = e.target.value;
                  setFormData({
                    ...formData,
                    category: cat,
                    ...(cat === 'Bank Deposit' && { payment_source: 'cash' })
                  });
                }}
                  required
                >
                  <option value="">Select category...</option>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Payment Source *</label>
                <select
                  value={formData.payment_source}
                  onChange={(e) => setFormData({ ...formData, payment_source: e.target.value })}
                  required
                >
                  {PAYMENT_SOURCES.map(source => (
                    <option key={source.value} value={source.value}>{source.label}</option>
                  ))}
                </select>
              </div>
              {formData.category === 'Bank Deposit' && (
                <>
                  <div className="form-group">
                    <label>Bank / Account *</label>
                    <select
                      value={formData.bank_account_id}
                      onChange={(e) => setFormData({ ...formData, bank_account_id: e.target.value, bank_name: e.target.value === 'other' ? formData.bank_name : '' })}
                      required
                    >
                      <option value="">Select bank...</option>
                      {bankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>{acc.name}{acc.account_number ? ` (${acc.account_number})` : ''}</option>
                      ))}
                      <option value="other">Other (enter name below)</option>
                    </select>
                  </div>
                  {formData.bank_account_id === 'other' && (
                    <div className="form-group">
                      <label>Bank name</label>
                      <input
                        type="text"
                        value={formData.bank_name}
                        onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                        placeholder="e.g. CRDB Branch X"
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label>Reference (optional)</label>
                    <input
                      type="text"
                      value={formData.deposit_reference_number}
                      onChange={(e) => setFormData({ ...formData, deposit_reference_number: e.target.value })}
                      placeholder="Deposit slip / transaction ref"
                    />
                  </div>
                </>
              )}
              <div className="form-group full-width">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows="2"
                  placeholder="Additional details..."
                />
              </div>
              <div className="form-group">
                <label>Receipt Number</label>
                <input
                  type="text"
                  value={formData.receipt_number}
                  onChange={(e) => setFormData({ ...formData, receipt_number: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingId ? 'Update Expense' : 'Add Expense'}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expenses List */}
      <div className="expenses-list-card">
        <h2>Expenses List</h2>
        {expenses.length > 0 ? (
          <div className="expenses-table-wrapper">
            <table className="expenses-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Bank</th>
                  <th>Amount</th>
                  <th>Payment Source</th>
                  <th>Description</th>
                  <th>Receipt</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => (
                  <tr key={expense.id}>
                    <td>{new Date(expense.date).toLocaleDateString()}</td>
                    <td>
                      <span className="category-badge">{expense.category}</span>
                    </td>
                    <td className="bank-cell">
                      {expense.category === 'Bank Deposit'
                        ? (expense.bank_account_name || expense.deposit_bank_name || '-')
                        : '-'}
                    </td>
                    <td className="amount-cell">
                      <strong>TSh {parseFloat(expense.amount).toLocaleString()}</strong>
                    </td>
                    <td>
                      <span className={`source-badge ${expense.payment_source}`}>
                        {PAYMENT_SOURCES.find(s => s.value === expense.payment_source)?.label.split(' ')[1] || expense.payment_source}
                      </span>
                    </td>
                    <td className="description-cell">{expense.description || '-'}</td>
                    <td className="receipt-cell">{expense.receipt_number || '-'}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => handleEdit(expense)}
                          className="btn-edit"
                          type="button"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(expense.id)}
                          className="btn-delete"
                          type="button"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <p>No expenses recorded for this date</p>
            <small>Click "Add Expense" to get started</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default Expenses;
