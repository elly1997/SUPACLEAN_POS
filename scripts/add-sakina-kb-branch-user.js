/**
 * Add SAKINA KB branch and a branch user for login testing.
 * Run: node scripts/add-sakina-kb-branch-user.js
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'server', 'database', 'query'));
const bcrypt = require('bcryptjs');

const BRANCH = {
  name: 'SAKINA KB',
  code: 'SAKINA',
  branch_type: 'collection',
  address: 'Sakina, Arusha, Tanzania',
  phone: '',
  manager_name: 'SAKINA KB Manager'
};

const USER = {
  username: 'sakinakb',
  password: 'sakina123',
  fullName: 'SAKINA KB Cashier',
  role: 'cashier'
};

async function addSakinaKb() {
  console.log('🚀 Adding SAKINA KB branch and user...\n');

  try {
    let branch = await db.get('SELECT * FROM branches WHERE code = $1', [BRANCH.code]);
    if (!branch) {
      const r = await db.run(
        'INSERT INTO branches (name, code, branch_type, address, phone, manager_name, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [BRANCH.name, BRANCH.code, BRANCH.branch_type, BRANCH.address, BRANCH.phone, BRANCH.manager_name, true]
      );
      branch = await db.get('SELECT * FROM branches WHERE id = $1', [r.lastID]);
      console.log(`✅ Branch created: ${branch.code} - ${branch.name}`);
    } else {
      console.log(`ℹ️  Branch exists: ${branch.code} - ${branch.name}`);
    }

    let user = await db.get('SELECT * FROM users WHERE username = $1', [USER.username]);
    if (!user) {
      const hash = await bcrypt.hash(USER.password, 10);
      const r = await db.run(
        'INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [USER.username, hash, USER.fullName, USER.role, branch.id, true]
      );
      user = await db.get('SELECT * FROM users WHERE id = $1', [r.lastID]);
      console.log(`✅ User created: ${user.username} (${user.full_name})`);
    } else {
      console.log(`ℹ️  User exists: ${user.username}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('🔑 LOG IN AS SAKINA KB BRANCH');
    console.log('='.repeat(50));
    console.log(`Username: ${USER.username}`);
    console.log(`Password: ${USER.password}`);
    console.log(`Branch:   ${branch.name} (${branch.code})`);
    console.log('='.repeat(50));
    console.log('\n💡 Use these credentials on the login page to test branch profile.\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    await db.pool.end();
    process.exit(0);
  }
}

addSakinaKb();
