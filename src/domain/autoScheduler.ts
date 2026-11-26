/**
 * @file Public entry point for the Deterministic Two-Stage Auto-Scheduler (`runAutoSchedule`).
 * Orchestrates input readiness, Pin Conflict Gate, Stage 1 coverage, Stage 2 rebalance,
 * post-Stage-2 ID assignment, independent candidate validation, and diagnostics.
 */

import { DAYS_OF_WEEK, MAX_SAFE_BIGINT, OPERATING_HOURS } from './constants';
import { checkPinConflicts, validateCandidateAssignments } from './constraints';
import { computeRequiredStaff } from './decimalMath';
import { getShiftDayMask, getStaffUnavailableMask, isStaffEligible } from './hardRules';
import { buildAutoScheduleDiagnostics } from './schedulerDiagnostics';
import { runStage1Coverage } from './schedulerStage1';
import { runStage2Rebalance } from './schedulerStage2';
import {
  compareStringsLex,
  compareWorkingStableKey,
  recomputeUtilizationSums,
  type SchedulerWorkingState,
} from './schedulerState';
import {
  computeTraceSummaryMetrics,
  formatTraceDay,
  snapshotTraceAssignments,
  snapshotTraceEntities,
  snapshotTraceGrid,
  type AutoScheduleOptions,
  type TraceAssignmentSnapshot,
} from './schedulerTrace';
import type {
  Assignment,
  AutoScheduleInput,
  AutoScheduleResult,
  MissingInputCode,
  ShiftTemplate,
  Staff,
} from './types';

function validateInputReadiness(
  input: AutoScheduleInput,
): { ok: true; eligibleStaff: Readonly<Staff>[] } | { ok: false; result: AutoScheduleResult } {
  const missingInputs: MissingInputCode[] = [];
  if (input.demand === null) missingInputs.push('DEMAND');
  if (input.shifts.length === 0) missingInputs.push('SHIFTS');

  const eligibleStaff = input.staff
    .filter(isStaffEligible)
    .slice()
    .sort((a, b) => compareStringsLex(a.id, b.id));

  if (eligibleStaff.length === 0) missingInputs.push('ELIGIBLE_STAFF');
  if (!Number.isFinite(input.targetTxnsPerStaffHour) || input.targetTxnsPerStaffHour <= 0) {
    missingInputs.push('INVALID_N');
  }

  if (missingInputs.length > 0) {
    return {
      ok: false,
      result: {
        status: 'FAILED',
        reasonCode: 'MISSING_INPUT',
        missingInputs,
        message: `Cannot run Auto-schedule: missing or invalid inputs (${missingInputs.join(', ')}).`,
      },
    };
  }

  for (const s of input.staff) {
    if (!Number.isSafeInteger(s.maxWeeklyHours) || s.maxWeeklyHours < 0) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'UNEXPECTED_ERROR',
          message: `Invalid maxWeeklyHours for staff "${s.id}".`,
        },
      };
    }
  }

  return { ok: true, eligibleStaff };
}

function buildRequiredGrids(
  input: AutoScheduleInput,
):
  | { ok: true; requiredGrid: Float64Array; txnsGrid: Float64Array; totalRequiredBigInt: bigint }
  | { ok: false; result: AutoScheduleResult } {
  const demand = input.demand!;
  const requiredGrid = new Float64Array(7 * 16);
  const txnsGrid = new Float64Array(7 * 16);
  let totalRequiredBigInt = 0n;

  for (const d of DAYS_OF_WEEK) {
    for (const h of OPERATING_HOURS) {
      const txns = demand.transactions[d][h];
      const reqRes = computeRequiredStaff(txns, input.targetTxnsPerStaffHour);
      if (!reqRes.ok) {
        return {
          ok: false,
          result: {
            status: 'FAILED',
            reasonCode: 'UNEXPECTED_ERROR',
            message:
              reqRes.error === 'SAFE_INTEGER_OVERFLOW'
                ? `SAFE_INTEGER_OVERFLOW: RequiredStaff overflowed at day ${d}, hour ${h}.`
                : `Invalid demand transaction or target N at day ${d}, hour ${h}.`,
          },
        };
      }

      const idx = d * 16 + (h - 7);
      requiredGrid[idx] = reqRes.value;
      txnsGrid[idx] = txns;
      totalRequiredBigInt += BigInt(reqRes.value);
      if (totalRequiredBigInt > MAX_SAFE_BIGINT) {
        return {
          ok: false,
          result: {
            status: 'FAILED',
            reasonCode: 'UNEXPECTED_ERROR',
            message: 'SAFE_INTEGER_OVERFLOW: totalRequiredStaffHours exceeded Number.MAX_SAFE_INTEGER.',
          },
        };
      }
    }
  }

  return { ok: true, requiredGrid, txnsGrid, totalRequiredBigInt };
}

