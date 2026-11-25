import type { CalendarEvent, DateStr, Task } from '../db/models';
import { addDays, fromDateStr, monthName, toDateStr } from './dates';
import { isLive, isOpen } from './smartLists';

/** Month view logic. A month is a `YYYY-MM` string — same discipline as
 *  DateStr: calendar concepts stay strings so they compare and slice without
 *  ever touching a timezone. */

export type MonthStr = string;

export function monthOf(date: DateStr): MonthStr {
  return date.slice(0, 7);
}

export function firstDayOf(month: MonthStr): DateStr {
  return `${month}-01`;
}

export function lastDayOf(month: MonthStr): DateStr {
  const d = fromDateStr(firstDayOf(month));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toDateStr(d);
}

export function shiftMonth(month: MonthStr, by: number): MonthStr {
  const d = fromDateStr(firstDayOf(month));
  d.setMonth(d.getMonth() + by);
  return monthOf(toDateStr(d));
}

export function monthLabel(month: MonthStr): string {
  const first = firstDayOf(month);
  return `${monthName(first)} ${first.slice(0, 4)}`;
}

/** Calendar grid rows. `weekStart` is 0 for Sunday, 1 for Monday. Cells
 *  outside the month are null so the grid keeps its shape without pretending
 *  neighbouring days belong to it. */
export function monthWeeks(month: MonthStr, weekStart = 1): (DateStr | null)[][] {
  const first = firstDayOf(month);
  const offset = (fromDateStr(first).getDay() - weekStart + 7) % 7;
  const last = lastDayOf(month);
  const weeks: (DateStr | null)[][] = [];
  let cursor = addDays(first, -offset);
  while (cursor <= last) {
    const row: (DateStr | null)[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(monthOf(cursor) === month ? cursor : null);
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export function weekdayLabels(weekStart = 1): string[] {
  const base = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return [...base.slice(weekStart), ...base.slice(0, weekStart)];
}

// ------------------------------------------------------------- agenda ------

export interface AgendaEntry {
  kind: 'event' | 'task';
  id: string;
  date: DateStr;
  title: string;
  /** Epoch ms for timed calendar events; null for all-day events and to-dos. */
  start: number | null;
  allDay: boolean;
  /** Why a to-do lands on this day. */
  reason?: 'start' | 'deadline';
}

export interface AgendaDay {
  date: DateStr;
  entries: AgendaEntry[];
}

function eventEntry(e: CalendarEvent): AgendaEntry {
  return {
    kind: 'event',
    id: e.id,
    date: e.date,
    title: e.title,
    start: e.allDay ? null : e.start,
    allDay: e.allDay,
  };
}

/** A to-do appears on its deadline if it has one, otherwise on its start date.
 *  Showing both would double-list the same to-do in one month. */
export function taskEntries(tasks: Task[]): AgendaEntry[] {
  const out: AgendaEntry[] = [];
  for (const t of tasks) {
    if (!isLive(t) || !isOpen(t)) continue;
    if (t.deadline !== null) {
      out.push({ kind: 'task', id: t.id, date: t.deadline, title: t.title, start: null, allDay: true, reason: 'deadline' });
    } else if (t.startDate !== null) {
      out.push({ kind: 'task', id: t.id, date: t.startDate, title: t.title, start: null, allDay: true, reason: 'start' });
    }
  }
  return out;
}

/** Within a day: all-day events, then timed events by clock time, then to-dos
 *  (deadlines ahead of scheduled starts). */
function compareEntries(a: AgendaEntry, b: AgendaEntry): number {
  const rank = (e: AgendaEntry) =>
    e.kind === 'event' ? (e.start === null ? 0 : 1) : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.start !== null && b.start !== null && a.start !== b.start) return a.start - b.start;
  if (a.kind === 'task' && b.kind === 'task' && a.reason !== b.reason) {
    return a.reason === 'deadline' ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}

export function entriesOn(
  events: CalendarEvent[],
  tasks: Task[],
  date: DateStr,
): AgendaEntry[] {
  const all = [
    ...events.filter((e) => e.date === date).map(eventEntry),
    ...taskEntries(tasks).filter((e) => e.date === date),
  ];
  return all.sort(compareEntries);
}

/** Every day of the month that has something on it, oldest first — the
 *  "whole month as one list" the calendar screen shows under the grid. */
export function monthAgenda(
  events: CalendarEvent[],
  tasks: Task[],
  month: MonthStr,
): AgendaDay[] {
  const all = [
    ...events.filter((e) => monthOf(e.date) === month).map(eventEntry),
    ...taskEntries(tasks).filter((e) => monthOf(e.date) === month),
  ];
  const byDate = new Map<DateStr, AgendaEntry[]>();
  for (const entry of all) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => ({ date, entries: byDate.get(date)!.sort(compareEntries) }));
}

/** Days in the month carrying at least one entry — the grid's dots. */
export function markedDays(
  events: CalendarEvent[],
  tasks: Task[],
  month: MonthStr,
): Set<DateStr> {
  return new Set(monthAgenda(events, tasks, month).map((d) => d.date));
}

/** The soonest event still ahead of `nowMs`. Timed events that already started
 *  drop out; all-day events count for the whole of their day. */
export function nextEvent(
  events: CalendarEvent[],
  nowMs: number,
  today: DateStr,
): CalendarEvent | null {
  const upcoming = events
    .filter((e) => e.date >= today)
    .filter((e) => e.allDay || e.start === null || e.date > today || e.start >= nowMs)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.start ?? 0) - (b.start ?? 0);
    });
  return upcoming[0] ?? null;
}

// ------------------------------------------------------------ day stats ----

export interface DayStat {
  /** Events plus open to-dos dated that day (start or deadline). */
  planned: number;
  /** To-dos finished that day (by completion time). */
  done: number;
  /** Any open to-do is still dated that day. */
  open: boolean;
}

/** What the month and year views draw for each day, after the calendar
 *  plugin's meters: filled dots grow with how full the day was (planned +
 *  done), a hollow ring says something on it is still open. */
export function dayStats(events: CalendarEvent[], tasks: Task[], from: DateStr, to: DateStr): Map<DateStr, DayStat> {
  const m = new Map<DateStr, DayStat>();
  const at = (d: DateStr) => {
    let s = m.get(d);
    if (!s) m.set(d, (s = { planned: 0, done: 0, open: false }));
    return s;
  };
  for (const e of events) if (e.date >= from && e.date <= to) at(e.date).planned++;
  for (const entry of taskEntries(tasks)) {
    if (entry.date < from || entry.date > to) continue;
    const s = at(entry.date);
    s.planned++;
    s.open = true;
  }
  for (const t of tasks) {
    if (t.status !== 'completed' || t.completedAt === null || t.trashedAt !== null) continue;
    const d = toDateStr(new Date(t.completedAt));
    if (d >= from && d <= to) at(d).done++;
  }
  return m;
}

/** 0–3 filled dots for a day. */
export function dotCount(s: DayStat | undefined): number {
  if (!s) return 0;
  const n = s.planned + s.done;
  return n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3;
}

/** ISO-8601 week number of a date. */
export function isoWeek(d: DateStr): number {
  const x = fromDateStr(d);
  const day = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - day + 3); // Thursday of this week
  const firstThu = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
}
