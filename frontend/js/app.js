/**
 * CLaiR — Main Application Logic & Screen Controllers
 */

// Global State
let inventory = [];
let suppliers = [];
let salesData = { transactions: [], txCount: 0, unitsSold: 0, revenue: 0, topProduct: '—' };
let profile = { name: '', business: '', role: 'Owner', locale: 'English', currency: 'IDR' };
let userPos = null; // { lat, lng }
let fcRange = '1d';
let fcGranularity = 'daily';
let invFilter = 'all';
let invQuery = '';
let histDays = 30;
let map = null;
let markerLayer = null;
let youMarker = null;

const DEFAULT_CENTER = [-6.2088, 106.8456]; // Jakarta fallback center

// ============================================================================
// Core Navigation & Landing Page
// ============================================================================

function enterApp() {
  document.body.classList.add('in-app');
  history.replaceState(null, '', '#app');
}

function goHome() {
  document.body.classList.remove('in-app');
  history.replaceState(null, '', location.pathname);
}

function goScreen(name) {
  const b = document.querySelector(`.nav-item[data-screen="${name}"]`);
  if (b) b.click();
}

// ============================================================================
// Data Synchronization
// ============================================================================

async function syncProfile() {
  try {
    profile = await API.getProfile();
    window.currentProfile = profile;
    applyProfile();
  } catch (err) {
    console.error('Error syncing profile:', err);
  }
}

async function syncInventory() {
  try {
    inventory = await API.getInventory();
    renderInventory();
    renderRestock();
    updateDatalists();
  } catch (err) {
    console.error('Error syncing inventory:', err);
  }
}

async function syncSales() {
  try {
    salesData = await API.getSales(histDays);
    renderHistory();
  } catch (err) {
    console.error('Error syncing sales:', err);
  }
}

async function syncSuppliers() {
  try {
    suppliers = await API.getSuppliers();
    renderSuppliers();
  } catch (err) {
    console.error('Error syncing suppliers:', err);
  }
}

async function syncAll() {
  await Promise.all([syncProfile(), syncInventory(), syncSales(), syncSuppliers()]);
  await renderOverview();
}

function updateDatalists() {
  const opts = inventory
    .map((it) => `<option value="${esc(it.name)}">${esc(it.sku)} (${it.qty} ${esc(it.unit)} on hand)</option>`)
    .join('');
  if ($('hist-item-list')) $('hist-item-list').innerHTML = opts;
}

// ============================================================================
// Overview & Forecast
// ============================================================================

