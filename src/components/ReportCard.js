'use client';

/**
 * Format the full report as plain text for clipboard copy.
 */
export function formatReportText(d) {
  const line = '═'.repeat(55);
  const q = d.quintiles.map(q => `  ${q.name} (${q.label}): $${q.low.toFixed(2)} – $${q.high.toFixed(2)}`).reverse().join('\n');
  const entry = d.staggeredEntryPlan.map(t => `  ${t.tranche}: $${t.priceRange[0].toFixed(2)} – $${t.priceRange[1].toFixed(2)}`).join('\n');
  const exitLines = Object.values(d.exitZones).map(z => `  ${z.label}: ${z.range}`).join('\n');
  const risks = d.primaryRisk.map(r => `  • ${r}`).join('\n');

  return `${line}
ANALYSIS: ${d.symbol}
As of: ${d.asOfDate}  |  Data: ${d.dataProvider}
${line}

REFERENCE WINDOW
  Type: ${d.referenceWindow.type === 'pre_crash_6m' ? 'Pre-crash 6-month' : 'Rolling 6-month'}
  Period: ${d.referenceWindow.start} to ${d.referenceWindow.end}
  Trading Days: ${d.referenceWindow.tradingDays}
  Crash Detected: ${d.crashDetected ? `Yes (onset: ${d.crashOnsetDate}, method: ${d.crashMethod})` : 'No'}

QUINTILE STRUCTURE
  Reference High: $${d.referenceWindow.refHigh.toFixed(2)}
  Reference Low:  $${d.referenceWindow.refLow.toFixed(2)}
${q}

CURRENT STATUS
  Price: $${d.currentPrice.toFixed(2)}
  Quintile: ${d.currentQuintile}
  Status: ${d.status}

BUY ASSESSMENT
  Action: ${d.bestBuyAssessment.action}
  Best Zone: ${d.bestBuyAssessment.bestBuyZone}
  ${d.bestBuyAssessment.note}

STAGGERED ENTRY PLAN
${entry}

EXIT ZONES
${exitLines}
${d.exitSignal ? `\n  ACTIVE SIGNAL: ${d.exitSignal}` : ''}

PRIMARY RISK
${risks}

SUMMARY
  ${d.summary.action}: ${d.summary.text}
${line}`;
}

function Badge({ action }) {
  const colors = {
    BUY_NOW: 'bg-green-900/60 text-green-400 border-green-700/50',
    PREPARE: 'bg-yellow-900/60 text-yellow-400 border-yellow-700/50',
    WAIT: 'bg-gray-800 text-gray-400 border-gray-700',
    SELL: 'bg-red-900/60 text-red-400 border-red-700/50',
    PARTIAL_SELL: 'bg-orange-900/60 text-orange-400 border-orange-700/50',
  };
  return (
    <span className={`inline-block font-bold px-4 py-1.5 rounded-lg border text-sm ${colors[action] || colors.WAIT}`}>
      {action.replace('_', ' ')}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 sm:p-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>
      {children}
    </div>
  );
}

function QuintileBar({ quintiles, currentPrice }) {
  const q1Low = quintiles[0].low;
  const q5High = quintiles[4].high;
  const range = q5High - q1Low;
  const extLow = Math.min(q1Low, currentPrice) - range * 0.06;
  const extHigh = Math.max(q5High, currentPrice) + range * 0.06;
  const full = extHigh - extLow;

  const colors = [
    { bg: 'rgba(21,128,61,0.25)', border: '#15803d', text: '#22c55e' },
    { bg: 'rgba(29,78,237,0.2)', border: '#1d4ed8', text: '#60a5fa' },
    { bg: 'rgba(161,98,7,0.25)', border: '#a16207', text: '#eab308' },
    { bg: 'rgba(194,65,12,0.25)', border: '#c2410c', text: '#f97316' },
    { bg: 'rgba(153,27,27,0.25)', border: '#991b1b', text: '#ef4444' },
  ];

  const pricePct = ((currentPrice - extLow) / full) * 100;

  return (
    <div className="relative" style={{ height: 240 }}>
      {quintiles.map((q, i) => {
        const bottom = ((q.low - extLow) / full) * 100;
        const height = ((q.high - q.low) / full) * 100;
        return (
          <div
            key={q.name}
            className="absolute left-16 sm:left-20 right-2 rounded flex items-center px-2 sm:px-3 transition-all"
            style={{
              bottom: `${bottom}%`,
              height: `${height}%`,
              background: colors[i].bg,
              border: `1px solid ${colors[i].border}40`,
            }}
          >
            <span className="text-[10px] sm:text-xs font-medium" style={{ color: colors[i].text }}>
              {q.name} — {q.label}
            </span>
            <span className="text-[10px] sm:text-xs font-mono ml-auto hidden sm:inline" style={{ color: colors[i].text + '90' }}>
              ${q.low.toFixed(2)}–${q.high.toFixed(2)}
            </span>
          </div>
        );
      })}
      <div
        className="absolute left-0 right-0 flex items-center z-10"
        style={{ bottom: `${pricePct}%` }}
      >
        <span className="text-[10px] sm:text-xs font-mono font-bold text-blue-400 w-16 sm:w-20 text-right pr-1.5">
          ${currentPrice.toFixed(2)}
        </span>
        <div className="flex-1 h-0.5 bg-blue-500 rounded shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
        <span className="text-[10px] text-blue-400 pl-1.5 whitespace-nowrap">&#9664; Current</span>
      </div>
    </div>
  );
}

