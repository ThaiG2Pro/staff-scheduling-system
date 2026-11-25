import type { TraceAlgorithmRef } from '../../../src/domain/schedulerTrace';

/**
 * Detached git commit reference for the core scheduling algorithm that this
 * simulator build is aligned against.
 *
 * Update this file whenever `src/domain/autoScheduler.ts`, `schedulerStage1.ts`,
 * `schedulerStage2.ts`, or `schedulerState.ts` changes in git history so exported
 * `.trace.json` runs and UI sessions remain traceable to the exact solver revision.
 */
export const SIMULATOR_ALGORITHM_REF: TraceAlgorithmRef = {
  algorithmCommit: '4d968fc021be96ee56dc7c1142ee52f61630c029',
  algorithmShortCommit: '4d968fc',
  algorithmDate: '2026-11-24 11:20:44 +0700',
  algorithmSubject: 'feat(domain): Implement pure scheduling domain core and T-01..T-13',
  baselineCommit: 'e4daeac963790fe174b98ba1ed9d5abd8f87445b',
  baselineShortCommit: 'e4daeac',
} as const;
