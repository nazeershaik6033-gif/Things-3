import { nanoid } from 'nanoid';
import { db } from './db';
import type {
  Task, Project, Heading, Area, Tag, Bucket, DateStr, RoutineItem, RoutineLog,
  DailyTarget, TargetOutcome, Sprint, EnergyLog, HealthDay, SleepNight, ActivityDay, TaskAlert,
} from './models';
import { keyAtEnd, keyBetween, sortByOrderKey, needsRebalance, rebalancedKeys } from './ordering';
import { fromDateStr, todayStr, toDateStr } from '../domain/dates';
import { logId } from '../domain/routine';
import { noteOps } from './undo';

/** Every write flows through this module. Ops carry before/after images so an
 *  undo ring buffer can be layered on later (iteration 2) without rewrites. */

type TableName =
  | 'tasks' | 'projects' | 'headings' | 'areas' | 'tags' | 'settings' | 'calendarEvents'
  | 'boards' | 'boardLists' | 'boardLabels' | 'cards'
  | 'routineItems' | 'routineLogs' | 'dailyTargets'
  | 'beliefs' | 'beliefRatings' | 'beliefEvidence' | 'quoteFavorites' | 'quoteNotes'
  | 'sprints' | 'energyLogs' | 'healthDays'
  | 'repeatCfgs' | 'counters' | 'counterDays' | 'dayReviews';

export interface Op {
  table: TableName;
  key: string;
  before: unknown | null;
  after: unknown | null; // null = delete
}

export async function applyOps(ops: Op[]): Promise<void> {
  if (ops.length === 0) return;
  const tables = [...new Set(ops.map((o) => o.table))];
  await db.transaction('rw', tables, async () => {
    for (const op of ops) {
      const table = db.table(op.table);
      if (op.after === null) await table.delete(op.key);
      else await table.put(op.after);
    }
  });
  noteOps(ops);
}

// ---------------------------------------------------------------- tasks ----

export type When =
  | { type: 'today' }
  | { type: 'morning' }
  | { type: 'afternoon' }
  | { type: 'evening' }
  | { type: 'date'; date: DateStr }
  | { type: 'someday' }
  | { type: 'anytime' }
  | { type: 'clear' };

export interface TaskDestination {
  bucket?: Bucket;
  projectId?: string | null;
  headingId?: string | null;
  areaId?: string | null;
}

export function newTask(partial: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: nanoid(),
    title: '',
    notes: '',
    status: 'open',
    completedAt: null,
    bucket: 'inbox',
    startDate: null,
    evening: false,
    deadline: null,
    priority: null,
    projectId: null,
    headingId: null,
    areaId: null,
    tagIds: [],
    checklist: [],
    orderKey: '',
    todayOrderKey: null,
    trashedAt: null,
    createdAt: now,
    modifiedAt: now,
    repeatRule: null,
    repeatTemplateId: null,
    reminderTime: null,
    mitDate: null,
    energy: null,
    timeEstimateMin: null,
    timeSpent: {},
    issueRef: null,
    startTime: null,
    durationMin: null,
    deadlineTime: null,
    alerts: null,
    alertsSentSig: null,
    ...partial,
  };
}

/** Tasks live in exactly one container; its members share an orderKey scope. */
async function containerTasks(t: Pick<Task, 'projectId' | 'headingId' | 'areaId' | 'bucket'>): Promise<Task[]> {
  let list: Task[];
  if (t.headingId) list = await db.tasks.where('headingId').equals(t.headingId).toArray();
  else if (t.projectId) {
    list = (await db.tasks.where('projectId').equals(t.projectId).toArray()).filter((x) => !x.headingId);
  } else if (t.areaId) list = await db.tasks.where('areaId').equals(t.areaId).toArray();
  else list = (await db.tasks.where('bucket').equals(t.bucket).toArray()).filter(
    (x) => !x.projectId && !x.areaId,
  );
  return list.filter((x) => x.trashedAt === null && x.status === 'open');
}

/** Inbox is mutually exclusive with having a home or a date. */
function normalizedBucket(t: Task): Bucket {
  if (t.bucket === 'inbox' && (t.projectId || t.areaId || t.startDate || t.headingId)) {
    return 'anytime';
  }
  return t.bucket;
}

