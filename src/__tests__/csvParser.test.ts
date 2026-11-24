import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATING_HOURS } from '../domain/constants';
import { parseCsvTransactions } from '../domain/csvParser';

function makeHourlyRows(valuesByHour: (h: number) => number[], use24h = false): string[] {
  return OPERATING_HOURS.map((h) => {
    const label = use24h
      ? `${String(h).padStart(2, '0')}:00`
      : h < 12
        ? `${h}am`
        : h === 12
          ? '12pm'
          : `${h - 12}pm`;
    return `${label},${valuesByHour(h).join(',')}`;
  });
}

describe('csvParser (T-03, T-04, T-05, AC-02)', () => {
  it('T-03: normalizes official sample CSV (Fri-Thu -> Mon-Sun) with UTF-8 BOM, CRLF & RFC 4180 quotes (AC-02)', () => {
    const samplePath = resolve(process.cwd(), 'docs/report_Transaction_20260807_20260813.csv');
    const rawCsv = readFileSync(samplePath, 'utf-8');

    // Official sample file already contains UTF-8 BOM (\uFEFF) and CRLF (\r\n)
    expect(rawCsv.startsWith('\uFEFF')).toBe(true);
    const result = parseCsvTransactions(rawCsv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify Fri (07 Aug) -> DayOfWeek 4, Mon (10 Aug) -> DayOfWeek 0, Thu (13 Aug) -> DayOfWeek 3
    // Line 3: 7am,22(Fri),13(Sat),7(Sun),12(Mon),22(Tue),13(Wed),16(Thu)
    expect(result.transactions[4][7]).toBe(22); // Fri 7am
    expect(result.transactions[5][7]).toBe(13); // Sat 7am
    expect(result.transactions[6][7]).toBe(7); // Sun 7am
    expect(result.transactions[0][7]).toBe(12); // Mon 7am
    expect(result.transactions[1][7]).toBe(22); // Tue 7am
    expect(result.transactions[2][7]).toBe(13); // Wed 7am
    expect(result.transactions[3][7]).toBe(16); // Thu 7am

    // Line 9: 1pm (13:00),64(Fri),44(Sat),38(Sun),45(Mon),48(Tue),45(Wed),45(Thu)
    expect(result.transactions[4][13]).toBe(64);
    expect(result.transactions[0][13]).toBe(45);

    // Line 18: 10pm (22:00),5(Fri),5(Sat),6(Sun),7(Mon),2(Tue),6(Wed),6(Thu)
    expect(result.transactions[4][22]).toBe(5);
    expect(result.transactions[1][22]).toBe(2);

    // Also test explicit calendar-date headers with year & quoted commas & escaped quotes in col 0
    const explicitCalendarCsv = [
      '"Hour ""Local""","Fri, 07 Aug 2026","Sat, 08 Aug 2026","Sun, 09 Aug 2026","Mon, 10 Aug 2026","Tue, 11 Aug 2026","Wed, 12 Aug 2026","Thu, 13 Aug 2026"',
      ...makeHourlyRows((h) => [h, h + 1, h + 2, h + 3, h + 4, h + 5, h + 6], true),
      '',
    ].join('\r\n');

    const res2 = parseCsvTransactions(explicitCalendarCsv);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.transactions[4][7]).toBe(7); // Fri
    expect(res2.transactions[0][7]).toBe(10); // Mon
  });

  it('T-04: accepts reordered Weekday-only headers (Wed..Tue -> Mon..Sun) and rejects mixed headers (AC-02)', () => {
    const weekdayCsv = [
      ',Wed,Thu,Fri,Sat,Sun,Mon,Tue',
      ...makeHourlyRows(() => [1, 2, 3, 4, 5, 6, 7]),
    ].join('\n');

    const res = parseCsvTransactions(weekdayCsv);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.transactions[2][7]).toBe(1); // Wed
    expect(res.transactions[3][7]).toBe(2); // Thu
    expect(res.transactions[4][7]).toBe(3); // Fri
    expect(res.transactions[5][7]).toBe(4); // Sat
    expect(res.transactions[6][7]).toBe(5); // Sun
    expect(res.transactions[0][7]).toBe(6); // Mon
    expect(res.transactions[1][7]).toBe(7); // Tue
    expect(res.totalTransactions).toBe((1 + 2 + 3 + 4 + 5 + 6 + 7) * 16);

    // Mixing weekday-only and calendar-date headers must be rejected
    const mixedCsv = [
      ',Mon,2026-08-11,Wed,Thu,Fri,Sat,Sun',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');

    const mixedRes = parseCsvTransactions(mixedCsv);
    expect(mixedRes.ok).toBe(false);
    if (!mixedRes.ok) {
      expect(mixedRes.errors[0]?.message).toMatch(/mix/i);
    }
  });

  it('T-05: fails gracefully with structured CsvParseError on invalid CSV data (E-01, AC-02)', () => {
    // 1. Missing hour (only 15 rows)
    const missingHourCsv = [
      ',Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]).slice(0, 15),
    ].join('\n');
    expect(parseCsvTransactions(missingHourCsv).ok).toBe(false);

    // 2. Duplicate hour
    const rows = makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]);
    rows[15] = '7am,1,1,1,1,1,1,1';
    const dupHourRes = parseCsvTransactions([',Mon,Tue,Wed,Thu,Fri,Sat,Sun', ...rows].join('\n'));
    expect(dupHourRes.ok).toBe(false);

    // 3. Negative / non-numeric cell
    const badValRows = makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]);
    badValRows[0] = '7am,-5,abc,1,1,1,1,1';
    const badValRes = parseCsvTransactions(
      [',Mon,Tue,Wed,Thu,Fri,Sat,Sun', ...badValRows].join('\n'),
    );
    expect(badValRes.ok).toBe(false);
    if (!badValRes.ok) {
      expect(badValRes.errors.length).toBeGreaterThanOrEqual(2);
      expect(badValRes.errors[0]?.row).toBe(2);
    }

    // 4. Multiline quoted field rejected
    const multilineCsv = [
      ',Mon,Tue,Wed,Thu,Fri,Sat,Sun',
      '"7am\nextra",1,1,1,1,1,1,1',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]).slice(1),
    ].join('\n');
    const multiRes = parseCsvTransactions(multilineCsv);
    expect(multiRes.ok).toBe(false);
    if (!multiRes.ok) {
      expect(multiRes.errors[0]?.message).toMatch(/multiline/i);
    }

    // 5. Cell or total exceeding Number.MAX_SAFE_INTEGER
    const hugeRows = makeHourlyRows(() => [
      Number.MAX_SAFE_INTEGER,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    const overflowRes = parseCsvTransactions(
      [',Mon,Tue,Wed,Thu,Fri,Sat,Sun', ...hugeRows].join('\n'),
    );
    expect(overflowRes.ok).toBe(false);

    // 6. Non-consecutive calendar dates
    const nonConsecCsv = [
      ',2026-08-07,2026-08-08,2026-08-09,2026-08-10,2026-08-11,2026-08-12,2026-08-20',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(nonConsecCsv).ok).toBe(false);

    // 7. Invalid calendar date (31 Feb 2026) & mismatched UTC weekday
    const invalidDateCsv = [
      ',28 Feb 2026,29 Feb 2026,30 Feb 2026,31 Feb 2026,01 Mar 2026,02 Mar 2026,03 Mar 2026',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(invalidDateCsv).ok).toBe(false);

    const wrongWeekdayCsv = [
      ',Mon 07 Aug 2026,Sat 08 Aug 2026,Sun 09 Aug 2026,Mon 10 Aug 2026,Tue 11 Aug 2026,Wed 12 Aug 2026,Thu 13 Aug 2026',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(wrongWeekdayCsv).ok).toBe(false);

    // 8. Ambiguous numeric date format rejected
    const ambiguousCsv = [
      ',01/02/2026,02/02/2026,03/02/2026,04/02/2026,05/02/2026,06/02/2026,07/02/2026',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(ambiguousCsv).ok).toBe(false);

    // 9. RFC 4180 syntax errors & structural errors
    expect(parseCsvTransactions('').ok).toBe(false);
    expect(parseCsvTransactions(',"unclosed,Tue,Wed,Thu,Fri,Sat,Sun\n').ok).toBe(false);
    expect(parseCsvTransactions(',"Mon"x,Tue,Wed,Thu,Fri,Sat,Sun\n').ok).toBe(false);
    expect(parseCsvTransactions(',Mo"n,Tue,Wed,Thu,Fri,Sat,Sun\n').ok).toBe(false);
    expect(parseCsvTransactions(',Mon,Tue,Wed\n').ok).toBe(false);
    expect(
      parseCsvTransactions(
        [',Mon,Mon,Wed,Thu,Fri,Sat,Sun', ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1])].join('\n'),
      ).ok,
    ).toBe(false);

    // 10. Out-of-range hour label & wrong data row column count
    const outOfRangeRows = makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]);
    outOfRangeRows[0] = '6am,1,1,1,1,1,1,1';
    expect(
      parseCsvTransactions([',Mon,Tue,Wed,Thu,Fri,Sat,Sun', ...outOfRangeRows].join('\n')).ok,
    ).toBe(false);

    const shortDataRows = makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]);
    shortDataRows[0] = '7am,1,1,1';
    expect(
      parseCsvTransactions([',Mon,Tue,Wed,Thu,Fri,Sat,Sun', ...shortDataRows].join('\n')).ok,
    ).toBe(false);

    // 11. MDY calendar format ("Aug 07, 2026") & ISO banner with short MDY headers
    const mdyCsv = [
      ',"Aug 07, 2026","Aug 08, 2026","Aug 09, 2026","Aug 10, 2026","Aug 11, 2026","Aug 12, 2026","Aug 13, 2026"',
      ...makeHourlyRows(() => [2, 2, 2, 2, 2, 2, 2]),
    ].join('\n');
    expect(parseCsvTransactions(mdyCsv).ok).toBe(true);

    const isoBannerCsv = [
      '"2026-08-07 - 2026-08-13"',
      ',"Fri, Aug 07","Sat, Aug 08","Sun, Aug 09","Mon, Aug 10","Tue, Aug 11","Wed, Aug 12","Thu, Aug 13"',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(isoBannerCsv).ok).toBe(true);

    // 12. Invalid 12am hour and unrecognized weekday in ISO date header
    const badIsoWd = [
      ',Xyz 2026-08-07,2026-08-08,2026-08-09,2026-08-10,2026-08-11,2026-08-12,2026-08-13',
      ...makeHourlyRows(() => [1, 1, 1, 1, 1, 1, 1]),
    ].join('\n');
    expect(parseCsvTransactions(badIsoWd).ok).toBe(false);
  });
});
