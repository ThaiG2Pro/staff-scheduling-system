/**
 * @file Pure CSV transaction importer (`parseCsvTransactions`).
 * Orchestrates RFC 4180 parsing, UTC/weekday header normalization to `Mon–Sun`,
 * 16 unique operating hours (`7..22`), and Safe Integer / BigInt sum validation.
 */

import { DAYS_OF_WEEK, MAX_SAFE_BIGINT, OPERATING_HOURS } from './constants';
import {
  extractBannerYearContext,
  parseDayHeadersRow,
  parseOperatingHour,
} from './csvHeaderParser';
import { parseRfc4180Rows } from './csvRfc4180';
import type {
  CsvParseError,
  CsvParseResult,
  OperatingHour,
  TransactionGrid,
} from './types';

function createEmptyGrid(): TransactionGrid {
  const grid = {} as TransactionGrid;
  for (const d of DAYS_OF_WEEK) {
    const row = {} as Record<OperatingHour, number>;
    for (const h of OPERATING_HOURS) {
      row[h] = 0;
    }
    grid[d] = row;
  }
  return grid;
}

/**
 * Pure CSV transaction importer (F-08, E-01).
 * Parses UTF-8 BOM, RFC 4180 quoting, optional banner row, Weekday-only or
 * 7 consecutive UTC Calendar-Date headers (never mixed), normalizes to Mon–Sun,
 * and enforces 16 unique operating hours (7am–10pm) with Safe Integer bounds.
 *
 * @param text - Raw CSV file contents as string (no DOM `File` or clock side effects).
 * @returns Normalized 7x16 `TransactionGrid` and `totalTransactions`, or structured `CsvParseError[]`.
 */
export function parseCsvTransactions(text: string): CsvParseResult {
  const rfcResult = parseRfc4180Rows(text);
  if (!rfcResult.ok) {
    return rfcResult;
  }

  const rows = rfcResult.rows;
  if (rows.length === 0) {
    return { ok: false, errors: [{ message: 'CSV file is empty.' }] };
  }

  const multilineErrors: CsvParseError[] = [];
  for (const row of rows) {
    for (let c = 0; c < row.cells.length; c++) {
      if (row.cells[c]?.hasMultiline) {
        multilineErrors.push({
          row: row.rowNumber,
          column: c + 1,
          message: 'Multiline quoted field is not allowed in transaction CSV.',
        });
      }
    }
  }
  if (multilineErrors.length > 0) {
    return { ok: false, errors: multilineErrors };
  }

  let headerIdx = 0;
  let yearContext = null;
  const firstRow = rows[0];
  if (firstRow && firstRow.cells.length === 1 && rows.length >= 2) {
    yearContext = extractBannerYearContext(firstRow.cells[0]?.value ?? '');
    headerIdx = 1;
  }

  const headerRow = rows[headerIdx];
  if (!headerRow) {
    return { ok: false, errors: [{ message: 'Missing header row in CSV.' }] };
  }

  const headerResult = parseDayHeadersRow(headerRow, yearContext);
  if (!headerResult.ok) {
    return headerResult;
  }

  const { dayHeaders, rawLabels } = headerResult;
  const dataRows = rows.slice(headerIdx + 1);
  const grid = createEmptyGrid();
  const seenHours = new Set<OperatingHour>();
  const errors: CsvParseError[] = [];
  let totalAcc = 0n;

  for (const row of dataRows) {
    if (row.cells.length !== 8) {
      errors.push({
        row: row.rowNumber,
        message: `Expected exactly 8 columns, found ${row.cells.length}.`,
      });
      continue;
    }

    const hourLabel = row.cells[0]?.value.trim() ?? '';
    const hour = parseOperatingHour(hourLabel);
    if (hour === null) {
      errors.push({
        row: row.rowNumber,
        column: 1,
        hourLabel,
        message: `Invalid or out-of-range operating hour "${hourLabel}" (expected 7am–10pm or 07:00–22:00).`,
      });
      continue;
    }

    if (seenHours.has(hour)) {
      errors.push({
        row: row.rowNumber,
        column: 1,
        hourLabel,
        message: `Duplicate operating hour "${hourLabel}".`,
      });
      continue;
    }
    seenHours.add(hour);

    for (let col = 1; col <= 7; col++) {
      const rawVal = row.cells[col]?.value.trim() ?? '';
      const dayHeader = dayHeaders[col - 1]!;
      const dayLabel = rawLabels[col - 1] ?? '';

      if (!/^\d+$/.test(rawVal)) {
        errors.push({
          row: row.rowNumber,
          column: col + 1,
          dayLabel,
          hourLabel,
          message: `Invalid transaction count "${rawVal}" (expected non-negative integer).`,
        });
        continue;
      }

      const numVal = Number(rawVal);
      if (!Number.isSafeInteger(numVal) || numVal < 0) {
        errors.push({
          row: row.rowNumber,
          column: col + 1,
          dayLabel,
          hourLabel,
          message: `Transaction count "${rawVal}" exceeds Number.MAX_SAFE_INTEGER.`,
        });
        continue;
      }

      totalAcc += BigInt(numVal);
      if (totalAcc > MAX_SAFE_BIGINT) {
        errors.push({
          row: row.rowNumber,
          column: col + 1,
          dayLabel,
          hourLabel,
          message: 'Total weekly transactions exceed Number.MAX_SAFE_INTEGER.',
        });
        continue;
      }

      grid[dayHeader.dayOfWeek][hour] = numVal;
    }
  }

  const missingHours = OPERATING_HOURS.filter((h) => !seenHours.has(h));
  if (missingHours.length > 0) {
    errors.push({
      message: `Missing required operating hours: ${missingHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}.`,
    });
  }

  if (dataRows.length !== 16 && errors.length === 0) {
    errors.push({
      message: `Expected exactly 16 hourly rows (7am–10pm), found ${dataRows.length}.`,
    });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, transactions: grid, totalTransactions: Number(totalAcc) };
}
