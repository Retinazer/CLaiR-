const express = require('express');
const router = express.Router();
const { getOverviewData } = require('../services/analyticsService');

// GET /api/overview
router.get('/', (req, res) => {
  try {
    const data = getOverviewData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
