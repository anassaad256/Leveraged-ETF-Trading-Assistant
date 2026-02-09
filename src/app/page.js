'use client';

import { useState, useRef } from 'react';
import ReportCard from '@/components/ReportCard';

export default function Home() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  async function handleAnalyze(e) {
    e?.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(sym)}`);
      const contentType = res.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed.');
      }

      setResult(data);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50 no-print">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">
              Leveraged ETF Trading Assistant
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
              Crash-aware pre-crash 6-month quintile mean-reversion framework
            </p>
          </div>
          <span className="text-[10px] sm:text-xs text-gray-600 font-mono">2×/3× Long Only</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        {/* Input */}
        <form onSubmit={handleAnalyze} className="bg-gray-900 rounded-xl border border-gray-800 p-5 sm:p-6 mb-6 no-print">
          <label htmlFor="symbol-input" className="block text-sm font-medium text-gray-400 mb-2">
            Enter Leveraged ETF Symbol
          </label>
          <div className="flex gap-3">
            <input
              ref={inputRef}
              id="symbol-input"
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. TQQQ, SOXL, NVDL, UPRO"
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-lg font-mono
                         uppercase placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500
                         text-white font-semibold px-6 sm:px-8 py-3 rounded-lg transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
        </form>

        {/* Loading */}
        {loading && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-gray-400 text-sm">Fetching market data and running analysis...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-900/25 border border-red-700/50 rounded-xl p-5 mb-6">
            <p className="text-red-300 font-medium text-sm">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && <ReportCard data={result} />}
      </main>
    </>
  );
}
