# Architect Lessons — `shift-days-and-staff-availability`

## 2026-11-26 — shift-days-and-staff-availability: Isolate Immutable Constraint Masks from Mutable Occupancy Buffers in Iterative Solvers
- **Context:** Adding per-staff unavailable days (`Staff.unavailableDays`) to a 2-stage solver whose Stage 2 rebalance mutates `dayOccupied[s * 7 + d]` (`= 0` / `= 1`) during `REASSIGN` and `SWAP` moves.
- **Lesson:** Never pre-populate static constraints (like days off) into mutable occupancy buffers (`dayOccupied`). Keep static constraints in a separate `readonly Uint8Array` (`unavailableMask`) and OR them into a per-iteration local bitmask (`let mask = state.unavailableMask[s]!`) before scanning moves. This guarantees O(1) hot-loop checks with zero extra branches and eliminates bit-erasure bugs on rollback/swap.

## 2026-11-26 — shift-days-and-staff-availability: Audit Secondary Entry Points Whenever Adding a Cascade-Delete Invariant
- **Context:** Introducing `ShiftTemplate.daysOfWeek` with confirmed cascade delete on disabling shift days (`AC-P2-005`).
- **Lesson:** Guarding the primary modal/action is never sufficient. Always audit all secondary paths where historical or external records can re-enter state: (1) `restoreAssignmentsSnapshot` (in-memory `Ctrl+Z` Undo stack), (2) `storageSchema.ts` hydration of persisted payloads, (3) direct state actions (`assignStaffToShift`), and (4) derived UI lenses (`gapSlots`, `fairnessExtremes`, Health Bar ranges).
