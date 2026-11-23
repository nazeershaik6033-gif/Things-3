import type { DateStr, Sprint, Task } from '../db/models';
import { dateStrOf } from './dates';
import { taskTimeByDay } from './timeTracking';
import { inToday } from './smartLists';

/** "Finish Day", ported from Super Productivity's daily summary: what got
 *  done, how long it took against the estimate, and what is still open and
 *  should roll to tomorrow — then one line of reflection on the day. */

export interface DaySummary {
  completed: Task[];
  /** Open to-dos still sitting in Today (or overdue from earlier days). */
  unfinished: Task[];
  trackedSec: number;
  /** Estimates of everything done or planned today, in minutes. */
  estimatedMin: number;
  /** Seconds spent per task today, for the list. */
  secByTask: Map<string, number>;
}

export function summarizeDay(tasks: Task[], sprints: Sprint[], day: DateStr): DaySummary {
  const secByTask = new Map<string, number>();
  let trackedSec = 0;
  for (const t of tasks) {
    if (t.trashedAt !== null) continue;
    const sec = taskTimeByDay(t, sprints)[day] ?? 0;
    if (sec > 0) {
      secByTask.set(t.id, sec);
      trackedSec += sec;
    }
  }
  const completed = tasks
    .filter((t) => t.trashedAt === null && t.status === 'completed' && t.completedAt !== null && dateStrOf(t.completedAt) === day)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  const unfinished = tasks.filter(
    (t) => t.trashedAt === null && t.status === 'open' &&
      (inToday(t, day) || (t.startDate !== null && t.startDate < day)),
  );
  const estimatedMin = [...completed, ...unfinished].reduce((s, t) => s + (t.timeEstimateMin ?? 0), 0);
  return { completed, unfinished, trackedSec, estimatedMin, secByTask };
}

export const IMPACT_LABELS = ['Low', 'Some', 'High', 'Very high'] as const;
