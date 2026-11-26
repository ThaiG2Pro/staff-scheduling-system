import { runAutoSchedule } from '../../../../src/domain/autoScheduler';
import { parseCsvTransactions } from '../../../../src/domain/csvParser';
import { createDemoStoreSchedule, DEMO_STORE_CSV_TEXT } from '../../../../src/domain/demoData';
import type { TraceRun } from '../../../../src/domain/schedulerTrace';
import type { Assignment, DemandDataset, Schedule } from '../../../../src/domain/types';
import { loadState, saveState } from '../../../../src/persistence/localStorageAdapter';
import {
  CURRENT_SCHEMA_VERSION,
  PRIMARY_STORAGE_KEY,
  RECOVERY_BACKUP_KEY,
  type PersistedAppState,
  type StorageLike,
} from '../../../../src/persistence/storageTypes';
import {
  buildComplexFlagship25StaffFixture,
  buildComplexMixedShiftsFixture,
  buildComplexUncoverableGapFixture,
  buildPhase2MrvAvailabilityFixture,
  buildPhase2ShiftActiveDaysFixture,
  type ComplexFixture,
} from './complexFixtures';
import type { ScenarioPresetId } from './scenarioPresets';
import { TraceCollector } from './traceCollector';

/** Isolated in-memory Storage sandbox so simulator never touches real browser localStorage. */
class SandboxStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.map.entries()) {
      out[k] = v.length > 240 ? `${v.slice(0, 240)}… (${v.length} chars)` : v;
    }
    return out;
  }
}

function makeDeterministicIdGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export interface RunScenarioParams {
  readonly presetId: ScenarioPresetId;
  readonly targetN: number;
  readonly customCsvText?: string;
  readonly customCsvFileName?: string;
}

