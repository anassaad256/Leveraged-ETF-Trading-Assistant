# Leveraged ETF Trading Assistant

Crash-aware, pre-crash 6-month quintile mean-reversion analysis for **long-only 2×/3× leveraged ETFs**.

Built with Next.js 14 (React frontend + API routes), deployable to Vercel in one click.

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/anassaad256/Leveraged-ETF-Trading-Assistant)

No environment variables required — defaults to Yahoo Finance (no API key needed).

## Run Locally

```bash
git clone https://github.com/anassaad256/Leveraged-ETF-Trading-Assistant.git
cd Leveraged-ETF-Trading-Assistant
npm install
npm run dev
# Open http://localhost:3000
```

## Run Tests

```bash
npm test
```

31 unit tests covering crash detection, quintile construction, status labeling, entry/exit logic, and full pipeline integration.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATA_PROVIDER` | `yahoo` | `yahoo` (no key) or `tiingo` (needs key) |
| `TIINGO_API_KEY` | — | Required only if `DATA_PROVIDER=tiingo` |
| `CACHE_TTL` | `900` | Cache duration in seconds (15 min default) |

## API

### `GET /api/analyze?symbol=TQQQ`

Returns JSON with the full analysis:

```json
{
  "symbol": "TQQQ",
  "asOfDate": "2026-02-07",
  "dataProvider": "Yahoo Finance",
  "crashDetected": false,
  "crashOnsetDate": null,
  "referenceWindow": {
    "type": "rolling_6m",
    "start": "2025-08-07",
    "end": "2026-02-07",
    "refHigh": 85.50,
    "refLow": 62.30,
    "tradingDays": 126
  },
  "currentPrice": 72.10,
  "quintiles": [
    { "name": "Q1", "label": "Cheapest", "low": 62.30, "high": 66.94 },
    { "name": "Q2", "label": "Below Average", "low": 66.94, "high": 71.58 },
    { "name": "Q3", "label": "Neutral", "low": 71.58, "high": 76.22 },
    { "name": "Q4", "label": "Expensive", "low": 76.22, "high": 80.86 },
    { "name": "Q5", "label": "Stretched", "low": 80.86, "high": 85.50 }
  ],
  "currentQuintile": "Q3",
  "status": "inside Q3",
  "bestBuyAssessment": {
    "action": "WAIT",
    "bestBuyZone": "Q1",
    "note": "Price is in Q3 — well above optimal entry..."
  },
  "staggeredEntryPlan": [
    { "tranche": "Upper Q1", "priceRange": [64.62, 66.94] },
    { "tranche": "Mid Q1", "priceRange": [62.30, 64.62] },
    { "tranche": "Lower Q1 / Overshoot", "priceRange": [59.19, 62.30] }
  ],
  "exitZones": { ... },
  "primaryRisk": ["..."],
  "summary": { "action": "PARTIAL_SELL", "text": "..." }
}
```

## Methodology

1. **Data**: Daily adjusted close, ≥12 months via Yahoo Finance or Tiingo
2. **Crash detection** (deterministic):
   - Rolling 30-day peak-to-trough drawdown ≤ −15%, OR
   - (10-day RV / 30-day RV > 1.3) AND (≥3 days with return ≤ −2.5% in last 10 days)
3. **Reference window**: 6 calendar months ending before crash onset (if crash) or at analysis date (if no crash)
4. **Quintiles**: 5 equal bands from reference low to reference high (Q1 cheapest → Q5 stretched)
5. **Entry**: Buy only in Q1 or below; staggered 3-tranche plan; never buy above Q2
6. **Exit**: Partial at early Q3, full at early Q4, strongly discourage Q5. Exit rules override entry rules.
7. **Risk**: Always warns about volatility decay and path dependence

## Architecture

```
src/
├── app/
│   ├── layout.js           # Root layout
│   ├── page.js              # Main UI (client component)
│   ├── globals.css           # Tailwind + print styles
│   └── api/analyze/route.js  # GET endpoint
├── components/
│   └── ReportCard.js         # Report rendering + copy/print
└── lib/
    ├── analysis.js           # Core analysis engine (pure functions)
    ├── dataProvider.js        # Yahoo Finance + Tiingo fetchers
    └── cache.js               # In-memory TTL cache
```

## Rules Enforced

- No inverse ETFs, no shorting
- Never recommend buy above Q2
- Never average up
- Exit rules override entry rules
- Quintiles never re-anchor downward during crashes
- Below-Q1 during crash = overshoot, not new normal
