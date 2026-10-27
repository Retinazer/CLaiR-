const store = require('../data/store');
const { generateForecast, SPARSE_THRESHOLD, RICH_THRESHOLD } = require('./forecastingEngine');

function getItemStatus(item) {
  if (item.qty <= 0 || item.qty < item.reorder / 2) return 'critical';
  if (item.qty < item.reorder) return 'low';
  return 'good';
}

function getStatusCounts(inventory) {
  const counts = { critical: 0, low: 0, good: 0, total: inventory.length };
  inventory.forEach((item) => {
    counts[getItemStatus(item)]++;
  });
  return counts;
}

function getOverviewData() {
  const inventory = store.getInventory();
  const sales = store.getSales();
  const profile = store.getProfile();

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const counts = getStatusCounts(inventory);

  const todayStr = now.toISOString().slice(0, 10);
  const todaySales = sales.filter((s) => s.date === todayStr);
  const todayDemand = todaySales.reduce((acc, s) => acc + (Number(s.qty) || 0), 0);

  // Run dynamic forecasting engine to evaluate active model and threshold
  const forecastInfo = generateForecast(sales, 7);

  let reliability = 'Awaiting Data';
  let reliabilityClass = '';
  let reliabilityText = `Need >= ${SPARSE_THRESHOLD} days for ETS`;

  if (forecastInfo.activeModel === 'SARIMAX') {
    reliability = 'SARIMAX';
    reliabilityClass = 'green';
    reliabilityText = `${forecastInfo.thresholds.currentPoints} days · Rich Regime (>=${RICH_THRESHOLD})`;
  } else if (forecastInfo.activeModel === 'ETS') {
    reliability = 'ETS';
    reliabilityClass = 'blue';
    reliabilityText = `${forecastInfo.thresholds.currentPoints} days · Sparse (need ${forecastInfo.thresholds.pointsNeededForRich} more for SARIMAX)`;
  } else if (forecastInfo.thresholds.currentPoints > 0) {
    reliability = 'Collecting';
    reliabilityClass = '';
    reliabilityText = `${forecastInfo.thresholds.currentPoints} / ${SPARSE_THRESHOLD} days for ETS`;
  }

  const urgentItems = inventory
    .filter((it) => getItemStatus(it) !== 'good')
    .sort((a, b) => (getItemStatus(a) === 'critical' ? 0 : 1) - (getItemStatus(b) === 'critical' ? 0 : 1))
    .slice(0, 3)
    .map((it) => ({
      ...it,
      status: getItemStatus(it),
      suggestedQty: Math.max(0, it.reorder - it.qty)
    }));

  return {
    greeting: greeting + (profile.name ? `, ${profile.name}` : ''),
    date: todayStr,
    riskCount: counts.critical + counts.low,
    healthyCount: counts.good,
    todayDemand,
    todayTransactions: todaySales.length,
    reliability,
    reliabilityClass,
    reliabilityText,
    urgentCount: counts.critical + counts.low,
    urgentItems,
    forecast: forecastInfo
  };
}

function getRestockRecommendations() {
  const inventory = store.getInventory();
  return inventory
    .filter((it) => it.qty < it.reorder)
    .map((it) => ({
      ...it,
      status: getItemStatus(it),
      suggestedQty: it.reorder - it.qty
    }));
}

function getSalesSummary(days = 30) {
  const sales = store.getSales();
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const inRange = sales.filter((s) => {
    const d = new Date(s.date);
    return !isNaN(d) && d >= start && d <= end;
  });

  const txCount = inRange.length;
  const unitsSold = inRange.reduce((acc, s) => acc + (Number(s.qty) || 0), 0);
  const revenue = inRange.reduce((acc, s) => acc + (Number(s.rev) || 0), 0);

  const prodCounts = {};
  inRange.forEach((s) => {
    prodCounts[s.item] = (prodCounts[s.item] || 0) + (Number(s.qty) || 0);
  });

  let topProduct = '—';
  let maxQty = 0;
  for (const [p, q] of Object.entries(prodCounts)) {
    if (q > maxQty) {
      maxQty = q;
      topProduct = p;
    }
  }

  const sortedSales = [...inRange].sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    days,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    txCount,
    unitsSold,
    revenue,
    topProduct,
    transactions: sortedSales
  };
}

module.exports = {
  getItemStatus,
  getStatusCounts,
  getOverviewData,
  getRestockRecommendations,
  getSalesSummary
};
