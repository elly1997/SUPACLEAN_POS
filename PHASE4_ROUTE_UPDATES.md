# Phase 4: Code Updates - Replace Database Calls

## Overview
Update all route files to use PostgreSQL query helpers instead of SQLite.

**Time Required**: 5-7 hours  
**Prerequisites**: 
- Phase 3 complete (query helpers ready)
- Database connection working
- Schema imported to Supabase

---

## Files to Update

### Priority Order (Most Used First):

1. **server/routes/cashManagement.js** ⭐ High Priority
2. **server/routes/reports.js** ⭐ High Priority
3. **server/routes/orders.js** ⭐ High Priority
4. **server/routes/customers.js** ⭐ High Priority
5. **server/routes/transactions.js** ⭐ High Priority
6. **server/routes/expenses.js**
7. **server/routes/auth.js**
8. **server/routes/branches.js**
9. **server/routes/services.js**
10. **server/routes/settings.js**
11. **server/routes/bankDeposits.js**
12. **server/routes/validation.js** (if exists)

---

## Conversion Patterns

### Pattern 1: Change Import

**OLD (SQLite)**:
```javascript
const db = require('../database/init');
```

**NEW (PostgreSQL)**:
```javascript
const db = require('../database/query');
```

---

### Pattern 2: db.all() - Get Multiple Rows

**OLD (SQLite callback)**:
```javascript
router.get('/endpoint', (req, res) => {
  db.all('SELECT * FROM table WHERE id = ?', [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
```

