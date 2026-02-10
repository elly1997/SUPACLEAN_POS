// Check orders table schema and add missing columns
const db = require('../server/database/query');

async function checkAndFixSchema() {
  try {
    console.log('🔍 Checking orders table schema...\n');
    
    // Get all columns from orders table
    const columns = await db.all(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY column_name
    `, ['orders']);
    
    console.log('Current columns:');
    const columnNames = columns.map(r => r.column_name);
    columnNames.forEach(col => console.log(`  - ${col}`));
    
    // Required columns
    const requiredColumns = [
      { name: 'branch_id', type: 'INTEGER', nullable: true },
      { name: 'created_at_branch_id', type: 'INTEGER', nullable: true },
      { name: 'ready_at_branch_id', type: 'INTEGER', nullable: true },
      { name: 'collected_at_branch_id', type: 'INTEGER', nullable: true },
      { name: 'estimated_collection_date', type: 'TIMESTAMP', nullable: true }
    ];
    
    console.log('\n🔧 Checking for missing columns...\n');
    
    for (const col of requiredColumns) {
      if (!columnNames.includes(col.name)) {
        console.log(`❌ Missing column: ${col.name}`);
        console.log(`   Adding ${col.name} (${col.type})...`);
        
        try {
          await db.run(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`);
          console.log(`✅ Added ${col.name}`);
        } catch (err) {
          // Ignore if column already exists
          if (err.message.includes('already exists') || err.code === '42701') {
            console.log(`⚠️ Column ${col.name} may already exist, skipping...`);
          } else {
            console.error(`❌ Error adding ${col.name}:`, err.message);
          }
        }
      } else {
        console.log(`✅ Column exists: ${col.name}`);
      }
    }
    
    console.log('\n✅ Schema check complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

checkAndFixSchema();
