/**
 * @file Trace emission helpers for Stage 0 (Gates, BigInt Transform, State Init)
 * and Stage 3 (ID Generation, Candidate Validation, Final Output) of the Auto-Scheduler pipeline.
 */

import type { SchedulerWorkingState } from './schedulerState';
import {
  computeTraceSummaryMetrics,
  formatTraceDay,
  snapshotTraceAssignments,
  snapshotTraceEntities,
  snapshotTraceGrid,
  type SchedulerTraceObserver,
  type TraceAssignmentSnapshot,
} from './schedulerTrace';
import type {
  Assignment,
  AutoScheduleDiagnostics,
  AutoScheduleInput,
  AutoScheduleResult,
  PinConflict,
  RebalanceStopReason,
  Staff,
} from './types';

/** Emits Stage 0 Input Readiness Gate trace event (pass or error). */
export function emitInputReadinessTrace(
  observer: SchedulerTraceObserver,
  input: AutoScheduleInput,
  readiness:
    | { ok: true; eligibleStaff: Readonly<Staff>[] }
    | { ok: false; result: AutoScheduleResult },
): void {
  if (!readiness.ok) {
    observer.emit({
      stageId: 'stage_0_gates',
      stageLabel: 'Kiểm tra đầu vào',
      kind: 'input_gate',
      status: 'error',
      title: 'Dừng tại Input Readiness Gate (E-02)',
      narrative: `Không thể chạy xếp lịch tự động vì thiếu hoặc sai dữ liệu đầu vào: ${readiness.result.status === 'FAILED' ? readiness.result.message : ''}`,
      metrics: [],
      debugPayload: { result: readiness.result },
    });
    return;
  }

  observer.emit({
    stageId: 'stage_0_gates',
    stageLabel: 'Kiểm tra đầu vào',
    kind: 'input_gate',
    status: 'ok',
    title: 'Đầu vào hợp lệ (Input Readiness Gate)',
    narrative: `Đã xác thực đủ dữ liệu: ${readiness.eligibleStaff.length} nhân viên hợp lệ (maxWeeklyHours > 0), ${input.shifts.length} mẫu ca, năng suất mục tiêu N = ${input.targetTxnsPerStaffHour} giao dịch/người-giờ.`,
    metrics: [
      { key: 'eligibleStaff', label: 'Nhân viên hợp lệ', value: readiness.eligibleStaff.length, unit: 'người' },
      { key: 'shiftTemplates', label: 'Mẫu ca', value: input.shifts.length, unit: 'ca' },
    ],
    debugPayload: {
      eligibleStaffIds: readiness.eligibleStaff.map((s) => s.id),
      shiftIds: input.shifts.map((sh) => sh.id),
      targetTxnsPerStaffHour: input.targetTxnsPerStaffHour,
      existingAssignmentsCount: input.existingAssignments.length,
    },
  });
}

/** Emits Stage 0 Pin Conflict Gate trace event (blocked or pass). */
export function emitPinConflictTrace(
  observer: SchedulerTraceObserver,
  input: AutoScheduleInput,
  conflicts: readonly PinConflict[],
): void {
  if (conflicts.length > 0) {
    observer.emit({
      stageId: 'stage_0_gates',
      stageLabel: 'Kiểm tra đầu vào',
      kind: 'input_gate',
      status: 'blocked',
      title: `Chặn do xung đột ca ghim (${conflicts.length} lỗi · E-03)`,
      narrative: `Phát hiện ${conflicts.length} xung đột ở các ca đã ghim (isPinned). Hệ thống dừng ngay lập tức và giữ nguyên lịch cũ (Atomic Guard).`,
      metrics: [{ key: 'pinConflicts', label: 'Xung đột ca ghim', value: conflicts.length, unit: 'lỗi' }],
      candidates: conflicts.map((c, idx) => ({
        id: `pin-conflict-${idx}`,
        label: `${c.type} · ${c.staffName} (${c.staffId})`,
        status: 'REJECTED' as const,
        reason: c.details,
        scores: { type: c.type, assignments: c.assignmentIds.length },
      })),
      debugPayload: { conflicts },
    });
    return;
  }

  const pinnedCount = input.existingAssignments.filter((a) => a.isPinned).length;
  observer.emit({
    stageId: 'stage_0_gates',
    stageLabel: 'Kiểm tra đầu vào',
    kind: 'input_gate',
    status: 'ok',
    title: `Vượt qua Pin Conflict Gate (${pinnedCount} ca ghim hợp lệ)`,
    narrative:
      pinnedCount > 0
        ? `Tất cả ${pinnedCount} ca đã ghim đều hợp lệ (không trùng ngày, không vượt giờ tuần, tham chiếu hợp lệ).`
        : 'Không có ca ghim nào bị xung đột. Sẵn sàng quy đổi nhu cầu nhân sự.',
    metrics: [{ key: 'pinnedCount', label: 'Ca ghim hợp lệ', value: pinnedCount, unit: 'ca' }],
    debugPayload: { pinnedCount },
  });
}

