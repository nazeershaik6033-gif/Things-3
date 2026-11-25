import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import { completeTask, createHeading, createProject, createTask, newTask } from '../../src/db/mutations';
import {
  bulkPatch, createProjectFromTemplate, createSavedView, saveDayNote, saveProjectAsTemplate, setStage, toggleBlocker,
} from '../../src/db/workflowMutations';
import {
  applyView, canDoNow, columnPatch, emptyFilter, isBlocked, kanbanColumns, unlockedBy, waitingOn, weekKey,
  weekReview, wouldCycle,
} from '../../src/domain/workflow';
import { exportData, importData } from '../../src/db/exportImport';
import type { Task } from '../../src/db/models';

const TODAY = '2026-11-25';
const t = (p: Partial<Task>) => newTask({ bucket: 'anytime', ...p });

beforeEach(async () => {
  await Promise.all(db.tables.map((x) => x.clear()));
});

describe('dependencies', () => {
  it('blocks while a blocker is open, and only then', () => {
    const a = t({ id: 'a' });
    const b = t({ id: 'b', blockedBy: ['a'] });
    const byId = new Map([a, b].map((x) => [x.id, x]));
    expect(isBlocked(b, byId)).toBe(true);
    expect(isBlocked(b, new Map([['a', { ...a, status: 'completed' as const }], ['b', b]]))).toBe(false);
    expect(isBlocked(b, new Map([['a', { ...a, trashedAt: 1 }], ['b', b]]))).toBe(false);
    expect(isBlocked({ ...b, blockedBy: ['gone'] }, byId)).toBe(false);
    expect(waitingOn('a', [a, b]).map((x) => x.id)).toEqual(['b']);
  });

  it('finds what finishing a to-do unlocks', () => {
    const tasks = [t({ id: 'a' }), t({ id: 'c' }), t({ id: 'b', blockedBy: ['a'] }), t({ id: 'd', blockedBy: ['a', 'c'] })];
    expect(unlockedBy('a', tasks).map((x) => x.id)).toEqual(['b']);
  });

  it('refuses loops', () => {
    const byId = new Map([t({ id: 'a', blockedBy: ['b'] }), t({ id: 'b', blockedBy: ['c'] }), t({ id: 'c' })].map((x) => [x.id, x]));
    expect(wouldCycle('c', 'a', byId)).toBe(true);
    expect(wouldCycle('a', 'c', byId)).toBe(false);
    expect(wouldCycle('a', 'a', byId)).toBe(true);
  });

  it('Can do now leaves out blocked, waiting, inbox, someday and future to-dos', () => {
    const tasks = [
      t({ id: 'ok' }),
      t({ id: 'today', startDate: TODAY }),
      t({ id: 'blocked', blockedBy: ['ok'] }),
      t({ id: 'waiting', stage: 'waiting' }),
      t({ id: 'doing', stage: 'doing' }),
      t({ id: 'inbox', bucket: 'inbox' }),
      t({ id: 'someday', bucket: 'someday' }),
      t({ id: 'later', startDate: '2026-12-01' }),
      t({ id: 'done', status: 'completed' }),
    ];
    expect(canDoNow(tasks, TODAY).map((x) => x.id)).toEqual(['ok', 'today', 'doing']);
  });

  it('toggleBlocker adds, removes and refuses a cycle', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });
    expect(await toggleBlocker(b, a)).toBe('added');
    expect((await db.tasks.get(b))!.blockedBy).toEqual([a]);
    expect(await toggleBlocker(a, b)).toBe('cycle');
    expect(await toggleBlocker(b, a)).toBe('removed');
  });
});

describe('kanban', () => {
  it('groups by stage, quadrant or heading, and moves with a patch', () => {
    const tasks = [t({ id: 'x', orderKey: 'a1' }), t({ id: 'y', stage: 'doing', priority: 'do', orderKey: 'a0' }), t({ id: 'z', stage: 'waiting', headingId: 'h1' })];
    expect(kanbanColumns(tasks, 'stage').map((c) => [c.id, c.tasks.map((x) => x.id)])).toEqual([
      ['todo', ['x']], ['doing', ['y']], ['waiting', ['z']],
    ]);
    expect(kanbanColumns(tasks, 'quadrant').find((c) => c.id === 'do')!.tasks.map((x) => x.id)).toEqual(['y']);
    const byHeading = kanbanColumns(tasks, 'heading', [{ id: 'h1', projectId: 'p', title: 'Build', orderKey: 'a0' }]);
    expect(byHeading.map((c) => c.title)).toEqual(['No heading', 'Build']);
    expect(columnPatch('stage', 'todo')).toEqual({ stage: null });
    expect(columnPatch('quadrant', 'none')).toEqual({ priority: null });
    expect(columnPatch('heading', 'root')).toEqual({ headingId: null });
  });

  it('setStage writes the stage', async () => {
    const id = await createTask({ title: 'A' });
    await setStage(id, 'doing');
    expect((await db.tasks.get(id))!.stage).toBe('doing');
  });
});

