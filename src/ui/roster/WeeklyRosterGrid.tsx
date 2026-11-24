/**
 * @file Shift-first Weekly Roster Grid (`AC-04`) with 7 fixed `Mon–Sun` columns, severity-tiered
 * day & slot shortage indicators, inline `AssignmentChip` list, `AssignmentGuidancePopover`,
 * and click-to-focus highlight when jumping from `Hourly Summary`.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DAYS_OF_WEEK, DAY_LABELS, OPERATING_HOURS } from '../../domain/constants';
import type {
  AggregatedSummary,
  Assignment,
  AssignmentWarningFlags,
  DayOfWeek,
  OperatingHour,
  ShiftTemplate,
  Staff,
} from '../../domain/types';
import { formatHour24, formatShiftRange } from '../common/formatters';
import { AssignmentChip } from './AssignmentChip';
import { AssignmentGuidancePopover } from './AssignmentGuidancePopover';

export interface FocusedRosterSlot {
  day: DayOfWeek;
  hour: OperatingHour;
}

export interface WeeklyRosterGridProps {
  shifts: readonly ShiftTemplate[];
  staff: readonly Staff[];
  assignments: readonly Assignment[];
  summary: AggregatedSummary;
  assignmentWarnings: Record<string, AssignmentWarningFlags>;
  unusedCapacityHours: number;
  highlightedStaffId: string | null;
  highlightedOverLimitOnly: boolean;
  conflictAssignmentIds: ReadonlySet<string>;
  newAutoAssignmentIds: ReadonlySet<string>;
  focusedSlot: FocusedRosterSlot | null;
  onClearFocus: () => void;
  onAssign: (day: DayOfWeek, shiftId: string, staffId: string) => void;
  onReassign: (assignmentId: string, newStaffId: string) => void;
  onTogglePin: (assignmentId: string) => void;
  onRemove: (assignmentId: string) => void;
  onOpenManageShifts: () => void;
}

interface DayHeaderStatus {
  gapCount: number;
  shortageHours: number;
  maxPeakNeed: number;
  hasDemand: boolean;
}

interface SlotNeedStatus {
  hasGap: boolean;
  maxNeed: number;
  shortageHoursList: string[];
}

type ActivePopover =
  | { mode: 'assign'; day: DayOfWeek; shiftId: string }
  | { mode: 'reassign'; day: DayOfWeek; shiftId: string; assignment: Assignment };

function computeDayStatus(day: DayOfWeek, summary: AggregatedSummary): DayHeaderStatus {
  let gapCount = 0;
  let shortageHours = 0;
  let maxPeakNeed = 0;
  let hasDemand = false;

  for (const hour of OPERATING_HOURS) {
    const cell = summary.cells[day][hour];
    if (cell.transactions !== null) hasDemand = true;
    if (cell.isStaffingGap) gapCount++;
    if (cell.coverageDelta !== null && cell.coverageDelta < 0) {
      const need = -cell.coverageDelta;
      shortageHours += need;
      if (need > maxPeakNeed) maxPeakNeed = need;
    }
  }

  return { gapCount, shortageHours, maxPeakNeed, hasDemand };
}

function computeSlotNeed(
  day: DayOfWeek,
  shift: ShiftTemplate,
  summary: AggregatedSummary,
): SlotNeedStatus {
  let hasGap = false;
  let maxNeed = 0;
  const shortageHoursList: string[] = [];

  for (const hour of OPERATING_HOURS) {
    if (hour < shift.startHour || hour >= shift.endHour) continue;
    const cell = summary.cells[day][hour];
    if (cell.isStaffingGap) hasGap = true;
    if (cell.coverageDelta !== null && cell.coverageDelta < 0) {
      const need = -cell.coverageDelta;
      if (need > maxNeed) maxNeed = need;
      shortageHoursList.push(`${formatHour24(hour)} (need +${need})`);
    }
  }

  return { hasGap, maxNeed, shortageHoursList };
}

/**
 * Interactive 7-day Shift-first Weekly Roster Grid with 2-click Assign/Reassign popover.
 *
 * @param props - Shifts, staff, assignments, summary metrics, highlight states, and edit callbacks.
 * @returns Roster grid table.
 */
