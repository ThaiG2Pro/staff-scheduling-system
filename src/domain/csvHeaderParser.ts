/**
 * @file CSV day-header and operating-hour parser.
 * Provides `extractBannerYearContext`, `parseDayHeadersRow` (Weekday-only vs
 * 7 consecutive UTC Calendar-Date headers, never mixed), and `parseOperatingHour`.
 */

import type { ParsedCsvRow } from './csvRfc4180';
import type { CsvParseError, DayOfWeek, OperatingHour } from './types';

export interface YearContext {
  yearsByMonth: Map<number, number>;
  fallbackYear: number;
}

export type ParsedDayHeader =
  | { kind: 'WEEKDAY'; dayOfWeek: DayOfWeek }
  | { kind: 'CALENDAR_DATE'; dayOfWeek: DayOfWeek; utcEpochDay: number };

const WEEKDAY_MAP: Readonly<Record<string, DayOfWeek>> = {
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

const MONTH_MAP: Readonly<Record<string, number>> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function utcDayToDayOfWeek(utcDay: number): DayOfWeek {
  return ((utcDay + 6) % 7) as DayOfWeek;
}

/** Extracts year hints from an optional 1-column report title banner (e.g. "Aug 07, 2026 - Aug 13, 2026"). */
export function extractBannerYearContext(bannerText: string): YearContext | null {
  const trimmed = bannerText.trim();
  const yearsByMonth = new Map<number, number>();
  let lastYear: number | null = null;

  const collectMatches = (regex: RegExp, monthGroup: number, yearGroup: number): void => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(trimmed)) !== null) {
      const monthStr = m[monthGroup]?.toLowerCase();
      const yearNum = Number(m[yearGroup]);
      if (monthStr && MONTH_MAP[monthStr] !== undefined && Number.isInteger(yearNum)) {
        yearsByMonth.set(MONTH_MAP[monthStr], yearNum);
        lastYear = yearNum;
      }
    }
  };

  collectMatches(/\b([A-Za-z]{3,9})\s+\d{1,2},?\s+(\d{4})\b/g, 1, 2);
  collectMatches(/\b\d{1,2}\s+([A-Za-z]{3,9})\s+(\d{4})\b/g, 1, 2);

  if (lastYear !== null) {
    return { yearsByMonth, fallbackYear: lastYear };
  }

  let iso: RegExpExecArray | null;
  const isoRegex = /\b(\d{4})-(\d{2})-\d{2}\b/g;
  while ((iso = isoRegex.exec(trimmed)) !== null) {
    const yearNum = Number(iso[1]);
    const monthNum = Number(iso[2]) - 1;
    if (monthNum >= 0 && monthNum <= 11 && Number.isInteger(yearNum)) {
      yearsByMonth.set(monthNum, yearNum);
      lastYear = yearNum;
    }
  }

  return lastYear !== null ? { yearsByMonth, fallbackYear: lastYear } : null;
}

function buildUtcDateHeader(
  year: number,
  monthIndex: number,
  dayOfMonth: number,
  expectedWeekday: DayOfWeek | null,
  rawLabel: string,
): { ok: true; header: ParsedDayHeader } | { ok: false; message: string } {
  const ms = Date.UTC(year, monthIndex, dayOfMonth);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== dayOfMonth
  ) {
    return { ok: false, message: `Invalid calendar date "${rawLabel}".` };
  }

  const actualDayOfWeek = utcDayToDayOfWeek(date.getUTCDay());
  if (expectedWeekday !== null && actualDayOfWeek !== expectedWeekday) {
    return {
      ok: false,
      message: `Weekday does not match UTC calendar date in "${rawLabel}".`,
    };
  }

  return {
    ok: true,
    header: {
      kind: 'CALENDAR_DATE',
      dayOfWeek: actualDayOfWeek,
      utcEpochDay: Math.floor(ms / 86_400_000),
    },
  };
}

