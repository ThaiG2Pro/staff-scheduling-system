import { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, Code2, Scale, XCircle } from 'lucide-react';
import type { TraceEvent } from '../../../../src/domain/schedulerTrace';

interface DecisionPanelProps {
  readonly event: TraceEvent;
  readonly lens: 'manager' | 'debug';
}

export function DecisionPanel({ event, lens }: DecisionPanelProps) {
  const [showJson, setShowJson] = useState(false);
  const [jsonSearch, setJsonSearch] = useState('');

  const candidates = event.candidates ?? [];
  const criteriaGuide = event.ruleHint ?? null;

  const scoreKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of candidates) {
      for (const k of Object.keys(c.scores)) keys.add(k);
    }
    return Array.from(keys);
  }, [candidates]);

  const formattedJson = useMemo(() => {
    const raw = JSON.stringify(event.debugPayload ?? {}, null, 2);
    if (!jsonSearch.trim()) return raw;
    const q = jsonSearch.trim().toLowerCase();
    return raw
      .split('\n')
      .filter((line) => line.toLowerCase().includes(q))
      .join('\n');
  }, [event.debugPayload, jsonSearch]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
          <Scale className="h-3.5 w-3.5 text-indigo-600" />
          {lens === 'manager' ? 'Vì sao chọn phương án này?' : 'So sánh ứng viên & Điểm số'}
        </h3>
        {candidates.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
            Top {candidates.length} (đã xếp hạng)
          </span>
        )}
      </div>

      {/* Contextual Algorithm Criteria Box so users immediately understand WHY */}
      {criteriaGuide && (
        <div className="mt-2.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-950">
          <div className="mb-1 flex items-center gap-1.5 font-bold text-indigo-900">
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            {criteriaGuide.title}
          </div>
          <ul className="space-y-0.5 leading-snug text-indigo-900/90">
            {criteriaGuide.rules.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Candidate Comparison Content */}
      <div className="mt-2.5">
        {candidates.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {lens === 'manager'
              ? 'Bước này là bước chuẩn bị / kiểm tra hệ thống, chưa có phép so sánh chọn nhân viên.'
              : 'Không có danh sách ứng viên ở bước này. Xem Raw Debug Payload bên dưới nếu cần.'}
          </p>
        ) : lens === 'manager' ? (
          /* Manager Lens: Clean plain-Vietnamese cards (Winner vs Alternatives/Rejected) */
          <div className="space-y-2">
            {candidates.slice(0, 5).map((c) => {
              const isWinner = c.status === 'WINNER';
              const isRejected = c.status === 'REJECTED';
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    isWinner
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : isRejected
                        ? 'border-rose-200 bg-rose-50/40'
                        : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900">{c.label}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isWinner
                          ? 'bg-emerald-100 text-emerald-800'
                          : isRejected
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {isWinner ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" /> Được chọn
                        </>
                      ) : isRejected ? (
                        <>
                          <XCircle className="h-3 w-3" /> Không hợp lệ
                        </>
                      ) : (
                        'Kém ưu tiên hơn'
                      )}
                    </span>
                  </div>
                  {c.reason && <p className="mt-1 text-[11px] text-slate-600">{c.reason}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          /* Debug Lens: Full technical scoring table in crisp light theme */
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Ứng viên</th>
                  {scoreKeys.map((k) => (
                    <th key={k} className="px-2 py-1.5 font-mono">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    className={
                      c.status === 'WINNER'
                        ? 'bg-emerald-50/70 font-medium'
                        : c.status === 'REJECTED'
                          ? 'bg-rose-50/30'
                          : ''
                    }
                  >
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                          c.status === 'WINNER'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.status === 'RUNNER_UP'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-800">
                      <div>{c.label}</div>
                      {c.reason && <div className="text-[10px] text-slate-500">{c.reason}</div>}
                    </td>
                    {scoreKeys.map((k) => (
                      <td key={k} className="px-2 py-1.5 font-mono text-slate-700">
                        {c.scores[k] !== undefined ? String(c.scores[k]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Collapsible Raw Debug Payload (only in Debug lens — unified light theme!) */}
      {lens === 'debug' && (
        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span className="inline-flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5 text-indigo-600" />
              Raw Debug Payload (JSON)
            </span>
            {showJson ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>

          {showJson && (
            <div className="mt-2 space-y-1.5">
              <input
                type="text"
                value={jsonSearch}
                onChange={(e) => setJsonSearch(e.target.value)}
                placeholder="Lọc dòng JSON (VD: deltaJ, BigInt, storageMode)..."
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              />
              <pre className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800">
                {formattedJson || '(Không có dòng nào khớp)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
