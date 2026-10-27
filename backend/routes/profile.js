const express = require('express');
const router = express.Router();
const store = require('../data/store');

// GET /api/profile
router.get('/', (req, res) => {
  try {
    res.json(store.getProfile());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile
router.put('/', (req, res) => {
  try {
    const updated = store.updateProfile(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
