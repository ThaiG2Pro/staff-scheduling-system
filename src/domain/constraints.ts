/**
 * @file Schedule constraint gates, assignment guidance, delete previews, and commit validation.
 * Provides `checkPinConflicts` (E-03), `evaluateStaffGuidance` (E-07), `previewDeleteStaff` /
 * `previewDeleteShift` (E-08), and `validateCandidateAssignments` (5 Atomic Commit invariants).
 */

import { DAY_LABELS, DAYS_OF_WEEK, OPERATING_HOURS } from './constants';
import {
  checkMaxOneShiftPerDayRule,
  checkMaxWeeklyHoursRule,
  checkNoShiftOverlapRule,
  checkShiftActiveOnDayRule,
  checkStaffAvailableOnDayRule,
  computeStaffHoursGrid,
  computeUnionAssignedHours,
  formatShiftLabel,
} from './hardRules';
import type {
  Assignment,
  AssignmentGuidanceOption,
  AssignmentGuidanceReason,
  AssignmentGuidanceResult,
  AutoScheduleInput,
  DayOfWeek,
  DeletePreview,
  PinConflict,
  ShiftTemplate,
  Staff,
} from './types';

/** Previews cascade impact before deleting a Staff member (E-08). */
export function previewDeleteStaff(
  staffId: string,
  assignments: readonly Readonly<Assignment>[],
): DeletePreview {
  const affectedAssignmentIds = assignments
    .filter((a) => a.staffId === staffId)
    .map((a) => a.id);
  return {
    affectedAssignmentsCount: affectedAssignmentIds.length,
    affectedAssignmentIds,
  };
}

/** Previews cascade impact before deleting a ShiftTemplate (E-08). */
export function previewDeleteShift(
  shiftId: string,
  assignments: readonly Readonly<Assignment>[],
): DeletePreview {
  const affectedAssignmentIds = assignments
    .filter((a) => a.shiftId === shiftId)
    .map((a) => a.id);
  return {
    affectedAssignmentsCount: affectedAssignmentIds.length,
    affectedAssignmentIds,
  };
}

/**
 * Previews cascade impact before disabling one or more active days on a ShiftTemplate.
 * Counts all existing assignments (both regular and pinned) on days not present in `nextDaysOfWeek`.
 */
export function previewDisableShiftDays(
  shiftId: string,
  nextDaysOfWeek: readonly DayOfWeek[],
  assignments: readonly Readonly<Assignment>[],
): DeletePreview {
  const activeSet = new Set<DayOfWeek>(nextDaysOfWeek);
  const affectedAssignmentIds = assignments
    .filter((a) => a.shiftId === shiftId && !activeSet.has(a.day))
    .map((a) => a.id);
  return {
    affectedAssignmentsCount: affectedAssignmentIds.length,
    affectedAssignmentIds,
  };
}

/**
 * Pin Conflict Gate (E-03, F-07): validates the pinned assignment subset `P`
 * against F-04 hard rule hooks before running Auto-schedule.
 *
 * @param input - Staff, shifts, and existing assignments snapshot.
 * @returns Deterministically ordered list of `PinConflict` items (empty if valid).
 */
