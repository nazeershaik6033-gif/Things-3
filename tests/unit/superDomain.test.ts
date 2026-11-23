import { describe, expect, it } from 'vitest';
import { newProject, newTask } from '../../src/db/mutations';
import type { Counter, CounterDay } from '../../src/db/models';
import { groupWorklog, timesheetCsv, weekStart, worklogDays } from '../../src/domain/worklog';
import { hasShortSyntax, parseDateWord, parseShortSyntax } from '../../src/domain/shortSyntax';
import { counterStreak, liveValue, recentDays } from '../../src/domain/counters';
import { parseRepo, planIssueSync, type GhIssue } from '../../src/domain/issues';
import { summarizeDay } from '../../src/domain/finishDay';

const MON = '2026-11-23'; // a Monday
const noon = (d: string) => new Date(`${d}T12:00:00`).getTime();

describe('worklog', () => {
  const tasks = [
    newTask({ id: 'a', title: 'Write report', timeSpent: { [MON]: 3600, '2026-11-24': 600 }, timeEstimateMin: 90 }),
    newTask({ id: 'b', title: 'Email, "urgent"', status: 'completed', completedAt: noon(MON) }),
    newTask({ id: 'c', title: 'Trashed', timeSpent: { [MON]: 999 }, trashedAt: 1 }),
  ];

  it('lists days newest first with entries by time', () => {
    const days = worklogDays(tasks);
    expect(days.map((d) => d.date)).toEqual(['2026-11-24', MON]);
    const mon = days[1]!;
    expect(mon.totalSec).toBe(3600);
    expect(mon.completedCount).toBe(1);
    expect(mon.entries.map((e) => e.taskId)).toEqual(['a', 'b']);
  });

  it('respects a range and groups into ISO weeks', () => {
    expect(worklogDays(tasks, [], [], { from: MON, to: MON }).map((d) => d.date)).toEqual([MON]);
    expect(weekStart('2026-11-29')).toBe(MON); // Sunday -> previous Monday
    const months = groupWorklog(worklogDays(tasks));
    expect(months).toHaveLength(1);
    expect(months[0]!.weeks[0]!.totalSec).toBe(4200);
  });

  it('exports a CSV timesheet with quoting', () => {
    const csv = timesheetCsv(worklogDays(tasks), tasks, [], []);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Date,To-Do,Project,Tags,Minutes,Estimate (min),Completed');
    expect(lines[1]).toBe(`${MON},Write report,,,60,90,`);
    expect(lines[2]).toBe(`${MON},"Email, ""urgent""",,,0,,yes`);
  });
});

describe('short syntax', () => {
  const projects = [newProject({ id: 'p1', title: 'Clarity App' }), newProject({ id: 'p2', title: 'Home' })];

  it('parses every token and leaves the rest as the title', () => {
    const r = parseShortSyntax('Call Anna #work #Calls +clarity @tomorrow ~30m !fri', projects, MON);
    expect(r).toEqual({
      title: 'Call Anna',
      tagTitles: ['work', 'Calls'],
      projectId: 'p1',
      when: { type: 'date', date: '2026-11-24' },
      deadline: '2026-11-27',
      estimateMin: 30,
    });
  });

  it('leaves look-alikes and unknown tokens in the title', () => {
    const r = parseShortSyntax('Mail a@b.com about C# #2 +nothing @later', projects, MON);
    expect(r.title).toBe('Mail a@b.com about C# #2 +nothing @later');
    expect(r.tagTitles).toEqual([]);
    expect(r.projectId).toBeNull();
    expect(r.when).toBeNull();
  });

  it('date words', () => {
    expect(parseDateWord('mon', MON)).toBe('2026-11-30'); // next Monday, not today
    expect(parseDateWord('3d', MON)).toBe('2026-11-26');
    expect(parseDateWord('2w', MON)).toBe('2026-12-07');
    expect(parseDateWord('2026-12-25', MON)).toBe('2026-12-25');
    expect(parseShortSyntax('x @today', projects, MON).when).toEqual({ type: 'today' });
    expect(parseShortSyntax('x @tonight', projects, MON).when).toEqual({ type: 'evening' });
    expect(parseShortSyntax('x @someday', projects, MON).when).toEqual({ type: 'someday' });
  });

  it('detects when to show the hint', () => {
    expect(hasShortSyntax('Buy milk')).toBe(false);
    expect(hasShortSyntax('Buy milk #errands')).toBe(true);
    expect(hasShortSyntax('Plan ~1h')).toBe(true);
  });
});

