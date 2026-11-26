/**
 * @file Workspace Top Action Bar with back navigation, inline schedule rename, passive save
 * status badge, Prepare flow triggers (`Import CSV`, `Shifts`), round-trip Target `N` input,
 * `Auto-schedule` button with E-02 readiness tooltip, and More (`⋯`) destructive menu.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Lock,
  Minus,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { MAX_TARGET_N, MIN_TARGET_N } from '../../domain/constants';
import { validateTargetNInput } from '../../domain/decimalMath';
import type { MissingInputCode } from '../../domain/types';
import type { SaveStatus } from '../../persistence/storageTypes';

export interface TopActionBarProps {
  scheduleName: string;
  targetN: number;
  saveStatus: SaveStatus;
  missingInputs: MissingInputCode[];
  onBack: () => void;
  onRename: (nextName: string) => { ok: boolean; error?: string };
  onChangeTargetN: (nextN: number) => { ok: boolean; error?: string };
  onOpenCsvImport: () => void;
  onOpenManageShifts: () => void;
  onRunAutoSchedule: () => void;
  onRequestDeleteSchedule: () => void;
  hasLastAutoRun?: boolean;
  onReplayLastAutoRun?: () => void;
}

const MISSING_INPUT_LABELS: Record<MissingInputCode, string> = {
  DEMAND: 'Import transaction CSV demand',
  SHIFTS: 'Add at least 1 shift template',
  ELIGIBLE_STAFF: 'Add at least 1 eligible staff member (> 0 max hours and at least 1 available day)',
  INVALID_N: 'Set a valid Target N (1–500)',
};

/**
 * Sticky top toolbar for the active schedule workspace.
 * Enforces IEEE-754 round-trip validation on Target `N` via `inputMode="decimal"` (no `step="1"`).
 *
 * @param props - Schedule metadata, save status, readiness state, and action handlers.
 * @returns Top navigation and action bar.
 */
