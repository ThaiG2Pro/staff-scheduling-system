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
  algorithmCommit: '25bd31e177155de5517a2ac2d0e9550333ec2940',
  algorithmShortCommit: '25bd31e',
  algorithmDate: '2026-11-26 13:34:47 +0700',
  algorithmSubject: 'feat(domain): add shift active days, staff availability, and Stage 1 MRV priority',
  baselineCommit: '97648651a76c5a38f32ece269a65bf5d0a00eadb',
  baselineShortCommit: '9764865',
} as const;
