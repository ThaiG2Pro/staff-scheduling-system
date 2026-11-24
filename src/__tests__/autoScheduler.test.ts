import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAutoSchedule } from '../domain/autoScheduler';
import { DAYS_OF_WEEK, OPERATING_HOURS } from '../domain/constants';
import { parseCsvTransactions } from '../domain/csvParser';
import { computeStaffHoursGrid, computeUnionAssignedHours } from '../domain/hardRules';
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
});