export function TopActionBar({
  scheduleName,
  targetN,
  saveStatus,
  missingInputs,
  onBack,
  onRename,
  onChangeTargetN,
  onOpenCsvImport,
  onOpenManageShifts,
  onRunAutoSchedule,
  onRequestDeleteSchedule,
  hasLastAutoRun,
  onReplayLastAutoRun,
}: TopActionBarProps) {
  const [nameDraft, setNameDraft] = useState(scheduleName);
  const [nameError, setNameError] = useState<string | null>(null);

  const [targetDraft, setTargetDraft] = useState(String(targetN));
  const [targetError, setTargetError] = useState<string | null>(null);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameDraft(scheduleName);
    setNameError(null);
  }, [scheduleName]);

  useEffect(() => {
    setTargetDraft(String(targetN));
    setTargetError(null);
  }, [targetN]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [moreOpen]);

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed === scheduleName) {
      setNameDraft(scheduleName);
      setNameError(null);
      return;
    }
    const res = onRename(nameDraft);
    if (!res.ok) {
      setNameError(res.error ?? 'Schedule name is required.');
    } else {
      setNameError(null);
    }
  };

  const commitTargetN = (raw: string) => {
    const validated = validateTargetNInput(raw);
    if (!validated.ok) {
      setTargetError(validated.error);
      return;
    }
    const res = onChangeTargetN(validated.value);
    if (!res.ok) {
      setTargetError(res.error ?? 'Unable to update Target N.');
      return;
    }
    setTargetError(null);
    setTargetDraft(String(validated.value));
  };

  const stepTargetN = (delta: number) => {
    const next = Math.min(MAX_TARGET_N, Math.max(MIN_TARGET_N, Math.round((targetN + delta) * 1e6) / 1e6));
    commitTargetN(String(next));
  };

  const autoScheduleDisabled = missingInputs.length > 0;
  const autoScheduleTooltip = autoScheduleDisabled
    ? `Required before Auto-schedule: ${missingInputs.map((code) => MISSING_INPUT_LABELS[code]).join('; ')}`
    : 'Generate an optimized weekly roster preserving all pinned assignments';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-300/80 bg-white">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        {/* Left: Back + Inline Rename + Passive Save Badge */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Schedules
          </button>

          <div className="relative">
            <input
              type="text"
              aria-label="Schedule name"
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                if (nameError) setNameError(null);
              }}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setNameDraft(scheduleName);
                  setNameError(null);
                  e.currentTarget.blur();
                }
              }}
              className={`w-64 rounded-lg border px-2.5 py-1.5 text-sm font-semibold text-slate-900 xl:w-72 focus:outline-none focus:ring-2 ${
                nameError
                  ? 'border-rose-400 bg-rose-50/40 focus:ring-rose-500/20'
                  : 'border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20'
              }`}
            />
            {nameError && (
              <p
                role="alert"
                className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 shadow-sm"
              >
                {nameError}
              </p>
            )}
          </div>

          {/* Passive Save Status Badge */}
          {saveStatus === 'saved' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Saved locally
            </span>
          )}
          {saveStatus === 'save_error' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Unable to save locally — changes exist in memory only
            </span>
          )}
          {saveStatus === 'locked' && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Storage locked
            </span>
          )}
        </div>

        {/* Right: Prepare Actions + Target N + Auto-schedule + More */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenCsvImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <Upload className="h-4 w-4 text-slate-600" aria-hidden="true" />
            Import CSV
          </button>

          <button
            type="button"
            onClick={onOpenManageShifts}
            title="Manage shift templates"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <Clock className="h-4 w-4 text-slate-600" aria-hidden="true" />
            Shifts
          </button>

          {/* Target N control with strict round-trip validation */}
          <div className="relative flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1">
            <label
              htmlFor="target-n-input"
              className="text-xs font-medium text-slate-700 select-none"
            >
              Target
            </label>
            <div className="flex items-center">
              <button
                type="button"
                aria-label="Decrease target transactions per staff hour"
                onClick={() => stepTargetN(-1)}
                disabled={targetN <= MIN_TARGET_N}
                className="flex h-6 w-6 items-center justify-center rounded-l-md border border-r-0 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <input
                id="target-n-input"
                type="text"
                inputMode="decimal"
                aria-label="Target transactions per staff hour"
                aria-invalid={targetError !== null}
                value={targetDraft}
                onChange={(e) => {
                  setTargetDraft(e.target.value);
                  if (targetError) setTargetError(null);
                }}
                onBlur={() => commitTargetN(targetDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTargetN(targetDraft);
                  if (e.key === 'Escape') {
                    setTargetDraft(String(targetN));
                    setTargetError(null);
                  }
                }}
                className={`h-6 w-16 border bg-white px-1.5 text-center text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 ${
                  targetError
                    ? 'border-rose-400 focus:ring-rose-500/20'
                    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/20'
                }`}
              />
              <button
                type="button"
                aria-label="Increase target transactions per staff hour"
                onClick={() => stepTargetN(1)}
                disabled={targetN >= MAX_TARGET_N}
                className="flex h-6 w-6 items-center justify-center rounded-r-md border border-l-0 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <span className="text-xs text-slate-600 select-none">txns/hr</span>

            {targetError && (
              <p
                role="alert"
                className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-800 shadow-md"
              >
                {targetError}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={autoScheduleDisabled}
            title={autoScheduleTooltip}
            onClick={onRunAutoSchedule}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Auto-schedule
          </button>

          {hasLastAutoRun && onReplayLastAutoRun && (
            <button
              type="button"
              onClick={onReplayLastAutoRun}
              title="Replay last Auto-schedule run step-by-step in Simulator"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Replay sim
            </button>
          )}

          {/* More menu with Delete Schedule */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              aria-label="More schedule actions"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>

            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1.5 w-48 rounded-lg border border-slate-300 bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onRequestDeleteSchedule();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete Schedule…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
