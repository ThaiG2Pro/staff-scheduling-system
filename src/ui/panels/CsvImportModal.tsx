/**
 * @file CSV Transaction Import modal supporting file upload, pasted CSV text, sample CSV
 * loading, and atomic preserve-on-error validation feedback (`AC-02`, `E-01`).
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, FileSpreadsheet, Upload, X } from 'lucide-react';
import { DEMO_STORE_CSV_TEXT } from '../../domain/demoData';
import type { CsvParseError } from '../../domain/types';

export interface CsvImportModalProps {
  open: boolean;
  hasExistingDemand: boolean;
  onImport: (
    csvText: string,
    sourceFileName?: string,
  ) =>
    | { ok: true; totalTransactions: number }
    | { ok: false; errors: CsvParseError[] };
  onClose: () => void;
}

/**
 * Modal for importing a 7-day × 16-hour (7am–10pm) transaction CSV report.
 * Rejects malformed CSVs atomically without overwriting existing demand data.
 *
 * @param props - Modal visibility, existing-demand indicator, import action, and close handler.
 * @returns CSV import modal when open, otherwise `null`.
 */
export function CsvImportModal({
  open,
  hasExistingDemand,
  onImport,
  onClose,
}: CsvImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<CsvParseError[]>([]);

  useEffect(() => {
    if (!open) return;
    setCsvText('');
    setFileName(undefined);
    setErrors([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setCsvText(content);
      setFileName(file.name);
      setErrors([]);
    } catch {
      setErrors([{ message: 'Unable to read the selected file. Try pasting the CSV text below.' }]);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!csvText.trim()) {
      setErrors([{ message: 'Select a CSV file or paste transaction CSV content first.' }]);
      return;
    }

    const res = onImport(csvText, fileName ?? 'Pasted CSV');
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            <h2 id="csv-import-title" className="text-base font-semibold text-slate-900">
              Import Transaction CSV
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close CSV import modal"
            className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-slate-700">
              Upload a weekly transaction report covering <strong>7 days × 16 hours (7am–10pm)</strong>.
              Columns in any weekday or 7-day calendar order (e.g. Fri–Thu) are normalized to{' '}
              <strong>Mon–Sun</strong> automatically.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-3">
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

              <div className="flex items-center gap-2">
                {fileName && (
                  <span className="text-xs font-medium text-slate-700">{fileName}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCsvText(DEMO_STORE_CSV_TEXT);
                    setFileName('sample_transaction_interview.csv');
                    setErrors([]);
                  }}
                  className="text-xs font-medium text-indigo-700 hover:text-indigo-800 hover:underline"
                >
                  Load sample CSV
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="csv-paste-textarea"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Or paste CSV content
              </label>
              <textarea
                id="csv-paste-textarea"
                rows={7}
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  if (errors.length > 0) setErrors([]);
                }}
                placeholder=',"Fri, 07 Aug","Sat, 08 Aug",...'
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {errors.length > 0 && (
              <div
                role="alert"
                className="space-y-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-3 text-sm text-rose-900"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
                  <span>
                    CSV import failed
                    {hasExistingDemand ? ' — existing demand data was preserved' : ''}
                  </span>
                </div>
                <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-rose-800">
                  {errors.slice(0, 8).map((err, idx) => {
                    const loc = [
                      err.row !== undefined ? `Row ${err.row}` : null,
                      err.column !== undefined ? `Col ${err.column}` : null,
                      err.dayLabel ? err.dayLabel : null,
                      err.hourLabel ? err.hourLabel : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={idx}>
                        {loc ? <strong>{loc}: </strong> : null}
                        {err.message}
                      </li>
                    );
                  })}
                  {errors.length > 8 && <li>…and {errors.length - 8} more issue(s).</li>}
                </ul>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              Import Demand
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
