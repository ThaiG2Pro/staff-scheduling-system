/**
 * @file Minimalist, high-clarity Daily Demand vs. Scheduled SVG chart (`07:00–22:00`).
 * Controlled by the 7×16 table selection in `AggregatedSummaryView` (zero duplicate day bar)
 * and owns the single contextual `... on Roster` CTA for the active day or hour.
 */

import { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  X,
} from 'lucide-react';
import { DAY_LABELS, OPERATING_HOURS } from '../../domain/constants';
import type { AggregatedSummary, DayOfWeek, OperatingHour } from '../../domain/types';
import { formatHour24 } from '../common/formatters';

export interface DailyDemandChartProps {
  summary: AggregatedSummary;
  targetN: number;
  day: DayOfWeek;
  /** Currently selected hour on `day` (null when whole day is selected). */
  selectedHour: OperatingHour | null;
  /** Optional subtle context badge (e.g. "From Roster" or "Coverage focus"). */
  contextLabel?: string | null;
  onSelectHour: (hour: OperatingHour) => void;
  onClearHour: () => void;
  onClose: () => void;
  onOpenRoster: () => void;
}

const CHART_WIDTH = 840;
const CHART_HEIGHT = 236;
const PAD_TOP = 28;
const PAD_RIGHT = 20;
const PAD_BOTTOM = 32;
const PAD_LEFT = 38;
const PLOT_WIDTH = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** Picks integer Y-axis tick values cleanly spaced from 0 to `maxY`. */
function buildYTicks(maxY: number): number[] {
  const step = maxY <= 6 ? 1 : maxY <= 12 ? 2 : maxY <= 25 ? 5 : Math.ceil(maxY / 5);
  const ticks: number[] = [];
  for (let v = 0; v <= maxY; v += step) {
    ticks.push(v);
  }
  if (ticks[ticks.length - 1] !== maxY) {
    ticks.push(maxY);
  }
  return ticks;
}

/**
 * Renders the hourly (`07:00–22:00`) Demand vs. Scheduled comparison chart for a single day.
 * Features hatched shortage caps, smooth demand area wash, inline delta micro-labels,
 * two-way hour selection with the 7×16 table, and the single Roster navigation button.
 */
