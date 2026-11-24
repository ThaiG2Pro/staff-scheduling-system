/**
 * @file Exact decimal ceiling division and Safe Integer arithmetic guards.
 * Provides `computeRequiredStaff` (BigInt fraction math), `sumSafeIntegers`,
 * and `validateTargetNInput` (round-trip IEEE-754 precision verification).
 */

import {
  DECIMAL_REGEX,
  MAX_SAFE_BIGINT,
  MAX_TARGET_N,
  MIN_TARGET_N,
  PLAIN_DECIMAL_INPUT_REGEX,
} from './constants';

export type MathError = 'INVALID_INPUT' | 'SAFE_INTEGER_OVERFLOW';

export type ComputeRequiredStaffResult =
  | { ok: true; value: number }
  | { ok: false; error: MathError };

export type TargetNValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** Checks whether N is finite and within [MIN_TARGET_N, MAX_TARGET_N]. */
export function isValidTargetN(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_TARGET_N && n <= MAX_TARGET_N;
}

/** Converts a non-negative BigInt to a safe JS number, returning SAFE_INTEGER_OVERFLOW on overflow. */
export function safeBigIntToNumber(
  value: bigint,
): { ok: true; value: number } | { ok: false; error: 'SAFE_INTEGER_OVERFLOW' } {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    return { ok: false, error: 'SAFE_INTEGER_OVERFLOW' };
  }
  return { ok: true, value: Number(value) };
}

/**
 * Sums non-negative safe integers using BigInt accumulation to prevent silent precision loss.
 *
 * @param values - Iterable of non-negative safe integers.
 * @returns `{ ok: true, value }` or `{ ok: false, error }` on invalid input or overflow.
 */
export function sumSafeIntegers(
  values: Iterable<number>,
): { ok: true; value: number } | { ok: false; error: MathError } {
  let acc = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v) || v < 0) {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    acc += BigInt(v);
    if (acc > MAX_SAFE_BIGINT) {
      return { ok: false, error: 'SAFE_INTEGER_OVERFLOW' };
    }
  }
  return { ok: true, value: Number(acc) };
}

/**
 * Computes `ceil(transactions / n)` with exact BigInt decimal arithmetic.
 * Avoids IEEE-754 floating-point drift (e.g. `21 / 1.4 === 15`, not `16`).
 *
 * @param transactions - Non-negative safe integer transaction count for one hour.
 * @param n - Positive finite target transactions per staff-hour.
 * @returns Required integer headcount or `INVALID_INPUT` / `SAFE_INTEGER_OVERFLOW`.
 */
export function computeRequiredStaff(
  transactions: number,
  n: number,
): ComputeRequiredStaffResult {
  if (
    !Number.isSafeInteger(transactions) ||
    transactions < 0 ||
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  if (transactions === 0) {
    return { ok: true, value: 0 };
  }

  const match = DECIMAL_REGEX.exec(n.toString());
  if (!match || match[1] === undefined) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const intPart = match[1];
  const fracPart = match[2] ?? '';
  const exponentPart = match[3] ? Number(match[3]) : 0;

  const digits = (intPart + fracPart).replace(/^0+/, '');
  if (!digits) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const mantissa = BigInt(digits);
  const exponent = exponentPart - fracPart.length;

  let num: bigint;
  let den: bigint;
  if (exponent < 0) {
    num = BigInt(transactions) * 10n ** BigInt(-exponent);
    den = mantissa;
  } else {
    num = BigInt(transactions);
    den = mantissa * 10n ** BigInt(exponent);
  }

  const ceilResult = (num + den - 1n) / den;
  if (ceilResult > MAX_SAFE_BIGINT) {
    return { ok: false, error: 'SAFE_INTEGER_OVERFLOW' };
  }

  return { ok: true, value: Number(ceilResult) };
}

/** Normalizes a decimal/scientific string into canonical plain decimal form, or null if invalid. */
export function toCanonicalPlainDecimal(raw: string): string | null {
  const match = DECIMAL_REGEX.exec(raw.trim());
  if (!match || match[1] === undefined) {
    return null;
  }

  const intPart = match[1];
  const fracPart = match[2] ?? '';
  const expPart = match[3] ? Number(match[3]) : 0;

  const combinedDigits = intPart + fracPart;
  if (!combinedDigits.replace(/^0+/, '')) {
    return '0';
  }

  const decimalPos = intPart.length + expPart;
  let result: string;
  if (decimalPos <= 0) {
    result = `0.${'0'.repeat(-decimalPos)}${combinedDigits}`;
  } else if (decimalPos >= combinedDigits.length) {
    result = `${combinedDigits}${'0'.repeat(decimalPos - combinedDigits.length)}`;
  } else {
    result = `${combinedDigits.slice(0, decimalPos)}.${combinedDigits.slice(decimalPos)}`;
  }

  const parts = result.split('.');
  const normInt = (parts[0] ?? '0').replace(/^0+/, '') || '0';
  const normFrac = (parts[1] ?? '').replace(/0+$/, '');
  return normFrac.length > 0 ? `${normInt}.${normFrac}` : normInt;
}

/**
 * Validates raw text input for Target N with range [1, 500] and strict
 * decimal round-trip verification against IEEE-754 precision loss.
 *
 * @param rawInput - Raw text entered by the Store Manager in TopActionBar.
 * @returns Validated numeric value or a user-facing inline error message.
 */
export function validateTargetNInput(rawInput: string): TargetNValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed || !PLAIN_DECIMAL_INPUT_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: `Enter a valid number between ${MIN_TARGET_N} and ${MAX_TARGET_N}.`,
    };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < MIN_TARGET_N || parsed > MAX_TARGET_N) {
    return {
      ok: false,
      error: `Target N must be between ${MIN_TARGET_N} and ${MAX_TARGET_N}.`,
    };
  }

  const canonicalInput = toCanonicalPlainDecimal(trimmed);
  const canonicalParsed = toCanonicalPlainDecimal(parsed.toString());
  if (canonicalInput === null || canonicalParsed === null || canonicalInput !== canonicalParsed) {
    return {
      ok: false,
      error: 'Value exceeds supported decimal precision.',
    };
  }

  return { ok: true, value: parsed };
}
