/**
 * @file Versioned Generic Trace Protocol (`schemaVersion: 1`) for the Auto-Scheduler.
 * 100% pure TypeScript — zero DOM, React, or external dependencies.
 * Designed to be self-describing and additive-only so downstream visualizers/simulators
 * never break when domain inputs, constraints, or solver stages evolve.
 */

import { computeJainFromSums, type SchedulerWorkingState } from './schedulerState';
import type { DayOfWeek, ShiftTemplate } from './types';

export const TRACE_SCHEMA_VERSION = 1 as const;

export type TraceEventKind =
  | 'storage_io'
  | 'input_gate'
  | 'transform'
  | 'state_init'
  | 'loop_step'
  | 'validation'
  | 'output';

export interface TraceMetric {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  readonly delta?: number;
}

export interface TraceCandidateRow {
  readonly id: string;
  readonly label: string;
  readonly status: 'WINNER' | 'RUNNER_UP' | 'REJECTED';
  readonly reason?: string;
  readonly scores: Readonly<Record<string, number | string>>;
}

export interface TraceGridSnapshot {
  readonly required: readonly number[];
  readonly staffed: readonly number[];
  readonly transactions?: readonly number[];
  readonly highlightCells?: readonly number[];
}

export interface TraceShiftSnapshot {
  readonly id: string;
  readonly label: string;
  readonly startHour: number;
  readonly endHour: number;
  readonly daysOfWeek?: readonly DayOfWeek[];
}

export interface TraceAssignmentSnapshot {
  readonly day: DayOfWeek;
  readonly staffId: string;
  readonly staffName: string;
  readonly shiftId?: string;
  readonly shiftLabel: string;
  readonly startHour: number;
  readonly endHour: number;
  readonly isPinned: boolean;
  readonly isChanged?: boolean;
  readonly changeKind?: 'assigned' | 'reassigned' | 'swapped';
}

export interface TraceEntitySnapshot {
  readonly id: string;
  readonly name: string;
  readonly assignedHours: number;
  readonly maxHours: number;
  readonly utilization: number;
  readonly isChanged?: boolean;
  readonly unavailableDays?: readonly DayOfWeek[];
  readonly availableDaysCount?: number;
  readonly extra?: Readonly<Record<string, number | string>>;
}

export interface TraceRuleHint {
  readonly title: string;
  readonly rules: readonly string[];
}

export interface TraceAlgorithmRef {
  readonly algorithmCommit: string;
  readonly algorithmShortCommit: string;
  readonly algorithmDate: string;
  readonly algorithmSubject: string;
  readonly baselineCommit: string;
  readonly baselineShortCommit: string;
}

export interface TraceEvent {
  readonly seq: number;
  readonly stageId: string;
  readonly stageLabel: string;
  readonly kind: TraceEventKind;
  readonly status: 'ok' | 'warning' | 'blocked' | 'error';
  readonly title: string;
  readonly narrative: string;
  readonly ruleHint?: TraceRuleHint;
  readonly metrics: readonly TraceMetric[];
  readonly grid?: TraceGridSnapshot;
  readonly shifts?: readonly TraceShiftSnapshot[];
  readonly entities?: readonly TraceEntitySnapshot[];
  readonly assignments?: readonly TraceAssignmentSnapshot[];
  readonly removedAssignments?: readonly TraceAssignmentSnapshot[];
  readonly stateDiff?: readonly string[];
  readonly candidates?: readonly TraceCandidateRow[];
  readonly debugPayload?: Readonly<Record<string, unknown>>;
}

export interface TraceStageRange {
  readonly id: string;
  readonly label: string;
  readonly startSeq: number;
  readonly endSeq: number;
}

export interface TraceRun {
  readonly schemaVersion: typeof TRACE_SCHEMA_VERSION;
  readonly scenarioName: string;
  readonly createdAtIso: string;
  readonly outcome: 'SUCCESS' | 'BLOCKED' | 'FAILED';
  readonly algorithmRef?: TraceAlgorithmRef;
  readonly stages: readonly TraceStageRange[];
  readonly events: readonly TraceEvent[];
}

export interface SchedulerTraceObserver {
  emit(event: Omit<TraceEvent, 'seq'>): void;
}

export interface AutoScheduleOptions {
  readonly observer?: SchedulerTraceObserver;
}

const DAY_LABELS_VI: readonly string[] = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

/** Pure helper returning a Vietnamese day label for trace narratives. */
export function formatTraceDay(day: DayOfWeek): string {
  return DAY_LABELS_VI[day] ?? `Ngày ${day}`;
}

/** Pure helper formatting a shift time window for trace narratives. */
export function formatTraceShift(shift: { readonly startHour: number; readonly endHour: number }): string {
  const pad = (h: number) => String(h).padStart(2, '0');
  return `Ca ${pad(shift.startHour)}–${pad(shift.endHour)}h`;
}