/** Emits Stage 0 BigInt RequiredStaff transform trace event (ok or error). */
export function emitRequiredGridsTrace(
  observer: SchedulerTraceObserver,
  input: AutoScheduleInput,
  grids:
    | { ok: true; requiredGrid: Float64Array; txnsGrid: Float64Array; totalRequiredBigInt: bigint }
    | { ok: false; result: AutoScheduleResult },
): void {
  if (!grids.ok) {
    observer.emit({
      stageId: 'stage_0_transform',
      stageLabel: 'Quy đổi nhu cầu (BigInt)',
      kind: 'transform',
      status: 'error',
      title: 'Lỗi quy đổi RequiredStaff (BigInt)',
      narrative: grids.result.status === 'FAILED' ? grids.result.message : 'Lỗi quy đổi nhu cầu.',
      metrics: [],
      debugPayload: { result: grids.result },
    });
    return;
  }

  const sampleCells: Record<string, unknown>[] = [];
  for (let i = 0; i < 112 && sampleCells.length < 6; i++) {
    const txns = grids.txnsGrid[i]!;
    const req = grids.requiredGrid[i]!;
    if (txns > 0) {
      const d = Math.floor(i / 16) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const h = (i % 16) + 7;
      sampleCells.push({
        cell: `${formatTraceDay(d)} ${h}:00`,
        transactions: txns,
        targetN: input.targetTxnsPerStaffHour,
        requiredStaff: req,
        formula: `ceilBigInt(${txns} / ${input.targetTxnsPerStaffHour}) = ${req}`,
      });
    }
  }

  observer.emit({
    stageId: 'stage_0_transform',
    stageLabel: 'Quy đổi nhu cầu (BigInt)',
    kind: 'transform',
    status: 'ok',
    title: `Quy đổi 112 ô giao dịch → ${grids.totalRequiredBigInt.toString()} giờ-người cần thiết`,
    narrative: `Áp dụng phép chia làm tròn lên chính xác bằng BigInt (tránh sai số dấu phẩy động) cho toàn bộ 7 ngày × 16 giờ với N = ${input.targetTxnsPerStaffHour}.`,
    metrics: [
      {
        key: 'totalRequiredHours',
        label: 'Tổng giờ nhu cầu',
        value: Number(grids.totalRequiredBigInt),
        unit: 'giờ',
      },
    ],
    grid: snapshotTraceGrid(grids.requiredGrid, new Uint32Array(112), undefined, grids.txnsGrid),
    stateDiff: [
      `requiredGrid[0..111] = ceilBigInt(txnsGrid / ${input.targetTxnsPerStaffHour})`,
      `totalRequiredBigInt = ${grids.totalRequiredBigInt.toString()}h`,
    ],
    debugPayload: {
      totalRequiredBigInt: grids.totalRequiredBigInt.toString(),
      targetTxnsPerStaffHour: input.targetTxnsPerStaffHour,
      sampleBigIntConversions: sampleCells,
    },
  });
}

/** Builds immutable trace assignment snapshots for all preserved pinned assignments. */
export function buildPinnedSnapshots(
  input: AutoScheduleInput,
  pinnedAssignments: readonly Assignment[],
): TraceAssignmentSnapshot[] {
  const staffNameById = new Map(input.staff.map((s) => [s.id, s.name]));
  const shiftById = new Map(input.shifts.map((sh) => [sh.id, sh]));
  const pad = (h: number) => String(h).padStart(2, '0');

  return pinnedAssignments.flatMap((p) => {
    const sh = shiftById.get(p.shiftId);
    if (!sh) return [];
    return [
      {
        day: p.day,
        staffId: p.staffId,
        staffName: staffNameById.get(p.staffId) ?? p.staffId,
        shiftLabel: `${pad(sh.startHour)}–${pad(sh.endHour)}h`,
        startHour: sh.startHour,
        endHour: sh.endHour,
        isPinned: true,
      },
    ];
  });
}