export async function createTask(partial: Partial<Task> = {}): Promise<string> {
  const t = newTask(partial);
  t.bucket = normalizedBucket(t);
  if (!t.orderKey) t.orderKey = keyAtEnd(await containerTasks(t));
  await applyOps([{ table: 'tasks', key: t.id, before: null, after: t }]);
  return t.id;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const before = await db.tasks.get(id);
  if (!before) return;
  const after: Task = { ...before, ...patch, modifiedAt: Date.now() };
  after.bucket = normalizedBucket(after);
  await applyOps([{ table: 'tasks', key: id, before, after }]);
}

export async function setTaskWhen(id: string, when: When): Promise<void> {
  const today = todayStr();
  const patch: Partial<Task> =
    when.type === 'today' ? { startDate: today, evening: false, reminderTime: null }
    : when.type === 'morning' ? { startDate: today, evening: false, reminderTime: 'morning' }
    : when.type === 'afternoon' ? { startDate: today, evening: false, reminderTime: 'afternoon' }
    : when.type === 'evening' ? { startDate: today, evening: true, reminderTime: null }
    : when.type === 'date' ? { startDate: when.date, evening: false, reminderTime: null, bucket: 'anytime' }
    : when.type === 'someday' ? { startDate: null, evening: false, reminderTime: null, bucket: 'someday' }
    : when.type === 'anytime' ? { startDate: null, evening: false, reminderTime: null, bucket: 'anytime' }
    : { startDate: null, evening: false, reminderTime: null }; // clear
  if (when.type === 'today' || when.type === 'morning' || when.type === 'afternoon' || when.type === 'evening') {
    const t = await db.tasks.get(id);
    if (t && t.bucket !== 'anytime') patch.bucket = 'anytime';
  }
  // A time of day survives a change of *day* (Today, a date): "10 AM" still
  // means 10 AM. It goes when the to-do loses its day, or when a vague slot
  // (Morning/Afternoon/Tonight) is picked instead of an exact time.
  if (when.type !== 'today' && when.type !== 'date') patch.startTime = null;
  await updateTask(id, patch);
}

/** Put a to-do on the timeline: a day, a start time and a block length.
 *  `startTime: null` takes it off the grid but keeps its day. */
export async function setTaskTime(
  id: string,
  date: DateStr,
  startTime: string | null,
  durationMin?: number | null,
): Promise<void> {
  const t = await db.tasks.get(id);
  if (!t) return;
  const patch: Partial<Task> = { startDate: date, startTime };
  if (durationMin !== undefined) patch.durationMin = durationMin;
  // Timed means it has a day, so it can't stay in the Inbox or Someday; and
  // an exact time replaces Today's vague Morning/Afternoon/Tonight slot.
  if (startTime !== null) {
    if (t.bucket !== 'anytime') patch.bucket = 'anytime';
    patch.evening = false;
    if (t.reminderTime === 'morning' || t.reminderTime === 'afternoon') patch.reminderTime = null;
  }
  await updateTask(id, patch);
}

/** A to-do's own calendar alerts; null goes back to the default. */
export async function setTaskAlerts(id: string, alerts: TaskAlert[] | null): Promise<void> {
  await updateTask(id, { alerts });
}

/** Remember what was sent to the Calendar, per to-do (signature → state). */
export async function markAlertsSent(sigs: { id: string; sig: string }[]): Promise<void> {
  const ops: Op[] = [];
  for (const { id, sig } of sigs) {
    const before = await db.tasks.get(id);
    if (!before || before.alertsSentSig === sig) continue;
    // modifiedAt stays: being sent to Calendar isn't an edit of the to-do
    ops.push({ table: 'tasks', key: id, before, after: { ...before, alertsSentSig: sig } });
  }
  await applyOps(ops);
}

/** Several timeline changes as one write (a push or a shift moves many). */
export async function setTaskTimes(
  changes: { id: string; date: DateStr; startTime: string; durationMin: number }[],
): Promise<void> {
  const ops: Op[] = [];
  const now = Date.now();
  for (const c of changes) {
    const before = await db.tasks.get(c.id);
    if (!before) continue;
    const after: Task = {
      ...before,
      startDate: c.date,
      startTime: c.startTime,
      durationMin: c.durationMin,
      bucket: 'anytime',
      evening: false,
      reminderTime: before.reminderTime === 'morning' || before.reminderTime === 'afternoon' ? null : before.reminderTime,
      modifiedAt: now,
    };
    ops.push({ table: 'tasks', key: c.id, before, after });
  }
  await applyOps(ops);
}

