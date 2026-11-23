import type { DateStr, Sprint, Task } from '../db/models';
import { toDateStr } from './dates';

/** Time tracking and estimates, ported from Super Productivity's
 *  `timeSpentOnDay` model: every to-do keeps seconds per local day, so the
 *  Worklog can answer "what did I do on Tuesday" and a timer left running
 *  past midnight is split honestly across both days. Pure — no DB, no clock. */

/** Split a tracked span [startMs, endMs) into whole seconds per local day. */
export function splitAcrossDays(startMs: number, endMs: number): Record<DateStr, number> {
  const out: Record<DateStr, number> = {};
  if (!(endMs > startMs)) return out;
  let cursor = startMs;
  while (cursor < endMs) {
    const d = new Date(cursor);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const sliceEnd = Math.min(endMs, nextMidnight);
    const key = toDateStr(d);
    out[key] = (out[key] ?? 0) + (sliceEnd - cursor) / 1000;
    cursor = sliceEnd;
  }
  for (const k of Object.keys(out)) {
    out[k] = Math.round(out[k]!);
    if (out[k] === 0) delete out[k];
  }
  return out;
}

/** Merge per-day seconds into an existing map (returns a new object). */
export function addTime(
  map: Record<DateStr, number> | undefined,
  add: Record<DateStr, number>,
): Record<DateStr, number> {
  const out: Record<DateStr, number> = { ...(map ?? {}) };
  for (const [day, sec] of Object.entries(add)) {
    const next = Math.max(0, (out[day] ?? 0) + sec);
    if (next === 0) delete out[day];
    else out[day] = next;
  }
  return out;
}

/** Seconds a finished sprint actually focused, or 0 if it never ran. */
export function sprintSeconds(s: Sprint): number {
  if (s.status !== 'done' || s.startedAt === null || s.endedAt === null) return 0;
  return Math.max(0, Math.round((s.endedAt - s.startedAt) / 1000));
}

/** Per-day seconds for one task: the tracker's own time plus every finished
 *  Focus Sprint on it. Sprints are read rather than copied into the task, so
 *  correcting a sprint in the Sprint log corrects the Worklog too. */
export function taskTimeByDay(task: Task, sprints: Sprint[] = []): Record<DateStr, number> {
  let out: Record<DateStr, number> = { ...(task.timeSpent ?? {}) };
  for (const s of sprints) {
    if (s.taskId !== task.id) continue;
    const sec = sprintSeconds(s);
    if (sec > 0 && s.startedAt !== null && s.endedAt !== null) {
      out = addTime(out, splitAcrossDays(s.startedAt, s.endedAt));
    }
  }
  return out;
}

export function totalSeconds(map: Record<DateStr, number> | undefined): number {
  let sum = 0;
  for (const v of Object.values(map ?? {})) sum += v;
  return sum;
}

/** Live total for a task, including a running tracker span. */
export function liveTaskSeconds(
  task: Task,
  sprints: Sprint[],
  tracker: { taskId: string; startedAt: number } | null,
  now: number,
): number {
  let total = totalSeconds(taskTimeByDay(task, sprints));
  if (tracker && tracker.taskId === task.id) total += Math.max(0, (now - tracker.startedAt) / 1000);
  return Math.round(total);
}

/** "45s", "12m", "1h 05m", "26h 30m". Compact enough for a chip. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "0:04:09" — the running clock. */
export function formatClockHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Parse a human duration into minutes: "90", "45m", "1h", "1h30m",
 *  "1.5h", "1:30". Returns null for anything unparseable or zero. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let min: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
    min = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    min = Number(m[1]);
  } else if ((m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m(?:in)?)?$/))) {
    if (m[1] === undefined && m[2] === undefined) return null;
    min = (m[1] ? Number(m[1]) * 60 : 0) + (m[2] ? Number(m[2]) : 0);
  }
  if (min === null || !Number.isFinite(min)) return null;
  min = Math.round(min);
  return min > 0 ? min : null;
}

/** 0..1+ — how much of the estimate has been used. null with no estimate. */
export function estimateRatio(spentSec: number, estimateMin: number | null): number | null {
  if (!estimateMin || estimateMin <= 0) return null;
  return spentSec / (estimateMin * 60);
}

/** Sum of open estimates minus time already spent on them, in minutes: what
 *  is left of today's plan. Mirrors Super Productivity's "time remaining". */
export function remainingEstimateMin(tasks: Task[], sprints: Sprint[] = []): number {
  let left = 0;
  for (const t of tasks) {
    if (t.status !== 'open' || !t.timeEstimateMin) continue;
    const spentMin = totalSeconds(taskTimeByDay(t, sprints)) / 60;
    left += Math.max(0, t.timeEstimateMin - spentMin);
  }
  return Math.round(left);
}

/** Break reminder (Super Productivity's take-a-break): has the current
 *  stretch of tracked work run long enough to suggest stepping away? */
export function breakDue(
  workStartedAt: number | null,
  now: number,
  afterMin: number,
): boolean {
  if (workStartedAt === null || afterMin <= 0) return false;
  return now - workStartedAt >= afterMin * 60_000;
}

export const ESTIMATE_PRESETS = [5, 15, 30, 45, 60, 90, 120, 240] as const;
