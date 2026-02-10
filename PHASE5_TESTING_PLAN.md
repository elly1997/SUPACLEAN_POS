# Phase 5: Testing Plan

## Overview
Test all converted routes to ensure they work correctly with PostgreSQL database.

## Testing Strategy

### 1. Database Connection Test ✅ COMPLETE
- [x] Verify PostgreSQL connection works
- [x] Test query helper functions (db.get, db.all, db.run)
- [x] Verify RETURNING id works correctly
- [x] Test SQL compatibility conversions (CURRENT_TIMESTAMP, LOWER(), etc.)
- [x] Verify table structure exists

### 2. Route Testing

#### Authentication Routes (auth.js)
- [ ] POST /api/auth/login - User login
- [ ] POST /api/auth/logout - User logout
- [ ] GET /api/auth/me - Get current user

#### Customer Routes (customers.js)
- [ ] GET /api/customers - List all customers
- [ ] GET /api/customers/:id - Get customer by ID
- [ ] POST /api/customers - Create new customer
- [ ] PUT /api/customers/:id - Update customer
- [ ] GET /api/customers/search - Search customers

#### Transaction Routes (transactions.js)
- [ ] GET /api/transactions - List transactions
- [ ] GET /api/transactions/daily-summary - Daily summary
- [ ] POST /api/transactions - Create transaction

#### Cash Management Routes (cashManagement.js)
- [ ] GET /api/cash/daily/:date - Get daily summary
- [ ] GET /api/cash/today - Get today's summary
- [ ] POST /api/cash/daily - Create/update daily summary
- [ ] POST /api/cash/reconcile/:date - Reconcile daily cash

#### Order Routes (orders.js) - 15 routes
- [ ] GET /api/orders - List orders
- [ ] GET /api/orders/collection-queue - Collection queue
- [ ] GET /api/orders/receipt/:receiptNumber - Get by receipt
- [ ] GET /api/orders/search/customer - Search by customer
- [ ] POST /api/orders - Create order (MOST CRITICAL)
- [ ] PUT /api/orders/:id/status - Update status
- [ ] PUT /api/orders/:id/estimated-collection-date - Update date
- [ ] POST /api/orders/collect/:receiptNumber - Collect order
- [ ] POST /api/orders/:id/receive-payment - Receive payment
- [ ] POST /api/orders/upload-stock-excel - Excel upload
- [ ] GET /api/orders/notifications - Get notifications
- [ ] POST /api/orders/:id/send-notification - Send notification
- [ ] POST /api/orders/:id/send-reminder - Send reminder

### 3. SQL Compatibility Tests ✅ COMPLETE
- [x] Test datetime() → CURRENT_TIMESTAMP conversions
- [x] Test julianday() → EXTRACT(EPOCH FROM ...) conversions
- [x] Test COLLATE NOCASE → LOWER() conversions
- [x] Test is_active = 1 → is_active = TRUE
- [x] Test RETURNING id in INSERT statements

### 4. Error Handling Tests
- [ ] Test error handling in async/await routes
- [ ] Test database connection errors
- [ ] Test invalid query parameters
- [ ] Test missing required fields

## Testing Tools

### Manual Testing
- Use Postman or similar tool
- Test with actual frontend application
- Monitor server logs for errors

### Automated Testing (Optional)
- Create test scripts for critical routes
- Test database operations directly

## Success Criteria

✅ All routes respond without errors
✅ Database operations complete successfully
✅ SQL queries execute correctly in PostgreSQL
✅ Error handling works properly
✅ No SQLite-specific syntax errors

## Next Steps After Testing

1. Fix any issues found during testing
2. Verify data integrity
3. Test with sample data
4. Proceed to Phase 6: Data Migration
