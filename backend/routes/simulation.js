const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { getOverviewData } = require('../services/analyticsService');

// GET /api/simulation
router.get('/', (req, res) => {
  try {
    const state = store.getSimulationState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulation/advance
// Body: { simulateSales: boolean, days: number }
router.post('/advance', (req, res) => {
  try {
    const { simulateSales = true, days = 1 } = req.body;
    const result = store.advanceSimulationDay({ simulateSales, days });
    const overview = getOverviewData();
    res.json({ ...result, overview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulation/reset
router.post('/reset', (req, res) => {
  try {
    const result = store.resetSimulation();
    const overview = getOverviewData();
    res.json({ ...result, overview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
