import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import { completeTask, createProject, createTask } from '../../src/db/mutations';
import {
  addTrackedTime, bumpCounter, createCounter, makeRepeating, moveToTomorrow, runRepeats,
  saveDayReview, setEstimate, setTimeOnDay, stopRepeating, syncIssues, toggleStopwatch,
  updateRepeatRule,
} from '../../src/db/superMutations';
import { presetRule } from '../../src/domain/repeat';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import type { GhIssue } from '../../src/domain/issues';

const MON = '2026-11-23';
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).getTime();

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('time tracking', () => {
  it('banks tracked spans per day and supports corrections', async () => {
    const id = await createTask({ title: 'Deep work' });
    await addTrackedTime(id, at(MON, '23:50'), at('2026-11-24', '00:20'));
    let t = (await db.tasks.get(id))!;
    expect(t.timeSpent).toEqual({ [MON]: 600, '2026-11-24': 1200 });
    await setTimeOnDay(id, MON, 0);
    await setEstimate(id, 45);
    t = (await db.tasks.get(id))!;
    expect(t.timeSpent).toEqual({ '2026-11-24': 1200 });
    expect(t.timeEstimateMin).toBe(45);
  });
});

describe('repeating to-dos', () => {
  it('turns a to-do into a series with one occurrence ahead', async () => {
    const id = await createTask({ title: 'Stand-up', checklist: [{ id: 'c', title: 'Notes', completed: true }] });
    const cfgId = await makeRepeating(id, presetRule('weekdays', MON), MON);
    const rows = (await db.tasks.where('repeatTemplateId').equals(cfgId!).toArray())
      .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
    expect(rows.map((t) => t.startDate)).toEqual([MON, '2026-11-24']);
    expect(rows[1]!.checklist[0]!.completed).toBe(false); // fresh checklist
    // Idempotent
    expect(await runRepeats(MON)).toBe(0);
    // The next day makes the next one ahead
    expect(await runRepeats('2026-11-24')).toBe(1);
  });

  it('after-completion rules schedule from the day you finish', async () => {
    const id = await createTask({ title: 'Water plants' });
    const rule = { ...presetRule('daily', MON), interval: 3, afterCompletion: true };
    const cfgId = (await makeRepeating(id, rule, MON))!;
    expect(await db.tasks.where('repeatTemplateId').equals(cfgId).count()).toBe(1);
    await completeTask(id, false, at('2026-11-25', '10:00'));
    const open = (await db.tasks.where('repeatTemplateId').equals(cfgId).toArray()).filter((t) => t.status === 'open');
    expect(open.map((t) => t.startDate)).toEqual(['2026-11-28']);
  });

  it('changing the rule drops future occurrences that no longer fit', async () => {
    const id = await createTask({ title: 'Gym' });
    const cfgId = (await makeRepeating(id, presetRule('daily', MON), MON))!;
    await updateRepeatRule(cfgId, { ...presetRule('weekly', MON), weekdays: [5] }, MON);
    const dates = (await db.tasks.where('repeatTemplateId').equals(cfgId).toArray()).map((t) => t.startDate).sort();
    expect(dates).toEqual([MON, '2026-11-27']);
  });

  it('stopping keeps what you have and removes what is ahead', async () => {
    const id = await createTask({ title: 'Review' });
    const cfgId = (await makeRepeating(id, presetRule('daily', MON), MON))!;
    await stopRepeating(cfgId, MON);
    const all = await db.tasks.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.repeatTemplateId).toBeNull();
    expect(await db.repeatCfgs.count()).toBe(0);
  });
});

describe('counters', () => {
  it('click counters never go below zero; stopwatches bank seconds', async () => {
    const water = await createCounter('Water', 'click', 8);
    await bumpCounter(water, MON, 1);
    await bumpCounter(water, MON, -5);
    expect(await db.counterDays.count()).toBe(0);
    await bumpCounter(water, MON, 2);
    expect((await db.counterDays.toArray())[0]!.value).toBe(2);

    const read = await createCounter('Read', 'stopwatch', 20);
    await toggleStopwatch(read, at(MON, '21:00'));
    expect((await db.counters.get(read))!.runningSince).not.toBeNull();
    await toggleStopwatch(read, at(MON, '21:15'));
    expect((await db.counters.get(read))!.runningSince).toBeNull();
    expect((await db.counterDays.get(`${MON}:${read}`))!.value).toBe(900);
  });
});

