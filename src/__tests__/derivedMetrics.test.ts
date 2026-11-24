import { describe, expect, it } from 'vitest';
import { DAYS_OF_WEEK, OPERATING_HOURS } from '../domain/constants';
import {
  evaluateStaffGuidance,
  previewDeleteShift,
  previewDeleteStaff,
  validateCandidateAssignments,
} from '../domain/constraints';
import {
  classifyDemandCoverageStatus,
  classifyFairnessStatus,
  deriveScheduleViewModel,
} from '../domain/derivedMetrics';
import type { OperatingHour, Schedule, TransactionGrid } from '../domain/types';

function createZeroGrid(): TransactionGrid {
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

describe('derivedMetrics & constraints (T-06, T-07, T-08, AC-01, AC-03)', () => {
  it('T-06: matches Section 2.6 arithmetic example & distinguishes Staffing Gaps from zero-demand cells (AC-03)', () => {
    const grid = createZeroGrid();
    // 3 hours on Monday: (33, 3), (48, 3), (33, 2)
    grid[0][7] = 33;
    grid[0][8] = 48;
    grid[0][9] = 33;
    // Add 1 staffing gap cell (txns > 0, staffHours === 0)
    grid[0][10] = 0; // NOT a staffing gap
    grid[0][11] = 10; // IS a staffing gap (will test separately below)

    const baseSchedule: Schedule = {
      id: 'sched-1',
      name: 'Test Week',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      targetTxnsPerStaffHour: 15,
      staff: [
        { id: 's1', name: 'Alice', maxWeeklyHours: 40 },
        { id: 's2', name: 'Bob', maxWeeklyHours: 40 },
        { id: 's3', name: 'Carol', maxWeeklyHours: 40 },
      ],
      shifts: [
        { id: 'sh-3h', startHour: 7, endHour: 10 }, // 7, 8, 9
        { id: 'sh-2h', startHour: 7, endHour: 9 }, // 7, 8
      ],
      demand: {
        importedAt: '2026-08-07T00:00:00.000Z',
        transactions: (() => {
          const g = createZeroGrid();
          g[0][7] = 33;
          g[0][8] = 48;
          g[0][9] = 33;
          return g;
        })(),
      },
      assignments: [
        // 3 staff on 7,8; 2 staff on 9 -> staffHours: h7=3, h8=3, h9=2
        { id: 'a1', day: 0, shiftId: 'sh-3h', staffId: 's1', isPinned: false },
        { id: 'a2', day: 0, shiftId: 'sh-3h', staffId: 's2', isPinned: false },
        { id: 'a3', day: 0, shiftId: 'sh-2h', staffId: 's3', isPinned: false },
      ],
    };

    const res = deriveScheduleViewModel(baseSchedule);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { summary, health } = res.viewModel;
    expect(summary.cells[0][7].txnsPerStaffHour).toBeCloseTo(11.0, 10);
    expect(summary.cells[0][8].txnsPerStaffHour).toBeCloseTo(16.0, 10);
    expect(summary.cells[0][9].txnsPerStaffHour).toBeCloseTo(16.5, 10);
    expect(summary.cells[0][10].txnsPerStaffHour).toBeNull();
    expect(summary.cells[0][10].isStaffingGap).toBe(false);

    expect(summary.totalTransactions).toBe(114);
    expect(summary.totalStaffHours).toBe(8);
    expect(summary.overallTxnsPerStaffHour).toBeCloseTo(14.25, 10);
    expect(summary.averageTxnsPerStaffHour).toBeCloseTo(14.5, 10);
    expect(health.staffingGapCount).toBe(0);

    // With a gap cell at Mon 11:00 (txns=10, staffHours=0)
    const withGap: Schedule = {
      ...baseSchedule,
      demand: {
        importedAt: '2026-08-07T00:00:00.000Z',
        transactions: grid,
      },
    };
    const gapRes = deriveScheduleViewModel(withGap);
    expect(gapRes.ok).toBe(true);
    if (!gapRes.ok) return;
    expect(gapRes.viewModel.summary.cells[0][11].isStaffingGap).toBe(true);
    expect(gapRes.viewModel.summary.cells[0][11].txnsPerStaffHour).toBeNull();
    expect(gapRes.viewModel.health.staffingGapCount).toBe(1);
    expect(gapRes.viewModel.health.staffingGapStatus).toBe('warning');
  });

  it('T-07: computes union-of-hours on overlapping manual shifts and separates overlap warnings from Hour Limit Warnings (AC-01, AC-03)', () => {
    const schedule: Schedule = {
      id: 'sched-overlap',
      name: 'Overlap Test',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      targetTxnsPerStaffHour: 15,
      staff: [{ id: 'alice', name: 'Alice', maxWeeklyHours: 20 }],
      shifts: [
        { id: 'sh1', startHour: 7, endHour: 15 }, // 8h
        { id: 'sh2', startHour: 14, endHour: 22 }, // 8h, overlaps at 14:00
      ],
      demand: null,
      assignments: [
        { id: 'a1', day: 0, shiftId: 'sh1', staffId: 'alice', isPinned: false },
        { id: 'a2', day: 0, shiftId: 'sh2', staffId: 'alice', isPinned: false },
      ],
    };

    const res = deriveScheduleViewModel(schedule);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const aliceMetrics = res.viewModel.staffMetrics['alice'];
    expect(aliceMetrics?.assignedHours).toBe(15); // Union of [7,15) U [14,22) = 15h, NOT 16h
    expect(aliceMetrics?.isOverMaxHours).toBe(false); // 15 <= 20
    expect(aliceMetrics?.overlappingAssignmentIds.sort()).toEqual(['a1', 'a2']);
    expect(aliceMetrics?.multiShiftDays).toEqual([0]);

    // Cell 14:00 must count Alice only once
    expect(res.viewModel.summary.cells[0][14].staffHours).toBe(1);
    expect(res.viewModel.summary.totalStaffHours).toBe(15);

    // Hour Limit Warnings must remain 0 (separated from overlap/multi-shift warnings)
    expect(res.viewModel.health.hourLimitWarningCount).toBe(0);
    expect(res.viewModel.assignmentWarnings['a1']?.isOverlapping).toBe(true);
    expect(res.viewModel.assignmentWarnings['a1']?.isOverMaxHours).toBe(false);

    // Verify previewDeleteStaff & previewDeleteShift (AC-01, E-08)
    expect(previewDeleteStaff('alice', schedule.assignments).affectedAssignmentsCount).toBe(2);
    expect(previewDeleteShift('sh1', schedule.assignments).affectedAssignmentsCount).toBe(1);

    // Verify StaffGuidancePopover evaluation (E-07)
    const guidance = evaluateStaffGuidance(
      0,
      { id: 'sh2', startHour: 14, endHour: 22 },
      schedule.staff,
      schedule.shifts,
      [schedule.assignments[0]!],
    );
    expect(guidance.eligible).toHaveLength(0);
    expect(guidance.requiresAttention).toHaveLength(1);
    const reasonCodes = guidance.requiresAttention[0]?.reasons.map((r) => r.code);
    expect(reasonCodes).toContain('ALREADY_HAS_SHIFT_ON_DAY');
    expect(reasonCodes).toContain('WOULD_OVERLAP_SHIFT');
    expect(reasonCodes).not.toContain('WOULD_EXCEED_MAX_HOURS');
  });

  it('T-08: enforces demandCoverage <= 100%, Jain Index edge cases & unrounded Health Bar thresholds (AC-03)', () => {
    const grid = createZeroGrid();
    // Hour 7 requires 3 staff (txns=45, N=15), Hour 8 requires 1 staff (txns=15, N=15)
    grid[0][7] = 45; // req = 3
    grid[0][8] = 15; // req = 1

    // 1. All staff have 0 assigned hours -> Jain Index = null; 0-hour staff excluded
    const emptyAssignSchedule: Schedule = {
      id: 'sched-health',
      name: 'Health Test',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      targetTxnsPerStaffHour: 15,
      staff: [
        { id: 's1', name: 'Alice', maxWeeklyHours: 20 },
        { id: 's0', name: 'Inactive', maxWeeklyHours: 0 },
      ],
      shifts: [{ id: 'sh8', startHour: 8, endHour: 9 }],
      demand: { importedAt: '2026-08-07T00:00:00.000Z', transactions: grid },
      assignments: [],
    };

    const res0 = deriveScheduleViewModel(emptyAssignSchedule);
    expect(res0.ok).toBe(true);
    if (!res0.ok) return;
    expect(res0.viewModel.health.fairnessJainIndex).toBeNull();
    expect(res0.viewModel.health.fairnessStatus).toBe('neutral');
    expect(res0.viewModel.health.eligibleStaffCount).toBe(1);
    expect(res0.viewModel.health.isSingleEligibleStaff).toBe(true);

    // 2. Overstaffing hour 8 with 2 staff does NOT compensate shortage at hour 7 (req=3, cur=0)
    const overstaffedSchedule: Schedule = {
      ...emptyAssignSchedule,
      staff: [
        { id: 's1', name: 'Alice', maxWeeklyHours: 20 },
        { id: 's2', name: 'Bob', maxWeeklyHours: 20 },
      ],
      assignments: [
        { id: 'a1', day: 0, shiftId: 'sh8', staffId: 's1', isPinned: false },
        { id: 'a2', day: 0, shiftId: 'sh8', staffId: 's2', isPinned: false },
      ],
    };
    const resOver = deriveScheduleViewModel(overstaffedSchedule);
    expect(resOver.ok).toBe(true);
    if (!resOver.ok) return;
    // Total req = 4, covered = min(0,3) + min(2,1) = 1 -> ratio = 0.25 (<= 1.0)
    expect(resOver.viewModel.health.demandCoverage?.ratio).toBe(0.25);
    expect(resOver.viewModel.health.demandCoverage?.shortageHours).toBe(3);
    expect(resOver.viewModel.health.demandCoverage?.overstaffedHours).toBe(1);

    // 3. Single eligible staff with hours > 0 -> Jain = 1.0 + isSingleEligibleStaff = true
    const singleStaffRes = deriveScheduleViewModel({
      ...emptyAssignSchedule,
      assignments: [{ id: 'a1', day: 0, shiftId: 'sh8', staffId: 's1', isPinned: false }],
    });
    expect(singleStaffRes.ok).toBe(true);
    if (!singleStaffRes.ok) return;
    expect(singleStaffRes.viewModel.health.fairnessJainIndex).toBe(1);
    expect(singleStaffRes.viewModel.health.isSingleEligibleStaff).toBe(true);

    // 4. Unrounded threshold boundaries (0.8999 -> attention, NOT good; 0.7499 -> warning, NOT attention)
    expect(classifyDemandCoverageStatus(0.9)).toBe('good');
    expect(classifyDemandCoverageStatus(0.89999)).toBe('attention');
    expect(classifyDemandCoverageStatus(0.75)).toBe('attention');
    expect(classifyDemandCoverageStatus(0.74999)).toBe('warning');
    expect(classifyDemandCoverageStatus(null)).toBe('neutral');

    expect(classifyFairnessStatus(0.9)).toBe('good');
    expect(classifyFairnessStatus(0.89999)).toBe('attention');
    expect(classifyFairnessStatus(0.8)).toBe('attention');
    expect(classifyFairnessStatus(0.79999)).toBe('warning');
    expect(classifyFairnessStatus(null)).toBe('neutral');

    // 5. Guidance WOULD_EXCEED_MAX_HOURS & Reassign excludeAssignmentId
    const reassignGuidance = evaluateStaffGuidance(
      0,
      { id: 'sh8', startHour: 8, endHour: 9 },
      [
        { id: 's1', name: 'Alice', maxWeeklyHours: 1 },
        { id: 's2', name: 'Bob', maxWeeklyHours: 0 },
      ],
      [{ id: 'sh8', startHour: 8, endHour: 9 }],
      [{ id: 'a1', day: 0, shiftId: 'sh8', staffId: 's1', isPinned: true }],
      'a1',
    );
    expect(reassignGuidance.eligible.map((o) => o.staff.id)).toEqual(['s1']);
    expect(reassignGuidance.requiresAttention[0]?.reasons[0]?.code).toBe('WOULD_EXCEED_MAX_HOURS');

    // 6. validateCandidateAssignments independent invariant checks
    const baseInput = {
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 8 }],
      shifts: [{ id: 'sh1', startHour: 7, endHour: 15 }],
      existingAssignments: [
        { id: 'pin-1', day: 0 as const, shiftId: 'sh1', staffId: 's1', isPinned: true },
      ],
    };
    expect(
      validateCandidateAssignments(
        [{ id: '', day: 0, shiftId: 'sh1', staffId: 's1', isPinned: true }],
        baseInput,
      ).ok,
    ).toBe(false);
    expect(
      validateCandidateAssignments(
        [{ id: 'pin-1', day: 0, shiftId: 'sh1', staffId: 'unknown', isPinned: true }],
        baseInput,
      ).ok,
    ).toBe(false);
    expect(
      validateCandidateAssignments(
        [{ id: 'pin-1', day: 0, shiftId: 'unknown', staffId: 's1', isPinned: true }],
        baseInput,
      ).ok,
    ).toBe(false);
    expect(
      validateCandidateAssignments(
        [{ id: 'pin-1', day: 1, shiftId: 'sh1', staffId: 's1', isPinned: true }],
        baseInput,
      ).ok,
    ).toBe(false);
    expect(
      validateCandidateAssignments(
        [
          { id: 'pin-1', day: 0, shiftId: 'sh1', staffId: 's1', isPinned: true },
          { id: 'new-1', day: 1, shiftId: 'sh1', staffId: 's1', isPinned: true },
        ],
        baseInput,
      ).ok,
    ).toBe(false);
    expect(
      validateCandidateAssignments(
        [
          { id: 'pin-1', day: 0, shiftId: 'sh1', staffId: 's1', isPinned: true },
          { id: 'new-1', day: 1, shiftId: 'sh1', staffId: 's1', isPinned: false },
        ],
        baseInput,
      ).ok,
    ).toBe(false);
  });
});
