/**
 * @file Strict schedule-scoped mutations and impact previews for Staff and ShiftTemplate entities.
 * Implements E-08 cascade delete previews (`previewDeleteStaffInSchedule`, `previewDeleteShiftInSchedule`),
 * E-09 shift time edits (preserving assignments & pins across 7 days), and immutable updates.
 */

import {
  DAYS_IN_WEEK,
  MAX_OPERATING_HOUR_INCLUSIVE,
  MAX_SHIFT_END_HOUR,
  MIN_OPERATING_HOUR,
} from '../domain/constants';
import {
  previewDeleteShift,
  previewDeleteStaff,
  previewDisableShiftDays,
} from '../domain/constraints';
import { isShiftActiveOnDay, normalizeDayArray } from '../domain/hardRules';
import type { DayOfWeek, DeletePreview, Schedule, ShiftTemplate, Staff } from '../domain/types';
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

function validateStaffInput(name: string, maxWeeklyHours: number): string | null {
  if (name.trim().length === 0) {
    return 'Staff name cannot be empty.';
  }
  if (!Number.isSafeInteger(maxWeeklyHours) || maxWeeklyHours < 0) {
    return 'Max weekly hours must be a non-negative integer.';
  }
  return null;
}

function validateDaySelection(
  days: readonly DayOfWeek[],
  allowEmpty: boolean,
  emptyMessage: string,
): string | null {
  if (!allowEmpty && days.length === 0) {
    return emptyMessage;
  }
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return 'Day values must be integers between 0 (Mon) and 6 (Sun).';
    }
  }
  return null;
}

function validateShiftHours(
  startHour: number,
  endHour: number,
  existingShifts: readonly Readonly<ShiftTemplate>[],
  excludeShiftId?: string,
): string | null {
  if (
    !Number.isInteger(startHour) ||
    startHour < MIN_OPERATING_HOUR ||
    startHour > MAX_OPERATING_HOUR_INCLUSIVE
  ) {
    return 'Shift start hour must be an integer between 07:00 and 22:00.';
  }
  if (
    !Number.isInteger(endHour) ||
    endHour < MIN_OPERATING_HOUR + 1 ||
    endHour > MAX_SHIFT_END_HOUR
  ) {
    return 'Shift end hour must be an integer between 08:00 and 23:00.';
  }
  if (startHour >= endHour) {
    return 'Shift end hour must be strictly after start hour.';
  }
  const hasDuplicate = existingShifts.some(
    (sh) => sh.id !== excludeShiftId && sh.startHour === startHour && sh.endHour === endHour,
  );
  if (hasDuplicate) {
    return 'A shift template with this exact start and end time already exists.';
  }
  return null;
}

/**
 * Adds a new Staff member to the specified schedule.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID (Strict Schedule Scoping).
 * @param input - Staff name and weekly hour cap.
 * @param deps - Optional clock and ID generator.
 * @returns Updated state with the newly created `staffId`, or validation error.
 */
export function addStaff(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  input: { name: string; maxWeeklyHours: number; unavailableDays?: DayOfWeek[] },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ staffId: string }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const validationError = validateStaffInput(input.name, input.maxWeeklyHours);
  if (validationError) return { ok: false, error: validationError };

  let normalizedUnavailable: DayOfWeek[] | undefined;
  if (input.unavailableDays !== undefined) {
    const dayErr = validateDaySelection(input.unavailableDays, true, '');
    if (dayErr) return { ok: false, error: dayErr };
    const norm = normalizeDayArray(input.unavailableDays);
    normalizedUnavailable = norm.length > 0 ? norm : undefined;
  }

  const newStaff: Staff = {
    id: deps.generateId(),
    name: input.name.trim(),
    maxWeeklyHours: input.maxWeeklyHours,
    ...(normalizedUnavailable !== undefined ? { unavailableDays: normalizedUnavailable } : {}),
  };

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    staff: [...schedule.staff, newStaff],
  };

  return {
    ok: true,
    state: replaceSchedule(state, updatedSchedule),
    changed: true,
    staffId: newStaff.id,
  };
}

/**
 * Updates an existing Staff member's name, `maxWeeklyHours`, or optional `unavailableDays`
 * within the specified schedule. Preserves existing `unavailableDays` when omitted and
 * preserves all existing assignments and their `isPinned` flags.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param staffId - Target staff ID inside `scheduleId`.
 * @param input - Updated name, weekly hour cap, and optional unavailable days.
 * @param deps - Optional clock and ID generator.
 * @returns Updated state or validation error.
 */
