/**
 * SQLite-compatible pre-launch migrations: order_item_photos + multi-branch indexes.
 * Run when DATABASE_URL is not set (local SQLite). Run: node scripts/pre-launch-sqlite.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'database');
const dbPath = path.join(dbDir, 'supaclean.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const statements = [
  // Order item photos (thermal POS)
  `CREATE TABLE IF NOT EXISTS order_item_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    branch_id INTEGER,
    file_path TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT DEFAULT 'image/jpeg',
    caption TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_order_item_photos_order ON order_item_photos(order_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_item_photos_branch ON order_item_photos(branch_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_item_photos_created ON order_item_photos(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_order_item_photos_branch_created ON order_item_photos(branch_id, created_at)',
  // Multi-branch indexes (SQLite: no UPPER in index)
  'CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_orders_branch_order_date ON orders(branch_id, order_date)',
  'CREATE INDEX IF NOT EXISTS idx_orders_receipt_number ON orders(receipt_number)',
  'CREATE INDEX IF NOT EXISTS idx_orders_branch_customer ON orders(branch_id, customer_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_branch_date ON transactions(branch_id, transaction_date)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_branch_type ON transactions(branch_id, transaction_type)',
  'CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, date)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_order ON notifications(order_id)'
];

function runSqlite() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log('🚀 Pre-launch SQLite migrations\n');
      const next = (i) => {
        if (i >= statements.length) {
          db.close((closeErr) => {
            if (closeErr) console.warn('Close:', closeErr.message);
            console.log('✅ Multi-branch indexes');
            console.log('\n✅ Pre-launch SQLite migrations done. You can run npm run dev.\n');
            resolve();
          });
          return;
        }
        db.run(statements[i], (runErr) => {
          if (runErr && !/already exists|duplicate|SQLITE_CONSTRAINT/.test(runErr.message)) {
            db.close(() => {});
            reject(runErr);
            return;
          }
          if (i === 4) console.log('✅ Order item photos (thermal POS)');
          next(i + 1);
        });
      };
      next(0);
    });
  });
}

if (require.main === module) {
  runSqlite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
module.exports = { runSqlite };
