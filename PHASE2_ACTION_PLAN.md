# Phase 2: Database Schema Migration - Action Plan

## ✅ Status: Ready to Import

**Phase 1 Complete**: Cloud accounts created  
**Next Step**: Import schema to Supabase

---

## 📋 Quick Checklist

- [ ] Step 1: Import main schema to Supabase (5 minutes)
- [ ] Step 2: Verify tables created (2 minutes)
- [ ] Step 3: Test basic operations (3 minutes)
- [ ] **Total Time**: ~10 minutes

---

## 🚀 Step-by-Step Instructions

### Step 1: Import Schema to Supabase

1. **Open Supabase Dashboard**:
   - Go to https://app.supabase.com
   - Select your project

2. **Open SQL Editor**:
   - Click "SQL Editor" in the left sidebar
   - Click "New query" button

3. **Copy Schema**:
   - Open file: `backups/schema_postgresql_fixed.sql` (use the FIXED version)
   - Select all (Ctrl+A)
   - Copy (Ctrl+C)
   
   **⚠️ IMPORTANT**: Use `schema_postgresql_fixed.sql` - it has tables in the correct order!

4. **Paste and Run**:
   - Paste into SQL Editor
   - Click "Run" button (or press Ctrl+Enter)
   - Wait for execution (should take 5-10 seconds)

5. **Check Results**:
   - Look for "Success" message
   - If errors appear, note them (we'll fix them)

---

### Step 2: Verify Tables Created

1. **Open Table Editor**:
   - Click "Table Editor" in left sidebar
   - You should see all tables listed

2. **Verify Key Tables**:
   - ✅ `branches` - Branch management
   - ✅ `customers` - Customer data
   - ✅ `orders` - Order management
   - ✅ `services` - Service types
   - ✅ `daily_cash_summaries` - Cash tracking
   - ✅ `transactions` - Payment transactions
   - ✅ `users` - User accounts

3. **Check daily_cash_summaries**:
   - Click on `daily_cash_summaries` table
   - Verify it has:
     - `date` column (type: DATE)
     - `branch_id` column (type: INTEGER)
     - Unique constraint on (date, branch_id)

---

### Step 3: Test Basic Operations

Run these test queries in SQL Editor:

```sql
-- Test 1: Insert a test branch
INSERT INTO branches (name, code, branch_type, address, is_active)
VALUES ('Test Branch', 'TB01', 'workshop', 'Test Address', TRUE)
RETURNING id;

-- Test 2: Select branches
SELECT * FROM branches LIMIT 5;

-- Test 3: Insert test customer
INSERT INTO customers (name, phone)
VALUES ('Test Customer', '+255123456789')
RETURNING id;

-- Test 4: Insert test daily cash summary
INSERT INTO daily_cash_summaries (date, branch_id, opening_balance, cash_sales)
VALUES ('2026-01-13', 1, 0, 100)
RETURNING id;

-- Test 5: Select daily cash summary
SELECT * FROM daily_cash_summaries WHERE branch_id = 1;
```

**Expected Results**:
- All INSERT statements should succeed
- All SELECT statements should return data
- No errors should appear

---

## ⚠️ Troubleshooting

### Error: "relation already exists"
**Fix**: Tables already exist. This is okay if you're re-running. You can:
- Drop tables and re-import (if no data)
- Or skip this step if tables are correct

### Error: "column does not exist"
**Fix**: Check if the schema file was fully imported. Re-run the import.

### Error: "foreign key constraint violation"
**Fix**: Make sure parent tables (branches, customers) exist before inserting child records.

### Error: "syntax error"
**Fix**: Check the SQL syntax. The schema file should be correct, but if you see errors, let me know.

---

## ✅ Success Criteria

Phase 2 is complete when:
- [x] All tables created in Supabase
- [x] `daily_cash_summaries` has `branch_id` column
- [x] `daily_cash_summaries` has unique constraint on (date, branch_id)
- [x] Test inserts work
- [x] Test selects work
- [x] No errors in SQL Editor

---

## 🎯 Next Steps

Once Phase 2 is complete:
1. **Phase 3**: Set up database connection in code
2. **Phase 4**: Convert route files to use PostgreSQL
3. **Phase 5**: Test everything
4. **Phase 6**: Migrate data
5. **Phase 7**: Deploy to production

---

## 📞 Need Help?

If you encounter any issues:
1. Check the error message in Supabase SQL Editor
2. Verify the schema file is correct
3. Check that all tables are created
4. Let me know what error you see

---

**Ready?** Open Supabase and import the schema! 🚀
