import { useState } from 'react';
import { MousePointerClick, Users } from 'lucide-react';
import type {
  TraceAssignmentSnapshot,
  TraceGridSnapshot,
} from '../../../../src/domain/schedulerTrace';

interface HeatmapGridProps {
  readonly grid: TraceGridSnapshot | null;
  readonly assignments: readonly TraceAssignmentSnapshot[];
  readonly targetN: number;
  readonly lens: 'manager' | 'debug';
}

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const DAY_FULL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

function cellColorClass(req: number, cur: number): string {
  if (req === 0 && cur === 0) return 'bg-slate-50 text-slate-300 hover:bg-slate-100';
  if (req > 0 && cur === 0) return 'bg-rose-100 text-rose-900 font-bold hover:bg-rose-200';
  if (cur < req) return 'bg-amber-100 text-amber-900 font-semibold hover:bg-amber-200';
  if (cur === req) return 'bg-emerald-100 text-emerald-900 font-semibold hover:bg-emerald-200';
  return 'bg-sky-100 text-sky-900 font-semibold hover:bg-sky-200';
}

export function HeatmapGrid({ grid, assignments, targetN, lens }: HeatmapGridProps) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const highlightSet = new Set(grid?.highlightCells ?? []);

  // Default to the first highlighted cell if user hasn't clicked a cell yet
  const activeCellIdx = selectedCell ?? (grid?.highlightCells?.[0] ?? null);

  const selectedDetail = (() => {
    if (!grid || activeCellIdx === null) return null;
    const d = Math.floor(activeCellIdx / 16);
    const h = (activeCellIdx % 16) + 7;
    const req = grid.required[activeCellIdx] ?? 0;
    const cur = grid.staffed[activeCellIdx] ?? 0;
    const txns = grid.transactions?.[activeCellIdx];
    const workingStaff = assignments.filter(
      (a) => a.day === d && a.startHour <= h && h < a.endHour,
    );
    return { d, h, req, cur, txns, workingStaff, idx: activeCellIdx };
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <MousePointerClick className="h-3.5 w-3.5 text-indigo-500" />
          Bấm vào bất kỳ ô nào trên lưới để soi giao dịch, công thức tính & nhân viên đang trực
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-rose-200" /> Trống (Gap)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-amber-200" /> Thiếu
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-emerald-200" /> Đủ
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-sky-200" /> Dư
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded ring-2 ring-indigo-600" /> Vừa đổi
          </span>
        </div>
      </div>

      {!grid ? (
        <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
          Chưa tới bước quy đổi lưới nhu cầu 7×16 (hãy bấm Bước tiếp)
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center text-[11px]">
              <thead>
                <tr>
                  <th className="w-10 px-1 py-1 text-left font-semibold text-slate-500">Ngày</th>
                  {HOURS.map((h) => (
                    <th key={h} className="min-w-[34px] py-1 font-mono font-semibold text-slate-500">
                      {h}h
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((dayLabel, d) => (
                  <tr key={dayLabel}>
                    <td className="px-1 font-semibold text-slate-700">{dayLabel}</td>
                    {HOURS.map((h, hIdx) => {
                      const idx = d * 16 + hIdx;
                      const req = grid.required[idx] ?? 0;
                      const cur = grid.staffed[idx] ?? 0;
                      const isHighlighted = highlightSet.has(idx);
                      const isSelected = activeCellIdx === idx;
                      return (
                        <td key={h} className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelectedCell(idx)}
                            title={`${DAY_FULL[d]} ${h}:00 — Hiện có ${cur} / Cần ${req}`}
                            className={`w-full rounded py-1.5 font-mono transition-all ${cellColorClass(req, cur)} ${
                              isSelected
                                ? 'ring-2 ring-slate-900 shadow-sm'
                                : isHighlighted
                                  ? 'ring-2 ring-indigo-500'
                                  : ''
                            }`}
                          >
                            {cur}/{req}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inline Cell Inspector Strip */}
          {selectedDetail && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-900 px-2 py-0.5 font-semibold text-white">
                    {DAY_FULL[selectedDetail.d]} · {selectedDetail.h}:00–{selectedDetail.h + 1}:00
                  </span>
                  {selectedDetail.txns !== undefined && (
                    <span className="text-slate-700">
                      {lens === 'debug' ? (
                        <span className="font-mono">
                          idx={selectedDetail.idx} · txns={selectedDetail.txns} · ceilBigInt({selectedDetail.txns}/{targetN}) ={' '}
                          <strong>{selectedDetail.req}</strong>
                        </span>
                      ) : (
                        <>
                          <strong>{selectedDetail.txns}</strong> giao dịch ÷ năng suất <strong>{targetN}</strong> → cần{' '}
                          <strong>{selectedDetail.req} người</strong>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${
                    selectedDetail.req > 0 && selectedDetail.cur === 0
                      ? 'bg-rose-100 text-rose-800'
                      : selectedDetail.cur < selectedDetail.req
                        ? 'bg-amber-100 text-amber-800'
                        : selectedDetail.cur === selectedDetail.req
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-sky-100 text-sky-800'
                  }`}
                >
                  Đang trực: {selectedDetail.cur} / {selectedDetail.req}
                  {selectedDetail.cur < selectedDetail.req
                    ? ` (Thiếu ${selectedDetail.req - selectedDetail.cur})`
                    : selectedDetail.cur > selectedDetail.req
                      ? ` (Dư ${selectedDetail.cur - selectedDetail.req})`
                      : ' (Đủ)'}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-slate-600">
                <Users className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium">Đang trực khung giờ này:</span>
                {selectedDetail.workingStaff.length === 0 ? (
                  <span className="italic text-slate-400">Chưa có nhân viên nào</span>
                ) : (
                  selectedDetail.workingStaff.map((w, i) => (
                    <span
                      key={`${w.staffId}-${i}`}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
                        w.isChanged
                          ? 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-300'
                          : w.isPinned
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-white text-slate-700 ring-1 ring-slate-200'
                      }`}
                    >
                      {w.isPinned ? '📌 ' : w.changeKind === 'swapped' || w.changeKind === 'reassigned' ? '🔄 ' : w.isChanged ? '✨ ' : ''}
                      {w.staffName} ({w.shiftLabel})
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
