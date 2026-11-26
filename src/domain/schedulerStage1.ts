/**
 * @file Stage 1 of the Auto-Scheduler: Greedy Coverage Construction (`runStage1Coverage`).
 * Eliminates Staffing Gaps (Step 1A) then fills marginal hourly deficits (Step 1B)
 * using Best-Fit staff selection, Jain Index tie-breaking, and incremental TypedArrays.
 */

import { DAYS_OF_WEEK, FLOAT_TIE_EPS, JAIN_TIE_EPS } from './constants';
import { getShiftDuration } from './hardRules';
import { computeJainFromSums, type SchedulerWorkingState } from './schedulerState';
import {
  computeTraceSummaryMetrics,
  formatTraceDay,
  formatTraceShift,
  snapshotTraceAssignments,
  snapshotTraceEntities,
  snapshotTraceGrid,
  type SchedulerTraceObserver,
  type TraceAssignmentSnapshot,
  type TraceCandidateRow,
  type TraceRuleHint,
} from './schedulerTrace';

const STAGE_1A_RULE_HINT: TraceRuleHint = {
  title: 'Thứ tự ưu tiên Stage 1A (Lấp lỗ hổng)',
  rules: [
    'Chọn ca: (1) Nhiều ô trống người nhất (deltaGaps) → (2) Hiệu suất phủ cao nhất (efficiency) → (3) Áp lực giao dịch cao nhất (pressure).',
    'Chọn người: Ít ngày khả dụng nhất (MRV — giữ người linh hoạt cho ngày khan hiếm) → Best-Fit (ít giờ dư nhất) → Jain Index → ID.',
  ],
};

const STAGE_1B_RULE_HINT: TraceRuleHint = {
  title: 'Thứ tự ưu tiên Stage 1B (Bù giờ thiếu)',
  rules: [
    'Chọn ca: (1) Hiệu suất phủ cao nhất (efficiency) → (2) Bù nhiều giờ thiếu nhất (deltaCov) → (3) Áp lực khách cao nhất (pressure).',
    'Chọn người: Ít ngày khả dụng nhất (MRV) → Best-Fit (đóng gói khít quỹ giờ) → Jain Index → ID. Việc san đều sẽ thực hiện ở Stage 2.',
  ],
};
import type { DayOfWeek } from './types';

