const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

const DEFAULT_STATE = {
  inventory: [],
  sales: [],
  suppliers: [],
  profile: {
    name: '',
    business: '',
    role: 'Owner',
    locale: 'English',
    currency: 'IDR',
    city: 'Pagar Alam',
    region: 'Sumatera Selatan',
    lat: -4.015,
    lng: 103.25
  },
  simulation: {
    currentDate: null,
    dayOffset: 0
  }
};

let state = { ...DEFAULT_STATE };

function loadStore() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      state = Object.assign({}, DEFAULT_STATE, JSON.parse(data));
    } else {
      saveStore();
    }
  } catch (err) {
    console.error('Error reading database file:', err.message);
    state = { ...DEFAULT_STATE };
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving database file:', err.message);
  }
}

// Initial load
loadStore();

module.exports = {
  getInventory: () => state.inventory,
  
  addInventoryItem: (item) => {
    const exists = state.inventory.some(
      (i) => i.sku.toLowerCase() === item.sku.toLowerCase()
    );
    if (exists) {
      throw new Error('An item with this SKU already exists');
    }
    const newItem = {
      sku: String(item.sku).trim(),
      name: String(item.name).trim(),
      qty: Number(item.qty) || 0,
      unit: String(item.unit || 'pcs').trim(),
      reorder: Number(item.reorder) || 0,
      expiryDate: item.expiryDate ? String(item.expiryDate).trim() : null
    };
    state.inventory.push(newItem);
    saveStore();
    return newItem;
  },

  updateInventoryStock: (sku, delta) => {
    const item = state.inventory.find(
      (i) => i.sku.toLowerCase() === String(sku).toLowerCase()
    );
    if (!item) {
      throw new Error('Item not found');
    }
    item.qty = Math.max(0, item.qty + (Number(delta) || 0));
    saveStore();
    return item;
  },

  updateInventoryItem: (sku, updates = {}) => {
    const item = state.inventory.find(
      (i) => i.sku.toLowerCase() === String(sku).toLowerCase()
    );
    if (!item) {
      throw new Error('Item not found');
    }
    if (updates.name !== undefined) item.name = String(updates.name).trim();
    if (updates.qty !== undefined) item.qty = Math.max(0, Number(updates.qty) || 0);
    if (updates.unit !== undefined) item.unit = String(updates.unit).trim();
    if (updates.expiryDate !== undefined) item.expiryDate = updates.expiryDate ? String(updates.expiryDate).trim() : null;
    saveStore();
    return item;
  },

  deleteInventoryItem: (sku) => {
    const index = state.inventory.findIndex(
      (i) => i.sku.toLowerCase() === String(sku).toLowerCase()
    );
    if (index === -1) {
      throw new Error('Item not found');
    }
    const [removed] = state.inventory.splice(index, 1);
    saveStore();
    return removed;
  },

  getSales: () => state.sales,

  recordSale: ({ date, item, qty, rev }) => {
    const q = Number(qty) || 0;
    const r = Number(rev) || 0;
    const saleRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      date: date || (state.simulation && state.simulation.currentDate ? state.simulation.currentDate : new Date().toISOString().slice(0, 10)),
      item: String(item).trim(),
      qty: q,
      rev: r
    };
    state.sales.push(saleRecord);

    // Automatically decrement matching inventory quantity if item found
    const matched = state.inventory.find(
      (i) =>
        i.name.toLowerCase() === item.toLowerCase() ||
        i.sku.toLowerCase() === item.toLowerCase()
    );
    if (matched) {
      matched.qty = Math.max(0, matched.qty - q);
    }

    saveStore();
    return { sale: saleRecord, matchedInventory: matched || null };
  },

  deleteSale: (identifier) => {
    let index = -1;
    // Check if identifier is id or numeric index
    if (typeof identifier === 'string' && isNaN(Number(identifier))) {
      index = state.sales.findIndex((s) => s.id === identifier);
    } else {
      const idx = Number(identifier);
      if (idx >= 0 && idx < state.sales.length) {
        index = idx;
      }
    }
    if (index === -1) {
      throw new Error('Sale transaction not found');
    }
    const [removed] = state.sales.splice(index, 1);
    saveStore();
    return removed;
  },

  getSuppliers: () => state.suppliers,

  addSupplier: ({ name, category, lat, lng, phone, address, leadTimeDays }) => {
    if (!name || lat == null || lng == null) {
      throw new Error('Name, latitude, and longitude are required');
    }
    const newSupplier = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name: String(name).trim(),
      category: String(category || 'Supplier').trim(),
      lat: Number(lat),
      lng: Number(lng),
      phone: phone ? String(phone).trim() : '',
      address: address ? String(address).trim() : '',
      leadTimeDays: leadTimeDays != null ? Math.max(1, Number(leadTimeDays)) : 3
    };
    state.suppliers.push(newSupplier);
    saveStore();
    return newSupplier;
  },

  deleteSupplier: (identifier) => {
    let index = -1;
    if (typeof identifier === 'string' && isNaN(Number(identifier))) {
      index = state.suppliers.findIndex((s) => s.id === identifier);
    } else {
      const idx = Number(identifier);
      if (idx >= 0 && idx < state.suppliers.length) {
        index = idx;
      }
    }
    if (index === -1) {
      throw new Error('Supplier not found');
    }
    const [removed] = state.suppliers.splice(index, 1);
    saveStore();
    return removed;
  },

  getProfile: () => state.profile,

  updateProfile: (updates) => {
    state.profile = {
      ...state.profile,
      ...updates
    };
    saveStore();
    return state.profile;
  },

  getCurrentDate: () => {
    if (state.simulation && state.simulation.currentDate) {
      return state.simulation.currentDate;
    }
    return new Date().toISOString().slice(0, 10);
  },

  getSimulationState: () => {
    const isSimulated = !!(state.simulation && state.simulation.currentDate);
    const currentDate = isSimulated ? state.simulation.currentDate : new Date().toISOString().slice(0, 10);
    return {
      isSimulated,
      currentDate,
      dayOffset: state.simulation ? state.simulation.dayOffset || 0 : 0
    };
  },

  advanceSimulationDay: ({ simulateSales = true, days = 1 } = {}) => {
    let currDateStr = state.simulation && state.simulation.currentDate
      ? state.simulation.currentDate
      : new Date().toISOString().slice(0, 10);

    const curr = new Date(currDateStr);
    curr.setDate(curr.getDate() + Number(days || 1));
    const nextDateStr = curr.toISOString().slice(0, 10);

    if (!state.simulation) state.simulation = {};
    state.simulation.currentDate = nextDateStr;
    state.simulation.dayOffset = (state.simulation.dayOffset || 0) + Number(days || 1);

    const generatedSales = [];
    if (simulateSales && state.inventory.length > 0) {
      const txCount = Math.min(state.inventory.length, Math.floor(Math.random() * 3) + 2);
      const shuffled = state.inventory.slice().sort(() => 0.5 - Math.random());
      
      for (let i = 0; i < txCount; i++) {
        const item = shuffled[i];
        const q = Math.max(1, Math.min(item.qty > 0 ? item.qty : 3, Math.floor(Math.random() * 4) + 1));
        const unitPrice = 18000 + Math.floor(Math.random() * 6) * 5000;
        const rev = q * unitPrice;
        
        const saleRecord = {
          id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
          date: nextDateStr,
          item: item.name,
          qty: q,
          rev: rev
        };
        state.sales.push(saleRecord);
        generatedSales.push(saleRecord);

        // Deduct inventory
        item.qty = Math.max(0, item.qty - q);
      }
    }

    saveStore();
    return {
      success: true,
      currentDate: nextDateStr,
      dayOffset: state.simulation.dayOffset,
      generatedSales
    };
  },

  resetSimulation: () => {
    state.simulation = {
      currentDate: null,
      dayOffset: 0
    };
    saveStore();
    return {
      success: true,
      currentDate: new Date().toISOString().slice(0, 10)
    };
  }
};
