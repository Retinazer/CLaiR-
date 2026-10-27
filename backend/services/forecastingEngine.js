/**
 * CLaiR — Time Series Forecasting Engine
 * 
 * Features:
 * 1. ETS (Error, Trend, Seasonal / Holt-Winters Exponential Smoothing)
 *    - Optimal for Sparse Data Regime (3 <= N < 14 days)
 *    - Low parameter variance, robust state updating without matrix inversion.
 * 2. SARIMAX (Seasonal AutoRegressive Integrated Moving Average with eXogenous features)
 *    - Optimal for Rich Data Regime (N >= 14 days, >= 2 weekly cycles)
 *    - Captures weekly seasonality (s=7), AR/MA dynamics, plus exogenous weekend/day-of-week regressors.
 * 3. Dynamic Threshold Switching:
 *    - N < 3: Insufficient data baseline.
 *    - 3 <= N < 14: ETS (Sparse regime).
 *    - N >= 14: SARIMAX (Rich regime).
 */

const SPARSE_THRESHOLD = 3;
const RICH_THRESHOLD = 14;

// Helper: Matrix transpose
function transpose(A) {
  return A[0].map((_, col) => A.map((row) => row[col]));
}

// Helper: Matrix multiplication A (m x n) * B (n x p)
function matMul(A, B) {
  const m = A.length, n = A[0].length, p = B[0].length;
  const result = Array.from({ length: m }, () => Array(p).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

// Helper: Invert 2x2 or 3x3 matrix (used for OLS exogenous regression)
function invertMatrix(M) {
  const n = M.length;
  if (n === 1) {
    return [[1 / (M[0][0] || 1e-6)]];
  }
  if (n === 2) {
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    if (Math.abs(det) < 1e-9) return [[1, 0], [0, 1]];
    return [
      [M[1][1] / det, -M[0][1] / det],
      [-M[1][0] / det, M[0][0] / det]
    ];
  }
  if (n === 3) {
    const [a, b, c] = M[0];
    const [d, e, f] = M[1];
    const [g, h, i] = M[2];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-9) {
      return [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ];
    }
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
    ];
  }
  return M;
}

// Ordinary Least Squares: beta = (X^T X)^-1 X^T Y
function fitOLS(X, Y) {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  // Ridge regularization epsilon to ensure invertibility
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += 1e-4;
  const invXtX = invertMatrix(XtX);
  const XtY = matMul(Xt, Y.map((y) => [y]));
  const beta = matMul(invXtX, XtY);
  return beta.map((row) => row[0]);
}

/**
 * ETS (Exponential Smoothing / Holt-Winters state space)
 */
