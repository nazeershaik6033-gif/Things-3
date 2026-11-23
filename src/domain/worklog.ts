import type { DateStr, DayReview, Project, Sprint, Tag, Task } from '../db/models';
import { addDays, dateStrOf, weekdayOf } from './dates';
import { taskTimeByDay } from './timeTracking';

/** The Worklog / timesheet, ported from Super Productivity's worklog: every
 *  day you tracked time or finished something, the to-dos involved and how
 *  long each took, rolled up into weeks and months, exportable as CSV. */

export interface WorklogEntry {
  taskId: string;
  title: string;
  projectId: string | null;
  sec: number;
  /** Finished on this day. */
  completed: boolean;
  estimateMin: number | null;
}

export interface WorklogDay {
  date: DateStr;
  totalSec: number;
  completedCount: number;
  entries: WorklogEntry[];
  review: DayReview | null;
}

export interface WorklogWeek {
  /** Monday of the week. */
  start: DateStr;
  totalSec: number;
  days: WorklogDay[];
}

export interface WorklogMonth {
  key: string; // YYYY-MM
  totalSec: number;
  weeks: WorklogWeek[];
}

/** Monday of the week containing `d` (ISO weeks, as timesheets expect). */
export function weekStart(d: DateStr): DateStr {
  return addDays(d, -((weekdayOf(d) + 6) % 7));
}

export function worklogDays(
  tasks: Task[],
  sprints: Sprint[] = [],
  reviews: DayReview[] = [],
  range?: { from: DateStr; to: DateStr },
): WorklogDay[] {
  const byDay = new Map<DateStr, Map<string, WorklogEntry>>();
  const inRange = (d: DateStr) => !range || (d >= range.from && d <= range.to);
  const entryFor = (day: DateStr, t: Task): WorklogEntry => {
    let m = byDay.get(day);
    if (!m) byDay.set(day, (m = new Map()));
    let e = m.get(t.id);
    if (!e) {
      e = {
        taskId: t.id, title: t.title || 'Untitled', projectId: t.projectId, sec: 0,
        completed: false, estimateMin: t.timeEstimateMin ?? null,
      };
      m.set(t.id, e);
    }
    return e;
  };

  for (const t of tasks) {
    if (t.trashedAt !== null) continue;
    for (const [day, sec] of Object.entries(taskTimeByDay(t, sprints))) {
      if (sec > 0 && inRange(day)) entryFor(day, t).sec += sec;
    }
    if (t.status === 'completed' && t.completedAt !== null) {
      const day = dateStrOf(t.completedAt);
      if (inRange(day)) entryFor(day, t).completed = true;
    }
  }

  const reviewByDay = new Map(reviews.map((r) => [r.date, r]));
  for (const r of reviews) if (inRange(r.date) && !byDay.has(r.date)) byDay.set(r.date, new Map());

  return [...byDay.entries()]
    .map(([date, m]) => {
      const entries = [...m.values()].sort((a, b) => b.sec - a.sec || a.title.localeCompare(b.title));
      return {
        date,
        totalSec: entries.reduce((s, e) => s + e.sec, 0),
        completedCount: entries.filter((e) => e.completed).length,
        entries,
        review: reviewByDay.get(date) ?? null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Newest first: months → weeks → days. */
export function groupWorklog(days: WorklogDay[]): WorklogMonth[] {
  const months: WorklogMonth[] = [];
  for (const day of days) {
    const key = day.date.slice(0, 7);
    let month = months.find((m) => m.key === key);
    if (!month) months.push((month = { key, totalSec: 0, weeks: [] }));
    const start = weekStart(day.date);
    let week = month.weeks.find((w) => w.start === start);
    if (!week) month.weeks.push((week = { start, totalSec: 0, days: [] }));
    week.days.push(day);
    week.totalSec += day.totalSec;
    month.totalSec += day.totalSec;
  }
  return months;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A timesheet: one row per (day, to-do). Minutes are rounded to the
 *  nearest minute per row, as time-tracking systems expect. */
export function timesheetCsv(
  days: WorklogDay[],
  tasks: Task[],
  projects: Project[],
  tags: Tag[],
): string {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectTitle = new Map(projects.map((p) => [p.id, p.title]));
  const tagTitle = new Map(tags.map((t) => [t.id, t.title]));
  const rows: string[] = ['Date,To-Do,Project,Tags,Minutes,Estimate (min),Completed'];
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const e of day.entries) {
      const t = taskById.get(e.taskId);
      const tagList = (t?.tagIds ?? []).map((id) => tagTitle.get(id)).filter(Boolean).join(' ');
      rows.push([
        day.date,
        e.title,
        e.projectId ? projectTitle.get(e.projectId) ?? '' : '',
        tagList,
        Math.round(e.sec / 60),
        e.estimateMin ?? '',
        e.completed ? 'yes' : '',
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\n') + '\n';
}
