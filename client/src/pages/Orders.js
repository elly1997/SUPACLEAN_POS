import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOrders, updateOrderStatus, updateEstimatedCollectionDate, uploadStockExcel, receivePayment, sendCollectionReminder } from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import { exportToPDF, exportToExcel } from '../utils/exportUtils';
import { receiptWidthCss, receiptPadding, receiptFontSize, receiptCompactFontSize, termsQrSize, receiptBrandMargin, receiptBrandFontSize } from '../utils/receiptPrintConfig';
import './Orders.css';

const roundMoney = (x) => (typeof x !== 'number' || Number.isNaN(x) ? 0 : Math.round(x * 100) / 100);
const ORDERS_PAGE_SIZE = 50;

const ORDERS_EXPORT_COLUMNS = [
  { key: 'branch_id', label: 'Branch ID' },
  { key: 'receipt_number', label: 'Receipt No' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'customer_phone', label: 'Phone' },
  { key: 'total_amount', label: 'Total Amount' },
  { key: 'paid_amount', label: 'Paid' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'payment_status_label', label: 'Payment Status' },
  { key: 'order_date', label: 'Order Date' },
  { key: 'estimated_collection_date', label: 'Est. Collection' },
  { key: 'status', label: 'Status' },
];

const Orders = () => {
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();
  const { branch, selectedBranchId } = useAuth();
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingDate, setEditingDate] = useState(null); // { orderId: number, value: string }
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showReceivePaymentModal, setShowReceivePaymentModal] = useState(false);
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [receivingPayment, setReceivingPayment] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(null);
  const [expandedReceipts, setExpandedReceipts] = useState(new Set()); // Track which receipts are expanded
  const [searchFilters, setSearchFilters] = useState({
    customer: '',
    dateFrom: '',
    dateTo: '',
    minAmount: '',
    maxAmount: '',
    paymentStatus: '',
    overdueOnly: false
  });
  const [debouncedSearchFilters, setDebouncedSearchFilters] = useState(searchFilters);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportingUncollected, setExportingUncollected] = useState(false);
  const [showExportPopup, setShowExportPopup] = useState(false);

  const loadOrders = useCallback(async (append = false, offsetOverride = undefined, filtersOverride = null, filterOverride = null) => {
    const f = filtersOverride ?? debouncedSearchFilters;
    const statusFilter = filterOverride ?? filter;
    const offset = append ? (offsetOverride ?? 0) : 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = { limit: ORDERS_PAGE_SIZE, offset };
      if (selectedBranchId) params.branch_id = selectedBranchId;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (f.customer) params.customer = f.customer;
      if (f.dateFrom) params.date_from = f.dateFrom;
      if (f.dateTo) params.date_to = f.dateTo;
      if (f.minAmount) params.min_amount = f.minAmount;
      if (f.maxAmount) params.max_amount = f.maxAmount;
      if (f.paymentStatus) params.payment_status = f.paymentStatus;
      if (f.overdueOnly) params.overdue_only = 'true';

      const res = await getOrders(params);
      const data = res.data || [];
      if (append) setOrders(prev => [...prev, ...data]);
      else setOrders(data);
      setHasMore(data.length === ORDERS_PAGE_SIZE);
      if (res.fromCache && res.syncedAt) setLastSyncedAt(res.syncedAt); else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading orders:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Network Error';
      const userFriendlyMsg = errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error') || errorMsg.includes('No response')
        ? 'Cannot connect to server. Please ensure the server is running on port 5000.'
        : errorMsg;
      showToast('Error loading orders: ' + userFriendlyMsg, 'error');
      if (!append) setOrders([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, debouncedSearchFilters, selectedBranchId, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchFilters(searchFilters), 400);
    return () => clearTimeout(timer);
  }, [searchFilters]);

  useEffect(() => {
    loadOrders(false);
  }, [filter, loadOrders]);

  const handleFilterChange = (key, value) => {
    setSearchFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleApplyFilters = () => {
    setDebouncedSearchFilters(searchFilters);
    loadOrders(false, undefined, searchFilters);
  };

  const handleClearFilters = () => {
    const cleared = {
      customer: '',
      dateFrom: '',
      dateTo: '',
      minAmount: '',
      maxAmount: '',
      paymentStatus: '',
      overdueOnly: false
    };
    setSearchFilters(cleared);
    setDebouncedSearchFilters(cleared);
    setFilter('all');
    loadOrders(false, undefined, cleared, 'all');
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      showToast(`Order status updated to ${newStatus}`, 'success');
      loadOrders(false);
    } catch (error) {
      const msg = error.response?.data?.error || error.message;
      showToast(msg, 'error');
    }
  };

  const handleEditEstimatedDate = (orderId, currentDate) => {
    const dateValue = currentDate ? new Date(currentDate).toISOString().slice(0, 16) : '';
    setEditingDate({ orderId, value: dateValue });
  };

  const handleSaveEstimatedDate = async (orderId) => {
    if (!editingDate || !editingDate.orderId) return;
    
    try {
      const dateToSave = editingDate.value ? new Date(editingDate.value).toISOString() : null;
      // If we have a receiptNumber, update all orders in that receipt
      if (editingDate.receiptNumber) {
        // Find all orders with the same receipt number
        const receiptOrders = orders.filter(o => o.receipt_number === editingDate.receiptNumber);
        if (receiptOrders.length > 0) {
          // Update all items in the receipt group
          const updatePromises = receiptOrders.map(item => 
            updateEstimatedCollectionDate(item.id, dateToSave)
          );
          await Promise.all(updatePromises);
          showToast('Estimated collection date updated for all items in receipt', 'success');
        }
      } else {
        // Single order update
        await updateEstimatedCollectionDate(orderId, dateToSave);
        showToast('Estimated collection date updated', 'success');
      }
      setEditingDate(null);
      loadOrders(false);
    } catch (error) {
      showToast('Error updating estimated collection date: ' + (error.response?.data?.error || error.message), 'error');
    }
  };

  const handleCancelEdit = () => {
    setEditingDate(null);
  };

  const handleReceivePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedOrderForPayment) return;

    const balanceDue = roundMoney(selectedOrderForPayment.total_amount - (selectedOrderForPayment.paid_amount || 0));
    const payment = roundMoney(parseFloat(paymentAmount) || 0);
    const tol = 0.01;
    
    if (payment <= 0) {
      showToast('Payment amount must be greater than 0', 'error');
      return;
    }
    if (payment < balanceDue - tol) {
      showToast(`Payment must equal the balance due of TSh ${balanceDue.toLocaleString()}. Partial payments are not allowed.`, 'error');
      return;
    }
    if (payment > balanceDue + tol) {
      showToast(`Payment cannot exceed the balance due of TSh ${balanceDue.toLocaleString()}.`, 'error');
      return;
    }

    try {
      setReceivingPayment(true);
      // Find all orders with the same receipt number
      const receiptOrders = orders.filter(o => o.receipt_number === selectedOrderForPayment.receipt_number);
      
      if (receiptOrders.length > 1) {
        // Distribute payment proportionally across all items
        const totalAmount = receiptOrders.reduce((sum, item) => sum + (parseFloat(item.total_amount) || 0), 0);
        const paymentPromises = receiptOrders.map(item => {
          const itemPayment = (payment * (item.total_amount / totalAmount));
          return receivePayment(item.id, {
            payment_amount: itemPayment,
            payment_method: paymentMethod,
            notes: `Payment received for receipt ${selectedOrderForPayment.receipt_number}`
          });
        });
        await Promise.all(paymentPromises);
      } else {
        // Single item payment
        await receivePayment(selectedOrderForPayment.id, {
          payment_amount: payment,
          payment_method: paymentMethod,
          notes: `Payment received for order ${selectedOrderForPayment.receipt_number}`
        });
      }
      
      showToast(`Payment of TSh ${payment.toLocaleString()} received successfully!`, 'success');
      setShowReceivePaymentModal(false);
      setSelectedOrderForPayment(null);
      setPaymentAmount('');
      loadOrders(false); // Reload orders to show updated payment info
    } catch (err) {
      showToast('Error receiving payment: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setReceivingPayment(false);
    }
  };

  const handleStockExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];
    
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
      showToast('Please upload a valid Excel file (.xlsx, .xls) or CSV file', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      showToast('Uploading and processing stock file...', 'info');
      const res = await uploadStockExcel(formData);
      showToast(`Successfully imported ${res.data.imported} orders! ${res.data.skipped > 0 ? `${res.data.skipped} skipped.` : ''}`, 'success');
      if (res.data.errors && res.data.errors.length > 0) {
        console.warn('Import errors:', res.data.errors);
      }
      loadOrders(false);
    } catch (error) {
      showToast('Error uploading file: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      // Reset file input
      e.target.value = '';
    }
  };

  const handleSendReminder = async (orderId, channels = ['sms']) => {
    try {
      setSendingReminder(orderId);
      const res = await sendCollectionReminder(orderId, channels);
      if (res.data.result && res.data.result.success) {
        showToast('Reminder sent successfully!', 'success');
      } else {
        showToast(res.data.result?.error || res.data.error || 'Failed to send reminder', 'warning');
      }
    } catch (error) {
      showToast('Error sending reminder: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setSendingReminder(null);
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'processing': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'collected': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const RECEIPT_COMPACT_THRESHOLD = 12;

  // Print receipt for a receipt group (single page; compact format when many items).
  // Uses original order date/time (when customer brought in the order) and original estimated collection, not reprint time.
  const handlePrintReceipt = async (receiptGroup) => {
    try {
      const receiptOrders = receiptGroup.items;
      if (receiptOrders.length === 0) {
        showToast('No items found for this receipt', 'error');
        return;
      }

      // Use original order date/time (first order in the receipt) so reprint matches the original receipt
      const orderDate = receiptOrders[0].order_date ? new Date(receiptOrders[0].order_date) : new Date();
      const dateStr = `${String(orderDate.getDate()).padStart(2, '0')}/${String(orderDate.getMonth() + 1).padStart(2, '0')}/${orderDate.getFullYear()} ${String(orderDate.getHours()).padStart(2, '0')}:${String(orderDate.getMinutes()).padStart(2, '0')}`;
      const estimatedCollectionDate = receiptGroup.estimated_collection_date
        ? (() => {
            const estDate = new Date(receiptGroup.estimated_collection_date);
            return `Est. Collection: ${String(estDate.getDate()).padStart(2, '0')}/${String(estDate.getMonth() + 1).padStart(2, '0')}/${estDate.getFullYear()} ${String(estDate.getHours()).padStart(2, '0')}:${String(estDate.getMinutes()).padStart(2, '0')}\n`;
          })()
        : '';

      const useCompact = receiptOrders.length > RECEIPT_COMPACT_THRESHOLD;
      const firstOrder = receiptOrders[0];
      const branchLabel = firstOrder?.branch_name || (branch?.id === firstOrder?.branch_id ? branch?.name : null) || (firstOrder?.branch_id ? `Branch ID ${firstOrder.branch_id}` : null) || 'Arusha';
      const branchLine = (firstOrder?.branch_name || firstOrder?.branch_id) ? `Branch: ${branchLabel}\n` : '';

      const headerText = useCompact
        ? `SUPACLEAN | ${branchLabel}\nReceipt: ${receiptGroup.receipt_number} | ${dateStr}\n${estimatedCollectionDate}${receiptGroup.customer_name} | ${receiptGroup.customer_phone}\n`
        : `
═══════════════════════════════════
   Laundry & Dry Cleaning
   ${branchLabel}, Tanzania
═══════════════════════════════════

Receipt No: ${receiptGroup.receipt_number}
${branchLine}Date: ${dateStr}
${estimatedCollectionDate}
Customer: ${receiptGroup.customer_name}
Phone: ${receiptGroup.customer_phone}
───────────────────────────────────
`;
      const brandTitle = useCompact ? null : 'SUPACLEAN';

      const items = [];
      receiptOrders.forEach((order) => {
        const itemName = order.garment_type || order.service_name || 'Item';
        const quantity = order.quantity || 1;
        const color = order.color || '';
        const itemAmount = parseFloat(order.total_amount) || 0;
        let itemDescription = itemName;
        if (color) itemDescription += ` (${color})`;
        items.push({
          qty: String(quantity),
          desc: itemDescription,
          amount: `TSh ${itemAmount.toLocaleString()}`
        });
      });

      const sep = useCompact ? '─'.repeat(32) : '───────────────────────────────────────────';
      let footerText = `${sep}\nTOTAL: TSh ${receiptGroup.total_amount.toLocaleString()}\n`;
      if (receiptGroup.payment_status === 'not_paid') {
        footerText += `NOT PAID\n`;
      } else if (receiptGroup.payment_status === 'paid_full') {
        footerText += `PAID (${(receiptGroup.payment_method || 'cash').toUpperCase()})\n`;
      } else {
        footerText += `ADVANCE | Paid TSh ${receiptGroup.paid_amount.toLocaleString()} | Due TSh ${(receiptGroup.total_amount - receiptGroup.paid_amount).toLocaleString()}\n`;
      }
      footerText += useCompact ? `\nKeep for collection. Thank you!\n` : `\nPlease keep this receipt for collection.\nThank you for choosing SUPACLEAN!\n\n═══════════════════════════════════\n`;

      await printReceiptText({ headerText, items, footerText, brandTitle });
    } catch (error) {
      console.error('Error generating receipt:', error);
      showToast('Error generating receipt: ' + (error.message || 'Unknown error'), 'error');
    }
  };

  // Print receipt text (single page; no black page; Terms QR at end).
  // Accepts either receiptText (string) or { headerText, items, footerText, brandTitle } for centered layout with table (desc wraps, amount visible).
  const printReceiptText = async (receiptTextOrData) => {
    const isStructured = receiptTextOrData && typeof receiptTextOrData === 'object' && Array.isArray(receiptTextOrData.items);
    const receiptText = isStructured ? null : (receiptTextOrData && typeof receiptTextOrData === 'string' ? receiptTextOrData : '');
    if (!isStructured && (!receiptText || !receiptText.trim())) {
      showToast('Error: Invalid receipt data', 'error');
      return;
    }
    const compact = isStructured ? receiptTextOrData.items.length > 12 : (receiptText.match(/\n/g) || []).length > 35;
    // Use public origin for Terms QR so it works when scanned from a phone (not localhost)
    const baseUrl = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_PUBLIC_ORIGIN)
      ? process.env.REACT_APP_PUBLIC_ORIGIN.replace(/\/$/, '')
      : (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const termsUrl = baseUrl ? `${baseUrl}/terms` : '';
    const skipQr = typeof process !== 'undefined' && process.env && process.env.REACT_APP_RECEIPT_SKIP_QR === 'true';
    const termsQrSrc = !skipQr && termsUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=${termsQrSize}x${termsQrSize}&data=${encodeURIComponent(termsUrl)}` : '';
    let termsQrDataUrl = '';
    if (termsQrSrc) {
      const qrTimeoutMs = 3000;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), qrTimeoutMs);
        const res = await fetch(termsQrSrc, { signal: controller.signal });
        clearTimeout(timeoutId);
        const blob = await res.blob();
        termsQrDataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Terms QR fetch failed', e);
      }
    }
    const termsQrBlock = termsQrDataUrl
      ? `<div class="receipt-end"><img src="${termsQrDataUrl}" alt="Terms" width="${termsQrSize}" height="${termsQrSize}" /><p>Scan for Terms / Masharti</p></div>`
      : '';
    const escape = (s) =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const itemsTableRows = isStructured
      ? receiptTextOrData.items.map((r) => `<tr><td class="r-qty">${escape(r.qty)}</td><td class="r-desc">${escape(r.desc)}</td><td class="r-amount">${escape(r.amount)}</td></tr>`).join('')
      : '';
    const brandBlock = (isStructured && receiptTextOrData.brandTitle)
      ? `<div class="receipt-brand">${escape(receiptTextOrData.brandTitle)}</div>`
      : '';
    const bodyContent = isStructured
      ? `${brandBlock}<pre class="receipt-header">${escape(receiptTextOrData.headerText)}</pre>
              <table class="receipt-items"><thead><tr><th class="r-qty">Qty</th><th class="r-desc">Item</th><th class="r-amount">TSh</th></tr></thead><tbody>${itemsTableRows}</tbody></table>
              <pre class="receipt-footer">${escape(receiptTextOrData.footerText)}</pre>`
      : `<pre>${escape(receiptText)}</pre>`;
    const printHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Receipt - SUPACLEAN</title>
            <meta charset="UTF-8">
            <style>
              @media print {
                @page { size: ${receiptWidthCss} auto; margin: 0; }
                html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .receipt-sheet { width: ${receiptWidthCss}; max-width: ${receiptWidthCss}; height: auto !important; min-height: 0 !important; overflow: visible !important; color: #000 !important; }
                body { font-family: 'Courier New', monospace; padding: ${receiptPadding}; margin: 0; background: white; width: ${receiptWidthCss}; max-width: ${receiptWidthCss}; font-size: ${receiptFontSize}; }
                pre, .receipt-items th, .receipt-items td { color: #000 !important; font-weight: 600; }
                .receipt-items .r-desc { color: #000 !important; font-weight: 600; }
                .receipt-footer { font-weight: bold; color: #000 !important; }
                .receipt-end p { font-weight: bold; color: #000 !important; }
                pre { margin: 0; padding: 0; white-space: pre; overflow: visible; }
                body.receipt-compact pre, body.receipt-compact .receipt-items { font-size: 8pt; }
                .receipt-end { margin-top: 6px; page-break-inside: avoid; }
                * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
              @media screen { body { font-family: 'Courier New', monospace; padding: 20px; max-width: ${receiptWidthCss}; margin: 0 auto; background: #f5f5f5; } }
              .receipt-sheet { text-align: center; margin: 0 auto; max-width: ${receiptWidthCss}; }
              .receipt-brand { font-weight: bold; text-align: center; margin: ${receiptBrandMargin}; font-size: ${receiptBrandFontSize}; color: #000; }
              body:not(.receipt-compact) pre, body:not(.receipt-compact) .receipt-items { font-size: ${receiptFontSize}; line-height: 1.15; }
              body.receipt-compact pre, body.receipt-compact .receipt-items { font-size: ${receiptCompactFontSize}; line-height: 1.05; }
              pre { margin: 0; color: black; white-space: pre; }
              .receipt-header, .receipt-footer { text-align: center; }
              .receipt-items { width: 100%; margin: 4px 0; border-collapse: collapse; text-align: center; }
              .receipt-items th, .receipt-items td { padding: 2px 4px; border: none; }
              .receipt-items .r-qty { width: 2.5em; text-align: center; }
              .receipt-items .r-desc { text-align: left; word-wrap: break-word; word-break: break-word; max-width: 1px; color: #000 !important; font-weight: 600; }
              .receipt-items .r-amount { width: 4.5em; text-align: right; white-space: nowrap; }
              .receipt-footer { font-weight: bold; }
              .receipt-end { text-align: center; margin-top: 8px; }
              .receipt-end p { margin: 4px 0 0 0; font-size: 8pt; color: #000; font-weight: bold; }
            </style>
          </head>
          <body class="${compact ? 'receipt-compact' : ''}">
            <div class="receipt-sheet">
              ${bodyContent}
              ${termsQrBlock}
            </div>
            <script>
              function doPrint() { try { window.focus(); window.print(); } catch (e) {} }
              window.onafterprint = function() { setTimeout(function() { try { window.close(); } catch (e) {} }, 500); };
              (function(){
                var run = false;
                function maybePrint() { if (!run) { run = true; setTimeout(doPrint, 350); } }
                var sheet = document.querySelector('.receipt-sheet');
                var img = sheet ? sheet.querySelector('img') : null;
                if (img && !img.complete) {
                  img.onload = maybePrint;
                  img.onerror = maybePrint;
                  setTimeout(maybePrint, 1200);
                } else {
                  if (document.readyState === 'complete') maybePrint();
                  else window.onload = function() { setTimeout(maybePrint, 400); };
                  setTimeout(maybePrint, 1000);
                }
              })();
            </script>
          </body>
        </html>
      `;

    try {
      const isPDA = typeof window !== 'undefined' && window.innerWidth <= 768;
      const printWindow = !isPDA ? window.open('', '_blank', 'width=400,height=600,scrollbars=yes') : null;
      if (printWindow && !printWindow.closed) {
        printWindow.document.open();
        printWindow.document.write(printHTML);
        printWindow.document.close();
        showToast('Receipt opened. Select your thermal printer.', 'success');
      } else {
        // PDA / popup blocked: use iframe so we print only receipt content, never the main page
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;border:none;visibility:hidden';
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(printHTML);
        doc.close();
        const cleanup = () => {
          try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) {}
        };
        iframe.contentWindow.onload = () => {
          setTimeout(() => {
            try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {}
            setTimeout(cleanup, 1500);
          }, 400);
        };
        setTimeout(cleanup, 3000);
        showToast('Print dialog opened. Choose your thermal printer.', 'info');
      }
    } catch (error) {
      console.error('Error printing receipt:', error);
      showToast('Error printing receipt: ' + (error?.message || 'Unknown error'), 'error');
    }
  };

  // Group orders by receipt number
  const groupOrdersByReceipt = (ordersList) => {
    const grouped = {};
    ordersList.forEach(order => {
      const receiptNum = order.receipt_number;
      if (!grouped[receiptNum]) {
        grouped[receiptNum] = {
          receipt_number: receiptNum,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          order_date: order.order_date,
          estimated_collection_date: order.estimated_collection_date,
          items: [],
          total_amount: 0,
          paid_amount: 0,
          payment_status: order.payment_status,
          payment_method: order.payment_method,
          status: order.status, // Use the most common status or 'pending' if mixed
          order_ids: []
        };
      }
      grouped[receiptNum].items.push(order);
      grouped[receiptNum].total_amount += parseFloat(order.total_amount) || 0;
      grouped[receiptNum].paid_amount += parseFloat(order.paid_amount) || 0;
      grouped[receiptNum].order_ids.push(order.id);
      
      // Determine overall status (if all ready, show ready; if any pending, show pending; etc.)
      const statuses = grouped[receiptNum].items.map(o => o.status);
      if (statuses.every(s => s === 'ready')) {
        grouped[receiptNum].status = 'ready';
      } else if (statuses.some(s => s === 'pending')) {
        grouped[receiptNum].status = 'pending';
      } else if (statuses.some(s => s === 'processing')) {
        grouped[receiptNum].status = 'processing';
      } else if (statuses.every(s => s === 'collected')) {
        grouped[receiptNum].status = 'collected';
      }
    });
    return Object.values(grouped);
  };

  const toggleReceiptExpansion = (receiptNumber) => {
    const newExpanded = new Set(expandedReceipts);
    if (newExpanded.has(receiptNumber)) {
      newExpanded.delete(receiptNumber);
    } else {
      newExpanded.add(receiptNumber);
    }
    setExpandedReceipts(newExpanded);
  };

  const paymentStatusLabel = (ps) => {
    if (ps === 'paid_full') return 'Paid';
    if (ps === 'advance') return 'Advance';
    return 'Unpaid';
  };

  const buildOrderExportRows = (ordersList) => {
    const grouped = groupOrdersByReceipt(ordersList);
    return grouped.map(g => {
      const outstanding = roundMoney((g.total_amount || 0) - (g.paid_amount || 0));
      const first = g.items && g.items[0];
      return {
        branch_id: first?.branch_id ?? '',
        branch_name: first?.branch_name ?? '',
        receipt_number: g.receipt_number ?? '',
        customer_name: g.customer_name ?? '',
        customer_phone: g.customer_phone ?? '',
        total_amount: roundMoney(g.total_amount || 0),
        paid_amount: roundMoney(g.paid_amount || 0),
        outstanding,
        payment_status_label: paymentStatusLabel(g.payment_status),
        order_date: g.order_date ? new Date(g.order_date).toLocaleDateString() : '',
        estimated_collection_date: g.estimated_collection_date ? new Date(g.estimated_collection_date).toLocaleString() : '',
        status: g.status ?? '',
      };
    });
  };

  const handleExportOrders = async (format) => {
    setExporting(true);
    try {
      const params = { limit: 500, offset: 0 };
      if (selectedBranchId) params.branch_id = selectedBranchId;
      if (filter !== 'all') params.status = filter;
      Object.assign(params, {
        date_from: debouncedSearchFilters.dateFrom || undefined,
        date_to: debouncedSearchFilters.dateTo || undefined,
        min_amount: debouncedSearchFilters.minAmount || undefined,
        max_amount: debouncedSearchFilters.maxAmount || undefined,
        payment_status: debouncedSearchFilters.paymentStatus || undefined,
        overdue_only: debouncedSearchFilters.overdueOnly ? 'true' : undefined,
        customer: debouncedSearchFilters.customer || undefined,
      });
      const res = await getOrders(params);
      const data = res.data || [];
      if (data.length === 0) {
        showToast('No orders to export', 'info');
        return;
      }
      const rows = buildOrderExportRows(data);
      const title = `Orders_${filter}_${new Date().toISOString().slice(0, 10)}`;
      const exportBranch = { branchName: branch?.name || rows[0]?.branch_name, branchId: branch?.id ?? selectedBranchId ?? rows[0]?.branch_id };
      if (format === 'pdf') exportToPDF(title, ORDERS_EXPORT_COLUMNS, rows, exportBranch);
      else exportToExcel(title, ORDERS_EXPORT_COLUMNS, rows, exportBranch);
      showToast(`Exported ${rows.length} receipt(s) as ${format.toUpperCase()}`, 'success');
      setShowExportPopup(false);
    } catch (error) {
      showToast('Export failed: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportUncollectedStock = async (format) => {
    setExportingUncollected(true);
    try {
      const params = { status: 'ready', overdue_only: 'true', limit: 500 };
      if (selectedBranchId) params.branch_id = selectedBranchId;
      const res = await getOrders(params);
      const data = res.data || [];
      if (data.length === 0) {
        showToast('No uncollected (overdue) stock to export', 'info');
        return;
      }
      const rows = buildOrderExportRows(data);
      const title = 'Uncollected_Stock_' + new Date().toISOString().slice(0, 10);
      const exportBranch = { branchName: branch?.name || rows[0]?.branch_name, branchId: branch?.id ?? selectedBranchId ?? rows[0]?.branch_id };
      if (format === 'pdf') exportToPDF(title, ORDERS_EXPORT_COLUMNS, rows, exportBranch);
      else exportToExcel(title, ORDERS_EXPORT_COLUMNS, rows, exportBranch);
      showToast(`Exported ${rows.length} uncollected receipt(s) as ${format.toUpperCase()}`, 'success');
      setShowExportPopup(false);
    } catch (error) {
      showToast('Export failed: ' + (error.response?.data?.error || error.message), 'error');
    } finally {
      setExportingUncollected(false);
    }
  };

  // Get consolidated orders
  const consolidatedOrders = groupOrdersByReceipt(orders);

  // Helper to get receipt group for a receipt number
  const getReceiptGroup = (receiptNumber) => {
    return consolidatedOrders.find(r => r.receipt_number === receiptNumber);
  };

  return (
    <div className="orders-page">
      <ToastContainer />
      {showExportPopup && (
        <div className="export-popup-overlay" onClick={() => setShowExportPopup(false)} role="dialog" aria-label="Export options">
          <div className="export-popup" onClick={e => e.stopPropagation()}>
            <div className="export-popup-header">
              <h3>Export</h3>
              <button type="button" className="export-popup-close" onClick={() => setShowExportPopup(false)} aria-label="Close">×</button>
            </div>
            <div className="export-popup-section">
              <p className="export-popup-label">Current orders (this tab & filters)</p>
              <div className="export-popup-actions">
                <button className="btn-primary" onClick={() => handleExportOrders('pdf')} disabled={exporting}>PDF</button>
                <button className="btn-primary" onClick={() => handleExportOrders('excel')} disabled={exporting}>Excel</button>
              </div>
            </div>
            <div className="export-popup-section">
              <p className="export-popup-label">Uncollected stock (overdue, not collected)</p>
              <div className="export-popup-actions">
                <button className="btn-primary" onClick={() => handleExportUncollectedStock('pdf')} disabled={exportingUncollected}>PDF</button>
                <button className="btn-primary" onClick={() => handleExportUncollectedStock('excel')} disabled={exportingUncollected}>Excel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {lastSyncedAt && (
        <div className="sync-cache-banner" role="status">
          Showing data from last sync — {new Date(lastSyncedAt).toLocaleString()}
        </div>
      )}
      <div className="page-header-modern">
        <div>
          <h1>Orders</h1>
          <p className="subtitle">View and manage all orders</p>
        </div>
        <div className="header-actions">
          <button
            className="btn-secondary"
            style={{ marginRight: '8px' }}
            onClick={() => setShowExportPopup(true)}
            disabled={exporting || exportingUncollected}
            title="Export orders or uncollected stock"
          >
            {(exporting || exportingUncollected) ? '…' : 'Export'}
          </button>
          <label className="btn-secondary" style={{ cursor: 'pointer' }} title="Format: id, name, phone, amount, paid/not paid. All uploaded stock is uncollected (Ready). See UPLOAD_STOCK_FORMAT.md">
            📦 Upload Stock Excel
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleStockExcelUpload}
            />
          </label>
        </div>
      </div>

      <div className="orders-filters-section">
        <div className="orders-filters">
          {['all', 'pending', 'ready', 'collected'].map(status => (
              <button
              key={status}
              className={`filter-btn ${filter === status ? 'active' : ''}`}
              onClick={() => setFilter(status)}
            >
              {status === 'pending' ? 'Pending Orders' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
          <button
            className="filter-btn btn-secondary"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            {showAdvancedFilters ? '🔽 Hide Filters' : '🔍 Advanced Filters'}
          </button>
        </div>

        {showAdvancedFilters && (
          <div className="advanced-filters-card">
            <div className="filters-grid">
              <div className="filter-group">
                <label>Customer (Name/Phone)</label>
                <input
                  type="text"
                  placeholder="Search customer..."
                  value={searchFilters.customer}
                  onChange={(e) => handleFilterChange('customer', e.target.value)}
                />
              </div>
              
              <div className="filter-group">
                <label>Date From</label>
                <input
                  type="date"
                  value={searchFilters.dateFrom}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                />
              </div>
              
              <div className="filter-group">
                <label>Date To</label>
                <input
                  type="date"
                  value={searchFilters.dateTo}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                />
              </div>
              
              <div className="filter-group">
                <label>Min Amount (TSh)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={searchFilters.minAmount}
                  onChange={(e) => handleFilterChange('minAmount', e.target.value)}
                  min="0"
                />
              </div>
              
              <div className="filter-group">
                <label>Max Amount (TSh)</label>
                <input
                  type="number"
                  placeholder="Any"
                  value={searchFilters.maxAmount}
                  onChange={(e) => handleFilterChange('maxAmount', e.target.value)}
                  min="0"
                />
              </div>
              
              <div className="filter-group">
                <label>Payment Status</label>
                <select
                  value={searchFilters.paymentStatus}
                  onChange={(e) => handleFilterChange('paymentStatus', e.target.value)}
                >
                  <option value="">All</option>
                  <option value="not_paid">Not Paid</option>
                  <option value="advance">Advance Payment</option>
                  <option value="paid_full">Paid Full</option>
                </select>
              </div>
            </div>
            
            <div className="filter-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={searchFilters.overdueOnly}
                  onChange={(e) => handleFilterChange('overdueOnly', e.target.checked)}
                />
                <span>Show only overdue orders</span>
              </label>
            </div>
            
            <div className="filter-actions">
              <button className="btn-primary" onClick={handleApplyFilters}>
                🔍 Apply Filters
              </button>
              <button className="btn-secondary" onClick={handleClearFilters}>
                ✕ Clear All
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading orders...</div>
      ) : consolidatedOrders.length === 0 ? (
        <div className="empty-state">No orders found</div>
      ) : (
        <>
        <div className="orders-table">
          <div className="orders-table-wrapper">
            <table>
            <thead>
              <tr>
                <th style={{ width: '30px' }}></th>
                <th>Receipt No</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total Amount</th>
                <th>Payment</th>
                <th>Order Date</th>
                <th>Est. Collection</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {consolidatedOrders.map((receiptGroup) => {
                const isExpanded = expandedReceipts.has(receiptGroup.receipt_number);
                const balance = receiptGroup.total_amount - receiptGroup.paid_amount;
                const itemCount = receiptGroup.items.length;
                
                return (
                  <Fragment key={receiptGroup.receipt_number}>
                    {/* Main consolidated row */}
                    <tr className="receipt-group-row" style={{ backgroundColor: isExpanded ? 'var(--bg-hover)' : 'transparent' }}>
                      <td>
                        <button
                          className="expand-btn"
                          onClick={() => toggleReceiptExpansion(receiptGroup.receipt_number)}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '4px 8px'
                          }}
                          title={isExpanded ? 'Collapse' : 'Expand to see items'}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td><strong>{receiptGroup.receipt_number}</strong></td>
                      <td>
                        <div>
                          <strong>{receiptGroup.customer_name}</strong>
                          <span>{receiptGroup.customer_phone}</span>
                        </div>
                      </td>
                      <td>
                        <div className="order-details">
                          <span style={{ fontWeight: '600' }}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                          {!isExpanded && (
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              {receiptGroup.items.slice(0, 2).map((item, idx) => (
                                <div key={idx}>
                                  {item.garment_type || item.service_name} x{item.quantity}
                                  {item.color && ` (${item.color})`}
                                </div>
                              ))}
                              {itemCount > 2 && <div>+ {itemCount - 2} more...</div>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td><strong>TSh {receiptGroup.total_amount.toLocaleString()}</strong></td>
                      <td>
                        <div className="payment-info">
                          <div>Paid: TSh {receiptGroup.paid_amount.toLocaleString()}</div>
                          {balance > 0 ? (
                            <div style={{ color: 'var(--warning-color)', fontWeight: 'bold' }}>
                              Balance: TSh {balance.toLocaleString()}
                            </div>
                          ) : (
                            <div style={{ color: 'var(--success-color)' }}>✅ Paid Full</div>
                          )}
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {receiptGroup.payment_status === 'not_paid' ? 'Not Paid' : 
                             receiptGroup.payment_status === 'advance' ? 'Advance' : 'Paid Full'}
                          </div>
                        </div>
                      </td>
                      <td>{new Date(receiptGroup.order_date).toLocaleDateString()}</td>
                      <td>
                        {editingDate && editingDate.receiptNumber === receiptGroup.receipt_number ? (
                          <div className="date-edit-controls">
                            <input
                              type="datetime-local"
                              value={editingDate.value}
                              onChange={(e) => setEditingDate({ ...editingDate, value: e.target.value })}
                              min={new Date().toISOString().slice(0, 16)}
                              className="date-edit-input"
                              autoFocus
                            />
                            <div className="date-edit-buttons">
                              <button
                                className="btn-small btn-success"
                                onClick={() => {
                                  // Update all orders in this receipt group
                                  receiptGroup.items.forEach(item => {
                                    handleSaveEstimatedDate(item.id);
                                  });
                                }}
                                title="Save"
                              >
                                ✓
                              </button>
                              <button
                                className="btn-small btn-secondary"
                                onClick={handleCancelEdit}
                                title="Cancel"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div 
                            className="estimated-date-cell"
                            onClick={() => {
                              const firstOrder = receiptGroup.items[0];
                              handleEditEstimatedDate(firstOrder.id, receiptGroup.estimated_collection_date);
                              setEditingDate(prev => ({ ...prev, receiptNumber: receiptGroup.receipt_number }));
                            }}
                            title="Click to edit"
                          >
                            <span className={receiptGroup.estimated_collection_date ? '' : 'not-set'}>
                              {formatDateTime(receiptGroup.estimated_collection_date)}
                            </span>
                            <button
                              className="edit-date-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const firstOrder = receiptGroup.items[0];
                                handleEditEstimatedDate(firstOrder.id, receiptGroup.estimated_collection_date);
                                setEditingDate(prev => ({ ...prev, receiptNumber: receiptGroup.receipt_number }));
                              }}
                              title="Edit estimated collection date"
                            >
                              ✏️
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className="status-badge"
                          style={{ backgroundColor: getStatusColor(receiptGroup.status === 'processing' ? 'pending' : receiptGroup.status) }}
                        >
                          {receiptGroup.status === 'processing' ? 'Pending' : receiptGroup.status}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          {receiptGroup.status === 'pending' && (
                            <button
                              className="btn-small btn-success"
                              onClick={() => {
                                receiptGroup.items.forEach(item => {
                                  handleStatusUpdate(item.id, 'ready');
                                });
                              }}
                              title="Mark order as ready for collection"
                            >
                              ✓ Mark as Ready
                            </button>
                          )}
                          {receiptGroup.status === 'processing' && (
                            <button
                              className="btn-small btn-success"
                              onClick={() => {
                                receiptGroup.items.forEach(item => {
                                  handleStatusUpdate(item.id, 'ready');
                                });
                              }}
                              title="Mark all ready"
                            >
                              Ready All
                            </button>
                          )}
                          {receiptGroup.status === 'ready' && (
                            <>
                              <button
                                className="btn-small btn-warning"
                                onClick={() => {
                                  receiptGroup.items.forEach(item => {
                                    handleStatusUpdate(item.id, 'collected');
                                  });
                                }}
                                disabled={balance > 0}
                                title={balance > 0 ? 'Payment required before collection. Use Pay first.' : 'Collect all items'}
                              >
                                Collect All
                              </button>
                              <button
                                className="btn-small btn-secondary"
                                onClick={() => {
                                  receiptGroup.items.forEach(item => {
                                    handleSendReminder(item.id);
                                  });
                                }}
                                disabled={sendingReminder !== null}
                                title="Send collection reminder"
                                style={{ marginTop: '4px' }}
                              >
                                {sendingReminder ? '⏳ Sending...' : '📱 Remind'}
                              </button>
                            </>
                          )}
                          {balance > 0 && (
                            <button
                              className="btn-small btn-primary"
                              onClick={() => {
                                // Use first order for payment modal (all share same receipt)
                                setSelectedOrderForPayment({
                                  ...receiptGroup.items[0],
                                  total_amount: receiptGroup.total_amount,
                                  paid_amount: receiptGroup.paid_amount
                                });
                                setPaymentAmount(balance.toString());
                                setShowReceivePaymentModal(true);
                              }}
                              style={{ marginTop: '4px' }}
                            >
                              💰 Pay
                            </button>
                          )}
                          <button
                            className="btn-small btn-secondary"
                            onClick={() => handlePrintReceipt(receiptGroup)}
                            style={{ marginTop: '4px' }}
                            title="Reprint receipt"
                          >
                            🖨️ Reprint Receipt
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Expanded items rows */}
                    {isExpanded && receiptGroup.items.map((item, idx) => (
                      <tr key={`${receiptGroup.receipt_number}-item-${idx}`} className="receipt-item-row" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                        <td></td>
                        <td style={{ paddingLeft: '40px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Item {idx + 1}
                        </td>
                        <td colSpan="2">
                          <div className="order-details" style={{ fontSize: '13px' }}>
                            <span><strong>Type:</strong> {item.garment_type || item.service_name}</span>
                            {item.color && <span><strong>Color:</strong> {item.color}</span>}
                            <span><strong>Qty:</strong> {item.quantity}</span>
                            {item.weight_kg && <span><strong>Weight:</strong> {item.weight_kg}kg</span>}
                          </div>
                        </td>
                        <td style={{ fontSize: '13px' }}>TSh {item.total_amount.toLocaleString()}</td>
                        <td>
                          <div className="action-buttons">
                            {(item.status === 'pending' || item.status === 'processing') && (
                              <>
                                {item.status === 'pending' && (
                                  <button
                                    className="btn-small btn-primary"
                                    onClick={() => handleStatusUpdate(item.id, 'processing')}
                                  >
                                    Start
                                  </button>
                                )}
                                {item.status === 'processing' && (
                                  <button
                                    className="btn-small btn-success"
                                    onClick={() => handleStatusUpdate(item.id, 'ready')}
                                  >
                                    Ready
                                  </button>
                                )}
                              </>
                            )}
                            {item.status === 'ready' && (
                              <button
                                className="btn-small btn-warning"
                                onClick={() => handleStatusUpdate(item.id, 'collected')}
                                disabled={balance > 0}
                                title={balance > 0 ? 'Payment required before collection. Use Pay first.' : 'Collect'}
                              >
                                Collect
                              </button>
                            )}
                          </div>
                        </td>
                        <td colSpan="4"></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        {hasMore && !loading && (
          <div className="load-more-row" style={{ padding: '12px', textAlign: 'center' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => loadOrders(true, orders.length)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more orders'}
            </button>
          </div>
        )}
        </>
      )}

      {/* Receive Payment Modal */}
      {showReceivePaymentModal && selectedOrderForPayment && (
        <div className="modal-overlay" onClick={() => setShowReceivePaymentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>💰 Receive Payment</h2>
              <button className="modal-close" onClick={() => setShowReceivePaymentModal(false)}>×</button>
            </div>
            <form onSubmit={handleReceivePaymentSubmit}>
              <div className="modal-body">
                <div className="payment-summary">
                  <div className="payment-item">
                    <span>Receipt No:</span>
                    <strong>{selectedOrderForPayment.receipt_number}</strong>
                  </div>
                  <div className="payment-item">
                    <span>Customer:</span>
                    <strong>{selectedOrderForPayment.customer_name}</strong>
                  </div>
                  <div className="payment-item">
                    <span>Total Amount:</span>
                    <strong>TSh {selectedOrderForPayment.total_amount.toLocaleString()}</strong>
                  </div>
                  <div className="payment-item">
                    <span>Amount Paid:</span>
                    <strong>TSh {(selectedOrderForPayment.paid_amount || 0).toLocaleString()}</strong>
                  </div>
                  <div className="payment-item balance-due">
                    <span>Balance Due:</span>
                    <strong>TSh {(selectedOrderForPayment.total_amount - (selectedOrderForPayment.paid_amount || 0)).toLocaleString()}</strong>
                  </div>
                </div>
                <div className="form-group">
                  <label>Payment Amount * (must equal balance due)</label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={`Enter exactly TSh ${(selectedOrderForPayment.total_amount - (selectedOrderForPayment.paid_amount || 0)).toLocaleString()}`}
                    min="0"
                    step="0.01"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Payment Method *</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    required
                  >
                    <option value="cash">Cash</option>
                    <option value="mobile_money">Mobile Money</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
                <div className="info-notice" style={{ marginTop: '15px', padding: '10px', background: 'var(--primary-light)', borderRadius: '8px', fontSize: '14px' }}>
                  ℹ️ This will record the payment and update the order's payment status. The order status will remain unchanged.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => {
                  setShowReceivePaymentModal(false);
                  setSelectedOrderForPayment(null);
                  setPaymentAmount('');
                }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={receivingPayment}>
                  {receivingPayment ? '⏳ Processing...' : '💰 Receive Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Orders;
