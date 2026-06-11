import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  createTask, updateTask, setTaskWhen, completeTask, reopenTask,
  trashTask, restoreTask, deleteTaskForever, moveTask, reorderToday,
  createProject, completeProject, trashProject, restoreProject, emptyTrash,
  createHeading, deleteHeading, createArea, deleteArea, createTag, deleteTag,
  setTaskOrder,
} from '../../src/db/mutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import { todayStr } from '../../src/domain/dates';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('createTask', () => {
  it('defaults to inbox with an orderKey', async () => {
    const id = await createTask({ title: 'Buy milk' });
    const t = (await db.tasks.get(id))!;
    expect(t.bucket).toBe('inbox');
    expect(t.orderKey).toBeTruthy();
    expect(t.status).toBe('open');
  });

  it('appends within the container in creation order', async () => {
    const a = await createTask({ title: 'a' });
    const b = await createTask({ title: 'b' });
    const ta = (await db.tasks.get(a))!;
    const tb = (await db.tasks.get(b))!;
    expect(ta.orderKey < tb.orderKey).toBe(true);
  });

  it('normalizes inbox→anytime when created with a home or date', async () => {
    const pid = await createProject({ title: 'P' });
    const inProject = (await db.tasks.get(await createTask({ projectId: pid })))!;
    expect(inProject.bucket).toBe('anytime');
    const dated = (await db.tasks.get(await createTask({ startDate: '2026-07-01' })))!;
    expect(dated.bucket).toBe('anytime');
  });
});

describe('setTaskWhen', () => {
  it('today / evening set start date and leave inbox', async () => {
    const id = await createTask({});
    await setTaskWhen(id, { type: 'today' });
    let t = (await db.tasks.get(id))!;
    expect(t.startDate).toBe(todayStr());
    expect(t.evening).toBe(false);
    expect(t.bucket).toBe('anytime');

    await setTaskWhen(id, { type: 'evening' });
    t = (await db.tasks.get(id))!;
    expect(t.evening).toBe(true);
    expect(t.startDate).toBe(todayStr());
  });

  it('someday clears the date; anytime clears someday', async () => {
    const id = await createTask({ startDate: '2026-07-01' });
    await setTaskWhen(id, { type: 'someday' });
    let t = (await db.tasks.get(id))!;
    expect(t.bucket).toBe('someday');
    expect(t.startDate).toBeNull();

    await setTaskWhen(id, { type: 'anytime' });
    t = (await db.tasks.get(id))!;
    expect(t.bucket).toBe('anytime');
  });

  it('clear removes the date but keeps inbox tasks in the inbox', async () => {
    const id = await createTask({});
    await setTaskWhen(id, { type: 'clear' });
    expect((await db.tasks.get(id))!.bucket).toBe('inbox');
  });

  it('date moves an inbox task out', async () => {
    const id = await createTask({});
    await setTaskWhen(id, { type: 'date', date: '2026-12-24' });
    const t = (await db.tasks.get(id))!;
    expect(t.startDate).toBe('2026-12-24');
    expect(t.bucket).toBe('anytime');
  });
});

describe('complete / reopen / trash', () => {
  it('completeTask stamps completedAt; reopen clears it', async () => {
    const id = await createTask({});
    await completeTask(id);
    let t = (await db.tasks.get(id))!;
    expect(t.status).toBe('completed');
    expect(t.completedAt).not.toBeNull();
    await reopenTask(id);
    t = (await db.tasks.get(id))!;
    expect(t.status).toBe('open');
    expect(t.completedAt).toBeNull();
  });

  it('cancel marks canceled', async () => {
    const id = await createTask({});
    await completeTask(id, true);
    expect((await db.tasks.get(id))!.status).toBe('canceled');
  });

  it('trash, restore, delete forever', async () => {
    const id = await createTask({});
    await trashTask(id);
    expect((await db.tasks.get(id))!.trashedAt).not.toBeNull();
    await restoreTask(id);
    expect((await db.tasks.get(id))!.trashedAt).toBeNull();
    await deleteTaskForever(id);
    expect(await db.tasks.get(id)).toBeUndefined();
  });
});

describe('moveTask', () => {
  it('moves into a project heading and appends at the end', async () => {
    const pid = await createProject({ title: 'P' });
    const hid = await createHeading(pid, 'H');
    const existing = await createTask({ projectId: pid, headingId: hid });
    const id = await createTask({});
    await moveTask(id, { projectId: pid, headingId: hid });
    const t = (await db.tasks.get(id))!;
    expect(t.projectId).toBe(pid);
    expect(t.headingId).toBe(hid);
    expect(t.bucket).toBe('anytime');
    expect(t.orderKey > (await db.tasks.get(existing))!.orderKey).toBe(true);
  });

  it('moving back to inbox clears home and dates', async () => {
    const pid = await createProject({ title: 'P' });
    const id = await createTask({ projectId: pid, startDate: '2026-07-01' });
    await moveTask(id, { bucket: 'inbox' });
    const t = (await db.tasks.get(id))!;
    expect(t.bucket).toBe('inbox');
    expect(t.projectId).toBeNull();
    expect(t.startDate).toBeNull();
  });
});

