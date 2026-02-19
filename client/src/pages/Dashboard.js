import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDailySummary, getOrders, updateOrderStatus, getCollectionQueue } from '../api/api';
import { useToast } from '../hooks/useToast';
import './Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();
  const [summary, setSummary] = useState(null);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [readyOrders, setReadyOrders] = useState([]);
  const [readyQueue, setReadyQueue] = useState([]); // Collection queue (grouped by receipt)
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      const [summaryRes, pendingRes, readyRes, queueRes] = await Promise.all([
        getDailySummary(today),
        getOrders({ status: 'pending' }),
        getOrders({ status: 'ready' }),
        getCollectionQueue({ limit: 10 }) // Get top 10 ready orders (grouped by receipt)
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
  };

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
    return <div className="loading">Loading dashboard...</div>;
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
          <p className="subtitle">Today's overview - {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button 
          className="btn-primary btn-large"
          onClick={() => handleQuickAction('new-order')}
        >
          ➕ New Order
        </button>
      </div>

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

      <div className="dashboard-reports-link-wrap">
        <button type="button" className="btn-link dashboard-reports-link" onClick={viewInReports}>
          📈 View in Reports (last 7 days)
        </button>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="card-header">
            <div>
              <h2>✅ Ready Orders Queue ({readyQueue.length})</h2>
              {readyQueue.filter(r => r.is_overdue).length > 0 && (
                <span className="overdue-count-badge">
                  ⚠️ {readyQueue.filter(r => r.is_overdue).length} Overdue
                </span>
              )}
            </div>
            {readyQueue.length > 5 && (
              <button className="btn-link" onClick={() => navigate('/collection')}>
                View All →
              </button>
            )}
          </div>
          {readyQueue.length > 0 ? (
            <div className="orders-list-modern">
              {readyQueue.slice(0, 5).map(receipt => {
                const balance = (receipt.total_amount || 0) - (receipt.paid_amount || 0);
                const isOverdue = receipt.is_overdue;
                const hoursOverdue = receipt.hours_overdue || 0;
                const itemCount = receipt.receipt_item_count || 1;
                
                return (
                  <div 
                    key={receipt.receipt_number} 
                    className={`order-card-modern ready ${isOverdue ? 'overdue' : ''}`}
                  >
                    <div className="order-info">
                      <div className={`receipt-badge ${isOverdue ? 'overdue-badge' : ''}`}>
                        {receipt.receipt_number}
                      </div>
                      <div>
                        <strong>{receipt.customer_name}</strong>
                        <span>{receipt.customer_phone}</span>
                        {itemCount > 1 && (
                          <span className="item-count-badge">📦 {itemCount} items</span>
                        )}
                      </div>
                    </div>
                    <div className="order-meta">
                      <div className="order-details">
                        <div className="amount">TSh {receipt.total_amount.toLocaleString()}</div>
                        {balance > 0 && (
                          <div className="balance-due">Balance: TSh {balance.toLocaleString()}</div>
                        )}
                        {isOverdue && hoursOverdue > 0 && (
                          <div className="overdue-indicator">
                            ⚠️ {hoursOverdue}h overdue
                          </div>
                        )}
                        {!isOverdue && receipt.estimated_collection_date && (
                          <div className="time-remaining">
                            {(() => {
                              const estDate = new Date(receipt.estimated_collection_date);
                              const now = new Date();
                              const diffHours = Math.floor((estDate - now) / (1000 * 60 * 60));
                              if (diffHours <= 2 && diffHours > 0) {
                                return `⏰ ${diffHours}h remaining`;
                              }
                              return null;
                            })()}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn-small btn-success"
                        onClick={() => navigate(`/collection?receipt=${receipt.receipt_number}`)}
                      >
                        Collect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state-modern">
              <div className="empty-icon">📭</div>
              <p>No orders ready for collection</p>
            </div>
          )}
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h2>⏳ Pending Orders ({groupedPending.length})</h2>
            {groupedPending.length > 5 && (
              <button className="btn-link" onClick={() => navigate('/orders')}>
                View All →
              </button>
            )}
          </div>
          {groupedPending.length > 0 ? (
            <div className="orders-list-modern">
              {groupedPending.slice(0, 5).map((receiptGroup) => (
                <div key={receiptGroup.receipt_number} className="order-card-modern pending">
                  <div className="order-info">
                    <div className="receipt-badge">{receiptGroup.receipt_number}</div>
                    <div>
                      <strong>{receiptGroup.customer_name}</strong>
                      <span>{receiptGroup.service_name || 'Regular Service'}</span>
                      {receiptGroup.items.length > 1 && (
                        <span className="item-count-badge">📦 {receiptGroup.items.length} items</span>
                      )}
                    </div>
                  </div>
                  <div className="order-meta">
                    <div className="amount">TSh {receiptGroup.total_amount.toLocaleString()}</div>
                    <div className="quick-actions">
                      <button
                        className="btn-small btn-secondary"
                        onClick={() => navigate(`/collection?receipt=${encodeURIComponent(receiptGroup.receipt_number)}`)}
                        title="View receipt and item details"
                      >
                        View receipt
                      </button>
                      <button
                        className="btn-small btn-success"
                        onClick={() => handleReceiptStatusUpdate(receiptGroup, 'ready')}
                      >
                        Ready
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state-modern">
              <div className="empty-icon">✨</div>
              <p>No pending orders</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
