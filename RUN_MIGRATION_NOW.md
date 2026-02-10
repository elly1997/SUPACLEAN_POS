# ⚡ QUICK FIX: Run Migration Now

## 🚨 Current Error
```
relation "items" does not exist
```

## ✅ SOLUTION: Use Supabase SQL Editor (2 Minutes)

### Step 1: Open Supabase
1. Go to https://supabase.com
2. Sign in and select your project
3. Click **"SQL Editor"** in the left sidebar
4. Click **"New query"**

### Step 2: Copy & Run Migration
1. Open file: `scripts/migrate-items-simple.sql`
2. **Select ALL** (Ctrl+A)
3. **Copy** (Ctrl+C)
4. **Paste** into Supabase SQL Editor (Ctrl+V)
5. Click **"Run"** button (or press Ctrl+Enter)

### Step 3: Wait for Success
- Should see: **"Success. No rows returned"** or similar
- Takes 2-5 seconds

### Step 4: Verify
- Click **"Table Editor"** in left sidebar
- You should see:
  - ✅ `items` table (with ~40+ rows)
  - ✅ `branch_item_prices` table

### Step 5: Refresh Your App
- Go back to `http://localhost:3000/price-list`
- **Items should now appear!** 🎉

---

## 🔍 Verify Migration Worked

After running the SQL, check:

```sql
-- Run this in Supabase SQL Editor to verify:
SELECT COUNT(*) as total_items FROM items;
SELECT category, COUNT(*) as count FROM items GROUP BY category;
```

You should see:
- Total items: ~40+
- Categories: gents, ladies, general

---

## ❌ If Still Errors

If you still see errors after running the SQL:

1. **Check error message** in Supabase SQL Editor
2. **Most common issue**: `branches` table doesn't exist
   - Solution: Run `backups/schema_postgresql_fixed.sql` first

3. **Share the error message** and I'll help fix it!

---

**Ready? Open Supabase SQL Editor and run `scripts/migrate-items-simple.sql` now!** 🚀
