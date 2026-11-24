/**
 * @file Roster assignment chip displaying staff name, Pin toggle, local warning flags
 * (`2+ shifts` / `Overlap`) separated from weekly `OT` badge, AI-new tag, and quick remove (`×`).
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
 * Interactive shift assignment chip rendered inside a `(Shift × Day)` roster cell.
 * Uses left accent bar + accessible badges to distinguish Normal, Pinned, AI-New, Local Warning,
 * Overtime (`OT`), and Pin Conflict states.
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

  let surfaceClasses = 'bg-slate-100/90 border-slate-300/90 border-l-slate-600 text-slate-900';
  if (isPinConflict) {
    surfaceClasses =
      'bg-rose-50 border-rose-400 border-l-rose-600 text-rose-950 ring-2 ring-rose-500/70';
  } else if (hasLocalWarning) {
    surfaceClasses = 'bg-amber-50 border-amber-300 border-l-amber-600 text-amber-950';
  } else if (assignment.isPinned) {
    surfaceClasses = 'bg-indigo-50 border-indigo-300 border-l-indigo-600 text-indigo-950';
  } else if (isNewFromAuto) {
    surfaceClasses = 'bg-sky-50 border-sky-300 border-l-sky-600 text-slate-900';
  }

  return (
    <div
      className={`group relative flex items-center justify-between gap-1 rounded-md border border-l-[3px] px-2 py-1 text-xs shadow-2xs transition ${surfaceClasses} ${
        isHighlighted ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
      } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          onClick={onOpenReassign}
          title={`Reassign ${staffName}`}
          className="truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-xs"
        >
          {staffName}
        </button>

        {isNewFromAuto && !assignment.isPinned && (
          <span className="shrink-0 rounded bg-sky-200/80 px-1 py-0.2 text-[10px] font-semibold text-sky-900">
            New
          </span>
        )}

        {hasLocalWarning && (
          <span
            title={localWarningLabel}
            aria-label={localWarningLabel}
            className="shrink-0 text-amber-700"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}

        {isOvertime && (
          <span
            title="Over weekly hour limit"
            className="shrink-0 rounded border border-rose-300 bg-rose-100 px-1 py-0.2 text-[10px] font-bold text-rose-800"
          >
            OT
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={assignment.isPinned ? `Unpin ${staffName}` : `Pin ${staffName}`}
          aria-pressed={assignment.isPinned}
          title={assignment.isPinned ? 'Pinned (click to unpin)' : 'Pin shift'}
          className={`rounded p-0.5 transition focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
            assignment.isPinned
              ? 'opacity-100 text-indigo-700 hover:bg-indigo-100'
              : 'opacity-0 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <Pin className="h-3 w-3" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${staffName} from shift`}
          title="Remove assignment"
          className="rounded p-0.5 text-slate-600 opacity-0 transition hover:bg-rose-100 hover:text-rose-700 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
