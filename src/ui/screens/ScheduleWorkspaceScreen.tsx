/**
 * @file Schedule Workspace Screen (`activeScheduleId !== null`) composing `TopActionBar`,
 * `ScheduleHealthBar`, `RecoveryBanner`, `ContextualBanners`, Tabbed Core View
 * (`WeeklyRosterGrid` | `AggregatedSummaryView`), sticky `StaffPanel`, and Prepare Modals.
 */

import { useState } from 'react';
import { BarChart3, CalendarDays } from 'lucide-react';
import type { AutoScheduleResult, DayOfWeek, OperatingHour, Schedule, Staff } from '../../domain/types';
import type { ScheduleStore } from '../../state/useScheduleStore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatTimestamp } from '../common/formatters';
import { CsvImportModal } from '../panels/CsvImportModal';
import { ManageShiftsModal } from '../panels/ManageShiftsModal';
import { StaffFormModal } from '../panels/StaffFormModal';
import { StaffPanel } from '../panels/StaffPanel';
import { WeeklyRosterGrid, type FocusedRosterSlot } from '../roster/WeeklyRosterGrid';
import { AggregatedSummaryView } from '../summary/AggregatedSummaryView';
import { ContextualBanners, type WorkspaceBannerState } from '../workspace/ContextualBanners';
import { RecoveryBanner } from '../workspace/RecoveryBanner';
import { ScheduleHealthBar } from '../workspace/ScheduleHealthBar';
import { TopActionBar } from '../workspace/TopActionBar';

export type WorkspaceTab = 'roster' | 'summary';

export interface ScheduleWorkspaceScreenProps {
  store: ScheduleStore;
  schedule: Schedule;
}

/**
 * Full interactive workspace for a single weekly store schedule.
 * Connects live derived metrics (`ScheduleHealthBar`, `AggregatedSummaryView`) with
 * direct roster editing (`WeeklyRosterGrid` + `AssignmentGuidancePopover`) and Prepare Flows.
 *
 * @param props - Active `ScheduleStore` and resolved active `Schedule`.
 * @returns Workspace layout.
 */
