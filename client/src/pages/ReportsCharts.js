import React from 'react';
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

/**
 * Recharts-only UI; loaded via React.lazy so the library is not parsed until charts render.
 *
 * @param {'profit'|'sales'|'services'} variant
 * @param {object} [props]
 */
export default function ReportsCharts({
  variant,
  profitChartData = [],
  salesChartData = [],
  serviceChartData = [],
  chartColors = {},
  formatTSh
}) {
  if (variant === 'profit' && profitChartData.length > 0) {
    return (
      <div className="report-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={profitChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(5) : '')} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip formatter={(v) => [formatTSh(v), '']} labelFormatter={(l) => `Date: ${l}`} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={chartColors.revenue}
              fill={chartColors.revenue}
              fillOpacity={0.3}
              name="Revenue"
            />
            <Area
              type="monotone"
              dataKey="expenses"
              stroke={chartColors.expenses}
              fill={chartColors.expenses}
              fillOpacity={0.3}
              name="Expenses"
            />
            <Area
              type="monotone"
              dataKey="profit"
              stroke={chartColors.profit}
              fill={chartColors.profit}
              fillOpacity={0.3}
              name="Profit"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (variant === 'sales' && salesChartData.length > 0) {
    return (
      <div className="report-chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={salesChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => (v ? String(v).slice(5) : '')} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip
              formatter={(v) => [typeof v === 'number' && v > 1000 ? formatTSh(v) : v, '']}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Bar dataKey="revenue" fill="var(--primary-color)" name="Revenue" radius={4} />
            <Bar dataKey="orders" fill="var(--text-muted)" name="Orders" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (variant === 'services' && serviceChartData.length > 0) {
    return (
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
    );
  }

  return null;
}
