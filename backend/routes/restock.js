const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getRestockRecommendations, getItemStatus } = require('../services/analyticsService');

// GET /api/restock
router.get('/', (req, res) => {
  try {
    const list = getRestockRecommendations();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/restock
// Body: { sku, qty }
router.post('/', (req, res) => {
  try {
    const { sku, qty } = req.body;
    const q = parseInt(qty, 10);
    if (!sku || isNaN(q) || q <= 0) {
      return res.status(400).json({ error: 'Valid SKU and positive quantity are required' });
    }
    const updated = store.updateInventoryStock(sku, q);
    const { calculateItemMetrics } = require('../services/analyticsService');
    const enhanced = calculateItemMetrics(updated, store.getSales(), store.getSuppliers());
    res.json({
      success: true,
      item: enhanced
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
