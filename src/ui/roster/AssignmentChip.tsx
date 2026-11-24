/**
 * @file Zero-width-bloat roster assignment chip displaying staff name, Pin status, local
 * warning flags (`2+ shifts` / `Overlap`) separated from weekly `OT` badge, AI-new tag,
 * and floating hover/focus Pin & Remove actions so chips never expand table columns.
 */

import { AlertTriangle, Pin, X } from 'lucide-react';
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
 * Compact shift assignment chip designed for fixed-column 7-day grids.
 * Hover/focus actions overlay neatly on the right edge without inflating column width.
 *
 * @param props - Assignment record, staff display name, warning/highlight states, and handlers.
 * @returns Styled assignment chip.
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
  const hasLocalWarning = Boolean(warningFlags?.isMultiShiftDay || warningFlags?.isOverlapping);
  const isOvertime = Boolean(warningFlags?.isOverMaxHours);

  const localWarningLabel = [
    warningFlags?.isOverlapping ? 'Overlapping shifts' : null,
    warningFlags?.isMultiShiftDay ? '2+ shifts same day' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let surfaceClasses = 'bg-slate-100/95 border-slate-300/90 border-l-slate-600 text-slate-900';
  let overlayBg = 'bg-slate-100/95';
  if (isPinConflict) {
    surfaceClasses =
      'bg-rose-50 border-rose-400 border-l-rose-600 text-rose-950 ring-2 ring-rose-500/70';
    overlayBg = 'bg-rose-50/95';
  } else if (hasLocalWarning) {
    surfaceClasses = 'bg-amber-50 border-amber-300 border-l-amber-600 text-amber-950';
    overlayBg = 'bg-amber-50/95';
  } else if (assignment.isPinned) {
    surfaceClasses = 'bg-indigo-50 border-indigo-300 border-l-indigo-600 text-indigo-950';
    overlayBg = 'bg-indigo-50/95';
  } else if (isNewFromAuto) {
    surfaceClasses = 'bg-sky-50 border-sky-300 border-l-sky-600 text-slate-900';
    overlayBg = 'bg-sky-50/95';
  }

  return (
    <div
      className={`group relative flex w-full min-w-0 items-center justify-between gap-1 rounded-md border border-l-[3px] px-2 py-1.5 text-xs shadow-2xs transition ${surfaceClasses} ${
        isHighlighted ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
      } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          data-chip-reassign="true"
          onClick={onOpenReassign}
          title={`Click to reassign ${staffName}`}
          className="min-w-0 flex-1 truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-xs"
        >
          {staffName}
        </button>

        {isNewFromAuto && !assignment.isPinned && (
          <span className="shrink-0 rounded bg-sky-200/80 px-1 py-0.2 text-[9px] font-bold text-sky-900">
            New
          </span>
        )}

        {hasLocalWarning && (
          <span
            title={localWarningLabel}
            aria-label={localWarningLabel}
            className="shrink-0 text-amber-700"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          </span>
        )}

        {isOvertime && (
          <span
            title="Over weekly hour limit"
            className="shrink-0 rounded border border-rose-300 bg-rose-100 px-1 py-0.2 text-[9px] font-bold text-rose-800"
          >
            OT
          </span>
        )}

        {/* Always-visible pin indicator when pinned (hidden on hover when overlay takes over) */}
        {assignment.isPinned && (
          <Pin
            className="h-3 w-3 shrink-0 text-indigo-700 group-hover:opacity-0"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Floating hover/focus actions — never inflates column width */}
      <div
        className={`pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded px-0.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${overlayBg}`}
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
              : 'text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
          }`}
        >
          <Pin className="h-3 w-3" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${staffName} from shift`}
          title="Remove assignment"
          className="rounded p-0.5 text-slate-600 transition hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
