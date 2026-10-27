const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getItemStatus } = require('../services/analyticsService');

// GET /api/inventory
router.get('/', (req, res) => {
  try {
    const items = store.getInventory().map((item) => ({
      ...item,
      status: getItemStatus(item)
    }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory
router.post('/', (req, res) => {
  try {
    const { sku, name, qty, unit, reorder } = req.body;
    if (!sku || !name) {
      return res.status(400).json({ error: 'SKU and item name are required' });
    }
    const item = store.addInventoryItem({ sku, name, qty, unit, reorder });
    res.status(201).json({
      ...item,
      status: getItemStatus(item)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/inventory/:sku/stock
router.patch('/:sku/stock', (req, res) => {
  try {
    const { delta } = req.body;
    const item = store.updateInventoryStock(req.params.sku, delta);
    res.json({
      ...item,
      status: getItemStatus(item)
    });
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
