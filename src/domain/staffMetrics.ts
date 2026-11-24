/**
 * @file Per-staff derived metrics and Jain's Fairness Index calculation.
 * Provides `computeAllStaffMetrics` (union hours, limit/overlap flags, unused capacity)
 * and `computeFairnessJainIndex` over eligible staff (`maxWeeklyHours > 0`).
 */

import { DAYS_OF_WEEK, MAX_SAFE_BIGINT } from './constants';
import { safeBigIntToNumber } from './decimalMath';
import { computeUnionAssignedHours, shiftsOverlap } from './hardRules';
import type {
  Assignment,
  AssignmentWarningFlags,
  DayOfWeek,
  ShiftTemplate,
  Staff,
  StaffMetrics,
} from './types';

export interface StaffMetricsBundle {
  staffMetrics: Record<string, StaffMetrics>;
  assignmentWarnings: Record<string, AssignmentWarningFlags>;
  hourLimitWarningCount: number;
  unusedCapacityHours: number;
}

/**
 * Computes per-staff union hours, overtime/limit flags, multi-shift/overlap warnings,
 * and BigInt-guarded `unusedCapacityHours` across all staff in a Schedule.
 *
 * @param staff - Staff list in the schedule.
 * @param assignments - Schedule assignments.
 * @param shiftMap - Lookup map of `shiftId -> ShiftTemplate`.
 * @returns Computed staff metrics bundle or a controlled `INVALID_INPUT` / `SAFE_INTEGER_OVERFLOW` error.
 */
export function computeAllStaffMetrics(
  staff: readonly Readonly<Staff>[],
  assignments: readonly Readonly<Assignment>[],
  shiftMap: ReadonlyMap<string, Readonly<ShiftTemplate>>,
): { ok: true; data: StaffMetricsBundle } | { ok: false; error: 'INVALID_INPUT' | 'SAFE_INTEGER_OVERFLOW'; message: string } {
  const staffMetrics: Record<string, StaffMetrics> = {};
  const assignmentWarnings: Record<string, AssignmentWarningFlags> = {};

  const assignmentsByStaff = new Map<string, Readonly<Assignment>[]>();
  for (const a of assignments) {
    const list = assignmentsByStaff.get(a.staffId);
    if (list) list.push(a);
    else assignmentsByStaff.set(a.staffId, [a]);
  }

  let hourLimitWarningCount = 0;
  let unusedCapacityBigInt = 0n;

  for (const s of staff) {
    if (!Number.isSafeInteger(s.maxWeeklyHours) || s.maxWeeklyHours < 0) {
      return {
        ok: false,
        error: 'INVALID_INPUT',
        message: `Invalid maxWeeklyHours for staff "${s.id}".`,
      };
    }

    const staffAssignments = assignmentsByStaff.get(s.id) ?? [];
    const assignedHours = computeUnionAssignedHours(s.id, staffAssignments, shiftMap);
    const remainingHours = s.maxWeeklyHours - assignedHours;
    const overtimeHours = Math.max(0, assignedHours - s.maxWeeklyHours);
    const isOverMaxHours = assignedHours > s.maxWeeklyHours;
    const utilization = s.maxWeeklyHours > 0 ? assignedHours / s.maxWeeklyHours : null;

    if (isOverMaxHours) {
      hourLimitWarningCount += 1;
    }

    if (s.maxWeeklyHours > 0 && remainingHours > 0) {
      unusedCapacityBigInt += BigInt(remainingHours);
      if (unusedCapacityBigInt > MAX_SAFE_BIGINT) {
        return {
          ok: false,
          error: 'SAFE_INTEGER_OVERFLOW',
          message: 'SAFE_INTEGER_OVERFLOW: unusedCapacityHours exceeded Number.MAX_SAFE_INTEGER.',
        };
      }
    }

    const byDay = new Map<DayOfWeek, Readonly<Assignment>[]>();
    for (const a of staffAssignments) {
      const list = byDay.get(a.day);
      if (list) list.push(a);
      else byDay.set(a.day, [a]);
    }

    const multiShiftDays: DayOfWeek[] = [];
    const overlappingSet = new Set<string>();

    for (const day of DAYS_OF_WEEK) {
      const dayAssignments = byDay.get(day);
      if (!dayAssignments || dayAssignments.length <= 1) continue;

      multiShiftDays.push(day);
      for (let i = 0; i < dayAssignments.length; i++) {
        for (let j = i + 1; j < dayAssignments.length; j++) {
          const a1 = dayAssignments[i]!;
          const a2 = dayAssignments[j]!;
          const sh1 = shiftMap.get(a1.shiftId);
          const sh2 = shiftMap.get(a2.shiftId);
          if (sh1 && sh2 && shiftsOverlap(sh1, sh2)) {
            overlappingSet.add(a1.id);
            overlappingSet.add(a2.id);
          }
        }
      }
    }

    const multiShiftDaySet = new Set<DayOfWeek>(multiShiftDays);
    staffMetrics[s.id] = {
      staffId: s.id,
      assignedHours,
      remainingHours,
      overtimeHours,
      isOverMaxHours,
      utilization,
      multiShiftDays,
      overlappingAssignmentIds: Array.from(overlappingSet),
    };

    for (const a of staffAssignments) {
      assignmentWarnings[a.id] = {
        assignmentId: a.id,
        isOverMaxHours,
        isMultiShiftDay: multiShiftDaySet.has(a.day),
        isOverlapping: overlappingSet.has(a.id),
      };
    }
  }

  const unusedCapacitySafe = safeBigIntToNumber(unusedCapacityBigInt);
  if (!unusedCapacitySafe.ok) {
    return {
      ok: false,
      error: 'SAFE_INTEGER_OVERFLOW',
      message: 'SAFE_INTEGER_OVERFLOW: unusedCapacityHours exceeded Number.MAX_SAFE_INTEGER.',
    };
  }

  return {
    ok: true,
    data: {
      staffMetrics,
      assignmentWarnings,
      hourLimitWarningCount,
      unusedCapacityHours: unusedCapacitySafe.value,
    },
  };
}

/**
 * Computes Jain's Fairness Index across eligible staff (`maxWeeklyHours > 0`).
 *
 * @param staff - Staff list in the schedule.
 * @param staffMetrics - Precomputed staff metrics keyed by `staffId`.
 * @returns Fairness index (`null` when no eligible staff or total utilization is 0) and eligibility counts.
 */
export function computeFairnessJainIndex(
  staff: readonly Readonly<Staff>[],
  staffMetrics: Readonly<Record<string, StaffMetrics>>,
): { jainIndex: number | null; eligibleStaffCount: number; isSingleEligibleStaff: boolean } {
  const eligible = staff.filter((s) => s.maxWeeklyHours > 0);
  const eligibleStaffCount = eligible.length;

  if (eligibleStaffCount === 0) {
    return { jainIndex: null, eligibleStaffCount: 0, isSingleEligibleStaff: false };
  }

  let sumU = 0;
  let sumU2 = 0;
  for (const s of eligible) {
    const assigned = staffMetrics[s.id]?.assignedHours ?? 0;
    const u = assigned / s.maxWeeklyHours;
    sumU += u;
    sumU2 += u * u;
  }

  if (sumU === 0 || sumU2 === 0) {
    return { jainIndex: null, eligibleStaffCount, isSingleEligibleStaff: eligibleStaffCount === 1 };
  }

  return {
    jainIndex: (sumU * sumU) / (eligibleStaffCount * sumU2),
    eligibleStaffCount,
    isSingleEligibleStaff: eligibleStaffCount === 1,
  };
}
