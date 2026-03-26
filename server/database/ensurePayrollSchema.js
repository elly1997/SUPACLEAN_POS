/**
 * Ensures payroll tables exist on PostgreSQL.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');

async function ensure() {
  try {
    await db.run(
      `CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        employee_code TEXT UNIQUE,
        phone TEXT,
        branch_id INTEGER REFERENCES branches(id),
        gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
        default_allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
        default_bonuses NUMERIC(14,2) NOT NULL DEFAULT 0,
        default_other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
        nssf_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        paye_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    );

    await db.run(
      `CREATE TABLE IF NOT EXISTS salary_advances (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        advance_date DATE NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        notes TEXT,
        branch_id INTEGER REFERENCES branches(id),
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    );

    await db.run(
      `CREATE TABLE IF NOT EXISTS payroll_monthly (
        id SERIAL PRIMARY KEY,
        month_key TEXT NOT NULL,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
        allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
        bonuses NUMERIC(14,2) NOT NULL DEFAULT 0,
        nssf_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        paye_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
        salary_advances NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
        branch_id INTEGER REFERENCES branches(id),
        computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        computed_by TEXT,
        UNIQUE(month_key, employee_id)
      )`,
      []
    );

    // Phase 1 accounting controls for expenses
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE', []);
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT', []);
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by TEXT', []);
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP', []);
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by TEXT', []);
    await db.run('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS update_reason TEXT', []);

    await db.run(
      `CREATE TABLE IF NOT EXISTS expense_audit_log (
        id SERIAL PRIMARY KEY,
        expense_id INTEGER,
        action TEXT NOT NULL,
        old_data JSONB,
        new_data JSONB,
        reason TEXT,
        changed_by TEXT,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    );

    await db.run('CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_date ON salary_advances(employee_id, advance_date)', []);
    await db.run('CREATE INDEX IF NOT EXISTS idx_payroll_monthly_month_employee ON payroll_monthly(month_key, employee_id)', []);
    await db.run('CREATE INDEX IF NOT EXISTS idx_expenses_voided ON expenses(is_voided)', []);
    console.log('✅ Payroll and accounting schema ready');
  } catch (err) {
    console.error('❌ Payroll schema migration error:', err.message);
  }
}

ensure();
