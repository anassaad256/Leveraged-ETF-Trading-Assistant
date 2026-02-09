const {
  detectCrash,
  computeReferenceWindow,
  computeQuintiles,
  determineStatus,
  generateEntryPlan,
  generateExitZones,
  validateSymbol,
  runAnalysis,
} = require('../src/lib/analysis');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate synthetic daily data */
function makeDailyData(prices, startDate = '2025-01-02') {
  const dt = new Date(startDate + 'T00:00:00Z');
  return prices.map((close, i) => {
    const d = new Date(dt);
    d.setUTCDate(d.getUTCDate() + i);
    // Skip weekends roughly
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return { date: d.toISOString().slice(0, 10), close };
  });
}

/** Generate a linear price series */
function linearPrices(start, end, count) {
  return Array.from({ length: count }, (_, i) => start + (end - start) * (i / (count - 1)));
}

/** Generate stable prices then a crash */
function crashScenario() {
  // 100 days stable around 100, then 30-day crash from 100 to 80 (20% drop)
  const stable = Array.from({ length: 100 }, () => 100 + (Math.random() - 0.5) * 2);
  const crash = linearPrices(100, 80, 30);
  return [...stable, ...crash];
}

// ─── Crash Detection ────────────────────────────────────────────────────────

describe('detectCrash', () => {
  test('detects crash when 15%+ drawdown in 30 days', () => {
    // Stable at 100 then drops to 83 (17% decline)
    const prices = [
      ...Array(80).fill(100),
      ...linearPrices(100, 83, 25),
    ];
    const data = makeDailyData(prices);
    const result = detectCrash(data);

    expect(result.detected).toBe(true);
    expect(result.method).toBe('drawdown');
    expect(result.onsetDate).toBeTruthy();
  });

  test('no crash on normal price action', () => {
    // Gentle uptrend, never drops 15%
    const prices = linearPrices(90, 110, 120);
    const data = makeDailyData(prices);
    const result = detectCrash(data);

    expect(result.detected).toBe(false);
    expect(result.onsetDate).toBeNull();
  });

  test('no crash with insufficient data', () => {
    const data = makeDailyData([100, 101, 99]);
    const result = detectCrash(data);
    expect(result.detected).toBe(false);
  });

  test('crash onset date is the peak before the decline', () => {
    // Peak at day 50 (price 120), then crash to 100 (16.7% decline)
    const up = linearPrices(100, 120, 50);
    const down = linearPrices(120, 100, 30);
    const prices = [...up, ...down];
    const data = makeDailyData(prices);
    const result = detectCrash(data);

    expect(result.detected).toBe(true);
    // Onset should be near the peak
    expect(result.onsetIndex).toBeLessThan(55);
    expect(result.onsetIndex).toBeGreaterThanOrEqual(45);
  });
});

// ─── Quintile Construction ──────────────────────────────────────────────────

describe('computeQuintiles', () => {
  test('divides range into 5 equal bands', () => {
    const q = computeQuintiles(100, 50);

    expect(q).toHaveLength(5);
    expect(q[0].name).toBe('Q1');
    expect(q[0].low).toBe(50);
    expect(q[0].high).toBe(60);
    expect(q[1].low).toBe(60);
    expect(q[1].high).toBe(70);
    expect(q[2].low).toBe(70);
    expect(q[2].high).toBe(80);
    expect(q[3].low).toBe(80);
    expect(q[3].high).toBe(90);
    expect(q[4].low).toBe(90);
    expect(q[4].high).toBe(100);
  });

  test('labels are correct order', () => {
    const q = computeQuintiles(200, 100);
    expect(q[0].label).toBe('Cheapest');
    expect(q[4].label).toBe('Stretched');
  });

  test('handles degenerate range (high == low)', () => {
    const q = computeQuintiles(100, 100);
    expect(q).toHaveLength(5);
    // All bands collapse to same price
    expect(q[0].low).toBe(100);
    expect(q[4].high).toBe(100);
  });
});

// ─── Status Labeling ────────────────────────────────────────────────────────

describe('determineStatus', () => {
  const quintiles = computeQuintiles(100, 50);

  test('below Q1 overshoot', () => {
    const s = determineStatus(45, quintiles);
    expect(s.quintile).toBe('Below Q1');
    expect(s.status).toContain('overshoot');
  });

  test('above Q5 breakout', () => {
    const s = determineStatus(105, quintiles);
    expect(s.quintile).toBe('Above Q5');
    expect(s.status).toContain('breakout');
  });

  test('inside Q1', () => {
    const s = determineStatus(55, quintiles);
    expect(s.quintile).toBe('Q1');
    expect(s.status).toContain('inside Q1');
  });

  test('inside Q3', () => {
    const s = determineStatus(75, quintiles);
    expect(s.quintile).toBe('Q3');
    expect(s.status).toContain('inside Q3');
  });

  test('inside Q5', () => {
    const s = determineStatus(95, quintiles);
    expect(s.quintile).toBe('Q5');
    expect(s.status).toContain('inside Q5');
  });

  test('touching boundary detection', () => {
    // Price within 0.25% of Q1 lower boundary (50)
    const s = determineStatus(50.1, quintiles);
    expect(s.status).toContain('touching');
  });
});

// ─── Entry Logic ────────────────────────────────────────────────────────────

