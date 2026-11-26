/**
 * @file Trace builders and observer emission helpers for Stage 1 (Greedy Coverage Construction).
 * Keeps trace-only candidate ranking, rule hints, and snapshot assembly isolated from the
 * Stage 1 hot loops while maintaining a strict 1-way DAG (no import from `schedulerStage1.ts`).
 */

import { DAYS_OF_WEEK, FLOAT_TIE_EPS } from './constants';
import { countAvailableDays7, getShiftDuration } from './hardRules';
import type { SchedulerWorkingState } from './schedulerState';
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
import type { DayOfWeek } from './types';

export const STAGE_1A_RULE_HINT: TraceRuleHint = {
  title: 'Thứ tự ưu tiên Stage 1A (Lấp lỗ hổng)',
  rules: [
    'Chọn ca: (1) Nhiều ô trống người nhất (deltaGaps) → (2) Hiệu suất phủ cao nhất (efficiency) → (3) Áp lực giao dịch cao nhất (pressure).',
    'Chọn người: Ít ngày khả dụng nhất (MRV — giữ người linh hoạt cho ngày khan hiếm) → Best-Fit (ít giờ dư nhất) → Jain Index → ID.',
  ],
};

export const STAGE_1B_RULE_HINT: TraceRuleHint = {
  title: 'Thứ tự ưu tiên Stage 1B (Bù giờ thiếu)',
  rules: [
    'Chọn ca: (1) Hiệu suất phủ cao nhất (efficiency) → (2) Bù nhiều giờ thiếu nhất (deltaCov) → (3) Áp lực khách cao nhất (pressure).',
    'Chọn người: Ít ngày khả dụng nhất (MRV) → Best-Fit (đóng gói khít quỹ giờ) → Jain Index → ID. Việc san đều sẽ thực hiện ở Stage 2.',
  ],
};

export interface Stage1Candidate {
  readonly day: DayOfWeek;
  readonly shiftIdx: number;
  readonly staffIdx: number;
  readonly deltaGaps: number;
  readonly deltaCov: number;
  readonly efficiency: number;
  readonly pressure: number;
}

type TraceSummaryMetrics = ReturnType<typeof computeTraceSummaryMetrics>;

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

/**
 * Collects the winning candidate, top-4 closest valid runner-ups, and up to 3 rejected
 * shift/day slots for a Stage 1A or Stage 1B decision step.
 *
 * @param state - Pre-mutation Stage 1 working state.
 * @param phase - Active Stage 1 sub-phase (`'1A'` or `'1B'`).
 * @param winner - Selected winning candidate for this step.
 * @param selectBestStaff - Staff selector callback injected by Stage 1 to preserve 1-way DAG.
 * @returns Ranked trace candidate rows for simulator inspection.
 */
