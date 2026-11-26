/**
 * @file Trace builders and observer emission helpers for Stage 2 (Coverage-Preserving Fairness Rebalance).
 * Isolates pre-move ghost-pill capture, post-move diff formatting, and stop-reason trace emission
 * from the Stage 2 typed-array hot loops.
 */

import { MAX_REBALANCE_ITERATIONS, REBALANCE_IMPROVE_EPS } from './constants';
import type { RebalanceMove, SchedulerWorkingState, WorkingAssignment } from './schedulerState';
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
import type { RebalanceStopReason, Staff } from './types';

export const STAGE_2_RULE_HINT: TraceRuleHint = {
  title: 'Quy tắc Stage 2 (Cân bằng công bằng)',
  rules: [
    'Giữ nguyên 100% độ phủ 112 ô (không làm hụt bất kỳ giờ nào đã lấp ở Stage 1).',
    'Thử chuyển ca (REASSIGN) hoặc hoán đổi ca khác thời lượng (SWAP) giúp tăng Jain Index (ΔJ > 10⁻⁶) nhiều nhất; dừng khi hội tụ.',
  ],
};

type TraceSummaryMetrics = ReturnType<typeof computeTraceSummaryMetrics>;

interface PreMoveStaffHours {
  readonly idx: number;
  readonly name: string;
  readonly oldH: number;
  readonly maxH: number;
}

export interface PreparedStage2MoveTrace {
  readonly title: string;
  readonly narrative: string;
  readonly changedStaff: number[];
  readonly highlightCells: number[];
  readonly candidates: TraceCandidateRow[];
  readonly debugPayload: Record<string, unknown>;
  readonly prevCoveragePct?: number;
  readonly preHours: readonly PreMoveStaffHours[];
  readonly removedAssignments?: TraceAssignmentSnapshot[];
}

function toRemovedGhostPill(
  a: Readonly<WorkingAssignment>,
  staff: Readonly<Staff>,
  changeKind: 'reassigned' | 'swapped',
): TraceAssignmentSnapshot {
  const pad = (h: number) => String(h).padStart(2, '0');
  return {
    day: a.day,
    staffId: staff.id,
    staffName: staff.name,
    shiftId: a.shiftId,
    shiftLabel: `${pad(a.startHour)}–${pad(a.endHour)}h`,
    startHour: a.startHour,
    endHour: a.endHour,
    isPinned: false,
    isChanged: true,
    changeKind,
  };
}