function renderSvgForecast(fc) {
  const L = 52, R = 675, T = 22, B = 222;
  const historyVals = (fc && fc.timeline && fc.timeline.values) || [];
  const historyDates = (fc && fc.timeline && fc.timeline.dates) || [];
  const predVals = (fc && fc.forecast && fc.forecast.predictions) || [];
  const predDates = (fc && fc.forecast && fc.forecast.dates) || [];
  const lowerVals = (fc && fc.forecast && fc.forecast.lower) || [];
  const upperVals = (fc && fc.forecast && fc.forecast.upper) || [];

  const nh = historyVals.length;
  const nf = predVals.length;
  const n = nh + nf;

  // Empty state fallback
  if (nh === 0) {
    const ticks = [100, 75, 50, 25, 0];
    let g = '';
    ticks.forEach((v, i) => {
      const y = T + ((B - T) * i) / (ticks.length - 1);
      g +=
        `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${v === 0 ? '#007AFF' : '#D0E4F7'}" stroke-width="${v === 0 ? 1.5 : 1}"/>` +
        `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#64748B">${v}</text>`;
    });
    g += `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#007AFF" stroke-width="1.5"/>`;
    g += `<text x="${(L + R) / 2}" y="${(T + B) / 2}" text-anchor="middle" font-size="13" font-weight="500" fill="#64748B">No sales recorded yet. Log sales transactions to activate ETS and SARIMAX forecasting.</text>`;
    $('fc-svg').innerHTML = g;
    return;
  }

  // Calculate Y axis scale
  const allVals = [...historyVals, ...predVals, ...upperVals];
  const maxRaw = Math.max(...allVals, 10);
  const stepMagnitude = Math.pow(10, Math.floor(Math.log10(maxRaw)));
  const ceiling = Math.ceil((maxRaw * 1.15) / (stepMagnitude / 2)) * (stepMagnitude / 2) || 10;

  const yTicks = [
    ceiling,
    Math.round(ceiling * 0.75),
    Math.round(ceiling * 0.5),
    Math.round(ceiling * 0.25),
    0
  ];

  let g = '';

  // Draw Horizontal Gridlines & Y labels
  yTicks.forEach((v, i) => {
    const y = T + ((B - T) * i) / (yTicks.length - 1);
    g +=
      `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${v === 0 ? '#007AFF' : '#E2E8F0'}" stroke-width="${v === 0 ? 1.5 : 1}"/>` +
      `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="11" font-weight="500" fill="#64748B">${v}</text>`;
  });

  const dx = (R - L) / Math.max(1, n - 1);

  // Compute (x, y) coordinates for history
  const historyPoints = historyVals.map((v, i) => {
    const x = L + i * dx;
    const y = B - (v / ceiling) * (B - T);
    return { x, y, val: v, date: historyDates[i] };
  });

  // Compute (x, y) coordinates for forecast
  const forecastPoints = predVals.map((v, i) => {
    const x = L + (nh + i) * dx;
    const y = B - (v / ceiling) * (B - T);
    const yLow = B - (Math.max(0, lowerVals[i] || 0) / ceiling) * (B - T);
    const yUp = B - (Math.max(0, upperVals[i] || 0) / ceiling) * (B - T);
    return { x, y, yLow, yUp, val: v, date: predDates[i], lower: lowerVals[i], upper: upperVals[i] };
  });

  // 1. Shaded Confidence Interval Ribbon (Upper polygon connecting to Lower)
  if (forecastPoints.length > 0) {
    const lastHist = historyPoints[historyPoints.length - 1];
    const upperRibbon = [
      `${lastHist.x.toFixed(1)},${lastHist.y.toFixed(1)}`,
      ...forecastPoints.map((p) => `${p.x.toFixed(1)},${p.yUp.toFixed(1)}`)
    ];
    const lowerRibbon = [
      ...forecastPoints.slice().reverse().map((p) => `${p.x.toFixed(1)},${p.yLow.toFixed(1)}`),
      `${lastHist.x.toFixed(1)},${lastHist.y.toFixed(1)}`
    ];
    const polyPoints = [...upperRibbon, ...lowerRibbon].join(' ');
    g += `<polygon points="${polyPoints}" fill="rgba(83, 197, 248, 0.22)" stroke="none"/>`;
  }

  // 2. Today / Forecast Horizon Dividing Line
  if (historyPoints.length > 0 && forecastPoints.length > 0) {
    const splitX = historyPoints[historyPoints.length - 1].x;
    g += `<line x1="${splitX.toFixed(1)}" y1="${T}" x2="${splitX.toFixed(1)}" y2="${B}" stroke="#53C5F8" stroke-dasharray="3 3" stroke-width="1.5" opacity="0.8"/>`;
    g += `<text x="${(splitX + 4).toFixed(1)}" y="${T + 10}" font-size="10" font-weight="700" fill="#007AFF" letter-spacing="0.05em">PROJECTED ▶</text>`;
  }

  // 3. Historical Actual Sales Line & Dots
  if (historyPoints.length > 0) {
    const histPath = historyPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    g += `<polyline points="${histPath}" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    historyPoints.forEach((p) => {
      g += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#007AFF" stroke="#FFFFFF" stroke-width="2">` +
        `<title>${esc(p.date)}: ${p.val} units (Actual)</title></circle>`;
    });
  }

  // 4. Forecast Projected Sales Line & Dots
  if (forecastPoints.length > 0) {
    const lastHist = historyPoints[historyPoints.length - 1];
    const fcPath = [
      `${lastHist.x.toFixed(1)},${lastHist.y.toFixed(1)}`,
      ...forecastPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    ].join(' ');
    g += `<polyline points="${fcPath}" fill="none" stroke="#53C5F8" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>`;
    forecastPoints.forEach((p) => {
      g += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#FFFFFF" stroke="#53C5F8" stroke-width="2.5">` +
        `<title>${esc(p.date)}: ${p.val} units [${p.lower} - ${p.upper}] (Predicted by ${esc(fc.activeModel)})</title></circle>`;
    });
  }

  // 5. X Axis baseline & ticks
  g += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#007AFF" stroke-width="1.5"/>`;
  g += `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#007AFF" stroke-width="1.5"/>`;

  // Draw X labels periodically
  const allPoints = [...historyPoints, ...forecastPoints];
  const labelInterval = Math.max(1, Math.ceil(allPoints.length / 8));
  allPoints.forEach((p, i) => {
    if (i % labelInterval === 0 || i === allPoints.length - 1) {
      const d = new Date(p.date);
      const labelText = isNaN(d) ? p.date : fmtMD(d);
      g += `<line x1="${p.x.toFixed(1)}" y1="${B}" x2="${p.x.toFixed(1)}" y2="${B + 5}" stroke="#007AFF"/>` +
        `<text x="${p.x.toFixed(1)}" y="${B + 18}" text-anchor="middle" font-size="11" font-weight="500" fill="#64748B">${labelText}</text>`;
    }
  });

  $('fc-svg').innerHTML = g;
}

