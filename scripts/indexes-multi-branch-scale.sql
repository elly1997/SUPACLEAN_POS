-- Indexes for multi-branch scale and differentiated data
-- Run against PostgreSQL. Helps orders, customers, transactions, and reports.

-- Orders: branch + status, branch + date, branch + receipt lookup
CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_branch_order_date ON orders(branch_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_receipt_upper ON orders(UPPER(receipt_number));
CREATE INDEX IF NOT EXISTS idx_orders_branch_customer ON orders(branch_id, customer_id);

-- Transactions: branch + date for book sales / daily reports
CREATE INDEX IF NOT EXISTS idx_transactions_branch_date ON transactions(branch_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_branch_type ON transactions(branch_id, transaction_type);

-- Customers: optional compound for search (if you add branch-scoped customer later)
CREATE INDEX IF NOT EXISTS idx_customers_phone_lower ON customers(LOWER(phone));
CREATE INDEX IF NOT EXISTS idx_customers_name_lower ON customers(LOWER(name));

-- Daily cash summaries already has (branch_id, date)
-- Expenses: branch + date
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, date);

-- Notifications: order lookup
CREATE INDEX IF NOT EXISTS idx_notifications_order ON notifications(order_id);
