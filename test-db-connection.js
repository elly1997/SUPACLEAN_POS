// Quick test script to verify database and fix loyalty_rewards table
const db = require('./server/database/init');

setTimeout(() => {
  console.log('\n=== Testing Database Connection ===\n');
  
  // Test services
  db.all('SELECT COUNT(*) as count FROM services', [], (err, rows) => {
    if (err) {
      console.error('❌ Services Error:', err.message);
    } else {
      console.log('✅ Services count:', rows[0].count);
    }
    
    // Test customers
    db.all('SELECT COUNT(*) as count FROM customers', [], (err2, rows2) => {
      if (err2) {
        console.error('❌ Customers Error:', err2.message);
      } else {
        console.log('✅ Customers count:', rows2[0].count);
      }
      
      // Check and fix loyalty_rewards
      db.all("PRAGMA table_info(loyalty_rewards)", [], (rewardsErr, rewardsColumns) => {
        if (rewardsErr) {
          console.log('ℹ️  loyalty_rewards table may not exist yet:', rewardsErr.message);
        } else {
          const columnNames = rewardsColumns.map(col => col.name);
          console.log('📋 loyalty_rewards columns:', columnNames);
          
          if (!columnNames.includes('service_value')) {
            console.log('🔧 Adding service_value column...');
            db.run("ALTER TABLE loyalty_rewards ADD COLUMN service_value REAL DEFAULT 0", (alterErr) => {
              if (alterErr) {
                console.error('❌ Error adding column:', alterErr.message);
              } else {
                console.log('✅ Added service_value column successfully');
              }
              process.exit(0);
            });
          } else {
            console.log('✅ service_value column exists');
            process.exit(0);
          }
        }
      });
    });
  });
}, 2000);
