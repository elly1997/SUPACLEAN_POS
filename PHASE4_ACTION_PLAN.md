# Phase 4: Route Updates - Action Plan

## 🎯 Overview

Convert all route files from SQLite (callbacks) to PostgreSQL (async/await).

**Total Files**: 13 route files  
**Estimated Time**: 5-7 hours  
**Strategy**: Update database connection first, then convert routes systematically

---

## ✅ Step 0: Update Database Connection (FIRST!)

Before converting routes, we need to update the database connection file.

### Current Status:
- ✅ `server/database/init.postgresql.js` exists (template)
- ✅ `server/database/query.js` exists (helper functions)
- ⚠️ `server/database/init.js` still uses SQLite

### Action Needed:
1. Backup current `init.js`
2. Replace with PostgreSQL version
3. Verify `query.js` works correctly

---

## 📋 Route Files to Convert (Priority Order)

### High Priority (Core Functionality):
1. ✅ **auth.js** - Authentication (login, sessions)
2. ✅ **orders.js** - Order management
3. ✅ **customers.js** - Customer management
4. ✅ **cashManagement.js** - Daily reconciliation
5. ✅ **transactions.js** - Payment transactions

### Medium Priority:
6. ✅ **reports.js** - Reports and analytics
7. ✅ **expenses.js** - Expense tracking
8. ✅ **branches.js** - Branch management
9. ✅ **services.js** - Service management

### Lower Priority:
10. ✅ **settings.js** - Settings
11. ✅ **bankDeposits.js** - Bank deposits
12. ✅ **validation.js** - Validation utilities
13. ✅ **loyalty.js** - Loyalty program (if exists)

---

## 🔄 Conversion Pattern for Each File

### 1. Change Import
```javascript
// OLD
const db = require('../database/init');

// NEW
const db = require('../database/query');
```

### 2. Convert Callbacks to Async/Await
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

### 3. Update db.get() calls
```javascript
// OLD
db.get('SELECT * FROM table WHERE id = ?', [id], (err, row) => {
  if (err) return res.status(500).json({ error: err.message });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// NEW
try {
  const row = await db.get('SELECT * FROM table WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

### 4. Update db.run() calls (INSERT/UPDATE/DELETE)
```javascript
// OLD
db.run('INSERT INTO table (col) VALUES (?)', [value], function(err) {
  if (err) return res.status(500).json({ error: err.message });
  res.json({ id: this.lastID, message: 'Success' });
});

// NEW
try {
  const result = await db.run('INSERT INTO table (col) VALUES (?) RETURNING id', [value]);
  res.json({ id: result.lastID, message: 'Success' });
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

**Note**: For INSERT statements, PostgreSQL requires `RETURNING id` to get the inserted ID.

---

## 📝 Testing Strategy

After each file conversion:
1. Check for syntax errors (run server)
2. Test affected endpoints
3. Verify database queries work
4. Check error handling

---

## 🚀 Execution Plan

### Phase 4.1: Database Connection Update
- [ ] Backup `server/database/init.js`
- [ ] Replace with PostgreSQL version
- [ ] Update `query.js` if needed
- [ ] Test connection

### Phase 4.2: High Priority Routes
- [ ] auth.js
- [ ] orders.js
- [ ] customers.js
- [ ] cashManagement.js
- [ ] transactions.js

### Phase 4.3: Medium Priority Routes
- [ ] reports.js
- [ ] expenses.js
- [ ] branches.js
- [ ] services.js

### Phase 4.4: Lower Priority Routes
- [ ] settings.js
- [ ] bankDeposits.js
- [ ] validation.js
- [ ] loyalty.js

---

## ⚠️ Important Notes

1. **Backup First**: Always backup files before modifying
2. **Test Incrementally**: Test after each file conversion
3. **Error Handling**: Add proper error logging
4. **SQL Compatibility**: Most SQLite queries work, but check:
   - Date functions (DATE() vs DATE_TRUNC())
   - Boolean values (1/0 vs TRUE/FALSE)
   - AUTO_INCREMENT vs SERIAL

---

## 📚 Reference

- `PHASE4_ROUTE_UPDATES.md` - Detailed conversion guide
- `QUICK_REFERENCE.md` - Quick lookup for patterns
- `server/database/query.js` - Query helper functions

---

**Ready to start?** Let's begin with Step 0: Database Connection Update!
