/**
 * @file Pure Demo Store seed data and default shift template factory.
 * Exports `DEMO_STORE_CSV_TEXT`, `createDefaultShiftTemplates`, and `createDemoStoreSchedule`
 * without touching browser globals, clocks, or random generators directly.
 */

import { DEFAULT_TARGET_N } from './constants';
import { parseCsvTransactions } from './csvParser';
import type { DemandDataset, Schedule, ShiftTemplate, Staff } from './types';

/** Official sample transaction report (Fri 07 Aug – Thu 13 Aug 2026) used by Demo Store. */
export const DEMO_STORE_CSV_TEXT = [
  '"Aug 07, 2026 - Aug 13, 2026"',
  ',"Fri, 07 Aug","Sat, 08 Aug","Sun, 09 Aug","Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug"',
  '7am,22,13,7,12,22,13,16',
  '8am,25,44,32,32,35,33,45',
  '9am,27,57,41,39,48,32,49',
  '10am,38,41,42,35,41,28,41',
  '11am,40,42,37,32,30,33,40',
  '12pm,25,47,30,33,52,33,40',
  '1pm,64,44,38,45,48,45,45',
  '2pm,42,37,18,45,33,31,34',
  '3pm,30,37,22,25,22,25,23',
  '4pm,19,27,28,13,14,14,14',
  '5pm,27,21,19,18,22,34,20',
  '6pm,18,21,16,19,24,19,20',
  '7pm,24,31,22,18,25,22,33',
  '8pm,34,34,24,15,26,15,32',
  '9pm,12,7,8,4,9,10,12',
  '10pm,5,5,6,7,2,6,6',
].join('\n');

interface DemoStaffSeed {
  readonly name: string;
  readonly maxWeeklyHours: number;
}

const DEMO_STAFF_SEEDS: readonly DemoStaffSeed[] = [
  { name: 'Alice Nguyen', maxWeeklyHours: 40 },
  { name: 'Brian Tran', maxWeeklyHours: 40 },
  { name: 'Chloe Le', maxWeeklyHours: 40 },
  { name: 'David Pham', maxWeeklyHours: 32 },
  { name: 'Elena Vo', maxWeeklyHours: 32 },
  { name: 'Felix Hoang', maxWeeklyHours: 24 },
  { name: 'Grace Bui', maxWeeklyHours: 24 },
  { name: 'Henry Dang', maxWeeklyHours: 16 },
  { name: 'Iris Do', maxWeeklyHours: 16 },
];

/**
 * Creates the 2 default shift templates (`07:00–15:00` and `15:00–23:00`) seeded on every new schedule.
 *
 * @param generateId - Deterministic or UUID generator for shift IDs.
 * @returns Two non-overlapping shift templates covering the full `07:00–23:00` operating window.
 */
export function createDefaultShiftTemplates(generateId: () => string): ShiftTemplate[] {
  return [
    { id: generateId(), startHour: 7, endHour: 15 },
    { id: generateId(), startHour: 15, endHour: 23 },
  ];
}

/**
 * Builds a realistic Demo Store schedule pre-loaded with the official sample CSV demand,
 * 9 diverse staff members (`16h–40h` weekly caps), and the 2 default shift templates.
 *
 * @param deps - Injected clock and ID generator for deterministic creation.
 * @returns Fresh `Schedule` ready for immediate one-click Auto-schedule.
 */
export function createDemoStoreSchedule(deps: {
  nowIso: () => string;
  generateId: () => string;
}): Schedule {
  const timestamp = deps.nowIso();
  const parsed = parseCsvTransactions(DEMO_STORE_CSV_TEXT);
  if (!parsed.ok) {
    throw new Error(`Demo Store CSV fixture failed to parse: ${parsed.errors[0]?.message ?? 'unknown error'}`);
  }

  const demand: DemandDataset = {
    importedAt: timestamp,
    sourceFileName: 'Demo Store',
    transactions: parsed.transactions,
  };

  const staff: Staff[] = DEMO_STAFF_SEEDS.map((seed) => ({
    id: deps.generateId(),
    name: seed.name,
    maxWeeklyHours: seed.maxWeeklyHours,
  }));

  return {
    id: deps.generateId(),
    name: 'Demo Store — Typical Week',
    createdAt: timestamp,
    updatedAt: timestamp,
    targetTxnsPerStaffHour: DEFAULT_TARGET_N,
    staff,
    shifts: createDefaultShiftTemplates(deps.generateId),
    demand,
    assignments: [],
  };
}
