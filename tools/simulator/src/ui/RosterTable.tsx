import type {
  TraceAssignmentSnapshot,
  TraceEntitySnapshot,
} from '../../../../src/domain/schedulerTrace';

interface RosterTableProps {
  readonly entities: readonly TraceEntitySnapshot[] | null;
  readonly assignments: readonly TraceAssignmentSnapshot[];
  readonly removedAssignments?: readonly TraceAssignmentSnapshot[];
}

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

export function RosterTable({
  entities,
  assignments,
  removedAssignments = [],
}: RosterTableProps) {
  if (!entities || entities.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
        Chưa tới bước nạp danh sách nhân viên (hãy bấm Bước tiếp)
      </div>
    );
  }

  // Group active assignments by staffId:day
  const byStaffDay = new Map<string, TraceAssignmentSnapshot[]>();
  for (const a of assignments) {
    const key = `${a.staffId}:${a.day}`;
    const list = byStaffDay.get(key) ?? [];
    list.push(a);
    byStaffDay.set(key, list);
  }

  // Group just-removed assignments (from REASSIGN) by staffId:day
  const removedByStaffDay = new Map<string, TraceAssignmentSnapshot[]>();
  for (const r of removedAssignments) {
    const key = `${r.staffId}:${r.day}`;
    const list = removedByStaffDay.get(key) ?? [];
    list.push(r);
    removedByStaffDay.set(key, list);
  }

  const hasAnyUnavailable = entities.some(
    (s) => s.unavailableDays !== undefined && s.unavailableDays.length > 0,
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <span>Bảng phân ca trực tiếp — tự động điền dần theo từng bước chạy</span>
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
          {hasAnyUnavailable && (
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-500">
              ⛔ Nghỉ (OFF)
            </span>
          )}
        </div>
      </div>

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
              const unavailSet = staff.unavailableDays ? new Set<number>(staff.unavailableDays) : null;
              return (
                <tr key={staff.id} className={staff.isChanged ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}>
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
                                item.changeKind === 'swapped' || item.changeKind === 'reassigned';
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
    </div>
  );
}