/** Pure helper computing coverage %, staffing gaps, and Jain Index from working state. */
export function computeTraceSummaryMetrics(
  state: SchedulerWorkingState,
  prevCoveragePct?: number,
  prevJain?: number,
): {
  coveragePct: number;
  jainIndex: number;
  staffingGaps: number;
  metrics: readonly TraceMetric[];
} {
  let totalReq = 0;
  let totalCovered = 0;
  let staffingGaps = 0;

  for (let i = 0; i < 112; i++) {
    const req = state.requiredGrid[i]!;
    const cur = state.staffHoursGrid[i]!;
    totalReq += req;
    totalCovered += Math.min(req, cur);
    if (req > 0 && cur === 0) staffingGaps += 1;
  }

  const coveragePct = totalReq === 0 ? 100 : Math.round((totalCovered / totalReq) * 1000) / 10;
  const rawJain = computeJainFromSums(state.sumU, state.sumU2, state.eligibleStaff.length);
  const jainIndex = Math.round(rawJain * 10000) / 10000;

  const covDelta =
    prevCoveragePct !== undefined ? Math.round((coveragePct - prevCoveragePct) * 10) / 10 : undefined;
  const jainDelta =
    prevJain !== undefined ? Math.round((jainIndex - prevJain) * 10000) / 10000 : undefined;

  const metrics: TraceMetric[] = [
    {
      key: 'coveragePct',
      label: 'Độ phủ nhu cầu',
      value: coveragePct,
      unit: '%',
      ...(covDelta !== undefined && covDelta !== 0 ? { delta: covDelta } : {}),
    },
    {
      key: 'jainIndex',
      label: 'Công bằng (Jain)',
      value: jainIndex,
      ...(jainDelta !== undefined && jainDelta !== 0 ? { delta: jainDelta } : {}),
    },
    {
      key: 'staffingGaps',
      label: 'Ô trống người',
      value: staffingGaps,
      unit: 'ô',
    },
  ];

  return { coveragePct, jainIndex, staffingGaps, metrics };
}

/** Pure helper cloning the 112-cell grid into plain readonly arrays for immutable time-travel snapshots. */
export function snapshotTraceGrid(
  requiredGrid: Float64Array,
  staffHoursGrid: Uint32Array,
  highlightCells?: readonly number[],
  txnsGrid?: Float64Array,
): TraceGridSnapshot {
  return {
    required: Array.from(requiredGrid),
    staffed: Array.from(staffHoursGrid),
    ...(txnsGrid ? { transactions: Array.from(txnsGrid) } : {}),
    ...(highlightCells && highlightCells.length > 0 ? { highlightCells } : {}),
  };
}

/** Pure helper snapshotting shift templates for immutable time-travel roster rendering. */
export function snapshotTraceShifts(
  shifts: readonly Readonly<ShiftTemplate>[],
): readonly TraceShiftSnapshot[] {
  const pad = (h: number) => String(h).padStart(2, '0');
  return shifts.map((sh) => ({
    id: sh.id,
    label: `${pad(sh.startHour)}–${pad(sh.endHour)}h`,
    startHour: sh.startHour,
    endHour: sh.endHour,
    ...(sh.daysOfWeek ? { daysOfWeek: [...sh.daysOfWeek] } : {}),
  }));
}

/** Pure helper building a live roster snapshot (pinned + workingNew) for immutable time-travel. */
export function snapshotTraceAssignments(
  state: SchedulerWorkingState,
  pinnedSnapshots: readonly TraceAssignmentSnapshot[],
  changedWorkingIndices?: ReadonlyMap<number, 'assigned' | 'reassigned' | 'swapped'>,
): readonly TraceAssignmentSnapshot[] {
  const result: TraceAssignmentSnapshot[] = pinnedSnapshots.map((p) => ({ ...p, isChanged: false }));
  const pad = (h: number) => String(h).padStart(2, '0');

  for (let i = 0; i < state.workingNew.length; i++) {
    const w = state.workingNew[i]!;
    const staff = state.eligibleStaff[w.staffIdx]!;
    const changeKind = changedWorkingIndices?.get(i);
    result.push({
      day: w.day,
      staffId: staff.id,
      staffName: staff.name,
      shiftId: w.shiftId,
      shiftLabel: `${pad(w.startHour)}–${pad(w.endHour)}h`,
      startHour: w.startHour,
      endHour: w.endHour,
      isPinned: false,
      ...(changeKind ? { isChanged: true, changeKind } : {}),
    });
  }
  return result;
}

/** Pure helper snapshotting staff utilization bars for immutable time-travel snapshots. */
export function snapshotTraceEntities(
  state: SchedulerWorkingState,
  changedStaffIndices?: readonly number[],
): readonly TraceEntitySnapshot[] {
  const changedSet = changedStaffIndices ? new Set(changedStaffIndices) : null;
  const entities: TraceEntitySnapshot[] = [];
  for (let i = 0; i < state.eligibleStaff.length; i++) {
    const s = state.eligibleStaff[i]!;
    const assigned = state.assignedHours[i]!;
    const maxH = state.maxHours[i]!;
    const unavailMask = state.unavailableMask[i]!;
    let unavailableDays: DayOfWeek[] | undefined;
    if (unavailMask !== 0) {
      unavailableDays = [];
      for (let d = 0; d < 7; d++) {
        if ((unavailMask & (1 << d)) !== 0) {
          unavailableDays.push(d as DayOfWeek);
        }
      }
    }
    entities.push({
      id: s.id,
      name: s.name,
      assignedHours: assigned,
      maxHours: maxH,
      utilization: maxH > 0 ? Math.round((assigned / maxH) * 1000) / 1000 : 0,
      ...(changedSet?.has(i) ? { isChanged: true } : {}),
      ...(unavailableDays
        ? { unavailableDays, availableDaysCount: 7 - unavailableDays.length }
        : {}),
    });
  }
  return entities;
}
