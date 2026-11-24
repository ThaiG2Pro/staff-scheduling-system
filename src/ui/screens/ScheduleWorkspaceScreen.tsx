/**
 * @file Schedule Workspace Screen (`activeScheduleId !== null`) composing `TopActionBar`,
 * `ScheduleHealthBar`, `RecoveryBanner`, `ContextualBanners`, Tabbed Core View
 * (`WeeklyRosterGrid` | `AggregatedSummaryView`), sticky `StaffPanel`, Floating Undo Toast
 * (`Ctrl+Z`), and Prepare Modals.
 */

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, CalendarDays, PanelRightClose, PanelRightOpen, RotateCcw, X } from 'lucide-react';
import type {
  Assignment,
  AutoScheduleResult,
  DayOfWeek,
  OperatingHour,
  Schedule,
  Staff,
} from '../../domain/types';
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

interface UndoEntry {
  label: string;
  snapshot: Assignment[];
}

/**
 * Full interactive workspace for a single weekly store schedule.
 * Connects live derived metrics (`ScheduleHealthBar`, `AggregatedSummaryView`), direct roster
 * editing (`WeeklyRosterGrid` + `AssignmentGuidancePopover`), in-memory Undo Toast (`Ctrl+Z`),
 * and Prepare Flows in a responsive, zero-clipping layout.
 *
 * @param props - Active `ScheduleStore` and resolved active `Schedule`.
 * @returns Workspace layout.
 */
