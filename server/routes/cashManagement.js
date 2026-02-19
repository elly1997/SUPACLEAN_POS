const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getEffectiveBranchId } = require('../utils/branchFilter');

// All cash-management routes require branch feature 'cash_management' (admin bypasses)
router.use(authenticate, requireBranchFeature('cash_management'));

// Get daily cash summary by date (cashiers, managers, admins can view)
router.get('/daily/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash management' });
  }
  try {
    const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    
    if (!row) {
      // Return empty summary if not found
      return res.json({
        date,
        opening_balance: 0,
        cash_sales: 0,
        book_sales: 0,
        card_sales: 0,
        mobile_money_sales: 0,
        bank_deposits: 0,
        bank_payments: 0,
        mpesa_received: 0,
        mpesa_paid: 0,
        expenses_from_cash: 0,
        expenses_from_bank: 0,
        expenses_from_mpesa: 0,
        closing_balance: 0,
        is_reconciled: false
      });
    }
    
    res.json(row);
  } catch (err) {
    console.error('Error fetching daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get today's cash summary (with automatic calculations) (cashiers, managers, admins can view)
router.get('/today', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash management' });
  }
  const today = new Date().toISOString().split('T')[0];
  
  // Get yesterday's closing balance for opening balance
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  try {
    const yesterdayRow = await db.get('SELECT closing_balance FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [yesterdayStr, branchId]);
    
    const openingBalance = yesterdayRow ? yesterdayRow.closing_balance : 0;
    
    // Calculate cash sales (orders paid in full with cash on order date)
    const cashSalesRow = await db.all(`
      SELECT SUM(paid_amount) as cash_sales
      FROM orders
      WHERE DATE(order_date) = ?
      AND payment_status = 'paid_full'
      AND payment_method = 'cash'
      AND paid_amount > 0
      AND branch_id = ?
    `, [today, branchId]);
    
    const cashSales = cashSalesRow[0]?.cash_sales || 0;
    
    // Book sales = cash received from receive-payment / collection today (daily sales report)
    const { calculateBookSales } = require('../utils/cashValidation');
    let bookSales = 0;
    try {
      bookSales = await calculateBookSales(today, branchId);
    } catch (err) {
      console.error('Error calculating book sales:', err);
      bookSales = 0;
    }
    
    // Calculate remaining values
    const result = await calculateRemaining(today, openingBalance, cashSales, bookSales, branchId);
    res.json(result);
  } catch (err) {
    console.error('Error calculating today\'s cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

async function calculateRemaining(date, openingBalance, cashSales, bookSales, branchId) {
  const { calculateMobileMoneyReceived, calculateCardReceived } = require('../utils/cashValidation');

  // Card and M-Pesa from transactions only (single source: includes advance + full payments on this date)
  let cardSales = 0;
  let mobileMoneySales = 0;
  try {
    const [cardFromTx, mpesaFromTx] = await Promise.all([
      calculateCardReceived(date, branchId),
      calculateMobileMoneyReceived(date, branchId)
    ]);
    cardSales = cardFromTx;
    mobileMoneySales = mpesaFromTx;
  } catch (err) {
    console.error('Error calculating card/M-Pesa from transactions:', err);
  }
  
  // Calculate expenses (handle both date formats and NULL branch_id for backward compatibility)
  const expensesRow = await db.all(`
    SELECT 
      SUM(CASE WHEN payment_source = 'cash' THEN amount ELSE 0 END) as expenses_from_cash,
      SUM(CASE WHEN payment_source = 'bank' THEN amount ELSE 0 END) as expenses_from_bank,
      SUM(CASE WHEN payment_source = 'mpesa' THEN amount ELSE 0 END) as expenses_from_mpesa
    FROM expenses
    WHERE date = $1
    AND (branch_id = $2 OR branch_id IS NULL)
  `, [date, branchId]);
  
  const expensesFromCash = expensesRow[0]?.expenses_from_cash || 0;
  const expensesFromBank = expensesRow[0]?.expenses_from_bank || 0;
  const expensesFromMpesa = expensesRow[0]?.expenses_from_mpesa || 0;
  
  // Calculate bank deposits
  const depositsRow = await db.get('SELECT COALESCE(SUM(amount), 0) as total FROM bank_deposits WHERE date = ? AND branch_id = ?', [date, branchId]);
  
  const bankDeposits = depositsRow?.total || 0;
  
  // Calculate total cash in hand = opening + cash sales + book sales - expenses from cash - bank deposits
  const cashInHand = openingBalance + cashSales + bookSales - expensesFromCash - bankDeposits;
  const closingBalance = cashInHand;
  
  return {
    date,
    opening_balance: openingBalance,
    cash_sales: cashSales,
    book_sales: bookSales,
    card_sales: cardSales,
    mobile_money_sales: mobileMoneySales,
    bank_deposits: bankDeposits,
    bank_payments: 0,
    mpesa_received: mobileMoneySales,
    mpesa_paid: 0,
    expenses_from_cash: expensesFromCash,
    expenses_from_bank: expensesFromBank,
    expenses_from_mpesa: expensesFromMpesa,
    cash_in_hand: cashInHand,
    closing_balance: closingBalance,
    is_reconciled: false
  };
}

// Create or update daily cash summary
router.post('/daily', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const {
    date,
    bank_deposits,
    bank_payments,
    mpesa_received,
    mpesa_paid,
    notes
  } = req.body;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to save cash summary' });
  }
  const today = date || new Date().toISOString().split('T')[0];
  
  // Get yesterday's closing balance for opening balance
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  try {
    const yesterdayRow = await db.get('SELECT closing_balance FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [yesterdayStr, branchId]);
    
    const openingBalance = yesterdayRow ? yesterdayRow.closing_balance : 0;
    
    // Calculate cash sales (orders paid in full with cash on order date)
    const cashSalesRow = await db.all(`
      SELECT SUM(paid_amount) as cash_sales
      FROM orders
      WHERE DATE(order_date) = ?
      AND payment_status = 'paid_full'
      AND payment_method = 'cash'
      AND paid_amount > 0
      AND branch_id = ?
    `, [today, branchId]);
    
    const cashSales = cashSalesRow[0]?.cash_sales || 0;
    
    // Book sales = cash received from receive-payment / collection (daily sales report)
    const { calculateBookSales } = require('../utils/cashValidation');
    let bookSales = 0;
    try {
      bookSales = await calculateBookSales(today, branchId);
    } catch (err) {
      console.error('Error calculating book sales:', err);
      bookSales = 0;
    }
    
    // Card and M-Pesa from transactions only (includes advance + full payments on this date)
    const { calculateMobileMoneyReceived, calculateCardReceived } = require('../utils/cashValidation');
    let cardSales = 0;
    let mobileMoneySales = 0;
    try {
      const [cardFromTx, mpesaFromTx] = await Promise.all([
        calculateCardReceived(today, branchId),
        calculateMobileMoneyReceived(today, branchId)
      ]);
      cardSales = cardFromTx;
      mobileMoneySales = mpesaFromTx;
    } catch (err) {
      console.error('Error calculating card/M-Pesa from transactions:', err);
    }

    // Calculate expenses (handle both date formats and NULL branch_id for backward compatibility)
    const expensesRow = await db.all(`
      SELECT 
        SUM(CASE WHEN payment_source = 'cash' THEN amount ELSE 0 END) as expenses_from_cash,
        SUM(CASE WHEN payment_source = 'bank' THEN amount ELSE 0 END) as expenses_from_bank,
        SUM(CASE WHEN payment_source = 'mpesa' THEN amount ELSE 0 END) as expenses_from_mpesa
      FROM expenses
      WHERE date = $1
      AND (branch_id = $2 OR branch_id IS NULL)
    `, [today, branchId]);
    
    const expensesFromCash = expensesRow[0]?.expenses_from_cash || 0;
    const expensesFromBank = expensesRow[0]?.expenses_from_bank || 0;
    const expensesFromMpesa = expensesRow[0]?.expenses_from_mpesa || 0;
    
    const bankDepositsAmount = bank_deposits || 0;
    const bankPayments = bank_payments || 0;
    const mpesaReceived = mpesa_received || mobileMoneySales;
    const mpesaPaid = mpesa_paid || 0;
    
    // Cash in hand = opening + cash sales + book sales - expenses from cash - bank deposits
    const cashInHand = openingBalance + cashSales + bookSales - expensesFromCash - bankDepositsAmount;
    const closingBalance = cashInHand;
    
    // Check if record exists
    const existing = await db.get('SELECT id FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
    
    if (existing) {
      // Update existing record
      await db.run(
        `UPDATE daily_cash_summaries SET
          opening_balance = ?,
          cash_sales = ?,
          book_sales = ?,
          card_sales = ?,
          mobile_money_sales = ?,
          bank_deposits = ?,
          bank_payments = ?,
          mpesa_received = ?,
          mpesa_paid = ?,
          expenses_from_cash = ?,
          expenses_from_bank = ?,
          expenses_from_mpesa = ?,
          cash_in_hand = ?,
          closing_balance = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE date = ? AND branch_id = ?`,
        [openingBalance, cashSales, bookSales, cardSales, mobileMoneySales,
         bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
         expensesFromCash, expensesFromBank, expensesFromMpesa,
         cashInHand, closingBalance, notes || null, today, branchId]
      );
      
      const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
      res.json(row);
    } else {
      // Insert new record
      await db.run(
        `INSERT INTO daily_cash_summaries (
          date, branch_id, opening_balance, cash_sales, book_sales, card_sales, mobile_money_sales,
          bank_deposits, bank_payments, mpesa_received, mpesa_paid,
          expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
          cash_in_hand, closing_balance, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [today, branchId, openingBalance, cashSales, bookSales, cardSales, mobileMoneySales,
         bankDepositsAmount, bankPayments, mpesaReceived, mpesaPaid,
         expensesFromCash, expensesFromBank, expensesFromMpesa,
         cashInHand, closingBalance, notes || null]
      );
      
      const row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [today, branchId]);
      res.json(row);
    }
  } catch (err) {
    console.error('Error creating/updating daily cash summary:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reconcile daily cash (managers and admins only)
// If no daily summary exists for the date, create it from calculated values first, then mark reconciled.
router.post('/reconcile/:date', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { date } = req.params;
  const { reconciled_by } = req.body;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to reconcile' });
  }
  try {
    let row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    
    if (!row) {
      // No row yet: create daily summary from calculated values (same logic as GET /today)
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayRow = await db.get('SELECT closing_balance FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [yesterdayStr, branchId]);
      const openingBalance = yesterdayRow ? yesterdayRow.closing_balance : 0;
      
      const cashSalesRow = await db.all(`
        SELECT SUM(paid_amount) as cash_sales
        FROM orders
        WHERE DATE(order_date) = ?
        AND payment_status = 'paid_full'
        AND payment_method = 'cash'
        AND paid_amount > 0
        AND branch_id = ?
      `, [date, branchId]);
      const cashSales = cashSalesRow[0]?.cash_sales || 0;
      
      const { calculateBookSales } = require('../utils/cashValidation');
      let bookSales = 0;
      try {
        bookSales = await calculateBookSales(date, branchId);
      } catch (e) {
        bookSales = 0;
      }
      
      const summary = await calculateRemaining(date, openingBalance, cashSales, bookSales, branchId);
      await db.run(
        `INSERT INTO daily_cash_summaries (
          date, branch_id, opening_balance, cash_sales, book_sales, card_sales, mobile_money_sales,
          bank_deposits, bank_payments, mpesa_received, mpesa_paid,
          expenses_from_cash, expenses_from_bank, expenses_from_mpesa,
          cash_in_hand, closing_balance, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [date, branchId, summary.opening_balance, summary.cash_sales, summary.book_sales, summary.card_sales, summary.mobile_money_sales,
         summary.bank_deposits, summary.bank_payments || 0, summary.mpesa_received, summary.mpesa_paid || 0,
         summary.expenses_from_cash, summary.expenses_from_bank, summary.expenses_from_mpesa,
         summary.cash_in_hand, summary.closing_balance, summary.notes || null]
      );
    }
    
    const result = await db.run(
      `UPDATE daily_cash_summaries 
       SET is_reconciled = TRUE, reconciled_by = ?, reconciled_at = CURRENT_TIMESTAMP
       WHERE date = ? AND branch_id = ?`,
      [reconciled_by || 'Cashier', date, branchId]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Daily summary not found' });
    }

    row = await db.get('SELECT * FROM daily_cash_summaries WHERE date = ? AND branch_id = ?', [date, branchId]);
    const branchRow = await db.get('SELECT name FROM branches WHERE id = ?', [branchId]);
    const branchName = branchRow?.name || `Branch ${branchId}`;

    // Daily Closing Report (SUPACLEAN format) – send to director WhatsApp (or return for manual send)
    let reportSent = false;
    let reportText = null;
    let directorPhoneForWa = null;
    try {
      const settingsRows = await db.all('SELECT setting_key, setting_value FROM settings WHERE setting_key = ?', ['manager_whatsapp_number']);
      const directorPhone = (settingsRows && settingsRows[0] && settingsRows[0].setting_value) ? settingsRows[0].setting_value.trim() : null;
      if (!directorPhone) {
        console.warn('Reconcile: No director WhatsApp number in settings – daily report not sent.');
      } else {
        const opening = parseFloat(row.opening_balance) || 0;
        const cashSales = parseFloat(row.cash_sales) || 0;
        const bookSales = parseFloat(row.book_sales) || 0;
        const cardSales = parseFloat(row.card_sales) || 0;
        const mobileSales = parseFloat(row.mobile_money_sales) || 0;
        const totalSales = cashSales + bookSales + cardSales + mobileSales;
        const expensesCash = parseFloat(row.expenses_from_cash) || 0;
        const expensesBank = parseFloat(row.expenses_from_bank) || 0;
        const expensesMpesa = parseFloat(row.expenses_from_mpesa) || 0;
        const totalExpenses = expensesCash + expensesBank + expensesMpesa;
        const closing = parseFloat(row.closing_balance) || 0;
        const cashOut = expensesCash;
        const expectedCash = opening + cashSales + bookSales - cashOut;
        const dateFormatted = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const cashierName = reconciled_by || 'Cashier';

        // P&L: Revenue = total sales; discounts/COGS from schema if available, else 0
        const revenue = totalSales;
        const discounts = 0;
        const costOfGoods = 0;
        const grossProfit = revenue - discounts - costOfGoods;
        const operatingExpenses = totalExpenses;
        const netProfit = grossProfit - operatingExpenses;

        const fmt = (n) => Number(n).toLocaleString();
        const report = [
          '*SUPACLEAN*',
          '*Daily Closing Report*',
          '━━━━━━━━━━━━━━━━',
          `📅 ${dateFormatted}`,
          `👤 Cashier: ${cashierName}`,
          '',
          '💰 *OPENING CASH*',
          `TZS ${fmt(opening)}`,
          '',
          '📈 *SALES BREAKDOWN*',
          `• Cash Sales: TZS ${fmt(cashSales)}`,
          `• M-Pesa: TZS ${fmt(mobileSales)}`,
          `• Bank: TZS ${fmt(cardSales)}`,
          `• Credit Sales: TZS ${fmt(0)}`,
          `*Total Sales: TZS ${fmt(totalSales)}*`,
          '',
          '📥 *CREDIT COLLECTIONS*',
          `Received Today: TZS ${fmt(bookSales)}`,
          '',
          '📤 *OUTFLOWS*',
          `• Expenses: TZS ${fmt(totalExpenses)}`,
          `• Stock Purchases: TZS 0`,
          '',
          '📊 *PROFIT & LOSS*',
          `• Revenue: TZS ${fmt(revenue)}`,
          `• Less Discounts: (TZS ${fmt(discounts)})`,
          `• Cost of Goods: (TZS ${fmt(costOfGoods)})`,
          `• *Gross Profit: TZS ${fmt(grossProfit)}*`,
          `• Operating Expenses: (TZS ${fmt(operatingExpenses)})`,
          `*💰 NET PROFIT: TZS ${fmt(netProfit)}*`,
          '',
          '💵 *CASH POSITION*',
          `Opening: TZS ${fmt(opening)}`,
          `+ Cash Sales: TZS ${fmt(cashSales)}`,
          `+ Collections: TZS ${fmt(bookSales)}`,
          `- Cash Out: TZS ${fmt(cashOut)}`,
          `*Expected Cash: TZS ${fmt(expectedCash)}*`,
          '━━━━━━━━━━━━━━━━',
          branchName ? `📍 ${branchName}` : ''
        ].filter(Boolean).join('\n');

        const { sendWhatsApp, formatPhoneNumber } = require('../utils/whatsapp');
        const waResult = await sendWhatsApp(directorPhone, report, {});
        reportSent = !!(waResult && waResult.success);
        if (!reportSent) {
          reportText = report;
          directorPhoneForWa = formatPhoneNumber(directorPhone).replace(/\D/g, '');
        }
      }
    } catch (waErr) {
      console.error('Reconcile: failed to send daily report WhatsApp:', waErr.message);
    }

    res.json({
      ...row,
      report_sent: reportSent,
      report_text: reportText || undefined,
      director_phone_wa: directorPhoneForWa || undefined
    });
  } catch (err) {
    console.error('Error reconciling daily cash:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get cash summary range
router.get('/range', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { start_date, end_date } = req.query;
  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({ error: 'Select a branch to view cash range' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  try {
    const rows = await db.all(
      'SELECT * FROM daily_cash_summaries WHERE date >= ? AND date <= ? AND branch_id = ? ORDER BY date DESC',
      [start_date, end_date, branchId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching cash summary range:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
