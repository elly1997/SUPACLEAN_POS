# Duplicate Receipt Number Fix

## Problem
The system was experiencing "Duplicate receipt number detected" errors when creating orders, especially for multi-item orders.

## Root Causes Identified

1. **Non-Atomic Receipt Generation**: The original `generateReceiptNumber` function used a MAX query that was not atomic, allowing race conditions when multiple orders were created simultaneously.

2. **UNIQUE Constraint**: SQLite may have created an implicit unique index on `receipt_number` that wasn't being properly removed.

## Solutions Implemented

### 1. Atomic Receipt Generation
- Updated `server/utils/receipt.js` to use `BEGIN IMMEDIATE TRANSACTION` for atomic receipt number generation
- This ensures that only one request can generate a receipt number at a time, preventing duplicates
- Added fallback mechanism with retry logic if transaction fails

### 2. Enhanced Database Migration
- Improved `server/database/init.js` to properly detect and remove all unique indexes on `receipt_number`
- Added comprehensive index checking and removal logic
- Added verification step to ensure constraints are removed

### 3. Better Error Handling
- Enhanced error logging in `server/routes/orders.js` to help diagnose issues
- Increased retry limit from 5 to 10 attempts
- More detailed error messages for debugging

### 4. Database Fix Utility
- Created `server/utils/fix-receipt-constraint.js` to manually check and fix database constraints
- Run with: `npm run fix-receipt-constraint`

## How to Fix Existing Database

If you're still experiencing duplicate receipt number errors:

1. **Stop the server** (if running)

2. **Run the fix utility**:
   ```bash
   npm run fix-receipt-constraint
   ```

3. **Restart the server**:
   ```bash
   npm run dev
   ```

## Verification

After applying fixes, the system should:
- ✅ Generate unique receipt numbers even under concurrent load
- ✅ Allow multiple items to share the same receipt number (for multi-item orders)
- ✅ Automatically retry with new receipt numbers if duplicates are detected
- ✅ Log detailed error information for debugging

## Technical Details

### Atomic Receipt Generation Flow:
1. Begin IMMEDIATE transaction (locks the database)
2. Query MAX sequence number
3. Calculate next sequence
4. Commit transaction (releases lock)
5. Return receipt number

This ensures that concurrent requests are serialized and cannot generate duplicate numbers.

### Error Handling:
- If a duplicate is detected during insertion, the system:
  1. Logs the error with full details
  2. Generates a new receipt number
  3. Retries the insertion (up to 10 times)
  4. Returns a user-friendly error if all retries fail

## Testing

To test the fix:
1. Create a multi-item order (add multiple services)
2. Create multiple orders rapidly (simulate concurrent requests)
3. Check server logs for any duplicate errors
4. Verify all orders have unique receipt numbers

## Notes

- The UNIQUE constraint was intentionally removed to allow multiple items per receipt
- Receipt numbers follow format: `HQ {sequence}-{day}-{month} ({year})`
- Example: `HQ 1-9-1 (26)` for the first order on January 9, 2026
