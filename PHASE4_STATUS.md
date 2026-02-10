# Phase 4: Route Conversion Status

## Overview
Converting all route files from SQLite (callbacks) to PostgreSQL (async/await).

## Strategy
1. ✅ Update query.js (independent PostgreSQL connection)
2. 🔄 Convert route files systematically
3. ✅ Test after each conversion

---

## Conversion Status

### High Priority (Core Functionality)
- [ ] **auth.js** - Authentication (login, sessions)
- [ ] **orders.js** - Order management
- [ ] **customers.js** - Customer management
- [ ] **cashManagement.js** - Daily reconciliation
- [ ] **transactions.js** - Payment transactions

### Medium Priority
- [ ] **reports.js** - Reports and analytics
- [ ] **expenses.js** - Expense tracking
- [ ] **branches.js** - Branch management
- [ ] **services.js** - Service management

### Lower Priority
- [ ] **settings.js** - Settings
- [ ] **bankDeposits.js** - Bank deposits
- [ ] **validation.js** - Validation utilities
- [ ] **loyalty.js** - Loyalty program

---

## Conversion Pattern

For each file:
1. Change: `const db = require('../database/init')` → `const db = require('../database/query')`
2. Convert route handlers: `(req, res) => {}` → `async (req, res) => {}`
3. Convert callbacks: `db.all(query, params, (err, rows) => {})` → `const rows = await db.all(query, params)`
4. Update error handling: wrap in `try/catch`
5. For INSERT: add `RETURNING id` to get lastID

---

## Notes

- Most SQL queries work as-is (query.js handles ? → $1 conversion)
- Error handling: use try/catch instead of err callback
- INSERT statements need `RETURNING id` for PostgreSQL
- Date functions may need adjustment (DATE() → DATE_TRUNC())

---

**Status**: Ready to begin conversions
**Next**: Start with high-priority routes
