/**
 * @file Zero-width-bloat roster assignment chip (`AC-04`) styled with healthy emerald
 * cards for valid assignments, indigo for pinned shifts, sky for AI-new drafts, and
 * self-explanatory 2-line problem sub-badges (`Overlap`, `2+ shifts`, `OT`, `Pin conflict`)
 * with floating hover/focus Pin & Remove actions so columns never expand.
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
 * Interactive shift assignment card designed for fixed-column 7-day grids.
 * Healthy shifts render as a clean 1-line emerald card; shifts with issues automatically
 * surface a concise 2nd status line so Store Managers diagnose conflicts without hovering.
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
  const hasLocalWarning = isOverlapping || isMultiShiftDay;
  const isOvertime = Boolean(warningFlags?.isOverMaxHours);
  const hasAnyIssue = isPinConflict || hasLocalWarning || isOvertime;

  const localWarningLabel = [
    isOverlapping ? 'Overlapping shifts' : null,
    isMultiShiftDay ? '2+ shifts same day' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let surfaceClasses = 'bg-emerald-50 border-emerald-300/90 border-l-emerald-600 text-emerald-950';
  let overlayBg = 'bg-emerald-50/95';

  if (isPinConflict) {
    surfaceClasses =
      'bg-rose-50 border-rose-400 border-l-rose-600 text-rose-950 ring-2 ring-rose-500/70';
    overlayBg = 'bg-rose-50/95';
  } else if (hasLocalWarning) {
    surfaceClasses = 'bg-amber-50 border-amber-300 border-l-amber-600 text-amber-950';
    overlayBg = 'bg-amber-50/95';
  } else if (isOvertime) {
    surfaceClasses = 'bg-rose-50/90 border-rose-300 border-l-rose-600 text-rose-950';
    overlayBg = 'bg-rose-50/95';
  } else if (assignment.isPinned) {
    surfaceClasses = 'bg-indigo-50 border-indigo-300 border-l-indigo-600 text-indigo-950';
    overlayBg = 'bg-indigo-50/95';
  } else if (isNewFromAuto) {
    surfaceClasses = 'bg-sky-50 border-sky-300 border-l-sky-600 text-slate-900';
    overlayBg = 'bg-sky-50/95';
  }

  return (
    <div
      className={`group relative w-full min-w-0 rounded-md border border-l-[3px] px-2 py-1.5 text-xs shadow-2xs transition ${surfaceClasses} ${
        isHighlighted ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
      } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      {/* Row 1: Staff Name + New/Pin badge */}
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

        {isNewFromAuto && !assignment.isPinned && (
          <span className="shrink-0 rounded bg-sky-200/80 px-1 py-0.2 text-[9px] font-bold text-sky-900">
            New
          </span>
        )}

        {assignment.isPinned && (
          <Pin
            className="h-3 w-3 shrink-0 text-indigo-700 group-hover:opacity-0"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Row 2: Self-explanatory issue pills (only when shift has a problem) */}
      {hasAnyIssue && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {isPinConflict && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-200/80 px-1.5 py-0.2 text-[10px] font-bold text-rose-900">
              <ShieldAlert className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              Pin conflict
            </span>
          )}

          {hasLocalWarning && (
            <span
              title={localWarningLabel}
              aria-label={localWarningLabel}
              className="inline-flex items-center gap-0.5 rounded bg-amber-200/75 px-1.5 py-0.2 text-[10px] font-bold text-amber-950"
            >
              <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-800" aria-hidden="true" />
              {isOverlapping ? 'Overlap' : '2+ shifts'}
            </span>
          )}

          {isOvertime && (
            <span
              title="Over weekly hour limit"
              className="inline-flex items-center rounded border border-rose-300 bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-800"
            >
              {hasLocalWarning || isPinConflict ? 'OT' : 'OT · Over cap'}
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
              ? 'text-indigo-700 hover:bg-indigo-100'
              : 'text-slate-700 hover:bg-black/10 hover:text-slate-950'
          }`}
        >
          <Pin className="h-3 w-3" aria-hidden="true" />
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
