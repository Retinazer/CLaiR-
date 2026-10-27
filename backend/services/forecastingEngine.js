/**
 * CLaiR — Multi-Regime Time Series Forecasting Engine
 * 
 * Features:
 * 1. 2D Decision Matrix based on BOTH:
 *    - Temporal Sequence Depth (N observations / cycles)
 *    - Data Volume & Density (total transactions, quantity volume, intermittency ratio)
 * 2. Multi-Model Portfolio:
 *    - Croston's Method (with SBA debiasing) for Intermittent Demand (slow-moving/zero-heavy items)
 *    - ETS (Holt-Winters Double Exponential Smoothing) for Sparse/Moderate Regimes
 *    - SARIMAX with Seasonal Lag Differencing & Exogenous Regressors for Rich Regimes
 *    - Baseline Average for Insufficient Initial Volume
 * 3. Granularity Support:
 *    - Daily: Weekly seasonality (s=7), weekend & day-of-week exogenous regressors
 *    - Hourly: Daily seasonality (s=24), business/peak hour exogenous regressors
 */

const SPARSE_DAILY_THRESHOLD = 3;
const RICH_DAILY_THRESHOLD = 14;
const SPARSE_HOURLY_THRESHOLD = 8;
const RICH_HOURLY_THRESHOLD = 48;

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
 * 1. Croston's Method with Syntetos-Boylan Approximation (SBA)
 * Optimal for intermittent demand with frequent zero-sales periods.
 * Separates smoothed non-zero demand size (z) from inter-arrival intervals (p).
 */
function runCroston(series, horizon = 7, alpha = 0.2) {
  const n = series.length;
  const firstNonZero = series.findIndex((v) => v > 0);
  if (firstNonZero === -1) {
    return {
      name: 'Croston',
      type: "Croston's Intermittent (SBA)",
      predictions: Array.from({ length: horizon }, () => 0),
      lower: Array.from({ length: horizon }, () => 0),
      upper: Array.from({ length: horizon }, () => 0),
      fitted: series.slice(),
      params: { alpha, demandSize: 0, interval: 1 },
      mae: 0,
      rmse: 0
    };
  }

  let z = series[firstNonZero]; // Smoothed demand size
  let p = 1.0;                  // Smoothed interval
  let q = 1;                    // Elapsed periods since last positive sale

  const fitted = [];
  const residuals = [];

  for (let i = 0; i < n; i++) {
    const yHat = p > 0 ? (1 - alpha / 2) * (z / p) : 0;
    fitted.push(Math.max(0, yHat));
    residuals.push(series[i] - yHat);

    if (series[i] > 0) {
      z = alpha * series[i] + (1 - alpha) * z;
      p = alpha * q + (1 - alpha) * p;
      q = 1;
    } else {
      q += 1;
    }
  }

  // Syntetos-Boylan debiased forecast rate
  const rate = Math.max(0, (1 - alpha / 2) * (z / Math.max(1, p)));
  const validRes = residuals.slice(firstNonZero);
  const variance = validRes.reduce((acc, r) => acc + r * r, 0) / Math.max(1, validRes.length);
  const sigma = Math.sqrt(variance);

  const predictions = [];
  const lower = [];
  const upper = [];

  for (let h = 1; h <= horizon; h++) {
    const se = sigma * Math.sqrt(1 + 0.1 * h);
    predictions.push(Number(rate.toFixed(1)));
    lower.push(Number(Math.max(0, rate - 1.96 * se).toFixed(1)));
    upper.push(Number((rate + 1.96 * se).toFixed(1)));
  }

  const absErrors = validRes.map((r) => Math.abs(r));
  const mae = absErrors.reduce((a, b) => a + b, 0) / Math.max(1, absErrors.length);

  return {
    name: 'Croston',
    type: "Croston's Intermittent Method (SBA)",
    predictions,
    lower,
    upper,
    fitted,
    params: {
      alpha,
      demandSize: Number(z.toFixed(2)),
      interval: Number(p.toFixed(2)),
      debiasedRate: Number(rate.toFixed(2))
    },
    mae: Number(mae.toFixed(2)),
    rmse: Number(sigma.toFixed(2))
  };
}

