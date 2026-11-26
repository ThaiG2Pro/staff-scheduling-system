/**
 * @file Stage 2 of the Auto-Scheduler: Coverage-Preserving Fairness Rebalance (`runStage2Rebalance`).
 * Optimizes Jain's Fairness Index via O(1) delta evaluation for `REASSIGN` and `SWAP` moves
 * without altering the 112-cell `StaffHours` grid or pinned assignments.
 */

import {
  JAIN_TIE_EPS,
  MAX_REBALANCE_ITERATIONS,
  REBALANCE_IMPROVE_EPS,
} from './constants';
import {
  emitStage2MoveTrace,
  emitStage2StopTrace,
  prepareStage2MoveTrace,
} from './schedulerStage2Trace';
import {
  computeJainFromSums,
  recomputeUtilizationSums,
  type RebalanceMove,
  type SchedulerWorkingState,
} from './schedulerState';
import {
  computeTraceSummaryMetrics,
  type SchedulerTraceObserver,
  type TraceAssignmentSnapshot,
} from './schedulerTrace';
import type { RebalanceStopReason } from './types';

function findBestRebalanceMove(state: SchedulerWorkingState, currentJ: number): RebalanceMove | null {
  const {
    workingNew,
    eligibleStaff,
    assignedHours,
    maxHours,
    dayOccupied,
    unavailableMask,
    sumU,
    sumU2,
  } = state;
  const eligibleCount = eligibleStaff.length;
  const uLen = workingNew.length;

  let best: RebalanceMove | null = null;
  let bestDeltaJ = REBALANCE_IMPROVE_EPS;
  const invN = 1 / eligibleCount;

  // Precompute per-staff scalars and 7-day occupancy bitmasks once per iteration
  const invMax = new Float64Array(eligibleCount);
  const uCurr = new Float64Array(eligibleCount);
  const uCurrSq = new Float64Array(eligibleCount);
  const dayMask = new Uint8Array(eligibleCount);
  for (let s = 0; s < eligibleCount; s++) {
    const inv = 1 / maxHours[s]!;
    const u = assignedHours[s]! * inv;
    invMax[s] = inv;
    uCurr[s] = u;
    uCurrSq[s] = u * u;
    const base = s * 7;
    let mask = unavailableMask[s]!;
    for (let d = 0; d < 7; d++) {
      if (dayOccupied[base + d] !== 0) mask |= 1 << d;
    }
    dayMask[s] = mask;
  }

  // Flat typed arrays avoid object property dereferencing inside the O(uLen^2) SWAP loop
  const aDay = new Uint8Array(uLen);
  const aDur = new Uint8Array(uLen);
  const aStaff = new Int32Array(uLen);
  for (let i = 0; i < uLen; i++) {
    const a = workingNew[i]!;
    aDay[i] = a.day;
    aDur[i] = a.duration;
    aStaff[i] = a.staffIdx;
  }

  // 1) REASSIGN moves (scanned in stableKey ASC, staff.id ASC)
  for (let i = 0; i < uLen; i++) {
    const oldStaff = aStaff[i]!;
    const day = aDay[i]!;
    const dur = aDur[i]!;
    const dayBit = 1 << day;
    const oldH = assignedHours[oldStaff]!;
    const oldInvMax = invMax[oldStaff]!;

    const oldUBefore = uCurr[oldStaff]!;
    const oldUAfter = (oldH - dur) * oldInvMax;
    const baseSumU = sumU - oldUBefore + oldUAfter;
    const baseSumU2 = sumU2 - uCurrSq[oldStaff]! + oldUAfter * oldUAfter;

    for (let newStaff = 0; newStaff < eligibleCount; newStaff++) {
      if (newStaff === oldStaff || (dayMask[newStaff]! & dayBit) !== 0) continue;

      const newH = assignedHours[newStaff]!;
      const newMax = maxHours[newStaff]!;
      if (newH + dur > newMax) continue;

      const newUBefore = uCurr[newStaff]!;
      const newUAfter = (newH + dur) * invMax[newStaff]!;
      const candSumU = baseSumU - newUBefore + newUAfter;
      const candSumU2 = baseSumU2 - uCurrSq[newStaff]! + newUAfter * newUAfter;
      const candJ = candSumU2 <= 0 ? 1 : (candSumU * candSumU) * invN / candSumU2;
      const deltaJ = candJ - currentJ;

      if (deltaJ > bestDeltaJ && (best === null || deltaJ - best.deltaJ > JAIN_TIE_EPS)) {
        best = { moveType: 'REASSIGN', deltaJ, a1Idx: i, a2OrStaffIdx: newStaff };
        bestDeltaJ = deltaJ;
      }
    }
  }

  // 2) SWAP moves (different durations, different staff; scanned in stableKey ASC)
  for (let i = 0; i < uLen; i++) {
    const s1 = aStaff[i]!;
    const d1 = aDay[i]!;
    const l1 = aDur[i]!;
    const d1Bit = 1 << d1;
    const m1 = dayMask[s1]!;
    const h1 = assignedHours[s1]!;
    const max1 = maxHours[s1]!;
    const invMax1 = invMax[s1]!;
    const u1Before = uCurr[s1]!;
    const u1BeforeSq = uCurrSq[s1]!;
    const baseSumU1 = sumU - u1Before;
    const baseSumU2_1 = sumU2 - u1BeforeSq;

    for (let j = i + 1; j < uLen; j++) {
      const l2 = aDur[j]!;
      if (l1 === l2) continue;

      const s2 = aStaff[j]!;
      if (s1 === s2) continue;

      const d2 = aDay[j]!;
      if (d1 !== d2 && ((m1 & (1 << d2)) !== 0 || (dayMask[s2]! & d1Bit) !== 0)) {
        continue;
      }

      const h2 = assignedHours[s2]!;
      const max2 = maxHours[s2]!;
      const h1After = h1 - l1 + l2;
      const h2After = h2 - l2 + l1;
      if (h1After > max1 || h2After > max2) continue;

      const u1After = h1After * invMax1;
      const u2After = h2After * invMax[s2]!;
      const candSumU = baseSumU1 + u1After - uCurr[s2]! + u2After;
      const candSumU2 = baseSumU2_1 + u1After * u1After - uCurrSq[s2]! + u2After * u2After;
      const candJ = candSumU2 <= 0 ? 1 : (candSumU * candSumU) * invN / candSumU2;
      const deltaJ = candJ - currentJ;

      if (deltaJ > bestDeltaJ && (best === null || deltaJ - best.deltaJ > JAIN_TIE_EPS)) {
        best = { moveType: 'SWAP', deltaJ, a1Idx: i, a2OrStaffIdx: j };
        bestDeltaJ = deltaJ;
      }
    }
  }

  return best;
}

