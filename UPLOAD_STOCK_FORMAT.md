# Upload Stock Excel – Format

Use **Orders → Upload Stock Excel** to import existing (uncollected) stock. All uploaded rows are created as **uncollected** orders (status: **Ready for collection**).

## Required columns (header row in first row)

| Column   | Description                    | Example    |
|----------|--------------------------------|------------|
| **id**   | Receipt/reference ID (unique)  | `SC-001` or `3-30-01` |
| **name** | Customer full name             | `John Mwita` |
| **phone**| Customer phone number          | `0784752752` |
| **amount** | Total order amount (number)  | `22000`     |
| **paid** | Paid or not paid               | `paid` / `not paid` or `yes` / `no` |

## Accepted column names (any casing)

- **id:** `id`, `Id`, `ID`, `Receipt ID`, `Receipt`, `Receipt Number`, `receipt_id`, **`CUST ID`**, `Customer ID`
- **name:** `name`, `Name`, `NAME`, `Customer Name`, `Customer name`, `Customer`, `Full Name`
- **phone:** `phone`, `Phone`, `PHONE`, `Phone Number`, `Mobile`, **`PHONE NO.`**, `Phone No.`
- **amount:** `amount`, `Amount`, `Total Amount`, `Total`, **`AMOUNT (TZS)`** (thousands separators like `12,000` are OK)
- **paid / status:** `paid`, `Paid`, `payment_status`, `Payment Status`, `Payment`, **`STATUS`**  
  Values: **paid** → `paid`, `yes`, `y`, `1`, `true`, `full`  
  **not paid** → `not paid`, `no`, `n`, `0`, `false` or leave empty

### Ledger-style sheet (your format)

If the first row looks like **CUST ID | NAME | PHONE NO. | AMOUNT (TZS) | STATUS**, that matches the importer (same data as above, different header labels). Rows were skipped in older versions because only names like `id` and `amount` were recognized—not `CUST ID` or `AMOUNT (TZS)`.

## Optional columns

- **paid_amount** – exact amount already paid (number). If present, overrides **paid**.
- **Unpaid Balance** or **balance** – unpaid amount; paid = amount − balance.
- **Service** / **Service Name** – match to an existing service; otherwise default service is used.
- **Quantity** / **Qty** – item quantity (default 1).

### Order date (from CUST ID / receipt — no extra column)

You **do not** need a separate date column. The system sets **`order_date`** from the **id / CUST ID / receipt number**, using the same idea as printed receipts:

- **With year:** `{sequence}-{DD}-{MM} ({YY})` — e.g. `15-15-03 (26)` → 15 March 2026  
- **Without year:** `{sequence}-{DD}-{MM}` — e.g. `9-7-12` → day **7**, month **12** (7 December), year inferred so reports stay sensible  

If the ID cannot be parsed, `order_date` falls back to **yesterday** (so today’s cash is not inflated).

### Paid vs not paid (no “payment date” row)

- **Not paid** — customer pays when they **collect** (normal collection flow).
- **Paid** — means they **already paid when the receipt was printed** (historical). The line is still **Ready** (stock in shop) until **collected**. We only store `paid_amount` / `payment_status` on the order; we **do not** create payment **transactions** for the upload, and we **do not** ask for a separate payment date column.

## Example (Excel / CSV)

| id      | name       | phone      | amount | paid     |
|---------|------------|------------|--------|----------|
| SC-001  | John Mwita | 0784752752 | 22000  | not paid |
| SC-002  | Jane Doe   | 0712345678 | 15000  | paid     |

## Rules

1. **First row** must be the header (column names).
2. **id** must be unique; duplicates are skipped.
3. **name** is required. If the customer does not exist, they are created when **phone** is provided.
4. **amount** must be a number (total order value).
5. **paid** / **not paid** sets whether the order is fully paid; if **paid**, `paid_amount` = `amount` (payment was on the **receipt day** encoded in the id — not recorded as new cash on upload day).
6. All imported orders are created with status **Ready** (uncollected). They appear in **Collection** and **Ready** tab until collected.
7. Select a **branch** in the sidebar before uploading; stock is assigned to that branch.

## File type

- `.xlsx` or `.xls` (Excel), or `.csv`
