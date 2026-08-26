import type { DailyTarget, DateStr, Task, TargetOutcome } from '../db/models';
import { addDays } from './dates';
import { isLive } from './smartLists';

/** The daily target: one sentence set in the morning, judged at night.
 *
 *  Nothing here schedules anything. A target belongs to a date, so "today's
 *  target" is a lookup, and yesterday's stays exactly as you left it. */

export function targetFor(targets: DailyTarget[], date: DateStr): DailyTarget | null {
  return targets.find((t) => t.date === date) ?? null;
}

/** A linked to-do carries the target: finishing it counts as a hit even before
 *  you sit down to review. Derived rather than written, so unticking the to-do
 *  takes the claim back — until you record a verdict yourself, which wins. */
export function resolveOutcome(target: DailyTarget, tasks: Task[]): TargetOutcome {
  if (target.outcome !== 'pending') return target.outcome;
  if (target.taskId === null) return 'pending';
  const task = tasks.find((t) => t.id === target.taskId);
  if (!task || !isLive(task)) return 'pending';
  return task.status === 'completed' ? 'hit' : 'pending';
}

export function resolveAll(targets: DailyTarget[], tasks: Task[]): DailyTarget[] {
  return targets.map((t) => ({ ...t, outcome: resolveOutcome(t, tasks) }));
}

/** True once a verdict has actually been recorded by hand. */
export function isReviewed(target: DailyTarget): boolean {
  return target.reviewedAt !== null;
}

/** Consecutive hit days ending today. Today still pending doesn't break the
 *  streak — an unjudged evening isn't a miss — but a recorded miss or partial
 *  ends it at zero, because it did happen. */
export function hitStreak(
  resolved: DailyTarget[],
  today: DateStr,
  maxLookback = 730,
): number {
  const byDate = new Map(resolved.map((t) => [t.date, t]));
  const todays = byDate.get(today);
  if (todays && (todays.outcome === 'missed' || todays.outcome === 'partial')) return 0;

  let cursor = todays && todays.outcome === 'hit' ? today : addDays(today, -1);
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    const t = byDate.get(cursor);
    if (!t || t.outcome !== 'hit') break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface TargetDay {
  date: DateStr;
  outcome: TargetOutcome;
  /** No target was set that day at all — distinct from one that was missed. */
  unset: boolean;
}

/** The last `days` days, oldest first — the history strip. */
export function recentTargets(
  resolved: DailyTarget[],
  today: DateStr,
  days = 14,
): TargetDay[] {
  const byDate = new Map(resolved.map((t) => [t.date, t]));
  const out: TargetDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const t = byDate.get(date);
    out.push({
      date,
      outcome: t?.outcome ?? 'pending',
      unset: t === undefined,
    });
  }
  return out;
}

export interface TargetStats {
  set: number;
  hit: number;
  partial: number;
  missed: number;
  pending: number;
  /** Hits ÷ days judged. 0 when nothing has been judged yet (never NaN). */
  hitRate: number;
}

/** Counts over the last `days` days, today included. */
export function targetStats(
  resolved: DailyTarget[],
  today: DateStr,
  days = 30,
): TargetStats {
  const window = recentTargets(resolved, today, days).filter((d) => !d.unset);
  const hit = window.filter((d) => d.outcome === 'hit').length;
  const partial = window.filter((d) => d.outcome === 'partial').length;
  const missed = window.filter((d) => d.outcome === 'missed').length;
  const pending = window.filter((d) => d.outcome === 'pending').length;
  const judged = hit + partial + missed;
  return {
    set: window.length,
    hit,
    partial,
    missed,
    pending,
    hitRate: judged === 0 ? 0 : hit / judged,
  };
}

/** Past targets newest first — the history list. Today is excluded: it lives
 *  in the hero, and showing it twice invites judging it twice. */
export function pastTargets(resolved: DailyTarget[], today: DateStr): DailyTarget[] {
  return resolved
    .filter((t) => t.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const OUTCOME_LABEL: Record<TargetOutcome, string> = {
  pending: 'Not judged yet',
  hit: 'Hit',
  partial: 'Partial',
  missed: 'Missed',
};

export const OUTCOME_COLOR: Record<TargetOutcome, string> = {
  pending: 'var(--text-tertiary)',
  hit: 'var(--green)',
  partial: 'var(--yellow-deep)',
  missed: 'var(--red)',
};
