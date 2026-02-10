# How to Run the Items Migration

## Error: "relation 'items' does not exist"

This error means the `items` table hasn't been created in your PostgreSQL database yet. You need to run the migration script first.

---

## Option 1: Using Supabase SQL Editor (Easiest) ✅ RECOMMENDED

1. **Open Supabase Dashboard**
   - Go to https://supabase.com
   - Sign in and select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Paste Migration Script**
   - Open the file: `scripts/migrate-items-services.sql`
   - Copy ALL the contents
   - Paste into the SQL Editor

4. **Run the Script**
   - Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
   - Wait for it to complete (should take a few seconds)

5. **Verify Success**
   - You should see "Success. No rows returned" or similar
   - Check the "Table Editor" - you should see:
     - `items` table
     - `branch_item_prices` table
     - Updated `services` table

6. **Refresh Your App**
   - Go back to your app at `http://localhost:3000/price-list`
   - The error should be gone and items should appear!

---

## Option 2: Using psql Command Line

If you have `psql` installed:

```bash
# Set your database URL (replace with your actual connection string)
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"

# Run the migration
psql $DATABASE_URL -f scripts/migrate-items-services.sql
```

---

## Option 3: Using Node.js Script

I can create a Node.js script that runs the migration automatically. Would you like me to create that?

---

## What the Migration Does

1. ✅ Creates `items` table with all laundry items from your price list
2. ✅ Creates `branch_item_prices` table for branch-specific pricing
3. ✅ Updates `services` table to represent delivery types only
4. ✅ Adds `item_id` column to `orders` table
5. ✅ Populates items with prices from your price list:
   - Gents items (Shirts, Suits, etc.)
   - Ladies items (Dresses, Blouses, etc.)
   - General items (Towels, Bed Sheets, etc.)

---

## After Migration

Once the migration is complete:

1. **Refresh the Price List page** - Items should appear
2. **Check categories** - You should see Gents, Ladies, and General items
3. **Test admin features** - Try editing an item price (if you're admin)

---

## Troubleshooting

### Error: "relation already exists"
- Some tables might already exist - that's OK
- The script uses `CREATE TABLE IF NOT EXISTS` so it's safe to run multiple times

### Error: "permission denied"
- Make sure you're using the correct database credentials
- Check that your Supabase project is active

### Error: "connection refused"
- Check your internet connection
- Verify your Supabase project is running
- Check your DATABASE_URL in `.env` file

---

## Need Help?

If you encounter any errors, share the error message and I'll help you fix it!