async function renderForecastChart() {
  try {
    const fc = await API.getForecast(fcRange, fcGranularity);
    if (!fc) return;

    // Update Model Badge
    const badge = $('fc-model-badge');
    const pill = $('fc-threshold-pill');
    const insights = $('fc-insights');

    if (badge) {
      badge.className = 'model-badge';
      if (fc.activeModel === 'SARIMAX') {
        badge.classList.add('sarimax');
        badge.innerHTML = '<i class="fa-solid fa-chart-line"></i> SARIMAX Active';
      } else if (fc.activeModel === 'CROSTON') {
        badge.classList.add('croston');
        badge.innerHTML = '<i class="fa-solid fa-calculator"></i> Croston Active';
      } else if (fc.activeModel === 'ETS') {
        badge.classList.add('ets');
        badge.innerHTML = '<i class="fa-solid fa-chart-simple"></i> ETS Active';
      } else {
        badge.innerHTML = '<i class="fa-solid fa-clock"></i> Awaiting Data';
      }
    }

    if (pill) {
      const stepUnit = fc.granularity === 'hourly' ? 'hrs' : 'days';
      if (fc.activeModel === 'SARIMAX') {
        pill.textContent = `${fc.thresholds.currentSteps} ${stepUnit} · ${fc.dataVolume.totalTransactions} tx (Rich Regime)`;
      } else if (fc.activeModel === 'CROSTON') {
        pill.textContent = `${fc.dataVolume.intermittencyPercent}% zero-demand (${fc.dataVolume.totalTransactions} tx · Intermittent)`;
      } else if (fc.activeModel === 'ETS') {
        pill.textContent = `${fc.thresholds.currentSteps} ${stepUnit} · ${fc.dataVolume.totalTransactions} tx (Sparse/Moderate)`;
      } else {
        pill.textContent = `${fc.thresholds.currentSteps} / ${fc.thresholds.minSteps} ${stepUnit} (${fc.dataVolume.totalTransactions} tx)`;
      }
    }

    if (insights) {
      if (fc.activeModel === 'NONE') {
        insights.style.display = 'none';
      } else {
        insights.style.display = 'flex';
        const sumPred = fc.forecast.predictions.reduce((a, b) => a + b, 0);
        const stepUnit = fc.granularity === 'hourly' ? 'hours' : 'days';
        insights.innerHTML = `
        <div class="fi-top">
          <div class="fi-title">
            <i class="fa-solid fa-chart-line" style="color:var(--primary)"></i>
            <span>${esc(fc.activeModel)} (${esc(fc.granularity.toUpperCase())})</span>
          </div>
          <span class="threshold-pill">2D Volume &amp; Temporal Cycles Matrix</span>
        </div>
        <div class="fi-desc">${esc(fc.rationale)}</div>
        <div class="threshold-bar">
          <div class="threshold-progress" style="width: ${fc.thresholds.progressPercent}%"></div>
        </div>
        <div class="threshold-markers">
          <span>0 (Start)</span>
          <span>Threshold 1: ${fc.thresholds.minSteps} ${stepUnit} (ETS)</span>
          <span>Threshold 2: ${fc.thresholds.richSteps} ${stepUnit} &amp; ${fc.thresholds.richTransactions} tx (SARIMAX)</span>
        </div>
        <div class="fi-metrics">
          <div class="fi-metric">Active Model: <b>${esc(fc.metrics.modelDetails || fc.activeModel)}</b></div>
          <div class="fi-metric">Data Volume: <b>${fc.dataVolume.totalTransactions} tx (${fc.dataVolume.totalQuantity} units)</b></div>
          <div class="fi-metric">Demand Density: <b>${100 - fc.dataVolume.intermittencyPercent}% active (${fc.dataVolume.intermittencyPercent}% zeros)</b></div>
          <div class="fi-metric">Mean Absolute Error (MAE): <b>${fc.metrics.mae}</b></div>
          <div class="fi-metric">Projected Period Demand: <b>${Math.round(sumPred)} units</b></div>
        </div>
      `;
      }
    }

    renderSvgForecast(fc);
  } catch (err) {
    console.error('Forecast render error:', err);
  }
}

