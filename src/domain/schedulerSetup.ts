/**
 * @file Stage 0 setup & post-Stage-2 ID assignment helpers for the Auto-Scheduler pipeline.
 * Provides input readiness validation (`validateInputReadiness`), BigInt demand grid conversion
 * (`buildRequiredGrids`), typed-array working state initialization (`initializeWorkingState`),
 * and deterministic post-rebalance ID generation (`assignGeneratedIds`).
 */

import { DAYS_OF_WEEK, MAX_SAFE_BIGINT, OPERATING_HOURS } from './constants';
import { computeRequiredStaff } from './decimalMath';
import { getShiftDayMask, getStaffUnavailableMask, isStaffEligible } from './hardRules';
import {
  compareStringsLex,
  recomputeUtilizationSums,
  type SchedulerWorkingState,
} from './schedulerState';
import type {
  Assignment,
  AutoScheduleInput,
  AutoScheduleResult,
  MissingInputCode,
  ShiftTemplate,
  Staff,
} from './types';

/**
 * Validates Stage 0 input readiness (E-02): demand present, shift templates non-empty,
 * at least one eligible staff member, valid `targetTxnsPerStaffHour`, and safe-integer `maxWeeklyHours`.
 */
export function validateInputReadiness(
  input: AutoScheduleInput,
): { ok: true; eligibleStaff: Readonly<Staff>[] } | { ok: false; result: AutoScheduleResult } {
  const missingInputs: MissingInputCode[] = [];
  if (input.demand === null) missingInputs.push('DEMAND');
  if (input.shifts.length === 0) missingInputs.push('SHIFTS');

  const eligibleStaff = input.staff
    .filter(isStaffEligible)
    .slice()
    .sort((a, b) => compareStringsLex(a.id, b.id));

  if (eligibleStaff.length === 0) missingInputs.push('ELIGIBLE_STAFF');
  if (!Number.isFinite(input.targetTxnsPerStaffHour) || input.targetTxnsPerStaffHour <= 0) {
    missingInputs.push('INVALID_N');
  }

  if (missingInputs.length > 0) {
    return {
      ok: false,
      result: {
        status: 'FAILED',
        reasonCode: 'MISSING_INPUT',
        missingInputs,
        message: `Cannot run Auto-schedule: missing or invalid inputs (${missingInputs.join(', ')}).`,
      },
    };
  }

  for (const s of input.staff) {
    if (!Number.isSafeInteger(s.maxWeeklyHours) || s.maxWeeklyHours < 0) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'UNEXPECTED_ERROR',
          message: `Invalid maxWeeklyHours for staff "${s.id}".`,
        },
      };
    }
  }

  return { ok: true, eligibleStaff };
}

/**
 * Converts the 7x16 transaction demand table into flat `requiredGrid` and `txnsGrid` Float64Arrays
 * using exact BigInt ceiling division (`computeRequiredStaff`), guarding against safe-integer overflow.
 */
export function buildRequiredGrids(
  input: AutoScheduleInput,
):
  | { ok: true; requiredGrid: Float64Array; txnsGrid: Float64Array; totalRequiredBigInt: bigint }
  | { ok: false; result: AutoScheduleResult } {
  const demand = input.demand!;
  const requiredGrid = new Float64Array(7 * 16);
  const txnsGrid = new Float64Array(7 * 16);
  let totalRequiredBigInt = 0n;

  for (const d of DAYS_OF_WEEK) {
    for (const h of OPERATING_HOURS) {
      const txns = demand.transactions[d][h];
      const reqRes = computeRequiredStaff(txns, input.targetTxnsPerStaffHour);
      if (!reqRes.ok) {
        return {
          ok: false,
          result: {
            status: 'FAILED',
            reasonCode: 'UNEXPECTED_ERROR',
            message:
              reqRes.error === 'SAFE_INTEGER_OVERFLOW'
                ? `SAFE_INTEGER_OVERFLOW: RequiredStaff overflowed at day ${d}, hour ${h}.`
                : `Invalid demand transaction or target N at day ${d}, hour ${h}.`,
          },
        };
      }

      const idx = d * 16 + (h - 7);
      requiredGrid[idx] = reqRes.value;
      txnsGrid[idx] = txns;
      totalRequiredBigInt += BigInt(reqRes.value);
      if (totalRequiredBigInt > MAX_SAFE_BIGINT) {
        return {
          ok: false,
          result: {
            status: 'FAILED',
            reasonCode: 'UNEXPECTED_ERROR',
            message:
              'SAFE_INTEGER_OVERFLOW: totalRequiredStaffHours exceeded Number.MAX_SAFE_INTEGER.',
          },
        };
      }
    }
  }

  return { ok: true, requiredGrid, txnsGrid, totalRequiredBigInt };
}

