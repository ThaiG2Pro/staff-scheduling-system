/**
 * @file Reusable accessible confirmation modal dialog (`ConfirmDialog`) for destructive
 * actions (Delete Schedule, Delete Staff, Delete Shift, Atomic Storage Reset).
 */

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  warningDetail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation modal with Escape-to-dismiss and optional cascade warning callout.
 *
 * @param props - Dialog visibility, copy, tone, and confirm/cancel callbacks.
 * @returns Modal overlay when `open` is true, otherwise `null`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  warningDetail,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  errorMessage = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClasses =
    tone === 'danger'
      ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600'
      : 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-600';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {tone === 'danger' && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-slate-700">{description}</p>

          {warningDetail && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              {warningDetail}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5 rounded-b-xl">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
