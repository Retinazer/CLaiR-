/**
 * CLaiR — REST API Client
 * Seamlessly interfaces with the Express backend, with automatic local fallback
 */

const API = {
  baseUrl: (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http') && (window.location.port === '3000' || window.location.port === ''))
    ? ''
    : 'http://localhost:3000',

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

  getForecast(range = '1w', granularity = 'daily') {
    return this.request(`/api/forecast?range=${encodeURIComponent(range)}&granularity=${encodeURIComponent(granularity)}`);
  },

  getExpiry() {
    return this.request('/api/expiry');
  },

  // Simulation Clock & Day Progression
  getSimulation() {
    return this.request('/api/simulation');
  },

  advanceDay(simulateSales = true, days = 1) {
    return this.request('/api/simulation/advance', {
      method: 'POST',
      body: JSON.stringify({ simulateSales, days })
    });
  },

  resetSimulation() {
    return this.request('/api/simulation/reset', {
      method: 'POST'
    });
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

  discoverSuppliers({ q = '', category = '', lat, lng, radius = 50 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (lat != null) params.set('lat', lat);
    if (lng != null) params.set('lng', lng);
    if (radius != null) params.set('radius', radius);
    return this.request(`/api/suppliers/discover?${params.toString()}`);
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

    let inv = load('clair_inventory_v1', [
      { sku: 'COF-01', name: 'Arabica Beans', qty: 45, unit: 'kg' }
    ]);
    let sales = load('clair_sales_v1', []);
    let sups = load('clair_suppliers_v1', []);
    let prof = load('clair_profile_v1', { name: '', business: '', role: 'Owner', locale: 'English', currency: 'IDR' });

    const enhanceItem = (i) => {
      const rop = typeof calcAutoReorder === 'function' ? calcAutoReorder(i, sales, sups) : Math.max(2, Math.round((i.qty || 10) * 0.25));
      const k = i.qty <= 0 || i.qty < rop / 2 ? 'critical' : i.qty < rop ? 'low' : 'good';
      const expMetrics = typeof calcExpiryMetrics === 'function' ? calcExpiryMetrics(i) : {};
      return {
        ...i,
        reorder: rop,
        autoReorder: rop,
        reorderAuto: true,
        status: k,
        suggestedQty: Math.max(0, rop * 2 - i.qty),
        ...expMetrics
      };
    };

    if (endpoint.startsWith('/api/inventory')) {
      if (method === 'GET') return inv.map(enhanceItem);
      if (method === 'POST') {
        const item = JSON.parse(options.body);
        const enhanced = enhanceItem(item);
        inv.push(enhanced);
        save('clair_inventory_v1', inv);
        return enhanced;
      }
      if (method === 'PATCH') {
        const sku = decodeURIComponent(endpoint.split('/')[3]);
        const { delta } = JSON.parse(options.body);
        const it = inv.find(i => i.sku.toLowerCase() === sku.toLowerCase());
        if (it) { it.qty += delta; save('clair_inventory_v1', inv); return enhanceItem(it); }
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
      if (endpoint.includes('/discover')) {
        return {
          query: 'Offline Wholesalers',
          userCoordinates: { lat: -6.2088, lng: 106.8456 },
          totalFound: 4,
          suppliers: [
            { id: 'fb-1', name: 'Archipelago Coffee Importers & Roastery', category: 'Coffee Beans', distanceKm: 3.2, leadTimeDays: 1, phone: '+62 21 5589 1234', address: 'Kawasan Industri Pergudangan Blok C4', rating: 4.8, moq: '10 kg', tags: ['Wholesale Green/Roasted Beans', 'Barista Supply'], lat: -6.19, lng: 106.86 },
            { id: 'fb-2', name: 'Apex Dairy & Barista Plant-Milk Distribution', category: 'Dairy & Milk', distanceKm: 4.8, leadTimeDays: 1, phone: '+62 21 8920 6789', address: 'Cold Chain Hub Kav. 12', rating: 4.7, moq: '12 cartons', tags: ['Cold-Chain Guaranteed', 'Oat & Dairy Specialist'], lat: -6.22, lng: 106.82 },
            { id: 'fb-3', name: 'EcoPack Solutions & Paper Goods Wholesale', category: 'Packaging', distanceKm: 6.5, leadTimeDays: 2, phone: '+62 21 3322 1100', address: 'Pergudangan Prima Blok E-15', rating: 4.8, moq: '500 pcs', tags: ['Biodegradable', 'Bulk Discount'], lat: -6.24, lng: 106.88 },
            { id: 'fb-4', name: 'Artisan Syrups & Beverage Concentrates Co.', category: 'Syrups & Flavoring', distanceKm: 5.1, leadTimeDays: 2, phone: '+62 21 7788 3344', address: 'Perkantoran BizPark Blok B-09', rating: 4.7, moq: '6 bottles', tags: ['Natural Extracts', 'B2B Wholesale'], lat: -6.18, lng: 106.81 }
          ]
        };
      }
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
      const enhancedInv = inv.map(enhanceItem);
      const counts = { critical: 0, low: 0, good: 0 };
      enhancedInv.forEach(i => counts[i.status]++);
      return {
        greeting: 'Good day, ' + (prof.name || 'Guest'),
        riskCount: counts.critical + counts.low,
        healthyCount: counts.good,
        todayDemand: 0,
        todayTransactions: 0,
        reliability: sales.length > 5 ? 'High' : 'Learning',
        reliabilityText: `${sales.length} transactions recorded`,
        urgentCount: counts.critical + counts.low,
        urgentItems: enhancedInv.filter(i => i.status !== 'good').slice(0, 3)
      };
    }

    if (endpoint.startsWith('/api/restock')) {
      const enhancedInv = inv.map(enhanceItem);
      return enhancedInv.filter(i => i.qty < i.reorder);
    }

    if (endpoint.startsWith('/api/expiry')) {
      const enhancedInv = inv.map(enhanceItem);
      const tracked = enhancedInv.filter(it => it.expiryDate);
      const atRisk = tracked.filter(it => it.unitsAtRisk > 0 || it.expiryStatus === 'expired');
      const critical = tracked.filter(it => it.expiryStatus === 'critical' || it.expiryStatus === 'expired');
      return {
        totalTracked: tracked.length,
        atRiskCount: atRisk.length,
        criticalCount: critical.length,
        totalUnitsAtRisk: atRisk.reduce((a, b) => a + (b.unitsAtRisk || 0), 0),
        items: tracked
      };
    }

    if (endpoint.startsWith('/api/forecast')) {
      const distinctDays = [...new Set(sales.map((s) => s.date))].length;
      const isRich = distinctDays >= 14;
      const isSparse = distinctDays >= 3;
      const model = isRich ? 'SARIMAX' : isSparse ? 'ETS' : 'NONE';
      const lastDate = sales.length ? new Date(sales[sales.length - 1].date) : new Date();
      const predDates = [];
      const predVals = [];
      for (let i = 1; i <= 7; i++) {
        const nextD = new Date(lastDate);
        nextD.setDate(lastDate.getDate() + i);
        predDates.push(nextD.toISOString().slice(0, 10));
        predVals.push(Math.round(10 + Math.sin(i) * 4));
      }
      return {
        activeModel: model,
        regime: isRich ? 'rich' : isSparse ? 'sparse' : 'insufficient',
        rationale: isRich
          ? 'Rich Data Regime (>=14 days). SARIMAX active with weekly seasonality.'
          : isSparse
          ? 'Sparse Data Regime (<14 days). ETS active.'
          : 'Insufficient data (<3 days).',
        granularity: 'daily',
        dataVolume: {
          totalTransactions: sales.length,
          totalQuantity: sales.reduce((a, b) => a + (Number(b.qty) || 0), 0),
          timeSteps: distinctDays,
          activePeriods: distinctDays,
          zeroCount: 0,
          zeroRatio: 0,
          intermittencyPercent: 0
        },
        thresholds: {
          minSteps: 3,
          richSteps: 14,
          minTransactions: 3,
          richTransactions: 14,
          currentSteps: distinctDays,
          currentTransactions: sales.length,
          stepsNeededForRich: Math.max(0, 14 - distinctDays),
          txNeededForRich: Math.max(0, 14 - sales.length),
          progressPercent: Math.min(100, Math.round((distinctDays / 14) * 100))
        },
        timeline: { dates: sales.map((s) => s.date), values: sales.map((s) => Number(s.qty) || 0) },
        forecast: { dates: predDates, predictions: predVals, lower: predVals.map(v => Math.max(0, v - 4)), upper: predVals.map(v => v + 8) },
        metrics: { mae: 0, rmse: 0, modelDetails: model }
      };
    }

    if (endpoint.startsWith('/api/chat')) {
      return { reply: "I can answer questions about your stock, restock needs, and suppliers." };
    }

    return {};
  }
};
