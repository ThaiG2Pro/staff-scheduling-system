/**
 * @file Persistence metadata types, storage key constants, and 4-mode hydration contracts.
 * Separates Persistence/UI metadata (`schemaVersion`, `activeScheduleId`, `StorageMode`)
 * from pure domain models in `src/domain/types.ts`.
 */

import type { Schedule } from '../domain/types';

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const PRIMARY_STORAGE_KEY = 'staff_scheduler_state_v1';
export const RECOVERY_BACKUP_KEY = 'staff_scheduler_recovery_backup';

export type StorageMode =
  | 'normal'
  | 'recovery_locked'
  | 'incompatible_version_locked'
  | 'storage_unavailable_locked';

export type SaveStatus = 'saved' | 'save_error' | 'locked';

export interface PersistedAppState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  activeScheduleId: string | null;
  schedules: Schedule[];
}

export interface LoadStateResult {
  storageMode: StorageMode;
  saveStatus: SaveStatus;
  state: PersistedAppState;
  rawPayload: string | null;
  backupSaved: boolean;
  errorMessage: string | null;
  warnings: string[];
}

export type SaveStateResult =
  | { ok: true }
  | { ok: false; error: string };

export type ResetStorageResult =
  | { ok: true; state: PersistedAppState }
  | { ok: false; error: string };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Creates an empty persisted state at the current schema version. */
export function createEmptyPersistedState(): PersistedAppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeScheduleId: null,
    schedules: [],
  };
}
