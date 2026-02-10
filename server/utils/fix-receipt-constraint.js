/**
 * Utility script to check and remove UNIQUE constraint from receipt_number
 * Run this if you're experiencing duplicate receipt number errors
 */

const db = require('../database/db');
const path = require('path');

console.log('🔍 Checking database for UNIQUE constraints on receipt_number...\n');

// Check table schema
db.all("PRAGMA table_info(orders)", [], (err, columns) => {
  if (err) {
    console.error('Error checking table info:', err);
    process.exit(1);
  }
  
  const receiptColumn = columns.find(col => col.name === 'receipt_number');
  if (receiptColumn) {
    console.log('📋 receipt_number column info:');
    console.log('   Type:', receiptColumn.type);
    console.log('   NotNull:', receiptColumn.notnull);
    console.log('   DefaultValue:', receiptColumn.dflt_value);
    console.log('   PrimaryKey:', receiptColumn.pk);
  }
  
  // Check all indexes on orders table
  db.all("SELECT name, sql, unique FROM sqlite_master WHERE type='index' AND tbl_name='orders'", [], (indexErr, indexes) => {
    if (indexErr) {
      console.error('Error checking indexes:', indexErr);
      process.exit(1);
    }
    
    console.log('\n📑 Indexes on orders table:');
    if (indexes.length === 0) {
      console.log('   No indexes found (this is good - no UNIQUE constraint)');
    } else {
      indexes.forEach(idx => {
        console.log(`   - ${idx.name} (unique: ${idx.unique})`);
        if (idx.sql) {
          console.log(`     SQL: ${idx.sql}`);
        }
      });
    }
    
    // Check for unique indexes
    const uniqueIndexes = indexes.filter(idx => idx.unique === 1);
    if (uniqueIndexes.length > 0) {
      console.log('\n⚠️  Found UNIQUE indexes. Attempting to remove...\n');
      
      uniqueIndexes.forEach(idx => {
        db.run(`DROP INDEX IF EXISTS ${idx.name}`, (dropErr) => {
          if (dropErr) {
            console.error(`   ❌ Failed to drop ${idx.name}:`, dropErr.message);
          } else {
            console.log(`   ✅ Dropped index: ${idx.name}`);
          }
        });
      });
      
      // Also try dropping the autoindex
      db.run("DROP INDEX IF EXISTS sqlite_autoindex_orders_1", (dropErr) => {
        if (dropErr) {
          console.log('   Note: sqlite_autoindex_orders_1 may not exist');
        } else {
          console.log('   ✅ Dropped sqlite_autoindex_orders_1');
        }
        
        // Verify removal
        setTimeout(() => {
          db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='orders' AND unique=1", [], (verifyErr, remaining) => {
            if (verifyErr) {
              console.error('Error verifying:', verifyErr);
            } else if (remaining.length === 0) {
              console.log('\n✅ Success! No UNIQUE constraints remain on receipt_number.');
            } else {
              console.log('\n⚠️  Warning: Some UNIQUE indexes still exist:');
              remaining.forEach(idx => console.log(`   - ${idx.name}`));
            }
            
            console.log('\n✅ Database check complete. Restart the server for changes to take effect.');
            process.exit(0);
          });
        }, 500);
      });
    } else {
      console.log('\n✅ No UNIQUE constraints found on receipt_number. Database is correctly configured.');
      process.exit(0);
    }
  });
});
