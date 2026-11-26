/**
 * @file Roster assignment card (`AC-04`) using a unified health-driven color model where
 * the left accent bar always matches the card tone:
 * - Emerald: Healthy shift (including pinned shifts, indicated by the Pin icon)
 * - Amber: Operational warning (`2+ shifts` same day or `OT` weekly cap)
 * - Rose: Critical conflict (`Overlap` or `Pin conflict` blocking Auto-schedule)
 */

import { AlertTriangle, Pin, ShieldAlert, X } from 'lucide-react';
import type { Assignment, AssignmentWarningFlags } from '../../domain/types';

export interface AssignmentChipProps {
  assignment: Assignment;
  staffName: string;
  warningFlags?: AssignmentWarningFlags;
  isHighlighted: boolean;
  isDimmed: boolean;
  isPinConflict: boolean;
  isNewFromAuto: boolean;
  onOpenReassign: () => void;
  onTogglePin: () => void;
  onRemove: () => void;
}

/**
 * Interactive shift assignment card for fixed-column 7-day grids.
 * Card surface and left accent bar share the same semantic health color; Pin is
 * represented orthogonally via the always-visible Pin icon so color means health only.
 *
 * @param props - Assignment record, staff display name, warning/highlight states, and handlers.
 * @returns Styled assignment card.
 */
export function AssignmentChip({
  assignment,
  staffName,
  warningFlags,
  isHighlighted,
  isDimmed,
  isPinConflict,
  isNewFromAuto,
  onOpenReassign,
  onTogglePin,
  onRemove,
}: AssignmentChipProps) {
  const isOverlapping = Boolean(warningFlags?.isOverlapping);
  const isMultiShiftDay = Boolean(warningFlags?.isMultiShiftDay);
  const isUnavailableDay = Boolean(warningFlags?.isUnavailableDay);
  const hasShiftClashWarning = isOverlapping || isMultiShiftDay;
  const isOvertime = Boolean(warningFlags?.isOverMaxHours);

  const isCritical = isPinConflict || isOverlapping;
  const isDayConflict = !isCritical && (isMultiShiftDay || isUnavailableDay);
  const hasRow2Issue = isCritical || isDayConflict;

  const localWarningLabel = [
    isOverlapping ? 'Overlapping shifts' : null,
    isMultiShiftDay ? '2+ shifts same day' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let surfaceClasses = 'bg-emerald-50 border-emerald-300/90 border-l-emerald-600 text-emerald-950';
  let overlayBg = 'bg-emerald-50/95';

  if (isCritical) {
    surfaceClasses = isPinConflict
      ? 'bg-rose-50 border-rose-400 border-l-rose-600 text-rose-950 ring-2 ring-rose-500/70'
      : 'bg-rose-50 border-rose-300 border-l-rose-600 text-rose-950';
    overlayBg = 'bg-rose-50/95';
  } else if (isDayConflict || isOvertime) {
    // Keep healthy emerald surface so amber/orange background stays reserved for Need cells;
    // highlight workload warnings (2+ shifts / OT) via amber left accent + compact inline tags.
    surfaceClasses = 'bg-emerald-50/80 border-emerald-300/80 border-l-amber-500 text-emerald-950';
    overlayBg = 'bg-emerald-50/95';
  }

  return (
    <div
      className={`group relative w-full min-w-0 rounded-md border border-l-[3px] px-2 py-1.5 text-xs shadow-2xs transition ${surfaceClasses} ${
        isHighlighted ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
      } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      {/* Row 1: Staff Name + compact inline OT / New / Pin indicators */}
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          data-chip-reassign="true"
          onClick={onOpenReassign}
          title={`Click to reassign ${staffName}`}
          className="min-w-0 flex-1 truncate text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-xs"
        >
          {staffName}
        </button>

        {isOvertime && !hasRow2Issue && (
          <span
            title="Staff exceeds weekly hour limit"
            className="shrink-0 rounded border border-amber-400 bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-900 group-hover:opacity-0"
          >
            OT
          </span>
        )}

        {isNewFromAuto && !assignment.isPinned && (
          <span className="shrink-0 rounded bg-sky-200/80 px-1 py-0.2 text-[9px] font-bold text-sky-900">
            New
          </span>
        )}

        {assignment.isPinned && (
          <Pin
            className="h-3 w-3 shrink-0 fill-indigo-600 text-indigo-600 group-hover:opacity-0"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Row 2: Self-explanatory conflict pills (only for same-day conflicts / pin conflicts) */}
      {hasRow2Issue && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {isPinConflict && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-200/80 px-1.5 py-0.2 text-[10px] font-bold text-rose-900">
              <ShieldAlert className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              Pin conflict
            </span>
          )}

          {hasShiftClashWarning && (
            <span
              title={localWarningLabel}
              aria-label={localWarningLabel}
              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[10px] font-bold ${
                isOverlapping
                  ? 'bg-rose-200/80 text-rose-900'
                  : 'bg-amber-200/75 text-amber-950'
              }`}
            >
              <AlertTriangle
                className={`h-2.5 w-2.5 shrink-0 ${
                  isOverlapping ? 'text-rose-800' : 'text-amber-800'
                }`}
                aria-hidden="true"
              />
              {isOverlapping ? 'Overlap' : '2+ shifts'}
            </span>
          )}

          {isUnavailableDay && (
            <span
              title="Staff marked unavailable on this day"
              aria-label="Staff unavailable on this day"
              className="inline-flex items-center gap-0.5 rounded bg-amber-200/80 px-1.5 py-0.2 text-[10px] font-bold text-amber-950"
            >
              <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-800" aria-hidden="true" />
              Day off
            </span>
          )}

          {isOvertime && (
            <span
              title="Over weekly hour limit"
              className="inline-flex items-center rounded border border-amber-300 bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-900"
            >
              OT
            </span>
          )}
        </div>
      )}

      {/* Floating hover/focus actions — never inflates column width */}
      <div
        className={`pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded px-0.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${overlayBg}`}
      >
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={assignment.isPinned ? `Unpin ${staffName}` : `Pin ${staffName}`}
          aria-pressed={assignment.isPinned}
          title={assignment.isPinned ? 'Pinned (click to unpin)' : 'Pin shift'}
          className={`rounded p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
            assignment.isPinned
              ? 'text-indigo-600 hover:bg-indigo-100'
              : 'text-slate-700 hover:bg-black/10 hover:text-slate-950'
          }`}
        >
          <Pin
            className={`h-3 w-3 ${assignment.isPinned ? 'fill-indigo-600' : ''}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${staffName} from shift`}
          title="Remove assignment"
          className="rounded p-0.5 text-slate-700 transition hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