/** `at` backdates the entry — the overdue prompt passes the day the user says
 *  they actually finished, which is what files it under that day's Logbook. */
export async function completeTask(id: string, canceled = false, at?: number): Promise<void> {
  const completedAt = at ?? Date.now();
  await updateTask(id, {
    status: canceled ? 'canceled' : 'completed',
    completedAt,
  });
  if (canceled) return;
  const t = await db.tasks.get(id);
  if (t) for (const hook of completionHooks) await hook(t, completedAt);
}

/** Features layered on top (repeating to-dos, the time tracker) react to a
 *  completion without this module importing them. */
type CompletionHook = (task: Task, completedAt: number) => Promise<void> | void;
const completionHooks: CompletionHook[] = [];
export function onTaskCompleted(hook: CompletionHook): () => void {
  completionHooks.push(hook);
  return () => {
    const i = completionHooks.indexOf(hook);
    if (i >= 0) completionHooks.splice(i, 1);
  };
}

/** Epoch ms to stamp for "this was finished on `date`". Today keeps the real
 *  clock time so ordering within today stays truthful; any other day lands at
 *  local noon — safely inside that calendar day whatever the timezone. */
export function completionTimeFor(date: DateStr, today: DateStr = todayStr()): number {
  if (date === today) return Date.now();
  const d = fromDateStr(date);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

export async function reopenTask(id: string): Promise<void> {
  await updateTask(id, { status: 'open', completedAt: null });
}

/** Trash timestamps double as cascade identity (restoreProject matches
 *  tasks by the project's stamp), so they must never collide — strictly
 *  monotonic even when calls land in the same millisecond. */
let lastTrashStamp = 0;
function trashStamp(): number {
  lastTrashStamp = Math.max(Date.now(), lastTrashStamp + 1);
  return lastTrashStamp;
}

export async function trashTask(id: string): Promise<void> {
  await updateTask(id, { trashedAt: trashStamp() });
}

export async function restoreTask(id: string): Promise<void> {
  await updateTask(id, { trashedAt: null });
}

export async function deleteTaskForever(id: string): Promise<void> {
  const before = await db.tasks.get(id);
  if (!before) return;
  await applyOps([{ table: 'tasks', key: id, before, after: null }]);
}

/** Move to a new container, placed last (or at the given orderKey). */
export async function moveTask(
  id: string,
  dest: TaskDestination,
  orderKey?: string,
): Promise<void> {
  const t = await db.tasks.get(id);
  if (!t) return;
  const patch: Partial<Task> = {
    projectId: dest.projectId !== undefined ? dest.projectId : null,
    headingId: dest.headingId !== undefined ? dest.headingId : null,
    areaId: dest.areaId !== undefined ? dest.areaId : null,
  };
  if (dest.bucket) patch.bucket = dest.bucket;
  else if (t.bucket === 'inbox' && (patch.projectId || patch.areaId)) patch.bucket = 'anytime';
  if (dest.bucket === 'inbox') {
    // Moving back to inbox clears dates and homes
    patch.projectId = null; patch.headingId = null; patch.areaId = null;
    patch.startDate = null; patch.evening = false; patch.startTime = null;
  }
  patch.orderKey = orderKey ?? keyAtEnd(await containerTasks({ ...t, ...patch } as Task));
  await updateTask(id, patch);
}

export async function setTaskOrder(id: string, orderKey: string): Promise<void> {
  await updateTask(id, { orderKey });
  await maybeRebalanceContainer(id);
}

/** Today/Evening have their own manual order. Unkeyed rows sort after keyed
 *  ones (see sortForToday); reordering stamps fresh keys for the section. */
export async function reorderToday(sectionIdsInNewOrder: string[]): Promise<void> {
  const keys = rebalancedKeys(sectionIdsInNewOrder.length);
  const ops: Op[] = [];
  const now = Date.now();
  for (let i = 0; i < sectionIdsInNewOrder.length; i++) {
    const before = await db.tasks.get(sectionIdsInNewOrder[i]!);
    if (!before) continue;
    ops.push({
      table: 'tasks', key: before.id, before,
      after: { ...before, todayOrderKey: keys[i]!, modifiedAt: now },
    });
  }
  await applyOps(ops);
}

async function maybeRebalanceContainer(taskId: string): Promise<void> {
  const t = await db.tasks.get(taskId);
  if (!t) return;
  const siblings = sortByOrderKey(await containerTasks(t));
  if (!needsRebalance(siblings)) return;
  const keys = rebalancedKeys(siblings.length);
  const now = Date.now();
  await applyOps(siblings.map((s, i) => ({
    table: 'tasks', key: s.id, before: s,
    after: { ...s, orderKey: keys[i]!, modifiedAt: now },
  })));
}

// ------------------------------------------------------------- projects ----

export function newProject(partial: Partial<Project> = {}): Project {
  const now = Date.now();
  return {
    id: nanoid(),
    title: '',
    notes: '',
    status: 'open',
    completedAt: null,
    areaId: null,
    deadline: null,
    tagIds: [],
    bucket: 'anytime',
    startDate: null,
    orderKey: '',
    trashedAt: null,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

async function siblingProjects(areaId: string | null): Promise<Project[]> {
  const all = await db.projects.toArray();
  return all.filter((p) => p.areaId === areaId && p.trashedAt === null && p.status === 'open');
}

export async function createProject(partial: Partial<Project> = {}): Promise<string> {
  const p = newProject(partial);
  if (!p.orderKey) p.orderKey = keyAtEnd(await siblingProjects(p.areaId));
  await applyOps([{ table: 'projects', key: p.id, before: null, after: p }]);
  return p.id;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const before = await db.projects.get(id);
  if (!before) return;
  const after: Project = { ...before, ...patch, modifiedAt: Date.now() };
  await applyOps([{ table: 'projects', key: id, before, after }]);
}

/** Completing a project completes its remaining open tasks too. */
export async function completeProject(id: string, canceled = false): Promise<void> {
  const p = await db.projects.get(id);
  if (!p) return;
  const now = Date.now();
  const status = canceled ? 'canceled' : 'completed';
  const ops: Op[] = [{
    table: 'projects', key: id, before: p,
    after: { ...p, status, completedAt: now, modifiedAt: now } satisfies Project,
  }];
  const tasks = await db.tasks.where('projectId').equals(id).toArray();
  for (const t of tasks) {
    if (t.status === 'open' && t.trashedAt === null) {
      ops.push({
        table: 'tasks', key: t.id, before: t,
        after: { ...t, status, completedAt: now, modifiedAt: now } satisfies Task,
      });
    }
  }
  await applyOps(ops);
}

export async function reopenProject(id: string): Promise<void> {
  await updateProject(id, { status: 'open', completedAt: null });
}

/** Trash cascades to the project's tasks with the SAME timestamp so restore
 *  brings back exactly the tasks that were trashed with it. */
export async function trashProject(id: string): Promise<void> {
  const p = await db.projects.get(id);
  if (!p) return;
  const now = trashStamp();
  const ops: Op[] = [{
    table: 'projects', key: id, before: p,
    after: { ...p, trashedAt: now, modifiedAt: now } satisfies Project,
  }];
  const tasks = await db.tasks.where('projectId').equals(id).toArray();
  for (const t of tasks) {
    if (t.trashedAt === null) {
      ops.push({
        table: 'tasks', key: t.id, before: t,
        after: { ...t, trashedAt: now, modifiedAt: now } satisfies Task,
      });
    }
  }
  await applyOps(ops);
}

export async function restoreProject(id: string): Promise<void> {
  const p = await db.projects.get(id);
  if (!p || p.trashedAt === null) return;
  const stamp = p.trashedAt;
  const now = Date.now();
  const ops: Op[] = [{
    table: 'projects', key: id, before: p,
    after: { ...p, trashedAt: null, modifiedAt: now } satisfies Project,
  }];
  const tasks = await db.tasks.where('projectId').equals(id).toArray();
  for (const t of tasks) {
    if (t.trashedAt === stamp) {
      ops.push({
        table: 'tasks', key: t.id, before: t,
        after: { ...t, trashedAt: null, modifiedAt: now } satisfies Task,
      });
    }
  }
  await applyOps(ops);
}

export async function emptyTrash(): Promise<void> {
  const ops: Op[] = [];
  const tasks = await db.tasks.toArray();
  for (const t of tasks) {
    if (t.trashedAt !== null) ops.push({ table: 'tasks', key: t.id, before: t, after: null });
  }
  const projects = await db.projects.toArray();
  const trashedProjects = new Set<string>();
  for (const p of projects) {
    if (p.trashedAt !== null) {
      trashedProjects.add(p.id);
      ops.push({ table: 'projects', key: p.id, before: p, after: null });
    }
  }
  const headings = await db.headings.toArray();
  for (const h of headings) {
    if (trashedProjects.has(h.projectId)) {
      ops.push({ table: 'headings', key: h.id, before: h, after: null });
    }
  }
  await applyOps(ops);
}

// ------------------------------------------------------------- headings ----

export async function createHeading(projectId: string, title: string): Promise<string> {
  const siblings = await db.headings.where('projectId').equals(projectId).toArray();
  const h: Heading = { id: nanoid(), projectId, title, orderKey: keyAtEnd(siblings) };
  await applyOps([{ table: 'headings', key: h.id, before: null, after: h }]);
  return h.id;
}

export async function updateHeading(id: string, patch: Partial<Heading>): Promise<void> {
  const before = await db.headings.get(id);
  if (!before) return;
  await applyOps([{ table: 'headings', key: id, before, after: { ...before, ...patch } }]);
}

/** Deleting a heading keeps its tasks, moved to the project's root section. */
export async function deleteHeading(id: string): Promise<void> {
  const before = await db.headings.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'headings', key: id, before, after: null }];
  const tasks = await db.tasks.where('headingId').equals(id).toArray();
  const now = Date.now();
  for (const t of tasks) {
    ops.push({
      table: 'tasks', key: t.id, before: t,
      after: { ...t, headingId: null, modifiedAt: now } satisfies Task,
    });
  }
  await applyOps(ops);
}

// ---------------------------------------------------------------- areas ----

export async function createArea(title: string): Promise<string> {
  const a: Area = { id: nanoid(), title, orderKey: keyAtEnd(await db.areas.toArray()) };
  await applyOps([{ table: 'areas', key: a.id, before: null, after: a }]);
  return a.id;
}

export async function updateArea(id: string, patch: Partial<Area>): Promise<void> {
  const before = await db.areas.get(id);
  if (!before) return;
  await applyOps([{ table: 'areas', key: id, before, after: { ...before, ...patch } }]);
}

/** Deleting an area keeps its projects and tasks, now standalone. */
export async function deleteArea(id: string): Promise<void> {
  const before = await db.areas.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'areas', key: id, before, after: null }];
  const now = Date.now();
  for (const p of await db.projects.where('areaId').equals(id).toArray()) {
    ops.push({
      table: 'projects', key: p.id, before: p,
      after: { ...p, areaId: null, modifiedAt: now } satisfies Project,
    });
  }
  for (const t of await db.tasks.where('areaId').equals(id).toArray()) {
    ops.push({
      table: 'tasks', key: t.id, before: t,
      after: { ...t, areaId: null, modifiedAt: now } satisfies Task,
    });
  }
  await applyOps(ops);
}

