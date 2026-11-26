# Dev Test Report — `shift-days-and-staff-availability` (Phase S4)

- **Change ID:** `shift-days-and-staff-availability`
- **Branch:** `feat/shift-days-and-staff-availability`
- **Date:** 2026-11-26
- **Agent:** `developer`
- **Tasks Completed:** 12 / 12 (`T1`–`T12` all `COMPLETED` in `bin/sdlc-ctx`)

---

## 1. Verification Gate Summary

| Check | Command | Result | Details |
|---|---|---|---|
| TypeScript Typecheck | `pnpm run typecheck` (`tsc --noEmit`) | **PASS** | 0 errors |
| Unit & Integration Tests | `pnpm run test:coverage` (`vitest run --coverage`) | **PASS** | 8/8 test files, 53/53 tests passing |
| Code Coverage (v8) | `pnpm run test:coverage` | **PASS** | **90.61% Stmts \| 90.12% Branch \| 91.71% Funcs \| 90.61% Lines** (threshold ≥80%) |
| Solver Benchmark | `pnpm run bench` (`vitest bench --run`) | **PASS** | Standard 0.30ms, Large 2.62ms, Worst-Case Stress (50 staff) 31.99ms (p99 34.98ms) |
| Production Build | `pnpm run build` (`vite build`) | **PASS** | Built cleanly in 1.46s (`dist/assets/index-X6wIX6ON.js` 465.84 kB) |

### Key Touched File Coverage (v8)

| File | % Stmts | % Branch | % Funcs | % Lines |
|---|---:|---:|---:|---:|
| `src/persistence/storageSchema.ts` | 100.00 | 98.48 | 100.00 | 100.00 |
| `src/state/assignmentActions.ts` | 99.02 | 87.75 | 100.00 | 99.02 |
| `src/state/scheduleEntityActions.ts` | 98.90 | 94.19 | 100.00 | 98.90 |
| `src/domain/schedulerStage1.ts` | 98.68 | 97.61 | 100.00 | 98.68 |
| `src/domain/hardRules.ts` | 98.58 | 96.42 | 100.00 | 98.58 |
| `src/domain/schedulerDiagnostics.ts` | 95.74 | 90.00 | 100.00 | 95.74 |
| `src/domain/constraints.ts` | 93.60 | 91.35 | 100.00 | 93.60 |
| `src/domain/derivedMetrics.ts` | 89.85 | 90.90 | 88.88 | 89.85 |
| `src/domain/autoScheduler.ts` | 85.68 | 87.50 | 88.23 | 85.68 |
| `src/domain/staffMetrics.ts` | 84.41 | 83.33 | 90.90 | 84.41 |

---

## 2. Task & AC Traceability Matrix

| Task | Scope | Key Files | Verified ACs |
|---|---|---|---|
| **T1** | Domain types, bitmasks, hard rules, shared 2D coverable grid | `src/domain/types.ts`, `src/domain/hardRules.ts` | `AC-P2-001`, `AC-P2-002`, `AC-P2-014` |
| **T2** | Pin conflict (`UNAVAILABLE_DAY` before early-continue), guidance, preview cascade, validation | `src/domain/constraints.ts` | `AC-P2-005`, `AC-P2-009`, `AC-P2-010`, `AC-P2-012` |
| **T3** | Immutable `shiftDayMask` & `unavailableMask` in solver state, Stage 1 & Stage 2 | `src/domain/schedulerState.ts`, `src/domain/autoScheduler.ts`, `src/domain/schedulerStage1.ts`, `src/domain/schedulerStage2.ts` | `AC-P2-006`, `AC-P2-011`, `AC-P2-013`, `AC-P2-014` |
| **T4** | 2D uncoverable grid + FM-05 guard, eligibility exclusion, `isUnavailableDay` warning | `src/domain/staffMetrics.ts`, `src/domain/derivedMetrics.ts`, `src/domain/schedulerDiagnostics.ts` | `AC-P2-007`, `AC-P2-009`, `AC-P2-010`, `AC-P2-014` |
| **T5** | Domain unit tests (solver, pin conflicts, eligibility, 2D diagnostics, warnings) | `src/__tests__/autoScheduler.test.ts`, `src/__tests__/derivedMetrics.test.ts` | `AC-P2-005`..`AC-P2-014` |
| **T6** | Checkpoint 1 verification | Domain test suite | All domain ACs |
| **T7** | Schema v1 backward compat, default omission, corrupt inactive-day rejection (ADR-001) | `src/persistence/storageSchema.ts`, `src/__tests__/persistence.test.ts` | `AC-P2-001`, `AC-P2-002` |
| **T8** | Entity CRUD + cascade delete, inactive-day assign & Ctrl+Z Undo guard | `src/state/scheduleEntityActions.ts`, `src/state/assignmentActions.ts`, `src/state/useScheduleStore.ts`, `src/__tests__/persistence.test.ts` | `AC-P2-003`, `AC-P2-005`, `AC-P2-008` |
| **T9** | Shared `WeekdayToggleGroup` + Shift active days & cascade confirm modal | `src/ui/common/WeekdayToggleGroup.tsx`, `src/ui/panels/ManageShiftsModal.tsx` | `AC-P2-003`, `AC-P2-005` |
| **T10** | Staff unavailable days toggle & concise summary (`Off: Wed, Sun` / `Off: All 7 days`) | `src/ui/panels/StaffFormModal.tsx`, `src/ui/panels/StaffPanel.tsx` | `AC-P2-008` |
| **T11** | Inactive roster cells, `Day off` warning badge, guidance reason, legend & UI integration tests | `src/ui/roster/WeeklyRosterGrid.tsx`, `src/ui/roster/AssignmentChip.tsx`, `src/ui/roster/AssignmentGuidancePopover.tsx`, `src/ui/screens/ScheduleWorkspaceScreen.tsx`, `src/ui/workspace/TopActionBar.tsx`, `src/__tests__/uiAppShellAndPrepare.test.tsx`, `src/__tests__/uiRosterAndSummary.test.tsx` | `AC-P2-003`, `AC-P2-004`, `AC-P2-005`, `AC-P2-008`, `AC-P2-009`, `AC-P2-011` |
| **T12** | Checkpoint 2 final verification gate | Full test suite + coverage + bench + build | All 14 ACs (`AC-P2-001`..`AC-P2-014`) |

---

## 3. Design Deviations

**None (0 high-risk or contract deviations).** All 4 ADRs (`ADR-001`..`ADR-004`) and 5 failure-mode mitigations (`FM-01`..`FM-05`) were implemented verbatim.

Minor low-risk sensible defaults & user-approved enhancements adopted:
- **Stage 1 MRV staff selection (User-approved Option 1):** `pickBestFitStaff` in `src/domain/schedulerStage1.ts` prioritizes staff with fewer configured available days (`countAvailableDays7(unavailableMask)`, O(1)) before Best-Fit `slack` → Jain Index → `staff.id`. Preserves flexible staff for scarce days (e.g., weekends) while remaining 100% identical to MVP behavior when all staff have 7 available days.
- Added `data-inactive-cell="true"` on inactive `WeeklyRosterGrid` cells and `data-reason-code={r.code}` on `AssignmentGuidancePopover` rows to support deterministic UI testing without coupling to CSS utility classes.
- `updateStaff` / `updateShiftTemplate` preserve existing `unavailableDays` / `daysOfWeek` when the optional argument is omitted (`undefined`), ensuring zero breakage for existing callers and MVP tests while explicit empty arrays `[]` clear unavailable days.
