// @vitest-environment jsdom
/**
 * @file UI integration tests for Slice 4 (WeeklyRosterGrid, AssignmentChip,
 * AssignmentGuidancePopover, ScheduleHealthBar 4 signals, ContextualBanners,
 * and P0 AggregatedSummaryView 7x16 with 1-click jump).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
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

    // Clicking Staffing Gaps activates Gap Focus lens on Weekly Roster (with Next stepper & Clear lens)
    await user.click(within(healthSection).getByRole('button', { name: /Staffing Gaps/i }));
    expect(screen.getByText(/Gap focus:/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Next gap slot/i }));
    await user.click(screen.getByRole('button', { name: /Clear lens/i }));
    expect(screen.queryByText(/Gap focus:/i)).toBeNull();

    // Clicking Demand Coverage activates Coverage Focus lens on Hourly Summary tab
    await user.click(within(healthSection).getByRole('button', { name: /Demand Coverage/i }));
    expect(screen.getByText(/Coverage focus:/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Next understaffed hour/i }));

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

    // Return trip: Back to Summary highlights Mon 07:00, then Back to Roster returns
    await user.click(screen.getByRole('button', { name: /Back to Summary/i }));
    expect(screen.getByText(/Returned from Weekly Roster:/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back to Roster/i }));
    expect(screen.getByText(/Focused from Hourly Summary:/i)).toBeTruthy();

    // Roster Day header -> inspects that day in Hourly Summary -> Back to Roster
    await user.click(screen.getByRole('button', { name: /Inspect Sat in Hourly Summary/i }));
    expect(screen.getByText(/Focused from Weekly Roster:/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Back to Roster/i }));

    // Run Auto-schedule and verify 1-click Undo Auto-schedule restores empty draft
    await user.click(screen.getByRole('button', { name: /Auto-schedule/i }));
    expect(screen.getByRole('button', { name: /Undo Auto-schedule/i })).toBeTruthy();

    // Clicking Hour Fairness activates Rebalance lens and sorts Team panel by % Used
    await user.click(within(healthSection).getByRole('button', { name: /Hour Fairness/i }));
    expect(screen.getByText(/Rebalance lens:/i)).toBeTruthy();
    expect((screen.getByLabelText(/Sort staff/i) as HTMLSelectElement).value).toBe('utilization');
    await user.click(screen.getByRole('button', { name: /Clear lens/i }));
    expect(screen.queryByText(/Rebalance lens:/i)).toBeNull();
    expect((screen.getByLabelText(/Sort staff/i) as HTMLSelectElement).value).toBe('name');

    // Test global Pin all / Unpin all + staff-scoped Pin all
    await user.click(screen.getByRole('button', { name: /^Pin all$/i }));
    expect(screen.getByRole('button', { name: /^Unpin all$/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Unpin all$/i }));
    expect(screen.getByRole('button', { name: /^Pin all$/i })).toBeTruthy();

    // Select Alice Nguyen in Team panel -> bulk pin scopes only to Alice's shifts
    const teamPanel = screen.getByRole('complementary', { name: /Team panel/i });
    await user.click(within(teamPanel).getByRole('button', { name: /^Alice Nguyen$/i }));
    const scopedPinBtn = screen.getByRole('button', { name: /^Pin all \(\d+\)$/i });
    await user.click(scopedPinBtn);
    expect(screen.getByRole('button', { name: /^Unpin \(\d+\)$/i })).toBeTruthy();

    // P1 Coverage View toggle: switch to Coverage View and back to Metrics View (AC-05)
    await user.click(screen.getByRole('tab', { name: /Hourly Summary/i }));
    const coverageBtn = screen.getByRole('button', { name: /^Coverage View$/i });
    const metricsBtn = screen.getByRole('button', { name: /^Metrics View$/i });
    expect(metricsBtn.getAttribute('aria-pressed')).toBe('true');

    await user.click(coverageBtn);
    expect(coverageBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/1\. Scheduled \/ Required staff/i)).toBeTruthy();
    expect(screen.getByText(/Shortage \(<0/i)).toBeTruthy();
    expect(screen.getByText(/Exact \(0\)/i)).toBeTruthy();

    await user.click(metricsBtn);
    expect(metricsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/1\. Transactions/i)).toBeTruthy();
  });
});

describe('Phase 2: Inactive Roster Cells, Day-Off Guidance/Badge & UNAVAILABLE_DAY Pin Conflict', () => {
  it('renders disabled/hatched cells hiding + Add on inactive shift days, soft-override Day off badge, and blocks UNAVAILABLE_DAY Pin Conflict (AC-P2-004, AC-P2-009, AC-P2-011)', async () => {
    const user = userEvent.setup();
    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    // 1. Restrict 07:00 – 15:00 to Mon–Fri -> Sat & Sun cells render disabled/hatched & hide + Add (AC-P2-004)
    await user.click(screen.getByRole('button', { name: /^Shifts$/i }));
    const shiftsDialog = screen.getByRole('dialog');
    await user.click(within(shiftsDialog).getByRole('button', { name: /Edit shift 07:00 – 15:00/i }));
    const editDaysGroup = within(shiftsDialog).getByRole('group', {
      name: /Active days for shift 07:00 – 15:00/i,
    });
    await user.click(within(editDaysGroup).getByRole('button', { name: 'Sat' }));
    await user.click(within(editDaysGroup).getByRole('button', { name: 'Sun' }));
    await user.click(within(shiftsDialog).getByRole('button', { name: /^Save$/i }));
    await user.click(within(shiftsDialog).getByRole('button', { name: /^Done$/i }));

    const table = screen.getByRole('table');
    const inactiveCells = table.querySelectorAll('td[data-inactive-cell="true"]');
    expect(inactiveCells.length).toBe(2);
    expect(screen.queryByRole('button', { name: /Add staff to Sat 07:00 – 15:00/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add staff to Sun 07:00 – 15:00/i })).toBeNull();

    // 2. Mark Alice Nguyen unavailable on Wed -> guidance warns STAFF_UNAVAILABLE_ON_DAY & allows manual override (AC-P2-009)
    await user.click(screen.getByRole('button', { name: /Edit Alice Nguyen/i }));
    const staffDialog = screen.getByRole('dialog');
    const unavailGroup = within(staffDialog).getByRole('group', { name: /Unavailable days/i });
    await user.click(within(unavailGroup).getByRole('button', { name: 'Wed' }));
    await user.click(within(staffDialog).getByRole('button', { name: /Save Changes/i }));

    await user.click(screen.getByRole('button', { name: /Add staff to Wed 07:00 – 15:00/i }));
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText(/Requires attention/i)).toBeTruthy();
    expect(within(popover).getByText(/Marked unavailable on Wed/i)).toBeTruthy();
    await user.click(within(popover).getByRole('button', { name: /Alice Nguyen/i }));
    await user.click(within(popover).getByRole('button', { name: /^Confirm$/i }));

    // AssignmentChip shows Day off badge; Hour Limit Warnings remains 0
    expect(screen.getByLabelText(/Staff unavailable on this day/i)).toBeTruthy();
    const healthSection = screen.getByRole('region', { name: /Schedule health/i });
    expect(
      within(healthSection).getByTitle(/All team members are within their weekly hour limits/i),
    ).toBeTruthy();

    // 3. Pin Alice's Wed shift & click Auto-schedule -> blocked by UNAVAILABLE_DAY Pin Conflict (AC-P2-011)
    await user.click(screen.getByRole('button', { name: /^Pin Alice Nguyen$/i }));
    await user.click(screen.getByRole('button', { name: /Auto-schedule/i }));
    expect(screen.getByText(/Auto-schedule blocked — resolve conflicting pinned shifts/i)).toBeTruthy();
    expect(screen.getByText(/marked as unavailable/i)).toBeTruthy();
  });

  it('only marks assignments as New when (day, shiftId, staffId) did not exist before Auto-schedule', async () => {
    const user = userEvent.setup();
    render(
      <App
        bootstrapState={makeNormalBootstrap()}
        storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
      />,
    );

    // Load Demo Store (starts with empty assignments)
    await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

    // 1st Auto-schedule on empty roster -> every created assignment shows "New"
    await user.click(screen.getByRole('button', { name: /^Auto-schedule$/i }));
    const initialNewBadges = screen.getAllByText(/^New$/);
    expect(initialNewBadges.length).toBeGreaterThan(0);

    // 2nd Auto-schedule with identical inputs -> same (day, shift, staff) positions -> 0 "New" badges
    await user.click(screen.getByRole('button', { name: /^Auto-schedule$/i }));
    expect(screen.queryAllByText(/^New$/).length).toBe(0);

    // Remove 1 assignment and re-run Auto-schedule -> only the re-added slot gets "New"
    const removeButtons = screen.getAllByRole('button', { name: /^Remove /i });
    await user.click(removeButtons[0]!);
    await user.click(screen.getByRole('button', { name: /^Auto-schedule$/i }));
    const diffNewBadges = screen.getAllByText(/^New$/);
    expect(diffNewBadges.length).toBe(1);
  });

  it('shows Simulator replay buttons after Auto-schedule and posts the captured pre-run snapshot', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      postMessage,
      focus: vi.fn(),
    } as unknown as Window);

    try {
      render(
        <App
          bootstrapState={makeNormalBootstrap()}
          storeOptions={{ deps: createTestDeps(), getStorage: createMemoryStorage }}
        />,
      );

      // Load Demo Store (starts with 0 assignments)
      await user.click(screen.getAllByRole('button', { name: /Load Demo Store/i })[0]!);

      // Before running Auto-schedule, Replay sim button is not rendered
      expect(screen.queryByRole('button', { name: /Replay sim/i })).toBeNull();

      // Run Auto-schedule
      await user.click(screen.getByRole('button', { name: /^Auto-schedule$/i }));

      // Both banner CTA ("Watch step-by-step") and TopActionBar CTA ("Replay sim") appear
      const watchBtn = screen.getByRole('button', { name: /Watch step-by-step/i });
      const replayBtn = screen.getByRole('button', { name: /Replay sim/i });
      expect(watchBtn).toBeTruthy();
      expect(replayBtn).toBeTruthy();

      // Click "Watch step-by-step" -> opens Simulator and sends the pre-run snapshot (0 assignments)
      await user.click(watchBtn);
      expect(openSpy).toHaveBeenCalledWith('http://localhost:5174', 'staff-scheduler-sim');
      expect(postMessage).toHaveBeenCalledTimes(1);

      const [message, targetOrigin] = postMessage.mock.calls[0] as [
        { type: string; payload: { protocolVersion: number; resultStatus: string; schedule: { assignments: unknown[] } } },
        string,
      ];
      expect(targetOrigin).toBe('http://localhost:5174');
      expect(message.type).toBe('SIMULATOR_LOAD_SCHEDULE');
      expect(message.payload.protocolVersion).toBe(1);
      expect(message.payload.resultStatus).toBe('SUCCESS');
      expect(message.payload.schedule.assignments).toHaveLength(0);

      // Acknowledge so timer cleans up cleanly
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:5174',
          data: { type: 'SIMULATOR_LOAD_ACK', protocolVersion: 1 },
        }),
      );
    } finally {
      openSpy.mockRestore();
    }
  });
});
