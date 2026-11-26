/**
 * @file Independent F-04 & Phase 2 hard rule hooks, bitmasks, and union-of-hours coverage primitives.
 * Provides composable rule predicates (`checkMaxWeeklyHoursRule`, `checkMaxOneShiftPerDayRule`,
 * `checkNoShiftOverlapRule`, `checkShiftActiveOnDayRule`, `checkStaffAvailableOnDayRule`),
 * `isStaffEligible`, bitmask builders, `buildCellCoverableGrid`, and `computeUnionAssignedHours`.
 */

import {
  DAYS_IN_WEEK,
  DAYS_OF_WEEK,
  MIN_OPERATING_HOUR,
  OPERATING_HOURS_PER_DAY,
} from './constants';
import type { Assignment, DayOfWeek, ShiftTemplate, Staff } from './types';

const ALL_DAYS_MASK = 0x7f;

/** Returns shift duration in hours (`endHour - startHour`). */
export function getShiftDuration(shift: Readonly<ShiftTemplate>): number {
  return shift.endHour - shift.startHour;
}

/** Formats a shift template as `HH:00–HH:00` for UI labels and guidance reasons. */
export function formatShiftLabel(shift: Readonly<ShiftTemplate>): string {
  const start = `${String(shift.startHour).padStart(2, '0')}:00`;
  const end = `${String(shift.endHour).padStart(2, '0')}:00`;
  return `${start}–${end}`;
}

/**
 * Checks whether two shifts on the same day overlap (`s1.startHour < s2.endHour && s2.startHour < s1.endHour`).
 * Adjacent shifts such as `[7, 15)` and `[15, 23)` do not overlap.
 */
export function shiftsOverlap(
  s1: Readonly<ShiftTemplate>,
  s2: Readonly<ShiftTemplate>,
): boolean {
  return s1.startHour < s2.endHour && s2.startHour < s1.endHour;
}

// --- F-04 Hard Rule Hooks (Independent, Composable Predicates) ---

/** Rule Hook: Staff weekly assigned hours must not exceed `maxWeeklyHours`. */
export function checkMaxWeeklyHoursRule(
  assignedHours: number,
  maxWeeklyHours: number,
): boolean {
  return assignedHours <= maxWeeklyHours;
}

/** Rule Hook: Staff may work at most 1 shift per calendar day. */
export function checkMaxOneShiftPerDayRule(shiftsOnDayCount: number): boolean {
  return shiftsOnDayCount <= 1;
}

/** Rule Hook: Two shifts on the same day for the same staff must not overlap. */
export function checkNoShiftOverlapRule(
  s1: Readonly<ShiftTemplate>,
  s2: Readonly<ShiftTemplate>,
): boolean {
  return !shiftsOverlap(s1, s2);
}

/** Returns the active days for a shift template (defaults to all 7 days when `daysOfWeek` is undefined). */
export function getShiftActiveDays(shift: Readonly<ShiftTemplate>): readonly DayOfWeek[] {
  return shift.daysOfWeek ?? DAYS_OF_WEEK;
}

/** Returns true if a shift template is active on `day`. */
export function isShiftActiveOnDay(shift: Readonly<ShiftTemplate>, day: DayOfWeek): boolean {
  return shift.daysOfWeek === undefined || shift.daysOfWeek.includes(day);
}

/** Rule Hook: Shift template must be active on the target calendar day. */
export function checkShiftActiveOnDayRule(
  shift: Readonly<ShiftTemplate>,
  day: DayOfWeek,
): boolean {
  return isShiftActiveOnDay(shift, day);
}

/** Returns the unavailable days for a staff member (defaults to `[]` when `unavailableDays` is undefined). */
export function getStaffUnavailableDays(staff: Readonly<Staff>): readonly DayOfWeek[] {
  return staff.unavailableDays ?? [];
}

/** Returns true if a staff member is marked unavailable on `day`. */
export function isStaffUnavailableOnDay(staff: Readonly<Staff>, day: DayOfWeek): boolean {
  return staff.unavailableDays !== undefined && staff.unavailableDays.includes(day);
}

/** Rule Hook: Staff member must be available (not marked unavailable) on the target calendar day. */
export function checkStaffAvailableOnDayRule(
  staff: Readonly<Staff>,
  day: DayOfWeek,
): boolean {
  return !isStaffUnavailableOnDay(staff, day);
}

/** Builds a 7-bit active-day bitmask (`bit d = 1` when active on day `d`). Defaults to `0x7f`. */
export function getShiftDayMask(shift: Readonly<ShiftTemplate>): number {
  if (shift.daysOfWeek === undefined) return ALL_DAYS_MASK;
  let mask = 0;
  for (const d of shift.daysOfWeek) {
    mask |= 1 << d;
  }
  return mask;
}

