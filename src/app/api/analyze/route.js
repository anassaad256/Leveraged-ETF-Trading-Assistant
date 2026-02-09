import { NextResponse } from 'next/server';

const { fetchDailyPrices, getProviderName } = require('@/lib/dataProvider');
const { runAnalysis, validateSymbol, KNOWN_INVERSE } = require('@/lib/analysis');
const cache = require('@/lib/cache');

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json(
      { error: 'Missing required query parameter: symbol' },
      { status: 400 }
    );
  }

  if (!/^[A-Z]{1,10}$/.test(symbol)) {
    return NextResponse.json(
      { error: `Invalid symbol format: "${symbol}". Use 1-10 letters only.` },
      { status: 400 }
    );
  }

  // Block inverse ETFs
  if (KNOWN_INVERSE.has(symbol)) {
    return NextResponse.json(
      { error: `${symbol} is an inverse/short ETF. This tool only supports long-only 2×/3× leveraged ETFs.` },
      { status: 400 }
    );
  }

  // Check analysis cache
  const cacheKey = `analysis:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const dailyData = await fetchDailyPrices(symbol);
    const result = runAnalysis(symbol, dailyData);
    result.dataProvider = getProviderName();

    // Attach symbol validation warning
    const validation = validateSymbol(symbol);
    result.symbolWarning = validation.warning;

    cache.set(cacheKey, result);
    return NextResponse.json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { error: err.message || 'Analysis failed. Please try again.' },
      { status }
    );
  }
}
