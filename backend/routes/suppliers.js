const express = require('express');
const router = express.Router();
const store = require('../data/store');

// GET /api/suppliers
router.get('/', (req, res) => {
  try {
    res.json(store.getSuppliers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers
router.post('/', (req, res) => {
  try {
    const { name, category, lat, lng } = req.body;
    const supplier = store.addSupplier({ name, category, lat, lng });
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
