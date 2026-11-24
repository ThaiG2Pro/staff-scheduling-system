/**
 * @file Add / Edit Staff modal with strictly 2 fields: Name and Max Weekly Hours (`AC-01`).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Staff } from '../../domain/types';

export interface StaffFormModalProps {
  open: boolean;
  editingStaff: Staff | null;
  onSubmit: (input: { name: string; maxWeeklyHours: number }) => { ok: boolean; error?: string };
  onClose: () => void;
}

/**
 * Modal form for creating or editing a store staff member.
 * Enforces strictly 2 domain inputs: `name` and non-negative safe integer `maxWeeklyHours`.
 *
 * @param props - Modal open state, optional staff being edited, and submit/close callbacks.
 * @returns Staff form modal when open, otherwise `null`.
 */
export function StaffFormModal({
  open,
  editingStaff,
  onSubmit,
  onClose,
}: StaffFormModalProps) {
  const [name, setName] = useState('');
  const [maxHoursRaw, setMaxHoursRaw] = useState('40');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingStaff?.name ?? '');
    setMaxHoursRaw(editingStaff ? String(editingStaff.maxWeeklyHours) : '40');
    setError(null);
  }, [open, editingStaff]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Staff name is required.');
      return;
    }

    const trimmedHours = maxHoursRaw.trim();
    if (!/^\d+$/.test(trimmedHours)) {
      setError('Max weekly hours must be a whole number (0 or greater).');
      return;
    }

    const parsedHours = Number(trimmedHours);
    if (!Number.isSafeInteger(parsedHours) || parsedHours < 0) {
      setError('Max weekly hours must be a valid non-negative integer.');
      return;
    }

    const res = onSubmit({ name: trimmedName, maxWeeklyHours: parsedHours });
    if (!res.ok) {
      setError(res.error ?? 'Unable to save staff member.');
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-form-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="staff-form-title" className="text-base font-semibold text-slate-900">
            {editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close staff modal"
            className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-4">
            <div>
              <label
                htmlFor="staff-name-input"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Staff Name
              </label>
              <input
                id="staff-name-input"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Jordan Lee"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="staff-max-hours-input"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Max Weekly Hours
              </label>
              <input
                id="staff-max-hours-input"
                type="text"
                inputMode="numeric"
                value={maxHoursRaw}
                onChange={(e) => {
                  setMaxHoursRaw(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="40"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <p className="mt-1 text-xs text-slate-600">
                Enter 0 for temporarily unavailable staff (excluded from Auto-schedule).
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
              >
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              {editingStaff ? 'Save Changes' : 'Add Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
