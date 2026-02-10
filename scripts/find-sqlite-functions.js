/**
 * Find SQLite-Specific Functions
 * Scans route files for SQLite-specific functions that need conversion
 * 
 * Usage: node scripts/find-sqlite-functions.js
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../server/routes');
const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));

const sqliteFunctions = {
  'strftime(': {
    description: 'SQLite date formatting function',
    replacement: 'TO_CHAR() or DATE_TRUNC()',
    example: "strftime('%Y-%m', date) → TO_CHAR(date, 'YYYY-MM')"
  },
  'julianday(': {
    description: 'SQLite Julian day calculation',
    replacement: 'Date arithmetic',
    example: "julianday('now') - julianday(date) → CURRENT_DATE - date"
  },
  "datetime('now')": {
    description: 'SQLite current datetime',
    replacement: 'NOW() or CURRENT_TIMESTAMP',
    example: "datetime('now') → NOW()"
  },
  'date(': {
    description: 'SQLite date function',
    replacement: 'DATE() or CAST()',
    example: "date('now') → CURRENT_DATE"
  }
};

console.log('🔍 Scanning for SQLite-specific functions...\n');
console.log('='.repeat(80));

let totalFound = 0;
const results = {};

routeFiles.forEach(file => {
  const filePath = path.join(routesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const found = {};

  for (const [func, info] of Object.entries(sqliteFunctions)) {
    // Escape special regex characters
    const escapedFunc = func.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedFunc, 'gi');
    const matches = content.match(regex);
    
    if (matches && matches.length > 0) {
      found[func] = {
        count: matches.length,
        info: info
      };
      totalFound += matches.length;
    }
  }

  if (Object.keys(found).length > 0) {
    results[file] = found;
  }
});

// Print results
if (totalFound === 0) {
  console.log('✅ No SQLite-specific functions found! All files appear to be converted.\n');
} else {
  for (const [file, functions] of Object.entries(results)) {
    console.log(`\n📄 ${file}`);
    console.log('-'.repeat(80));
    
    for (const [func, data] of Object.entries(functions)) {
      console.log(`\n  ${func}`);
      console.log(`    Found: ${data.count} occurrence(s)`);
      console.log(`    Description: ${data.info.description}`);
      console.log(`    Replacement: ${data.info.replacement}`);
      console.log(`    Example: ${data.info.example}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Summary: Found ${totalFound} SQLite-specific function(s) across ${Object.keys(results).length} file(s)`);
  console.log('\n💡 Tip: Use PHASE4_ROUTE_UPDATES.md for conversion patterns\n');
}
