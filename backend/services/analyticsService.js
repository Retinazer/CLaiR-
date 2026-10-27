const store = require('../data/store');
const { generateForecast, SPARSE_DAILY_THRESHOLD, RICH_DAILY_THRESHOLD } = require('./forecastingEngine');

/**
 * Calculates the dynamic reorder point for an inventory item automatically via supply chain algorithm:
 * ROP = (Average Daily Demand * Lead Time) + Safety Stock
 * where Safety Stock = Z * sqrt(Lead Time) * StdDev(Daily Demand)
 * Z = 1.65 (95% cycle service level)
 * Lead time defaults to 3 days (or from matching supplier).
 */
function calculateItemMetrics(item, sales = [], suppliers = []) {
  const itemName = String(item.name || '').trim().toLowerCase();
  const itemSku = String(item.sku || '').trim().toLowerCase();

  // Determine supplier lead time (default 3 days if not specified or linked)
  let leadTime = 3;
  if (Array.isArray(suppliers) && suppliers.length > 0) {
    const matchedSup = suppliers.find((s) => {
      const supCat = String(s.category || '').toLowerCase();
      const supName = String(s.name || '').toLowerCase();
      return supCat.includes(itemName) || itemName.includes(supCat) || supName.includes(itemName);
    });
    if (matchedSup && Number(matchedSup.leadTimeDays)) {
      leadTime = Math.max(1, Number(matchedSup.leadTimeDays));
    }
  }

  // Filter sales for this item
  const itemSales = (sales || []).filter((s) => {
    const sItem = String(s.item || '').trim().toLowerCase();
    return sItem === itemName || sItem === itemSku;
  });

  let dailyDemand = 0;
  let stdDevDemand = 0;
  let autoReorder = 0;
  let safetyStock = 0;

  if (itemSales.length > 0) {
    const dailyMap = {};
    itemSales.forEach((s) => {
      const d = s.date;
      dailyMap[d] = (dailyMap[d] || 0) + (Number(s.qty) || 0);
    });

    const dates = Object.keys(dailyMap).sort();
    const firstDate = new Date(dates[0] + 'T12:00:00Z');
    const lastDate = new Date(dates[dates.length - 1] + 'T12:00:00Z');
    const spanDays = Math.max(1, Math.round((lastDate - firstDate) / 864e5) + 1);

    const dailyVals = Object.values(dailyMap);
    const totalQty = dailyVals.reduce((a, b) => a + b, 0);
    dailyDemand = totalQty / spanDays;

    let sumSqDiff = 0;
    dailyVals.forEach((v) => {
      sumSqDiff += Math.pow(v - dailyDemand, 2);
    });
    const zeroDays = Math.max(0, spanDays - dailyVals.length);
    sumSqDiff += zeroDays * Math.pow(0 - dailyDemand, 2);

    stdDevDemand = Math.sqrt(sumSqDiff / spanDays);

    // Z = 1.65 (95% Service Level)
    const Z = 1.65;
    safetyStock = Math.ceil(Z * Math.sqrt(leadTime) * stdDevDemand);
    safetyStock = Math.max(1, safetyStock, Math.ceil(dailyDemand * 0.5));

    const leadTimeDemand = dailyDemand * leadTime;
    autoReorder = Math.ceil(leadTimeDemand + safetyStock);
  } else {
    // Cold start (no sales transactions logged yet for this item):
    // Auto-configure baseline reorder point from on-hand stock or standard safety threshold
    const onHand = Number(item.qty) || 0;
    autoReorder = Math.max(2, Math.round(onHand * 0.25));
    safetyStock = Math.max(1, Math.round(autoReorder * 0.4));
    dailyDemand = 0;
  }

  autoReorder = Math.max(1, autoReorder);

  const daysOfStock = dailyDemand > 0 ? Math.round(item.qty / dailyDemand) : null;
  const suggestedQty = Math.max(0, autoReorder * 2 - item.qty);

  let status = 'good';
  if (item.qty <= 0 || item.qty < autoReorder / 2) {
    status = 'critical';
  } else if (item.qty < autoReorder) {
    status = 'low';
  }

  // Expiry & Spoilage Risk Forecasting
  const todayStr = store.getCurrentDate ? store.getCurrentDate() : new Date().toISOString().slice(0, 10);
  const expiryDate = item.expiryDate || null;
  let daysToExpiry = null;
  let expiryStatus = 'none'; // 'none' | 'safe' | 'warning' | 'critical' | 'expired'
  let unitsAtRisk = 0;
  let projectedSalesBeforeExpiry = 0;
  let expiryRiskPercent = 0;
  let expiryRecommendation = '';

  if (expiryDate) {
    const today = new Date(todayStr + 'T12:00:00Z');
    const exp = new Date(expiryDate + 'T12:00:00Z');
    if (!isNaN(exp)) {
      daysToExpiry = Math.ceil((exp - today) / 864e5);
      if (daysToExpiry < 0) {
        expiryStatus = 'expired';
        unitsAtRisk = Number(item.qty) || 0;
        expiryRiskPercent = 100;
        expiryRecommendation = `Expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? '' : 's'} ago. Remove from active stock and route to partner.`;
      } else if (daysToExpiry === 0) {
        expiryStatus = 'critical';
        unitsAtRisk = Number(item.qty) || 0;
        expiryRiskPercent = 100;
        expiryRecommendation = 'Expires today! Mark down immediately or prepare for recovery.';
      } else {
        projectedSalesBeforeExpiry = Math.round(dailyDemand * daysToExpiry);
        unitsAtRisk = Math.max(0, (Number(item.qty) || 0) - projectedSalesBeforeExpiry);
        expiryRiskPercent = item.qty > 0 ? Math.round((unitsAtRisk / item.qty) * 100) : 0;

        if (unitsAtRisk > 0) {
          if (daysToExpiry <= 5) {
            expiryStatus = 'critical';
            expiryRecommendation = `High spoilage risk: ${unitsAtRisk} ${item.unit} won't sell before expiry (${daysToExpiry}d left). Run 30% flash promo.`;
          } else {
            expiryStatus = 'warning';
            expiryRecommendation = `Moderate risk: ${unitsAtRisk} ${item.unit} surplus expected at expiry (${daysToExpiry}d left). Bundle or promote.`;
          }
        } else {
          expiryStatus = 'safe';
          const bufferDays = daysOfStock != null ? Math.max(0, daysToExpiry - daysOfStock) : daysToExpiry;
          expiryRecommendation = `Healthy turnover: Entire stock projected to sell ~${bufferDays} days before expiry.`;
        }
      }
    }
  }

  return {
    ...item,
    reorder: autoReorder,
    autoReorder,
    reorderAuto: true,
    leadTimeDays: leadTime,
    safetyStock,
    dailyDemand: Math.round(dailyDemand * 10) / 10,
    daysOfStock,
    suggestedQty,
    status,
    expiryDate,
    daysToExpiry,
    expiryStatus,
    unitsAtRisk,
    projectedSalesBeforeExpiry,
    expiryRiskPercent,
    expiryRecommendation
  };
}