async function renderOverview() {
  await renderForecastChart();

  try {
    const ov = await API.getOverview();
    $('ov-greet').textContent = ov.greeting;

    if (ov.simulation && ov.simulation.isSimulated) {
      if ($('sim-badge')) $('sim-badge').style.display = 'inline-flex';
      if ($('sim-reset-btn')) $('sim-reset-btn').style.display = 'inline-flex';
      $('ov-date').textContent = fmtToday(new Date(ov.simulation.currentDate + 'T12:00:00'));
    } else {
      if ($('sim-badge')) $('sim-badge').style.display = 'none';
      if ($('sim-reset-btn')) $('sim-reset-btn').style.display = 'none';
      $('ov-date').textContent = fmtToday(new Date());
    }

    $('ov-risk').textContent = ov.riskCount;
    $('ov-good').textContent = ov.healthyCount;

    if (ov.todayDemand > 0) {
      $('ov-demand').textContent = ov.todayDemand + ' units';
      $('ov-demand').nextElementSibling.textContent =
        ov.todayTransactions + ' transaction' + (ov.todayTransactions === 1 ? '' : 's') + ' today';
    } else if (salesData.transactions && salesData.transactions.length > 0) {
      $('ov-demand').textContent = '0 units';
      $('ov-demand').nextElementSibling.textContent = 'No sales recorded today';
    } else {
      $('ov-demand').textContent = '—';
      $('ov-demand').nextElementSibling.textContent = 'No sales data yet';
    }

    $('ov-rel').textContent = ov.reliability;
    $('ov-rel').className = 'val ' + (ov.reliabilityClass || '');
    $('ov-rel').nextElementSibling.textContent = ov.reliabilityText;

    const total = ov.urgentCount;
    $('ov-count').textContent = total ? `${total} item${total === 1 ? '' : 's'} need your attention` : '';
    const host = $('ov-attn');

    if (!inventory.length) {
      host.innerHTML =
        [0, 1]
          .map(
            (i) =>
              `<div class="attn" style="border-left-color:#53C5F8;background:#EBF4FB;border-color:#D0E4F7"><span class="sk sk-pill"></span><div class="body"><span class="sk" style="width:${[38, 52][i]}%;margin-bottom:8px"></span><span class="sk" style="width:${[60, 44][i]}%;height:8px"></span></div></div>`
          )
          .join('') +
        '<div class="sk-note"><b>Nothing needs attention yet</b>Add items in Inventory and anything running low will show up here.</div>';
    } else if (!ov.urgentItems || !ov.urgentItems.length) {
      host.innerHTML = '<div class="sk-note"><b>All clear</b>Every item is above its reorder point.</div>';
    } else {
      host.innerHTML = ov.urgentItems
        .map((it) => {
          const k = it.status || statusKey(it);
          return (
            `<div class="attn ${k}">${statusPill(k)}<div class="body"><b>${esc(it.name)}</b><small>${it.qty} ${esc(it.unit)} remaining · reorder at ${it.reorder}</small></div>` +
            `<button class="${k === 'critical' ? 'btn-main' : 'btn-plain'}" data-go-restock>${k === 'critical' ? 'Restock' : 'View'}</button></div>`
          );
        })
        .join('');
      host.querySelectorAll('[data-go-restock]').forEach((b) => (b.onclick = () => goScreen('restock')));
    }
  } catch (err) {
    console.error('Overview render error:', err);
  }
}

// ============================================================================
// Inventory Management
// ============================================================================

function statusCounts() {
  const c = { critical: 0, low: 0, good: 0 };
  inventory.forEach((it) => c[statusKey(it)]++);
  return c;
}