describe('today reordering', () => {
  it('stamps fresh todayOrderKeys in the given order', async () => {
    const a = await createTask({ startDate: todayStr(), bucket: 'anytime' });
    const b = await createTask({ startDate: todayStr(), bucket: 'anytime' });
    const c = await createTask({ startDate: todayStr(), bucket: 'anytime' });
    await reorderToday([c, a, b]);
    const [ta, tb, tc] = await Promise.all([db.tasks.get(a), db.tasks.get(b), db.tasks.get(c)]);
    expect(tc!.todayOrderKey! < ta!.todayOrderKey!).toBe(true);
    expect(ta!.todayOrderKey! < tb!.todayOrderKey!).toBe(true);
  });
});

describe('rebalancing', () => {
  it('setTaskOrder triggers rebalance when keys get long', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await createTask({ title: `t${i}` }));
    // Force a pathological key directly
    await updateTask(ids[0]!, { orderKey: 'a'.repeat(60) });
    await setTaskOrder(ids[1]!, 'a'.repeat(61));
    const all = await db.tasks.toArray();
    expect(all.every((t) => t.orderKey.length <= 40)).toBe(true);
  });
});

describe('projects', () => {
  it('completing a project completes its open tasks', async () => {
    const pid = await createProject({ title: 'P' });
    const t1 = await createTask({ projectId: pid });
    const t2 = await createTask({ projectId: pid });
    await completeTask(t1, true); // already canceled — must stay canceled
    await completeProject(pid);
    expect((await db.projects.get(pid))!.status).toBe('completed');
    expect((await db.tasks.get(t1))!.status).toBe('canceled');
    expect((await db.tasks.get(t2))!.status).toBe('completed');
  });

  it('trash cascades; restore brings back exactly the cascaded tasks', async () => {
    const pid = await createProject({ title: 'P' });
    const tCascade = await createTask({ projectId: pid });
    const tAlreadyTrashed = await createTask({ projectId: pid });
    await trashTask(tAlreadyTrashed);
    await trashProject(pid);
    expect((await db.tasks.get(tCascade))!.trashedAt).not.toBeNull();
    await restoreProject(pid);
    expect((await db.projects.get(pid))!.trashedAt).toBeNull();
    expect((await db.tasks.get(tCascade))!.trashedAt).toBeNull();
    // Independently trashed task stays in the trash
    expect((await db.tasks.get(tAlreadyTrashed))!.trashedAt).not.toBeNull();
  });

  it('emptyTrash hard-deletes trashed items and orphaned headings', async () => {
    const pid = await createProject({ title: 'P' });
    const hid = await createHeading(pid, 'H');
    const tid = await createTask({ projectId: pid, headingId: hid });
    const keep = await createTask({ title: 'keep' });
    await trashProject(pid);
    await emptyTrash();
    expect(await db.projects.get(pid)).toBeUndefined();
    expect(await db.tasks.get(tid)).toBeUndefined();
    expect(await db.headings.get(hid)).toBeUndefined();
    expect(await db.tasks.get(keep)).toBeDefined();
  });
});

describe('headings / areas / tags', () => {
  it('deleteHeading moves tasks to the project root', async () => {
    const pid = await createProject({ title: 'P' });
    const hid = await createHeading(pid, 'H');
    const tid = await createTask({ projectId: pid, headingId: hid });
    await deleteHeading(hid);
    const t = (await db.tasks.get(tid))!;
    expect(t.headingId).toBeNull();
    expect(t.projectId).toBe(pid);
  });

  it('deleteArea detaches projects and tasks', async () => {
    const aid = await createArea('Home');
    const pid = await createProject({ title: 'P', areaId: aid });
    const tid = await createTask({ areaId: aid });
    await deleteArea(aid);
    expect((await db.projects.get(pid))!.areaId).toBeNull();
    expect((await db.tasks.get(tid))!.areaId).toBeNull();
  });

  it('deleteTag removes it from tasks and projects', async () => {
    const tag = await createTag('errand');
    const other = await createTag('work');
    const tid = await createTask({ tagIds: [tag, other] });
    const pid = await createProject({ title: 'P', tagIds: [tag] });
    await deleteTag(tag);
    expect((await db.tasks.get(tid))!.tagIds).toEqual([other]);
    expect((await db.projects.get(pid))!.tagIds).toEqual([]);
  });
});

describe('export / import', () => {
  it('roundtrips all data', async () => {
    const aid = await createArea('Home');
    const pid = await createProject({ title: 'P', areaId: aid });
    await createHeading(pid, 'H');
    await createTask({ projectId: pid, title: 'task', notes: '**bold**' });
    await createTag('errand');
    await db.settings.put({ key: 'theme', value: 'dark' });

    const file = await exportData();
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await db.tasks.count()).toBe(0);

    await importData(validateExport(JSON.parse(JSON.stringify(file))));
    expect(await db.tasks.count()).toBe(1);
    expect(await db.projects.count()).toBe(1);
    expect(await db.headings.count()).toBe(1);
    expect(await db.areas.count()).toBe(1);
    expect(await db.tags.count()).toBe(1);
    expect((await db.settings.get('theme'))!.value).toBe('dark');
  });

  it('rejects malformed files', () => {
    expect(() => validateExport(null)).toThrow();
    expect(() => validateExport({ app: 'other' })).toThrow();
    expect(() => validateExport({ app: 'clarity', schemaVersion: 999, data: {} })).toThrow();
    expect(() => validateExport({ app: 'clarity', schemaVersion: 1, data: { tasks: [{}] } })).toThrow();
  });
});
