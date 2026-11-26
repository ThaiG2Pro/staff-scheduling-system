import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAutoSchedule } from '../domain/autoScheduler';
import { DAYS_OF_WEEK, OPERATING_HOURS } from '../domain/constants';
import { parseCsvTransactions } from '../domain/csvParser';
import { computeStaffHoursGrid, computeUnionAssignedHours } from '../domain/hardRules';
import type { SchedulerTraceObserver, TraceEvent } from '../domain/schedulerTrace';
import type {
  Assignment,
  AutoScheduleInput,
  DemandDataset,
  OperatingHour,
  ShiftTemplate,
  Staff,
  TransactionGrid,
} from '../domain/types';

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

function makeDemand(grid: TransactionGrid): DemandDataset {
  return {
    importedAt: '2026-08-07T00:00:00.000Z',
    sourceFileName: 'test.csv',
    transactions: grid,
  };
}

function makeSeqIdGen(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

describe('autoScheduler (T-09, T-10, T-11, T-12, T-13, AC-03)', () => {
  it('T-09: satisfies all F-04 hard constraints, never mutates input snapshot, and is deterministic across idGenerators (AC-03)', () => {
    const samplePath = resolve(process.cwd(), 'docs/report_Transaction_20260807_20260813.csv');
    const parsed = parseCsvTransactions(readFileSync(samplePath, 'utf-8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const shifts: ShiftTemplate[] = [
      { id: 'morning', startHour: 7, endHour: 15 },
      { id: 'evening', startHour: 15, endHour: 23 },
    ];
    const staff: Staff[] = Array.from({ length: 12 }, (_, idx) => ({
      id: `staff-${String(idx + 1).padStart(2, '0')}`,
      name: `Staff ${idx + 1}`,
      maxWeeklyHours: idx < 6 ? 40 : 24,
    }));

    const input1: AutoScheduleInput = {
      demand: makeDemand(parsed.transactions),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('runA'),
    };

    const snapshotBefore = JSON.stringify({
      demand: input1.demand,
      staff: input1.staff,
      shifts: input1.shifts,
      existingAssignments: input1.existingAssignments,
    });

    const res1 = runAutoSchedule(input1);
    const snapshotAfter = JSON.stringify({
      demand: input1.demand,
      staff: input1.staff,
      shifts: input1.shifts,
      existingAssignments: input1.existingAssignments,
    });

    // Immutability check
    expect(snapshotAfter).toBe(snapshotBefore);
    expect(res1.status).toBe('SUCCESS');
    if (res1.status !== 'SUCCESS') return;

    // Hard constraints F-04 check
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    for (const s of staff) {
      const hours = computeUnionAssignedHours(s.id, res1.assignments, shiftMap);
      expect(hours).toBeLessThanOrEqual(s.maxWeeklyHours);

      const seenDays = new Set<number>();
      for (const a of res1.assignments.filter((x) => x.staffId === s.id)) {
        expect(seenDays.has(a.day)).toBe(false);
        seenDays.add(a.day);
      }
    }

    // Determinism across 2 completely different idGenerators
    const res2 = runAutoSchedule({
      ...input1,
      idGenerator: makeSeqIdGen('runB'),
    });
    expect(res2.status).toBe('SUCCESS');
    if (res2.status !== 'SUCCESS') return;

    const stripIds = (list: Assignment[]) =>
      list
        .map((a) => `${a.day}|${a.shiftId}|${a.staffId}|${a.isPinned}`)
        .sort();
    expect(stripIds(res2.assignments)).toEqual(stripIds(res1.assignments));
    expect(res2.diagnostics).toEqual(res1.diagnostics);
  });

  it('T-10: solves Best-Fit counterexample (S1/S2) to 100% coverage and prefers overlapping peak shift by efficiency (AC-03)', () => {
    const grid = createZeroGrid();
    // Monday: 07-11 needs 2 staff (txns=30), 12-15 needs 3 staff (txns=45), 15:00 needs 1 staff (txns=15)
    for (let h = 7; h <= 11; h++) grid[0][h as OperatingHour] = 30; // req 2
    for (let h = 12; h <= 14; h++) grid[0][h as OperatingHour] = 45; // req 3
    grid[0][15] = 15; // req 1 (covered only by S2: 12-16)

    const shifts: ShiftTemplate[] = [
      { id: 'S1', startHour: 7, endHour: 15 }, // 8h
      { id: 'S2', startHour: 12, endHour: 16 }, // 4h overlapping peak shift
    ];
    const staff: Staff[] = [
      { id: 'P', name: 'Pinned Lead', maxWeeklyHours: 80 },
      { id: 'A', name: 'Staff A (8h)', maxWeeklyHours: 8 },
      { id: 'B', name: 'Staff B (4h)', maxWeeklyHours: 4 },
    ];
    const existingAssignments: Assignment[] = [
      { id: 'pin-1', day: 0, shiftId: 'S1', staffId: 'P', isPinned: true },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments,
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('bf'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    // B (4h) must take S2 (4h) and A (8h) must take S1 (8h) -> 100% demand coverage!
    expect(res.diagnostics.demandCoverage).toBe(1);
    expect(res.diagnostics.shortageHours).toBe(0);

    const aAssign = res.assignments.find((a) => a.staffId === 'A');
    const bAssign = res.assignments.find((a) => a.staffId === 'B');
    expect(aAssign?.shiftId).toBe('S1');
    expect(bAssign?.shiftId).toBe('S2');
  });

  it('T-11: preserves pinned assignments verbatim and blocks on Pin Conflicts (E-03, F-07, AC-03)', () => {
    const grid = createZeroGrid();
    grid[0][7] = 15;

    const shifts: ShiftTemplate[] = [
      { id: 'S1', startHour: 7, endHour: 15 },
      { id: 'S2', startHour: 15, endHour: 23 },
    ];

    // 1. Valid pin is preserved verbatim
    const validPin: Assignment = {
      id: 'my-pinned-id-999',
      day: 0,
      shiftId: 'S1',
      staffId: 's1',
      isPinned: true,
    };
    const okRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 16 }],
      shifts,
      existingAssignments: [validPin],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('pin'),
    });
    expect(okRes.status).toBe('SUCCESS');
    if (okRes.status === 'SUCCESS') {
      expect(okRes.assignments).toContainEqual(validPin);
      expect(okRes.diagnostics.preservedPinnedCount).toBe(1);
    }

    // 2. Pin exceeds maxWeeklyHours -> BLOCKED_PIN_CONFLICT
    const overMaxRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 4 }],
      shifts,
      existingAssignments: [validPin],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('pin'),
    });
    expect(overMaxRes.status).toBe('BLOCKED_PIN_CONFLICT');
    if (overMaxRes.status === 'BLOCKED_PIN_CONFLICT') {
      expect(overMaxRes.conflicts.some((c) => c.type === 'OVER_MAX_HOURS')).toBe(true);
    }

    // 3. Two overlapping pins on same day -> BLOCKED_PIN_CONFLICT (both MULTIPLE_SHIFTS_SAME_DAY & OVERLAPPING_SHIFTS)
    const twoPinsSameDayRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [
        { id: 'S1', startHour: 7, endHour: 15 },
        { id: 'S2', startHour: 12, endHour: 20 },
      ],
      existingAssignments: [
        validPin,
        { id: 'pin-2', day: 0, shiftId: 'S2', staffId: 's1', isPinned: true },
      ],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('pin'),
    });
    expect(twoPinsSameDayRes.status).toBe('BLOCKED_PIN_CONFLICT');
    if (twoPinsSameDayRes.status === 'BLOCKED_PIN_CONFLICT') {
      expect(twoPinsSameDayRes.conflicts.some((c) => c.type === 'MULTIPLE_SHIFTS_SAME_DAY')).toBe(
        true,
      );
      expect(twoPinsSameDayRes.conflicts.some((c) => c.type === 'OVERLAPPING_SHIFTS')).toBe(true);
    }
  });

  it('T-12: Stage 2 rebalance improves Jain Index while strictly preserving 112-cell coverage and Pins (AC-03)', () => {
    const grid = createZeroGrid();
    // 2 days need 1 morning shift each (8h)
    for (let h = 7; h < 15; h++) {
      grid[0][h as OperatingHour] = 15;
      grid[1][h as OperatingHour] = 15;
    }

    const shifts: ShiftTemplate[] = [{ id: 'morning', startHour: 7, endHour: 15 }];
    // s1 has 16h max, s2 has 16h max. Best-Fit on day 0 picks s1 (slack 8), then on day 1 picks s1 again (slack 0 < 8)!
    // So after Stage 1: s1 has 16h (u=1.0), s2 has 0h (u=0.0) -> Jain = 0.5.
    // Stage 2 REASSIGN moves one 8h shift to s2 -> s1=8h (u=0.5), s2=8h (u=0.5) -> Jain = 1.0!
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', maxWeeklyHours: 16 },
      { id: 's2', name: 'Bob', maxWeeklyHours: 16 },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('reb'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    expect(res.diagnostics.rebalanceIterationsRun).toBeGreaterThanOrEqual(1);
    expect(res.diagnostics.rebalanceStopReason).toBe('CONVERGED');
    expect(res.diagnostics.fairnessJainIndex).toBeCloseTo(1.0, 9);
    expect(res.diagnostics.demandCoverage).toBe(1);

    // Verify 112-cell StaffHours grid matches exact demand
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const gridAfter = computeStaffHoursGrid(res.assignments, shiftMap);
    for (let h = 7; h < 15; h++) {
      expect(gridAfter[0 * 16 + (h - 7)]).toBe(1);
      expect(gridAfter[1 * 16 + (h - 7)]).toBe(1);
    }

    // Also exercise Stage 2 SWAP (different shift durations 8h vs 4h on same day)
    const swapGrid = createZeroGrid();
    for (let h = 7; h < 15; h++) swapGrid[0][h as OperatingHour] = 15; // 8h shift
    for (let h = 15; h < 19; h++) swapGrid[0][h as OperatingHour] = 15; // 4h shift
    const swapShifts: ShiftTemplate[] = [
      { id: 'long', startHour: 7, endHour: 15 }, // 8h
      { id: 'short', startHour: 15, endHour: 19 }, // 4h
    ];
    // s1 (max 16h) & s2 (max 8h): Stage 1 Best-Fit assigns long(8h) to s2 (slack 0) and short(4h) to s1 (slack 12) -> u=(0.25, 1.0)
    // Stage 2 SWAP swaps s1 & s2 -> s1 gets 8h (u=0.5), s2 gets 4h (u=0.5) -> Jain = 1.0!
    const swapRes = runAutoSchedule({
      demand: makeDemand(swapGrid),
      staff: [
        { id: 's1', name: 'Full-timer', maxWeeklyHours: 16 },
        { id: 's2', name: 'Part-timer', maxWeeklyHours: 8 },
      ],
      shifts: swapShifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('swap'),
    });
    expect(swapRes.status).toBe('SUCCESS');
    if (swapRes.status === 'SUCCESS') {
      expect(swapRes.diagnostics.fairnessJainIndex).toBeCloseTo(1.0, 9);
      expect(swapRes.diagnostics.rebalanceIterationsRun).toBeGreaterThanOrEqual(1);
    }
  });

  it('T-13: handles shortage/surplus diagnostics, idGenerator failures/duplicates & SAFE_INTEGER_OVERFLOW (E-04, AC-03)', () => {
    // 1. Shortage split: uncoverableRequiredStaffHours vs residualCoverableShortageHours
    const shortageGrid = createZeroGrid();
    shortageGrid[0][7] = 30; // req 2 (coverable by morning 07-15)
    shortageGrid[0][20] = 30; // req 2 (UNCOVERABLE — no evening shift!)

    const shortageRes = runAutoSchedule({
      demand: makeDemand(shortageGrid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 8 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('short'),
    });
    expect(shortageRes.status).toBe('SUCCESS');
    if (shortageRes.status === 'SUCCESS') {
      expect(shortageRes.diagnostics.uncoverableRequiredStaffHours).toBe(2);
      expect(shortageRes.diagnostics.residualCoverableShortageHours).toBe(1);
      expect(shortageRes.diagnostics.shortageHours).toBe(3);
      expect(shortageRes.diagnostics.summaryMessages.length).toBeGreaterThanOrEqual(2);
    }

    // 2. Surplus capacity stops at 100% coverage & reports unusedCapacityHours
    const surplusGrid = createZeroGrid();
    surplusGrid[0][7] = 15; // req 1
    const surplusRes = runAutoSchedule({
      demand: makeDemand(surplusGrid),
      staff: [
        { id: 's1', name: 'Alice', maxWeeklyHours: 40 },
        { id: 's2', name: 'Bob', maxWeeklyHours: 40 },
      ],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('surplus'),
    });
    expect(surplusRes.status).toBe('SUCCESS');
    if (surplusRes.status === 'SUCCESS') {
      expect(surplusRes.diagnostics.demandCoverage).toBe(1);
      expect(surplusRes.diagnostics.unusedCapacityHours).toBe(72); // 80 - 8
      expect(surplusRes.diagnostics.unscheduledEligibleStaffCount).toBe(1);
    }

    // 3. Missing inputs -> FAILED (MISSING_INPUT)
    const missingRes = runAutoSchedule({
      demand: null,
      staff: [],
      shifts: [],
      existingAssignments: [],
      targetTxnsPerStaffHour: 0,
      idGenerator: makeSeqIdGen('miss'),
    });
    expect(missingRes.status).toBe('FAILED');
    if (missingRes.status === 'FAILED') {
      expect(missingRes.reasonCode).toBe('MISSING_INPUT');
      expect(missingRes.missingInputs).toEqual(['DEMAND', 'SHIFTS', 'ELIGIBLE_STAFF', 'INVALID_N']);
    }

    // 4. idGenerator throws -> FAILED (CANDIDATE_VALIDATION_FAILED)
    const throwRes = runAutoSchedule({
      demand: makeDemand(surplusGrid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: () => {
        throw new Error('UUID generator broken');
      },
    });
    expect(throwRes.status).toBe('FAILED');
    if (throwRes.status === 'FAILED') {
      expect(throwRes.reasonCode).toBe('CANDIDATE_VALIDATION_FAILED');
    }

    // 5. idGenerator returns duplicate IDs -> FAILED (CANDIDATE_VALIDATION_FAILED)
    const dupGrid = createZeroGrid();
    dupGrid[0][7] = 15;
    dupGrid[1][7] = 15;
    const dupIdRes = runAutoSchedule({
      demand: makeDemand(dupGrid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: () => 'constant-id',
    });
    expect(dupIdRes.status).toBe('FAILED');
    if (dupIdRes.status === 'FAILED') {
      expect(dupIdRes.reasonCode).toBe('CANDIDATE_VALIDATION_FAILED');
    }

    // 6. SAFE_INTEGER_OVERFLOW in unusedCapacityHours -> FAILED (UNEXPECTED_ERROR)
    const overflowRes = runAutoSchedule({
      demand: makeDemand(surplusGrid),
      staff: [
        { id: 's1', name: 'Huge 1', maxWeeklyHours: Number.MAX_SAFE_INTEGER },
        { id: 's2', name: 'Huge 2', maxWeeklyHours: Number.MAX_SAFE_INTEGER },
      ],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('ovf'),
    });
    expect(overflowRes.status).toBe('FAILED');
    if (overflowRes.status === 'FAILED') {
      expect(overflowRes.reasonCode).toBe('UNEXPECTED_ERROR');
      expect(overflowRes.message).toContain('SAFE_INTEGER_OVERFLOW');
    }

    // 7. Zero-demand week -> SUCCESS with demandCoverage = null & zero-demand summary message
    const zeroRes = runAutoSchedule({
      demand: makeDemand(createZeroGrid()),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('zero'),
    });
    expect(zeroRes.status).toBe('SUCCESS');
    if (zeroRes.status === 'SUCCESS') {
      expect(zeroRes.diagnostics.demandCoverage).toBeNull();
      expect(zeroRes.diagnostics.rebalanceStopReason).toBe('SKIPPED');
      expect(zeroRes.diagnostics.summaryMessages[0]).toMatch(/0/);
    }

    // 8. Empty ID returned by idGenerator -> FAILED (CANDIDATE_VALIDATION_FAILED)
    const emptyIdRes = runAutoSchedule({
      demand: makeDemand(surplusGrid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: () => '   ',
    });
    expect(emptyIdRes.status).toBe('FAILED');
    if (emptyIdRes.status === 'FAILED') {
      expect(emptyIdRes.reasonCode).toBe('CANDIDATE_VALIDATION_FAILED');
    }

    // 9. RequiredStaff SAFE_INTEGER_OVERFLOW inside runAutoSchedule -> FAILED (UNEXPECTED_ERROR)
    const hugeTxnsGrid = createZeroGrid();
    hugeTxnsGrid[0][7] = Number.MAX_SAFE_INTEGER;
    const reqOverflowRes = runAutoSchedule({
      demand: makeDemand(hugeTxnsGrid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [{ id: 'morning', startHour: 7, endHour: 15 }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 0.5,
      idGenerator: makeSeqIdGen('reqovf'),
    });
    expect(reqOverflowRes.status).toBe('FAILED');
    if (reqOverflowRes.status === 'FAILED') {
      expect(reqOverflowRes.reasonCode).toBe('UNEXPECTED_ERROR');
      expect(reqOverflowRes.message).toContain('SAFE_INTEGER_OVERFLOW');
    }

    // 10. Cross-day Stage 2 SWAP (day 0 8h vs day 1 4h)
    const crossDayGrid = createZeroGrid();
    for (let h = 7; h < 15; h++) crossDayGrid[0][h as OperatingHour] = 15;
    for (let h = 15; h < 19; h++) crossDayGrid[1][h as OperatingHour] = 15;
    const crossDayRes = runAutoSchedule({
      demand: makeDemand(crossDayGrid),
      staff: [
        { id: 's1', name: 'Full-timer', maxWeeklyHours: 16 },
        { id: 's2', name: 'Part-timer', maxWeeklyHours: 8 },
      ],
      shifts: [
        { id: 'long', startHour: 7, endHour: 15 },
        { id: 'short', startHour: 15, endHour: 19 },
      ],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('xswap'),
    });
    expect(crossDayRes.status).toBe('SUCCESS');
    if (crossDayRes.status === 'SUCCESS') {
      expect(crossDayRes.diagnostics.fairnessJainIndex).toBeCloseTo(1.0, 9);
    }
  });

  it('QA-E4: blocks 2 non-overlapping pins on same day with MULTIPLE_SHIFTS_SAME_DAY only (not OVERLAPPING_SHIFTS)', () => {
    const grid = createZeroGrid();
    grid[0][7] = 15;

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 40 }],
      shifts: [
        { id: 'morning', startHour: 7, endHour: 15 },
        { id: 'evening', startHour: 15, endHour: 23 },
      ],
      existingAssignments: [
        { id: 'pin-m', day: 0, shiftId: 'morning', staffId: 's1', isPinned: true },
        { id: 'pin-e', day: 0, shiftId: 'evening', staffId: 's1', isPinned: true },
      ],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('pin-nonovl'),
    });

    expect(res.status).toBe('BLOCKED_PIN_CONFLICT');
    if (res.status === 'BLOCKED_PIN_CONFLICT') {
      expect(res.conflicts.some((c) => c.type === 'MULTIPLE_SHIFTS_SAME_DAY')).toBe(true);
      expect(res.conflicts.some((c) => c.type === 'OVERLAPPING_SHIFTS')).toBe(false);
    }
  });

  it('QA-E5: keeps pinned assignments strictly immutable during Stage 2 rebalance even when unpinning would improve Jain Index', () => {
    const grid = createZeroGrid();
    // 3 days need 1 morning shift (8h) each
    for (let d = 0; d < 3; d++) {
      for (let h = 7; h < 15; h++) {
        grid[d as 0 | 1 | 2][h as OperatingHour] = 15;
      }
    }

    const shifts: ShiftTemplate[] = [{ id: 'morning', startHour: 7, endHour: 15 }];
    // Alice has 2 pinned shifts (16h / 24h); Bob has 0 pinned shifts (0h / 24h).
    // Day 2 unpinned shift must go to Bob (or rebalance to Bob) so Alice=16h, Bob=8h;
    // Stage 2 must NEVER move either of Alice's pinned shifts!
    const pinned1: Assignment = {
      id: 'pin-d0',
      day: 0,
      shiftId: 'morning',
      staffId: 'alice',
      isPinned: true,
    };
    const pinned2: Assignment = {
      id: 'pin-d1',
      day: 1,
      shiftId: 'morning',
      staffId: 'alice',
      isPinned: true,
    };

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [
        { id: 'alice', name: 'Alice', maxWeeklyHours: 24 },
        { id: 'bob', name: 'Bob', maxWeeklyHours: 24 },
      ],
      shifts,
      existingAssignments: [pinned1, pinned2],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('pin-reb'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    expect(res.assignments).toContainEqual(pinned1);
    expect(res.assignments).toContainEqual(pinned2);
    expect(res.diagnostics.preservedPinnedCount).toBe(2);
    expect(res.diagnostics.demandCoverage).toBe(1);
    // Day 2 shift should end up on Bob for better fairness (16h vs 8h instead of 24h vs 0h)
    const day2Assign = res.assignments.find((a) => a.day === 2);
    expect(day2Assign?.staffId).toBe('bob');
    expect(day2Assign?.isPinned).toBe(false);
  });
});

describe('Phase 2: Shift Active Days & Staff Unavailability in Auto-Scheduler', () => {
  it('skips inactive shift days in Stage 1A, 1B, and trace candidates via shiftDayMask (AC-P2-006)', () => {
    const grid = createZeroGrid();
    // Demand on Mon (0) and Sat (5) at 07:00-15:00
    for (let h = 7; h < 15; h++) {
      grid[0][h as OperatingHour] = 30; // req 2 on Mon
      grid[5][h as OperatingHour] = 30; // req 2 on Sat
    }

    const shifts: ShiftTemplate[] = [
      { id: 'weekend-morning', startHour: 7, endHour: 15, daysOfWeek: [5, 6] },
    ];
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', maxWeeklyHours: 40 },
      { id: 's2', name: 'Bob', maxWeeklyHours: 40 },
    ];

    const traceEvents: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = { emit: (e) => traceEvents.push(e) };
    const res = runAutoSchedule(
      {
        demand: makeDemand(grid),
        staff,
        shifts,
        existingAssignments: [],
        targetTxnsPerStaffHour: 15,
        idGenerator: makeSeqIdGen('p2-mask'),
      },
      { observer },
    );

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    // Zero assignments on Mon (0) or any weekday 0..4; 2 assignments on Sat (5)
    expect(res.assignments.every((a) => a.day === 5 || a.day === 6)).toBe(true);
    expect(res.assignments.filter((a) => a.day === 5)).toHaveLength(2);
    // Trace candidates must not include Mon for weekend-morning
    const stage1Steps = traceEvents.filter(
      (e) => e.stageId === 'stage_1a_gaps' || e.stageId === 'stage_1b_deficit',
    );
    for (const ev of stage1Steps) {
      for (const cand of ev.candidates ?? []) {
        expect(cand.id).not.toMatch(/^(win|run|rej)-0-weekend-morning/);
      }
    }
  });

  it('computes 2D cellCoverable uncoverable vs residual shortage in schedulerDiagnostics (AC-P2-007)', () => {
    const grid = createZeroGrid();
    // Mon (0) hour 7: req 2 (uncoverable because shift is Sat-Sun only)
    grid[0][7] = 30;
    // Sat (5) hour 7: req 2 (coverable, but only 1 staff with 8h -> 1 covered, 1 residual shortage)
    grid[5][7] = 30;

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [{ id: 's1', name: 'Alice', maxWeeklyHours: 8 }],
      shifts: [{ id: 'wknd', startHour: 7, endHour: 15, daysOfWeek: [5, 6] }],
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-2d'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;
    expect(res.diagnostics.totalRequiredStaffHours).toBe(4);
    expect(res.diagnostics.coveredRequiredStaffHours).toBe(1);
    expect(res.diagnostics.shortageHours).toBe(3);
    expect(res.diagnostics.uncoverableRequiredStaffHours).toBe(2);
    expect(res.diagnostics.residualCoverableShortageHours).toBe(1);
  });

  it('excludes 7-day-unavailable staff from eligibleStaff, Jain Index, and triggers ELIGIBLE_STAFF gate (AC-P2-010)', () => {
    const grid = createZeroGrid();
    grid[0][7] = 15;
    const shifts: ShiftTemplate[] = [{ id: 'm', startHour: 7, endHour: 15 }];

    // Only staff has all 7 days unavailable -> MISSING_INPUT: ELIGIBLE_STAFF
    const blockedRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [
        { id: 'off-all', name: 'On Leave', maxWeeklyHours: 40, unavailableDays: [0, 1, 2, 3, 4, 5, 6] },
      ],
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-elig'),
    });
    expect(blockedRes.status).toBe('FAILED');
    if (blockedRes.status === 'FAILED') {
      expect(blockedRes.reasonCode).toBe('MISSING_INPUT');
      expect(blockedRes.missingInputs).toContain('ELIGIBLE_STAFF');
    }

    // With 1 eligible + 1 7-day-off staff -> only eligible staff is scheduled, Jain = 1.0 (not 0.5)
    const okRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff: [
        { id: 'active', name: 'Alice', maxWeeklyHours: 40 },
        { id: 'off-all', name: 'On Leave', maxWeeklyHours: 40, unavailableDays: [0, 1, 2, 3, 4, 5, 6] },
      ],
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-elig2'),
    });
    expect(okRes.status).toBe('SUCCESS');
    if (okRes.status === 'SUCCESS') {
      expect(okRes.assignments.every((a) => a.staffId === 'active')).toBe(true);
      expect(okRes.diagnostics.fairnessJainIndex).toBeCloseTo(1.0, 9);
      expect(okRes.diagnostics.unscheduledEligibleStaffCount).toBe(0);
    }
  });

  it('blocks Auto-schedule on single UNAVAILABLE_DAY pinned conflict, while clearing unpinned ones (AC-P2-011)', () => {
    const grid = createZeroGrid();
    grid[2][7] = 15; // Wed
    const shifts: ShiftTemplate[] = [{ id: 'm', startHour: 7, endHour: 15 }];
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', maxWeeklyHours: 40, unavailableDays: [2] }, // Off Wed
      { id: 's2', name: 'Bob', maxWeeklyHours: 40 },
    ];

    // 1. Single pinned assignment on Wed -> BLOCKED_PIN_CONFLICT (UNAVAILABLE_DAY)
    const pinRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [
        { id: 'pin-wed', day: 2, shiftId: 'm', staffId: 's1', isPinned: true },
      ],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-pin'),
    });
    expect(pinRes.status).toBe('BLOCKED_PIN_CONFLICT');
    if (pinRes.status === 'BLOCKED_PIN_CONFLICT') {
      expect(pinRes.conflicts).toHaveLength(1);
      expect(pinRes.conflicts[0]?.type).toBe('UNAVAILABLE_DAY');
      expect(pinRes.conflicts[0]?.assignmentIds).toEqual(['pin-wed']);
    }

    // 2. Unpinned assignment on Wed -> cleared & re-scheduled to Bob without blocking
    const unpinnedRes = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [
        { id: 'unpin-wed', day: 2, shiftId: 'm', staffId: 's1', isPinned: false },
      ],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-unpin'),
    });
    expect(unpinnedRes.status).toBe('SUCCESS');
    if (unpinnedRes.status === 'SUCCESS') {
      expect(unpinnedRes.assignments).toHaveLength(1);
      expect(unpinnedRes.assignments[0]?.staffId).toBe('s2');
    }
  });

  it('enforces unavailableMask in Stage 1 pickBestFitStaff (AC-P2-012)', () => {
    const grid = createZeroGrid();
    for (let h = 7; h < 15; h++) {
      grid[0][h as OperatingHour] = 15; // Mon
      grid[1][h as OperatingHour] = 15; // Tue
    }
    const shifts: ShiftTemplate[] = [{ id: 'm', startHour: 7, endHour: 15 }];
    // Alice has 8h (tighter Best-Fit slack on Mon!), but is unavailable on Mon (0)
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', maxWeeklyHours: 8, unavailableDays: [0] },
      { id: 's2', name: 'Bob', maxWeeklyHours: 16, unavailableDays: [1] },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-s1'),
    });
    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    const mon = res.assignments.find((a) => a.day === 0);
    const tue = res.assignments.find((a) => a.day === 1);
    expect(mon?.staffId).toBe('s2');
    expect(tue?.staffId).toBe('s1');
  });

  it('preserves unavailableMask and 112-cell coverage during Stage 2 REASSIGN and cross-day SWAP (AC-P2-013, AC-P2-014)', () => {
    const grid = createZeroGrid();
    // Day 0 (Mon): 8h shift, Day 1 (Tue): 4h shift, Day 2 (Wed): 8h shift
    for (let h = 7; h < 15; h++) {
      grid[0][h as OperatingHour] = 15;
      grid[2][h as OperatingHour] = 15;
    }
    for (let h = 15; h < 19; h++) {
      grid[1][h as OperatingHour] = 15;
    }

    const shifts: ShiftTemplate[] = [
      { id: 'long', startHour: 7, endHour: 15 },
      { id: 'short', startHour: 15, endHour: 19 },
    ];
    // s1 unavailable on Tue(1); s2 unavailable on Mon(0).
    // Stage 2 REASSIGN & cross-day SWAP must NEVER move Mon(0) to s2 or Tue(1) to s1!
    const staff: Staff[] = [
      { id: 's1', name: 'Alice', maxWeeklyHours: 24, unavailableDays: [1] },
      { id: 's2', name: 'Bob', maxWeeklyHours: 16, unavailableDays: [0] },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-s2'),
    });
    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    // Verify zero assignments on unavailable days
    for (const a of res.assignments) {
      const st = staff.find((s) => s.id === a.staffId)!;
      expect(st.unavailableDays ?? []).not.toContain(a.day);
    }

    // Verify 100% coverage preserved
    expect(res.diagnostics.demandCoverage).toBe(1);
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const gridAfter = computeStaffHoursGrid(res.assignments, shiftMap);
    for (let h = 7; h < 15; h++) {
      expect(gridAfter[0 * 16 + (h - 7)]).toBe(1);
      expect(gridAfter[2 * 16 + (h - 7)]).toBe(1);
    }
    for (let h = 15; h < 19; h++) {
      expect(gridAfter[1 * 16 + (h - 7)]).toBe(1);
    }
  });

  it('prioritizes staff with fewer available days (MRV) to preserve flexible staff for scarce weekend days (AC-P2-011)', () => {
    const grid = createZeroGrid();
    // All 7 days need 1 staff for 07:00-15:00 (56h total)
    for (const d of [0, 1, 2, 3, 4, 5, 6] as const) {
      for (let h = 7; h < 15; h++) {
        grid[d][h as OperatingHour] = 15;
      }
    }

    const shifts: ShiftTemplate[] = [{ id: 'day-8h', startHour: 7, endHour: 15 }];
    // s1-flex sorts BEFORE s2-weekdays by id and has identical 40h cap;
    // without MRV, s1-flex would absorb Mon-Fri (40/40h) and leave Sat-Sun uncovered.
    const staff: Staff[] = [
      { id: 's1-flex', name: 'Flex', maxWeeklyHours: 40 },
      { id: 's2-weekdays', name: 'WeekdaysOnly', maxWeeklyHours: 40, unavailableDays: [5, 6] },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-mrv-weekend'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    // 100% coverage across all 7 days (56/56h)
    expect(res.diagnostics.demandCoverage).toBe(1);
    expect(res.assignments).toHaveLength(7);
    // Weekend days must be covered by s1-flex
    const sat = res.assignments.find((a) => a.day === 5);
    const sun = res.assignments.find((a) => a.day === 6);
    expect(sat?.staffId).toBe('s1-flex');
    expect(sun?.staffId).toBe('s1-flex');
    // s2-weekdays must never be scheduled on Sat/Sun
    expect(
      res.assignments.filter((a) => a.staffId === 's2-weekdays').every((a) => a.day < 5),
    ).toBe(true);
  });

  it('prefers staff with fewer available days over lower slack on their rare available day (AC-P2-011)', () => {
    const grid = createZeroGrid();
    // Only Mon (0) and Wed (2) need 1 staff for 07:00-15:00
    for (let h = 7; h < 15; h++) {
      grid[0][h as OperatingHour] = 15;
      grid[2][h as OperatingHour] = 15;
    }

    const shifts: ShiftTemplate[] = [{ id: 'day-8h', startHour: 7, endHour: 15 }];
    // s1-full has lower slack (24-8=16) than s2-rare (40-8=32),
    // but s2-rare is ONLY available on Mon (0).
    const staff: Staff[] = [
      { id: 's1-full', name: 'FullWeek', maxWeeklyHours: 24 },
      { id: 's2-rare', name: 'MonOnly', maxWeeklyHours: 40, unavailableDays: [1, 2, 3, 4, 5, 6] },
    ];

    const res = runAutoSchedule({
      demand: makeDemand(grid),
      staff,
      shifts,
      existingAssignments: [],
      targetTxnsPerStaffHour: 15,
      idGenerator: makeSeqIdGen('p2-mrv-rare'),
    });

    expect(res.status).toBe('SUCCESS');
    if (res.status !== 'SUCCESS') return;

    expect(res.diagnostics.demandCoverage).toBe(1);
    const mon = res.assignments.find((a) => a.day === 0);
    const wed = res.assignments.find((a) => a.day === 2);
    expect(mon?.staffId).toBe('s2-rare');
    expect(wed?.staffId).toBe('s1-full');
  });
});