export function ScheduleWorkspaceScreen({ store, schedule }: ScheduleWorkspaceScreenProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('roster');
  const [teamPanelOpen, setTeamPanelOpen] = useState(true);
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

  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [toastLabel, setToastLabel] = useState<string | null>(null);

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

  const pushUndo = useCallback(
    (label: string) => {
      const snapshot = schedule.assignments.map((a) => ({ ...a }));
      setUndoStack((prev) => [...prev.slice(-19), { label, snapshot }]);
      setToastLabel(label);
    },
    [schedule.assignments],
  );

  const performUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1]!;
    store.restoreAssignments(schedule.id, last.snapshot);
    setUndoStack((prev) => prev.slice(0, -1));
    setNewAutoAssignmentIds(new Set());
    setConflictAssignmentIds(new Set());
    setBanner((cur) => (cur?.kind === 'auto_review' ? null : cur));
    setToastLabel(null);
  }, [schedule.id, store, undoStack]);

  // Auto-dismiss Undo Toast after 5 seconds
  useEffect(() => {
    if (!toastLabel) return;
    const timer = window.setTimeout(() => setToastLabel(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toastLabel]);

  // Global Ctrl+Z / Cmd+Z keyboard shortcut when not typing in an input
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (undoStack.length > 0) {
          event.preventDefault();
          performUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack.length, performUndo]);

  const handleRunAutoSchedule = () => {
    const beforeSnapshot = schedule.assignments.map((a) => ({ ...a }));
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

      setUndoStack((prev) => [
        ...prev.slice(-19),
        { label: 'Auto-schedule applied', snapshot: beforeSnapshot },
      ]);
      setToastLabel('Auto-schedule applied');
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

  const highlightedStaffName = highlightedStaffId
    ? schedule.staff.find((s) => s.id === highlightedStaffId)?.name ?? null
    : null;

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

      <main className="mx-auto w-full max-w-[1680px] space-y-3.5 px-4 py-4 sm:px-5">
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
          canUndoAutoSchedule={undoStack.length > 0}
          onUndoAutoSchedule={performUndo}
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

        {/* Responsive Split Workspace: stacks cleanly below lg, side-by-side on desktop */}
        <div className="flex min-h-0 flex-col items-start gap-4 lg:flex-row">
          <section className="w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-300/80 bg-white shadow-xs">
            {/* Sub-header Tabs & Roster Legend */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
              <div
                className="inline-flex items-center gap-1 rounded-lg bg-slate-200/80 p-0.5"
                role="tablist"
                aria-label="Workspace views"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'roster'}
                  onClick={() => setActiveTab('roster')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'roster'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  Weekly Roster
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'summary'}
                  onClick={() => setActiveTab('summary')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'summary'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Hourly Summary (7×16)
                </button>
              </div>

              {activeTab === 'roster' ? (
                <div className="flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5 text-[11px] font-medium text-slate-700">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-3.5 w-1.5 rounded-full bg-indigo-600" aria-hidden="true" />
                    Pinned
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-3.5 w-1.5 rounded-full bg-amber-600" aria-hidden="true" />
                    2+ shifts / overlap
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="rounded border border-rose-300 bg-rose-100 px-1 py-0.2 text-[9px] font-bold text-rose-800">
                      OT
                    </span>
                    Over weekly cap
                  </span>
                  {highlightedStaffName && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-100 px-2.5 py-0.5 font-semibold text-indigo-900">
                      Showing {highlightedStaffName}
                      <button
                        type="button"
                        onClick={() => setHighlightedStaffId(null)}
                        aria-label="Clear staff highlight"
                        className="ml-0.5 hover:text-indigo-950"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setTeamPanelOpen((prev) => !prev)}
                    title={teamPanelOpen ? 'Hide Team panel to expand roster' : 'Show Team panel'}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {teamPanelOpen ? (
                      <>
                        <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                        Hide Team
                      </>
                    ) : (
                      <>
                        <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        Team ({schedule.staff.length})
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-xs text-slate-600">
                  {schedule.demand
                    ? `Demand: ${schedule.demand.sourceFileName ?? 'Imported CSV'} (${formatTimestamp(
                        schedule.demand.importedAt,
                      )})`
                    : 'No demand CSV imported yet'}
                </div>
              )}
            </div>

            {/* Active Tab Content */}
            {viewModel && activeTab === 'roster' && (
              <WeeklyRosterGrid
                shifts={schedule.shifts}
                staff={schedule.staff}
                assignments={schedule.assignments}
                hasDemand={schedule.demand !== null}
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
                  const memberName =
                    schedule.staff.find((s) => s.id === staffId)?.name ?? 'Staff';
                  pushUndo(`Assigned ${memberName}`);
                  store.assignStaffToShift(schedule.id, { day, shiftId, staffId });
                  setConflictAssignmentIds(new Set());
                }}
                onReassign={(assignmentId, newStaffId) => {
                  const memberName =
                    schedule.staff.find((s) => s.id === newStaffId)?.name ?? 'Staff';
                  pushUndo(`Reassigned shift to ${memberName}`);
                  store.reassignStaff(schedule.id, assignmentId, newStaffId);
                  setConflictAssignmentIds(new Set());
                }}
                onTogglePin={(assignmentId) => {
                  pushUndo('Updated shift pin');
                  store.togglePinAssignment(schedule.id, assignmentId);
                  setConflictAssignmentIds(new Set());
                }}
                onRemove={(assignmentId) => {
                  const existing = schedule.assignments.find((a) => a.id === assignmentId);
                  const memberName = existing
                    ? schedule.staff.find((s) => s.id === existing.staffId)?.name ?? 'Staff'
                    : 'Staff';
                  pushUndo(`Removed ${memberName} from shift`);
                  store.unassignStaff(schedule.id, assignmentId);
                  setConflictAssignmentIds(new Set());
                }}
                onOpenManageShifts={() => setShiftsModalOpen(true)}
                onOpenCsvImport={() => setCsvModalOpen(true)}
                onOpenAddStaff={() => setStaffModalState({ open: true, editing: null })}
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

          {teamPanelOpen && (
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
          )}
        </div>
      </main>

      {/* Floating Undo Toast (5s auto-dismiss + Ctrl+Z) */}
      {toastLabel && undoStack.length > 0 && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs text-white shadow-2xl"
        >
          <span className="font-medium text-slate-100">{toastLabel}</span>
          <button
            type="button"
            onClick={performUndo}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 font-semibold text-white transition hover:bg-indigo-400"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Undo
          </button>
          <span className="hidden text-[10px] text-slate-300 sm:inline">Ctrl+Z</span>
          <button
            type="button"
            onClick={() => setToastLabel(null)}
            aria-label="Dismiss undo toast"
            className="p-0.5 text-slate-300 transition hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

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