// ----------------------------------------------------------------- tags ----

export async function createTag(title: string): Promise<string> {
  const t: Tag = { id: nanoid(), title, orderKey: keyAtEnd(await db.tags.toArray()), parentId: null };
  await applyOps([{ table: 'tags', key: t.id, before: null, after: t }]);
  return t.id;
}

export async function updateTag(id: string, patch: Partial<Tag>): Promise<void> {
  const before = await db.tags.get(id);
  if (!before) return;
  await applyOps([{ table: 'tags', key: id, before, after: { ...before, ...patch } }]);
}

export async function deleteTag(id: string): Promise<void> {
  const before = await db.tags.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'tags', key: id, before, after: null }];
  const now = Date.now();
  for (const t of await db.tasks.where('tagIds').equals(id).toArray()) {
    ops.push({
      table: 'tasks', key: t.id, before: t,
      after: { ...t, tagIds: t.tagIds.filter((x) => x !== id), modifiedAt: now } satisfies Task,
    });
  }
  for (const p of await db.projects.where('tagIds').equals(id).toArray()) {
    ops.push({
      table: 'projects', key: p.id, before: p,
      after: { ...p, tagIds: p.tagIds.filter((x) => x !== id), modifiedAt: now } satisfies Project,
    });
  }
  await applyOps(ops);
}

