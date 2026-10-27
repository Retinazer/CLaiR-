const express = require('express');
const router = express.Router();
const { getExpiryForecast } = require('../services/analyticsService');

// GET /api/expiry
// Returns comprehensive expiry and spoilage risk forecast
router.get('/', (req, res) => {
  try {
    const data = getExpiryForecast();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
