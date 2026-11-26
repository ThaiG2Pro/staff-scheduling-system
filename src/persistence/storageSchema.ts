/**
 * @file Strict structural validator and version gate for persisted LocalStorage payloads.
 * Enforces all 7 hydration invariants from `03-domain-model.md` §7.3 plus `N ∈ [1, 500]`
 * (without auto-clamping), ISO 8601 timestamps, safe integers, and orphan assignment stripping.
 */

import {
  DAYS_IN_WEEK,
  MAX_OPERATING_HOUR_INCLUSIVE,
  MAX_SHIFT_END_HOUR,
  MIN_OPERATING_HOUR,
} from '../domain/constants';
import { isValidTargetN } from '../domain/decimalMath';
import { isShiftActiveOnDay } from '../domain/hardRules';
import type { Assignment, DayOfWeek, Schedule, ShiftTemplate, Staff } from '../domain/types';
import {
  isNonEmptyString,
  isPlainObject,
  isSafeNonNegativeInt,
  validateDemand,
  validateIsoTimestamp,
} from './storageDemandValidator';
import { CURRENT_SCHEMA_VERSION, type PersistedAppState } from './storageTypes';

export type SchemaValidationResult =
  | { kind: 'OK'; state: PersistedAppState; warnings: string[] }
  | { kind: 'INCOMPATIBLE_VERSION'; version: number; message: string }
  | { kind: 'CORRUPT_SCHEMA'; message: string };

function validateOptionalDayArray(
  raw: unknown,
  fieldPath: string,
  options: { allowEmpty: boolean; omitWhenAllSeven?: boolean; omitWhenEmpty?: boolean },
): { ok: true; value: DayOfWeek[] | undefined } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: `${fieldPath} must be an array of unique integers in [0, 6].` };
  }
  if (!options.allowEmpty && raw.length === 0) {
    return { ok: false, message: `${fieldPath} must contain at least 1 active day.` };
  }

  const seen = new Set<number>();
  const days: DayOfWeek[] = [];
  for (let i = 0; i < raw.length; i++) {
    const d = raw[i];
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
      return { ok: false, message: `${fieldPath}[${i}] must be an integer in [0, 6].` };
    }
    if (seen.has(d)) {
      return { ok: false, message: `${fieldPath} contains duplicate day ${d}.` };
    }
    seen.add(d);
    days.push(d as DayOfWeek);
  }

  days.sort((a, b) => a - b);
  if (options.omitWhenEmpty && days.length === 0) {
    return { ok: true, value: undefined };
  }
  if (options.omitWhenAllSeven && days.length === DAYS_IN_WEEK) {
    return { ok: true, value: undefined };
  }
  return { ok: true, value: days };
}

function validateStaffList(
  rawStaff: unknown,
  scheduleLabel: string,
): { ok: true; staff: Staff[]; staffIds: Set<string> } | { ok: false; message: string } {
  if (!Array.isArray(rawStaff)) {
    return { ok: false, message: `${scheduleLabel}.staff must be an array.` };
  }

  const staff: Staff[] = [];
  const staffIds = new Set<string>();

  for (let i = 0; i < rawStaff.length; i++) {
    const item = rawStaff[i];
    if (!isPlainObject(item)) {
      return { ok: false, message: `${scheduleLabel}.staff[${i}] must be an object.` };
    }
    if (!isNonEmptyString(item.id) || staffIds.has(item.id)) {
      return { ok: false, message: `${scheduleLabel}.staff[${i}].id must be a unique non-empty string.` };
    }
    if (!isNonEmptyString(item.name)) {
      return { ok: false, message: `${scheduleLabel}.staff[${i}].name must be a non-empty string.` };
    }
    if (!isSafeNonNegativeInt(item.maxWeeklyHours)) {
      return {
        ok: false,
        message: `${scheduleLabel}.staff[${i}].maxWeeklyHours must be a non-negative safe integer.`,
      };
    }
    const unavailRes = validateOptionalDayArray(
      item.unavailableDays,
      `${scheduleLabel}.staff[${i}].unavailableDays`,
      { allowEmpty: true, omitWhenEmpty: true },
    );
    if (!unavailRes.ok) return unavailRes;

    staffIds.add(item.id);
    staff.push({
      id: item.id,
      name: item.name,
      maxWeeklyHours: item.maxWeeklyHours,
      ...(unavailRes.value !== undefined ? { unavailableDays: unavailRes.value } : {}),
    });
  }

  return { ok: true, staff, staffIds };
}

