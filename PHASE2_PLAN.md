# Phase 2: Feature Flags & Data Isolation

## 🎯 Phase 2 Goals

Since Phase 1 already included authentication, Phase 2 focuses on:
1. **Feature Flag System** - Properly implement feature-based access control
2. **Data Isolation** - Ensure each branch only sees their own data
3. **Admin Dashboard** - Build interface for managing branches and users

---

## 📋 Phase 2 Tasks

### Task 1: Complete Feature Flag System ✅ (Partially Done)
**Status**: Basic structure exists, needs refinement

**What to do:**
- [x] Feature flags table created
- [x] Default features set per branch type
- [ ] **Verify feature flags are applied correctly** in all routes
- [ ] **Add feature check middleware** to protect routes
- [ ] **Update frontend** to properly hide/show features based on flags
- [ ] **Test feature filtering** for collection units vs workshops

**Files to modify:**
- `server/middleware/auth.js` - Add feature check middleware
- `server/routes/*.js` - Add feature checks to protected routes
- `client/src/components/Layout.js` - Already has basic filtering, verify it works

---

### Task 2: Data Isolation (Branch Filtering) 🔴 (Critical)
**Status**: Not implemented yet

**What to do:**
- [ ] **Add branch filtering** to ALL API endpoints:
  - Orders (only show orders from user's branch)
  - Customers (show all, but filter by primary_branch_id in reports)
  - Transactions (only user's branch)
  - Expenses (only user's branch)
  - Reports (filtered by branch)
  - Cash Management (branch-specific)
  - Bank Deposits (branch-specific)
- [ ] **Admin override** - Admin can see all branches' data
- [ ] **Branch context** - Ensure all queries include branch_id filter

**Files to modify:**
- `server/routes/orders.js` - Add branch filtering
- `server/routes/customers.js` - Add branch filtering
- `server/routes/transactions.js` - Add branch filtering
- `server/routes/expenses.js` - Add branch filtering
- `server/routes/reports.js` - Add branch filtering
- `server/routes/cashManagement.js` - Add branch filtering
- `server/routes/bankDeposits.js` - Add branch filtering

**Example pattern:**
```javascript
// In each route handler
router.get('/', authenticate, requireBranchAccess, (req, res) => {
  const branchFilter = req.user.role === 'admin' 
    ? '' // Admin sees all
    : 'WHERE branch_id = ?'; // Others see only their branch
  
  db.all(`SELECT * FROM orders ${branchFilter}`, 
    req.user.role === 'admin' ? [] : [req.user.branchId], 
    (err, rows) => {
      // ...
    }
  );
});
```

---

### Task 3: Admin Dashboard 🟡 (High Priority)
**Status**: Not started

**What to do:**
- [ ] **Create Admin Dashboard Page** (`/admin/branches`)
- [ ] **Branch Overview**:
  - List all branches in a table
  - Show branch status (active/inactive)
  - Quick stats per branch (orders today, revenue)
  - Branch type badges (collection/workshop)
- [ ] **Branch Management**:
  - Create new branch form
  - Edit branch details
  - View branch profile
  - Configure feature flags per branch
- [ ] **User Management**:
  - Create users for branches
  - Assign roles (manager, cashier, processor)
  - View users per branch
  - Activate/deactivate users

**Files to create:**
- `client/src/pages/AdminBranches.js` - Main admin dashboard
- `client/src/pages/AdminBranches.css` - Styling
- `server/routes/users.js` - User management API (if not exists)

**Files to modify:**
- `client/src/App.js` - Add admin routes
- `client/src/api/api.js` - Add admin API functions

---

### Task 4: Create Sample Branches & Users 🟢 (Setup)
**Status**: Not started

**What to do:**
- [ ] **Create 8 Collection Units**:
  - AR02, AR03, AR04, AR05, AR06, AR07, AR08, AR09
  - Set branch_type = 'collection'
  - Set default feature flags (limited features)
- [ ] **Create 1 Additional Workshop**:
  - AR10 (Main Branch is AR01)
  - Set branch_type = 'workshop'
  - Set default feature flags (full features)
- [ ] **Create sample users** for testing:
  - Manager for each branch
  - Cashier for collection units
  - Processor for workshops

**Can be done via:**
- Admin dashboard (once built)
- OR SQL script for initial setup

---

### Task 5: Update Order Creation Logic 🟡
**Status**: Needs update

**What to do:**
- [ ] **Set branch_id** when creating orders
- [ ] **Set created_at_branch_id** to current user's branch
- [ ] **For collection units**: Auto-set status to "pending" and mark for transfer
- [ ] **For workshops**: Allow normal order creation

**Files to modify:**
- `server/routes/orders.js` - POST /orders endpoint

---

### Task 6: Update Frontend Pages 🟡
**Status**: Needs updates

**What to do:**
- [ ] **Dashboard**: Show branch-specific stats only
- [ ] **Orders Page**: 
  - Hide status change buttons for collection units
  - Show transfer options for workshops
- [ ] **Reports**: Filter by branch (unless admin)
- [ ] **All pages**: Ensure they respect branch context

**Files to modify:**
- `client/src/pages/Dashboard.js`
- `client/src/pages/Orders.js`
- `client/src/pages/Reports.js`
- All other pages that show data

---

## 🎯 Priority Order

1. **Data Isolation** (Task 2) - CRITICAL - Prevents data leakage between branches
2. **Feature Flags** (Task 1) - HIGH - Ensures proper access control
3. **Admin Dashboard** (Task 3) - HIGH - Needed to manage branches
4. **Sample Branches** (Task 4) - MEDIUM - For testing
5. **Order Logic** (Task 5) - MEDIUM - Business logic
6. **Frontend Updates** (Task 6) - MEDIUM - UI polish

---

## 📊 Estimated Time

- **Task 1**: 2-3 hours (refinement)
- **Task 2**: 4-6 hours (critical, affects all routes)
- **Task 3**: 6-8 hours (admin dashboard UI)
- **Task 4**: 1 hour (setup script)
- **Task 5**: 1-2 hours (order logic)
- **Task 6**: 3-4 hours (frontend updates)

**Total**: ~17-24 hours of development

---

## ✅ Success Criteria

Phase 2 is complete when:
- [ ] Each branch only sees their own data (data isolation works)
- [ ] Collection units cannot change order status
- [ ] Workshops can change order status
- [ ] Admin can see all branches' data
- [ ] Admin dashboard allows creating/managing branches
- [ ] Feature flags properly hide/show menu items
- [ ] All API endpoints respect branch context

---

## 🚀 Ready to Start?

Would you like me to:
1. **Start with Task 2 (Data Isolation)** - Most critical
2. **Start with Task 3 (Admin Dashboard)** - Most visible
3. **Do both in parallel** - Faster overall

**Recommendation**: Start with **Task 2 (Data Isolation)** as it's the foundation for everything else.