describe('saved views', () => {
  it('applies every set condition', () => {
    const tasks = [
      t({ id: 'a', tagIds: ['w'], deadline: '2026-11-27', priority: 'do' }),
      t({ id: 'b', tagIds: ['w'], projectId: 'p1' }),
      t({ id: 'c', tagIds: ['w', 'x'], stage: 'doing', energy: 'high' }),
      t({ id: 'd', bucket: 'someday', title: 'Learn piano' }),
    ];
    const projects = [{ id: 'p1', areaId: 'ar' } as never];
    const f = emptyFilter();
    expect(applyView(tasks, { ...f, tagIds: ['w'] }, projects, TODAY).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(applyView(tasks, { ...f, dueWithinDays: 3 }, projects, TODAY).map((x) => x.id)).toEqual(['a']);
    expect(applyView(tasks, { ...f, home: 'a:ar' }, projects, TODAY).map((x) => x.id)).toEqual(['b']);
    expect(applyView(tasks, { ...f, stages: ['doing'], energy: 'high' }, projects, TODAY).map((x) => x.id)).toEqual(['c']);
    expect(applyView(tasks, { ...f, when: 'someday', search: 'piano' }, projects, TODAY).map((x) => x.id)).toEqual(['d']);
    expect(applyView(tasks, { ...f, quadrants: ['do'] }, projects, TODAY).map((x) => x.id)).toEqual(['a']);
  });

  it('saves a view', async () => {
    const id = await createSavedView('Work', { ...emptyFilter(), tagIds: ['w'] });
    expect((await db.savedViews.get(id))!.filter.tagIds).toEqual(['w']);
  });
});

describe('templates', () => {
  it('round-trips a project with headings and dependencies into a new one', async () => {
    const p = await createProject({ title: 'Ship a feature' });
    const h = await createHeading(p, 'Build');
    const spec = await createTask({ title: 'Write spec', projectId: p, checklist: [{ id: 'c', title: 'Goals', completed: true }], startDate: TODAY });
    const code = await createTask({ title: 'Code it', projectId: p, headingId: h });
    await toggleBlocker(code, spec);
    await completeTask(spec);
    const tid = (await saveProjectAsTemplate(p))!;
    const np = (await createProjectFromTemplate(tid))!;
    const tasks = await db.tasks.where('projectId').equals(np).toArray();
    const newSpec = tasks.find((x) => x.title === 'Write spec')!;
    const newCode = tasks.find((x) => x.title === 'Code it')!;
    expect(newSpec).toMatchObject({ status: 'open', startDate: null, checklist: [{ title: 'Goals', completed: false }] });
    expect(newCode.blockedBy).toEqual([newSpec.id]);
    const heads = await db.headings.where('projectId').equals(np).toArray();
    expect(heads.map((x) => x.title)).toEqual(['Build']);
    expect(newCode.headingId).toBe(heads[0]!.id);
  });
});

describe('notes, review, bulk, backup', () => {
  it('saves and deletes notes', async () => {
    await saveDayNote(TODAY, 'Shipped the planner');
    expect((await db.dayNotes.get(TODAY))!.text).toBe('Shipped the planner');
    await saveDayNote(TODAY, '  ');
    expect(await db.dayNotes.get(TODAY)).toBeUndefined();
  });

  it('keys weeks by ISO week', () => {
    expect(weekKey('2026-11-25')).toBe('2026-W48');
    expect(weekKey('2027-01-01')).toBe('2026-W53');
    expect(weekKey('2024-12-30')).toBe('2025-W01');
  });

  it('weekly review lists', () => {
    const now = new Date(`${TODAY}T12:00:00`).getTime();
    const r = weekReview([
      t({ id: 'done', status: 'completed', completedAt: now - 86_400_000, projectId: 'p1' }),
      t({ id: 'late', deadline: '2026-11-20' }),
      t({ id: 'in', bucket: 'inbox' }),
      t({ id: 'w', stage: 'waiting', projectId: 'p2' }),
      t({ id: 'soon', startDate: '2026-11-28' }),
    ], [
      { id: 'p1', status: 'open', trashedAt: null, bucket: 'anytime' } as never,
      { id: 'p2', status: 'open', trashedAt: null, bucket: 'anytime' } as never,
    ], TODAY);
    expect(r.done.map((x) => x.id)).toEqual(['done']);
    expect(r.overdue.map((x) => x.id)).toEqual(['late']);
    expect(r.inbox).toBe(1);
    expect(r.waiting.map((x) => x.id)).toEqual(['w']);
    expect(r.stuckProjects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(r.comingUp.map((x) => x.id)).toEqual(['soon']);
  });

  it('bulk patch and the v12 backup round-trip', async () => {
    const a = await createTask({ title: 'A' });
    const b = await createTask({ title: 'B' });
    await bulkPatch([a, b], { stage: 'doing' });
    await saveDayNote('2026-W48', 'Good week');
    const file = await exportData();
    expect(file.schemaVersion).toBe(12);
    await importData(file);
    expect((await db.tasks.get(b))!.stage).toBe('doing');
    expect((await db.dayNotes.get('2026-W48'))!.text).toBe('Good week');
    const old = JSON.parse(JSON.stringify(file));
    for (const x of old.data.tasks) { delete x.stage; delete x.blockedBy; }
    delete old.data.dayNotes;
    await importData(old);
    expect((await db.tasks.get(a))!).toMatchObject({ stage: null, blockedBy: [] });
  });
});