function renderInventory() {
  const c = statusCounts(), n = inventory.length;
  $('inv-date').textContent = 'As of ' + fmtToday(new Date());
  $('inv-sub').textContent = `${n} item${n === 1 ? '' : 's'} tracked · ${c.critical + c.low} below reorder point`;
  $('inv-crit').textContent = c.critical;
  $('inv-low').textContent = c.low;
  $('inv-good').textContent = c.good;
  $('inv-total').textContent = n;

  const counts = { all: n, critical: c.critical, low: c.low, good: c.good };
  document.querySelectorAll('#inv-tabs button').forEach((b) => {
    b.querySelector('.cnt').textContent = counts[b.dataset.f];
    b.classList.toggle('on', b.dataset.f === invFilter);
  });

  const wrap = $('inv-wrap');
  const heads = ['Item', 'On hand', 'Daily demand', 'Days left', 'Trend', 'Status'];
  if (!n) {
    wrap.innerHTML = skTable(heads, 5, 'Use "+ New item" above to start tracking stock.', 'No inventory yet');
    return;
  }

  const q = invQuery.trim().toLowerCase();
  const rows = inventory
    .map((it) => ({ it, k: statusKey(it) }))
    .filter(
      (r) =>
        (invFilter === 'all' || r.k === invFilter) &&
        (!q || r.it.name.toLowerCase().includes(q) || r.it.sku.toLowerCase().includes(q))
    );

  if (!rows.length) {
    wrap.innerHTML = '<div class="sk-note"><b>No items match</b>Try a different filter or search.</div>';
    return;
  }

  wrap.innerHTML =
    '<table><thead><tr><th>Item</th><th class="r">On hand</th><th class="r">Daily demand</th><th class="r">Days left</th><th>Trend</th><th>Status</th><th></th></tr></thead><tbody>' +
    rows
      .map(
        ({ it, k }) =>
          `<tr class="row-${k}"><td><b>${esc(it.name)}</b><small>${esc(it.sku)}</small></td>` +
          `<td class="r"><span class="big">${it.qty}</span> <span class="unit">${esc(it.unit)}</span></td><td class="r dim">—</td><td class="r dim">—</td><td class="dim">—</td>` +
          `<td>${statusPill(k)}</td><td class="act"><button class="icon-btn" data-add-sku="${esc(it.sku)}" title="Add stock" style="font-size:22px">+</button>` +
          `<button class="icon-btn del" data-del-sku="${esc(it.sku)}" title="Remove item">${ico('trash', 16)}</button></td></tr>`
      )
      .join('') +
    '</tbody></table>';

  wrap.querySelectorAll('[data-add-sku]').forEach((b) => {
    b.onclick = async () => {
      const sku = b.dataset.addSku;
      const it = inventory.find((i) => i.sku === sku);
      if (!it) return;
      const v = parseInt(prompt(`Add how many ${it.unit} of ${it.name}?`), 10);
      if (!v || v <= 0) return;
      try {
        await API.updateStock(sku, v);
        toast(`Added ${v} to ${it.sku}`);
        await syncInventory();
        await renderOverview();
      } catch (err) {
        toast('Error updating stock: ' + err.message);
      }
    };
  });

  wrap.querySelectorAll('[data-del-sku]').forEach((b) => {
    b.onclick = async () => {
      const sku = b.dataset.delSku;
      if (!confirm(`Are you sure you want to delete SKU ${sku}?`)) return;
      try {
        await API.deleteInventoryItem(sku);
        toast(`Item removed`);
        await syncInventory();
        await renderOverview();
      } catch (err) {
        toast('Error deleting item: ' + err.message);
      }
    };
  });
}

// ============================================================================
// Restock Signals
// ============================================================================

function restockList() {
  return inventory.filter((it) => it.qty < it.reorder);
}

function renderRestock() {
  const wrap = $('restock-wrap');
  const low = restockList();
  if (!inventory.length) {
    wrap.innerHTML = skTable(
      ['SKU', 'Item', 'On Hand', 'Reorder Pt', 'Suggested Qty'],
      4,
      'Add items to Inventory and CLaiR will flag the ones that fall below their reorder point.',
      'Nothing to restock yet'
    );
  } else if (!low.length) {
    wrap.innerHTML = skTable(
      ['SKU', 'Item', 'On Hand', 'Reorder Pt', 'Suggested Qty'],
      3,
      'No items are below their reorder point right now.',
      'All stocked up'
    );
  } else {
    wrap.innerHTML =
      '<table><thead><tr><th>SKU</th><th>Item</th><th>On Hand</th><th>Reorder Pt</th><th>Suggested Qty</th></tr></thead><tbody>' +
      low
        .map(
          (it) =>
            `<tr><td>${esc(it.sku)}</td><td>${esc(it.name)}</td><td>${it.qty}</td><td>${it.reorder}</td><td><b>${
              it.reorder - it.qty
            }</b></td></tr>`
        )
        .join('') +
      '</tbody></table>';
  }

  const sel = $('restock-sku');
  if (sel) {
    sel.innerHTML = inventory.length
      ? inventory.map((it) => `<option value="${esc(it.sku)}">${esc(it.sku)} ${esc(it.name)}</option>`).join('')
      : '<option value="">No items yet</option>';
  }
  if ($('restock-form')) {
    $('restock-form').style.display = inventory.length ? 'flex' : 'none';
  }
}

