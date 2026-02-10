-- SQLite Schema Export
-- Export Date: 2026-01-12T21:53:55.655Z
-- Database: supaclean.db
-- Note: This schema needs to be converted to PostgreSQL

CREATE TABLE bank_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_number TEXT,
    bank_name TEXT,
    notes TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , branch_id INTEGER);

CREATE TABLE branch_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    UNIQUE(branch_id, feature_key)
  );

CREATE TABLE branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    branch_type TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    manager_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , sms_notifications_enabled INTEGER DEFAULT 1, tags TEXT, primary_branch_id INTEGER);

CREATE TABLE daily_cash_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    opening_balance REAL DEFAULT 0,
    cash_sales REAL DEFAULT 0,
    card_sales REAL DEFAULT 0,
    mobile_money_sales REAL DEFAULT 0,
    bank_deposits REAL DEFAULT 0,
    bank_payments REAL DEFAULT 0,
    mpesa_received REAL DEFAULT 0,
    mpesa_paid REAL DEFAULT 0,
    expenses_from_cash REAL DEFAULT 0,
    expenses_from_bank REAL DEFAULT 0,
    expenses_from_mpesa REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    is_reconciled INTEGER DEFAULT 0,
    reconciled_by TEXT,
    reconciled_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_source TEXT NOT NULL,
    description TEXT,
    receipt_number TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , branch_id INTEGER);

CREATE TABLE loyalty_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL UNIQUE,
    current_points INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'Bronze',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

CREATE TABLE loyalty_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    points_required INTEGER NOT NULL,
    discount_percentage REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  , service_value REAL DEFAULT 0);

CREATE TABLE loyalty_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    transaction_type TEXT NOT NULL,
    points INTEGER NOT NULL,
    description TEXT,
    balance_after INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    notification_type TEXT NOT NULL,
    channel TEXT DEFAULT 'sms',
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

CREATE TABLE order_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    from_branch_id INTEGER,
    to_branch_id INTEGER NOT NULL,
    transfer_type TEXT NOT NULL,
    transferred_by INTEGER,
    transfer_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (from_branch_id) REFERENCES branches(id),
    FOREIGN KEY (to_branch_id) REFERENCES branches(id),
    FOREIGN KEY (transferred_by) REFERENCES users(id)
  );

CREATE TABLE "orders" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT NOT NULL,
        customer_id INTEGER NOT NULL,
        service_id INTEGER NOT NULL,
        garment_type TEXT,
        color TEXT,
        quantity INTEGER DEFAULT 1,
        weight_kg REAL,
        special_instructions TEXT,
        delivery_type TEXT DEFAULT 'standard',
        express_surcharge_multiplier REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        total_amount REAL NOT NULL,
        paid_amount REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'not_paid',
        payment_method TEXT DEFAULT 'cash',
        created_by TEXT,
        order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        ready_date DATETIME,
        collected_date DATETIME,
        estimated_collection_date DATETIME, created_at_branch_id INTEGER, ready_at_branch_id INTEGER, collected_at_branch_id INTEGER, branch_id INTEGER,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (service_id) REFERENCES services(id)
      );

CREATE TABLE payment_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_payment_status TEXT,
    new_payment_status TEXT,
    old_paid_amount REAL,
    new_paid_amount REAL,
    old_payment_method TEXT,
    new_payment_method TEXT,
    changed_by TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

CREATE TABLE services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    base_price REAL NOT NULL DEFAULT 0,
    price_per_item REAL DEFAULT 0,
    price_per_kg REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE sqlite_sequence(name,seq);

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    transaction_type TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    description TEXT,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT, branch_id INTEGER,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    branch_id INTEGER,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
  );

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    branch_id INTEGER,
    role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
  );

-- Indexes
CREATE INDEX idx_customers_name ON customers(name);

CREATE INDEX idx_customers_phone ON customers(phone);

CREATE INDEX idx_orders_branch_id ON orders(branch_id);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);

CREATE INDEX idx_orders_estimated_collection ON orders(estimated_collection_date);

CREATE INDEX idx_orders_order_date ON orders(order_date);

CREATE INDEX idx_orders_payment_date ON orders(payment_status, payment_method, order_date);

CREATE INDEX idx_orders_payment_status ON orders(payment_status);

CREATE INDEX idx_orders_status ON orders(status);

CREATE INDEX idx_payment_audit_order ON payment_audit_log(order_id, changed_at);

CREATE INDEX idx_transactions_date ON transactions(transaction_date);

CREATE INDEX idx_transactions_order_id ON transactions(order_id);

CREATE INDEX idx_transactions_payment_date ON transactions(transaction_type, payment_method, transaction_date);

CREATE INDEX idx_transactions_type ON transactions(transaction_type);

CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);

