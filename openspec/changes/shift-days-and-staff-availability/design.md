# Technical Design for shift-days-and-staff-availability

## Architecture Decisions

### None
- Decision: Optional field normalization and strict inactive-day assignment rejection in storageSchema: Chosen 'Keep schemaVersion 1 with optional daysOfWeek? and unavailableDays?; omit default values ([0..6]/[]) on write; reject malformed day arrays and assignments on inactive shift days as CORRUPT_SCHEMA.'
- Reasoning: Context: . Rationale: Zero migration risk, 100% MVP snapshot test compatibility, and prevents illegal persisted assignments from bypassing disabled cells or crashing candidate validation.

### None
- Decision: Immutable solver bitmasks (shiftDayMask, unavailableMask) and shared 2D cellCoverable helper: Chosen 'Store separate immutable shiftDayMask and unavailableMask Uint8Arrays in SchedulerWorkingState; Stage 2 ORs unavailableMask[s] into local dayMask[s] each iteration; share buildCellCoverableGrid(shifts) in hardRules.ts.'
- Reasoning: Context: . Rationale: O(1) checks with zero extra branches in Stage 2 SWAP inner loop, prevents applyRebalanceMove from erasing day-off bits, and eliminates 7x16 index drift across derivedMetrics and schedulerDiagnostics.

### None
- Decision: Defense-in-depth for inactive shift days and unified isStaffEligible predicate: Chosen 'Centralize isStaffEligible(staff) in hardRules.ts for solver, Jain Index, utilization (null when ineligible), unusedCapacityHours, and ELIGIBLE_STAFF gate; guard assignStaffToShift, restoreAssignmentsSnapshot (Undo), and WeeklyRosterGrid gapSlots with isShiftActiveOnDay.'
- Reasoning: Context: . Rationale: Eliminates Ctrl+Z resurrection onto disabled cells, prevents 7-day-off staff from skewing Health Bar Range / Rebalance Lens, and keeps Gap Focus Lens on active cells only.

### None
- Decision: Reusable WeekdayToggleGroup component with consistent English DAY_LABELS (Mon-Sun): Chosen 'Build shared src/ui/common/WeekdayToggleGroup.tsx using canonical DAY_LABELS (Mon..Sun, Off: Wed, Sun) with minSelected guard for ManageShiftsModal (min=1) and StaffFormModal (min=0).'
- Reasoning: Context: . Rationale: Matches 100% of existing English UI headers (WeeklyRosterGrid, StaffPanel) and test suites while avoiding duplicated toggle markup.

## Database Schemas

- Table `entity`: ACTIVE

## Endpoints