/** Emits Stage 0 working-state initialization trace event. */
export function emitStateInitTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  pinnedAssignments: readonly Assignment[],
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
): void {
  const initMetrics = computeTraceSummaryMetrics(state);
  observer.emit({
    stageId: 'stage_0_init',
    stageLabel: 'Khởi tạo trạng thái',
    kind: 'state_init',
    status: 'ok',
    title: `Khởi tạo bộ đệm & nạp ${pinnedAssignments.length} ca ghim`,
    narrative: `Nạp ${pinnedAssignments.length} ca cố định vào lưới 112 ô và tính quỹ giờ ban đầu cho ${state.eligibleStaff.length} nhân viên (độ phủ ban đầu: ${initMetrics.coveragePct}%, còn ${initMetrics.staffingGaps} ô trống người).`,
    metrics: initMetrics.metrics,
    grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
    entities: snapshotTraceEntities(state),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots),
    stateDiff: [
      `eligibleStaff.length = ${state.eligibleStaff.length}`,
      `pinnedAssignments = ${pinnedAssignments.length} ca cố định`,
      `staffingGaps ban đầu = ${initMetrics.staffingGaps} ô`,
    ],
    debugPayload: {
      pinnedAssignments,
      sortedShiftOrder: state.sortedShifts.map((s) => `${s.id} (${s.startHour}-${s.endHour}h)`),
    },
  });
}

/** Emits Stage 3 error trace event when `idGenerator` fails or collides. */
export function emitIdErrorTrace(
  observer: SchedulerTraceObserver,
  result: AutoScheduleResult,
): void {
  observer.emit({
    stageId: 'stage_3_validation',
    stageLabel: 'Kiểm định & Xuất kết quả',
    kind: 'validation',
    status: 'error',
    title: 'Lỗi cấp phát ID cho ca mới',
    narrative: result.status === 'FAILED' ? result.message : 'Lỗi idGenerator.',
    metrics: [],
    debugPayload: { result },
  });
}

/** Emits Stage 3 5-Invariant Candidate Validation trace event (ok or error). */
export function emitValidationTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  pinnedCount: number,
  generatedCount: number,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  validation: { ok: true } | { ok: false; message: string },
): void {
  if (!validation.ok) {
    observer.emit({
      stageId: 'stage_3_validation',
      stageLabel: 'Kiểm định & Xuất kết quả',
      kind: 'validation',
      status: 'error',
      title: 'Thất bại tại 5-Invariant Candidate Validation',
      narrative: `Bộ kiểm định độc lập phát hiện vi phạm: ${validation.message}. Hủy bỏ kết quả nháp và giữ nguyên lịch cũ.`,
      metrics: [],
      debugPayload: { validationMessage: validation.message },
    });
    return;
  }

  const valMetrics = computeTraceSummaryMetrics(state);
  observer.emit({
    stageId: 'stage_3_validation',
    stageLabel: 'Kiểm định & Xuất kết quả',
    kind: 'validation',
    status: 'ok',
    title: `Vượt qua 5-Invariant Candidate Validation (${pinnedCount + generatedCount} ca)`,
    narrative: `Bộ kiểm định độc lập đã xác nhận 5 bất biến an toàn: bảo toàn 100% ca ghim, không trùng ngày, không vượt giờ tuần, ID duy nhất và lưới 112 ô khớp tuyệt đối sau Stage 2.`,
    metrics: valMetrics.metrics,
    grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
    entities: snapshotTraceEntities(state),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots),
    stateDiff: [
      '5/5 bất biến an toàn: PASS',
      `pinned=${pinnedCount}, generated=${generatedCount}`,
    ],
    debugPayload: {
      preservedPinnedCount: pinnedCount,
      generatedAssignmentsCount: generatedCount,
      invariantsVerified: [
        '1. Pinned assignments preserved verbatim',
        '2. Valid staff & shift references',
        '3. Max 1 shift per staff per day',
        '4. Weekly assignedHours <= maxWeeklyHours',
        '5. Stage 2 preserved 112-cell StaffHours grid identically',
      ],
    },
  });
}

/** Emits Stage 3 final output trace event with summary metrics and diagnostics. */
export function emitOutputTrace(
  observer: SchedulerTraceObserver,
  state: SchedulerWorkingState,
  totalAssignmentsCount: number,
  generatedCount: number,
  pinnedCount: number,
  rebalanceIterationsRun: number,
  rebalanceStopReason: RebalanceStopReason,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  diagnostics: AutoScheduleDiagnostics,
): void {
  const outMetrics = computeTraceSummaryMetrics(state);
  observer.emit({
    stageId: 'stage_3_validation',
    stageLabel: 'Kiểm định & Xuất kết quả',
    kind: 'output',
    status: 'ok',
    title: `Hoàn tất xếp lịch: ${totalAssignmentsCount} ca · Phủ ${outMetrics.coveragePct}% · Jain ${outMetrics.jainIndex}`,
    narrative: `Thuật toán hoàn thành toàn bộ quy trình (${generatedCount} ca mới + ${pinnedCount} ca ghim, ${rebalanceIterationsRun} vòng cân bằng — ${rebalanceStopReason}). Sẵn sàng commit nguyên tử (atomic replace).`,
    metrics: outMetrics.metrics,
    grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
    entities: snapshotTraceEntities(state),
    assignments: snapshotTraceAssignments(state, pinnedSnapshots),
    debugPayload: { diagnostics },
  });
}
