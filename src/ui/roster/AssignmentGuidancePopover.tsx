/**
 * @file Assignment Guidance Popover (`AC-04`, `E-05`, `E-06`, `E-07`) displaying pre-grouped
 * `Eligible` and `Requires attention` candidates from `evaluateStaffGuidance`, with auto-focused
 * Quick Search, Enter-to-assign, inline soft-override confirmation, and Pin reset notice.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Search, X } from 'lucide-react';
import { DAY_LABELS } from '../../domain/constants';
import { evaluateStaffGuidance } from '../../domain/constraints';
import type { Assignment, DayOfWeek, ShiftTemplate, Staff } from '../../domain/types';
import { formatShiftRange } from '../common/formatters';

export interface AssignmentGuidancePopoverProps {
  day: DayOfWeek;
  shift: ShiftTemplate;
  staffList: readonly Staff[];
  shifts: readonly ShiftTemplate[];
  assignments: readonly Assignment[];
  unusedCapacityHours: number;
  reassigningAssignment?: Assignment | null;
  onSelectStaff: (staffId: string) => void;
  onClose: () => void;
}

/**
 * Interactive popover for 2-click Assign or Reassign with proactive soft-warning guardrails.
 * Allows soft overrides via 1-tap inline confirmation without hard-blocking the Store Manager.
 *
 * @param props - Target slot, schedule entities, optional reassign target, and selection callback.
 * @returns Guidance popover dialog.
 */
export function AssignmentGuidancePopover({
  day,
  shift,
  staffList,
  shifts,
  assignments,
  unusedCapacityHours,
  reassigningAssignment = null,
  onSelectStaff,
  onClose,
}: AssignmentGuidancePopoverProps) {
  const [query, setQuery] = useState('');
  const [pendingOverrideId, setPendingOverrideId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const guidance = useMemo(
    () =>
      evaluateStaffGuidance(
        day,
        shift,
        staffList,
        shifts,
        assignments,
        reassigningAssignment?.id,
      ),
    [day, shift, staffList, shifts, assignments, reassigningAssignment?.id],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredEligible = useMemo(
    () =>
      guidance.eligible.filter(
        (opt) => !normalizedQuery || opt.staff.name.toLowerCase().includes(normalizedQuery),
      ),
    [guidance.eligible, normalizedQuery],
  );

  const filteredAttention = useMemo(
    () =>
      guidance.requiresAttention.filter(
        (opt) => !normalizedQuery || opt.staff.name.toLowerCase().includes(normalizedQuery),
      ),
    [guidance.requiresAttention, normalizedQuery],
  );

  const isReassign = reassigningAssignment !== null;
  const currentStaffName = isReassign
    ? staffList.find((s) => s.id === reassigningAssignment.staffId)?.name ?? 'Staff'
    : null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={isReassign ? `Reassign ${currentStaffName}` : `Assign staff to ${DAY_LABELS[day]} ${formatShiftRange(shift.startHour, shift.endHour)}`}
      className="absolute left-0 top-full z-40 mt-1.5 w-80 rounded-xl border border-slate-300 bg-white shadow-xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5">
        <div>
          <p className="text-xs font-semibold text-slate-900">
            {isReassign ? `Replace ${currentStaffName}` : 'Assign Staff'}
          </p>
          <p className="text-[11px] text-slate-600">
            {DAY_LABELS[day]} · {formatShiftRange(shift.startHour, shift.endHour)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assignment popover"
          className="rounded-md p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Pin reset notice in Reassign mode (E-05) */}
      {isReassign && reassigningAssignment.isPinned && (
        <div className="flex items-center gap-1.5 border-b border-indigo-200 bg-indigo-50 px-3.5 py-2 text-[11px] font-medium text-indigo-900">
          <Info className="h-3.5 w-3.5 shrink-0 text-indigo-700" aria-hidden="true" />
          <span>Replacing a pinned shift starts as Unpinned</span>
        </div>
      )}

      {/* Quick Search */}
      <div className="border-b border-slate-200 bg-slate-50/70 px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="text"
            autoFocus
            aria-label="Search staff to assign"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPendingOverrideId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filteredEligible.length > 0) {
                e.preventDefault();
                onSelectStaff(filteredEligible[0]!.staff.id);
              }
            }}
            placeholder="Type name + Enter…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </div>

      {/* Grouped Candidates */}
      <div className="max-h-72 overflow-y-auto p-2 space-y-3">
        {/* Eligible group */}
        <div>
          <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Eligible ({filteredEligible.length})
          </p>

          {filteredEligible.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
              {guidance.eligible.length === 0 && unusedCapacityHours === 0 && staffList.length > 0
                ? 'Team is at 100% weekly capacity — assigning anyone below will trigger an overtime warning, or consider adjusting shift hours / adding staff.'
                : 'No eligible staff match.'}
            </div>
          ) : (
            <ul className="space-y-1">
              {filteredEligible.map((opt) => (
                <li key={opt.staff.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStaff(opt.staff.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium text-slate-900">
                      <CheckCircle2
                        className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                        aria-hidden="true"
                      />
                      <span className="truncate">{opt.staff.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-600">
                      {opt.currentAssignedHours}/{opt.staff.maxWeeklyHours}h ·{' '}
                      <strong>{opt.remainingHoursAfter}h left</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Requires attention group */}
        {filteredAttention.length > 0 && (
          <div>
            <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
              Requires attention ({filteredAttention.length})
            </p>
            <ul className="space-y-1">
              {filteredAttention.map((opt) => {
                const isConfirming = pendingOverrideId === opt.staff.id;
                return (
                  <li
                    key={opt.staff.id}
                    className="rounded-lg border border-amber-200/80 bg-amber-50/50"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setPendingOverrideId(isConfirming ? null : opt.staff.id)
                      }
                      className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left text-xs hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 rounded-lg"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate font-medium text-slate-900">
                          <AlertTriangle
                            className="h-3.5 w-3.5 shrink-0 text-amber-700"
                            aria-hidden="true"
                          />
                          <span className="truncate">{opt.staff.name}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-700">
                          {opt.currentAssignedHours}/{opt.staff.maxWeeklyHours}h
                        </span>
                      </div>
                      <ul className="pl-5 text-[11px] text-amber-900">
                        {opt.reasons.map((r, idx) => (
                          <li key={idx}>{r.message}</li>
                        ))}
                      </ul>
                    </button>

                    {isConfirming && (
                      <div className="flex items-center justify-between gap-2 border-t border-amber-200 bg-amber-100/70 px-2.5 py-1.5 rounded-b-lg">
                        <span className="text-[11px] font-medium text-amber-950">
                          Assign with warning?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPendingOverrideId(null)}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectStaff(opt.staff.id)}
                            className="rounded bg-amber-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-800"
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
