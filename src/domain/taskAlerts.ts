import type { DateStr, Task, TaskAlert } from '../db/models';
import { buildCalendar, floatingStamp, utcStamp, type IcsEvent } from './icsWrite';
import { DAY_MIN, formatClock, parseHHMM, taskDuration, toHHMM } from './timeline';

/** Alerts on to-dos, delivered as iOS Calendar alerts (the user's choice: no
 *  push server, nothing leaves the phone). TaskNotes' model: each alert is
 *  relative to the start time or to the deadline, so it moves with them.
 *
 *  A to-do's alerts go into a .ics file — one to-do from its card, or a
 *  whole day from the timeline — which the share sheet hands to Calendar.
 *  Each event has a stable UID per to-do, and the to-do remembers a
 *  signature of what was sent, so the app can tell "in Calendar" from
 *  "changed since — send again". */

/** For timed to-dos with no alerts of their own. null = none. */
export type DefaultAlert = number | null;

/** Deadlines with no time are anchored here for alerts. */
export const DEADLINE_DEFAULT_TIME = '09:00';

/** The alerts that apply: the to-do's own, or — if it has none set and is
 *  timed — the default before its start. */
export function effectiveAlerts(t: Task, defaultBeforeMin: DefaultAlert): TaskAlert[] {
  const own = (t.alerts ?? null);
  let list: TaskAlert[];
  if (own !== null) list = own;
  else list = defaultBeforeMin !== null && parseHHMM(t.startTime) !== null ? [{ anchor: 'start', beforeMin: defaultBeforeMin }] : [];
  // An alert needs its anchor: a start time, or a deadline
  return list.filter((a) => (a.anchor === 'start' ? parseHHMM(t.startTime) !== null && !!t.startDate : !!t.deadline));
}

export function hasAlert(list: TaskAlert[], a: TaskAlert): boolean {
  return list.some((x) => x.anchor === a.anchor && x.beforeMin === a.beforeMin);
}

/** Toggle one alert in a list, keeping it sorted (earliest first). */
export function toggleAlert(list: TaskAlert[], a: TaskAlert): TaskAlert[] {
  const next = hasAlert(list, a)
    ? list.filter((x) => !(x.anchor === a.anchor && x.beforeMin === a.beforeMin))
    : [...list, a];
  return next.sort((x, y) => (x.anchor === y.anchor ? y.beforeMin - x.beforeMin : x.anchor === 'start' ? -1 : 1));
}

export function describeBefore(beforeMin: number, anchor: TaskAlert['anchor']): string {
  if (beforeMin === 0) return anchor === 'start' ? 'At start' : 'When due';
  if (beforeMin % 1440 === 0) return `${beforeMin / 1440}d before`;
  if (beforeMin % 60 === 0) return `${beforeMin / 60}h before`;
  return `${beforeMin}m before`;
}

/** What, if changed, means the Calendar copy is out of date. */
export function alertSignature(t: Task, alerts: TaskAlert[]): string {
  if (alerts.length === 0) return '';
  return JSON.stringify([t.title, t.startDate, t.startTime, taskDuration(t), t.deadline, t.deadlineTime, alerts]);
}

export type AlertState = 'none' | 'pending' | 'sent' | 'changed';

export function alertState(t: Task, defaultBeforeMin: DefaultAlert): AlertState {
  const alerts = effectiveAlerts(t, defaultBeforeMin);
  if (alerts.length === 0 || t.status !== 'open' || t.trashedAt !== null) return 'none';
  if (!t.alertsSentSig) return 'pending';
  return t.alertsSentSig === alertSignature(t, alerts) ? 'sent' : 'changed';
}

function endStamp(date: DateStr, startMin: number, lenMin: number): string {
  const end = Math.min(DAY_MIN - 1, startMin + lenMin);
  return floatingStamp(date, toHHMM(end));
}

/** Calendar events carrying a to-do's alerts: one for its start, one for its
 *  deadline, each only if it has alerts of that kind. */
export function alertEvents(t: Task, defaultBeforeMin: DefaultAlert): IcsEvent[] {
  const alerts = effectiveAlerts(t, defaultBeforeMin);
  const out: IcsEvent[] = [];
  const title = t.title || 'To-do';
  const start = alerts.filter((a) => a.anchor === 'start');
  if (start.length > 0) {
    const m = parseHHMM(t.startTime)!;
    out.push({
      uid: `clarity-task-${t.id}-start@clarity.app`,
      start: floatingStamp(t.startDate!, t.startTime!),
      end: endStamp(t.startDate!, m, taskDuration(t)),
      summary: title,
      description: 'Planned in Clarity.',
      alarms: start.map((a) => ({
        offsetMin: -a.beforeMin,
        text: a.beforeMin === 0 ? `Now: ${title}` : `${title} at ${formatClock(m)}`,
      })),
    });
  }
  const due = alerts.filter((a) => a.anchor === 'deadline');
  if (due.length > 0) {
    const time = parseHHMM(t.deadlineTime) !== null ? t.deadlineTime! : DEADLINE_DEFAULT_TIME;
    const m = parseHHMM(time)!;
    out.push({
      uid: `clarity-task-${t.id}-due@clarity.app`,
      start: floatingStamp(t.deadline!, time),
      end: endStamp(t.deadline!, m, 15),
      summary: `⚑ Due: ${title}`,
      description: 'Deadline from Clarity.',
      alarms: due.map((a) => ({
        offsetMin: -a.beforeMin,
        text: a.beforeMin === 0 ? `Due now: ${title}` : `Due ${formatClock(m)}: ${title}`,
      })),
    });
  }
  return out;
}

/** One file for many to-dos (a day's worth), or for one. */
export function alertsCalendar(tasks: Task[], defaultBeforeMin: DefaultAlert, now = new Date()): string {
  return buildCalendar('Clarity alerts', tasks.flatMap((t) => alertEvents(t, defaultBeforeMin)), utcStamp(now));
}

/** To-dos whose alerts belong to one of `dates` (timed there, or due there). */
export function tasksWithAlertsOn(tasks: Task[], dates: DateStr[], defaultBeforeMin: DefaultAlert): Task[] {
  const set = new Set(dates);
  return tasks.filter((t) => {
    if (t.status !== 'open' || t.trashedAt !== null) return false;
    const alerts = effectiveAlerts(t, defaultBeforeMin);
    return alerts.some((a) => (a.anchor === 'start' ? set.has(t.startDate!) : set.has(t.deadline!)));
  });
}

/** Alert moments (epoch ms) for a to-do — for in-app nudges while open. */
export function alertMoments(t: Task, defaultBeforeMin: DefaultAlert): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (const a of effectiveAlerts(t, defaultBeforeMin)) {
    const date = a.anchor === 'start' ? t.startDate! : t.deadline!;
    const hhmm = a.anchor === 'start' ? t.startTime! : (parseHHMM(t.deadlineTime) !== null ? t.deadlineTime! : DEADLINE_DEFAULT_TIME);
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    const d = new Date(`${date}T00:00:00`);
    d.setHours(h, m - a.beforeMin, 0, 0);
    const title = t.title || 'To-do';
    out.push({
      at: d.getTime(),
      text: a.anchor === 'start'
        ? (a.beforeMin === 0 ? `Starting now: ${title}` : `In ${a.beforeMin} min: ${title}`)
        : (a.beforeMin === 0 ? `Due now: ${title}` : `Due soon: ${title}`),
    });
  }
  return out;
}
