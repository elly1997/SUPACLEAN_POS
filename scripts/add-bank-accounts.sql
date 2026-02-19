-- Run this in Supabase SQL Editor (or your PostgreSQL client) to add Banking support.
-- Creates bank_accounts table and adds bank_account_id (and branch_id if missing) to bank_deposits.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  account_number TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_bank_account_id ON bank_deposits(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_branch_id ON bank_deposits(branch_id);
