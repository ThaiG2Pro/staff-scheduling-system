/**
 * @file Executive-grade 4-KPI Schedule Health Strip (`AC-05`) inspired by Legion WFM,
 * Deputy, and 7shifts. Evaluates Staffing Gaps, Hour Limit Warnings, Demand Coverage,
 * and Hour Fairness (Jain Index) independently on unrounded floats with high-contrast
 * visual hierarchy, semantic left accents, hero tabular values, and drill-down affordances.
 */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  Minus,
  Scale,
  TrendingUp,
  UserX,
} from 'lucide-react';
import type { HealthStatus, ScheduleHealth } from '../../domain/types';

export interface ScheduleHealthBarProps {
  health: ScheduleHealth;
  onInspectGapsOrCoverage: () => void;
  onInspectHourLimitWarnings: () => void;
}

interface StatusStyle {
  accent: string;
  pill: string;
  bar: string;
  iconBox: string;
  valueTone: string;
  label: string;
}

function getStatusStyle(status: HealthStatus): StatusStyle {
  if (status === 'good') {
    return {
      accent: 'border-l-emerald-500',
      pill: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      bar: 'bg-emerald-600',
      iconBox: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
      valueTone: 'text-slate-900',
      label: 'Good',
    };
  }
  if (status === 'attention') {
    return {
      accent: 'border-l-amber-500',
      pill: 'border-amber-300 bg-amber-50 text-amber-900',
      bar: 'bg-amber-500',
      iconBox: 'bg-amber-50 text-amber-700 border-amber-200/80',
      valueTone: 'text-amber-950',
      label: 'Attention',
    };
  }
  if (status === 'warning') {
    return {
      accent: 'border-l-rose-500',
      pill: 'border-rose-300 bg-rose-50 text-rose-800',
      bar: 'bg-rose-600',
      iconBox: 'bg-rose-50 text-rose-700 border-rose-200/80',
      valueTone: 'text-rose-900',
      label: 'Warning',
    };
  }
  return {
    accent: 'border-l-slate-400',
    pill: 'border-slate-300 bg-slate-100 text-slate-700',
    bar: 'bg-slate-400',
    iconBox: 'bg-slate-100 text-slate-600 border-slate-200',
    valueTone: 'text-slate-700',
    label: 'Neutral',
  };
}

