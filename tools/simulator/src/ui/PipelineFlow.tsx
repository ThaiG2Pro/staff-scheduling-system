import { CheckCircle2, Circle, ShieldAlert, XCircle } from 'lucide-react';
import type { TraceEvent, TraceStageRange } from '../../../../src/domain/schedulerTrace';

interface PipelineFlowProps {
  readonly stages: readonly TraceStageRange[];
  readonly events: readonly TraceEvent[];
  readonly currentIndex: number;
  readonly onJumpToStep: (seq: number) => void;
}

export function PipelineFlow({ stages, events, currentIndex, onJumpToStep }: PipelineFlowProps) {
  const milestoneEvents = events.filter(
    (e) =>
      e.kind === 'storage_io' ||
      e.kind === 'input_gate' ||
      e.kind === 'transform' ||
      e.kind === 'state_init' ||
      e.kind === 'validation' ||
      e.kind === 'output',
  );

  return (
    <div className="space-y-4">
      {/* Visual Stage Pipeline */}
      <div>
        <div className="mb-2 text-xs font-semibold text-slate-700">
          Tiến trình đi qua các chặng của hệ thống (bấm để nhảy nhanh)
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stages.map((st, i) => {
            const isActive = currentIndex >= st.startSeq && currentIndex <= st.endSeq;
            const isPassed = currentIndex > st.endSeq;
            const stageEvents = events.slice(st.startSeq, st.endSeq + 1);
            const hasError = stageEvents.some((e) => e.status === 'error');
            const hasBlocked = stageEvents.some((e) => e.status === 'blocked');

            const cardClass = isActive
              ? 'border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-100'
              : hasError
                ? 'border-rose-200 bg-rose-50/50'
                : hasBlocked
                  ? 'border-orange-200 bg-orange-50/50'
                  : isPassed
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200 bg-slate-50/60';

            return (
              <button
                key={`${st.id}-${i}`}
                type="button"
                onClick={() => onJumpToStep(st.startSeq)}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition hover:shadow-xs ${cardClass}`}
              >
                <div className="mt-0.5 shrink-0">
                  {hasError ? (
                    <XCircle className="h-4 w-4 text-rose-600" />
                  ) : hasBlocked ? (
                    <ShieldAlert className="h-4 w-4 text-orange-600" />
                  ) : isPassed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : isActive ? (
                    <span className="flex h-4 w-4 items-center justify-center">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />
                    </span>
                  ) : (
                    <Circle className="h-4 w-4 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900">
                    {i + 1}. {st.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                    Bước {st.startSeq + 1}
                    {st.endSeq > st.startSeq ? `–${st.endSeq + 1}` : ''} ({st.endSeq - st.startSeq + 1} bước)
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Storage, Gate & Validation Audit Log */}
      <div>
        <div className="mb-2 text-xs font-semibold text-slate-700">
          Nhật ký Lưu trữ (Storage I/O), Cổng kiểm duyệt & Kiểm định an toàn
        </div>
        <div className="space-y-1.5">
          {milestoneEvents.map((ev) => {
            const isCurrent = ev.seq === currentIndex;
            return (
              <button
                key={ev.seq}
                type="button"
                onClick={() => onJumpToStep(ev.seq)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-400">
                    #{ev.seq + 1}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                    {ev.kind}
                  </span>
                  <span className="truncate font-medium">{ev.title}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    ev.status === 'ok'
                      ? 'bg-emerald-100 text-emerald-800'
                      : ev.status === 'blocked'
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {ev.status}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
