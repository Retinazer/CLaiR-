const store = require('../data/store');
const { getRestockRecommendations } = require('./analyticsService');
const { generateForecast } = require('./forecastingEngine');

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

  if (q.includes('forecast') || q.includes('predict') || q.includes('sarimax') || q.includes('ets') || q.includes('sales') || q.includes('demand')) {
    if (!sales.length) {
      return 'There is no sales history yet, so I cannot forecast. Use Input Data to record sales first.';
    }
    const fc = generateForecast(sales, 7);
    const sumPred = fc.forecast.predictions.reduce((a, b) => a + b, 0);
    const avgPred = (sumPred / (fc.forecast.predictions.length || 1)).toFixed(1);

    if (fc.activeModel === 'SARIMAX') {
      return `Currently using SARIMAX (${fc.thresholds.currentPoints} days of rich data >= ${fc.thresholds.richThreshold}). Accounting for weekly seasonality (s=7) and weekend trends, projected next 7-day demand is ~${Math.round(sumPred)} units (avg ${avgPred}/day) with MAE ${fc.metrics.mae}.`;
    }
    if (fc.activeModel === 'ETS') {
      return `Currently using ETS (Exponential Smoothing) due to sparse data (${fc.thresholds.currentPoints} days < ${fc.thresholds.richThreshold} threshold). Need ${fc.thresholds.pointsNeededForRich} more days to unlock SARIMAX. Projected 7-day demand is ~${Math.round(sumPred)} units (avg ${avgPred}/day).`;
    }
    return `Currently collecting sales data (${fc.thresholds.currentPoints} / ${fc.thresholds.sparseThreshold} days). Need ${Math.max(0, fc.thresholds.sparseThreshold - fc.thresholds.currentPoints)} more days of data to engage ETS smoothing.`;
  }

  return "I can answer questions about your stock, restock needs, demand forecasts (ETS & SARIMAX), and suppliers.";
}

module.exports = {
  generateClairReply
};
