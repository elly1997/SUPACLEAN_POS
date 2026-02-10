# Manual Testing Checklist - Phase 5

## ✅ Testing Guide

### Prerequisites
- ✅ Server running on http://localhost:5000
- ✅ Frontend running on http://localhost:3000
- ✅ PostgreSQL database connected
- ✅ Browser console open (F12 → Console tab)

---

## 🧪 Critical Tests to Perform

### 1. Authentication & Login
**Route: POST /api/auth/login**

- [ ] **Test Admin Login**
  - Username: `admin` (or your admin username)
  - Password: Your admin password
  - Expected: Login successful, redirected to dashboard
  - Check: No errors in browser console
  - Check: No errors in server logs

- [ ] **Test Invalid Credentials**
  - Username: `test`, Password: `wrong`
  - Expected: Error message shown
  - Check: Server returns 401 status

---

### 2. Customer Management
**Route: GET /api/customers**

- [ ] **View Customer List**
  - Navigate to Customers page
  - Expected: Customer list loads without errors
  - Check: No console errors
  - Check: Data displays correctly

- [ ] **Search Customers**
  - Route: GET /api/customers/search?q=...
  - Use search box on Customers page
  - Expected: Search results filter correctly
  - Check: Case-insensitive search works
  - Check: No SQL errors in server logs

- [ ] **Create New Customer**
  - Route: POST /api/customers
  - Fill in customer form (name, phone)
  - Expected: Customer created successfully
  - Check: New customer appears in list
  - Check: No database errors

---

### 3. Order Management (MOST CRITICAL)
**Route: POST /api/orders**

- [ ] **Create New Order**
  - Navigate to "New Order" page
  - Select a customer (or create one)
  - Select a service
  - Enter quantity and other details
  - Click "Create Order"
  - Expected: Order created, receipt generated
  - Check: Order appears in Orders list
  - Check: Receipt number generated correctly
  - Check: No errors in console or server logs
  - ⚠️ **This is the most critical test - watch for any errors!**

- [ ] **View Orders List**
  - Route: GET /api/orders
  - Navigate to Orders page
  - Expected: All orders load correctly
  - Check: Orders filtered by branch (if applicable)
  - Check: Status filters work (pending, ready, collected)

- [ ] **Search Orders by Customer**
  - Route: GET /api/orders/search/customer?q=...
  - Use search functionality
  - Expected: Orders filtered by customer name
  - Check: Case-insensitive search works

- [ ] **Update Order Status**
  - Route: PUT /api/orders/:id/status
  - Change order status (pending → processing → ready → collected)
  - Expected: Status updates successfully
  - Check: Status change reflected in UI
  - Check: No errors

- [ ] **Receive Payment**
  - Route: POST /api/orders/:id/receive-payment
  - Click "Receive Payment" on an order
  - Enter payment amount
  - Expected: Payment recorded successfully
  - Check: Payment status updated
  - Check: Balance calculation correct
  - Check: Transaction recorded in database

---

### 4. Transactions
**Route: GET /api/transactions**

- [ ] **View Transactions**
  - Navigate to Transactions page
  - Expected: Transaction list loads
  - Check: All transactions display correctly
  - Check: Date filtering works

- [ ] **View Daily Summary**
  - Route: GET /api/transactions/daily-summary
  - Expected: Daily totals calculated correctly
  - Check: No calculation errors

---

### 5. Cash Management
**Route: GET /api/cash-management/today**

- [ ] **View Today's Cash Summary**
  - Navigate to Cash Management page
  - Expected: Today's summary loads
  - Check: Totals calculated correctly
  - Check: No errors

- [ ] **Reconcile Daily Cash**
  - Route: POST /api/cash-management/reconcile/:date
  - Expected: Reconciliation completes successfully
  - Check: Summary updated correctly

---

## 🔍 What to Watch For

### Browser Console Errors
- ❌ Red errors in console (F12 → Console)
- ❌ Network errors (404, 500, etc.)
- ❌ CORS errors
- ❌ JavaScript errors

### Server Log Errors
Watch terminal/server logs for:
- ❌ Database connection errors
- ❌ SQL syntax errors
- ❌ PostgreSQL-specific errors
- ❌ Route handler errors
- ❌ Timeout errors

### Common Issues to Report

1. **"Cannot connect to server"**
   - Server not running
   - Port 5000 in use
   - Wrong URL

2. **"Database error" or SQL errors**
   - SQL syntax incompatibility
   - Missing RETURNING clause
   - Parameter binding issues

3. **"ECONNABORTED" or timeout errors**
   - Slow database queries
   - Connection pool issues
   - Missing await statements

4. **Data not displaying**
   - Query returns no results
   - Frontend not handling response
   - Filtering issues

---

## 📝 Testing Results Template

```
Date: ___________
Tester: ___________

### Authentication
- [ ] Login works: PASS / FAIL
- Issues: ________________________

### Customer Management
- [ ] List customers: PASS / FAIL
- [ ] Search customers: PASS / FAIL
- [ ] Create customer: PASS / FAIL
- Issues: ________________________

### Order Management
- [ ] Create order: PASS / FAIL ⚠️ CRITICAL
- [ ] View orders: PASS / FAIL
- [ ] Search orders: PASS / FAIL
- [ ] Update status: PASS / FAIL
- [ ] Receive payment: PASS / FAIL
- Issues: ________________________

### Transactions
- [ ] View transactions: PASS / FAIL
- Issues: ________________________

### Cash Management
- [ ] View summary: PASS / FAIL
- Issues: ________________________

### Overall
- Any blocking issues? YES / NO
- Ready for Phase 6? YES / NO
- Notes: ________________________
```

---

## 🚨 If Errors Occur

1. **Note the exact error message**
2. **Check which route/endpoint failed**
3. **Copy error from browser console**
4. **Copy error from server logs**
5. **Report with:**
   - What you were doing
   - Expected behavior
   - Actual error
   - Screenshot (if helpful)

---

## ✅ Success Criteria

- All critical routes respond correctly
- No SQL syntax errors
- No database connection errors
- Orders can be created successfully
- Payments can be received
- Data displays correctly in UI
- Search and filtering work

If all tests pass → **Proceed to Phase 6: Data Migration**
