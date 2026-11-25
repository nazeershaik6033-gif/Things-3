import { nanoid } from 'nanoid';
import { db } from './db';
import type {
  Counter, CounterKind, DateStr, DayReview, RepeatCfg, RepeatRule, RepeatTemplate, Task,
} from './models';
import { applyOps, createProject, createTag, createTask, onTaskCompleted, updateTask, type Op } from './mutations';
import { keyAtEnd, sortByOrderKey } from './ordering';
import { addDays, dateStrOf, daysBetween, todayStr } from '../domain/dates';
import { addTime, splitAcrossDays } from '../domain/timeTracking';
import { nextAfterCompletion, normalizeRule, planOccurrences } from '../domain/repeat';
import { COUNTER_COLORS, counterDayId } from '../domain/counters';
import { issueNotes, issueRef, issueTitle, planIssueSync, type GhIssue, type RepoRef } from '../domain/issues';
import type { DaySummary } from '../domain/finishDay';

/** Writes for the features ported from Super Productivity. Same rule as
 *  mutations.ts: everything goes through applyOps with before/after images. */

// ------------------------------------------------------- time tracking ----

/** Bank a tracked span on a task, split across local days. */
export async function addTrackedTime(taskId: string, startMs: number, endMs: number): Promise<void> {
  const t = await db.tasks.get(taskId);
  if (!t) return;
  const add = splitAcrossDays(startMs, endMs);
  if (Object.keys(add).length === 0) return;
  await updateTask(taskId, { timeSpent: addTime(t.timeSpent, add) });
}

/** Hand-correct the time on one day ("I forgot to start the timer"). */
export async function setTimeOnDay(taskId: string, day: DateStr, sec: number): Promise<void> {
  const t = await db.tasks.get(taskId);
  if (!t) return;
  const next = { ...(t.timeSpent ?? {}) };
  if (sec > 0) next[day] = Math.round(sec);
  else delete next[day];
  await updateTask(taskId, { timeSpent: next });
}

export async function setEstimate(taskId: string, minutes: number | null): Promise<void> {
  await updateTask(taskId, { timeEstimateMin: minutes && minutes > 0 ? Math.round(minutes) : null });
}

// ------------------------------------------------------------- repeats ----

export function templateFromTask(t: Task): RepeatTemplate {
  return {
    title: t.title,
    notes: t.notes,
    checklist: t.checklist.map((c) => c.title),
    tagIds: [...t.tagIds],
    projectId: t.projectId,
    headingId: t.headingId,
    areaId: t.areaId,
    evening: t.evening,
    energy: t.energy,
    timeEstimateMin: t.timeEstimateMin ?? null,
    deadlineOffsetDays: t.deadline && t.startDate ? Math.max(0, daysBetween(t.startDate, t.deadline)) : null,
    startTime: t.startTime ?? null,
    durationMin: t.durationMin ?? null,
    deadlineTime: t.deadlineTime ?? null,
  };
}

/** A time set from a repeating to-do's card applies to the series: the
 *  template takes it, and so do open occurrences that haven't started yet
 *  and still carry the series' old time. (A block dragged on the timeline
 *  changes that one day only, and doesn't come through here.) */
export async function setRepeatSeriesTime(
  cfgId: string,
  startTime: string | null,
  durationMin: number | null,
  today = todayStr(),
): Promise<void> {
  const before = await db.repeatCfgs.get(cfgId);
  if (!before) return;
  const oldTime = before.template.startTime ?? null;
  const now = Date.now();
  const ops: Op[] = [{
    table: 'repeatCfgs', key: cfgId, before,
    after: { ...before, template: { ...before.template, startTime, durationMin }, modifiedAt: now },
  }];
  const instances = await db.tasks.where('repeatTemplateId').equals(cfgId).toArray();
  for (const t of instances) {
    if (t.status !== 'open' || t.trashedAt !== null || !t.startDate || t.startDate <= today) continue;
    if ((t.startTime ?? null) !== oldTime) continue;
    ops.push({ table: 'tasks', key: t.id, before: t, after: { ...t, startTime, durationMin, modifiedAt: now } });
  }
  await applyOps(ops);
}

