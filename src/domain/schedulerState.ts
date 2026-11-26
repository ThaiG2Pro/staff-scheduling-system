/**
 * @file Shared mutable working state and utilization helpers for the Auto-Scheduler pipeline.
 * Provides `SchedulerWorkingState`, `WorkingAssignment`, deterministic tie-break comparators,
 * and O(1) / O(|E|) Jain utilization sum helpers used by Stage 1, Stage 2, and Diagnostics.
 */

import type { DayOfWeek, ShiftTemplate, Staff } from './types';

export interface WorkingAssignment {
  readonly day: DayOfWeek;
  readonly shiftId: string;
  readonly shiftIdx: number;
  readonly startHour: number;
  readonly endHour: number;
  readonly duration: number;
  readonly initialStaffId: string;
  readonly stableOrdinal: number;
  staffIdx: number;
}

export interface SchedulerWorkingState {
  readonly eligibleStaff: readonly Readonly<Staff>[];
  readonly sortedShifts: readonly Readonly<ShiftTemplate>[];
  readonly requiredGrid: Float64Array;
  readonly txnsGrid: Float64Array;
  readonly staffHoursGrid: Uint32Array;
  readonly maxHours: Float64Array;
  readonly assignedHours: Int32Array;
  readonly dayOccupied: Uint8Array;
  /** 7-bit active-day bitmask per shift in `sortedShifts` (`bit d = 1` if active on day `d`). */
  readonly shiftDayMask: Uint8Array;
  /** Immutable 7-bit unavailable-day bitmask per staff in `eligibleStaff` (`bit d = 1` if unavailable). */
  readonly unavailableMask: Uint8Array;
  sumU: number;
  sumU2: number;
  workingNew: WorkingAssignment[];
}

/** Lexicographical code-unit string comparator for deterministic tie-breaking. */
export function compareStringsLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic comparator ordering working assignments by `stableKey ASC`. */
export function compareWorkingStableKey(a: WorkingAssignment, b: WorkingAssignment): number {
  if (a.day !== b.day) return a.day - b.day;
  if (a.startHour !== b.startHour) return a.startHour - b.startHour;
  if (a.endHour !== b.endHour) return a.endHour - b.endHour;
  const shiftCmp = compareStringsLex(a.shiftId, b.shiftId);
  if (shiftCmp !== 0) return shiftCmp;
  const staffCmp = compareStringsLex(a.initialStaffId, b.initialStaffId);
  if (staffCmp !== 0) return staffCmp;
  return a.stableOrdinal - b.stableOrdinal;
}

/** Computes Jain's Fairness Index in O(1) from pre-accumulated utilization sums. */
export function computeJainFromSums(
  sumU: number,
  sumU2: number,
  eligibleCount: number,
): number {
  if (eligibleCount === 0 || sumU === 0 || sumU2 === 0) return 0;
  return (sumU * sumU) / (eligibleCount * sumU2);
}

/** Recomputes `sumU` and `sumU2` directly in O(|E|) to prevent floating-point drift. */
export function recomputeUtilizationSums(state: SchedulerWorkingState): void {
  let sumU = 0;
  let sumU2 = 0;
  for (let i = 0; i < state.eligibleStaff.length; i++) {
    const u = state.assignedHours[i]! / state.maxHours[i]!;
    sumU += u;
    sumU2 += u * u;
  }
  state.sumU = sumU;
  state.sumU2 = sumU2;
}
