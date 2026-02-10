/**
 * Migration: Bills + Bill Items (replacing delivery notes for Monthly Billing)
 * Run: node scripts/migrate-bills.js
 *
 * Bills: customer + billing date + multiple line items (description, qty, price, amount).
 * Invoices: auto-generated from bills; invoice lines = Bill ID, billing date, amount.
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'server', 'database', 'query'));

async function run() {
  console.log('🚀 Bills migration...\n');

  try {
    // 1. Customers: add TIN, VRN
    console.log('1. Customers: add TIN, VRN...');
    for (const col of ['tin', 'vrn']) {
      try {
        await db.run(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ${col} TEXT`);
        console.log(`   ✅ ${col}`);
      } catch (e) {
        if (!/already exists|duplicate/i.test(e.message)) throw e;
      }
    }

    // 2. Bills table
    console.log('\n2. Creating bills table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS bills (
        id SERIAL PRIMARY KEY,
        bill_number TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        billing_date DATE NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        invoice_id INTEGER REFERENCES invoices(id),
        branch_id INTEGER REFERENCES branches(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT
      )
    `);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_bills_customer_date ON bills(customer_id, billing_date)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_bills_invoice ON bills(invoice_id)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_bills_branch ON bills(branch_id)`);
    console.log('   ✅ bills');

    // 3. Bill items table
    console.log('\n3. Creating bill_items table...');
    await db.run(`
      CREATE TABLE IF NOT EXISTS bill_items (
        id SERIAL PRIMARY KEY,
        bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id)`);
    console.log('   ✅ bill_items');

    // 4. Invoice items: add bill_id, billing_date for bill-based lines
    console.log('\n4. Invoice items: add bill_id, billing_date...');
    try {
      await db.run(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS bill_id INTEGER REFERENCES bills(id)`);
      await db.run(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS billing_date DATE`);
    } catch (e) {
      if (!/already exists|duplicate/i.test(e.message)) throw e;
    }
    console.log('   ✅ invoice_items updated');

    console.log('\n✅ Bills migration done.\n');
  } catch (err) {
    console.error('❌', err.message);
    throw err;
  } finally {
    await db.pool.end();
    process.exit(0);
  }
}

run();
