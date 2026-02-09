/**
 * Crash-Aware Pre-Crash 6-Month Quintile Mean Reversion Analysis
 *
 * All functions are pure and deterministic:
 * same inputs => same outputs, no side effects.
 */

// ─── Known long-only leveraged ETFs (2× and 3×) ────────────────────────────

const KNOWN_LEVERAGED_LONG = new Set([
  // 3× Long
  'TQQQ','UPRO','SPXL','TECL','SOXL','FAS','TNA','LABU','NAIL',
  'CURE','DPST','RETL','DFEN','FNGU','BULZ','UDOW','UMDD',
  // 2× Long
  'SSO','QLD','DDM','MVV','UWM','UYG','ROM','UGE','UCC','DIG',
  'UPW','URE','UXI','BIB','NUGT','GUSH','UCO','AGQ','UGL','BOIL',
  // Single-stock 2× Long
  'NVDL','TSLL','AMZU','MSFU','AAPB','CONL','GGLL',
]);

const KNOWN_INVERSE = new Set([
  'SQQQ','SDS','QID','DXD','MZZ','SDD','TWM','SKF','REW','SSG',
  'SZK','SCC','DUG','SDP','SRS','SIJ','BIS','LABD','DUST','JDST',
  'DRIP','SCO','ZSL','GLL','KOLD','SPXS','TECS','FAZ','TZA','SOXS',
  'WEBS','FNGD','BERZ','SPXU','SDOW','SMDD',
]);

/**
 * Validate if symbol is a known long-only leveraged ETF.
 * Returns { valid, leverage, warning }.
 */
function validateSymbol(symbol) {
  const s = symbol.toUpperCase();
  if (KNOWN_INVERSE.has(s)) {
    return {
      valid: false,
      leverage: null,
      warning: `${s} is an inverse/short ETF. This framework only supports long-only leveraged ETFs.`,
    };
  }
  if (KNOWN_LEVERAGED_LONG.has(s)) {
    return { valid: true, leverage: '2x/3x Long', warning: null };
  }
  return {
    valid: true,
    leverage: 'Unknown',
    warning: `${s} is not in our recognized leveraged ETF list. Analysis will proceed, but this framework is designed for 2×/3× long-only leveraged ETFs.`,
  };
}

// ─── Crash Detection ────────────────────────────────────────────────────────

/**
 * Compute realized volatility (std of log returns) over a window.
 */
