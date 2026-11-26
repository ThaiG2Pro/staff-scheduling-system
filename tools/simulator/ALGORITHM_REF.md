# Simulator ↔ Algorithm Git Reference

> This file anchors the simulator (`tools/simulator/`) to the exact git commit of the scheduling algorithm so future algorithm changes can be diffed and traced cleanly.

## Tracked Commits

| Role | Commit (Full) | Short | Date | Subject |
|---|---|---|---|---|
| **Algorithm Core** (`src/domain/autoScheduler.ts`, `schedulerStage1.ts`, `schedulerStage2.ts`, `schedulerState.ts`, `hardRules.ts`) | `25bd31e177155de5517a2ac2d0e9550333ec2940` | `25bd31e` | 2026-11-26 13:34:47 +0700 | `feat(domain): add shift active days, staff availability, and Stage 1 MRV priority` |
| **Repo Baseline (HEAD)** when simulator was synced | `97648651a76c5a38f32ece269a65bf5d0a00eadb` | `9764865` | 2026-11-26 13:40:09 +0700 | `Merge branch 'feat/shift-days-and-staff-availability' into feat/staff-scheduling-mvp` |

### Previous Tracked Revisions
- `4d968fc` (2026-11-24) — Initial MVP pure scheduling domain core (simulator v1 committed at `46057f9`).

## Useful Git Trace Commands

```bash
# Inspect all changes to the scheduling algorithm since this simulator baseline
git log 25bd31e..HEAD --oneline -- src/domain/

# Diff the algorithm core against the tracked commit
git diff 25bd31e..HEAD -- src/domain/autoScheduler.ts src/domain/schedulerStage1.ts src/domain/schedulerStage2.ts src/domain/schedulerState.ts src/domain/hardRules.ts
```

## Runtime Embedding
- Defined in code at `tools/simulator/src/algorithmRef.ts`.
- Automatically embedded in every exported `.trace.json` under `algorithmRef`.
- Displayed in the simulator header badge (`algo@25bd31e`) with full commit metadata on hover.
