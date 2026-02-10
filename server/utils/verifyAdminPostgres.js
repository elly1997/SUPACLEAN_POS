/**
 * Admin User Verification Script for PostgreSQL
 * 
 * This script checks if the admin user exists in PostgreSQL and creates it if missing.
 * Run this script if you're having login issues: node server/utils/verifyAdminPostgres.js
 */

const db = require('../database/query');
const bcrypt = require('bcryptjs');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_FULL_NAME = 'System Administrator';
const ADMIN_ROLE = 'admin';

async function verifyAdmin() {
  console.log('🔍 Checking for admin user in PostgreSQL...\n');

  try {
    // Check if admin exists
    const user = await db.get('SELECT * FROM users WHERE username = $1', [ADMIN_USERNAME]);

    if (user) {
      console.log('✅ Admin user found:');
      console.log('   ID:', user.id);
      console.log('   Username:', user.username);
      console.log('   Full Name:', user.full_name);
      console.log('   Role:', user.role);
      console.log('   Active:', user.is_active ? 'Yes' : 'No');
      console.log('   Branch ID:', user.branch_id || 'None (Admin access to all branches)');
      console.log('   Last Login:', user.last_login || 'Never');
      console.log('\n✅ Admin user is ready to use!');
      console.log('   Username: admin');
      console.log('   Password: admin123');
      process.exit(0);
    } else {
      console.log('❌ Admin user NOT found.');
      console.log('🔧 Creating admin user...\n');

      // Hash password
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

      // Create admin user (no branch assigned - admin can access all branches)
      const result = await db.run(
        'INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [ADMIN_USERNAME, passwordHash, ADMIN_FULL_NAME, ADMIN_ROLE, null, true]
      );

      if (result && result.lastID) {
        console.log('✅ Admin user created successfully!');
        console.log('\n📋 Admin Credentials:');
        console.log('   Username: admin');
        console.log('   Password: admin123');
        console.log('\n⚠️  IMPORTANT: Please change the password after first login!');
        console.log('\n✅ You can now log in with these credentials.');
        process.exit(0);
      } else {
        console.error('❌ Error creating admin user: No ID returned');
        process.exit(1);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.code === '42P01') {
      console.error('\n💡 It looks like the users table might not exist in PostgreSQL.');
      console.error('   Please make sure the database schema has been migrated to PostgreSQL.');
    }
    process.exit(1);
  }
}

// Run the verification
verifyAdmin();
