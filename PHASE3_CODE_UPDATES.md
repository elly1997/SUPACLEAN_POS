# Phase 3: Code Updates - Database Connection

## Overview
Update codebase to use PostgreSQL instead of SQLite.

**Time Required**: 2-3 hours  
**Prerequisites**: 
- Phase 1 complete (Supabase account)
- Phase 2 complete (Schema imported to Supabase)
- DATABASE_URL from Supabase

---

## Step 3.1: Install PostgreSQL Package ⏱️ 5 minutes

### Status: ✅ Already Done!

The `pg` package has been installed. You can verify:
```bash
npm list pg
```

---

## Step 3.2: Create .env File ⏱️ 10 minutes

### Actions:

1. **Copy template to .env**:
   ```bash
   cp .env.template .env
   ```
   Or manually create `.env` file in root directory.

2. **Fill in DATABASE_URL**:
   - Go to Supabase Dashboard
   - Project Settings → Database
   - Connection string → URI
   - Copy the connection string
   - Replace `[YOUR-PASSWORD]` with your actual password
   - Paste into `.env` file

3. **Generate JWT_SECRET** (optional but recommended):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output and paste into `.env` as JWT_SECRET value.

4. **Verify .env file**:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@db.xxx.supabase.co:5432/postgres
   PORT=5000
   NODE_ENV=development
   CLIENT_URL=http://localhost:3000
   JWT_SECRET=your-generated-secret-here
   ```

### ✅ Checklist:
- [ ] `.env` file created
- [ ] DATABASE_URL filled in (with real password)
- [ ] JWT_SECRET generated and set
- [ ] `.env` added to `.gitignore` (should be there already)

---

## Step 3.3: Update Database Connection File ⏱️ 30 minutes

### Current File: `server/database/init.js` (SQLite)
### New File: `server/database/init.postgresql.js` (PostgreSQL - already created)

### Migration Strategy:

We have two options:

#### Option A: Replace init.js (Recommended for clean migration)
1. Backup current `server/database/init.js`
2. Replace with PostgreSQL version
3. Update all imports

#### Option B: Keep both, switch via environment (For gradual migration)
1. Keep `init.js` as SQLite (for fallback)
2. Use `init.postgresql.js` for PostgreSQL
3. Switch based on environment variable

**We'll use Option A** (clean migration).

### Actions:

1. **Backup current init.js**:
   ```bash
   cp server/database/init.js server/database/init.sqlite.backup.js
   ```

2. **Replace init.js with PostgreSQL version**:
   - Copy content from `init.postgresql.js`
   - Or rename: `mv init.postgresql.js init.js` (after backup)

3. **Remove SQLite-specific code**:
   - Remove `sqlite3` require
   - Remove `initializeTables()` function (tables are in Supabase)
   - Remove PRAGMA statements
   - Keep only pool connection

### ✅ Checklist:
- [ ] init.js backed up
- [ ] init.js replaced with PostgreSQL version
- [ ] SQLite code removed
- [ ] Connection uses DATABASE_URL from .env

---

## Step 3.4: Create Query Helper Functions ⏱️ 1 hour

### Status: ✅ Already Created!

File: `server/database/query.js`

This file provides:
- `all(sql, params)` - Returns array of rows (replaces `db.all`)
- `get(sql, params)` - Returns first row (replaces `db.get`)
- `run(sql, params)` - Executes query (replaces `db.run`)
- `query(sql, params)` - Raw query (for advanced use)
- `convertQuery()` - Converts ? placeholders to $1, $2, etc.

### Usage Example:

**OLD (SQLite callback)**:
```javascript
const db = require('../database/init');
db.all('SELECT * FROM customers WHERE id = ?', [id], (err, rows) => {
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json(rows);
});
```

**NEW (PostgreSQL async/await)**:
```javascript
const db = require('../database/query');
try {
  const rows = await db.all('SELECT * FROM customers WHERE id = ?', [id]);
  res.json(rows);
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

### ✅ Checklist:
- [ ] query.js file created ✅
- [ ] Helper functions implemented ✅
- [ ] Functions handle ? → $1, $2 conversion
- [ ] Error handling included

---

## Step 3.5: Update Route Files (Overview) ⏱️ Review Only

This is a preview of Phase 4. For now, just understand the pattern.

### Files to Update (Phase 4):
- `server/routes/cashManagement.js`
- `server/routes/reports.js`
- `server/routes/orders.js`
- `server/routes/customers.js`
- `server/routes/transactions.js`
- `server/routes/expenses.js`
- `server/routes/branches.js`
- `server/routes/auth.js`
- Other route files

### Pattern for Each File:

1. **Change import**:
   ```javascript
   // OLD
   const db = require('../database/init');
   
   // NEW
   const db = require('../database/query');
   ```

2. **Change callbacks to async/await**:
   ```javascript
   // OLD
   router.get('/endpoint', (req, res) => {
     db.all('SELECT * FROM table', [], (err, rows) => {
       if (err) return res.status(500).json({ error: err.message });
       res.json(rows);
     });
   });
   
   // NEW
   router.get('/endpoint', async (req, res) => {
     try {
       const rows = await db.all('SELECT * FROM table', []);
       res.json(rows);
     } catch (err) {
       console.error('Error:', err);
       res.status(500).json({ error: err.message });
     }
   });
   ```

We'll do this in Phase 4.

### ✅ Checklist:
- [ ] Pattern understood
- [ ] Ready for Phase 4

---

## Step 3.6: Test Database Connection ⏱️ 15 minutes

### Create Test Script:

Create `test-postgres-connection.js`:
```javascript
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connection successful!');
    console.log('Current time:', result.rows[0].now);
    
    // Test query
    const branches = await pool.query('SELECT COUNT(*) FROM branches');
    console.log('✅ Query test successful!');
    console.log('Branches count:', branches.rows[0].count);
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Make sure:');
    console.error('  1. DATABASE_URL is set in .env file');
    console.error('  2. Supabase database is accessible');
    console.error('  3. Password is correct');
    process.exit(1);
  }
}

testConnection();
```

### Run Test:
```bash
node test-postgres-connection.js
```

### Expected Output:
```
✅ PostgreSQL connection successful!
Current time: 2026-01-13T...
✅ Query test successful!
Branches count: 1
```

### ✅ Checklist:
- [ ] Test script created
- [ ] Connection test passes
- [ ] Can query database
- [ ] No errors

---

## Step 3.7: Update server/index.js ⏱️ 15 minutes

### Check Current Code:

File: `server/index.js`

Look for:
```javascript
const db = require('./database/init');
```

### Update (if needed):

The database connection is usually only imported, not directly used in index.js. 
But verify that any database usage uses the query helpers.

### ✅ Checklist:
- [ ] server/index.js reviewed
- [ ] No direct database calls (should use routes only)
- [ ] Database initialization happens in routes

---

## Troubleshooting

### Common Issues:

1. **"Cannot find module 'pg'"**:
   ```bash
   npm install pg
   ```

2. **"DATABASE_URL is not defined"**:
   - Check `.env` file exists
   - Check `require('dotenv').config()` is called
   - Verify DATABASE_URL format is correct

3. **Connection refused**:
   - Check Supabase project is active
   - Verify connection string
   - Check password is correct
   - Ensure no firewall blocking

4. **SSL error**:
   - Add `ssl: { rejectUnauthorized: false }` for development
   - Use proper SSL for production

5. **Query syntax errors**:
   - Check ? placeholders are converted
   - Verify table/column names match PostgreSQL
   - Check data types match

---

## Next Steps

Once Phase 3 is complete:
- ✅ PostgreSQL package installed
- ✅ .env file configured
- ✅ Database connection updated
- ✅ Query helpers created
- ✅ Connection tested

**Phase 4** will:
- Update all route files
- Convert callbacks to async/await
- Handle SQLite-specific functions
- Test all endpoints

---

**Ready to proceed?** Complete Phase 3, then we'll move to Phase 4!
