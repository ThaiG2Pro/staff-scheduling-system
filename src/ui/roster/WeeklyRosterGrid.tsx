/**
 * @file Shift-first Weekly Roster Grid (`AC-04`) with 7 fixed `Mon–Sun` columns, severity-tiered
 * day & slot shortage indicators, inline `AssignmentChip` list, viewport-safe fixed
 * `AssignmentGuidancePopover`, Empty Schedule 3-Step Onboarding, and focused-hour jump highlight.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
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
import {
  AssignmentGuidancePopover,
  type PopoverAnchorRect,
} from './AssignmentGuidancePopover';

export interface FocusedRosterSlot {
  day: DayOfWeek;
  hour?: OperatingHour;
}

export interface WeeklyRosterGridProps {
  shifts: readonly ShiftTemplate[];
  staff: readonly Staff[];
  assignments: readonly Assignment[];
  hasDemand: boolean;
  summary: AggregatedSummary;
  assignmentWarnings: Record<string, AssignmentWarningFlags>;
  unusedCapacityHours: number;
  highlightedStaffId: string | null;
  highlightedOverLimitOnly: boolean;
  highlightGapsOnly?: boolean;
  totalGapHours?: number;
  onClearGapsLens?: () => void;
  conflictAssignmentIds: ReadonlySet<string>;
  newAutoAssignmentIds: ReadonlySet<string>;
  focusedSlot: FocusedRosterSlot | null;
  onClearFocus: () => void;
  onBackToSummary?: (slot: FocusedRosterSlot) => void;
  onInspectDayInSummary?: (day: DayOfWeek) => void;
  onAssign: (day: DayOfWeek, shiftId: string, staffId: string) => void;
  onReassign: (assignmentId: string, newStaffId: string) => void;
  onTogglePin: (assignmentId: string) => void;
  onRemove: (assignmentId: string) => void;
  onOpenManageShifts: () => void;
  onOpenCsvImport: () => void;
  onOpenAddStaff: () => void;
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
  | { mode: 'assign'; day: DayOfWeek; shift: ShiftTemplate; anchorRect: PopoverAnchorRect }
  | {
      mode: 'reassign';
      day: DayOfWeek;
      shift: ShiftTemplate;
      assignment: Assignment;
      anchorRect: PopoverAnchorRect;
    };

function captureRect(event: MouseEvent<HTMLElement>): PopoverAnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

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
 * Interactive 7-day Shift-first Weekly Roster Grid with viewport-safe 2-click Assign/Reassign popover.
 *
 * @param props - Shifts, staff, assignments, summary metrics, highlight states, and edit callbacks.
 * @returns Roster grid table or 3-step onboarding card for brand-new empty schedules.
 */
const DEFAULT_ROW_HEIGHT = 72;
const ROOMY_ROW_HEIGHT = 144;
const MIN_ROW_HEIGHT = 72;
const MAX_ROW_HEIGHT = 280;
const ROW_HEIGHT_STORAGE_KEY = 'staff-scheduling.roster-row-height';

function readSavedRowHeight(): number {
  try {
    const raw = window.localStorage.getItem(ROW_HEIGHT_STORAGE_KEY);
    if (!raw) return DEFAULT_ROW_HEIGHT;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_ROW_HEIGHT && parsed <= MAX_ROW_HEIGHT) {
      return Math.round(parsed);
    }
  } catch {
    // Ignore storage access errors for non-critical UI preference
  }
  return DEFAULT_ROW_HEIGHT;
}