// ============================================================================
// Sales History
// ============================================================================

function renderHistory() {
  const end = new Date(), start = new Date(end.getTime() - (histDays - 1) * 864e5);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  $('hist-range').innerHTML = ico('calendar', 16) + ' ' + fmtMD(start) + ' – ' + fmtMD(end);
  $('hist-sub').textContent = `Past ${histDays} days`;

  const txCount = salesData.txCount || (salesData.transactions ? salesData.transactions.length : 0);
  const unitsSold = salesData.unitsSold || 0;
  const revenue = salesData.revenue || 0;
  const topProd = salesData.topProduct || '—';

  $('hs-tx').textContent = txCount;
  $('hs-units').textContent = unitsSold.toLocaleString();
  $('hs-rev').textContent = txCount ? fmtMoney(revenue) : '—';
  $('hs-top').textContent = topProd;

  const wrap = $('history-card');
  const transactions = salesData.transactions || [];

  if (!transactions.length) {
    wrap.innerHTML = skTable(
      ['Date', 'Item', 'Qty', 'Revenue'],
      5,
      'Use "+ Input Data" above to record sales.',
      'No sales recorded yet'
    );
    return;
  }

  wrap.innerHTML =
    '<table><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th class="r">Revenue</th><th></th></tr></thead><tbody>' +
    transactions
      .map((s, idx) => {
        const id = s.id || idx;
        return (
          `<tr><td style="color:var(--muted);font-size:12px;">${esc(s.date)}</td>` +
          `<td><b>${esc(s.item)}</b></td>` +
          `<td class="r">${s.qty}</td>` +
          `<td class="r price"><b>${fmtMoney(s.rev)}</b></td>` +
          `<td class="act"><button class="icon-btn del" data-del-sale="${id}" title="Delete transaction">${ico(
            'trash',
            16
          )}</button></td></tr>`
        );
      })
      .join('') +
    '</tbody></table>';

  wrap.querySelectorAll('[data-del-sale]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.delSale;
      try {
        await API.deleteSale(id);
        toast('Transaction removed');
        await syncSales();
        await renderOverview();
      } catch (err) {
        toast('Error removing sale: ' + err.message);
      }
    };
  });
}

// ============================================================================
// Suppliers & Map (Leaflet)
// ============================================================================

function renderSupplierCards() {
  const host = $('supplier-cards');
  if (!suppliers.length) {
    host.innerHTML =
      [0, 1, 2]
        .map(
          (i) =>
            `<div class="sup-card sk-card"><span class="sk" style="width:${[60, 45, 70][i]}%"></span><span class="sk" style="width:${[35, 50, 30][i]}%;height:8px"></span></div>`
        )
        .join('') + '<div class="sk-note"><b>No suppliers yet</b>Click the map to pin your first supplier.</div>';
    return;
  }

  host.innerHTML = suppliers
    .map((s, i) => {
      const d = userPos ? ' · ' + distKm(userPos, s).toFixed(1) + ' km away' : '';
      const id = s.id || i;
      return (
        `<div class="sup-card"><div class="top"><b>${esc(s.name)}</b><button class="btn-sm" data-del-sup="${id}">Remove</button></div>` +
        `<div class="meta">${esc(s.category || 'Supplier')}${d}</div></div>`
      );
    })
    .join('');

  host.querySelectorAll('[data-del-sup]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.delSup;
      try {
        await API.deleteSupplier(id);
        toast('Supplier removed');
        await syncSuppliers();
      } catch (err) {
        toast('Error deleting supplier: ' + err.message);
      }
    };
  });
}

function renderMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  suppliers.forEach((s) => {
    L.circleMarker([s.lat, s.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#007AFF', fillOpacity: 1 })
      .bindTooltip(esc(s.name), { permanent: true, direction: 'bottom', offset: [0, 6] })
      .addTo(markerLayer);
  });
}

function renderSuppliers() {
  renderSupplierCards();
  renderMarkers();
}

function showSuppliers() {
  if (typeof L === 'undefined') {
    $('supplier-map').innerHTML =
      '<div class="empty-note"><b>Map could not load</b>Check your internet connection and reload the page.</div>';
    renderSupplierCards();
    return;
  }

  if (!map) {
    map = L.map('supplier-map').setView(DEFAULT_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);

    map.on('click', async (ev) => {
      const name = prompt('Supplier name?');
      if (!name || !name.trim()) return;
      const category = prompt('Category (e.g. Coffee, Dairy, Packaging)?') || '';
      try {
        await API.addSupplier({
          name: name.trim(),
          category: category.trim(),
          lat: ev.latlng.lat,
          lng: ev.latlng.lng
        });
        toast('Supplier added');
        await syncSuppliers();
      } catch (err) {
        toast('Error adding supplier: ' + err.message);
      }
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          userPos = { lat: p.coords.latitude, lng: p.coords.longitude };
          map.setView([userPos.lat, userPos.lng], 13);
          youMarker = L.circleMarker([userPos.lat, userPos.lng], {
            radius: 8,
            color: '#fff',
            weight: 2,
            fillColor: '#53C5F8',
            fillOpacity: 1
          })
            .bindTooltip('You', { permanent: true, direction: 'bottom', offset: [0, 6] })
            .addTo(map);
          renderSupplierCards();
        },
        () => {},
        { timeout: 8000 }
      );
    }
  }

  setTimeout(() => {
    map.invalidateSize();
    if (suppliers.length && !userPos) {
      map.fitBounds(
        suppliers.map((s) => [s.lat, s.lng]),
        { padding: [40, 40], maxZoom: 15 }
      );
    }
  }, 50);

  renderSuppliers();
}

// ============================================================================
// Profile & Settings
// ============================================================================