async function createOccurrence(cfg: RepeatCfg, date: DateStr): Promise<string> {
  const tp = cfg.template;
  return createTask({
    title: tp.title,
    notes: tp.notes,
    checklist: tp.checklist.map((title) => ({ id: nanoid(), title, completed: false })),
    tagIds: [...tp.tagIds],
    projectId: tp.projectId,
    headingId: tp.headingId,
    areaId: tp.areaId,
    evening: tp.evening,
    energy: tp.energy,
    timeEstimateMin: tp.timeEstimateMin,
    startDate: date,
    bucket: 'anytime',
    deadline: tp.deadlineOffsetDays !== null ? addDays(date, tp.deadlineOffsetDays) : null,
    startTime: tp.startTime ?? null,
    durationMin: tp.durationMin ?? null,
    deadlineTime: tp.deadlineOffsetDays !== null ? (tp.deadlineTime ?? null) : null,
    repeatTemplateId: cfg.id,
  });
}

async function saveCfg(before: RepeatCfg | null, after: RepeatCfg): Promise<void> {
  await applyOps([{ table: 'repeatCfgs', key: after.id, before, after: { ...after, modifiedAt: Date.now() } }]);
}

/** Turn an existing to-do into a repeating one. The to-do itself becomes the
 *  first occurrence (re-dated to the rule's anchor) so nothing is lost. */
export async function makeRepeating(taskId: string, rule: RepeatRule, today = todayStr()): Promise<string | null> {
  const t = await db.tasks.get(taskId);
  if (!t) return null;
  const r = normalizeRule(rule);
  if (t.repeatTemplateId) {
    const existing = await db.repeatCfgs.get(t.repeatTemplateId);
    if (existing) {
      await updateRepeatRule(existing.id, r, today);
      return existing.id;
    }
  }
  const now = Date.now();
  const cfg: RepeatCfg = {
    id: nanoid(), rule: r, template: templateFromTask(t), lastDate: r.anchor,
    paused: false, createdAt: now, modifiedAt: now,
  };
  await saveCfg(null, cfg);
  await updateTask(taskId, {
    repeatTemplateId: cfg.id,
    startDate: r.anchor,
    bucket: 'anytime',
    evening: t.evening && r.anchor <= today,
    repeatRule: JSON.stringify(r),
  });
  await runRepeats(today);
  return cfg.id;
}

/** Change the rule. Open future occurrences that no longer fit are removed
 *  and the schedule is re-planned from today. */
export async function updateRepeatRule(cfgId: string, rule: RepeatRule, today = todayStr()): Promise<void> {
  const before = await db.repeatCfgs.get(cfgId);
  if (!before) return;
  const r = normalizeRule(rule);
  const instances = await db.tasks.where('repeatTemplateId').equals(cfgId).toArray();
  const ops: Op[] = [];
  for (const t of instances) {
    if (t.status === 'open' && t.trashedAt === null && t.startDate !== null && t.startDate > today) {
      ops.push({ table: 'tasks', key: t.id, before: t, after: null });
    }
  }
  await applyOps(ops);
  const keptDates = instances
    .filter((t) => !(t.status === 'open' && t.startDate !== null && t.startDate > today))
    .map((t) => t.startDate)
    .filter((d): d is DateStr => d !== null && d <= today);
  const latestKept = keptDates.sort().at(-1) ?? null;
  // Re-anchoring keeps the phase the user just chose; lastDate stops it
  // re-creating an occurrence that already exists today.
  await saveCfg(before, { ...before, rule: r, lastDate: latestKept && latestKept >= r.anchor ? latestKept : null });
  await runRepeats(today);
}

export async function updateRepeatTemplate(cfgId: string, patch: Partial<RepeatTemplate>): Promise<void> {
  const before = await db.repeatCfgs.get(cfgId);
  if (!before) return;
  await saveCfg(before, { ...before, template: { ...before.template, ...patch } });
}

export async function setRepeatPaused(cfgId: string, paused: boolean, today = todayStr()): Promise<void> {
  const before = await db.repeatCfgs.get(cfgId);
  if (!before) return;
  await saveCfg(before, { ...before, paused });
  if (!paused) await runRepeats(today);
}

