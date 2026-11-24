/**
 * @file Shared dependency injection and discriminated-union result contracts for state actions.
 * Enables deterministic testing of timestamps (`nowIso`) and identifiers (`generateId`).
 */

import type { AutoScheduleResult, CsvParseError } from '../domain/types';
import type { PersistedAppState } from '../persistence/storageTypes';

export interface ActionDeps {
  nowIso: () => string;
  generateId: () => string;
}

export const DEFAULT_ACTION_DEPS: ActionDeps = {
  nowIso: () => new Date().toISOString(),
  generateId: () => crypto.randomUUID(),
};

export type StateActionResult<TExtra extends object = object> =
  | ({ ok: true; state: PersistedAppState; changed: boolean } & TExtra)
  | { ok: false; error: string };

export type CsvImportActionResult =
  | { ok: true; state: PersistedAppState; totalTransactions: number }
  | { ok: false; errors: CsvParseError[] };

export interface AutoScheduleActionResult {
  state: PersistedAppState;
  committed: boolean;
  result: AutoScheduleResult;
}
