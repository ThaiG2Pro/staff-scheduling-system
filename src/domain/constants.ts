/**
 * @file Business and algorithmic constants for the pure scheduling domain.
 * Provides operating hours (`7..22`), week days (`0..6`), target `N` bounds (`[1, 500]`),
 * Health Bar thresholds, BigInt safe-integer limits, and Stage 2 rebalance caps.
 */

import type { DayOfWeek, OperatingHour } from './types';

export const DAYS_OF_WEEK: readonly DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6] as const;

export const OPERATING_HOURS: readonly OperatingHour[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const;

export const DAY_LABELS: Readonly<Record<DayOfWeek, string>> = {
  0: 'Mon',
  1: 'Tue',
  2: 'Wed',
  3: 'Thu',
  4: 'Fri',
  5: 'Sat',
  6: 'Sun',
} as const;

export const MIN_OPERATING_HOUR = 7;
export const MAX_OPERATING_HOUR_INCLUSIVE = 22;
export const MAX_SHIFT_END_HOUR = 23;
export const OPERATING_HOURS_PER_DAY = 16;
export const DAYS_IN_WEEK = 7;

export const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const DECIMAL_REGEX = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
export const PLAIN_DECIMAL_INPUT_REGEX = /^\d+(?:\.\d+)?$/;

export const MIN_TARGET_N = 1;
export const MAX_TARGET_N = 500;
export const DEFAULT_TARGET_N = 15;

export const HEALTH_THRESHOLDS = {
  coverageGood: 0.9,
  coverageAttention: 0.75,
  fairnessGood: 0.9,
  fairnessAttention: 0.8,
} as const;

export const MAX_REBALANCE_ITERATIONS = 200;
export const JAIN_TIE_EPS = 1e-9;
export const REBALANCE_IMPROVE_EPS = 1e-6;
export const FLOAT_TIE_EPS = 1e-12;
