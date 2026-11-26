/**
 * @file Unit and integration tests for Persistence, State Actions, Demo Store, and 4-Mode Defense.
 * Covers mandatory acceptance tests T-14 and T-15 (AC-01, AC-06) plus exhaustive schema validation.
 */

import { describe, expect, it } from 'vitest';
import { DEMO_STORE_CSV_TEXT } from '../domain/demoData';
import { deriveScheduleViewModel } from '../domain/derivedMetrics';
import { loadState, resetStorageAtomic, saveState } from '../persistence/localStorageAdapter';
import { validatePersistedState } from '../persistence/storageSchema';
import {
  PRIMARY_STORAGE_KEY,
  RECOVERY_BACKUP_KEY,
  createEmptyPersistedState,
  type PersistedAppState,
  type StorageLike,
} from '../persistence/storageTypes';
import type { ActionDeps } from '../state/actionTypes';
import {
  assignStaffToShift,
  reassignStaff,
  restoreAssignmentsSnapshot,
  togglePinAssignment,
  unassignStaff,
} from '../state/assignmentActions';
import {
  commitAutoScheduleWithRevision,
  createSchedule,
  deleteSchedule,
  executeAutoSchedule,
  importCsvToSchedule,
  loadDemoStore,
  renameSchedule,
  setActiveSchedule,
  setTargetTxnsPerStaffHour,
} from '../state/scheduleActions';
import {
  addShiftTemplate,
  addStaff,
  deleteShiftTemplate,
  deleteStaff,
  previewDeleteShiftInSchedule,
  previewDeleteStaffInSchedule,
  previewDisableShiftDaysInSchedule,
  previewEditShiftInSchedule,
  reorderShiftTemplates,
  updateShiftTemplate,
  updateStaff,
} from '../state/scheduleEntityActions';

function createDeterministicDeps(startTick = 1): ActionDeps {
  let seq = 0;
  let tick = startTick;
  return {
    generateId: () => `id-${++seq}`,
    nowIso: () => new Date(Date.UTC(2026, 7, 10, 8, 0, tick++)).toISOString(),
  };
}

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  failGet = false;
  failSetKeys = new Set<string>();
  failAllSets = false;

  getItem(key: string): string | null {
    if (this.failGet) {
      throw new Error('SecurityError: LocalStorage access denied');
    }
    return this.data.has(key) ? (this.data.get(key) ?? null) : null;
  }

  setItem(key: string, value: string): void {
    if (this.failAllSets || this.failSetKeys.has(key)) {
      throw new Error('QuotaExceededError: Storage quota exceeded');
    }
    this.data.set(key, value);
  }
}