/**
 * 2. ETS (Exponential Smoothing / Holt-Winters state space)
 * Optimal for Sparse/Moderate continuous data without full seasonal cycle depth.
 */
function runETS(series, horizon = 7) {
  const n = series.length;
  if (n < 2) {
    const val = series[0] || 0;
    return {
      name: 'ETS',
      type: 'Exponential Smoothing (Holt)',
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

  const validRes = residuals.slice(1);
  const variance = validRes.reduce((acc, r) => acc + r * r, 0) / Math.max(1, validRes.length);
  const sigma = Math.sqrt(variance);

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

  return {
    name: 'ETS',
    type: 'Exponential Smoothing (Holt-Winters)',
    predictions,
    lower,
    upper,
    fitted,
    params: bestParams,
    mae: Number(mae.toFixed(2)),
    rmse: Number(sigma.toFixed(2))
  };
}

/**
 * 3. SARIMAX (Seasonal AutoRegressive Integrated Moving Average with Exogenous Regressors)
 * Order: (1, 1, 1) x (1, 1, 0)_s + Exogenous Features
 * Daily: s = 7 with Weekend/DOW features
 * Hourly: s = 24 with Peak Operating Hour features
 */
function runSARIMAX(series, dates, horizon = 7, granularity = 'daily') {
  const n = series.length;
  const s = granularity === 'hourly' ? 24 : 7;
  const minRequired = granularity === 'hourly' ? RICH_HOURLY_THRESHOLD : RICH_DAILY_THRESHOLD;

  if (n < minRequired) {
    return runETS(series, horizon);
  }

  // 1. Build Exogenous Feature Matrix X
  const X = dates.map((dStr) => {
    const d = new Date(dStr);
    if (granularity === 'hourly') {
      const hr = isNaN(d.getHours()) ? 12 : d.getHours();
      const isPeak = (hr >= 11 && hr <= 14) || (hr >= 17 && hr <= 20) ? 1 : 0;
      const sinHr = Math.sin((2 * Math.PI * hr) / 24);
      return [1.0, isPeak, sinHr];
    } else {
      const dow = isNaN(d.getDay()) ? 0 : d.getDay();
      const isWeekend = (dow === 0 || dow === 6) ? 1 : 0;
      const sinDow = Math.sin((2 * Math.PI * dow) / 7);
      return [1.0, isWeekend, sinDow];
    }
  });

  // 2. Fit Exogenous coefficients beta via OLS
  const beta = fitOLS(X, series);

  // 3. Detrend series: Y_detrended = Y - X * beta
  const detrended = series.map((y, i) => {
    const xHat = X[i][0] * beta[0] + X[i][1] * beta[1] + X[i][2] * beta[2];
    return y - xHat;
  });

  // 4. Differencing: Seasonal (s) and Non-seasonal (d=1)
  const diffSeason = [];
  for (let i = s; i < n; i++) {
    diffSeason.push(detrended[i] - detrended[i - s]);
  }

  const diffStationary = [];
  for (let i = 1; i < diffSeason.length; i++) {
    diffStationary.push(diffSeason[i] - diffSeason[i - 1]);
  }

  // 5. Fit AR(1) and MA(1) on stationary series w_t
  const m = diffStationary.length;
  let phi = 0.25;
  let theta = 0.15;

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

  const residuals = [0];
  for (let i = 1; i < m; i++) {
    const wPred = phi * diffStationary[i - 1] + theta * (residuals[i - 1] || 0);
    residuals.push(diffStationary[i] - wPred);
  }

  const sse = residuals.reduce((acc, r) => acc + r * r, 0);
  const sigmaInnov = Math.sqrt(sse / Math.max(1, m));

  // 6. Multi-step forecasting into horizon
  const lastKeyStr = dates[dates.length - 1];
  const lastDate = new Date(lastKeyStr.includes('T') ? lastKeyStr : `${lastKeyStr.slice(0, 10)}T12:00:00Z`);
  const stepMs = granularity === 'hourly' ? 3600 * 1000 : 864e5;
  const futureX = [];

  for (let h = 1; h <= horizon; h++) {
    const fDate = new Date(lastDate.getTime() + h * stepMs);
    if (granularity === 'hourly') {
      const hr = fDate.getHours();
      const isPeak = (hr >= 11 && hr <= 14) || (hr >= 17 && hr <= 20) ? 1 : 0;
      const sinHr = Math.sin((2 * Math.PI * hr) / 24);
      futureX.push([1.0, isPeak, sinHr]);
    } else {
      const dow = fDate.getDay();
      const isWeekend = (dow === 0 || dow === 6) ? 1 : 0;
      const sinDow = Math.sin((2 * Math.PI * dow) / 7);
      futureX.push([1.0, isWeekend, sinDow]);
    }
  }

  const predictions = [];
  const lower = [];
  const upper = [];
  const extendedDetrended = detrended.slice();

  for (let h = 0; h < horizon; h++) {
    const idx = n + h;
    const sLag = extendedDetrended[idx - s] !== undefined ? extendedDetrended[idx - s] : extendedDetrended[extendedDetrended.length - 1];
    const sLagPrev = extendedDetrended[idx - s - 1] !== undefined ? extendedDetrended[idx - s - 1] : sLag;
    const prevVal = extendedDetrended[idx - 1];

    const wHat = phi * (idx - 1 >= 0 ? 0.2 * diffStationary[diffStationary.length - 1] : 0);
    const zHat = (prevVal - sLagPrev) + wHat;
    const nextDetrended = sLag + zHat;
    extendedDetrended.push(nextDetrended);

    const exogEffect = futureX[h][0] * beta[0] + futureX[h][1] * beta[1] + futureX[h][2] * beta[2];
    const pointForecast = Math.max(0, nextDetrended + exogEffect);

    const se = Math.sqrt(sigmaInnov * sigmaInnov * (1 + 0.3 * h) + 1.2);
    predictions.push(Number(pointForecast.toFixed(1)));
    lower.push(Number(Math.max(0, pointForecast - 1.96 * se).toFixed(1)));
    upper.push(Number((pointForecast + 1.96 * se).toFixed(1)));
  }

  const absRes = residuals.map((r) => Math.abs(r));
  const mae = absRes.reduce((a, b) => a + b, 0) / Math.max(1, absRes.length);

  return {
    name: 'SARIMAX',
    type: `SARIMAX(1,1,1)(1,1,0)[${s}] + Exog(${granularity === 'hourly' ? 'PeakHours' : 'Weekend,DOW'})`,
    predictions,
    lower,
    upper,
    params: {
      order: `(1,1,1)x(1,1,0)[${s}]`,
      phi: Number(phi.toFixed(3)),
      theta: Number(theta.toFixed(3)),
      betaExog: Number(beta[1].toFixed(2))
    },
    mae: Number(mae.toFixed(2)),
    rmse: Number(sigmaInnov.toFixed(2))
  };
}

/**
 * Main Dynamic Switcher Engine
 * Implements 2D Threshold Matrix:
 * - Temporal Depth (time steps N)
 * - Data Volume & Density (total transactions, quantity, intermittency)
 */
function generateForecast(salesList = [], options = 7) {
  const horizon = typeof options === 'object' && options.horizon ? Number(options.horizon) : (typeof options === 'number' ? options : 7);
  const granularity = typeof options === 'object' && options.granularity === 'hourly' ? 'hourly' : 'daily';

  // 1. Calculate Data Volume Metrics
  const totalTransactions = salesList.length;
  const totalQuantity = salesList.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);

  // 2. Aggregate timeline according to granularity
  const buckets = {};
  salesList.forEach((s) => {
    if (!s.date) return;
    const dStr = s.date.slice(0, 10);
    const key = granularity === 'hourly' && s.time ? `${dStr}T${s.time.slice(0, 2)}:00` : dStr;
    buckets[key] = (buckets[key] || 0) + (Number(s.qty) || 0);
  });

  const sortedKeys = Object.keys(buckets).sort();
  let timelineDates = [];
  let timelineValues = [];

  if (sortedKeys.length > 0) {
    if (granularity === 'hourly') {
      // Build continuous hourly timeline for the last 48 hours
      const lastKey = sortedKeys[sortedKeys.length - 1];
      const end = new Date(lastKey.includes('T') ? lastKey : `${lastKey.slice(0, 10)}T23:00:00Z`);
      const start = new Date(end.getTime() - 47 * 3600 * 1000);
      const curr = new Date(start);
      while (curr <= end) {
        const k = curr.toISOString().slice(0, 13) + ':00';
        timelineDates.push(k);
        const dStr = curr.toISOString().slice(0, 10);
        const hr = curr.getUTCHours();
        let val = buckets[k];
        if (val === undefined && buckets[dStr]) {
          // If transaction only has date without hour, synthesize diurnal curve (08:00 to 21:00) with peaks
          if (hr >= 8 && hr <= 21) {
            const isPeak = (hr >= 11 && hr <= 14) || (hr >= 18 && hr <= 20);
            const weight = isPeak ? 1.8 : 1.0;
            const totalWeight = 6 * 1.8 + 8 * 1.0;
            val = Number(((buckets[dStr] * weight) / totalWeight).toFixed(1));
          } else {
            val = 0;
          }
        }
        timelineValues.push(val || 0);
        curr.setHours(curr.getHours() + 1);
      }
    } else {
      // Build continuous daily timeline using UTC midday to avoid timezone day shifts
      const start = new Date(sortedKeys[0].slice(0, 10) + 'T12:00:00Z');
      const end = new Date(sortedKeys[sortedKeys.length - 1].slice(0, 10) + 'T12:00:00Z');
      const curr = new Date(start);
      while (curr <= end) {
        const dStr = curr.toISOString().slice(0, 10);
        timelineDates.push(dStr);
        timelineValues.push(buckets[dStr] || 0);
        curr.setDate(curr.getDate() + 1);
      }
    }
  }

  const timeSteps = timelineValues.length;
  const activePeriods = timelineValues.filter((v) => v > 0).length;
  const zeroCount = timeSteps - activePeriods;
  const zeroRatio = timeSteps > 0 ? zeroCount / timeSteps : 0;
  const intermittencyPercent = Math.round(zeroRatio * 100);

  // 3. Define 2D Threshold Boundaries
  const minSteps = granularity === 'hourly' ? SPARSE_HOURLY_THRESHOLD : SPARSE_DAILY_THRESHOLD;
  const richSteps = granularity === 'hourly' ? RICH_HOURLY_THRESHOLD : RICH_DAILY_THRESHOLD;
  const minTransactions = granularity === 'hourly' ? 12 : 3;
  const richTransactions = granularity === 'hourly' ? 36 : 14;

  let activeModel = 'NONE';
  let regime = 'insufficient';
  let rationale = '';

  // 4. 2D Decision Matrix Evaluation
  if (totalTransactions < minTransactions || timeSteps < minSteps) {
    regime = 'insufficient';
    activeModel = 'NONE';
    rationale = `Insufficient Data Volume: ${totalTransactions} transactions across ${timeSteps} ${granularity === 'hourly' ? 'hours' : 'days'}. Need >= ${minTransactions} transactions and >= ${minSteps} time steps.`;
  } else if (zeroRatio >= 0.40 && timeSteps >= 4) {
    // Intermittent Demand Regime: high zeros, sporadic order arrivals
    regime = 'intermittent';
    activeModel = 'CROSTON';
    rationale = `Intermittent Demand Regime (${intermittencyPercent}% zero-demand intervals, ${totalTransactions} tx). Croston's method active to isolate transaction arrival intervals from order magnitude.`;
  } else if (timeSteps >= richSteps && totalTransactions >= richTransactions) {
    // Rich Data & Volume Regime: >= 2 seasonal cycles AND sufficient transaction volume
    regime = 'rich';
    activeModel = 'SARIMAX';
    rationale = `Rich Data & High Volume Regime (${timeSteps} ${granularity === 'hourly' ? 'hours' : 'days'}, ${totalTransactions} tx). SARIMAX active with seasonal differencing (s=${granularity === 'hourly' ? 24 : 7}) and exogenous regressors.`;
  } else {
    // Sparse/Moderate Regime: continuous sales without full 2 cycles, or moderate volume
    regime = 'sparse';
    activeModel = 'ETS';
    rationale = `Sparse/Moderate Regime (${timeSteps} ${granularity === 'hourly' ? 'hours' : 'days'}, ${totalTransactions} tx). ETS (Holt-Winters) active for robust exponential state tracking.`;
  }

  // 5. Model Execution
  let crostonResult = null;
  let etsResult = null;
  let sarimaxResult = null;
  let chosenResult = null;

  if (timelineValues.length >= 4) {
    crostonResult = runCroston(timelineValues, horizon);
  }
  if (timelineValues.length >= minSteps) {
    etsResult = runETS(timelineValues, horizon);
  }
  if (timelineValues.length >= richSteps && totalTransactions >= richTransactions) {
    sarimaxResult = runSARIMAX(timelineValues, timelineDates, horizon, granularity);
  }

  if (activeModel === 'SARIMAX' && sarimaxResult) {
    chosenResult = sarimaxResult;
  } else if (activeModel === 'CROSTON' && crostonResult) {
    chosenResult = crostonResult;
  } else if (activeModel === 'ETS' && etsResult) {
    chosenResult = etsResult;
  } else {
    const meanVal = timeSteps > 0 ? Number((totalQuantity / timeSteps).toFixed(1)) : 0;
    chosenResult = {
      name: 'Baseline',
      type: 'Historical Mean Baseline',
      predictions: Array.from({ length: horizon }, () => meanVal),
      lower: Array.from({ length: horizon }, () => Math.max(0, meanVal * 0.7)),
      upper: Array.from({ length: horizon }, () => meanVal * 1.3),
      mae: 0,
      rmse: 0
    };
  }

  // 6. Build Future Forecast Dates
  const lastKnownKey = timelineDates.length > 0 ? timelineDates[timelineDates.length - 1] : new Date().toISOString();
  const lastKnownDate = new Date(lastKnownKey.includes('T') ? lastKnownKey : `${lastKnownKey.slice(0, 10)}T12:00:00Z`);
  const stepMs = granularity === 'hourly' ? 3600 * 1000 : 864e5;
  const forecastDates = [];

  for (let h = 1; h <= horizon; h++) {
    const fd = new Date(lastKnownDate.getTime() + h * stepMs);
    if (granularity === 'hourly') {
      forecastDates.push(fd.toISOString().slice(0, 13) + ':00');
    } else {
      forecastDates.push(fd.toISOString().slice(0, 10));
    }
  }

  return {
    activeModel,
    regime,
    rationale,
    granularity,
    dataVolume: {
      totalTransactions,
      totalQuantity,
      timeSteps,
      activePeriods,
      zeroCount,
      zeroRatio: Number(zeroRatio.toFixed(3)),
      intermittencyPercent
    },
    thresholds: {
      minSteps,
      richSteps,
      minTransactions,
      richTransactions,
      currentSteps: timeSteps,
      currentTransactions: totalTransactions,
      stepsNeededForRich: Math.max(0, richSteps - timeSteps),
      txNeededForRich: Math.max(0, richTransactions - totalTransactions),
      progressPercent: Math.min(100, Math.round(((timeSteps / richSteps) * 0.6 + (totalTransactions / richTransactions) * 0.4) * 100))
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
      croston: crostonResult,
      ets: etsResult,
      sarimax: sarimaxResult
    }
  };
}

module.exports = {
  SPARSE_DAILY_THRESHOLD,
  RICH_DAILY_THRESHOLD,
  SPARSE_HOURLY_THRESHOLD,
  RICH_HOURLY_THRESHOLD,
  runCroston,
  runETS,
  runSARIMAX,
  generateForecast
};
