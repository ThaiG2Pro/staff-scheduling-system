/**
 * @file P0 Aggregated Summary View (`AC-05`) rendering the 4 mandatory weekly KPI cards,
 * an on-demand `DailyDemandChart` (opens on clicking any Day column or Hour×Day cell),
 * and the 7×16 hourly grid (`Mon–Sun` × `07:00–22:00`) with `-Xh` day header badges
 * and a single unified `... on Roster` action in the chart header.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  X,
} from 'lucide-react';
import { DAYS_OF_WEEK, DAY_LABELS, OPERATING_HOURS } from '../../domain/constants';
import type { AggregatedSummary, DayOfWeek, OperatingHour } from '../../domain/types';
import { formatHour24 } from '../common/formatters';
import { DailyDemandChart } from './DailyDemandChart';

export type FocusedSummaryTarget =
  | { kind: 'day'; day: DayOfWeek }
  | { kind: 'cell'; day: DayOfWeek; hour: OperatingHour };

export type SummaryViewMode = 'metrics' | 'coverage';

export interface AggregatedSummaryViewProps {
  summary: AggregatedSummary;
  targetN: number;
  viewMode?: SummaryViewMode;
  highlightUnderstaffedOnly?: boolean;
  onClearCoverageLens?: () => void;
  focusedTarget?: FocusedSummaryTarget | null;
  onClearFocusedTarget?: () => void;
  onBackToRoster?: () => void;
  onJumpToRosterCell: (day: DayOfWeek, hour: OperatingHour) => void;
  onJumpToRosterDay?: (day: DayOfWeek) => void;
}

function formatRate(value: number | null): string {
  if (value === null) return '–';
  return value.toFixed(1);
}

/** Returns progressive heatmap background/text classes for High Load cells (`txns/hr > targetN`). */
function getHighLoadHeatClasses(rate: number, targetN: number): { cellBg: string; textTone: string } {
  const ratio = targetN > 0 ? rate / targetN : 1;
  if (ratio > 1.6) {
    return {
      cellBg: 'bg-orange-200/80 hover:bg-orange-200',
      textTone: 'text-orange-950',
    };
  }
  if (ratio > 1.25) {
    return {
      cellBg: 'bg-amber-100 hover:bg-amber-200/70',
      textTone: 'text-amber-950',
    };
  }
  return {
    cellBg: 'bg-amber-50 hover:bg-amber-100/80',
    textTone: 'text-amber-900',
  };
}

/** Returns 3-tier progressive rose heatmap classes for Coverage View Shortage (`delta < 0` or Gap). */
function getShortageHeatClasses(delta: number, isGap: boolean): { cellBg: string; textTone: string } {
  if (isGap || delta <= -3) {
    return {
      cellBg: 'bg-rose-200/80 hover:bg-rose-200',
      textTone: 'text-rose-950',
    };
  }
  if (delta === -2) {
    return {
      cellBg: 'bg-rose-100 hover:bg-rose-200/70',
      textTone: 'text-rose-900',
    };
  }
  return {
    cellBg: 'bg-rose-50 hover:bg-rose-100',
    textTone: 'text-rose-800',
  };
}

/**
 * Displays the 4 weekly summary KPIs, an on-demand `DailyDemandChart`, and the 7×16 P0 hourly matrix.
 * Clicking any Day column header or Hour×Day cell highlights it and opens the Daily Demand vs.
 * Scheduled chart; navigating to `WeeklyRosterGrid` happens explicitly via the single Roster CTA
 * in the chart header.
 */