export function DailyDemandChart({
  summary,
  targetN,
  day,
  selectedHour,
  contextLabel = null,
  onSelectHour,
  onClearHour,
  onClose,
  onOpenRoster,
}: DailyDemandChartProps) {
  const uid = useId().replace(/:/g, '');
  const [hoveredHour, setHoveredHour] = useState<OperatingHour | null>(null);

  const { points, rollup } = useMemo(() => {
    let scheduledHours = 0;
    let requiredHours = 0;
    let shortageHours = 0;
    let surplusHours = 0;
    let gapCount = 0;
    let transactions = 0;
    let hasDemand = false;

    const list = OPERATING_HOURS.map((hour, index) => {
      const cell = summary.cells[day][hour];
      const scheduled = cell.staffHours;
      const required = cell.requiredStaff;
      const delta = cell.coverageDelta;
      const isGap = cell.isStaffingGap;
      const isHighLoad =
        !isGap && cell.txnsPerStaffHour !== null && cell.txnsPerStaffHour > targetN;
      const isShortage = delta !== null && delta < 0;
      const isSurplus = delta !== null && delta > 0;
      const isExact = delta === 0 && required !== null && required > 0;
      const isActionable = isGap || isHighLoad || isShortage;

      scheduledHours += scheduled;
      if (cell.transactions !== null) {
        hasDemand = true;
        transactions += cell.transactions;
      }
      if (required !== null) requiredHours += required;
      if (isGap) gapCount += 1;
      if (delta !== null) {
        if (delta < 0) shortageHours += -delta;
        else if (delta > 0) surplusHours += delta;
      }

      return {
        index,
        hour,
        cell,
        scheduled,
        required,
        delta,
        isGap,
        isHighLoad,
        isShortage,
        isSurplus,
        isExact,
        isActionable,
      };
    });

    return {
      points: list,
      rollup: {
        scheduledHours,
        requiredHours,
        shortageHours,
        surplusHours,
        gapCount,
        transactions,
        hasDemand,
      },
    };
  }, [summary, day, targetN]);

  const hasDemand = rollup.hasDemand;

  const maxY = useMemo(() => {
    let peak = 4;
    for (const p of points) {
      if (p.scheduled > peak) peak = p.scheduled;
      if (p.required !== null && p.required > peak) peak = p.required;
    }
    return peak;
  }, [points]);

  const yTicks = useMemo(() => buildYTicks(maxY), [maxY]);
  const slotWidth = PLOT_WIDTH / OPERATING_HOURS.length;
  const barWidth = Math.min(30, slotWidth * 0.56);

  const yForValue = (val: number) => PAD_TOP + PLOT_HEIGHT - (val / maxY) * PLOT_HEIGHT;
  const xCenterForIndex = (idx: number) => PAD_LEFT + idx * slotWidth + slotWidth / 2;

  const { demandLinePath, demandAreaPath } = useMemo(() => {
    if (!hasDemand || points.length === 0) {
      return { demandLinePath: '', demandAreaPath: '' };
    }
    const coords = points.map((p, idx) => ({
      x: xCenterForIndex(idx),
      y: yForValue(p.required ?? 0),
    }));
    const line = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const baselineY = yForValue(0).toFixed(1);
    const firstX = coords[0]!.x.toFixed(1);
    const lastX = coords[coords.length - 1]!.x.toFixed(1);
    const area = `${line} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
    return { demandLinePath: line, demandAreaPath: area };
  }, [hasDemand, points, maxY]);

  const inspectedHour: OperatingHour | null = hoveredHour ?? selectedHour;
  const inspectedPoint =
    inspectedHour !== null ? points.find((p) => p.hour === inspectedHour) ?? null : null;

  const selectedPoint =
    selectedHour !== null ? points.find((p) => p.hour === selectedHour) ?? null : null;

  const coveragePct =
    hasDemand && rollup.requiredHours > 0
      ? Math.round(((rollup.requiredHours - rollup.shortageHours) / rollup.requiredHours) * 100)
      : null;

  const rosterCtaLabel =
    selectedHour !== null
      ? selectedPoint?.isActionable
        ? `Fix ${DAY_LABELS[day]} ${formatHour24(selectedHour)} on Roster`
        : `Open ${DAY_LABELS[day]} ${formatHour24(selectedHour)} on Roster`
      : `Open ${DAY_LABELS[day]} on Roster`;

  const isPrimaryWarningCta =
    selectedHour !== null ? Boolean(selectedPoint?.isActionable) : rollup.shortageHours > 0;

  return (
    <section
      aria-label="Daily demand vs. scheduled chart"
      className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm"
    >
      {/* Clean single-row header with Day summary + THE single Roster CTA + Close */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50/70 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200/70">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-bold tracking-tight text-slate-900">
            {DAY_LABELS[day]}
            {selectedHour !== null && (
              <span className="ml-1.5 font-semibold text-indigo-700">
                · {formatHour24(selectedHour)}
              </span>
            )}
          </h3>
          {contextLabel && (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
              {contextLabel}
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 tabular-nums">
            {hasDemand
              ? `${rollup.scheduledHours} / ${rollup.requiredHours} staff-hrs${
                  coveragePct !== null ? ` · ${coveragePct}%` : ''
                }`
              : `${rollup.scheduledHours} staff-hrs`}
          </span>
          {hasDemand && rollup.shortageHours > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 tabular-nums">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />-{rollup.shortageHours}h
              shortage
            </span>
          )}
          {hasDemand && rollup.shortageHours === 0 && rollup.requiredHours > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Covered
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedHour !== null && (
            <button
              type="button"
              onClick={onClearHour}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Whole {DAY_LABELS[day]}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenRoster}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-2xs transition ${
              isPrimaryWarningCta
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {rosterCtaLabel}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close daily demand chart"
            title="Close chart"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div className="space-y-2.5 px-4 pb-3.5 pt-3">
        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600">
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-slate-900" aria-hidden="true" />
              Demand (required)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" aria-hidden="true" />
              Scheduled (covered)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-xs border border-rose-500 bg-rose-100"
                aria-hidden="true"
              />
              Shortage gap
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-sky-400" aria-hidden="true" />
              Surplus
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Click any hour bar to focus · Click another day header below to switch
          </span>
        </div>

        {/* Responsive SVG chart */}
        <div className="overflow-x-auto rounded-lg border border-slate-100 bg-slate-50/40 px-1 py-1">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-auto w-full min-w-[660px] select-none"
            role="img"
            aria-label={`${DAY_LABELS[day]} hourly demand vs. scheduled staff chart from 07:00 to 22:00`}
            onMouseLeave={() => setHoveredHour(null)}
          >
            <defs>
              {/* Soft wash under Demand curve */}
              <linearGradient id={`demand-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0f172a" stopOpacity="0.09" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0.01" />
              </linearGradient>

              {/* Covered scheduled emerald gradient */}
              <linearGradient id={`bar-covered-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>

              {/* Partial scheduled slate gradient (under shortage) */}
              <linearGradient id={`bar-partial-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#64748b" />
                <stop offset="100%" stopColor="#475569" />
              </linearGradient>

              {/* Neutral indigo gradient (when no demand CSV imported) */}
              <linearGradient id={`bar-neutral-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#4f46e5" />
              </linearGradient>

              {/* Surplus sky gradient */}
              <linearGradient id={`bar-surplus-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>

              {/* Diagonal rose hatch for shortage gap */}
              <pattern
                id={`hatch-shortage-${uid}`}
                width="6"
                height="6"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="6" height="6" fill="#fff1f2" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#fda4af" strokeWidth="2.2" />
              </pattern>
            </defs>

            {/* Horizontal Y-axis gridlines & labels */}
            {yTicks.map((tick) => {
              const y = yForValue(tick);
              return (
                <g key={tick}>
                  <line
                    x1={PAD_LEFT}
                    x2={CHART_WIDTH - PAD_RIGHT}
                    y1={y}
                    y2={y}
                    stroke={tick === 0 ? '#cbd5e1' : '#e2e8f0'}
                    strokeDasharray={tick === 0 ? undefined : '3 4'}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_LEFT - 10}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-semibold tabular-nums"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            {/* Soft Demand Area Wash behind bars */}
            {hasDemand && demandAreaPath && (
              <path d={demandAreaPath} fill={`url(#demand-area-${uid})`} pointerEvents="none" />
            )}

            {/* Hourly bars & interactive hit columns */}
            {points.map((p) => {
              const cx = xCenterForIndex(p.index);
              const xBar = cx - barWidth / 2;
              const yZero = yForValue(0);
              const isSelected = selectedHour === p.hour;
              const isHovered = hoveredHour === p.hour;
              const isActive = isSelected || isHovered;

              const reqVal = p.required ?? 0;
              const coveredVal = hasDemand ? Math.min(p.scheduled, reqVal) : p.scheduled;

              const coveredY = yForValue(coveredVal);
              const coveredH = Math.max(0, yZero - coveredY);

              const surplusY = yForValue(p.scheduled);
              const surplusH =
                hasDemand && p.scheduled > reqVal ? Math.max(0, coveredY - surplusY) : 0;

              const shortageY = yForValue(reqVal);
              const shortageH =
                hasDemand && reqVal > p.scheduled
                  ? Math.max(0, yForValue(p.scheduled) - shortageY)
                  : 0;

              const topY = yForValue(Math.max(p.scheduled, reqVal));

              return (
                <g
                  key={p.hour}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredHour(p.hour)}
                  onClick={() => onSelectHour(p.hour)}
                >
                  {/* Selected / Hovered column spotlight */}
                  {isActive && (
                    <rect
                      x={PAD_LEFT + p.index * slotWidth + 2}
                      y={PAD_TOP - 8}
                      width={slotWidth - 4}
                      height={PLOT_HEIGHT + 8}
                      rx={8}
                      fill={isSelected ? '#eef2ff' : '#f1f5f9'}
                      stroke={isSelected ? '#6366f1' : '#cbd5e1'}
                      strokeWidth={isSelected ? 1.5 : 1}
                    />
                  )}

                  {/* Transparent full-column hit target */}
                  <rect
                    x={PAD_LEFT + p.index * slotWidth}
                    y={PAD_TOP - 8}
                    width={slotWidth}
                    height={PLOT_HEIGHT + PAD_BOTTOM + 8}
                    fill="transparent"
                  />

                  {/* Covered / Scheduled base bar */}
                  {coveredH > 0 && (
                    <rect
                      x={xBar}
                      y={coveredY}
                      width={barWidth}
                      height={coveredH}
                      rx={surplusH === 0 && shortageH === 0 ? 4 : 0}
                      fill={
                        !hasDemand
                          ? `url(#bar-neutral-${uid})`
                          : p.isShortage
                            ? `url(#bar-partial-${uid})`
                            : `url(#bar-covered-${uid})`
                      }
                      opacity={isActive ? 1 : 0.9}
                    />
                  )}

                  {/* Surplus cap above required */}
                  {surplusH > 0 && (
                    <rect
                      x={xBar}
                      y={surplusY}
                      width={barWidth}
                      height={surplusH}
                      rx={4}
                      fill={`url(#bar-surplus-${uid})`}
                      opacity={isActive ? 1 : 0.88}
                    />
                  )}

                  {/* Hatched shortage gap cap */}
                  {shortageH > 0 && (
                    <rect
                      x={xBar}
                      y={shortageY}
                      width={barWidth}
                      height={shortageH}
                      rx={4}
                      fill={`url(#hatch-shortage-${uid})`}
                      stroke="#e11d48"
                      strokeWidth={1.35}
                      opacity={isActive ? 1 : 0.95}
                    />
                  )}

                  {/* Micro delta label above shortage/surplus bars */}
                  {hasDemand && p.delta !== null && p.delta !== 0 && (
                    <text
                      x={cx}
                      y={Math.max(12, topY - 7)}
                      textAnchor="middle"
                      className={`text-[9.5px] font-bold tabular-nums ${
                        p.delta < 0 ? 'fill-rose-700' : 'fill-sky-700'
                      }`}
                    >
                      {p.delta > 0 ? `+${p.delta}` : p.delta}
                    </text>
                  )}

                  {/* X-axis hour label */}
                  <text
                    x={cx}
                    y={CHART_HEIGHT - 10}
                    textAnchor="middle"
                    className={`text-[10.5px] tabular-nums ${
                      isSelected
                        ? 'fill-indigo-700 font-bold'
                        : isHovered
                          ? 'fill-slate-900 font-bold'
                          : p.isShortage || p.isGap
                            ? 'fill-rose-700 font-semibold'
                            : 'fill-slate-500 font-medium'
                    }`}
                  >
                    {String(p.hour).padStart(2, '0')}h
                  </text>
                </g>
              );
            })}

            {/* Demand (Required staff) line & ringed markers */}
            {hasDemand && demandLinePath && (
              <g pointerEvents="none">
                <path
                  d={demandLinePath}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((p) => {
                  const cx = xCenterForIndex(p.index);
                  const cy = yForValue(p.required ?? 0);
                  const isActive = selectedHour === p.hour || hoveredHour === p.hour;
                  const dotFill =
                    p.isGap || p.isShortage
                      ? '#e11d48'
                      : p.isExact
                        ? '#059669'
                        : p.isSurplus
                          ? '#0284c7'
                          : '#475569';
                  return (
                    <circle
                      key={p.hour}
                      cx={cx}
                      cy={cy}
                      r={isActive ? 5.2 : 3.6}
                      fill={dotFill}
                      stroke="#ffffff"
                      strokeWidth={1.75}
                    />
                  );
                })}
              </g>
            )}
          </svg>
        </div>

        {/* Compact live readout strip (read-only — no duplicate Roster CTA) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-xs text-slate-700">
          {inspectedPoint ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                {DAY_LABELS[day]} {formatHour24(inspectedPoint.hour)}
              </span>
              <span>
                Scheduled: <strong className="text-slate-900">{inspectedPoint.scheduled}</strong>
              </span>
              {hasDemand && (
                <>
                  <span>
                    Required:{' '}
                    <strong className="text-slate-900">{inspectedPoint.required ?? 0}</strong>
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                      inspectedPoint.isShortage || inspectedPoint.isGap
                        ? 'bg-rose-100 text-rose-800'
                        : inspectedPoint.isExact
                          ? 'bg-emerald-100 text-emerald-800'
                          : inspectedPoint.isSurplus
                            ? 'bg-sky-100 text-sky-800'
                            : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {inspectedPoint.delta === null
                      ? '–'
                      : inspectedPoint.delta > 0
                        ? `+${inspectedPoint.delta} surplus`
                        : inspectedPoint.delta < 0
                          ? `${inspectedPoint.delta} shortage`
                          : 'Exact match'}
                  </span>
                  <span className="text-slate-500">
                    {inspectedPoint.cell.transactions ?? 0} txns
                    {inspectedPoint.cell.txnsPerStaffHour !== null
                      ? ` · ${inspectedPoint.cell.txnsPerStaffHour.toFixed(1)} txns/staff hr`
                      : ''}
                  </span>
                </>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">
              {hasDemand
                ? `Showing all 16 hours for ${DAY_LABELS[day]} (${rollup.transactions.toLocaleString()} txns). Hover or click any hour bar to pin details.`
                : `No demand CSV imported yet — showing scheduled staff hours for ${DAY_LABELS[day]}.`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