export default function ReportCard({ data }) {
  const d = data;

  function handleCopy() {
    navigator.clipboard.writeText(formatReportText(d));
  }

  return (
    <div id="report-card" className="space-y-5 animate-in fade-in">
      {/* Header */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold font-mono">{d.symbol}</h2>
          <p className="text-xs text-gray-500 mt-1">
            As of {d.asOfDate} &middot; Data: {d.dataProvider}
          </p>
          {d.symbolWarning && (
            <p className="text-xs text-yellow-400 mt-1.5">{d.symbolWarning}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge action={d.summary.action} />
          <button
            onClick={handleCopy}
            className="no-print text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors"
            title="Copy report to clipboard"
          >
            Copy
          </button>
          <button
            onClick={() => window.print()}
            className="no-print text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors"
            title="Print / Save as PDF"
          >
            PDF
          </button>
        </div>
      </div>

      {/* Reference Window */}
      <Section title="Reference Window">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500 text-xs">Type</span>
            <p className="font-medium mt-0.5">
              {d.referenceWindow.type === 'pre_crash_6m' ? 'Pre-crash 6-month' : 'Rolling 6-month'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Period</span>
            <p className="font-medium mt-0.5">{d.referenceWindow.start} to {d.referenceWindow.end}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Crash Detected</span>
            <p className="mt-0.5">
              {d.crashDetected ? (
                <span className="text-red-400 font-semibold">Yes — {d.crashOnsetDate}</span>
              ) : (
                <span className="text-green-400">No</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Trading Days</span>
            <p className="font-medium mt-0.5">{d.referenceWindow.tradingDays}</p>
          </div>
        </div>
      </Section>

      {/* Quintile Visualization */}
      <Section title="Quintile Structure">
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-gray-500 text-xs">Reference High</span>
            <p className="font-mono font-medium">${d.referenceWindow.refHigh.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Reference Low</span>
            <p className="font-mono font-medium">${d.referenceWindow.refLow.toFixed(2)}</p>
          </div>
        </div>
        <QuintileBar quintiles={d.quintiles} currentPrice={d.currentPrice} />
      </Section>

      {/* Current Status */}
      <Section title="Current Status">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500 text-xs">Price</span>
            <p className="text-xl font-bold font-mono mt-0.5">${d.currentPrice.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Quintile</span>
            <p className="font-semibold mt-0.5">{d.currentQuintile}</p>
          </div>
          <div className="col-span-2">
            <span className="text-gray-500 text-xs">Status</span>
            <p className="mt-0.5">{d.status} — {d.statusDetail}</p>
          </div>
        </div>
      </Section>

      {/* Buy Assessment */}
      <Section title="Buy Assessment">
        <div className="flex items-start gap-3 mb-4">
          <Badge action={d.bestBuyAssessment.action} />
          <p className="text-sm text-gray-300 pt-0.5">{d.bestBuyAssessment.note}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">Staggered Entry Plan</h4>
          <div className="space-y-2">
            {d.staggeredEntryPlan.map((t, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
                <span className="font-medium text-green-400 font-mono w-40 shrink-0">{t.tranche}</span>
                <span className="font-mono">${t.priceRange[0].toFixed(2)} – ${t.priceRange[1].toFixed(2)}</span>
                <span className="text-gray-500 text-xs sm:ml-auto">{t.note}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Exit Zones */}
      <Section title="Exit Zones">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {Object.entries(d.exitZones).map(([key, zone]) => {
            const colorMap = {
              partialProfit: 'border-yellow-800/40 bg-yellow-900/15 text-yellow-400',
              asymmetryWarning: 'border-orange-800/40 bg-orange-900/15 text-orange-400',
              fullExit: 'border-red-800/40 bg-red-900/15 text-red-400',
              discourageHold: 'border-red-800/50 bg-red-900/20 text-red-300',
            };
            return (
              <div key={key} className={`rounded-lg border p-3 ${colorMap[key]}`}>
                <p className="text-xs font-semibold uppercase">{zone.label}</p>
                <p className="font-mono text-lg font-bold mt-1">{zone.range}</p>
              </div>
            );
          })}
        </div>
        {d.exitSignal && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3">
            <p className="text-red-300 text-sm font-semibold">Active Signal: {d.exitSignal}</p>
          </div>
        )}
      </Section>

      {/* Primary Risk */}
      <Section title="Primary Risk">
        <ul className="space-y-2">
          {d.primaryRisk.map((risk, i) => (
            <li key={i} className="text-sm text-gray-300 leading-relaxed flex gap-2">
              <span className="text-gray-500 shrink-0">{i === 0 ? '!' : '•'}</span>
              {risk}
            </li>
          ))}
        </ul>
      </Section>

      {/* Summary */}
      <Section title="Summary">
        <p className="text-gray-300 leading-relaxed mb-4">{d.summary.text}</p>
        <div className="pt-3 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Final Recommendation</span>
          <Badge action={d.summary.action} />
        </div>
      </Section>

      <p className="text-[10px] text-gray-600 text-center py-3 no-print">
        For informational/educational purposes only. Not financial advice.
        Leveraged ETFs carry substantial risk including total loss of capital.
      </p>
    </div>
  );
}
