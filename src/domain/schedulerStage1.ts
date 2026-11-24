/**
 * @file Stage 1 of the Auto-Scheduler: Greedy Coverage Construction (`runStage1Coverage`).
 * Eliminates Staffing Gaps (Step 1A) then fills marginal hourly deficits (Step 1B)
 * using Best-Fit staff selection, Jain Index tie-breaking, and incremental TypedArrays.
 */

import { DAYS_OF_WEEK, FLOAT_TIE_EPS, JAIN_TIE_EPS } from './constants';
import { getShiftDuration } from './hardRules';
import { computeJainFromSums, type SchedulerWorkingState } from './schedulerState';
import type { DayOfWeek } from './types';

/** Selects best eligible staff for `(day, duration)` by Best-Fit slack, then Jain Index, then `staff.id`. */
function pickBestFitStaff(
  state: SchedulerWorkingState,
  day: DayOfWeek,
  duration: number,
): number {
  const eligibleCount = state.eligibleStaff.length;
  let bestIdx = -1;
  let bestSlack = Number.POSITIVE_INFINITY;
  let bestJain = -1;

  for (let i = 0; i < eligibleCount; i++) {
    if (state.dayOccupied[i * 7 + day] !== 0) continue;
    const currH = state.assignedHours[i]!;
    const maxH = state.maxHours[i]!;
    const nextH = currH + duration;
    if (nextH > maxH) continue;

    const slack = maxH - nextH;
    const oldU = currH / maxH;
    const newU = nextH / maxH;
    const hypJain = computeJainFromSums(
      state.sumU - oldU + newU,
      state.sumU2 - oldU * oldU + newU * newU,
      eligibleCount,
    );

    if (
      bestIdx === -1 ||
      slack < bestSlack ||
      (slack === bestSlack && hypJain - bestJain > JAIN_TIE_EPS)
    ) {
      bestIdx = i;
      bestSlack = slack;
      bestJain = hypJain;
    }
  }

  return bestIdx;
}

function recordWorkingAssignment(
  state: SchedulerWorkingState,
  day: DayOfWeek,
  shiftIdx: number,
  staffIdx: number,
  stableOrdinal: number,
): void {
  const shift = state.sortedShifts[shiftIdx]!;
  const duration = getShiftDuration(shift);
  const staff = state.eligibleStaff[staffIdx]!;

  const oldH = state.assignedHours[staffIdx]!;
  const maxH = state.maxHours[staffIdx]!;
  const newH = oldH + duration;
  const oldU = oldH / maxH;
  const newU = newH / maxH;

  state.assignedHours[staffIdx] = newH;
  state.dayOccupied[staffIdx * 7 + day] = 1;
  state.sumU = state.sumU - oldU + newU;
  state.sumU2 = state.sumU2 - oldU * oldU + newU * newU;

  const dayOffset = day * 16;
  for (let h = shift.startHour; h < shift.endHour; h++) {
    const idx = dayOffset + (h - 7);
    state.staffHoursGrid[idx] = state.staffHoursGrid[idx]! + 1;
  }

  state.workingNew.push({
    day,
    shiftId: shift.id,
    shiftIdx,
    startHour: shift.startHour,
    endHour: shift.endHour,
    duration,
    initialStaffId: staff.id,
    stableOrdinal,
    staffIdx,
  });
}

/**
 * Runs Stage 1 Greedy Coverage Construction:
 * - Step 1A: Eliminates zero-staffing gaps (`deltaGaps > 0`).
 * - Step 1B: Fills remaining hourly marginal deficit (`deltaCov > 0`) by shift efficiency.
 *
 * @param state - Mutable working state initialized with pinned assignments.
 */
