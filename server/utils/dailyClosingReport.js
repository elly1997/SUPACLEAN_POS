/**
 * SUPACLEAN daily closing report — short WhatsApp summary for the director.
 * One independent message per branch (keep it scannable across many branches).
 */
const db = require('../database/query');

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function isReconciledFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 't';
}

function fmtMoney(n) {
  return `TZS ${Number(n).toLocaleString()}`;
}

/**
 * Compact director report: opening, sales/revenue, M-Pesa, expenses,
 * bank deposits, credit collections, closing cash.
 */
function buildDailyClosingReportText(row, branchName, cashierName, ymd, brand = null) {
  const businessName = (brand && brand.business_name) || 'SUPACLEAN';
  const opening = num(row.opening_balance);
  const openingDeclared = row.opening_cash_declared != null ? num(row.opening_cash_declared) : opening;
  const cashSales = num(row.cash_sales);
  const bookSales = num(row.book_sales); // cash credit collections / prior-day collections
  const cardSales = num(row.card_sales);
  const mobileSales = num(row.mobile_money_sales);
  const bankPaymentsIn = num(row.bank_payments); // bank / bank_transfer received
  const creditSales = num(row.credit_sales);
  // Sales booked today (settlement mix). Collections stay separate.
  const totalSales = cashSales + mobileSales + cardSales + bankPaymentsIn + creditSales;
  const expensesCash = num(row.expenses_from_cash);
  const expensesBank = num(row.expenses_from_bank);
  const expensesMpesa = num(row.expenses_from_mpesa);
  const totalExpenses = expensesCash + expensesBank + expensesMpesa;
  const bankDepositsDay = num(row.bank_deposits);
  const cashOutDrawer = expensesCash + bankDepositsDay;
  // Closing cash uses declared opening (what the till session started with).
  const closingCash = openingDeclared + cashSales + bookSales - cashOutDrawer;

  const dateFormatted = new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const branchLine = branchName ? String(branchName).trim() : 'Branch';
  const lines = [
    `*${businessName}*`,
    `*${branchLine}* · ${dateFormatted}`,
    '━━━━━━━━━━━━━━━━',
    '*Opening*',
    `Expected: ${fmtMoney(opening)}`,
    `Declared: ${fmtMoney(openingDeclared)}`,
    '',
    '*Sales & revenue*',
    `Cash sales: ${fmtMoney(cashSales)}`,
    `M-Pesa: ${fmtMoney(mobileSales)}`,
    `Card: ${fmtMoney(cardSales)}`,
    `Bank transfers: ${fmtMoney(bankPaymentsIn)}`,
    `Credit sales: ${fmtMoney(creditSales)}`,
    `Credit collections: ${fmtMoney(bookSales)}`,
    `*Total sales: ${fmtMoney(totalSales)}*`,
    '',
    '*Outflows*',
    `Expenses: ${fmtMoney(totalExpenses)}`,
    `Bank deposits: ${fmtMoney(bankDepositsDay)}`,
    '',
    `*Closing cash: ${fmtMoney(closingCash)}*`,
    '━━━━━━━━━━━━━━━━',
  ];

  return lines.join('\n');
}

async function getDirectorWhatsAppNumber() {
  const row = await db.get(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    ['manager_whatsapp_number']
  );
  const phone = row?.setting_value ? String(row.setting_value).trim() : '';
  return phone || null;
}

async function deliverDirectorDailyReport(row, branchName, cashierName, ymd, branchId = null) {
  const { getBrandSettings } = require('./brandSettings');
  const brand = await getBrandSettings();
  const directorPhone = await getDirectorWhatsAppNumber();
  if (!directorPhone) {
    return {
      report_sent: false,
      report_text: null,
      director_phone_wa: null,
      error: 'Director WhatsApp number is not configured. Set it in Admin → Branches.',
    };
  }

  const effectiveBranchId = branchId != null ? branchId : row?.branch_id;

  // Always resolve Credit Sales from NOT PAID / advance AR for this day
  // (covers older reconciled rows that still store 0 / missing credit_sales).
  let reportRow = row;
  try {
    const { calculateCreditSales } = require('./cashValidation');
    const creditSales = await calculateCreditSales(ymd, effectiveBranchId);
    reportRow = { ...row, branch_id: effectiveBranchId, credit_sales: creditSales };

    // Persist onto the daily summary even after reconcile so UI + resends stay correct.
    if (effectiveBranchId != null && ymd) {
      try {
        await db.run(
          `UPDATE daily_cash_summaries
           SET credit_sales = ?, updated_at = CURRENT_TIMESTAMP
           WHERE date = ? AND branch_id = ?`,
          [creditSales, ymd, effectiveBranchId]
        );
      } catch (persistErr) {
        console.error('Error persisting credit_sales for daily closing report:', persistErr.message);
      }
    }
  } catch (err) {
    console.error('Error calculating credit sales for daily closing report:', err.message, err.stack);
    reportRow = { ...row, credit_sales: num(row?.credit_sales) };
  }

  const report = buildDailyClosingReportText(reportRow, branchName, cashierName, ymd, brand);
  const creditSalesOut = num(reportRow?.credit_sales);
  const { sendWhatsApp, formatPhoneNumber } = require('./whatsapp');

  try {
    const waResult = await sendWhatsApp(directorPhone, report, {});
    const reportSent = !!(waResult && waResult.success);
    if (reportSent) {
      return {
        report_sent: true,
        report_text: report,
        director_phone_wa: null,
        credit_sales: creditSalesOut,
      };
    }
    return {
      report_sent: false,
      report_text: report,
      director_phone_wa: formatPhoneNumber(directorPhone).replace(/\D/g, ''),
      credit_sales: creditSalesOut,
    };
  } catch (err) {
    return {
      report_sent: false,
      report_text: report,
      director_phone_wa: formatPhoneNumber(directorPhone).replace(/\D/g, ''),
      error: err.message,
      credit_sales: creditSalesOut,
    };
  }
}

module.exports = {
  isReconciledFlag,
  buildDailyClosingReportText,
  deliverDirectorDailyReport,
  getDirectorWhatsAppNumber,
};