export function runSimulationScenario(params: RunScenarioParams): TraceRun {
  const collector = new TraceCollector();
  const sandbox = new SandboxStorage();
  const nowIso = () => '2026-08-07T09:00:00.000Z';

  // --- Special Scenario: Corrupted LocalStorage Lock ---
  if (params.presetId === 'storage_corrupt_lock') {
    const corruptPayload = '{"schemaVersion": 1, "activeScheduleId": 12345, "schedules": "CORRUPTED"}';
    sandbox.setItem(PRIMARY_STORAGE_KEY, corruptPayload);

    const loadRes = loadState(() => sandbox);
    collector.emit({
      stageId: 'stage_storage',
      stageLabel: 'Lưu trữ (Storage I/O)',
      kind: 'storage_io',
      status: 'blocked',
      title: `Phát hiện dữ liệu hỏng → Khóa Auto-Save (${loadRes.storageMode})`,
      narrative: `Khi khởi động, bộ kiểm định phát hiện payload tại khóa "${PRIMARY_STORAGE_KEY}" bị hỏng cấu trúc. Hệ thống tự động sao lưu nguyên văn sang "${RECOVERY_BACKUP_KEY}" và khóa mọi thao tác ghi đè để bảo vệ dữ liệu người dùng.`,
      metrics: [
        { key: 'backupSaved', label: 'Sao lưu khôi phục', value: loadRes.backupSaved ? 1 : 0 },
      ],
      debugPayload: {
        storageMode: loadRes.storageMode,
        saveStatus: loadRes.saveStatus,
        backupSaved: loadRes.backupSaved,
        errorMessage: loadRes.errorMessage,
        sandboxKeys: sandbox.snapshot(),
      },
    });

    const autoSaveBlocked = loadRes.storageMode !== 'normal';
    collector.emit({
      stageId: 'stage_storage',
      stageLabel: 'Lưu trữ (Storage I/O)',
      kind: 'storage_io',
      status: 'blocked',
      title: `Chặn ghi đè xuống Storage (saveStatus: ${loadRes.saveStatus})`,
      narrative: `Vì storageMode đang ở "${loadRes.storageMode}", lớp State tuyệt đối không gọi saveState() để tránh ghi đè dữ liệu hỏng cho đến khi người dùng xác nhận Reset rõ ràng.`,
      metrics: [],
      debugPayload: {
        autoSaveBlocked,
        storageMode: loadRes.storageMode,
        saveStatus: loadRes.saveStatus,
        primaryKeyIntact: sandbox.getItem(PRIMARY_STORAGE_KEY) === corruptPayload,
      },
    });

    return collector.build('Kịch bản lỗi: Storage hỏng (recovery_locked)', 'BLOCKED');
  }

  // --- Seed initial Schedule & persist into Sandbox Storage ---
  const complexFixture: ComplexFixture | null =
    params.presetId === 'phase2_mrv_availability'
      ? buildPhase2MrvAvailabilityFixture()
      : params.presetId === 'phase2_shift_active_days'
        ? buildPhase2ShiftActiveDaysFixture()
        : params.presetId === 'complex_mixed_shifts_swap'
          ? buildComplexMixedShiftsFixture()
          : params.presetId === 'complex_uncoverable_gap'
            ? buildComplexUncoverableGapFixture()
            : params.presetId === 'complex_heavy_25_staff'
              ? buildComplexFlagship25StaffFixture()
              : null;

  const baseSchedule: Schedule = createDemoStoreSchedule({
    nowIso,
    generateId: makeDeterministicIdGen('seed'),
  });

  let scheduleStaff = complexFixture ? complexFixture.staff.slice() : baseSchedule.staff;
  let pinnedAssignments: Assignment[] = [];
  if (complexFixture) {
    pinnedAssignments = complexFixture.pinnedAssignments.slice();
  } else if (params.presetId === 'demo_with_pins') {
    const s0 = baseSchedule.staff[0]!;
    const s1 = baseSchedule.staff[1]!;
    const sh0 = baseSchedule.shifts[0]!;
    const sh1 = baseSchedule.shifts[1]!;
    pinnedAssignments = [
      { id: 'pin-mon-s0', day: 0, shiftId: sh0.id, staffId: s0.id, isPinned: true },
      { id: 'pin-fri-s1', day: 4, shiftId: sh1.id, staffId: s1.id, isPinned: true },
    ];
  } else if (params.presetId === 'pin_conflict_e03') {
    const s0 = baseSchedule.staff[0]!;
    const sh0 = baseSchedule.shifts[0]!;
    const sh1 = baseSchedule.shifts[1]!;
    pinnedAssignments = [
      { id: 'pin-conflict-1', day: 0, shiftId: sh0.id, staffId: s0.id, isPinned: true },
      { id: 'pin-conflict-2', day: 0, shiftId: sh1.id, staffId: s0.id, isPinned: true },
    ];
  } else if (params.presetId === 'pin_conflict_unavailable') {
    const s0 = baseSchedule.staff[0]!;
    const sh0 = baseSchedule.shifts[0]!;
    scheduleStaff = baseSchedule.staff.map((st, idx) =>
      idx === 0 ? { ...st, unavailableDays: [0] } : st,
    );
    pinnedAssignments = [
      { id: 'pin-unavail-mon', day: 0, shiftId: sh0.id, staffId: s0.id, isPinned: true },
    ];
  }

  const initialSchedule: Schedule = {
    ...baseSchedule,
    name: complexFixture ? complexFixture.label : baseSchedule.name,
    staff: scheduleStaff,
    shifts: complexFixture ? complexFixture.shifts.slice() : baseSchedule.shifts,
    targetTxnsPerStaffHour: params.targetN,
    assignments: pinnedAssignments,
  };

  const initialPersisted: PersistedAppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeScheduleId: initialSchedule.id,
    schedules: [initialSchedule],
  };
  sandbox.setItem(PRIMARY_STORAGE_KEY, JSON.stringify(initialPersisted));

  // Step 0A: Load & Hydrate from Sandbox Storage
  const hydrated = loadState(() => sandbox);
  collector.emit({
    stageId: 'stage_storage',
    stageLabel: 'Lưu trữ (Storage I/O)',
    kind: 'storage_io',
    status: 'ok',
    title: `Đọc & kiểm định trạng thái từ LocalStorage (${hydrated.storageMode})`,
    narrative: `Nạp thành công ${hydrated.state.schedules.length} lịch làm việc (schemaVersion: ${hydrated.state.schemaVersion}) từ "${PRIMARY_STORAGE_KEY}" với ${initialSchedule.staff.length} nhân viên và ${initialSchedule.shifts.length} mẫu ca.`,
    metrics: [
      { key: 'staffCount', label: 'Nhân viên', value: initialSchedule.staff.length, unit: 'người' },
      { key: 'pinnedCount', label: 'Ca ghim sẵn', value: pinnedAssignments.length, unit: 'ca' },
    ],
    debugPayload: {
      storageMode: hydrated.storageMode,
      saveStatus: hydrated.saveStatus,
      storageKey: PRIMARY_STORAGE_KEY,
      activeScheduleId: hydrated.state.activeScheduleId,
    },
  });

  // Step 0B: Parse CSV Demand (custom, complex fixture, or Demo Store CSV)
  const csvText = params.customCsvText ?? complexFixture?.csvText ?? DEMO_STORE_CSV_TEXT;
  const csvFileName =
    params.customCsvFileName ?? complexFixture?.csvFileName ?? 'Demo Store (sample_transaction.csv)';
  const csvRes = parseCsvTransactions(csvText);

  if (!csvRes.ok) {
    collector.emit({
      stageId: 'stage_0_gates',
      stageLabel: 'Kiểm tra đầu vào',
      kind: 'input_gate',
      status: 'error',
      title: `Lỗi đọc CSV (${csvRes.errors.length} lỗi · E-01)`,
      narrative: `File "${csvFileName}" không hợp lệ theo chuẩn RFC 4180 / 7×16. Dữ liệu nhu cầu cũ trong Schedule được giữ nguyên 100% (Atomic Preserve-on-Error).`,
      metrics: [{ key: 'csvErrors', label: 'Lỗi CSV', value: csvRes.errors.length, unit: 'lỗi' }],
      candidates: csvRes.errors.slice(0, 6).map((err, idx) => ({
        id: `csv-err-${idx}`,
        label: `Dòng ${err.row ?? '?'} · Cột ${err.column ?? '?'}`,
        status: 'REJECTED' as const,
        reason: err.message,
        scores: { day: err.dayLabel ?? '-', hour: err.hourLabel ?? '-' },
      })),
      debugPayload: { fileName: csvFileName, errors: csvRes.errors },
    });
    return collector.build(`CSV lỗi: ${csvFileName}`, 'FAILED');
  }

  const parsedDemand: DemandDataset = {
    importedAt: nowIso(),
    sourceFileName: csvFileName,
    transactions: csvRes.transactions,
  };

  collector.emit({
    stageId: 'stage_0_gates',
    stageLabel: 'Kiểm tra đầu vào',
    kind: 'input_gate',
    status: 'ok',
    title: `Đọc CSV thành công: ${csvRes.totalTransactions.toLocaleString('vi-VN')} giao dịch`,
    narrative: `Bộ phân tích RFC 4180 đã đọc đủ ma trận 7 ngày × 16 giờ (112 ô) từ "${csvFileName}", tổng cộng ${csvRes.totalTransactions.toLocaleString('vi-VN')} giao dịch trong tuần.`,
    metrics: [
      { key: 'totalTransactions', label: 'Tổng giao dịch', value: csvRes.totalTransactions, unit: 'gd' },
    ],
    debugPayload: {
      fileName: csvFileName,
      totalTransactions: csvRes.totalTransactions,
      cellsParsed: 112,
    },
  });

  // Step 1..6: Run real deterministic Auto-Scheduler with TraceCollector
  const solverResult = runAutoSchedule(
    {
      demand: parsedDemand,
      staff: initialSchedule.staff,
      shifts: initialSchedule.shifts,
      existingAssignments: initialSchedule.assignments,
      targetTxnsPerStaffHour: params.targetN,
      idGenerator: makeDeterministicIdGen('auto'),
    },
    { observer: collector },
  );

  // Step 7: Atomic Persistence Commit or Rollback
  if (solverResult.status === 'SUCCESS') {
    const updatedSchedule: Schedule = {
      ...initialSchedule,
      demand: parsedDemand,
      assignments: solverResult.assignments,
      updatedAt: '2026-08-07T09:00:01.000Z',
    };
    const nextPersisted: PersistedAppState = {
      ...hydrated.state,
      schedules: [updatedSchedule],
    };
    const saveRes = saveState(nextPersisted, () => sandbox);

    collector.emit({
      stageId: 'stage_storage_commit',
      stageLabel: 'Lưu kết quả (Atomic Save)',
      kind: 'storage_io',
      status: saveRes.ok ? 'ok' : 'error',
      title: `Ghi nguyên tử ${solverResult.assignments.length} ca xuống LocalStorage (${saveRes.ok ? 'saved' : 'save_error'})`,
      narrative: `Chỉ ghi dữ liệu nguồn (Domain Source of Truth) xuống "${PRIMARY_STORAGE_KEY}". Toàn bộ chỉ số dẫn xuất (Derived Metrics) sẽ được tính động lại qua pure selectors, không bao giờ lưu thừa.`,
      metrics: [
        { key: 'savedAssignments', label: 'Ca đã lưu', value: solverResult.assignments.length, unit: 'ca' },
      ],
      debugPayload: {
        saveStatus: saveRes.ok ? 'saved' : 'save_error',
        ...(saveRes.ok ? {} : { error: saveRes.error }),
        persistedKeys: Object.keys(sandbox.snapshot()),
        payloadBytes: sandbox.getItem(PRIMARY_STORAGE_KEY)?.length ?? 0,
      },
    });

    const label = params.customCsvFileName
      ? `CSV tùy chỉnh: ${params.customCsvFileName} (N=${params.targetN})`
      : `${params.presetId} (N=${params.targetN})`;
    return collector.build(label, 'SUCCESS');
  }

  // Blocked or Failed: prove storage remained untouched
  collector.emit({
    stageId: 'stage_storage_commit',
    stageLabel: 'Bảo toàn trạng thái cũ',
    kind: 'storage_io',
    status: 'blocked',
    title: 'Không ghi đè Storage — Giữ nguyên 100% lịch cũ (Atomic Guard)',
    narrative: `Do thuật toán trả về "${solverResult.status}", hệ thống hủy bỏ toàn bộ trạng thái nháp. Schedule.assignments và dữ liệu trong "${PRIMARY_STORAGE_KEY}" giữ nguyên không thay đổi.`,
    metrics: [],
    debugPayload: {
      solverStatus: solverResult.status,
      storageUnchanged: true,
    },
  });

  return collector.build(
    `${params.presetId} (N=${params.targetN})`,
    solverResult.status === 'BLOCKED_PIN_CONFLICT' ? 'BLOCKED' : 'FAILED',
  );
}
