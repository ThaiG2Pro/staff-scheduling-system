// @vitest-environment jsdom
/**
 * @file UI integration tests for Slice 4 (WeeklyRosterGrid, AssignmentChip,
 * AssignmentGuidancePopover, ScheduleHealthBar 4 signals, ContextualBanners,
 * and P0 AggregatedSummaryView 7x16 with 1-click jump).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import {
  createEmptyPersistedState,
  type LoadStateResult,
  type StorageLike,
} from '../persistence/storageTypes';
import type { ActionDeps } from '../state/actionTypes';

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
    generateId: () => `t4-${seq++}`,
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

describe('Slice 4: Weekly Roster, AssignmentGuidancePopover & Pinning (AC-04)', () => {
  it('supports 2-click Assign, Pin toggle, Reassign resetting isPinned=false, and soft-override (AC-04)', async () => {
    const user = userEvent.setup();
    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
      />,
    );

    // Load Demo Store (9 staff, 2 default shifts, CSV demand loaded)
    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    // 1. 2-click Assign on Mon 07:00 – 15:00
    await user.click(screen.getByRole('button', { name: /Add staff to Mon 07:00 – 15:00/i }));
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText(/Eligible/i)).toBeTruthy();
    await user.click(within(popover).getByRole('button', { name: /Alice Nguyen/i }));

    // Verify chip rendered & pin it
    const pinBtn = screen.getByRole('button', { name: /^Pin Alice Nguyen$/i });
    await user.click(pinBtn);
    expect(screen.getByRole('button', { name: /^Unpin Alice Nguyen$/i })).toBeTruthy();

    // 2. Reassign pinned shift -> shows indigo notice and resets isPinned=false (E-05)
    await user.click(
      within(screen.getByRole('table')).getByRole('button', { name: /^Alice Nguyen$/i }),
    );
    const reassignPopover = screen.getByRole('dialog');
    expect(
      within(reassignPopover).getByText(/Replacing a pinned shift starts as Unpinned/i),
    ).toBeTruthy();
    await user.click(within(reassignPopover).getByRole('button', { name: /Brian Tran/i }));

    // Brian Tran is now in Mon 07:00 – 15:00 and unpinned
    expect(screen.getByRole('button', { name: /^Pin Brian Tran$/i })).toBeTruthy();

    // 3. Soft-override: assign Brian Tran to Mon 15:00 – 23:00 (Requires attention -> Confirm) (E-07)
    await user.click(screen.getByRole('button', { name: /Add staff to Mon 15:00 – 23:00/i }));
    const overridePopover = screen.getByRole('dialog');
    expect(within(overridePopover).getByText(/Requires attention/i)).toBeTruthy();
    await user.click(within(overridePopover).getByRole('button', { name: /Brian Tran/i }));
    expect(within(overridePopover).getByText(/Assign with warning\?/i)).toBeTruthy();
    await user.click(within(overridePopover).getByRole('button', { name: /^Confirm$/i }));

    // Both chips should show local warning (2+ shifts same day)
    expect(screen.getAllByLabelText(/2\+ shifts same day/i).length).toBeGreaterThanOrEqual(2);

    // 4. Pin both conflicting shifts and click Auto-schedule -> blocked with Pin Conflict banner (E-03)
    const pinBrianButtons = screen.getAllByRole('button', { name: /^Pin Brian Tran$/i });
    for (const btn of pinBrianButtons) {
      await user.click(btn);
    }
    await user.click(screen.getByRole('button', { name: /Auto-schedule/i }));
    expect(screen.getByText(/Auto-schedule blocked — resolve conflicting pinned shifts/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Highlight conflicting shifts/i }));
  });
});

describe('Slice 4: Schedule Health Bar & P0 Aggregated Summary 7x16 (AC-05)', () => {
  it('renders 4 independent Health Bar signals, P0 7x16 Summary KPIs, and 1-click Gap jump (AC-05)', async () => {
    const user = userEvent.setup();
    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    // 4 independent signals in ScheduleHealthBar
    const healthSection = screen.getByRole('region', { name: /Schedule health/i });
    expect(within(healthSection).getByText(/Staffing Gaps/i)).toBeTruthy();
    expect(within(healthSection).getByText(/Hour Limit Warnings/i)).toBeTruthy();
    expect(within(healthSection).getByText(/Demand Coverage/i)).toBeTruthy();
    expect(within(healthSection).getByText(/Hour Fairness/i)).toBeTruthy();

    // Clicking Staffing Gaps jumps to Hourly Summary tab
    await user.click(within(healthSection).getByRole('button', { name: /Staffing Gaps/i }));

    // Verify 4 mandatory weekly KPI cards
    expect(screen.getByText('Total Transactions')).toBeTruthy();
    expect(screen.getByText('Total Staff Hours')).toBeTruthy();
    expect(screen.getByText('Overall Txns / Staff Hr')).toBeTruthy();
    expect(screen.getByText('Average Txns / Staff Hr')).toBeTruthy();

    // Verify 07:00 and 22:00 rows exist in 7x16 grid
    expect(screen.getByRole('rowheader', { name: '07:00' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '22:00' })).toBeTruthy();

    // Click a Gap cell -> jumps back to Weekly Roster with Focused banner
    const mon07GapBtn = screen.getByRole('button', {
      name: /Mon 07:00 staffing gap — jump to Weekly Roster/i,
    });
    await user.click(mon07GapBtn);

    expect(screen.getByText(/Focused from Hourly Summary:/i)).toBeTruthy();
    expect(screen.getByText(/Mon 07:00/i)).toBeTruthy();

    // Run Auto-schedule and verify 1-click Undo Auto-schedule restores empty draft
    await user.click(screen.getByRole('button', { name: /Auto-schedule/i }));
    expect(screen.getByRole('button', { name: /Undo Auto-schedule/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Undo Auto-schedule/i }));
    expect(screen.queryByRole('button', { name: /Undo Auto-schedule/i })).toBeNull();
  });
});
