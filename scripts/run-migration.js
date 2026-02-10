/**
 * Node.js Script to Run Items Migration
 * 
 * This script runs the SQL migration to create items table and populate it.
 * Run: node scripts/run-migration.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env file');
    console.error('   Please set DATABASE_URL in your .env file');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    console.log('🔄 Starting migration...\n');
    console.log('📋 Reading migration script...');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'migrate-items-services.sql');
    if (!fs.existsSync(sqlFile)) {
      console.error(`❌ Migration file not found: ${sqlFile}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('✅ Migration script loaded');
    console.log('🚀 Executing migration...\n');

    // Better SQL statement splitting
    // Remove comments first
    let cleanSql = sql
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
    
    // Split by semicolon, but be smarter about it
    const statements = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < cleanSql.length; i++) {
      const char = cleanSql[i];
      const prev = i > 0 ? cleanSql[i - 1] : '';
      
      // Track quoted strings
      if ((char === "'" || char === '"') && prev !== '\\') {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        }
      }
      
      current += char;
      
      // End of statement (semicolon outside quotes)
      if (char === ';' && !inQuotes) {
        const trimmed = current.trim();
        if (trimmed.length > 5 && 
            !trimmed.toUpperCase().startsWith('COMMENT') &&
            trimmed !== ';') {
          statements.push(trimmed);
        }
        current = '';
      }
    }
    
    // Add any remaining statement
    if (current.trim().length > 5) {
      statements.push(current.trim());
    }

    console.log(`📊 Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Execute statements in order - CRITICAL for dependencies
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        await pool.query(statement);
        successCount++;
        
        // Log what we're doing
        if (statement.match(/CREATE TABLE.*IF NOT EXISTS/i)) {
          const match = statement.match(/CREATE TABLE.*IF NOT EXISTS\s+(\w+)/i);
          if (match && match[1]) {
            console.log(`  ✅ [${i + 1}/${statements.length}] Created table: ${match[1]}`);
          }
        } else if (statement.match(/INSERT INTO/i)) {
          const match = statement.match(/INSERT INTO\s+(\w+)/i);
          if (match && match[1]) {
            const valueMatches = statement.match(/\([^)]+\)/g);
            const rowCount = valueMatches ? valueMatches.length : 1;
            console.log(`  ✅ [${i + 1}/${statements.length}] Inserted ${rowCount} row(s) into: ${match[1]}`);
          }
        } else if (statement.match(/ALTER TABLE/i)) {
          console.log(`  ✅ [${i + 1}/${statements.length}] Altered table structure`);
        } else if (statement.match(/CREATE INDEX/i)) {
          const match = statement.match(/CREATE INDEX.*?(\w+)/i);
          if (match && match[1]) {
            console.log(`  ✅ [${i + 1}/${statements.length}] Created index: ${match[1]}`);
          }
        } else if (statement.match(/DELETE FROM/i)) {
          console.log(`  ✅ [${i + 1}/${statements.length}] Cleaned up old data`);
        } else if (statement.match(/DO\s+\$\$/i)) {
          console.log(`  ✅ [${i + 1}/${statements.length}] Executed conditional block`);
        }
      } catch (err) {
        const errMsg = err.message.toLowerCase();
        // Check if it's an ignorable error
        const isIgnorable = 
          errMsg.includes('already exists') ||
          errMsg.includes('duplicate') ||
          (errMsg.includes('does not exist') && errMsg.includes('constraint')) ||
          errMsg.includes('column') && errMsg.includes('already exists');
        
        if (isIgnorable) {
          console.log(`  ⚠️  [${i + 1}/${statements.length}] Skipped: ${err.message.split('\n')[0].substring(0, 50)}...`);
        } else {
          errorCount++;
          errors.push({
            index: i + 1,
            statement: statement.substring(0, 100) + '...',
            error: err.message.split('\n')[0]
          });
          console.error(`  ❌ [${i + 1}/${statements.length}] Error: ${err.message.split('\n')[0]}`);
          
          // For critical errors (like table doesn't exist), show more info
          if (err.message.includes('does not exist')) {
            console.error(`     This might be a dependency issue - checking...`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`✅ Successful: ${successCount}/${statements.length}`);
    if (errorCount > 0) {
      console.log(`⚠️  Errors: ${errorCount}`);
      console.log('\n💡 Note: Some errors may be non-critical (e.g., already exists)');
    }
    console.log('');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const tablesToCheck = ['items', 'branch_item_prices'];
    
    for (const table of tablesToCheck) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ✅ ${table}: ${result.rows[0].count} rows`);
      } catch (err) {
        console.log(`  ❌ ${table}: ${err.message.split('\n')[0]}`);
      }
    }

    // Check items count
    try {
      const itemsResult = await pool.query('SELECT COUNT(*) as count FROM items');
      const itemsCount = itemsResult.rows[0].count;
      
      if (itemsCount > 0) {
        console.log(`\n✅ Migration completed successfully!`);
        console.log(`   Items table has ${itemsCount} items`);
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Refresh your Price List page (http://localhost:3000/price-list)`);
        console.log(`   2. Items should now be visible!`);
      } else {
        console.log(`\n⚠️  Items table exists but is empty.`);
        console.log(`   You may need to run the INSERT statements manually.`);
      }
    } catch (err) {
      console.log(`\n❌ Migration incomplete:`);
      console.log(`   ${err.message}`);
      console.log(`\n💡 Try running the SQL script directly in Supabase SQL Editor:`);
      console.log(`   1. Open Supabase Dashboard → SQL Editor`);
      console.log(`   2. Copy contents of scripts/migrate-items-services.sql`);
      console.log(`   3. Paste and run`);
    }

    // Show any critical errors
    if (errors.length > 0 && errors.some(e => e.error.includes('does not exist'))) {
      console.log('\n⚠️  Critical Errors Detected:');
      errors.forEach(err => {
        if (err.error.includes('does not exist')) {
          console.log(`   Statement ${err.index}: ${err.error}`);
        }
      });
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    await pool.end();
    process.exit(1);
  }
}

// Run the migration
runMigration();
