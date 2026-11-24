/**
 * @file React state hook store initialized cleanly from pre-loaded `bootstrapState`.
 * Enforces auto-save gating (`storageMode === 'normal'`), Atomic Reset Contract,
 * storage retry, per-schedule revision tracking, and memoized `ScheduleViewModel` derivation.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  deriveScheduleListSummaries,
  deriveScheduleViewModel,
} from '../domain/derivedMetrics';
import type {
  Assignment,
  DayOfWeek,
  DeletePreview,
  Schedule,
  ScheduleDerivationResult,
  ScheduleListItemSummary,
} from '../domain/types';
import { loadState, resetStorageAtomic, saveState } from '../persistence/localStorageAdapter';
import type {
  LoadStateResult,
  PersistedAppState,
  SaveStatus,
  StorageLike,
  StorageMode,
} from '../persistence/storageTypes';
import {
  DEFAULT_ACTION_DEPS,
  type ActionDeps,
  type AutoScheduleActionResult,
  type CsvImportActionResult,
  type StateActionResult,
} from './actionTypes';
import {
  assignStaffToShift,
  reassignStaff,
  restoreAssignmentsSnapshot,
  setBulkPinAssignments,
  togglePinAssignment,
  unassignStaff,
} from './assignmentActions';
import {
  createSchedule,
  deleteSchedule,
  executeAutoSchedule,
  importCsvToSchedule,
  loadDemoStore,
  renameSchedule,
  setActiveSchedule,
  setTargetTxnsPerStaffHour,
} from './scheduleActions';
import {
  addShiftTemplate,
  addStaff,
  deleteShiftTemplate,
  deleteStaff,
  previewDeleteShiftInSchedule,
  previewDeleteStaffInSchedule,
  previewEditShiftInSchedule,
  updateShiftTemplate,
  updateStaff,
} from './scheduleEntityActions';

export interface StoreOptions {
  deps?: ActionDeps;
  getStorage?: () => StorageLike | null;
}

export interface ScheduleStore {
  persisted: PersistedAppState;
  storageMode: StorageMode;
  saveStatus: SaveStatus;
  rawPayload: string | null;
  storageErrorMessage: string | null;
  hydrationWarnings: string[];
  scheduleRevision: Record<string, number>;
  scheduleListSummaries: ScheduleListItemSummary[];
  activeSchedule: Schedule | null;
  activeViewModelResult: ScheduleDerivationResult | null;
  resetStorage: () => { ok: boolean; error?: string };
  retryStorageAccess: () => LoadStateResult;
  createSchedule: (name: string) => StateActionResult<{ scheduleId: string }>;
  loadDemoStore: () => { ok: true; state: PersistedAppState; scheduleId: string } | { ok: false; error: string };
  renameSchedule: (scheduleId: string, name: string) => StateActionResult;
  deleteSchedule: (scheduleId: string) => StateActionResult;
  setActiveSchedule: (scheduleId: string | null) => StateActionResult;
  setTargetTxnsPerStaffHour: (scheduleId: string, targetN: number) => StateActionResult;
  addStaff: (scheduleId: string, input: { name: string; maxWeeklyHours: number }) => StateActionResult<{ staffId: string }>;
  updateStaff: (scheduleId: string, staffId: string, input: { name: string; maxWeeklyHours: number }) => StateActionResult;
  previewDeleteStaff: (scheduleId: string, staffId: string) => DeletePreview;
  deleteStaff: (scheduleId: string, staffId: string) => StateActionResult<{ removedAssignmentsCount: number }>;
  addShiftTemplate: (scheduleId: string, input: { startHour: number; endHour: number }) => StateActionResult<{ shiftId: string }>;
  previewEditShift: (scheduleId: string, shiftId: string) => DeletePreview;
  updateShiftTemplate: (scheduleId: string, shiftId: string, input: { startHour: number; endHour: number }) => StateActionResult;
  previewDeleteShift: (scheduleId: string, shiftId: string) => DeletePreview;
  deleteShiftTemplate: (scheduleId: string, shiftId: string) => StateActionResult<{ removedAssignmentsCount: number }>;
  assignStaffToShift: (scheduleId: string, input: { day: DayOfWeek; shiftId: string; staffId: string }) => StateActionResult<{ assignmentId: string }>;
  unassignStaff: (scheduleId: string, assignmentId: string) => StateActionResult;
  reassignStaff: (scheduleId: string, assignmentId: string, newStaffId: string) => StateActionResult<{ assignmentId: string }>;
  togglePinAssignment: (scheduleId: string, assignmentId: string) => StateActionResult<{ isPinned: boolean }>;
  setBulkPinAssignments: (
    scheduleId: string,
    input: { isPinned: boolean; staffId?: string | null },
  ) => StateActionResult<{ affectedCount: number }>;
  restoreAssignments: (scheduleId: string, snapshot: readonly Assignment[]) => StateActionResult;
  importCsvToSchedule: (scheduleId: string, csvText: string, sourceFileName?: string) => CsvImportActionResult;
  runAutoScheduleForSchedule: (scheduleId: string) => AutoScheduleActionResult;
}

const LOCKED_ERROR = 'Storage is locked. Resolve the storage banner before modifying schedules.';

/**
 * Pure React store hook initialized directly from `bootstrapState` (loaded outside `<StrictMode>`).
 * Never reads or writes `localStorage` inside the React state initializer.
 *
 * @param bootstrapState - Pre-loaded hydration result from `loadState()`.
 * @param options - Optional injected clock/ID dependencies and storage resolver for testing.
 * @returns Reactive store state, memoized derived selectors, and domain/persistence actions.
 */
