/**
 * @file Schedule List Screen (`activeScheduleId === null`) with Empty State onboarding,
 * Create Schedule form, Load Demo Store action, and Open / Rename / Delete controls.
 */

import { useState, type FormEvent } from 'react';
import {
  CalendarRange,
  Check,
  Clock,
  FileSpreadsheet,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { ScheduleStore } from '../../state/useScheduleStore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatTimestamp } from '../common/formatters';
import { RecoveryBanner } from '../workspace/RecoveryBanner';

export interface ScheduleListScreenProps {
  store: ScheduleStore;
}

/**
 * Top-level screen listing all saved weekly schedules or presenting first-run onboarding.
 * Respects `storageMode !== 'normal'` by locking all write actions while showing `RecoveryBanner`.
 *
 * @param props - Active `ScheduleStore` instance.
 * @returns Schedule List screen layout.
 */
export function ScheduleListScreen({ store }: ScheduleListScreenProps) {
  const isLocked = store.storageMode !== 'normal';

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    const res = store.createSchedule(newName);
    if (!res.ok) {
      setCreateError(res.error);
      return;
    }
    setNewName('');
    setCreateError(null);
    setCreateOpen(false);
  };

  const handleRenameSubmit = (scheduleId: string) => {
    const res = store.renameSchedule(scheduleId, renameDraft);
    if (!res.ok) {
      setRenameError(res.error);
      return;
    }
    setRenamingId(null);
    setRenameError(null);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    store.deleteSchedule(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <div className="min-h-screen bg-[#E6ECF3] text-slate-900">
      <header className="border-b border-slate-300/80 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
              <CalendarRange className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Staff Scheduling System</h1>
              <p className="text-xs text-slate-600">
                Weekly store roster planner — demand-driven, local-first
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isLocked}
              onClick={() => store.loadDemoStore()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              Load Demo Store
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Schedule
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <RecoveryBanner
          storageMode={store.storageMode}
          saveStatus={store.saveStatus}
          storageErrorMessage={store.storageErrorMessage}
          hydrationWarnings={store.hydrationWarnings}
          onResetStorage={store.resetStorage}
          onRetryStorageAccess={store.retryStorageAccess}
        />

        {createOpen && !isLocked && (
          <form
            onSubmit={handleCreateSubmit}
            className="rounded-xl border border-indigo-300 bg-white p-4 shadow-xs"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1">
                <label
                  htmlFor="new-schedule-name"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Schedule Name
                </label>
                <input
                  id="new-schedule-name"
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (createError) setCreateError(null);
                  }}
                  placeholder="e.g. Week of Aug 10 – Store #12"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  Create Schedule
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    setNewName('');
                    setCreateError(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
            {createError && (
              <p role="alert" className="mt-2 text-sm text-rose-700">
                {createError}
              </p>
            )}
          </form>
        )}

        {store.scheduleListSummaries.length === 0 ? (
          <section className="rounded-xl border border-slate-300/80 bg-white px-8 py-14 text-center shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-indigo-600">
              <CalendarRange className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">
              {isLocked ? 'Schedules are temporarily unavailable' : 'No weekly schedules yet'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
              {isLocked
                ? 'Resolve the storage notice above to unlock schedule creation and editing.'
                : 'Start from a blank weekly schedule (seeded with 07:00–15:00 & 15:00–23:00 shifts) or explore instantly with a realistic Demo Store.'}
            </p>
            {!isLocked && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setCreateOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create Schedule
                </button>
                <button
                  type="button"
                  onClick={() => store.loadDemoStore()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                  Load Demo Store
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Your Schedules ({store.scheduleListSummaries.length})
              </h2>
            </div>

            <div className="grid gap-3">
              {store.scheduleListSummaries.map((item) => {
                const isRenaming = renamingId === item.id;
                return (
                  <article
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-300/80 bg-white px-5 py-4 shadow-xs transition hover:border-slate-400/90"
                  >
                    <div className="min-w-[260px] flex-1 space-y-1.5">
                      {isRenaming ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              aria-label="Rename schedule"
                              value={renameDraft}
                              onChange={(e) => {
                                setRenameDraft(e.target.value);
                                if (renameError) setRenameError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameSubmit(item.id);
                                if (e.key === 'Escape') {
                                  setRenamingId(null);
                                  setRenameError(null);
                                }
                              }}
                              className="w-72 rounded-lg border border-indigo-400 px-2.5 py-1 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameSubmit(item.id)}
                              aria-label="Save schedule name"
                              className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-700"
                            >
                              <Check className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(null);
                                setRenameError(null);
                              }}
                              aria-label="Cancel rename"
                              className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-100"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                          {renameError && (
                            <p role="alert" className="text-xs text-rose-700">
                              {renameError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <h3 className="text-base font-semibold text-slate-900">{item.name}</h3>
                      )}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                          {item.staffCount} staff
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                          {item.totalStaffHours}h scheduled
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                            item.hasDemand
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border border-slate-300 bg-slate-100 text-slate-700'
                          }`}
                        >
                          <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
                          {item.hasDemand ? 'Demand loaded' : 'No demand CSV'}
                        </span>
                        <span>Updated {formatTimestamp(item.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => store.setActiveSchedule(item.id)}
                        className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          setRenamingId(item.id);
                          setRenameDraft(item.name);
                          setRenameError(null);
                        }}
                        aria-label={`Rename ${item.name}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => setDeleteTarget({ id: item.id, name: item.name })}
                        aria-label={`Delete ${item.name}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.name ?? ''}"?`}
        description="This permanently removes the schedule, its staff roster, shift templates, demand data, and all assignments."
        confirmLabel="Delete Schedule"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