// -------------------------------------------------------------- routine ----

export function newRoutineItem(partial: Partial<RoutineItem> = {}): RoutineItem {
  const now = Date.now();
  return {
    id: nanoid(),
    title: '',
    note: '',
    orderKey: '',
    active: true,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

export async function createRoutineItem(title: string): Promise<string> {
  const siblings = (await db.routineItems.toArray()).filter((i) => i.active);
  const item = newRoutineItem({ title, orderKey: keyAtEnd(siblings) });
  await applyOps([{ table: 'routineItems', key: item.id, before: null, after: item }]);
  return item.id;
}

/** Seed several items in one pass, preserving the given order. */
export async function createRoutineItems(titles: string[]): Promise<void> {
  const siblings = (await db.routineItems.toArray()).filter((i) => i.active);
  const ops: Op[] = [];
  let prev: string | null = sortByOrderKey(siblings).at(-1)?.orderKey ?? null;
  for (const title of titles) {
    prev = keyBetween(prev, null);
    const item = newRoutineItem({ title, orderKey: prev });
    ops.push({ table: 'routineItems', key: item.id, before: null, after: item });
  }
  await applyOps(ops);
}

export async function updateRoutineItem(id: string, patch: Partial<RoutineItem>): Promise<void> {
  const before = await db.routineItems.get(id);
  if (!before) return;
  const after: RoutineItem = { ...before, ...patch, modifiedAt: Date.now() };
  await applyOps([{ table: 'routineItems', key: id, before, after }]);
}

/** Retire an item: it leaves today's checklist but its history stays intact,
 *  so past streaks keep their meaning. */
export async function archiveRoutineItem(id: string): Promise<void> {
  await updateRoutineItem(id, { active: false });
}

/** Remove an item and every tick it ever recorded. */
export async function deleteRoutineItem(id: string): Promise<void> {
  const before = await db.routineItems.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'routineItems', key: id, before, after: null }];
  for (const log of await db.routineLogs.where('itemId').equals(id).toArray()) {
    ops.push({ table: 'routineLogs', key: log.id, before: log, after: null });
  }
  await applyOps(ops);
}

