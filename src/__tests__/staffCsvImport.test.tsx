// @vitest-environment jsdom
/**
 * @file Unit and UI integration tests for Staff CSV Import (`parseStaffCsv`,
 * `importStaffCsvToSchedule`, and `StaffImportModal` with default-on Update matching names).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { parseCsvTransactions } from '../domain/csvParser';
import { DEMO_STAFF_CSV_TEXT } from '../domain/demoData';
import { parseStaffCsv } from '../domain/staffCsvParser';
import {
  createEmptyPersistedState,
  type LoadStateResult,
  type StorageLike,
} from '../persistence/storageTypes';
import type { ActionDeps } from '../state/actionTypes';
import { createSchedule } from '../state/scheduleActions';
import { addStaff, importStaffCsvToSchedule } from '../state/scheduleEntityActions';

afterEach(() => {
  cleanup();
});

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function createTestDeps(): ActionDeps {
  let seq = 1;
  return {
    nowIso: () => '2026-08-10T08:00:00.000Z',
    generateId: () => `scsv-${seq++}`,
  };
}

function makeNormalBootstrap(): LoadStateResult {
  return {
    storageMode: 'normal',
    saveStatus: 'saved',
    state: createEmptyPersistedState(),
    rawPayload: null,
    backupSaved: false,
    errorMessage: null,
    warnings: [],
  };
}

describe('parseStaffCsv (domain)', () => {
  it('parses DEMO_STAFF_CSV_TEXT and unavailable_days variants cleanly', () => {
    const demo = parseStaffCsv(DEMO_STAFF_CSV_TEXT);
    expect(demo.ok).toBe(true);
    if (demo.ok) {
      expect(demo.rows).toHaveLength(9);
      expect(demo.rows[0]).toMatchObject({ name: 'Alice Nguyen', maxWeeklyHours: 40 });
    }

    const custom = parseStaffCsv(
      [
        'Staff Name,Max Hours,Days Off',
        'Alice Nguyen,36,"Sat, Sun"',
        'Brian Tran,24,Monday;Wed',
        'Carla Pham,40,none',
      ].join('\n'),
    );
    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.rows[0]?.unavailableDays).toEqual([5, 6]);
      expect(custom.rows[1]?.unavailableDays).toEqual([0, 2]);
      expect(custom.rows[2]?.unavailableDays).toBeUndefined();
    }
  });

  it('rejects missing headers, duplicate names, invalid hours, and invalid weekdays with row numbers', () => {
    const badHeader = parseStaffCsv('foo,bar\nAlice,40');
    expect(badHeader.ok).toBe(false);

    const badRows = parseStaffCsv(
      [
        'name,max_weekly_hours,unavailable_days',
        'Alice,40,',
        'alice,32,',
        'Bob,-5,',
        'Carla,24,Funday',
      ].join('\n'),
    );
    expect(badRows.ok).toBe(false);
    if (!badRows.ok) {
      expect(badRows.errors.length).toBe(3);
      expect(badRows.errors[0]?.message).toMatch(/duplicate staff name/i);
      expect(badRows.errors[1]?.message).toMatch(/non-negative whole number/i);
      expect(badRows.errors[2]?.message).toMatch(/unrecognized weekday/i);
    }
  });
});

describe('importStaffCsvToSchedule (state action)', () => {
  it('updates matching names when updateExisting=true and skips them when false while preserving IDs', () => {
    const deps = createTestDeps();
    const created = createSchedule(createEmptyPersistedState(), 'Store A', deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const s1 = addStaff(
      created.state,
      created.scheduleId,
      { name: 'Alice Nguyen', maxWeeklyHours: 40 },
      deps,
    );
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const originalAliceId = s1.staffId;

    const csv = [
      'name,max_weekly_hours,unavailable_days',
      'alice nguyen,32,Sun',
      'Brian Tran,24,Mon;Wed',
    ].join('\n');

    // Update mode (default)
    const updatedRes = importStaffCsvToSchedule(
      s1.state,
      created.scheduleId,
      csv,
      { updateExisting: true },
      deps,
    );
    expect(updatedRes.ok).toBe(true);
    if (!updatedRes.ok) return;
    expect(updatedRes.addedCount).toBe(1);
    expect(updatedRes.updatedCount).toBe(1);
    expect(updatedRes.skippedCount).toBe(0);

    const scheduleAfterUpdate = updatedRes.state.schedules[0]!;
    expect(scheduleAfterUpdate.staff).toHaveLength(2);
    expect(scheduleAfterUpdate.staff[0]).toEqual({
      id: originalAliceId,
      name: 'alice nguyen',
      maxWeeklyHours: 32,
      unavailableDays: [6],
    });

    // Skip mode
    const skipRes = importStaffCsvToSchedule(
      s1.state,
      created.scheduleId,
      csv,
      { updateExisting: false },
      deps,
    );
    expect(skipRes.ok).toBe(true);
    if (!skipRes.ok) return;
    expect(skipRes.addedCount).toBe(1);
    expect(skipRes.updatedCount).toBe(0);
    expect(skipRes.skippedCount).toBe(1);
    expect(skipRes.state.schedules[0]!.staff[0]?.maxWeeklyHours).toBe(40);
  });
});

describe('StaffImportModal UI integration', () => {
  it('defaults Update matching names to checked, loads demo staff CSV, and updates/skips on re-import', async () => {
    const user = userEvent.setup();
    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
      />,
    );

    // Create blank schedule
    await user.click(screen.getAllByRole('button', { name: /New Schedule/i })[0]!);
    const nameInput = screen.getByLabelText(/Schedule name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'CSV Staff Test');
    await user.click(screen.getAllByRole('button', { name: /^Create Schedule$/i })[0]!);

    // Open Import Staff CSV modal from Team panel
    await user.click(screen.getByRole('button', { name: /Import Staff CSV/i }));
    const dialog = screen.getByRole('dialog', { name: /Import Staff CSV/i });

    // Checkbox defaults to checked
    const updateCheckbox = within(dialog).getByRole('checkbox', {
      name: /Update existing staff with matching names/i,
    }) as HTMLInputElement;
    expect(updateCheckbox.checked).toBe(true);

    // Load demo staff CSV (9 rows) and import
    await user.click(within(dialog).getByRole('button', { name: /Load demo staff CSV/i }));
    expect(within(dialog).getByText(/\+9 new/i)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Import Staff \(9\)/i }));

    expect(screen.getByText(/Team \(9\)/i)).toBeTruthy();

    // Re-open modal and paste an update for Alice + 1 new staff member
    await user.click(screen.getByRole('button', { name: /Import Staff CSV/i }));
    const dialog2 = screen.getByRole('dialog', { name: /Import Staff CSV/i });
    const textarea = within(dialog2).getByLabelText(/Or paste CSV content/i);
    await user.type(
      textarea,
      'name,max_weekly_hours,unavailable_days\nAlice Nguyen,30,Sun\nZara Kim,20,Sat',
    );

    // Default checked -> 1 new, 1 update
    expect(within(dialog2).getByText(/\+1 new/i)).toBeTruthy();
    expect(within(dialog2).getByText(/1 update/i)).toBeTruthy();

    // Unchecking switches Alice from update -> skip
    const checkbox2 = within(dialog2).getByRole('checkbox', {
      name: /Update existing staff with matching names/i,
    });
    await user.click(checkbox2);
    expect(within(dialog2).getByText(/1 skip/i)).toBeTruthy();

    // Re-check and import both
    await user.click(checkbox2);
    await user.click(within(dialog2).getByRole('button', { name: /Import Staff \(2\)/i }));
    expect(screen.getByText(/Team \(10\)/i)).toBeTruthy();
    expect(screen.getByText(/Staff CSV imported \(1 added, 1 updated\)\./i)).toBeTruthy();
  });
});

describe('Bundled sample CSV fixtures in docs/', () => {
  it('parses all bundled staff and transaction sample CSV files cleanly', () => {
    const docsDir = resolve(process.cwd(), 'docs');

    const demoStaff = parseStaffCsv(readFileSync(resolve(docsDir, 'sample_staff_demo.csv'), 'utf8'));
    expect(demoStaff.ok).toBe(true);
    if (demoStaff.ok) expect(demoStaff.rows).toHaveLength(9);

    const busyStaff = parseStaffCsv(
      readFileSync(resolve(docsDir, 'sample_staff_busy_store.csv'), 'utf8'),
    );
    expect(busyStaff.ok).toBe(true);
    if (busyStaff.ok) expect(busyStaff.rows).toHaveLength(14);

    const weekendTxns = parseCsvTransactions(
      readFileSync(resolve(docsDir, 'report_Transaction_weekend_rush.csv'), 'utf8'),
    );
    expect(weekendTxns.ok).toBe(true);

    const morningTxns = parseCsvTransactions(
      readFileSync(resolve(docsDir, 'report_Transaction_cafe_morning_peak.csv'), 'utf8'),
    );
    expect(morningTxns.ok).toBe(true);
  });
});