function StatusPill({ status }: { status: HealthStatus }) {
  const style = getStatusStyle(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.pill}`}
    >
      {status === 'good' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
      {status === 'attention' && <CircleDot className="h-3 w-3" aria-hidden="true" />}
      {status === 'warning' && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {status === 'neutral' && <Minus className="h-3 w-3" aria-hidden="true" />}
      {style.label}
    </span>
  );
}

/**
 * Displays 4 independent, elevated KPI cards for instant 3-second schedule diagnostics.
 * Never merges independent health signals into a composite score.
 *
 * @param props - Derived `ScheduleHealth` metrics and drill-down callbacks.
 * @returns 4-card KPI grid.
 */
export function ScheduleHealthBar({
  health,
  onInspectGapsOrCoverage,
  onInspectHourLimitWarnings,
}: ScheduleHealthBarProps) {
  const hasDemand = health.staffingGapCount !== null;
  const gapStyle = getStatusStyle(health.staffingGapStatus);
  const hlStyle = getStatusStyle(health.hourLimitWarningStatus);
  const covStyle = getStatusStyle(health.demandCoverageStatus);
  const fairStyle = getStatusStyle(health.fairnessStatus);

  const covRatio = health.demandCoverage?.ratio ?? null;
  const covPctNum = covRatio !== null ? Math.min(100, Math.round(covRatio * 100)) : null;

  const jainPctNum =
    health.fairnessJainIndex !== null
      ? Math.min(100, Math.round(health.fairnessJainIndex * 100))
      : null;

  const cardBase =
    'group relative flex min-w-0 flex-col justify-between rounded-xl border border-slate-300/80 border-l-4 bg-white px-4 py-3.5 text-left shadow-xs transition';

  return (
    <section
      aria-label="Schedule health"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* KPI 1: Staffing Gaps */}
      <button
        type="button"
        onClick={onInspectGapsOrCoverage}
        title="Operating hours with customer transactions > 0 and 0 staff scheduled. Click to inspect Hourly Summary."
        className={`${cardBase} ${gapStyle.accent} hover:border-slate-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${gapStyle.iconBox}`}
            >
              <UserX className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Staffing Gaps
            </span>
          </div>
          <StatusPill status={health.staffingGapStatus} />
        </div>

        <div className="mt-2.5 flex items-baseline gap-1.5">
          <span
            className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${gapStyle.valueTone}`}
          >
            {!hasDemand ? '–' : health.staffingGapCount}
          </span>
          {hasDemand && (
            <span className="text-sm font-medium text-slate-600">
              {health.staffingGapCount === 1 ? 'gap' : 'gaps'}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-1 text-xs font-medium text-slate-600">
          <span className="leading-snug">
            {!hasDemand ? 'Import CSV to evaluate' : 'Busy hours with 0 staff'}
          </span>
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600"
            aria-hidden="true"
          />
        </div>
      </button>

      {/* KPI 2: Hour Limit Warnings */}
      <button
        type="button"
        onClick={onInspectHourLimitWarnings}
        disabled={health.hourLimitWarningCount === 0}
        title="Team members exceeding their weekly hour cap. Click to highlight on Weekly Roster."
        className={`${cardBase} ${hlStyle.accent} enabled:hover:border-slate-400 enabled:hover:shadow-sm disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${hlStyle.iconBox}`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Hour Limit Warnings
            </span>
          </div>
          <StatusPill status={health.hourLimitWarningStatus} />
        </div>

        <div className="mt-2.5 flex items-baseline gap-1.5">
          <span
            className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${hlStyle.valueTone}`}
          >
            {health.hourLimitWarningCount}
          </span>
          <span className="text-sm font-medium text-slate-600">staff</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-1 text-xs font-medium text-slate-600">
          <span className="leading-snug">
            {health.hourLimitWarningCount === 0
              ? 'All within weekly limits'
              : 'Click to highlight over-limit staff'}
          </span>
          {health.hourLimitWarningCount > 0 && (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-rose-500 transition group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          )}
        </div>
      </button>

      {/* KPI 3: Demand Coverage */}
      <button
        type="button"
        onClick={onInspectGapsOrCoverage}
        title="Share of hourly staffing demand covered (≥90% Good, 75–<90% Attention, <75% Warning). Click to view Hourly Summary."
        className={`${cardBase} ${covStyle.accent} hover:border-slate-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${covStyle.iconBox}`}
            >
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Demand Coverage
            </span>
          </div>
          <StatusPill status={health.demandCoverageStatus} />
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <span
            className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${covStyle.valueTone}`}
          >
            {covRatio === null ? '–' : `${(covRatio * 100).toFixed(1)}%`}
          </span>
          {covPctNum !== null && (
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${covStyle.bar}`}
                style={{ width: `${covPctNum}%` }}
              />
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-1 text-xs font-medium text-slate-600">
          <span className="leading-snug">
            {covRatio === null ? 'No demand loaded' : 'Hourly demand met · ≥90% Good'}
          </span>
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-600"
            aria-hidden="true"
          />
        </div>
      </button>

      {/* KPI 4: Hour Fairness */}
      <div
        title="Jain Fairness Index (0.00–1.00) measuring how evenly weekly hour caps are utilized across active team members."
        className={`${cardBase} ${fairStyle.accent}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${fairStyle.iconBox}`}
            >
              <Scale className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Hour Fairness
            </span>
          </div>
          <StatusPill status={health.fairnessStatus} />
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <span
            className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${fairStyle.valueTone}`}
          >
            {jainPctNum === null ? '–' : `${jainPctNum}%`}
          </span>
          {jainPctNum !== null && (
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${fairStyle.bar}`}
                style={{ width: `${jainPctNum}%` }}
              />
            </div>
          )}
        </div>

        <p className="mt-2 text-xs font-medium leading-snug text-slate-600">
          {health.fairnessJainIndex === null
            ? 'No hours assigned yet'
            : health.isSingleEligibleStaff
              ? '1 active staff — no comparison'
              : `Team balance · Jain ${health.fairnessJainIndex.toFixed(2)}`}
        </p>
      </div>
    </section>
  );
}
