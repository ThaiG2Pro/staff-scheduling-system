/**
 * @file Strict schedule-scoped manual Assignment actions (Assign, Unassign, Reassign, Pin/Unpin).
 * Enforces unique `(day, shiftId, staffId)` tuples, Reassign-unpins-by-default (E-05),
 * and no-op preservation of `Schedule.updatedAt`.
 */

import type { Assignment, DayOfWeek, Schedule } from '../domain/types';
import type { PersistedAppState } from '../persistence/storageTypes';
import { DEFAULT_ACTION_DEPS, type ActionDeps, type StateActionResult } from './actionTypes';

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
 * Manually assigns a staff member to `(day, shiftId)` with `isPinned = false`.
 * Rejects duplicate `(day, shiftId, staffId)` tuples and invalid references.
 */
export function assignStaffToShift(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  input: { day: DayOfWeek; shiftId: string; staffId: string },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ assignmentId: string }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  if (!schedule.staff.some((st) => st.id === input.staffId)) {
    return { ok: false, error: 'Staff member not found in schedule.' };
  }
  if (!schedule.shifts.some((sh) => sh.id === input.shiftId)) {
    return { ok: false, error: 'Shift template not found in schedule.' };
  }
  const duplicate = schedule.assignments.some(
    (a) => a.day === input.day && a.shiftId === input.shiftId && a.staffId === input.staffId,
  );
  if (duplicate) {
    return { ok: false, error: 'Staff member is already assigned to this shift on this day.' };
  }

  const assignment: Assignment = {
    id: deps.generateId(),
    day: input.day,
    shiftId: input.shiftId,
    staffId: input.staffId,
    isPinned: false,
  };

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: [...schedule.assignments, assignment],
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    changed: true,
    assignmentId: assignment.id,
  };
}

/** Removes an assignment from the specified schedule. */
export function unassignStaff(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  assignmentId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  if (!schedule.assignments.some((a) => a.id === assignmentId)) {
    return { ok: false, error: 'Assignment not found in schedule.' };
  }

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: schedule.assignments.filter((a) => a.id !== assignmentId),
  };

  return { ok: true, state: replaceSchedule(state, updated), changed: true };
}

/**
 * Reassigns an existing assignment to `newStaffId` (E-05).
 * No-op if `newStaffId === oldStaffId` (does not touch `updatedAt`).
 * Otherwise creates a replacement assignment with `isPinned: false` even if the previous assignment was pinned.
 */
export function reassignStaff(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  assignmentId: string,
  newStaffId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ assignmentId: string }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const existing = schedule.assignments.find((a) => a.id === assignmentId);
  if (!existing) return { ok: false, error: 'Assignment not found in schedule.' };

  if (!schedule.staff.some((st) => st.id === newStaffId)) {
    return { ok: false, error: 'Replacement staff member not found in schedule.' };
  }

  if (existing.staffId === newStaffId) {
    return { ok: true, state, changed: false, assignmentId: existing.id };
  }

  const duplicate = schedule.assignments.some(
    (a) =>
      a.id !== assignmentId &&
      a.day === existing.day &&
      a.shiftId === existing.shiftId &&
      a.staffId === newStaffId,
  );
  if (duplicate) {
    return { ok: false, error: 'Replacement staff member is already assigned to this shift.' };
  }

  const replacement: Assignment = {
    id: deps.generateId(),
    day: existing.day,
    shiftId: existing.shiftId,
    staffId: newStaffId,
    isPinned: false,
  };

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: schedule.assignments.map((a) => (a.id === assignmentId ? replacement : a)),
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    changed: true,
    assignmentId: replacement.id,
  };
}

/** Toggles `isPinned` on an assignment within the specified schedule and updates `updatedAt`. */
export function togglePinAssignment(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  assignmentId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ isPinned: boolean }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const existing = schedule.assignments.find((a) => a.id === assignmentId);
  if (!existing) return { ok: false, error: 'Assignment not found in schedule.' };

  const nextPinned = !existing.isPinned;
  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: schedule.assignments.map((a) =>
      a.id === assignmentId ? { ...a, isPinned: nextPinned } : a,
    ),
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    changed: true,
    isPinned: nextPinned,
  };
}

/**
 * Restores an in-memory snapshot of `assignments` for Undo (manual edit or Auto-schedule revert),
 * filtering out any entries whose `staffId` or `shiftId` no longer exist in the schedule.
 */
export function restoreAssignmentsSnapshot(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  snapshot: readonly Assignment[],
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const validStaffIds = new Set(schedule.staff.map((st) => st.id));
  const validShiftIds = new Set(schedule.shifts.map((sh) => sh.id));
  const restored = snapshot
    .filter((a) => validStaffIds.has(a.staffId) && validShiftIds.has(a.shiftId))
    .map((a) => ({ ...a }));

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: restored,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    changed: true,
  };
}

/**
 * Sets `isPinned` atomically across all assignments (or only those matching `staffId`).
 * Preserves `updatedAt` as a no-op if no targeted assignment actually changes state.
 */
export function setBulkPinAssignments(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  input: { isPinned: boolean; staffId?: string | null },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ affectedCount: number }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  let affectedCount = 0;
  const nextAssignments = schedule.assignments.map((a) => {
    const matchesScope = !input.staffId || a.staffId === input.staffId;
    if (!matchesScope || a.isPinned === input.isPinned) {
      return a;
    }
    affectedCount++;
    return { ...a, isPinned: input.isPinned };
  });

  if (affectedCount === 0) {
    return { ok: true, state, changed: false, affectedCount: 0 };
  }

  const updated: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    assignments: nextAssignments,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updated),
    changed: true,
    affectedCount,
  };
}
