# Current Branch Structure Documentation

## Documentation Date: 2026-01-13

---

## Business Structure

### Total Locations: 9
- **Workshops**: 2 (can wash + collect)
- **Collection Units**: 7 (reception only - collect → send to workshop → receive back → return to customer)

### Supply Chain
- **Supply Car**: 1 (transports laundry between collection units and workshops)

---

## Branch Database Structure

Based on the codebase, branches table includes:
- `id` (SERIAL PRIMARY KEY)
- `name` (TEXT/VARCHAR) - Branch name
- `code` (TEXT/VARCHAR UNIQUE) - Branch code (e.g., 'AR01')
- `branch_type` (TEXT/VARCHAR) - Type: 'workshop', 'collection_unit', or 'both'
- `address` (TEXT/VARCHAR)
- `phone` (TEXT/VARCHAR)
- `manager_name` (TEXT/VARCHAR)
- `is_active` (INTEGER/BOOLEAN) - Default: 1/true
- `created_at` (DATETIME/TIMESTAMP)
- `updated_at` (DATETIME/TIMESTAMP)

---

## Default Branch

The system creates a default branch on initialization:
- **Name**: "Main Branch"
- **Code**: "AR01"
- **Type**: "workshop"
- **Address**: "Arusha, Tanzania"
- **Status**: Active

---

## Current Branch Setup (To Be Updated)

**Note**: Please update this section with your actual 9 branches:

### Workshops (2)
1. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

2. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

### Collection Units (7)
1. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

2. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

3. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

4. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

5. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

6. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

7. **Name**: _______________
   - **Code**: _______________
   - **Location**: _______________
   - **Manager**: _______________

---

## Migration Notes

- All 9 locations need to be configured in the cloud system
- Branch isolation is already implemented (users see only their branch)
- Admin can view all branches
- Daily reconciliation needs branch_id support (to be added)
