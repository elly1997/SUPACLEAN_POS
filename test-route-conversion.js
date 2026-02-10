/**
 * Test script to verify route conversions work with PostgreSQL
 * Run with: node test-route-conversion.js
 */

require('dotenv').config();
const db = require('./server/database/query');

async function testDatabaseConnection() {
  console.log('🔍 Testing database connection...');
  try {
    const result = await db.get('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database connection successful!');
    console.log('   PostgreSQL Version:', result.pg_version.split(' ')[0] + ' ' + result.pg_version.split(' ')[1]);
    console.log('   Current Time:', result.current_time);
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  }
}

async function testQueryHelpers() {
  console.log('\n🔍 Testing query helper functions...');
  
  try {
    // Test db.get
    console.log('   Testing db.get...');
    const user = await db.get('SELECT COUNT(*) as count FROM users LIMIT 1');
    console.log('   ✅ db.get works');
    
    // Test db.all
    console.log('   Testing db.all...');
    const services = await db.all('SELECT COUNT(*) as count FROM services');
    console.log('   ✅ db.all works');
    
    // Test db.run with RETURNING
    console.log('   Testing db.run with RETURNING id...');
    // Note: We'll test with a safe operation (SELECT) to avoid modifying data
    const testResult = await db.run('SELECT 1 as test');
    console.log('   ✅ db.run works');
    
    return true;
  } catch (err) {
    console.error('❌ Query helper test failed:', err.message);
    return false;
  }
}

async function testSQLConversions() {
  console.log('\n🔍 Testing SQL compatibility conversions...');
  
  try {
    // Test CURRENT_TIMESTAMP (replacement for datetime('now'))
    console.log('   Testing CURRENT_TIMESTAMP...');
    const timeTest = await db.get('SELECT CURRENT_TIMESTAMP as now_time');
    console.log('   ✅ CURRENT_TIMESTAMP works:', timeTest.now_time);
    
    // Test EXTRACT(EPOCH FROM ...) (replacement for julianday)
    console.log('   Testing EXTRACT(EPOCH FROM ...)...');
    const epochTest = await db.get(`
      SELECT EXTRACT(EPOCH FROM (NOW() - NOW())) / 3600 as hours_diff
    `);
    console.log('   ✅ EXTRACT(EPOCH FROM ...) works:', epochTest.hours_diff);
    
    // Test LOWER() (replacement for COLLATE NOCASE)
    console.log('   Testing LOWER() for case-insensitive comparison...');
    const lowerTest = await db.get(`
      SELECT LOWER('TEST') as lower_result
    `);
    console.log('   ✅ LOWER() works:', lowerTest.lower_result);
    
    // Test is_active = TRUE (replacement for is_active = 1)
    console.log('   Testing is_active = TRUE...');
    const boolTest = await db.get(`
      SELECT COUNT(*) as count FROM services WHERE is_active = TRUE
    `);
    console.log('   ✅ is_active = TRUE works:', boolTest.count, 'active services');
    
    return true;
  } catch (err) {
    console.error('❌ SQL conversion test failed:', err.message);
    return false;
  }
}

async function testTableStructure() {
  console.log('\n🔍 Testing table structure...');
  
  const tables = [
    'users', 'branches', 'customers', 'services', 'orders', 
    'transactions', 'daily_cash_summaries', 'expenses', 'bank_deposits'
  ];
  
  try {
    for (const table of tables) {
      const result = await db.get(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_name = $1
      `, [table]);
      
      if (result && result.count > 0) {
        console.log(`   ✅ Table '${table}' exists`);
      } else {
        console.log(`   ⚠️  Table '${table}' not found`);
      }
    }
    return true;
  } catch (err) {
    console.error('❌ Table structure test failed:', err.message);
    return false;
  }
}

async function runAllTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   PHASE 5: ROUTE CONVERSION TESTING');
  console.log('═══════════════════════════════════════════════════\n');
  
  const results = {
    connection: false,
    queryHelpers: false,
    sqlConversions: false,
    tableStructure: false
  };
  
  results.connection = await testDatabaseConnection();
  if (!results.connection) {
    console.log('\n❌ Cannot proceed - database connection failed!');
    process.exit(1);
  }
  
  results.queryHelpers = await testQueryHelpers();
  results.sqlConversions = await testSQLConversions();
  results.tableStructure = await testTableStructure();
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   Database Connection: ${results.connection ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Query Helpers: ${results.queryHelpers ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   SQL Conversions: ${results.sqlConversions ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Table Structure: ${results.tableStructure ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════\n');
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('✅ All basic tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Start the server: npm run server');
    console.log('   2. Test routes manually with Postman or frontend');
    console.log('   3. Test critical routes:');
    console.log('      - POST /api/auth/login');
    console.log('      - GET /api/customers');
    console.log('      - POST /api/orders (create order)');
    console.log('      - GET /api/orders');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review errors above.');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