export function AggregatedSummaryView({
  summary,
  targetN,
  viewMode = 'metrics',
  highlightUnderstaffedOnly = false,
  onClearCoverageLens,
  focusedTarget = null,
  onClearFocusedTarget,
  onJumpToRosterCell,
  onJumpToRosterDay,
}: AggregatedSummaryViewProps) {
  const [activePeakIndex, setActivePeakIndex] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<FocusedSummaryTarget | null>(
    () => focusedTarget,
  );
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  // Daily rollups for `-Xh` shortage badges / covered dots on the 7×16 Mon–Sun column headers
  const dayHeaderBadges = useMemo(() => {
    return DAYS_OF_WEEK.map((day) => {
      let requiredHours = 0;
      let shortageHours = 0;
      let hasDemand = false;
      for (const hour of OPERATING_HOURS) {
        const cell = summary.cells[day][hour];
        if (cell.transactions !== null) hasDemand = true;
        if (cell.requiredStaff !== null) requiredHours += cell.requiredStaff;
        if (cell.coverageDelta !== null && cell.coverageDelta < 0) {
          shortageHours += -cell.coverageDelta;
        }
      }
      return { day, requiredHours, shortageHours, hasDemand };
    });
  }, [summary]);

  const understaffedCells = useMemo(() => {
    const list: Array<{
      key: string;
      day: DayOfWeek;
      hour: OperatingHour;
      isGap: boolean;
      rate: number;
      shortage: number;
      transactions: number;
    }> = [];

    for (const day of DAYS_OF_WEEK) {
      for (const hour of OPERATING_HOURS) {
        const cell = summary.cells[day][hour];
        const isGap = cell.isStaffingGap;
        const isHighLoad =
          !isGap && cell.txnsPerStaffHour !== null && cell.txnsPerStaffHour > targetN;
        if (!isGap && !isHighLoad) continue;

        const shortage =
          cell.coverageDelta !== null && cell.coverageDelta < 0
            ? -cell.coverageDelta
            : isGap
              ? 1
              : 0;
        list.push({
          key: `${day}|${hour}`,
          day,
          hour,
          isGap,
          rate: isGap ? Number.POSITIVE_INFINITY : (cell.txnsPerStaffHour ?? 0),
          shortage,
          transactions: cell.transactions ?? 0,
        });
      }
    }

    // Align 100% with heatmap severity: Gap (rose) -> highest txns/staff hr (darkest orange) -> shortage -> txns
    list.sort((a, b) => {
      if (a.isGap !== b.isGap) return a.isGap ? -1 : 1;
      if (b.rate !== a.rate) return b.rate - a.rate;
      if (b.shortage !== a.shortage) return b.shortage - a.shortage;
      if (b.transactions !== a.transactions) return b.transactions - a.transactions;
      if (a.day !== b.day) return a.day - b.day;
      return a.hour - b.hour;
    });

    return list;
  }, [summary, targetN]);

  const safePeakIndex =
    understaffedCells.length > 0 ? Math.min(activePeakIndex, understaffedCells.length - 1) : 0;
  const activePeak =
    highlightUnderstaffedOnly && understaffedCells.length > 0
      ? understaffedCells[safePeakIndex] ?? null
      : null;

  // Sync external focusedTarget (when jumping from Weekly Roster) into local selection
  useEffect(() => {
    if (focusedTarget) {
      setSelectedTarget(focusedTarget);
      if (focusedTarget.kind === 'cell') {
        const key = `${focusedTarget.day}|${focusedTarget.hour}`;
        cellRefs.current[key]?.scrollIntoView?.({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }
    }
  }, [focusedTarget]);

  // Sync Coverage Lens active peak into selection & scroll into view
  useEffect(() => {
    if (!highlightUnderstaffedOnly) {
      setActivePeakIndex(0);
      return;
    }
    if (activePeak) {
      setSelectedTarget({ kind: 'cell', day: activePeak.day, hour: activePeak.hour });
      cellRefs.current[activePeak.key]?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [highlightUnderstaffedOnly, activePeak?.key]);

  const handleOpenSelectedInRoster = () => {
    if (!selectedTarget) return;
    if (selectedTarget.kind === 'cell') {
      onJumpToRosterCell(selectedTarget.day, selectedTarget.hour);
    } else if (onJumpToRosterDay) {
      onJumpToRosterDay(selectedTarget.day);
    } else {
      onJumpToRosterCell(selectedTarget.day, 7);
    }
  };

  const handleCloseChart = () => {
    setSelectedTarget(null);
    onClearFocusedTarget?.();
  };

  const chartContextLabel = highlightUnderstaffedOnly
    ? 'Coverage focus'
    : focusedTarget &&
        selectedTarget &&
        focusedTarget.kind === selectedTarget.kind &&
        focusedTarget.day === selectedTarget.day &&
        (focusedTarget.kind === 'day' ||
          (selectedTarget.kind === 'cell' && focusedTarget.hour === selectedTarget.hour))
      ? 'From Weekly Roster'
      : null;

  return (
    <div className="space-y-4 p-4">
      {/* Coverage Lens stepper bar (navigation only — Roster CTA lives once in chart header) */}
      {highlightUnderstaffedOnly && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
            understaffedCells.length === 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {understaffedCells.length === 0 ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  <strong>Coverage focus:</strong> All operating hours meet target demand (0 understaffed hours).
                </span>
              </>
            ) : (
              <>
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                <span>
                  <strong>Coverage focus:</strong> {understaffedCells.length} understaffed{' '}
                  {understaffedCells.length === 1 ? 'hour' : 'hours'} (sorted by peak load)
                  {activePeak && (
                    <>
                      {' · '}
                      <span className="font-semibold text-amber-950">
                        {DAY_LABELS[activePeak.day]} {formatHour24(activePeak.hour)}
                        {activePeak.isGap
                          ? ' (Gap · 0 staff)'
                          : ` (${activePeak.rate.toFixed(1)}/h${
                              activePeak.shortage > 0 ? ` · need +${activePeak.shortage}` : ''
                            })`}
                      </span>{' '}
                      ({safePeakIndex + 1}/{understaffedCells.length})
                    </>
                  )}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {understaffedCells.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setActivePeakIndex(
                      (prev) => (prev - 1 + understaffedCells.length) % understaffedCells.length,
                    )
                  }
                  aria-label="Previous understaffed hour"
                  className="inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActivePeakIndex((prev) => (prev + 1) % understaffedCells.length)
                  }
                  aria-label="Next understaffed hour"
                  className="inline-flex items-center gap-0.5 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Next
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            )}
            {onClearCoverageLens && (
              <button
                type="button"
                onClick={onClearCoverageLens}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear lens
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4 Mandatory Weekly Totals (Secondary Reference Strip — subordinate to Health Bar) */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-200 grid grid-cols-1 gap-px sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Total Transactions
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
            {summary.totalTransactions !== null
              ? summary.totalTransactions.toLocaleString()
              : '–'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">Weekly customer volume</p>
        </div>

        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Total Staff Hours
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
            {summary.totalStaffHours}
            <span className="ml-1 text-xs font-medium text-slate-600">hrs</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">Total scheduled team hours</p>
        </div>

        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Overall Txns / Staff Hr
          </p>
          <p
            className={`mt-1 text-xl font-bold tabular-nums ${
              summary.overallTxnsPerStaffHour !== null &&
              summary.overallTxnsPerStaffHour > targetN
                ? 'text-amber-800'
                : 'text-slate-900'
            }`}
          >
            {formatRate(summary.overallTxnsPerStaffHour)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Total txns ÷ total staff hrs (Target ≤ {targetN})
          </p>
        </div>

        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Average Txns / Staff Hr
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
            {formatRate(summary.averageTxnsPerStaffHour)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">Mean load across staffed hours</p>
        </div>
      </div>

      {/* On-demand Daily Demand vs. Scheduled Chart (closed until a Day or Hour×Day is clicked) */}
      {selectedTarget ? (
        <DailyDemandChart
          summary={summary}
          targetN={targetN}
          day={selectedTarget.day}
          selectedHour={selectedTarget.kind === 'cell' ? selectedTarget.hour : null}
          contextLabel={chartContextLabel}
          onSelectHour={(hour) =>
            setSelectedTarget({ kind: 'cell', day: selectedTarget.day, hour })
          }
          onClearHour={() => setSelectedTarget({ kind: 'day', day: selectedTarget.day })}
          onClose={handleCloseChart}
          onOpenRoster={handleOpenSelectedInRoster}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-2 text-xs text-slate-600">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden="true" />
          <span>
            Click any <strong>day column header</strong> or <strong>hour cell</strong> below to open
            its Daily Demand vs. Scheduled chart.
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-3">
          {viewMode === 'metrics' ? (
            <>
              <span className="font-semibold text-slate-800">Cell lines:</span>
              <span>1. Transactions</span>
              <span>2. Staff hrs</span>
              <span>3. Txns / staff hr (Target {targetN})</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-slate-800">Cell lines:</span>
              <span>1. Scheduled / Required staff</span>
              <span>2. Coverage delta (- / 0 / +)</span>
            </>
          )}
        </div>
        {viewMode === 'metrics' ? (
          <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-0.5 font-medium text-rose-800">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Gap
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              High load (&gt;{targetN}/h)
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              – Idle (0/0)
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-100 px-2 py-0.5 font-medium text-rose-900">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Shortage (&lt;0: -1 / -2 / -3+·Gap)
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Exact (0)
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-2 py-0.5 font-medium text-sky-900">
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              Surplus (&gt;0)
            </span>
          </div>
        )}
      </div>

      {/* 7x16 Hourly Detail Matrix */}
      <div className="max-h-[600px] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 w-20 border-r border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Hour
              </th>
              {DAYS_OF_WEEK.map((day) => {
                const badge = dayHeaderBadges[day]!;
                const isSelectedCol = selectedTarget?.day === day;
                const hasIssue = badge.hasDemand && badge.shortageHours > 0;
                const isCovered =
                  badge.hasDemand && badge.shortageHours === 0 && badge.requiredHours > 0;

                return (
                  <th
                    key={day}
                    scope="col"
                    className={`sticky top-0 z-20 border-r border-slate-200 p-0 text-center text-xs font-semibold last:border-r-0 ${
                      isSelectedCol
                        ? 'bg-indigo-100 text-indigo-950'
                        : day >= 5
                          ? 'bg-slate-200 text-slate-900'
                          : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTarget({ kind: 'day', day })}
                      aria-pressed={isSelectedCol}
                      aria-label={`Inspect ${DAY_LABELS[day]} chart`}
                      title={`Click to open ${DAY_LABELS[day]} Demand vs. Scheduled chart`}
                      className="inline-flex w-full items-center justify-center gap-1.5 px-2.5 py-2 transition hover:bg-indigo-100/80 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                    >
                      <span>{DAY_LABELS[day]}</span>
                      {hasIssue ? (
                        <span
                          className="rounded bg-rose-100 px-1 py-0.2 text-[10px] font-bold text-rose-800 tabular-nums"
                          title={`${badge.shortageHours}h shortage on ${DAY_LABELS[day]}`}
                        >
                          -{badge.shortageHours}h
                        </span>
                      ) : isCovered ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                          title={`${DAY_LABELS[day]} fully covered`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200">
            {OPERATING_HOURS.map((hour) => (
              <tr key={hour}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  {formatHour24(hour)}
                </th>

                {DAYS_OF_WEEK.map((day) => {
                  const cell = summary.cells[day][hour];
                  const isGap = cell.isStaffingGap;
                  const isZeroZero = cell.transactions === 0 && cell.staffHours === 0;
                  const isHighLoad =
                    !isGap &&
                    cell.txnsPerStaffHour !== null &&
                    cell.txnsPerStaffHour > targetN;
                  const isActionable = isGap || isHighLoad;

                  const highLoadHeat =
                    viewMode === 'metrics' && isHighLoad && cell.txnsPerStaffHour !== null
                      ? getHighLoadHeatClasses(cell.txnsPerStaffHour, targetN)
                      : null;

                  const delta = cell.coverageDelta;
                  const isShortage = delta !== null && delta < 0;
                  const isSurplus = delta !== null && delta > 0;
                  const isExactCovered =
                    delta === 0 && cell.requiredStaff !== null && cell.requiredStaff > 0;
                  const shortageHeat =
                    viewMode === 'coverage' && (isGap || isShortage)
                      ? getShortageHeatClasses(delta ?? -1, isGap)
                      : null;

                  let cellBg = day >= 5 ? 'bg-slate-50/70' : 'bg-white';
                  if (viewMode === 'coverage') {
                    if (shortageHeat) cellBg = shortageHeat.cellBg;
                    else if (isExactCovered) cellBg = 'bg-emerald-50/80 hover:bg-emerald-100/70';
                    else if (isSurplus) cellBg = 'bg-sky-50/80 hover:bg-sky-100/70';
                    else if (isZeroZero) cellBg = 'bg-slate-100/70 hover:bg-slate-200/50';
                    else cellBg = `${cellBg} hover:bg-slate-100/70`;
                  } else {
                    if (isGap) cellBg = 'bg-rose-100 hover:bg-rose-200/70';
                    else if (highLoadHeat) cellBg = highLoadHeat.cellBg;
                    else if (isZeroZero) cellBg = 'bg-slate-100/70 hover:bg-slate-200/50';
                    else cellBg = `${cellBg} hover:bg-slate-100/70`;
                  }

                  const content =
                    viewMode === 'coverage' ? (
                      <div className="space-y-0.5 text-center leading-tight">
                        <p className="text-[11px] font-medium text-slate-700 tabular-nums">
                          {cell.requiredStaff !== null
                            ? `${cell.staffHours} / ${cell.requiredStaff}`
                            : `${cell.staffHours} / –`}
                        </p>
                        {delta === null ? (
                          <p className="text-[11px] font-medium text-slate-500">–</p>
                        ) : isShortage ? (
                          <p
                            className={`inline-flex items-center justify-center gap-0.5 text-[11px] font-bold tabular-nums ${
                              shortageHeat?.textTone ?? 'text-rose-900'
                            }`}
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            {delta}
                          </p>
                        ) : isExactCovered ? (
                          <p className="inline-flex items-center justify-center gap-0.5 text-[11px] font-bold text-emerald-900 tabular-nums">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />0
                          </p>
                        ) : isSurplus ? (
                          <p className="inline-flex items-center justify-center gap-0.5 text-[11px] font-semibold text-sky-900 tabular-nums">
                            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />+{delta}
                          </p>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-600">–</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-0.5 text-center leading-tight">
                        <p className="text-[11px] font-medium text-slate-700">
                          {cell.transactions !== null ? `${cell.transactions} txns` : '–'}
                        </p>
                        <p className="text-[11px] text-slate-600">{cell.staffHours} staff</p>
                        {isGap ? (
                          <p className="inline-flex items-center justify-center gap-0.5 text-[11px] font-bold text-rose-900">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />– (Gap)
                          </p>
                        ) : highLoadHeat ? (
                          <p
                            className={`inline-flex items-center justify-center gap-0.5 text-[11px] font-bold ${highLoadHeat.textTone}`}
                          >
                            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                            {cell.txnsPerStaffHour!.toFixed(1)}/h
                          </p>
                        ) : cell.txnsPerStaffHour !== null ? (
                          <p className="text-[11px] font-semibold text-slate-900">
                            {cell.txnsPerStaffHour.toFixed(1)}/h
                          </p>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-600">–</p>
                        )}
                      </div>
                    );

                  const cellKey = `${day}|${hour}`;
                  const isSelectedCell =
                    selectedTarget?.kind === 'cell' &&
                    selectedTarget.day === day &&
                    selectedTarget.hour === hour;
                  const isSelectedDay =
                    selectedTarget?.kind === 'day' && selectedTarget.day === day;
                  const isDimmedByCoverageLens =
                    highlightUnderstaffedOnly && !isActionable && !isSelectedCell;

                  return (
                    <td
                      key={day}
                      ref={(el) => {
                        cellRefs.current[cellKey] = el;
                      }}
                      className={`border-r border-slate-200 p-0 last:border-r-0 transition-opacity ${cellBg} ${
                        isSelectedCell
                          ? 'ring-2 ring-inset ring-indigo-600'
                          : isSelectedDay
                            ? 'ring-1 ring-inset ring-indigo-300/80'
                            : ''
                      } ${isDimmedByCoverageLens ? 'opacity-35 hover:opacity-100' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTarget({ kind: 'cell', day, hour })}
                        aria-pressed={isSelectedCell}
                        aria-label={`${DAY_LABELS[day]} ${formatHour24(hour)}${
                          isGap ? ' staffing gap' : isHighLoad ? ' high load' : ''
                        } — inspect in chart`}
                        title={`Click to inspect ${DAY_LABELS[day]} ${formatHour24(hour)} on chart`}
                        className="w-full px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                      >
                        {content}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
