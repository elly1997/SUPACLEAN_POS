-- Add branch_id to expenses table
-- This ensures expenses are properly linked to branches and can be included in cash management

-- Step 1: Add branch_id column
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);

-- Step 2: Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date_branch ON expenses(date, branch_id);

-- Step 3: Update existing expenses to assign a default branch (if needed)
-- Uncomment and modify if you have existing expenses without branch_id
-- UPDATE expenses
-- SET branch_id = (SELECT id FROM branches WHERE code = 'AR01' LIMIT 1)
-- WHERE branch_id IS NULL;

-- Note: After running this migration, all new expenses will require branch_id
-- The application will automatically assign the user's branch_id when creating expenses
