import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  completeTask, createTask, moveTask, setTaskTime, setTaskTimes, setTaskWhen, trashTask, updateTask,
} from '../../src/db/mutations';
import { clearUndo, peekUndo, recordUndo, undo, undoDepth } from '../../src/db/undo';
import { makeRepeating, setRepeatSeriesTime } from '../../src/db/superMutations';
import { presetRule } from '../../src/domain/repeat';
import { exportData, importData } from '../../src/db/exportImport';

const TODAY = '2026-11-25';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  clearUndo();
});

describe('undo', () => {
  it('restores a row to exactly how it was before the action', async () => {
    const id = await createTask({ title: 'Plan', startDate: TODAY, bucket: 'anytime' });
    const before = await db.tasks.get(id);
    await recordUndo('Reschedule', () => setTaskTime(id, TODAY, '09:00', 45));
    expect((await db.tasks.get(id))!.startTime).toBe('09:00');
    const r = await undo();
    expect(r).toEqual({ label: 'Reschedule', restored: 1, skipped: 0 });
    expect(await db.tasks.get(id)).toEqual(before);
  });

  it('undoes a whole multi-row action at once', async () => {
    const a = await createTask({ title: 'A', startDate: TODAY, startTime: '09:00', durationMin: 30, bucket: 'anytime' });
    const b = await createTask({ title: 'B', startDate: TODAY, startTime: '09:30', durationMin: 30, bucket: 'anytime' });
    await recordUndo('Push', () => setTaskTimes([
      { id: a, date: TODAY, startTime: '09:00', durationMin: 60 },
      { id: b, date: TODAY, startTime: '10:00', durationMin: 30 },
    ]));
    await undo();
    expect((await db.tasks.get(a))!.durationMin).toBe(30);
    expect((await db.tasks.get(b))!.startTime).toBe('09:30');
  });

  it('removes a row the action created', async () => {
    await recordUndo('Add', () => createTask({ title: 'New' }));
    expect(await db.tasks.count()).toBe(1);
    await undo();
    expect(await db.tasks.count()).toBe(0);
  });

  it('brings back a deleted to-do', async () => {
    const id = await createTask({ title: 'Oops' });
    await recordUndo('Delete', () => trashTask(id));
    await undo();
    expect((await db.tasks.get(id))!.trashedAt).toBeNull();
  });

  it("won't overwrite a row that changed after the action", async () => {
    const id = await createTask({ title: 'Plan', startDate: TODAY, bucket: 'anytime' });
    await recordUndo('Reschedule', () => setTaskTime(id, TODAY, '09:00'));
    await updateTask(id, { title: 'Plan v2' }); // a later, unrecorded edit
    const r = await undo();
    expect(r).toEqual({ label: 'Reschedule', restored: 0, skipped: 1 });
    const t = (await db.tasks.get(id))!;
    expect(t.title).toBe('Plan v2');
    expect(t.startTime).toBe('09:00');
  });

  it('undoes by id, so a stale Undo button only undoes its own action', async () => {
    const a = await createTask({ title: 'A', startDate: TODAY, bucket: 'anytime' });
    const b = await createTask({ title: 'B', startDate: TODAY, bucket: 'anytime' });
    await recordUndo('First', () => setTaskTime(a, TODAY, '08:00'));
    const firstId = peekUndo()!.id;
    await recordUndo('Second', () => setTaskTime(b, TODAY, '10:00'));
    await undo(firstId);
    expect((await db.tasks.get(a))!.startTime).toBeNull();
    expect((await db.tasks.get(b))!.startTime).toBe('10:00');
    expect(undoDepth()).toBe(1);
  });

  it('records nothing for an action that wrote nothing, and joins nested actions', async () => {
    await recordUndo('Noop', async () => {});
    expect(undoDepth()).toBe(0);
    const id = await createTask({ title: 'A' });
    await recordUndo('Outer', async () => {
      await updateTask(id, { title: 'B' });
      await recordUndo('Inner', () => updateTask(id, { title: 'C' }));
    });
    expect(undoDepth()).toBe(1);
    await undo();
    expect((await db.tasks.get(id))!.title).toBe('A');
  });

  it("doesn't record writes made outside an action", async () => {
    const id = await createTask({ title: 'A' });
    await updateTask(id, { title: 'B' });
    expect(await undo()).toBeNull();
  });

  it('is cleared by a backup import', async () => {
    const id = await createTask({ title: 'A' });
    await recordUndo('Rename', () => updateTask(id, { title: 'B' }));
    await importData(await exportData());
    expect(undoDepth()).toBe(0);
  });
});

