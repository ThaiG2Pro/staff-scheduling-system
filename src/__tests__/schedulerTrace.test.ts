import { describe, expect, it } from 'vitest';
import { runAutoSchedule } from '../domain/autoScheduler';
import { createDemoStoreSchedule } from '../domain/demoData';
import {
  snapshotTraceShifts,
  type SchedulerTraceObserver,
  type TraceEvent,
} from '../domain/schedulerTrace';
import type { AutoScheduleInput, DayOfWeek } from '../domain/types';

function makeDeterministicIdGen(prefix: string): () => string {
  let seq = 0;
  return () => `${prefix}-${++seq}`;
}

function buildDemoInput(overrides?: Partial<AutoScheduleInput>): AutoScheduleInput {
  const schedule = createDemoStoreSchedule({
    nowIso: () => '2026-08-07T00:00:00.000Z',
    generateId: makeDeterministicIdGen('seed'),
  });
  return {
    demand: schedule.demand,
    staff: schedule.staff,
    shifts: schedule.shifts,
    existingAssignments: schedule.assignments,
    targetTxnsPerStaffHour: schedule.targetTxnsPerStaffHour,
    idGenerator: makeDeterministicIdGen('gen'),
    ...overrides,
  };
}

describe('Scheduler Trace Protocol — Determinism & Non-Interference Invariant', () => {
  it('produces bit-for-bit identical SUCCESS result with and without observer', () => {
    const events: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = {
      emit: (e) => events.push(e),
    };

    const baseline = runAutoSchedule(buildDemoInput());
    const traced = runAutoSchedule(buildDemoInput(), { observer });

    expect(traced).toEqual(baseline);
    expect(traced.status).toBe('SUCCESS');

    // Verify expected pipeline stages were traced
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('input_gate')).toBe(true);
    expect(kinds.has('transform')).toBe(true);
    expect(kinds.has('state_init')).toBe(true);
    expect(kinds.has('loop_step')).toBe(true);
    expect(kinds.has('validation')).toBe(true);
    expect(kinds.has('output')).toBe(true);

    // Every grid snapshot must have exactly 112 cells (7 x 16)
    for (const ev of events) {
      if (ev.grid) {
        expect(ev.grid.required).toHaveLength(112);
        expect(ev.grid.staffed).toHaveLength(112);
      }
    }
  });

  it('produces identical BLOCKED_PIN_CONFLICT result with and without observer', () => {
    const schedule = createDemoStoreSchedule({
      nowIso: () => '2026-08-07T00:00:00.000Z',
      generateId: makeDeterministicIdGen('seed'),
    });
    const staff0 = schedule.staff[0]!;
    const shift0 = schedule.shifts[0]!;
    const shift1 = schedule.shifts[1]!;

    const conflictingPins = [
      { id: 'pin-1', day: 0 as const, shiftId: shift0.id, staffId: staff0.id, isPinned: true },
      { id: 'pin-2', day: 0 as const, shiftId: shift1.id, staffId: staff0.id, isPinned: true },
    ];

    const events: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = { emit: (e) => events.push(e) };

    const baseline = runAutoSchedule(buildDemoInput({ existingAssignments: conflictingPins }));
    const traced = runAutoSchedule(buildDemoInput({ existingAssignments: conflictingPins }), { observer });

    expect(traced).toEqual(baseline);
    expect(traced.status).toBe('BLOCKED_PIN_CONFLICT');
    expect(events.some((e) => e.kind === 'input_gate' && e.status === 'blocked')).toBe(true);
  });

  it('produces identical MISSING_INPUT result with and without observer', () => {
    const events: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = { emit: (e) => events.push(e) };

    const baseline = runAutoSchedule(buildDemoInput({ demand: null }));
    const traced = runAutoSchedule(buildDemoInput({ demand: null }), { observer });

    expect(traced).toEqual(baseline);
    expect(traced.status).toBe('FAILED');
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('error');
  });

  it('traces MRV availDays and unavailableDays snapshots identically with Phase 2 inputs', () => {
    const base = buildDemoInput();
    const wkdays: DayOfWeek[] = [0, 1, 2, 3, 4];
    const staffWithUnavail = base.staff.map((s, idx) =>
      idx === 0 ? { ...s, unavailableDays: wkdays.slice() } : s,
    );
    const shiftsWithDays = base.shifts.map((sh, idx) =>
      idx === 0 ? { ...sh, daysOfWeek: wkdays.slice() } : sh,
    );

    const inputWithPhase2: Partial<AutoScheduleInput> = {
      staff: staffWithUnavail,
      shifts: shiftsWithDays,
    };

    const events: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = { emit: (e) => events.push(e) };

    const baseline = runAutoSchedule(buildDemoInput(inputWithPhase2));
    const traced = runAutoSchedule(buildDemoInput(inputWithPhase2), { observer });

    expect(traced).toEqual(baseline);
    expect(traced.status).toBe('SUCCESS');

    const stage1Steps = events.filter((e) => e.stageId.startsWith('stage_1') && e.kind === 'loop_step');
    expect(stage1Steps.length).toBeGreaterThan(0);

    // Every Stage 1 winner candidate includes availDays score
    const winner = stage1Steps[0]!.candidates?.find((c) => c.status === 'WINNER');
    expect(winner?.scores.availDays).toBeTypeOf('number');

    // Entity snapshot preserves unavailableDays & availableDaysCount for constrained staff
    const constrainedEntity = stage1Steps[0]!.entities?.find((e) => e.id === staffWithUnavail[0]!.id);
    expect(constrainedEntity?.availableDaysCount).toBe(2);
    expect(constrainedEntity?.unavailableDays).toEqual([0, 1, 2, 3, 4]);

    // Stage 0 readiness.ok event emits TraceShiftSnapshot[] preserving daysOfWeek
    const readinessEvent = events.find((e) => e.kind === 'input_gate' && e.status === 'ok');
    expect(readinessEvent?.shifts).toHaveLength(shiftsWithDays.length);
    const constrainedShiftSnap = readinessEvent?.shifts?.find((s) => s.id === shiftsWithDays[0]!.id);
    expect(constrainedShiftSnap?.daysOfWeek).toEqual([0, 1, 2, 3, 4]);
    const unconstrainedShiftSnap = readinessEvent?.shifts?.find((s) => s.id === shiftsWithDays[1]!.id);
    expect(unconstrainedShiftSnap?.daysOfWeek).toBeUndefined();
  });

  it('emits shifts snapshot and shiftId on pinned, generated, and removed trace assignments', () => {
    const base = buildDemoInput();
    const staff0 = base.staff[0]!;
    const shift0 = base.shifts[0]!;
    const pinnedInput = buildDemoInput({
      existingAssignments: [
        { id: 'pin-trace-1', day: 0, shiftId: shift0.id, staffId: staff0.id, isPinned: true },
      ],
    });

    const events: Omit<TraceEvent, 'seq'>[] = [];
    const observer: SchedulerTraceObserver = { emit: (e) => events.push(e) };
    const result = runAutoSchedule(pinnedInput, { observer });
    expect(result.status).toBe('SUCCESS');

    const shiftIds = new Set(pinnedInput.shifts.map((sh) => sh.id));

    // Readiness event includes full shifts snapshot
    const readiness = events.find((e) => e.kind === 'input_gate' && e.status === 'ok');
    expect(readiness?.shifts).toBeDefined();
    expect(readiness?.shifts?.map((s) => s.id)).toEqual(pinnedInput.shifts.map((s) => s.id));

    // Output event assignments all carry valid shiftId (both pinned and generated)
    const outputEvent = events.find((e) => e.kind === 'output');
    expect(outputEvent?.assignments).toBeDefined();
    expect(outputEvent!.assignments!.length).toBeGreaterThan(1);

    const pinnedSnap = outputEvent!.assignments!.find((a) => a.isPinned);
    expect(pinnedSnap?.shiftId).toBe(shift0.id);

    for (const a of outputEvent!.assignments!) {
      expect(a.shiftId).toBeTypeOf('string');
      expect(shiftIds.has(a.shiftId!)).toBe(true);
    }

    // Any removedAssignments in Stage 2 also carry valid shiftId
    for (const ev of events) {
      if (ev.removedAssignments) {
        for (const rem of ev.removedAssignments) {
          expect(rem.shiftId).toBeTypeOf('string');
          expect(shiftIds.has(rem.shiftId!)).toBe(true);
        }
      }
    }
  });

  it('snapshotTraceShifts formats labels and clones daysOfWeek immutably', () => {
    const days: DayOfWeek[] = [0, 2, 4];
    const snaps = snapshotTraceShifts([
      { id: 'sh-1', startHour: 7, endHour: 13, daysOfWeek: days },
      { id: 'sh-2', startHour: 14, endHour: 22 },
    ]);

    expect(snaps).toEqual([
      { id: 'sh-1', label: '07–13h', startHour: 7, endHour: 13, daysOfWeek: [0, 2, 4] },
      { id: 'sh-2', label: '14–22h', startHour: 14, endHour: 22 },
    ]);

    // Mutating original array does not affect snapshot
    days.push(6);
    expect(snaps[0]!.daysOfWeek).toEqual([0, 2, 4]);
  });
});
