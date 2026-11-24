import { describe, expect, it } from 'vitest';
import { DECIMAL_REGEX } from '../domain/constants';
import {
  computeRequiredStaff,
  isValidTargetN,
  sumSafeIntegers,
  validateTargetNInput,
} from '../domain/decimalMath';

describe('decimalMath (T-01, T-02, AC-03)', () => {
  it('T-01: computes exact RequiredStaff for standard N=15 boundary values (AC-03)', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [15, 1],
      [16, 2],
      [30, 2],
      [31, 3],
    ];

    for (const [txns, expected] of cases) {
      const res = computeRequiredStaff(txns, 15);
      expect(res).toEqual({ ok: true, value: expected });
    }
  });

  it('T-02: prevents IEEE-754 drift on decimal N, verifies DECIMAL_REGEX capture groups, overflow & round-trip (AC-03)', () => {
    // Exact integer ratios that IEEE-754 Math.ceil(21 / 1.4) gets wrong (15.000000000000002 -> 16)
    expect(computeRequiredStaff(21, 1.4)).toEqual({ ok: true, value: 15 });
    expect(computeRequiredStaff(42, 2.8)).toEqual({ ok: true, value: 15 });
    // Strict boundary just below 1.4 must ceiling to 16 (no arbitrary epsilon!)
    expect(computeRequiredStaff(21, 1.399999999999999)).toEqual({ ok: true, value: 16 });
    expect(computeRequiredStaff(25, 12.5)).toEqual({ ok: true, value: 2 });
    expect(computeRequiredStaff(26, 12.5)).toEqual({ ok: true, value: 3 });

    // DECIMAL_REGEX capture groups smoke tests (design.md §3.2)
    expect(DECIMAL_REGEX.test('1.4')).toBe(true);
    expect(DECIMAL_REGEX.exec('1.4')?.slice(1, 4)).toEqual(['1', '4', undefined]);
    expect(DECIMAL_REGEX.exec('1.5e-7')?.slice(1, 4)).toEqual(['1', '5', '-7']);
    expect(DECIMAL_REGEX.exec('1.5e+21')?.slice(1, 4)).toEqual(['1', '5', '+21']);

    // Very small decimal N causing SAFE_INTEGER_OVERFLOW
    expect(computeRequiredStaff(Number.MAX_SAFE_INTEGER, 0.5)).toEqual({
      ok: false,
      error: 'SAFE_INTEGER_OVERFLOW',
    });
    expect(computeRequiredStaff(100, 1e-20)).toEqual({
      ok: false,
      error: 'SAFE_INTEGER_OVERFLOW',
    });

    // Invalid inputs
    expect(computeRequiredStaff(-1, 15)).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(computeRequiredStaff(1.5, 15)).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(computeRequiredStaff(10, 0)).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(computeRequiredStaff(10, -5)).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(computeRequiredStaff(10, Number.NaN)).toEqual({ ok: false, error: 'INVALID_INPUT' });

    // Round-trip Target N text validation (design.md §3.3)
    expect(validateTargetNInput('15')).toEqual({ ok: true, value: 15 });
    expect(validateTargetNInput('12.5')).toEqual({ ok: true, value: 12.5 });
    expect(validateTargetNInput('1.4')).toEqual({ ok: true, value: 1.4 });
    expect(validateTargetNInput(' 015.50 ')).toEqual({ ok: true, value: 15.5 });
    expect(validateTargetNInput('1')).toEqual({ ok: true, value: 1 });
    expect(validateTargetNInput('500')).toEqual({ ok: true, value: 500 });

    // Rejects precision-loss decimal string
    const precisionLoss = validateTargetNInput('1.0000000000000001');
    expect(precisionLoss.ok).toBe(false);

    // Rejects out-of-range and non-numeric strings
    expect(validateTargetNInput('0.9').ok).toBe(false);
    expect(validateTargetNInput('500.1').ok).toBe(false);
    expect(validateTargetNInput('abc').ok).toBe(false);
    expect(validateTargetNInput('').ok).toBe(false);

    // isValidTargetN & sumSafeIntegers
    expect(isValidTargetN(15)).toBe(true);
    expect(isValidTargetN(0.5)).toBe(false);
    expect(isValidTargetN(501)).toBe(false);
    expect(sumSafeIntegers([Number.MAX_SAFE_INTEGER, 1])).toEqual({
      ok: false,
      error: 'SAFE_INTEGER_OVERFLOW',
    });
    expect(sumSafeIntegers([10, 20, 30])).toEqual({ ok: true, value: 60 });
  });

  it('QA-E1: rejects scientific notation, Infinity, negative, and malformed decimal strings in validateTargetNInput', () => {
    for (const raw of ['1e1', '1.5e2', 'Infinity', '-15', '15.', '.5', '+15', 'NaN']) {
      expect(validateTargetNInput(raw).ok).toBe(false);
    }
  });
});