function realizedVol(closes, endIdx, window) {
  if (endIdx < window) return 0;
  const logReturns = [];
  for (let i = endIdx - window + 1; i <= endIdx; i++) {
    if (closes[i - 1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (logReturns.length < 2) return 0;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance);
}

/**
 * Detect crash regime using deterministic rules.
 *
 * Triggers if:
 *   A) Rolling 30-day peak-to-trough drawdown <= -15%  (checked over last 30 days)
 *   OR
 *   B) (10-day RV / 30-day RV > 1.3) AND (>= 3 days with return <= -2.5% in last 10 days)
 *
 * @param {Array<{date: string, close: number}>} dailyData - sorted ascending
 * @returns {{ detected: boolean, onsetDate: string|null, onsetIndex: number|null, method: string|null }}
 */
function detectCrash(dailyData) {
  const closes = dailyData.map(d => d.close);
  const n = closes.length;

  if (n < 31) {
    return { detected: false, onsetDate: null, onsetIndex: null, method: null };
  }

  // ── Method A: Rolling 30-day drawdown ──
  // For each of the last 30 trading days, compute rolling peak and drawdown
  let crashA = false;
  let onsetIdxA = null;

  for (let t = Math.max(29, n - 30); t < n; t++) {
    const windowStart = Math.max(0, t - 29);
    let peakVal = -Infinity;
    let peakIdx = windowStart;
    for (let j = windowStart; j <= t; j++) {
      if (closes[j] > peakVal) {
        peakVal = closes[j];
        peakIdx = j;
      }
    }
    if (peakVal <= 0) continue;
    const drawdown = (closes[t] - peakVal) / peakVal;
    if (drawdown <= -0.15) {
      crashA = true;
      onsetIdxA = peakIdx;
      break;
    }
  }

  // ── Method B: Volatility expansion + negative clustering ──
  let crashB = false;
  let onsetIdxB = null;

  if (n >= 31) {
    const rv10 = realizedVol(closes, n - 1, 10);
    const rv30 = realizedVol(closes, n - 1, 30);
    const volExpansion = rv30 > 0 && (rv10 / rv30) > 1.3;

    let negCount = 0;
    for (let i = n - 10; i < n; i++) {
      if (i > 0) {
        const ret = (closes[i] - closes[i - 1]) / closes[i - 1];
        if (ret <= -0.025) negCount++;
      }
    }
    const negCluster = negCount >= 3;

    if (volExpansion && negCluster) {
      crashB = true;
      // Onset = peak in last 30 days
      let peak = -Infinity;
      let peakIdx = n - 1;
      for (let i = Math.max(0, n - 30); i < n; i++) {
        if (closes[i] > peak) {
          peak = closes[i];
          peakIdx = i;
        }
      }
      onsetIdxB = peakIdx;
    }
  }

  if (crashA) {
    return {
      detected: true,
      onsetDate: dailyData[onsetIdxA].date,
      onsetIndex: onsetIdxA,
      method: 'drawdown',
    };
  }
  if (crashB) {
    return {
      detected: true,
      onsetDate: dailyData[onsetIdxB].date,
      onsetIndex: onsetIdxB,
      method: 'vol_cluster',
    };
  }
  return { detected: false, onsetDate: null, onsetIndex: null, method: null };
}

// ─── Reference Window ───────────────────────────────────────────────────────

/**
 * Compute the 6-month reference window.
 *
 * If crash detected: window ends the day BEFORE crash onset, starts 6 cal months prior.
 * If no crash: window ends on analysis date, starts 6 cal months prior.
 * Dates snap to nearest available trading day in data.
 *
 * @param {Array<{date: string, close: number}>} dailyData
 * @param {{ detected: boolean, onsetDate: string|null, onsetIndex: number|null }} crashInfo
 * @returns {{ type: string, startDate: string, endDate: string, refHigh: number, refLow: number, data: Array }}
 */
function computeReferenceWindow(dailyData, crashInfo) {
  let endDate, type;

  if (crashInfo.detected && crashInfo.onsetIndex !== null) {
    // End = day before crash onset
    const onsetIdx = crashInfo.onsetIndex;
    const endIdx = Math.max(0, onsetIdx - 1);
    endDate = dailyData[endIdx].date;
    type = 'pre_crash_6m';
  } else {
    endDate = dailyData[dailyData.length - 1].date;
    type = 'rolling_6m';
  }

  // Start = 6 calendar months before endDate
  const endDt = new Date(endDate + 'T00:00:00Z');
  const startDt = new Date(endDt);
  startDt.setUTCMonth(startDt.getUTCMonth() - 6);
  const startStr = startDt.toISOString().slice(0, 10);

  // Snap to nearest trading days in data
  const endIdx = findNearestIndex(dailyData, endDate, 'before');
  const startIdx = findNearestIndex(dailyData, startStr, 'after');

  if (startIdx >= endIdx || endIdx < 0) {
    // Fallback: use all available data before endIdx
    const fallbackStart = Math.max(0, endIdx - 125);
    const slice = dailyData.slice(fallbackStart, endIdx + 1);
    const closes = slice.map(d => d.close);
    return {
      type,
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      refHigh: Math.max(...closes),
      refLow: Math.min(...closes),
      data: slice,
    };
  }

  const slice = dailyData.slice(startIdx, endIdx + 1);
  const closes = slice.map(d => d.close);

  return {
    type,
    startDate: slice[0].date,
    endDate: slice[slice.length - 1].date,
    refHigh: Math.max(...closes),
    refLow: Math.min(...closes),
    data: slice,
  };
}

/** Find index of nearest trading day to target date. */
function findNearestIndex(dailyData, targetDate, direction) {
  if (direction === 'after') {
    for (let i = 0; i < dailyData.length; i++) {
      if (dailyData[i].date >= targetDate) return i;
    }
    return dailyData.length - 1;
  }
  // 'before'
  for (let i = dailyData.length - 1; i >= 0; i--) {
    if (dailyData[i].date <= targetDate) return i;
  }
  return 0;
}

// ─── Quintile Construction ──────────────────────────────────────────────────

/**
 * Divide reference range into 5 equal price bands.
 * Q1 = cheapest, Q5 = stretched.
 */
function computeQuintiles(refHigh, refLow) {
  const range = refHigh - refLow;
  if (range <= 0) {
    // Degenerate case: all prices identical
    return Array.from({ length: 5 }, (_, i) => ({
      name: `Q${i + 1}`,
      low: round(refLow),
      high: round(refHigh),
    }));
  }

  const labels = ['Cheapest', 'Below Average', 'Neutral', 'Expensive', 'Stretched'];
  return Array.from({ length: 5 }, (_, i) => ({
    name: `Q${i + 1}`,
    label: labels[i],
    low: round(refLow + i * 0.2 * range),
    high: round(refLow + (i + 1) * 0.2 * range),
  }));
}

// ─── Current Status ─────────────────────────────────────────────────────────

/**
 * Determine which quintile the current price falls into and label the status.
 * Epsilon = 0.25% of price for "touching" detection.
 */
function determineStatus(price, quintiles) {
  const epsilon = price * 0.0025;
  const q1Low = quintiles[0].low;
  const q5High = quintiles[4].high;

  if (price < q1Low) {
    const pctBelow = ((q1Low - price) / q1Low * 100).toFixed(1);
    return {
      quintile: 'Below Q1',
      status: `below Q1 (overshoot)`,
      detail: `${pctBelow}% below Q1 floor`,
    };
  }
  if (price > q5High) {
    const pctAbove = ((price - q5High) / q5High * 100).toFixed(1);
    return {
      quintile: 'Above Q5',
      status: 'above Q5 (breakout)',
      detail: `${pctAbove}% above Q5 ceiling`,
    };
  }

  for (const q of quintiles) {
    if (price >= q.low && price <= q.high) {
      if (Math.abs(price - q.low) <= epsilon) {
        return {
          quintile: q.name,
          status: `touching ${q.name} lower boundary`,
          detail: `At $${round(q.low)} boundary`,
        };
      }
      if (Math.abs(price - q.high) <= epsilon) {
        return {
          quintile: q.name,
          status: `touching ${q.name} upper boundary`,
          detail: `At $${round(q.high)} boundary`,
        };
      }
      return {
        quintile: q.name,
        status: `inside ${q.name}`,
        detail: `${q.label} zone`,
      };
    }
  }
  // Edge: falls between cracks due to rounding
  return { quintile: 'Q3', status: 'inside Q3', detail: 'Neutral zone' };
}

// ─── Entry Logic ────────────────────────────────────────────────────────────

/**
 * Generate buy assessment and staggered entry plan.
 *
 * Rules:
 * - Buy only if: first touch Q1, inside Q1, or below Q1 (overshoot).
 * - Never recommend buys above Q2.
 * - Staggered entries across upper/mid/lower Q1.
 */
function generateEntryPlan(quintiles, statusInfo, crashDetected) {
  const q1 = quintiles[0];
  const q1Mid = round((q1.low + q1.high) / 2);
  const q1Upper = round(q1.high);
  const q1Lower = round(q1.low);

  const staggeredEntryPlan = [
    {
      tranche: 'Upper Q1',
      priceRange: [q1Mid, q1Upper],
      note: 'Initial entry — first touch of Q1',
    },
    {
      tranche: 'Mid Q1',
      priceRange: [q1Lower, q1Mid],
      note: 'Add to position — deeper into value zone',
    },
    {
      tranche: 'Lower Q1 / Overshoot',
      priceRange: [round(q1Lower * 0.95), q1Lower],
      note: crashDetected
        ? 'Final tranche — overshoot territory, use smaller size'
        : 'Final tranche — overshoot if price breaks below Q1',
    },
  ];

  const qName = statusInfo.quintile;

  if (qName === 'Below Q1') {
    return {
      action: 'BUY_NOW',
      bestBuyZone: 'Below Q1 (overshoot)',
      note: 'Price is below Q1 — overshoot/dislocation zone. Valid buy with heightened caution. Use reduced position size.',
      staggeredEntryPlan,
    };
  }
  if (qName === 'Q1') {
    const isTouching = statusInfo.status.includes('touching');
    return {
      action: 'BUY_NOW',
      bestBuyZone: 'Q1',
      note: isTouching
        ? 'Price is touching Q1 — first touch entry signal. Begin staggered entries.'
        : 'Price is inside Q1 — valid buy zone. Use staggered entries across the tranche plan.',
      staggeredEntryPlan,
    };
  }
  if (qName === 'Q2') {
    return {
      action: 'PREPARE',
      bestBuyZone: 'Q1',
      note: `Price is in Q2 — approaching buy zone but not there yet. Best entry begins at $${q1Upper} (Q1 upper boundary). Do not buy here.`,
      staggeredEntryPlan,
    };
  }

  // Q3, Q4, Q5, Above Q5
  return {
    action: 'WAIT',
    bestBuyZone: 'Q1',
    note: `Price is in ${qName} — well above optimal entry. Best buy zone is Q1 ($${q1Lower}–$${q1Upper}). Do not buy at current levels.`,
    staggeredEntryPlan,
  };
}

// ─── Exit Logic ─────────────────────────────────────────────────────────────

/**
 * Generate exit zones based on quintile boundaries.
 */
function generateExitZones(quintiles, statusInfo) {
  const q3 = quintiles[2];
  const q4 = quintiles[3];
  const q5 = quintiles[4];

  const earlyQ3 = round(q3.low + (q3.high - q3.low) * 0.25);
  const earlyQ4 = round(q4.low + (q4.high - q4.low) * 0.25);

  const zones = {
    partialProfit: {
      range: `$${round(q3.low)}–$${earlyQ3}`,
      label: 'Early Q3 — partial profit-taking',
    },
    asymmetryWarning: {
      range: `$${earlyQ3}–$${round(q3.high)}`,
      label: 'Mid–Late Q3 — diminishing asymmetry',
    },
    fullExit: {
      range: `$${round(q4.low)}–$${earlyQ4}`,
      label: 'Early Q4 — full or near-full exit',
    },
    discourageHold: {
      range: `$${round(q5.low)}–$${round(q5.high)}`,
      label: 'Q5 — strongly discourage holding',
    },
  };

  // Active exit signal based on current position
  const qName = statusInfo.quintile;
  let activeSignal = null;
  if (qName === 'Q5' || qName === 'Above Q5') {
    activeSignal = 'SELL — Q5/above: strongly discourage holding. Full exit recommended now.';
  } else if (qName === 'Q4') {
    activeSignal = 'SELL — Early Q4: full or near-full exit recommended.';
  } else if (qName === 'Q3') {
    activeSignal = 'PARTIAL_SELL — Q3: consider partial profit-taking. Asymmetry diminishing.';
  }

  return { zones, activeSignal };
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

function assessRisk(statusInfo, crashInfo) {
  const qName = statusInfo.quintile;
  const risks = [];

  // Always warn about vol decay for leveraged instruments
  risks.push('Volatility decay / path dependence: Daily-reset leveraged ETFs suffer compounding drag in choppy markets. Returns over holding periods > 1 day can diverge significantly from the leverage multiple times the underlying return.');

  if (qName === 'Below Q1' && crashInfo.detected) {
    risks.unshift('Dislocation / regime break risk: Price is below the pre-crash reference range. This may indicate a structural regime change rather than a temporary overshoot. Position sizing must be conservative.');
  } else if ((qName === 'Below Q1' || qName === 'Q1') && crashInfo.detected) {
    risks.unshift('Drawdown continuation risk: Crash regime is active. Prices can continue falling further than historical norms suggest. Maintain reserves for additional tranches.');
  } else if (qName === 'Q4' || qName === 'Q5' || qName === 'Above Q5') {
    risks.unshift('Holding risk: In upper quintiles, the risk/reward is unfavorable. A mean-reversion move lower could be sharp and amplified by 2×/3× leverage.');
  }

  return risks;
}

// ─── Summary ────────────────────────────────────────────────────────────────

function generateSummary(entryPlan, exitZones, statusInfo) {
  // Exit rules have higher priority
  if (exitZones.activeSignal) {
    if (exitZones.activeSignal.startsWith('SELL')) {
      return { action: 'SELL', text: exitZones.activeSignal };
    }
    if (exitZones.activeSignal.startsWith('PARTIAL')) {
      return { action: 'PARTIAL_SELL', text: exitZones.activeSignal };
    }
  }

  return {
    action: entryPlan.action,
    text: `${entryPlan.action}: ${entryPlan.note}`,
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run the full analysis pipeline.
 *
 * @param {string} symbol
 * @param {Array<{date: string, close: number}>} dailyData - sorted ascending by date
 * @returns {object} Full analysis result
 */
function runAnalysis(symbol, dailyData) {
  if (!dailyData || dailyData.length < 30) {
    throw new Error(`Insufficient data for ${symbol}: only ${dailyData?.length || 0} days available (need ≥30).`);
  }

  const asOfDate = dailyData[dailyData.length - 1].date;
  const currentPrice = dailyData[dailyData.length - 1].close;
  const symbolInfo = validateSymbol(symbol);

  // 1. Crash detection
  const crashInfo = detectCrash(dailyData);

  // 2. Reference window
  const refWindow = computeReferenceWindow(dailyData, crashInfo);

  // 3. Quintiles
  const quintiles = computeQuintiles(refWindow.refHigh, refWindow.refLow);

  // 4. Current status
  const statusInfo = determineStatus(currentPrice, quintiles);

  // 5. Entry plan
  const entryPlan = generateEntryPlan(quintiles, statusInfo, crashInfo.detected);

  // 6. Exit zones
  const exitZones = generateExitZones(quintiles, statusInfo);

  // 7. Risk
  const risks = assessRisk(statusInfo, crashInfo);

  // 8. Summary (exit rules override entry)
  const summary = generateSummary(entryPlan, exitZones, statusInfo);

  return {
    symbol: symbol.toUpperCase(),
    asOfDate,
    symbolValidation: symbolInfo,
    crashDetected: crashInfo.detected,
    crashOnsetDate: crashInfo.onsetDate,
    crashMethod: crashInfo.method,
    referenceWindow: {
      type: refWindow.type,
      start: refWindow.startDate,
      end: refWindow.endDate,
      refHigh: round(refWindow.refHigh),
      refLow: round(refWindow.refLow),
      tradingDays: refWindow.data.length,
    },
    currentPrice: round(currentPrice),
    quintiles,
    currentQuintile: statusInfo.quintile,
    status: statusInfo.status,
    statusDetail: statusInfo.detail,
    bestBuyAssessment: {
      action: entryPlan.action,
      bestBuyZone: entryPlan.bestBuyZone,
      note: entryPlan.note,
    },
    staggeredEntryPlan: entryPlan.staggeredEntryPlan,
    exitZones: exitZones.zones,
    exitSignal: exitZones.activeSignal,
    primaryRisk: risks,
    summary: summary,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(n, decimals = 2) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

module.exports = {
  validateSymbol,
  detectCrash,
  computeReferenceWindow,
  computeQuintiles,
  determineStatus,
  generateEntryPlan,
  generateExitZones,
  assessRisk,
  generateSummary,
  runAnalysis,
  realizedVol,
  KNOWN_LEVERAGED_LONG,
  KNOWN_INVERSE,
};
