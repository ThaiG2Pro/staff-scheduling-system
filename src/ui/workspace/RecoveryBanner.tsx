/**
 * @file Storage defense banner handling all 4 `StorageMode` states, `save_error` notices,
 * and orphaned-assignment hydration warnings with Atomic Reset confirmation.
 */

import { useState } from 'react';
import { AlertTriangle, Info, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react';
import type { SaveStatus, StorageMode } from '../../persistence/storageTypes';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface RecoveryBannerProps {
  storageMode: StorageMode;
  saveStatus: SaveStatus;
  storageErrorMessage: string | null;
  hydrationWarnings: string[];
  onResetStorage: () => { ok: boolean; error?: string };
  onRetryStorageAccess: () => void;
}

/**
 * Renders the appropriate storage lock, save error, or hydration warning banner.
 * Enforces the 4-mode contract: `recovery_locked` offers Atomic Reset; `storage_unavailable_locked`
 * offers Retry only (no Reset); `incompatible_version_locked` locks without overwrite.
 *
 * @param props - Current storage mode, save status, error message, warnings, and recovery callbacks.
 * @returns Banner element or `null` when storage is healthy with no warnings.
 */
export function RecoveryBanner({
  storageMode,
  saveStatus,
  storageErrorMessage,
  hydrationWarnings,
  onResetStorage,
  onRetryStorageAccess,
}: RecoveryBannerProps) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [warningsDismissed, setWarningsDismissed] = useState(false);

  const handleConfirmReset = () => {
    const result = onResetStorage();
    if (result.ok) {
      setResetError(null);
      setConfirmResetOpen(false);
    } else {
      setResetError(
        result.error ?? 'Failed to reset local storage. Previous data remains untouched.',
      );
    }
  };

  if (storageMode === 'recovery_locked') {
    return (
      <>
        <div
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-rose-900 shadow-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-rose-900">
                  Saved data could not be loaded — auto-save is locked
                </p>
                <p className="text-sm text-rose-800">
                  {storageErrorMessage ??
                    'Stored schedule data is corrupted or invalid. Your original data has not been overwritten.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setResetError(null);
                setConfirmResetOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Reset &amp; Start Fresh
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmResetOpen}
          title="Reset & Start Fresh?"
          description="This will replace the unreadable local storage data with a clean, empty workspace and re-enable auto-save."
          warningDetail="A best-effort backup of the raw payload was attempted under staff_scheduler_recovery_backup. This action only unlocks storage if writing the clean state succeeds."
          confirmLabel="Reset & Start Fresh"
          tone="danger"
          errorMessage={resetError}
          onConfirm={handleConfirmReset}
          onCancel={() => {
            setConfirmResetOpen(false);
            setResetError(null);
          }}
        />
      </>
    );
  }

  if (storageMode === 'incompatible_version_locked') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-amber-950 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-950">
              Incompatible newer data version — auto-save is locked
            </p>
            <p className="text-sm text-amber-900">
              {storageErrorMessage ??
                'Saved schedules were created by a newer version of this app. Editing and auto-save are disabled to protect your data from being overwritten.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (storageMode === 'storage_unavailable_locked') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-rose-900 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-rose-900">
                Browser local storage is unavailable — editing is locked
              </p>
              <p className="text-sm text-rose-800">
                {storageErrorMessage ??
                  'Unable to access window.localStorage. Check browser privacy or site storage permissions, then retry.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetryStorageAccess}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-sm font-medium text-rose-800 shadow-xs hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry Storage Access
          </button>
        </div>
      </div>
    );
  }

  if (saveStatus === 'save_error') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div className="text-sm">
            <span className="font-semibold">
              Unable to save locally — changes exist in memory only.
            </span>{' '}
            {storageErrorMessage && <span className="text-amber-900">{storageErrorMessage}</span>}
          </div>
        </div>
      </div>
    );
  }

  if (hydrationWarnings.length > 0 && !warningsDismissed) {
    return (
      <div
        role="status"
        className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800 shadow-xs"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="font-medium text-slate-900">Storage cleanup notice</p>
              <ul className="list-disc pl-4 text-slate-700">
                {hydrationWarnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWarningsDismissed(true)}
            aria-label="Dismiss notice"
            className="rounded-md p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