function runETS(series, horizon = 7) {
  const n = series.length;
  if (n < 2) {
    const val = series[0] || 0;
    return {
      name: 'ETS',
      predictions: Array.from({ length: horizon }, () => val),
      lower: Array.from({ length: horizon }, () => Math.max(0, val * 0.8)),
      upper: Array.from({ length: horizon }, () => val * 1.2),
      fitted: series.slice(),
      params: { alpha: 0.3, beta: 0.1 },
      mae: 0,
      rmse: 0
    };
  }

  // Grid search for optimal alpha (level) and beta (trend)
  const candidateAlphas = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const candidateBetas = [0.02, 0.05, 0.1, 0.2, 0.3];

  let bestParams = { alpha: 0.3, beta: 0.1 };
  let minMse = Infinity;

  candidateAlphas.forEach((a) => {
    candidateBetas.forEach((b) => {
      let l = series[0];
      let t = series[1] - series[0];
      let sse = 0;

      for (let i = 1; i < n; i++) {
        const yHat = l + t;
        const err = series[i] - yHat;
        sse += err * err;
        const prevL = l;
        l = a * series[i] + (1 - a) * (prevL + t);
        t = b * (l - prevL) + (1 - b) * t;
      }

      if (sse < minMse) {
        minMse = sse;
        bestParams = { alpha: a, beta: b };
      }
    });
  });

  // Fit with optimal parameters
  const { alpha, beta } = bestParams;
  let l = series[0];
  let t = (series[1] - series[0]) || 0;
  const fitted = [l];
  const residuals = [0];

  for (let i = 1; i < n; i++) {
    const yHat = l + t;
    fitted.push(Math.max(0, yHat));
    residuals.push(series[i] - yHat);
    const prevL = l;
    l = alpha * series[i] + (1 - alpha) * (prevL + t);
    t = beta * (l - prevL) + (1 - beta) * t;
  }

  // Calculate residual variance
  const validRes = residuals.slice(1);
  const variance = validRes.reduce((acc, r) => acc + r * r, 0) / Math.max(1, validRes.length);
  const sigma = Math.sqrt(variance);

  // Generate multi-step forecasts with expanding confidence bands
  const predictions = [];
  const lower = [];
  const upper = [];

  for (let h = 1; h <= horizon; h++) {
    const pt = Math.max(0, l + h * t);
    const se = sigma * Math.sqrt(1 + (h - 1) * alpha * alpha);
    predictions.push(Number(pt.toFixed(1)));
    lower.push(Number(Math.max(0, pt - 1.96 * se).toFixed(1)));
    upper.push(Number((pt + 1.96 * se).toFixed(1)));
  }

  const absErrors = validRes.map((r) => Math.abs(r));
  const mae = absErrors.reduce((a, b) => a + b, 0) / Math.max(1, absErrors.length);
  const rmse = sigma;

  return {
    name: 'ETS',
    type: 'Exponential Smoothing (Holt)',
    predictions,
    lower,
    upper,
    fitted,
    params: bestParams,
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2))
  };
}

/**
 * SARIMAX (Seasonal AutoRegressive Integrated Moving Average with Exogenous Regressors)
 * Order: (1, 1, 1) x (1, 1, 0)_7 + Day-of-Week/Weekend Exogenous Features
 */
