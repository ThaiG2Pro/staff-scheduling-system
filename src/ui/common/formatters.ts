/**
 * @file Pure UI display formatters for hours, shift ranges, and ISO timestamps.
 */

/** Formats an integer hour (0..23) as `HH:00` (e.g. `7` -> `"07:00"`). */
export function formatHour24(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Formats a shift template range and duration (e.g. `"07:00 – 15:00"`). */
export function formatShiftRange(startHour: number, endHour: number): string {
  return `${formatHour24(startHour)} – ${formatHour24(endHour)}`;
}

/** Formats an ISO 8601 timestamp into a concise local date/time string. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
