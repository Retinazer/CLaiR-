const express = require('express');
const router = express.Router();
const store = require('../data/store');
const { generateForecast } = require('../services/forecastingEngine');

// GET /api/forecast
// Query params: ?horizon=7 &range=1d|1w|1m &granularity=daily|hourly
router.get('/', (req, res) => {
  try {
    let horizon = 7;
    const range = req.query.range;
    if (range === '1d') horizon = 1;
    else if (range === '1w') horizon = 7;
    else if (range === '1m') horizon = 30;
    else if (req.query.horizon) horizon = parseInt(req.query.horizon, 10) || 7;

    const granularity = req.query.granularity === 'hourly' ? 'hourly' : 'daily';
    const sales = store.getSales();
    const result = generateForecast(sales, { horizon, granularity });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
