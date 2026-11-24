/**
 * @file Schedule Workspace App Shell (`activeScheduleId !== null`) composing `TopActionBar`,
 * `RecoveryBanner`, contextual feedback banners, Tabbed Core View (`Weekly Roster` | `Hourly Summary`),
 * sticky `StaffPanel`, and all Prepare Flow modals (`StaffFormModal`, `ManageShiftsModal`,
 * `CsvImportModal`, `ConfirmDialog`).
 */

import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Users,
  X,
} from 'lucide-react';
import type { AutoScheduleResult, Schedule, Staff } from '../../domain/types';
import type { ScheduleStore } from '../../state/useScheduleStore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatShiftRange, formatTimestamp } from '../common/formatters';
import { CsvImportModal } from '../panels/CsvImportModal';
import { ManageShiftsModal } from '../panels/ManageShiftsModal';
import { StaffFormModal } from '../panels/StaffFormModal';
import { StaffPanel } from '../panels/StaffPanel';
import { RecoveryBanner } from '../workspace/RecoveryBanner';
import { TopActionBar } from '../workspace/TopActionBar';

export type WorkspaceTab = 'roster' | 'summary';

export interface ScheduleWorkspaceScreenProps {
  store: ScheduleStore;
  schedule: Schedule;
}

interface FeedbackNotice {
  tone: 'success' | 'warning' | 'error';
  title: string;
  details?: string[];
}

/**
 * Main workspace screen for editing and optimizing a single weekly store schedule.
 * Hosts all Slice 3 Prepare Flows and provides clean tab slots for Slice 4's Roster & Summary grids.
 *
 * @param props - Active `ScheduleStore` and resolved active `Schedule`.
 * @returns Workspace layout.
 */
