# Receipt Number Format Update

## New Format

The receipt number format has been updated to match the required specification:

**Format:** `{sequence}-{DD}-{MM} ({YY})`

**Example:** `1-01-01 (26)`

### Format Breakdown:
- **First digit(s)**: Sequence number (first customer of the day = 1, second = 2, etc.)
- **Second digits**: Day of month (zero-padded: 01, 02, 03, ..., 31)
- **Third digits**: Month (zero-padded: 01 = January, 02 = February, ..., 12 = December)
- **In brackets**: Year (last 2 digits: 26 = 2026)

### Examples:
- `1-01-01 (26)` - First customer on January 1, 2026
- `2-01-01 (26)` - Second customer on January 1, 2026
- `1-09-01 (26)` - First customer on January 9, 2026
- `1-01-02 (26)` - First customer on February 1, 2026
- `15-15-03 (26)` - 15th customer on March 15, 2026

## Changes Made

### 1. Removed "HQ" Prefix
- **Before:** `HQ 1-1-2 (26)`
- **After:** `1-01-02 (26)`

### 2. Zero-Padded Day and Month
- **Before:** Day and month were single digits (1, 2, 3, etc.)
- **After:** Day and month are zero-padded (01, 02, 03, etc.)

### 3. Updated SQL Queries
- Updated receipt number parsing to extract sequence from the beginning of the string
- Changed from `SUBSTR(receipt_number, 4, ...)` to `SUBSTR(receipt_number, 1, ...)`
- Updated pattern matching to work with new format

### 4. Files Modified
- `server/utils/receipt.js` - Main receipt generation logic
- `server/routes/orders.js` - Updated comments

## How It Works

1. **Atomic Generation**: Uses `BEGIN IMMEDIATE TRANSACTION` to ensure only one receipt number is generated at a time
2. **Sequence Tracking**: Queries the database for the maximum sequence number for the current day
3. **Increments**: Adds 1 to the max sequence to get the next number
4. **Format**: Combines sequence, zero-padded day, zero-padded month, and year

## Testing

After restarting the server, test by:
1. Creating a new order - should get format like `1-09-01 (26)`
2. Creating another order on the same day - should get `2-09-01 (26)`
3. Creating an order on a different day - should reset sequence to `1-{newDay}-{month} ({year})`

## Notes

- Each customer gets a unique receipt number for the day
- Multiple items in the same order share the same receipt number
- Sequence resets to 1 each new day
- Format is consistent and human-readable