function getEnhancedInventory() {
  const inventory = store.getInventory();
  const sales = store.getSales();
  const suppliers = store.getSuppliers();
  return inventory.map((it) => calculateItemMetrics(it, sales, suppliers));
}

function getItemStatus(item) {
  if (item.status) return item.status;
  const sales = store.getSales();
  const suppliers = store.getSuppliers();
  const enhanced = calculateItemMetrics(item, sales, suppliers);
  return enhanced.status;
}

function getStatusCounts(inventory) {
  const counts = { critical: 0, low: 0, good: 0, total: inventory.length };
  inventory.forEach((item) => {
    counts[item.status || getItemStatus(item)]++;
  });
  return counts;
}

function getOverviewData() {
  const inventory = getEnhancedInventory();
  const sales = store.getSales();
  const profile = store.getProfile();
  const simulationState = store.getSimulationState
    ? store.getSimulationState()
    : { isSimulated: false, currentDate: new Date().toISOString().slice(0, 10), dayOffset: 0 };

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
    .filter((it) => it.status !== 'good')
    .sort((a, b) => (a.status === 'critical' ? 0 : 1) - (b.status === 'critical' ? 0 : 1))
    .slice(0, 3)
    .map((it) => ({
      ...it,
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
    forecast: forecastInfo,
    expiryForecast: getExpiryForecast()
  };
}

function getExpiryForecast() {
  const inventory = getEnhancedInventory();
  const tracked = inventory.filter((it) => it.expiryDate);
  const atRisk = tracked.filter((it) => it.unitsAtRisk > 0 || it.expiryStatus === 'expired');
  const critical = tracked.filter((it) => it.expiryStatus === 'critical' || it.expiryStatus === 'expired');
  const totalUnitsAtRisk = atRisk.reduce((acc, it) => acc + (it.unitsAtRisk || 0), 0);

  return {
    totalTracked: tracked.length,
    atRiskCount: atRisk.length,
    criticalCount: critical.length,
    totalUnitsAtRisk,
    items: tracked.sort((a, b) => (a.daysToExpiry ?? 999) - (b.daysToExpiry ?? 999))
  };
}

function getRestockRecommendations() {
  const inventory = getEnhancedInventory();
  return inventory
    .filter((it) => it.qty < it.reorder)
    .map((it) => ({
      ...it,
      suggestedQty: Math.max(0, it.reorder * 2 - it.qty)
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
  calculateItemMetrics,
  getEnhancedInventory,
  getItemStatus,
  getStatusCounts,
  getOverviewData,
  getRestockRecommendations,
  getSalesSummary,
  getExpiryForecast
};

