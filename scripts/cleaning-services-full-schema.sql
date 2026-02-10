-- Cleaning Services: independent customers, payments, expenses (separate from laundry)
-- Run after cleaning-documents-schema.sql. Safe to run if some objects already exist.

-- 1) Cleaning customers (independent from laundry customers)
CREATE TABLE IF NOT EXISTS cleaning_customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    tin TEXT,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);
CREATE INDEX IF NOT EXISTS idx_cleaning_customers_branch ON cleaning_customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_customers_phone ON cleaning_customers(phone);

-- 2) Payments received for cleaning invoices (cleaning cash flow)
CREATE TABLE IF NOT EXISTS cleaning_payments (
    id SERIAL PRIMARY KEY,
    cleaning_document_id INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    reference_number TEXT,
    notes TEXT,
    branch_id INTEGER,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cleaning_document_id) REFERENCES cleaning_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);
CREATE INDEX IF NOT EXISTS idx_cleaning_payments_doc ON cleaning_payments(cleaning_document_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_payments_date ON cleaning_payments(payment_date);

-- 3) Cleaning expenses (rugs, soap, equipment, tools)
CREATE TABLE IF NOT EXISTS cleaning_expenses (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    branch_id INTEGER,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);
CREATE INDEX IF NOT EXISTS idx_cleaning_expenses_date ON cleaning_expenses(date);
CREATE INDEX IF NOT EXISTS idx_cleaning_expenses_branch ON cleaning_expenses(branch_id);

-- 4) Add payment tracking and cleaning_customer_id to cleaning_documents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cleaning_documents' AND column_name = 'paid_amount') THEN
    ALTER TABLE cleaning_documents ADD COLUMN paid_amount DECIMAL(10,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cleaning_documents' AND column_name = 'balance_due') THEN
    ALTER TABLE cleaning_documents ADD COLUMN balance_due DECIMAL(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cleaning_documents' AND column_name = 'cleaning_customer_id') THEN
    ALTER TABLE cleaning_documents ADD COLUMN cleaning_customer_id INTEGER REFERENCES cleaning_customers(id);
  END IF;
END $$;

-- 5) Migrate existing cleaning_documents from customer_id to cleaning_customers
-- (Only if customer_id column still exists and we have rows to migrate)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cleaning_documents' AND column_name = 'customer_id') THEN
    -- Create cleaning_customers from distinct (customer_id, branch_id) in cleaning_documents
    INSERT INTO cleaning_customers (name, phone, email, address, branch_id)
    SELECT DISTINCT c.name, c.phone, c.email, c.address, cd.branch_id
    FROM customers c
    INNER JOIN cleaning_documents cd ON cd.customer_id = c.id
    WHERE NOT EXISTS (
      SELECT 1 FROM cleaning_customers cc
      WHERE cc.phone = c.phone AND (cc.branch_id = cd.branch_id OR (cc.branch_id IS NULL AND cd.branch_id IS NULL))
    );
    -- Link documents to cleaning_customers by matching (customer_id -> customers, then same name/phone/branch -> cleaning_customers)
    UPDATE cleaning_documents cd
    SET cleaning_customer_id = cc.id
    FROM customers c, cleaning_customers cc
    WHERE cd.customer_id = c.id
      AND cd.cleaning_customer_id IS NULL
      AND cc.phone = c.phone
      AND (cc.branch_id = cd.branch_id OR (cc.branch_id IS NULL AND cd.branch_id IS NULL));
    -- Drop old FK and column (optional - comment out if you want to keep customer_id for a while)
    ALTER TABLE cleaning_documents DROP CONSTRAINT IF EXISTS cleaning_documents_customer_id_fkey;
    ALTER TABLE cleaning_documents DROP COLUMN IF EXISTS customer_id;
  END IF;
END $$;

-- Ensure balance_due is set where needed
UPDATE cleaning_documents
SET balance_due = total_amount - COALESCE(paid_amount, 0)
WHERE balance_due IS NULL AND total_amount IS NOT NULL;

-- 6) Add unique constraint for branch+feature (branch_features already has UNIQUE(branch_id, feature_key))
-- No change needed. Admin will add 'cleaning_services' feature per branch via UI.
