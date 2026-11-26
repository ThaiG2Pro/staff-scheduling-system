/// <reference types="vite/client" />
/**
 * @file Browser-side bridge between Web Scheduler (`pnpm run dev`) and the
 * standalone Step-by-Step Simulator (`pnpm run dev:sim`) via `window.postMessage`.
 *
 * Keeps `src/domain/*` 100% pure TypeScript and `localStorage` (`schemaVersion: 1`)
 * completely untouched; snapshots are held in memory on Web Scheduler and in
 * `sessionStorage` on the Simulator side.
 */

import type { AutoScheduleResult, Schedule } from '../../domain/types';

export const SIMULATOR_BRIDGE_PROTOCOL_VERSION = 1 as const;

export const SIMULATOR_SESSION_STORAGE_KEY = 'staff_scheduler_sim_live_snapshot_v1';

export interface SimulatorScheduleSnapshot {
  readonly protocolVersion: typeof SIMULATOR_BRIDGE_PROTOCOL_VERSION;
  readonly capturedAtIso: string;
  readonly resultStatus: AutoScheduleResult['status'];
  readonly schedule: Schedule;
}

export interface SimulatorReadyMessage {
  readonly type: 'SIMULATOR_READY';
  readonly protocolVersion: typeof SIMULATOR_BRIDGE_PROTOCOL_VERSION;
}

export interface SimulatorLoadScheduleMessage {
  readonly type: 'SIMULATOR_LOAD_SCHEDULE';
  readonly payload: SimulatorScheduleSnapshot;
}

export interface SimulatorLoadAckMessage {
  readonly type: 'SIMULATOR_LOAD_ACK';
  readonly protocolVersion: typeof SIMULATOR_BRIDGE_PROTOCOL_VERSION;
}

const VALID_RESULT_STATUSES = new Set<string>(['SUCCESS', 'BLOCKED_PIN_CONFLICT', 'FAILED']);

export function getSimulatorUrl(): string {
  const configured = (import.meta.env.VITE_SIMULATOR_URL as string | undefined)?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? 'http://localhost:5174' : '/sim/';
}

export function isValidSimulatorScheduleSnapshot(
  value: unknown,
): value is SimulatorScheduleSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.protocolVersion !== SIMULATOR_BRIDGE_PROTOCOL_VERSION) return false;
  if (typeof candidate.capturedAtIso !== 'string' || candidate.capturedAtIso.trim().length === 0) {
    return false;
  }
  if (typeof candidate.resultStatus !== 'string' || !VALID_RESULT_STATUSES.has(candidate.resultStatus)) {
    return false;
  }

  const sched = candidate.schedule;
  if (!sched || typeof sched !== 'object') return false;
  const s = sched as Record<string, unknown>;

  if (typeof s.id !== 'string' || typeof s.name !== 'string') return false;
  if (!Array.isArray(s.staff) || !Array.isArray(s.shifts) || !Array.isArray(s.assignments)) {
    return false;
  }
  if (typeof s.targetTxnsPerStaffHour !== 'number' || !Number.isFinite(s.targetTxnsPerStaffHour)) {
    return false;
  }

  return true;
}

export interface OpenSimulatorOptions {
  simulatorUrl?: string;
  timeoutMs?: number;
  onDelivered?: () => void;
  onUnavailable?: (url: string) => void;
}

export function openScheduleInSimulator(
  snapshot: SimulatorScheduleSnapshot,
  options?: OpenSimulatorOptions,
): { ok: true } | { ok: false; error: string } {
  const simUrl = options?.simulatorUrl?.trim() || getSimulatorUrl();
  const simWin = window.open(simUrl, 'staff-scheduler-sim');

  if (!simWin) {
    return {
      ok: false,
      error: 'Popup blocked — allow popups for this site to open the Simulator.',
    };
  }

  try {
    simWin.focus();
  } catch {
    // Ignore cross-origin or browser focus restrictions
  }

  const targetOrigin = new URL(simUrl, window.location.origin).origin;
  let delivered = false;
  let timerId: number | null = null;

  const cleanup = () => {
    window.removeEventListener('message', handleMessage);
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const postSnapshot = () => {
    const message: SimulatorLoadScheduleMessage = {
      type: 'SIMULATOR_LOAD_SCHEDULE',
      payload: snapshot,
    };
    try {
      simWin.postMessage(message, targetOrigin);
    } catch {
      // Newly opened window may still be initializing; wait for SIMULATOR_READY
    }
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== targetOrigin) return;
    const data = event.data as Partial<SimulatorReadyMessage | SimulatorLoadAckMessage> | null;
    if (!data || typeof data !== 'object') return;

    if (
      data.type === 'SIMULATOR_READY' &&
      data.protocolVersion === SIMULATOR_BRIDGE_PROTOCOL_VERSION
    ) {
      postSnapshot();
      return;
    }

    if (
      data.type === 'SIMULATOR_LOAD_ACK' &&
      data.protocolVersion === SIMULATOR_BRIDGE_PROTOCOL_VERSION
    ) {
      if (!delivered) {
        delivered = true;
        cleanup();
        options?.onDelivered?.();
      }
    }
  };

  window.addEventListener('message', handleMessage);

  // Also send immediately so an already-loaded reused Simulator tab receives the snapshot right away
  postSnapshot();

  timerId = window.setTimeout(() => {
    if (!delivered) {
      cleanup();
      options?.onUnavailable?.(simUrl);
    }
  }, options?.timeoutMs ?? 2000);

  return { ok: true };
}