describe('persistence & state (T-14, T-15, AC-01, AC-06)', () => {
  it('T-14: serializes/hydrates Source of Truth only, enforces strict schedule scoping, reassign-unpin, cascades & shift edit ripple (AC-01, AC-06)', () => {
    const storage = new MemoryStorage();
    const deps = createDeterministicDeps();

    // 1. Load Demo Store & run Auto-schedule
    const demoRes = loadDemoStore(createEmptyPersistedState(), deps);
    let state: PersistedAppState = demoRes.state;
    const demoId = demoRes.scheduleId;

    const demoSchedule = state.schedules[0]!;
    expect(demoSchedule.staff).toHaveLength(9);
    expect(demoSchedule.shifts).toHaveLength(2);
    expect(demoSchedule.demand).not.toBeNull();
    expect(demoSchedule.demand?.sourceFileName).toBe('Demo Store');

    const autoRes = executeAutoSchedule(state, demoId, deps);
    expect(autoRes.committed).toBe(true);
    expect(autoRes.result.status).toBe('SUCCESS');
    state = autoRes.state;

    // 2. Create a second independent schedule to verify Strict Schedule Scoping
    const s2Res = createSchedule(state, 'Branch B Week', deps);
    expect(s2Res.ok).toBe(true);
    if (!s2Res.ok) return;
    state = s2Res.state;
    const s2Id = s2Res.scheduleId;

    const addAliceRes = addStaff(state, s2Id, { name: 'Alice', maxWeeklyHours: 20 }, deps);
    expect(addAliceRes.ok).toBe(true);
    if (!addAliceRes.ok) return;
    state = addAliceRes.state;
    const aliceId = addAliceRes.staffId;

    const addBobRes = addStaff(state, s2Id, { name: 'Bob', maxWeeklyHours: 20 }, deps);
    expect(addBobRes.ok).toBe(true);
    if (!addBobRes.ok) return;
    state = addBobRes.state;
    const bobId = addBobRes.staffId;

    const s2 = state.schedules.find((s) => s.id === s2Id)!;
    const morningShiftId = s2.shifts[0]!.id;

    // Assign Alice on Mon morning, then Pin it
    const assignRes = assignStaffToShift(
      state,
      s2Id,
      { day: 0, shiftId: morningShiftId, staffId: aliceId },
      deps,
    );
    expect(assignRes.ok).toBe(true);
    if (!assignRes.ok) return;
    state = assignRes.state;

    const pinRes = togglePinAssignment(state, s2Id, assignRes.assignmentId, deps);
    expect(pinRes.ok).toBe(true);
    if (!pinRes.ok) return;
    expect(pinRes.isPinned).toBe(true);
    state = pinRes.state;

    // Cross-schedule scoping: Alice does NOT exist in Demo Store
    expect(previewDeleteStaffInSchedule(state, demoId, aliceId).affectedAssignmentsCount).toBe(0);
    expect(deleteStaff(state, demoId, aliceId, deps).ok).toBe(false);

    // Reassign to same staff is a no-op and does not change updatedAt
    const updatedBeforeNoOp = state.schedules.find((s) => s.id === s2Id)!.updatedAt;
    const noOpReassign = reassignStaff(state, s2Id, assignRes.assignmentId, aliceId, deps);
    expect(noOpReassign.ok).toBe(true);
    if (noOpReassign.ok) {
      expect(noOpReassign.changed).toBe(false);
      expect(noOpReassign.state).toBe(state);
    }
    expect(state.schedules.find((s) => s.id === s2Id)!.updatedAt).toBe(updatedBeforeNoOp);

    // Reassign pinned assignment from Alice -> Bob MUST produce an Unpinned assignment (E-05)
    const reassignRes = reassignStaff(state, s2Id, assignRes.assignmentId, bobId, deps);
    expect(reassignRes.ok).toBe(true);
    if (!reassignRes.ok) return;
    state = reassignRes.state;
    const reassigned = state.schedules
      .find((s) => s.id === s2Id)!
      .assignments.find((a) => a.id === reassignRes.assignmentId)!;
    expect(reassigned.staffId).toBe(bobId);
    expect(reassigned.isPinned).toBe(false);

    // Pin Bob's assignment and test ShiftTemplate edit ripple-effect (E-09)
    const pinBobRes = togglePinAssignment(state, s2Id, reassigned.id, deps);
    expect(pinBobRes.ok).toBe(true);
    if (!pinBobRes.ok) return;
    state = pinBobRes.state;

    expect(previewEditShiftInSchedule(state, s2Id, morningShiftId).affectedAssignmentsCount).toBe(1);
    const editShiftRes = updateShiftTemplate(
      state,
      s2Id,
      morningShiftId,
      { startHour: 7, endHour: 17 },
      deps,
    );
    expect(editShiftRes.ok).toBe(true);
    if (!editShiftRes.ok) return;
    state = editShiftRes.state;
    const afterEditAssignment = state.schedules.find((s) => s.id === s2Id)!.assignments[0]!;
    expect(afterEditAssignment.id).toBe(reassigned.id);
    expect(afterEditAssignment.isPinned).toBe(true);

    // Changing activeScheduleId MUST NOT modify any Schedule.updatedAt
    const demoUpdatedBeforeNav = state.schedules.find((s) => s.id === demoId)!.updatedAt;
    const s2UpdatedBeforeNav = state.schedules.find((s) => s.id === s2Id)!.updatedAt;
    const navRes = setActiveSchedule(state, demoId);
    expect(navRes.ok).toBe(true);
    if (!navRes.ok) return;
    state = navRes.state;
    expect(state.activeScheduleId).toBe(demoId);
    expect(state.schedules.find((s) => s.id === demoId)!.updatedAt).toBe(demoUpdatedBeforeNav);
    expect(state.schedules.find((s) => s.id === s2Id)!.updatedAt).toBe(s2UpdatedBeforeNav);

    // Save & Hydrate round-trip: verify zero Derived State leaked into JSON
    const saveRes = saveState(state, () => storage);
    expect(saveRes.ok).toBe(true);
    const rawJson = storage.getItem(PRIMARY_STORAGE_KEY)!;
    expect(rawJson).not.toContain('assignedHours');
    expect(rawJson).not.toContain('fairnessJainIndex');
    expect(rawJson).not.toContain('staffingGapCount');

    const loaded = loadState(() => storage);
    expect(loaded.storageMode).toBe('normal');
    expect(loaded.saveStatus).toBe('saved');
    expect(loaded.state).toEqual(state);

    // Derived State re-computes identically after reload
    const beforeVm = deriveScheduleViewModel(state.schedules[0]!);
    const afterVm = deriveScheduleViewModel(loaded.state.schedules[0]!);
    expect(afterVm).toEqual(beforeVm);

    // Delete Staff cascade & preview (E-08)
    expect(previewDeleteStaffInSchedule(state, s2Id, bobId).affectedAssignmentsCount).toBe(1);
    const delStaffRes = deleteStaff(state, s2Id, bobId, deps);
    expect(delStaffRes.ok).toBe(true);
    if (!delStaffRes.ok) return;
    expect(delStaffRes.removedAssignmentsCount).toBe(1);
    state = delStaffRes.state;
    expect(state.schedules.find((s) => s.id === s2Id)!.assignments).toHaveLength(0);

    // Assign Alice, then Delete ShiftTemplate cascade & preview (E-08)
    const assignAliceAgain = assignStaffToShift(
      state,
      s2Id,
      { day: 1, shiftId: morningShiftId, staffId: aliceId },
      deps,
    );
    expect(assignAliceAgain.ok).toBe(true);
    if (!assignAliceAgain.ok) return;
    state = assignAliceAgain.state;

    expect(previewDeleteShiftInSchedule(state, s2Id, morningShiftId).affectedAssignmentsCount).toBe(1);
    const delShiftRes = deleteShiftTemplate(state, s2Id, morningShiftId, deps);
    expect(delShiftRes.ok).toBe(true);
    if (!delShiftRes.ok) return;
    expect(delShiftRes.removedAssignmentsCount).toBe(1);
    state = delShiftRes.state;
    expect(state.schedules.find((s) => s.id === s2Id)!.assignments).toHaveLength(0);

    // Reorder shift templates & validate error guards
    const extraShiftRes = addShiftTemplate(state, s2Id, { startHour: 10, endHour: 14 }, deps);
    expect(extraShiftRes.ok).toBe(true);
    if (!extraShiftRes.ok) return;
    state = extraShiftRes.state;
    const currentShifts = state.schedules.find((s) => s.id === s2Id)!.shifts;
    expect(currentShifts.length).toBe(2);
    const reversedIds = [currentShifts[1]!.id, currentShifts[0]!.id];

    const reorderRes = reorderShiftTemplates(state, s2Id, reversedIds, deps);
    expect(reorderRes.ok).toBe(true);
    if (!reorderRes.ok) return;
    expect(reorderRes.changed).toBe(true);
    state = reorderRes.state;
    expect(state.schedules.find((s) => s.id === s2Id)!.shifts.map((sh) => sh.id)).toEqual(reversedIds);

    // Unchanged order returns changed: false
    const sameOrderRes = reorderShiftTemplates(state, s2Id, reversedIds, deps);
    expect(sameOrderRes.ok).toBe(true);
    if (sameOrderRes.ok) expect(sameOrderRes.changed).toBe(false);

    // Invalid permutations rejected
    expect(reorderShiftTemplates(state, s2Id, [reversedIds[0]!], deps).ok).toBe(false);
    expect(reorderShiftTemplates(state, s2Id, [reversedIds[0]!, reversedIds[0]!], deps).ok).toBe(false);
    expect(reorderShiftTemplates(state, s2Id, [reversedIds[0]!, 'unknown-id'], deps).ok).toBe(false);
  });

  it('T-15: enforces 4 storage modes, orphan stripping, save error handling, and Atomic Reset Contract (AC-06)', () => {
    // 1. First launch (getItem === null) -> normal
    const emptyStorage = new MemoryStorage();
    const firstLaunch = loadState(() => emptyStorage);
    expect(firstLaunch.storageMode).toBe('normal');
    expect(firstLaunch.saveStatus).toBe('saved');
    expect(firstLaunch.state.schedules).toHaveLength(0);

    // 2. Empty string "" -> recovery_locked (NOT first launch)
    const blankStorage = new MemoryStorage();
    blankStorage.data.set(PRIMARY_STORAGE_KEY, '');
    const blankRes = loadState(() => blankStorage);
    expect(blankRes.storageMode).toBe('recovery_locked');
    expect(blankRes.saveStatus).toBe('locked');
    expect(blankRes.rawPayload).toBe('');
    expect(blankStorage.data.get(PRIMARY_STORAGE_KEY)).toBe('');

    // 3. Corrupt JSON -> recovery_locked + rawPayload in RAM + best-effort backup
    const corruptStorage = new MemoryStorage();
    corruptStorage.data.set(PRIMARY_STORAGE_KEY, '{broken-json');
    const corruptRes = loadState(() => corruptStorage);
    expect(corruptRes.storageMode).toBe('recovery_locked');
    expect(corruptRes.saveStatus).toBe('locked');
    expect(corruptRes.rawPayload).toBe('{broken-json');
    expect(corruptRes.backupSaved).toBe(true);
    expect(corruptStorage.data.get(RECOVERY_BACKUP_KEY)).toBe('{broken-json');
    expect(corruptStorage.data.get(PRIMARY_STORAGE_KEY)).toBe('{broken-json');

    // Best-effort backup failure still enters recovery_locked cleanly
    corruptStorage.failSetKeys.add(RECOVERY_BACKUP_KEY);
    const corruptNoBackup = loadState(() => corruptStorage);
    expect(corruptNoBackup.storageMode).toBe('recovery_locked');
    expect(corruptNoBackup.backupSaved).toBe(false);
    corruptStorage.failSetKeys.clear();

    // 4. Target N outside [1, 500] (never auto-clamped!) -> recovery_locked
    const deps = createDeterministicDeps();
    const demo = loadDemoStore(createEmptyPersistedState(), deps).state;
    const outOfRangePayload = JSON.stringify({
      ...demo,
      schedules: [{ ...demo.schedules[0]!, targetTxnsPerStaffHour: 501 }],
    });
    const badNStorage = new MemoryStorage();
    badNStorage.data.set(PRIMARY_STORAGE_KEY, outOfRangePayload);
    const badNRes = loadState(() => badNStorage);
    expect(badNRes.storageMode).toBe('recovery_locked');
    expect(badNRes.rawPayload).toBe(outOfRangePayload);
    expect(badNRes.errorMessage).toMatch(/targetTxnsPerStaffHour/i);

    // 5. schemaVersion > 1 -> incompatible_version_locked (never overwrites primary key)
    const futurePayload = JSON.stringify({ schemaVersion: 2, activeScheduleId: null, schedules: [] });
    const futureStorage = new MemoryStorage();
    futureStorage.data.set(PRIMARY_STORAGE_KEY, futurePayload);
    const futureRes = loadState(() => futureStorage);
    expect(futureRes.storageMode).toBe('incompatible_version_locked');
    expect(futureRes.saveStatus).toBe('locked');
    expect(futureRes.rawPayload).toBe(futurePayload);
    expect(futureStorage.data.get(PRIMARY_STORAGE_KEY)).toBe(futurePayload);

    // 6. getItem() / getStorage() throws or returns null -> storage_unavailable_locked
    const deniedStorage = new MemoryStorage();
    deniedStorage.failGet = true;
    expect(loadState(() => deniedStorage).storageMode).toBe('storage_unavailable_locked');
    expect(loadState(() => null).storageMode).toBe('storage_unavailable_locked');
    expect(
      loadState(() => {
        throw new Error('SecurityError');
      }).storageMode,
    ).toBe('storage_unavailable_locked');

    // 7. Orphan assignment on structurally valid payload -> stripped with warning + normal mode
    const orphanStorage = new MemoryStorage();
    const withOrphan: PersistedAppState = {
      schemaVersion: 1,
      activeScheduleId: 'non-existent-schedule-id',
      schedules: [
        {
          ...demo.schedules[0]!,
          assignments: [
            {
              id: 'orphan-1',
              day: 0,
              shiftId: 'missing-shift',
              staffId: 'missing-staff',
              isPinned: false,
            },
          ],
        },
      ],
    };
    orphanStorage.data.set(PRIMARY_STORAGE_KEY, JSON.stringify(withOrphan));
    const orphanRes = loadState(() => orphanStorage);
    expect(orphanRes.storageMode).toBe('normal');
    expect(orphanRes.state.activeScheduleId).toBeNull();
    expect(orphanRes.state.schedules[0]!.assignments).toHaveLength(0);
    expect(orphanRes.warnings).toHaveLength(1);

    // 8. setItem() throws during auto-save or unavailable storage -> returns { ok: false }
    const quotaStorage = new MemoryStorage();
    quotaStorage.failAllSets = true;
    expect(saveState(demo, () => quotaStorage).ok).toBe(false);
    expect(saveState(demo, () => null).ok).toBe(false);

    // 9. Atomic Reset Contract: fails cleanly if setItem throws, succeeds when writable
    expect(resetStorageAtomic(() => quotaStorage).ok).toBe(false);

    const resetOk = resetStorageAtomic(() => corruptStorage);
    expect(resetOk.ok).toBe(true);
    if (resetOk.ok) {
      expect(resetOk.state).toEqual(createEmptyPersistedState());
      const afterResetLoad = loadState(() => corruptStorage);
      expect(afterResetLoad.storageMode).toBe('normal');
      expect(afterResetLoad.state.schedules).toHaveLength(0);
    }
  });

  it('rejects all malformed schema payloads cleanly without auto-clamping (AC-06)', () => {
    const deps = createDeterministicDeps();
    const base = loadDemoStore(createEmptyPersistedState(), deps).state;
    const baseSched = base.schedules[0]!;

    const badPayloads: unknown[] = [
      null,
      [],
      { schemaVersion: '1', activeScheduleId: null, schedules: [] },
      { schemaVersion: 0, activeScheduleId: null, schedules: [] },
      { schemaVersion: 1, activeScheduleId: 123, schedules: [] },
      { schemaVersion: 1, activeScheduleId: null, schedules: 'bad' },
      { schemaVersion: 1, activeScheduleId: null, schedules: [null] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, id: '' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [baseSched, baseSched] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, name: '   ' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, createdAt: undefined }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, updatedAt: 'not-a-date' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, staff: 'bad' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, staff: [null] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, staff: [{ id: '', name: 'A', maxWeeklyHours: 8 }] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, staff: [{ id: 's1', name: '', maxWeeklyHours: 8 }] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, staff: [{ id: 's1', name: 'A', maxWeeklyHours: -1 }] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, shifts: 'bad' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, shifts: [null] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, shifts: [{ id: '', startHour: 7, endHour: 15 }] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, shifts: [{ id: 'sh1', startHour: 6, endHour: 15 }] }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, shifts: [{ id: 'sh1', startHour: 15, endHour: 15 }] }] },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            shifts: [
              { id: 'sh1', startHour: 7, endHour: 15 },
              { id: 'sh2', startHour: 7, endHour: 15 },
            ],
          },
        ],
      },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, demand: 'bad' }] },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, demand: { ...baseSched.demand!, importedAt: 'bad' } }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, demand: { ...baseSched.demand!, sourceFileName: 42 } }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, demand: { ...baseSched.demand!, transactions: null } }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, demand: { ...baseSched.demand!, transactions: { 0: {} } } }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            demand: {
              ...baseSched.demand!,
              transactions: { ...baseSched.demand!.transactions, 0: null },
            },
          },
        ],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            demand: {
              ...baseSched.demand!,
              transactions: { ...baseSched.demand!.transactions, 0: { 7: 1 } },
            },
          },
        ],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            demand: {
              ...baseSched.demand!,
              transactions: {
                ...baseSched.demand!.transactions,
                0: { ...baseSched.demand!.transactions[0], 7: -1 },
              },
            },
          },
        ],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            demand: {
              ...baseSched.demand!,
              transactions: {
                ...baseSched.demand!.transactions,
                0: { ...baseSched.demand!.transactions[0], 7: Number.MAX_SAFE_INTEGER },
                1: { ...baseSched.demand!.transactions[1], 7: 1 },
              },
            },
          },
        ],
      },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, assignments: 'bad' }] },
      { schemaVersion: 1, activeScheduleId: null, schedules: [{ ...baseSched, assignments: [null] }] },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, assignments: [{ id: '', day: 0, shiftId: 'x', staffId: 'y', isPinned: false }] }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, assignments: [{ id: 'a1', day: 7, shiftId: 'x', staffId: 'y', isPinned: false }] }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, assignments: [{ id: 'a1', day: 0, shiftId: '', staffId: 'y', isPinned: false }] }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [{ ...baseSched, assignments: [{ id: 'a1', day: 0, shiftId: 'x', staffId: 'y', isPinned: 'no' }] }],
      },
      {
        schemaVersion: 1,
        activeScheduleId: null,
        schedules: [
          {
            ...baseSched,
            assignments: [
              { id: 'a1', day: 0, shiftId: baseSched.shifts[0]!.id, staffId: baseSched.staff[0]!.id, isPinned: false },
              { id: 'a2', day: 0, shiftId: baseSched.shifts[0]!.id, staffId: baseSched.staff[0]!.id, isPinned: true },
            ],
          },
        ],
      },
    ];

    for (const payload of badPayloads) {
      expect(validatePersistedState(payload).kind).toBe('CORRUPT_SCHEMA');
    }
  });

  it('enforces atomic CSV import, pin-conflict preservation, revision guard, and action error paths (AC-01, AC-06)', () => {
    const deps = createDeterministicDeps();
    let state = createEmptyPersistedState();

    // Error paths on missing schedule / invalid inputs
    expect(createSchedule(state, '   ', deps).ok).toBe(false);
    expect(renameSchedule(state, 'missing', 'New', deps).ok).toBe(false);
    expect(deleteSchedule(state, 'missing').ok).toBe(false);
    expect(setActiveSchedule(state, 'missing').ok).toBe(false);
    expect(setTargetTxnsPerStaffHour(state, 'missing', 15, deps).ok).toBe(false);
    expect(importCsvToSchedule(state, 'missing', DEMO_STORE_CSV_TEXT, undefined, deps).ok).toBe(false);
    expect(executeAutoSchedule(state, 'missing', deps).committed).toBe(false);
    expect(addStaff(state, 'missing', { name: 'A', maxWeeklyHours: 8 }, deps).ok).toBe(false);
    expect(updateStaff(state, 'missing', 'st', { name: 'A', maxWeeklyHours: 8 }, deps).ok).toBe(false);
    expect(deleteStaff(state, 'missing', 'st', deps).ok).toBe(false);
    expect(addShiftTemplate(state, 'missing', { startHour: 7, endHour: 15 }, deps).ok).toBe(false);
    expect(updateShiftTemplate(state, 'missing', 'sh', { startHour: 7, endHour: 15 }, deps).ok).toBe(false);
    expect(deleteShiftTemplate(state, 'missing', 'sh', deps).ok).toBe(false);
    expect(previewDeleteStaffInSchedule(state, 'missing', 'st').affectedAssignmentsCount).toBe(0);
    expect(previewEditShiftInSchedule(state, 'missing', 'sh').affectedAssignmentsCount).toBe(0);
    expect(previewDeleteShiftInSchedule(state, 'missing', 'sh').affectedAssignmentsCount).toBe(0);
    expect(assignStaffToShift(state, 'missing', { day: 0, shiftId: 'sh', staffId: 'st' }, deps).ok).toBe(false);
    expect(unassignStaff(state, 'missing', 'a', deps).ok).toBe(false);
    expect(reassignStaff(state, 'missing', 'a', 'st', deps).ok).toBe(false);
    expect(togglePinAssignment(state, 'missing', 'a', deps).ok).toBe(false);

    const created = createSchedule(state, 'Week 1', deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    state = created.state;
    const scheduleId = created.scheduleId;

    // No-op active schedule selection
    const sameNav = setActiveSchedule(state, scheduleId);
    expect(sameNav.ok && !sameNav.changed).toBe(true);

    // Rename & target N validation
    expect(renameSchedule(state, scheduleId, '   ', deps).ok).toBe(false);
    const renamed = renameSchedule(state, scheduleId, 'Week 1 Updated', deps);
    if (renamed.ok) state = renamed.state;

    expect(setTargetTxnsPerStaffHour(state, scheduleId, 0.5, deps).ok).toBe(false);
    expect(setTargetTxnsPerStaffHour(state, scheduleId, 501, deps).ok).toBe(false);
    const setN = setTargetTxnsPerStaffHour(state, scheduleId, 12.5, deps);
    if (setN.ok) state = setN.state;

    // Valid CSV import followed by invalid CSV import (must preserve old demand & updatedAt)
    const csvOk = importCsvToSchedule(state, scheduleId, DEMO_STORE_CSV_TEXT, 'sample.csv', deps);
    expect(csvOk.ok).toBe(true);
    if (!csvOk.ok) return;
    state = csvOk.state;
    const demandBeforeBadCsv = state.schedules[0]!.demand;
    const updatedBeforeBadCsv = state.schedules[0]!.updatedAt;

    const csvBad = importCsvToSchedule(state, scheduleId, 'bad,csv,data', 'broken.csv', deps);
    expect(csvBad.ok).toBe(false);
    expect(state.schedules[0]!.demand).toBe(demandBeforeBadCsv);
    expect(state.schedules[0]!.updatedAt).toBe(updatedBeforeBadCsv);

    // Shift validation: invalid bounds, overlapping allowed, exact duplicate rejected
    expect(addShiftTemplate(state, scheduleId, { startHour: 6, endHour: 12 }, deps).ok).toBe(false);
    expect(addShiftTemplate(state, scheduleId, { startHour: 12, endHour: 24 }, deps).ok).toBe(false);
    expect(addShiftTemplate(state, scheduleId, { startHour: 15, endHour: 15 }, deps).ok).toBe(false);
    expect(updateShiftTemplate(state, scheduleId, 'missing', { startHour: 8, endHour: 12 }, deps).ok).toBe(false);
    expect(deleteShiftTemplate(state, scheduleId, 'missing', deps).ok).toBe(false);

    const overlapShift = addShiftTemplate(state, scheduleId, { startHour: 11, endHour: 15 }, deps);
    expect(overlapShift.ok).toBe(true);
    if (overlapShift.ok) state = overlapShift.state;
    expect(addShiftTemplate(state, scheduleId, { startHour: 11, endHour: 15 }, deps).ok).toBe(false);

    // Staff validation
    expect(addStaff(state, scheduleId, { name: '  ', maxWeeklyHours: 8 }, deps).ok).toBe(false);
    expect(addStaff(state, scheduleId, { name: 'Bad', maxWeeklyHours: -2 }, deps).ok).toBe(false);
    expect(updateStaff(state, scheduleId, 'missing', { name: 'A', maxWeeklyHours: 8 }, deps).ok).toBe(false);

    const stRes = addStaff(state, scheduleId, { name: 'Cara', maxWeeklyHours: 8 }, deps);
    if (!stRes.ok) return;
    state = stRes.state;
    const caraId = stRes.staffId;
    const st2Res = addStaff(state, scheduleId, { name: 'Dan', maxWeeklyHours: 8 }, deps);
    if (!st2Res.ok) return;
    state = st2Res.state;
    const danId = st2Res.staffId;

    const sh0 = state.schedules[0]!.shifts[0]!.id;

    // Assignment error paths
    expect(assignStaffToShift(state, scheduleId, { day: 0, shiftId: sh0, staffId: 'missing' }, deps).ok).toBe(false);
    expect(assignStaffToShift(state, scheduleId, { day: 0, shiftId: 'missing', staffId: caraId }, deps).ok).toBe(false);

    const a1 = assignStaffToShift(state, scheduleId, { day: 0, shiftId: sh0, staffId: caraId }, deps);
    if (!a1.ok) return;
    state = a1.state;
    // Duplicate assignment rejected
    expect(assignStaffToShift(state, scheduleId, { day: 0, shiftId: sh0, staffId: caraId }, deps).ok).toBe(false);

    const a2 = assignStaffToShift(state, scheduleId, { day: 0, shiftId: sh0, staffId: danId }, deps);
    if (!a2.ok) return;
    state = a2.state;
    // Reassigning Cara's slot to Dan (already in that slot) rejected
    expect(reassignStaff(state, scheduleId, a1.assignmentId, danId, deps).ok).toBe(false);
    expect(reassignStaff(state, scheduleId, 'missing', danId, deps).ok).toBe(false);
    expect(reassignStaff(state, scheduleId, a1.assignmentId, 'missing', deps).ok).toBe(false);
    expect(unassignStaff(state, scheduleId, 'missing', deps).ok).toBe(false);
    expect(togglePinAssignment(state, scheduleId, 'missing', deps).ok).toBe(false);

    const pin1 = togglePinAssignment(state, scheduleId, a1.assignmentId, deps);
    if (pin1.ok) state = pin1.state;

    // Lower Cara's maxWeeklyHours below pinned shift duration (8h -> 4h) -> Pin Conflict blocks Auto-schedule
    const lowered = updateStaff(state, scheduleId, caraId, { name: 'Cara', maxWeeklyHours: 4 }, deps);
    if (lowered.ok) state = lowered.state;

    const assignmentsBeforeAuto = state.schedules[0]!.assignments;
    const updatedBeforeAuto = state.schedules[0]!.updatedAt;
    const blocked = executeAutoSchedule(state, scheduleId, deps);
    expect(blocked.committed).toBe(false);
    expect(blocked.result.status).toBe('BLOCKED_PIN_CONFLICT');
    expect(blocked.state.schedules[0]!.assignments).toBe(assignmentsBeforeAuto);
    expect(blocked.state.schedules[0]!.updatedAt).toBe(updatedBeforeAuto);

    // Revision guard aborts commit when snapshotRevision !== currentRevision
    const staleCommit = commitAutoScheduleWithRevision(
      state,
      scheduleId,
      {
        status: 'SUCCESS',
        assignments: [],
        diagnostics: {
          preservedPinnedCount: 0,
          generatedAssignmentsCount: 0,
          totalRequiredStaffHours: 0,
          coveredRequiredStaffHours: 0,
          demandCoverage: null,
          shortageHours: 0,
          uncoverableRequiredStaffHours: 0,
          residualCoverableShortageHours: 0,
          overstaffedHours: 0,
          unusedCapacityHours: 0,
          unscheduledEligibleStaffCount: 0,
          fairnessJainIndex: null,
          rebalanceIterationsRun: 0,
          rebalanceStopReason: 'SKIPPED',
          summaryMessages: [],
        },
      },
      1,
      2,
      deps,
    );
    expect(staleCommit.committed).toBe(false);
    expect(staleCommit.state).toBe(state);

    // Unassign & Delete schedule clears activeScheduleId
    const unassignRes = unassignStaff(state, scheduleId, a1.assignmentId, deps);
    if (unassignRes.ok) state = unassignRes.state;
    expect(state.schedules[0]!.assignments).toHaveLength(1);

    const delSched = deleteSchedule(state, scheduleId);
    expect(delSched.ok).toBe(true);
    if (delSched.ok) {
      expect(delSched.state.activeScheduleId).toBeNull();
      expect(delSched.state.schedules).toHaveLength(0);
    }
  });
});

