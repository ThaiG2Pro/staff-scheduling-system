/**
 * @file Contextual Workspace Banners handling Auto-schedule Review (`E-04` Before → After delta
 * with 1-click Undo Auto-schedule), Pin Conflict Guardrail (`E-03` with Highlight button),
 * and CSV/action notices.
 */

import { AlertTriangle, CheckCircle2, RotateCcw, Sparkles, X } from 'lucide-react';
import type { AutoScheduleDiagnostics, PinConflict } from '../../domain/types';

export type WorkspaceBannerState =
  | {
      kind: 'auto_review';
      beforeCoveragePct: number | null;
      afterCoveragePct: number | null;
      beforeGaps: number | null;
      afterGaps: number | null;
      diagnostics: AutoScheduleDiagnostics;
    }
  | {
      kind: 'pin_conflict';
      conflicts: PinConflict[];
    }
  | {
      kind: 'notice';
      tone: 'success' | 'warning' | 'error';
      title: string;
      details?: string[];
    };

export interface ContextualBannersProps {
  banner: WorkspaceBannerState | null;
  canUndoAutoSchedule: boolean;
  onUndoAutoSchedule: () => void;
  onHighlightPinConflicts: (assignmentIds: string[]) => void;
  onKeepDraft: () => void;
  onDismiss: () => void;
}

/**
 * Renders contextual feedback banners immediately beneath `ScheduleHealthBar`.
 * Hidden (`null`) when there is no active banner.
 *
 * @param props - Active banner payload and undo/dismiss/highlight/keep callbacks.
 * @returns Banner element or `null`.
 */
export function ContextualBanners({
  banner,
  canUndoAutoSchedule,
  onUndoAutoSchedule,
  onHighlightPinConflicts,
  onKeepDraft,
  onDismiss,
}: ContextualBannersProps) {
  if (!banner) return null;

  if (banner.kind === 'auto_review') {
    const beforeCov = banner.beforeCoveragePct !== null ? `${banner.beforeCoveragePct}%` : '–';
    const afterCov = banner.afterCoveragePct !== null ? `${banner.afterCoveragePct}%` : '–';
    const beforeGaps = banner.beforeGaps !== null ? String(banner.beforeGaps) : '–';
    const afterGaps = banner.afterGaps !== null ? String(banner.afterGaps) : '–';

    return (
      <div
        role="status"
        className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-slate-900 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold text-slate-900">
                Auto-schedule draft ready — {banner.diagnostics.generatedAssignmentsCount} new
                shift(s) assigned, {banner.diagnostics.preservedPinnedCount} pinned preserved
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
                <span>
                  Demand Coverage: <strong>{beforeCov}</strong> →{' '}
                  <strong className="text-emerald-800">{afterCov}</strong>
                </span>
                <span>
                  Staffing Gaps: <strong>{beforeGaps}</strong> →{' '}
                  <strong className="text-slate-900">{afterGaps}</strong>
                </span>
              </div>
              {banner.diagnostics.summaryMessages.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-slate-700">
                  {banner.diagnostics.summaryMessages.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canUndoAutoSchedule && (
              <button
                type="button"
                onClick={onUndoAutoSchedule}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Undo Auto-schedule
              </button>
            )}
            <button
              type="button"
              onClick={onKeepDraft}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Keep draft
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (banner.kind === 'pin_conflict') {
    const allConflictIds = Array.from(
      new Set(banner.conflicts.flatMap((conflict) => conflict.assignmentIds)),
    );

    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold text-rose-950">
                Auto-schedule blocked — resolve conflicting pinned shifts first
              </p>
              <ul className="list-disc pl-4 text-xs text-rose-800">
                {banner.conflicts.map((conflict, idx) => (
                  <li key={idx}>{conflict.details}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onHighlightPinConflicts(allConflictIds)}
              className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
            >
              Highlight conflicting shifts
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss conflict banner"
              className="rounded-md p-1 text-rose-700 hover:bg-rose-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const toneClasses =
    banner.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : banner.tone === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-950'
        : 'border-rose-300 bg-rose-50 text-rose-900';

  return (
    <div
      role={banner.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm shadow-xs ${toneClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {banner.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <div className="space-y-1">
            <p className="font-medium">{banner.title}</p>
            {banner.details && banner.details.length > 0 && (
              <ul className="list-disc pl-4 text-xs opacity-90">
                {banner.details.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded-md p-1 opacity-75 hover:bg-black/5 hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
