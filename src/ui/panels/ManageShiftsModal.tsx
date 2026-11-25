/**
 * @file Manage Shift Templates modal supporting Create, Edit (with E-09 ripple-effect
 * preview & soft-warning preservation), and Delete (with E-08 cascade preview).
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { MAX_SHIFT_END_HOUR, MIN_OPERATING_HOUR } from '../../domain/constants';
import type { DeletePreview, ShiftTemplate } from '../../domain/types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatHour24, formatShiftRange } from '../common/formatters';

export interface ManageShiftsModalProps {
  open: boolean;
  shifts: readonly ShiftTemplate[];
  onAddShift: (input: { startHour: number; endHour: number }) => { ok: boolean; error?: string };
  onPreviewEditShift: (shiftId: string) => DeletePreview;
  onUpdateShift: (
    shiftId: string,
    input: { startHour: number; endHour: number },
  ) => { ok: boolean; error?: string };
  onPreviewDeleteShift: (shiftId: string) => DeletePreview;
  onDeleteShift: (shiftId: string) => { ok: boolean; error?: string };
  onReorderShifts?: (orderedShiftIds: readonly string[]) => { ok: boolean; error?: string };
  onClose: () => void;
}

const START_HOUR_OPTIONS = Array.from(
  { length: MAX_SHIFT_END_HOUR - MIN_OPERATING_HOUR },
  (_, idx) => MIN_OPERATING_HOUR + idx,
);

const END_HOUR_OPTIONS = Array.from(
  { length: MAX_SHIFT_END_HOUR - MIN_OPERATING_HOUR },
  (_, idx) => MIN_OPERATING_HOUR + 1 + idx,
);

/**
 * Modal for managing weekly shift templates (`07:00`–`23:00`).
 * Supports overlapping shifts (e.g. peak midday `10:00–14:00`) and displays affected
 * assignment counts before editing or deleting any template.
 *
 * @param props - Shift list, preview helpers, and CRUD callbacks.
 * @returns Modal dialog when open, otherwise `null`.
 */
