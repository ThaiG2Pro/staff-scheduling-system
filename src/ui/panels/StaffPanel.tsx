/**
 * @file Sticky right-hand Team (`StaffPanel`) sidebar with Search, Filter (`All` / `Under cap` /
 * `Over limit`), Sort (`Name` / `Hrs left`), live `assigned/max` meters, click-to-highlight,
 * and progressive-disclosure Edit/Delete controls (`AC-01`).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import type { Staff, StaffMetrics } from '../../domain/types';

export type StaffFilterMode = 'all' | 'under_cap' | 'over_limit';
export type StaffSortMode = 'name' | 'hrs_left';

export interface StaffPanelProps {
  staff: readonly Staff[];
  staffMetrics: Record<string, StaffMetrics>;
  highlightedStaffId: string | null;
  onSelectStaff: (staffId: string | null) => void;
  onAddStaff: () => void;
  onEditStaff: (staff: Staff) => void;
  onRequestDeleteStaff: (staff: Staff) => void;
}

/**
 * Right sidebar displaying team weekly hour meters, filter/sort controls, and staff CRUD triggers.
 *
 * @param props - Team list, derived metrics, active highlight ID, and CRUD/selection handlers.
 * @returns Sticky Team panel.
 */
export function StaffPanel({
  staff,
  staffMetrics,
  highlightedStaffId,
  onSelectStaff,
  onAddStaff,
  onEditStaff,
  onRequestDeleteStaff,
}: StaffPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<StaffFilterMode>('all');
  const [sortMode, setSortMode] = useState<StaffSortMode>('name');

  const overLimitCount = useMemo(
    () => staff.filter((member) => staffMetrics[member.id]?.isOverMaxHours).length,
    [staff, staffMetrics],
  );

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
      if (sortMode === 'hrs_left') {
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
      className="w-[296px] shrink-0 rounded-xl border border-slate-300/80 bg-white shadow-xs xl:w-[316px] sticky top-16"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-700" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">Team ({staff.length})</h2>
        </div>
        <button
          type="button"
          onClick={onAddStaff}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Staff
        </button>
      </div>

      {/* Search, Filter & Sort */}
      <div className="space-y-2.5 border-b border-slate-200 bg-slate-50/70 px-3.5 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Search staff"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search team…"
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Filter staff">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'under_cap', label: 'Under cap' },
                {
                  id: 'over_limit',
                  label: overLimitCount > 0 ? `Over limit (${overLimitCount})` : 'Over limit',
                },
              ] as const
            ).map((option) => {
              const active = filterMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilterMode(option.id)}
                  aria-pressed={active}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <select
            aria-label="Sort staff"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as StaffSortMode)}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            <option value="name">Sort: Name</option>
            <option value="hrs_left">Sort: Hrs left</option>
          </select>
        </div>
      </div>

      {/* Staff List */}
      <div className="max-h-[calc(100vh-240px)] divide-y divide-slate-200 overflow-y-auto">
        {staff.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-700">No team members yet</p>
            <p className="mt-1 text-xs text-slate-600">
              Add staff with their weekly hour caps to start scheduling.
            </p>
          </div>
        ) : visibleStaff.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-600">
            No staff match the current filter.
          </div>
        ) : (
          visibleStaff.map((member) => {
            const metrics = staffMetrics[member.id];
            const assigned = metrics?.assignedHours ?? 0;
            const max = member.maxWeeklyHours;
            const overtime = metrics?.overtimeHours ?? Math.max(0, assigned - max);
            const isOver = metrics?.isOverMaxHours ?? assigned > max;
            const isAtCap = !isOver && max > 0 && assigned === max;
            const pct = max > 0 ? Math.min(100, Math.round((assigned / max) * 100)) : assigned > 0 ? 100 : 0;
            const isHighlighted = highlightedStaffId === member.id;

            const barColor = isOver
              ? 'bg-rose-600'
              : isAtCap
                ? 'bg-emerald-600'
                : 'bg-indigo-600';

            return (
              <div
                key={member.id}
                className={`group relative px-3.5 py-2.5 transition ${
                  isHighlighted ? 'bg-indigo-50/80' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStaff(isHighlighted ? null : member.id)}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-sm"
                  >
                    <p className="truncate text-sm font-medium text-slate-900">{member.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-700">
                      <span>
                        {assigned} / {max}h
                      </span>
                      {isOver && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.2 text-[11px] font-semibold text-rose-800">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          +{overtime}h
                        </span>
                      )}
                      {isAtCap && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.2 text-[11px] font-medium text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          At cap
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onEditStaff(member)}
                      aria-label={`Edit ${member.name}`}
                      className="rounded-md p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteStaff(member)}
                      aria-label={`Delete ${member.name}`}
                      className="rounded-md p-1 text-slate-600 hover:bg-rose-100 hover:text-rose-700 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