export function ScheduleWorkspaceScreen({ store, schedule }: ScheduleWorkspaceScreenProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('roster');
  const [highlightedStaffId, setHighlightedStaffId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackNotice | null>(null);

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [shiftsModalOpen, setShiftsModalOpen] = useState(false);
  const [staffModalState, setStaffModalState] = useState<{
    open: boolean;
    editing: Staff | null;
  }>({ open: false, editing: null });

  const [deleteStaffTarget, setDeleteStaffTarget] = useState<{
    staff: Staff;
    affectedCount: number;
  } | null>(null);

  const [deleteScheduleOpen, setDeleteScheduleOpen] = useState(false);

  const vmResult = store.activeViewModelResult;
  const viewModel = vmResult && vmResult.ok ? vmResult.viewModel : null;

  const handleRunAutoSchedule = () => {
    const actionRes = store.runAutoScheduleForSchedule(schedule.id);
    const result: AutoScheduleResult = actionRes.result;

    if (result.status === 'SUCCESS') {
      const covPct =
        result.diagnostics.demandCoverage !== null
          ? `${Math.round(result.diagnostics.demandCoverage * 100)}%`
          : '–';
      setFeedback({
        tone: 'success',
        title: `Auto-schedule completed: ${result.diagnostics.generatedAssignmentsCount} new shift(s) assigned, ${result.diagnostics.preservedPinnedCount} pinned preserved (Demand Coverage ${covPct}).`,
        details: result.diagnostics.summaryMessages,
      });
      return;
    }

    if (result.status === 'BLOCKED_PIN_CONFLICT') {
      setFeedback({
        tone: 'error',
        title: 'Auto-schedule blocked due to conflicting pinned shifts.',
        details: result.conflicts.map((c) => `${c.staffName}: ${c.details}`),
      });
      return;
    }

    setFeedback({
      tone: 'warning',
      title: result.message,
    });
  };

  const handleRequestDeleteStaff = (member: Staff) => {
    const preview = store.previewDeleteStaff(schedule.id, member.id);
    setDeleteStaffTarget({ staff: member, affectedCount: preview.affectedAssignmentsCount });
  };

  return (
    <div className="min-h-screen bg-[#E6ECF3] text-slate-900">
      <TopActionBar
        scheduleName={schedule.name}
        targetN={schedule.targetTxnsPerStaffHour}
        saveStatus={store.saveStatus}
        missingInputs={viewModel?.autoScheduleMissingInputs ?? []}
        onBack={() => store.setActiveSchedule(null)}
        onRename={(nextName) => store.renameSchedule(schedule.id, nextName)}
        onChangeTargetN={(nextN) => store.setTargetTxnsPerStaffHour(schedule.id, nextN)}
        onOpenCsvImport={() => setCsvModalOpen(true)}
        onOpenManageShifts={() => setShiftsModalOpen(true)}
        onRunAutoSchedule={handleRunAutoSchedule}
        onRequestDeleteSchedule={() => setDeleteScheduleOpen(true)}
      />

      <main className="space-y-4 px-5 py-4">
        <RecoveryBanner
          storageMode={store.storageMode}
          saveStatus={store.saveStatus}
          storageErrorMessage={store.storageErrorMessage}
          hydrationWarnings={store.hydrationWarnings}
          onResetStorage={store.resetStorage}
          onRetryStorageAccess={store.retryStorageAccess}
        />

        {vmResult && !vmResult.ok && (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            <strong>Metrics unavailable:</strong> {vmResult.message}
          </div>
        )}

        {feedback && (
          <div
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-sm shadow-xs ${
              feedback.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : feedback.tone === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-rose-300 bg-rose-50 text-rose-900'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {feedback.tone === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <div className="space-y-1">
                  <p className="font-medium">{feedback.title}</p>
                  {feedback.details && feedback.details.length > 0 && (
                    <ul className="list-disc pl-4 text-xs opacity-90">
                      {feedback.details.map((line, idx) => (
                        <li key={idx}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                aria-label="Dismiss notification"
                className="rounded-md p-1 opacity-75 hover:bg-black/5 hover:opacity-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Main Split Workspace: Left ~75% Tabbed Core View, Right ~25% Sticky Team Panel */}
        <div className="flex min-h-0 items-start gap-4">
          <section className="min-w-0 flex-1 rounded-xl border border-slate-300/80 bg-white shadow-xs">
            {/* Tab Bar */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 pt-2.5">
              <div className="flex items-center gap-1" role="tablist" aria-label="Workspace views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'roster'}
                  onClick={() => setActiveTab('roster')}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition ${
                    activeTab === 'roster'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Weekly Roster
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'summary'}
                  onClick={() => setActiveTab('summary')}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition ${
                    activeTab === 'summary'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  Hourly Summary (7×16)
                </button>
              </div>

              <div className="pb-2 text-xs text-slate-600">
                {schedule.demand
                  ? `Demand: ${schedule.demand.sourceFileName ?? 'Imported CSV'} (${formatTimestamp(
                      schedule.demand.importedAt,
                    )})`
                  : 'No demand CSV imported yet'}
              </div>
            </div>

            {/* Slice 3 Workspace Preview Slot (replaced by full Roster & Summary grids in T4) */}
            <div className="p-5">
              {activeTab === 'roster' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                        Demand Dataset
                      </div>
                      <p className="mt-1.5 text-lg font-semibold text-slate-900">
                        {viewModel?.summary.totalTransactions !== null &&
                        viewModel?.summary.totalTransactions !== undefined
                          ? `${viewModel.summary.totalTransactions.toLocaleString()} txns`
                          : 'Not imported'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <Clock className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                        Shift Templates
                      </div>
                      <p className="mt-1.5 text-lg font-semibold text-slate-900">
                        {schedule.shifts.length} active
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {schedule.shifts
                          .map((s) => formatShiftRange(s.startHour, s.endHour))
                          .join(', ') || 'None configured'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <Users className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                        Assignments
                      </div>
                      <p className="mt-1.5 text-lg font-semibold text-slate-900">
                        {schedule.assignments.length} shifts ·{' '}
                        {viewModel?.summary.totalStaffHours ?? 0}h
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-5 py-8 text-center">
                    <p className="text-sm font-medium text-slate-800">
                      Weekly Roster Grid ready for Slice 4 (`T4`)
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Use Import CSV, Shifts, Target N, Team Panel, and Auto-schedule above to
                      prepare schedule inputs and verify live persistence.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-slate-800">
                    Hourly Summary (7×16) Grid ready for Slice 4 (`T4`)
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Total Transactions:{' '}
                    <strong>{viewModel?.summary.totalTransactions ?? '–'}</strong> · Total Staff
                    Hours: <strong>{viewModel?.summary.totalStaffHours ?? 0}h</strong>
                  </p>
                </div>
              )}
            </div>
          </section>

          <StaffPanel
            staff={schedule.staff}
            staffMetrics={viewModel?.staffMetrics ?? {}}
            highlightedStaffId={highlightedStaffId}
            onSelectStaff={(staffId) => {
              setHighlightedStaffId(staffId);
              if (staffId) setActiveTab('roster');
            }}
            onAddStaff={() => setStaffModalState({ open: true, editing: null })}
            onEditStaff={(member) => setStaffModalState({ open: true, editing: member })}
            onRequestDeleteStaff={handleRequestDeleteStaff}
          />
        </div>
      </main>

      {/* Prepare Flow Modals */}
      <StaffFormModal
        open={staffModalState.open}
        editingStaff={staffModalState.editing}
        onSubmit={(input) => {
          if (staffModalState.editing) {
            return store.updateStaff(schedule.id, staffModalState.editing.id, input);
          }
          return store.addStaff(schedule.id, input);
        }}
        onClose={() => setStaffModalState({ open: false, editing: null })}
      />

      <ManageShiftsModal
        open={shiftsModalOpen}
        shifts={schedule.shifts}
        onAddShift={(input) => store.addShiftTemplate(schedule.id, input)}
        onPreviewEditShift={(shiftId) => store.previewEditShift(schedule.id, shiftId)}
        onUpdateShift={(shiftId, input) => store.updateShiftTemplate(schedule.id, shiftId, input)}
        onPreviewDeleteShift={(shiftId) => store.previewDeleteShift(schedule.id, shiftId)}
        onDeleteShift={(shiftId) => store.deleteShiftTemplate(schedule.id, shiftId)}
        onClose={() => setShiftsModalOpen(false)}
      />

      <CsvImportModal
        open={csvModalOpen}
        hasExistingDemand={schedule.demand !== null}
        onImport={(csvText, sourceFileName) => {
          const res = store.importCsvToSchedule(schedule.id, csvText, sourceFileName);
          if (res.ok) {
            setFeedback({
              tone: 'success',
              title: `Imported ${res.totalTransactions.toLocaleString()} weekly transactions from "${
                sourceFileName ?? 'CSV'
              }" (normalized to Mon–Sun).`,
            });
          }
          return res;
        }}
        onClose={() => setCsvModalOpen(false)}
      />

      <ConfirmDialog
        open={deleteStaffTarget !== null}
        title={`Remove "${deleteStaffTarget?.staff.name ?? ''}"?`}
        description="This removes the staff member from this weekly schedule."
        warningDetail={
          deleteStaffTarget && deleteStaffTarget.affectedCount > 0
            ? `This staff member currently has ${deleteStaffTarget.affectedCount} assigned shift${
                deleteStaffTarget.affectedCount === 1 ? '' : 's'
              } that will also be removed.`
            : undefined
        }
        confirmLabel="Delete Staff"
        tone="danger"
        onConfirm={() => {
          if (!deleteStaffTarget) return;
          store.deleteStaff(schedule.id, deleteStaffTarget.staff.id);
          if (highlightedStaffId === deleteStaffTarget.staff.id) {
            setHighlightedStaffId(null);
          }
          setDeleteStaffTarget(null);
        }}
        onCancel={() => setDeleteStaffTarget(null)}
      />

      <ConfirmDialog
        open={deleteScheduleOpen}
        title={`Delete "${schedule.name}"?`}
        description="This permanently deletes the schedule, staff roster, shift templates, demand data, and all assignments."
        confirmLabel="Delete Schedule"
        tone="danger"
        onConfirm={() => {
          store.deleteSchedule(schedule.id);
          setDeleteScheduleOpen(false);
        }}
        onCancel={() => setDeleteScheduleOpen(false)}
      />
    </div>
  );
}
