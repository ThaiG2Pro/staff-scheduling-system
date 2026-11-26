/**
 * @file Sticky right-hand Team (`StaffPanel`) sidebar with initials Avatars, Team Capacity Totals,
 * Search, Filter (`All` / `Under cap` / `Over limit`), Sort (`Name` / `Hrs left`), live
 * `assigned/max` meters, local shift warnings, click-to-highlight, and Edit/Delete controls (`AC-01`).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { DAY_LABELS } from '../../domain/constants';
import type { Staff, StaffMetrics } from '../../domain/types';
import { formatWeekdaySummary } from '../common/WeekdayToggleGroup';

export type StaffFilterMode = 'all' | 'under_cap' | 'over_limit';
export type StaffSortMode = 'name' | 'hrs_left' | 'utilization';

export interface StaffPanelProps {
  staff: readonly Staff[];
  staffMetrics: Record<string, StaffMetrics>;
  highlightedStaffId: string | null;
  filterMode?: StaffFilterMode;
  onFilterModeChange?: (mode: StaffFilterMode) => void;
  sortMode?: StaffSortMode;
  onSortModeChange?: (mode: StaffSortMode) => void;
  fairnessExtremes?: {
    highestStaffIds: ReadonlySet<string>;
    lowestStaffIds: ReadonlySet<string>;
  } | null;
  onSelectStaff: (staffId: string | null) => void;
  onAddStaff: () => void;
  onEditStaff: (staff: Staff) => void;
  onRequestDeleteStaff: (staff: Staff) => void;
}

const AVATAR_PALETTE = [
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-amber-100 text-amber-900 border-amber-200',
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-orange-100 text-orange-900 border-orange-200',
] as const;

function getAvatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

/**
 * Team sidebar displaying capacity totals, initials avatars, weekly hour meters,
 * filter/sort controls, and staff CRUD triggers without clipping on narrow screens.
 *
 * @param props - Team list, derived metrics, active highlight ID, and CRUD/selection handlers.
 * @returns Responsive sticky Team panel.
 */
