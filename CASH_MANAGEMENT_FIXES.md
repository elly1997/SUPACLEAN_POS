# Cash Management & Reports Integration Fixes

## Issues Fixed

### 1. ✅ Expenses Not Recording in Cash Management
**Problem:** Expenses were not being included in cash management calculations because:
- Expenses table was missing `branch_id` column
- Cash management queries were filtering by `branch_id` but expenses didn't have it

**Solution:**
- Created migration script: `scripts/add-branch-id-to-expenses.sql`
- Updated expenses routes to include `branch_id` when creating expenses
- Updated cash management to handle expenses with or without `branch_id` (backward compatibility)

### 2. ✅ Reports Not Using Cash Management Data
**Problem:** Reports were only querying from `orders` table, not using reconciled `daily_cash_summaries` data

**Solution:**
- Created new report endpoints that use `daily_cash_summaries`:
  - `/api/reports/financial` - Financial report with profit calculations
  - `/api/reports/profit/daily` - Daily profit report
  - `/api/reports/overview` - Today's summary from cash management
- Updated frontend to use new endpoints

### 3. ✅ Missing Profit Calculations
**Problem:** Reports didn't calculate profit (revenue - expenses)

**Solution:**
- Added profit calculations to all financial reports
- Profit = Total Revenue - Total Expenses
- Shows profit for each day/week/month

### 4. ✅ Missing Daily/Weekly/Monthly Aggregation
**Problem:** Reports only showed daily data, no weekly or monthly views

**Solution:**
- Added `period` parameter to financial reports: `day`, `week`, `month`
- Reports now aggregate data by the selected period
- Shows totals for each period with profit calculations

## Migration Required

**⚠️ IMPORTANT: Run this migration in Supabase SQL Editor**

1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `scripts/add-branch-id-to-expenses.sql`
3. Run the migration

This will:
- Add `branch_id` column to expenses table
- Create indexes for better performance
- Allow expenses to be properly linked to branches

## New API Endpoints

### Financial Report
```
GET /api/reports/financial?start_date=2026-01-15&end_date=2026-01-22&period=day
```
Returns:
- Revenue (cash, book, digital)
- Expenses (cash, bank, mpesa)
- Profit (revenue - expenses)
- Aggregated by day/week/month

### Daily Profit Report
```
GET /api/reports/profit/daily?start_date=2026-01-15&end_date=2026-01-22
```
Returns daily profit breakdown

### Overview Report
```
GET /api/reports/overview?date=2026-01-22
```
Returns today's summary from cash management

## How It Works Now

1. **Expenses Creation:**
   - When an expense is created, it's automatically assigned to the user's branch
   - Expenses are stored with `branch_id` for proper filtering

2. **Cash Management:**
   - When calculating daily cash summary, expenses are automatically included
   - Expenses are grouped by payment source (cash, bank, mpesa)
   - Cash in hand = Opening + Sales - Expenses (cash) - Bank Deposits

3. **Reconciliation:**
   - After reconciliation, the `daily_cash_summaries` table contains the final reconciled data
   - Reports use this reconciled data for accurate financial reporting

4. **Reports:**
   - Reports now show:
     - Revenue (from cash management)
     - Expenses (from cash management)
     - Profit (calculated: revenue - expenses)
     - Daily, weekly, and monthly views
     - Reconciliation status

## Testing Checklist

- [ ] Run migration script to add branch_id to expenses
- [ ] Create a new expense and verify it appears in cash management
- [ ] Reconcile a day in cash management
- [ ] Check Reports → Overview tab shows today's data
- [ ] Check Reports → Financial Report shows profit calculations
- [ ] Verify daily/weekly/monthly aggregation works
- [ ] Verify expenses are deducted from cash in hand

## Notes

- Existing expenses without `branch_id` will still work (backward compatibility)
- New expenses will require `branch_id` (automatically assigned)
- Reports use reconciled data, so reconcile days for accurate reporting
- Profit calculations are done at the database level for accuracy
