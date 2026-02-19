import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import {
  getOverviewReport,
  getFinancialReport,
  getDailyProfitReport,
  getSalesReport,
  getServiceReport,
  getCustomerReport
} from '../api/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../contexts/AuthContext';
import './Reports.css';

class ChartErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Chart error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="report-chart-wrap report-chart-fallback" role="alert">
          <p>Chart could not be displayed. Tables below still show the data.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const formatTSh = (n) => (n != null && !Number.isNaN(n) ? `TSh ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'TSh 0');

const presetRanges = () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const toStr = (date) => date.toISOString().split('T')[0];
  return {
    last7: {
      start: toStr(new Date(y, m, d - 6)),
      end: toStr(today),
      label: 'Last 7 days'
    },
    thisMonth: {
      start: toStr(new Date(y, m, 1)),
      end: toStr(today),
      label: 'This month'
    },
    lastMonth: {
      start: toStr(new Date(y, m - 1, 1)),
      end: toStr(new Date(y, m, 0)),
      label: 'Last month'
    },
    today: {
      start: toStr(today),
      end: toStr(today),
      label: 'Today'
    }
  };
};

const exportCSV = (rows, columns, filename, branchLabel) => {
  if (!rows || rows.length === 0) return;
  const headers = columns.map((c) => (typeof c === 'string' ? c : c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => {
      const key = typeof col === 'string' ? col : col.key;
      let val = row[key];
      if (val instanceof Date) val = val.toISOString().split('T')[0];
      if (typeof val === 'number') return val;
      return `"${String(val ?? '').replace(/"/g, '""')}"`;
    }).join(',')
  );
  const headerLine = branchLabel ? `Branch: ${branchLabel}\n` : '';
  const csv = headerLine + [headers, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename || 'report.csv';
  link.click();
  URL.revokeObjectURL(link.href);
};