export function updateStaff(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  staffId: string,
  input: { name: string; maxWeeklyHours: number; unavailableDays?: DayOfWeek[] },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const existing = schedule.staff.find((st) => st.id === staffId);
  if (!existing) return { ok: false, error: 'Staff member not found in schedule.' };

  const validationError = validateStaffInput(input.name, input.maxWeeklyHours);
  if (validationError) return { ok: false, error: validationError };

  let nextUnavailable: DayOfWeek[] | undefined = existing.unavailableDays;
  if (input.unavailableDays !== undefined) {
    const dayErr = validateDaySelection(input.unavailableDays, true, '');
    if (dayErr) return { ok: false, error: dayErr };
    const norm = normalizeDayArray(input.unavailableDays);
    nextUnavailable = norm.length > 0 ? norm : undefined;
  }

  const trimmedName = input.name.trim();
  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    staff: schedule.staff.map((st) => {
      if (st.id !== staffId) return st;
      return {
        id: st.id,
        name: trimmedName,
        maxWeeklyHours: input.maxWeeklyHours,
        ...(nextUnavailable !== undefined ? { unavailableDays: nextUnavailable } : {}),
      };
    }),
  };

  return { ok: true, state: replaceSchedule(state, updatedSchedule), changed: true };
}

/** Previews affected assignments before deleting a Staff member in a specific schedule (E-08). */
export function previewDeleteStaffInSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  staffId: string,
): DeletePreview {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { affectedAssignmentsCount: 0, affectedAssignmentIds: [] };
  }
  return previewDeleteStaff(staffId, schedule.assignments);
}

/**
 * Deletes a Staff member and cascade-deletes all of their assignments within the owning schedule.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param staffId - Staff ID to delete.
 * @param deps - Optional clock and ID generator.
 * @returns Updated state and count of cascade-removed assignments.
 */
export function deleteStaff(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  staffId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ removedAssignmentsCount: number }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const exists = schedule.staff.some((st) => st.id === staffId);
  if (!exists) return { ok: false, error: 'Staff member not found in schedule.' };

  const remainingAssignments = schedule.assignments.filter((a) => a.staffId !== staffId);
  const removedAssignmentsCount = schedule.assignments.length - remainingAssignments.length;

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    staff: schedule.staff.filter((st) => st.id !== staffId),
    assignments: remainingAssignments,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updatedSchedule),
    changed: true,
    removedAssignmentsCount,
  };
}

/**
 * Adds a new ShiftTemplate to the specified schedule.
 * Overlapping shift templates are permitted; exact duplicate `(startHour, endHour)` pairs are rejected.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param input - Shift `startHour` (`7..22`) and `endHour` (`8..23`).
 * @param deps - Optional clock and ID generator.
 * @returns Updated state with the newly created `shiftId`, or validation error.
 */
export function addShiftTemplate(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  input: { startHour: number; endHour: number; daysOfWeek?: DayOfWeek[] },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ shiftId: string }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const validationError = validateShiftHours(input.startHour, input.endHour, schedule.shifts);
  if (validationError) return { ok: false, error: validationError };

  let normalizedDays: DayOfWeek[] | undefined;
  if (input.daysOfWeek !== undefined) {
    const dayErr = validateDaySelection(
      input.daysOfWeek,
      false,
      'Shift template must be active on at least 1 day of the week.',
    );
    if (dayErr) return { ok: false, error: dayErr };
    const norm = normalizeDayArray(input.daysOfWeek);
    normalizedDays = norm.length === DAYS_IN_WEEK ? undefined : norm;
  }

  const newShift: ShiftTemplate = {
    id: deps.generateId(),
    startHour: input.startHour,
    endHour: input.endHour,
    ...(normalizedDays !== undefined ? { daysOfWeek: normalizedDays } : {}),
  };

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    shifts: [...schedule.shifts, newShift],
  };

  return {
    ok: true,
    state: replaceSchedule(state, updatedSchedule),
    changed: true,
    shiftId: newShift.id,
  };
}

/** Previews affected assignments across all 7 days before editing a ShiftTemplate's time range (E-09). */
export function previewEditShiftInSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  shiftId: string,
): DeletePreview {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { affectedAssignmentsCount: 0, affectedAssignmentIds: [] };
  }
  return previewDeleteShift(shiftId, schedule.assignments);
}

/** Previews affected assignments (regular + pinned) that will be cascade-deleted when disabling shift days. */
export function previewDisableShiftDaysInSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  shiftId: string,
  nextDaysOfWeek: readonly DayOfWeek[],
): DeletePreview {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { affectedAssignmentsCount: 0, affectedAssignmentIds: [] };
  }
  return previewDisableShiftDays(shiftId, nextDaysOfWeek, schedule.assignments);
}

/**
 * Updates a ShiftTemplate's `startHour`, `endHour`, and optional `daysOfWeek` (E-09 & Phase 2).
 * Preserves existing `daysOfWeek` when omitted. When active days are restricted, atomically
 * cascade-deletes any assignments (regular or pinned) on the newly disabled day(s).
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param shiftId - Shift template ID inside `scheduleId`.
 * @param input - Updated `startHour`, `endHour`, and optional `daysOfWeek`.
 * @param deps - Optional clock and ID generator.
 * @returns Updated state with `removedAssignmentsCount`, or validation error.
 */
