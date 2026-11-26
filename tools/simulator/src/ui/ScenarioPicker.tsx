import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import {
  SCENARIO_PRESETS,
  type ScenarioPreset,
  type ScenarioPresetId,
} from '../runner/scenarioPresets';

interface ScenarioPickerProps {
  readonly value: ScenarioPresetId;
  readonly onChange: (preset: ScenarioPreset) => void;
}

function getBadgeClass(badge: string): string {
  if (badge === 'Happy Path') return 'bg-emerald-100 text-emerald-800';
  if (badge === 'Stage 2') return 'bg-indigo-100 text-indigo-800';
  if (badge.startsWith('Phase 2')) return 'bg-sky-100 text-sky-800';
  if (badge.startsWith('Stress')) return 'bg-violet-100 text-violet-800';
  if (badge === 'Pinned') return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

const GROUPS: readonly { readonly title: string; readonly ids: readonly ScenarioPresetId[] }[] = [
  {
    title: 'Kịch bản tiêu chuẩn',
    ids: ['demo_store', 'demo_stage2_rebalance', 'demo_with_pins'],
  },
  {
    title: 'Phase 2 · Ngày ca & Ngày nghỉ (MRV)',
    ids: ['phase2_mrv_availability', 'phase2_shift_active_days'],
  },
  {
    title: 'Stress-Test thuật toán (Phức tạp)',
    ids: ['complex_mixed_shifts_swap', 'complex_uncoverable_gap', 'complex_heavy_25_staff'],
  },
  {
    title: 'Kịch bản lỗi & Bảo vệ dữ liệu',
    ids: ['pin_conflict_e03', 'pin_conflict_unavailable', 'storage_corrupt_lock'],
  },
];

export function ScenarioPicker({ value, onChange }: ScenarioPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = SCENARIO_PRESETS.find((p) => p.id === value) ?? SCENARIO_PRESETS[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[300px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left text-xs shadow-xs transition hover:border-slate-400 hover:bg-slate-50 focus:border-indigo-500 focus:outline-none"
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${getBadgeClass(selected.badge)}`}
        >
          {selected.badge}
        </span>
        <span className="truncate font-semibold text-slate-800">{selected.name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1.5 max-h-[75vh] w-[420px] max-w-[92vw] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-slate-900/5"
        >
          {GROUPS.map((group, gIdx) => (
            <div key={group.title} className={gIdx > 0 ? 'mt-2 border-t border-slate-100 pt-2' : ''}>
              <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.ids.map((id) => {
                  const preset = SCENARIO_PRESETS.find((p) => p.id === id);
                  if (!preset) return null;
                  const isSelected = preset.id === value;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(preset);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                        isSelected
                          ? 'bg-indigo-50 ring-1 ring-indigo-200'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${getBadgeClass(preset.badge)}`}
                          >
                            {preset.badge}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{preset.name}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-500">
                          {preset.shortDescription}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                          N={preset.defaultTargetN}
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
