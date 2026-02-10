# Phase 2: Database Schema Migration Guide

## Overview
Export SQLite schema, convert to PostgreSQL, and import to Supabase.

**Time Required**: 3-5 hours  
**Prerequisites**: Phase 1 complete (Supabase account created)

---

## Step 2.1: Export SQLite Schema ⏱️ 30 minutes

### Option A: Using the Script (Recommended)

I've created a script to export your schema automatically.

**Run the export script:**
```bash
cd "C:\Users\HP\OneDrive\Desktop\TUNTCHIE\CURSOR PROJECTS"
node scripts/export-schema.js
```

This will:
- Connect to your SQLite database
- Export all CREATE TABLE statements
- Export all indexes
- Save to `backups/schema_export.sql`

### Option B: Using DB Browser for SQLite (Manual)

1. **Download DB Browser for SQLite** (if not installed):
   - https://sqlitebrowser.org/dl/
   - Install it

2. **Open your database**:
   - Open DB Browser
   - File → Open Database
   - Select: `database/supaclean.db`

3. **Export schema**:
   - File → Export → Database to SQL file
   - Save as: `backups/schema_export.sql`
   - Check "Structure only" (not data yet)
   - Click "Export"

### ✅ Checklist:
- [ ] Schema exported to `backups/schema_export.sql`
- [ ] File contains CREATE TABLE statements
- [ ] All tables included

---

## Step 2.2: Convert Schema to PostgreSQL ⏱️ 2-3 hours

### Option A: Using the Converter Script (Quick Start)

I've created a converter script that handles most conversions automatically.

**Run the converter:**
```bash
node scripts/sqlite-to-postgres-converter.js
```

This will:
- Read `backups/schema_export.sql`
- Convert SQLite syntax to PostgreSQL
- Save to `backups/schema_postgresql.sql`

### Manual Conversion Checklist

Even with the script, you should review and fix:

1. **Data Types**:
   - ✅ `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` (handled by script)
   - ✅ `REAL` → `DECIMAL(10,2)` for money fields (handled by script)
   - ✅ `DATETIME` → `TIMESTAMP` (handled by script)
   - ✅ `INTEGER` (booleans) → `BOOLEAN` (handled by script)
   - ⚠️ `TEXT` → Keep as `TEXT` or change to `VARCHAR(255)` (review manually)
   - ⚠️ `date TEXT` → `date DATE` (for daily_cash_summaries - handled in Step 2.3)

2. **Functions**:
   - ✅ `CURRENT_TIMESTAMP` → `CURRENT_TIMESTAMP` (same in PostgreSQL)
   - ⚠️ `strftime()` → `TO_CHAR()` or `DATE_TRUNC()` (handle in code)
   - ⚠️ `julianday()` → PostgreSQL date functions (handle in code)

3. **Constraints**:
   - ✅ `UNIQUE` → `UNIQUE` (same)
   - ✅ `FOREIGN KEY` → `FOREIGN KEY` (same)
   - ⚠️ `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING` (handle in code)

4. **Remove SQLite-specific**:
   - ✅ Remove `PRAGMA` statements (handled by script)
   - ✅ Remove `sqlite_autoindex` indexes

### Review Converted Schema

Open `backups/schema_postgresql.sql` and review:

1. Check all money fields are `DECIMAL(10,2)`
2. Check all boolean fields are `BOOLEAN`
3. Check all date/time fields are `TIMESTAMP`
4. Verify table names are correct
5. Verify foreign key relationships

### ✅ Checklist:
- [ ] Schema converted to PostgreSQL
- [ ] File saved: `backups/schema_postgresql.sql`
- [ ] All tables converted
- [ ] Manual review completed

---

## Step 2.3: Add branch_id to daily_cash_summaries ⏱️ 30 minutes

### Why This is Needed

Currently, `daily_cash_summaries` has a `date TEXT UNIQUE` constraint. For multi-branch support, we need:
- `branch_id` column
- Unique constraint on `(date, branch_id)` instead of just `date`

### Changes Needed

1. **Change date column type** (if TEXT):
   ```sql
   -- In schema_postgresql.sql, find daily_cash_summaries table
   -- Change: date TEXT UNIQUE NOT NULL
   -- To: date DATE NOT NULL
   ```

2. **Add branch_id column**:
   Add this after the daily_cash_summaries table creation:
   ```sql
   -- Add branch_id to daily_cash_summaries
   ALTER TABLE daily_cash_summaries 
   ADD COLUMN branch_id INTEGER REFERENCES branches(id);
   ```