describe('finish day', () => {
  it('saves a review and rolls unfinished to tomorrow', async () => {
    const id = await createTask({ title: 'Leftover', startDate: MON, evening: true, bucket: 'anytime' });
    await moveToTomorrow([id], MON);
    const t = (await db.tasks.get(id))!;
    expect(t.startDate).toBe('2026-11-24');
    expect(t.evening).toBe(false);
    await saveDayReview(MON, { impact: 3, note: ' Good day ' }, { trackedSec: 3600, completed: [] });
    expect(await db.dayReviews.get(MON)).toMatchObject({ impact: 3, note: 'Good day', trackedSec: 3600, completedCount: 0 });
  });
});

describe('issue import', () => {
  const issue = (n: number, state: 'open' | 'closed', labels: string[] = []): GhIssue => ({
    number: n, title: `Bug ${n}`, state, html_url: `https://github.com/o/r/issues/${n}`, body: 'Details',
    labels: labels.map((name) => ({ name })),
  });

  it('creates a project, imports open issues with label tags, and re-syncs', async () => {
    const r = { owner: 'o', repo: 'r' };
    const first = await syncIssues(r, [issue(1, 'open', ['bug']), issue(2, 'closed')]);
    expect(first.created).toBe(1);
    const project = (await db.projects.get(first.projectId))!;
    expect(project.title).toBe('o/r');
    const t = (await db.tasks.toArray())[0]!;
    expect(t.title).toBe('#1 Bug 1');
    expect(t.issueRef).toBe('github:o/r#1');
    expect(t.notes.startsWith('https://github.com/o/r/issues/1')).toBe(true);
    expect((await db.tags.toArray()).map((x) => x.title)).toEqual(['bug']);

    const second = await syncIssues(r, [issue(1, 'closed', ['bug'])], first.projectId);
    expect(second).toMatchObject({ created: 0, completed: 1, projectId: first.projectId });
    expect((await db.tasks.get(t.id))!.status).toBe('completed');
    expect(await db.tags.count()).toBe(1);
  });

  it('reuses a project the user picked', async () => {
    const pid = await createProject({ title: 'Work' });
    const res = await syncIssues({ owner: 'o', repo: 'r' }, [issue(7, 'open')], pid);
    expect(res.projectId).toBe(pid);
  });
});

describe('backup', () => {
  it('round-trips the v9 tables', async () => {
    const id = await createTask({ title: 'x', timeSpent: { [MON]: 5 } });
    await makeRepeating(id, presetRule('daily', MON), MON);
    await createCounter('Water', 'click');
    await saveDayReview(MON, { impact: 2, note: '' }, { trackedSec: 5, completed: [] });
    const file = validateExport(JSON.parse(JSON.stringify(await exportData())));
    expect(file.schemaVersion).toBe(11);
    await Promise.all(db.tables.map((t) => t.clear()));
    await importData(file);
    expect(await db.repeatCfgs.count()).toBe(1);
    expect(await db.counters.count()).toBe(1);
    expect(await db.dayReviews.count()).toBe(1);
    expect((await db.tasks.get(id))!.timeSpent).toEqual({ [MON]: 5 });
  });

  it('defaults v9 task fields when importing an older backup', async () => {
    const file = validateExport({
      app: 'clarity', schemaVersion: 8, exportedAt: 0,
      data: {
        tasks: [{ id: 'old', title: 'Old', status: 'open', completedAt: null }],
        projects: [], headings: [], areas: [], tags: [], settings: [],
      },
    });
    await importData(file);
    const t = (await db.tasks.get('old'))!;
    expect(t.timeSpent).toEqual({});
    expect(t.timeEstimateMin).toBeNull();
    expect(t.issueRef).toBeNull();
  });
});