/** Counts available days (0-bits in the 7-bit `unavailableMask`) in O(1). */
function countAvailableDays7(unavailableMask: number): number {
  let x = ~unavailableMask & 0x7f;
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

/**
 * Selects best eligible staff for `(day, duration)` by:
 * 1. Fewest configured available days (MRV — preserves flexible staff for scarce days),
 * 2. Best-Fit slack (`maxH - nextH`),
 * 3. Higher hypothetical Jain Index,
 * 4. `staff.id` ASC (iteration order).
 * When all staff have 7 available days (MVP baseline), criterion (1) ties identically.
 */
function pickBestFitStaff(
  state: SchedulerWorkingState,
  day: DayOfWeek,
  duration: number,
): number {
  const eligibleCount = state.eligibleStaff.length;
  const dayBit = 1 << day;
  let bestIdx = -1;
  let bestAvailDays = 8;
  let bestSlack = Number.POSITIVE_INFINITY;
  let bestJain = -1;

  for (let i = 0; i < eligibleCount; i++) {
    if (state.dayOccupied[i * 7 + day] !== 0) continue;
    const unavailMask = state.unavailableMask[i]!;
    if ((unavailMask & dayBit) !== 0) continue;
    const currH = state.assignedHours[i]!;
    const maxH = state.maxHours[i]!;
    const nextH = currH + duration;
    if (nextH > maxH) continue;

    const availDays = countAvailableDays7(unavailMask);
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
      availDays < bestAvailDays ||
      (availDays === bestAvailDays &&
        (slack < bestSlack ||
          (slack === bestSlack && hypJain - bestJain > JAIN_TIE_EPS)))
    ) {
      bestIdx = i;
      bestAvailDays = availDays;
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

function collectStage1TraceCandidates(
  state: SchedulerWorkingState,
  phase: '1A' | '1B',
  winnerDay: DayOfWeek,
  winnerShiftIdx: number,
  winnerStaffIdx: number,
  winnerDeltaGaps: number,
  winnerDeltaCov: number,
  winnerEfficiency: number,
  winnerPressure: number,
): readonly TraceCandidateRow[] {
  const rows: TraceCandidateRow[] = [];
  const winnerShift = state.sortedShifts[winnerShiftIdx]!;
  const winnerStaff = state.eligibleStaff[winnerStaffIdx]!;
  const winnerDur = getShiftDuration(winnerShift);
  const winnerSlack = state.maxHours[winnerStaffIdx]! - (state.assignedHours[winnerStaffIdx]! + winnerDur);
  const winnerAvailDays = countAvailableDays7(state.unavailableMask[winnerStaffIdx]!);
  const winnerStaffWhy =
    winnerAvailDays < 7
      ? `ưu tiên MRV (${winnerAvailDays}/7 ngày khả dụng) → Best-Fit còn dư ${winnerSlack}h`
      : `Best-Fit còn dư ${winnerSlack}h (đóng gói khít quỹ giờ)`;

  rows.push({
    id: `win-${winnerDay}-${winnerShift.id}-${winnerStaff.id}`,
    label: `${formatTraceDay(winnerDay)} · ${formatTraceShift(winnerShift)} → ${winnerStaff.name}`,
    status: 'WINNER',
    reason:
      phase === '1A'
        ? `Lấp ${winnerDeltaGaps} ô trống người, hiệu suất ${(winnerEfficiency * 100).toFixed(0)}%. Chọn ${winnerStaff.name} vì ${winnerStaffWhy}.`
        : `Hiệu suất phủ ${(winnerEfficiency * 100).toFixed(0)}% (+${winnerDeltaCov}h). Chọn ${winnerStaff.name} vì ${winnerStaffWhy}.`,
    scores: {
      ...(phase === '1A' ? { deltaGaps: winnerDeltaGaps } : {}),
      deltaCov: winnerDeltaCov,
      efficiency: Number(winnerEfficiency.toFixed(3)),
      pressure: Number(winnerPressure.toFixed(1)),
      availDays: winnerAvailDays,
      slack: winnerSlack,
    },
  });

  // Collect ALL competing valid candidates so we can rank the true closest runner-ups by Stage 1 priority
  interface ScoredRunnerUp {
    readonly d: DayOfWeek;
    readonly shift: Readonly<SchedulerWorkingState['sortedShifts'][number]>;
    readonly staff: Readonly<SchedulerWorkingState['eligibleStaff'][number]>;
    readonly deltaGaps: number;
    readonly deltaCov: number;
    readonly efficiency: number;
    readonly pressure: number;
    readonly availDays: number;
    readonly slack: number;
  }

  const allRunnerUps: ScoredRunnerUp[] = [];
  const rejectedRows: TraceCandidateRow[] = [];

  for (const d of DAYS_OF_WEEK) {
    const dayOffset = d * 16;
    const dayBit = 1 << d;
    for (let sIdx = 0; sIdx < state.sortedShifts.length; sIdx++) {
      if ((state.shiftDayMask[sIdx]! & dayBit) === 0) continue;
      if (d === winnerDay && sIdx === winnerShiftIdx) continue;
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

      const relevant = phase === '1A' ? deltaGaps > 0 : deltaCov > 0;
      if (!relevant) continue;

      const chosenStaff = pickBestFitStaff(state, d, duration);
      const efficiency = deltaCov / duration;
      if (chosenStaff === -1) {
        if (rejectedRows.length < 3) {
          rejectedRows.push({
            id: `rej-${d}-${shift.id}`,
            label: `${formatTraceDay(d)} · ${formatTraceShift(shift)}`,
            status: 'REJECTED',
            reason: 'Không còn nhân viên hợp lệ (đã có ca trong ngày, đánh dấu nghỉ, hoặc vượt maxWeeklyHours)',
            scores: {
              ...(phase === '1A' ? { deltaGaps } : {}),
              deltaCov,
              efficiency: Number(efficiency.toFixed(3)),
              pressure: Number(pressure.toFixed(1)),
            },
          });
        }
      } else {
        const staff = state.eligibleStaff[chosenStaff]!;
        const availDays = countAvailableDays7(state.unavailableMask[chosenStaff]!);
        const slack = state.maxHours[chosenStaff]! - (state.assignedHours[chosenStaff]! + duration);
        allRunnerUps.push({ d, shift, staff, deltaGaps, deltaCov, efficiency, pressure, availDays, slack });
      }
    }
  }

  // Sort runner-ups by the exact Stage 1A / 1B priority order
  allRunnerUps.sort((a, b) => {
    if (phase === '1A') {
      if (a.deltaGaps !== b.deltaGaps) return b.deltaGaps - a.deltaGaps;
      if (Math.abs(a.efficiency - b.efficiency) > FLOAT_TIE_EPS) return b.efficiency - a.efficiency;
      return b.pressure - a.pressure;
    }
    if (Math.abs(a.efficiency - b.efficiency) > FLOAT_TIE_EPS) return b.efficiency - a.efficiency;
    if (a.deltaCov !== b.deltaCov) return b.deltaCov - a.deltaCov;
    return b.pressure - a.pressure;
  });

  // Update winner's reason to explain WHY it beat the #2 closest competitor
  const topRunner = allRunnerUps[0];
  if (topRunner && rows[0]) {
    let winWhy = '';
    if (phase === '1A' && winnerDeltaGaps > topRunner.deltaGaps) {
      winWhy = `Thắng nhờ lấp nhiều ô trống hơn (${winnerDeltaGaps} > ${topRunner.deltaGaps})`;
    } else if (Math.abs(winnerEfficiency - topRunner.efficiency) > FLOAT_TIE_EPS) {
      winWhy = `Thắng nhờ hiệu suất phủ cao hơn (${(winnerEfficiency * 100).toFixed(0)}% > ${(topRunner.efficiency * 100).toFixed(0)}%)`;
    } else if (phase === '1B' && winnerDeltaCov > topRunner.deltaCov) {
      winWhy = `Thắng nhờ bù nhiều giờ thiếu hơn (${winnerDeltaCov}h > ${topRunner.deltaCov}h)`;
    } else if (Math.abs(winnerPressure - topRunner.pressure) > FLOAT_TIE_EPS) {
      winWhy = `Hòa các tiêu chí đầu → Thắng nhờ áp lực khách (pressure) cao nhất (${winnerPressure.toFixed(1)} > ${topRunner.pressure.toFixed(1)})`;
    } else {
      winWhy = `Hòa mọi chỉ số → Thắng nhờ thứ tự ngày/giờ sớm hơn (deterministic tie-break)`;
    }
    rows[0] = {
      ...rows[0],
      reason: `${winWhy}. Chọn ${winnerStaff.name} vì ${winnerStaffWhy}.`,
    };
  }

  for (const r of allRunnerUps.slice(0, 4)) {
    let loseWhy = 'Kém điểm ưu tiên hơn';
    if (phase === '1A' && r.deltaGaps < winnerDeltaGaps) {
      loseWhy = `Ít ô trống hơn (${r.deltaGaps} < ${winnerDeltaGaps})`;
    } else if (Math.abs(r.efficiency - winnerEfficiency) > FLOAT_TIE_EPS) {
      loseWhy = `Hiệu suất thấp hơn (${(r.efficiency * 100).toFixed(0)}% < ${(winnerEfficiency * 100).toFixed(0)}%)`;
    } else if (phase === '1B' && r.deltaCov < winnerDeltaCov) {
      loseWhy = `Bù ít giờ thiếu hơn (${r.deltaCov}h < ${winnerDeltaCov}h)`;
    } else if (r.pressure < winnerPressure) {
      loseWhy = `Áp lực khách thấp hơn (${r.pressure.toFixed(1)} < ${winnerPressure.toFixed(1)})`;
    }
    rows.push({
      id: `run-${r.d}-${r.shift.id}-${r.staff.id}`,
      label: `${formatTraceDay(r.d)} · ${formatTraceShift(r.shift)} → ${r.staff.name}`,
      status: 'RUNNER_UP',
      reason: loseWhy,
      scores: {
        ...(phase === '1A' ? { deltaGaps: r.deltaGaps } : {}),
        deltaCov: r.deltaCov,
        efficiency: Number(r.efficiency.toFixed(3)),
        pressure: Number(r.pressure.toFixed(1)),
        availDays: r.availDays,
        slack: r.slack,
      },
    });
  }

  for (const rej of rejectedRows) {
    rows.push(rej);
  }

  return rows;
}

/**
 * Runs Stage 1 Greedy Coverage Construction:
 * - Step 1A: Eliminates zero-staffing gaps (`deltaGaps > 0`).
 * - Step 1B: Fills remaining hourly marginal deficit (`deltaCov > 0`) by shift efficiency.
 *
 * @param state - Mutable working state initialized with pinned assignments.
 * @param observer - Optional trace observer for step-by-step simulation (zero overhead when omitted).
 */
export function runStage1Coverage(
  state: SchedulerWorkingState,
  observer?: SchedulerTraceObserver,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[] = [],
): void {
  let stableOrdinal = 0;
  let prevMetrics = observer ? computeTraceSummaryMetrics(state) : undefined;
  let step1ACount = 0;
  let step1BCount = 0;

  // Step 1A: Eliminate Staffing Gaps (deltaGaps > 0)
  while (true) {
    let bestDay: DayOfWeek = 0;
    let bestShiftIdx = -1;
    let bestStaffIdx = -1;
    let bestDeltaGaps = 0;
    let bestDeltaCov = 0;
    let bestEfficiency = -1;
    let bestPressure = -1;

    for (const d of DAYS_OF_WEEK) {
      const dayOffset = d * 16;
      const dayBit = 1 << d;
      for (let sIdx = 0; sIdx < state.sortedShifts.length; sIdx++) {
        if ((state.shiftDayMask[sIdx]! & dayBit) === 0) continue;
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
          bestDeltaCov = deltaCov;
          bestEfficiency = efficiency;
          bestPressure = pressure;
        }
      }
    }

    if (bestShiftIdx === -1) break;

    const candidates = observer
      ? collectStage1TraceCandidates(
          state,
          '1A',
          bestDay,
          bestShiftIdx,
          bestStaffIdx,
          bestDeltaGaps,
          bestDeltaCov,
          bestEfficiency,
          bestPressure,
        )
      : undefined;

    const oldAssignedH = observer ? state.assignedHours[bestStaffIdx]! : 0;
    recordWorkingAssignment(state, bestDay, bestShiftIdx, bestStaffIdx, stableOrdinal++);
    step1ACount += 1;

    if (observer) {
      const shift = state.sortedShifts[bestShiftIdx]!;
      const staff = state.eligibleStaff[bestStaffIdx]!;
      const newAssignedH = state.assignedHours[bestStaffIdx]!;
      const highlightCells: number[] = [];
      for (let h = shift.startHour; h < shift.endHour; h++) {
        highlightCells.push(bestDay * 16 + (h - 7));
      }
      const nextMetrics = computeTraceSummaryMetrics(state, prevMetrics?.coveragePct, prevMetrics?.jainIndex);
      const changedMap = new Map<number, 'assigned'>([[state.workingNew.length - 1, 'assigned']]);
      observer.emit({
        stageId: 'stage_1a_gaps',
        stageLabel: 'Stage 1A · Lấp lỗ hổng',
        kind: 'loop_step',
        status: 'ok',
        title: `Lấp ${bestDeltaGaps} ô trống: ${formatTraceDay(bestDay)} · ${formatTraceShift(shift)} → ${staff.name}`,
        narrative: `${formatTraceDay(bestDay)} (${shift.startHour}–${shift.endHour}h) có ${bestDeltaGaps} giờ hoàn toàn trống người. Thuật toán chọn ${staff.name} (Best-Fit + Jain Index) vì khớp quỹ giờ tốt nhất (${newAssignedH}/${state.maxHours[bestStaffIdx]}h).`,
        ruleHint: STAGE_1A_RULE_HINT,
        metrics: nextMetrics.metrics,
        grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, highlightCells, state.txnsGrid),
        entities: snapshotTraceEntities(state, [bestStaffIdx]),
        assignments: snapshotTraceAssignments(state, pinnedSnapshots, changedMap),
        stateDiff: [
          `assignedHours[${staff.name}]: ${oldAssignedH}h → ${newAssignedH}h (max ${state.maxHours[bestStaffIdx]}h)`,
          `dayOccupied[${staff.name}, ${formatTraceDay(bestDay)}]: 0 → 1`,
          `staffHoursGrid[${formatTraceDay(bestDay)} ${shift.startHour}–${shift.endHour}h]: +1 người`,
          `workingNew.length: ${state.workingNew.length - 1} → ${state.workingNew.length}`,
        ],
        candidates,
        debugPayload: {
          subStage: '1A',
          iteration: step1ACount,
          day: bestDay,
          shiftId: shift.id,
          staffId: staff.id,
          deltaGaps: bestDeltaGaps,
          deltaCov: bestDeltaCov,
          efficiency: Number(bestEfficiency.toFixed(4)),
          pressure: Number(bestPressure.toFixed(2)),
        },
      });
      prevMetrics = nextMetrics;
    }
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
      const dayBit = 1 << d;
      for (let sIdx = 0; sIdx < state.sortedShifts.length; sIdx++) {
        if ((state.shiftDayMask[sIdx]! & dayBit) === 0) continue;
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

    const candidates = observer
      ? collectStage1TraceCandidates(
          state,
          '1B',
          bestDay,
          bestShiftIdx,
          bestStaffIdx,
          0,
          bestDeltaCov,
          bestEfficiency,
          bestPressure,
        )
      : undefined;

    const oldAssignedH = observer ? state.assignedHours[bestStaffIdx]! : 0;
    recordWorkingAssignment(state, bestDay, bestShiftIdx, bestStaffIdx, stableOrdinal++);
    step1BCount += 1;

    if (observer) {
      const shift = state.sortedShifts[bestShiftIdx]!;
      const staff = state.eligibleStaff[bestStaffIdx]!;
      const newAssignedH = state.assignedHours[bestStaffIdx]!;
      const highlightCells: number[] = [];
      for (let h = shift.startHour; h < shift.endHour; h++) {
        highlightCells.push(bestDay * 16 + (h - 7));
      }
      const nextMetrics = computeTraceSummaryMetrics(state, prevMetrics?.coveragePct, prevMetrics?.jainIndex);
      const changedMap = new Map<number, 'assigned'>([[state.workingNew.length - 1, 'assigned']]);
      observer.emit({
        stageId: 'stage_1b_deficit',
        stageLabel: 'Stage 1B · Bù giờ thiếu',
        kind: 'loop_step',
        status: 'ok',
        title: `Bù +${bestDeltaCov}h thiếu: ${formatTraceDay(bestDay)} · ${formatTraceShift(shift)} → ${staff.name}`,
        narrative: `Gán thêm ${staff.name} vào ${formatTraceShift(shift)} ngày ${formatTraceDay(bestDay)} với hiệu suất phủ ${(bestEfficiency * 100).toFixed(0)}%, nâng độ phủ toàn tuần lên ${nextMetrics.coveragePct}%.`,
        ruleHint: STAGE_1B_RULE_HINT,
        metrics: nextMetrics.metrics,
        grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, highlightCells, state.txnsGrid),
        entities: snapshotTraceEntities(state, [bestStaffIdx]),
        assignments: snapshotTraceAssignments(state, pinnedSnapshots, changedMap),
        stateDiff: [
          `assignedHours[${staff.name}]: ${oldAssignedH}h → ${newAssignedH}h (max ${state.maxHours[bestStaffIdx]}h)`,
          `dayOccupied[${staff.name}, ${formatTraceDay(bestDay)}]: 0 → 1`,
          `staffHoursGrid[${formatTraceDay(bestDay)} ${shift.startHour}–${shift.endHour}h]: +1 người`,
          `workingNew.length: ${state.workingNew.length - 1} → ${state.workingNew.length}`,
        ],
        candidates,
        debugPayload: {
          subStage: '1B',
          iteration: step1BCount,
          day: bestDay,
          shiftId: shift.id,
          staffId: staff.id,
          deltaCov: bestDeltaCov,
          efficiency: Number(bestEfficiency.toFixed(4)),
          pressure: Number(bestPressure.toFixed(2)),
        },
      });
      prevMetrics = nextMetrics;
    }
  }
}