export function ManageShiftsModal({
  open,
  shifts,
  onAddShift,
  onPreviewEditShift,
  onUpdateShift,
  onPreviewDeleteShift,
  onDeleteShift,
  onReorderShifts,
  onClose,
}: ManageShiftsModalProps) {
  const [newStart, setNewStart] = useState(10);
  const [newEnd, setNewEnd] = useState(14);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState(7);
  const [editEnd, setEditEnd] = useState(15);
  const [editError, setEditError] = useState<string | null>(null);

  const [draggedShiftId, setDraggedShiftId] = useState<string | null>(null);
  const [dragOverShiftId, setDragOverShiftId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    shift: ShiftTemplate;
    affectedCount: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddError(null);
    setEditingId(null);
    setEditError(null);
    setDraggedShiftId(null);
    setDragOverShiftId(null);
    setDeleteTarget(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleteTarget) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, deleteTarget, onClose]);

  if (!open) return null;

  const canReorder = Boolean(onReorderShifts) && shifts.length > 1;

  const moveShiftByStep = (index: number, delta: -1 | 1) => {
    if (!onReorderShifts) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= shifts.length) return;
    const nextIds = shifts.map((sh) => sh.id);
    const [moved] = nextIds.splice(index, 1);
    nextIds.splice(targetIndex, 0, moved!);
    onReorderShifts(nextIds);
  };

  const moveShiftByIds = (sourceId: string, targetId: string) => {
    if (!onReorderShifts || sourceId === targetId) return;
    const fromIndex = shifts.findIndex((sh) => sh.id === sourceId);
    const toIndex = shifts.findIndex((sh) => sh.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const nextIds = shifts.map((sh) => sh.id);
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved!);
    onReorderShifts(nextIds);
  };

  const handleAddSubmit = (event: FormEvent) => {
    event.preventDefault();
    const res = onAddShift({ startHour: newStart, endHour: newEnd });
    if (!res.ok) {
      setAddError(res.error ?? 'Unable to add shift template.');
      return;
    }
    setAddError(null);
  };

  const startEdit = (shift: ShiftTemplate) => {
    setEditingId(shift.id);
    setEditStart(shift.startHour);
    setEditEnd(shift.endHour);
    setEditError(null);
  };

  const commitEdit = (shiftId: string) => {
    const res = onUpdateShift(shiftId, { startHour: editStart, endHour: editEnd });
    if (!res.ok) {
      setEditError(res.error ?? 'Unable to update shift template.');
      return;
    }
    setEditingId(null);
    setEditError(null);
  };

  const requestDelete = (shift: ShiftTemplate) => {
    const preview = onPreviewDeleteShift(shift.id);
    setDeleteTarget({ shift, affectedCount: preview.affectedAssignmentsCount });
  };

  const editingAffectedCount = editingId ? onPreviewEditShift(editingId).affectedAssignmentsCount : 0;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-shifts-title"
      >
        <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              <h2 id="manage-shifts-title" className="text-base font-semibold text-slate-900">
                Manage Shift Templates
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close shifts modal"
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-5 px-5 py-4">
            {/* Existing shifts */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Active Shifts ({shifts.length})
                </p>
                {canReorder && (
                  <span className="text-[11px] text-slate-500">
                    Drag or use arrows to reorder Roster rows
                  </span>
                )}
              </div>

              {shifts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">
                  No shift templates defined. Add at least one shift between 07:00 and 23:00.
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                  {shifts.map((shift, index) => {
                    const isEditing = editingId === shift.id;
                    const duration = shift.endHour - shift.startHour;
                    const isDragging = draggedShiftId === shift.id;
                    const isDropTarget =
                      dragOverShiftId === shift.id && draggedShiftId !== shift.id;

                    return (
                      <li
                        key={shift.id}
                        draggable={canReorder && !isEditing}
                        onDragStart={(e) => {
                          if (!canReorder || isEditing) return;
                          setDraggedShiftId(shift.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', shift.id);
                        }}
                        onDragOver={(e) => {
                          if (!canReorder || !draggedShiftId || isEditing) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverShiftId !== shift.id) {
                            setDragOverShiftId(shift.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverShiftId === shift.id) {
                            setDragOverShiftId(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourceId = draggedShiftId || e.dataTransfer.getData('text/plain');
                          if (sourceId) moveShiftByIds(sourceId, shift.id);
                          setDraggedShiftId(null);
                          setDragOverShiftId(null);
                        }}
                        onDragEnd={() => {
                          setDraggedShiftId(null);
                          setDragOverShiftId(null);
                        }}
                        className={`px-3.5 py-3 transition ${
                          isDragging
                            ? 'bg-slate-50 opacity-60'
                            : isDropTarget
                              ? 'bg-indigo-50/70 ring-2 ring-inset ring-indigo-400'
                              : ''
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                aria-label="Edit shift start hour"
                                value={editStart}
                                onChange={(e) => {
                                  setEditStart(Number(e.target.value));
                                  if (editError) setEditError(null);
                                }}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                              >
                                {START_HOUR_OPTIONS.map((h) => (
                                  <option key={h} value={h}>
                                    {formatHour24(h)}
                                  </option>
                                ))}
                              </select>
                              <span className="text-sm text-slate-600">to</span>
                              <select
                                aria-label="Edit shift end hour"
                                value={editEnd}
                                onChange={(e) => {
                                  setEditEnd(Number(e.target.value));
                                  if (editError) setEditError(null);
                                }}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                              >
                                {END_HOUR_OPTIONS.map((h) => (
                                  <option key={h} value={h}>
                                    {formatHour24(h)}
                                  </option>
                                ))}
                              </select>
                              <div className="ml-auto flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => commitEdit(shift.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditError(null);
                                  }}
                                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>

                            {editingAffectedCount > 0 && (
                              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                <AlertTriangle
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700"
                                  aria-hidden="true"
                                />
                                <span>
                                  Updates <strong>{editingAffectedCount}</strong> existing
                                  assignment{editingAffectedCount === 1 ? '' : 's'} across the week.
                                  All assignments and pins are preserved; any new hour-limit or
                                  overlap conflicts will appear as soft warnings.
                                </span>
                              </div>
                            )}

                            {editError && (
                              <p role="alert" className="text-xs font-medium text-rose-700">
                                {editError}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              {canReorder && (
                                <span
                                  title="Drag to reorder"
                                  className="cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                                >
                                  <GripVertical className="h-4 w-4" aria-hidden="true" />
                                </span>
                              )}
                              <div>
                                <span className="text-sm font-semibold text-slate-900">
                                  {formatShiftRange(shift.startHour, shift.endHour)}
                                </span>
                                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                                  {duration}h
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {canReorder && (
                                <div className="mr-1 flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveShiftByStep(index, -1)}
                                    disabled={index === 0}
                                    aria-label={`Move shift ${formatShiftRange(shift.startHour, shift.endHour)} up`}
                                    title="Move up"
                                    className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveShiftByStep(index, 1)}
                                    disabled={index === shifts.length - 1}
                                    aria-label={`Move shift ${formatShiftRange(shift.startHour, shift.endHour)} down`}
                                    title="Move down"
                                    className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => startEdit(shift)}
                                aria-label={`Edit shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => requestDelete(shift)}
                                aria-label={`Delete shift ${formatShiftRange(shift.startHour, shift.endHour)}`}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Add new shift */}
            <form
              onSubmit={handleAddSubmit}
              className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Add Shift Template (overlapping shifts allowed)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="new-shift-start" className="text-xs text-slate-700">
                  Start
                </label>
                <select
                  id="new-shift-start"
                  value={newStart}
                  onChange={(e) => {
                    setNewStart(Number(e.target.value));
                    if (addError) setAddError(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                >
                  {START_HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour24(h)}
                    </option>
                  ))}
                </select>

                <label htmlFor="new-shift-end" className="text-xs text-slate-700">
                  End
                </label>
                <select
                  id="new-shift-end"
                  value={newEnd}
                  onChange={(e) => {
                    setNewEnd(Number(e.target.value));
                    if (addError) setAddError(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                >
                  {END_HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {formatHour24(h)}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Shift
                </button>
              </div>
              {addError && (
                <p role="alert" className="text-xs font-medium text-rose-700">
                  {addError}
                </p>
              )}
            </form>
          </div>

          <div className="flex justify-end rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete shift ${
          deleteTarget
            ? formatShiftRange(deleteTarget.shift.startHour, deleteTarget.shift.endHour)
            : ''
        }?`}
        description="This removes the shift template from this weekly schedule."
        warningDetail={
          deleteTarget && deleteTarget.affectedCount > 0
            ? `This shift currently has ${deleteTarget.affectedCount} assignment${
                deleteTarget.affectedCount === 1 ? '' : 's'
              } that will also be removed.`
            : undefined
        }
        confirmLabel="Delete Shift"
        tone="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          onDeleteShift(deleteTarget.shift.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