export function updateShiftTemplate(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  shiftId: string,
  input: { startHour: number; endHour: number; daysOfWeek?: DayOfWeek[] },
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ removedAssignmentsCount: number }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const existing = schedule.shifts.find((sh) => sh.id === shiftId);
  if (!existing) return { ok: false, error: 'Shift template not found in schedule.' };

  const validationError = validateShiftHours(
    input.startHour,
    input.endHour,
    schedule.shifts,
    shiftId,
  );
  if (validationError) return { ok: false, error: validationError };

  let nextDays: DayOfWeek[] | undefined = existing.daysOfWeek;
  if (input.daysOfWeek !== undefined) {
    const dayErr = validateDaySelection(
      input.daysOfWeek,
      false,
      'Shift template must be active on at least 1 day of the week.',
    );
    if (dayErr) return { ok: false, error: dayErr };
    const norm = normalizeDayArray(input.daysOfWeek);
    nextDays = norm.length === DAYS_IN_WEEK ? undefined : norm;
  }

  const updatedShift: ShiftTemplate = {
    id: existing.id,
    startHour: input.startHour,
    endHour: input.endHour,
    ...(nextDays !== undefined ? { daysOfWeek: nextDays } : {}),
  };

  const remainingAssignments = schedule.assignments.filter(
    (a) => a.shiftId !== shiftId || isShiftActiveOnDay(updatedShift, a.day),
  );
  const removedAssignmentsCount = schedule.assignments.length - remainingAssignments.length;

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    shifts: schedule.shifts.map((sh) => (sh.id === shiftId ? updatedShift : sh)),
    assignments: remainingAssignments,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updatedSchedule),
    changed: true,
    removedAssignmentsCount,
  };
}

/** Previews affected assignments before deleting a ShiftTemplate in a specific schedule (E-08). */
export function previewDeleteShiftInSchedule(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  shiftId: string,
): DeletePreview {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) {
    return { affectedAssignmentsCount: 0, affectedAssignmentIds: [] };
  }
  return previewDeleteShift(shiftId, schedule.assignments);
}

/**
 * Deletes a ShiftTemplate and cascade-deletes all assignments referencing it within the owning schedule.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param shiftId - Shift template ID to delete.
 * @param deps - Optional clock and ID generator.
 * @returns Updated state and count of cascade-removed assignments.
 */
export function deleteShiftTemplate(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  shiftId: string,
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult<{ removedAssignmentsCount: number }> {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  const exists = schedule.shifts.some((sh) => sh.id === shiftId);
  if (!exists) return { ok: false, error: 'Shift template not found in schedule.' };

  const remainingAssignments = schedule.assignments.filter((a) => a.shiftId !== shiftId);
  const removedAssignmentsCount = schedule.assignments.length - remainingAssignments.length;

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    shifts: schedule.shifts.filter((sh) => sh.id !== shiftId),
    assignments: remainingAssignments,
  };

  return {
    ok: true,
    state: replaceSchedule(state, updatedSchedule),
    changed: true,
    removedAssignmentsCount,
  };
}

/**
 * Reorders the ShiftTemplate list in a schedule so both Manage Shifts and Weekly Roster rows
 * follow the manager's custom order.
 *
 * @param state - Current persisted state.
 * @param scheduleId - Owning schedule ID.
 * @param orderedShiftIds - Complete permutation of existing `schedule.shifts` IDs.
 * @param deps - Optional clock dependency.
 * @returns Updated state or validation error.
 */
export function reorderShiftTemplates(
  state: Readonly<PersistedAppState>,
  scheduleId: string,
  orderedShiftIds: readonly string[],
  deps: ActionDeps = DEFAULT_ACTION_DEPS,
): StateActionResult {
  const schedule = findSchedule(state, scheduleId);
  if (!schedule) return { ok: false, error: 'Schedule not found.' };

  if (orderedShiftIds.length !== schedule.shifts.length) {
    return { ok: false, error: 'Shift order must include every shift template.' };
  }

  const shiftById = new Map(schedule.shifts.map((sh) => [sh.id, sh]));
  const seen = new Set<string>();
  const reordered: ShiftTemplate[] = [];

  for (const id of orderedShiftIds) {
    if (seen.has(id)) {
      return { ok: false, error: 'Shift order contains duplicate shift IDs.' };
    }
    const found = shiftById.get(id);
    if (!found) {
      return { ok: false, error: 'Shift template not found in schedule.' };
    }
    seen.add(id);
    reordered.push(found);
  }

  const unchanged = reordered.every((sh, idx) => sh.id === schedule.shifts[idx]!.id);
  if (unchanged) {
    return { ok: true, state, changed: false };
  }

  const updatedSchedule: Schedule = {
    ...schedule,
    updatedAt: deps.nowIso(),
    shifts: reordered,
  };

  return { ok: true, state: replaceSchedule(state, updatedSchedule), changed: true };
}
