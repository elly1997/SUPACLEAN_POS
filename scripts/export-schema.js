/**
 * Export SQLite Schema Script
 * Exports database schema from SQLite for PostgreSQL conversion
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../database/supaclean.db');
const outputPath = path.join(__dirname, '../backups/schema_export.sql');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found:', dbPath);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database');
});

// Export schema
db.serialize(() => {
  let schema = '';
  
  schema += '-- SQLite Schema Export\n';
  schema += `-- Export Date: ${new Date().toISOString()}\n`;
  schema += '-- Database: supaclean.db\n';
  schema += '-- Note: This schema needs to be converted to PostgreSQL\n\n';
  
  // Get all CREATE TABLE statements
  db.all("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name", [], (err, rows) => {
    if (err) {
      console.error('❌ Error fetching schema:', err.message);
      db.close();
      process.exit(1);
    }
    
    rows.forEach((row) => {
      schema += row.sql + ';\n\n';
    });
    
    // Get indexes
    schema += '-- Indexes\n';
    db.all("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name", [], (err, indexRows) => {
      if (err) {
        console.error('⚠️  Error fetching indexes:', err.message);
      } else {
        indexRows.forEach((row) => {
          schema += row.sql + ';\n\n';
        });
      }
      
      // Write to file
      fs.writeFileSync(outputPath, schema, 'utf8');
      console.log(`✅ Schema exported to: ${outputPath}`);
      console.log(`📊 Exported ${rows.length} tables`);
      
      db.close((err) => {
        if (err) {
          console.error('⚠️  Error closing database:', err.message);
        } else {
          console.log('✅ Database connection closed');
          console.log('\n📝 Next step: Convert this schema to PostgreSQL format');
        }
        process.exit(0);
      });
    });
  });
});
