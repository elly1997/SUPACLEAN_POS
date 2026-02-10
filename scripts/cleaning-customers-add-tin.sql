-- Add TIN to cleaning_customers (for invoices/quotations). Run in PostgreSQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cleaning_customers' AND column_name = 'tin') THEN
    ALTER TABLE cleaning_customers ADD COLUMN tin TEXT;
  END IF;
END $$;
