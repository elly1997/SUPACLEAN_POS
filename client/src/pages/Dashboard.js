import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getDailySummary, getOrders, updateOrderStatus, getCollectionQueue } from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import { useListViewPreference } from '../hooks/useListViewPreference';
import ListViewToggle from '../components/ListViewToggle';
import Loader from '../components/Loader';
import './Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();
  const { selectedBranchId, user, hasPermission } = useAuth();
  const isCashier = user?.role === 'cashier';
  const canManageCash = hasPermission?.('canManageCash') ?? false;
  const [listView, setListView] = useListViewPreference();
  const [summary, setSummary] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [readyOrders, setReadyOrders] = useState([]);
  const [readyQueue, setReadyQueue] = useState([]); // Collection queue (grouped by receipt)
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [readySearchTerm, setReadySearchTerm] = useState('');
  const [pendingSearchTerm, setPendingSearchTerm] = useState('');
  const [readySearchInput, setReadySearchInput] = useState('');
  const [pendingSearchInput, setPendingSearchInput] = useState('');
  const today = new Date().toISOString().split('T')[0];

  const loadDashboardData = useCallback(async () => {
    try {
      const readyCustomer = readySearchTerm.trim() || undefined;
      const pendingCustomer = pendingSearchTerm.trim() || undefined;
      const [summaryRes, pendingRes, readyRes, queueRes] = await Promise.all([
        getDailySummary(today),
        getOrders({ status: 'pending', ...(pendingCustomer && { customer: pendingCustomer }) }),
        getOrders({ status: 'ready', ...(readyCustomer && { customer: readyCustomer }) }),
        getCollectionQueue({ limit: 100, ...(readyCustomer && { customer: readyCustomer }) })
      ]);

      setSummary(summaryRes.data);
      setPendingOrders(pendingRes.data || []);
      setReadyOrders(readyRes.data || []);
      setReadyQueue(queueRes.data || []);
      const synced = [summaryRes, pendingRes, readyRes, queueRes].find((r) => r.fromCache && r.syncedAt);
      if (synced) setLastSyncedAt(synced.syncedAt); else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Network Error';
      if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')) {
        showToast('Cannot connect to server. Please ensure the server is running.', 'error');
      }
      // Set empty arrays on error to prevent crashes
      setPendingOrders([]);
      setReadyOrders([]);
      setReadyQueue([]);
    } finally {
      setLoading(false);
    }
  }, [today, readySearchTerm, pendingSearchTerm, selectedBranchId]);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  // Debounce search terms so we don't refetch on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setReadySearchTerm(readySearchInput), 400);
    return () => clearTimeout(t);
  }, [readySearchInput]);
  useEffect(() => {
    const t = setTimeout(() => setPendingSearchTerm(pendingSearchInput), 400);
    return () => clearTimeout(t);
  }, [pendingSearchInput]);

  const handleQuickAction = (action) => {
    if (action === 'new-order') {
      navigate('/new-order');
    }
  };

  const viewInReports = () => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(new Date().setDate(new Date().getDate() - 6)).toISOString().split('T')[0];
    navigate(`/reports?start=${start}&end=${end}`);
  };

  // Group orders by receipt_number so one receipt = one card (same receipt number not shown twice)
  const groupPendingByReceipt = (ordersList) => {
    const grouped = {};
    (ordersList || []).forEach((order) => {
      const rn = order.receipt_number;
      if (!grouped[rn]) {
        grouped[rn] = {
          receipt_number: rn,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          service_name: order.service_name,
          items: [],
          total_amount: 0,
          order_ids: []
        };
      }
      grouped[rn].items.push(order);
      grouped[rn].total_amount += parseFloat(order.total_amount) || 0;
      grouped[rn].order_ids.push(order.id);
    });
    return Object.values(grouped);
  };

  const groupedPending = groupPendingByReceipt(pendingOrders);

  const handleOrderStatusUpdate = async (orderId, newStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      showToast(`Order marked as ${newStatus}`, 'success');
      loadDashboardData();
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Error updating order';
      showToast(msg, 'error');
    }
  };

  // Update status for entire receipt (all line items) so one click = one receipt
  const handleReceiptStatusUpdate = async (receiptGroup, newStatus) => {
    try {
      for (const id of receiptGroup.order_ids) {
        await updateOrderStatus(id, newStatus);
      }
      showToast(`Receipt ${receiptGroup.receipt_number} marked as ${newStatus}`, 'success');
      loadDashboardData();
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Error updating order';
      showToast(msg, 'error');
    }
  };

  if (loading) {
    return <Loader message="Loading dashboard…" fullPage />;
  }

  return (
    <div className="dashboard-modern">
      <ToastContainer />
      {lastSyncedAt && (
        <div className="sync-cache-banner" role="status">
          Showing data from last sync — {new Date(lastSyncedAt).toLocaleString()}
        </div>
      )}
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">
            {isCashier ? "Quick access: new orders & collection" : "Today's overview"} — {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary btn-large"
            onClick={() => navigate('/collection')}
          >
            Go to Collection
          </button>
          <button
            type="button"
            className="btn-primary btn-large"
            onClick={() => handleQuickAction('new-order')}
          >
            New Order
          </button>
        </div>
      </div>

      {canManageCash && (
        <div className="dashboard-manager-cta">
          <span className="dashboard-manager-label">Reconcile & daily totals</span>
          <button type="button" className="btn-secondary btn-large" onClick={() => navigate('/cash-management')}>
            Cash Management
          </button>
        </div>
      )}

      <div className="stats-grid-modern">
        <div className="stat-card-modern income">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Today's Income</h3>
            <p className="stat-value">TSh {summary?.total_income?.toLocaleString() || '0'}</p>
            <small>Cash: TSh {summary?.cash_income?.toLocaleString() || '0'}</small>
          </div>
        </div>

        <div className="stat-card-modern orders">
          <div className="stat-icon">📋</div>
          <div className="stat-content">
            <h3>Total Orders</h3>
            <p className="stat-value">{summary?.total_transactions || 0}</p>
            <small>Today's transactions</small>
          </div>
        </div>

        <div className="stat-card-modern pending">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <h3>Pending</h3>
            <p className="stat-value">{groupedPending.length}</p>
            <small>Receipts in progress</small>
          </div>
        </div>

        <div className="stat-card-modern ready">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Ready</h3>
            <p className="stat-value">{readyOrders.length}</p>
            <small>Ready for collection</small>
          </div>
        </div>
      </div>

      <div className="dashboard-reports-link-wrap" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <button type="button" className="btn-link dashboard-reports-link" onClick={viewInReports}>
          📈 View in Reports (last 7 days)
        </button>
        <ListViewToggle view={listView} setView={setListView} />
      </div>

      <div className="dashboard-grid dashboard-queues-grid">
        <div className="dashboard-card queue-card ready-queue-card">
          <div className="card-header">
            <div>
              <h2>✅ Ready Orders Queue ({readyQueue.length})</h2>
              {readyQueue.filter(r => r.is_overdue).length > 0 && (
                <span className="overdue-count-badge">
                  ⚠️ {readyQueue.filter(r => r.is_overdue).length} Overdue
                </span>
              )}
            </div>
            <button className="btn-link" onClick={() => navigate('/collection')}>
              View in Collection →
            </button>
          </div>
          <div className="dashboard-search-wrap">
            <span className="dashboard-search-icon" aria-hidden>🔍</span>
            <input
              type="text"
              className="dashboard-search-input"
              placeholder="Search by customer name or phone..."
              value={readySearchInput}
              onChange={(e) => setReadySearchInput(e.target.value)}
              aria-label="Search ready orders by customer name"
            />
          </div>
          {readyQueue.length > 0 ? (
            listView === 'card' ? (
              <div className="dashboard-cards-grid queue-scroll-area">
                {readyQueue.map(receipt => {
                  const balance = (receipt.total_amount || 0) - (receipt.paid_amount || 0);
                  const isOverdue = receipt.is_overdue;
                  const hoursOverdue = receipt.hours_overdue || 0;
                  const itemCount = receipt.receipt_item_count || 1;
                  const timeRemaining = !isOverdue && receipt.estimated_collection_date ? (() => {
                    const estDate = new Date(receipt.estimated_collection_date);
                    const now = new Date();
                    const diffHours = Math.floor((estDate - now) / (1000 * 60 * 60));
                    if (diffHours <= 2 && diffHours > 0) return `${diffHours}h left`;
                    return null;
                  })() : null;
                  return (
                    <div key={receipt.receipt_number} className={`dashboard-list-card ${isOverdue ? 'overdue' : ''}`}>
                      <div className="dashboard-list-card-header">
                        <Link to={`/collection?receipt=${encodeURIComponent(receipt.receipt_number)}`} className={`receipt-badge receipt-link ${isOverdue ? 'overdue-badge' : ''}`}>
                          {receipt.receipt_number}
                        </Link>
                        {isOverdue && hoursOverdue > 0 && <span className="overdue-indicator">⚠️ {hoursOverdue}h overdue</span>}
                        {timeRemaining && <span className="time-remaining">⏰ {timeRemaining}</span>}
                      </div>
                      <div className="dashboard-list-card-body">
                        <p><strong>{receipt.customer_name}</strong></p>
                        <p className="text-muted">{receipt.customer_phone}</p>
                        <p>{itemCount} item(s) · TSh {(receipt.total_amount || 0).toLocaleString()}</p>
                        <p>{balance > 0 ? <span className="balance-due">Balance TSh {balance.toLocaleString()}</span> : 'Paid'}</p>
                      </div>
                      <div className="dashboard-list-card-actions">
                        <button type="button" className="btn-small btn-success" onClick={() => navigate(`/collection?receipt=${receipt.receipt_number}`)}>
                          Collect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="dashboard-table-wrap queue-scroll-area">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readyQueue.map(receipt => {
                      const balance = (receipt.total_amount || 0) - (receipt.paid_amount || 0);
                      const isOverdue = receipt.is_overdue;
                      const hoursOverdue = receipt.hours_overdue || 0;
                      const itemCount = receipt.receipt_item_count || 1;
                      const timeRemaining = !isOverdue && receipt.estimated_collection_date ? (() => {
                        const estDate = new Date(receipt.estimated_collection_date);
                        const now = new Date();
                        const diffHours = Math.floor((estDate - now) / (1000 * 60 * 60));
                        if (diffHours <= 2 && diffHours > 0) return `${diffHours}h left`;
                        return null;
                      })() : null;
                      return (
                        <tr key={receipt.receipt_number} className={isOverdue ? 'row-overdue' : ''}>
                          <td>
                            <Link to={`/collection?receipt=${encodeURIComponent(receipt.receipt_number)}`} className={`receipt-badge receipt-link ${isOverdue ? 'overdue-badge' : ''}`} title="Open in Collection">
                              {receipt.receipt_number}
                            </Link>
                          </td>
                          <td><strong>{receipt.customer_name}</strong></td>
                          <td className="text-muted">{receipt.customer_phone}</td>
                          <td>{itemCount}</td>
                          <td className="amount-cell">TSh {(receipt.total_amount || 0).toLocaleString()}</td>
                          <td>{balance > 0 ? <span className="balance-due">TSh {balance.toLocaleString()}</span> : '—'}</td>
                          <td>
                            {isOverdue && hoursOverdue > 0 && <span className="overdue-indicator">⚠️ {hoursOverdue}h overdue</span>}
                            {timeRemaining && <span className="time-remaining">⏰ {timeRemaining}</span>}
                            {!isOverdue && !timeRemaining && '—'}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-small btn-success btn-table-action"
                              onClick={() => navigate(`/collection?receipt=${receipt.receipt_number}`)}
                            >
                              Collect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="empty-state-modern">
              <div className="empty-icon">📭</div>
              <p>{readySearchInput.trim() ? 'No ready orders match that name' : 'No orders ready for collection'}</p>
            </div>
          )}
        </div>

        <div className="dashboard-card queue-card pending-queue-card">
          <div className="card-header">
            <h2>⏳ Pending Orders ({groupedPending.length})</h2>
            <button className="btn-link" onClick={() => navigate('/orders')}>
              View in Orders →
            </button>
          </div>
          <div className="dashboard-search-wrap">
            <span className="dashboard-search-icon" aria-hidden>🔍</span>
            <input
              type="text"
              className="dashboard-search-input"
              placeholder="Search by customer name or phone..."
              value={pendingSearchInput}
              onChange={(e) => setPendingSearchInput(e.target.value)}
              aria-label="Search pending orders by customer name"
            />
          </div>
          {groupedPending.length > 0 ? (
            listView === 'card' ? (
              <div className="dashboard-cards-grid queue-scroll-area">
                {groupedPending.map((receiptGroup) => (
                  <div key={receiptGroup.receipt_number} className="dashboard-list-card">
                    <div className="dashboard-list-card-header">
                      <span className="receipt-badge">{receiptGroup.receipt_number}</span>
                    </div>
                    <div className="dashboard-list-card-body">
                      <p><strong>{receiptGroup.customer_name}</strong></p>
                      <p className="text-muted">{receiptGroup.customer_phone}</p>
                      <p>{receiptGroup.items.length} item(s) · TSh {(receiptGroup.total_amount || 0).toLocaleString()}</p>
                    </div>
                    <div className="dashboard-list-card-actions">
                      <button type="button" className="btn-small btn-secondary" onClick={() => navigate(`/collection?receipt=${encodeURIComponent(receiptGroup.receipt_number)}`)}>View</button>
                      <button type="button" className="btn-small btn-success" onClick={() => handleReceiptStatusUpdate(receiptGroup, 'ready')}>Mark Ready</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dashboard-table-wrap queue-scroll-area">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPending.map((receiptGroup) => (
                      <tr key={receiptGroup.receipt_number}>
                        <td><span className="receipt-badge">{receiptGroup.receipt_number}</span></td>
                        <td><strong>{receiptGroup.customer_name}</strong></td>
                        <td className="text-muted">{receiptGroup.customer_phone}</td>
                        <td>{receiptGroup.items.length}</td>
                        <td className="amount-cell">TSh {(receiptGroup.total_amount || 0).toLocaleString()}</td>
                        <td>
                          <div className="quick-actions">
                            <button
                              type="button"
                              className="btn-small btn-secondary btn-table-action"
                              onClick={() => navigate(`/collection?receipt=${encodeURIComponent(receiptGroup.receipt_number)}`)}
                              title="View receipt"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn-small btn-success btn-table-action"
                              onClick={() => handleReceiptStatusUpdate(receiptGroup, 'ready')}
                            >
                              Mark Ready
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="empty-state-modern">
              <div className="empty-icon">✨</div>
              <p>{pendingSearchInput.trim() ? 'No pending orders match that name' : 'No pending orders'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
