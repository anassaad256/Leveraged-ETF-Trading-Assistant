/**
 * Data provider: fetches daily adjusted close prices.
 *
 * Supports:
 *   - "yahoo" (default) — Yahoo Finance v8 chart API, no key needed
 *   - "tiingo" — Tiingo REST API, requires TIINGO_API_KEY
 */

const cache = require('./cache');

/**
 * Fetch daily price data for a symbol.
 * Returns sorted array of { date: "YYYY-MM-DD", close: number }.
 */
async function fetchDailyPrices(symbol, months = 14) {
  const cacheKey = `prices:${symbol.toUpperCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const provider = (process.env.DATA_PROVIDER || 'yahoo').toLowerCase();

  let data;
  if (provider === 'tiingo') {
    data = await fetchFromTiingo(symbol, months);
  } else {
    data = await fetchFromYahoo(symbol, months);
  }

  if (!data || data.length === 0) {
    throw new Error(`No price data returned for "${symbol}". Verify the symbol is valid.`);
  }

  cache.set(cacheKey, data);
  return data;
}

// ─── Yahoo Finance (v8 chart API) ───────────────────────────────────────────

async function fetchFromYahoo(symbol, months) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - months * 30 * 86400;

  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${now}&interval=1d&events=history`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LeveragedETFAssistant/1.0)',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || text.includes('No data found')) {
      throw new Error(`Symbol "${symbol}" not found on Yahoo Finance.`);
    }
    throw new Error(`Yahoo Finance API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No chart data for "${symbol}" from Yahoo Finance.`);
  }

  const timestamps = result.timestamp || [];
  const adjCloses = result.indicators?.adjclose?.[0]?.adjclose;
  const regularCloses = result.indicators?.quote?.[0]?.close;
  const closes = adjCloses || regularCloses;

  if (!closes || closes.length === 0) {
    throw new Error(`No price series for "${symbol}" from Yahoo Finance.`);
  }

  const dailyData = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null && !isNaN(closes[i]) && closes[i] > 0) {
      const dt = new Date(timestamps[i] * 1000);
      const dateStr = dt.toISOString().slice(0, 10);
      dailyData.push({ date: dateStr, close: closes[i] });
    }
  }

  // Sort ascending and deduplicate by date
  dailyData.sort((a, b) => a.date.localeCompare(b.date));
  return dedup(dailyData);
}

// ─── Tiingo ─────────────────────────────────────────────────────────────────

async function fetchFromTiingo(symbol, months) {
  const apiKey = process.env.TIINGO_API_KEY;
  if (!apiKey) {
    throw new Error('TIINGO_API_KEY environment variable is required when DATA_PROVIDER=tiingo');
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startStr}&endDate=${endStr}&token=${apiKey}`;

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Symbol "${symbol}" not found on Tiingo.`);
    }
    throw new Error(`Tiingo API error (${res.status})`);
  }

  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(`No data returned for "${symbol}" from Tiingo.`);
  }

  const dailyData = json
    .filter(d => d.adjClose != null && d.adjClose > 0)
    .map(d => ({
      date: d.date.slice(0, 10),
      close: d.adjClose,
    }));

  dailyData.sort((a, b) => a.date.localeCompare(b.date));
  return dedup(dailyData);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dedup(data) {
  const seen = new Set();
  return data.filter(d => {
    if (seen.has(d.date)) return false;
    seen.add(d.date);
    return true;
  });
}

function getProviderName() {
  const p = (process.env.DATA_PROVIDER || 'yahoo').toLowerCase();
  return p === 'tiingo' ? 'Tiingo' : 'Yahoo Finance';
}

module.exports = { fetchDailyPrices, getProviderName };
