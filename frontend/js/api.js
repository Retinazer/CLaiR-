/**
 * CLaiR — REST API Client
 * Seamlessly interfaces with the Express backend, with automatic local fallback
 */

const API = {
  baseUrl: window.location.origin.startsWith('http') ? '' : 'http://localhost:3000',

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`[API] Failed connecting to backend at ${url}: ${err.message}. Using local storage fallback.`);
      return this.localFallback(endpoint, options);
    }
  },

  // Overview & Forecast
  getOverview() {
    return this.request('/api/overview');
  },

  getForecast(range = '1w') {
    return this.request(`/api/forecast?range=${encodeURIComponent(range)}`);
  },

  // Inventory
  getInventory() {
    return this.request('/api/inventory');
  },

  addInventoryItem(item) {
    return this.request('/api/inventory', {
      method: 'POST',
      body: JSON.stringify(item)
    });
  },

  updateStock(sku, delta) {
    return this.request(`/api/inventory/${encodeURIComponent(sku)}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  },

  deleteInventoryItem(sku) {
    return this.request(`/api/inventory/${encodeURIComponent(sku)}`, {
      method: 'DELETE'
    });
  },

  // Sales
  getSales(days = 30) {
    return this.request(`/api/sales?days=${days}`);
  },

  recordSale({ date, item, qty, rev }) {
    return this.request('/api/sales', {
      method: 'POST',
      body: JSON.stringify({ date, item, qty, rev })
    });
  },

  deleteSale(id) {
    return this.request(`/api/sales/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  // Restock
  getRestock() {
    return this.request('/api/restock');
  },

  restockItem(sku, qty) {
    return this.request('/api/restock', {
      method: 'POST',
      body: JSON.stringify({ sku, qty })
    });
  },

  // Suppliers
  getSuppliers() {
    return this.request('/api/suppliers');
  },

  addSupplier(supplier) {
    return this.request('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplier)
    });
  },

  deleteSupplier(id) {
    return this.request(`/api/suppliers/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  // Profile
  getProfile() {
    return this.request('/api/profile');
  },

  updateProfile(profile) {
    return this.request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(profile)
    });
  },

  // Chat
  sendChat(message) {
    return this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  },

  // LocalStorage Fallback Handler
  localFallback(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch (e) { return fb; } };
    const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

    let inv = load('clair_inventory_v1', []);
    let sales = load('clair_sales_v1', []);
    let sups = load('clair_suppliers_v1', []);
    let prof = load('clair_profile_v1', { name: '', business: '', role: 'Owner', locale: 'English', currency: 'IDR' });

    if (endpoint.startsWith('/api/inventory')) {
      if (method === 'GET') return inv;
      if (method === 'POST') {
        const item = JSON.parse(options.body);
        inv.push(item);
        save('clair_inventory_v1', inv);
        return item;
      }
      if (method === 'PATCH') {
        const sku = decodeURIComponent(endpoint.split('/')[3]);
        const { delta } = JSON.parse(options.body);
        const it = inv.find(i => i.sku.toLowerCase() === sku.toLowerCase());
        if (it) { it.qty += delta; save('clair_inventory_v1', inv); return it; }
      }
      if (method === 'DELETE') {
        const sku = decodeURIComponent(endpoint.split('/')[3]);
        inv = inv.filter(i => i.sku.toLowerCase() !== sku.toLowerCase());
        save('clair_inventory_v1', inv);
        return { success: true };
      }
    }

    if (endpoint.startsWith('/api/sales')) {
      if (method === 'GET') {
        const days = 30;
        return { transactions: sales, days, txCount: sales.length, unitsSold: sales.reduce((a, b) => a + (Number(b.qty) || 0), 0), revenue: sales.reduce((a, b) => a + (Number(b.rev) || 0), 0) };
      }
      if (method === 'POST') {
        const body = JSON.parse(options.body);
        sales.push(body);
        save('clair_sales_v1', sales);
        const match = inv.find(i => i.name.toLowerCase() === body.item.toLowerCase() || i.sku.toLowerCase() === body.item.toLowerCase());
        if (match) { match.qty = Math.max(0, match.qty - body.qty); save('clair_inventory_v1', inv); }
        return { sale: body };
      }
      if (method === 'DELETE') {
        const id = endpoint.split('/')[3];
        const idx = Number(id);
        if (!isNaN(idx)) sales.splice(idx, 1);
        save('clair_sales_v1', sales);
        return { success: true };
      }
    }

    if (endpoint.startsWith('/api/suppliers')) {
      if (method === 'GET') return sups;
      if (method === 'POST') {
        const sup = JSON.parse(options.body);
        sups.push(sup);
        save('clair_suppliers_v1', sups);
        return sup;
      }
      if (method === 'DELETE') {
        const idx = Number(endpoint.split('/')[3]);
        if (!isNaN(idx)) sups.splice(idx, 1);
        save('clair_suppliers_v1', sups);
        return { success: true };
      }
    }

    if (endpoint.startsWith('/api/profile')) {
      if (method === 'GET') return prof;
      if (method === 'PUT') {
        Object.assign(prof, JSON.parse(options.body));
        save('clair_profile_v1', prof);
        return prof;
      }
    }

    if (endpoint.startsWith('/api/overview')) {
      const counts = { critical: 0, low: 0, good: 0 };
      inv.forEach(i => counts[statusKey(i)]++);
      return {
        greeting: 'Good day, ' + (prof.name || 'Guest'),
        riskCount: counts.critical + counts.low,
        healthyCount: counts.good,
        todayDemand: 0,
        todayTransactions: 0,
        reliability: sales.length > 5 ? 'High' : 'Learning',
        reliabilityText: `${sales.length} transactions recorded`,
        urgentCount: counts.critical + counts.low,
        urgentItems: inv.filter(i => statusKey(i) !== 'good').slice(0, 3)
      };
    }

    if (endpoint.startsWith('/api/forecast')) {
      const distinctDays = [...new Set(sales.map((s) => s.date))].length;
      const isRich = distinctDays >= 14;
      const isSparse = distinctDays >= 3;
      const model = isRich ? 'SARIMAX' : isSparse ? 'ETS' : 'NONE';
      return {
        activeModel: model,
        regime: isRich ? 'rich' : isSparse ? 'sparse' : 'insufficient',
        rationale: isRich
          ? 'Rich Data Regime (>=14 days). SARIMAX active with weekly seasonality.'
          : isSparse
          ? 'Sparse Data Regime (<14 days). ETS active.'
          : 'Insufficient data (<3 days).',
        thresholds: {
          sparseThreshold: 3,
          richThreshold: 14,
          currentPoints: distinctDays,
          pointsNeededForRich: Math.max(0, 14 - distinctDays),
          progressPercent: Math.min(100, Math.round((distinctDays / 14) * 100))
        },
        timeline: { dates: sales.map((s) => s.date), values: sales.map((s) => s.qty) },
        forecast: { dates: [], predictions: [], lower: [], upper: [] },
        metrics: { mae: 0, rmse: 0, modelDetails: model }
      };
    }

    if (endpoint.startsWith('/api/chat')) {
      const { message } = JSON.parse(options.body);
      return { reply: "I can answer questions about your stock, restock needs, and suppliers." };
    }

    return {};
  }
};
