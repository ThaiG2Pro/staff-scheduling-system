/**
 * @file P0 Aggregated Summary View (`AC-05`) rendering the 4 mandatory weekly KPI cards
 * and the 7×16 hourly grid (`Mon–Sun` × `07:00–22:00`) with 3 stacked metrics per cell
 * (Transactions, Union-of-hours Staff hours, Txns/staff hr) and 1-click jump to Roster.
 */

import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { DAYS_OF_WEEK, DAY_LABELS, OPERATING_HOURS } from '../../domain/constants';
import type { AggregatedSummary, DayOfWeek, OperatingHour } from '../../domain/types';
import { formatHour24 } from '../common/formatters';

export interface AggregatedSummaryViewProps {
  summary: AggregatedSummary;
  targetN: number;
  onJumpToRosterCell: (day: DayOfWeek, hour: OperatingHour) => void;
}

function formatRate(value: number | null): string {
  if (value === null) return '–';
  return value.toFixed(1);
}

/**
 * Displays the 4 weekly summary KPIs and 7×16 P0 hourly breakdown table.
 * Clicking any `Gap` or `High Load` (`txns/hr > targetN`) cell navigates directly to the
 * corresponding day and covering shifts in `WeeklyRosterGrid`.
 *
 * @param props - Derived `AggregatedSummary`, active `targetN`, and jump callback.
 * @returns Summary KPI strip and 7×16 hourly matrix.
 */
export function AggregatedSummaryView({
  summary,
  targetN,
  onJumpToRosterCell,
}: AggregatedSummaryViewProps) {
  return (
    <div className="space-y-4 p-4">
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

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-800">Cell lines:</span>
          <span>1. Transactions</span>
          <span>2. Staff hrs</span>
          <span>3. Txns / staff hr (Target {targetN})</span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-0.5 font-medium text-rose-800">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Gap (click to fix)
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            High load (&gt;{targetN}/h)
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            – Idle (0/0)
          </span>
        </div>
      </div>

      {/* 7x16 Hourly Detail Matrix (P0: no daily total row) */}
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
              {DAYS_OF_WEEK.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={`sticky top-0 z-20 border-r border-slate-200 px-2.5 py-2 text-center text-xs font-semibold text-slate-900 last:border-r-0 ${
                    day >= 5 ? 'bg-slate-200/70' : 'bg-slate-100'
                  }`}
                >
                  {DAY_LABELS[day]}
                </th>
              ))}
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

                  let cellBg = day >= 5 ? 'bg-slate-50/70' : 'bg-white';
                  if (isGap) cellBg = 'bg-rose-50 hover:bg-rose-100/80';
                  else if (isHighLoad) cellBg = 'bg-amber-50 hover:bg-amber-100/80';
                  else if (isZeroZero) cellBg = 'bg-slate-100/70';

                  const content = (
                    <div className="space-y-0.5 text-center leading-tight">
                      <p className="text-[11px] font-medium text-slate-700">
                        {cell.transactions !== null ? `${cell.transactions} txns` : '–'}
                      </p>
                      <p className="text-[11px] text-slate-600">{cell.staffHours} staff</p>
                      {isGap ? (
                        <p className="inline-flex items-center justify-center gap-0.5 text-[11px] font-bold text-rose-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />– (Gap)
                        </p>
                      ) : isHighLoad ? (
                        <p className="inline-flex items-center justify-center gap-0.5 text-[11px] font-bold text-amber-900">
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

                  return (
                    <td
                      key={day}
                      className={`border-r border-slate-200 p-0 last:border-r-0 ${cellBg}`}
                    >
                      {isActionable ? (
                        <button
                          type="button"
                          onClick={() => onJumpToRosterCell(day, hour)}
                          aria-label={`${DAY_LABELS[day]} ${formatHour24(hour)} ${
                            isGap ? 'staffing gap' : 'high load'
                          } — jump to Weekly Roster`}
                          title="Click to inspect and fix this hour on Weekly Roster"
                          className="w-full px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="px-2 py-1.5">{content}</div>
                      )}
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
