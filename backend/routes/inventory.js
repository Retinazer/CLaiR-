const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getEnhancedInventory, calculateItemMetrics } = require('../services/analyticsService');

// GET /api/inventory
router.get('/', (req, res) => {
  try {
    const items = getEnhancedInventory();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory
router.post('/', (req, res) => {
  try {
    const { sku, name, qty, unit, expiryDate } = req.body;
    if (!sku || !name) {
      return res.status(400).json({ error: 'SKU and item name are required' });
    }
    const item = store.addInventoryItem({ sku, name, qty, unit, expiryDate });
    const enhanced = calculateItemMetrics(item, store.getSales(), store.getSuppliers());
    res.status(201).json(enhanced);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/inventory/:sku
router.patch('/:sku', (req, res) => {
  try {
    const updated = store.updateInventoryItem(req.params.sku, req.body);
    const enhanced = calculateItemMetrics(updated, store.getSales(), store.getSuppliers());
    res.json(enhanced);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// PATCH /api/inventory/:sku/stock
router.patch('/:sku/stock', (req, res) => {
  try {
    const { delta } = req.body;
    const item = store.updateInventoryStock(req.params.sku, delta);
    const enhanced = calculateItemMetrics(item, store.getSales(), store.getSuppliers());
    res.json(enhanced);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /api/inventory/:sku
router.delete('/:sku', (req, res) => {
  try {
    const removed = store.deleteInventoryItem(req.params.sku);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