describe('counters', () => {
  const water: Counter = {
    id: 'w', title: 'Water', kind: 'click', color: '', goal: 3, orderKey: 'a0', active: true,
    runningSince: null, createdAt: 0, modifiedAt: 0,
  };
  const days: CounterDay[] = [
    { id: '1', counterId: 'w', date: '2026-11-20', value: 3 },
    { id: '2', counterId: 'w', date: '2026-11-21', value: 4 },
    { id: '3', counterId: 'w', date: '2026-11-22', value: 3 },
  ];

  it('an unfinished today does not break the streak', () => {
    expect(counterStreak(water, days, MON, 0)).toBe(3);
    expect(counterStreak(water, [...days, { id: '4', counterId: 'w', date: MON, value: 3 }], MON, 0)).toBe(4);
    expect(counterStreak(water, days.slice(0, 2), MON, 0)).toBe(0);
  });

  it('stopwatch counts its running span on today only', () => {
    const read: Counter = { ...water, id: 'r', kind: 'stopwatch', goal: 10, runningSince: new Date(`${MON}T09:00:00`).getTime() };
    const now = new Date(`${MON}T09:12:00`).getTime();
    expect(liveValue(read, [], MON, now)).toBe(720);
    const strip = recentDays(read, [], MON, now, 3);
    expect(strip.map((d) => d.met)).toEqual([false, false, true]);
  });
});

describe('issues', () => {
  it('parses repo references', () => {
    expect(parseRepo('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(parseRepo('https://github.com/super-productivity/super-productivity/')).toEqual({
      owner: 'super-productivity', repo: 'super-productivity',
    });
    expect(parseRepo('not a repo')).toBeNull();
  });

  it('plans creates, closes, reopens and retitles — skipping PRs', () => {
    const r = { owner: 'o', repo: 'r' };
    const issue = (n: number, state: 'open' | 'closed', title = `Issue ${n}`, pr = false): GhIssue => ({
      number: n, title, state, html_url: `https://github.com/o/r/issues/${n}`, body: null, labels: [],
      ...(pr ? { pull_request: {} } : {}),
    });
    const tasks = [
      newTask({ id: 't1', title: '#1 Issue 1', issueRef: 'github:o/r#1' }),
      newTask({ id: 't2', title: '#2 Old', issueRef: 'github:o/r#2', status: 'completed', completedAt: 1 }),
      newTask({ id: 't3', title: '#3 Issue 3', issueRef: 'github:other/r#3' }),
    ];
    const plan = planIssueSync(r, [issue(1, 'closed'), issue(2, 'open', 'New'), issue(3, 'open'), issue(4, 'open', 'PR', true), issue(5, 'closed')], tasks);
    expect(plan.create.map((i) => i.number)).toEqual([3]);
    expect(plan.complete).toEqual(['t1']);
    expect(plan.reopen).toEqual(['t2']);
    expect(plan.retitle).toEqual([{ id: 't2', title: '#2 New' }]);
  });
});

describe('finish day', () => {
  it('summarizes done, unfinished, tracked and estimated', () => {
    const tasks = [
      newTask({ id: 'done', status: 'completed', completedAt: noon(MON), timeEstimateMin: 30, timeSpent: { [MON]: 1200 } }),
      newTask({ id: 'open', bucket: 'anytime', startDate: MON, timeEstimateMin: 60 }),
      newTask({ id: 'late', bucket: 'anytime', startDate: '2026-11-20' }),
      newTask({ id: 'later', bucket: 'anytime', startDate: '2026-11-30' }),
    ];
    const s = summarizeDay(tasks, [], MON);
    expect(s.completed.map((t) => t.id)).toEqual(['done']);
    expect(s.unfinished.map((t) => t.id).sort()).toEqual(['late', 'open']);
    expect(s.trackedSec).toBe(1200);
    expect(s.estimatedMin).toBe(90);
  });
});
