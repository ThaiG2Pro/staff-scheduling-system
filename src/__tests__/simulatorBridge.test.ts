// @vitest-environment jsdom
/**
 * @file Unit tests for the Web Scheduler → Simulator bridge (`simulatorBridge.ts`)
 * and `runSimulationFromSchedule` in `tools/simulator/src/runner/scenarioRunner.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoStoreSchedule } from '../domain/demoData';
import type { Schedule } from '../domain/types';
import {
  SIMULATOR_BRIDGE_PROTOCOL_VERSION,
  isValidSimulatorScheduleSnapshot,
  openScheduleInSimulator,
  type SimulatorScheduleSnapshot,
} from '../ui/common/simulatorBridge';
import { runSimulationFromSchedule } from '../../tools/simulator/src/runner/scenarioRunner';

function makeDemoSchedule(): Schedule {
  let seq = 1;
  return createDemoStoreSchedule({
    nowIso: () => '2026-08-10T08:00:00.000Z',
    generateId: () => `sim-bridge-${seq++}`,
  });
}

function makeValidSnapshot(schedule: Schedule = makeDemoSchedule()): SimulatorScheduleSnapshot {
  return {
    protocolVersion: SIMULATOR_BRIDGE_PROTOCOL_VERSION,
    capturedAtIso: '2026-08-10T09:00:00.000Z',
    resultStatus: 'SUCCESS',
    schedule,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('isValidSimulatorScheduleSnapshot', () => {
  it('accepts a valid SimulatorScheduleSnapshot payload', () => {
    expect(isValidSimulatorScheduleSnapshot(makeValidSnapshot())).toBe(true);
  });

  it('rejects null, primitives, wrong protocolVersion, invalid resultStatus, and malformed schedule', () => {
    expect(isValidSimulatorScheduleSnapshot(null)).toBe(false);
    expect(isValidSimulatorScheduleSnapshot('invalid')).toBe(false);
    expect(isValidSimulatorScheduleSnapshot({})).toBe(false);

    const valid = makeValidSnapshot();
    expect(isValidSimulatorScheduleSnapshot({ ...valid, protocolVersion: 2 })).toBe(false);
    expect(isValidSimulatorScheduleSnapshot({ ...valid, capturedAtIso: '' })).toBe(false);
    expect(isValidSimulatorScheduleSnapshot({ ...valid, resultStatus: 'UNKNOWN' })).toBe(false);
    expect(isValidSimulatorScheduleSnapshot({ ...valid, schedule: null })).toBe(false);
    expect(
      isValidSimulatorScheduleSnapshot({
        ...valid,
        schedule: { ...valid.schedule, staff: 'not-an-array' },
      }),
    ).toBe(false);
    expect(
      isValidSimulatorScheduleSnapshot({
        ...valid,
        schedule: { ...valid.schedule, targetTxnsPerStaffHour: Number.NaN },
      }),
    ).toBe(false);
  });
});

describe('openScheduleInSimulator', () => {
  it('completes SIMULATOR_READY -> SIMULATOR_LOAD_SCHEDULE -> SIMULATOR_LOAD_ACK handshake', () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const focus = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      postMessage,
      focus,
    } as unknown as Window);

    const snapshot = makeValidSnapshot();
    const onDelivered = vi.fn();
    const onUnavailable = vi.fn();

    const res = openScheduleInSimulator(snapshot, {
      simulatorUrl: 'http://localhost:5174',
      timeoutMs: 1500,
      onDelivered,
      onUnavailable,
    });

    expect(res).toEqual({ ok: true });
    expect(focus).toHaveBeenCalledTimes(1);
    // Immediate send for already-open tab
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SIMULATOR_LOAD_SCHEDULE', payload: snapshot },
      'http://localhost:5174',
    );

    // Simulate newly opened tab posting SIMULATOR_READY
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:5174',
        data: { type: 'SIMULATOR_READY', protocolVersion: 1 },
      }),
    );
    expect(postMessage).toHaveBeenCalledTimes(2);

    // Simulate Simulator posting SIMULATOR_LOAD_ACK
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:5174',
        data: { type: 'SIMULATOR_LOAD_ACK', protocolVersion: 1 },
      }),
    );

    expect(onDelivered).toHaveBeenCalledTimes(1);

    // Advancing past timeout must not trigger onUnavailable once delivered
    vi.advanceTimersByTime(3000);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('returns popup-blocked error when window.open returns null', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    const res = openScheduleInSimulator(makeValidSnapshot(), {
      simulatorUrl: 'http://localhost:5174',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Popup blocked/i);
    }
  });

  it('invokes onUnavailable if simulator does not acknowledge before timeout', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue({
      postMessage: vi.fn(),
      focus: vi.fn(),
    } as unknown as Window);

    const onDelivered = vi.fn();
    const onUnavailable = vi.fn();

    const res = openScheduleInSimulator(makeValidSnapshot(), {
      simulatorUrl: 'http://localhost:5174',
      timeoutMs: 1200,
      onDelivered,
      onUnavailable,
    });

    expect(res).toEqual({ ok: true });
    vi.advanceTimersByTime(1200);

    expect(onDelivered).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith('http://localhost:5174');
  });

  it('resolves relative simulatorUrl (/sim/) to window.location.origin and completes handshake', () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const focus = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      postMessage,
      focus,
    } as unknown as Window);

    const snapshot = makeValidSnapshot();
    const onDelivered = vi.fn();
    const onUnavailable = vi.fn();

    const res = openScheduleInSimulator(snapshot, {
      simulatorUrl: '/sim/',
      timeoutMs: 1500,
      onDelivered,
      onUnavailable,
    });

    expect(res).toEqual({ ok: true });
    expect(openSpy).toHaveBeenCalledWith('/sim/', 'staff-scheduler-sim');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SIMULATOR_LOAD_SCHEDULE', payload: snapshot },
      window.location.origin,
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'SIMULATOR_READY', protocolVersion: 1 },
      }),
    );
    expect(postMessage).toHaveBeenCalledTimes(2);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'SIMULATOR_LOAD_ACK', protocolVersion: 1 },
      }),
    );

    expect(onDelivered).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

describe('runSimulationFromSchedule', () => {
  it('replays a schedule with pinned shifts, staff availability, and shift activeDays to SUCCESS', () => {
    const base = makeDemoSchedule();
    const s0 = base.staff[0]!;
    const s1 = base.staff[1]!;
    const sh0 = base.shifts[0]!;
    const sh1 = base.shifts[1]!;

    const schedule: Schedule = {
      ...base,
      name: 'Flagship Live Roster',
      staff: base.staff.map((st) => (st.id === s1.id ? { ...st, unavailableDays: [0] } : st)),
      shifts: base.shifts.map((sh) =>
        sh.id === sh1.id ? { ...sh, activeDays: [0, 1, 2, 3, 4] } : sh,
      ),
      assignments: [
        { id: 'pin-mon-1', day: 0, shiftId: sh0.id, staffId: s0.id, isPinned: true },
      ],
    };

    const trace = runSimulationFromSchedule(schedule);

    expect(trace.outcome).toBe('SUCCESS');
    expect(trace.scenarioName).toContain('Web Roster: Flagship Live Roster');
    expect(trace.events.some((e) => e.stageId === 'stage_storage')).toBe(true);
    expect(trace.events.some((e) => e.stageId === 'stage_0_gates')).toBe(true);
    expect(trace.events.some((e) => e.stageId === 'stage_storage_commit')).toBe(true);
  });

  it('produces BLOCKED outcome when pinned shifts have a pin conflict', () => {
    const base = makeDemoSchedule();
    const s0 = base.staff[0]!;
    const sh0 = base.shifts[0]!;
    const sh1 = base.shifts[1]!;

    const conflictedSchedule: Schedule = {
      ...base,
      name: 'Conflicted Roster',
      assignments: [
        { id: 'pin-c1', day: 0, shiftId: sh0.id, staffId: s0.id, isPinned: true },
        { id: 'pin-c2', day: 0, shiftId: sh1.id, staffId: s0.id, isPinned: true },
      ],
    };

    const trace = runSimulationFromSchedule(conflictedSchedule);
    expect(trace.outcome).toBe('BLOCKED');
    expect(trace.events.some((e) => e.stageId === 'stage_storage_commit' && e.status === 'blocked')).toBe(true);
  });

  it('applies targetNOverride when provided', () => {
    const base = makeDemoSchedule();
    const trace = runSimulationFromSchedule(base, 22.5);

    expect(trace.outcome).toBe('SUCCESS');
    expect(trace.scenarioName).toContain('(N=22.5)');
  });
});
