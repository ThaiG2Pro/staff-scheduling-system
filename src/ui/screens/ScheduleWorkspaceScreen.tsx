/**
 * @file Schedule Workspace Screen (`activeScheduleId !== null`) composing `TopActionBar`,
 * `ScheduleHealthBar`, `RecoveryBanner`, `ContextualBanners`, Tabbed Core View
 * (`WeeklyRosterGrid` | `AggregatedSummaryView`), sticky `StaffPanel`, Floating Undo Toast
 * (`Ctrl+Z`), and Prepare Modals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  RotateCcw,
  Scale,
  X,
} from 'lucide-react';
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
import {
  SIMULATOR_BRIDGE_PROTOCOL_VERSION,
  openScheduleInSimulator,
  type SimulatorScheduleSnapshot,
} from '../common/simulatorBridge';
import { CsvImportModal } from '../panels/CsvImportModal';
import { ManageShiftsModal } from '../panels/ManageShiftsModal';
import { StaffFormModal } from '../panels/StaffFormModal';
import { StaffImportModal } from '../panels/StaffImportModal';
import { StaffPanel, type StaffFilterMode, type StaffSortMode } from '../panels/StaffPanel';
import { WeeklyRosterGrid, type FocusedRosterSlot } from '../roster/WeeklyRosterGrid';
import {
  AggregatedSummaryView,
  type FocusedSummaryTarget,
  type SummaryViewMode,
} from '../summary/AggregatedSummaryView';
import { ContextualBanners, type WorkspaceBannerState } from '../workspace/ContextualBanners';
import { RecoveryBanner } from '../workspace/RecoveryBanner';
import { ScheduleHealthBar, type ActiveKpiLens } from '../workspace/ScheduleHealthBar';
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
  const [teamFilterMode, setTeamFilterMode] = useState<StaffFilterMode>('all');
  const [teamSortMode, setTeamSortMode] = useState<StaffSortMode>('name');
  const [highlightedStaffId, setHighlightedStaffId] = useState<string | null>(null);
  const [activeKpiLens, setActiveKpiLens] = useState<ActiveKpiLens>(null);
  const [focusedSlot, setFocusedSlot] = useState<FocusedRosterSlot | null>(null);
  const [focusedSummaryTarget, setFocusedSummaryTarget] =
    useState<FocusedSummaryTarget | null>(null);
  const [summaryViewMode, setSummaryViewMode] = useState<SummaryViewMode>('metrics');

  const [banner, setBanner] = useState<WorkspaceBannerState | null>(null);
  const [conflictAssignmentIds, setConflictAssignmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [newAutoAssignmentIds, setNewAutoAssignmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [toastLabel, setToastLabel] = useState<string | null>(null);
  const [lastAutoRuns, setLastAutoRuns] = useState<Record<string, SimulatorScheduleSnapshot>>({});

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [staffImportModalOpen, setStaffImportModalOpen] = useState(false);
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

  // Auto-clear KPI lenses when the underlying issue is resolved
  const currentGapCount = viewModel?.health.staffingGapCount ?? 0;
  const currentOverLimitCount = viewModel?.health.hourLimitWarningCount ?? 0;
  const fairnessEligible =
    viewModel?.health.fairnessJainIndex !== null &&
    viewModel?.health.fairnessJainIndex !== undefined &&
    !viewModel.health.isSingleEligibleStaff;

  const fairnessExtremes = useMemo(() => {
    if (!viewModel) return null;
    const eligible = schedule.staff
      .map((member) => {
        const m = viewModel.staffMetrics[member.id];
        const util = m?.utilization ?? null;
        return util !== null
          ? { staff: member, util, assignedHours: m?.assignedHours ?? 0 }
          : null;
      })
      .filter((x): x is { staff: Staff; util: number; assignedHours: number } => x !== null);

    if (eligible.length < 2) return null;

    const sorted = [...eligible].sort((a, b) => {
      if (b.util !== a.util) return b.util - a.util;
      if (b.assignedHours !== a.assignedHours) return b.assignedHours - a.assignedHours;
      return a.staff.name.localeCompare(b.staff.name);
    });

    const maxUtil = sorted[0]!.util;
    const minUtil = sorted[sorted.length - 1]!.util;
    const highestPct = Math.round(maxUtil * 100);
    const lowestPct = Math.round(minUtil * 100);

    if (Math.abs(maxUtil - minUtil) < 1e-9 || highestPct === lowestPct) {
      return {
        isBalanced: true as const,
        balancedPct: highestPct,
        highestList: [] as Staff[],
        lowestList: [] as Staff[],
        highestStaffIds: new Set<string>(),
        lowestStaffIds: new Set<string>(),
        highestPct,
        lowestPct,
      };
    }

    const highestList = sorted
      .filter((item) => Math.abs(item.util - maxUtil) < 1e-9 || Math.round(item.util * 100) === highestPct)
      .map((item) => item.staff);
    const lowestList = sorted
      .filter((item) => Math.abs(item.util - minUtil) < 1e-9 || Math.round(item.util * 100) === lowestPct)
      .map((item) => item.staff);

    return {
      isBalanced: false as const,
      balancedPct: null,
      highestList,
      lowestList,
      highestStaffIds: new Set(highestList.map((s) => s.id)),
      lowestStaffIds: new Set(lowestList.map((s) => s.id)),
      highestPct,
      lowestPct,
    };
  }, [schedule.staff, viewModel]);

  const cycleHighlightGroup = (group: readonly Staff[]) => {
    if (group.length === 0) return;
    setHighlightedStaffId((prev) => {
      if (group.length === 1) {
        return prev === group[0]!.id ? null : group[0]!.id;
      }
      const idx = group.findIndex((s) => s.id === prev);
      if (idx === -1) return group[0]!.id;
      return group[(idx + 1) % group.length]!.id;
    });
  };

  useEffect(() => {
    if (activeKpiLens === 'gaps' && currentGapCount === 0) {
      setActiveKpiLens(null);
    } else if (activeKpiLens === 'over_limit' && currentOverLimitCount === 0) {
      setActiveKpiLens(null);
      setTeamFilterMode('all');
    } else if (activeKpiLens === 'fairness' && !fairnessEligible) {
      setActiveKpiLens(null);
      setTeamSortMode('name');
    }
  }, [activeKpiLens, currentGapCount, currentOverLimitCount, fairnessEligible]);

  // Global Ctrl+Z / Cmd+Z undo & Esc to clear active KPI lens
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (undoStack.length > 0) {
          event.preventDefault();
          performUndo();
        }
        return;
      }

      if (event.key === 'Escape' && (activeKpiLens !== null || focusedSummaryTarget !== null)) {
        if (document.querySelector('[role="dialog"]')) return;
        if (activeKpiLens === 'over_limit') {
          setTeamFilterMode('all');
        }
        if (activeKpiLens === 'fairness') {
          setTeamSortMode('name');
        }
        setActiveKpiLens(null);
        setFocusedSummaryTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack.length, performUndo, activeKpiLens, focusedSummaryTarget]);

  const handleRunAutoSchedule = () => {
    const clonedSchedule: Schedule =
      typeof structuredClone === 'function'
        ? structuredClone(schedule)
        : (JSON.parse(JSON.stringify(schedule)) as Schedule);

    const assignmentSlotKey = (a: { day: number; shiftId: string; staffId: string }) =>
      `${a.day}:${a.shiftId}:${a.staffId}`;
    const beforeSnapshot = schedule.assignments.map((a) => ({ ...a }));
    const beforeKeys = new Set(schedule.assignments.map(assignmentSlotKey));
    const beforeCov =
      viewModel?.health.demandCoverage?.ratio !== null &&
      viewModel?.health.demandCoverage?.ratio !== undefined
        ? Math.round(viewModel.health.demandCoverage.ratio * 100)
        : null;
    const beforeGaps = viewModel?.health.staffingGapCount ?? null;

    const actionRes = store.runAutoScheduleForSchedule(schedule.id);
    const result: AutoScheduleResult = actionRes.result;

    if (result.status === 'SUCCESS' || result.status === 'BLOCKED_PIN_CONFLICT') {
      const capturedSnapshot: SimulatorScheduleSnapshot = {
        protocolVersion: SIMULATOR_BRIDGE_PROTOCOL_VERSION,
        capturedAtIso: new Date().toISOString(),
        resultStatus: result.status,
        schedule: clonedSchedule,
      };
      setLastAutoRuns((prev) => ({
        ...prev,
        [schedule.id]: capturedSnapshot,
      }));
    }

    if (result.status === 'SUCCESS') {
      const addedIds = new Set(
        result.assignments
          .filter((a) => !beforeKeys.has(assignmentSlotKey(a)))
          .map((a) => a.id),
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

  const handleReplayLastAutoRun = () => {
    const snapshot = lastAutoRuns[schedule.id];
    if (!snapshot) return;

    const res = openScheduleInSimulator(snapshot, {
      onUnavailable: (url) => {
        setBanner({
          kind: 'notice',
          tone: 'warning',
          title: `Simulator is not responding at ${url}`,
          details: [
            import.meta.env.DEV
              ? 'Start the simulator in a terminal with: pnpm run dev:sim'
              : 'Please refresh the Simulator tab or try again.',
          ],
        });
      },
    });

    if (!res.ok) {
      setBanner({
        kind: 'notice',
        tone: 'warning',
        title: res.error,
      });
    }
  };

  const handleRequestDeleteStaff = (member: Staff) => {
    const preview = store.previewDeleteStaff(schedule.id, member.id);
    setDeleteStaffTarget({ staff: member, affectedCount: preview.affectedAssignmentsCount });
  };

  const clearPreviousLensSideEffects = (prevLens: ActiveKpiLens) => {
    if (prevLens === 'over_limit') setTeamFilterMode('all');
    if (prevLens === 'fairness') setTeamSortMode('name');
  };

  const handleInspectGaps = () => {
    if (!schedule.demand) {
      setCsvModalOpen(true);
      return;
    }
    if (activeKpiLens === 'gaps') {
      setActiveKpiLens(null);
      return;
    }
    clearPreviousLensSideEffects(activeKpiLens);
    setHighlightedStaffId(null);
    setFocusedSlot(null);
    setActiveKpiLens('gaps');
    setActiveTab('roster');
  };

  const handleInspectHourLimitWarnings = () => {
    if (activeKpiLens === 'over_limit') {
      setActiveKpiLens(null);
      setTeamFilterMode('all');
      return;
    }
    clearPreviousLensSideEffects(activeKpiLens);
    setHighlightedStaffId(null);
    setFocusedSlot(null);
    setActiveKpiLens('over_limit');
    setTeamPanelOpen(true);
    setTeamFilterMode('over_limit');
    setActiveTab('roster');
  };

  const handleInspectCoverage = () => {
    if (!schedule.demand) {
      setCsvModalOpen(true);
      return;
    }
    if (activeKpiLens === 'coverage') {
      setActiveKpiLens(null);
      return;
    }
    clearPreviousLensSideEffects(activeKpiLens);
    setHighlightedStaffId(null);
    setFocusedSlot(null);
    setFocusedSummaryTarget(null);
    setActiveKpiLens('coverage');
    setActiveTab('summary');
  };

  const handleInspectFairness = () => {
    if (activeKpiLens === 'fairness') {
      setActiveKpiLens(null);
      setTeamSortMode('name');
      return;
    }
    clearPreviousLensSideEffects(activeKpiLens);
    setHighlightedStaffId(null);
    setFocusedSlot(null);
    setFocusedSummaryTarget(null);
    setActiveKpiLens('fairness');
    setTeamPanelOpen(true);
    setTeamFilterMode('all');
    setTeamSortMode('utilization');
    setActiveTab('roster');
  };

  const handleJumpToRosterCell = (day: DayOfWeek, hour: OperatingHour) => {
    setActiveKpiLens(null);
    setFocusedSummaryTarget(null);
    setFocusedSlot({ day, hour });
    setActiveTab('roster');
  };

  const handleJumpToRosterDay = (day: DayOfWeek) => {
    setActiveKpiLens(null);
    setFocusedSummaryTarget(null);
    setFocusedSlot({ day });
    setActiveTab('roster');
  };

  const handleBackToSummary = (slot: FocusedRosterSlot) => {
    setFocusedSlot(null);
    setActiveKpiLens(null);
    setFocusedSummaryTarget(
      slot.hour !== undefined
        ? { kind: 'cell', day: slot.day, hour: slot.hour }
        : { kind: 'day', day: slot.day },
    );
    setActiveTab('summary');
  };

  const handleInspectDayInSummary = (day: DayOfWeek) => {
    if (activeKpiLens === 'over_limit') {
      setTeamFilterMode('all');
    }
    setActiveKpiLens(null);
    setFocusedSlot(null);
    setFocusedSummaryTarget({ kind: 'day', day });
    setActiveTab('summary');
  };

  const handleBackToRosterFromSummary = () => {
    if (focusedSummaryTarget?.kind === 'cell') {
      setFocusedSlot({ day: focusedSummaryTarget.day, hour: focusedSummaryTarget.hour });
    } else if (focusedSummaryTarget?.kind === 'day') {
      setFocusedSlot({ day: focusedSummaryTarget.day });
    }
    setFocusedSummaryTarget(null);
    setActiveTab('roster');
  };

  const highlightedStaffName = highlightedStaffId
    ? schedule.staff.find((s) => s.id === highlightedStaffId)?.name ?? null
    : null;

  const scopedAssignments = highlightedStaffId
    ? schedule.assignments.filter((a) => a.staffId === highlightedStaffId)
    : schedule.assignments;
  const allScopedPinned =
    scopedAssignments.length > 0 && scopedAssignments.every((a) => a.isPinned);

  const handleBulkPinToggle = () => {
    if (scopedAssignments.length === 0) return;
    const nextPinned = !allScopedPinned;
    const scopeLabel = highlightedStaffName ? `${highlightedStaffName}'s shifts` : 'all shifts';
    pushUndo(`${nextPinned ? 'Pinned' : 'Unpinned'} ${scopeLabel}`);
    store.setBulkPinAssignments(schedule.id, {
      isPinned: nextPinned,
      staffId: highlightedStaffId,
    });
    setConflictAssignmentIds(new Set());
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
        hasLastAutoRun={Boolean(lastAutoRuns[schedule.id])}
        onReplayLastAutoRun={handleReplayLastAutoRun}
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
            staffMetrics={viewModel.staffMetrics}
            activeLens={activeKpiLens}
            onInspectGaps={handleInspectGaps}
            onInspectHourLimitWarnings={handleInspectHourLimitWarnings}
            onInspectCoverage={handleInspectCoverage}
            onInspectFairness={handleInspectFairness}
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
          canReplayLastRun={Boolean(lastAutoRuns[schedule.id])}
          onReplayLastRun={handleReplayLastAutoRun}
        />

        {/* Responsive Split Workspace: stacks cleanly below lg, side-by-side on desktop */}
        <div className="flex min-h-0 flex-col items-start gap-4 lg:flex-row">
          <section className="w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-300/80 bg-white shadow-xs">
            {/* Sub-header Tabs & Primary View Controls (Actions only — zero wrap jitter) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2">
              <div
                className="inline-flex items-center gap-1 rounded-lg bg-slate-200/80 p-0.5"
                role="tablist"
                aria-label="Workspace views"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'roster'}
                  onClick={() => {
                    if (activeKpiLens === 'coverage') setActiveKpiLens(null);
                    setActiveTab('roster');
                  }}
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
                <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-medium text-slate-700">
                  {activeKpiLens === 'over_limit' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-900">
                      Filter: Over-limit staff ({currentOverLimitCount})
                      <button
                        type="button"
                        onClick={() => {
                          setActiveKpiLens(null);
                          setTeamFilterMode('all');
                        }}
                        aria-label="Clear over-limit filter"
                        className="ml-0.5 hover:text-rose-950"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
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
                  {scopedAssignments.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkPinToggle}
                      title={
                        highlightedStaffName
                          ? `${allScopedPinned ? 'Unpin' : 'Pin'} all ${scopedAssignments.length} shift(s) for ${highlightedStaffName}`
                          : `${allScopedPinned ? 'Unpin' : 'Pin'} all ${scopedAssignments.length} shifts in this schedule`
                      }
                      className={`inline-flex min-w-[88px] items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        highlightedStaffName
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {allScopedPinned ? (
                        <>
                          <PinOff className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                          {highlightedStaffName
                            ? `Unpin (${scopedAssignments.length})`
                            : 'Unpin all'}
                        </>
                      ) : (
                        <>
                          <Pin
                            className="h-3.5 w-3.5 fill-indigo-600 text-indigo-600"
                            aria-hidden="true"
                          />
                          {highlightedStaffName
                            ? `Pin all (${scopedAssignments.length})`
                            : 'Pin all'}
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setTeamPanelOpen((prev) => !prev)}
                    title={teamPanelOpen ? 'Hide Team panel to expand roster' : 'Show Team panel'}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
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
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="hidden text-xs text-slate-600 md:inline">
                    {schedule.demand
                      ? `Demand: ${schedule.demand.sourceFileName ?? 'Imported CSV'} (${formatTimestamp(
                          schedule.demand.importedAt,
                        )})`
                      : 'No demand CSV imported yet'}
                  </span>
                  <div
                    role="group"
                    aria-label="Summary view mode"
                    className="inline-flex rounded-lg border border-slate-300 bg-slate-200/70 p-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => setSummaryViewMode('metrics')}
                      aria-pressed={summaryViewMode === 'metrics'}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        summaryViewMode === 'metrics'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Metrics View
                    </button>
                    <button
                      type="button"
                      onClick={() => setSummaryViewMode('coverage')}
                      aria-pressed={summaryViewMode === 'coverage'}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        summaryViewMode === 'coverage'
                          ? 'bg-white text-indigo-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Coverage View
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Dedicated slim Roster Legend Bar — never wraps or jumps when buttons toggle */}
            {activeTab === 'roster' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-white px-4 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-3 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                  Healthy
                </span>
                <span
                  title="Staff assigned 2+ shifts on the same day, on a day off, or exceeding weekly hour limit"
                  className="inline-flex cursor-help items-center gap-1.5 whitespace-nowrap"
                >
                  <span className="h-3 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                  2+ shifts / Day off / OT
                </span>
                <span
                  title="Overlapping shifts or conflicting pinned shifts blocking Auto-schedule"
                  className="inline-flex cursor-help items-center gap-1.5 whitespace-nowrap"
                >
                  <span className="h-3 w-1.5 rounded-full bg-rose-600" aria-hidden="true" />
                  Overlap / Conflict
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <Pin className="h-3 w-3 fill-indigo-600 text-indigo-600" aria-hidden="true" />
                  Pinned
                </span>
              </div>
            )}

            {/* Rebalance Lens Bar (KPI 4 — Hour Fairness) */}
            {activeTab === 'roster' && activeKpiLens === 'fairness' && fairnessExtremes && (
              <div
                role="status"
                className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  fairnessExtremes.isBalanced
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                    : 'border-indigo-300 bg-indigo-50 text-indigo-950'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Scale
                    className={`h-3.5 w-3.5 shrink-0 ${
                      fairnessExtremes.isBalanced ? 'text-emerald-700' : 'text-indigo-700'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="font-semibold">Rebalance lens:</span>
                  {fairnessExtremes.isBalanced ? (
                    <span>
                      Team balanced — all active members are at{' '}
                      <strong>{fairnessExtremes.balancedPct}%</strong> of weekly cap.
                    </span>
                  ) : (
                    <>
                      <span className="text-indigo-900">Team sorted by % used ·</span>
                      {(() => {
                        const activeHigh =
                          fairnessExtremes.highestList.find((s) => s.id === highlightedStaffId) ??
                          fairnessExtremes.highestList[0]!;
                        const extraHigh = fairnessExtremes.highestList.length - 1;
                        const isHighSelected =
                          highlightedStaffId !== null &&
                          fairnessExtremes.highestStaffIds.has(highlightedStaffId);

                        const activeLow =
                          fairnessExtremes.lowestList.find((s) => s.id === highlightedStaffId) ??
                          fairnessExtremes.lowestList[0]!;
                        const extraLow = fairnessExtremes.lowestList.length - 1;
                        const isLowSelected =
                          highlightedStaffId !== null &&
                          fairnessExtremes.lowestStaffIds.has(highlightedStaffId);

                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => cycleHighlightGroup(fairnessExtremes.highestList)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                                isHighSelected
                                  ? 'border-amber-600 bg-amber-600 text-white'
                                  : 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
                              }`}
                              title={
                                extraHigh > 0
                                  ? `Tied highest (${fairnessExtremes.highestList.map((s) => s.name).join(', ')}). Click to cycle.`
                                  : "Click to highlight highest-utilized staff member's shifts"
                              }
                            >
                              Highest: {activeHigh.name}
                              {extraHigh > 0 ? ` +${extraHigh}` : ''} ({fairnessExtremes.highestPct}%)
                            </button>
                            <ArrowRight
                              className="h-3 w-3 shrink-0 text-indigo-500"
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              onClick={() => cycleHighlightGroup(fairnessExtremes.lowestList)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                                isLowSelected
                                  ? 'border-sky-700 bg-sky-700 text-white'
                                  : 'border-sky-300 bg-sky-50 text-sky-950 hover:bg-sky-100'
                              }`}
                              title={
                                extraLow > 0
                                  ? `Tied lowest (${fairnessExtremes.lowestList.map((s) => s.name).join(', ')}). Click to cycle.`
                                  : "Click to highlight lowest-utilized active staff member's shifts"
                              }
                            >
                              Lowest: {activeLow.name}
                              {extraLow > 0 ? ` +${extraLow}` : ''} ({fairnessExtremes.lowestPct}%)
                            </button>
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveKpiLens(null);
                    setTeamSortMode('name');
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                  Clear lens
                </button>
              </div>
            )}

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
                highlightedOverLimitOnly={activeKpiLens === 'over_limit'}
                highlightGapsOnly={activeKpiLens === 'gaps'}
                totalGapHours={currentGapCount}
                onClearGapsLens={() => setActiveKpiLens(null)}
                conflictAssignmentIds={conflictAssignmentIds}
                newAutoAssignmentIds={newAutoAssignmentIds}
                focusedSlot={focusedSlot}
                onClearFocus={() => setFocusedSlot(null)}
                onBackToSummary={handleBackToSummary}
                onInspectDayInSummary={handleInspectDayInSummary}
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
                viewMode={summaryViewMode}
                highlightUnderstaffedOnly={activeKpiLens === 'coverage'}
                onClearCoverageLens={() => setActiveKpiLens(null)}
                focusedTarget={focusedSummaryTarget}
                onClearFocusedTarget={() => setFocusedSummaryTarget(null)}
                onBackToRoster={handleBackToRosterFromSummary}
                onJumpToRosterCell={handleJumpToRosterCell}
                onJumpToRosterDay={handleJumpToRosterDay}
              />
            )}
          </section>

          {teamPanelOpen && (
            <StaffPanel
              staff={schedule.staff}
              staffMetrics={viewModel?.staffMetrics ?? {}}
              highlightedStaffId={highlightedStaffId}
              filterMode={teamFilterMode}
              onFilterModeChange={(mode) => {
                setTeamFilterMode(mode);
                if (activeKpiLens === 'over_limit' && mode !== 'over_limit') {
                  setActiveKpiLens(null);
                }
              }}
              sortMode={teamSortMode}
              onSortModeChange={(mode) => {
                setTeamSortMode(mode);
                if (activeKpiLens === 'fairness' && mode !== 'utilization') {
                  setActiveKpiLens(null);
                }
              }}
              fairnessExtremes={
                activeKpiLens === 'fairness' && fairnessExtremes && !fairnessExtremes.isBalanced
                  ? {
                      highestStaffIds: fairnessExtremes.highestStaffIds,
                      lowestStaffIds: fairnessExtremes.lowestStaffIds,
                    }
                  : null
              }
              onSelectStaff={(staffId) => {
                if (activeKpiLens === 'gaps' || activeKpiLens === 'over_limit') {
                  setActiveKpiLens(null);
                }
                setHighlightedStaffId(staffId);
                if (staffId) setActiveTab('roster');
              }}
              onAddStaff={() => setStaffModalState({ open: true, editing: null })}
              onImportStaff={() => setStaffImportModalOpen(true)}
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

      <StaffImportModal
        open={staffImportModalOpen}
        existingStaff={schedule.staff}
        onImport={(csvText, options) => {
          const res = store.importStaffCsv(schedule.id, csvText, options);
          if (res.ok) {
            const parts: string[] = [];
            if (res.addedCount > 0) parts.push(`${res.addedCount} added`);
            if (res.updatedCount > 0) parts.push(`${res.updatedCount} updated`);
            if (res.skippedCount > 0) parts.push(`${res.skippedCount} skipped`);
            setBanner({
              kind: 'notice',
              tone: 'success',
              title: `Staff CSV imported (${parts.join(', ') || 'no changes'}).`,
            });
          }
          return res;
        }}
        onClose={() => setStaffImportModalOpen(false)}
      />

      <ManageShiftsModal
        open={shiftsModalOpen}
        shifts={schedule.shifts}
        onAddShift={(input) => store.addShiftTemplate(schedule.id, input)}
        onPreviewEditShift={(shiftId) => store.previewEditShift(schedule.id, shiftId)}
        onPreviewDisableShiftDays={(shiftId, nextDays) =>
          store.previewDisableShiftDays(schedule.id, shiftId, nextDays)
        }
        onUpdateShift={(shiftId, input) => store.updateShiftTemplate(schedule.id, shiftId, input)}
        onPreviewDeleteShift={(shiftId) => store.previewDeleteShift(schedule.id, shiftId)}
        onDeleteShift={(shiftId) => store.deleteShiftTemplate(schedule.id, shiftId)}
        onReorderShifts={(orderedIds) => store.reorderShiftTemplates(schedule.id, orderedIds)}
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
