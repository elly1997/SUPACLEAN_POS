# Quick Migration Guide - Fix "items does not exist" Error

## 🚨 Current Error
```
Error loading items: relation "items" does not exist
```

## ✅ Quick Fix (Choose One Method)

### Method 1: Using npm script (Easiest) ⭐ RECOMMENDED

```bash
npm run migrate-items
```

This will automatically:
- Connect to your database
- Run the migration script
- Create all necessary tables
- Populate items from your price list

---

### Method 2: Using Supabase SQL Editor

1. Go to https://supabase.com → Your Project → SQL Editor
2. Click "New query"
3. Open `scripts/migrate-items-services.sql` and copy ALL contents
4. Paste into SQL Editor
5. Click "Run" (or press Ctrl+Enter)
6. Wait for "Success" message
7. Refresh your app!

---

### Method 3: Manual Node.js Script

```bash
node scripts/run-migration.js
```

---

## ✅ After Migration

1. **Refresh your browser** (Price List page)
2. **Items should appear** grouped by:
   - 👔 Gents
   - 👗 Ladies  
   - 🏠 General

3. **Test admin features**:
   - Click "Edit" on an item (if you're admin)
   - Try "Branch Price" to set branch-specific pricing

---

## 🔍 Verify Migration Worked

After running migration, you should see:
- ✅ No more "items does not exist" error
- ✅ Items displayed in categories
- ✅ Prices shown for each item
- ✅ Admin can edit prices

---

## ❓ Still Having Issues?

If you still see errors:
1. Check your `.env` file has `DATABASE_URL` set correctly
2. Verify your Supabase project is active
3. Check the terminal/console for specific error messages
4. Share the error message and I'll help fix it!

---

**Ready? Run `npm run migrate-items` now!** 🚀
