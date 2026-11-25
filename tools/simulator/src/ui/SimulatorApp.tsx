import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  CalendarDays,
  Download,
  FileSpreadsheet,
  GitBranch,
  Grid3x3,
  PlayCircle,
  Upload,
  Wrench,
} from 'lucide-react';
import type { TraceRun } from '../../../../src/domain/schedulerTrace';
import { SIMULATOR_ALGORITHM_REF } from '../algorithmRef';
import type { ScenarioPresetId } from '../runner/scenarioPresets';
import { runSimulationScenario } from '../runner/scenarioRunner';
import { parseTraceRunJson } from '../runner/traceCollector';
import { usePlayback } from '../state/usePlayback';
import { DecisionPanel } from './DecisionPanel';
import { HeatmapGrid } from './HeatmapGrid';
import { MetricsChart } from './MetricsChart';
import { NarrativeCard } from './NarrativeCard';
import { PipelineFlow } from './PipelineFlow';
import { PlaybackBar } from './PlaybackBar';
import { RosterTable } from './RosterTable';
import { ScenarioPicker } from './ScenarioPicker';
import { StaffBars } from './StaffBars';

type ViewLens = 'manager' | 'debug';
type CanvasTab = 'heatmap' | 'roster' | 'pipeline';

export function SimulatorApp() {
  const [presetId, setPresetId] = useState<ScenarioPresetId>('demo_store');
  const [targetN, setTargetN] = useState<number>(15);
  const [lens, setLens] = useState<ViewLens>('manager');
  const [activeTab, setActiveTab] = useState<CanvasTab>('heatmap');
  const [customCsv, setCustomCsv] = useState<{ name: string; text: string } | null>(null);
  const [importedRun, setImportedRun] = useState<TraceRun | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);

  const safeTargetN = Number.isFinite(targetN) && targetN > 0 ? targetN : 15;

  const computedRun = useMemo(() => {
    if (importedRun) return importedRun;
    return runSimulationScenario({
      presetId,
      targetN: safeTargetN,
      customCsvText: customCsv?.text,
      customCsvFileName: customCsv?.name,
    });
  }, [importedRun, presetId, safeTargetN, customCsv]);

  const controls = usePlayback(computedRun);

  // Carry forward the latest grid, entities & assignments snapshots cleanly across steps
  const activeGrid = useMemo(() => {
    for (let i = controls.currentIndex; i >= 0; i--) {
      const g = computedRun.events[i]?.grid;
      if (g) return g;
    }
    return null;
  }, [computedRun.events, controls.currentIndex]);

  const activeEntities = useMemo(() => {
    for (let i = controls.currentIndex; i >= 0; i--) {
      const ents = computedRun.events[i]?.entities;
      if (ents) return ents;
    }
    return null;
  }, [computedRun.events, controls.currentIndex]);

  const activeAssignments = useMemo(() => {
    for (let i = controls.currentIndex; i >= 0; i--) {
      const asgn = computedRun.events[i]?.assignments;
      if (asgn) return asgn;
    }
    return [];
  }, [computedRun.events, controls.currentIndex]);

  // Keyboard shortcuts: Space (play/pause), Left/Right arrows (step)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        controls.togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        controls.stepForward();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        controls.stepBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controls]);

  const handleExportTrace = () => {
    const blob = new Blob([JSON.stringify(computedRun, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheduler-trace-${presetId}-v${computedRun.schemaVersion}.trace.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadCsv = async (file: File) => {
    setBannerError(null);
    const text = await file.text();
    setImportedRun(null);
    setPresetId('demo_store');
    setCustomCsv({ name: file.name, text });
  };

  const handleImportTrace = async (file: File) => {
    setBannerError(null);
    const text = await file.text();
    const parsed = parseTraceRunJson(text);
    if (!parsed.ok) {
      setBannerError(parsed.error);
      return;
    }
    setImportedRun(parsed.run);
  };

  const currentEvent = controls.currentEvent;

  return (
    <div className="min-h-screen bg-slate-50 pb-6 text-slate-900">
      {/* Unified Light Header — Zero Layout Shift */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2.5 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold tracking-tight text-slate-900">
                  Auto-Scheduler Step-by-Step Simulator
                </h1>
                {(() => {
                  const ref = computedRun.algorithmRef ?? SIMULATOR_ALGORITHM_REF;
                  return (
                    <span
                      title={`Algorithm commit: ${ref.algorithmCommit} (${ref.algorithmDate})\n${ref.algorithmSubject}\nRepo baseline: ${ref.baselineCommit}`}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                    >
                      <GitBranch className="h-2.5 w-2.5 text-indigo-600" />
                      algo@{ref.algorithmShortCommit}
                    </span>
                  );
                })()}
              </div>
              <p className="text-[11px] text-slate-500">
                {lens === 'debug'
                  ? `Trace Protocol v${computedRun.schemaVersion} · outcome=${computedRun.outcome} · ${computedRun.events.length} bước · base@${(computedRun.algorithmRef ?? SIMULATOR_ALGORITHM_REF).baselineShortCommit}`
                  : 'Mô phỏng trực quan cách hệ thống xếp lịch tối ưu & công bằng từng bước'}
              </p>
            </div>
          </div>

          {/* Scenario & Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <ScenarioPicker
              value={presetId}
              onChange={(preset) => {
                setImportedRun(null);
                setCustomCsv(null);
                setBannerError(null);
                setPresetId(preset.id);
                setTargetN(preset.defaultTargetN);
              }}
            />

            <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700">
              <span className="font-medium text-slate-500">N =</span>
              <input
                type="number"
                min={1}
                max={200}
                step={1}
                value={targetN}
                onChange={(e) => {
                  setImportedRun(null);
                  setTargetN(Number(e.target.value));
                }}
                className="w-12 font-mono font-semibold text-slate-900 focus:outline-none"
              />
            </label>

            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadCsv(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Nạp CSV
            </button>

            <input
              ref={traceInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportTrace(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => traceInputRef.current?.click()}
              title="Mở lại file .trace.json đã lưu"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleExportTrace}
              title="Xuất toàn bộ kịch bản mô phỏng thành .trace.json"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
            </button>

            {/* Segmented Lens Switcher — changes depth of detail WITHOUT shifting layout */}
            <div className="ml-1 flex items-center rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setLens('manager')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  lens === 'manager'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" />
                Quản lý
              </button>
              <button
                type="button"
                onClick={() => setLens('debug')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  lens === 'debug'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Wrench className="h-3.5 w-3.5" />
                Kỹ thuật
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-3 px-4 pt-3">
        {bannerError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-800">
            {bannerError}
          </div>
        )}

        {importedRun && (
          <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900">
            <span>
              Đang phát lại từ file trace đã import: <strong>{importedRun.scenarioName}</strong> ({importedRun.events.length} bước)
            </span>
            <button
              type="button"
              onClick={() => setImportedRun(null)}
              className="font-semibold underline hover:text-indigo-700"
            >
              Quay lại chạy trực tiếp
            </button>
          </div>
        )}

        {/* TOP ROW (2 Regions): Playback Bar + Metrics & Progression Chart */}
        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <PlaybackBar controls={controls} stages={computedRun.stages} />
          </div>
          <div className="xl:col-span-5">
            <MetricsChart events={computedRun.events} currentIndex={controls.currentIndex} />
          </div>
        </div>

        {/* BOTTOM ROW (3 Vertical Columns): Lưới/Lịch/Luồng | Step & Quyết định | Phân bổ giờ NV */}
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-12">
          {/* COLUMN 1: Visual Canvas (Heatmap 7x16 / Live Roster / Pipeline Flow) */}
          <div className="xl:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3.5 pt-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('heatmap')}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-xs font-semibold transition ${
                      activeTab === 'heatmap'
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                    Lưới 7×16
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('roster')}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-xs font-semibold transition ${
                      activeTab === 'roster'
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Lịch nhân viên ({activeAssignments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pipeline')}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 text-xs font-semibold transition ${
                      activeTab === 'pipeline'
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    Luồng & Lưu trữ
                  </button>
                </div>
              </div>

              <div className="p-3.5">
                {activeTab === 'heatmap' && (
                  <HeatmapGrid
                    grid={activeGrid}
                    assignments={activeAssignments}
                    targetN={safeTargetN}
                    lens={lens}
                  />
                )}
                {activeTab === 'roster' && (
                  <RosterTable
                    entities={activeEntities}
                    assignments={activeAssignments}
                    removedAssignments={currentEvent?.removedAssignments}
                  />
                )}
                {activeTab === 'pipeline' && (
                  <PipelineFlow
                    stages={computedRun.stages}
                    events={computedRun.events}
                    currentIndex={controls.currentIndex}
                    onJumpToStep={controls.jumpTo}
                  />
                )}
              </div>
            </div>
          </div>

          {/* COLUMN 2: Step Narrative + Decision / Candidate Comparison */}
          <div className="space-y-3 xl:col-span-4">
            {currentEvent && <NarrativeCard event={currentEvent} lens={lens} />}
            {currentEvent && <DecisionPanel event={currentEvent} lens={lens} />}
          </div>

          {/* COLUMN 3: Dedicated Staff Utilization Column (flexible content height) */}
          <div className="xl:col-span-2">
            <StaffBars entities={activeEntities} />
          </div>
        </div>
      </main>
    </div>
  );
}