function resolveOptionalWeekday(
  rawWeekday: string | undefined,
  rawLabel: string,
): { ok: true; weekday: DayOfWeek | null } | { ok: false; message: string } {
  if (!rawWeekday) return { ok: true, weekday: null };
  const wd = WEEKDAY_MAP[rawWeekday.toLowerCase()];
  return wd !== undefined
    ? { ok: true, weekday: wd }
    : { ok: false, message: `Unrecognized weekday in header "${rawLabel}".` };
}

function parseSingleDayHeader(
  rawHeader: string,
  yearContext: YearContext | null,
): { ok: true; header: ParsedDayHeader } | { ok: false; message: string } {
  const trimmed = rawHeader.trim();
  if (!trimmed) return { ok: false, message: 'Empty day header.' };

  const pureWeekday = WEEKDAY_MAP[trimmed.toLowerCase()];
  if (pureWeekday !== undefined) {
    return { ok: true, header: { kind: 'WEEKDAY', dayOfWeek: pureWeekday } };
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) {
    return {
      ok: false,
      message: `Ambiguous numeric date header "${trimmed}" is not allowed. Use ISO YYYY-MM-DD or named month.`,
    };
  }

  const isoMatch = /^(?:([A-Za-z]{3,9}),?\s+)?(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const wd = resolveOptionalWeekday(isoMatch[1], trimmed);
    if (!wd.ok) return wd;
    return buildUtcDateHeader(
      Number(isoMatch[2]),
      Number(isoMatch[3]) - 1,
      Number(isoMatch[4]),
      wd.weekday,
      trimmed,
    );
  }

  const dmyFull = /^(?:([A-Za-z]{3,9}),?\s+)?(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/.exec(
    trimmed,
  );
  if (dmyFull) {
    const wd = resolveOptionalWeekday(dmyFull[1], trimmed);
    if (!wd.ok) return wd;
    const monthIndex = MONTH_MAP[(dmyFull[3] ?? '').toLowerCase()];
    if (monthIndex === undefined) {
      return { ok: false, message: `Unrecognized month in header "${trimmed}".` };
    }
    return buildUtcDateHeader(Number(dmyFull[4]), monthIndex, Number(dmyFull[2]), wd.weekday, trimmed);
  }

  const mdyFull = /^(?:([A-Za-z]{3,9}),?\s+)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(
    trimmed,
  );
  if (mdyFull) {
    const wd = resolveOptionalWeekday(mdyFull[1], trimmed);
    if (!wd.ok) return wd;
    const monthIndex = MONTH_MAP[(mdyFull[2] ?? '').toLowerCase()];
    if (monthIndex === undefined) {
      return { ok: false, message: `Unrecognized month in header "${trimmed}".` };
    }
    return buildUtcDateHeader(Number(mdyFull[4]), monthIndex, Number(mdyFull[3]), wd.weekday, trimmed);
  }

  if (yearContext !== null) {
    const dmyShort = /^(?:([A-Za-z]{3,9}),?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})$/.exec(trimmed);
    if (dmyShort) {
      const wd = resolveOptionalWeekday(dmyShort[1], trimmed);
      if (!wd.ok) return wd;
      const monthIndex = MONTH_MAP[(dmyShort[3] ?? '').toLowerCase()];
      if (monthIndex === undefined) {
        return { ok: false, message: `Unrecognized month in header "${trimmed}".` };
      }
      const year = yearContext.yearsByMonth.get(monthIndex) ?? yearContext.fallbackYear;
      return buildUtcDateHeader(year, monthIndex, Number(dmyShort[2]), wd.weekday, trimmed);
    }

    const mdyShort = /^(?:([A-Za-z]{3,9}),?\s+)?([A-Za-z]{3,9})\s+(\d{1,2})$/.exec(trimmed);
    if (mdyShort) {
      const wd = resolveOptionalWeekday(mdyShort[1], trimmed);
      if (!wd.ok) return wd;
      const monthIndex = MONTH_MAP[(mdyShort[2] ?? '').toLowerCase()];
      if (monthIndex === undefined) {
        return { ok: false, message: `Unrecognized month in header "${trimmed}".` };
      }
      const year = yearContext.yearsByMonth.get(monthIndex) ?? yearContext.fallbackYear;
      return buildUtcDateHeader(year, monthIndex, Number(mdyShort[3]), wd.weekday, trimmed);
    }
  }

  return { ok: false, message: `Unrecognized day header "${trimmed}".` };
}

