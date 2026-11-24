/**
 * @file Auto-Scheduler diagnostics builder (`buildAutoScheduleDiagnostics`).
 * Computes BigInt-guarded coverage, shortage split (`uncoverable` vs `residual`),
 * `unusedCapacityHours`, and concise E-04 `summaryMessages`.
 */

import { MAX_SAFE_BIGINT } from './constants';
import { computeJainFromSums, type SchedulerWorkingState } from './schedulerState';
import type { AutoScheduleDiagnostics, RebalanceStopReason } from './types';

function buildSummaryMessages(
  totalRequiredStaffHours: number,
  shortageHours: number,
  uncoverableRequiredStaffHours: number,
  residualCoverableShortageHours: number,
  overstaffedHours: number,
  unusedCapacityHours: number,
  unscheduledEligibleStaffCount: number,
): string[] {
  const messages: string[] = [];

  if (totalRequiredStaffHours === 0) {
    messages.push(
      'Weekly transaction demand is 0 across all hours; no new shifts were generated (pinned shifts preserved).',
    );
    return messages;
  }

  if (shortageHours === 0) {
    messages.push('100% of projected staffing demand is covered.');
    if (unusedCapacityHours > 0) {
      messages.push(`${unusedCapacityHours} staff-hours of team weekly capacity remain unused.`);
    }
    if (overstaffedHours > 0) {
      messages.push(
        `${overstaffedHours} overstaffed staff-hours occurred due to fixed shift lengths.`,
      );
    }
    if (unscheduledEligibleStaffCount > 0) {
      messages.push(
        `${unscheduledEligibleStaffCount} eligible staff member(s) were not scheduled because demand was already fully met without adding unnecessary shifts.`,
      );
    }
    return messages;
  }

  if (uncoverableRequiredStaffHours > 0) {
    messages.push(
      `${uncoverableRequiredStaffHours} required staff-hours fall outside all configured Shift Templates. Add a Shift Template covering those hours.`,
    );
  }
  if (residualCoverableShortageHours > 0) {
    messages.push(
      `${residualCoverableShortageHours} coverable required staff-hours remain unfilled under current staff capacity, shift templates, and constraints. Consider adding staff, adjusting weekly hour limits, or adding shorter overlapping peak shifts.`,
    );
  }

  return messages;
}

/**
 * Builds `AutoScheduleDiagnostics` with BigInt overflow guards on all aggregate metrics
 * and concise actionable `summaryMessages` for the workspace banner (E-04).
 *
 * @param params - Solver working state, required-hours total, and rebalance run metadata.
 * @returns `{ ok: true, diagnostics }` or `{ ok: false, message }` on `SAFE_INTEGER_OVERFLOW`.
 */
export function buildAutoScheduleDiagnostics(params: {
  state: SchedulerWorkingState;
  totalRequiredBigInt: bigint;
  preservedPinnedCount: number;
  generatedAssignmentsCount: number;
  rebalanceIterationsRun: number;
  rebalanceStopReason: RebalanceStopReason;
}): { ok: true; diagnostics: AutoScheduleDiagnostics } | { ok: false; message: string } {
  const {
    state,
    totalRequiredBigInt,
    preservedPinnedCount,
    generatedAssignmentsCount,
    rebalanceIterationsRun,
    rebalanceStopReason,
  } = params;

  const hourCoverable = new Uint8Array(16);
  for (const sh of state.sortedShifts) {
    for (let h = sh.startHour; h < sh.endHour; h++) {
      if (h >= 7 && h <= 22) hourCoverable[h - 7] = 1;
    }
  }

  let coveredBigInt = 0n;
  let shortageBigInt = 0n;
  let uncoverableBigInt = 0n;
  let overstaffedBigInt = 0n;

  for (let d = 0; d < 7; d++) {
    for (let hIdx = 0; hIdx < 16; hIdx++) {
      const idx = d * 16 + hIdx;
      const reqBig = BigInt(state.requiredGrid[idx]!);
      const curBig = BigInt(state.staffHoursGrid[idx]!);

      coveredBigInt += curBig < reqBig ? curBig : reqBig;
      if (reqBig > curBig) shortageBigInt += reqBig - curBig;
      else if (curBig > reqBig) overstaffedBigInt += curBig - reqBig;
      if (hourCoverable[hIdx] === 0) uncoverableBigInt += reqBig;

      if (
        coveredBigInt > MAX_SAFE_BIGINT ||
        shortageBigInt > MAX_SAFE_BIGINT ||
        overstaffedBigInt > MAX_SAFE_BIGINT ||
        uncoverableBigInt > MAX_SAFE_BIGINT
      ) {
        return {
          ok: false,
          message:
            'SAFE_INTEGER_OVERFLOW: Diagnostic coverage metrics exceeded Number.MAX_SAFE_INTEGER.',
        };
      }
    }
  }

  let unusedCapacityBigInt = 0n;
  let unscheduledEligibleStaffCount = 0;
  for (let i = 0; i < state.eligibleStaff.length; i++) {
    const assigned = state.assignedHours[i]!;
    const maxH = state.maxHours[i]!;
    if (assigned === 0) unscheduledEligibleStaffCount += 1;

    unusedCapacityBigInt += BigInt(Math.max(0, maxH - assigned));
    if (unusedCapacityBigInt > MAX_SAFE_BIGINT) {
      return {
        ok: false,
        message: 'SAFE_INTEGER_OVERFLOW: unusedCapacityHours exceeded Number.MAX_SAFE_INTEGER.',
      };
    }
  }

  const totalRequiredStaffHours = Number(totalRequiredBigInt);
  const coveredRequiredStaffHours = Number(coveredBigInt);
  const shortageHours = Number(shortageBigInt);
  const uncoverableRequiredStaffHours = Number(uncoverableBigInt);
  const residualCoverableShortageHours = shortageHours - uncoverableRequiredStaffHours;
  const overstaffedHours = Number(overstaffedBigInt);
  const unusedCapacityHours = Number(unusedCapacityBigInt);

  const summaryMessages = buildSummaryMessages(
    totalRequiredStaffHours,
    shortageHours,
    uncoverableRequiredStaffHours,
    residualCoverableShortageHours,
    overstaffedHours,
    unusedCapacityHours,
    unscheduledEligibleStaffCount,
  );

  return {
    ok: true,
    diagnostics: {
      preservedPinnedCount,
      generatedAssignmentsCount,
      totalRequiredStaffHours,
      coveredRequiredStaffHours,
      demandCoverage:
        totalRequiredStaffHours === 0 ? null : coveredRequiredStaffHours / totalRequiredStaffHours,
      shortageHours,
      uncoverableRequiredStaffHours,
      residualCoverableShortageHours,
      overstaffedHours,
      unusedCapacityHours,
      unscheduledEligibleStaffCount,
      fairnessJainIndex:
        state.sumU === 0
          ? null
          : computeJainFromSums(state.sumU, state.sumU2, state.eligibleStaff.length),
      rebalanceIterationsRun,
      rebalanceStopReason,
      summaryMessages,
    },
  };
}
