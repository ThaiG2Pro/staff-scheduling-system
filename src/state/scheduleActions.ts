/**
 * @file Pure immutable application actions for Schedules, CSV Import, and Atomic Auto-schedule.
 * Enforces Strict Schedule Scoping, `updatedAt` mutation rules (never updated on navigation),
 * Atomic Auto-schedule Commit, and Revision Guard.
 */

import { runAutoSchedule } from '../domain/autoScheduler';
import { DEFAULT_TARGET_N } from '../domain/constants';
import { parseCsvTransactions } from '../domain/csvParser';
import { isValidTargetN } from '../domain/decimalMath';
import { createDefaultShiftTemplates, createDemoStoreSchedule } from '../domain/demoData';
import type { AutoScheduleResult, DemandDataset, Schedule } from '../domain/types';
import type { PersistedAppState } from '../persistence/storageTypes';
import {
  DEFAULT_ACTION_DEPS,
  type ActionDeps,
  type AutoScheduleActionResult,
  type CsvImportActionResult,
  type StateActionResult,
} from './actionTypes';

function findSchedule(state: Readonly<PersistedAppState>, scheduleId: string): Schedule | undefined {
  return state.schedules.find((s) => s.id === scheduleId);
}

function replaceSchedule(
  state: Readonly<PersistedAppState>,
  updatedSchedule: Schedule,
): PersistedAppState {
  return {
    ...state,
    schedules: state.schedules.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s)),
  };
}

/**
 * Creates a new empty schedule seeded with 2 default shift templates (`07:00–15:00`, `15:00–23:00`)
 * and selects it as `activeScheduleId`.
 */
export function createSchedule(
  state: Readonly<PersistedAppState>,
  name: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ scheduleId: string }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Schedule name cannot be empty.' };
  }

  const now = deps.nowIso();
  const schedule: Schedule = {
    id: deps.generateId(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    targetTxnsPerStaffHour: DEFAULT_TARGET_N,
    staff: [],
    shifts: createDefaultShiftTemplates(deps.generateId),
    demand: null,
    assignments: [],
  };

  return {
    ok: true,
    state: {
      ...state,
      activeScheduleId: schedule.id,
      schedules: [...state.schedules, schedule],
    },
    changed: true,
    scheduleId: schedule.id,
  };
}

/** Creates and activates a realistic Demo Store schedule (sample CSV + 9 staff + 2 default shifts). */
export function loadDemoStore(
  state: Readonly<PersistedAppState>,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): { ok: true; state: PersistedAppState; scheduleId: string } {
  const demoSchedule = createDemoStoreSchedule(deps);
  return {
    ok: true,
    state: {
      ...state,
      activeScheduleId: demoSchedule.id,
      schedules: [...state.schedules, demoSchedule],
    },
    scheduleId: demoSchedule.id,
  };
}

/** Renames an existing schedule and updates its `updatedAt` timestamp. */
export function renameSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  name: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Schedule name cannot be empty.' };

  const updated: Schedule = { ...schedule, name: trimmed, updatedAt: deps.nowIso() };
  return { ok: true, state: replaceSchedule(state, updated), changed: true };
}

/** Deletes a schedule and clears `activeScheduleId` if the deleted schedule was active. */
export function deleteSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
): StateActionResult {
  const exists = state.schedules.some((s) => s.id === scheduleId);
  if (!exists) return { ok: false, error: 'Schedule not found.' };

  return {
    ok: true,
    state: {
      ...state,
      activeScheduleId: state.activeScheduleId === scheduleId ? null : state.activeScheduleId,
      schedules: state.schedules.filter((s) => s.id !== scheduleId),
    },
    changed: true,
  };
}

/**
 * Updates `activeScheduleId` navigation metadata without modifying any `Schedule.updatedAt`.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Target schedule ID or `null` to return to Schedule List.
 * @returns Updated state with `activeScheduleId` set, or error if ID does not exist.
 */
export function setActiveSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string | null,
): StateActionResult {
  if (scheduleId !== null && !state.schedules.some((s) => s.id === scheduleId)) {
    return { ok: false, error: 'Schedule not found.' };
  }
  if (state.activeScheduleId === scheduleId) {
    return { ok: true, state, changed: false };
  }
  return {
    ok: true,
    state: {
      ...state,
      activeScheduleId: scheduleId,
    },
    changed: true,
  };
}

/** Updates `targetTxnsPerStaffHour` (`N ∈ [1, 500]`) for the specified schedule. */
export function setTargetTxnsPerStaffHour(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  targetN: number,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };
  if (!isValidTargetN(targetN)) {
    return { ok: false, error: 'Target transactions per staff-hour must be between 1 and 500.' };
  }

  const updated: Schedule = {
    ...schedule,
    targetTxnsPerStaffHour: targetN,
    updatedAt: deps.nowIso(),
  };
  return { ok: true, state: replaceSchedule(state, updated), changed: true };
}

/**
 * Parses raw CSV text and atomically replaces `Schedule.demand` on success (E-01).
 * On parse failure, leaves existing `Schedule.demand` and `updatedAt` completely untouched.
 */
export function importCsvToSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  csvText: string,
  sourceFileName: string | undefined,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): CsvImportActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { ok: false, errors: [{ message: 'Schedule not found.' }] };
  }

  const parsed = parseCsvTransactions(csvText);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  const now = deps.nowIso();
  const demand: DemandDataset = {
    importedAt: now,
    transactions: parsed.transactions,
    ...(sourceFileName !== undefined ? { sourceFileName } : {}),
  };

  const updated: Schedule = {
    ...schedule,
    updatedAt: now,
    demand,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    totalTransactions: parsed.totalTransactions,
  };
}

/**
 * Commits a `SUCCESS` auto-schedule result atomically if `currentRevision === snapshotRevision`.
 * Used both synchronously and as the Revision Guard for asynchronous Worker execution.
 */
export function commitAutoScheduleWithRevision(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  result: AutoScheduleResult,
  snapshotRevision: number,
  currentRevision: number,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): AutoScheduleActionResult {
  if (result.status !== 'SUCCESS' || snapshotRevision !== currentRevision) {
    return { state, committed: false, result };
  }

  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { state, committed: false, result };
  }

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: result.assignments,
  };

  return {
    state: replaceSchedule(state, updated),
    committed: true,
    result,
  };
}

/**
 * Executes `runAutoSchedule` on the target schedule and atomically commits candidate assignments
 * only when the solver returns `status === 'SUCCESS'`. On `BLOCKED_PIN_CONFLICT` or `FAILED`,
 * returns the original `state` untouched (preserving `assignments` and `updatedAt`).
 */
export function executeAutoSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): AutoScheduleActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return {
      state,
      committed: false,
      result: {
        status: 'FAILED',
        reasonCode: 'UNEXPECTED_ERROR',
        message: 'Schedule not found.',
      },
    };
  }

  const result = runAutoSchedule({
    demand: schedule.demand,
    staff: schedule.staff,
    shifts: schedule.shifts,
    existingAssignments: schedule.assignments,
    targetTxnsPerStaffHour: schedule.targetTxnsPerStaffHour,
    idGenerator: deps.generateId,
  });

  return commitAutoScheduleWithRevision(state, scheduleId, result, 0, 0, deps);
}