export function ScheduleWorkspaceScreen({ store, schedule }: ScheduleWorkspaceScreenProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('roster');
  const [highlightedStaffId, setHighlightedStaffId] = useState<string | null>(null);
  const [highlightedOverLimitOnly, setHighlightedOverLimitOnly] = useState(false);
  const [focusedSlot, setFocusedSlot] = useState<FocusedRosterSlot | null>(null);

  const [banner, setBanner] = useState<WorkspaceBannerState | null>(null);
  const [conflictAssignmentIds, setConflictAssignmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [newAutoAssignmentIds, setNewAutoAssignmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
    const beforeIds = new Set(schedule.assignments.map((a) => a.id));
    const beforeCov =
      viewModel?.health.demandCoverage?.ratio !== null &&
      viewModel?.health.demandCoverage?.ratio !== undefined
        ? Math.round(viewModel.health.demandCoverage.ratio * 100)
        : null;
    const beforeGaps = viewModel?.health.staffingGapCount ?? null;

    const actionRes = store.runAutoScheduleForSchedule(schedule.id);
    const result: AutoScheduleResult = actionRes.result;

    if (result.status === 'SUCCESS') {
      const addedIds = new Set(
        result.assignments.filter((a) => !beforeIds.has(a.id)).map((a) => a.id),
      );
      const afterCov =
        result.diagnostics.demandCoverage !== null
          ? Math.round(result.diagnostics.demandCoverage * 100)
          : null;

      setConflictAssignmentIds(new Set());
      setNewAutoAssignmentIds(addedIds);
      setActiveTab('roster');
      setBanner({
        kind: 'auto_review',
        beforeCoveragePct: beforeCov,
        afterCoveragePct: afterCov,
        beforeGaps,
        afterGaps: result.diagnostics.shortageHours === 0 ? 0 : null,
        diagnostics: result.diagnostics,
      });
      return;
    }

    if (result.status === 'BLOCKED_PIN_CONFLICT') {
      setBanner({ kind: 'pin_conflict', conflicts: result.conflicts });
      return;
    }

    setBanner({
      kind: 'notice',
      tone: 'warning',
      title: result.message,
    });
  };

  const handleRequestDeleteStaff = (member: Staff) => {
    const preview = store.previewDeleteStaff(schedule.id, member.id);
    setDeleteStaffTarget({ staff: member, affectedCount: preview.affectedAssignmentsCount });
  };

  const handleJumpToRosterCell = (day: DayOfWeek, hour: OperatingHour) => {
    setFocusedSlot({ day, hour });
    setActiveTab('roster');
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

      <main className="space-y-3.5 px-5 py-4">
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

        {viewModel && (
          <ScheduleHealthBar
            health={viewModel.health}
            onInspectGapsOrCoverage={() => setActiveTab('summary')}
            onInspectHourLimitWarnings={() => {
              setHighlightedStaffId(null);
              setHighlightedOverLimitOnly((prev) => !prev);
              setActiveTab('roster');
            }}
          />
        )}

        <ContextualBanners
          banner={
            banner?.kind === 'auto_review' && viewModel
              ? { ...banner, afterGaps: viewModel.health.staffingGapCount }
              : banner
          }
          onHighlightPinConflicts={(ids) => {
            setConflictAssignmentIds(new Set(ids));
            setActiveTab('roster');
          }}
          onKeepDraft={() => {
            setNewAutoAssignmentIds(new Set());
            setBanner(null);
          }}
          onDismiss={() => {
            setConflictAssignmentIds(new Set());
            setBanner(null);
          }}
        />

        {/* Main Split Workspace: Left ~75% Tabbed Core View, Right ~25% Sticky Team Panel */}
        <div className="flex min-h-0 items-start gap-4">
          <section className="min-w-0 flex-1 rounded-xl border border-slate-300/80 bg-white shadow-xs">
            {/* Tab Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 pt-2.5">
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

            {/* Active Tab Content */}
            {viewModel && activeTab === 'roster' && (
              <WeeklyRosterGrid
                shifts={schedule.shifts}
                staff={schedule.staff}
                assignments={schedule.assignments}
                summary={viewModel.summary}
                assignmentWarnings={viewModel.assignmentWarnings}
                unusedCapacityHours={viewModel.health.unusedCapacityHours}
                highlightedStaffId={highlightedStaffId}
                highlightedOverLimitOnly={highlightedOverLimitOnly}
                conflictAssignmentIds={conflictAssignmentIds}
                newAutoAssignmentIds={newAutoAssignmentIds}
                focusedSlot={focusedSlot}
                onClearFocus={() => setFocusedSlot(null)}
                onAssign={(day, shiftId, staffId) => {
                  store.assignStaffToShift(schedule.id, { day, shiftId, staffId });
                  setConflictAssignmentIds(new Set());
                }}
                onReassign={(assignmentId, newStaffId) => {
                  store.reassignStaff(schedule.id, assignmentId, newStaffId);
                  setConflictAssignmentIds(new Set());
                }}
                onTogglePin={(assignmentId) => {
                  store.togglePinAssignment(schedule.id, assignmentId);
                  setConflictAssignmentIds(new Set());
                }}
                onRemove={(assignmentId) => {
                  store.unassignStaff(schedule.id, assignmentId);
                  setConflictAssignmentIds(new Set());
                }}
                onOpenManageShifts={() => setShiftsModalOpen(true)}
              />
            )}

            {viewModel && activeTab === 'summary' && (
              <AggregatedSummaryView
                summary={viewModel.summary}
                targetN={schedule.targetTxnsPerStaffHour}
                onJumpToRosterCell={handleJumpToRosterCell}
              />
            )}
          </section>

          <StaffPanel
            staff={schedule.staff}
            staffMetrics={viewModel?.staffMetrics ?? {}}
            highlightedStaffId={highlightedStaffId}
            onSelectStaff={(staffId) => {
              setHighlightedOverLimitOnly(false);
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
            setBanner({
              kind: 'notice',
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
