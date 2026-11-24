/**
 * @file Defensive LocalStorage persistence adapter with 4 storage modes and Atomic Reset Contract.
 * Wraps every `localStorage` access, read, write, and best-effort recovery backup in `try/catch`
 * so corrupted payloads, future schema versions, or restricted storage never crash or silently overwrite data.
 */

import { validatePersistedState } from './storageSchema';
import {
  CURRENT_SCHEMA_VERSION,
  PRIMARY_STORAGE_KEY,
  RECOVERY_BACKUP_KEY,
  createEmptyPersistedState,
  type LoadStateResult,
  type PersistedAppState,
  type ResetStorageResult,
  type SaveStateResult,
  type StorageLike,
} from './storageTypes';

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function tryResolveStorage(
  getStorage: () => StorageLike | null,
): { ok: true; storage: StorageLike } | { ok: false; error: string } {
  try {
    const storage = getStorage();
    if (!storage) {
      return { ok: false, error: 'Browser LocalStorage is unavailable in this environment.' };
    }
    return { ok: true, storage };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unable to access LocalStorage: ${detail}` };
  }
}

function trySaveRecoveryBackup(storage: StorageLike, rawPayload: string): boolean {
  try {
    storage.setItem(RECOVERY_BACKUP_KEY, rawPayload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads and validates application state from `localStorage` once at bootstrap (outside React StrictMode).
 * Never overwrites corrupt or future-version payloads on load.
 *
 * @param getStorage - Optional storage resolver for deterministic testing (defaults to `window.localStorage`).
 * @returns `LoadStateResult` describing the resolved `storageMode`, `saveStatus`, and state.
 */
export function loadState(
  getStorage: () => StorageLike | null = getBrowserLocalStorage,
): LoadStateResult {
  const emptyState = createEmptyPersistedState();
  const storageRes = tryResolveStorage(getStorage);
  if (!storageRes.ok) {
    return {
      storageMode: 'storage_unavailable_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: null,
      backupSaved: false,
      errorMessage: storageRes.error,
      warnings: [],
    };
  }

  let raw: string | null;
  try {
    raw = storageRes.storage.getItem(PRIMARY_STORAGE_KEY);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      storageMode: 'storage_unavailable_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: null,
      backupSaved: false,
      errorMessage: `Unable to read from LocalStorage: ${detail}`,
      warnings: [],
    };
  }

  // Only strict `null` represents a clean first-launch state; empty string `""` is corrupt.
  if (raw === null) {
    return {
      storageMode: 'normal',
      saveStatus: 'saved',
      state: emptyState,
      rawPayload: null,
      backupSaved: false,
      errorMessage: null,
      warnings: [],
    };
  }

  if (raw === '') {
    const backupSaved = trySaveRecoveryBackup(storageRes.storage, raw);
    return {
      storageMode: 'recovery_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: raw,
      backupSaved,
      errorMessage: 'Saved data is empty and cannot be loaded safely.',
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const backupSaved = trySaveRecoveryBackup(storageRes.storage, raw);
    return {
      storageMode: 'recovery_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: raw,
      backupSaved,
      errorMessage: `Saved data contains invalid JSON: ${detail}`,
      warnings: [],
    };
  }

  const validation = validatePersistedState(parsed);

  if (validation.kind === 'INCOMPATIBLE_VERSION') {
    return {
      storageMode: 'incompatible_version_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: raw,
      backupSaved: false,
      errorMessage: validation.message,
      warnings: [],
    };
  }

  if (validation.kind === 'CORRUPT_SCHEMA') {
    const backupSaved = trySaveRecoveryBackup(storageRes.storage, raw);
    return {
      storageMode: 'recovery_locked',
      saveStatus: 'locked',
      state: emptyState,
      rawPayload: raw,
      backupSaved,
      errorMessage: validation.message,
      warnings: [],
    };
  }

  return {
    storageMode: 'normal',
    saveStatus: 'saved',
    state: validation.state,
    rawPayload: null,
    backupSaved: false,
    errorMessage: null,
    warnings: validation.warnings,
  };
}

/**
 * Serializes and writes only Source of Truth + Persistence Metadata (`PersistedAppState`)
 * to `PRIMARY_STORAGE_KEY`. Never throws on quota or security errors.
 *
 * @param state - Current persisted application state (must contain no derived state).
 * @param getStorage - Optional storage resolver for testing.
 * @returns `{ ok: true }` on success or `{ ok: false, error }` on write failure.
 */
export function saveState(
  state: Readonly<PersistedAppState>,
  getStorage: () => StorageLike | null = getBrowserLocalStorage,
): SaveStateResult {
  const storageRes = tryResolveStorage(getStorage);
  if (!storageRes.ok) {
    return { ok: false, error: storageRes.error };
  }

  const payload: PersistedAppState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeScheduleId: state.activeScheduleId,
    schedules: state.schedules,
  };

  try {
    storageRes.storage.setItem(PRIMARY_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Unable to save locally: ${detail}` };
  }
}

/**
 * Implements the Atomic Reset Contract for "Reset & Start Fresh":
 * writes a clean v1 payload to `PRIMARY_STORAGE_KEY` and reports success only if `setItem` succeeds.
 *
 * @param getStorage - Optional storage resolver for testing.
 * @returns `{ ok: true, state }` if reset persisted cleanly, or `{ ok: false, error }` so caller stays locked.
 */
export function resetStorageAtomic(
  getStorage: () => StorageLike | null = getBrowserLocalStorage,
): ResetStorageResult {
  const cleanState = createEmptyPersistedState();
  const writeRes = saveState(cleanState, getStorage);
  if (!writeRes.ok) {
    return { ok: false, error: writeRes.error };
  }
  return { ok: true, state: cleanState };
}
