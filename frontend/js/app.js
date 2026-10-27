/**
 * CLaiR — Main Application Logic & Screen Controllers
 */

// Global State
let inventory = [];
let suppliers = [];
let salesData = { transactions: [], txCount: 0, unitsSold: 0, revenue: 0, topProduct: '—' };
let profile = { name: '', business: '', role: 'Owner', locale: 'English', currency: 'IDR' };
let userPos = null; // { lat, lng }
let fcRange = '1w';
let fcGranularity = 'daily';
let invFilter = 'all';
let invQuery = '';
let histDays = 30;
let map = null;
let markerLayer = null;
let youMarker = null;

const DEFAULT_CENTER = [-4.015, 103.25]; // Pagar Alam, Sumatera Selatan

function getStoreCenter() {
  if (userPos && userPos.lat && userPos.lng) return [userPos.lat, userPos.lng];
  if (profile && profile.lat != null && profile.lng != null) return [profile.lat, profile.lng];
  return DEFAULT_CENTER;
}

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

  // When without data: render a real chart with a line at 0,0
  if (nh === 0) {
    const yTicks = [10, 7.5, 5, 2.5, 0];
    let g = '';
    // Draw Horizontal Gridlines & Y labels
    yTicks.forEach((v, i) => {
      const y = T + ((B - T) * i) / (yTicks.length - 1);
      g +=
        `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${v === 0 ? '#007AFF' : '#E2E8F0'}" stroke-width="${v === 0 ? 1.5 : 1}"/>` +
        `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="11" font-weight="500" fill="#64748B">${v}</text>`;
    });

    // 7 timeline points along the 0 baseline
    const today = new Date();
    const zeroPoints = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      zeroPoints.push(d);
    }
    const dx = (R - L) / (zeroPoints.length - 1);
    const pts = zeroPoints.map((d, i) => ({
      x: L + i * dx,
      y: B,
      date: fmtMD(d)
    }));

    // Draw the baseline line at (0, 0)
    const linePath = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    g += `<polyline points="${linePath}" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    pts.forEach((p) => {
      g += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#007AFF" stroke="#FFFFFF" stroke-width="2">` +
        `<title>${p.date}: 0 units</title></circle>`;
    });

    // X Axis baseline & ticks
    g += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#007AFF" stroke-width="1.5"/>`;
    g += `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#007AFF" stroke-width="1.5"/>`;

    pts.forEach((p) => {
      g += `<line x1="${p.x.toFixed(1)}" y1="${B}" x2="${p.x.toFixed(1)}" y2="${B + 5}" stroke="#007AFF"/>` +
        `<text x="${p.x.toFixed(1)}" y="${B + 18}" text-anchor="middle" font-size="11" font-weight="500" fill="#64748B">${p.date}</text>`;
    });

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
      const d = new Date(p.date.includes('T') ? p.date : `${p.date}T12:00:00Z`);
      const isHourly = fc && fc.granularity === 'hourly';
      const labelText = isHourly
        ? (!isNaN(d) ? `${String(d.getHours()).padStart(2, '0')}:00` : p.date)
        : (!isNaN(d) ? fmtMD(d) : p.date);
      g += `<line x1="${p.x.toFixed(1)}" y1="${B}" x2="${p.x.toFixed(1)}" y2="${B + 5}" stroke="#007AFF"/>` +
        `<text x="${p.x.toFixed(1)}" y="${B + 18}" text-anchor="middle" font-size="11" font-weight="500" fill="#64748B">${labelText}</text>`;
    }
  });

  $('fc-svg').innerHTML = g;
}