const Reports = () => {
  const [searchParams] = useSearchParams();
  const { showToast, ToastContainer } = useToast();
  const { branch } = useAuth();
  const csvBranchLabel = branch?.name || (branch?.id != null ? `Branch ID ${branch.id}` : null);
  const [summary, setSummary] = useState(null);
  const [financialReport, setFinancialReport] = useState(null);
  const [profitReport, setProfitReport] = useState([]);
  const [salesReport, setSalesReport] = useState([]);
  const [serviceReport, setServiceReport] = useState([]);
  const [customerReport, setCustomerReport] = useState([]);
  const [dateRange, setDateRange] = useState(() => {
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (start && end) return { start, end };
    const presets = presetRanges();
    return {
      start: presets.last7.start,
      end: presets.last7.end
    };
  });
  const [reportPeriod, setReportPeriod] = useState('day');
  const [customerFilter, setCustomerFilter] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedSections, setExpandedSections] = useState({
    sales: true,
    services: true,
    customers: true,
    financial: true,
    dailyProfit: true
  });
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const [summaryRes, financialRes, profitRes, salesRes, serviceRes, customerRes] = await Promise.all([
        getOverviewReport(today),
        getFinancialReport(dateRange.start, dateRange.end, reportPeriod),
        getDailyProfitReport(dateRange.start, dateRange.end),
        getSalesReport(dateRange.start, dateRange.end),
        getServiceReport(dateRange.start, dateRange.end),
        getCustomerReport({ month: customerFilter.month, year: customerFilter.year })
      ]);

      setSummary(summaryRes.data);
      setFinancialReport(financialRes.data);
      setProfitReport(profitRes.data || []);
      setSalesReport(salesRes.data || []);
      setServiceReport(serviceRes.data || []);
      setCustomerReport(customerRes.data || []);
      const synced = [summaryRes, financialRes, salesRes, serviceRes, customerRes].find((r) => r.fromCache && r.syncedAt);
      if (synced) setLastSyncedAt(synced.syncedAt); else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading reports:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Network Error';
      setLoadError(errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network Error')
        ? 'Cannot connect to server. Ensure the backend is running (npm run dev).'
        : errorMsg);
      setSummary(null);
      setFinancialReport(null);
      setProfitReport([]);
      setSalesReport([]);
      setServiceReport([]);
      setCustomerReport([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange.start, dateRange.end, reportPeriod, customerFilter.month, customerFilter.year]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const applyPreset = (key) => {
    const presets = presetRanges();
    const p = presets[key];
    if (p) {
      setDateRange({ start: p.start, end: p.end });
      showToast(`Date range set to ${p.label}`, 'info');
    }
  };

  const handleCustomerFilterChange = async () => {
    setLoading(true);
    try {
      const res = await getCustomerReport({ month: customerFilter.month, year: customerFilter.year });
      setCustomerReport(res.data || []);
      if (res.fromCache && res.syncedAt) setLastSyncedAt(res.syncedAt); else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading customer report:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateRangeChange = async () => {
    setLoading(true);
    try {
      const [financialRes, profitRes, salesRes, serviceRes] = await Promise.all([
        getFinancialReport(dateRange.start, dateRange.end, reportPeriod),
        getDailyProfitReport(dateRange.start, dateRange.end),
        getSalesReport(dateRange.start, dateRange.end),
        getServiceReport(dateRange.start, dateRange.end)
      ]);
      setFinancialReport(financialRes.data);
      setProfitReport(profitRes.data || []);
      setSalesReport(salesRes.data);
      setServiceReport(serviceRes.data);
      const synced = [financialRes, salesRes, serviceRes].find((r) => r.fromCache && r.syncedAt);
      if (synced) setLastSyncedAt(synced.syncedAt); else setLastSyncedAt(null);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const hasFinancialData = financialReport?.data?.length > 0;
  const hasProfitData = profitReport?.length > 0;
  const hasSalesData = salesReport?.length > 0;
  const hasServiceData = serviceReport?.length > 0;
  const hasCustomerData = customerReport?.length > 0;

  const overviewSummaryLine = summary
    ? `Today: ${formatTSh(summary.total_income)} income · ${summary.total_transactions || 0} transactions · Net ${formatTSh(summary.net_income)}`
    : 'No data for today yet.';
  const financialSummaryLine = hasFinancialData && financialReport?.totals
    ? `Period ${dateRange.start} – ${dateRange.end}: Revenue ${formatTSh(financialReport.totals.total_revenue)} · Expenses ${formatTSh(financialReport.totals.total_expenses)} · Profit ${formatTSh(financialReport.totals.total_profit)}`
    : 'No reconciled data for this period. Reconcile days in Cash Management to see financial report.';
  const salesSummaryLine = hasSalesData
    ? `${salesReport.length} days · Total revenue ${formatTSh(salesReport.reduce((s, d) => s + (parseFloat(d.total_revenue) || 0), 0))} · ${salesReport.reduce((s, d) => s + (d.total_orders || 0), 0)} orders`
    : 'No sales data for this period.';
  const servicesSummaryLine = hasServiceData
    ? `${serviceReport.length} services · Total revenue ${formatTSh(serviceReport.reduce((s, r) => s + (parseFloat(r.total_revenue) || 0), 0))}`
    : 'No service data for this period.';
  const customersSummaryLine = hasCustomerData
    ? `Top ${Math.min(20, customerReport.length)} customers · ${customerFilter.month}/${customerFilter.year}`
    : 'No customer data for this month.';

  if (loadError && !summary && !financialReport) {
    return (
      <div className="reports-page">
        <ToastContainer />
        <div className="page-header">
          <h1>Reports & Analytics</h1>
          <p>View business insights and statistics</p>
        </div>
        <div className="reports-error-state">
          <p className="reports-error-message">{loadError}</p>
          <button type="button" className="btn-primary" onClick={loadReports}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="reports-page">
        <ToastContainer />
        <div className="loading">Loading reports...</div>
      </div>
    );
  }

  const chartColors = { revenue: 'var(--primary-color)', expenses: '#f44336', profit: '#4caf50' };
  const profitChartData = (profitReport || [])
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      revenue: parseFloat(r.revenue || 0),
      expenses: parseFloat(r.expenses || 0),
      profit: parseFloat(r.profit || 0)
    }));
  const salesChartData = (salesReport || []).slice().reverse().map((d) => ({
    date: d.date,
    revenue: parseFloat(d.total_revenue || 0),
    orders: parseInt(d.total_orders || 0, 10)
  }));
  const serviceChartData = (serviceReport || []).slice(0, 10).map((s) => ({
    name: (s.service_name || 'Other').substring(0, 15),
    revenue: parseFloat(s.total_revenue || 0),
    orders: parseInt(s.order_count || 0, 10)
  }));

  return (
    <div className="reports-page">
      <ToastContainer />
      {lastSyncedAt && (
        <div className="sync-cache-banner" role="status">
          Showing data from last sync — {new Date(lastSyncedAt).toLocaleString()}
        </div>
      )}
      <div className="page-header">
        <h1>Reports & Analytics</h1>
        <p>View business insights and statistics</p>
      </div>

      <div className="reports-tabs-wrap">
        <div className="reports-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'sales' ? 'active' : ''}`}
            onClick={() => setActiveTab('sales')}
          >
            💰 Sales
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'customers' ? 'active' : ''}`}
            onClick={() => setActiveTab('customers')}
          >
            👥 Customers
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setActiveTab('services')}
          >
            🧺 Services
          </button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
          <p className="report-summary-line" aria-live="polite">{overviewSummaryLine}</p>
          <div className="today-summary">
            <h2>Today&apos;s Summary</h2>
            <div className="summary-cards-compact">
              <div className="summary-card-compact">
                <div className="summary-label-compact">Total Income</div>
                <div className="summary-value-compact">{formatTSh(summary?.total_income)}</div>
              </div>
              <div className="summary-card-compact">
                <div className="summary-label-compact">Cash Income</div>
                <div className="summary-value-compact">{formatTSh(summary?.cash_income)}</div>
              </div>
              <div className="summary-card-compact">
                <div className="summary-label-compact">Total Transactions</div>
                <div className="summary-value-compact">{summary?.total_transactions ?? 0}</div>
              </div>
              <div className="summary-card-compact">
                <div className="summary-label-compact">Net Income</div>
                <div className="summary-value-compact">{formatTSh(summary?.net_income)}</div>
              </div>
            </div>
          </div>

          <div className="date-range-selector">
            <h2>Financial Report (Reconciled Data)</h2>
            <div className="date-presets">
              {Object.entries(presetRanges()).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  className="preset-btn"
                  onClick={() => applyPreset(key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="date-inputs">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                aria-label="Start date"
              />
              <span>to</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                aria-label="End date"
              />
              <select
                value={reportPeriod}
                onChange={(e) => setReportPeriod(e.target.value)}
                className="report-period-select"
                aria-label="Group by"
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
              <button type="button" className="btn-primary" onClick={handleDateRangeChange}>
                Update Report
              </button>
              {hasFinancialData && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    exportCSV(
                      financialReport.data,
                      [
                        { key: 'period', label: 'Period' },
                        { key: 'total_revenue', label: 'Revenue' },
                        { key: 'total_expenses', label: 'Expenses' },
                        { key: 'profit', label: 'Profit' },
                        { key: 'reconciled_days', label: 'Reconciled Days' }
                      ],
                      `financial-${dateRange.start}-${dateRange.end}.csv`,
                      csvBranchLabel
                    )
                  }
                >
                  Export CSV
                </button>
              )}
            </div>
            <p className="report-summary-line report-summary-line--muted">{financialSummaryLine}</p>

            {hasFinancialData && (
              <div className="report-totals-cards">
                <div className="report-total-card revenue">
                  <span className="report-total-label">Total Revenue</span>
                  <span className="report-total-value">{formatTSh(financialReport.totals?.total_revenue)}</span>
                </div>
                <div className="report-total-card expenses">
                  <span className="report-total-label">Total Expenses</span>
                  <span className="report-total-value">{formatTSh(financialReport.totals?.total_expenses)}</span>
                </div>
                <div className="report-total-card profit">
                  <span className="report-total-label">Total Profit</span>
                  <span className="report-total-value" style={{ color: (financialReport.totals?.total_profit ?? 0) >= 0 ? '#4caf50' : '#f44336' }}>
                    {formatTSh(financialReport.totals?.total_profit)}
                  </span>
                </div>
              </div>
            )}

            {hasFinancialData && (
              <div className="table-wrapper" style={{ marginTop: '16px' }}>
                <table className="report-table-compact" aria-label="Financial report by period">
                  <caption className="sr-only">Financial report by period: revenue, expenses, profit, reconciled days</caption>
                  <thead>
                    <tr>
                      <th scope="col">Period</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Revenue</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Expenses</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Profit</th>
                      <th scope="col" style={{ textAlign: 'center' }}>Reconciled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialReport.data.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.period}</td>
                        <td style={{ textAlign: 'right', color: 'var(--primary-color)' }}>
                          {formatTSh(row.total_revenue)}
                        </td>
                        <td style={{ textAlign: 'right', color: '#f44336' }}>{formatTSh(row.total_expenses)}</td>
                        <td style={{ textAlign: 'right', color: parseFloat(row.profit || 0) >= 0 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>
                          {formatTSh(row.profit)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {row.reconciled_days > 0 ? `✅ ${row.reconciled_days}/${row.days_count}` : '❌'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!hasFinancialData && (
              <p className="empty-state empty-state--explained">
                No reconciled data for this period. Close and reconcile days in <strong>Cash Management</strong> to see revenue, expenses and profit here.
              </p>
            )}
          </div>

          {/* Daily Profit section */}
          <div className="report-card-compact">
            <h2>
              <span>Daily Profit (Reconciled)</span>
              <button
                type="button"
                className="collapse-btn"
                onClick={() => toggleSection('dailyProfit')}
                aria-expanded={expandedSections.dailyProfit}
              >
                {expandedSections.dailyProfit ? '▼' : '▶'}
              </button>
            </h2>
            {expandedSections.dailyProfit && (
              <>
                {hasProfitData && profitChartData.length > 0 && (
                  <ChartErrorBoundary>
                    <div className="report-chart-wrap">
                      <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={profitChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(5) : '')} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                          <Tooltip formatter={(v) => [formatTSh(v), '']} labelFormatter={(l) => `Date: ${l}`} />
                          <Area type="monotone" dataKey="revenue" stroke={chartColors.revenue} fill={chartColors.revenue} fillOpacity={0.3} name="Revenue" />
                          <Area type="monotone" dataKey="expenses" stroke={chartColors.expenses} fill={chartColors.expenses} fillOpacity={0.3} name="Expenses" />
                          <Area type="monotone" dataKey="profit" stroke={chartColors.profit} fill={chartColors.profit} fillOpacity={0.3} name="Profit" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartErrorBoundary>
                )}
                {hasProfitData ? (
                  <div className="table-wrapper">
                    <table className="report-table-compact" aria-label="Daily profit by date">
                      <caption className="sr-only">Daily profit: date, revenue, expenses, profit</caption>
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col" style={{ textAlign: 'right' }}>Revenue</th>
                          <th scope="col" style={{ textAlign: 'right' }}>Expenses</th>
                          <th scope="col" style={{ textAlign: 'right' }}>Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profitReport.slice(0, 14).map((row, idx) => (
                          <tr key={idx}>
                            <td>{row.date}</td>
                            <td style={{ textAlign: 'right', color: 'var(--primary-color)' }}>{formatTSh(row.revenue)}</td>
                            <td style={{ textAlign: 'right', color: '#f44336' }}>{formatTSh(row.expenses)}</td>
                            <td style={{ textAlign: 'right', color: parseFloat(row.profit || 0) >= 0 ? '#4caf50' : '#f44336', fontWeight: 'bold' }}>
                              {formatTSh(row.profit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-state empty-state--explained">
                    No daily profit data. Reconcile days in Cash Management to see daily revenue, expenses and profit.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {activeTab === 'sales' && (
        <div className="report-card-compact">
          <p className="report-summary-line" aria-live="polite">{salesSummaryLine}</p>
          <h2>
            <span>Sales by Date</span>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => toggleSection('sales')}
              aria-expanded={expandedSections.sales}
            >
              {expandedSections.sales ? '▼' : '▶'}
            </button>
          </h2>
          {expandedSections.sales && (
            <>
              {hasSalesData && salesChartData.length > 0 && (
                <ChartErrorBoundary>
                  <div className="report-chart-wrap">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={salesChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(5) : '')} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                        <Tooltip formatter={(v) => [typeof v === 'number' && v > 1000 ? formatTSh(v) : v, '']} labelFormatter={(l) => `Date: ${l}`} />
                        <Bar dataKey="revenue" fill="var(--primary-color)" name="Revenue" radius={4} />
                        <Bar dataKey="orders" fill="var(--text-muted)" name="Orders" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartErrorBoundary>
              )}
              <div className="table-wrapper">
                {hasSalesData ? (
                  <>
                    <table className="report-table-compact" aria-label="Sales by date">
                      <caption className="sr-only">Sales by date: orders, revenue, collected, pending, ready</caption>
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Orders</th>
                          <th scope="col">Total Revenue</th>
                          <th scope="col">Collected</th>
                          <th scope="col">Pending</th>
                          <th scope="col">Ready</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesReport.map((day) => (
                          <tr key={day.date}>
                            <td>{new Date(day.date).toLocaleDateString('en-GB')}</td>
                            <td>{day.total_orders}</td>
                            <td>{formatTSh(day.total_revenue)}</td>
                            <td>{formatTSh(day.collected_revenue)}</td>
                            <td>{day.pending_orders}</td>
                            <td>{day.ready_orders}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      type="button"
                      className="btn-secondary btn-export"
                      onClick={() =>
                        exportCSV(
                          salesReport,
                          [
                            { key: 'date', label: 'Date' },
                            { key: 'total_orders', label: 'Orders' },
                            { key: 'total_revenue', label: 'Total Revenue' },
                            { key: 'collected_revenue', label: 'Collected' },
                            { key: 'pending_orders', label: 'Pending' },
                            { key: 'ready_orders', label: 'Ready' }
                          ],
                          `sales-${dateRange.start}-${dateRange.end}.csv`,
                          csvBranchLabel
                        )
                      }
                    >
                      Export CSV
                    </button>
                  </>
                ) : (
                  <p className="empty-state empty-state--explained">
                    No sales data for this period. Select a date range in Overview or ensure orders exist for the period.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'services' && (
        <div className="report-card-compact">
          <p className="report-summary-line" aria-live="polite">{servicesSummaryLine}</p>
          <h2>
            <span>Service Performance</span>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => toggleSection('services')}
              aria-expanded={expandedSections.services}
            >
              {expandedSections.services ? '▼' : '▶'}
            </button>
          </h2>
          {expandedSections.services && (
            <>
              {hasServiceData && serviceChartData.length > 0 && (
                <ChartErrorBoundary>
                  <div className="report-chart-wrap">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={serviceChartData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                        <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [typeof v === 'number' && v > 100 ? formatTSh(v) : v, '']} />
                        <Bar dataKey="revenue" fill="var(--primary-color)" name="Revenue" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartErrorBoundary>
              )}
              <div className="table-wrapper">
                {hasServiceData ? (
                  <>
                    <table className="report-table-compact" aria-label="Service performance">
                      <caption className="sr-only">Service performance: orders, revenue, average order value</caption>
                      <thead>
                        <tr>
                          <th scope="col">Service</th>
                          <th scope="col">Orders</th>
                          <th scope="col">Total Revenue</th>
                          <th scope="col">Avg Order Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceReport.map((service) => (
                          <tr key={service.service_name}>
                            <td>{service.service_name}</td>
                            <td>{service.order_count ?? 0}</td>
                            <td>{formatTSh(service.total_revenue)}</td>
                            <td>{formatTSh(Math.round(service.average_order_value || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      type="button"
                      className="btn-secondary btn-export"
                      onClick={() =>
                        exportCSV(
                          serviceReport,
                          [
                            { key: 'service_name', label: 'Service' },
                            { key: 'order_count', label: 'Orders' },
                            { key: 'total_revenue', label: 'Total Revenue' },
                            { key: 'average_order_value', label: 'Avg Order Value' }
                          ],
                          `services-${dateRange.start}-${dateRange.end}.csv`,
                          csvBranchLabel
                        )
                      }
                    >
                      Export CSV
                    </button>
                  </>
                ) : (
                  <p className="empty-state empty-state--explained">
                    No service data for this period. Ensure orders are linked to services and date range has orders.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'customers' && (
        <div className="report-card-compact">
          <p className="report-summary-line" aria-live="polite">{customersSummaryLine}</p>
          <h2>
            <span>Top Customers – Loyalty Program</span>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => toggleSection('customers')}
              aria-expanded={expandedSections.customers}
            >
              {expandedSections.customers ? '▼' : '▶'}
            </button>
          </h2>
          {expandedSections.customers && (
            <>
              <div className="filter-controls-compact">
                <select
                  value={customerFilter.month}
                  onChange={(e) => setCustomerFilter((prev) => ({ ...prev, month: parseInt(e.target.value, 10) }))}
                  aria-label="Month"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mo) => (
                    <option key={mo} value={mo}>
                      {new Date(2000, mo - 1, 1).toLocaleString('en-GB', { month: 'long' })}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={customerFilter.year}
                  onChange={(e) => setCustomerFilter((prev) => ({ ...prev, year: parseInt(e.target.value, 10) || new Date().getFullYear() }))}
                  min="2020"
                  max="2099"
                  placeholder="Year"
                  aria-label="Year"
                />
                <button type="button" className="btn-primary" onClick={handleCustomerFilterChange}>
                  Filter
                </button>
                {hasCustomerData && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      exportCSV(
                        customerReport.slice(0, 50),
                        [
                          { key: 'name', label: 'Customer' },
                          { key: 'phone', label: 'Phone' },
                          { key: 'total_orders', label: 'Orders' },
                          { key: 'total_spent', label: 'Spent' },
                          { key: 'current_points', label: 'Points' },
                          { key: 'tier', label: 'Tier' },
                          { key: 'last_order_date', label: 'Last Order' }
                        ],
                        `customers-${customerFilter.year}-${customerFilter.month}.csv`,
                        csvBranchLabel
                      )
                    }
                  >
                    Export CSV
                  </button>
                )}
              </div>
              <div className="info-banner-compact">
                <strong>Loyalty Points:</strong> 1 point per 20,000 TSh spent. 100 points = Free wash worth 10,000 TSh
              </div>
              <div className="table-wrapper">
                {hasCustomerData ? (
                  <table className="report-table-compact" aria-label="Top customers loyalty">
                    <caption className="sr-only">Top customers by loyalty: orders, spent, points, tier, last order</caption>
                    <thead>
                      <tr>
                        <th scope="col">Customer</th>
                        <th scope="col">Orders</th>
                        <th scope="col">Spent</th>
                        <th scope="col">Points</th>
                        <th scope="col">Tier</th>
                        <th scope="col">Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerReport.slice(0, 20).map((customer) => (
                        <tr key={customer.id}>
                          <td>
                            <div className="customer-cell">
                              <strong>{customer.name}</strong>
                              <small>{customer.phone}</small>
                            </div>
                          </td>
                          <td>{customer.total_orders ?? 0}</td>
                          <td>{formatTSh(customer.total_spent)}</td>
                          <td>
                            <div className="points-cell">
                              <span className="points-display points-monthly">{customer.monthly_points_earned ?? 0} this month</span>
                              <span className="points-display points-current">{customer.current_points ?? 0} available</span>
                              <span className="points-lifetime">{customer.lifetime_points ?? 0} lifetime</span>
                            </div>
                          </td>
                          <td>
                            <span className={`badge-compact badge-tier-${(customer.tier || 'bronze').toLowerCase()}`}>
                              {customer.tier || 'Bronze'}
                            </span>
                          </td>
                          <td className="text-muted">
                            {customer.last_order_date
                              ? new Date(customer.last_order_date).toLocaleDateString('en-GB')
                              : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="empty-state empty-state--explained">
                    No customer data for this month. Customers appear here when they have orders or loyalty activity in the selected month.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
