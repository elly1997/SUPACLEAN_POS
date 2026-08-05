import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdminInbox,
  getAdminInboxCounts,
  markAdminInboxRead,
  dismissAdminInboxItem,
  approveAdminInboxItem,
  rejectAdminInboxItem,
} from '../api/api';
import { useAuth } from '../contexts/AuthContext';
import './AdminNotificationCenter.css';

const TYPE_LABELS = {
  void_receipt: 'Void',
  cash_short: 'Cash short',
  ai_suggestion: 'AI tip',
  system: 'System',
};

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function AdminNotificationCenter() {
  const { isAdmin, selectedBranchId } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ unread: 0, pending_actions: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | pending | unread
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const params = {};
      if (selectedBranchId != null && selectedBranchId !== '') {
        params.branch_id = selectedBranchId;
      }
      if (filter === 'pending') params.action_status = 'pending';
      if (filter === 'unread') params.status = 'unread';

      const [listRes, countRes] = await Promise.all([
        getAdminInbox(params),
        getAdminInboxCounts(
          selectedBranchId != null && selectedBranchId !== ''
            ? { branch_id: selectedBranchId }
            : {}
        ),
      ]);
      setItems(listRes?.data?.items || []);
      setCounts(countRes?.data || listRes?.data?.counts || { unread: 0, pending_actions: 0, total: 0 });
    } catch (err) {
      console.error('Failed to load admin inbox:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, selectedBranchId, filter]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    load();
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [isAdmin, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isAdmin) return null;

  const badge = Math.max(counts.pending_actions || 0, counts.unread || 0);

  const handleApprove = async (item) => {
    setBusyId(item.id);
    try {
      await approveAdminInboxItem(item.id, {});
      await load();
    } catch (error) {
      const status = error.response?.status;
      const code = error.response?.data?.code;
      if (status === 409 && code === 'reconciled_day') {
        if (
          !window.confirm(
            'This receipt touches a reconciled day. Approving will recalculate the locked daily summary. Continue?'
          )
        ) {
          return;
        }
        try {
          await approveAdminInboxItem(item.id, { acknowledge_reconciled_day: true });
          await load();
        } catch (err2) {
          window.alert(err2.response?.data?.error || err2.message || 'Approve failed');
        }
        return;
      }
      window.alert(error.response?.data?.error || error.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (item) => {
    const note = window.prompt('Optional note for declining this void request:', '');
    if (note === null) return;
    setBusyId(item.id);
    try {
      await rejectAdminInboxItem(item.id, { review_note: note.trim() || null });
      await load();
    } catch (error) {
      window.alert(error.response?.data?.error || error.message || 'Decline failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenItem = async (item) => {
    if (item.status === 'unread') {
      try {
        await markAdminInboxRead(item.id);
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, status: 'read' } : row))
        );
        setCounts((c) => ({ ...c, unread: Math.max(0, (c.unread || 0) - 1) }));
      } catch (_) {
        /* ignore */
      }
    }

    if (item.type === 'void_receipt' && item.payload?.receipt_number) {
      setOpen(false);
      navigate(`/orders?receipt=${encodeURIComponent(item.payload.receipt_number)}`);
    } else if (item.type === 'cash_short') {
      setOpen(false);
      navigate('/cash-management');
    }
  };

  const handleDismiss = async (item, e) => {
    e.stopPropagation();
    setBusyId(item.id);
    try {
      await dismissAdminInboxItem(item.id);
      await load();
    } catch (error) {
      window.alert(error.response?.data?.error || error.message || 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-inbox" ref={panelRef}>
      <button
        type="button"
        className={`admin-inbox__bell${open ? ' is-open' : ''}`}
        aria-label="Admin notification center"
        aria-expanded={open}
        title="Admin inbox"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
      >
        <span className="admin-inbox__bell-icon" aria-hidden>inbox</span>
        {badge > 0 && (
          <span className="admin-inbox__badge">{badge > 99 ? '99+' : badge}</span>
        )}
      </button>

      {open && (
        <div className="admin-inbox__panel" role="dialog" aria-label="Admin notifications">
          <div className="admin-inbox__header">
            <div>
              <h2>Inbox</h2>
              <p>
                {counts.pending_actions
                  ? `${counts.pending_actions} awaiting approval`
                  : 'Branch alerts & requests'}
              </p>
            </div>
            <button type="button" className="admin-inbox__refresh" onClick={load} disabled={loading}>
              {loading ? '…' : 'Refresh'}
            </button>
          </div>

          <div className="admin-inbox__filters">
            {[
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Approvals' },
              { id: 'unread', label: 'Unread' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`admin-inbox__chip${filter === f.id ? ' is-active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="admin-inbox__list">
            {!loading && items.length === 0 && (
              <div className="admin-inbox__empty">
                No notifications right now. Void requests, cash shorts, and AI tips will show here by branch.
              </div>
            )}
            {items.map((item) => {
              const payload = item.payload || {};
              const pending = item.action_status === 'pending';
              const typeLabel = TYPE_LABELS[item.type] || item.type;
              const amount = formatMoney(payload.total_amount ?? payload.opening_short);
              return (
                <article
                  key={item.id}
                  className={`admin-inbox__item admin-inbox__item--${item.type}${item.status === 'unread' ? ' is-unread' : ''}${pending ? ' is-pending' : ''}`}
                >
                  <button type="button" className="admin-inbox__item-main" onClick={() => handleOpenItem(item)}>
                    <div className="admin-inbox__item-top">
                      <span className={`admin-inbox__type admin-inbox__type--${item.type}`}>{typeLabel}</span>
                      {item.branch_name && (
                        <span className="admin-inbox__branch">{item.branch_code || item.branch_name}</span>
                      )}
                      <span className="admin-inbox__when">{formatWhen(item.created_at)}</span>
                    </div>
                    <h3>{item.title}</h3>
                    {item.body && <p>{item.body}</p>}
                    <div className="admin-inbox__meta">
                      {item.requested_by && <span>From {item.requested_by}</span>}
                      {amount != null && <span>{amount} TZS</span>}
                      {item.action_status && item.action_status !== 'pending' && (
                        <span className="admin-inbox__status-pill">{item.action_status}</span>
                      )}
                    </div>
                  </button>

                  {pending && (
                    <div className="admin-inbox__actions">
                      <button
                        type="button"
                        className="admin-inbox__btn admin-inbox__btn--approve"
                        disabled={busyId === item.id}
                        onClick={() => handleApprove(item)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="admin-inbox__btn admin-inbox__btn--reject"
                        disabled={busyId === item.id}
                        onClick={() => handleReject(item)}
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {!pending && (
                    <div className="admin-inbox__actions">
                      <button
                        type="button"
                        className="admin-inbox__btn admin-inbox__btn--ghost"
                        disabled={busyId === item.id}
                        onClick={(e) => handleDismiss(item, e)}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
