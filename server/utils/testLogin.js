/**
 * Test Login Script
 * Tests the login functionality directly
 */

const db = require('../database/db');
const bcrypt = require('bcryptjs');

setTimeout(() => {
  const username = 'admin';
  const password = 'admin123';

  console.log('🔍 Testing login for:', username);
  console.log('📝 Password:', password);
  console.log('');

  // Find user
  db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], (err, user) => {
    if (err) {
      console.error('❌ Error finding user:', err.message);
      process.exit(1);
    }

    if (!user) {
      console.error('❌ User not found!');
      console.log('Run: npm run verify-admin');
      process.exit(1);
    }

    console.log('✅ User found:');
    console.log('   ID:', user.id);
    console.log('   Username:', user.username);
    console.log('   Password Hash:', user.password_hash ? 'Exists (' + user.password_hash.substring(0, 20) + '...)' : 'MISSING!');
    console.log('   Role:', user.role);
    console.log('   Active:', user.is_active);
    console.log('');

    if (!user.password_hash) {
      console.error('❌ Password hash is missing!');
      console.log('Creating password hash...');
      
      bcrypt.hash(password, 10, (hashErr, passwordHash) => {
        if (hashErr) {
          console.error('❌ Error hashing:', hashErr);
          process.exit(1);
        }

        db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id], (updateErr) => {
          if (updateErr) {
            console.error('❌ Error updating password:', updateErr);
            process.exit(1);
          }
          console.log('✅ Password hash created!');
          console.log('Try logging in again.');
          process.exit(0);
        });
      });
      return;
    }

    // Test password verification
    console.log('🔐 Testing password verification...');
    bcrypt.compare(password, user.password_hash, (compareErr, isMatch) => {
      if (compareErr) {
        console.error('❌ Error comparing password:', compareErr.message);
        process.exit(1);
      }

      if (isMatch) {
        console.log('✅ Password is CORRECT!');
        console.log('');
        console.log('🔍 Possible issues:');
        console.log('   1. Check if server is running');
        console.log('   2. Check browser console for errors');
        console.log('   3. Check server logs for errors');
        console.log('   4. Verify API endpoint: POST /api/auth/login');
        console.log('   5. Check CORS settings');
      } else {
        console.log('❌ Password is INCORRECT!');
        console.log('');
        console.log('🔧 Fixing password...');
        
        bcrypt.hash(password, 10, (hashErr, passwordHash) => {
          if (hashErr) {
            console.error('❌ Error hashing:', hashErr);
            process.exit(1);
          }

          db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id], (updateErr) => {
            if (updateErr) {
              console.error('❌ Error updating password:', updateErr);
              process.exit(1);
            }
            console.log('✅ Password hash updated!');
            console.log('Try logging in again.');
            process.exit(0);
          });
        });
      }
    });
  });
}, 1000);