describe('Phase 2: Storage Schema Backward Compatibility & Day Array Validation', () => {
  it('loads legacy schemaVersion 1 payloads without daysOfWeek or unavailableDays and normalizes defaults (AC-P2-001)', () => {
    const deps = createDeterministicDeps();
    const base = loadDemoStore(createEmptyPersistedState(), deps).state;
    const storage = new MemoryStorage();

    // Legacy payload without optional fields
    storage.data.set(PRIMARY_STORAGE_KEY, JSON.stringify(base));
    const legacyLoad = loadState(() => storage);
    expect(legacyLoad.storageMode).toBe('normal');
    expect(legacyLoad.state.schedules[0]!.shifts[0]!.daysOfWeek).toBeUndefined();
    expect(legacyLoad.state.schedules[0]!.staff[0]!.unavailableDays).toBeUndefined();

    // Payload with explicit default [0..6] and [] normalizes to undefined (omitted defaults)
    const explicitDefaults = {
      ...base,
      schedules: [
        {
          ...base.schedules[0]!,
          shifts: base.schedules[0]!.shifts.map((sh) => ({
            ...sh,
            daysOfWeek: [6, 5, 4, 3, 2, 1, 0],
          })),
          staff: base.schedules[0]!.staff.map((st) => ({
            ...st,
            unavailableDays: [],
          })),
        },
      ],
    };
    const normRes = validatePersistedState(explicitDefaults);
    expect(normRes.kind).toBe('OK');
    if (normRes.kind === 'OK') {
      expect(normRes.state.schedules[0]!.shifts[0]!.daysOfWeek).toBeUndefined();
      expect(normRes.state.schedules[0]!.staff[0]!.unavailableDays).toBeUndefined();
    }

    // Payload with valid restricted daysOfWeek and unavailableDays sorts ascending & round-trips
    const restricted = {
      ...base,
      schedules: [
        {
          ...base.schedules[0]!,
          shifts: [{ ...base.schedules[0]!.shifts[0]!, daysOfWeek: [6, 5] }],
          staff: [{ ...base.schedules[0]!.staff[0]!, unavailableDays: [6, 2] }],
          assignments: [],
        },
      ],
    };
    const res = validatePersistedState(restricted);
    expect(res.kind).toBe('OK');
    if (res.kind === 'OK') {
      expect(res.state.schedules[0]!.shifts[0]!.daysOfWeek).toEqual([5, 6]);
      expect(res.state.schedules[0]!.staff[0]!.unavailableDays).toEqual([2, 6]);
    }
  });

  it('rejects malformed daysOfWeek, unavailableDays, and assignments on inactive shift days as CORRUPT_SCHEMA (AC-P2-002)', () => {
    const deps = createDeterministicDeps();
    const base = loadDemoStore(createEmptyPersistedState(), deps).state;
    const baseSched = base.schedules[0]!;
    const sh0 = baseSched.shifts[0]!;
    const st0 = baseSched.staff[0]!;

    const badPayloads: unknown[] = [
      // Empty daysOfWeek []
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: [] }], assignments: [] }] },
      // Non-array daysOfWeek
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: 'Mon' }], assignments: [] }] },
      // Out-of-range daysOfWeek (-1, 7)
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: [-1, 0] }], assignments: [] }] },
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: [0, 7] }], assignments: [] }] },
      // Non-integer daysOfWeek
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: [1.5] }], assignments: [] }] },
      // Duplicate daysOfWeek
      { ...base, schedules: [{ ...baseSched, shifts: [{ ...sh0, daysOfWeek: [0, 0] }], assignments: [] }] },
      // Non-array unavailableDays
      { ...base, schedules: [{ ...baseSched, staff: [{ ...st0, unavailableDays: 2 }], assignments: [] }] },
      // Out-of-range unavailableDays
      { ...base, schedules: [{ ...baseSched, staff: [{ ...st0, unavailableDays: [7] }], assignments: [] }] },
      // Non-integer unavailableDays
      { ...base, schedules: [{ ...baseSched, staff: [{ ...st0, unavailableDays: ['0'] }], assignments: [] }] },
      // Duplicate unavailableDays
      { ...base, schedules: [{ ...baseSched, staff: [{ ...st0, unavailableDays: [2, 2] }], assignments: [] }] },
      // Persisted assignment on inactive shift day -> CORRUPT_SCHEMA
      {
        ...base,
        schedules: [
          {
            ...baseSched,
            shifts: [{ ...sh0, daysOfWeek: [5, 6] }],
            assignments: [
              { id: 'bad-day-assign', day: 0, shiftId: sh0.id, staffId: st0.id, isPinned: false },
            ],
          },
        ],
      },
    ];

    for (const payload of badPayloads) {
      expect(validatePersistedState(payload).kind).toBe('CORRUPT_SCHEMA');
    }

    // Verify loadState enters recovery_locked on corrupt daysOfWeek
    const storage = new MemoryStorage();
    storage.data.set(PRIMARY_STORAGE_KEY, JSON.stringify(badPayloads[0]));
    expect(loadState(() => storage).storageMode).toBe('recovery_locked');
  });

  it('enforces shift daysOfWeek cascade delete, staff unavailableDays, inactive-day guard, and Undo snapshot filter (AC-P2-003, AC-P2-005, AC-P2-008)', () => {
    const deps = createDeterministicDeps();
    let state = createEmptyPersistedState();
    const created = createSchedule(state, 'Phase 2 State', deps);
    if (!created.ok) return;
    state = created.state;
    const schedId = created.scheduleId;

    // 1. addShiftTemplate rejects empty daysOfWeek [] and omits default [0..6]
    expect(
      addShiftTemplate(state, schedId, { startHour: 8, endHour: 12, daysOfWeek: [] }, deps).ok,
    ).toBe(false);
    const fullWeekShift = addShiftTemplate(
      state,
      schedId,
      { startHour: 8, endHour: 12, daysOfWeek: [6, 5, 4, 3, 2, 1, 0] },
      deps,
    );
    expect(fullWeekShift.ok).toBe(true);
    if (!fullWeekShift.ok) return;
    state = fullWeekShift.state;
    const shId = fullWeekShift.shiftId;
    expect(state.schedules[0]!.shifts.find((s) => s.id === shId)?.daysOfWeek).toBeUndefined();

    // 2. addStaff / updateStaff with unavailableDays normalizes & preserves when omitted
    const stRes = addStaff(
      state,
      schedId,
      { name: 'Alice', maxWeeklyHours: 40, unavailableDays: [6, 2, 2] },
      deps,
    );
    expect(stRes.ok).toBe(true);
    if (!stRes.ok) return;
    state = stRes.state;
    const stId = stRes.staffId;
    expect(state.schedules[0]!.staff[0]!.unavailableDays).toEqual([2, 6]);

    // Legacy updateStaff without unavailableDays preserves [2, 6]
    const legacyUpd = updateStaff(state, schedId, stId, { name: 'Alice M', maxWeeklyHours: 36 }, deps);
    expect(legacyUpd.ok).toBe(true);
    if (!legacyUpd.ok) return;
    state = legacyUpd.state;
    expect(state.schedules[0]!.staff[0]!.unavailableDays).toEqual([2, 6]);

    // Clearing unavailableDays to [] omits the field
    const clearUpd = updateStaff(
      state,
      schedId,
      stId,
      { name: 'Alice M', maxWeeklyHours: 36, unavailableDays: [] },
      deps,
    );
    expect(clearUpd.ok).toBe(true);
    if (!clearUpd.ok) return;
    state = clearUpd.state;
    expect(state.schedules[0]!.staff[0]!.unavailableDays).toBeUndefined();

    // 3. Assign on Mon (0, regular) and Sat (5, pinned), then disable Sat -> preview & atomic cascade delete
    const aMon = assignStaffToShift(state, schedId, { day: 0, shiftId: shId, staffId: stId }, deps);
    if (!aMon.ok) return;
    state = aMon.state;
    const aSat = assignStaffToShift(state, schedId, { day: 5, shiftId: shId, staffId: stId }, deps);
    if (!aSat.ok) return;
    state = aSat.state;
    const pinSat = togglePinAssignment(state, schedId, aSat.assignmentId, deps);
    if (!pinSat.ok) return;
    state = pinSat.state;

    const snapshotWithSat = state.schedules[0]!.assignments.slice();
    const preview = previewDisableShiftDaysInSchedule(state, schedId, shId, [0, 1, 2, 3, 4]);
    expect(preview.affectedAssignmentsCount).toBe(1);
    expect(preview.affectedAssignmentIds).toEqual([aSat.assignmentId]);

    const updShift = updateShiftTemplate(
      state,
      schedId,
      shId,
      { startHour: 8, endHour: 12, daysOfWeek: [0, 1, 2, 3, 4] },
      deps,
    );
    expect(updShift.ok).toBe(true);
    if (!updShift.ok) return;
    expect(updShift.removedAssignmentsCount).toBe(1);
    state = updShift.state;
    expect(state.schedules[0]!.assignments).toHaveLength(1);
    expect(state.schedules[0]!.assignments[0]!.day).toBe(0);

    // 4. Assigning on inactive day Sat (5) is blocked
    expect(
      assignStaffToShift(state, schedId, { day: 5, shiftId: shId, staffId: stId }, deps).ok,
    ).toBe(false);

    // 5. Undo snapshot (Ctrl+Z) filters out assignment on now-inactive Sat (5)
    const undoRes = restoreAssignmentsSnapshot(state, schedId, snapshotWithSat, deps);
    expect(undoRes.ok).toBe(true);
    if (!undoRes.ok) return;
    expect(undoRes.state.schedules[0]!.assignments).toHaveLength(1);
    expect(undoRes.state.schedules[0]!.assignments[0]!.day).toBe(0);
  });
});