export function collectStage1TraceCandidates(
  state: SchedulerWorkingState,
  phase: '1A' | '1B',
  winner: Stage1Candidate,
  selectBestStaff: (state: SchedulerWorkingState, day: DayOfWeek, duration: number) => number,
): readonly TraceCandidateRow[] {
  const {
    day: winnerDay,
    shiftIdx: winnerShiftIdx,
    staffIdx: winnerStaffIdx,
    deltaGaps: winnerDeltaGaps,
    deltaCov: winnerDeltaCov,
    efficiency: winnerEfficiency,
    pressure: winnerPressure,
  } = winner;

  const rows: TraceCandidateRow[] = [];
  const winnerShift = state.sortedShifts[winnerShiftIdx]!;
  const winnerStaff = state.eligibleStaff[winnerStaffIdx]!;
  const winnerDur = getShiftDuration(winnerShift);
  const winnerSlack =
    state.maxHours[winnerStaffIdx]! - (state.assignedHours[winnerStaffIdx]! + winnerDur);
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

      if (phase === '1A' ? deltaGaps === 0 : deltaCov === 0) continue;

      const chosenStaff = selectBestStaff(state, d, duration);
      const efficiency = deltaCov / duration;
      if (chosenStaff === -1) {
        if (rejectedRows.length < 3) {
          rejectedRows.push({
            id: `rej-${d}-${shift.id}`,
            label: `${formatTraceDay(d)} · ${formatTraceShift(shift)}`,
            status: 'REJECTED',
            reason:
              'Không còn nhân viên hợp lệ (đã có ca trong ngày, đánh dấu nghỉ, hoặc vượt maxWeeklyHours)',
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
    rows[0] = { ...rows[0], reason: `${winWhy}. Chọn ${winnerStaff.name} vì ${winnerStaffWhy}.` };
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
 * Emits a post-assignment `TraceEvent` for a Stage 1A or Stage 1B step and returns
 * the updated summary metrics for delta calculation on the subsequent step.
 */
export function emitStage1StepTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  phase: '1A' | '1B',
  iteration: number,
  winner: Stage1Candidate,
  oldAssignedH: number,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  candidates: readonly TraceCandidateRow[] | undefined,
  prevMetrics: TraceSummaryMetrics | undefined,
): TraceSummaryMetrics {
  const { day, shiftIdx, staffIdx, deltaGaps, deltaCov, efficiency, pressure } = winner;
  const shift = state.sortedShifts[shiftIdx]!;
  const staff = state.eligibleStaff[staffIdx]!;
  const newAssignedH = state.assignedHours[staffIdx]!;
  const highlightCells: number[] = [];
  for (let h = shift.startHour; h < shift.endHour; h++) {
    highlightCells.push(day * 16 + (h - 7));
  }

  const nextMetrics = computeTraceSummaryMetrics(
    state,
    prevMetrics?.coveragePct,
    prevMetrics?.jainIndex,
  );
  const changedMap = new Map<number, 'assigned'>([[state.workingNew.length - 1, 'assigned']]);
  const is1A = phase === '1A';

  observer.emit({
    stageId: is1A ? 'stage_1a_gaps' : 'stage_1b_deficit',
    stageLabel: is1A ? 'Stage 1A · Lấp lỗ hổng' : 'Stage 1B · Bù giờ thiếu',
    kind: 'loop_step',
    status: 'ok',
    title: is1A
      ? `Lấp ${deltaGaps} ô trống: ${formatTraceDay(day)} · ${formatTraceShift(shift)} → ${staff.name}`
      : `Bù +${deltaCov}h thiếu: ${formatTraceDay(day)} · ${formatTraceShift(shift)} → ${staff.name}`,
    narrative: is1A
      ? `${formatTraceDay(day)} (${shift.startHour}–${shift.endHour}h) có ${deltaGaps} giờ hoàn toàn trống người. Thuật toán chọn ${staff.name} (Best-Fit + Jain Index) vì khớp quỹ giờ tốt nhất (${newAssignedH}/${state.maxHours[staffIdx]}h).`
      : `Gán thêm ${staff.name} vào ${formatTraceShift(shift)} ngày ${formatTraceDay(day)} với hiệu suất phủ ${(efficiency * 100).toFixed(0)}%, nâng độ phủ toàn tuần lên ${nextMetrics.coveragePct}%.`,
    ruleHint: is1A ? STAGE_1A_RULE_HINT : STAGE_1B_RULE_HINT,
    metrics: nextMetrics.metrics,
    grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, highlightCells, state.txnsGrid),
    entities: snapshotTraceEntities(state, [staffIdx]),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots, changedMap),
    stateDiff: [
      `assignedHours[${staff.name}]: ${oldAssignedH}h → ${newAssignedH}h (max ${state.maxHours[staffIdx]}h)`,
      `dayOccupied[${staff.name}, ${formatTraceDay(day)}]: 0 → 1`,
      `staffHoursGrid[${formatTraceDay(day)} ${shift.startHour}–${shift.endHour}h]: +1 người`,
      `workingNew.length: ${state.workingNew.length - 1} → ${state.workingNew.length}`,
    ],
    candidates,
    debugPayload: {
      subStage: phase,
      iteration,
      day,
      shiftId: shift.id,
      staffId: staff.id,
      ...(is1A ? { deltaGaps } : {}),
      deltaCov,
      efficiency: Number(efficiency.toFixed(4)),
      pressure: Number(pressure.toFixed(2)),
    },
  });

  return nextMetrics;
}
