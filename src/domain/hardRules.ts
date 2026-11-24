/**
 * @file Independent F-04 hard rule hooks and union-of-hours coverage primitives.
 * Provides composable rule predicates (`checkMaxWeeklyHoursRule`, `checkMaxOneShiftPerDayRule`,
 * `checkNoShiftOverlapRule`) and `computeUnionAssignedHours` / `computeStaffHoursGrid`.
 */

import type { Assignment, ShiftTemplate } from './types';

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