/** Builds a 7-bit unavailable-day bitmask (`bit d = 1` when unavailable on day `d`). Defaults to `0`. */
export function getStaffUnavailableMask(staff: Readonly<Staff>): number {
  if (staff.unavailableDays === undefined) return 0;
  let mask = 0;
  for (const d of staff.unavailableDays) {
    mask |= 1 << d;
  }
  return mask;
}

/**
 * Unified eligibility predicate for Auto-schedule, Jain Fairness Index, utilization,
 * unused capacity, and `ELIGIBLE_STAFF` gate: requires `maxWeeklyHours > 0` and at least 1 available day.
 */
export function isStaffEligible(staff: Readonly<Staff>): boolean {
  return staff.maxWeeklyHours > 0 && getStaffUnavailableMask(staff) !== ALL_DAYS_MASK;
}

/** Deduplicates and sorts a list of days in ascending order (`0..6`). */
export function normalizeDayArray(days: readonly DayOfWeek[]): DayOfWeek[] {
  const unique = new Set<DayOfWeek>(days);
  return Array.from(unique).sort((a, b) => a - b);
}

/**
 * Builds the 2D `(7 days x 16 operating hours)` cell coverability grid indexed by
 * `day * 16 + (hour - 7)`. A cell is `1` iff at least one shift template is active on `day`
 * and covers `hour` (`startHour <= hour < endHour`).
 */
export function buildCellCoverableGrid(
  shifts: readonly Readonly<ShiftTemplate>[],
): Uint8Array {
  const grid = new Uint8Array(DAYS_IN_WEEK * OPERATING_HOURS_PER_DAY);
  for (const shift of shifts) {
    const mask = getShiftDayMask(shift);
    for (let d = 0; d < DAYS_IN_WEEK; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const dayOffset = d * OPERATING_HOURS_PER_DAY;
      for (let h = shift.startHour; h < shift.endHour; h++) {
        grid[dayOffset + (h - MIN_OPERATING_HOUR)] = 1;
      }
    }
  }
  return grid;
}

/**
 * Computes the union of covered operating hours for one staff member across all 7 days,
 * preventing double-counting when manual overrides assign overlapping shifts.
 *
 * @param staffId - Target staff ID.
 * @param assignments - Assignments to inspect.
 * @param shiftMap - Lookup map of `shiftId -> ShiftTemplate`.
 * @returns Unique covered hours in `[0, 112]`.
 */
export function computeUnionAssignedHours(
  staffId: string,
  assignments: readonly Readonly<Assignment>[],
  shiftMap: ReadonlyMap<string, Readonly<ShiftTemplate>>,
): number {
  const covered = new Uint8Array(7 * 16);
  let total = 0;

  for (const a of assignments) {
    if (a.staffId !== staffId) continue;
    const shift = shiftMap.get(a.shiftId);
    if (!shift) continue;

    const dayOffset = a.day * 16;
    for (let h = shift.startHour; h < shift.endHour; h++) {
      const idx = dayOffset + (h - 7);
      if (covered[idx] === 0) {
        covered[idx] = 1;
        total += 1;
      }
    }
  }

  return total;
}

/**
 * Computes the 7x16 unique-staff coverage grid (`staffHours[day * 16 + (hour - 7)]`).
 * Each staff member is counted at most once per operating hour cell.
 *
 * @param assignments - Schedule assignments.
 * @param shiftMap - Lookup map of `shiftId -> ShiftTemplate`.
 * @returns Flat 112-cell `Uint32Array` of unique headcount per hour.
 */
export function computeStaffHoursGrid(
  assignments: readonly Readonly<Assignment>[],
  shiftMap: ReadonlyMap<string, Readonly<ShiftTemplate>>,
): Uint32Array {
  const grid = new Uint32Array(7 * 16);
  const seenPerCell = new Map<number, Set<string>>();

  for (const a of assignments) {
    const shift = shiftMap.get(a.shiftId);
    if (!shift) continue;

    const dayOffset = a.day * 16;
    for (let h = shift.startHour; h < shift.endHour; h++) {
      const idx = dayOffset + (h - 7);
      let staffSet = seenPerCell.get(idx);
      if (!staffSet) {
        staffSet = new Set<string>();
        seenPerCell.set(idx, staffSet);
      }
      if (!staffSet.has(a.staffId)) {
        staffSet.add(a.staffId);
        grid[idx] = grid[idx]! + 1;
      }
    }
  }

  return grid;
}
