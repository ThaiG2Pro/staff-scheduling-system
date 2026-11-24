/**
 * @file Primitive and DemandDataset structural validators for persisted LocalStorage payloads.
 * Used by `storageSchema.ts` to validate ISO 8601 timestamps, safe non-negative integers,
 * and exact 7x16 transaction grids with BigInt overflow guards.
 */

import { DAYS_OF_WEEK, OPERATING_HOURS } from '../domain/constants';
import { sumSafeIntegers } from '../domain/decimalMath';
import type { DemandDataset, OperatingHour, TransactionGrid } from '../domain/types';

const ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Type guard for non-null, non-array plain JS objects. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard for strings with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Type guard for safe integers >= 0. */
export function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Validates an ISO 8601 timestamp string, distinguishing missing vs. malformed values. */
export function validateIsoTimestamp(value: unknown, fieldLabel: string): string | null {
  if (value === undefined || value === null) {
    return `${fieldLabel} is missing.`;
  }
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_REGEX.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return `${fieldLabel} is not a valid ISO 8601 timestamp.`;
  }
  return null;
}

/**
 * Validates `Schedule.demand` (`null` or exact 7x16 `DemandDataset` with safe integers).
 *
 * @param rawDemand - Unknown deserialized `demand` field.
 * @param scheduleLabel - Diagnostic label for error messages (e.g. `schedules[0]`).
 * @returns Validated `DemandDataset | null` or an error message.
 */
export function validateDemand(
  rawDemand: unknown,
  scheduleLabel: string,
): { ok: true; demand: DemandDataset | null } | { ok: false; message: string } {
  if (rawDemand === null) {
    return { ok: true, demand: null };
  }
  if (!isPlainObject(rawDemand)) {
    return { ok: false, message: `${scheduleLabel}.demand must be an object or null.` };
  }

  const importedAtErr = validateIsoTimestamp(rawDemand.importedAt, `${scheduleLabel}.demand.importedAt`);
  if (importedAtErr) return { ok: false, message: importedAtErr };

  if (rawDemand.sourceFileName !== undefined && typeof rawDemand.sourceFileName !== 'string') {
    return {
      ok: false,
      message: `${scheduleLabel}.demand.sourceFileName must be a string when present.`,
    };
  }

  if (!isPlainObject(rawDemand.transactions)) {
    return { ok: false, message: `${scheduleLabel}.demand.transactions must be an object.` };
  }

  if (Object.keys(rawDemand.transactions).length !== DAYS_OF_WEEK.length) {
    return {
      ok: false,
      message: `${scheduleLabel}.demand.transactions must have exactly 7 day keys ("0".."6").`,
    };
  }

  const grid = {} as TransactionGrid;
  const allCells: number[] = [];

  for (const day of DAYS_OF_WEEK) {
    const rawDayRow = rawDemand.transactions[String(day)];
    if (!isPlainObject(rawDayRow)) {
      return {
        ok: false,
        message: `${scheduleLabel}.demand.transactions[${day}] must be an object with 16 hour keys.`,
      };
    }

    if (Object.keys(rawDayRow).length !== OPERATING_HOURS.length) {
      return {
        ok: false,
        message: `${scheduleLabel}.demand.transactions[${day}] must have exactly 16 hour keys ("7".."22").`,
      };
    }

    const hourRow = {} as Record<OperatingHour, number>;
    for (const hour of OPERATING_HOURS) {
      const cell = rawDayRow[String(hour)];
      if (!isSafeNonNegativeInt(cell)) {
        return {
          ok: false,
          message: `${scheduleLabel}.demand.transactions[${day}][${hour}] must be a non-negative safe integer.`,
        };
      }
      hourRow[hour] = cell;
      allCells.push(cell);
    }
    grid[day] = hourRow;
  }

  const totalCheck = sumSafeIntegers(allCells);
  if (!totalCheck.ok) {
    return {
      ok: false,
      message: `${scheduleLabel}.demand.transactions total exceeds MAX_SAFE_INTEGER.`,
    };
  }

  const demand: DemandDataset = {
    importedAt: rawDemand.importedAt as string,
    transactions: grid,
    ...(rawDemand.sourceFileName !== undefined ? { sourceFileName: rawDemand.sourceFileName } : {}),
  };

  return { ok: true, demand };
}