3. **Add unique constraint**:
   ```sql
   -- Remove old unique constraint on date (if exists)
   -- Add new unique constraint
   ALTER TABLE daily_cash_summaries 
   ADD CONSTRAINT daily_cash_summaries_date_branch_unique 
   UNIQUE (date, branch_id);
   ```

4. **Add index**:
   ```sql
   CREATE INDEX idx_daily_cash_summaries_branch_date 
   ON daily_cash_summaries(branch_id, date);
   ```

### Manual Edit Instructions

1. Open `backups/schema_postgresql.sql`
2. Find the `daily_cash_summaries` table definition
3. Make these changes:
   - Change `date TEXT UNIQUE` → `date DATE` (remove UNIQUE from column)
   - Add `branch_id INTEGER` column (after other columns)
   - At the end of the file, add the ALTER TABLE and CREATE INDEX statements above

### ✅ Checklist:
- [ ] date column changed to DATE
- [ ] branch_id column added
- [ ] Unique constraint updated (date, branch_id)
- [ ] Index created

---

## Step 2.4: Import Schema to Supabase ⏱️ 30 minutes

### Prerequisites:
- ✅ Supabase account created (Phase 1)
- ✅ Schema converted to PostgreSQL
- ✅ branch_id changes added

### Steps:

1. **Go to Supabase Dashboard**:
   - https://app.supabase.com
   - Select your project

2. **Open SQL Editor**:
   - Click "SQL Editor" in left sidebar
   - Click "New query"

3. **Copy Schema**:
   - Open `backups/schema_postgresql.sql`
   - Select all content (Ctrl+A)
   - Copy (Ctrl+C)

4. **Paste and Run**:
   - Paste into SQL Editor
   - Click "Run" button (or press Ctrl+Enter)
   - Wait for execution

5. **Check for Errors**:
   - Review error messages (if any)
   - Common issues:
     - Syntax errors (fix and re-run)
     - Missing dependencies (run in order)
     - Duplicate tables (drop existing or use IF NOT EXISTS)

6. **Verify Tables Created**:
   - Click "Table Editor" in left sidebar
   - You should see all tables:
     - branches
     - customers
     - orders
     - services
     - transactions
     - daily_cash_summaries
     - expenses
     - etc.

### ✅ Checklist:
- [ ] Schema imported to Supabase
- [ ] No errors in SQL editor
- [ ] All tables visible in Table Editor
- [ ] daily_cash_summaries has branch_id column
- [ ] Foreign keys created

---

## Step 2.5: Verify Schema ⏱️ 30 minutes

### Check Table Structure

1. **In Supabase Table Editor**:
   - Click on each table
   - Verify columns match SQLite structure
   - Check data types are correct

2. **Verify daily_cash_summaries**:
   - Should have `branch_id` column
   - Should have `date` as DATE type
   - Should have unique constraint on (date, branch_id)

3. **Test Basic Operations**:
   ```sql
   -- Test insert (should work)
   INSERT INTO branches (name, code, branch_type, address, is_active)
   VALUES ('Test Branch', 'TB01', 'workshop', 'Test Address', TRUE);
   
   -- Test select (should work)
   SELECT * FROM branches LIMIT 1;
   
   -- Test daily_cash_summaries insert
   INSERT INTO daily_cash_summaries (date, branch_id, opening_balance, cash_sales)
   VALUES ('2026-01-13', 1, 0, 100);
   ```

### ✅ Checklist:
- [ ] All tables verified
- [ ] Column types correct
- [ ] Test inserts work
- [ ] Test selects work
- [ ] Foreign keys work

---

## Troubleshooting

### Common Issues:

1. **Syntax Errors**:
   - Check SQL syntax
   - PostgreSQL is more strict than SQLite
   - Fix errors and re-run

2. **Missing Tables**:
   - Run CREATE TABLE statements in order
   - Tables with foreign keys need parent tables first

3. **Duplicate Key Errors**:
   - Use `IF NOT EXISTS` in CREATE TABLE
   - Or drop existing tables first (if empty)

4. **Type Errors**:
   - Check data types match PostgreSQL
   - Decimal places for DECIMAL type
   - Boolean values (TRUE/FALSE not 1/0)

5. **Foreign Key Errors**:
   - Ensure parent tables exist
   - Check column names match
   - Verify referenced columns exist

---

## Next Steps

Once Phase 2 is complete:
- ✅ Schema imported to Supabase
- ✅ All tables created
- ✅ branch_id added to daily_cash_summaries
- ✅ Ready for Phase 3: Code Updates

**Phase 3** will:
- Install PostgreSQL package
- Update database connection
- Create query helper functions
- Update code to use PostgreSQL

---

**Ready to proceed?** Complete Phase 2, then we'll move to Phase 3!