function buildStage2MoveTrace(
  state: SchedulerWorkingState,
  move: RebalanceMove,
  iter: number,
  beforeJain: number,
  prevCoveragePct?: number,
): Omit<PreparedStage2MoveTrace, 'preHours' | 'removedAssignments'> {
  if (move.moveType === 'REASSIGN') {
    const a = state.workingNew[move.a1Idx]!;
    const oldStaff = state.eligibleStaff[a.staffIdx]!;
    const newStaff = state.eligibleStaff[move.a2OrStaffIdx]!;
    const shift = state.sortedShifts[a.shiftIdx]!;
    const highlightCells: number[] = [];
    for (let h = a.startHour; h < a.endHour; h++) {
      highlightCells.push(a.day * 16 + (h - 7));
    }
    return {
      title: `Chuyển ca (REASSIGN): ${oldStaff.name} → ${newStaff.name} (${formatTraceDay(a.day)})`,
      narrative: `Chuyển ${formatTraceShift(shift)} ngày ${formatTraceDay(a.day)} từ ${oldStaff.name} sang ${newStaff.name}. Độ phủ 112 ô giữ nguyên 100%, chỉ số công bằng Jain tăng +${move.deltaJ.toFixed(4)}.`,
      changedStaff: [a.staffIdx, move.a2OrStaffIdx],
      highlightCells,
      candidates: [
        {
          id: `s2-reassign-${iter}`,
          label: `REASSIGN · ${formatTraceDay(a.day)} ${formatTraceShift(shift)}: ${oldStaff.name} → ${newStaff.name}`,
          status: 'WINNER',
          reason: `Tăng Jain Index +${move.deltaJ.toFixed(4)} mà không thay đổi coverage`,
          scores: {
            moveType: 'REASSIGN',
            beforeJain: Number(beforeJain.toFixed(4)),
            deltaJ: Number(move.deltaJ.toFixed(5)),
            duration: a.duration,
          },
        },
      ],
      debugPayload: {
        iteration: iter + 1,
        moveType: 'REASSIGN',
        day: a.day,
        shiftId: a.shiftId,
        fromStaffId: oldStaff.id,
        toStaffId: newStaff.id,
        beforeJain: Number(beforeJain.toFixed(5)),
        deltaJ: Number(move.deltaJ.toFixed(5)),
      },
      prevCoveragePct,
    };
  }

  const a1 = state.workingNew[move.a1Idx]!;
  const a2 = state.workingNew[move.a2OrStaffIdx]!;
  const s1 = state.eligibleStaff[a1.staffIdx]!;
  const s2 = state.eligibleStaff[a2.staffIdx]!;
  const sh1 = state.sortedShifts[a1.shiftIdx]!;
  const sh2 = state.sortedShifts[a2.shiftIdx]!;
  const highlightSet = new Set<number>();
  for (let h = a1.startHour; h < a1.endHour; h++) highlightSet.add(a1.day * 16 + (h - 7));
  for (let h = a2.startHour; h < a2.endHour; h++) highlightSet.add(a2.day * 16 + (h - 7));

  return {
    title: `Hoán đổi (SWAP): ${s1.name} ↔ ${s2.name}`,
    narrative: `Hoán đổi 2 ca khác thời lượng: ${s1.name} (${formatTraceDay(a1.day)} ${formatTraceShift(sh1)}, ${a1.duration}h) ↔ ${s2.name} (${formatTraceDay(a2.day)} ${formatTraceShift(sh2)}, ${a2.duration}h). Độ phủ giữ nguyên, Jain Index tăng +${move.deltaJ.toFixed(4)}.`,
    changedStaff: [a1.staffIdx, a2.staffIdx],
    highlightCells: Array.from(highlightSet),
    candidates: [
      {
        id: `s2-swap-${iter}`,
        label: `SWAP · ${s1.name} (${a1.duration}h) ↔ ${s2.name} (${a2.duration}h)`,
        status: 'WINNER',
        reason: `Cân bằng tải giữa 2 nhân viên, Jain Index tăng +${move.deltaJ.toFixed(4)}`,
        scores: {
          moveType: 'SWAP',
          beforeJain: Number(beforeJain.toFixed(4)),
          deltaJ: Number(move.deltaJ.toFixed(5)),
          dur1: a1.duration,
          dur2: a2.duration,
        },
      },
    ],
    debugPayload: {
      iteration: iter + 1,
      moveType: 'SWAP',
      assignment1: { day: a1.day, shiftId: a1.shiftId, staffId: s1.id, duration: a1.duration },
      assignment2: { day: a2.day, shiftId: a2.shiftId, staffId: s2.id, duration: a2.duration },
      beforeJain: Number(beforeJain.toFixed(5)),
      deltaJ: Number(move.deltaJ.toFixed(5)),
    },
    prevCoveragePct,
  };
}

/**
 * Captures pre-move metadata, per-staff assigned hours, and removed ghost-pill snapshots
 * before `applyRebalanceMove` mutates `state`.
 */
export function prepareStage2MoveTrace(
  state: SchedulerWorkingState,
  move: RebalanceMove,
  iter: number,
  beforeJain: number,
  prevCoveragePct?: number,
): PreparedStage2MoveTrace {
  const base = buildStage2MoveTrace(state, move, iter, beforeJain, prevCoveragePct);
  const preHours: PreMoveStaffHours[] = base.changedStaff.map((sIdx) => ({
    idx: sIdx,
    name: state.eligibleStaff[sIdx]!.name,
    oldH: state.assignedHours[sIdx]!,
    maxH: state.maxHours[sIdx]!,
  }));

  let removedAssignments: TraceAssignmentSnapshot[] | undefined;
  if (move.moveType === 'REASSIGN') {
    const a = state.workingNew[move.a1Idx]!;
    removedAssignments = [toRemovedGhostPill(a, state.eligibleStaff[a.staffIdx]!, 'reassigned')];
  } else {
    const a1 = state.workingNew[move.a1Idx]!;
    const a2 = state.workingNew[move.a2OrStaffIdx]!;
    if (a1.day !== a2.day) {
      removedAssignments = [
        toRemovedGhostPill(a1, state.eligibleStaff[a1.staffIdx]!, 'swapped'),
        toRemovedGhostPill(a2, state.eligibleStaff[a2.staffIdx]!, 'swapped'),
      ];
    }
  }

  return {
    ...base,
    preHours,
    ...(removedAssignments ? { removedAssignments } : {}),
  };
}

/**
 * Emits a post-move Stage 2 `TraceEvent` and returns updated summary metrics for the next step.
 */
