/**
 * CLaiR — Forecast Threshold Demo & Testing Script
 * 
 * Usage:
 *   node backend/scripts/seed-demo.js sparse   # Seeds 5 days of sales -> Activates ETS
 *   node backend/scripts/seed-demo.js rich     # Seeds 18 days of sales -> Activates SARIMAX
 *   node backend/scripts/seed-demo.js clear    # Clears data back to empty state
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../data/db.json');
const mode = process.argv[2] || 'sparse';

const today = new Date();

function generateSales(daysCount) {
  const sales = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 864e5);
    const dateStr = d.toISOString().slice(0, 10);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const baseDemand = 14 + (isWeekend ? 8 : 0) + Math.round(Math.sin(i) * 3);

    sales.push({
      id: 'demo_' + Math.random().toString(36).substr(2, 6),
      date: dateStr,
      item: 'Arabica Coffee Beans',
      qty: Math.max(5, baseDemand),
      rev: Math.max(5, baseDemand) * 25000
    });
  }
  return sales;
}

let db = {
  inventory: [
    { sku: 'COF-01', name: 'Arabica Coffee Beans', qty: 45, unit: 'kg', reorder: 20 },
    { sku: 'MLK-02', name: 'Oat Milk Barista', qty: 12, unit: 'cartons', reorder: 15 }
  ],
  sales: [],
  suppliers: [
    { name: 'Kopi Sumatra Roasters', category: 'Coffee', lat: -6.2088, lng: 106.8456 }
  ],
  profile: {
    name: 'Alex',
    business: 'Artisan Cafe',
    role: 'Owner',
    locale: 'English',
    currency: 'IDR'
  }
};

if (mode === 'sparse') {
  db.sales = generateSales(5);
  console.log('\n🟢 Seeded 5 days of sales data.');
  console.log('👉 Threshold Status: SPARSE REGIME (3 <= N < 14) -> ETS (Holt-Winters) ACTIVE.');
} else if (mode === 'rich') {
  db.sales = generateSales(18);
  console.log('\n🟢 Seeded 18 days of sales data.');
  console.log('👉 Threshold Status: RICH REGIME (N >= 14) -> SARIMAX (1,1,1)x(1,1,0)[7] ACTIVE.');
} else if (mode === 'clear') {
  db.sales = [];
  console.log('\n🧹 Cleared all sales transactions back to empty state.');
  console.log('👉 Threshold Status: COLD START (N < 3) -> AWAITING DATA.');
} else {
  console.log('Unknown mode. Use: sparse | rich | clear');
  process.exit(1);
}

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
console.log('🔄 Open http://localhost:3000 to see the live chart and badges update!\n');
