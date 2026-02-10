/**
 * Count Database Calls Script
 * Counts db.all, db.get, db.run calls in route files
 * Helps estimate conversion workload
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../server/routes');
const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));

console.log('📊 Database Call Statistics\n');
console.log('File'.padEnd(30), 'all'.padEnd(8), 'get'.padEnd(8), 'run'.padEnd(8), 'Total');
console.log('-'.repeat(70));

let totalAll = 0;
let totalGet = 0;
let totalRun = 0;

routeFiles.forEach(file => {
  const filePath = path.join(routesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  const allCount = (content.match(/db\.all\(/g) || []).length;
  const getCount = (content.match(/db\.get\(/g) || []).length;
  const runCount = (content.match(/db\.run\(/g) || []).length;
  const total = allCount + getCount + runCount;
  
  totalAll += allCount;
  totalGet += getCount;
  totalRun += runCount;
  
  if (total > 0) {
    console.log(
      file.padEnd(30),
      allCount.toString().padEnd(8),
      getCount.toString().padEnd(8),
      runCount.toString().padEnd(8),
      total.toString()
    );
  }
});

console.log('-'.repeat(70));
console.log(
  'TOTAL'.padEnd(30),
  totalAll.toString().padEnd(8),
  totalGet.toString().padEnd(8),
  totalRun.toString().padEnd(8),
  (totalAll + totalGet + totalRun).toString()
);

console.log('\n📝 Conversion Estimate:');
console.log(`   Total database calls to convert: ${totalAll + totalGet + totalRun}`);
console.log(`   Estimated time: ${Math.ceil((totalAll + totalGet + totalRun) / 10)}-${Math.ceil((totalAll + totalGet + totalRun) / 5)} hours`);
console.log(`   (Assuming 5-10 minutes per conversion)`);
