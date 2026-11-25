# Simulator ↔ Algorithm Git Reference (Detached)

> **Status:** Detached / uncommitted simulator workspace (`tools/simulator/`).
> This file anchors the simulator to the exact git commit of the scheduling algorithm so future algorithm changes can be diffed and traced cleanly.

## Tracked Commits

| Role | Commit (Full) | Short | Date | Subject |
|---|---|---|---|---|
| **Algorithm Core** (`src/domain/autoScheduler.ts`, `schedulerStage1.ts`, `schedulerStage2.ts`, `schedulerState.ts`) | `4d968fc021be96ee56dc7c1142ee52f61630c029` | `4d968fc` | 2026-11-24 11:20:44 +0700 | `feat(domain): Implement pure scheduling domain core and T-01..T-13` |
| **Repo Baseline (HEAD)** when simulator was built | `e4daeac963790fe174b98ba1ed9d5abd8f87445b` | `e4daeac` | 2026-11-25 10:36:54 +0700 | `fix(ui): use crisp white/indigo outline for Need 2+ to eliminate amber/orange collision` |

## Useful Git Trace Commands

```bash
# Inspect all changes to the scheduling algorithm since this simulator baseline
git log 4d968fc..HEAD --oneline -- src/domain/

# Diff the algorithm core against the tracked commit
git diff 4d968fc..HEAD -- src/domain/autoScheduler.ts src/domain/schedulerStage1.ts src/domain/schedulerStage2.ts src/domain/schedulerState.ts
```

## Runtime Embedding
- Defined in code at `tools/simulator/src/algorithmRef.ts`.
- Automatically embedded in every exported `.trace.json` under `algorithmRef`.
- Displayed in the simulator header badge (`algo@4d968fc`) with full commit metadata on hover.
