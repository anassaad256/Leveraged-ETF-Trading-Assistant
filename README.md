# Leveraged ETF Trading Assistant

A crash-aware, quintile mean-reversion trading framework for daily 2× leveraged ETFs.

## Quick Deploy to Vercel (Recommended)

### Option 1: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/anassaad256/Leveraged-ETF-Trading-Assistant)

### Option 2: CLI Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Login and deploy
vercel login
vercel --prod
```

### Option 3: GitHub Actions (auto-deploy on push)

1. Create a Vercel project: `vercel` (first-time setup)
2. Add these secrets to your GitHub repo (Settings → Secrets):
   - `VERCEL_TOKEN` — from https://vercel.com/account/tokens
   - `VERCEL_ORG_ID` — from `.vercel/project.json`
   - `VERCEL_PROJECT_ID` — from `.vercel/project.json`
3. Push to `main` — deploys automatically

## Run Locally

```bash
pip install -r requirements.txt
python3 run.py
# Open http://localhost:5000
```

## How It Works

1. **Data Acquisition** — Fetches 14 months of adjusted close prices via yfinance
2. **Crash Detection** — Identifies crash regimes via peak-to-trough decline, expanding volatility, or rapid acceleration
3. **Reference Window** — Uses rolling 6-month window, or freezes to pre-crash period if crash detected
4. **Quintile Construction** — Divides reference range into 5 equal bands
5. **Buy/Sell Logic** — Rules-based recommendations with staggered entry plans and exit zones

## Key Rules

- Never recommends buying above 2nd quintile
- Exit rules override entry rules
- Quintiles never re-anchor downward during crashes
- Below-1st-quintile prices in crashes are treated as overshoots, not new normals
