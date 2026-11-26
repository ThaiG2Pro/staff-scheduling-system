# Proposal for shift-days-and-staff-availability

## Acceptance Criteria

- **AC-P2-001** [CONFIRMED]: Backward-compatible schemaVersion 1 load for optional shift days and staff days off
  GIVEN a persisted localStorage schedule payload at schemaVersion 1 without daysOfWeek on ShiftTemplate or unavailableDays on Staff WHEN the application loads and validates the payload THEN it succeeds without migration error, treating undefined daysOfWeek as [0,1,2,3,4,5,6] and undefined unavailableDays as [].

- **AC-P2-002** [CONFIRMED]: Strict structural validation for daysOfWeek and unavailableDays in storageSchema
  GIVEN a schedule payload validated by storageSchema.ts WHEN daysOfWeek or unavailableDays contains non-integer values, out-of-range values outside 0..6, duplicate days, or daysOfWeek is an empty array [] THEN validation rejects the payload and triggers the existing storage recovery flow.

- **AC-P2-003** [CONFIRMED]: ManageShiftsModal 7-day toggle and minimum 1 active day guard
  GIVEN the ManageShiftsModal UI for creating or editing a ShiftTemplate WHEN Manager views a shift THEN 7 day toggles (T2..CN) are displayed with all 7 enabled by default for new shifts, and attempting to disable the last remaining active day is blocked or surfaces a clear validation error preventing saving a 0-day shift.

- **AC-P2-004** [CONFIRMED]: WeeklyRosterGrid disabled state for inactive shift-day cells
  GIVEN a ShiftTemplate with one or more inactive days in daysOfWeek WHEN WeeklyRosterGrid renders the 7-day roster THEN cells (day, shift) for inactive days are rendered in a disabled/muted/hatched state and hide the + Assign button.

- **AC-P2-005** [CONFIRMED]: Confirmed atomic cascade delete when disabling shift days with existing assignments
  GIVEN a ShiftTemplate that has existing assignments (regular and/or pinned) on day(s) being disabled WHEN Manager disables those day(s) and requests save THEN the system previews the exact total count of affected assignments in a confirmation dialog, preserves state if cancelled, and atomically cascade-deletes all affected assignments in a single immutable update upon confirmation.

- **AC-P2-006** [CONFIRMED]: Stage 1 solver skips inactive shift days via shiftDayMask
  GIVEN a schedule with ShiftTemplates having restricted daysOfWeek WHEN Auto-schedule Stage 1 runs Step 1A, Step 1B, and collectStage1TraceCandidates THEN every (d, sIdx) pair where (shiftDayMask[sIdx] & (1 << d)) === 0 is skipped and never allocated.

- **AC-P2-007** [CONFIRMED]: Upgrade coverability matrix from 1D hourCoverable to 2D cellCoverable (7x16)
  GIVEN a schedule where demand exists on days with no active shift covering certain hours (e.g., Mon-Fri demand with a Sat-Sun-only shift) WHEN derivedMetrics.ts and schedulerDiagnostics.ts compute coverage metrics THEN a 2D cellCoverable Uint8Array(7 * 16) indexed by d * 16 + (h - 7) is used so uncoverableRequiredStaffHours and residualCoverableShortageHours reflect per-day coverability accurately.

- **AC-P2-008** [CONFIRMED]: StaffFormModal 7-day unavailability toggles and StaffPanel summary
  GIVEN StaffFormModal and StaffPanel WHEN Manager creates or edits a staff member THEN 7 day-off toggles (T2..CN) allow toggling unavailableDays on/off, and StaffPanel displays a concise day-off summary (e.g., Off: T4, CN) on the staff card.

- **AC-P2-009** [CONFIRMED]: Manual assignment guidance warning and AssignmentChip badge for unavailable days
  GIVEN a staff member whose unavailableDays includes day d WHEN Manager opens AssignmentGuidancePopover for (d, shift) THEN the staff member is classified under Requires Attention with reason code STAFF_UNAVAILABLE_ON_DAY while still allowing explicit manual override, and any resulting or pre-existing assignment on an unavailable day renders an isUnavailableDay warning badge on AssignmentChip.