export async function reorderRoutineItems(idsInNewOrder: string[]): Promise<void> {
  const keys = rebalancedKeys(idsInNewOrder.length);
  const ops: Op[] = [];
  const now = Date.now();
  for (let i = 0; i < idsInNewOrder.length; i++) {
    const before = await db.routineItems.get(idsInNewOrder[i]!);
    if (!before) continue;
    ops.push({
      table: 'routineItems', key: before.id, before,
      after: { ...before, orderKey: keys[i]!, modifiedAt: now } satisfies RoutineItem,
    });
  }
  await applyOps(ops);
}

/** Tick or untick one item for one day. Idempotent: the row id is the pair. */
export async function setRoutineDone(
  itemId: string,
  date: DateStr,
  done: boolean,
): Promise<void> {
  const key = logId(date, itemId);
  const before = (await db.routineLogs.get(key)) ?? null;
  if (done) {
    if (before) return;
    const after: RoutineLog = { id: key, date, itemId, completedAt: Date.now() };
    await applyOps([{ table: 'routineLogs', key, before: null, after }]);
  } else {
    if (!before) return;
    await applyOps([{ table: 'routineLogs', key, before, after: null }]);
  }
}

// -------------------------------------------------------- daily target ----

/** Write (or rewrite) the target for a day. Keyed by date, so setting it twice
 *  in one morning replaces rather than duplicates. Rewriting the text of an
 *  already-judged day keeps its verdict — you're fixing a typo, not reopening
 *  the question. */
export async function setDailyTarget(
  date: DateStr,
  text: string,
  taskId: string | null = null,
): Promise<void> {
  const before = (await db.dailyTargets.get(date)) ?? null;
  const after: DailyTarget = {
    date,
    text,
    taskId,
    outcome: before?.outcome ?? 'pending',
    reflection: before?.reflection ?? '',
    setAt: before?.setAt ?? Date.now(),
    reviewedAt: before?.reviewedAt ?? null,
  };
  await applyOps([{ table: 'dailyTargets', key: date, before, after }]);
}