**NEW (PostgreSQL async/await)**:
```javascript
router.get('/endpoint', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM table WHERE id = ?', [id]);
    res.json(rows);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

### Pattern 3: db.get() - Get Single Row

**OLD (SQLite callback)**:
```javascript
db.get('SELECT * FROM table WHERE id = ?', [id], (err, row) => {
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!row) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(row);
});
```

**NEW (PostgreSQL async/await)**:
```javascript
try {
  const row = await db.get('SELECT * FROM table WHERE id = ?', [id]);
  if (!row) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(row);
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

---

### Pattern 4: db.run() - INSERT/UPDATE/DELETE

**OLD (SQLite callback)**:
```javascript
db.run(
  'INSERT INTO table (name, email) VALUES (?, ?)',
  [name, email],
  function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, message: 'Created' });
  }
);
```

**NEW (PostgreSQL async/await)**:
```javascript
try {
  const result = await db.run(
    'INSERT INTO table (name, email) VALUES (?, ?) RETURNING id',
    [name, email]
  );
  res.json({ id: result.lastID, message: 'Created' });
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

**Note**: For INSERT, add `RETURNING id` to get the inserted ID.

---

### Pattern 5: Nested Queries

**OLD (SQLite nested callbacks)**:
```javascript
db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  db.all('SELECT * FROM orders WHERE customer_id = ?', [id], (err, orders) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ customer, orders });
  });
});
```

**NEW (PostgreSQL async/await)**:
```javascript
try {
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  const orders = await db.all('SELECT * FROM orders WHERE customer_id = ?', [id]);
  res.json({ customer, orders });
} catch (err) {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
}
```

---

## SQLite-Specific Function Conversions

### strftime() → PostgreSQL Date Functions

**SQLite**:
```sql
WHERE strftime('%Y-%m', o.collected_date) = ?
```

**PostgreSQL**:
```sql
WHERE TO_CHAR(o.collected_date, 'YYYY-MM') = ?
```

Or:
```sql
WHERE DATE_TRUNC('month', o.collected_date)::text LIKE ?
```

---

### julianday() → PostgreSQL Date Functions

**SQLite**:
```sql
WHERE julianday('now') - julianday(date) < 7
```

**PostgreSQL**:
```sql
WHERE CURRENT_DATE - date < INTERVAL '7 days'
```

Or:
```sql
WHERE date > CURRENT_DATE - INTERVAL '7 days'
```

---

### datetime() → NOW() or CURRENT_TIMESTAMP

**SQLite**:
```sql
WHERE datetime('now')
```

**PostgreSQL**:
```sql
WHERE NOW()
```

Or:
```sql
WHERE CURRENT_TIMESTAMP
```

---

## Step-by-Step Conversion Process

### For Each Route File:

1. **Change import**:
   ```javascript
   const db = require('../database/query'); // Changed from 'init'
   ```

2. **Add async to route handlers**:
   ```javascript
   router.get('/endpoint', async (req, res) => { // Added async
   ```

3. **Convert db.all()**:
   - Wrap in try/catch
   - Change callback to await
   - Remove error callback parameter

4. **Convert db.get()**:
   - Wrap in try/catch
   - Change callback to await
   - Handle null result (404)

5. **Convert db.run()**:
   - Wrap in try/catch
   - Change callback to await
   - For INSERT: Add RETURNING id
   - Use result.lastID instead of this.lastID

6. **Convert nested queries**:
   - Use sequential await calls
   - Handle errors in single try/catch

7. **Convert SQLite-specific functions**:
   - strftime() → TO_CHAR() or DATE_TRUNC()
   - julianday() → date arithmetic
   - datetime('now') → NOW()

8. **Test the route**:
   - Test each endpoint
   - Verify queries work
   - Check error handling

---

## Conversion Checklist Template

For each file, check:

- [ ] Import changed to `require('../database/query')`
- [ ] All route handlers are `async`
- [ ] All `db.all()` converted to `await db.all()` with try/catch
- [ ] All `db.get()` converted to `await db.get()` with try/catch
- [ ] All `db.run()` converted to `await db.run()` with try/catch
- [ ] INSERT statements have `RETURNING id` (if ID needed)
- [ ] Nested queries converted to sequential await
- [ ] strftime() converted to TO_CHAR() or DATE_TRUNC()
- [ ] julianday() converted to date arithmetic
- [ ] datetime('now') converted to NOW()
- [ ] Error handling uses try/catch
- [ ] Route tested and working

---

## Common Issues & Solutions

### Issue 1: INSERT without RETURNING

**Problem**: `db.run()` returns lastID, but PostgreSQL needs RETURNING clause.

**Solution**: Add `RETURNING id` to INSERT statement:
```sql
INSERT INTO table (name) VALUES (?) RETURNING id
```

---

### Issue 2: this.lastID not available

**Problem**: SQLite callback uses `this.lastID`, but PostgreSQL uses `result.lastID`.

**Solution**: Use `result.lastID` from await:
```javascript
const result = await db.run('INSERT...');
const id = result.lastID;
```

---

### Issue 3: Nested callbacks

**Problem**: Nested callbacks are hard to convert.

**Solution**: Use sequential await:
```javascript
const customer = await db.get(...);
const orders = await db.all(...);
```

---

### Issue 4: Error handling

**Problem**: Multiple error handlers in nested callbacks.

**Solution**: Single try/catch block:
```javascript
try {
  // all queries here
} catch (err) {
  // handle error
}
```

---

## Testing Strategy

### After Converting Each File:

1. **Start server**:
   ```bash
   npm run server
   ```

2. **Test each endpoint**:
   - Use browser or Postman
   - Test GET requests
   - Test POST requests
   - Test error cases

3. **Check logs**:
   - Look for SQL errors
   - Check for connection errors
   - Verify queries execute

4. **Verify data**:
   - Check Supabase database
   - Verify data is correct
   - Check relationships

---

## File-by-File Conversion Guide

### File 1: cashManagement.js

**Key Changes**:
- Multiple date calculations (strftime conversions)
- Complex nested queries
- Multiple db.all() and db.get() calls

**Special Notes**:
- CalculateBookSales function uses date functions
- Daily cash summary queries need date conversions
- Reconciliation queries need updates

---

### File 2: reports.js

**Key Changes**:
- Sales report queries (date ranges)
- Service performance queries
- Customer statistics queries
- strftime() conversions needed

---

### File 3: orders.js

**Key Changes**:
- Order creation (INSERT with RETURNING)
- Order updates (UPDATE)
- Order queries (SELECT)
- Receipt number generation
- Payment transactions

---

## Next Steps

Once all files are converted:

1. **Test all endpoints**
2. **Fix any SQL errors**
3. **Verify data integrity**
4. **Performance testing**
5. **Move to Phase 5: Testing**

---

**Ready to start converting?** Begin with cashManagement.js or orders.js (most critical).