/** Stop repeating: the config goes, open future occurrences go, and every
 *  occurrence you already have (done or not) stays as an ordinary to-do. */
export async function stopRepeating(cfgId: string, today = todayStr()): Promise<void> {
  const cfg = await db.repeatCfgs.get(cfgId);
  const instances = await db.tasks.where('repeatTemplateId').equals(cfgId).toArray();
  const ops: Op[] = [];
  for (const t of instances) {
    const future = t.status === 'open' && t.startDate !== null && t.startDate > today;
    if (future) ops.push({ table: 'tasks', key: t.id, before: t, after: null });
    else ops.push({ table: 'tasks', key: t.id, before: t, after: { ...t, repeatTemplateId: null, repeatRule: null, modifiedAt: Date.now() } });
  }
  if (cfg) ops.push({ table: 'repeatCfgs', key: cfgId, before: cfg, after: null });
  await applyOps(ops);
}

/** Create every occurrence that is due. Idempotent: safe at boot, at
 *  midnight and after any edit. */
let repeatQueue: Promise<unknown> = Promise.resolve();
export function runRepeats(today = todayStr()): Promise<number> {
  // Serialized: boot, rollover and edits can overlap, and two concurrent runs
  // would each see "not created yet" and duplicate an occurrence.
  const run = repeatQueue.then(() => runRepeatsNow(today));
  repeatQueue = run.catch(() => undefined);
  return run;
}

async function runRepeatsNow(today: DateStr): Promise<number> {
  let created = 0;
  for (const cfg of await db.repeatCfgs.toArray()) {
    const dates = planOccurrences(cfg, today);
    if (dates.length === 0) continue;
    const existing = new Set(
      (await db.tasks.where('repeatTemplateId').equals(cfg.id).toArray()).map((t) => t.startDate),
    );
    for (const d of dates) {
      if (existing.has(d)) continue;
      await createOccurrence(cfg, d);
      created++;
    }
    await saveCfg(cfg, { ...cfg, lastDate: dates.reduce((a, b) => (a > b ? a : b), cfg.lastDate ?? dates[0]!) });
  }
  return created;
}

/** After-completion rules: finishing one schedules the next from that day. */
export async function onRepeatCompleted(task: Task, completedAt: number): Promise<void> {
  if (!task.repeatTemplateId) return;
  const cfg = await db.repeatCfgs.get(task.repeatTemplateId);
  if (!cfg || cfg.paused || !cfg.rule.afterCompletion) return;
  const next = nextAfterCompletion(cfg.rule, dateStrOf(completedAt));
  if (!next) return;
  const open = (await db.tasks.where('repeatTemplateId').equals(cfg.id).toArray())
    .some((t) => t.id !== task.id && t.status === 'open' && t.trashedAt === null);
  if (open) return;
  await createOccurrence(cfg, next);
  await saveCfg(cfg, { ...cfg, lastDate: next });
}

onTaskCompleted(onRepeatCompleted);

// ------------------------------------------------------------ counters ----

export async function createCounter(title: string, kind: CounterKind, goal = 0): Promise<string> {
  const all = sortByOrderKey(await db.counters.toArray());
  const now = Date.now();
  const c: Counter = {
    id: nanoid(), title: title.trim() || 'Counter', kind,
    color: COUNTER_COLORS[all.length % COUNTER_COLORS.length]!,
    goal: Math.max(0, Math.round(goal)), orderKey: keyAtEnd(all), active: true,
    runningSince: null, createdAt: now, modifiedAt: now,
  };
  await applyOps([{ table: 'counters', key: c.id, before: null, after: c }]);
  return c.id;
}

export async function updateCounter(id: string, patch: Partial<Counter>): Promise<void> {
  const before = await db.counters.get(id);
  if (!before) return;
  await applyOps([{ table: 'counters', key: id, before, after: { ...before, ...patch, modifiedAt: Date.now() } }]);
}

