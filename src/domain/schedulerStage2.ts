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
  computeJainFromSums,
  recomputeUtilizationSums,
  type SchedulerWorkingState,
} from './schedulerState';
import type { RebalanceStopReason } from './types';

interface RebalanceMove {
  moveType: 'REASSIGN' | 'SWAP';
  deltaJ: number;
  a1Idx: number;
  a2OrStaffIdx: number;
}

function findBestRebalanceMove(state: SchedulerWorkingState, currentJ: number): RebalanceMove | null {
  const { workingNew, eligibleStaff, assignedHours, maxHours, dayOccupied, sumU, sumU2 } = state;
  const eligibleCount = eligibleStaff.length;
  const uLen = workingNew.length;

  let best: RebalanceMove | null = null;

  // 1) REASSIGN moves (scanned in stableKey ASC, staff.id ASC)
  for (let i = 0; i < uLen; i++) {
    const a = workingNew[i]!;
    const oldStaff = a.staffIdx;
    const oldH = assignedHours[oldStaff]!;
    const oldMax = maxHours[oldStaff]!;
    const dur = a.duration;

    const oldUBefore = oldH / oldMax;
    const oldUAfter = (oldH - dur) / oldMax;
    const baseSumU = sumU - oldUBefore + oldUAfter;
    const baseSumU2 = sumU2 - oldUBefore * oldUBefore + oldUAfter * oldUAfter;

    for (let newStaff = 0; newStaff < eligibleCount; newStaff++) {
      if (newStaff === oldStaff || dayOccupied[newStaff * 7 + a.day] !== 0) continue;

      const newH = assignedHours[newStaff]!;
      const newMax = maxHours[newStaff]!;
      if (newH + dur > newMax) continue;

      const newUBefore = newH / newMax;
      const newUAfter = (newH + dur) / newMax;
      const candJ = computeJainFromSums(
        baseSumU - newUBefore + newUAfter,
        baseSumU2 - newUBefore * newUBefore + newUAfter * newUAfter,
        eligibleCount,
      );
      const deltaJ = candJ - currentJ;

      if (deltaJ > REBALANCE_IMPROVE_EPS && (best === null || deltaJ - best.deltaJ > JAIN_TIE_EPS)) {
        best = { moveType: 'REASSIGN', deltaJ, a1Idx: i, a2OrStaffIdx: newStaff };
      }
    }
  }

  // 2) SWAP moves (different durations, different staff; scanned in stableKey ASC)
  for (let i = 0; i < uLen; i++) {
    const a1 = workingNew[i]!;
    const s1 = a1.staffIdx;
    const l1 = a1.duration;
    const h1 = assignedHours[s1]!;
    const max1 = maxHours[s1]!;
    const u1Before = h1 / max1;

    for (let j = i + 1; j < uLen; j++) {
      const a2 = workingNew[j]!;
      const l2 = a2.duration;
      if (l1 === l2) continue;

      const s2 = a2.staffIdx;
      if (s1 === s2) continue;
      if (a1.day !== a2.day && (dayOccupied[s1 * 7 + a2.day] !== 0 || dayOccupied[s2 * 7 + a1.day] !== 0)) {
        continue;
      }

      const h2 = assignedHours[s2]!;
      const max2 = maxHours[s2]!;
      const h1After = h1 - l1 + l2;
      const h2After = h2 - l2 + l1;
      if (h1After > max1 || h2After > max2) continue;

      const u1After = h1After / max1;
      const u2Before = h2 / max2;
      const u2After = h2After / max2;

      const candJ = computeJainFromSums(
        sumU - u1Before + u1After - u2Before + u2After,
        sumU2 - u1Before * u1Before + u1After * u1After - u2Before * u2Before + u2After * u2After,
        eligibleCount,
      );
      const deltaJ = candJ - currentJ;

      if (deltaJ > REBALANCE_IMPROVE_EPS && (best === null || deltaJ - best.deltaJ > JAIN_TIE_EPS)) {
        best = { moveType: 'SWAP', deltaJ, a1Idx: i, a2OrStaffIdx: j };
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
 * @returns Number of iterations executed and the deterministic stop reason.
 */
export function runStage2Rebalance(state: SchedulerWorkingState): {
  rebalanceIterationsRun: number;
  rebalanceStopReason: RebalanceStopReason;
} {
  if (state.eligibleStaff.length <= 1 || state.workingNew.length === 0) {
    return { rebalanceIterationsRun: 0, rebalanceStopReason: 'SKIPPED' };
  }

  let rebalanceIterationsRun = 0;
  for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
    const currentJ = computeJainFromSums(state.sumU, state.sumU2, state.eligibleStaff.length);
    const move = findBestRebalanceMove(state, currentJ);
    if (!move) {
      return { rebalanceIterationsRun, rebalanceStopReason: 'CONVERGED' };
    }
    applyRebalanceMove(state, move);
    rebalanceIterationsRun += 1;
  }

  return { rebalanceIterationsRun, rebalanceStopReason: 'MAX_ITERATIONS_REACHED' };
}
