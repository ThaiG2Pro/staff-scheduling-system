/**
 * @file Node solver microbenchmarks using Vitest Bench (`pnpm run bench`).
 * Covers the 3 datasets defined in `docs/technical-design.md §8.2`.
 */

import { bench, describe, expect } from 'vitest';
import { runAutoSchedule } from '../domain/autoScheduler';
import {
  createBenchIdGenerator,
  createLargeBenchmarkInput,
  createStandardBenchmarkInput,
  createWorstCaseBenchmarkInput,
} from './fixtures';

const standardInput = createStandardBenchmarkInput();
const largeInput = createLargeBenchmarkInput();
const worstCaseInput = createWorstCaseBenchmarkInput();

// Pre-flight invariant assertions (docs/technical-design.md §8.2)
const standardCheck = runAutoSchedule({
  ...standardInput,
  idGenerator: createBenchIdGenerator('chk-std'),
});
expect(standardCheck.status).toBe('SUCCESS');

const largeCheck = runAutoSchedule({
  ...largeInput,
  idGenerator: createBenchIdGenerator('chk-lg'),
});
expect(largeCheck.status).toBe('SUCCESS');

const worstCaseCheck = runAutoSchedule({
  ...worstCaseInput,
  idGenerator: createBenchIdGenerator('chk-wc'),
});
expect(worstCaseCheck.status).toBe('SUCCESS');
if (worstCaseCheck.status === 'SUCCESS') {
  expect(worstCaseCheck.diagnostics.rebalanceIterationsRun).toBeGreaterThanOrEqual(140);
}

describe('Auto-Scheduler Node Microbenchmarks (AC-06)', () => {
  bench(
    'Standard (Demo Store: 4 shifts, 12 staff)',
    () => {
      const res = runAutoSchedule({
        ...standardInput,
        idGenerator: createBenchIdGenerator('std'),
      });
      if (res.status !== 'SUCCESS') throw new Error(`Expected SUCCESS, got ${res.status}`);
    },
    { warmupIterations: 10, iterations: 100 },
  );

  bench(
    'Large Store (6 shifts, 30 staff)',
    () => {
      const res = runAutoSchedule({
        ...largeInput,
        idGenerator: createBenchIdGenerator('lg'),
      });
      if (res.status !== 'SUCCESS') throw new Error(`Expected SUCCESS, got ${res.status}`);
    },
    { warmupIterations: 5, iterations: 50 },
  );

  bench(
    'Worst-Case Stress (6 shifts, 50 staff, 147 rebalance iterations)',
    () => {
      const res = runAutoSchedule({
        ...worstCaseInput,
        idGenerator: createBenchIdGenerator('wc'),
      });
      if (res.status !== 'SUCCESS') throw new Error(`Expected SUCCESS, got ${res.status}`);
    },
    { warmupIterations: 3, iterations: 20 },
  );
});
