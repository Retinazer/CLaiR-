const store = require('../data/store');
const { generateForecast, SPARSE_DAILY_THRESHOLD, RICH_DAILY_THRESHOLD } = require('./forecastingEngine');

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
  const simulationState = store.getSimulationState ? store.getSimulationState() : { isSimulated: false, currentDate: new Date().toISOString().slice(0, 10), dayOffset: 0 };

  const now = new Date(simulationState.currentDate + 'T12:00:00');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const counts = getStatusCounts(inventory);

  const todayStr = simulationState.currentDate;
  const todaySales = sales.filter((s) => s.date === todayStr);
  const todayDemand = todaySales.reduce((acc, s) => acc + (Number(s.qty) || 0), 0);

  // Run dynamic forecasting engine to evaluate 2D matrix (Volume + Temporal Cycles)
  const forecastInfo = generateForecast(sales, { horizon: 7, granularity: 'daily' });

  let reliability = 'Awaiting Data';
  let reliabilityClass = '';
  let reliabilityText = `Need >= ${forecastInfo.thresholds.minSteps} days and >= ${forecastInfo.thresholds.minTransactions} tx`;

  if (forecastInfo.activeModel === 'SARIMAX') {
    reliability = 'SARIMAX';
    reliabilityClass = 'green';
    reliabilityText = `${forecastInfo.thresholds.currentSteps} days · ${forecastInfo.dataVolume.totalTransactions} tx (Rich Regime)`;
  } else if (forecastInfo.activeModel === 'CROSTON') {
    reliability = 'Croston';
    reliabilityClass = 'purple';
    reliabilityText = `${forecastInfo.dataVolume.intermittencyPercent}% zero-demand · Intermittent Demand`;
  } else if (forecastInfo.activeModel === 'ETS') {
    reliability = 'ETS';
    reliabilityClass = 'blue';
    reliabilityText = `${forecastInfo.thresholds.currentSteps} days · ${forecastInfo.dataVolume.totalTransactions} tx (Sparse/Moderate)`;
  } else if (forecastInfo.thresholds.currentSteps > 0) {
    reliability = 'Collecting';
    reliabilityClass = '';
    reliabilityText = `${forecastInfo.thresholds.currentSteps} / ${forecastInfo.thresholds.minSteps} days (${forecastInfo.dataVolume.totalTransactions} tx)`;
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
    simulation: simulationState,
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
  const currentDateStr = store.getCurrentDate ? store.getCurrentDate() : new Date().toISOString().slice(0, 10);
  const end = new Date(currentDateStr + 'T23:59:59.999');
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  start.setHours(0, 0, 0, 0);

  const inRange = sales.filter((s) => {
    const d = new Date(s.date + 'T12:00:00');
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