export function StaffPanel({
  staff,
  staffMetrics,
  highlightedStaffId,
  filterMode: controlledFilterMode,
  onFilterModeChange,
  sortMode: controlledSortMode,
  onSortModeChange,
  fairnessExtremes = null,
  onSelectStaff,
  onAddStaff,
  onEditStaff,
  onRequestDeleteStaff,
}: StaffPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [uncontrolledFilterMode, setUncontrolledFilterMode] = useState<StaffFilterMode>('all');
  const [uncontrolledSortMode, setUncontrolledSortMode] = useState<StaffSortMode>('name');

  const filterMode = controlledFilterMode ?? uncontrolledFilterMode;
  const setFilterMode = (next: StaffFilterMode) => {
    if (onFilterModeChange) onFilterModeChange(next);
    else setUncontrolledFilterMode(next);
  };

  const sortMode = controlledSortMode ?? uncontrolledSortMode;
  const setSortMode = (next: StaffSortMode) => {
    if (onSortModeChange) onSortModeChange(next);
    else setUncontrolledSortMode(next);
  };

  const { totalAssigned, totalCapacity, underCapCount, overLimitCount } = useMemo(() => {
    let assigned = 0;
    let capacity = 0;
    let under = 0;
    let over = 0;
    for (const member of staff) {
      const m = staffMetrics[member.id];
      const hrs = m?.assignedHours ?? 0;
      assigned += hrs;
      capacity += member.maxWeeklyHours;
      if (hrs < member.maxWeeklyHours) under++;
      if (m?.isOverMaxHours ?? hrs > member.maxWeeklyHours) over++;
    }
    return {
      totalAssigned: assigned,
      totalCapacity: capacity,
      underCapCount: under,
      overLimitCount: over,
    };
  }, [staff, staffMetrics]);

  const visibleStaff = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = staff.filter((member) => {
      if (query && !member.name.toLowerCase().includes(query)) return false;
      const metrics = staffMetrics[member.id];
      const assigned = metrics?.assignedHours ?? 0;
      const isOver = metrics?.isOverMaxHours ?? assigned > member.maxWeeklyHours;
      if (filterMode === 'under_cap') return assigned < member.maxWeeklyHours;
      if (filterMode === 'over_limit') return isOver;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'utilization') {
        const utilA =
          staffMetrics[a.id]?.utilization ??
          (a.maxWeeklyHours > 0 ? (staffMetrics[a.id]?.assignedHours ?? 0) / a.maxWeeklyHours : 0);
        const utilB =
          staffMetrics[b.id]?.utilization ??
          (b.maxWeeklyHours > 0 ? (staffMetrics[b.id]?.assignedHours ?? 0) / b.maxWeeklyHours : 0);
        if (utilB !== utilA) return utilB - utilA;
        const hrsA = staffMetrics[a.id]?.assignedHours ?? 0;
        const hrsB = staffMetrics[b.id]?.assignedHours ?? 0;
        if (hrsB !== hrsA) return hrsB - hrsA;
      } else if (sortMode === 'hrs_left') {
        const remA = staffMetrics[a.id]?.remainingHours ?? Math.max(0, a.maxWeeklyHours);
        const remB = staffMetrics[b.id]?.remainingHours ?? Math.max(0, b.maxWeeklyHours);
        if (remB !== remA) return remB - remA;
      }
      return a.name.localeCompare(b.name);
    });
  }, [staff, staffMetrics, searchQuery, filterMode, sortMode]);

  return (
    <aside
      aria-label="Team panel"
      className="w-full shrink-0 overflow-hidden rounded-xl border border-slate-300/80 bg-white shadow-xs lg:sticky lg:top-16 lg:w-[268px] xl:w-[292px]"
    >
      {/* Header + Totals + Search/Filter/Sort */}
      <div className="space-y-2.5 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-700" aria-hidden="true" />
            <h2 className="text-sm font-bold text-slate-900">Team ({staff.length})</h2>
          </div>
          <button
            type="button"
            onClick={onAddStaff}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Staff
          </button>
        </div>

        <p className="text-xs text-slate-700 tabular-nums">
          Assigned <strong className="text-slate-900">{totalAssigned}h</strong> of{' '}
          <strong className="text-slate-900">{totalCapacity}h</strong> weekly capacity
        </p>

        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search staff"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter team…"
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <select
            aria-label="Sort staff"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as StaffSortMode)}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            <option value="name">Sort: Name</option>
            <option value="hrs_left">Sort: Hrs left</option>
            <option value="utilization">Sort: % Used</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter staff">
          {(
            [
              { id: 'all', label: `All (${staff.length})` },
              { id: 'under_cap', label: `Under cap (${underCapCount})` },
              { id: 'over_limit', label: `Over limit (${overLimitCount})` },
            ] as const
          ).map((option) => {
            const active = filterMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilterMode(option.id)}
                aria-pressed={active}
                className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Staff List */}
      <div className="max-h-[540px] divide-y divide-slate-200/80 overflow-y-auto">
        {staff.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-700">No team members yet</p>
            <p className="mt-1 text-xs text-slate-600">
              Add staff with their weekly hour caps to start scheduling.
            </p>
          </div>
        ) : visibleStaff.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-600">
            No team members match this filter.
          </div>
        ) : (
          visibleStaff.map((member) => {
            const metrics = staffMetrics[member.id];
            const assigned = metrics?.assignedHours ?? 0;
            const max = member.maxWeeklyHours;
            const overtime = metrics?.overtimeHours ?? Math.max(0, assigned - max);
            const isOver = metrics?.isOverMaxHours ?? assigned > max;
            const isAtCap = !isOver && max > 0 && assigned === max;
            const pct =
              max > 0 ? Math.min(100, Math.round((assigned / max) * 100)) : assigned > 0 ? 100 : 0;
            const isHighlighted = highlightedStaffId === member.id;

            const hasLocalWarn =
              (metrics?.multiShiftDays.length ?? 0) > 0 ||
              (metrics?.overlappingAssignmentIds.length ?? 0) > 0;
            const localWarnTip = [
              metrics && metrics.multiShiftDays.length > 0
                ? `2+ shifts on: ${metrics.multiShiftDays.map((d) => DAY_LABELS[d]).join(', ')}`
                : null,
              metrics && metrics.overlappingAssignmentIds.length > 0
                ? 'Has overlapping shifts'
                : null,
            ]
              .filter(Boolean)
              .join(' · ');

            const barColor = isOver
              ? 'bg-rose-600'
              : isAtCap
                ? 'bg-emerald-600'
                : 'bg-indigo-600';

            return (
              <div
                key={member.id}
                className={`group px-4 py-2.5 transition ${
                  isHighlighted ? 'bg-indigo-50/90' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStaff(isHighlighted ? null : member.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${getAvatarTone(
                        member.id,
                      )}`}
                    >
                      {getInitials(member.name)}
                    </span>
                    <span
                      className={`truncate text-xs font-semibold ${
                        isHighlighted
                          ? 'text-indigo-800'
                          : 'text-slate-900 group-hover:text-indigo-700'
                      }`}
                    >
                      {member.name}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    {fairnessExtremes?.highestStaffIds.has(member.id) && (
                      <span
                        title="Highest utilization in active team"
                        className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
                      >
                        Highest
                      </span>
                    )}
                    {fairnessExtremes?.lowestStaffIds.has(member.id) && (
                      <span
                        title="Lowest utilization in active team"
                        className="whitespace-nowrap rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900"
                      >
                        Lowest
                      </span>
                    )}
                    {hasLocalWarn && (
                      <span title={localWarnTip} className="text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                    {isOver && (
                      <span className="whitespace-nowrap rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                        +{overtime}h
                      </span>
                    )}
                    {isAtCap && (
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
                        At cap
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onEditStaff(member)}
                      aria-label={`Edit ${member.name}`}
                      className="rounded-md p-1 text-slate-600 opacity-0 transition hover:bg-slate-200 hover:text-slate-900 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteStaff(member)}
                      aria-label={`Delete ${member.name}`}
                      className="rounded-md p-1 text-slate-600 opacity-0 transition hover:bg-rose-100 hover:text-rose-700 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2.5 pl-9">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span
                    className={`shrink-0 text-[11px] font-semibold tabular-nums ${
                      isOver ? 'text-rose-800' : 'text-slate-700'
                    }`}
                  >
                    {assigned}/{max}h
                  </span>
                </div>

                {member.unavailableDays && member.unavailableDays.length > 0 && (
                  <p className="mt-1 pl-9 text-[11px] font-medium text-rose-700">
                    {formatWeekdaySummary(member.unavailableDays, 'off')}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-100/80 px-4 py-2.5 text-[11px] font-medium text-slate-600">
        Click any team member to highlight their shifts.
      </div>
    </aside>
  );
}