- **AC-P2-010** [CONFIRMED]: Exclude 7-day-unavailable staff from eligibleStaff, Jain Fairness Index, and ELIGIBLE_STAFF gate
  GIVEN a staff member with unavailableDays.length === 7 WHEN eligibleStaff is computed for Auto-schedule and Jain Fairness Index THEN that staff member is excluded identically to maxWeeklyHours === 0, does not enter Stage 1/2 or the Jain Index denominator, and if no staff remain eligible the system reports missing input ELIGIBLE_STAFF (E-02).

- **AC-P2-011** [CONFIRMED]: Pin Conflict Gate blocks Auto-schedule on UNAVAILABLE_DAY pinned conflicts
  GIVEN a staff member with a Pinned assignment on day d where d is in staff.unavailableDays WHEN Manager triggers Auto-schedule THEN checkPinConflicts blocks execution at the Pin Conflict Gate and reports a conflict of type UNAVAILABLE_DAY; unpinned assignments on unavailable days are cleared and re-scheduled without blocking.

- **AC-P2-012** [CONFIRMED]: Stage 1 pickBestFitStaff enforces unavailableMask in O(1)
  GIVEN eligible staff with precomputed unavailableMask: Uint8Array WHEN Stage 1 pickBestFitStaff evaluates candidates for day d THEN any staff member with (unavailableMask[i] & (1 << d)) !== 0 is skipped in O(1) and never assigned on their unavailable day.

- **AC-P2-013** [CONFIRMED]: Stage 2 rebalance preserves unavailableMask and 112-cell coverage matrix
  GIVEN Stage 2 findBestRebalanceMove building per-iteration dayMask[s] WHEN evaluating REASSIGN and SWAP moves THEN dayMask[s] initializes from immutable state.unavailableMask[s] ORed with occupied days (without mutating unavailableMask into dayOccupied), guaranteeing zero assignments on unavailable days and 100% preservation of the 112-cell coverage matrix.

- **AC-P2-014** [CONFIRMED]: Post-condition validation of shift active days and staff availability in constraints.ts
  GIVEN candidate assignments produced by Auto-schedule WHEN validateCandidateAssignments executes in constraints.ts THEN every generated assignment is verified against both checkShiftActiveOnDayRule(shift, day) and checkStaffAvailableOnDayRule(staff, day).

- **BR-P2-001** [CONFIRMED]: Shift active days normalization and non-empty invariant
  A ShiftTemplate must always have at least 1 active day in 0..6; undefined daysOfWeek normalizes to all 7 days [0..6] and duplicate (startHour, endHour) pairs remain forbidden within a Schedule.

- **BR-P2-002** [CONFIRMED]: Cascade delete with confirmation on disabling shift days
  Disabling active day(s) on a ShiftTemplate with existing assignments (regular or pinned) requires explicit user confirmation with exact affected count and performs atomic immutable cascade deletion.

- **BR-P2-003** [CONFIRMED]: Extended staff eligibility rule for Auto-schedule and Jain Index
  Staff eligibility requires both maxWeeklyHours > 0 and (unavailableDays?.length ?? 0) < 7; ineligible staff are excluded from Auto-schedule and Jain Fairness Index denominator.

- **BR-P2-004** [CONFIRMED]: Asymmetric enforcement of staff unavailableDays between Auto-schedule and manual edits
  Asymmetric constraint enforcement: Auto-schedule treats unavailableDays as a hard constraint (blocking on Pinned conflicts via UNAVAILABLE_DAY), whereas manual Manager edits allow confirmed soft-warning overrides with visual warning badges.

- **BR-P2-005** [CONFIRMED]: Demo Store seed backward compatibility
  Existing Demo Store seed data remains backward-compatible at schemaVersion 1 without requiring seed mutation.