export function emitStage2MoveTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  move: RebalanceMove,
  currentJ: number,
  prepared: PreparedStage2MoveTrace,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  prevMetrics: TraceSummaryMetrics | undefined,
): TraceSummaryMetrics {
  const nextMetrics = computeTraceSummaryMetrics(
    state,
    prevMetrics?.coveragePct,
    prevMetrics?.jainIndex,
  );
  const changedMap = new Map<number, 'reassigned' | 'swapped'>();
  if (move.moveType === 'REASSIGN') {
    changedMap.set(move.a1Idx, 'reassigned');
  } else {
    changedMap.set(move.a1Idx, 'swapped');
    changedMap.set(move.a2OrStaffIdx, 'swapped');
  }

  const diffLines = prepared.preHours.map(
    (p) => `assignedHours[${p.name}]: ${p.oldH}h → ${state.assignedHours[p.idx]!}h (max ${p.maxH}h)`,
  );
  diffLines.push(
    `Jain Index: ${currentJ.toFixed(4)} → ${nextMetrics.jainIndex} (+${move.deltaJ.toFixed(4)})`,
  );
  diffLines.push('staffHoursGrid[0..111]: giữ nguyên 100% (coverage-preserving)');

  observer.emit({
    stageId: 'stage_2_rebalance',
    stageLabel: 'Stage 2 · Cân bằng công bằng',
    kind: 'loop_step',
    status: 'ok',
    title: prepared.title,
    narrative: prepared.narrative,
    ruleHint: STAGE_2_RULE_HINT,
    metrics: nextMetrics.metrics,
    grid: snapshotTraceGrid(
      state.requiredGrid,
      state.staffHoursGrid,
      prepared.highlightCells,
      state.txnsGrid,
    ),
    entities: snapshotTraceEntities(state, prepared.changedStaff),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots, changedMap),
    ...(prepared.removedAssignments ? { removedAssignments: prepared.removedAssignments } : {}),
    stateDiff: diffLines,
    candidates: prepared.candidates,
    debugPayload: { ...prepared.debugPayload, afterJain: nextMetrics.jainIndex },
  });

  return nextMetrics;
}

/**
 * Emits the terminal Stage 2 `TraceEvent` for `SKIPPED`, `CONVERGED`, or `MAX_ITERATIONS_REACHED`.
 */
export function emitStage2StopTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  stopReason: RebalanceStopReason,
  rebalanceIterationsRun: number,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  prevMetrics?: TraceSummaryMetrics,
): void {
  const m =
    stopReason === 'SKIPPED'
      ? computeTraceSummaryMetrics(state)
      : computeTraceSummaryMetrics(state, prevMetrics?.coveragePct, prevMetrics?.jainIndex);

  const isSkipped = stopReason === 'SKIPPED';
  const isConverged = stopReason === 'CONVERGED';
  const title = isSkipped
    ? 'Bỏ qua cân bằng (SKIPPED)'
    : isConverged
      ? `Hội tụ sau ${rebalanceIterationsRun} vòng cân bằng (CONVERGED)`
      : `Đạt giới hạn ${MAX_REBALANCE_ITERATIONS} vòng lặp (MAX_ITERATIONS_REACHED)`;
  const narrative = isSkipped
    ? 'Không đủ nhân viên hợp lệ hoặc không có ca mới nào cần cân bằng lại.'
    : isConverged
      ? `Không còn phép chuyển ca (REASSIGN) hoặc hoán đổi (SWAP) nào giúp tăng chỉ số công bằng Jain vượt ngưỡng ${REBALANCE_IMPROVE_EPS}. Thuật toán dừng tối ưu.`
      : `Stage 2 đã chạy tối đa ${MAX_REBALANCE_ITERATIONS} bước cân bằng và dừng theo giới hạn an toàn hiệu năng.`;

  observer.emit({
    stageId: 'stage_2_rebalance',
    stageLabel: 'Stage 2 · Cân bằng công bằng',
    kind: 'loop_step',
    status: stopReason === 'MAX_ITERATIONS_REACHED' ? 'warning' : 'ok',
    title,
    narrative,
    ruleHint: STAGE_2_RULE_HINT,
    metrics: m.metrics,
    grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
    entities: snapshotTraceEntities(state),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots),
    ...(isConverged
      ? {
          stateDiff: [
            `stopReason = CONVERGED (sau ${rebalanceIterationsRun} bước)`,
            `finalJain = ${m.jainIndex}`,
          ],
        }
      : {}),
    debugPayload: isSkipped
      ? { rebalanceStopReason: 'SKIPPED', rebalanceIterationsRun: 0 }
      : { rebalanceStopReason: stopReason, rebalanceIterationsRun, finalJain: m.jainIndex },
  });
}
