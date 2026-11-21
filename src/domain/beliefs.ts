import type { Belief, BeliefEvidence, BeliefRating, DateStr } from '../db/models';
import { addDays, dateStrOf } from './dates';
import { sortByOrderKey } from '../db/ordering';

/** The belief board: statements you are deliberately installing, each carrying
 *  a conviction that moves.
 *
 *  Nothing here is a task and nothing here is a habit. A belief is never
 *  "done" — what changes is how much of you believes it, which is why the unit
 *  of tracking is a score per day rather than a tick. Conviction is stored per
 *  (day, belief), so re-rating replaces rather than accumulates and "a fresh
 *  rating every morning" is a property of the schema, not a job that runs at
 *  midnight. */

export const MAX_SCORE = 10;

export function ratingId(date: DateStr, beliefId: string): string {
  return `${date}:${beliefId}`;
}

export function activeBeliefs(beliefs: Belief[]): Belief[] {
  return sortByOrderKey(beliefs.filter((b) => b.active));
}

/** Beliefs that already existed on `date`. One added today must not make
 *  yesterday retroactively unrated and break a streak that really happened. */
export function beliefsOnDate(beliefs: Belief[], date: DateStr): Belief[] {
  return activeBeliefs(beliefs).filter((b) => dateStrOf(b.createdAt) <= date);
}

export function ratingsOn(ratings: BeliefRating[], date: DateStr): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ratings) if (r.date === date) out.set(r.beliefId, r.score);
  return out;
}

export function scoreOn(
  ratings: BeliefRating[],
  beliefId: string,
  date: DateStr,
): number | null {
  const r = ratings.find((x) => x.beliefId === beliefId && x.date === date);
  return r ? r.score : null;
}

/** The last score at or before `date` — what the board shows for a belief you
 *  haven't re-rated yet today. Conviction persists; it doesn't reset to zero
 *  just because the day turned over. */
export function latestScore(
  ratings: BeliefRating[],
  beliefId: string,
  date: DateStr,
): number | null {
  let best: BeliefRating | null = null;
  for (const r of ratings) {
    if (r.beliefId !== beliefId || r.date > date) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best ? best.score : null;
}

export interface SessionProgress {
  rated: number;
  total: number;
  /** 0..1, and 0 when there is nothing to rate (never NaN). */
  ratio: number;
  complete: boolean;
  /** Mean conviction across what has been rated today, or null if nothing has. */
  average: number | null;
}

/** How today's session stands. */
export function sessionProgress(
  beliefs: Belief[],
  ratings: BeliefRating[],
  date: DateStr,
): SessionProgress {
  const due = beliefsOnDate(beliefs, date);
  const today = ratingsOn(ratings, date);
  const scores = due.map((b) => today.get(b.id)).filter((s): s is number => s !== undefined);
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    rated: scores.length,
    total: due.length,
    ratio: due.length === 0 ? 0 : scores.length / due.length,
    complete: due.length > 0 && scores.length === due.length,
    average: scores.length === 0 ? null : sum / scores.length,
  };
}

export function isSessionComplete(
  beliefs: Belief[],
  ratings: BeliefRating[],
  date: DateStr,
): boolean {
  return sessionProgress(beliefs, ratings, date).complete;
}

/** Consecutive complete days ending today. Today being unfinished *yet* does
 *  not break the streak — an unspoken morning isn't a miss — so we fall back
 *  to counting from yesterday, the same way Habits does. */
export function beliefStreak(
  beliefs: Belief[],
  ratings: BeliefRating[],
  today: DateStr,
  maxLookback = 730,
): number {
  let cursor = isSessionComplete(beliefs, ratings, today) ? today : addDays(today, -1);
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    if (!isSessionComplete(beliefs, ratings, cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface BeliefDay {
  date: DateStr;
  /** Mean conviction recorded that day, or null if nothing was rated. */
  average: number | null;
  ratio: number;
  complete: boolean;
}

/** The last `days` days, oldest first — the history strip. */
export function recentBeliefDays(
  beliefs: Belief[],
  ratings: BeliefRating[],
  today: DateStr,
  days = 14,
): BeliefDay[] {
  const out: BeliefDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const p = sessionProgress(beliefs, ratings, date);
    out.push({ date, average: p.average, ratio: p.ratio, complete: p.complete });
  }
  return out;
}

/** One belief's scores over the last `days` days, oldest first. Gaps stay null
 *  rather than being carried forward: the sparkline should show the days you
 *  didn't show up, not paper over them. */
export function beliefTrend(
  ratings: BeliefRating[],
  beliefId: string,
  today: DateStr,
  days = 14,
): Array<{ date: DateStr; score: number | null }> {
  const byDate = new Map<string, number>();
  for (const r of ratings) if (r.beliefId === beliefId) byDate.set(r.date, r.score);
  const out: Array<{ date: DateStr; score: number | null }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, score: byDate.get(date) ?? null });
  }
  return out;
}

/** Change in conviction over the window: latest score minus the earliest one
 *  recorded inside it. Null when there is nothing to compare — one rating is a
 *  reading, not a direction. */
export function beliefMomentum(
  ratings: BeliefRating[],
  beliefId: string,
  today: DateStr,
  days = 14,
): number | null {
  const window = beliefTrend(ratings, beliefId, today, days).filter((d) => d.score !== null);
  if (window.length < 2) return null;
  return window[window.length - 1]!.score! - window[0]!.score!;
}

/** Board-wide movement: the mean of every belief's momentum that has one. */
export function boardMomentum(
  beliefs: Belief[],
  ratings: BeliefRating[],
  today: DateStr,
  days = 14,
): number | null {
  const deltas = beliefsOnDate(beliefs, today)
    .map((b) => beliefMomentum(ratings, b.id, today, days))
    .filter((d): d is number => d !== null);
  if (deltas.length === 0) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

export function evidenceFor(evidence: BeliefEvidence[], beliefId: string): BeliefEvidence[] {
  return evidence
    .filter((e) => e.beliefId === beliefId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function evidenceCounts(evidence: BeliefEvidence[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of evidence) out.set(e.beliefId, (out.get(e.beliefId) ?? 0) + 1);
  return out;
}

/** What a score means, in words. Shown beside the dots so a number you gave
 *  three weeks ago still means something when you read it back. */
export function scoreLabel(score: number): string {
  if (score <= 1) return 'I don’t believe this yet';
  if (score <= 3) return 'I want to believe it';
  if (score <= 5) return 'Some days I believe it';
  if (score <= 7) return 'I mostly believe it';
  if (score <= 9) return 'I believe it';
  return 'I live from it';
}

export function scoreColor(score: number): string {
  if (score <= 3) return 'var(--red)';
  if (score <= 6) return 'var(--yellow-deep)';
  if (score <= 8) return 'var(--teal)';
  return 'var(--green)';
}

/** Example statements offered as placeholder text on the empty board. They are
 *  never written for you — a belief you didn't choose is not a belief. */
export const BELIEF_EXAMPLES: string[] = [
  'I am the kind of person who finishes what I start.',
  'Discomfort is the signal that I am growing, not the sign to stop.',
  'My focus is a skill I train, not a mood I wait for.',
  'Rest is part of the work, not a reward for it.',
  'I keep the promises I make to myself.',
];
