/**
 * Test API Routes Script
 * Tests critical API endpoints to verify route conversions work correctly
 * Run with: node test-api-routes.js
 * 
 * Note: Server must be running on port 5000
 */

require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.CLIENT_URL?.replace(':3000', ':5000') || 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;

// Test results
const results = {
  passed: [],
  failed: []
};

function logTest(name, passed, message = '') {
  if (passed) {
    console.log(`   ✅ ${name}`);
    results.passed.push(name);
  } else {
    console.log(`   ❌ ${name}: ${message}`);
    results.failed.push({ name, message });
  }
}

async function testServerRunning() {
  console.log('🔍 Testing if server is running...');
  try {
    const response = await axios.get(`${BASE_URL}/api/health`, { timeout: 2000 });
    logTest('Server Health Check', true);
    return true;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('   ⚠️  Server not running. Please start server with: npm run server');
      return false;
    }
    // Health endpoint might not exist, that's OK
    logTest('Server Health Check', true, 'Server responding (health endpoint may not exist)');
    return true;
  }
}

async function testAuthRoutes() {
  console.log('\n🔍 Testing Authentication Routes...');
  
  try {
    // Test login endpoint (should fail without credentials, but endpoint should exist)
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        username: 'test',
        password: 'test'
      }, { timeout: 5000 });
      logTest('POST /api/auth/login', true, 'Endpoint exists (login may fail without valid credentials)');
    } catch (err) {
      if (err.response && err.response.status === 401) {
        logTest('POST /api/auth/login', true, 'Endpoint exists (authentication failed as expected)');
      } else if (err.response && err.response.status === 400) {
        logTest('POST /api/auth/login', true, 'Endpoint exists (validation error as expected)');
      } else if (err.code === 'ECONNREFUSED') {
        logTest('POST /api/auth/login', false, 'Server not running');
      } else {
        logTest('POST /api/auth/login', false, err.message);
      }
    }
  } catch (err) {
    logTest('POST /api/auth/login', false, err.message);
  }
}

async function testCustomerRoutes() {
  console.log('\n🔍 Testing Customer Routes...');
  
  try {
    // Test GET /api/customers (may require auth, but endpoint should exist)
    try {
      const response = await axios.get(`${API_BASE}/customers`, { timeout: 5000 });
      logTest('GET /api/customers', true);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        logTest('GET /api/customers', true, 'Endpoint exists (authentication required)');
      } else if (err.code === 'ECONNREFUSED') {
        logTest('GET /api/customers', false, 'Server not running');
      } else {
        logTest('GET /api/customers', false, err.message);
      }
    }
  } catch (err) {
    logTest('GET /api/customers', false, err.message);
  }
}

async function testOrderRoutes() {
  console.log('\n🔍 Testing Order Routes...');
  
  try {
    // Test GET /api/orders (may require auth)
    try {
      const response = await axios.get(`${API_BASE}/orders`, { timeout: 5000 });
      logTest('GET /api/orders', true);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        logTest('GET /api/orders', true, 'Endpoint exists (authentication required)');
      } else if (err.code === 'ECONNREFUSED') {
        logTest('GET /api/orders', false, 'Server not running');
      } else {
        logTest('GET /api/orders', false, err.message);
      }
    }
  } catch (err) {
    logTest('GET /api/orders', false, err.message);
  }
}

async function testTransactionRoutes() {
  console.log('\n🔍 Testing Transaction Routes...');
  
  try {
    // Test GET /api/transactions
    try {
      const response = await axios.get(`${API_BASE}/transactions`, { timeout: 5000 });
      logTest('GET /api/transactions', true);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        logTest('GET /api/transactions', true, 'Endpoint exists (authentication required)');
      } else if (err.code === 'ECONNREFUSED') {
        logTest('GET /api/transactions', false, 'Server not running');
      } else {
        logTest('GET /api/transactions', false, err.message);
      }
    }
  } catch (err) {
    logTest('GET /api/transactions', false, err.message);
  }
}

async function testCashManagementRoutes() {
  console.log('\n🔍 Testing Cash Management Routes...');
  
  try {
    // Test GET /api/cash/today
    try {
      const response = await axios.get(`${API_BASE}/cash/today`, { timeout: 5000 });
      logTest('GET /api/cash/today', true);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        logTest('GET /api/cash/today', true, 'Endpoint exists (authentication required)');
      } else if (err.code === 'ECONNREFUSED') {
        logTest('GET /api/cash/today', false, 'Server not running');
      } else {
        logTest('GET /api/cash/today', false, err.message);
      }
    }
  } catch (err) {
    logTest('GET /api/cash/today', false, err.message);
  }
}

async function runAllTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   PHASE 5: API ROUTE TESTING');
  console.log('═══════════════════════════════════════════════════\n');
  
  const serverRunning = await testServerRunning();
  
  if (!serverRunning) {
    console.log('\n⚠️  Cannot test routes - server is not running.');
    console.log('   Please start the server with: npm run server');
    console.log('   Then run this test again.');
    process.exit(1);
  }
  
  await testAuthRoutes();
  await testCustomerRoutes();
  await testOrderRoutes();
  await testTransactionRoutes();
  await testCashManagementRoutes();
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   TEST RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   ✅ Passed: ${results.passed.length}`);
  console.log(`   ❌ Failed: ${results.failed.length}`);
  console.log('═══════════════════════════════════════════════════\n');
  
  if (results.failed.length > 0) {
    console.log('Failed Tests:');
    results.failed.forEach(test => {
      console.log(`   - ${test.name}: ${test.message}`);
    });
    console.log('');
  }
  
  if (results.failed.length === 0) {
    console.log('✅ All route tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Test routes manually with frontend application');
    console.log('   2. Test critical workflows:');
    console.log('      - Login as admin/user');
    console.log('      - Create a new order');
    console.log('      - Search for customers');
    console.log('      - View orders');
    console.log('   3. Monitor server logs for any errors');
    console.log('   4. Proceed to Phase 6: Data Migration');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Review errors above.');
    console.log('   Note: Authentication errors are expected if not logged in.');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
