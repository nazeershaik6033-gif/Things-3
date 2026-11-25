import { nanoid } from 'nanoid';
import { db } from './db';
import type {
  DayNote, ProjectTemplate, SavedView, Task, TaskStage, ViewFilter,
} from './models';
import {
  applyOps, completeTask, createHeading, createProject, newTask, setTaskWhen, trashTask, updateTask,
  type Op, type When,
} from './mutations';
import { keyAtEnd, rebalancedKeys } from './ordering';
import { templateFromProject, wouldCycle } from '../domain/workflow';

/** Writes for Kanban stages, dependencies, notes, saved views, templates and
 *  bulk edits. Same rule as everywhere: through applyOps, so undo works. */

// ---------------------------------------------------------------- stages --

export async function setStage(id: string, stage: TaskStage | null): Promise<void> {
  await updateTask(id, { stage });
}

// ---------------------------------------------------------- dependencies --

/** Make `id` wait for `blockerId`, or stop waiting. Refuses a loop. */
export async function toggleBlocker(id: string, blockerId: string): Promise<'added' | 'removed' | 'cycle'> {
  const t = await db.tasks.get(id);
  if (!t) return 'removed';
  const list = t.blockedBy ?? [];
  if (list.includes(blockerId)) {
    await updateTask(id, { blockedBy: list.filter((x) => x !== blockerId) });
    return 'removed';
  }
  const byId = new Map((await db.tasks.toArray()).map((x) => [x.id, x]));
  if (wouldCycle(id, blockerId, byId)) return 'cycle';
  await updateTask(id, { blockedBy: [...list, blockerId] });
  return 'added';
}

// ----------------------------------------------------------------- notes --

/** A day ("2026-11-25") or week ("2026-W48") note. Empty text deletes it. */
export async function saveDayNote(key: string, text: string): Promise<void> {
  const before = (await db.dayNotes.get(key)) ?? null;
  const after: DayNote | null = text.trim() ? { key, text, updatedAt: Date.now() } : null;
  if (!before && !after) return;
  await applyOps([{ table: 'dayNotes', key, before, after }]);
}

// ----------------------------------------------------------- saved views --

export async function createSavedView(title: string, filter: ViewFilter, groupBy: SavedView['groupBy'] = 'home'): Promise<string> {
  const all = await db.savedViews.toArray();
  const v: SavedView = {
    id: nanoid(), title: title.trim() || 'New View', filter, groupBy, orderKey: keyAtEnd(all), createdAt: Date.now(),
  };
  await applyOps([{ table: 'savedViews', key: v.id, before: null, after: v }]);
  return v.id;
}

export async function updateSavedView(id: string, patch: Partial<SavedView>): Promise<void> {
  const before = await db.savedViews.get(id);
  if (!before) return;
  await applyOps([{ table: 'savedViews', key: id, before, after: { ...before, ...patch } }]);
}

export async function deleteSavedView(id: string): Promise<void> {
  const before = await db.savedViews.get(id);
  if (before) await applyOps([{ table: 'savedViews', key: id, before, after: null }]);
}

// ------------------------------------------------------------- templates --

export async function saveProjectAsTemplate(projectId: string): Promise<string | null> {
  const p = await db.projects.get(projectId);
  if (!p) return null;
  const headings = await db.headings.where('projectId').equals(projectId).toArray();
  const tasks = await db.tasks.where('projectId').equals(projectId).toArray();
  const t: ProjectTemplate = { id: nanoid(), createdAt: Date.now(), ...templateFromProject(p, headings, tasks) };
  await applyOps([{ table: 'templates', key: t.id, before: null, after: t }]);
  return t.id;
}

export async function deleteTemplate(id: string): Promise<void> {
  const before = await db.templates.get(id);
  if (before) await applyOps([{ table: 'templates', key: id, before, after: null }]);
}

/** A fresh project from a template: its headings and to-dos (open, undated),
 *  with dependencies re-linked to the new to-dos. */
export async function createProjectFromTemplate(templateId: string, areaId: string | null = null): Promise<string | null> {
  const tp = await db.templates.get(templateId);
  if (!tp) return null;
  const projectId = await createProject({ title: tp.title, notes: tp.notes, areaId });
  const headingIds: string[] = [];
  for (const h of tp.headings) headingIds.push(await createHeading(projectId, h));
  const ids = tp.tasks.map(() => nanoid());
  const keys = rebalancedKeys(tp.tasks.length);
  const now = Date.now();
  const ops: Op[] = tp.tasks.map((x, i) => {
    const t: Task = newTask({
      id: ids[i]!,
      title: x.title,
      notes: x.notes,
      checklist: x.checklist.map((title) => ({ id: nanoid(), title, completed: false })),
      tagIds: [...x.tagIds],
      timeEstimateMin: x.timeEstimateMin,
      projectId,
      headingId: x.heading !== null ? (headingIds[x.heading] ?? null) : null,
      bucket: 'anytime',
      orderKey: keys[i]!,
      blockedBy: x.waitsFor.map((j) => ids[j]).filter((id): id is string => !!id),
      createdAt: now,
      modifiedAt: now,
    });
    return { table: 'tasks', key: t.id, before: null, after: t };
  });
  await applyOps(ops);
  return projectId;
}

// ------------------------------------------------------------ bulk edits --

export async function bulkComplete(ids: string[]): Promise<void> {
  for (const id of ids) await completeTask(id);
}

export async function bulkWhen(ids: string[], when: When): Promise<void> {
  for (const id of ids) await setTaskWhen(id, when);
}

export async function bulkTrash(ids: string[]): Promise<void> {
  for (const id of ids) await trashTask(id);
}

export async function bulkPatch(ids: string[], patch: Partial<Task>): Promise<void> {
  const ops: Op[] = [];
  const now = Date.now();
  for (const id of ids) {
    const before = await db.tasks.get(id);
    if (before) ops.push({ table: 'tasks', key: id, before, after: { ...before, ...patch, modifiedAt: now } });
  }
  await applyOps(ops);
}
