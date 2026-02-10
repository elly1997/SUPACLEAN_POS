/**
 * Route Conversion Validator
 * Validates that route files have been properly converted from SQLite to PostgreSQL
 * 
 * Usage: node scripts/validate-route-conversion.js [route-file]
 * Example: node scripts/validate-route-conversion.js server/routes/orders.js
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../server/routes');
const routeFile = process.argv[2];

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const issues = [];
  const warnings = [];
  const passed = [];

  console.log(`\n${colors.cyan}📋 Checking: ${fileName}${colors.reset}\n`);

  // Check 1: Import statement
  if (content.includes("require('../database/init')")) {
    issues.push({
      type: 'error',
      message: 'Still using SQLite import (require(\'../database/init\'))',
      fix: "Change to: const db = require('../database/query')"
    });
  } else if (content.includes("require('../database/query')")) {
    passed.push('✅ Using PostgreSQL query helpers');
  } else {
    warnings.push({
      type: 'warning',
      message: 'No database import found - may not be a route file'
    });
  }

  // Check 2: Async route handlers
  const routeHandlers = content.match(/router\.(get|post|put|delete)\(['"`][^'"`]+['"`]\s*,/g) || [];
  const asyncHandlers = content.match(/router\.(get|post|put|delete)\(['"`][^'"`]+['"`]\s*,\s*async\s*\(/g) || [];
  
  if (routeHandlers.length > 0) {
    const nonAsyncCount = routeHandlers.length - asyncHandlers.length;
    if (nonAsyncCount > 0) {
      issues.push({
        type: 'error',
        message: `${nonAsyncCount} route handler(s) missing 'async' keyword`,
        fix: 'Add async to route handlers: router.get(\'/path\', async (req, res) => {'
      });
    } else {
      passed.push(`✅ All ${routeHandlers.length} route handlers are async`);
    }
  }

  // Check 3: db.all() usage
  const dbAllMatches = content.match(/db\.all\(/g) || [];
  const dbAllCallback = content.match(/db\.all\([^)]+,\s*\(err,\s*rows\)\s*=>/g) || [];
  const dbAllAwait = content.match(/await\s+db\.all\(/g) || [];
  
  if (dbAllMatches.length > 0) {
    if (dbAllCallback.length > 0) {
      issues.push({
        type: 'error',
        message: `${dbAllCallback.length} db.all() call(s) still using callback pattern`,
        fix: 'Convert to: const rows = await db.all(query, params);'
      });
    } else if (dbAllAwait.length === dbAllMatches.length) {
      passed.push(`✅ All ${dbAllMatches.length} db.all() calls use await`);
    }
  }

  // Check 4: db.get() usage
  const dbGetMatches = content.match(/db\.get\(/g) || [];
  const dbGetCallback = content.match(/db\.get\([^)]+,\s*\(err,\s*row\)\s*=>/g) || [];
  const dbGetAwait = content.match(/await\s+db\.get\(/g) || [];
  
  if (dbGetMatches.length > 0) {
    if (dbGetCallback.length > 0) {
      issues.push({
        type: 'error',
        message: `${dbGetCallback.length} db.get() call(s) still using callback pattern`,
        fix: 'Convert to: const row = await db.get(query, params);'
      });
    } else if (dbGetAwait.length === dbGetMatches.length) {
      passed.push(`✅ All ${dbGetMatches.length} db.get() calls use await`);
    }
  }

  // Check 5: db.run() usage
  const dbRunMatches = content.match(/db\.run\(/g) || [];
  const dbRunCallback = content.match(/db\.run\([^)]+,\s*function\s*\(err\)/g) || [];
  const dbRunAwait = content.match(/await\s+db\.run\(/g) || [];
  
  if (dbRunMatches.length > 0) {
    if (dbRunCallback.length > 0) {
      issues.push({
        type: 'error',
        message: `${dbRunCallback.length} db.run() call(s) still using callback pattern`,
        fix: 'Convert to: const result = await db.run(query, params);'
      });
    } else if (dbRunAwait.length === dbRunMatches.length) {
      passed.push(`✅ All ${dbRunMatches.length} db.run() calls use await`);
    }
  }

  // Check 6: Try/catch blocks
  const tryCatchBlocks = (content.match(/try\s*{/g) || []).length;
  const dbCalls = dbAllMatches.length + dbGetMatches.length + dbRunMatches.length;
  
  if (dbCalls > 0 && tryCatchBlocks === 0) {
    warnings.push({
      type: 'warning',
      message: 'No try/catch blocks found - error handling may be missing',
      fix: 'Wrap database calls in try/catch blocks'
    });
  } else if (tryCatchBlocks > 0) {
    passed.push(`✅ Found ${tryCatchBlocks} try/catch block(s) for error handling`);
  }

  // Check 7: SQLite-specific functions
  const sqliteFunctions = {
    'strftime(': 'Use TO_CHAR() or DATE_TRUNC() instead',
    'julianday(': 'Use date arithmetic instead',
    "datetime('now')": "Use NOW() or CURRENT_TIMESTAMP instead"
  };

  for (const [func, fix] of Object.entries(sqliteFunctions)) {
    if (content.includes(func)) {
      const count = (content.match(new RegExp(func.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      issues.push({
        type: 'error',
        message: `Found ${count} SQLite-specific function(s): ${func}`,
        fix: fix
      });
    }
  }

  // Check 8: INSERT with RETURNING
  const insertStatements = content.match(/INSERT\s+INTO\s+\w+/gi) || [];
  const insertWithReturning = content.match(/INSERT\s+INTO\s+\w+[^;]+RETURNING/gi) || [];
  
  if (insertStatements.length > 0 && insertWithReturning.length < insertStatements.length) {
    warnings.push({
      type: 'warning',
      message: `${insertStatements.length - insertWithReturning.length} INSERT statement(s) may need RETURNING clause`,
      fix: 'Add RETURNING id to INSERT statements if you need the inserted ID'
    });
  }

  // Check 9: this.lastID usage
  if (content.includes('this.lastID')) {
    issues.push({
      type: 'error',
      message: 'Found this.lastID (SQLite-specific)',
      fix: 'Use result.lastID from await db.run() instead'
    });
  }

  // Print results
  if (passed.length > 0) {
    console.log(`${colors.green}✅ Passed Checks:${colors.reset}`);
    passed.forEach(p => console.log(`   ${p}`));
  }

  if (warnings.length > 0) {
    console.log(`\n${colors.yellow}⚠️  Warnings:${colors.reset}`);
    warnings.forEach(w => {
      console.log(`   ${w.message}`);
      if (w.fix) console.log(`   Fix: ${w.fix}`);
    });
  }

  if (issues.length > 0) {
    console.log(`\n${colors.red}❌ Issues Found:${colors.reset}`);
    issues.forEach(issue => {
      console.log(`   ${issue.message}`);
      if (issue.fix) console.log(`   Fix: ${issue.fix}`);
    });
  }

  if (issues.length === 0 && warnings.length === 0 && passed.length > 0) {
    console.log(`\n${colors.green}✅ File appears to be fully converted!${colors.reset}\n`);
    return true;
  }

  return issues.length === 0;
}

// Main execution
if (routeFile) {
  // Check single file
  const filePath = path.isAbsolute(routeFile) ? routeFile : path.join(process.cwd(), routeFile);
  if (!fs.existsSync(filePath)) {
    console.error(`${colors.red}Error: File not found: ${filePath}${colors.reset}`);
    process.exit(1);
  }
  const isValid = checkFile(filePath);
  process.exit(isValid ? 0 : 1);
} else {
  // Check all route files
  console.log(`${colors.blue}🔍 Validating all route files...${colors.reset}`);
  
  const routeFiles = fs.readdirSync(routesDir)
    .filter(file => file.endsWith('.js'))
    .map(file => path.join(routesDir, file));

  let allValid = true;
  routeFiles.forEach(file => {
    const isValid = checkFile(file);
    if (!isValid) allValid = false;
  });

  console.log(`\n${colors.cyan}=== Summary ===${colors.reset}`);
  console.log(`Checked ${routeFiles.length} file(s)`);
  
  if (allValid) {
    console.log(`${colors.green}✅ All files appear to be converted!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ Some files need attention${colors.reset}\n`);
    process.exit(1);
  }
}
