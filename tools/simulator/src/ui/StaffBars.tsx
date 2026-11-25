import type { TraceEntitySnapshot } from '../../../../src/domain/schedulerTrace';

interface StaffBarsProps {
  readonly entities: readonly TraceEntitySnapshot[] | null;
}

export function StaffBars({ entities }: StaffBarsProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
      <div className="mb-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          Phân bổ giờ nhân viên {entities ? `(${entities.length})` : ''}
        </h3>
        <p className="text-[11px] text-slate-500">Giờ đã gán / Giờ tối đa tuần</p>
      </div>

      {!entities || entities.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
          Chưa tới bước nạp quỹ giờ nhân viên
        </div>
      ) : (
        <div className="space-y-1.5">
          {entities.map((e) => {
            const pct = Math.min(100, Math.round(e.utilization * 100));
            const isOver = e.assignedHours > e.maxHours;
            return (
              <div
                key={e.id}
                className={`rounded-lg px-2 py-1.5 transition ${
                  e.isChanged ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-1 text-[11px]">
                  <span className="truncate font-semibold text-slate-800" title={e.name}>
                    {e.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    <strong>{e.assignedHours}</strong>/{e.maxHours}h
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isOver
                        ? 'bg-rose-500'
                        : e.isChanged
                          ? 'bg-indigo-600'
                          : pct >= 85
                            ? 'bg-emerald-500'
                            : 'bg-sky-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {e.extra && Object.keys(e.extra).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    {Object.entries(e.extra).map(([k, v]) => (
                      <span key={k} className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
