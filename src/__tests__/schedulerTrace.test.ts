import { describe, expect, it } from 'vitest';
import { runAutoSchedule } from '../domain/autoScheduler';
import { createDemoStoreSchedule } from '../domain/demoData';
import type { SchedulerTraceObserver, TraceEvent } from '../domain/schedulerTrace';
import type { AutoScheduleInput } from '../domain/types';

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
});
