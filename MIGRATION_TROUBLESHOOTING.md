# Migration Troubleshooting Guide

## Current Issue: "relation 'items' does not exist"

The migration script is trying to INSERT into `items` before the table is created. Here's how to fix it:

---

## ✅ Solution: Use Supabase SQL Editor (Most Reliable)

The Node.js script may have issues splitting SQL correctly. Using Supabase SQL Editor is more reliable:

### Step-by-Step:

1. **Open Supabase Dashboard**
   - Go to https://supabase.com
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in left sidebar
   - Click "New query"

3. **Copy Migration Script**
   - Open file: `scripts/migrate-items-services.sql`
   - Select ALL content (Ctrl+A)
   - Copy (Ctrl+C)

4. **Paste and Run**
   - Paste into SQL Editor (Ctrl+V)
   - Click "Run" button (or Ctrl+Enter)
   - Wait for "Success" message

5. **Verify Tables**
   - Go to "Table Editor" in left sidebar
   - You should see:
     - ✅ `items` table (with ~40+ rows)
     - ✅ `branch_item_prices` table (empty)
     - ✅ `services` table (updated)

6. **Refresh Your App**
   - Go back to `http://localhost:3000/price-list`
   - Items should now appear!

---

## 🔧 Alternative: Fix the Node.js Script

If you prefer using the npm script, the issue is that SQL statements are being executed out of order. I've updated the script to handle this better, but if you still see errors:

1. **Check the order of execution** in the terminal output
2. **Make sure CREATE TABLE runs before INSERT**
3. **If it doesn't work, use Supabase SQL Editor instead** (recommended)

---

## ✅ After Successful Migration

Once the migration completes successfully:

1. **Price List page** should show:
   - Items grouped by category (Gents, Ladies, General)
   - Prices for each item
   - Admin can edit prices

2. **Check in Supabase Table Editor**:
   - `items` table should have ~40+ items
   - Each item has: name, category, base_price, service_type

3. **Test Admin Features**:
   - Edit an item price
   - Set branch-specific price
   - Add new item

---

## ❌ If Migration Still Fails

If you see errors in Supabase SQL Editor:

### Error: "relation 'branches' does not exist"
- You need to run the Phase 2 schema migration first
- Run: `backups/schema_postgresql_fixed.sql` in Supabase SQL Editor

### Error: "permission denied"
- Make sure you're using the correct database user
- Check your connection string has the right credentials

### Error: "constraint violation"
- Some constraints might already exist
- The script uses `IF NOT EXISTS` so it should be safe
- Try running individual CREATE TABLE statements one at a time

---

## 💡 Recommended Approach

**Use Supabase SQL Editor** - it's the most reliable way to run migrations:
1. ✅ Guaranteed to execute in order
2. ✅ Better error messages
3. ✅ Can see results immediately
4. ✅ Can run individual statements if needed

---

**Next Steps:**
1. Open Supabase SQL Editor
2. Copy the entire `scripts/migrate-items-services.sql` file
3. Paste and run it
4. Refresh your Price List page!