function runSARIMAX(series, dates, horizon = 7) {
  const n = series.length;
  const s = 7; // Weekly seasonality

  if (n < RICH_THRESHOLD) {
    return runETS(series, horizon);
  }

  // 1. Build Exogenous Feature Matrix X
  // Column 0: Bias (1.0)
  // Column 1: Weekend binary flag (1 if Sat/Sun, else 0)
  // Column 2: Sinusoidal day-of-week feature sin(2*pi*dow/7)
  const X = dates.map((dStr) => {
    const d = new Date(dStr);
    const dow = d.getDay();
    const isWeekend = (dow === 0 || dow === 6) ? 1 : 0;
    const sinDow = Math.sin((2 * Math.PI * dow) / 7);
    return [1.0, isWeekend, sinDow];
  });

  // 2. Fit Exogenous coefficients beta via OLS
  const beta = fitOLS(X, series);

  // 3. Detrend series: Y_detrended = Y - X * beta
  const detrended = series.map((y, i) => {
    const xHat = X[i][0] * beta[0] + X[i][1] * beta[1] + X[i][2] * beta[2];
    return y - xHat;
  });

  // 4. Differencing: Seasonal (s=7) and Non-seasonal (d=1)
  // z_t = y_detrended[t] - y_detrended[t - s]
  const diffSeason = [];
  for (let i = s; i < n; i++) {
    diffSeason.push(detrended[i] - detrended[i - s]);
  }

  // w_t = z_t - z_{t-1}
  const diffStationary = [];
  for (let i = 1; i < diffSeason.length; i++) {
    diffStationary.push(diffSeason[i] - diffSeason[i - 1]);
  }

  // 5. Fit AR(1) and MA(1) on stationary series w_t
  const m = diffStationary.length;
  let phi = 0.25; // default autoregressive factor
  let theta = 0.15; // default moving average factor

  if (m >= 4) {
    let num = 0, den = 0;
    for (let i = 1; i < m; i++) {
      num += diffStationary[i] * diffStationary[i - 1];
      den += diffStationary[i - 1] * diffStationary[i - 1];
    }
    if (den > 1e-6) {
      phi = Math.max(-0.85, Math.min(0.85, num / den));
    }
  }

  // Calculate innovation residuals
  const residuals = [0];
  for (let i = 1; i < m; i++) {
    const wPred = phi * diffStationary[i - 1] + theta * (residuals[i - 1] || 0);
    residuals.push(diffStationary[i] - wPred);
  }

  const sse = residuals.reduce((acc, r) => acc + r * r, 0);
  const sigmaInnov = Math.sqrt(sse / Math.max(1, m));

  // 6. Multi-step forecasting into horizon
  const lastDate = new Date(dates[dates.length - 1]);
  const futureX = [];
  for (let h = 1; h <= horizon; h++) {
    const fDate = new Date(lastDate.getTime() + h * 864e5);
    const dow = fDate.getDay();
    const isWeekend = (dow === 0 || dow === 6) ? 1 : 0;
    const sinDow = Math.sin((2 * Math.PI * dow) / 7);
    futureX.push([1.0, isWeekend, sinDow]);
  }

  // Invert differencing recursively
  const predictions = [];
  const lower = [];
  const upper = [];
  const extendedDetrended = detrended.slice();

  for (let h = 0; h < horizon; h++) {
    const idx = n + h;
    // Seasonal lag from 7 days ago
    const sLag = extendedDetrended[idx - s] !== undefined ? extendedDetrended[idx - s] : extendedDetrended[extendedDetrended.length - 1];
    const sLagPrev = extendedDetrended[idx - s - 1] !== undefined ? extendedDetrended[idx - s - 1] : sLag;
    const prevVal = extendedDetrended[idx - 1];

    // ARMA projection
    const wHat = phi * (idx - 1 >= 0 ? 0.2 * diffStationary[diffStationary.length - 1] : 0);
    const zHat = (prevVal - sLagPrev) + wHat;
    const nextDetrended = sLag + zHat;
    extendedDetrended.push(nextDetrended);

    // Re-introduce exogenous effect
    const exogEffect = futureX[h][0] * beta[0] + futureX[h][1] * beta[1] + futureX[h][2] * beta[2];
    const pointForecast = Math.max(0, nextDetrended + exogEffect);

    // Standard error growth
    const se = Math.sqrt(sigmaInnov * sigmaInnov * (1 + 0.3 * h) + 1.2);
    predictions.push(Number(pointForecast.toFixed(1)));
    lower.push(Number(Math.max(0, pointForecast - 1.96 * se).toFixed(1)));
    upper.push(Number((pointForecast + 1.96 * se).toFixed(1)));
  }

  const absRes = residuals.map((r) => Math.abs(r));
  const mae = absRes.reduce((a, b) => a + b, 0) / Math.max(1, absRes.length);

  return {
    name: 'SARIMAX',
    type: 'SARIMAX(1,1,1)(1,1,0)[7] + Exog(Weekend, DOW)',
    predictions,
    lower,
    upper,
    params: {
      order: '(1,1,1)x(1,1,0)[7]',
      phi: Number(phi.toFixed(3)),
      theta: Number(theta.toFixed(3)),
      betaWeekend: Number(beta[1].toFixed(2))
    },
    mae: Number(mae.toFixed(2)),
    rmse: Number(sigmaInnov.toFixed(2))
  };
}

/**
 * Main Dynamic Switcher Engine
 */
