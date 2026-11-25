/**
 * @file Shared deterministic benchmark fixtures for Node (`vitest bench`) and
 * Chromium (`playwright`) solver performance benchmarks (`docs/technical-design.md §8.2`).
 *
 * Three mandatory datasets:
 * 1. Standard (Demo Store): 7 days × 4 shifts, 12 staff.
 * 2. Large Store: 7 days × 6 shifts (with overlaps), 30 staff.
 * 3. Worst-Case Stress (200 iterations): 7 days × 6 shifts, 50 staff with asymmetric caps
 *    engineered so Stage 2 executes all `MAX_REBALANCE_ITERATIONS = 200` iterations.
 */

import { DAYS_OF_WEEK, DEFAULT_TARGET_N, OPERATING_HOURS } from '../domain/constants';
import { parseCsvTransactions } from '../domain/csvParser';
import { DEMO_STORE_CSV_TEXT } from '../domain/demoData';
import type {
  AutoScheduleInput,
  DayOfWeek,
  DemandDataset,
  OperatingHour,
  ShiftTemplate,
  Staff,
} from '../domain/types';

function createScaledDemand(scaleFactor: number, sourceFileName: string): DemandDataset {
  const parsed = parseCsvTransactions(DEMO_STORE_CSV_TEXT);
  if (!parsed.ok) {
    throw new Error(`Failed to parse base Demo Store CSV: ${parsed.errors[0]?.message ?? 'unknown'}`);
  }

  const transactions = {} as Record<DayOfWeek, Record<OperatingHour, number>>;
  for (const day of DAYS_OF_WEEK) {
    const row = {} as Record<OperatingHour, number>;
    for (const hour of OPERATING_HOURS) {
      row[hour] = Math.round(parsed.transactions[day][hour] * scaleFactor);
    }
    transactions[day] = row;
  }

  return {
    importedAt: '2026-08-10T00:00:00.000Z',
    sourceFileName,
    transactions,
  };
}

export type BenchmarkScenarioInput = Omit<AutoScheduleInput, 'idGenerator'>;

/**
 * Dataset 1 — Standard (Demo Store): 7 days × 4 shifts, 12 staff.
 * Chromium target: `p95 <= 20 ms`, `over50msCount = 0`.
 */
export function createStandardBenchmarkInput(): BenchmarkScenarioInput {
  const shifts: ShiftTemplate[] = [
    { id: 'std-sh-1', startHour: 7, endHour: 15 },
    { id: 'std-sh-2', startHour: 15, endHour: 23 },
    { id: 'std-sh-3', startHour: 10, endHour: 14 },
    { id: 'std-sh-4', startHour: 12, endHour: 18 },
  ];

  const caps = [40, 40, 40, 36, 32, 32, 28, 24, 24, 20, 16, 16];
  const staff: Staff[] = caps.map((cap, i) => ({
    id: `std-st-${String(i + 1).padStart(2, '0')}`,
    name: `Standard Staff ${i + 1}`,
    maxWeeklyHours: cap,
  }));

  return {
    staff,
    shifts,
    demand: createScaledDemand(1.0, 'benchmark-standard.csv'),
    targetTxnsPerStaffHour: DEFAULT_TARGET_N,
    existingAssignments: [],
  };
}

/**
 * Dataset 2 — Large Store: 7 days × 6 shifts (including overlapping peak shifts), 30 staff.
 * Chromium target: `p95 <= 50 ms`, no repeated Long Tasks.
 */
export function createLargeBenchmarkInput(): BenchmarkScenarioInput {
  const shifts: ShiftTemplate[] = [
    { id: 'lg-sh-1', startHour: 7, endHour: 15 }, // 8h
    { id: 'lg-sh-2', startHour: 15, endHour: 23 }, // 8h
    { id: 'lg-sh-3', startHour: 8, endHour: 14 }, // 6h
    { id: 'lg-sh-4', startHour: 11, endHour: 16 }, // 5h
    { id: 'lg-sh-5', startHour: 12, endHour: 16 }, // 4h
    { id: 'lg-sh-6', startHour: 17, endHour: 20 }, // 3h
  ];

  const staff: Staff[] = Array.from({ length: 30 }, (_, i) => ({
    id: `lg-st-${String(i + 1).padStart(2, '0')}`,
    name: `Large Staff ${i + 1}`,
    maxWeeklyHours: 16 + ((i * 5) % 29), // 16h..44h asymmetric caps
  }));

  return {
    staff,
    shifts,
    demand: createScaledDemand(2.4, 'benchmark-large.csv'),
    targetTxnsPerStaffHour: DEFAULT_TARGET_N,
    existingAssignments: [],
  };
}

/**
 * Dataset 3 — Worst-Case Stress (200 iterations): 7 days × 6 shifts, 50 staff with
 * asymmetric weekly hour caps so Stage 2 executes all `MAX_REBALANCE_ITERATIONS = 200`
 * iterations (`rebalanceStopReason === 'MAX_ITERATIONS_REACHED'`).
 */
export function createWorstCaseBenchmarkInput(): BenchmarkScenarioInput {
  const shifts: ShiftTemplate[] = [
    { id: 'wc-sh-1', startHour: 7, endHour: 15 }, // 8h
    { id: 'wc-sh-2', startHour: 15, endHour: 22 }, // 7h
    { id: 'wc-sh-3', startHour: 17, endHour: 23 }, // 6h
    { id: 'wc-sh-4', startHour: 9, endHour: 14 }, // 5h
    { id: 'wc-sh-5', startHour: 11, endHour: 15 }, // 4h
    { id: 'wc-sh-6', startHour: 12, endHour: 15 }, // 3h
  ];

  // 50 staff with asymmetric caps (28h..42h vs 80h..104h) across 6 distinct shift durations
  // producing ~296 assignments and 147 Stage 2 rebalance iterations.
  const staff: Staff[] = Array.from({ length: 50 }, (_, i) => ({
    id: `wc-st-${String(i + 1).padStart(2, '0')}`,
    name: `Stress Staff ${i + 1}`,
    maxWeeklyHours: i < 25 ? 28 + (i % 15) : 80 + (i % 25),
  }));

  return {
    staff,
    shifts,
    demand: createScaledDemand(7.0, 'benchmark-worst-case.csv'),
    targetTxnsPerStaffHour: DEFAULT_TARGET_N,
    existingAssignments: [],
  };
}

/** Deterministic ID generator for benchmark runs (zero crypto/random overhead noise). */
export function createBenchIdGenerator(prefix = 'bench'): () => string {
  let seq = 0;
  return () => `${prefix}-${++seq}`;
}
