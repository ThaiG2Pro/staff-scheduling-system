import type { TraceEvent } from '../../../../src/domain/schedulerTrace';

interface MetricsChartProps {
  readonly events: readonly TraceEvent[];
  readonly currentIndex: number;
}

export function MetricsChart({ events, currentIndex }: MetricsChartProps) {
  const current = events[currentIndex];
  const currentStepMetrics = current?.metrics ?? [];

  // Carry forward core solver KPIs in algorithm priority order:
  // (1) staffingGaps (Stage 1A) → (2) coveragePct (Stage 1B) → (3) jainIndex (Stage 2)
  const CORE_KEYS = ['staffingGaps', 'coveragePct', 'jainIndex'] as const;
  const latestCore = new Map<string, (typeof currentStepMetrics)[number]>();
  for (let i = 0; i <= currentIndex; i++) {
    const ev = events[i];
    if (!ev) continue;
    for (const m of ev.metrics) {
      if ((CORE_KEYS as readonly string[]).includes(m.key)) {
        latestCore.set(m.key, i === currentIndex ? m : { ...m, delta: undefined });
      }
    }
  }

  const displayedMetrics = (() => {
    const seen = new Set<string>();
    const merged: (typeof currentStepMetrics)[number][] = [];
    for (const key of CORE_KEYS) {
      const m = latestCore.get(key);
      if (m) {
        merged.push(m);
        seen.add(key);
      }
    }
    for (const m of currentStepMetrics) {
      if (!seen.has(m.key)) {
        merged.push(m);
        seen.add(m.key);
      }
    }
    return merged.slice(0, 4);
  })();

  // Build progression points for coveragePct (0..100) and jainIndex (0..1 -> 0..100%)
  const covPoints: { x: number; y: number }[] = [];
  const jainPoints: { x: number; y: number }[] = [];

  const maxIdx = Math.max(1, events.length - 1);
  for (let i = 0; i <= currentIndex; i++) {
    const ev = events[i];
    if (!ev) continue;
    for (const m of ev.metrics) {
      if (m.key === 'coveragePct') {
        covPoints.push({ x: (i / maxIdx) * 200 + 6, y: 66 - (Math.min(100, Math.max(0, m.value)) / 100) * 56 });
      } else if (m.key === 'jainIndex') {
        jainPoints.push({ x: (i / maxIdx) * 200 + 6, y: 66 - Math.min(1, Math.max(0, m.value)) * 56 });
      }
    }
  }

  const toPolyline = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        {/* Compact KPI Pills */}
        <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3">
          {displayedMetrics.length === 0 ? (
            <div className="col-span-full rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
              Chưa có chỉ số định lượng.
            </div>
          ) : (
            displayedMetrics.slice(0, 3).map((m) => (
              <div key={m.key} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                <div className="truncate text-[10px] font-medium text-slate-500">{m.label}</div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="font-mono text-sm font-bold text-slate-900">
                    {m.value}
                    {m.unit ? <span className="ml-0.5 text-[10px] font-normal text-slate-500">{m.unit}</span> : null}
                  </span>
                  {m.delta !== undefined && m.delta !== 0 && (
                    <span
                      className={`font-mono text-[10px] font-semibold ${
                        m.delta > 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Compact Sparkline Chart */}
        <div className="w-full shrink-0 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-1.5 sm:w-52">
          <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-500">
            <span className="font-semibold">Tiến hóa</span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" /> Phủ
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Jain
              </span>
            </div>
          </div>
          <svg viewBox="0 0 212 72" className="h-14 w-full overflow-visible">
            <line x1="6" y1="10" x2="206" y2="10" stroke="#e2e8f0" strokeDasharray="3 3" />
            <line x1="6" y1="38" x2="206" y2="38" stroke="#e2e8f0" strokeDasharray="3 3" />
            <line x1="6" y1="66" x2="206" y2="66" stroke="#cbd5e1" />
            {covPoints.length > 1 && (
              <polyline
                fill="none"
                stroke="#4f46e5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(covPoints)}
              />
            )}
            {jainPoints.length > 1 && (
              <polyline
                fill="none"
                stroke="#059669"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(jainPoints)}
              />
            )}
            {covPoints.length > 0 && (
              <circle
                cx={covPoints[covPoints.length - 1]!.x}
                cy={covPoints[covPoints.length - 1]!.y}
                r="3"
                fill="#4f46e5"
              />
            )}
            {jainPoints.length > 0 && (
              <circle
                cx={jainPoints[jainPoints.length - 1]!.x}
                cy={jainPoints[jainPoints.length - 1]!.y}
                r="3"
                fill="#059669"
              />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
