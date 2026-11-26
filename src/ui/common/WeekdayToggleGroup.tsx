/**
 * @file Reusable 7-day weekday toggle group (`Mon`–`Sun`) shared by `ManageShiftsModal`
 * (`minSelected = 1`, active shift days) and `StaffFormModal` (`minSelected = 0`, staff days off).
 */

import { DAY_LABELS, DAYS_OF_WEEK } from '../../domain/constants';
import { normalizeDayArray } from '../../domain/hardRules';
import type { DayOfWeek } from '../../domain/types';

export interface WeekdayToggleGroupProps {
  selectedDays: readonly DayOfWeek[];
  onChange: (nextDays: DayOfWeek[]) => void;
  minSelected?: number;
  onMinSelectedBlocked?: () => void;
  tone?: 'active' | 'off';
  groupLabel: string;
  size?: 'sm' | 'md';
}

/**
 * Formats a sorted list of days into a concise human-readable English summary
 * (e.g. `Every day`, `Mon–Fri`, `Sat–Sun`, `Mon, Wed, Fri`, or `Off: Wed, Sun`).
 */
export function formatWeekdaySummary(
  days: readonly DayOfWeek[],
  mode: 'active' | 'off',
): string {
  const sorted = normalizeDayArray(days);
  if (mode === 'off') {
    if (sorted.length === 0) return '';
    if (sorted.length === 7) return 'Off: All 7 days';
    return `Off: ${sorted.map((d) => DAY_LABELS[d]).join(', ')}`;
  }

  if (sorted.length === 7) return 'Every day';
  if (sorted.length === 5 && sorted[0] === 0 && sorted[4] === 4) return 'Mon–Fri';
  if (sorted.length === 2 && sorted[0] === 5 && sorted[1] === 6) return 'Sat–Sun';
  return sorted.map((d) => DAY_LABELS[d]).join(', ');
}

/**
 * Accessible 7-button weekday toggle group using canonical `DAY_LABELS` (`Mon`–`Sun`).
 * Enforces `minSelected` when preventing removal of the last selected day.
 */
export function WeekdayToggleGroup({
  selectedDays,
  onChange,
  minSelected = 0,
  onMinSelectedBlocked,
  tone = 'active',
  groupLabel,
  size = 'sm',
}: WeekdayToggleGroupProps) {
  const selectedSet = new Set<DayOfWeek>(selectedDays);

  const handleToggle = (day: DayOfWeek) => {
    if (selectedSet.has(day)) {
      if (selectedSet.size <= minSelected) {
        onMinSelectedBlocked?.();
        return;
      }
      onChange(normalizeDayArray(selectedDays.filter((d) => d !== day)));
    } else {
      onChange(normalizeDayArray([...selectedDays, day]));
    }
  };

  const sizeClasses = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-xs';

  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="flex flex-wrap items-center gap-1"
    >
      {DAYS_OF_WEEK.map((day) => {
        const isSelected = selectedSet.has(day);
        const isLockedLast = isSelected && selectedSet.size <= minSelected;

        const stateClasses = isSelected
          ? tone === 'active'
            ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
            : 'border-rose-500 bg-rose-50 text-rose-800 hover:bg-rose-100'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50';

        return (
          <button
            key={day}
            type="button"
            aria-pressed={isSelected}
            title={
              isLockedLast
                ? 'At least 1 active day is required'
                : `${DAY_LABELS[day]}${isSelected ? (tone === 'off' ? ' (Off)' : ' (Active)') : ''}`
            }
            onClick={() => handleToggle(day)}
            className={`rounded-md border font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${sizeClasses} ${stateClasses}`}
          >
            {DAY_LABELS[day]}
          </button>
        );
      })}
    </div>
  );
}
