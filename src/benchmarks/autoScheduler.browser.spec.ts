/**
 * @file Chromium Main-Thread Performance Benchmark (`pnpm run bench:browser`).
 * Measures `runAutoSchedule` across >= 100 runs after warm-up on Chromium for all 3
 * datasets (`Standard`, `Large`, `Worst-Case`), reporting `median`, `p95`, `max`,
 * and `over50msCount` (`docs/technical-design.md §8.1–§8.3`).
 */

import { expect, test } from '@playwright/test';
import type { AutoScheduleInput, AutoScheduleResult } from '../domain/types';
import {
  createLargeBenchmarkInput,
  createStandardBenchmarkInput,
  createWorstCaseBenchmarkInput,
  type BenchmarkScenarioInput,
} from './fixtures';

interface BenchStats {
  label: string;
  runs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  over50msCount: number;
  rebalanceIterationsRun: number;
  rebalanceStopReason: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

test('Chromium Auto-Scheduler Performance Benchmark (>=100 runs, AC-06)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?bench=1');

  const scenarios: Array<{
    label: string;
    input: BenchmarkScenarioInput;
    warmupRuns: number;
    measuredRuns: number;
  }> = [
    {
      label: 'Standard (Demo Store: 4 shifts, 12 staff)',
      input: createStandardBenchmarkInput(),
      warmupRuns: 10,
      measuredRuns: 100,
    },
    {
      label: 'Large Store (6 shifts, 30 staff)',
      input: createLargeBenchmarkInput(),
      warmupRuns: 10,
      measuredRuns: 100,
    },
    {
      label: 'Worst-Case Stress (6 shifts, 50 staff)',
      input: createWorstCaseBenchmarkInput(),
      warmupRuns: 5,
      measuredRuns: 100,
    },
  ];

  const results: BenchStats[] = [];

  for (const scenario of scenarios) {
    const raw = await page.evaluate(
      ({ input, warmupRuns, measuredRuns }) => {
        const api = (
          window as unknown as {
            __STAFF_SCHEDULER_BENCH__?: {
              runAutoSchedule: (arg: AutoScheduleInput) => AutoScheduleResult;
            };
          }
        ).__STAFF_SCHEDULER_BENCH__;
        if (!api) throw new Error('Benchmark hook __STAFF_SCHEDULER_BENCH__ is not available.');

        const makeIdGen = (prefix: string) => {
          let seq = 0;
          return () => `${prefix}-${++seq}`;
        };

        for (let w = 0; w < warmupRuns; w++) {
          const res = api.runAutoSchedule({ ...input, idGenerator: makeIdGen(`w-${w}`) });
          if (res.status !== 'SUCCESS') throw new Error(`Warmup failed: ${res.status}`);
        }

        const samples: number[] = [];
        let rebalanceIterationsRun = 0;
        let rebalanceStopReason = 'UNKNOWN';

        for (let r = 0; r < measuredRuns; r++) {
          const t0 = performance.now();
          const res = api.runAutoSchedule({ ...input, idGenerator: makeIdGen(`r-${r}`) });
          const elapsed = performance.now() - t0;
          if (res.status !== 'SUCCESS') throw new Error(`Run ${r} failed: ${res.status}`);
          samples.push(elapsed);
          if (r === 0) {
            rebalanceIterationsRun = res.diagnostics.rebalanceIterationsRun;
            rebalanceStopReason = res.diagnostics.rebalanceStopReason;
          }
        }

        return { samples, rebalanceIterationsRun, rebalanceStopReason };
      },
      {
        input: scenario.input,
        warmupRuns: scenario.warmupRuns,
        measuredRuns: scenario.measuredRuns,
      },
    );

    const sorted = [...raw.samples].sort((a, b) => a - b);
    const stats: BenchStats = {
      label: scenario.label,
      runs: sorted.length,
      medianMs: Number(percentile(sorted, 0.5).toFixed(2)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
      maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
      over50msCount: sorted.filter((ms) => ms > 50).length,
      rebalanceIterationsRun: raw.rebalanceIterationsRun,
      rebalanceStopReason: raw.rebalanceStopReason,
    };
    results.push(stats);
  }

  console.table(results);

  const standard = results[0]!;
  const large = results[1]!;
  const worstCase = results[2]!;

  expect(standard.p95Ms).toBeLessThanOrEqual(20);
  expect(standard.over50msCount).toBe(0);
  expect(large.p95Ms).toBeLessThanOrEqual(50);
  expect(worstCase.rebalanceIterationsRun).toBeGreaterThanOrEqual(140);
});
