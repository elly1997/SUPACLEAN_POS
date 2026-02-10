/**
 * SQLite to PostgreSQL Schema Converter
 * Converts SQLite schema syntax to PostgreSQL syntax
 */

const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '../backups/schema_export.sql');
const outputPath = path.join(__dirname, '../backups/schema_postgresql.sql');

if (!fs.existsSync(inputPath)) {
  console.error('❌ Input file not found:', inputPath);
  console.error('   Run export-schema.js first');
  process.exit(1);
}

console.log('🔄 Converting SQLite schema to PostgreSQL...');

let sqliteSchema = fs.readFileSync(inputPath, 'utf8');
let postgresSchema = sqliteSchema;

// Add header
postgresSchema = `-- PostgreSQL Schema
-- Converted from SQLite on ${new Date().toISOString()}
-- Database: supaclean

-- Enable UUID extension (if needed)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

` + postgresSchema;

// Conversion rules

// 1. INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
postgresSchema = postgresSchema.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');

// 2. TEXT -> VARCHAR or TEXT (keep TEXT for long text fields)
// We'll use TEXT for most fields (PostgreSQL supports it)
// postgresSchema = postgresSchema.replace(/\bTEXT\b/gi, 'VARCHAR(255)'); // Optional: use VARCHAR

// 3. REAL -> DECIMAL(10,2) for money fields
// We'll be careful - only convert REAL in specific contexts
postgresSchema = postgresSchema.replace(/\b(amount|price|balance|total_amount|paid_amount|base_price|price_per_item|price_per_kg|weight_kg|opening_balance|cash_sales|book_sales|card_sales|mobile_money_sales|bank_deposits|bank_payments|mpesa_received|mpesa_paid|expenses_from_cash|expenses_from_bank|expenses_from_mpesa|cash_in_hand|closing_balance)\s+REAL\b/gi, '$1 DECIMAL(10,2)');

// 4. DATETIME -> TIMESTAMP
postgresSchema = postgresSchema.replace(/\bDATETIME\b/gi, 'TIMESTAMP');

// 5. INTEGER (for booleans) -> BOOLEAN
// Default 0 -> FALSE, Default 1 -> TRUE
postgresSchema = postgresSchema.replace(/\b(is_active|is_reconciled|is_enabled)\s+INTEGER\s+DEFAULT\s+0\b/gi, '$1 BOOLEAN DEFAULT FALSE');
postgresSchema = postgresSchema.replace(/\b(is_active|is_reconciled|is_enabled)\s+INTEGER\s+DEFAULT\s+1\b/gi, '$1 BOOLEAN DEFAULT TRUE');
postgresSchema = postgresSchema.replace(/\b(is_active|is_reconciled|is_enabled)\s+INTEGER\b/gi, '$1 BOOLEAN');

// 6. Remove SQLite-specific PRAGMA statements (they're usually in comments or separate)
// Already handled by export - but check for any
postgresSchema = postgresSchema.replace(/PRAGMA\s+\w+\s*[=;].*?;/gi, '-- PRAGMA removed (PostgreSQL equivalent handled separately)');

// 7. Remove SQLite-specific constraints
// INSERT OR IGNORE -> ON CONFLICT DO NOTHING (handled in migration code, not schema)

// 8. FOREIGN KEY syntax is the same, but ensure proper formatting
// PostgreSQL is more strict about foreign keys

// 9. CURRENT_TIMESTAMP is fine in PostgreSQL
// No change needed

// 10. UNIQUE constraints - check if date needs to be changed
// If date is TEXT and UNIQUE, consider changing to DATE type
// But we'll handle this in the manual review step

// 11. Remove IF NOT EXISTS from ALTER TABLE (not needed in initial migration)
// Actually, keep IF NOT EXISTS for safety

// Special handling for daily_cash_summaries date column
// Change date TEXT UNIQUE to date DATE with unique constraint
if (postgresSchema.includes('daily_cash_summaries')) {
  // We'll need to handle this specially - TEXT date -> DATE
  // But wait until we add branch_id
}

// Write converted schema
fs.writeFileSync(outputPath, postgresSchema, 'utf8');

console.log('✅ Schema converted to PostgreSQL');
console.log(`📄 Output file: ${outputPath}`);
console.log('\n⚠️  IMPORTANT: Review the converted schema manually');
console.log('   Check for:');
console.log('   - Date columns (TEXT -> DATE)');
console.log('   - Money fields (REAL -> DECIMAL)');
console.log('   - Boolean fields (INTEGER -> BOOLEAN)');
console.log('   - Any SQLite-specific syntax');
console.log('\n📝 Next: Add branch_id to daily_cash_summaries table');