/** Record the night's verdict. Passing 'pending' un-judges the day, which is
 *  how you take back a verdict you gave too early. */
export async function reviewDailyTarget(
  date: DateStr,
  outcome: TargetOutcome,
  reflection?: string,
): Promise<void> {
  const before = await db.dailyTargets.get(date);
  if (!before) return;
  const after: DailyTarget = {
    ...before,
    outcome,
    reflection: reflection ?? before.reflection,
    reviewedAt: outcome === 'pending' ? null : Date.now(),
  };
  await applyOps([{ table: 'dailyTargets', key: date, before, after }]);
}

/** Attach or detach the to-do that carries the target. */
export async function linkTargetTask(date: DateStr, taskId: string | null): Promise<void> {
  const before = await db.dailyTargets.get(date);
  if (!before) return;
  await applyOps([{ table: 'dailyTargets', key: date, before, after: { ...before, taskId } }]);
}

export async function clearDailyTarget(date: DateStr): Promise<void> {
  const before = await db.dailyTargets.get(date);
  if (!before) return;
  await applyOps([{ table: 'dailyTargets', key: date, before, after: null }]);
}

// ------------------------------------------------------------- settings ----

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export { keyBetween };

// ------------------------------------------------------ focus framework ----

export type MitResult = 'added' | 'removed' | 'limit';

/** Toggle "Most Important Task" for today. Picking an MIT also puts it in
 *  Today; the 1–3 cap is enforced here so every entry point respects it. */
export async function toggleMit(id: string, today = todayStr(), limit = 3): Promise<MitResult> {
  const t = await db.tasks.get(id);
  if (!t) return 'removed';
  if (t.mitDate === today) {
    await updateTask(id, { mitDate: null });
    return 'removed';
  }
  const open = (await db.tasks.toArray()).filter(
    (x) => x.mitDate === today && x.status === 'open' && x.trashedAt === null && x.id !== id,
  ).length;
  if (open >= limit) return 'limit';
  const patch: Partial<Task> = { mitDate: today };
  if (!t.startDate || t.startDate > today) {
    patch.startDate = today;
    if (t.bucket !== 'anytime') patch.bucket = 'anytime';
  }
  await updateTask(id, patch);
  return 'added';
}

export async function setTaskEnergy(id: string, energy: Task['energy']): Promise<void> {
  await updateTask(id, { energy });
}

export async function createSprint(partial: Partial<Sprint>): Promise<string> {
  const s: Sprint = {
    id: nanoid(),
    taskId: null,
    title: '',
    nextAction: '',
    durationMin: 45,
    date: todayStr(),
    plannedAt: null,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    status: 'planned',
    completedNote: '',
    createdAt: Date.now(),
    ...partial,
  };
  await applyOps([{ table: 'sprints', key: s.id, before: null, after: s }]);
  return s.id;
}

export async function updateSprint(id: string, patch: Partial<Sprint>): Promise<void> {
  const before = await db.sprints.get(id);
  if (!before) return;
  await applyOps([{ table: 'sprints', key: id, before, after: { ...before, ...patch } }]);
}

export async function deleteSprint(id: string): Promise<void> {
  const before = await db.sprints.get(id);
  if (!before) return;
  await applyOps([{ table: 'sprints', key: id, before, after: null }]);
}

/** Start the visible timer (only one sprint runs at a time). */
export async function startSprint(id: string, now = Date.now()): Promise<void> {
  const s = await db.sprints.get(id);
  if (!s) return;
  const running = await db.sprints.where('status').equals('running').toArray();
  for (const r of running) {
    if (r.id !== id) await updateSprint(r.id, { status: 'abandoned', endedAt: now });
  }
  await updateSprint(id, {
    status: 'running',
    startedAt: now,
    endsAt: now + s.durationMin * 60_000,
    date: todayStr(),
  });
}

/** Close the loop: record the outcome; the next action becomes the first
 *  unchecked checklist item of the to-do so tomorrow starts concrete. */
