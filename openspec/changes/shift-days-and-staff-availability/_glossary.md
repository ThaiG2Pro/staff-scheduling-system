# Change Glossary — `shift-days-and-staff-availability`

| Term | Canonical Definition | Boundary / Notes |
|------|----------------------|------------------|
| `Shift Active Day` | Weekday `d ∈ 0..6` (`0 = Mon .. 6 = Sun`) included in `ShiftTemplate.daysOfWeek` (defaults to `[0..6]` when `undefined`). | Shift must have ≥ 1 active day; inactive `(d, shift)` cells are disabled in UI and skipped in Stage 1. |
| `Unavailable Day` | Weekday `d ∈ 0..6` included in `Staff.unavailableDays` (defaults to `[]` when `undefined`). | Hard constraint in Auto-schedule (`unavailableMask`) & Pin Conflict Gate (`UNAVAILABLE_DAY`); overridable soft warning in manual edits. |
| `Eligible Staff` | Staff member with `maxWeeklyHours > 0` AND `(unavailableDays?.length ?? 0) < 7`. | Extends MVP definition; excludes 7-day-unavailable staff from Stage 1/2, Jain Fairness Index, `utilization`, `unusedCapacityHours`, and `ELIGIBLE_STAFF`. |
| `cellCoverable` | 2D `Uint8Array(7 * 16)` indexed by `d * 16 + (h - 7)` marking whether any active shift covers cell `(d, h)`. | Built via shared `buildCellCoverableGrid(shifts)` in `hardRules.ts`; replaces 1D `hourCoverable(16)`. |
| `shiftDayMask` | Immutable `Uint8Array(sortedShifts.length)` in `SchedulerWorkingState`; bit `1 << d` is 1 iff shift is active on day `d` (`0x7F` = all 7 days). | Checked in O(1) across Stage 1 Step 1A, Step 1B, and `collectStage1TraceCandidates`. |
| `unavailableMask` | Immutable `Uint8Array(eligibleStaff.length)` in `SchedulerWorkingState`; bit `1 << d` is 1 iff staff is unavailable on day `d`. | Never mutated into `dayOccupied`; ORed into local `dayMask[s]` each Stage 2 iteration. |
| `WeekdayToggleGroup` | Shared accessible 7-day button group (`src/ui/common/WeekdayToggleGroup.tsx`) using `DAY_LABELS` (`Mon`–`Sun`, mapped `0=Mon/T2..6=Sun/CN`). | Reused by `ManageShiftsModal` (`minSelected=1`) and `StaffFormModal` (`minSelected=0`). |