export function runStage1Coverage(state: SchedulerWorkingState): void {
  let stableOrdinal = 0;

  // Step 1A: Eliminate Staffing Gaps (deltaGaps > 0)
  while (true) {
    let bestDay: DayOfWeek = 0;
    let bestShiftIdx = -1;
    let bestStaffIdx = -1;
    let bestDeltaGaps = 0;
    let bestEfficiency = -1;
    let bestPressure = -1;

    for (const d of DAYS_OF_WEEK) {
      const dayOffset = d * 16;
      for (let sIdx = 0; sIdx < state.sortedShifts.length; sIdx++) {
        const shift = state.sortedShifts[sIdx]!;
        const duration = getShiftDuration(shift);

        let deltaGaps = 0;
        let deltaCov = 0;
        let pressure = 0;

        for (let h = shift.startHour; h < shift.endHour; h++) {
          const idx = dayOffset + (h - 7);
          const req = state.requiredGrid[idx]!;
          const cur = state.staffHoursGrid[idx]!;
          if (req > 0 && cur === 0) deltaGaps += 1;
          if (req > cur) {
            deltaCov += 1;
            pressure += state.txnsGrid[idx]! / Math.max(1, cur);
          }
        }

        if (deltaGaps === 0) continue;
        const chosenStaff = pickBestFitStaff(state, d, duration);
        if (chosenStaff === -1) continue;

        const efficiency = deltaCov / duration;
        const isBetter =
          bestShiftIdx === -1 ||
          (deltaGaps !== bestDeltaGaps
            ? deltaGaps > bestDeltaGaps
            : Math.abs(efficiency - bestEfficiency) > FLOAT_TIE_EPS
              ? efficiency > bestEfficiency
              : Math.abs(pressure - bestPressure) > FLOAT_TIE_EPS && pressure > bestPressure);

        if (isBetter) {
          bestDay = d;
          bestShiftIdx = sIdx;
          bestStaffIdx = chosenStaff;
          bestDeltaGaps = deltaGaps;
          bestEfficiency = efficiency;
          bestPressure = pressure;
        }
      }
    }

    if (bestShiftIdx === -1) break;
    recordWorkingAssignment(state, bestDay, bestShiftIdx, bestStaffIdx, stableOrdinal++);
  }

  // Step 1B: Fill Remaining Deficit (deltaCov > 0)
  while (true) {
    let bestDay: DayOfWeek = 0;
    let bestShiftIdx = -1;
    let bestStaffIdx = -1;
    let bestEfficiency = -1;
    let bestDeltaCov = 0;
    let bestPressure = -1;

    for (const d of DAYS_OF_WEEK) {
      const dayOffset = d * 16;
      for (let sIdx = 0; sIdx < state.sortedShifts.length; sIdx++) {
        const shift = state.sortedShifts[sIdx]!;
        const duration = getShiftDuration(shift);

        let deltaCov = 0;
        let pressure = 0;

        for (let h = shift.startHour; h < shift.endHour; h++) {
          const idx = dayOffset + (h - 7);
          const req = state.requiredGrid[idx]!;
          const cur = state.staffHoursGrid[idx]!;
          if (req > cur) {
            deltaCov += 1;
            pressure += state.txnsGrid[idx]! / Math.max(1, cur);
          }
        }

        if (deltaCov === 0) continue;
        const chosenStaff = pickBestFitStaff(state, d, duration);
        if (chosenStaff === -1) continue;

        const efficiency = deltaCov / duration;
        const isBetter =
          bestShiftIdx === -1 ||
          (Math.abs(efficiency - bestEfficiency) > FLOAT_TIE_EPS
            ? efficiency > bestEfficiency
            : deltaCov !== bestDeltaCov
              ? deltaCov > bestDeltaCov
              : Math.abs(pressure - bestPressure) > FLOAT_TIE_EPS && pressure > bestPressure);

        if (isBetter) {
          bestDay = d;
          bestShiftIdx = sIdx;
          bestStaffIdx = chosenStaff;
          bestEfficiency = efficiency;
          bestDeltaCov = deltaCov;
          bestPressure = pressure;
        }
      }
    }

    if (bestShiftIdx === -1) break;
    recordWorkingAssignment(state, bestDay, bestShiftIdx, bestStaffIdx, stableOrdinal++);
  }
}
