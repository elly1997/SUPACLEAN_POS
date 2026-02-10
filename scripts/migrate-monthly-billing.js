/**
 * Migration: Add Monthly Billing System
 * Run: node scripts/migrate-monthly-billing.js
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'server', 'database', 'query'));

async function migrateMonthlyBilling() {
  console.log('🚀 Starting Monthly Billing migration...\n');

  try {
    // 1. Update customers table
    console.log('1. Updating customers table...');
    try {
      await db.run(`
        ALTER TABLE customers 
        ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'per_order' 
        CHECK (billing_type IN ('per_order', 'monthly'))
      `);
      console.log('   ✅ Added billing_type column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  billing_type column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name TEXT');
      console.log('   ✅ Added company_name column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  company_name column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id TEXT');
      console.log('   ✅ Added tax_id column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  tax_id column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address TEXT');
      console.log('   ✅ Added billing_address column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  billing_address column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_contact_name TEXT');
      console.log('   ✅ Added billing_contact_name column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  billing_contact_name column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_contact_phone TEXT');
      console.log('   ✅ Added billing_contact_phone column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  billing_contact_phone column already exists');
    }

    try {
      await db.run('ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_contact_email TEXT');
      console.log('   ✅ Added billing_contact_email column');
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
        throw err;
      }
      console.log('   ℹ️  billing_contact_email column already exists');
    }

    // 2. Create invoices table (must be before delivery_notes due to FK)
    console.log('\n2. Creating invoices table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        invoice_date DATE NOT NULL,
        due_date DATE NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        tax_rate REAL DEFAULT 0.18,
        tax_amount REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        credit_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        balance_due REAL NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
        payment_terms TEXT DEFAULT 'Net 30',
        notes TEXT,
        branch_id INTEGER REFERENCES branches(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        sent_at TIMESTAMP,
        paid_at TIMESTAMP
      )
    `);
    console.log('   ✅ Created invoices table');

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_invoices_customer 
      ON invoices(customer_id)
    `);
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_invoices_status 
      ON invoices(status)
    `);
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_invoices_date 
      ON invoices(invoice_date)
    `);
    console.log('   ✅ Created indexes');

    // 3. Create delivery_notes table
    console.log('\n3. Creating delivery_notes table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS delivery_notes (
        id SERIAL PRIMARY KEY,
        delivery_number TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        delivery_date DATE NOT NULL,
        service_id INTEGER REFERENCES services(id),
        item_name TEXT,
        quantity INTEGER DEFAULT 1,
        weight_kg REAL,
        unit_price REAL NOT NULL,
        total_amount REAL NOT NULL,
        notes TEXT,
        delivered_by TEXT,
        received_by TEXT,
        status TEXT DEFAULT 'delivered' CHECK (status IN ('delivered', 'returned', 'cancelled')),
        order_id INTEGER REFERENCES orders(id),
        invoice_id INTEGER REFERENCES invoices(id),
        branch_id INTEGER REFERENCES branches(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      )
    `);
    console.log('   ✅ Created delivery_notes table');

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer_date 
      ON delivery_notes(customer_id, delivery_date)
    `);
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_order 
      ON delivery_notes(order_id)
    `);
    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice 
      ON delivery_notes(invoice_id)
    `);
    console.log('   ✅ Created indexes');

    // 4. Create invoice_items table
    console.log('\n4. Creating invoice_items table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        delivery_note_id INTEGER REFERENCES delivery_notes(id),
        line_number INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        unit_price REAL NOT NULL,
        total_amount REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ Created invoice_items table');

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice 
      ON invoice_items(invoice_id)
    `);
    console.log('   ✅ Created index');

    // 5. Create invoice_payments table
    console.log('\n5. Creating invoice_payments table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        payment_date DATE NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'mobile_money', 'other')),
        reference_number TEXT,
        notes TEXT,
        branch_id INTEGER REFERENCES branches(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      )
    `);
    console.log('   ✅ Created invoice_payments table');

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice 
      ON invoice_payments(invoice_id)
    `);
    console.log('   ✅ Created index');

    console.log('\n' + '='.repeat(50));
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(50));
    console.log('\nNext steps:');
    console.log('1. Restart the server');
    console.log('2. Access Monthly Billing from navigation menu');
    console.log('3. Mark customers as monthly-billing or credit');
    console.log('4. Delivery notes will auto-create from orders\n');

  } catch (err) {
    console.error('❌ Migration error:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    await db.pool.end();
    process.exit(0);
  }
}

migrateMonthlyBilling();
