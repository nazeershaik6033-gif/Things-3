import type { Counter, CounterDay, DateStr } from '../db/models';
import { addDays } from './dates';
import { splitAcrossDays } from './timeTracking';

/** Counters, ported from Super Productivity's simple counters: a click
 *  counter (glasses of water, push-ups) or a stopwatch (minutes reading),
 *  stored per day, with a daily goal that builds a streak. */

export function counterDayId(date: DateStr, counterId: string): string {
  return `${date}:${counterId}`;
}

/** Stored value on a day: taps, or seconds for a stopwatch. */
export function storedValue(days: CounterDay[], counterId: string, date: DateStr): number {
  return days.find((d) => d.counterId === counterId && d.date === date)?.value ?? 0;
}

/** Value including a stopwatch's running span (only the part on `date`). */
export function liveValue(counter: Counter, days: CounterDay[], date: DateStr, now: number): number {
  let v = storedValue(days, counter.id, date);
  if (counter.kind === 'stopwatch' && counter.runningSince !== null) {
    v += splitAcrossDays(counter.runningSince, now)[date] ?? 0;
  }
  return v;
}

/** Goal in the stored unit (taps, or seconds for a stopwatch). */
export function goalUnits(counter: Counter): number {
  return counter.kind === 'stopwatch' ? counter.goal * 60 : counter.goal;
}

/** Did this day count toward the streak? With no goal, any activity counts. */
export function metGoal(counter: Counter, value: number): boolean {
  const g = goalUnits(counter);
  return g > 0 ? value >= g : value > 0;
}

/** Consecutive days meeting the goal, ending today — or yesterday, so an
 *  unfinished today doesn't read as a broken streak before it's over. */
export function counterStreak(counter: Counter, days: CounterDay[], today: DateStr, now: number): number {
  let d = metGoal(counter, liveValue(counter, days, today, now)) ? today : addDays(today, -1);
  let n = 0;
  for (let i = 0; i < 3660; i++) {
    const v = d === today ? liveValue(counter, days, d, now) : storedValue(days, counter.id, d);
    if (!metGoal(counter, v)) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Oldest → newest: the last `n` days for a strip. */
export function recentDays(
  counter: Counter, days: CounterDay[], today: DateStr, now: number, n = 7,
): { date: DateStr; value: number; met: boolean }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const value = i === 0 ? liveValue(counter, days, date, now) : storedValue(days, counter.id, date);
    out.push({ date, value, met: metGoal(counter, value) });
  }
  return out;
}

export function formatCounterValue(counter: Counter, value: number): string {
  if (counter.kind === 'click') return String(value);
  const m = Math.floor(value / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export const COUNTER_COLORS = [
  'var(--blue)', 'var(--green)', 'var(--purple)', 'var(--teal)', 'var(--yellow-deep)', 'var(--red)',
];
