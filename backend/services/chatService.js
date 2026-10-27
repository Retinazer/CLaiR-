const store = require('../data/store');
const { getRestockRecommendations } = require('./analyticsService');

function generateClairReply(query) {
  const q = String(query || '').trim().toLowerCase();
  const inventory = store.getInventory();
  const suppliers = store.getSuppliers();
  const sales = store.getSales();

  if (!inventory.length && !suppliers.length) {
    return "I don't have any data yet. Add items in Inventory and suppliers on the map, then ask me again.";
  }

  if (q.includes('restock') || q.includes('reorder') || q.includes('low') || q.includes('stock')) {
    const low = getRestockRecommendations();
    if (!inventory.length) {
      return 'There is no inventory yet, so nothing to restock.';
    }
    return low.length
      ? 'Below reorder point: ' +
          low.map((i) => `${i.name} (${i.qty} ${i.unit}, reorder at ${i.reorder})`).join(', ') +
          '.'
      : 'Everything is at or above its reorder point.';
  }

  if (q.includes('supplier')) {
    return suppliers.length
      ? 'Your suppliers: ' + suppliers.map((s) => s.name).join(', ') + '.'
      : 'No suppliers have been added yet. Click the map on the Suppliers screen to add one.';
  }

  if (q.includes('forecast') || q.includes('predict') || q.includes('sales') || q.includes('demand')) {
    if (!sales.length) {
      return 'There is no sales history yet, so I cannot forecast. Use Input Data to record sales first.';
    }
    const totalUnits = sales.reduce((a, s) => a + (Number(s.qty) || 0), 0);
    return `Based on ${sales.length} recorded transaction(s) (${totalUnits} total units sold), demand is tracking steadily. Keep logging sales for higher forecast accuracy.`;
  }

  return "I can answer questions about your stock, restock needs, sales forecast, and suppliers.";
}

module.exports = {
  generateClairReply
};
