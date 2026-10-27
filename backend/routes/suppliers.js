const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { discoverSuppliers } = require('../services/supplierService');

// GET /api/suppliers
router.get('/', (req, res) => {
  try {
    res.json(store.getSuppliers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers/discover?q=coffee&category=coffee&lat=-6.2&lng=106.8&radius=30
router.get('/discover', async (req, res) => {
  try {
    const { q, query, category, lat, lng, radius } = req.query;
    const results = await discoverSuppliers({
      query: q || query || '',
      category: category || '',
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
      radiusKm: radius ? parseFloat(radius) : 50
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers
router.post('/', (req, res) => {
  try {
    const { name, category, lat, lng, phone, address, leadTimeDays } = req.body;
    const supplier = store.addSupplier({ name, category, lat, lng, phone, address, leadTimeDays });
    res.status(201).json(supplier);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', (req, res) => {
  try {
    const removed = store.deleteSupplier(req.params.id);
    res.json({ success: true, removed });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