export function WeeklyRosterGrid({
  shifts,
  staff,
  assignments,
  hasDemand,
  summary,
  assignmentWarnings,
  unusedCapacityHours,
  highlightedStaffId,
  highlightedOverLimitOnly,
  highlightGapsOnly = false,
  totalGapHours = 0,
  onClearGapsLens,
  conflictAssignmentIds,
  newAutoAssignmentIds,
  focusedSlot,
  onClearFocus,
  onBackToSummary,
  onInspectDayInSummary,
  onAssign,
  onReassign,
  onTogglePin,
  onRemove,
  onOpenManageShifts,
  onOpenCsvImport,
  onOpenAddStaff,
}: WeeklyRosterGridProps) {
  const [activePopover, setActivePopover] = useState<ActivePopover | null>(null);
  const [activeGapIndex, setActiveGapIndex] = useState(0);
  const [rowHeightPx, setRowHeightPx] = useState<number>(readSavedRowHeight);
  const [isResizingRows, setIsResizingRows] = useState(false);
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  const updateRowHeight = (next: number) => {
    const clamped = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(next)));
    setRowHeightPx(clamped);
    try {
      window.localStorage.setItem(ROW_HEIGHT_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage access errors
    }
  };

  const handleRowResizeMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = rowHeightPx;
    const rowCount = Math.max(1, orderedShifts.length);
    setIsResizingRows(true);

    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      // Divide by rowCount so the bottom resize handle tracks the mouse cursor 1:1
      updateRowHeight(startHeight + deltaY / rowCount);
    };

    const handleUp = () => {
      setIsResizingRows(false);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const staffNameMap = useMemo(
    () => new Map(staff.map((member) => [member.id, member.name])),
    [staff],
  );

  // Preserve the manager's configured shift template order from Manage Shift Templates
  const orderedShifts = shifts;

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

  const gapSlots = useMemo(() => {
    const list: Array<{ key: string; day: DayOfWeek; shift: ShiftTemplate }> = [];
    for (const day of DAYS_OF_WEEK) {
      for (const shift of orderedShifts) {
        const need = computeSlotNeed(day, shift, summary);
        if (need.hasGap) {
          list.push({ key: `${shift.id}|${day}`, day, shift });
        }
      }
    }
    return list;
  }, [orderedShifts, summary]);

  const safeGapIndex = gapSlots.length > 0 ? Math.min(activeGapIndex, gapSlots.length - 1) : 0;
  const activeGapSlot = highlightGapsOnly && gapSlots.length > 0 ? gapSlots[safeGapIndex] ?? null : null;

  useEffect(() => {
    if (!highlightGapsOnly) {
      setActiveGapIndex(0);
      return;
    }
    if (activeGapSlot) {
      cellRefs.current[activeGapSlot.key]?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [highlightGapsOnly, activeGapSlot?.key]);

  if (orderedShifts.length === 0) {
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

  // Empty Schedule 3-Step Onboarding (brand-new schedule with neither CSV demand nor staff yet)
  if (!hasDemand && staff.length === 0 && assignments.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <h3 className="text-base font-bold text-slate-900">
          Get started with this week&apos;s schedule
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Follow 3 quick steps to run Auto-schedule, or manage shifts anytime.
        </p>

        <div className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-3.5 text-left sm:grid-cols-3">
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                Step 1
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">Import CSV Demand</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Upload 7-day hourly customer transactions (07:00–22:00).
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCsvImport}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Import CSV
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                Step 2
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">Add Staff</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Add team members and their weekly hour limits.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAddStaff}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Staff
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              Step 3
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">Run Auto-schedule</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Generate a balanced weekly draft, then pin and fine-tune shifts directly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {highlightGapsOnly && (
        <div
          role="status"
          className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-950"
        >
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
            <span>
              <strong>Gap focus:</strong> {gapSlots.length} shift slot
              {gapSlots.length === 1 ? '' : 's'} covering{' '}
              <strong>
                {totalGapHours} unstaffed busy {totalGapHours === 1 ? 'hour' : 'hours'}
              </strong>
              {activeGapSlot && (
                <>
                  {' · '}
                  <span className="font-semibold text-rose-900">
                    {DAY_LABELS[activeGapSlot.day]}{' '}
                    {formatShiftRange(activeGapSlot.shift.startHour, activeGapSlot.shift.endHour)}
                  </span>{' '}
                  ({safeGapIndex + 1}/{gapSlots.length})
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {gapSlots.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setActiveGapIndex((prev) => (prev - 1 + gapSlots.length) % gapSlots.length)
                  }
                  aria-label="Previous gap slot"
                  className="inline-flex items-center gap-0.5 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGapIndex((prev) => (prev + 1) % gapSlots.length)}
                  aria-label="Next gap slot"
                  className="inline-flex items-center gap-0.5 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                >
                  Next
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            )}
            {onClearGapsLens && (
              <button
                type="button"
                onClick={onClearGapsLens}
                className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear lens
              </button>
            )}
          </div>
        </div>
      )}

      {focusedSlot && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-950">
          <span>
            Focused from Hourly Summary:{' '}
            <strong>
              {focusedSlot.hour !== undefined
                ? `${DAY_LABELS[focusedSlot.day]} ${formatHour24(focusedSlot.hour)}`
                : DAY_LABELS[focusedSlot.day]}
            </strong>{' '}
            —{' '}
            {focusedSlot.hour !== undefined
              ? 'shifts covering this hour are highlighted below.'
              : 'all shifts on this day are highlighted below.'}
          </span>
          <div className="flex items-center gap-1.5">
            {onBackToSummary && (
              <button
                type="button"
                onClick={() => onBackToSummary(focusedSlot)}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
              >
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back to Summary
              </button>
            )}
            <button
              type="button"
              onClick={onClearFocus}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear focus
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[740px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[108px] xl:w-[118px]" />
            {DAYS_OF_WEEK.map((day) => (
              <col key={day} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              <th
                scope="col"
                className="sticky left-0 z-20 border-r border-slate-200 bg-slate-100 px-2.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700"
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
                    className={`border-r border-slate-200 p-0 align-top last:border-r-0 ${
                      isFocusedDay
                        ? 'bg-indigo-100/80'
                        : isWeekend
                          ? 'bg-slate-200/50'
                          : 'bg-slate-100'
                    }`}
                  >
                    {onInspectDayInSummary ? (
                      <button
                        type="button"
                        onClick={() => onInspectDayInSummary(day)}
                        title={`Inspect ${DAY_LABELS[day]} hourly breakdown on Summary`}
                        aria-label={`Inspect ${DAY_LABELS[day]} in Hourly Summary`}
                        className="group flex w-full flex-wrap items-center justify-between gap-1 px-2 py-2 text-left transition hover:bg-indigo-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                      >
                        <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-800">
                          {DAY_LABELS[day]}
                        </span>
                        {status.hasDemand && status.gapCount > 0 ? (
                          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                            {status.gapCount} gap{status.gapCount === 1 ? '' : 's'}
                          </span>
                        ) : status.hasDemand && status.shortageHours >= 15 ? (
                          <span className="whitespace-nowrap rounded-full bg-orange-600 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand && status.shortageHours >= 6 ? (
                          <span className="whitespace-nowrap rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand && status.shortageHours > 0 ? (
                          <span className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand ? (
                          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-800">
                            <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
                            OK
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-2">
                        <span className="text-xs font-bold text-slate-900">{DAY_LABELS[day]}</span>
                        {status.hasDemand && status.gapCount > 0 ? (
                          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                            {status.gapCount} gap{status.gapCount === 1 ? '' : 's'}
                          </span>
                        ) : status.hasDemand && status.shortageHours >= 15 ? (
                          <span className="whitespace-nowrap rounded-full bg-orange-600 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand && status.shortageHours >= 6 ? (
                          <span className="whitespace-nowrap rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand && status.shortageHours > 0 ? (
                          <span className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900">
                            Need {status.shortageHours}h
                          </span>
                        ) : status.hasDemand ? (
                          <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-800">
                            <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
                            OK
                          </span>
                        ) : null}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200">
            {orderedShifts.map((shift) => {
              const duration = shift.endHour - shift.startHour;
              return (
                <tr key={shift.id} className="align-top">
                  {/* Sticky Shift Row Header */}
                  <th
                    scope="row"
                    className="group sticky left-0 z-10 border-r border-slate-200 bg-white px-2.5 py-2.5 text-left font-normal"
                  >
                    <div className="space-y-1">
                      <p className="text-xs font-semibold leading-tight text-slate-900 tabular-nums">
                        {formatHour24(shift.startHour)}–{formatHour24(shift.endHour)}
                      </p>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] text-slate-600">{duration}h</span>
                        <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={onOpenManageShifts}
                            aria-label={`Manage shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                            title="Edit or delete shift template"
                            className="rounded p-0.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:opacity-100"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={onOpenManageShifts}
                            aria-label={`Delete shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                            title="Manage shifts"
                            className="rounded p-0.5 text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
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
                      (focusedSlot.hour === undefined ||
                        (focusedSlot.hour >= shift.startHour &&
                          focusedSlot.hour < shift.endHour));
                    const isDimmedByDayFocus =
                      !highlightGapsOnly &&
                      focusedSlot !== null &&
                      focusedSlot.hour === undefined &&
                      focusedSlot.day !== day;

                    let addButtonClasses =
                      'border-slate-300/80 bg-white text-slate-600 opacity-75 hover:opacity-100 hover:border-indigo-400 hover:text-indigo-700';
                    let addButtonLabel = 'Add';

                    if (need.hasGap) {
                      addButtonClasses =
                        'border-rose-400 bg-rose-100/90 text-rose-900 font-semibold hover:bg-rose-200/80';
                      addButtonLabel = 'Gap';
                    } else if (need.maxNeed >= 3) {
                      addButtonClasses =
                        'border-orange-500 bg-orange-100/80 text-orange-950 font-semibold hover:bg-orange-200/80';
                      addButtonLabel = `Need ${need.maxNeed}+`;
                    } else if (need.maxNeed === 2) {
                      addButtonClasses =
                        'border-amber-400 bg-amber-100/70 text-amber-950 font-semibold hover:bg-amber-200/70';
                      addButtonLabel = 'Need 2';
                    } else if (need.maxNeed === 1) {
                      addButtonClasses =
                        'border-amber-300 bg-amber-50/70 text-amber-900 font-medium hover:bg-amber-100/70';
                      addButtonLabel = 'Need 1';
                    }

                    const isActiveGapCell =
                      highlightGapsOnly && activeGapSlot?.key === cellKey;
                    const isGapLensCell = highlightGapsOnly && need.hasGap;
                    const isDimmedByGapLens = highlightGapsOnly && !need.hasGap;

                    return (
                      <td
                        key={day}
                        ref={(el) => {
                          cellRefs.current[cellKey] = el;
                        }}
                        className={`border-r border-slate-200 p-1.5 last:border-r-0 transition-opacity ${
                          isActiveGapCell
                            ? 'bg-rose-100/80 ring-2 ring-inset ring-rose-600'
                            : isGapLensCell
                              ? 'bg-rose-50/70 ring-1 ring-inset ring-rose-400'
                              : isFocusedCell
                                ? 'bg-indigo-50/70 ring-2 ring-inset ring-indigo-400'
                                : isWeekend
                                  ? 'bg-slate-100/60'
                                  : 'bg-white'
                        } ${
                          isDimmedByGapLens
                            ? 'opacity-40 hover:opacity-100'
                            : isDimmedByDayFocus
                              ? 'opacity-45 hover:opacity-100'
                              : ''
                        }`}
                      >
                        <div
                          className="flex flex-col gap-1.5"
                          style={{ minHeight: `${rowHeightPx}px` }}
                        >
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
                              <div
                                key={assignment.id}
                                onClick={(e) => {
                                  const target = e.target as HTMLElement;
                                  if (target.closest('button[data-chip-reassign="true"]')) {
                                    setActivePopover({
                                      mode: 'reassign',
                                      day,
                                      shift,
                                      assignment,
                                      anchorRect: captureRect(e),
                                    });
                                  }
                                }}
                              >
                                <AssignmentChip
                                  assignment={assignment}
                                  staffName={staffNameMap.get(assignment.staffId) ?? 'Unknown'}
                                  warningFlags={flags}
                                  isHighlighted={isHighlighted}
                                  isDimmed={isDimmed}
                                  isPinConflict={conflictAssignmentIds.has(assignment.id)}
                                  isNewFromAuto={newAutoAssignmentIds.has(assignment.id)}
                                  onOpenReassign={() => {
                                    // Anchor rect captured via wrapper click; fallback for keyboard Enter
                                    if (!activePopover) {
                                      setActivePopover({
                                        mode: 'reassign',
                                        day,
                                        shift,
                                        assignment,
                                        anchorRect: { top: 180, bottom: 210, left: 240, right: 340 },
                                      });
                                    }
                                  }}
                                  onTogglePin={() => onTogglePin(assignment.id)}
                                  onRemove={() => onRemove(assignment.id)}
                                />
                              </div>
                            );
                          })}

                          <button
                            type="button"
                            onClick={(e) =>
                              setActivePopover({
                                mode: 'assign',
                                day,
                                shift,
                                anchorRect: captureRect(e),
                              })
                            }
                            title={
                              need.shortageHoursList.length > 0
                                ? `Shortage hours: ${need.shortageHoursList.join(', ')}`
                                : `Assign staff to ${DAY_LABELS[day]} ${formatShiftRange(shift.startHour, shift.endHour)}`
                            }
                            aria-label={`Add staff to ${DAY_LABELS[day]} ${formatShiftRange(shift.startHour, shift.endHour)}`}
                            className={`mt-auto inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed px-2 py-1 text-[11px] transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${addButtonClasses}`}
                          >
                            {need.hasGap ? (
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                            )}
                            <span>{addButtonLabel}</span>
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom Mouse-Drag Row Height Resizer */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize roster row height"
        aria-valuemin={MIN_ROW_HEIGHT}
        aria-valuemax={MAX_ROW_HEIGHT}
        aria-valuenow={rowHeightPx}
        tabIndex={0}
        onMouseDown={handleRowResizeMouseDown}
        onDoubleClick={() =>
          updateRowHeight(rowHeightPx > DEFAULT_ROW_HEIGHT + 12 ? DEFAULT_ROW_HEIGHT : ROOMY_ROW_HEIGHT)
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateRowHeight(rowHeightPx + 16);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateRowHeight(rowHeightPx - 16);
          }
        }}
        title="Drag up/down to resize shift row height (double-click to toggle compact/roomy)"
        className={`group flex cursor-ns-resize select-none items-center justify-center gap-2 border-t border-slate-200 px-3 py-1 text-[11px] font-medium transition ${
          isResizingRows
            ? 'bg-indigo-50 text-indigo-800'
            : 'bg-slate-50/80 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        }`}
      >
        <GripHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {isResizingRows
            ? `Row height: ${rowHeightPx}px`
            : rowHeightPx > DEFAULT_ROW_HEIGHT
              ? `Drag to resize rows (${rowHeightPx}px) · Double-click to reset`
              : 'Drag down to expand shift cells · Double-click for roomy view'}
        </span>
      </div>

      {/* Viewport-safe fixed Popover rendered outside table overflow container */}
      {activePopover && (
        <AssignmentGuidancePopover
          day={activePopover.day}
          shift={activePopover.shift}
          staffList={staff}
          shifts={shifts}
          assignments={assignments}
          unusedCapacityHours={unusedCapacityHours}
          anchorRect={activePopover.anchorRect}
          reassigningAssignment={
            activePopover.mode === 'reassign' ? activePopover.assignment : null
          }
          onSelectStaff={(staffId) => {
            if (activePopover.mode === 'reassign') {
              onReassign(activePopover.assignment.id, staffId);
            } else {
              onAssign(activePopover.day, activePopover.shift.id, staffId);
            }
            setActivePopover(null);
          }}
          onRemoveExisting={(assignmentId) => onRemove(assignmentId)}
          onClose={() => setActivePopover(null)}
        />
      )}
    </div>
  );
}
