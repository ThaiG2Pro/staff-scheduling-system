import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { TraceStageRange } from '../../../../src/domain/schedulerTrace';
import type { PlaybackControls, PlaybackSpeed } from '../state/usePlayback';

interface PlaybackBarProps {
  readonly controls: PlaybackControls;
  readonly stages: readonly TraceStageRange[];
}

const SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 2, 4];

export function PlaybackBar({ controls, stages }: PlaybackBarProps) {
  const { currentIndex, totalSteps, isPlaying, speed } = controls;

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Transport buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={controls.reset}
            title="Về đầu (Reset)"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            disabled={currentIndex === 0}
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={controls.stepBack}
            title="Bước trước (←)"
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={controls.togglePlay}
            title="Phát / Tạm dừng (Space)"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isPlaying ? 'Tạm dừng' : currentIndex >= totalSteps - 1 ? 'Chạy lại' : 'Phát'}</span>
          </button>
          <button
            type="button"
            onClick={controls.stepForward}
            title="Bước tiếp (→)"
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={currentIndex >= totalSteps - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => controls.jumpTo(totalSteps - 1)}
            title="Tới bước cuối"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            disabled={currentIndex >= totalSteps - 1}
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        {/* Scrubber */}
        <div className="flex min-w-[200px] flex-1 items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalSteps - 1)}
            value={currentIndex}
            onChange={(e) => controls.jumpTo(Number(e.target.value))}
            aria-label="Thanh tiến trình mô phỏng"
            className="h-2 flex-1 cursor-pointer accent-indigo-600"
          />
          <span className="shrink-0 font-mono text-xs font-semibold text-slate-600">
            Bước {currentIndex + 1} / {totalSteps}
          </span>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => controls.setSpeed(s)}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                speed === s
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {s}x
            </button>
          ))}
          <button
            type="button"
            onClick={controls.reset}
            title="Đặt lại bước 1"
            className="ml-1 rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Dynamic Stage Stepper (self-describing from TraceRun.stages) */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
        {stages.map((stage, idx) => {
          const isCurrent = currentIndex >= stage.startSeq && currentIndex <= stage.endSeq;
          const isDone = currentIndex > stage.endSeq;
          const stepCount = stage.endSeq - stage.startSeq + 1;
          return (
            <button
              key={`${stage.id}-${idx}`}
              type="button"
              onClick={() => controls.jumpTo(stage.startSeq)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                isCurrent
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-2 ring-indigo-100'
                  : isDone
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isCurrent ? 'bg-indigo-600' : isDone ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              />
              <span>{stage.label}</span>
              <span className="font-mono text-[10px] opacity-70">({stepCount})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
