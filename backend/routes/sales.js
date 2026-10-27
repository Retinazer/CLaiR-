const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getSalesSummary } = require('../services/analyticsService');

// GET /api/sales
// Optional query ?days=30
router.get('/', (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const summary = getSalesSummary(days);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales
router.post('/', (req, res) => {
  try {
    const { date, item, qty, rev } = req.body;
    if (!item) {
      return res.status(400).json({ error: 'Item name is required' });
    }
    const result = store.recordSale({ date, item, qty, rev });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', (req, res) => {
  try {
    const removed = store.deleteSale(req.params.id);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