export function WeeklyRosterGrid({
  shifts,
  staff,
  assignments,
  summary,
  assignmentWarnings,
  unusedCapacityHours,
  highlightedStaffId,
  highlightedOverLimitOnly,
  conflictAssignmentIds,
  newAutoAssignmentIds,
  focusedSlot,
  onClearFocus,
  onAssign,
  onReassign,
  onTogglePin,
  onRemove,
  onOpenManageShifts,
}: WeeklyRosterGridProps) {
  const [activePopover, setActivePopover] = useState<ActivePopover | null>(null);

  const staffNameMap = useMemo(
    () => new Map(staff.map((member) => [member.id, member.name])),
    [staff],
  );

  const sortedShifts = useMemo(
    () =>
      [...shifts].sort((a, b) =>
        a.startHour !== b.startHour ? a.startHour - b.startHour : a.endHour - b.endHour,
      ),
    [shifts],
  );

  const assignmentsByCell = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const key = `${a.shiftId}|${a.day}`;
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const nameA = staffNameMap.get(a.staffId) ?? '';
        const nameB = staffNameMap.get(b.staffId) ?? '';
        return nameA.localeCompare(nameB);
      });
    }
    return map;
  }, [assignments, staffNameMap]);

  const dayStatuses = useMemo(
    () => DAYS_OF_WEEK.map((day) => computeDayStatus(day, summary)),
    [summary],
  );

  if (sortedShifts.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-semibold text-slate-800">No shift templates configured</p>
        <p className="mt-1 text-xs text-slate-600">
          Add at least one shift template (e.g. 07:00–15:00) to start building your weekly roster.
        </p>
        <button
          type="button"
          onClick={onOpenManageShifts}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Manage Shifts
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {focusedSlot && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
          <span>
            Focused from Hourly Summary:{' '}
            <strong>
              {DAY_LABELS[focusedSlot.day]} {formatHour24(focusedSlot.hour)}
            </strong>{' '}
            — shifts covering this hour are highlighted below.
          </span>
          <button
            type="button"
            onClick={onClearFocus}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear focus
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              <th
                scope="col"
                className="sticky left-0 z-20 w-36 border-r border-slate-200 bg-slate-100 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Shift
              </th>
              {DAYS_OF_WEEK.map((day) => {
                const status = dayStatuses[day]!;
                const isWeekend = day >= 5;
                const isFocusedDay = focusedSlot?.day === day;

                return (
                  <th
                    key={day}
                    scope="col"
                    className={`min-w-[116px] border-r border-slate-200 px-2.5 py-2 align-top last:border-r-0 ${
                      isFocusedDay
                        ? 'bg-indigo-100/80'
                        : isWeekend
                          ? 'bg-slate-200/50'
                          : 'bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-slate-900">
                        {DAY_LABELS[day]}
                      </span>
                      {status.hasDemand && status.gapCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.2 text-[10px] font-semibold text-rose-800">
                          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                          {status.gapCount} gap{status.gapCount === 1 ? '' : 's'}
                        </span>
                      ) : status.hasDemand &&
                        (status.maxPeakNeed >= 2 || status.shortageHours >= 6) ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900">
                          Need {status.shortageHours}h
                        </span>
                      ) : status.hasDemand && status.shortageHours > 0 ? (
                        <span className="rounded-full border border-slate-300 bg-white px-1.5 py-0.2 text-[10px] font-medium text-slate-700">
                          Need {status.shortageHours}h
                        </span>
                      ) : status.hasDemand ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-800">
                          <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
                          Covered
                        </span>
                      ) : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200">
            {sortedShifts.map((shift) => {
              const duration = shift.endHour - shift.startHour;
              return (
                <tr key={shift.id} className="align-top">
                  {/* Sticky Shift Row Header */}
                  <th
                    scope="row"
                    className="group sticky left-0 z-10 w-36 border-r border-slate-200 bg-white px-3 py-3 text-left font-normal"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {formatShiftRange(shift.startHour, shift.endHour)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600">{duration}h shift</p>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={onOpenManageShifts}
                          aria-label={`Manage shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                          title="Edit or delete shift template"
                          className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:opacity-100"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={onOpenManageShifts}
                          aria-label={`Delete shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                          title="Manage shifts"
                          className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </th>

                  {/* 7 Day Cells */}
                  {DAYS_OF_WEEK.map((day) => {
                    const cellKey = `${shift.id}|${day}`;
                    const cellAssignments = assignmentsByCell.get(cellKey) ?? [];
                    const need = computeSlotNeed(day, shift, summary);
                    const isWeekend = day >= 5;
                    const isFocusedCell =
                      focusedSlot !== null &&
                      focusedSlot.day === day &&
                      focusedSlot.hour >= shift.startHour &&
                      focusedSlot.hour < shift.endHour;

                    const isPopoverInCell =
                      activePopover !== null &&
                      activePopover.day === day &&
                      activePopover.shiftId === shift.id;

                    let addButtonClasses =
                      'border-slate-300/80 bg-white text-slate-600 opacity-75 hover:opacity-100 hover:border-indigo-400 hover:text-indigo-700';
                    let addButtonLabel = 'Add';

                    if (need.hasGap) {
                      addButtonClasses =
                        'border-rose-300 bg-rose-50 text-rose-800 font-semibold hover:bg-rose-100';
                      addButtonLabel = 'Gap · Add';
                    } else if (need.maxNeed >= 2) {
                      addButtonClasses =
                        'border-amber-300 bg-amber-50 text-amber-900 font-semibold hover:bg-amber-100';
                      addButtonLabel = 'Add (need 2+)';
                    } else if (need.maxNeed === 1) {
                      addButtonClasses =
                        'border-slate-300 bg-white text-slate-700 font-medium hover:border-indigo-400 hover:text-indigo-700';
                      addButtonLabel = 'Add (need 1)';
                    }

                    return (
                      <td
                        key={day}
                        className={`relative border-r border-slate-200 p-2 last:border-r-0 ${
                          isFocusedCell
                            ? 'bg-indigo-50/70 ring-2 ring-inset ring-indigo-400'
                            : isWeekend
                              ? 'bg-slate-100/60'
                              : 'bg-white'
                        }`}
                      >
                        <div className="flex min-h-[72px] flex-col gap-1.5">
                          {cellAssignments.map((assignment) => {
                            const flags = assignmentWarnings[assignment.id];
                            const isStaffSelected = highlightedStaffId === assignment.staffId;
                            const isOverHighlight =
                              highlightedOverLimitOnly && Boolean(flags?.isOverMaxHours);
                            const isHighlighted = isStaffSelected || isOverHighlight;
                            const isDimmed =
                              (highlightedStaffId !== null && !isStaffSelected) ||
                              (highlightedOverLimitOnly && !isOverHighlight);

                            return (
                              <AssignmentChip
                                key={assignment.id}
                                assignment={assignment}
                                staffName={staffNameMap.get(assignment.staffId) ?? 'Unknown'}
                                warningFlags={flags}
                                isHighlighted={isHighlighted}
                                isDimmed={isDimmed}
                                isPinConflict={conflictAssignmentIds.has(assignment.id)}
                                isNewFromAuto={newAutoAssignmentIds.has(assignment.id)}
                                onOpenReassign={() =>
                                  setActivePopover({
                                    mode: 'reassign',
                                    day,
                                    shiftId: shift.id,
                                    assignment,
                                  })
                                }
                                onTogglePin={() => onTogglePin(assignment.id)}
                                onRemove={() => onRemove(assignment.id)}
                              />
                            );
                          })}

                          <button
                            type="button"
                            onClick={() =>
                              setActivePopover({ mode: 'assign', day, shiftId: shift.id })
                            }
                            title={
                              need.shortageHoursList.length > 0
                                ? `Shortage hours: ${need.shortageHoursList.join(', ')}`
                                : `Assign staff to ${DAY_LABELS[day]} ${formatShiftRange(shift.startHour, shift.endHour)}`
                            }
                            aria-label={`Add staff to ${DAY_LABELS[day]} ${formatShiftRange(shift.startHour, shift.endHour)}`}
                            className={`mt-auto inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${addButtonClasses}`}
                          >
                            {need.hasGap ? (
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                            )}
                            <span>{addButtonLabel}</span>
                          </button>
                        </div>

                        {isPopoverInCell && (
                          <AssignmentGuidancePopover
                            day={day}
                            shift={shift}
                            staffList={staff}
                            shifts={shifts}
                            assignments={assignments}
                            unusedCapacityHours={unusedCapacityHours}
                            reassigningAssignment={
                              activePopover.mode === 'reassign' ? activePopover.assignment : null
                            }
                            onSelectStaff={(staffId) => {
                              if (activePopover.mode === 'reassign') {
                                onReassign(activePopover.assignment.id, staffId);
                              } else {
                                onAssign(day, shift.id, staffId);
                              }
                              setActivePopover(null);
                            }}
                            onClose={() => setActivePopover(null)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
