/**
 * CLaiR — Utility & Helper Functions
 */

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

// Currency formatting
function fmtMoney(amt, currency) {
  const cur = currency || (window.currentProfile && window.currentProfile.currency) || 'IDR';
  const n = Number(amt) || 0;
  if (cur === 'IDR') return 'Rp ' + n.toLocaleString('id-ID');
  if (cur === 'USD') return '$' + n.toLocaleString('en-US');
  if (cur === 'SGD') return 'S$' + n.toLocaleString('en-SG');
  if (cur === 'MYR') return 'RM ' + n.toLocaleString('ms-MY');
  if (cur === 'THB') return '฿' + n.toLocaleString('th-TH');
  if (cur === 'VND') return n.toLocaleString('vi-VN') + ' ₫';
  return cur + ' ' + n.toLocaleString();
}

// Date formatting
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtToday = (d) => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const fmtMD = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;

// Toast notification
let toastTimer = null;
function toast(msg) {
  const toastEl = $('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// Skeleton helpers
const SK_W = [70, 90, 45, 60, 80, 55];
function skRows(cols, n, startAt) {
  let out = '';
  for (let r = 0; r < n; r++) {
    out +=
      '<tr class="sk-row">' +
      Array.from(
        { length: cols },
        (_, c) => `<td><span class="sk" style="width:${SK_W[(r + c + (startAt || 0)) % SK_W.length]}%"></span></td>`
      ).join('') +
      '</tr>';
  }
  return out;
}

function skTable(headers, n, note, title) {
  return (
    '<table><thead><tr>' +
    headers.map((h) => `<th>${h}</th>`).join('') +
    '</tr></thead><tbody>' +
    skRows(headers.length, n) +
    '</tbody></table>' +
    `<div class="sk-note"><b>${title}</b>${note}</div>`
  );
}

// Algorithmic Automatic Reorder Point (ROP) Calculator
function calcAutoReorder(it, sales = [], suppliers = []) {
  if (it.reorderAuto && it.reorder != null) return it.reorder;

  const itemName = String(it.name || '').trim().toLowerCase();
  const itemSku = String(it.sku || '').trim().toLowerCase();

  let leadTime = 3;
  if (Array.isArray(suppliers) && suppliers.length > 0) {
    const matched = suppliers.find((s) => {
      const cat = String(s.category || '').toLowerCase();
      const n = String(s.name || '').toLowerCase();
      return cat.includes(itemName) || itemName.includes(cat) || n.includes(itemName);
    });
    if (matched && Number(matched.leadTimeDays)) leadTime = Math.max(1, Number(matched.leadTimeDays));
  }

  const txs = (sales || []).filter((s) => {
    const si = String(s.item || '').trim().toLowerCase();
    return si === itemName || si === itemSku;
  });

  if (txs.length > 0) {
    const dailyMap = {};
    txs.forEach((s) => {
      dailyMap[s.date] = (dailyMap[s.date] || 0) + (Number(s.qty) || 0);
    });
    const dates = Object.keys(dailyMap).sort();
    const firstDate = new Date(dates[0] + 'T12:00:00Z');
    const lastDate = new Date(dates[dates.length - 1] + 'T12:00:00Z');
    const spanDays = Math.max(1, Math.round((lastDate - firstDate) / 864e5) + 1);

    const dailyVals = Object.values(dailyMap);
    const totalQty = dailyVals.reduce((a, b) => a + b, 0);
    const dailyDemand = totalQty / spanDays;

    let sumSq = 0;
    dailyVals.forEach((v) => { sumSq += Math.pow(v - dailyDemand, 2); });
    const zeroDays = Math.max(0, spanDays - dailyVals.length);
    sumSq += zeroDays * Math.pow(0 - dailyDemand, 2);
    const stdDev = Math.sqrt(sumSq / spanDays);

    const Z = 1.65; // 95% service level
    let ss = Math.ceil(Z * Math.sqrt(leadTime) * stdDev);
    ss = Math.max(1, ss, Math.ceil(dailyDemand * 0.5));
    const rop = Math.ceil(dailyDemand * leadTime + ss);
    return Math.max(1, rop);
  }

  // Cold start baseline
  const onHand = Number(it.qty) || 0;
  return Math.max(2, Math.round(onHand * 0.25));
}

// Inventory status indicators
function statusKey(it) {
  if (it.status) return it.status;
  const rop = it.reorder != null ? it.reorder : calcAutoReorder(it);
  if (it.qty <= 0 || it.qty < rop / 2) return 'critical';
  if (it.qty < rop) return 'low';
  return 'good';
}

const STATUS_UI = {
  critical: ['Critical', 'alert-circle'],
  low: ['Low', 'alert-triangle'],
  good: ['Good', 'check-circle']
};

const statusPill = (k) => `<span class="spill ${k}">${ico(STATUS_UI[k][1], 14)}${STATUS_UI[k][0]}</span>`;

// Expiry & Spoilage Forecast Helper
function calcExpiryMetrics(it, todayStr) {
  if (it.expiryStatus && it.expiryStatus !== 'none') return it;
  const expiryDate = it.expiryDate || null;
  if (!expiryDate) {
    return { ...it, expiryStatus: 'none', daysToExpiry: null, unitsAtRisk: 0, expiryRecommendation: '' };
  }
  const today = new Date((todayStr || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
  const exp = new Date(expiryDate + 'T12:00:00Z');
  if (isNaN(exp)) {
    return { ...it, expiryStatus: 'none', daysToExpiry: null, unitsAtRisk: 0, expiryRecommendation: '' };
  }
  const daysToExpiry = Math.ceil((exp - today) / 864e5);
  const daily = Number(it.dailyDemand) || 0;
  let expiryStatus = 'none';
  let unitsAtRisk = 0;
  let expiryRecommendation = '';

  if (daysToExpiry < 0) {
    expiryStatus = 'expired';
    unitsAtRisk = Number(it.qty) || 0;
    expiryRecommendation = `Expired ${Math.abs(daysToExpiry)}d ago`;
  } else if (daysToExpiry === 0) {
    expiryStatus = 'critical';
    unitsAtRisk = Number(it.qty) || 0;
    expiryRecommendation = 'Expires today!';
  } else {
    const projSales = Math.round(daily * daysToExpiry);
    unitsAtRisk = Math.max(0, (Number(it.qty) || 0) - projSales);
    if (unitsAtRisk > 0) {
      expiryStatus = daysToExpiry <= 5 ? 'critical' : 'warning';
      expiryRecommendation = `${unitsAtRisk} ${it.unit} at spoilage risk (${daysToExpiry}d left)`;
    } else {
      expiryStatus = 'safe';
      expiryRecommendation = `Healthy (${daysToExpiry}d left)`;
    }
  }

  return {
    ...it,
    daysToExpiry,
    expiryStatus,
    unitsAtRisk,
    expiryRecommendation
  };
}

function expiryPill(it) {
  if (!it.expiryDate) return '<span class="dim">—</span>';
  const k = it.expiryStatus || 'none';
  if (k === 'expired') {
    return `<span class="spill critical" title="${esc(it.expiryRecommendation)}"><i class="fa-solid fa-triangle-exclamation"></i> Expired</span>`;
  }
  if (k === 'critical') {
    return `<span class="spill critical" title="${esc(it.expiryRecommendation)}"><i class="fa-solid fa-fire"></i> ${it.unitsAtRisk} at risk (${it.daysToExpiry}d)</span>`;
  }
  if (k === 'warning') {
    return `<span class="spill low" title="${esc(it.expiryRecommendation)}"><i class="fa-solid fa-clock"></i> ${it.unitsAtRisk} at risk (${it.daysToExpiry}d)</span>`;
  }
  if (k === 'safe') {
    return `<span class="spill good" title="${esc(it.expiryRecommendation)}"><i class="fa-solid fa-shield-halved"></i> Safe (${it.daysToExpiry}d)</span>`;
  }
  return `<span class="dim">${it.expiryDate}</span>`;
}

// SVG Icons Dictionary
const ICONS = {
  'alert-circle':
    '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16" r=".6" fill="currentColor"/>',
  'alert-triangle':
    '<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  'boxes': '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  'flame': '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  'target': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
  'chart-line': '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  'receipt': '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
  'coins':
    '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  'list':
    '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  'calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  'trash': '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'
};

const ico = (n, sz = 20) =>
  `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
    ICONS[n] || ''
  }</svg>`;

// Distance calculation for suppliers
function distKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