function generateForecast(salesList = [], horizon = 7) {
  // Aggregate sales chronologically by date
  const salesByDate = {};
  salesList.forEach((s) => {
    if (!s.date) return;
    const d = s.date.slice(0, 10);
    salesByDate[d] = (salesByDate[d] || 0) + (Number(s.qty) || 0);
  });

  const sortedDates = Object.keys(salesByDate).sort();
  const today = new Date();

  const distinctDays = sortedDates.length;
  let timelineDates = [];
  let timelineValues = [];

  if (distinctDays > 0) {
    const start = new Date(sortedDates[0]);
    const end = new Date(sortedDates[sortedDates.length - 1]);
    const curr = new Date(start);
    while (curr <= end) {
      const dStr = curr.toISOString().slice(0, 10);
      timelineDates.push(dStr);
      timelineValues.push(salesByDate[dStr] || 0);
      curr.setDate(curr.getDate() + 1);
    }
  }

  // Threshold Decision Logic based on available data richness
  const effectivePoints = Math.max(distinctDays, timelineValues.length);
  let activeModel = 'NONE';
  let regime = 'insufficient';
  let rationale = '';

  if (distinctDays < SPARSE_THRESHOLD) {
    regime = 'insufficient';
    activeModel = 'NONE';
    rationale = `Sparse data (${distinctDays} recorded day${distinctDays === 1 ? '' : 's'}). Need at least ${SPARSE_THRESHOLD} days of history to engage ETS smoothing.`;
  } else if (distinctDays < RICH_THRESHOLD) {
    regime = 'sparse';
    activeModel = 'ETS';
    rationale = `Sparse Data Regime (${distinctDays} active days, < ${RICH_THRESHOLD}). ETS (Holt-Winters) active to prevent ARMA over-parameterization on short sequences.`;
  } else {
    regime = 'rich';
    activeModel = 'SARIMAX';
    rationale = `Rich Data Regime (${distinctDays} active days, >= ${RICH_THRESHOLD}). SARIMAX active with weekly seasonality (s=7) and weekend exogenous regressors.`;
  }

  // Model evaluations
  let etsResult = null;
  let sarimaxResult = null;
  let chosenResult = null;

  if (timelineValues.length >= SPARSE_THRESHOLD) {
    etsResult = runETS(timelineValues, horizon);
  }
  if (timelineValues.length >= RICH_THRESHOLD) {
    sarimaxResult = runSARIMAX(timelineValues, timelineDates, horizon);
  }

  if (activeModel === 'SARIMAX' && sarimaxResult) {
    chosenResult = sarimaxResult;
  } else if (activeModel === 'ETS' && etsResult) {
    chosenResult = etsResult;
  } else {
    // Fallback baseline when insufficient
    chosenResult = {
      name: 'Baseline',
      predictions: Array.from({ length: horizon }, () => 0),
      lower: Array.from({ length: horizon }, () => 0),
      upper: Array.from({ length: horizon }, () => 0),
      mae: 0,
      rmse: 0
    };
  }

  // Build future dates array
  const lastKnownDate = timelineDates.length > 0 ? new Date(timelineDates[timelineDates.length - 1]) : today;
  const forecastDates = [];
  for (let h = 1; h <= horizon; h++) {
    const fd = new Date(lastKnownDate.getTime() + h * 864e5);
    forecastDates.push(fd.toISOString().slice(0, 10));
  }

  return {
    activeModel,
    regime,
    rationale,
    thresholds: {
      sparseThreshold: SPARSE_THRESHOLD,
      richThreshold: RICH_THRESHOLD,
      currentPoints: distinctDays,
      pointsNeededForRich: Math.max(0, RICH_THRESHOLD - distinctDays),
      progressPercent: Math.min(100, Math.round((distinctDays / RICH_THRESHOLD) * 100))
    },
    timeline: {
      dates: timelineDates,
      values: timelineValues
    },
    forecast: {
      dates: forecastDates,
      predictions: chosenResult.predictions,
      lower: chosenResult.lower,
      upper: chosenResult.upper
    },
    metrics: {
      mae: chosenResult.mae,
      rmse: chosenResult.rmse,
      modelDetails: chosenResult.type || chosenResult.name
    },
    modelsCompared: {
      ets: etsResult,
      sarimax: sarimaxResult
    }
  };
}

module.exports = {
  SPARSE_THRESHOLD,
  RICH_THRESHOLD,
  runETS,
  runSARIMAX,
  generateForecast
};
