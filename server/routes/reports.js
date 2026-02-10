const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { getBranchFilter } = require('../utils/branchFilter');

// Get sales report by date range
router.get('/sales', async (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }

  try {
    const query = `
      SELECT 
        DATE(o.order_date) as date,
        COUNT(*) as total_orders,
        SUM(o.total_amount) as total_revenue,
        SUM(CASE WHEN o.status = 'collected' THEN o.total_amount ELSE 0 END) as collected_revenue,
        SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN o.status = 'ready' THEN 1 ELSE 0 END) as ready_orders
      FROM orders o
      WHERE DATE(o.order_date) BETWEEN $1 AND $2
      GROUP BY DATE(o.order_date)
      ORDER BY date DESC
    `;

    const rows = await db.all(query, [start_date, end_date]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get service performance report
router.get('/services', async (req, res) => {
  const { start_date, end_date } = req.query;
  let query = `
    SELECT 
      s.name as service_name,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as total_revenue,
      AVG(o.total_amount) as average_order_value
    FROM services s
    LEFT JOIN orders o ON s.id = o.service_id
  `;
  let params = [];

  if (start_date && end_date) {
    query += ' WHERE DATE(o.order_date) BETWEEN $1 AND $2';
    params = [start_date, end_date];
  }

  query += ' GROUP BY s.id, s.name ORDER BY total_revenue DESC';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get customer statistics with loyalty points
router.get('/customers', async (req, res) => {
  const { month, year } = req.query;
  let dateFilter = '';
  let params = [];
  
  // If month/year provided, filter orders collected in that month
  if (month && year) {
    // PostgreSQL: TO_CHAR(date, 'YYYY-MM') instead of strftime
    dateFilter = `AND o.collected_date IS NOT NULL AND TO_CHAR(o.collected_date, 'YYYY-MM') = $1`;
    params.push(`${year}-${month.padStart(2, '0')}`);
  } else if (year) {
    // If only year provided, filter for entire year
    dateFilter = `AND o.collected_date IS NOT NULL AND TO_CHAR(o.collected_date, 'YYYY') = $1`;
    params.push(year);
  }

  const query = `
    SELECT 
      c.id,
      c.name,
      c.phone,
      COUNT(o.id) as total_orders,
      SUM(o.total_amount) as total_spent,
      MAX(o.order_date) as last_order_date,
      -- Calculate monthly points (1 point per 20,000 TSh spent, only for collected and paid orders)
      SUM(CASE 
        WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
          CAST(o.total_amount / 20000 AS INTEGER)
        ELSE 0 
      END) as monthly_points_earned,
      -- Get current loyalty points from loyalty_points table
      COALESCE(lp.current_points, 0) as current_points,
      COALESCE(lp.lifetime_points, 0) as lifetime_points,
      COALESCE(lp.tier, 'Bronze') as tier
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id ${dateFilter}
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

// Get monthly loyalty points report
router.get('/loyalty/monthly', async (req, res) => {
  const { month, year } = req.query;
  
  if (!month || !year) {
    return res.status(400).json({ error: 'Month and year are required' });
  }

  const monthStr = `${year}-${month.padStart(2, '0')}`;

  try {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.phone,
        COUNT(DISTINCT o.id) as orders_count,
        SUM(o.total_amount) as total_spent,
        -- Calculate points earned this month (1 point per 20,000 TSh spent)
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
      WHERE TO_CHAR(o.collected_date, 'YYYY-MM') = $1
        AND o.status = 'collected'
        AND o.payment_status = 'paid_full'
      GROUP BY c.id, c.name, c.phone, lp.current_points, lp.tier
      HAVING SUM(CASE 
        WHEN o.status = 'collected' AND o.payment_status = 'paid_full' THEN 
          CAST(o.total_amount / 20000 AS INTEGER)
        ELSE 0 
      END) > 0
      ORDER BY points_earned DESC, total_spent DESC
      LIMIT 50
    `;

    const rows = await db.all(query, [monthStr]);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get financial report with profit calculations (uses reconciled daily_cash_summaries)
router.get('/financial', authenticate, requireBranchAccess(), async (req, res) => {
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
      return acc;
    }, { total_revenue: 0, total_expenses: 0, total_profit: 0 });
    
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
router.get('/profit/daily', authenticate, requireBranchAccess(), async (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start date and end date are required' });
  }
  
  const branchFilter = getBranchFilter(req, 'd');
  
  try {
    let query = `
      SELECT 
        d.date,
        d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales as revenue,
        d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa as expenses,
        (d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales) - 
        (d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa) as profit,
        d.cash_sales,
        d.book_sales,
        d.card_sales + d.mobile_money_sales as digital_sales,
        d.is_reconciled
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
router.get('/overview', authenticate, requireBranchAccess(), async (req, res) => {
  const { date } = req.query;
  const today = date || new Date().toISOString().split('T')[0];
  const branchFilter = getBranchFilter(req, 'd');
  
  try {
    let query = `
      SELECT 
        d.date,
        d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales as total_income,
        d.cash_sales as cash_income,
        d.card_sales + d.mobile_money_sales as digital_income,
        d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa as total_expenses,
        (d.cash_sales + d.book_sales + d.card_sales + d.mobile_money_sales) - 
        (d.expenses_from_cash + d.expenses_from_bank + d.expenses_from_mpesa) as net_income,
        d.is_reconciled
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

module.exports = router;
