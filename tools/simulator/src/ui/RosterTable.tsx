import { useMemo, useState } from 'react';
import type { DayOfWeek } from '../../../../src/domain/types';
import type {
  TraceAssignmentSnapshot,
  TraceEntitySnapshot,
  TraceShiftSnapshot,
} from '../../../../src/domain/schedulerTrace';

interface RosterTableProps {
  readonly entities: readonly TraceEntitySnapshot[] | null;
  readonly shifts?: readonly TraceShiftSnapshot[] | null;
  readonly assignments: readonly TraceAssignmentSnapshot[];
  readonly removedAssignments?: readonly TraceAssignmentSnapshot[];
}

type RosterViewMode = 'shift' | 'staff';

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'] as const;

function matchesShiftRow(
  assignment: TraceAssignmentSnapshot,
  shift: TraceShiftSnapshot,
): boolean {
  if (assignment.shiftId && shift.id) {
    return assignment.shiftId === shift.id;
  }
  return (
    assignment.startHour === shift.startHour &&
    assignment.endHour === shift.endHour &&
    assignment.shiftLabel === shift.label
  );
}

function deriveFallbackShifts(
  assignments: readonly TraceAssignmentSnapshot[],
  removedAssignments: readonly TraceAssignmentSnapshot[],
): readonly TraceShiftSnapshot[] {
  const seen = new Map<string, TraceShiftSnapshot>();
  for (const item of [...assignments, ...removedAssignments]) {
    const key = item.shiftId || `${item.startHour}-${item.endHour}-${item.shiftLabel}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: item.shiftId ?? '',
        label: item.shiftLabel,
        startHour: item.startHour,
        endHour: item.endHour,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.startHour !== b.startHour) return a.startHour - b.startHour;
    if (a.endHour !== b.endHour) return a.endHour - b.endHour;
    return a.label.localeCompare(b.label);
  });
}

function formatActiveDaysTooltip(daysOfWeek: readonly DayOfWeek[]): string {
  const labels = [...daysOfWeek]
    .sort((a, b) => a - b)
    .map((d) => DAYS[d] ?? `Ngày ${d}`);
  return `Áp dụng ${daysOfWeek.length}/7 ngày: ${labels.join(', ')}`;
}

export function RosterTable({
  entities,
  shifts,
  assignments,
  removedAssignments = [],
}: RosterTableProps) {
  const [mode, setMode] = useState<RosterViewMode>('shift');

  // Resolved shift rows for Shift × Day mode (native trace shifts or backward-compatible fallback)
  const resolvedShifts = useMemo(() => {
    if (shifts && shifts.length > 0) return shifts;
    return deriveFallbackShifts(assignments, removedAssignments);
  }, [shifts, assignments, removedAssignments]);

  // Group active assignments by staffId:day (for Staff × Day mode)
  const byStaffDay = useMemo(() => {
    const map = new Map<string, TraceAssignmentSnapshot[]>();
    for (const a of assignments) {
      const key = `${a.staffId}:${a.day}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [assignments]);

  // Group just-removed assignments (from REASSIGN) by staffId:day (for Staff × Day mode)
  const removedByStaffDay = useMemo(() => {
    const map = new Map<string, TraceAssignmentSnapshot[]>();
    for (const r of removedAssignments) {
      const key = `${r.staffId}:${r.day}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [removedAssignments]);

  // Pre-group active & removed assignments by shiftRowIndex:day (for Shift × Day mode)
  const { byShiftDay, removedByShiftDay, shiftRowTotals } = useMemo(() => {
    const activeMap = new Map<string, TraceAssignmentSnapshot[]>();
    const removedMap = new Map<string, TraceAssignmentSnapshot[]>();
    const totals = new Array<number>(resolvedShifts.length).fill(0);

    for (const a of assignments) {
      const rowIdx = resolvedShifts.findIndex((sh) => matchesShiftRow(a, sh));
      if (rowIdx === -1) continue;
      const key = `${rowIdx}:${a.day}`;
      const list = activeMap.get(key) ?? [];
      list.push(a);
      activeMap.set(key, list);
      totals[rowIdx] = (totals[rowIdx] ?? 0) + 1;
    }

    for (const r of removedAssignments) {
      const rowIdx = resolvedShifts.findIndex((sh) => matchesShiftRow(r, sh));
      if (rowIdx === -1) continue;
      const key = `${rowIdx}:${r.day}`;
      const list = removedMap.get(key) ?? [];
      list.push(r);
      removedMap.set(key, list);
    }

    return { byShiftDay: activeMap, removedByShiftDay: removedMap, shiftRowTotals: totals };
  }, [resolvedShifts, assignments, removedAssignments]);

  const hasAnyUnavailable = Boolean(
    entities?.some((s) => s.unavailableDays !== undefined && s.unavailableDays.length > 0),
  );
  const hasAnyInactiveShiftDay = resolvedShifts.some(
    (sh) => sh.daysOfWeek !== undefined && sh.daysOfWeek.length < 7,
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setMode('shift')}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                mode === 'shift'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Theo Ca (Ca × Ngày)
            </button>
            <button
              type="button"
              onClick={() => setMode('staff')}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                mode === 'staff'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Theo NV (NV × Ngày)
            </button>
          </div>
          <span className="hidden sm:inline text-slate-500">
            Tự động điền dần theo từng bước chạy
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-medium">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">📌 Ghim</span>
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-900 ring-1 ring-indigo-400">
            ✨ Vừa gán
          </span>
          <span className="rounded border border-dashed border-rose-400 bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through">
            ↗ Vừa chuyển đi
          </span>
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-900 ring-1 ring-violet-400">
            🔄 Vừa nhận/đổi
          </span>
          {mode === 'shift' && hasAnyInactiveShiftDay && (
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-500">
              ⛔ Nghỉ ca
            </span>
          )}
          {mode === 'staff' && hasAnyUnavailable && (
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-500">
              ⛔ Nghỉ (OFF)
            </span>
          )}
        </div>
      </div>

      {mode === 'shift' ? (
        resolvedShifts.length === 0 ? (
          <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
            Chưa có dữ liệu mẫu ca (hãy bấm Bước tiếp)
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="px-2.5 py-2">Mẫu ca</th>
                  {DAYS.map((d) => (
                    <th key={d} className="px-2 py-2 text-center">
                      {d}
                    </th>
                  ))}
                  <th className="px-2.5 py-2 text-right">Tổng ca</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resolvedShifts.map((shift, rowIdx) => {
                  const duration = shift.endHour - shift.startHour;
                  const rowKey = shift.id || `${shift.startHour}-${shift.endHour}-${shift.label}`;
                  const hasChangedInRow = DAYS.some((_, d) => {
                    const key = `${rowIdx}:${d}`;
                    const act = byShiftDay.get(key);
                    const rem = removedByShiftDay.get(key);
                    return (
                      Boolean(rem && rem.length > 0) ||
                      Boolean(act?.some((item) => item.isChanged))
                    );
                  });

                  return (
                    <tr
                      key={rowKey}
                      className={hasChangedInRow ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}
                    >
                      <td className="whitespace-nowrap px-2.5 py-2 font-semibold text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono">{shift.label}</span>
                          <span className="text-[10px] font-normal text-slate-400">
                            ({duration}h)
                          </span>
                          {shift.daysOfWeek && shift.daysOfWeek.length < 7 && (
                            <span
                              title={formatActiveDaysTooltip(shift.daysOfWeek)}
                              className="rounded bg-amber-50 px-1 py-0.5 font-mono text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200"
                            >
                              {shift.daysOfWeek.length}/7d
                            </span>
                          )}
                        </div>
                      </td>
                      {DAYS.map((dayLabel, d) => {
                        const day = d as DayOfWeek;
                        const key = `${rowIdx}:${d}`;
                        const cellItems = byShiftDay.get(key) ?? [];
                        const removedItems = removedByShiftDay.get(key) ?? [];
                        const isEmpty = cellItems.length === 0 && removedItems.length === 0;
                        const isInactiveDay =
                          shift.daysOfWeek !== undefined && !shift.daysOfWeek.includes(day);

                        return (
                          <td
                            key={d}
                            className={`px-1.5 py-1.5 text-center ${
                              isInactiveDay ? 'bg-slate-100/80' : ''
                            }`}
                            title={
                              isInactiveDay
                                ? `Ca ${shift.label} không áp dụng vào ${dayLabel}`
                                : undefined
                            }
                          >
                            {isEmpty ? (
                              isInactiveDay ? (
                                <span className="inline-block rounded border border-slate-200 bg-white/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-400">
                                  Nghỉ ca
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                {removedItems.map((rem, idx) => (
                                  <span
                                    key={`rem-${idx}`}
                                    title={`Vừa chuyển ${rem.shiftLabel} rời khỏi ${rem.staffName}`}
                                    className="whitespace-nowrap rounded border border-dashed border-rose-400 bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 line-through"
                                  >
                                    ↗ {rem.staffName}
                                  </span>
                                ))}
                                {cellItems.map((item, idx) => {
                                  const isSwapOrReassign =
                                    item.changeKind === 'swapped' ||
                                    item.changeKind === 'reassigned';
                                  const pillClass = item.isPinned
                                    ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                                    : isSwapOrReassign
                                      ? 'bg-violet-100 text-violet-900 font-bold ring-2 ring-violet-500'
                                      : item.isChanged
                                        ? 'bg-indigo-100 text-indigo-900 font-bold ring-2 ring-indigo-500'
                                        : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200';
                                  return (
                                    <span
                                      key={`act-${idx}`}
                                      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${pillClass}`}
                                    >
                                      {item.isPinned
                                        ? '📌 '
                                        : isSwapOrReassign
                                          ? '🔄 '
                                          : item.isChanged
                                            ? '✨ '
                                            : ''}
                                      {item.staffName}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono text-xs text-slate-700">
                        <span className="font-semibold">{shiftRowTotals[rowIdx] ?? 0}</span> ca
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : !entities || entities.length === 0 ? (
        <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
          Chưa tới bước nạp danh sách nhân viên (hãy bấm Bước tiếp)
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="px-2.5 py-2">Nhân viên</th>
                {DAYS.map((d) => (
                  <th key={d} className="px-2 py-2 text-center">
                    {d}
                  </th>
                ))}
                <th className="px-2.5 py-2 text-right">Tổng giờ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entities.map((staff) => {
                const pct = Math.round(staff.utilization * 100);
                const unavailSet = staff.unavailableDays
                  ? new Set<number>(staff.unavailableDays)
                  : null;
                return (
                  <tr
                    key={staff.id}
                    className={staff.isChanged ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}
                  >
                    <td className="whitespace-nowrap px-2.5 py-2 font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span>{staff.name}</span>
                        {staff.availableDaysCount !== undefined && staff.availableDaysCount < 7 && (
                          <span
                            title={`Khả dụng ${staff.availableDaysCount}/7 ngày (MRV priority)`}
                            className="rounded bg-amber-50 px-1 py-0.5 font-mono text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200"
                          >
                            {staff.availableDaysCount}/7d
                          </span>
                        )}
                      </div>
                    </td>
                    {DAYS.map((dayLabel, d) => {
                      const key = `${staff.id}:${d}`;
                      const cellItems = byStaffDay.get(key) ?? [];
                      const removedItems = removedByStaffDay.get(key) ?? [];
                      const isEmpty = cellItems.length === 0 && removedItems.length === 0;
                      const isOff = unavailSet?.has(d) ?? false;
                      return (
                        <td
                          key={d}
                          className={`px-1.5 py-1.5 text-center ${
                            isOff ? 'bg-slate-100/80' : ''
                          }`}
                          title={isOff ? `${staff.name} đánh dấu nghỉ ${dayLabel}` : undefined}
                        >
                          {isEmpty ? (
                            isOff ? (
                              <span className="inline-block rounded border border-slate-200 bg-white/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-400">
                                OFF
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              {removedItems.map((rem, idx) => (
                                <span
                                  key={`rem-${idx}`}
                                  title={`Vừa chuyển ${rem.shiftLabel} rời khỏi ${staff.name}`}
                                  className="whitespace-nowrap rounded border border-dashed border-rose-400 bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700 line-through"
                                >
                                  ↗ {rem.shiftLabel}
                                </span>
                              ))}
                              {cellItems.map((item, idx) => {
                                const isSwapOrReassign =
                                  item.changeKind === 'swapped' ||
                                  item.changeKind === 'reassigned';
                                const pillClass = item.isPinned
                                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                                  : isSwapOrReassign
                                    ? 'bg-violet-100 text-violet-900 font-bold ring-2 ring-violet-500'
                                    : item.isChanged
                                      ? 'bg-indigo-100 text-indigo-900 font-bold ring-2 ring-indigo-500'
                                      : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200';
                                return (
                                  <span
                                    key={`act-${idx}`}
                                    className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] ${pillClass}`}
                                  >
                                    {item.isPinned
                                      ? '📌 '
                                      : isSwapOrReassign
                                        ? '🔄 '
                                        : item.isChanged
                                          ? '✨ '
                                          : ''}
                                    {item.shiftLabel}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2.5 py-2 text-right font-mono text-xs text-slate-700">
                      <span className="font-semibold">{staff.assignedHours}</span>/{staff.maxHours}h{' '}
                      <span className="text-[10px] text-slate-400">({pct}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
