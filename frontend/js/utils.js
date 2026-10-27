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

// Inventory status indicators
function statusKey(it) {
  if (it.qty <= 0 || it.qty < it.reorder / 2) return 'critical';
  if (it.qty < it.reorder) return 'low';
  return 'good';
}

const STATUS_UI = {
  critical: ['Critical', 'alert-circle'],
  low: ['Low', 'alert-triangle'],
  good: ['Good', 'check-circle']
};

const statusPill = (k) => `<span class="spill ${k}">${ico(STATUS_UI[k][1], 14)}${STATUS_UI[k][0]}</span>`;

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
