import { useCallback, useEffect, useState } from 'react';
import type { TraceEvent, TraceRun } from '../../../../src/domain/schedulerTrace';

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

const BASE_INTERVAL_MS = 750;

export interface PlaybackControls {
  readonly currentIndex: number;
  readonly totalSteps: number;
  readonly currentEvent: TraceEvent | null;
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly play: () => void;
  readonly pause: () => void;
  readonly togglePlay: () => void;
  readonly stepForward: () => void;
  readonly stepBack: () => void;
  readonly jumpTo: (index: number) => void;
  readonly reset: () => void;
  readonly setSpeed: (speed: PlaybackSpeed) => void;
}

export function usePlayback(run: TraceRun): PlaybackControls {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const totalSteps = run.events.length;

  // Reset playback whenever a new TraceRun is loaded
  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [run]);

  useEffect(() => {
    if (!isPlaying) return;
    if (currentIndex >= totalSteps - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setCurrentIndex((prev) => Math.min(prev + 1, totalSteps - 1));
    }, Math.round(BASE_INTERVAL_MS / speed));

    return () => window.clearTimeout(timer);
  }, [isPlaying, currentIndex, totalSteps, speed]);

  const play = useCallback(() => {
    if (currentIndex >= totalSteps - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, [currentIndex, totalSteps]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && currentIndex >= totalSteps - 1) {
        setCurrentIndex(0);
      }
      return !prev;
    });
  }, [currentIndex, totalSteps]);

  const stepForward = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.min(prev + 1, totalSteps - 1));
  }, [totalSteps]);

  const stepBack = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      setIsPlaying(false);
      setCurrentIndex(Math.max(0, Math.min(index, totalSteps - 1)));
    },
    [totalSteps],
  );

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
  }, []);

  return {
    currentIndex,
    totalSteps,
    currentEvent: run.events[currentIndex] ?? null,
    isPlaying,
    speed,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBack,
    jumpTo,
    reset,
    setSpeed,
  };
}
