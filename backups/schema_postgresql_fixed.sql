-- PostgreSQL Schema
-- Converted from SQLite on 2026-01-12T21:53:59.686Z
-- Database: supaclean
-- FIXED: Tables ordered correctly (parent tables before child tables)

-- Enable UUID extension (if needed)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PHASE 1: Core Tables (No Dependencies)
-- ============================================

CREATE TABLE branches (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    branch_type TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    manager_name TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sms_notifications_enabled INTEGER DEFAULT 1,
    tags TEXT,
    primary_branch_id INTEGER
);

CREATE TABLE services (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    price_per_item DECIMAL(10,2) DEFAULT 0,
    price_per_kg DECIMAL(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
    id SERIAL PRIMARY KEY,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PHASE 2: Tables with Branch/Customer/Service Dependencies
-- ============================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    branch_id INTEGER,
    role TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE TABLE bank_deposits (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reference_number TEXT,
    bank_name TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    branch_id INTEGER,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE TABLE branch_features (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    UNIQUE(branch_id, feature_key)
);

CREATE TABLE daily_cash_summaries (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    branch_id INTEGER,
    opening_balance DECIMAL(10,2) DEFAULT 0,
    cash_sales DECIMAL(10,2) DEFAULT 0,
    book_sales DECIMAL(10,2) DEFAULT 0,
    card_sales DECIMAL(10,2) DEFAULT 0,
    mobile_money_sales DECIMAL(10,2) DEFAULT 0,
    bank_deposits DECIMAL(10,2) DEFAULT 0,
    bank_payments DECIMAL(10,2) DEFAULT 0,
    mpesa_received DECIMAL(10,2) DEFAULT 0,
    mpesa_paid DECIMAL(10,2) DEFAULT 0,
    expenses_from_cash DECIMAL(10,2) DEFAULT 0,
    expenses_from_bank DECIMAL(10,2) DEFAULT 0,
    expenses_from_mpesa DECIMAL(10,2) DEFAULT 0,
    cash_in_hand DECIMAL(10,2) DEFAULT 0,
    closing_balance DECIMAL(10,2) DEFAULT 0,
    is_reconciled BOOLEAN DEFAULT FALSE,
    reconciled_by TEXT,
    reconciled_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    UNIQUE(date, branch_id)
);

CREATE TABLE expenses (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_source TEXT NOT NULL,
    description TEXT,
    receipt_number TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    branch_id INTEGER,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE TABLE loyalty_points (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL UNIQUE,
    current_points INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'Bronze',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE loyalty_rewards (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    points_required INTEGER NOT NULL,
    discount_percentage REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    service_value REAL DEFAULT 0
);

-- ============================================
-- PHASE 3: Orders Table (Depends on customers, services)
-- ============================================

CREATE TABLE "orders" (
    id SERIAL PRIMARY KEY,
    receipt_number TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    garment_type TEXT,
    color TEXT,
    quantity INTEGER DEFAULT 1,
    weight_kg DECIMAL(10,2),
    special_instructions TEXT,
    delivery_type TEXT DEFAULT 'standard',
    express_surcharge_multiplier REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    total_amount DECIMAL(10,2) NOT NULL,
    paid_amount DECIMAL(10,2) DEFAULT 0,
    payment_status TEXT DEFAULT 'not_paid',
    payment_method TEXT DEFAULT 'cash',
    created_by TEXT,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ready_date TIMESTAMP,
    collected_date TIMESTAMP,
    estimated_collection_date TIMESTAMP,
    created_at_branch_id INTEGER,
    ready_at_branch_id INTEGER,
    collected_at_branch_id INTEGER,
    branch_id INTEGER,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- ============================================
-- PHASE 4: Tables with Order Dependencies
-- ============================================

CREATE TABLE loyalty_transactions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    transaction_type TEXT NOT NULL,
    points INTEGER NOT NULL,
    description TEXT,
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_id INTEGER,
    notification_type TEXT NOT NULL,
    channel TEXT DEFAULT 'sms',
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE order_transfers (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    from_branch_id INTEGER,
    to_branch_id INTEGER NOT NULL,
    transfer_type TEXT NOT NULL,
    transferred_by INTEGER,
    transfer_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (from_branch_id) REFERENCES branches(id),
    FOREIGN KEY (to_branch_id) REFERENCES branches(id),
    FOREIGN KEY (transferred_by) REFERENCES users(id)
);

CREATE TABLE payment_audit_log (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_payment_status TEXT,
    new_payment_status TEXT,
    old_paid_amount REAL,
    new_paid_amount REAL,
    old_payment_method TEXT,
    new_payment_method TEXT,
    changed_by TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    order_id INTEGER,
    transaction_type TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    description TEXT,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    branch_id INTEGER,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    branch_id INTEGER,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- ============================================
-- INDEXES
-- ============================================

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
CREATE INDEX idx_daily_cash_summaries_branch_date ON daily_cash_summaries(branch_id, date);