function initializeWorkingState(
  input: AutoScheduleInput,
  eligibleStaff: readonly Readonly<Staff>[],
  requiredGrid: Float64Array,
  txnsGrid: Float64Array,
): { state: SchedulerWorkingState; pinnedAssignments: Assignment[] } {
  const sortedShifts: Readonly<ShiftTemplate>[] = input.shifts.slice().sort((a, b) => {
    if (a.startHour !== b.startHour) return a.startHour - b.startHour;
    if (a.endHour !== b.endHour) return a.endHour - b.endHour;
    return compareStringsLex(a.id, b.id);
  });

  const shiftMap = new Map(sortedShifts.map((sh) => [sh.id, sh]));
  const shiftDayMask = new Uint8Array(sortedShifts.length);
  for (let sIdx = 0; sIdx < sortedShifts.length; sIdx++) {
    shiftDayMask[sIdx] = getShiftDayMask(sortedShifts[sIdx]!);
  }

  const eligibleCount = eligibleStaff.length;
  const staffIdxById = new Map<string, number>();
  const maxHours = new Float64Array(eligibleCount);
  const assignedHours = new Int32Array(eligibleCount);
  const dayOccupied = new Uint8Array(eligibleCount * 7);
  const unavailableMask = new Uint8Array(eligibleCount);

  for (let i = 0; i < eligibleCount; i++) {
    const s = eligibleStaff[i]!;
    staffIdxById.set(s.id, i);
    maxHours[i] = s.maxWeeklyHours;
    unavailableMask[i] = getStaffUnavailableMask(s);
  }

  const pinnedAssignments: Assignment[] = [];
  const staffHoursGrid = new Uint32Array(7 * 16);

  for (const a of input.existingAssignments) {
    if (!a.isPinned) continue;
    pinnedAssignments.push({ id: a.id, day: a.day, shiftId: a.shiftId, staffId: a.staffId, isPinned: true });

    const shift = shiftMap.get(a.shiftId);
    if (!shift) continue;
    const sIdx = staffIdxById.get(a.staffId);
    if (sIdx !== undefined) {
      dayOccupied[sIdx * 7 + a.day] = 1;
      assignedHours[sIdx] = assignedHours[sIdx]! + (shift.endHour - shift.startHour);
    }

    const dayOffset = a.day * 16;
    for (let h = shift.startHour; h < shift.endHour; h++) {
      const idx = dayOffset + (h - 7);
      staffHoursGrid[idx] = staffHoursGrid[idx]! + 1;
    }
  }

  const state: SchedulerWorkingState = {
    eligibleStaff,
    sortedShifts,
    requiredGrid,
    txnsGrid,
    staffHoursGrid,
    maxHours,
    assignedHours,
    dayOccupied,
    shiftDayMask,
    unavailableMask,
    sumU: 0,
    sumU2: 0,
    workingNew: [],
  };
  recomputeUtilizationSums(state);
  return { state, pinnedAssignments };
}

