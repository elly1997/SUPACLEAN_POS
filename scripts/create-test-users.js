/**
 * Test Script: Create Test Branches and Users
 * 
 * This script creates sample branches and users for testing multi-branch functionality.
 * Run: node scripts/create-test-users.js
 */

const db = require('../server/database/query');
const bcrypt = require('bcryptjs');

async function createTestUsers() {
  console.log('🚀 Starting test user creation...\n');

  try {
    // 1. Create test branches
    const branches = [
      {
        name: 'AR02 Collection Unit',
        code: 'AR02',
        branch_type: 'collection',
        address: '123 Main Street, Arusha',
        phone: '+255 123 456 789',
        manager_name: 'John Manager'
      },
      {
        name: 'AR03 Collection Unit',
        code: 'AR03',
        branch_type: 'collection',
        address: '456 Market Road, Arusha',
        phone: '+255 123 456 790',
        manager_name: 'Jane Manager'
      },
      {
        name: 'AR10 Workshop',
        code: 'AR10',
        branch_type: 'workshop',
        address: '789 Industrial Area, Arusha',
        phone: '+255 123 456 791',
        manager_name: 'Bob Manager'
      }
    ];

    const createdBranches = [];

    for (const branchData of branches) {
      // Check if branch already exists
      let branch = await db.get('SELECT * FROM branches WHERE code = $1', [branchData.code]);
      
      if (!branch) {
        // Create the branch
        const branchResult = await db.run(
          'INSERT INTO branches (name, code, branch_type, address, phone, manager_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [branchData.name, branchData.code, branchData.branch_type, branchData.address, branchData.phone, branchData.manager_name]
        );
        branch = await db.get('SELECT * FROM branches WHERE id = $1', [branchResult.lastID]);
        console.log(`✅ Branch created: ${branch.code} - ${branch.name}`);
      } else {
        console.log(`ℹ️  Branch already exists: ${branch.code} - ${branch.name}`);
      }
      
      createdBranches.push(branch);
    }

    console.log('\n📋 Creating users for branches...\n');

    // 2. Create test users for each branch
    const users = [
      {
        username: 'ar02_manager',
        password: 'test123',
        fullName: 'AR02 Manager',
        role: 'manager',
        branchCode: 'AR02'
      },
      {
        username: 'ar02_cashier',
        password: 'test123',
        fullName: 'AR02 Cashier',
        role: 'cashier',
        branchCode: 'AR02'
      },
      {
        username: 'ar03_manager',
        password: 'test123',
        fullName: 'AR03 Manager',
        role: 'manager',
        branchCode: 'AR03'
      },
      {
        username: 'ar10_manager',
        password: 'test123',
        fullName: 'AR10 Workshop Manager',
        role: 'manager',
        branchCode: 'AR10'
      },
      {
        username: 'ar10_processor',
        password: 'test123',
        fullName: 'AR10 Processor',
        role: 'processor',
        branchCode: 'AR10'
      }
    ];

    const createdUsers = [];

    for (const userData of users) {
      // Find the branch
      const branch = createdBranches.find(b => b.code === userData.branchCode);
      
      if (!branch) {
        console.log(`⚠️  Branch ${userData.branchCode} not found, skipping user ${userData.username}`);
        continue;
      }

      // Check if user already exists
      let user = await db.get('SELECT * FROM users WHERE username = $1', [userData.username]);
      
      if (!user) {
        // Hash password
        const passwordHash = await bcrypt.hash(userData.password, 10);

        // Create user
        const userResult = await db.run(
          'INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [userData.username, passwordHash, userData.fullName, userData.role, branch.id, true]
        );

        user = await db.get('SELECT * FROM users WHERE id = $1', [userResult.lastID]);
        console.log(`✅ User created: ${user.username} (${user.full_name})`);
        console.log(`   Branch: ${branch.name} (${branch.code})`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Password: ${userData.password}\n`);
        
        createdUsers.push({ ...user, password: userData.password });
      } else {
        console.log(`ℹ️  User already exists: ${userData.username}\n`);
        createdUsers.push({ ...user, password: '(existing)' });
      }
    }

    // 3. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Branches created/found: ${createdBranches.length}`);
    console.log(`✅ Users created/found: ${createdUsers.length}\n`);
    
    console.log('\n🔑 TEST CREDENTIALS:\n');
    console.log('You can now login with these credentials:\n');
    
    createdUsers.forEach(user => {
      const branch = createdBranches.find(b => b.id === user.branch_id);
      if (user.password !== '(existing)') {
        console.log(`Username: ${user.username}`);
        console.log(`Password: ${user.password}`);
        console.log(`Branch: ${branch ? branch.name : 'N/A'}`);
        console.log(`Role: ${user.role}`);
        console.log('');
      }
    });

    console.log('\n💡 TIP: Login with different users to test branch data isolation!');
    console.log('   Each user should only see data from their own branch.\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  } finally {
    await db.pool.end();
    process.exit(0);
  }
}

// Run the script
createTestUsers();
