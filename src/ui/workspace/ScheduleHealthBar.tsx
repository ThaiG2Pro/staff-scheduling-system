/**
 * @file Unified 4-signal Schedule Health Bar (`AC-05`) evaluating Staffing Gaps,
 * Hour Limit Warnings, Demand Coverage, and Hour Fairness (Jain Index) independently
 * on unrounded floats with WCAG-accessible icon + text labels.
 */

import { AlertTriangle, CheckCircle2, CircleDot, Minus } from 'lucide-react';
import type { HealthStatus, ScheduleHealth } from '../../domain/types';

export interface ScheduleHealthBarProps {
  health: ScheduleHealth;
  onInspectGapsOrCoverage: () => void;
  onInspectHourLimitWarnings: () => void;
}

function StatusBadge({ status }: { status: HealthStatus }) {
  if (status === 'good') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Good
      </span>
    );
  }
  if (status === 'attention') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        <CircleDot className="h-3 w-3" aria-hidden="true" />
        Attention
      </span>
    );
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
      <Minus className="h-3 w-3" aria-hidden="true" />
      Neutral
    </span>
  );
}

/**
 * Displays the 4 independent Schedule Health signals in a single compact strip.
 * Never merges signals into a single composite score.
 *
 * @param props - Derived `ScheduleHealth` metrics and click-to-inspect callbacks.
 * @returns 4-column Health Strip.
 */
export function ScheduleHealthBar({
  health,
  onInspectGapsOrCoverage,
  onInspectHourLimitWarnings,
}: ScheduleHealthBarProps) {
  const coveragePct =
    health.demandCoverage && health.demandCoverage.ratio !== null
      ? `${Math.round(health.demandCoverage.ratio * 100)}%`
      : '–';

  const coverageSubtext = health.demandCoverage
    ? health.demandCoverage.totalRequiredStaffHours === 0
      ? 'No demand hours'
      : `${health.demandCoverage.coveredRequiredStaffHours}/${health.demandCoverage.totalRequiredStaffHours} req hrs`
    : 'Import CSV to evaluate';

  const fairnessPct =
    health.fairnessJainIndex !== null ? `${Math.round(health.fairnessJainIndex * 100)}%` : '–';

  const fairnessSubtext =
    health.fairnessJainIndex !== null
      ? health.isSingleEligibleStaff
        ? `Jain ${health.fairnessJainIndex.toFixed(2)} (1 eligible staff)`
        : `Jain ${health.fairnessJainIndex.toFixed(2)} (${health.eligibleStaffCount} eligible)`
      : 'No eligible staff with hours';

  return (
    <section
      aria-label="Schedule health"
      className="rounded-xl border border-slate-300/80 bg-white shadow-xs"
    >
      <div className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {/* 1. Staffing Gaps */}
        <button
          type="button"
          onClick={onInspectGapsOrCoverage}
          title="Hours with customer transactions > 0 and 0 staff scheduled. Click to inspect Hourly Summary."
          className="flex items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 rounded-tl-xl lg:rounded-l-xl"
        >
          <div>
            <p className="text-xs font-medium text-slate-600">Staffing Gaps</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">
              {health.staffingGapCount === null ? '–' : health.staffingGapCount}
              <span className="ml-1 text-xs font-normal text-slate-600">
                {health.staffingGapCount === null ? '' : health.staffingGapCount === 1 ? 'hr' : 'hrs'}
              </span>
            </p>
            <p className="text-[11px] text-slate-600">
              {health.staffingGapCount === null
                ? 'Import CSV to evaluate'
                : health.staffingGapCount === 0
                  ? 'All active hours covered'
                  : 'Click to inspect gaps'}
            </p>
          </div>
          <StatusBadge status={health.staffingGapStatus} />
        </button>

        {/* 2. Hour Limit Warnings */}
        <button
          type="button"
          onClick={onInspectHourLimitWarnings}
          disabled={health.hourLimitWarningCount === 0}
          title="Staff whose union-of-hours assigned exceeds maxWeeklyHours."
          className="flex items-center justify-between gap-3 px-4 py-3 text-left transition enabled:hover:bg-slate-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
        >
          <div>
            <p className="text-xs font-medium text-slate-600">Hour Limit Warnings</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">
              {health.hourLimitWarningCount}
              <span className="ml-1 text-xs font-normal text-slate-600">staff</span>
            </p>
            <p className="text-[11px] text-slate-600">
              {health.hourLimitWarningCount === 0
                ? 'Everyone within cap'
                : 'Click to highlight on roster'}
            </p>
          </div>
          <StatusBadge status={health.hourLimitWarningStatus} />
        </button>

        {/* 3. Demand Coverage */}
        <button
          type="button"
          onClick={onInspectGapsOrCoverage}
          title="Percentage of required staff-hours covered across 7×16 operating hours. Good ≥90%, Attention 75–89%, Warning <75%."
          className="flex items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
        >
          <div>
            <p className="text-xs font-medium text-slate-600">Demand Coverage</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{coveragePct}</p>
            <p className="text-[11px] text-slate-600">{coverageSubtext}</p>
          </div>
          <StatusBadge status={health.demandCoverageStatus} />
        </button>

        {/* 4. Hour Fairness */}
        <div
          title="Jain Fairness Index across eligible staff (maxWeeklyHours > 0) based on utilization ratio. Good ≥90%, Attention 80–89%, Warning <80%."
          className="flex items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <p className="text-xs font-medium text-slate-600">Hour Fairness</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{fairnessPct}</p>
            <p className="text-[11px] text-slate-600">{fairnessSubtext}</p>
          </div>
          <StatusBadge status={health.fairnessStatus} />
        </div>
      </div>
    </section>
  );
}
