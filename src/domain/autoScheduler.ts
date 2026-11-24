/**
 * @file Public entry point for the Deterministic Two-Stage Auto-Scheduler (`runAutoSchedule`).
 * Orchestrates input readiness, Pin Conflict Gate, Stage 1 coverage, Stage 2 rebalance,
 * post-Stage-2 ID assignment, independent candidate validation, and diagnostics.
 */

import { DAYS_OF_WEEK, MAX_SAFE_BIGINT, OPERATING_HOURS } from './constants';
import { checkPinConflicts, validateCandidateAssignments } from './constraints';
import { computeRequiredStaff } from './decimalMath';
import { buildAutoScheduleDiagnostics } from './schedulerDiagnostics';
import { runStage1Coverage } from './schedulerStage1';
import { runStage2Rebalance } from './schedulerStage2';
import {
  compareStringsLex,
  compareWorkingStableKey,
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

function validateInputReadiness(
  input: AutoScheduleInput,
): { ok: true; eligibleStaff: Readonly<Staff>[] } | { ok: false; result: AutoScheduleResult } {
  const missingInputs: MissingInputCode[] = [];
  if (input.demand === null) missingInputs.push('DEMAND');
  if (input.shifts.length === 0) missingInputs.push('SHIFTS');

  const eligibleStaff = input.staff
    .filter((s) => s.maxWeeklyHours > 0)
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

function buildRequiredGrids(
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
            message: 'SAFE_INTEGER_OVERFLOW: totalRequiredStaffHours exceeded Number.MAX_SAFE_INTEGER.',
          },
        };
      }
    }
  }

  return { ok: true, requiredGrid, txnsGrid, totalRequiredBigInt };
}

function initializeWorkingState(
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
  const eligibleCount = eligibleStaff.length;
  const staffIdxById = new Map<string, number>();
  const maxHours = new Float64Array(eligibleCount);
  const assignedHours = new Int32Array(eligibleCount);
  const dayOccupied = new Uint8Array(eligibleCount * 7);

  for (let i = 0; i < eligibleCount; i++) {
    const s = eligibleStaff[i]!;
    staffIdxById.set(s.id, i);
    maxHours[i] = s.maxWeeklyHours;
  }

  const pinnedAssignments: Assignment[] = [];
  const staffHoursGrid = new Uint32Array(7 * 16);

  for (const a of input.existingAssignments) {
    if (!a.isPinned) continue;
    pinnedAssignments.push({ id: a.id, day: a.day, shiftId: a.shiftId, staffId: a.staffId, isPinned: true });

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
    sumU: 0,
    sumU2: 0,
    workingNew: [],
  };
  recomputeUtilizationSums(state);
  return { state, pinnedAssignments };
}

function assignGeneratedIds(
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

/**
 * Deterministic Two-Stage Auto-Scheduler (`Optimization Spec §4`, `Technical Design §4`).
 * Pure function: never mutates `input`; preserves all pinned assignments verbatim;
 * calls `idGenerator` only after Stage 2 completes; runs independent candidate validation
 * before returning `SUCCESS`.
 *
 * @param input - Deep-readonly snapshot of demand, staff, shifts, existing assignments, N, and `idGenerator`.
 * @returns `SUCCESS` (with full candidate assignments & diagnostics), `BLOCKED_PIN_CONFLICT`, or `FAILED`.
 */
export function runAutoSchedule(input: AutoScheduleInput): AutoScheduleResult {
  // 1. Input Readiness Gate (E-02)
  const readiness = validateInputReadiness(input);
  if (!readiness.ok) return readiness.result;

  // 2. Pin Conflict Gate (E-03, F-07)
  const conflicts = checkPinConflicts(input);
  if (conflicts.length > 0) {
    return { status: 'BLOCKED_PIN_CONFLICT', conflicts };
  }

  // 3. Build RequiredStaff & Transactions grids (BigInt exact ceiling)
  const grids = buildRequiredGrids(input);
  if (!grids.ok) return grids.result;

  // 4. Stage 1: Greedy Coverage Construction (Gaps -> Deficit)
  const { state, pinnedAssignments } = initializeWorkingState(
    input,
    readiness.eligibleStaff,
    grids.requiredGrid,
    grids.txnsGrid,
  );
  runStage1Coverage(state);

  const stage1StaffHoursGrid = new Uint32Array(state.staffHoursGrid);
  state.workingNew.sort(compareWorkingStableKey);
  recomputeUtilizationSums(state);

  // 5. Stage 2: Coverage-Preserving Fairness Rebalance (O(1) Delta)
  const { rebalanceIterationsRun, rebalanceStopReason } = runStage2Rebalance(state);

  // 6. Assign generated IDs in stableKey ASC + Independent Candidate Validation
  const idRes = assignGeneratedIds(state, pinnedAssignments, input.idGenerator);
  if (!idRes.ok) return idRes.result;

  const candidateAssignments: Assignment[] = [...pinnedAssignments, ...idRes.generatedAssignments];
  const validation = validateCandidateAssignments(candidateAssignments, input, stage1StaffHoursGrid);
  if (!validation.ok) {
    return { status: 'FAILED', reasonCode: 'CANDIDATE_VALIDATION_FAILED', message: validation.message };
  }

  // 7. Build UI-friendly Diagnostics
  const diagRes = buildAutoScheduleDiagnostics({
    state,
    totalRequiredBigInt: grids.totalRequiredBigInt,
    preservedPinnedCount: pinnedAssignments.length,
    generatedAssignmentsCount: idRes.generatedAssignments.length,
    rebalanceIterationsRun,
    rebalanceStopReason,
  });
  if (!diagRes.ok) {
    return { status: 'FAILED', reasonCode: 'UNEXPECTED_ERROR', message: diagRes.message };
  }

  return { status: 'SUCCESS', assignments: candidateAssignments, diagnostics: diagRes.diagnostics };
}
