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
    currency: 'IDR'
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
      reorder: Number(item.reorder) || 0
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
      date: date || new Date().toISOString().slice(0, 10),
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

  addSupplier: ({ name, category, lat, lng }) => {
    if (!name || !lat || !lng) {
      throw new Error('Name, latitude, and longitude are required');
    }
    const newSupplier = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name: String(name).trim(),
      category: String(category || 'Supplier').trim(),
      lat: Number(lat),
      lng: Number(lng)
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
  }
};
