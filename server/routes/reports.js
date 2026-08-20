const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { getBranchFilter } = require('../utils/branchFilter');

router.use(authenticate, requireBranchFeature('reports_basic'));

// Get sales report by date range (filtered by branch when user has a branch)
router.get('/sales', requireBranchAccess(), async (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  const branchFilter = getBranchFilter(req, 'o');
  let query = `
    SELECT 
      DATE(o.order_date) as date,
      COUNT(*) as total_orders,
      SUM(o.total_amount) as total_revenue,
      SUM(CASE WHEN o.status = 'collected' THEN o.total_amount ELSE 0 END) as collected_revenue,
      SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
      SUM(CASE WHEN o.status = 'ready' THEN 1 ELSE 0 END) as ready_orders
    FROM orders o
    WHERE DATE(o.order_date) BETWEEN $1 AND $2
  `;
  if (branchFilter.clause) {
    const branchClause = branchFilter.clause.replace(/\?/g, () => '$3');
    query += ' ' + branchClause;
  }
  query += ' GROUP BY DATE(o.order_date) ORDER BY date DESC';

  const params = [start_date, end_date, ...(branchFilter.params || [])];
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get service performance report (filtered by branch when user has a branch)
router.get('/services', requireBranchAccess(), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchFilter = getBranchFilter(req, 'o');
  let query = `
    SELECT 
      s.name as service_name,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as total_revenue,
      AVG(o.total_amount) as average_order_value
    FROM services s
    LEFT JOIN orders o ON s.id = o.service_id
  `;
  const conditions = [];
  const params = [];
  let paramIndex = 1;
  if (start_date && end_date) {
    conditions.push(`DATE(o.order_date) BETWEEN $${paramIndex++} AND $${paramIndex++}`);
    params.push(start_date, end_date);
  }
  if (branchFilter.clause) {
    const branchClause = branchFilter.clause.replace(/^AND\s+/, '').replace(/\?/g, () => `$${paramIndex++}`);
    conditions.push(branchClause);
    if (branchFilter.params?.length) params.push(...branchFilter.params);
  }
  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' GROUP BY s.id, s.name ORDER BY total_revenue DESC';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get customer statistics with loyalty points (filtered by branch when user has a branch)
router.get('/customers', requireBranchAccess(), async (req, res) => {
  const { month, year } = req.query;
  const branchFilter = getBranchFilter(req, 'o');
  let dateFilter = '';
  const params = [];
  
  // If month/year provided, filter orders collected in that month
  if (month && year) {
    dateFilter = `AND o.collected_date IS NOT NULL AND TO_CHAR(o.collected_date, 'YYYY-MM') = $1`;
    params.push(`${year}-${month.padStart(2, '0')}`);
  } else if (year) {
    dateFilter = `AND o.collected_date IS NOT NULL AND TO_CHAR(o.collected_date, 'YYYY') = $1`;
    params.push(year);
  }
  const nextParam = params.length + 1;
  const branchJoinClause = branchFilter.clause ? ' ' + branchFilter.clause.replace(/\?/g, () => `$${nextParam}`) : '';
  if (branchFilter.params?.length) params.push(...branchFilter.params);

  const query = `
    SELECT 
      c.id,
      c.name,
      c.phone,
      COUNT(o.id) as total_orders,
      SUM(o.total_amount) as total_spent,
      MAX(o.order_date) as last_order_date,
      SUM(CASE 
        WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
          CAST(o.total_amount / 20000 AS INTEGER)
        ELSE 0 
      END) as monthly_points_earned,
      COALESCE(lp.current_points, 0) as current_points,
      COALESCE(lp.lifetime_points, 0) as lifetime_points,
      COALESCE(lp.tier, 'Bronze') as tier
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id ${dateFilter}${branchJoinClause}
    LEFT JOIN loyalty_points lp ON c.id = lp.customer_id
    GROUP BY c.id, c.name, c.phone, lp.current_points, lp.lifetime_points, lp.tier
    HAVING COUNT(o.id) > 0 OR SUM(CASE 
      WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
        CAST(o.total_amount / 20000 AS INTEGER)
      ELSE 0 
    END) > 0
    ORDER BY monthly_points_earned DESC, total_spent DESC
    LIMIT 50
  `;

  try {
    const rows = await db.all(query, params);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get monthly loyalty points report (filtered by branch when user has a branch)
router.get('/loyalty/monthly', requireBranchAccess(), async (req, res) => {
  const { month, year } = req.query;
  
  if (!month || !year) {
    return res.status(400).json({ error: 'Month and year are required' });
  }

  const monthStr = `${year}-${month.padStart(2, '0')}`;
  const branchFilter = getBranchFilter(req, 'o');
  let whereClause = `TO_CHAR(o.collected_date, 'YYYY-MM') = $1 AND o.status = 'collected' AND o.payment_status = 'paid_full'`;
  const params = [monthStr];
  if (branchFilter.clause) {
    whereClause += ' ' + branchFilter.clause.replace(/\?/g, () => '$2');
    params.push(...(branchFilter.params || []));
  }

  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.phone,
        COUNT(DISTINCT o.id) as orders_count,
        SUM(o.total_amount) as total_spent,
        SUM(CASE 
          WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
            CAST(o.total_amount / 20000 AS INTEGER)
          ELSE 0 
        END) as points_earned,
        COALESCE(lp.current_points, 0) as current_points,
        COALESCE(lp.tier, 'Bronze') as tier
      FROM customers c
      INNER JOIN orders o ON c.id = o.customer_id
      LEFT JOIN loyalty_points lp ON c.id = lp.customer_id
      WHERE ${whereClause}
      GROUP BY c.id, c.name, c.phone, lp.current_points, lp.tier
      HAVING SUM(CASE 
        WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
          CAST(o.total_amount / 20000 AS INTEGER)
        ELSE 0 
      END) > 0
      ORDER BY points_earned DESC, total_spent DESC
      LIMIT 50
    `;

    const rows = await db.all(query, params);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get financial report with profit calculations (uses reconciled daily_cash_summaries)
router.get('/financial', requireBranchAccess(), async (req, res) => {
  const { start_date, end_date, period = 'day' } = req.query; // period: 'day', 'week', 'month'
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }
  
  const branchFilter = getBranchFilter(req, 'd');
  
  try {
    let dateGrouping, dateFormat;
    switch (period) {
      case 'week':
        dateGrouping = `DATE_TRUNC('week', d.date::date)`;
        dateFormat = `TO_CHAR(DATE_TRUNC('week', d.date::date), 'YYYY-MM-DD')`;
        break;
      case 'month':
        dateGrouping = `DATE_TRUNC('month', d.date::date)`;
        dateFormat = `TO_CHAR(DATE_TRUNC('month', d.date::date), 'YYYY-MM')`;
        break;
      default: // 'day'
        dateGrouping = `d.date`;
        dateFormat = `d.date`;
    }
    
    let query = `
      SELECT 
        ${dateFormat} as period,
        COUNT(*) as days_count,
        SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales) as total_revenue,
        SUM(d.cash_sales) as cash_revenue,
        SUM(d.book_sales) as book_revenue,
        SUM(d.card_sales + d.mobile_money_sales) as digital_revenue,
        SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa) as total_expenses,
        SUM(d.expenses_from_cash) as cash_expenses,
        SUM(d.expenses_from_bank) as bank_expenses,
        SUM(d.expenses_from_mpesa) as mpesa_expenses,
        SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales) - 
        SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa) as profit,
        SUM(d.cash_in_hand) as total_cash_in_hand,
        SUM(d.bank_deposits) as total_bank_deposits,
        COUNT(CASE WHEN d.is_reconciled = TRUE THEN 1 END) as reconciled_days
      FROM daily_cash_summaries d
      WHERE d.date >= $1 AND d.date <= $2
    `;
    
    if (branchFilter.clause) {
      // Convert ? to $N placeholders and adjust table alias
      let branchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND d.');
      let clauseParamIndex = 3;
      branchClause = branchClause.replace(/\?/g, () => `$${clauseParamIndex++}`);
      query += ' ' + branchClause;
    }
    
    query += ` GROUP BY ${dateGrouping} ORDER BY period DESC`;
    
    const params = [start_date, end_date, ...(branchFilter.params || [])];
    const rows = await db.all(query, params);
    
    // Calculate totals
    const totals = rows.reduce((acc, row) => {
      acc.total_revenue += parseFloat(row.total_revenue || 0);
      acc.total_expenses += parseFloat(row.total_expenses || 0);
      acc.total_profit += parseFloat(row.profit || 0);
      acc.cash_revenue += parseFloat(row.cash_revenue || 0);
      acc.book_revenue += parseFloat(row.book_revenue || 0);
      acc.digital_revenue += parseFloat(row.digital_revenue || 0);
      acc.cash_expenses += parseFloat(row.cash_expenses || 0);
      acc.bank_expenses += parseFloat(row.bank_expenses || 0);
      acc.mpesa_expenses += parseFloat(row.mpesa_expenses || 0);
      acc.reconciled_days += parseInt(row.reconciled_days, 10) || 0;
      acc.days_count += parseInt(row.days_count, 10) || 0;
      return acc;
    }, {
      total_revenue: 0,
      total_expenses: 0,
      total_profit: 0,
      cash_revenue: 0,
      book_revenue: 0,
      digital_revenue: 0,
      cash_expenses: 0,
      bank_expenses: 0,
      mpesa_expenses: 0,
      reconciled_days: 0,
      days_count: 0,
    });

    if (totals.total_revenue > 0) {
      totals.profit_margin_pct = Math.round((totals.total_profit / totals.total_revenue) * 1000) / 10;
      totals.expense_ratio_pct = Math.round((totals.total_expenses / totals.total_revenue) * 1000) / 10;
    } else {
      totals.profit_margin_pct = 0;
      totals.expense_ratio_pct = 0;
    }
    
    res.json({
      period,
      data: rows,
      totals
    });
  } catch (err) {
    console.error('Error fetching financial report:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get daily profit report (uses reconciled data)
router.get('/profit/daily', requireBranchAccess(), async (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }
  
  const branchFilter = getBranchFilter(req, 'd');
  
  try {
    let query = `
      SELECT 
        d.date,
        d.branch_id,
        COALESCE(b.name, 'Branch ' || CAST(d.branch_id AS TEXT)) as branch_name,
        d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales as revenue,
        d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa as expenses,
        (d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales) - 
        (d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa) as profit,
        d.cash_sales,
        d.book_sales,
        d.card_sales + d.mobile_money_sales as digital_sales,
        d.is_reconciled
      FROM daily_cash_summaries d
      LEFT JOIN branches b ON b.id = d.branch_id
      WHERE d.date >= $1 AND d.date <= $2
    `;
    
    if (branchFilter.clause) {
      // Convert ? to $N placeholders and adjust table alias
      let branchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND d.');
      let clauseParamIndex = 3;
      branchClause = branchClause.replace(/\?/g, () => `$${clauseParamIndex++}`);
      query += ' ' + branchClause;
    }
    
    query += ' ORDER BY d.date DESC';
    
    const params = [start_date, end_date, ...(branchFilter.params || [])];
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching daily profit report:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get overview summary (today's data from cash management)
router.get('/overview', requireBranchAccess(), async (req, res) => {
  const { date } = req.query;
  const today = date || new Date().toISOString().split('T')[0];
  const branchFilter = getBranchFilter(req, 'd');
  
  try {
    let query = `
      SELECT 
        $1::date as date,
        COALESCE(SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales), 0) as total_income,
        COALESCE(SUM(d.cash_sales), 0) as cash_income,
        COALESCE(SUM(d.card_sales + d.mobile_money_sales), 0) as digital_income,
        COALESCE(SUM(d.book_sales), 0) as book_income,
        COALESCE(SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa), 0) as total_expenses,
        COALESCE(SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales), 0) -
        COALESCE(SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa), 0) as net_income,
        BOOL_AND(COALESCE(d.is_reconciled, FALSE)) as is_reconciled,
        COUNT(*)::int as branch_rows
      FROM daily_cash_summaries d
      WHERE d.date = $1
    `;
    
    if (branchFilter.clause) {
      // Convert ? to $N placeholders and adjust table alias
      let branchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND d.');
      let clauseParamIndex = 2;
      branchClause = branchClause.replace(/\?/g, () => `$${clauseParamIndex++}`);
      query += ' ' + branchClause;
    }

    query += ' GROUP BY d.date';

    // Get transaction count separately
    let transactionQuery = `
      SELECT COUNT(*) as total_transactions
      FROM orders o
      WHERE DATE(o.order_date) = $1
    `;
    if (branchFilter.clause) {
      let transactionBranchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND o.');
      let transactionParamIndex = 2;
      transactionBranchClause = transactionBranchClause.replace(/\?/g, () => `$${transactionParamIndex++}`);
      transactionQuery += ' ' + transactionBranchClause;
    }
    
    const transactionParams = [today, ...(branchFilter.params || [])];
    const transactionRow = await db.get(transactionQuery, transactionParams);
    const totalTransactions = transactionRow?.total_transactions || 0;
    
    const params = [today, ...(branchFilter.params || [])];
    const row = await db.get(query, params);
    
    if (!row) {
      // Return empty summary if no data
      return res.json({
        date: today,
        total_income: 0,
        cash_income: 0,
        digital_income: 0,
        total_expenses: 0,
        net_income: 0,
        total_transactions: totalTransactions,
        is_reconciled: false
      });
    }
    
    res.json({
      ...row,
      total_transactions: totalTransactions
    });
  } catch (err) {
    console.error('Error fetching overview:', err);
    res.status(500).json({ error: err.message });
  }
});

function priorPeriodRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dayMs = 86400000;
  const spanDays = Math.max(1, Math.round((end - start) / dayMs) + 1);
  const priorEnd = new Date(start.getTime() - dayMs);
  const priorStart = new Date(priorEnd.getTime() - (spanDays - 1) * dayMs);
  const toYmd = (d) => d.toISOString().split('T')[0];
  return { start: toYmd(priorStart), end: toYmd(priorEnd), span_days: spanDays };
}

function pctChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

async function fetchFinancialTotals(startDate, endDate, branchFilter) {
  let query = `
    SELECT
      COALESCE(SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales), 0) as total_revenue,
      COALESCE(SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa), 0) as total_expenses,
      COALESCE(SUM(d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales), 0) -
      COALESCE(SUM(d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa), 0) as total_profit,
      COALESCE(SUM(d.cash_sales), 0) as cash_revenue,
      COALESCE(SUM(d.book_sales), 0) as book_revenue,
      COALESCE(SUM(d.card_sales + d.mobile_money_sales), 0) as digital_revenue,
      COUNT(*)::int as summary_rows,
      COUNT(CASE WHEN d.is_reconciled = TRUE THEN 1 END)::int as reconciled_rows,
      COUNT(CASE WHEN COALESCE(d.is_reconciled, FALSE) = FALSE THEN 1 END)::int as open_rows
    FROM daily_cash_summaries d
    WHERE d.date >= $1 AND d.date <= $2
  `;
  if (branchFilter.clause) {
    let branchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND d.');
    let clauseParamIndex = 3;
    branchClause = branchClause.replace(/\?/g, () => `$${clauseParamIndex++}`);
    query += ' ' + branchClause;
  }
  const params = [startDate, endDate, ...(branchFilter.params || [])];
  const row = await db.get(query, params);
  const totalRevenue = parseFloat(row?.total_revenue || 0);
  const totalProfit = parseFloat(row?.total_profit || 0);
  const totalExpenses = parseFloat(row?.total_expenses || 0);
  return {
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    total_profit: totalProfit,
    cash_revenue: parseFloat(row?.cash_revenue || 0),
    book_revenue: parseFloat(row?.book_revenue || 0),
    digital_revenue: parseFloat(row?.digital_revenue || 0),
    summary_rows: parseInt(row?.summary_rows, 10) || 0,
    reconciled_rows: parseInt(row?.reconciled_rows, 10) || 0,
    open_rows: parseInt(row?.open_rows, 10) || 0,
    profit_margin_pct: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
    expense_ratio_pct: totalRevenue > 0 ? Math.round((totalExpenses / totalRevenue) * 1000) / 10 : 0,
  };
}

async function fetchSalesTotals(startDate, endDate, branchFilter) {
  let query = `
    SELECT
      COUNT(*)::int as total_orders,
      COALESCE(SUM(o.total_amount), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN o.status = 'collected' THEN o.total_amount ELSE 0 END), 0) as collected_revenue
    FROM orders o
    WHERE DATE(o.order_date) BETWEEN $1 AND $2
      AND COALESCE(o.is_voided, FALSE) = FALSE
  `;
  if (branchFilter.clause) {
    let branchClause = branchFilter.clause.replace(/AND\s+(\w+)\./, 'AND o.');
    let clauseParamIndex = 3;
    branchClause = branchClause.replace(/\?/g, () => `$${clauseParamIndex++}`);
    query += ' ' + branchClause;
  }
  const params = [startDate, endDate, ...(branchFilter.params || [])];
  const row = await db.get(query, params);
  const orders = parseInt(row?.total_orders, 10) || 0;
  const revenue = parseFloat(row?.total_revenue || 0);
  return {
    total_orders: orders,
    total_revenue: revenue,
    collected_revenue: parseFloat(row?.collected_revenue || 0),
    average_order_value: orders > 0 ? Math.round(revenue / orders) : 0,
    collection_rate_pct: revenue > 0
      ? Math.round((parseFloat(row?.collected_revenue || 0) / revenue) * 1000) / 10
      : 0,
  };
}

async function fetchMonthlyTarget(branchId) {
  const keys = branchId != null
    ? [`reports_monthly_target_branch_${branchId}`, 'reports_monthly_target']
    : ['reports_monthly_target'];
  for (const key of keys) {
    const row = await db.get('SELECT setting_value FROM settings WHERE setting_key = $1', [key]);
    const val = parseFloat(row?.setting_value);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return null;
}

// Business health snapshot: current vs prior period, ratios, alerts (Personal MBA finance layer)
router.get('/business-health', requireBranchAccess(), async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  const branchFilter = getBranchFilter(req, 'd');
  const prior = priorPeriodRange(start_date, end_date);
  const branchId = req.effectiveBranchId ?? req.user?.branchId ?? null;

  try {
    const [current, previous, salesCurrent, salesPrevious, monthlyTarget] = await Promise.all([
      fetchFinancialTotals(start_date, end_date, branchFilter),
      fetchFinancialTotals(prior.start, prior.end, branchFilter),
      fetchSalesTotals(start_date, end_date, branchFilter),
      fetchSalesTotals(prior.start, prior.end, branchFilter),
      fetchMonthlyTarget(branchId),
    ]);

    const comparison = {
      prior_start: prior.start,
      prior_end: prior.end,
      span_days: prior.span_days,
      revenue_change_pct: pctChange(current.total_revenue, previous.total_revenue),
      profit_change_pct: pctChange(current.total_profit, previous.total_profit),
      expenses_change_pct: pctChange(current.total_expenses, previous.total_expenses),
      orders_change_pct: pctChange(salesCurrent.total_orders, salesPrevious.total_orders),
      aov_change_pct: pctChange(salesCurrent.average_order_value, salesPrevious.average_order_value),
    };

    const alerts = [];
    if (current.open_rows > 0) {
      alerts.push({
        type: 'unreconciled',
        severity: 'warning',
        message: `${current.open_rows} daily cash summary row(s) in this period are not reconciled. Financial totals may change after close.`,
      });
    }
    if (current.total_profit < 0) {
      alerts.push({
        type: 'negative_profit',
        severity: 'danger',
        message: `Period profit is ${current.total_profit.toLocaleString()} TZS. Review expenses and revenue mix.`,
      });
    }
    const collectionGap = salesCurrent.total_revenue - current.total_revenue;
    if (Math.abs(collectionGap) > Math.max(50000, current.total_revenue * 0.05)) {
      alerts.push({
        type: 'sales_vs_reconciled',
        severity: 'info',
        message: `Order book revenue differs from reconciled revenue by ${Math.round(collectionGap).toLocaleString()} TZS. Check unreconciled days or timing of collections.`,
      });
    }

    let target_progress_pct = null;
    if (monthlyTarget && current.total_revenue > 0) {
      target_progress_pct = Math.min(999, Math.round((current.total_revenue / monthlyTarget) * 1000) / 10);
    }

    res.json({
      period: { start: start_date, end: end_date },
      current: { financial: current, sales: salesCurrent },
      previous: { financial: previous, sales: salesPrevious },
      comparison,
      monthly_target: monthlyTarget,
      target_progress_pct,
      alerts,
    });
  } catch (err) {
    console.error('Error fetching business health report:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update monthly revenue target (admin/manager)
router.put('/monthly-target', requireBranchAccess(), async (req, res) => {
  const amount = parseFloat(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'A valid non-negative amount is required' });
  }
  const branchId = req.effectiveBranchId ?? req.user?.branchId ?? null;
  const key = branchId != null ? `reports_monthly_target_branch_${branchId}` : 'reports_monthly_target';
  const description = branchId != null
    ? `Monthly revenue target for branch ${branchId}`
    : 'Global monthly revenue target';

  try {
    const existing = await db.get('SELECT id FROM settings WHERE setting_key = $1', [key]);
    if (existing) {
      await db.run(
        'UPDATE settings SET setting_value = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $3',
        [String(amount), description, key]
      );
    } else {
      await db.run(
        'INSERT INTO settings (setting_key, setting_value, description) VALUES ($1, $2, $3)',
        [key, String(amount), description]
      );
    }
    res.json({ success: true, monthly_target: amount, setting_key: key });
  } catch (err) {
    console.error('Error saving monthly target:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
