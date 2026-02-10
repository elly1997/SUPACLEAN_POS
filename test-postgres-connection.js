/**
 * Test PostgreSQL Connection Script
 * Tests connection to Supabase PostgreSQL database
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env file');
  console.error('   Please create .env file with DATABASE_URL from Supabase');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false
});

async function testConnection() {
  try {
    console.log('🔄 Testing PostgreSQL connection...');
    console.log('   Database:', process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'Unknown');
    
    // Test basic connection
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ PostgreSQL connection successful!');
    console.log('   Current time:', result.rows[0].current_time);
    console.log('   PostgreSQL version:', result.rows[0].pg_version.split(',')[0]);
    
    // Test query (check if branches table exists)
    try {
      const branches = await pool.query('SELECT COUNT(*) as count FROM branches');
      console.log('✅ Query test successful!');
      console.log('   Branches count:', branches.rows[0].count);
    } catch (queryErr) {
      console.log('⚠️  Query test failed (tables may not be imported yet):', queryErr.message);
      console.log('   This is OK if you haven\'t imported schema yet (Phase 2)');
    }
    
    await pool.end();
    console.log('\n✅ All tests passed! Database connection is working.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Connection failed:', err.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Check DATABASE_URL in .env file is correct');
    console.error('  2. Verify Supabase project is active');
    console.error('  3. Check password in connection string');
    console.error('  4. Ensure internet connection is working');
    console.error('  5. Check Supabase dashboard for any issues');
    await pool.end();
    process.exit(1);
  }
}

testConnection();
