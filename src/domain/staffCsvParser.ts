/**
 * @file Pure Staff CSV parser supporting RFC 4180 CSV upload or pasted text.
 * Parses `name`, `max_weekly_hours`, and optional `unavailable_days` (`Mon`–`Sun`)
 * with strict row-level error reporting and duplicate-name detection.
 */

import { parseRfc4180Rows } from './csvRfc4180';
import { normalizeDayArray } from './hardRules';
import type { DayOfWeek } from './types';

export interface ParsedStaffRow {
  rowNumber: number;
  name: string;
  maxWeeklyHours: number;
  unavailableDays?: DayOfWeek[];
}

export interface StaffCsvParseError {
  row?: number;
  message: string;
}

export type StaffCsvParseResult =
  | { ok: true; rows: ParsedStaffRow[] }
  | { ok: false; errors: StaffCsvParseError[] };

const NAME_HEADERS = new Set([
  'name',
  'staff',
  'staffname',
  'employee',
  'employeename',
  'fullname',
]);

const HOURS_HEADERS = new Set([
  'maxweeklyhours',
  'maxhours',
  'weeklyhours',
  'hours',
  'hourcap',
  'cap',
]);

const UNAVAILABLE_HEADERS = new Set([
  'unavailabledays',
  'unavailable',
  'daysoff',
  'dayoff',
  'offdays',
  'off',
]);

const DAY_TOKEN_MAP: Readonly<Record<string, DayOfWeek>> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseUnavailableDays(
  raw: string,
  rowNumber: number,
): { ok: true; days?: DayOfWeek[] } | { ok: false; error: StaffCsvParseError } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'none') {
    return { ok: true, days: undefined };
  }

  const tokens = trimmed
    .split(/[;,|/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const parsed: DayOfWeek[] = [];
  for (const token of tokens) {
    const day = DAY_TOKEN_MAP[token.toLowerCase()];
    if (day === undefined) {
      return {
        ok: false,
        error: {
          row: rowNumber,
          message: `Row ${rowNumber}: unrecognized weekday "${token}" in unavailable_days (use Mon–Sun).`,
        },
      };
    }
    parsed.push(day);
  }

  const normalized = normalizeDayArray(parsed);
  return { ok: true, days: normalized.length > 0 ? normalized : undefined };
}

/**
 * Parses a Staff CSV document (`name,max_weekly_hours,unavailable_days`).
 * Returns all parsed staff rows on success or all validation errors atomically.
 *
 * @param csvText - Raw CSV text from file upload or pasted clipboard input.
 * @returns Parsed staff rows or structured row-level validation errors.
 */
export function parseStaffCsv(csvText: string): StaffCsvParseResult {
  if (!csvText.trim()) {
    return {
      ok: false,
      errors: [{ message: 'CSV content is empty. Paste rows or upload a .csv file.' }],
    };
  }

  const tokenized = parseRfc4180Rows(csvText);
  if (!tokenized.ok) {
    return {
      ok: false,
      errors: tokenized.errors.map((e) => ({ row: e.row, message: e.message })),
    };
  }

  const nonEmptyRows = tokenized.rows.filter(
    (row) => !row.cells.every((cell) => cell.value.trim() === ''),
  );

  if (nonEmptyRows.length === 0) {
    return {
      ok: false,
      errors: [{ message: 'CSV content contains no rows.' }],
    };
  }

  const headerRow = nonEmptyRows[0]!;
  let nameIdx = -1;
  let hoursIdx = -1;
  let unavailableIdx = -1;

  headerRow.cells.forEach((cell, idx) => {
    const key = normalizeHeader(cell.value);
    if (nameIdx === -1 && NAME_HEADERS.has(key)) nameIdx = idx;
    else if (hoursIdx === -1 && HOURS_HEADERS.has(key)) hoursIdx = idx;
    else if (unavailableIdx === -1 && UNAVAILABLE_HEADERS.has(key)) unavailableIdx = idx;
  });

  if (nameIdx === -1 || hoursIdx === -1) {
    return {
      ok: false,
      errors: [
        {
          row: headerRow.rowNumber,
          message:
            'Missing required header columns. Expected "name" and "max_weekly_hours" (optional: "unavailable_days").',
        },
      ],
    };
  }

  const dataRows = nonEmptyRows.slice(1);
  if (dataRows.length === 0) {
    return {
      ok: false,
      errors: [{ message: 'CSV contains a header row but no staff entries.' }],
    };
  }

  const errors: StaffCsvParseError[] = [];
  const parsedRows: ParsedStaffRow[] = [];
  const seenNames = new Map<string, number>();

  for (const row of dataRows) {
    const nameRaw = row.cells[nameIdx]?.value ?? '';
    const hoursRaw = row.cells[hoursIdx]?.value ?? '';
    const unavailableRaw = unavailableIdx >= 0 ? (row.cells[unavailableIdx]?.value ?? '') : '';

    const name = nameRaw.trim();
    if (!name) {
      errors.push({ row: row.rowNumber, message: `Row ${row.rowNumber}: staff name is required.` });
      continue;
    }

    const nameKey = name.toLowerCase();
    const prevRow = seenNames.get(nameKey);
    if (prevRow !== undefined) {
      errors.push({
        row: row.rowNumber,
        message: `Row ${row.rowNumber}: duplicate staff name "${name}" (already listed on row ${prevRow}).`,
      });
      continue;
    }
    seenNames.set(nameKey, row.rowNumber);

    const hoursTrimmed = hoursRaw.trim();
    if (!/^\d+$/.test(hoursTrimmed)) {
      errors.push({
        row: row.rowNumber,
        message: `Row ${row.rowNumber} (${name}): max_weekly_hours must be a non-negative whole number.`,
      });
      continue;
    }

    const maxWeeklyHours = Number(hoursTrimmed);
    if (!Number.isSafeInteger(maxWeeklyHours) || maxWeeklyHours < 0) {
      errors.push({
        row: row.rowNumber,
        message: `Row ${row.rowNumber} (${name}): max_weekly_hours is out of safe integer range.`,
      });
      continue;
    }

    const unavailRes = parseUnavailableDays(unavailableRaw, row.rowNumber);
    if (!unavailRes.ok) {
      errors.push(unavailRes.error);
      continue;
    }

    parsedRows.push({
      rowNumber: row.rowNumber,
      name,
      maxWeeklyHours,
      ...(unavailRes.days ? { unavailableDays: unavailRes.days } : {}),
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, rows: parsedRows };
}
