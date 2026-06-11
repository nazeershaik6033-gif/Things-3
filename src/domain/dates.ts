import type { DateStr } from '../db/models';

/** The ONLY module allowed to do Date math. All when/deadline logic operates
 *  on local YYYY-MM-DD strings, which compare correctly with < > ===. */

export function toDateStr(d: Date): DateStr {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): DateStr {
  return toDateStr(new Date());
}

/** Parse YYYY-MM-DD as a LOCAL date (Date.parse would give UTC midnight). */
export function fromDateStr(s: DateStr): Date {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return new Date(y, m - 1, d);
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromDateStr(s);
  return toDateStr(d) === s;
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Whole days from `from` to `to` (positive if `to` is later). DST-safe. */
export function daysBetween(from: DateStr, to: DateStr): number {
  const a = fromDateStr(from);
  const b = fromDateStr(to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Ms until the next local midnight after `now`. DST-safe (uses Date fields). */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function dateStrOf(epochMs: number): DateStr {
  return toDateStr(new Date(epochMs));
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function weekdayName(s: DateStr): string {
  return WEEKDAYS[fromDateStr(s).getDay()]!;
}

export function monthName(s: DateStr): string {
  return MONTHS[fromDateStr(s).getMonth()]!;
}

export function dayOfMonth(s: DateStr): number {
  return fromDateStr(s).getDate();
}

export function yearOf(s: DateStr): number {
  return fromDateStr(s).getFullYear();
}

/** "Today" / "Tomorrow" / "Saturday" (within 6 days) / "Jun 21" / "Jun 21, 2027" */
export function formatRelative(s: DateStr, today: DateStr): string {
  const diff = daysBetween(today, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return weekdayName(s);
  const base = `${monthName(s).slice(0, 3)} ${dayOfMonth(s)}`;
  return yearOf(s) === yearOf(today) ? base : `${base}, ${yearOf(s)}`;
}

/** Deadline chip text: "today", "tomorrow", "3 days left", "2 days ago", "Jun 21" */
export function formatDeadline(deadline: DateStr, today: DateStr): string {
  const diff = daysBetween(today, deadline);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${-diff} days ago`;
  if (diff < 15) return `${diff} days left`;
  return formatRelative(deadline, today);
}

export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}