function assignGeneratedIds(
  state: SchedulerWorkingState,
  pinnedAssignments: readonly Assignment[],
  idGenerator: () => string,
): { ok: true; generatedAssignments: Assignment[] } | { ok: false; result: AutoScheduleResult } {
  const seenIds = new Set(pinnedAssignments.map((p) => p.id));
  const generatedAssignments: Assignment[] = [];

  for (const w of state.workingNew) {
    let newId: string;
    try {
      newId = idGenerator();
    } catch (err) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: `idGenerator threw an error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    if (typeof newId !== 'string' || newId.trim().length === 0) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: 'idGenerator returned an empty or invalid ID.',
        },
      };
    }

    if (seenIds.has(newId)) {
      return {
        ok: false,
        result: {
          status: 'FAILED',
          reasonCode: 'CANDIDATE_VALIDATION_FAILED',
          message: `idGenerator produced a duplicate ID "${newId}".`,
        },
      };
    }

    seenIds.add(newId);
    generatedAssignments.push({
      id: newId,
      day: w.day,
      shiftId: w.shiftId,
      staffId: state.eligibleStaff[w.staffIdx]!.id,
      isPinned: false,
    });
  }

  return { ok: true, generatedAssignments };
}

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
  if (!readiness.ok) {
    if (observer) {
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
    }
    return readiness.result;
  }

  if (observer) {
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

  // 2. Pin Conflict Gate (E-03, F-07)
  const conflicts = checkPinConflicts(input);
  if (conflicts.length > 0) {
    if (observer) {
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
    }
    return { status: 'BLOCKED_PIN_CONFLICT', conflicts };
  }

  if (observer) {
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

  // 3. Build RequiredStaff & Transactions grids (BigInt exact ceiling)
  const grids = buildRequiredGrids(input);
  if (!grids.ok) {
    if (observer) {
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
    }
    return grids.result;
  }

  if (observer) {
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

  // 4. Stage 1: Greedy Coverage Construction (Gaps -> Deficit)
  const { state, pinnedAssignments } = initializeWorkingState(
    input,
    readiness.eligibleStaff,
    grids.requiredGrid,
    grids.txnsGrid,
  );

  let pinnedSnapshots: TraceAssignmentSnapshot[] = [];
  if (observer) {
    const staffNameById = new Map(input.staff.map((s) => [s.id, s.name]));
    const shiftById = new Map(input.shifts.map((sh) => [sh.id, sh]));
    const pad = (h: number) => String(h).padStart(2, '0');
    pinnedSnapshots = pinnedAssignments.flatMap((p) => {
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
    if (observer) {
      observer.emit({
        stageId: 'stage_3_validation',
        stageLabel: 'Kiểm định & Xuất kết quả',
        kind: 'validation',
        status: 'error',
        title: 'Lỗi cấp phát ID cho ca mới',
        narrative: idRes.result.status === 'FAILED' ? idRes.result.message : 'Lỗi idGenerator.',
        metrics: [],
        debugPayload: { result: idRes.result },
      });
    }
    return idRes.result;
  }

  const candidateAssignments: Assignment[] = [...pinnedAssignments, ...idRes.generatedAssignments];
  const validation = validateCandidateAssignments(candidateAssignments, input, stage1StaffHoursGrid);
  if (!validation.ok) {
    if (observer) {
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
    }
    return { status: 'FAILED', reasonCode: 'CANDIDATE_VALIDATION_FAILED', message: validation.message };
  }

  if (observer) {
    const valMetrics = computeTraceSummaryMetrics(state);
    observer.emit({
      stageId: 'stage_3_validation',
      stageLabel: 'Kiểm định & Xuất kết quả',
      kind: 'validation',
      status: 'ok',
      title: `Vượt qua 5-Invariant Candidate Validation (${candidateAssignments.length} ca)`,
      narrative: `Bộ kiểm định độc lập đã xác nhận 5 bất biến an toàn: bảo toàn 100% ca ghim, không trùng ngày, không vượt giờ tuần, ID duy nhất và lưới 112 ô khớp tuyệt đối sau Stage 2.`,
      metrics: valMetrics.metrics,
      grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
      entities: snapshotTraceEntities(state),
      assignments: snapshotTraceAssignments(state, pinnedSnapshots),
      stateDiff: [
        '5/5 bất biến an toàn: PASS',
        `pinned=${pinnedAssignments.length}, generated=${idRes.generatedAssignments.length}`,
      ],
      debugPayload: {
        preservedPinnedCount: pinnedAssignments.length,
        generatedAssignmentsCount: idRes.generatedAssignments.length,
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
    const outMetrics = computeTraceSummaryMetrics(state);
    observer.emit({
      stageId: 'stage_3_validation',
      stageLabel: 'Kiểm định & Xuất kết quả',
      kind: 'output',
      status: 'ok',
      title: `Hoàn tất xếp lịch: ${candidateAssignments.length} ca · Phủ ${outMetrics.coveragePct}% · Jain ${outMetrics.jainIndex}`,
      narrative: `Thuật toán hoàn thành toàn bộ quy trình (${idRes.generatedAssignments.length} ca mới + ${pinnedAssignments.length} ca ghim, ${rebalanceIterationsRun} vòng cân bằng — ${rebalanceStopReason}). Sẵn sàng commit nguyên tử (atomic replace).`,
      metrics: outMetrics.metrics,
      grid: snapshotTraceGrid(state.requiredGrid, state.staffHoursGrid, undefined, state.txnsGrid),
      entities: snapshotTraceEntities(state),
      assignments: snapshotTraceAssignments(state, pinnedSnapshots),
      debugPayload: { diagnostics: diagRes.diagnostics },
    });
  }

  return { status: 'SUCCESS', assignments: candidateAssignments, diagnostics: diagRes.diagnostics };
}
