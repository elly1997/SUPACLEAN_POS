import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from '../api/api';
import './AdminBanking.css';

const AdminBanking = () => {
  const { isAdmin } = useAuth();
  const { showToast, ToastContainer } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [form, setForm] = useState({ name: '', account_number: '', is_active: true });

  useEffect(() => {
    if (!isAdmin) {
      showToast('Access denied. Admin privileges required.', 'error');
      return;
    }
    loadAccounts();
  }, [isAdmin, showToast]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const res = await getBankAccounts();
      setAccounts(res.data || []);
    } catch (err) {
      showToast('Error loading bank accounts: ' + (err.response?.data?.error || err.message), 'error');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Bank account name is required', 'error');
      return;
    }
    try {
      if (editingAccount) {
        await updateBankAccount(editingAccount.id, {
          name: form.name.trim(),
          account_number: form.account_number.trim() || null,
          is_active: form.is_active,
        });
        showToast('Bank account updated', 'success');
      } else {
        await createBankAccount({
          name: form.name.trim(),
          account_number: form.account_number.trim() || null,
        });
        showToast('Bank account added', 'success');
      }
      setShowForm(false);
      setEditingAccount(null);
      setForm({ name: '', account_number: '', is_active: true });
      loadAccounts();
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Error saving', 'error');
    }
  };

  const handleEdit = (account) => {
    setEditingAccount(account);
    setForm({
      name: account.name || '',
      account_number: account.account_number || '',
      is_active: account.is_active !== false && account.is_active !== 0,
    });
    setShowForm(true);
  };

  const handleDelete = async (account) => {
    if (!window.confirm(`Delete bank account "${account.name}"? This is only allowed if no deposits use it.`)) return;
    try {
      await deleteBankAccount(account.id);
      showToast('Bank account deleted', 'success');
      loadAccounts();
      if (editingAccount && editingAccount.id === account.id) {
        setShowForm(false);
        setEditingAccount(null);
        setForm({ name: '', account_number: '', is_active: true });
      }
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Error deleting', 'error');
    }
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingAccount(null);
    setForm({ name: '', account_number: '', is_active: true });
  };

  if (!isAdmin) {
    return (
      <div className="admin-banking">
        <p className="error-message">Access denied. Admin only.</p>
      </div>
    );
  }

  return (
    <div className="admin-banking">
      <ToastContainer />
      <div className="banking-header">
        <h1>🏦 Banking</h1>
        <p>Manage bank accounts. These appear in the dropdown when recording deposits in Cash Management.</p>
      </div>

      <div className="banking-actions">
        <button type="button" className="btn-primary" onClick={() => { setEditingAccount(null); setForm({ name: '', account_number: '', is_active: true }); setShowForm(true); }}>
          + Add Bank Account
        </button>
      </div>

      {showForm && (
        <div className="banking-form-card">
          <h2>{editingAccount ? 'Edit Bank Account' : 'New Bank Account'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Bank / Account Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. NBC Arusha, CRDB Main"
                required
              />
            </div>
            <div className="form-group">
              <label>Account Number (optional)</label>
              <input
                type="text"
                value={form.account_number}
                onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                placeholder="e.g. 0123456789"
              />
            </div>
            {editingAccount && (
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  {' '}Active (show in deposit dropdown)
                </label>
              </div>
            )}
            <div className="form-actions">
              <button type="submit" className="btn-primary">{editingAccount ? 'Update' : 'Add'}</button>
              <button type="button" className="btn-secondary" onClick={handleCancelForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="banking-list-card">
        <h2>Bank Accounts</h2>
        {loading ? (
          <p className="loading">Loading...</p>
        ) : accounts.length === 0 ? (
          <p className="empty-state">No bank accounts yet. Add one so they appear when recording deposits.</p>
        ) : (
          <ul className="bank-accounts-list">
            {accounts.map((acc) => (
              <li key={acc.id} className={acc.is_active === false || acc.is_active === 0 ? 'inactive' : ''}>
                <div className="account-info">
                  <strong>{acc.name}</strong>
                  {acc.account_number && <span className="account-number">{acc.account_number}</span>}
                  {(acc.is_active === false || acc.is_active === 0) && <span className="badge inactive-badge">Inactive</span>}
                </div>
                <div className="account-actions">
                  <button type="button" className="btn-small btn-secondary" onClick={() => handleEdit(acc)}>Edit</button>
                  <button type="button" className="btn-small btn-danger" onClick={() => handleDelete(acc)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminBanking;