async function renderForecastChart() {
  try {
    const fc = await API.getForecast(fcRange, fcGranularity);
    if (!fc) {
      renderSvgForecast(null);
      return;
    }

    // 1. Immediately render the SVG Forecast Chart so it is never delayed or blocked
    renderSvgForecast(fc);

    // 2. Safe Update Model Badge
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

    const gran = (fc.granularity || 'daily').toLowerCase();
    const stepUnit = gran === 'hourly' ? 'hrs' : 'days';
    const thresholds = fc.thresholds || { currentSteps: 0, minSteps: 3, richSteps: 14, richTransactions: 14, progressPercent: 0 };
    const dataVol = fc.dataVolume || { totalTransactions: 0, totalQuantity: 0, intermittencyPercent: 0 };

    if (pill) {
      if (fc.activeModel === 'SARIMAX') {
        pill.textContent = `${thresholds.currentSteps} ${stepUnit} · ${dataVol.totalTransactions} tx (Rich Regime)`;
      } else if (fc.activeModel === 'CROSTON') {
        pill.textContent = `${dataVol.intermittencyPercent}% zero-demand (${dataVol.totalTransactions} tx · Intermittent)`;
      } else if (fc.activeModel === 'ETS') {
        pill.textContent = `${thresholds.currentSteps} ${stepUnit} · ${dataVol.totalTransactions} tx (Sparse/Moderate)`;
      } else {
        pill.textContent = `${thresholds.currentSteps} / ${thresholds.minSteps} ${stepUnit} (${dataVol.totalTransactions} tx)`;
      }
    }

    if (insights) {
      if (!fc.activeModel || fc.activeModel === 'NONE') {
        insights.style.display = 'none';
      } else {
        insights.style.display = 'flex';
        const preds = (fc.forecast && Array.isArray(fc.forecast.predictions)) ? fc.forecast.predictions : [];
        const sumPred = preds.reduce((a, b) => a + b, 0);
        const metrics = fc.metrics || {};
        insights.innerHTML = `
        <div class="fi-top">
          <div class="fi-title">
            <i class="fa-solid fa-chart-line" style="color:var(--primary)"></i>
            <span>${esc(fc.activeModel)} (${esc(gran.toUpperCase())})</span>
          </div>
          <span class="threshold-pill">2D Volume &amp; Temporal Cycles Matrix</span>
        </div>
        <div class="fi-desc">${esc(fc.rationale || '')}</div>
        <div class="threshold-bar">
          <div class="threshold-progress" style="width: ${thresholds.progressPercent || 0}%"></div>
        </div>
        <div class="threshold-markers">
          <span>0 (Start)</span>
          <span>Threshold 1: ${thresholds.minSteps || 3} ${stepUnit} (ETS)</span>
          <span>Threshold 2: ${thresholds.richSteps || 14} ${stepUnit} &amp; ${thresholds.richTransactions || 14} tx (SARIMAX)</span>
        </div>
        <div class="fi-metrics">
          <div class="fi-metric">Active Model: <b>${esc(metrics.modelDetails || fc.activeModel)}</b></div>
          <div class="fi-metric">Data Volume: <b>${dataVol.totalTransactions} tx (${dataVol.totalQuantity} units)</b></div>
          <div class="fi-metric">Demand Density: <b>${100 - (dataVol.intermittencyPercent || 0)}% active (${dataVol.intermittencyPercent || 0}% zeros)</b></div>
          <div class="fi-metric">Mean Absolute Error (MAE): <b>${metrics.mae != null ? metrics.mae : '—'}</b></div>
          <div class="fi-metric">Projected Period Demand: <b>${Math.round(sumPred)} units</b></div>
        </div>
      `;
      }
    }
  } catch (err) {
    console.error('Forecast render error:', err);
    renderSvgForecast(null);
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
      host.innerHTML = '<div class="sk-note"><b>All clear</b>Every item is above its auto-configured reorder point.</div>';
    } else {
      host.innerHTML = ov.urgentItems
        .map((it) => {
          const k = it.status || statusKey(it);
          return (
            `<div class="attn ${k}">${statusPill(k)}<div class="body"><b>${esc(it.name)}</b><small>${it.qty} ${esc(it.unit)} remaining · auto-reorder at ${it.reorder}</small></div>` +
            `<button class="${k === 'critical' ? 'btn-main' : 'btn-plain'}" data-go-restock>${k === 'critical' ? 'Restock' : 'View'}</button></div>`
          );
        })
        .join('');
      host.querySelectorAll('[data-go-restock]').forEach((b) => (b.onclick = () => goScreen('restock')));
    }

    // Render Expiry & Spoilage Forecast Panel
    const expPill = $('ov-expiry-pill');
    const expContent = $('ov-expiry-content');
    const ef = ov.expiryForecast || { totalTracked: 0, atRiskCount: 0, criticalCount: 0, totalUnitsAtRisk: 0, items: [] };

    if (expPill) {
      if (!ef.totalTracked) {
        expPill.textContent = 'No items tracked with expiry';
        expPill.className = 'threshold-pill';
        expPill.style = '';
      } else if (ef.atRiskCount > 0) {
        expPill.textContent = `${ef.atRiskCount} item${ef.atRiskCount === 1 ? '' : 's'} at risk (${ef.totalUnitsAtRisk} units surplus)`;
        expPill.className = 'threshold-pill';
        expPill.style.color = '#E11D48';
        expPill.style.borderColor = '#FECDD3';
        expPill.style.background = '#FFF1F2';
      } else {
        expPill.textContent = `All clear · ${ef.totalTracked} item${ef.totalTracked === 1 ? '' : 's'} safe`;
        expPill.className = 'threshold-pill';
        expPill.style.color = '#059669';
        expPill.style.borderColor = '#A7F3D0';
        expPill.style.background = '#ECFDF5';
      }
    }

    if (expContent) {
      if (!ef.totalTracked) {
        expContent.innerHTML =
          '<div class="sk-note" style="padding:16px 20px;">' +
          '<b>No expiry dates set yet</b>' +
          'Add expiry dates when creating items in Inventory. CLaiR compares shelf life against predicted daily consumption and alerts you before stock spoils.' +
          '</div>';
      } else if (!ef.atRiskCount) {
        expContent.innerHTML =
          '<div style="background:#ECFDF5; border:1px solid #A7F3D0; border-radius:14px; padding:16px 20px; display:flex; align-items:center; gap:14px;">' +
          '<span class="chip green" style="background:#10B981; color:#fff; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border-radius:999px;"><i class="fa-solid fa-shield-halved"></i></span>' +
          '<div style="flex:1;">' +
          '<b style="color:#065F46; font-size:15px; display:block;">Zero Spoilage Risk</b>' +
          '<small style="color:#047857; font-size:13px;">Based on statistical sales velocity, 100% of tracked inventory is projected to sell completely before expiring.</small>' +
          '</div></div>';
      } else {
        const atRiskItems = ef.items.filter((it) => it.unitsAtRisk > 0 || it.expiryStatus === 'expired');
        expContent.innerHTML = atRiskItems
          .map((it) => {
            const isCritical = it.expiryStatus === 'critical' || it.expiryStatus === 'expired';
            return `
            <div class="attn ${isCritical ? 'critical' : 'low'}" style="margin-bottom:10px;">
              <span class="spill ${isCritical ? 'critical' : 'low'}">
                <i class="fa-solid ${isCritical ? 'fa-fire' : 'fa-hourglass-half'}"></i> ${it.daysToExpiry <= 0 ? 'Expired' : `${it.daysToExpiry}d left`}
              </span>
              <div class="body">
                <b>${esc(it.name)} <small style="display:inline; font-weight:normal; color:#64748B;">(${esc(it.sku)})</small></b>
                <small style="color:${isCritical ? '#BE123C' : '#0369A1'}; font-weight:700; display:block; margin-top:3px;">
                  ⚠️ Spoilage Forecast: ${it.unitsAtRisk} ${esc(it.unit)} projected to expire unsold (${it.expiryRiskPercent}% surplus)
                </small>
                <div style="font-size:12px; color:#64748B; margin-top:3px;">
                  ${esc(it.expiryRecommendation)}
                </div>
              </div>
              <button class="${isCritical ? 'btn-main' : 'btn-plain'}" data-go-inv style="font-size:13px; padding:8px 14px;">View Stock</button>
            </div>
          `;
          })
          .join('');
        expContent.querySelectorAll('[data-go-inv]').forEach((b) => (b.onclick = () => goScreen('inventory')));
      }
    }
  } catch (err) {
    console.error('Overview render error:', err);
  }
}

