-- Add branch_id to daily_cash_summaries table
-- This script should be run AFTER importing the main schema to Supabase

-- Step 1: Add branch_id column
ALTER TABLE daily_cash_summaries 
ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);

-- Step 2: Update date column type (if it's TEXT, change to DATE)
-- Note: If you have existing data, this might need data migration
-- For new setup, the schema should already have DATE type

-- Step 3: Drop old unique constraint on date (if exists)
ALTER TABLE daily_cash_summaries 
DROP CONSTRAINT IF EXISTS daily_cash_summaries_date_key;

-- Step 4: Add new unique constraint (date + branch_id must be unique)
ALTER TABLE daily_cash_summaries 
ADD CONSTRAINT daily_cash_summaries_date_branch_unique 
UNIQUE (date, branch_id);

-- Step 5: Create index for performance
CREATE INDEX IF NOT EXISTS idx_daily_cash_summaries_branch_date 
ON daily_cash_summaries(branch_id, date);

-- Note: If you have existing data without branch_id, you'll need to:
-- 1. Assign branch_id to existing records
-- 2. Or delete old records and start fresh
-- Example update (uncomment and modify as needed):
-- UPDATE daily_cash_summaries 
-- SET branch_id = (SELECT id FROM branches WHERE code = 'AR01' LIMIT 1)
-- WHERE branch_id IS NULL;
