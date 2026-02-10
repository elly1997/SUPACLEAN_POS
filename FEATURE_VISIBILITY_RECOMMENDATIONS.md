# Feature Visibility Recommendations by Branch Type

## 🏪 Collection Units (8 branches) - Limited Access

### ✅ **SHOW - Core Features:**
- **Dashboard** - View their branch's daily stats only
- **New Order** - Create orders when customers drop off laundry
- **Collection** - Hand out ready orders (search by receipt)
- **Customers** - View and manage customers
- **Price List** - View services and prices (read-only)
- **Cash Management** - Record transactions for their branch only
- **Reports** - Branch-specific reports only:
  - Today's orders
  - Today's collections
  - Branch revenue
  - Top customers (their branch only)

### ❌ **HIDE - Workshop-Only Features:**
- **Orders Management** - Cannot change order status (can only view)
- **Expenses** - Collection units don't incur cleaning expenses
- **Bank Deposits** - Handled centrally by admin
- **Service Management** - Cannot modify prices (admin/managers only)
- Advanced processing reports
- Inventory/Stock management

### 🎯 **Special Behavior:**
- Orders created at collection units are marked as "pending" and transferred to workshop
- Cannot mark orders as "processing" or "ready"
- Can only collect orders that are marked "ready" (prepared at workshop)

---

## 🏭 Workshops (2 branches) - Full Access

### ✅ **SHOW - All Features:**
- **Dashboard** - Full branch dashboard with processing metrics
- **New Order** - Create orders
- **Orders Management** - Full order lifecycle management:
  - View all orders
  - Change status: Pending → Processing → Ready
  - Transfer orders to collection units
  - Processing queue
- **Collection** - Hand out ready orders
- **Customers** - Full customer management
- **Price List** - View and edit services (if manager role)
- **Cash Management** - Record all transactions
- **Expenses** - Track cleaning supplies, utilities, etc.
- **Bank Deposits** - Record bank deposits for their branch
- **Reports** - Full reporting suite:
  - Processing analytics
  - Workshop efficiency metrics
  - Branch comparison (if manager)
  - All standard reports

---

## 👑 Admin Dashboard - Master View

### ✅ **SHOW - Everything + Admin Features:**
- **All branch features** PLUS:
- **Branch Management**
  - View all 10 branches
  - Branch profile pages
  - Configure feature flags per branch
  - Branch statistics overview
- **User Management**
  - Create/edit users
  - Assign branches
  - Set roles and permissions
- **Consolidated Reports**
  - Company-wide sales
  - Multi-branch comparisons
  - Cross-branch analytics
  - Transfer reports
- **Order Transfer Management**
  - View all transfers
  - Manual transfer interface
  - Transfer history
- **System Settings**
  - Global pricing
  - Feature flag management
  - System configuration

---

## 🔄 Workflow Differences

### Collection Unit Workflow:
1. Customer arrives → **New Order** → Create order → Receipt printed
2. Order status: **Pending** (automatically transferred to workshop)
3. Later: Customer returns → **Collection** → Search receipt → Mark as collected (if ready)

### Workshop Workflow:
1. Receive transfer from collection unit → Order appears in **Orders** page
2. **Orders** → Change status to "Processing"
3. After cleaning → **Orders** → Change status to "Ready"
4. Option: Transfer to collection unit OR keep for collection
5. **Collection** → Hand out to customer when they arrive

### Admin Workflow:
1. **Branch Dashboard** → View all branches at a glance
2. **Branch Profile** → Click on any branch → View their data
3. **Reports** → Switch between branch view and consolidated view
4. **User Management** → Assign users to branches
5. **Settings** → Configure which features each branch can access

---

## 📊 Recommended UI Changes

### For Collection Units:
- Dashboard shows: "Orders Today", "Collections Today", "Revenue Today"
- Orders page: **Read-only** mode (cannot change status)
- Hide "Orders Management" navigation item OR show it disabled
- Hide "Expenses" navigation item completely
- Reports page: Only show branch-specific tabs

### For Workshops:
- Dashboard shows: "Orders Processing", "Ready Today", "Pending Transfers"
- Orders page: Full functionality with status buttons
- Show "Expenses" navigation item
- Reports page: All tabs including workshop analytics

### For Admin:
- Additional navigation: "Branches", "Users", "System Settings"
- Branch selector in header (switch between branch views)
- Consolidated view toggle in reports
- Branch badge/indicator showing current view

---

## 🔐 Recommended Roles

1. **Admin** - Full access to all branches, all features
2. **Branch Manager** - Full access to their branch, limited admin features
3. **Cashier** - Order creation and collection only (Collection Units)
4. **Processor** - Order processing and status changes (Workshops)
5. **Viewer** - Read-only access for reports only

---

## 🎯 Implementation Priority

### Phase 1: Foundation
- Database schema for branches and users
- Basic authentication
- Branch assignment for existing data

### Phase 2: Feature Flags
- Conditional UI rendering
- Branch-specific feature sets
- Route protection

### Phase 3: Data Isolation
- Filter all queries by branch_id
- Branch-specific dashboards
- Data security (can't access other branches' data)

### Phase 4: Admin Dashboard
- Branch overview page
- Branch management interface
- Consolidated reports

### Phase 5: Order Transfer
- Transfer workflow
- Processing queue
- Transfer notifications

---

**Next Steps:** Should we start with Phase 1 (database schema and authentication)?