// ============================================================================
// Inventory Management
// ============================================================================

function statusCounts() {
  const c = { critical: 0, low: 0, good: 0, expiring: 0 };
  inventory.forEach((it) => {
    c[statusKey(it)] = (c[statusKey(it)] || 0) + 1;
    if (it.unitsAtRisk > 0 || it.expiryStatus === 'expired' || it.expiryStatus === 'critical' || it.expiryStatus === 'warning') {
      c.expiring++;
    }
  });
  return c;
}

function renderInventory() {
  const c = statusCounts(), n = inventory.length;
  $('inv-date').textContent = 'As of ' + fmtToday(new Date());
  $('inv-sub').textContent = `${n} item${n === 1 ? '' : 's'} tracked · ${c.critical + c.low} below auto reorder point · ${c.expiring} at expiry risk`;
  $('inv-crit').textContent = c.critical;
  $('inv-low').textContent = c.low;
  $('inv-good').textContent = c.good;
  $('inv-total').textContent = n;

  const counts = { all: n, critical: c.critical, low: c.low, good: c.good, expiring: c.expiring };
  document.querySelectorAll('#inv-tabs button').forEach((b) => {
    b.querySelector('.cnt').textContent = counts[b.dataset.f] != null ? counts[b.dataset.f] : 0;
    b.classList.toggle('on', b.dataset.f === invFilter);
  });

  const wrap = $('inv-wrap');
  const heads = ['Item', 'On hand', 'Daily demand', 'Days left', 'Auto Reorder Pt', 'Expiry Risk', 'Status'];
  if (!n) {
    wrap.innerHTML = skTable(heads, 6, 'Use "+ New item" above to start tracking stock.', 'No inventory yet');
    return;
  }

  const q = invQuery.trim().toLowerCase();
  const rows = inventory
    .map((it) => ({ it, k: statusKey(it) }))
    .filter((r) => {
      if (invFilter === 'expiring') {
        if (!(r.it.unitsAtRisk > 0 || r.it.expiryStatus === 'expired' || r.it.expiryStatus === 'critical' || r.it.expiryStatus === 'warning')) return false;
      } else if (invFilter !== 'all' && r.k !== invFilter) {
        return false;
      }
      return !q || r.it.name.toLowerCase().includes(q) || r.it.sku.toLowerCase().includes(q);
    });

  if (!rows.length) {
    wrap.innerHTML = '<div class="sk-note"><b>No items match</b>Try a different filter or search.</div>';
    return;
  }

  wrap.innerHTML =
    '<table><thead><tr><th>Item</th><th class="r">On hand</th><th class="r">Daily demand</th><th class="r">Days left</th><th class="r">Auto Reorder Pt</th><th class="r">Expiry Risk</th><th>Status</th><th></th></tr></thead><tbody>' +
    rows
      .map(
        ({ it, k }) =>
          `<tr class="row-${k}"><td><b>${esc(it.name)}</b><small>${esc(it.sku)}</small></td>` +
          `<td class="r"><span class="big">${it.qty}</span> <span class="unit">${esc(it.unit)}</span></td>` +
          `<td class="r">${it.dailyDemand != null ? `${it.dailyDemand} <span class="unit">${esc(it.unit)}/d</span>` : '<span class="dim">—</span>'}</td>` +
          `<td class="r">${it.daysOfStock != null ? `<b>${it.daysOfStock}</b> d` : '<span class="dim">—</span>'}</td>` +
          `<td class="r"><span class="badge-rop" title="Auto-configured by lead time & demand variance">${it.reorder} ${esc(it.unit)}</span></td>` +
          `<td class="r">${expiryPill(it)}</td>` +
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
  const heads = ['SKU', 'Item', 'On Hand', 'Auto Reorder Pt', 'Safety Stock', 'Suggested Qty', 'Action'];
  if (!inventory.length) {
    wrap.innerHTML = skTable(
      heads,
      4,
      'Add items to Inventory and CLaiR will flag the ones that fall below their auto-configured reorder point.',
      'Nothing to restock yet'
    );
  } else if (!low.length) {
    wrap.innerHTML = skTable(
      heads,
      3,
      'Every item is above its auto-configured reorder point right now.',
      'All stocked up'
    );
  } else {
    wrap.innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;background:#EBF4FB;padding:8px 14px;border-radius:10px;border:1px solid #D0E4F7;display:flex;align-items:center;gap:8px;">' +
      '<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--primary);font-size:14px;"></i> <span><b>Algorithmic Safety Level:</b> Reorder points are continuously tuned via <code>(Lead Time × Daily Demand) + Safety Stock (95% Service Level)</code>.</span></div>' +
      '<table><thead><tr><th>SKU</th><th>Item</th><th>On Hand</th><th>Auto Reorder Pt</th><th>Safety Stock</th><th>Suggested Qty</th><th class="r">Find Restockers</th></tr></thead><tbody>' +
      low
        .map(
          (it) =>
            `<tr><td><b>${esc(it.sku)}</b></td><td>${esc(it.name)}</td><td>${it.qty} ${esc(it.unit)}</td>` +
            `<td><span class="badge-rop" title="Auto-configured by lead time & demand variance">${it.reorder} ${esc(it.unit)}</span></td>` +
            `<td>${it.safetyStock != null ? `${it.safetyStock} ${esc(it.unit)}` : '—'}</td>` +
            `<td><b style="color:var(--primary)">${it.suggestedQty || Math.max(0, it.reorder * 2 - it.qty)} ${esc(it.unit)}</b></td>` +
            `<td class="r"><button class="btn-sm" style="color:var(--primary);border-color:#BAE6FD;background:#F0F9FF;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-weight:600;" data-find-restocker="${esc(it.name)}"><i class="fa-solid fa-compass"></i> Find Restockers</button></td></tr>`
        )
        .join('') +
      '</tbody></table>';

    wrap.querySelectorAll('[data-find-restocker]').forEach((b) => {
      b.onclick = () => {
        const query = b.dataset.findRestocker;
        goScreen('suppliers');
        if ($('sp-discover-input')) $('sp-discover-input').value = query;
        performSupplierDiscovery(query);
      };
    });
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
      const lt = s.leadTimeDays ? ` · ${s.leadTimeDays}d lead time` : '';
      const id = s.id || i;
      const cleanPhone = s.phone ? s.phone.replace(/[^0-9]/g, '') : '';
      return (
        `<div class="sup-card" data-card-sup="${id}">` +
        `<div class="top"><b>${esc(s.name)}</b><button class="btn-sm" data-del-sup="${id}">Remove</button></div>` +
        `<div class="meta">${esc(s.category || 'Supplier')}${d}${lt}</div>` +
        (s.address ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(s.address)}</div>` : '') +
        `<div style="font-size:12px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">` +
        (s.phone ? `<span style="color:#0369A1;"><i class="fa-solid fa-phone"></i> ${esc(s.phone)}</span>` : '<span></span>') +
        `<div style="display:flex;gap:8px;">` +
        (s.phone ? `<a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hi ${s.name}, checking stock availability.`)}" target="_blank" style="color:#059669;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i class="fa-brands fa-whatsapp"></i> Chat</a>` : '') +
        `<button class="btn-plain" data-center-sup="${id}" style="color:var(--primary);font-weight:700;font-size:12px;padding:0;cursor:pointer;"><i class="fa-solid fa-location-crosshairs"></i> View on Map</button>` +
        `</div></div></div>`
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

  host.querySelectorAll('[data-center-sup]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.centerSup;
      const s = suppliers.find((sp, i) => (sp.id || i).toString() === id.toString());
      if (s && map) {
        map.flyTo([s.lat, s.lng], 14, { duration: 0.8 });
        const m = markerInstances[id];
        if (m) setTimeout(() => m.openPopup(), 850);
      }
    };
  });
}

