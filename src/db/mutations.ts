import { nanoid } from 'nanoid';
import { db } from './db';
import type { Task, Project, Heading, Area, Tag, Bucket, DateStr } from './models';
import { keyAtEnd, keyBetween, sortByOrderKey, needsRebalance, rebalancedKeys } from './ordering';
import { todayStr } from '../domain/dates';

/** Every write flows through this module. Ops carry before/after images so an
 *  undo ring buffer can be layered on later (iteration 2) without rewrites. */

type TableName = 'tasks' | 'projects' | 'headings' | 'areas' | 'tags' | 'settings' | 'calendarEvents';

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
  await updateTask(id, patch);
}

export async function completeTask(id: string, canceled = false): Promise<void> {
  await updateTask(id, {
    status: canceled ? 'canceled' : 'completed',
    completedAt: Date.now(),
  });
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
    patch.startDate = null; patch.evening = false;
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

// ------------------------------------------------------------- settings ----

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export { keyBetween };