export function useScheduleStore(
  bootstrapState: LoadStateResult,
  options: StoreOptions = {},
): ScheduleStore {
  const deps = options.deps ?? DEFAULT_ACTION_DEPS;
  const getStorage = options.getStorage;

  const [persisted, setPersisted] = useState<PersistedAppState>(bootstrapState.state);
  const [storageMode, setStorageMode] = useState<StorageMode>(bootstrapState.storageMode);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(bootstrapState.saveStatus);
  const [rawPayload, setRawPayload] = useState<string | null>(bootstrapState.rawPayload);
  const [storageErrorMessage, setStorageErrorMessage] = useState<string | null>(
    bootstrapState.errorMessage,
  );
  const [hydrationWarnings, setHydrationWarnings] = useState<string[]>(bootstrapState.warnings);
  const [scheduleRevision, setScheduleRevision] = useState<Record<string, number>>({});

  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;

  const commitState = useCallback(
    (nextState: PersistedAppState, mutatedScheduleId?: string) => {
      persistedRef.current = nextState;
      setPersisted(nextState);

      if (mutatedScheduleId) {
        setScheduleRevision((prev) => ({
          ...prev,
          [mutatedScheduleId]: (prev[mutatedScheduleId] ?? 0) + 1,
        }));
      }

      if (storageModeRef.current !== 'normal') {
        setSaveStatus('locked');
        return;
      }

      const saveRes = saveState(nextState, getStorage);
      setSaveStatus(saveRes.ok ? 'saved' : 'save_error');
      setStorageErrorMessage(saveRes.ok ? null : saveRes.error);
    },
    [getStorage],
  );

  const runWritable = <TExtra extends object>(
    action: (current: PersistedAppState) => StateActionResult<TExtra>,
    resolveMutatedId?: (res: Extract<StateActionResult<TExtra>, { ok: true }>) => string | undefined,
  ): StateActionResult<TExtra> => {
    if (storageModeRef.current !== 'normal') return { ok: false, error: LOCKED_ERROR };
    const res = action(persistedRef.current);
    if (res.ok && res.changed) {
      commitState(res.state, resolveMutatedId?.(res));
    }
    return res;
  };

  const resetStorage = useCallback(() => {
    const res = resetStorageAtomic(getStorage);
    if (!res.ok) {
      setStorageErrorMessage(res.error);
      return { ok: false, error: res.error };
    }
    persistedRef.current = res.state;
    storageModeRef.current = 'normal';
    setPersisted(res.state);
    setStorageMode('normal');
    setSaveStatus('saved');
    setRawPayload(null);
    setStorageErrorMessage(null);
    setHydrationWarnings([]);
    setScheduleRevision({});
    return { ok: true };
  }, [getStorage]);

  const retryStorageAccess = useCallback(() => {
    const loaded = loadState(getStorage);
    persistedRef.current = loaded.state;
    storageModeRef.current = loaded.storageMode;
    setPersisted(loaded.state);
    setStorageMode(loaded.storageMode);
    setSaveStatus(loaded.saveStatus);
    setRawPayload(loaded.rawPayload);
    setStorageErrorMessage(loaded.errorMessage);
    setHydrationWarnings(loaded.warnings);
    return loaded;
  }, [getStorage]);

  const scheduleListSummaries = useMemo(
    () => deriveScheduleListSummaries(persisted.schedules),
    [persisted.schedules],
  );

  const activeSchedule = useMemo(
    () => persisted.schedules.find((s) => s.id === persisted.activeScheduleId) ?? null,
    [persisted.schedules, persisted.activeScheduleId],
  );

  const activeViewModelResult = useMemo(
    () => (activeSchedule ? deriveScheduleViewModel(activeSchedule) : null),
    [activeSchedule],
  );

  return {
    persisted,
    storageMode,
    saveStatus,
    rawPayload,
    storageErrorMessage,
    hydrationWarnings,
    scheduleRevision,
    scheduleListSummaries,
    activeSchedule,
    activeViewModelResult,
    resetStorage,
    retryStorageAccess,
    createSchedule: (name) =>
      runWritable((cur) => createSchedule(cur, name, deps), (res) => res.scheduleId),
    loadDemoStore: () => {
      if (storageModeRef.current !== 'normal') return { ok: false, error: LOCKED_ERROR };
      const res = loadDemoStore(persistedRef.current, deps);
      commitState(res.state, res.scheduleId);
      return res;
    },
    renameSchedule: (scheduleId, name) =>
      runWritable((cur) => renameSchedule(cur, scheduleId, name, deps), () => scheduleId),
    deleteSchedule: (scheduleId) => runWritable((cur) => deleteSchedule(cur, scheduleId)),
    setActiveSchedule: (scheduleId) => {
      const res = setActiveSchedule(persistedRef.current, scheduleId);
      if (res.ok && res.changed) commitState(res.state);
      return res;
    },
    setTargetTxnsPerStaffHour: (scheduleId, targetN) =>
      runWritable((cur) => setTargetTxnsPerStaffHour(cur, scheduleId, targetN, deps), () => scheduleId),
    addStaff: (scheduleId, input) =>
      runWritable((cur) => addStaff(cur, scheduleId, input, deps), () => scheduleId),
    updateStaff: (scheduleId, staffId, input) =>
      runWritable((cur) => updateStaff(cur, scheduleId, staffId, input, deps), () => scheduleId),
    previewDeleteStaff: (scheduleId, staffId) =>
      previewDeleteStaffInSchedule(persistedRef.current, scheduleId, staffId),
    deleteStaff: (scheduleId, staffId) =>
      runWritable((cur) => deleteStaff(cur, scheduleId, staffId, deps), () => scheduleId),
    addShiftTemplate: (scheduleId, input) =>
      runWritable((cur) => addShiftTemplate(cur, scheduleId, input, deps), () => scheduleId),
    previewEditShift: (scheduleId, shiftId) =>
      previewEditShiftInSchedule(persistedRef.current, scheduleId, shiftId),
    updateShiftTemplate: (scheduleId, shiftId, input) =>
      runWritable((cur) => updateShiftTemplate(cur, scheduleId, shiftId, input, deps), () => scheduleId),
    previewDeleteShift: (scheduleId, shiftId) =>
      previewDeleteShiftInSchedule(persistedRef.current, scheduleId, shiftId),
    deleteShiftTemplate: (scheduleId, shiftId) =>
      runWritable((cur) => deleteShiftTemplate(cur, scheduleId, shiftId, deps), () => scheduleId),
    assignStaffToShift: (scheduleId, input) =>
      runWritable((cur) => assignStaffToShift(cur, scheduleId, input, deps), () => scheduleId),
    unassignStaff: (scheduleId, assignmentId) =>
      runWritable((cur) => unassignStaff(cur, scheduleId, assignmentId, deps), () => scheduleId),
    reassignStaff: (scheduleId, assignmentId, newStaffId) =>
      runWritable((cur) => reassignStaff(cur, scheduleId, assignmentId, newStaffId, deps), () => scheduleId),
    togglePinAssignment: (scheduleId, assignmentId) =>
      runWritable((cur) => togglePinAssignment(cur, scheduleId, assignmentId, deps), () => scheduleId),
    setBulkPinAssignments: (scheduleId, input) =>
      runWritable((cur) => setBulkPinAssignments(cur, scheduleId, input, deps), () => scheduleId),
    restoreAssignments: (scheduleId, snapshot) =>
      runWritable((cur) => restoreAssignmentsSnapshot(cur, scheduleId, snapshot, deps), () => scheduleId),
    importCsvToSchedule: (scheduleId, csvText, sourceFileName) => {
      if (storageModeRef.current !== 'normal') return { ok: false, errors: [{ message: LOCKED_ERROR }] };
      const res = importCsvToSchedule(persistedRef.current, scheduleId, csvText, sourceFileName, deps);
      if (res.ok) commitState(res.state, scheduleId);
      return res;
    },
    runAutoScheduleForSchedule: (scheduleId) => {
      if (storageModeRef.current !== 'normal') {
        return {
          state: persistedRef.current,
          committed: false,
          result: { status: 'FAILED', reasonCode: 'UNEXPECTED_ERROR', message: LOCKED_ERROR },
        };
      }
      const res = executeAutoSchedule(persistedRef.current, scheduleId, deps);
      if (res.committed) commitState(res.state, scheduleId);
      return res;
    },
  };
}
