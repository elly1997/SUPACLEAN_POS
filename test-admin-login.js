/**
 * Quick Admin Login Test
 * Run from project root: node test-admin-login.js
 */

const db = require('./server/database/init');
const bcrypt = require('bcryptjs');

setTimeout(() => {
  const username = 'admin';
  const password = 'admin123';

  console.log('🔍 Testing Admin Login...\n');

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('❌ Database Error:', err.message);
      process.exit(1);
    }

    if (!user) {
      console.log('❌ Admin user NOT found!');
      console.log('Run: npm run verify-admin');
      process.exit(1);
    }

    console.log('✅ Admin user found');
    console.log('   ID:', user.id);
    console.log('   Username:', user.username);
    console.log('   Role:', user.role);
    console.log('   Active:', user.is_active === 1 ? 'Yes' : 'No');
    console.log('   Has Password Hash:', user.password_hash ? 'Yes' : 'NO!');
    console.log('');

    if (!user.password_hash) {
      console.log('🔧 Creating password hash...');
      bcrypt.hash(password, 10, (hashErr, hash) => {
        if (hashErr) {
          console.error('❌ Error:', hashErr.message);
          process.exit(1);
        }
        db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id], (updateErr) => {
          if (updateErr) {
            console.error('❌ Update error:', updateErr.message);
            process.exit(1);
          }
          console.log('✅ Password hash created!');
          console.log('Try logging in again.');
          process.exit(0);
        });
      });
      return;
    }

    console.log('🔐 Testing password...');
    bcrypt.compare(password, user.password_hash, (compareErr, isMatch) => {
      if (compareErr) {
        console.error('❌ Compare error:', compareErr.message);
        process.exit(1);
      }

      if (isMatch) {
        console.log('✅ Password is CORRECT!');
        console.log('');
        console.log('📋 Login should work with:');
        console.log('   Username: admin');
        console.log('   Password: admin123');
        console.log('');
        console.log('🔍 If login still fails, check:');
        console.log('   1. Server is running on port 5000');
        console.log('   2. Browser console for errors');
        console.log('   3. Server console for login attempts');
        console.log('   4. Network tab in browser DevTools');
      } else {
        console.log('❌ Password is INCORRECT!');
        console.log('🔧 Resetting password...');
        bcrypt.hash(password, 10, (hashErr, hash) => {
          if (hashErr) {
            console.error('❌ Error:', hashErr.message);
            process.exit(1);
          }
          db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id], (updateErr) => {
            if (updateErr) {
              console.error('❌ Update error:', updateErr.message);
              process.exit(1);
            }
            console.log('✅ Password reset!');
            console.log('Try logging in again.');
            process.exit(0);
          });
        });
      }
    });
  });
}, 1000);
