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

const STAGE_2_RULE_HINT: TraceRuleHint = {
  title: 'Quy tắc Stage 2 (Cân bằng công bằng)',
  rules: [
    'Giữ nguyên 100% độ phủ 112 ô (không làm hụt bất kỳ giờ nào đã lấp ở Stage 1).',
    'Thử chuyển ca (REASSIGN) hoặc hoán đổi ca khác thời lượng (SWAP) giúp tăng Jain Index (ΔJ > 10⁻⁶) nhiều nhất; dừng khi hội tụ.',
  ],
};
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

function buildStage2MoveTrace(
  state: SchedulerWorkingState,
  move: RebalanceMove,
  iter: number,
  beforeJain: number,
  prevCoveragePct?: number,
): {
  title: string;
  narrative: string;
  changedStaff: number[];
  highlightCells: number[];
  candidates: TraceCandidateRow[];
  debugPayload: Record<string, unknown>;
  prevCoveragePct?: number;
} {
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
 * Runs Stage 2 Coverage-Preserving Fairness Rebalance using O(1) delta evaluation
 * for `REASSIGN` and `SWAP` moves (capped at `MAX_REBALANCE_ITERATIONS = 200`).
 *
 * @param state - Working state after Stage 1 sorted by `stableKey ASC`.
 * @param observer - Optional trace observer for step-by-step simulation (zero overhead when omitted).
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
      const m = computeTraceSummaryMetrics(state);
      observer.emit({
        stageId: 'stage_2_rebalance',
        stageLabel: 'Stage 2 · Cân bằng công bằng',
        kind: 'loop_step',
        status: 'ok',
        title: 'Bỏ qua cân bằng (SKIPPED)',
        narrative: 'Không đủ nhân viên hợp lệ hoặc không có ca mới nào cần cân bằng lại.',
        ruleHint: STAGE_2_RULE_HINT,
        metrics: m.metrics,
        grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
        entities: snapshotTraceEntities(state),
        assignments: snapshotTraceAssignments(state, pinnedSnapshots),
        debugPayload: { rebalanceStopReason: 'SKIPPED', rebalanceIterationsRun: 0 },
      });
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
        const m = computeTraceSummaryMetrics(state, prevMetrics?.coveragePct, prevMetrics?.jainIndex);
        observer.emit({
          stageId: 'stage_2_rebalance',
          stageLabel: 'Stage 2 · Cân bằng công bằng',
          kind: 'loop_step',
          status: 'ok',
          title: `Hội tụ sau ${rebalanceIterationsRun} vòng cân bằng (CONVERGED)`,
          narrative: `Không còn phép chuyển ca (REASSIGN) hoặc hoán đổi (SWAP) nào giúp tăng chỉ số công bằng Jain vượt ngưỡng ${REBALANCE_IMPROVE_EPS}. Thuật toán dừng tối ưu.`,
          ruleHint: STAGE_2_RULE_HINT,
          metrics: m.metrics,
          grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
          entities: snapshotTraceEntities(state),
          assignments: snapshotTraceAssignments(state, pinnedSnapshots),
          stateDiff: [`stopReason = CONVERGED (sau ${rebalanceIterationsRun} bước)`, `finalJain = ${m.jainIndex}`],
          debugPayload: {
            rebalanceStopReason: 'CONVERGED',
            rebalanceIterationsRun,
            finalJain: m.jainIndex,
          },
        });
      }
      return { rebalanceIterationsRun, rebalanceStopReason: 'CONVERGED' };
    }

    const preTrace = observer
      ? buildStage2MoveTrace(state, move, iter, currentJ, prevMetrics?.coveragePct)
      : undefined;

    const preHours = observer
      ? preTrace!.changedStaff.map((sIdx) => ({
          idx: sIdx,
          name: state.eligibleStaff[sIdx]!.name,
          oldH: state.assignedHours[sIdx]!,
          maxH: state.maxHours[sIdx]!,
        }))
      : null;

    // Capture cells losing a shift during REASSIGN or cross-day SWAP so the Roster UI can show ghost pills
    let removedAssignments: TraceAssignmentSnapshot[] | undefined;
    if (observer) {
      const pad = (h: number) => String(h).padStart(2, '0');
      if (move.moveType === 'REASSIGN') {
        const a = state.workingNew[move.a1Idx]!;
        const oldStaff = state.eligibleStaff[a.staffIdx]!;
        removedAssignments = [
          {
            day: a.day,
            staffId: oldStaff.id,
            staffName: oldStaff.name,
            shiftLabel: `${pad(a.startHour)}–${pad(a.endHour)}h`,
            startHour: a.startHour,
            endHour: a.endHour,
            isPinned: false,
            isChanged: true,
            changeKind: 'reassigned',
          },
        ];
      } else {
        const a1 = state.workingNew[move.a1Idx]!;
        const a2 = state.workingNew[move.a2OrStaffIdx]!;
        if (a1.day !== a2.day) {
          const s1 = state.eligibleStaff[a1.staffIdx]!;
          const s2 = state.eligibleStaff[a2.staffIdx]!;
          removedAssignments = [
            {
              day: a1.day,
              staffId: s1.id,
              staffName: s1.name,
              shiftLabel: `${pad(a1.startHour)}–${pad(a1.endHour)}h`,
              startHour: a1.startHour,
              endHour: a1.endHour,
              isPinned: false,
              isChanged: true,
              changeKind: 'swapped',
            },
            {
              day: a2.day,
              staffId: s2.id,
              staffName: s2.name,
              shiftLabel: `${pad(a2.startHour)}–${pad(a2.endHour)}h`,
              startHour: a2.startHour,
              endHour: a2.endHour,
              isPinned: false,
              isChanged: true,
              changeKind: 'swapped',
            },
          ];
        }
      }
    }

    applyRebalanceMove(state, move);
    rebalanceIterationsRun += 1;

    if (observer && preTrace && preHours) {
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
      const diffLines = preHours.map(
        (p) => `assignedHours[${p.name}]: ${p.oldH}h → ${state.assignedHours[p.idx]!}h (max ${p.maxH}h)`,
      );
      diffLines.push(`Jain Index: ${currentJ.toFixed(4)} → ${nextMetrics.jainIndex} (+${move.deltaJ.toFixed(4)})`);
      diffLines.push('staffHoursGrid[0..111]: giữ nguyên 100% (coverage-preserving)');

      observer.emit({
        stageId: 'stage_2_rebalance',
        stageLabel: 'Stage 2 · Cân bằng công bằng',
        kind: 'loop_step',
        status: 'ok',
        title: preTrace.title,
        narrative: preTrace.narrative,
        ruleHint: STAGE_2_RULE_HINT,
        metrics: nextMetrics.metrics,
        grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, preTrace.highlightCells, state.txnsGrid),
        entities: snapshotTraceEntities(state, preTrace.changedStaff),
        assignments: snapshotTraceAssignments(state, pinnedSnapshots, changedMap),
        ...(removedAssignments ? { removedAssignments } : {}),
        stateDiff: diffLines,
        candidates: preTrace.candidates,
        debugPayload: {
          ...preTrace.debugPayload,
          afterJain: nextMetrics.jainIndex,
        },
      });
      prevMetrics = nextMetrics;
    }
  }

  if (observer) {
    const m = computeTraceSummaryMetrics(state, prevMetrics?.coveragePct, prevMetrics?.jainIndex);
    observer.emit({
      stageId: 'stage_2_rebalance',
      stageLabel: 'Stage 2 · Cân bằng công bằng',
      kind: 'loop_step',
      status: 'warning',
      title: `Đạt giới hạn ${MAX_REBALANCE_ITERATIONS} vòng lặp (MAX_ITERATIONS_REACHED)`,
      narrative: `Stage 2 đã chạy tối đa ${MAX_REBALANCE_ITERATIONS} bước cân bằng và dừng theo giới hạn an toàn hiệu năng.`,
      ruleHint: STAGE_2_RULE_HINT,
      metrics: m.metrics,
      grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
      entities: snapshotTraceEntities(state),
      assignments: snapshotTraceAssignments(state, pinnedSnapshots),
      debugPayload: {
        rebalanceStopReason: 'MAX_ITERATIONS_REACHED',
        rebalanceIterationsRun,
        finalJain: m.jainIndex,
      },
    });
  }

  return { rebalanceIterationsRun, rebalanceStopReason: 'MAX_ITERATIONS_REACHED' };
}
