/**
 * @file Unified 4-signal Schedule Health Bar (`AC-05`) evaluating Staffing Gaps,
 * Hour Limit Warnings, Demand Coverage, and Hour Fairness (Jain Index) independently
 * on unrounded floats with user-friendly Store Manager copy and WCAG icon + text badges.
 */

import { AlertTriangle, CheckCircle2, CircleDot, Minus } from 'lucide-react';
import type { HealthStatus, ScheduleHealth } from '../../domain/types';

export interface ScheduleHealthBarProps {
  health: ScheduleHealth;
  onInspectGapsOrCoverage: () => void;
  onInspectHourLimitWarnings: () => void;
}

function getTone(status: HealthStatus): {
  pill: string;
  bar: string;
  label: string;
} {
  if (status === 'good') {
    return {
      pill: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      bar: 'bg-emerald-600',
      label: 'Good',
    };
  }
  if (status === 'attention') {
    return {
      pill: 'border-amber-300 bg-amber-50 text-amber-900',
      bar: 'bg-amber-500',
      label: 'Attention',
    };
  }
  if (status === 'warning') {
    return {
      pill: 'border-rose-300 bg-rose-50 text-rose-800',
      bar: 'bg-rose-600',
      label: 'Warning',
    };
  }
  return {
    pill: 'border-slate-300 bg-slate-100 text-slate-700',
    bar: 'bg-slate-400',
    label: 'Neutral',
  };
}

function StatusPill({ status }: { status: HealthStatus }) {
  const tone = getTone(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.pill}`}
    >
      {status === 'good' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
      {status === 'attention' && <CircleDot className="h-3 w-3" aria-hidden="true" />}
      {status === 'warning' && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {status === 'neutral' && <Minus className="h-3 w-3" aria-hidden="true" />}
      {tone.label}
    </span>
  );
}

/**
 * Displays the 4 independent Schedule Health signals in a responsive 4-column strip.
 * Uses plain Store Manager language, large tabular metrics, progress bars, and full text wrap
 * so no card content is ever clipped.
 *
 * @param props - Derived `ScheduleHealth` metrics and click-to-inspect callbacks.
 * @returns 4-column Health Strip.
 */
export function ScheduleHealthBar({
  health,
  onInspectGapsOrCoverage,
  onInspectHourLimitWarnings,
}: ScheduleHealthBarProps) {
  const hasDemand = health.staffingGapCount !== null;

  const gapVal = !hasDemand
    ? '–'
    : `${health.staffingGapCount} ${health.staffingGapCount === 1 ? 'gap' : 'gaps'}`;
  const gapSub = !hasDemand ? 'Import CSV to evaluate' : 'Busy hours with 0 staff';

  const hlVal = `${health.hourLimitWarningCount} staff`;
  const hlSub =
    health.hourLimitWarningCount === 0
      ? 'All within weekly limits'
      : 'Click to highlight over-limit staff';

  const covRatio = health.demandCoverage?.ratio ?? null;
  const covPctNum = covRatio !== null ? Math.min(100, Math.round(covRatio * 100)) : null;
  const covVal = covRatio === null ? '–' : `${(covRatio * 100).toFixed(1)}%`;
  const covSub =
    covRatio === null ? 'No demand loaded' : 'Hourly demand met · ≥90% Good';

  const jainPctNum =
    health.fairnessJainIndex !== null
      ? Math.min(100, Math.round(health.fairnessJainIndex * 100))
      : null;
  const jainVal = jainPctNum === null ? '–' : `${jainPctNum}%`;
  const jainSub =
    health.fairnessJainIndex === null
      ? 'No hours assigned yet'
      : health.isSingleEligibleStaff
        ? '1 active staff — no comparison'
        : `Team balance · Jain ${health.fairnessJainIndex.toFixed(2)}`;

  return (
    <section
      aria-label="Schedule health"
      className="overflow-hidden rounded-xl border border-slate-300/80 bg-white shadow-xs"
    >
      <div className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 sm:gap-px sm:bg-slate-200 xl:grid-cols-4">
        {/* 1. Staffing Gaps */}
        <button
          type="button"
          onClick={onInspectGapsOrCoverage}
          title="Operating hours with transactions > 0 and 0 staff. Click to inspect Hourly Summary."
          className="flex min-w-0 flex-col justify-between bg-white px-4 py-3.5 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Staffing Gaps</span>
            <StatusPill status={health.staffingGapStatus} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {gapVal}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600">{gapSub}</p>
        </button>

        {/* 2. Hour Limit Warnings */}
        <button
          type="button"
          onClick={onInspectHourLimitWarnings}
          disabled={health.hourLimitWarningCount === 0}
          title="Staff exceeding their weekly hour limit. Click to highlight on roster."
          className="flex min-w-0 flex-col justify-between bg-white px-4 py-3.5 text-left transition enabled:hover:bg-slate-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Hour Limit Warnings</span>
            <StatusPill status={health.hourLimitWarningStatus} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {hlVal}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600">{hlSub}</p>
        </button>

        {/* 3. Demand Coverage */}
        <button
          type="button"
          onClick={onInspectGapsOrCoverage}
          title="Share of hourly staffing demand covered (≥90% Good, 75–<90% Attention, <75% Warning). Click to view Hourly Summary."
          className="flex min-w-0 flex-col justify-between bg-white px-4 py-3.5 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Demand Coverage</span>
            <StatusPill status={health.demandCoverageStatus} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {covVal}
            </span>
            {covPctNum !== null && (
              <div className="h-2 flex-1 max-w-[100px] overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${getTone(health.demandCoverageStatus).bar}`}
                  style={{ width: `${covPctNum}%` }}
                />
              </div>
            )}
          </div>
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600">{covSub}</p>
        </button>

        {/* 4. Hour Fairness */}
        <div
          title="Jain Fairness Index (0.00–1.00) measuring how evenly weekly hour caps are utilized across active team members."
          className="flex min-w-0 flex-col justify-between bg-white px-4 py-3.5 text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Hour Fairness</span>
            <StatusPill status={health.fairnessStatus} />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {jainVal}
            </span>
            {jainPctNum !== null && (
              <div className="h-2 flex-1 max-w-[100px] overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all ${getTone(health.fairnessStatus).bar}`}
                  style={{ width: `${jainPctNum}%` }}
                />
              </div>
            )}
          </div>
          <p className="mt-1 text-xs font-medium leading-snug text-slate-600">{jainSub}</p>
        </div>
      </div>
    </section>
  );
}