export function checkPinConflicts(
  input: Pick<AutoScheduleInput, 'staff' | 'shifts' | 'existingAssignments'>,
): PinConflict[] {
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((sh) => [sh.id, sh]));
  const pinned = input.existingAssignments.filter((a) => a.isPinned);

  if (pinned.length === 0) return [];

  const pinnedByStaff = new Map<string, Readonly<Assignment>[]>();
  for (const a of pinned) {
    const list = pinnedByStaff.get(a.staffId);
    if (list) list.push(a);
    else pinnedByStaff.set(a.staffId, [a]);
  }

  const conflicts: PinConflict[] = [];
  const staffIds = Array.from(pinnedByStaff.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const staffId of staffIds) {
    const staff = staffMap.get(staffId);
    const staffPins = pinnedByStaff.get(staffId) ?? [];
    if (!staff) continue;

    const pinnedHours = computeUnionAssignedHours(staffId, staffPins, shiftMap);
    if (!checkMaxWeeklyHoursRule(pinnedHours, staff.maxWeeklyHours)) {
      conflicts.push({
        staffId: staff.id,
        staffName: staff.name,
        type: 'OVER_MAX_HOURS',
        assignmentIds: staffPins.map((a) => a.id),
        details: `${staff.name} has ${pinnedHours}h of pinned shifts, exceeding their ${staff.maxWeeklyHours}h weekly limit.`,
      });
    }

    const byDay = new Map<DayOfWeek, Readonly<Assignment>[]>();
    for (const a of staffPins) {
      const list = byDay.get(a.day);
      if (list) list.push(a);
      else byDay.set(a.day, [a]);
    }

    for (const day of DAYS_OF_WEEK) {
      const dayPins = byDay.get(day);
      if (!dayPins) continue;

      if (!checkStaffAvailableOnDayRule(staff, day)) {
        conflicts.push({
          staffId: staff.id,
          staffName: staff.name,
          type: 'UNAVAILABLE_DAY',
          assignmentIds: dayPins.map((a) => a.id),
          details: `${staff.name} has ${dayPins.length === 1 ? 'a pinned shift' : `${dayPins.length} pinned shifts`} on ${DAY_LABELS[day]}, which is marked as unavailable.`,
        });
      }

      if (checkMaxOneShiftPerDayRule(dayPins.length)) continue;

      conflicts.push({
        staffId: staff.id,
        staffName: staff.name,
        type: 'MULTIPLE_SHIFTS_SAME_DAY',
        assignmentIds: dayPins.map((a) => a.id),
        details: `${staff.name} has ${dayPins.length} pinned shifts on the same day.`,
      });

      const overlappingIds = new Set<string>();
      for (let i = 0; i < dayPins.length; i++) {
        for (let j = i + 1; j < dayPins.length; j++) {
          const a1 = dayPins[i]!;
          const a2 = dayPins[j]!;
          const s1 = shiftMap.get(a1.shiftId);
          const s2 = shiftMap.get(a2.shiftId);
          if (s1 && s2 && !checkNoShiftOverlapRule(s1, s2)) {
            overlappingIds.add(a1.id);
            overlappingIds.add(a2.id);
          }
        }
      }

      if (overlappingIds.size > 0) {
        conflicts.push({
          staffId: staff.id,
          staffName: staff.name,
          type: 'OVERLAPPING_SHIFTS',
          assignmentIds: Array.from(overlappingIds),
          details: `${staff.name} has overlapping pinned shifts on the same day.`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Evaluates all staff candidates for assigning or reassigning to `(day, targetShift)`,
 * grouping them into `eligible` and `requiresAttention` for the guidance popover (E-07).
 *
 * @param day - Target day of week (`0..6`).
 * @param targetShift - Target shift template.
 * @param staffList - All staff in the schedule.
 * @param shifts - All shift templates in the schedule.
 * @param assignments - Current assignments in the schedule.
 * @param excludeAssignmentId - Optional assignment ID to exclude when in Reassign mode.
 * @returns Grouped `eligible` and `requiresAttention` candidate lists with soft-warning reasons.
 */
export function evaluateStaffGuidance(
  day: DayOfWeek,
  targetShift: Readonly<ShiftTemplate>,
  staffList: readonly Readonly<Staff>[],
  shifts: readonly Readonly<ShiftTemplate>[],
  assignments: readonly Readonly<Assignment>[],
  excludeAssignmentId?: string,
): AssignmentGuidanceResult {
  const shiftMap = new Map(shifts.map((sh) => [sh.id, sh]));
  shiftMap.set(targetShift.id, targetShift);

  const baseAssignments = excludeAssignmentId
    ? assignments.filter((a) => a.id !== excludeAssignmentId)
    : assignments;

  const eligible: AssignmentGuidanceOption[] = [];
  const requiresAttention: AssignmentGuidanceOption[] = [];

  for (const candidate of staffList) {
    const alreadyInSlot = baseAssignments.some(
      (a) => a.day === day && a.shiftId === targetShift.id && a.staffId === candidate.id,
    );
    if (alreadyInSlot) continue;

    const currentAssignedHours = computeUnionAssignedHours(candidate.id, baseAssignments, shiftMap);
    const hypotheticalAssignedHours = computeUnionAssignedHours(
      candidate.id,
      [
        ...baseAssignments,
        { id: '__hypothetical__', day, shiftId: targetShift.id, staffId: candidate.id, isPinned: false },
      ],
      shiftMap,
    );

    const reasons: AssignmentGuidanceReason[] = [];
    if (!checkStaffAvailableOnDayRule(candidate, day)) {
      reasons.push({
        code: 'STAFF_UNAVAILABLE_ON_DAY',
        message: `Marked unavailable on ${DAY_LABELS[day]}`,
      });
    }

    if (!checkMaxWeeklyHoursRule(hypotheticalAssignedHours, candidate.maxWeeklyHours)) {
      const excessHours = hypotheticalAssignedHours - candidate.maxWeeklyHours;
      reasons.push({
        code: 'WOULD_EXCEED_MAX_HOURS',
        message: `Exceeds weekly limit by +${excessHours}h`,
        excessHours,
      });
    }

    const sameDayAssignments = baseAssignments.filter(
      (a) => a.staffId === candidate.id && a.day === day,
    );
    if (!checkMaxOneShiftPerDayRule(sameDayAssignments.length + 1)) {
      reasons.push({
        code: 'ALREADY_HAS_SHIFT_ON_DAY',
        message: 'Already has a shift on this day',
      });

      for (const existing of sameDayAssignments) {
        const existingShift = shiftMap.get(existing.shiftId);
        if (existingShift && !checkNoShiftOverlapRule(existingShift, targetShift)) {
          const label = formatShiftLabel(existingShift);
          reasons.push({
            code: 'WOULD_OVERLAP_SHIFT',
            message: `Overlaps with shift ${label}`,
            overlappingShiftLabel: label,
          });
        }
      }
    }

    const option: AssignmentGuidanceOption = {
      staff: candidate,
      currentAssignedHours,
      hypotheticalAssignedHours,
      remainingHoursAfter: candidate.maxWeeklyHours - hypotheticalAssignedHours,
      status: reasons.length === 0 ? 'ELIGIBLE' : 'REQUIRES_ATTENTION',
      reasons,
    };

    if (reasons.length === 0) eligible.push(option);
    else requiresAttention.push(option);
  }

  return { eligible, requiresAttention };
}

/**
 * Independent post-condition validator for Atomic Auto-schedule Commit (Domain Model §4.3).
 * Verifies all 5 invariants: pin preservation, unique IDs & triples, referential integrity,
 * F-04 hard rules, `isPinned=false` on new rows, and optional exact 112-cell coverage equality.
 *
 * @param candidateAssignments - Full candidate assignment list produced by the solver.
 * @param input - Original solver input snapshot.
 * @param expectedStaffHoursGrid - Optional Stage 1 112-cell coverage grid to verify Stage 2 invariance.
 * @returns `{ ok: true }` or `{ ok: false, message }` describing the violated invariant.
 */
export function validateCandidateAssignments(
  candidateAssignments: readonly Readonly<Assignment>[],
  input: Pick<AutoScheduleInput, 'staff' | 'shifts' | 'existingAssignments'>,
  expectedStaffHoursGrid?: Uint32Array,
): { ok: true } | { ok: false; message: string } {
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((sh) => [sh.id, sh]));
  const originalPinMap = new Map(
    input.existingAssignments.filter((a) => a.isPinned).map((p) => [p.id, p]),
  );

  const seenIds = new Set<string>();
  const seenTriples = new Set<string>();
  const matchedPinIds = new Set<string>();
  const staffDayCount = new Map<string, number>();

  for (const a of candidateAssignments) {
    if (typeof a.id !== 'string' || a.id.trim().length === 0) {
      return { ok: false, message: 'Candidate assignment has empty or invalid ID.' };
    }
    if (seenIds.has(a.id)) {
      return { ok: false, message: `Duplicate assignment ID detected: "${a.id}".` };
    }
    seenIds.add(a.id);

    const staff = staffMap.get(a.staffId);
    if (!staff) {
      return { ok: false, message: `Unknown staffId "${a.staffId}" in candidate assignments.` };
    }
    const shift = shiftMap.get(a.shiftId);
    if (!shift) {
      return { ok: false, message: `Unknown shiftId "${a.shiftId}" in candidate assignments.` };
    }
    if (!checkShiftActiveOnDayRule(shift, a.day)) {
      return {
        ok: false,
        message: `Shift "${a.shiftId}" is inactive on ${DAY_LABELS[a.day]} (day ${a.day}).`,
      };
    }
    if (!checkStaffAvailableOnDayRule(staff, a.day)) {
      return {
        ok: false,
        message: `Staff "${a.staffId}" is unavailable on ${DAY_LABELS[a.day]} (day ${a.day}).`,
      };
    }

    const tripleKey = `${a.day}|${a.shiftId}|${a.staffId}`;
    if (seenTriples.has(tripleKey)) {
      return { ok: false, message: `Duplicate assignment triple (${tripleKey}).` };
    }
    seenTriples.add(tripleKey);

    const origPin = originalPinMap.get(a.id);
    if (origPin) {
      if (
        !a.isPinned ||
        a.day !== origPin.day ||
        a.shiftId !== origPin.shiftId ||
        a.staffId !== origPin.staffId
      ) {
        return { ok: false, message: `Pinned assignment "${a.id}" was mutated.` };
      }
      matchedPinIds.add(a.id);
    } else if (a.isPinned) {
      return { ok: false, message: `Newly generated assignment "${a.id}" must have isPinned=false.` };
    }

    const staffDayKey = `${a.staffId}|${a.day}`;
    const count = (staffDayCount.get(staffDayKey) ?? 0) + 1;
    if (!checkMaxOneShiftPerDayRule(count)) {
      return {
        ok: false,
        message: `Staff "${a.staffId}" assigned to more than 1 shift on day ${a.day}.`,
      };
    }
    staffDayCount.set(staffDayKey, count);
  }

  if (matchedPinIds.size !== originalPinMap.size) {
    return {
      ok: false,
      message: `Pinned assignments mismatch: expected ${originalPinMap.size}, preserved ${matchedPinIds.size}.`,
    };
  }

  for (const s of input.staff) {
    const hours = computeUnionAssignedHours(s.id, candidateAssignments, shiftMap);
    if (!checkMaxWeeklyHoursRule(hours, s.maxWeeklyHours)) {
      return {
        ok: false,
        message: `Staff "${s.id}" exceeds maxWeeklyHours (${hours} > ${s.maxWeeklyHours}).`,
      };
    }
  }

  if (expectedStaffHoursGrid) {
    const actualGrid = computeStaffHoursGrid(candidateAssignments, shiftMap);
    for (let idx = 0; idx < DAYS_OF_WEEK.length * OPERATING_HOURS.length; idx++) {
      if (actualGrid[idx] !== expectedStaffHoursGrid[idx]) {
        return {
          ok: false,
          message: `Stage 2 coverage invariant violated at cell index ${idx}.`,
        };
      }
    }
  }

  return { ok: true };
}