function applyProfile() {
  $('set-name').value = profile.name || '';
  $('set-biz').value = profile.business || '';
  $('set-role').value = profile.role || 'Owner';
  $('set-lang').value = profile.locale || 'English';
  $('set-curr').value = profile.currency || 'IDR';
  $('lang-top').value = profile.locale || 'English';
  $('curr-top').value = profile.currency || 'IDR';
  $('top-name').textContent = profile.name || 'Guest';
  $('top-avatar').textContent = (profile.name || '?').slice(0, 1).toUpperCase();
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Landing <-> App
  document.querySelectorAll('[data-enter]').forEach((b) => (b.onclick = enterApp));
  $('brand-home').onclick = goHome;
  if (location.hash === '#app') enterApp();

  // Landing smooth scroll
  document.querySelectorAll('[data-scroll]').forEach((b) => {
    b.onclick = () => {
      const el = $(b.dataset.scroll);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  // Drawer
  const drawer = $('drawer');
  const scrim = $('scrim');
  $('hamburger').onclick = () => {
    drawer.classList.add('open');
    scrim.classList.add('show');
  };
  $('drawer-close').onclick = () => {
    drawer.classList.remove('open');
    scrim.classList.remove('show');
  };
  scrim.onclick = () => {
    drawer.classList.remove('open');
    scrim.classList.remove('show');
  };

  // Nav Items
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.screen;
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
      $('screen-' + target).classList.add('active');
      drawer.classList.remove('open');
      scrim.classList.remove('show');
      if (target === 'suppliers') showSuppliers();
    };
  });

  // Overview restock button
  $('ov-all').onclick = () => goScreen('restock');

  // Segmented controls
  document.querySelectorAll('.seg[data-seg] button').forEach((b) => {
    b.onclick = async () => {
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      if (b.dataset.range) {
        fcRange = b.dataset.range;
        await renderForecastChart();
      }
      if (b.dataset.days) {
        histDays = Number(b.dataset.days);
        await syncSales();
      }
      if (b.dataset.f) {
        invFilter = b.dataset.f;
        renderInventory();
      }
    };
  });

  // Granularity selector
  const granSeg = $('granularity-seg');
  if (granSeg) {
    granSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        granSeg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        fcGranularity = b.dataset.gran || 'daily';
        await renderForecastChart();
      };
    });
  }

  // Simulation controls
  const simAdvBtn = $('sim-advance-btn');
  if (simAdvBtn) {
    simAdvBtn.onclick = async () => {
      simAdvBtn.disabled = true;
      try {
        const res = await API.advanceDay(true, 1);
        const count = res.generatedSales ? res.generatedSales.length : 0;
        toast(`Advanced to ${res.currentDate}! ${count} sales simulated.`);
        await Promise.all([syncSales(), syncInventory(), renderOverview()]);
      } catch (err) {
        toast('Error advancing day: ' + err.message);
      } finally {
        simAdvBtn.disabled = false;
      }
    };
  }

  const simResetBtn = $('sim-reset-btn');
  if (simResetBtn) {
    simResetBtn.onclick = async () => {
      simResetBtn.disabled = true;
      try {
        await API.resetSimulation();
        toast('Reset calendar back to real-time.');
        await Promise.all([syncSales(), syncInventory(), renderOverview()]);
      } catch (err) {
        toast('Error resetting calendar: ' + err.message);
      } finally {
        simResetBtn.disabled = false;
      }
    };
  }

  // Inline forms
  $('hist-new').onclick = () => {
    const f = $('hist-form');
    const open = f.style.display === 'none';
    f.style.display = open ? 'flex' : 'none';
    if (open) {
      if (!$('hist-date').value) $('hist-date').value = new Date().toISOString().slice(0, 10);
      $('hist-name').focus();
    }
  };

  $('hist-form').onsubmit = async (e) => {
    e.preventDefault();
    const date = $('hist-date').value;
    const item = $('hist-name').value.trim();
    const qty = $('hist-qty').value;
    const rev = $('hist-rev-in').value;
    try {
      await API.recordSale({ date, item, qty, rev });
      toast(`Recorded sale: ${item} (${qty})`);
      $('hist-form').reset();
      $('hist-date').value = new Date().toISOString().slice(0, 10);
      await Promise.all([syncSales(), syncInventory(), renderOverview()]);
    } catch (err) {
      toast('Error recording sale: ' + err.message);
    }
  };

  // Inventory search & quick new item
  $('inv-search').oninput = (e) => {
    invQuery = e.target.value;
    renderInventory();
  };

  $('inv-new').onclick = () => {
    const f = $('inv-form');
    const open = f.style.display === 'none';
    f.style.display = open ? 'flex' : 'none';
    if (open) $('inv-sku').focus();
  };

  $('inv-form').onsubmit = async (e) => {
    e.preventDefault();
    const sku = $('inv-sku').value.trim();
    const name = $('inv-name').value.trim();
    const qty = Number($('inv-qty').value);
    const unit = $('inv-unit').value.trim();
    const reorder = Number($('inv-reorder').value);
    try {
      await API.addInventoryItem({ sku, name, qty, unit, reorder });
      toast('Item added');
      $('inv-form').reset();
      $('inv-form').style.display = 'none';
      await Promise.all([syncInventory(), renderOverview()]);
    } catch (err) {
      toast('Error adding item: ' + err.message);
    }
  };

  // Restock form
  $('restock-form').onsubmit = async (e) => {
    e.preventDefault();
    const sku = $('restock-sku').value;
    const qty = parseInt($('restock-qty').value, 10) || 0;
    if (!sku || qty <= 0) return;
    try {
      await API.restockItem(sku, qty);
      toast(`Added ${qty} to ${sku}`);
      $('restock-form').reset();
      await Promise.all([syncInventory(), renderOverview()]);
    } catch (err) {
      toast('Error restocking: ' + err.message);
    }
  };

  // Chat form
  $('chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('chat-in');
    const text = input.value.trim();
    if (!text) return;

    const thread = $('chat-thread');
    const userMsg = document.createElement('div');
    userMsg.className = 'msg user';
    userMsg.textContent = text;
    thread.appendChild(userMsg);
    input.value = '';
    thread.scrollTop = thread.scrollHeight;

    try {
      const res = await API.sendChat(text);
      const botMsg = document.createElement('div');
      botMsg.className = 'msg bot';
      botMsg.textContent = res.reply;
      thread.appendChild(botMsg);
      thread.scrollTop = thread.scrollHeight;
    } catch (err) {
      const errMsg = document.createElement('div');
      errMsg.className = 'msg bot';
      errMsg.textContent = "Sorry, I couldn't process that right now.";
      thread.appendChild(errMsg);
    }
  };

  // Profile save
  $('set-save').onclick = async () => {
    const updates = {
      name: $('set-name').value.trim(),
      business: $('set-biz').value.trim(),
      role: $('set-role').value,
      locale: $('set-lang').value,
      currency: $('set-curr').value
    };
    try {
      await API.updateProfile(updates);
      profile = { ...profile, ...updates };
      window.currentProfile = profile;
      applyProfile();
      renderHistory();
      toast('Settings saved');
    } catch (err) {
      toast('Error saving settings: ' + err.message);
    }
  };

  $('lang-top').onchange = (e) => {
    $('set-lang').value = e.target.value;
  };

  $('curr-top').onchange = async (e) => {
    $('set-curr').value = e.target.value;
    profile.currency = e.target.value;
    window.currentProfile = profile;
    renderHistory();
  };

  // Initialize data-ico SVGs
  document.querySelectorAll('[data-ico]').forEach((el) => {
    el.innerHTML = ico(el.dataset.ico);
  });

  // Initial Sync
  syncAll();
});
