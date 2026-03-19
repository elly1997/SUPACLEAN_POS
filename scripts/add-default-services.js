// Add default services to PostgreSQL database
const db = require('../server/database/query');

const defaultServices = [
  {
    name: 'Pressing only',
    description: 'Ironing / press only',
    base_price: 2000,
    price_per_item: 2000,
    price_per_kg: 0
  },
  {
    name: 'Drying only',
    description: 'Tumble dry only',
    base_price: 3000,
    price_per_kg: 3000,
    price_per_item: 0
  },
  {
    name: 'Wash, Dry & Fold',
    description: 'Full service wash, dry and fold',
    base_price: 5000,
    price_per_kg: 2000,
    price_per_item: 0
  },
  {
    name: 'Pressing',
    description: 'Professional pressing service',
    base_price: 3000,
    price_per_item: 1000,
    price_per_kg: 0
  },
  {
    name: 'Express Service',
    description: 'Same-day service',
    base_price: 8000,
    price_per_kg: 3000,
    price_per_item: 0
  },
  {
    name: 'Standard Wash',
    description: 'Standard washing service',
    base_price: 4000,
    price_per_kg: 1500,
    price_per_item: 0
  }
];

async function addDefaultServices() {
  try {
    console.log('🔍 Checking existing services...\n');
    
    const existingServices = await db.all('SELECT name FROM services');
    const existingNames = existingServices.map(s => s.name.toLowerCase());
    
    console.log(`Found ${existingServices.length} existing services\n`);
    
    let added = 0;
    let skipped = 0;
    
    for (const service of defaultServices) {
      if (existingNames.includes(service.name.toLowerCase())) {
        console.log(`⏭️  Skipping "${service.name}" - already exists`);
        skipped++;
        continue;
      }
      
      try {
        await db.run(
          `INSERT INTO services (name, description, base_price, price_per_kg, price_per_item, is_active)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [service.name, service.description, service.base_price, service.price_per_kg, service.price_per_item, true]
        );
        console.log(`✅ Added service: "${service.name}"`);
        added++;
      } catch (err) {
        console.error(`❌ Error adding "${service.name}":`, err.message);
      }
    }
    
    console.log(`\n✅ Complete! Added ${added} services, skipped ${skipped}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

addDefaultServices();