describe('times on to-dos', () => {
  it('setTaskTime gives a day, clears vague slots and leaves the Inbox', async () => {
    const id = await createTask({ title: 'Call', reminderTime: 'morning' });
    await setTaskTime(id, TODAY, '14:00', 30);
    const t = (await db.tasks.get(id))!;
    expect(t).toMatchObject({ startDate: TODAY, startTime: '14:00', durationMin: 30, bucket: 'anytime', reminderTime: null });
  });

  it('a reminder clock time is not mistaken for a slot', async () => {
    const id = await createTask({ title: 'Call', reminderTime: '09:00', startDate: TODAY, bucket: 'anytime' });
    await setTaskTime(id, TODAY, '14:00');
    expect((await db.tasks.get(id))!.reminderTime).toBe('09:00');
  });

  it('keeps the time across a change of day, drops it for a vague slot or no day', async () => {
    const id = await createTask({ title: 'Gym', startDate: TODAY, startTime: '07:00', bucket: 'anytime' });
    await setTaskWhen(id, { type: 'date', date: '2026-11-27' });
    expect((await db.tasks.get(id))!.startTime).toBe('07:00');
    await setTaskWhen(id, { type: 'today' });
    expect((await db.tasks.get(id))!.startTime).toBe('07:00');
    await setTaskWhen(id, { type: 'evening' });
    expect((await db.tasks.get(id))!.startTime).toBeNull();
    await setTaskTime(id, TODAY, '07:00');
    await setTaskWhen(id, { type: 'someday' });
    expect((await db.tasks.get(id))!.startTime).toBeNull();
    await setTaskTime(id, TODAY, '07:00');
    await moveTask(id, { bucket: 'inbox' });
    expect((await db.tasks.get(id))!.startTime).toBeNull();
  });

  it('repeating to-dos carry their time to the next occurrence', async () => {
    const id = await createTask({ title: 'Gym', startDate: TODAY, startTime: '07:00', durationMin: 60, bucket: 'anytime' });
    const cfgId = (await makeRepeating(id, presetRule('daily', TODAY), TODAY))!;
    await completeTask(id);
    const next = (await db.tasks.where('repeatTemplateId').equals(cfgId).toArray()).find((t) => t.status === 'open')!;
    expect(next).toMatchObject({ startTime: '07:00', durationMin: 60 });
  });

  it('setting the series time moves future occurrences that still had the old time', async () => {
    const id = await createTask({ title: 'Gym', startDate: TODAY, startTime: '07:00', bucket: 'anytime' });
    const cfgId = (await makeRepeating(id, presetRule('daily', TODAY), TODAY))!;
    const future = (await db.tasks.where('repeatTemplateId').equals(cfgId).toArray()).find((t) => t.startDate! > TODAY)!;
    await setRepeatSeriesTime(cfgId, '06:30', 45, TODAY);
    expect((await db.repeatCfgs.get(cfgId))!.template).toMatchObject({ startTime: '06:30', durationMin: 45 });
    expect((await db.tasks.get(future.id))!).toMatchObject({ startTime: '06:30', durationMin: 45 });
    // Today's occurrence is the user's to move on the timeline, not the series'
    expect((await db.tasks.get(id))!.startTime).toBe('07:00');
  });

  it('round-trips through a backup, and old backups get the new fields', async () => {
    const id = await createTask({ title: 'Gym', startDate: TODAY, startTime: '07:00', durationMin: 60, deadline: TODAY, deadlineTime: '18:00' });
    const file = await exportData();
    expect(file.schemaVersion).toBe(11);
    await importData(file);
    expect((await db.tasks.get(id))!).toMatchObject({ startTime: '07:00', durationMin: 60, deadlineTime: '18:00' });
    const old = JSON.parse(JSON.stringify(file));
    old.schemaVersion = 9;
    for (const t of old.data.tasks) { delete t.startTime; delete t.durationMin; delete t.deadlineTime; }
    await importData(old);
    expect((await db.tasks.get(id))!).toMatchObject({ startTime: null, durationMin: null, deadlineTime: null });
  });
});