export async function finishSprint(
  id: string,
  outcome: { note: string; nextAction: string; completeTask: boolean },
  now = Date.now(),
): Promise<void> {
  const s = await db.sprints.get(id);
  if (!s) return;
  await updateSprint(id, {
    status: 'done',
    endedAt: Math.min(now, s.endsAt ?? now),
    completedNote: outcome.note.trim(),
  });
  if (!s.taskId) return;
  const t = await db.tasks.get(s.taskId);
  if (!t) return;
  if (outcome.completeTask) {
    await completeTask(t.id);
    return;
  }
  const next = outcome.nextAction.trim();
  if (next && !t.checklist.some((c) => !c.completed && c.title === next)) {
    await updateTask(t.id, {
      checklist: [{ id: nanoid(), title: next, completed: false }, ...t.checklist],
    });
  }
}

export async function logEnergy(level: number, at = new Date()): Promise<string> {
  const log: EnergyLog = {
    id: nanoid(),
    at: at.getTime(),
    date: toDateStr(at),
    minuteOfDay: at.getHours() * 60 + at.getMinutes(),
    level: Math.min(5, Math.max(1, Math.round(level))),
  };
  await applyOps([{ table: 'energyLogs', key: log.id, before: null, after: log }]);
  return log.id;
}

export async function deleteEnergyLog(id: string): Promise<void> {
  const before = await db.energyLogs.get(id);
  if (!before) return;
  await applyOps([{ table: 'energyLogs', key: id, before, after: null }]);
}

// ------------------------------------------------- sprint editing ---------

/** Change a running sprint mid-flight: switch task, rewrite the next action,
 *  or set how many minutes are left. The planned length follows. */
export async function editRunningSprint(
  id: string,
  patch: { taskId?: string | null; title?: string; nextAction?: string; remainingMin?: number },
  now = Date.now(),
): Promise<void> {
  const s = await db.sprints.get(id);
  if (!s) return;
  const next: Partial<Sprint> = {};
  if (patch.taskId !== undefined) next.taskId = patch.taskId;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.nextAction !== undefined) next.nextAction = patch.nextAction;
  if (patch.remainingMin !== undefined && s.startedAt !== null) {
    const endsAt = now + Math.max(1, Math.round(patch.remainingMin)) * 60_000;
    next.endsAt = endsAt;
    next.durationMin = Math.max(1, Math.round((endsAt - s.startedAt) / 60_000));
  }
  await updateSprint(id, next);
}

/** Fix a finished sprint in the log: when it started, how long you actually
 *  focused, what it was, what you got done. Keeps "minutes focused" honest. */
export async function editSprintRecord(
  id: string,
  patch: { startedAt?: number; minutes?: number; taskId?: string | null; title?: string; completedNote?: string },
): Promise<void> {
  const s = await db.sprints.get(id);
  if (!s) return;
  const startedAt = patch.startedAt ?? s.startedAt ?? s.createdAt;
  const minutes = Math.max(1, Math.round(
    patch.minutes ?? (s.endedAt !== null && s.startedAt !== null ? (s.endedAt - s.startedAt) / 60_000 : s.durationMin),
  ));
  const endedAt = startedAt + minutes * 60_000;
  await updateSprint(id, {
    startedAt,
    endedAt,
    endsAt: endedAt,
    durationMin: minutes,
    date: toDateStr(new Date(startedAt)),
    ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.completedNote !== undefined ? { completedNote: patch.completedNote } : {}),
  });
}

// ------------------------------------------------------------- health -----

/** Upsert one day of Apple Watch data. Sleep replaces; rings from the
 *  Shortcut merge upward (they only grow during a day), typed rings replace. */
export async function saveHealth(
  date: DateStr,
  data: { sleep?: SleepNight | null; activity?: ActivityDay | null },
  source: 'shortcut' | 'manual',
  merge: (prev: ActivityDay | null, next: ActivityDay) => ActivityDay = (_p, n) => n,
): Promise<void> {
  const before = (await db.healthDays.get(date)) ?? null;
  const after: HealthDay = {
    date,
    sleep: data.sleep !== undefined ? data.sleep : before?.sleep ?? null,
    activity: data.activity === undefined
      ? before?.activity ?? null
      : data.activity === null ? null
      : source === 'shortcut' ? merge(before?.activity ?? null, data.activity) : data.activity,
    source,
    updatedAt: Date.now(),
  };
  await applyOps([{ table: 'healthDays', key: date, before, after }]);
}

export async function deleteHealthDay(date: DateStr): Promise<void> {
  const before = await db.healthDays.get(date);
  if (!before) return;
  await applyOps([{ table: 'healthDays', key: date, before, after: null }]);
}
