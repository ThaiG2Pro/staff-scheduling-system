/**
 * @file Staff CSV Import modal supporting `.csv` upload, pasted CSV text, 1-click Demo Staff CSV
 * loading, template download, live preview, and default-on "Update matching names" toggle.
 */

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { DEMO_STAFF_CSV_TEXT } from '../../domain/demoData';
import { parseStaffCsv, type StaffCsvParseError } from '../../domain/staffCsvParser';
import type { Staff } from '../../domain/types';
import { formatWeekdaySummary } from '../common/WeekdayToggleGroup';

export interface StaffImportModalProps {
  open: boolean;
  existingStaff: readonly Staff[];
  onImport: (
    csvText: string,
    options: { updateExisting: boolean },
  ) =>
    | { ok: true; addedCount: number; updatedCount: number; skippedCount: number }
    | { ok: false; errors: StaffCsvParseError[] };
  onClose: () => void;
}

const TEMPLATE_CSV = [
  'name,max_weekly_hours,unavailable_days',
  'Alice Nguyen,40,',
  'Brian Tran,32,Sat;Sun',
  'Carla Pham,24,Mon;Wed',
].join('\n');

function downloadTemplateCsv() {
  const blob = new Blob([`${TEMPLATE_CSV}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'staff_template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Modal for bulk-importing staff members from a CSV file or pasted CSV text.
 * Never deletes existing staff; defaults to updating matching names in place.
 */
export function StaffImportModal({
  open,
  existingStaff,
  onImport,
  onClose,
}: StaffImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [submitErrors, setSubmitErrors] = useState<StaffCsvParseError[]>([]);

  useEffect(() => {
    if (!open) return;
    setCsvText('');
    setFileName(undefined);
    setUpdateExisting(true);
    setSubmitErrors([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const existingNames = useMemo(() => {
    const set = new Set<string>();
    for (const st of existingStaff) {
      set.add(st.name.trim().toLowerCase());
    }
    return set;
  }, [existingStaff]);

  const livePreview = useMemo(() => {
    if (!csvText.trim()) return null;
    const parsed = parseStaffCsv(csvText);
    if (!parsed.ok) {
      return { ok: false as const, errors: parsed.errors };
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const items = parsed.rows.map((row) => {
      const exists = existingNames.has(row.name.trim().toLowerCase());
      const action: 'new' | 'update' | 'skip' = exists
        ? updateExisting
          ? 'update'
          : 'skip'
        : 'new';
      if (action === 'new') addedCount += 1;
      else if (action === 'update') updatedCount += 1;
      else skippedCount += 1;
      return { row, action };
    });

    return {
      ok: true as const,
      items,
      addedCount,
      updatedCount,
      skippedCount,
    };
  }, [csvText, existingNames, updateExisting]);

  if (!open) return null;

  const displayedErrors =
    submitErrors.length > 0
      ? submitErrors
      : livePreview && !livePreview.ok
        ? livePreview.errors
        : [];

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setCsvText(content);
      setFileName(file.name);
      setSubmitErrors([]);
    } catch {
      setSubmitErrors([
        { message: 'Unable to read the selected file. Try pasting the CSV text below.' },
      ]);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!csvText.trim()) {
      setSubmitErrors([{ message: 'Select a CSV file or paste staff CSV rows first.' }]);
      return;
    }

    const res = onImport(csvText, { updateExisting });
    if (!res.ok) {
      setSubmitErrors(res.errors);
      return;
    }
    onClose();
  };

  const actionableCount =
    livePreview && livePreview.ok ? livePreview.addedCount + livePreview.updatedCount : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-import-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            <h2 id="staff-import-title" className="text-base font-semibold text-slate-900">
              Import Staff CSV
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close staff CSV import modal"
            className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <p className="text-sm text-slate-700">
              Upload a <code>.csv</code> file or paste rows with columns{' '}
              <strong>name</strong>, <strong>max_weekly_hours</strong>, and optional{' '}
              <strong>unavailable_days</strong> (e.g. <code>Sat;Sun</code>). Existing staff not
              listed in the CSV are kept untouched.
            </p>

            {/* File upload + Quick sample / template actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <Upload className="h-4 w-4 text-slate-600" aria-hidden="true" />
                  Choose .csv File
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                {fileName && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    {fileName}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCsvText(DEMO_STAFF_CSV_TEXT);
                    setFileName('sample_staff_demo.csv');
                    setSubmitErrors([]);
                  }}
                  className="text-xs font-medium text-indigo-700 hover:text-indigo-800 hover:underline"
                >
                  Load demo staff CSV
                </button>
                <button
                  type="button"
                  onClick={downloadTemplateCsv}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Download template
                </button>
              </div>
            </div>

            {/* Paste textarea */}
            <div>
              <label
                htmlFor="staff-csv-paste-textarea"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Or paste CSV content
              </label>
              <textarea
                id="staff-csv-paste-textarea"
                rows={6}
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setSubmitErrors([]);
                }}
                placeholder={TEMPLATE_CSV}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Update matching names checkbox (default checked) */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <strong className="text-slate-900">
                  Update existing staff with matching names
                </strong>
                <span className="mt-0.5 block text-[11px] text-slate-600">
                  Updates <code>max_weekly_hours</code> and <code>unavailable_days</code> while
                  preserving existing shift assignments. Uncheck to skip matching names.
                </span>
              </span>
            </label>

            {/* Validation errors */}
            {displayedErrors.length > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                  Fix {displayedErrors.length} CSV{' '}
                  {displayedErrors.length === 1 ? 'issue' : 'issues'} before importing:
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {displayedErrors.slice(0, 6).map((err, idx) => (
                    <li key={idx}>{err.message}</li>
                  ))}
                  {displayedErrors.length > 6 && (
                    <li>…and {displayedErrors.length - 6} more.</li>
                  )}
                </ul>
              </div>
            )}

            {/* Live preview table */}
            {livePreview && livePreview.ok && (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-800">
                    Preview ({livePreview.items.length} rows)
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    {livePreview.addedCount > 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                        +{livePreview.addedCount} new
                      </span>
                    )}
                    {livePreview.updatedCount > 0 && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800">
                        {livePreview.updatedCount} update
                      </span>
                    )}
                    {livePreview.skippedCount > 0 && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">
                        {livePreview.skippedCount} skip
                      </span>
                    )}
                  </div>
                </div>
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] text-slate-600">
                        <th className="px-3 py-1.5 font-semibold">Name</th>
                        <th className="px-3 py-1.5 font-semibold">Max hrs</th>
                        <th className="px-3 py-1.5 font-semibold">Days off</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {livePreview.items.map(({ row, action }) => (
                        <tr key={row.rowNumber} className={action === 'skip' ? 'opacity-55' : ''}>
                          <td className="px-3 py-1.5 font-medium text-slate-900">{row.name}</td>
                          <td className="px-3 py-1.5 tabular-nums text-slate-700">
                            {row.maxWeeklyHours}h
                          </td>
                          <td className="px-3 py-1.5 text-slate-600">
                            {row.unavailableDays && row.unavailableDays.length > 0
                              ? formatWeekdaySummary(row.unavailableDays, 'off')
                              : 'All 7 days'}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {action === 'new' ? (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                New
                              </span>
                            ) : action === 'update' ? (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                Update
                              </span>
                            ) : (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                Skip
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!csvText.trim() || displayedErrors.length > 0 || actionableCount === 0}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionableCount > 0 ? `Import Staff (${actionableCount})` : 'Import Staff'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