describe('generateEntryPlan', () => {
  const quintiles = computeQuintiles(100, 50);

  test('BUY_NOW when inside Q1', () => {
    const status = determineStatus(55, quintiles);
    const plan = generateEntryPlan(quintiles, status, false);
    expect(plan.action).toBe('BUY_NOW');
    expect(plan.staggeredEntryPlan).toHaveLength(3);
  });

  test('BUY_NOW when below Q1', () => {
    const status = determineStatus(45, quintiles);
    const plan = generateEntryPlan(quintiles, status, true);
    expect(plan.action).toBe('BUY_NOW');
    expect(plan.note).toContain('overshoot');
  });

  test('PREPARE when in Q2', () => {
    const status = determineStatus(65, quintiles);
    const plan = generateEntryPlan(quintiles, status, false);
    expect(plan.action).toBe('PREPARE');
  });

  test('WAIT when in Q3 or higher', () => {
    const status = determineStatus(75, quintiles);
    const plan = generateEntryPlan(quintiles, status, false);
    expect(plan.action).toBe('WAIT');
  });

  test('WAIT when in Q5', () => {
    const status = determineStatus(95, quintiles);
    const plan = generateEntryPlan(quintiles, status, false);
    expect(plan.action).toBe('WAIT');
  });

  test('never recommends buy above Q2', () => {
    for (const price of [75, 85, 95, 105]) {
      const status = determineStatus(price, quintiles);
      const plan = generateEntryPlan(quintiles, status, false);
      expect(['WAIT', 'PREPARE']).toContain(plan.action);
    }
  });
});

// ─── Exit Logic ─────────────────────────────────────────────────────────────

describe('generateExitZones', () => {
  const quintiles = computeQuintiles(100, 50);

  test('no active signal when in Q1', () => {
    const status = determineStatus(55, quintiles);
    const exit = generateExitZones(quintiles, status);
    expect(exit.activeSignal).toBeNull();
  });

  test('partial sell signal in Q3', () => {
    const status = determineStatus(75, quintiles);
    const exit = generateExitZones(quintiles, status);
    expect(exit.activeSignal).toContain('PARTIAL_SELL');
  });

  test('sell signal in Q4', () => {
    const status = determineStatus(85, quintiles);
    const exit = generateExitZones(quintiles, status);
    expect(exit.activeSignal).toContain('SELL');
  });

  test('sell signal in Q5', () => {
    const status = determineStatus(95, quintiles);
    const exit = generateExitZones(quintiles, status);
    expect(exit.activeSignal).toContain('SELL');
  });

  test('has all four exit zone types', () => {
    const status = determineStatus(55, quintiles);
    const exit = generateExitZones(quintiles, status);
    expect(exit.zones.partialProfit).toBeDefined();
    expect(exit.zones.asymmetryWarning).toBeDefined();
    expect(exit.zones.fullExit).toBeDefined();
    expect(exit.zones.discourageHold).toBeDefined();
  });
});

// ─── Symbol Validation ──────────────────────────────────────────────────────

describe('validateSymbol', () => {
  test('recognizes TQQQ as valid', () => {
    const v = validateSymbol('TQQQ');
    expect(v.valid).toBe(true);
    expect(v.warning).toBeNull();
  });

  test('rejects SQQQ as inverse', () => {
    const v = validateSymbol('SQQQ');
    expect(v.valid).toBe(false);
    expect(v.warning).toContain('inverse');
  });

  test('warns for unknown symbols', () => {
    const v = validateSymbol('AAPL');
    expect(v.valid).toBe(true);
    expect(v.warning).toBeTruthy();
  });
});

// ─── Full Pipeline ──────────────────────────────────────────────────────────

describe('runAnalysis (integration)', () => {
  test('produces complete output for normal market', () => {
    const prices = linearPrices(80, 100, 200);
    const data = makeDailyData(prices, '2025-01-02');
    const result = runAnalysis('TEST', data);

    expect(result.symbol).toBe('TEST');
    expect(result.currentPrice).toBeCloseTo(100, 0);
    expect(result.quintiles).toHaveLength(5);
    expect(result.bestBuyAssessment.action).toBeDefined();
    expect(result.staggeredEntryPlan).toHaveLength(3);
    expect(result.exitZones).toBeDefined();
    expect(result.primaryRisk.length).toBeGreaterThan(0);
    expect(result.summary.action).toBeDefined();
  });

  test('produces complete output for crash scenario', () => {
    const prices = crashScenario();
    const data = makeDailyData(prices, '2024-06-01');
    const result = runAnalysis('TEST', data);

    expect(result.crashDetected).toBe(true);
    expect(result.referenceWindow.type).toBe('pre_crash_6m');
    expect(result.crashOnsetDate).toBeTruthy();
  });

  test('throws for insufficient data', () => {
    const data = makeDailyData([100, 101]);
    expect(() => runAnalysis('TEST', data)).toThrow('Insufficient');
  });

  test('exit rules override entry rules (Q4 = SELL even though not in buy zone)', () => {
    // Price ends in Q4 territory
    const prices = [...linearPrices(80, 95, 200)];
    const data = makeDailyData(prices, '2025-01-02');
    const result = runAnalysis('TEST', data);

    // If current price is in Q4/Q5, summary should reflect exit signal
    if (result.currentQuintile === 'Q4' || result.currentQuintile === 'Q5') {
      expect(result.summary.action).toBe('SELL');
    }
  });
});
