import React, { useState, useEffect, useCallback } from 'react';
import { getCoupons, createCoupon, updateCoupon, getBranches } from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import './AdminCoupons.css';

const EMPTY_FORM = {
  code: '',
  type: 'percent',
  value: '',
  min_order_amount: '20000',
  max_uses: '0',
  expires_at: '',
  branch_id: '',
  is_active: true,
};

const AdminCoupons = () => {
  const { showToast, ToastContainer } = useToast();
  const { hasPermission } = useAuth();
  const [coupons, setCoupons] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const canManage = hasPermission('canManageBranches');

  const loadCoupons = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getCoupons();
      setCoupons(res.data || []);
    } catch (error) {
      showToast('Error loading coupons: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadCoupons();
  }, [loadCoupons]);

  useEffect(() => {
    let cancelled = false;
    getBranches()
      .then((res) => {
        if (!cancelled) setBranches(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => { cancelled = true; };
  }, []);

  const branchName = (branchId) => {
    if (branchId == null || branchId === '') return 'All branches';
    const b = branches.find((x) => Number(x.id) === Number(branchId));
    return b?.name || `Branch #${branchId}`;
  };

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.code.trim()) {
      showToast('Coupon code is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: parseFloat(form.value),
        min_order_amount: parseFloat(form.min_order_amount) || 20000,
        max_uses: parseInt(form.max_uses, 10) || 0,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        branch_id: form.branch_id ? parseInt(form.branch_id, 10) : null,
        is_active: form.is_active,
      };
      if (editingId) {
        await updateCoupon(editingId, payload);
        showToast('Coupon updated', 'success');
      } else {
        await createCoupon(payload);
        showToast('Coupon created', 'success');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      loadCoupons();
    } catch (error) {
      showToast('Error saving coupon: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (coupon) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      type: coupon.type,
      value: String(coupon.value),
      min_order_amount: String(coupon.min_order_amount ?? 20000),
      max_uses: String(coupon.max_uses ?? 0),
      expires_at: coupon.expires_at ? new Date(coupon.expires_at).toISOString().slice(0, 10) : '',
      branch_id: coupon.branch_id != null ? String(coupon.branch_id) : '',
      is_active: !!coupon.is_active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (coupon) => {
    try {
      await updateCoupon(coupon.id, { is_active: !coupon.is_active });
      showToast(coupon.is_active ? 'Coupon deactivated' : 'Coupon activated', 'success');
      loadCoupons();
    } catch (error) {
      showToast('Error: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  if (!canManage) {
    return (
      <div className="coupons-page">
        <ToastContainer />
        <div className="page-header-modern">
          <div>
            <h1>Coupons</h1>
            <p className="subtitle">You do not have permission to manage coupons.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="coupons-page">
      <ToastContainer />
      <div className="page-header-modern">
        <div>
          <h1>Coupons</h1>
          <p className="subtitle">Create and manage discount codes for the counter</p>
        </div>
      </div>

      <p className="coupons-hint">
        A coupon can only be applied when the order subtotal is at least <strong>TSh 20,000</strong>.
        Leave branch as “All branches” to allow every location.
      </p>

      <form onSubmit={handleSubmit} className="coupons-form-card">
        <h2 className="coupons-form-title">{editingId ? 'Edit coupon' : 'Create coupon'}</h2>
        <div className="coupons-form-grid">
          <div className="coupons-field">
            <label htmlFor="coupon-code">Code *</label>
            <input
              id="coupon-code"
              type="text"
              value={form.code}
              onChange={(e) => handleChange('code', e.target.value.toUpperCase())}
              placeholder="e.g. SAVE20"
              required
              autoComplete="off"
            />
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-type">Type</label>
            <select id="coupon-type" value={form.type} onChange={(e) => handleChange('type', e.target.value)}>
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed (TSh)</option>
            </select>
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-value">Value *</label>
            <input
              id="coupon-value"
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => handleChange('value', e.target.value)}
              placeholder={form.type === 'percent' ? 'e.g. 10' : 'e.g. 5000'}
              required
            />
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-min">Min order (TSh)</label>
            <input
              id="coupon-min"
              type="number"
              min="0"
              value={form.min_order_amount}
              onChange={(e) => handleChange('min_order_amount', e.target.value)}
            />
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-max">Max uses (0 = unlimited)</label>
            <input
              id="coupon-max"
              type="number"
              min="0"
              value={form.max_uses}
              onChange={(e) => handleChange('max_uses', e.target.value)}
            />
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-expires">Expires</label>
            <input
              id="coupon-expires"
              type="date"
              value={form.expires_at}
              onChange={(e) => handleChange('expires_at', e.target.value)}
            />
          </div>
          <div className="coupons-field">
            <label htmlFor="coupon-branch">Branch</label>
            <select
              id="coupon-branch"
              value={form.branch_id}
              onChange={(e) => handleChange('branch_id', e.target.value)}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="coupons-actions">
            <button type="submit" className="dk-btn dk-btn--primary dk-btn--md" disabled={saving}>
              {saving ? 'Saving…' : (editingId ? 'Update' : 'Create')}
            </button>
            {editingId && (
              <button
                type="button"
                className="dk-btn dk-btn--secondary dk-btn--md"
                onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      {loading ? (
        <div className="coupons-loading">Loading coupons…</div>
      ) : coupons.length === 0 ? (
        <div className="coupons-empty">No coupons yet. Create one above.</div>
      ) : (
        <div className="coupons-table-wrap">
          <table className="coupons-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Min order</th>
                <th>Branch</th>
                <th>Used</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td className="coupons-code">{c.code}</td>
                  <td>{c.type === 'percent' ? `${c.value}%` : `TSh ${Number(c.value).toLocaleString()}`}</td>
                  <td>TSh {Number(c.min_order_amount || 0).toLocaleString()}</td>
                  <td>{branchName(c.branch_id)}</td>
                  <td>{c.used_count}{c.max_uses > 0 ? ` / ${c.max_uses}` : ''}</td>
                  <td>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`coupons-status ${c.is_active ? 'coupons-status--active' : 'coupons-status--inactive'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="coupons-row-actions">
                      <button type="button" className="btn-small btn-primary" onClick={() => startEdit(c)}>Edit</button>
                      <button type="button" className="btn-small btn-secondary" onClick={() => toggleActive(c)}>
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminCoupons;
