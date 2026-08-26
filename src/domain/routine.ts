import type { DateStr, RoutineItem, RoutineLog } from '../db/models';
import { addDays, dateStrOf, toDateStr } from './dates';
import { sortByOrderKey } from '../db/ordering';

/** Pure logic for the daily routine. Nothing here resets anything: completion
 *  is stored per (day, item), so "every day starts fresh" is a property of the
 *  data model rather than a job that has to run at midnight. */

export function logId(date: DateStr, itemId: string): string {
  return `${date}:${itemId}`;
}

export function activeItems(items: RoutineItem[]): RoutineItem[] {
  return sortByOrderKey(items.filter((i) => i.active));
}

/** Items that already existed on `date`. An item added today must not make
 *  yesterday retroactively incomplete and break a real streak. */
export function itemsOnDate(items: RoutineItem[], date: DateStr): RoutineItem[] {
  return activeItems(items).filter((i) => dateStrOf(i.createdAt) <= date);
}

export function completedIdsOn(logs: RoutineLog[], date: DateStr): Set<string> {
  const set = new Set<string>();
  for (const l of logs) if (l.date === date) set.add(l.itemId);
  return set;
}

export interface RoutineProgress {
  done: number;
  total: number;
  /** 0..1, and 0 when there is nothing to do (never NaN). */
  ratio: number;
  complete: boolean;
}

export function routineProgress(
  items: RoutineItem[],
  logs: RoutineLog[],
  date: DateStr,
): RoutineProgress {
  const due = itemsOnDate(items, date);
  const done = completedIdsOn(logs, date);
  const doneCount = due.filter((i) => done.has(i.id)).length;
  return {
    done: doneCount,
    total: due.length,
    ratio: due.length === 0 ? 0 : doneCount / due.length,
    complete: due.length > 0 && doneCount === due.length,
  };
}

export function isDayComplete(items: RoutineItem[], logs: RoutineLog[], date: DateStr): boolean {
  return routineProgress(items, logs, date).complete;
}

/** Consecutive complete days ending today. Today not being finished *yet*
 *  doesn't break the streak — an unfinished morning shouldn't read as a miss —
 *  so we fall back to counting from yesterday. */
export function streakLength(
  items: RoutineItem[],
  logs: RoutineLog[],
  today: DateStr,
  maxLookback = 730,
): number {
  let cursor = isDayComplete(items, logs, today) ? today : addDays(today, -1);
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    if (!isDayComplete(items, logs, cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface DayMark {
  date: DateStr;
  ratio: number;
  complete: boolean;
}

/** The last `days` days, oldest first — the history strip on the Routine screen. */
export function recentDays(
  items: RoutineItem[],
  logs: RoutineLog[],
  today: DateStr,
  days = 7,
): DayMark[] {
  const out: DayMark[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const p = routineProgress(items, logs, date);
    out.push({ date, ratio: p.ratio, complete: p.complete });
  }
  return out;
}

/** Suggested starter routine offered on the empty state. */
export const STARTER_ROUTINE: string[] = [
  'Natural light',
  'Park phone in other room',
  '2 breath buffer',
  'Ask, don’t assume',
  '8 minute replay',
  'Five pages a day',
  'Daily cleanse',
  'Bedtime cue',
];

export { toDateStr };
