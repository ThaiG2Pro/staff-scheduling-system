// @vitest-environment jsdom
/**
 * @file UI integration tests for Slice 3 (App Shell, 4 Storage Modes, Atomic Reset,
 * Round-trip Target N, Schedule/Staff/Shift Prepare Flows, and CSV Import modal).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { DEMO_STORE_CSV_TEXT } from '../domain/demoData';
import {
  CURRENT_SCHEMA_VERSION,
  PRIMARY_STORAGE_KEY,
  createEmptyPersistedState,
  type LoadStateResult,
  type StorageLike,
} from '../persistence/storageTypes';
import type { ActionDeps } from '../state/actionTypes';

afterEach(() => {
  cleanup();
});

function createMemoryStorage(initial: Record<string, string> = {}): {
  storage: StorageLike;
  data: Map<string, string>;
  failSetItem: boolean;
  failGetItem: boolean;
} {
  const data = new Map<string, string>(Object.entries(initial));
  const state = {
    data,
    failSetItem: false,
    failGetItem: false,
    storage: {
      getItem(key: string) {
        if (state.failGetItem) {
          throw new Error('SecurityError: storage blocked');
        }
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (state.failSetItem) {
          throw new Error('QuotaExceededError: storage full');
        }
        data.set(key, value);
      },
    },
  };
  return state;
}

function createTestDeps(): ActionDeps {
  let seq = 1;
  return {
    nowIso: () => '2026-08-10T08:00:00.000Z',
    generateId: () => `id-${seq++}`,
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

describe('Slice 3: 4 Storage Modes & Atomic Reset UI (AC-06)', () => {
  it('renders recovery_locked banner, locks actions, and enforces Atomic Reset Contract (AC-06)', async () => {
    const user = userEvent.setup();
    const mem = createMemoryStorage({ [PRIMARY_STORAGE_KEY]: '{broken-json' });
    mem.failSetItem = true;

    const bootstrap: LoadStateResult = {
      storageMode: 'recovery_locked',
      saveStatus: 'locked',
      state: createEmptyPersistedState(),
      rawPayload: '{broken-json',
      backupSaved: true,
      errorMessage: 'Corrupted JSON payload in localStorage.',
      warnings: [],
    };

    render(
      <App
        bootstrapState={bootstrap}
        storeOptions={{ deps: createTestDeps(), getStorage: () => mem.storage }}
      />,
    );

    expect(screen.getByText(/Saved data could not be loaded/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /New Schedule/i })).toHaveProperty('disabled', true);

    // Trigger Reset & Start Fresh while setItem fails -> must stay locked and show error
    await user.click(screen.getByRole('button', { name: /Reset & Start Fresh/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Reset & Start Fresh/i }));

    expect(within(dialog).getByRole('alert').textContent).toMatch(/QuotaExceededError/i);
    expect(mem.data.get(PRIMARY_STORAGE_KEY)).toBe('{broken-json');

    // Now allow setItem to succeed -> unlocks to normal mode
    mem.failSetItem = false;
    await user.click(within(dialog).getByRole('button', { name: /Reset & Start Fresh/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Saved data could not be loaded/i)).toBeNull();
    expect(screen.getByRole('button', { name: /New Schedule/i })).toHaveProperty('disabled', false);
  });

  it('renders incompatible_version_locked without Reset button and blocks writes (AC-06)', () => {
    const bootstrap: LoadStateResult = {
      storageMode: 'incompatible_version_locked',
      saveStatus: 'locked',
      state: createEmptyPersistedState(),
      rawPayload: JSON.stringify({ schemaVersion: 99 }),
      backupSaved: false,
      errorMessage: 'Schema version 99 is newer than supported version 1.',
      warnings: [],
    };

    render(<App bootstrapState={bootstrap} storeOptions={{ deps: createTestDeps() }} />);

    expect(screen.getByText(/Incompatible newer data version/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reset & Start Fresh/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Load Demo Store/i })).toHaveProperty('disabled', true);
  });

  it('renders storage_unavailable_locked with Retry only (no Reset) and unlocks on Retry (AC-06)', async () => {
    const user = userEvent.setup();
    const mem = createMemoryStorage();

    const bootstrap: LoadStateResult = {
      storageMode: 'storage_unavailable_locked',
      saveStatus: 'locked',
      state: createEmptyPersistedState(),
      rawPayload: null,
      backupSaved: false,
      errorMessage: 'SecurityError: localStorage disabled.',
      warnings: [],
    };

    render(
      <App
        bootstrapState={bootstrap}
        storeOptions={{ deps: createTestDeps(), getStorage: () => mem.storage }}
      />,
    );

    expect(screen.getByText(/Browser local storage is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reset & Start Fresh/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Retry Storage Access/i }));

    expect(screen.queryByText(/Browser local storage is unavailable/i)).toBeNull();
    expect(screen.getByRole('button', { name: /New Schedule/i })).toHaveProperty('disabled', false);
  });

  it('shows save_error banner & badge while preserving RAM changes when setItem fails (AC-06)', async () => {
    const user = userEvent.setup();
    const mem = createMemoryStorage();
    mem.failSetItem = true;

    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: () => mem.storage }}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    expect(
      screen.getAllByText(/Unable to save locally — changes exist in memory only/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue('Demo Store — Typical Week')).toBeTruthy();
  });
});

describe('Slice 3: Prepare Flows, Target N Round-trip & CSV Import (AC-01, AC-02)', () => {
  it('validates Target N decimals & rejects IEEE-754 precision loss without mutating state (AC-01, AC-06)', async () => {
    const user = userEvent.setup();
    const mem = createMemoryStorage();

    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: () => mem.storage }}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    const targetInput = screen.getByLabelText(/^Target transactions per staff hour$/i) as HTMLInputElement;
    expect(targetInput.value).toBe('15');
    expect(targetInput.getAttribute('step')).toBeNull();

    // Accept valid decimal 12.5
    await user.clear(targetInput);
    await user.type(targetInput, '12.5{Enter}');
    expect(targetInput.value).toBe('12.5');
    expect(screen.queryByRole('alert')).toBeNull();

    // Reject IEEE-754 precision loss 1.0000000000000001
    await user.clear(targetInput);
    await user.type(targetInput, '1.0000000000000001{Enter}');
    expect(screen.getByRole('alert').textContent).toMatch(/precision/i);

    // Persisted schedule must still hold 12.5
    const saved = JSON.parse(mem.data.get(PRIMARY_STORAGE_KEY) ?? '{}');
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.schedules[0].targetTxnsPerStaffHour).toBe(12.5);
  });

  it('supports Staff CRUD, Shift Templates CRUD with cascade previews, and CSV preserve-on-error (AC-01, AC-02)', async () => {
    const user = userEvent.setup();
    const mem = createMemoryStorage();

    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: () => mem.storage }}
      />,
    );

    // Create a blank schedule
    await user.click(screen.getAllByRole('button', { name: /Create Schedule/i })[0]!);
    await user.type(screen.getByLabelText(/Schedule Name/i), 'Store #42 Week 1{Enter}');

    // Auto-schedule should be disabled initially (E-02: missing demand & staff)
    const autoBtn = screen.getByRole('button', { name: /Auto-schedule/i });
    expect(autoBtn).toHaveProperty('disabled', true);

    // Add a staff member via StaffFormModal (strictly 2 fields)
    await user.click(screen.getAllByRole('button', { name: /^Add Staff$/i })[0]!);
    const staffDialog = screen.getByRole('dialog');
    await user.type(within(staffDialog).getByLabelText(/Staff Name/i), 'Maya Lin');
    const hoursInput = within(staffDialog).getByLabelText(/Max Weekly Hours/i);
    await user.clear(hoursInput);
    await user.type(hoursInput, '32');
    await user.click(within(staffDialog).getByRole('button', { name: /^Add Staff$/i }));

    expect(screen.getByText('Maya Lin')).toBeTruthy();

    // Open Manage Shifts Modal & add overlapping midday shift 10:00–14:00
    await user.click(screen.getByRole('button', { name: /^Shifts$/i }));
    const shiftsDialog = screen.getByRole('dialog');
    expect(within(shiftsDialog).getByText('07:00 – 15:00')).toBeTruthy();
    expect(within(shiftsDialog).getByText('15:00 – 23:00')).toBeTruthy();
    await user.click(within(shiftsDialog).getByRole('button', { name: /Add Shift/i }));
    expect(within(shiftsDialog).getByText('10:00 – 14:00')).toBeTruthy();
    await user.click(within(shiftsDialog).getByRole('button', { name: /^Done$/i }));

    // Import valid CSV via CsvImportModal
    await user.click(screen.getByRole('button', { name: /^Import CSV$/i }));
    const csvDialog = screen.getByRole('dialog');
    const textarea = within(csvDialog).getByLabelText(/Or paste CSV content/i);
    fireEvent.change(textarea, { target: { value: DEMO_STORE_CSV_TEXT } });
    await user.click(within(csvDialog).getByRole('button', { name: /Import Demand/i }));

    expect(screen.getByText(/Imported .* weekly transactions/i)).toBeTruthy();
    // Auto-schedule should now be enabled
    expect(screen.getByRole('button', { name: /Auto-schedule/i })).toHaveProperty('disabled', false);

    // Attempt malformed CSV import -> must fail and preserve existing demand (E-01)
    await user.click(screen.getByRole('button', { name: /Import CSV/i }));
    const csvDialog2 = screen.getByRole('dialog');
    fireEvent.change(within(csvDialog2).getByLabelText(/Or paste CSV content/i), {
      target: { value: 'bad,csv,content' },
    });
    await user.click(within(csvDialog2).getByRole('button', { name: /Import Demand/i }));

    expect(within(csvDialog2).getByText(/existing demand data was preserved/i)).toBeTruthy();
    await user.click(within(csvDialog2).getByRole('button', { name: /Cancel/i }));

    // Run Auto-schedule so Maya Lin gets assigned shifts, then verify Delete Staff cascade count (E-08)
    await user.click(screen.getByRole('button', { name: /Auto-schedule/i }));
    expect(screen.getByText(/Auto-schedule draft ready/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Delete Maya Lin/i }));
    const deleteDialog = screen.getByRole('dialog');
    expect(within(deleteDialog).getByText(/currently has \d+ assigned shift/i)).toBeTruthy();
    await user.click(within(deleteDialog).getByRole('button', { name: /Delete Staff/i }));
    expect(screen.queryByText('Maya Lin')).toBeNull();
  });
});