function validateShiftList(
  rawShifts: unknown,
  scheduleLabel: string,
):
  | { ok: true; shifts: ShiftTemplate[]; shiftMap: Map<string, ShiftTemplate> }
  | { ok: false; message: string } {
  if (!Array.isArray(rawShifts)) {
    return { ok: false, message: `${scheduleLabel}.shifts must be an array.` };
  }

  const shifts: ShiftTemplate[] = [];
  const shiftMap = new Map<string, ShiftTemplate>();
  const timePairs = new Set<string>();

  for (let i = 0; i < rawShifts.length; i++) {
    const item = rawShifts[i];
    if (!isPlainObject(item)) {
      return { ok: false, message: `${scheduleLabel}.shifts[${i}] must be an object.` };
    }
    if (!isNonEmptyString(item.id) || shiftMap.has(item.id)) {
      return { ok: false, message: `${scheduleLabel}.shifts[${i}].id must be a unique non-empty string.` };
    }
    if (
      typeof item.startHour !== 'number' ||
      !Number.isInteger(item.startHour) ||
      item.startHour < MIN_OPERATING_HOUR ||
      item.startHour > MAX_OPERATING_HOUR_INCLUSIVE
    ) {
      return { ok: false, message: `${scheduleLabel}.shifts[${i}].startHour must be an integer in [7, 22].` };
    }
    if (
      typeof item.endHour !== 'number' ||
      !Number.isInteger(item.endHour) ||
      item.endHour < MIN_OPERATING_HOUR + 1 ||
      item.endHour > MAX_SHIFT_END_HOUR ||
      item.startHour >= item.endHour
    ) {
      return {
        ok: false,
        message: `${scheduleLabel}.shifts[${i}].endHour must be an integer in [8, 23] and > startHour.`,
      };
    }

    const pairKey = `${item.startHour}-${item.endHour}`;
    if (timePairs.has(pairKey)) {
      return {
        ok: false,
        message: `${scheduleLabel}.shifts contains duplicate time range (${item.startHour}, ${item.endHour}).`,
      };
    }

    const daysRes = validateOptionalDayArray(
      item.daysOfWeek,
      `${scheduleLabel}.shifts[${i}].daysOfWeek`,
      { allowEmpty: false, omitWhenAllSeven: true },
    );
    if (!daysRes.ok) return daysRes;

    const shift: ShiftTemplate = {
      id: item.id,
      startHour: item.startHour,
      endHour: item.endHour,
      ...(daysRes.value !== undefined ? { daysOfWeek: daysRes.value } : {}),
    };
    shiftMap.set(item.id, shift);
    timePairs.add(pairKey);
    shifts.push(shift);
  }

  return { ok: true, shifts, shiftMap };
}

function validateAssignmentList(
  rawAssignments: unknown,
  scheduleLabel: string,
  staffIds: ReadonlySet<string>,
  shiftMap: ReadonlyMap<string, ShiftTemplate>,
  warnings: string[],
): { ok: true; assignments: Assignment[] } | { ok: false; message: string } {
  if (!Array.isArray(rawAssignments)) {
    return { ok: false, message: `${scheduleLabel}.assignments must be an array.` };
  }

  const assignments: Assignment[] = [];
  const assignmentIds = new Set<string>();
  const triples = new Set<string>();

  for (let i = 0; i < rawAssignments.length; i++) {
    const item = rawAssignments[i];
    if (!isPlainObject(item)) {
      return { ok: false, message: `${scheduleLabel}.assignments[${i}] must be an object.` };
    }
    if (!isNonEmptyString(item.id) || assignmentIds.has(item.id)) {
      return {
        ok: false,
        message: `${scheduleLabel}.assignments[${i}].id must be a unique non-empty string.`,
      };
    }
    if (typeof item.day !== 'number' || !Number.isInteger(item.day) || item.day < 0 || item.day > 6) {
      return { ok: false, message: `${scheduleLabel}.assignments[${i}].day must be an integer in [0, 6].` };
    }
    if (!isNonEmptyString(item.shiftId) || !isNonEmptyString(item.staffId)) {
      return {
        ok: false,
        message: `${scheduleLabel}.assignments[${i}] must have non-empty shiftId and staffId.`,
      };
    }
    if (typeof item.isPinned !== 'boolean') {
      return { ok: false, message: `${scheduleLabel}.assignments[${i}].isPinned must be a boolean.` };
    }

    assignmentIds.add(item.id);

    // Strip orphan assignments on an otherwise structurally valid payload with a warning (§7.4).
    const shift = shiftMap.get(item.shiftId);
    if (!staffIds.has(item.staffId) || !shift) {
      warnings.push(
        `Removed orphan assignment "${item.id}" in ${scheduleLabel} referencing missing staff or shift.`,
      );
      continue;
    }

    if (!isShiftActiveOnDay(shift, item.day as DayOfWeek)) {
      return {
        ok: false,
        message: `${scheduleLabel}.assignments[${i}] targets inactive day ${item.day} for shift "${item.shiftId}".`,
      };
    }

    const tripleKey = `${item.day}|${item.shiftId}|${item.staffId}`;
    if (triples.has(tripleKey)) {
      return {
        ok: false,
        message: `${scheduleLabel}.assignments contains duplicate (day, shiftId, staffId) tuple.`,
      };
    }
    triples.add(tripleKey);

    assignments.push({
      id: item.id,
      day: item.day as DayOfWeek,
      shiftId: item.shiftId,
      staffId: item.staffId,
      isPinned: item.isPinned,
    });
  }

  return { ok: true, assignments };
}