/**
 * Validates and normalizes the 7 day column headers (Weekday-only or 7 consecutive
 * UTC Calendar-Date headers; mixing modes is rejected).
 *
 * @param headerRow - The 8-column header row from RFC 4180 parsing.
 * @param yearContext - Optional year context extracted from a 1-column report banner.
 * @returns Normalized day headers ordered by CSV column (1..7), or structured errors.
 */
export function parseDayHeadersRow(
  headerRow: ParsedCsvRow,
  yearContext: YearContext | null,
): { ok: true; dayHeaders: ParsedDayHeader[]; rawLabels: string[] } | { ok: false; errors: CsvParseError[] } {
  if (headerRow.cells.length !== 8) {
    return {
      ok: false,
      errors: [
        {
          row: headerRow.rowNumber,
          message: `Expected exactly 8 columns (1 hour column + 7 day columns), found ${headerRow.cells.length}.`,
        },
      ],
    };
  }

  const errors: CsvParseError[] = [];
  const dayHeaders: ParsedDayHeader[] = [];
  const rawLabels: string[] = [];

  for (let col = 1; col <= 7; col++) {
    const label = headerRow.cells[col]?.value.trim() ?? '';
    rawLabels.push(label);
    const parsed = parseSingleDayHeader(label, yearContext);
    if (!parsed.ok) {
      errors.push({
        row: headerRow.rowNumber,
        column: col + 1,
        dayLabel: label,
        message: parsed.message,
      });
    } else {
      dayHeaders.push(parsed.header);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const firstKind = dayHeaders[0]?.kind;
  if (dayHeaders.some((h) => h.kind !== firstKind)) {
    return {
      ok: false,
      errors: [
        {
          row: headerRow.rowNumber,
          message:
            'Inconsistent day headers: cannot mix weekday-only headers with calendar-date headers.',
        },
      ],
    };
  }

  const seenDays = new Set<DayOfWeek>();
  for (let i = 0; i < dayHeaders.length; i++) {
    const h = dayHeaders[i]!;
    if (seenDays.has(h.dayOfWeek)) {
      errors.push({
        row: headerRow.rowNumber,
        column: i + 2,
        dayLabel: rawLabels[i],
        message: `Duplicate day of week in header "${rawLabels[i] ?? ''}".`,
      });
    }
    seenDays.add(h.dayOfWeek);
  }

  if (firstKind === 'CALENDAR_DATE') {
    const epochDays = dayHeaders.map((h) => (h.kind === 'CALENDAR_DATE' ? h.utcEpochDay : 0));
    const uniqueEpochDays = new Set(epochDays);
    if (
      uniqueEpochDays.size !== 7 ||
      Math.max(...epochDays) - Math.min(...epochDays) !== 6
    ) {
      errors.push({
        row: headerRow.rowNumber,
        message: 'Calendar-date headers must represent 7 consecutive UTC calendar days.',
      });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, dayHeaders, rawLabels };
}

/** Parses an operating hour label (`7am`–`10pm` or `07:00`–`22:00`) into `OperatingHour`. */
export function parseOperatingHour(rawHour: string): OperatingHour | null {
  const trimmed = rawHour.trim().toLowerCase();

  const ampmMatch = /^(\d{1,2})\s*(am|pm)$/.exec(trimmed);
  if (ampmMatch) {
    const rawNum = Number(ampmMatch[1]);
    if (rawNum < 1 || rawNum > 12) return null;
    const hour24 =
      ampmMatch[2] === 'am'
        ? rawNum === 12
          ? 0
          : rawNum
        : rawNum === 12
          ? 12
          : rawNum + 12;
    return hour24 >= 7 && hour24 <= 22 ? (hour24 as OperatingHour) : null;
  }

  const h24Match = /^(\d{1,2}):00$/.exec(trimmed);
  if (h24Match) {
    const hour24 = Number(h24Match[1]);
    return hour24 >= 7 && hour24 <= 22 ? (hour24 as OperatingHour) : null;
  }

  return null;
}
