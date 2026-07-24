import React from 'react';
import { formatReceiptForDisplay } from '../utils/receiptId';
import { getReceiptTotals, formatReceiptMoney } from '../utils/receiptTotals';
import './ReceiptDetailPanel.css';

/**
 * Full receipt detail panel for expand-in-place on Orders (and reusable elsewhere).
 * Expects an order-like object optionally with all_items / rolled totals.
 */
export default function ReceiptDetailPanel({
  order,
  items = null,
  loading = false,
  error = null,
  onClose = null,
  actions = null,
  compact = false,
}) {
  if (loading) {
    return (
      <div className={`receipt-detail-panel ${compact ? 'receipt-detail-panel--compact' : ''}`}>
        <p className="receipt-detail-panel__loading">Loading order details…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`receipt-detail-panel ${compact ? 'receipt-detail-panel--compact' : ''}`}>
        <p className="receipt-detail-panel__error">{error}</p>
        {onClose && (
          <button type="button" className="dk-btn dk-btn--secondary dk-btn--sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  if (!order) return null;

  const lineItems =
    (order.all_items && order.all_items.length > 0
      ? order.all_items
      : items && items.length > 0
        ? items
        : [order]);
  const { receiptTotal, receiptPaid, balanceDue } = getReceiptTotals(order, lineItems);
  const status = order.status === 'processing' ? 'pending' : order.status;

  return (
    <div className={`receipt-detail-panel ${compact ? 'receipt-detail-panel--compact' : ''}`}>
      <div className="receipt-detail-panel__toolbar">
        <div className="receipt-summary-one-line" role="status">
          Receipt #{formatReceiptForDisplay(order.receipt_number, lineItems)} · Total{' '}
          {formatReceiptMoney(receiptTotal)} · Due {formatReceiptMoney(balanceDue)}
          {receiptPaid > 0 && balanceDue > 0 && (
            <span className="receipt-summary-paid"> · Paid {formatReceiptMoney(receiptPaid)}</span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="dk-btn dk-btn--secondary dk-btn--sm"
            onClick={onClose}
            aria-label="Collapse details"
          >
            Minimize
          </button>
        )}
      </div>

      <div className="order-header-modern receipt-detail-panel__header">
        <div>
          <h3>
            Receipt: {formatReceiptForDisplay(order.receipt_number, lineItems)}
          </h3>
          <p className="order-date">
            Order Date:{' '}
            {order.order_date ? new Date(order.order_date).toLocaleString() : '—'}
          </p>
          {order.estimated_collection_date && (
            <p className="order-date">
              Est. Collection: {new Date(order.estimated_collection_date).toLocaleString()}
            </p>
          )}
        </div>
        <div className={`status-badge-modern status-${status || 'pending'}`}>
          {(status || 'pending').toUpperCase()}
        </div>
      </div>

      <div className="receipt-detail-table-section">
        <h4>Customer</h4>
        <table className="receipt-detail-table">
          <tbody>
            <tr>
              <td>Name</td>
              <td>
                <strong>{order.customer_name || '—'}</strong>
              </td>
            </tr>
            <tr>
              <td>Phone</td>
              <td>{order.customer_phone || '—'}</td>
            </tr>
            {order.customer_email && (
              <tr>
                <td>Email</td>
                <td>{order.customer_email}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="receipt-detail-table-section">
        <h4>Items on Receipt</h4>
        <div className="receipt-items-table-scroll">
          <table className="receipt-detail-table receipt-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Amount (TSh)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, idx) => {
                const itemName =
                  item.garment_type || item.item_name || item.service_name || 'Item';
                const itemColor = item.color || '';
                const itemQty = item.quantity || 1;
                const itemAmount = parseFloat(item.total_amount || 0);
                const itemStatus = item.status === 'processing' ? 'pending' : item.status;
                return (
                  <tr key={item.id || idx}>
                    <td>
                      {itemName}
                      {itemColor ? ` (${itemColor})` : ''}
                      {item.weight_kg ? ` · ${item.weight_kg}kg` : ''}
                    </td>
                    <td>{itemQty}</td>
                    <td>{itemAmount.toLocaleString()}</td>
                    <td>{itemStatus || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="receipt-detail-table-section">
        <h4>Payment Information</h4>
        <table className="receipt-detail-table">
          <tbody>
            <tr>
              <td>Total Amount</td>
              <td>
                <strong>TSh {receiptTotal.toLocaleString()}</strong>
              </td>
            </tr>
            <tr>
              <td>Amount Paid</td>
              <td>TSh {receiptPaid.toLocaleString()}</td>
            </tr>
            <tr>
              <td>Balance Due</td>
              <td>
                {balanceDue > 0 ? (
                  <span className="balance-due">TSh {balanceDue.toLocaleString()}</span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
            <tr>
              <td>Status</td>
              <td>
                {balanceDue <= 0 ? (
                  <span style={{ color: 'var(--success-color)' }}>Fully Paid</span>
                ) : (
                  'Outstanding'
                )}
              </td>
            </tr>
            <tr>
              <td>Payment Method</td>
              <td>{order.payment_method || 'N/A'}</td>
            </tr>
            {order.ready_date && (
              <tr>
                <td>Ready Date</td>
                <td>{new Date(order.ready_date).toLocaleString()}</td>
              </tr>
            )}
            {order.collected_date && (
              <tr>
                <td>Collected</td>
                <td>{new Date(order.collected_date).toLocaleString()}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {order.special_instructions && (
        <div className="special-instructions-modern">
          <h4>Special Instructions</h4>
          <p>{order.special_instructions}</p>
        </div>
      )}

      {actions && <div className="receipt-detail-panel__actions">{actions}</div>}
    </div>
  );
}
