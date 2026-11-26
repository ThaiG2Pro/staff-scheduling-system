/**
 * @file Public entry point for the Deterministic Two-Stage Auto-Scheduler (`runAutoSchedule`).
 * Orchestrates input readiness, Pin Conflict Gate, Stage 1 coverage, Stage 2 rebalance,
 * post-Stage-2 ID assignment, independent candidate validation, and diagnostics.
 */

import { checkPinConflicts, validateCandidateAssignments } from './constraints';
import { buildAutoScheduleDiagnostics } from './schedulerDiagnostics';
import {
  buildPinnedSnapshots,
  emitIdErrorTrace,
  emitInputReadinessTrace,
  emitOutputTrace,
  emitPinConflictTrace,
  emitRequiredGridsTrace,
  emitStateInitTrace,
  emitValidationTrace,
} from './schedulerPipelineTrace';
import {
  assignGeneratedIds,
  buildRequiredGrids,
  initializeWorkingState,
  validateInputReadiness,
} from './schedulerSetup';
import { runStage1Coverage } from './schedulerStage1';
import { runStage2Rebalance } from './schedulerStage2';
import { compareWorkingStableKey, recomputeUtilizationSums } from './schedulerState';
import type { AutoScheduleOptions, TraceAssignmentSnapshot } from './schedulerTrace';
import type { Assignment, AutoScheduleInput, AutoScheduleResult } from './types';

/**
 * Deterministic Two-Stage Auto-Scheduler (`Optimization Spec §4`, `Technical Design §4`).
 * Pure function: never mutates `input`; preserves all pinned assignments verbatim;
 * calls `idGenerator` only after Stage 2 completes; runs independent candidate validation
 * before returning `SUCCESS`.
 *
 * @param input - Deep-readonly snapshot of demand, staff, shifts, existing assignments, N, and `idGenerator`.
 * @param options - Optional execution hooks (e.g., `observer` for step-by-step simulation; zero overhead when omitted).
 * @returns `SUCCESS` (with full candidate assignments & diagnostics), `BLOCKED_PIN_CONFLICT`, or `FAILED`.
 */
export function runAutoSchedule(
  input: AutoScheduleInput,
  options?: AutoScheduleOptions,
): AutoScheduleResult {
  const observer = options?.observer;

  // 1. Input Readiness Gate (E-02)
  const readiness = validateInputReadiness(input);
  if (observer) emitInputReadinessTrace(observer, input, readiness);
  if (!readiness.ok) return readiness.result;

  // 2. Pin Conflict Gate (E-03, F-07)
  const conflicts = checkPinConflicts(input);
  if (observer) emitPinConflictTrace(observer, input, conflicts);
  if (conflicts.length > 0) {
    return { status: 'BLOCKED_PIN_CONFLICT', conflicts };
  }

  // 3. Build RequiredStaff & Transactions grids (BigInt exact ceiling)
  const grids = buildRequiredGrids(input);
  if (observer) emitRequiredGridsTrace(observer, input, grids);
  if (!grids.ok) return grids.result;

  // 4. Stage 1: Greedy Coverage Construction (Gaps -> Deficit)
  const { state, pinnedAssignments } = initializeWorkingState(
    input,
    readiness.eligibleStaff,
    grids.requiredGrid,
    grids.txnsGrid,
  );

  let pinnedSnapshots: TraceAssignmentSnapshot[] = [];
  if (observer) {
    pinnedSnapshots = buildPinnedSnapshots(input, pinnedAssignments);
    emitStateInitTrace(observer, state, pinnedAssignments, pinnedSnapshots);
  }

  runStage1Coverage(state, observer, pinnedSnapshots);

  const stage1StaffHoursGrid = new Uint32Array(state.staffHoursGrid);
  state.workingNew.sort(compareWorkingStableKey);
  recomputeUtilizationSums(state);

  // 5. Stage 2: Coverage-Preserving Fairness Rebalance (O(1) Delta)
  const { rebalanceIterationsRun, rebalanceStopReason } = runStage2Rebalance(
    state,
    observer,
    pinnedSnapshots,
  );

  // 6. Assign generated IDs in stableKey ASC + Independent Candidate Validation
  const idRes = assignGeneratedIds(state, pinnedAssignments, input.idGenerator);
  if (!idRes.ok) {
    if (observer) emitIdErrorTrace(observer, idRes.result);
    return idRes.result;
  }

  const candidateAssignments: Assignment[] = [...pinnedAssignments, ...idRes.generatedAssignments];
  const validation = validateCandidateAssignments(candidateAssignments, input, stage1StaffHoursGrid);
  if (observer) {
    emitValidationTrace(
      observer,
      state,
      pinnedAssignments.length,
      idRes.generatedAssignments.length,
      pinnedSnapshots,
      validation,
    );
  }
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

  if (observer) {
    emitOutputTrace(
      observer,
      state,
      candidateAssignments.length,
      idRes.generatedAssignments.length,
      pinnedAssignments.length,
      rebalanceIterationsRun,
      rebalanceStopReason,
      pinnedSnapshots,
      diagRes.diagnostics,
    );
  }

  return { status: 'SUCCESS', assignments: candidateAssignments, diagnostics: diagRes.diagnostics };
}