let discoveredMarkers = null;
let markerInstances = {};

async function performSupplierDiscovery(query = '', category = '') {
  const container = $('sp-discover-results');
  const statusBadge = $('sp-discovery-status');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = '<div class="sk-note" style="padding:16px;"><i class="fa-solid fa-spinner fa-spin" style="margin-right:8px; color:var(--primary);"></i> Searching nearby wholesale distributors & restockers...</div>';

  if (statusBadge) {
    statusBadge.textContent = 'Scanning network...';
  }

  try {
    const center = getStoreCenter();
    const lat = center[0];
    const lng = center[1];
    const res = await API.discoverSuppliers({ q: query, category, lat, lng });
    const list = (res && res.suppliers) ? res.suppliers : [];

    if (statusBadge) {
      statusBadge.textContent = `${list.length} restockers found`;
    }

    if (!list.length) {
      container.innerHTML = `<div class="sk-note" style="padding:16px;"><b>No suppliers found</b>Try searching with broader terms like "coffee", "dairy", or "packaging".</div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text);">Discovered Restockers &amp; Wholesalers (${list.length})</span>
        <button class="btn-plain" id="sp-clear-discover" style="font-size:12px; color:var(--muted);"><i class="fa-solid fa-xmark"></i> Close</button>
      </div>
      <div class="discovered-grid">
        ${list.map((s) => `
          <div class="discovered-card">
            <div>
              <div class="discovered-head">
                <b style="font-size:14px; color:var(--text);">${esc(s.name)}</b>
                <span style="font-size:11px; background:#FEF3C7; color:#92400E; padding:2px 6px; border-radius:6px; font-weight:700;">★ ${s.rating || 4.7}</span>
              </div>
              <div style="font-size:12px; color:var(--muted); margin:4px 0 8px;">
                ${s.address ? esc(s.address) : 'Wholesale Distribution'}
              </div>
              <div class="discovered-meta">
                <span><i class="fa-solid fa-location-dot"></i> ${s.distanceKm != null ? `${s.distanceKm} km` : 'Local'}</span>
                <span><i class="fa-solid fa-truck-fast"></i> ${s.leadTimeDays}d lead time</span>
                ${s.moq ? `<span style="background:#F1F5F9; color:#475569;">MOQ: ${esc(s.moq)}</span>` : ''}
              </div>
              ${s.phone ? `<div style="font-size:12px; color:#0369A1; margin-top:8px; font-weight:500;"><i class="fa-solid fa-phone"></i> ${esc(s.phone)}</div>` : ''}
            </div>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="btn btn-primary" style="flex:1; font-size:12px; padding:7px 10px; display:inline-flex; align-items:center; justify-content:center; gap:5px;" data-pin-supplier='${JSON.stringify({ name: s.name, category: s.category, lat: s.lat, lng: s.lng, phone: s.phone, address: s.address, leadTimeDays: s.leadTimeDays }).replace(/'/g, '&apos;')}'>
                <i class="fa-solid fa-map-pin"></i> Pin to My Suppliers
              </button>
              ${s.phone ? `<a href="https://wa.me/${s.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi ${s.name}, I found your wholesale business via CLaiR. Do you have stock available?`)}" target="_blank" class="btn-plain" style="padding:7px 10px; font-size:12px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #A7F3D0; background:#ECFDF5; color:#065F46; border-radius:8px;" title="Chat via WhatsApp"><i class="fa-brands fa-whatsapp" style="font-size:14px;"></i></a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Hook up Pin to My Suppliers with auto map pan and popup open
    container.querySelectorAll('[data-pin-supplier]').forEach((b) => {
      b.onclick = async () => {
        try {
          const supData = JSON.parse(b.getAttribute('data-pin-supplier'));
          const added = await API.addSupplier(supData);
          toast(`Pinned "${supData.name}" to your map!`);
          b.disabled = true;
          b.innerHTML = '<i class="fa-solid fa-check"></i> Pinned';
          b.style.background = '#10B981';
          b.style.borderColor = '#10B981';
          await syncSuppliers();
          if (map && supData.lat && supData.lng) {
            map.flyTo([supData.lat, supData.lng], 14, { duration: 1.0 });
            setTimeout(() => {
              const m = markerInstances[added.id || supData.id];
              if (m) m.openPopup();
            }, 1050);
          }
        } catch (err) {
          toast('Error adding supplier: ' + err.message);
        }
      };
    });

    if ($('sp-clear-discover')) {
      $('sp-clear-discover').onclick = () => {
        container.style.display = 'none';
        if (discoveredMarkers && map) {
          discoveredMarkers.clearLayers();
        }
      };
    }

    // Add purple preview markers to Leaflet map
    if (map) {
      if (!discoveredMarkers) {
        discoveredMarkers = L.layerGroup().addTo(map);
      } else {
        discoveredMarkers.clearLayers();
      }
      list.forEach((s) => {
        if (s.lat && s.lng) {
          L.circleMarker([s.lat, s.lng], {
            radius: 9,
            color: '#fff',
            weight: 2,
            fillColor: '#8B5CF6',
            fillOpacity: 0.95
          })
            .bindTooltip(`🔍 ${esc(s.name)} (${s.leadTimeDays}d lead time)`, { direction: 'top', offset: [0, -6] })
            .addTo(discoveredMarkers);
        }
      });
    }

  } catch (err) {
    container.innerHTML = `<div class="sk-note" style="padding:16px; color:#BE123C;"><b>Discovery error:</b> ${esc(err.message)}</div>`;
  }
}

function renderMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markerInstances = {};

  if (!suppliers.length) return;

  const supplierIcon = L.divIcon({
    className: 'custom-sup-pin',
    html: `<div style="background:#007AFF; color:#fff; width:30px; height:30px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 3px 10px rgba(0,122,255,0.45); border:2px solid #fff;"><i class="fa-solid fa-truck" style="transform:rotate(45deg); font-size:12px;"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -32]
  });

  suppliers.forEach((s, idx) => {
    const id = s.id || idx;
    const cleanPhone = s.phone ? s.phone.replace(/[^0-9]/g, '') : '';
    const distText = userPos ? `${distKm(userPos, s).toFixed(1)} km away` : '';
    const popupHtml = `
      <div style="font-family:inherit; min-width:200px; padding:4px 2px;">
        <div style="font-size:14px; font-weight:700; color:#0F172A; margin-bottom:3px;">${esc(s.name)}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
          <span style="font-size:11px; background:#EBF4FB; color:#0369A1; font-weight:600; padding:2px 7px; border-radius:4px;">${esc(s.category || 'Supplier')}</span>
          ${distText ? `<span style="font-size:11px; background:#F1F5F9; color:#475569; font-weight:600; padding:2px 7px; border-radius:4px;"><i class="fa-solid fa-location-dot"></i> ${distText}</span>` : ''}
        </div>
        ${s.address ? `<div style="font-size:12px; color:#64748B; margin-bottom:5px;"><i class="fa-solid fa-building" style="margin-right:4px;"></i>${esc(s.address)}</div>` : ''}
        <div style="font-size:12px; color:#0284C7; font-weight:600; margin-bottom:6px;"><i class="fa-solid fa-truck-fast" style="margin-right:4px;"></i>${s.leadTimeDays || 3} days estimated lead time</div>
        ${s.phone ? `<div style="margin-top:8px; padding-top:6px; border-top:1px solid #E2E8F0; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:12px; color:#0369A1; font-weight:500;"><i class="fa-solid fa-phone"></i> ${esc(s.phone)}</span>
          <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hi ${s.name}, I am contacting you from CLaiR about inventory restock.`)}" target="_blank" style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:#059669; font-weight:700; text-decoration:none;"><i class="fa-brands fa-whatsapp"></i> Chat</a>
        </div>` : ''}
      </div>
    `;

    const marker = L.marker([s.lat, s.lng], { icon: supplierIcon })
      .bindTooltip(`<b>${esc(s.name)}</b>`, { permanent: true, direction: 'bottom', offset: [0, 4], className: 'sup-map-label' })
      .bindPopup(popupHtml)
      .addTo(markerLayer);

    markerInstances[id] = marker;
  });

  // Fit bounds to show all pinned suppliers and user
  if (suppliers.length > 0) {
    const coords = suppliers.map((s) => [s.lat, s.lng]);
    if (userPos) coords.push([userPos.lat, userPos.lng]);
    if (coords.length > 1) {
      map.fitBounds(coords, { padding: [50, 50], maxZoom: 14 });
    } else if (coords.length === 1) {
      map.setView(coords[0], 13);
    }
  }
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
    map = L.map('supplier-map').setView(getStoreCenter(), 13);
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
  if ($('set-city')) $('set-city').value = profile.city || 'Pagar Alam, Sumatera Selatan';
  if ($('sp-store-loc')) $('sp-store-loc').innerHTML = `<i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> ${esc(profile.city || 'Pagar Alam')}`;
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
    const expiryDate = ($('inv-expiry') && $('inv-expiry').value) ? $('inv-expiry').value : null;
    try {
      const res = await API.addInventoryItem({ sku, name, qty, unit, expiryDate });
      toast(`Item added with auto-configured reorder point: ${res.reorder || 'Auto'}`);
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
      currency: $('set-curr').value,
      city: $('set-city') ? $('set-city').value.trim() : (profile.city || 'Pagar Alam')
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

  // Restocker Discovery Events
  if ($('sp-discover-btn')) {
    $('sp-discover-btn').onclick = () => {
      const q = ($('sp-discover-input') && $('sp-discover-input').value) ? $('sp-discover-input').value.trim() : '';
      performSupplierDiscovery(q);
    };
  }

  if ($('sp-discover-input')) {
    $('sp-discover-input').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = e.target.value.trim();
        performSupplierDiscovery(q);
      }
    };
  }

  document.querySelectorAll('.sp-cat-chip').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.sp-cat-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      if ($('sp-discover-input')) $('sp-discover-input').value = cat;
      performSupplierDiscovery('', cat);
    };
  });

  // Immediately render zero line at 0,0 so user sees the baseline graph instantly with no loading delay
  renderSvgForecast(null);

  // Initial Sync
  syncAll();
});