function validateSchedule(
  rawSchedule: unknown,
  index: number,
  seenScheduleIds: Set<string>,
  warnings: string[],
): { ok: true; schedule: Schedule } | { ok: false; message: string } {
  const label = `schedules[${index}]`;
  if (!isPlainObject(rawSchedule)) {
    return { ok: false, message: `${label} must be an object.` };
  }
  if (!isNonEmptyString(rawSchedule.id) || seenScheduleIds.has(rawSchedule.id)) {
    return { ok: false, message: `${label}.id must be a unique non-empty string.` };
  }
  if (!isNonEmptyString(rawSchedule.name)) {
    return { ok: false, message: `${label}.name must be a non-empty string.` };
  }

  const createdAtErr = validateIsoTimestamp(rawSchedule.createdAt, `${label}.createdAt`);
  if (createdAtErr) return { ok: false, message: createdAtErr };

  const updatedAtErr = validateIsoTimestamp(rawSchedule.updatedAt, `${label}.updatedAt`);
  if (updatedAtErr) return { ok: false, message: updatedAtErr };

  if (
    typeof rawSchedule.targetTxnsPerStaffHour !== 'number' ||
    !isValidTargetN(rawSchedule.targetTxnsPerStaffHour)
  ) {
    return {
      ok: false,
      message: `${label}.targetTxnsPerStaffHour must be a finite number in [1, 500].`,
    };
  }

  const staffRes = validateStaffList(rawSchedule.staff, label);
  if (!staffRes.ok) return staffRes;

  const shiftRes = validateShiftList(rawSchedule.shifts, label);
  if (!shiftRes.ok) return shiftRes;

  const demandRes = validateDemand(rawSchedule.demand, label);
  if (!demandRes.ok) return demandRes;

  const assignmentRes = validateAssignmentList(
    rawSchedule.assignments,
    label,
    staffRes.staffIds,
    shiftRes.shiftMap,
    warnings,
  );
  if (!assignmentRes.ok) return assignmentRes;

  seenScheduleIds.add(rawSchedule.id);

  return {
    ok: true,
    schedule: {
      id: rawSchedule.id,
      name: rawSchedule.name,
      createdAt: rawSchedule.createdAt as string,
      updatedAt: rawSchedule.updatedAt as string,
      targetTxnsPerStaffHour: rawSchedule.targetTxnsPerStaffHour,
      staff: staffRes.staff,
      shifts: shiftRes.shifts,
      demand: demandRes.demand,
      assignments: assignmentRes.assignments,
    },
  };
}

/**
 * Validates a parsed JSON value against the `PersistedAppState` v1 schema.
 * Rejects future `schemaVersion > 1` with `INCOMPATIBLE_VERSION` and structural
 * or domain invariant violations (including `N` outside `[1, 500]`) with `CORRUPT_SCHEMA`.
 *
 * @param raw - Unknown value produced by `JSON.parse`.
 * @returns Discriminated union indicating valid state, incompatible future version, or corrupt schema.
 */
export function validatePersistedState(raw: unknown): SchemaValidationResult {
  if (!isPlainObject(raw)) {
    return { kind: 'CORRUPT_SCHEMA', message: 'Persisted root payload must be a JSON object.' };
  }

  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { kind: 'CORRUPT_SCHEMA', message: 'Missing or invalid schemaVersion (must be an integer).' };
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      kind: 'INCOMPATIBLE_VERSION',
      version,
      message: `Saved data uses newer schema version ${version} (supported: ${CURRENT_SCHEMA_VERSION}).`,
    };
  }

  if (version < CURRENT_SCHEMA_VERSION) {
    return { kind: 'CORRUPT_SCHEMA', message: `Unsupported legacy schemaVersion ${version}.` };
  }

  if (raw.activeScheduleId !== null && typeof raw.activeScheduleId !== 'string') {
    return { kind: 'CORRUPT_SCHEMA', message: 'activeScheduleId must be a string or null.' };
  }

  if (!Array.isArray(raw.schedules)) {
    return { kind: 'CORRUPT_SCHEMA', message: 'schedules must be an array.' };
  }

  const schedules: Schedule[] = [];
  const seenScheduleIds = new Set<string>();
  const warnings: string[] = [];

  for (let i = 0; i < raw.schedules.length; i++) {
    const res = validateSchedule(raw.schedules[i], i, seenScheduleIds, warnings);
    if (!res.ok) return { kind: 'CORRUPT_SCHEMA', message: res.message };
    schedules.push(res.schedule);
  }

  const activeScheduleId =
    raw.activeScheduleId !== null && seenScheduleIds.has(raw.activeScheduleId)
      ? raw.activeScheduleId
      : null;

  return {
    kind: 'OK',
    state: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      activeScheduleId,
      schedules,
    },
    warnings,
  };
}