function applyRebalanceMove(state: SchedulerWorkingState, move: RebalanceMove): void {
  if (move.moveType === 'REASSIGN') {
    const a = state.workingNew[move.a1Idx]!;
    const oldStaff = a.staffIdx;
    const newStaff = move.a2OrStaffIdx;

    state.dayOccupied[oldStaff * 7 + a.day] = 0;
    state.assignedHours[oldStaff] = state.assignedHours[oldStaff]! - a.duration;
    state.dayOccupied[newStaff * 7 + a.day] = 1;
    state.assignedHours[newStaff] = state.assignedHours[newStaff]! + a.duration;
    a.staffIdx = newStaff;
  } else {
    const a1 = state.workingNew[move.a1Idx]!;
    const a2 = state.workingNew[move.a2OrStaffIdx]!;
    const s1 = a1.staffIdx;
    const s2 = a2.staffIdx;

    state.assignedHours[s1] = state.assignedHours[s1]! - a1.duration + a2.duration;
    state.assignedHours[s2] = state.assignedHours[s2]! - a2.duration + a1.duration;

    if (a1.day !== a2.day) {
      state.dayOccupied[s1 * 7 + a1.day] = 0;
      state.dayOccupied[s1 * 7 + a2.day] = 1;
      state.dayOccupied[s2 * 7 + a2.day] = 0;
      state.dayOccupied[s2 * 7 + a1.day] = 1;
    }

    a1.staffIdx = s2;
    a2.staffIdx = s1;
  }

  recomputeUtilizationSums(state);
}

/**
 * Runs Stage 2 Coverage-Preserving Fairness Rebalance using O(1) delta evaluation
 * for `REASSIGN` and `SWAP` moves (capped at `MAX_REBALANCE_ITERATIONS = 200`).
 *
 * @param state - Working state after Stage 1 sorted by `stableKey ASC`.
 * @param observer - Optional trace observer for step-by-step simulation (zero overhead when omitted).
 * @param pinnedSnapshots - Precomputed trace snapshots for pinned assignments.
 * @returns Number of iterations executed and the deterministic stop reason.
 */
export function runStage2Rebalance(
  state: SchedulerWorkingState,
  observer?: SchedulerTraceObserver,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[] = [],
): {
  rebalanceIterationsRun: number;
  rebalanceStopReason: RebalanceStopReason;
} {
  if (state.eligibleStaff.length <= 1 || state.workingNew.length === 0) {
    if (observer) {
      emitStage2StopTrace(observer, state, 'SKIPPED', 0, pinnedSnapshots);
    }
    return { rebalanceIterationsRun: 0, rebalanceStopReason: 'SKIPPED' };
  }

  let prevMetrics = observer ? computeTraceSummaryMetrics(state) : undefined;
  let rebalanceIterationsRun = 0;

  for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
    const currentJ = computeJainFromSums(state.sumU, state.sumU2, state.eligibleStaff.length);
    const move = findBestRebalanceMove(state, currentJ);
    if (!move) {
      if (observer) {
        emitStage2StopTrace(
          observer,
          state,
          'CONVERGED',
          rebalanceIterationsRun,
          pinnedSnapshots,
          prevMetrics,
        );
      }
      return { rebalanceIterationsRun, rebalanceStopReason: 'CONVERGED' };
    }

    const prepared = observer
      ? prepareStage2MoveTrace(state, move, iter, currentJ, prevMetrics?.coveragePct)
      : undefined;

    applyRebalanceMove(state, move);
    rebalanceIterationsRun += 1;

    if (observer && prepared) {
      prevMetrics = emitStage2MoveTrace(
        observer,
        state,
        move,
        currentJ,
        prepared,
        pinnedSnapshots,
        prevMetrics,
      );
    }
  }

  if (observer) {
    emitStage2StopTrace(
      observer,
      state,
      'MAX_ITERATIONS_REACHED',
      rebalanceIterationsRun,
      pinnedSnapshots,
      prevMetrics,
    );
  }

  return { rebalanceIterationsRun, rebalanceStopReason: 'MAX_ITERATIONS_REACHED' };
}