/**
 * Initializes the mutable typed-array `SchedulerWorkingState` with deterministically sorted shifts,
 * per-staff bitmasks, and pre-applied pinned assignments.
 */
export function initializeWorkingState(
  input: AutoScheduleInput,
  eligibleStaff: readonly Readonly<Staff>[],
  requiredGrid: Float64Array,
  txnsGrid: Float64Array,
): { state: SchedulerWorkingState; pinnedAssignments: Assignment[] } {
  const sortedShifts: Readonly<ShiftTemplate>[] = input.shifts.slice().sort((a, b) => {
    if (a.startHour !== b.startHour) return a.startHour - b.startHour;
    if (a.endHour !== b.endHour) return a.endHour - b.endHour;
    return compareStringsLex(a.id, b.id);
  });

  const shiftMap = new Map(sortedShifts.map((sh) => [sh.id, sh]));
  const shiftDayMask = new Uint8Array(sortedShifts.length);
  for (let sIdx = 0; sIdx < sortedShifts.length; sIdx++) {
    shiftDayMask[sIdx] = getShiftDayMask(sortedShifts[sIdx]!);
  }

  const eligibleCount = eligibleStaff.length;
  const staffIdxById = new Map<string, number>();
  const maxHours = new Float64Array(eligibleCount);
  const assignedHours = new Int32Array(eligibleCount);
  const dayOccupied = new Uint8Array(eligibleCount * 7);
  const unavailableMask = new Uint8Array(eligibleCount);

  for (let i = 0; i < eligibleCount; i++) {
    const s = eligibleStaff[i]!;
    staffIdxById.set(s.id, i);
    maxHours[i] = s.maxWeeklyHours;
    unavailableMask[i] = getStaffUnavailableMask(s);
  }

  const pinnedAssignments: Assignment[] = [];
  const staffHoursGrid = new Uint32Array(7 * 16);

  for (const a of input.existingAssignments) {
    if (!a.isPinned) continue;
    pinnedAssignments.push({
      id: a.id,
      day: a.day,
      shiftId: a.shiftId,
      staffId: a.staffId,
      isPinned: true,
    });

    const shift = shiftMap.get(a.shiftId);
    if (!shift) continue;
    const sIdx = staffIdxById.get(a.staffId);
    if (sIdx !== undefined) {
      dayOccupied[sIdx * 7 + a.day] = 1;
      assignedHours[sIdx] = assignedHours[sIdx]! + (shift.endHour - shift.startHour);
    }

    const dayOffset = a.day * 16;
    for (let h = shift.startHour; h < shift.endHour; h++) {
      const idx = dayOffset + (h - 7);
      staffHoursGrid[idx] = staffHoursGrid[idx]! + 1;
    }
  }

  const state: SchedulerWorkingState = {
    eligibleStaff,
    sortedShifts,
    requiredGrid,
    txnsGrid,
    staffHoursGrid,
    maxHours,
    assignedHours,
    dayOccupied,
    shiftDayMask,
    unavailableMask,
    sumU: 0,
    sumU2: 0,
    workingNew: [],
  };
  recomputeUtilizationSums(state);
  return { state, pinnedAssignments };
}

/**
 * Assigns unique IDs to all newly generated working assignments in `stableKey ASC` order
 * after Stage 2 completes, rejecting empty, throwing, or duplicate IDs.
 */
export function assignGeneratedIds(
  state: SchedulerWorkingState,
  pinnedAssignments: readonly Assignment[],
  idGenerator: () => string,
): { ok: true; generatedAssignments: Assignment[] } | { ok: false; result: AutoScheduleResult } {
  const seenIds = new Set(pinnedAssignments.map((p) => p.id));
  const generatedAssignments: Assignment[] = [];

  for (const w of state.workingNew) {
    let newId: string;
    try {
      newId = idGenerator();
    } catch (err) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: `idGenerator threw an error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    if (typeof newId !== 'string' || newId.trim().length === 0) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: 'idGenerator returned an empty or invalid ID.',
        },
      };
    }

    if (seenIds.has(newId)) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: `idGenerator produced a duplicate ID "${newId}".`,
        },
      };
    }

    seenIds.add(newId);
    generatedAssignments.push({
      id: newId,
      day: w.day,
      shiftId: w.shiftId,
      staffId: state.eligibleStaff[w.staffIdx]!.id,
      isPinned: false,
    });
  }

  return { ok: true, generatedAssignments };
}