export async function deleteCounter(id: string): Promise<void> {
  const before = await db.counters.get(id);
  const days = await db.counterDays.where('counterId').equals(id).toArray();
  const ops: Op[] = days.map((d) => ({ table: 'counterDays' as const, key: d.id, before: d, after: null }));
  if (before) ops.push({ table: 'counters', key: id, before, after: null });
  await applyOps(ops);
}

/** Add to a day's value (taps, or seconds). Never goes below zero. */
export async function bumpCounter(counterId: string, date: DateStr, delta: number): Promise<void> {
  const id = counterDayId(date, counterId);
  const before = (await db.counterDays.get(id)) ?? null;
  const value = Math.max(0, (before?.value ?? 0) + delta);
  await applyOps([{
    table: 'counterDays', key: id, before,
    after: value === 0 ? null : { id, counterId, date, value },
  }]);
}

export async function toggleStopwatch(counterId: string, now = Date.now()): Promise<void> {
  const c = await db.counters.get(counterId);
  if (!c || c.kind !== 'stopwatch') return;
  if (c.runningSince === null) {
    await updateCounter(counterId, { runningSince: now });
    return;
  }
  for (const [day, sec] of Object.entries(splitAcrossDays(c.runningSince, now))) {
    await bumpCounter(counterId, day, sec);
  }
  await updateCounter(counterId, { runningSince: null });
}

// ---------------------------------------------------------- finish day ----

export async function saveDayReview(
  date: DateStr,
  input: { impact: number | null; note: string },
  summary: Pick<DaySummary, 'trackedSec' | 'completed'>,
): Promise<void> {
  const before = (await db.dayReviews.get(date)) ?? null;
  const after: DayReview = {
    date,
    impact: input.impact,
    note: input.note.trim(),
    trackedSec: Math.round(summary.trackedSec),
    completedCount: summary.completed.length,
    finishedAt: Date.now(),
  };
  await applyOps([{ table: 'dayReviews', key: date, before, after }]);
}

/** Roll unfinished to-dos to tomorrow (keeps This Evening off). */
export async function moveToTomorrow(taskIds: string[], today = todayStr()): Promise<void> {
  const tomorrow = addDays(today, 1);
  for (const id of taskIds) {
    await updateTask(id, { startDate: tomorrow, evening: false, bucket: 'anytime' });
  }
}

// -------------------------------------------------------- issue import ----

export interface IssueSyncResult {
  created: number;
  completed: number;
  reopened: number;
  projectId: string;
}

/** Import a repo's issues into a project (created on first sync, named after
 *  the repo). Labels become tags. */
export async function syncIssues(r: RepoRef, issues: GhIssue[], projectId?: string | null): Promise<IssueSyncResult> {
  const tasks = await db.tasks.toArray();
  const plan = planIssueSync(r, issues, tasks);
  let pid = projectId ?? null;
  if (!pid || !(await db.projects.get(pid))) {
    const name = `${r.owner}/${r.repo}`;
    const existing = (await db.projects.toArray()).find((p) => p.title === name && p.trashedAt === null);
    pid = existing?.id ?? (await createProject({ title: name, notes: `https://github.com/${name}/issues` }));
  }
  const tags = await db.tags.toArray();
  const tagId = async (name: string): Promise<string> => {
    const hit = tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const id = await createTag(name);
    tags.push({ id, title: name, orderKey: '', parentId: null });
    return id;
  };
  for (const issue of plan.create) {
    const tagIds: string[] = [];
    for (const l of issue.labels ?? []) tagIds.push(await tagId(l.name));
    await createTask({
      title: issueTitle(issue),
      notes: issueNotes(issue),
      projectId: pid,
      bucket: 'anytime',
      tagIds,
      issueRef: issueRef(r, issue.number),
    });
  }
  const now = Date.now();
  for (const id of plan.complete) await updateTask(id, { status: 'completed', completedAt: now });
  for (const id of plan.reopen) await updateTask(id, { status: 'open', completedAt: null });
  for (const { id, title } of plan.retitle) await updateTask(id, { title });
  return { created: plan.create.length, completed: plan.complete.length, reopened: plan.reopen.length, projectId: pid };
}
