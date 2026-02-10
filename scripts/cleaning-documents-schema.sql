-- Cleaning Services: Quotations and Invoices (standalone, not in financial reports)
-- Run this in your PostgreSQL database (e.g. Supabase SQL editor) to add the tables.

-- Parent: one document = one quotation or one invoice
CREATE TABLE IF NOT EXISTS cleaning_documents (
    id SERIAL PRIMARY KEY,
    document_type TEXT NOT NULL CHECK (document_type IN ('quotation', 'invoice')),
    document_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL,
    document_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT,
    branch_id INTEGER,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- Line items: service type, description, amount (all manual entry)
CREATE TABLE IF NOT EXISTS cleaning_document_items (
    id SERIAL PRIMARY KEY,
    cleaning_document_id INTEGER NOT NULL,
    line_number INTEGER NOT NULL DEFAULT 1,
    service_type TEXT,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (cleaning_document_id) REFERENCES cleaning_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cleaning_documents_customer ON cleaning_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_documents_date ON cleaning_documents(document_date DESC);
CREATE INDEX IF NOT EXISTS idx_cleaning_documents_type ON cleaning_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_cleaning_document_items_doc ON cleaning_document_items(cleaning_document_id);
