import { describe, expect, it } from 'vitest';
import { newTask, newProject } from '../../src/db/mutations';
import type { Task } from '../../src/db/models';
import {
  inInbox, inToday, inUpcoming, inAnytime, inSomeday, inLogbook, isOverdue,
  todayTasks, upcomingGroups, logbookGroups, projectSections, projectProgress,
  sidebarCounts, groupByHome, trashItems, upcomingDateOf,
} from '../../src/domain/smartLists';

const TODAY = '2026-06-11';

function task(partial: Partial<Task>): Task {
  return newTask({ orderKey: 'a0', ...partial });
}

describe('Inbox', () => {
  it('contains open, live, bucket=inbox tasks only', () => {
    expect(inInbox(task({}))).toBe(true);
    expect(inInbox(task({ bucket: 'anytime' }))).toBe(false);
    expect(inInbox(task({ bucket: 'someday' }))).toBe(false);
    expect(inInbox(task({ status: 'completed' }))).toBe(false);
    expect(inInbox(task({ trashedAt: 1 }))).toBe(false);
  });
});

describe('Today', () => {
  it('includes only tasks scheduled for today (not past days)', () => {
    expect(inToday(task({ startDate: TODAY, bucket: 'anytime' }), TODAY)).toBe(true);
    // Past startDate no longer rolls over into Today — goes to Prior instead
    expect(inToday(task({ startDate: '2026-06-01', bucket: 'anytime' }), TODAY)).toBe(false);
    expect(inToday(task({ startDate: '2026-06-12', bucket: 'anytime' }), TODAY)).toBe(false);
    expect(inToday(task({ bucket: 'anytime' }), TODAY)).toBe(false);
  });

  it('includes tasks with due-or-overdue deadlines when no startDate', () => {
    expect(inToday(task({ deadline: TODAY, bucket: 'anytime' }), TODAY)).toBe(true);
    expect(inToday(task({ deadline: '2026-06-01', bucket: 'anytime' }), TODAY)).toBe(true);
    expect(inToday(task({ deadline: '2026-07-01', bucket: 'anytime' }), TODAY)).toBe(false);
    // A task with startDate set uses the startDate rule, not deadline
    expect(inToday(task({ startDate: '2026-06-01', deadline: TODAY, bucket: 'anytime' }), TODAY)).toBe(false);
  });

  it('excludes completed/trashed', () => {
    expect(inToday(task({ startDate: TODAY, status: 'completed' }), TODAY)).toBe(false);
    expect(inToday(task({ startDate: TODAY, trashedAt: 1 }), TODAY)).toBe(false);
  });

  it('past startDate stays out of today (no rollover)', () => {
    const t = task({ startDate: '2026-06-11', bucket: 'anytime' });
    expect(inToday(t, '2026-06-10')).toBe(false);
    expect(inToday(t, '2026-06-11')).toBe(true);
    expect(inToday(t, '2026-06-12')).toBe(false); // no rollover
  });

  it('splits into ungrouped and tonight sections', () => {
    const a = task({ startDate: TODAY, bucket: 'anytime', todayOrderKey: 'a1' });
    const b = task({ startDate: TODAY, bucket: 'anytime', evening: true });
    const { ungrouped, tonight } = todayTasks([a, b], TODAY);
    expect(ungrouped.map((t) => t.id)).toEqual([a.id]);
    expect(tonight.map((t) => t.id)).toEqual([b.id]);
  });

  it('routes morning/afternoon via reminderTime', () => {
    const m = task({ startDate: TODAY, bucket: 'anytime', reminderTime: 'morning' });
    const a = task({ startDate: TODAY, bucket: 'anytime', reminderTime: 'afternoon' });
    const u = task({ startDate: TODAY, bucket: 'anytime' });
    const { morning, afternoon, ungrouped } = todayTasks([m, a, u], TODAY);
    expect(morning.map((t) => t.id)).toEqual([m.id]);
    expect(afternoon.map((t) => t.id)).toEqual([a.id]);
    expect(ungrouped.map((t) => t.id)).toEqual([u.id]);
  });

  it('sorts keyed rows first, unkeyed rows after by orderKey', () => {
    const keyed = task({ startDate: TODAY, bucket: 'anytime', todayOrderKey: 'a5', orderKey: 'z' });
    const plain = task({ startDate: TODAY, bucket: 'anytime', orderKey: 'a1' });
    const { ungrouped } = todayTasks([plain, keyed], TODAY);
    expect(ungrouped.map((t) => t.id)).toEqual([keyed.id, plain.id]);
  });

  it('flags overdue deadlines', () => {
    expect(isOverdue(task({ deadline: '2026-06-10' }), TODAY)).toBe(true);
    expect(isOverdue(task({ deadline: TODAY }), TODAY)).toBe(false);
  });
});

describe('Upcoming', () => {
  it('contains future-scheduled tasks', () => {
    expect(inUpcoming(task({ startDate: '2026-06-12', bucket: 'anytime' }), TODAY)).toBe(true);
    expect(inUpcoming(task({ startDate: TODAY, bucket: 'anytime' }), TODAY)).toBe(false);
  });

  it('surfaces future deadlines without a start date on the deadline day', () => {
    const t = task({ deadline: '2026-06-20', bucket: 'anytime' });
    expect(inUpcoming(t, TODAY)).toBe(true);
    expect(upcomingDateOf(t, TODAY)).toBe('2026-06-20');
  });

  it('does not duplicate a task that has both future start and deadline', () => {
    const t = task({ startDate: '2026-06-15', deadline: '2026-06-20', bucket: 'anytime' });
    expect(upcomingDateOf(t, TODAY)).toBe('2026-06-15');
  });

  it('groups: 7 day rows (always) then month buckets (non-empty only)', () => {
    const inWeek = task({ startDate: '2026-06-13', bucket: 'anytime' });
    const inJuly = task({ startDate: '2026-07-04', bucket: 'anytime' });
    const inDec = task({ startDate: '2026-12-25', bucket: 'anytime' });
    const nextYear = task({ startDate: '2027-01-01', bucket: 'anytime' });
    const groups = upcomingGroups([inWeek, inJuly, inDec, nextYear], TODAY);
    expect(groups.filter((g) => g.kind === 'day')).toHaveLength(7);
    expect(groups[0]!.label).toBe('Tomorrow');
    expect(groups.find((g) => g.date === '2026-06-13')!.tasks).toHaveLength(1);
    const months = groups.filter((g) => g.kind === 'month');
    expect(months.map((m) => m.label)).toEqual(['July', 'December', 'January']);
    expect(months[2]!.sublabel).toBe('2027');
  });

  it('groups tasks 8+ days out into months even in the current month', () => {
    const t = task({ startDate: '2026-06-25', bucket: 'anytime' });
    const groups = upcomingGroups([t], TODAY);
    const june = groups.find((g) => g.kind === 'month' && g.label === 'June');
    expect(june!.tasks).toHaveLength(1);
  });
});

describe('Anytime', () => {
  it('bucket=anytime with no future start', () => {
    expect(inAnytime(task({ bucket: 'anytime' }), TODAY)).toBe(true);
    expect(inAnytime(task({ bucket: 'anytime', startDate: TODAY }), TODAY)).toBe(true);
    expect(inAnytime(task({ bucket: 'anytime', startDate: '2026-07-01' }), TODAY)).toBe(false);
    expect(inAnytime(task({ bucket: 'inbox' }), TODAY)).toBe(false);
    expect(inAnytime(task({ bucket: 'someday' }), TODAY)).toBe(false);
  });
});

describe('Someday', () => {
  it('bucket=someday without a date', () => {
    expect(inSomeday(task({ bucket: 'someday' }))).toBe(true);
    expect(inSomeday(task({ bucket: 'someday', startDate: '2026-07-01' }))).toBe(false);
    expect(inSomeday(task({ bucket: 'anytime' }))).toBe(false);
  });
});

describe('Logbook', () => {
  it('completed and canceled items, grouped by completion date, newest first', () => {
    const day1 = new Date(2026, 5, 10, 9).getTime();
    const day2a = new Date(2026, 5, 11, 9).getTime();
    const day2b = new Date(2026, 5, 11, 17).getTime();
    const t1 = task({ status: 'completed', completedAt: day1 });
    const t2 = task({ status: 'canceled', completedAt: day2a });
    const p = newProject({ status: 'completed', completedAt: day2b, orderKey: 'a0' });
    const groups = logbookGroups([t1, t2], [p]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.date).toBe('2026-06-11');
    expect(groups[0]!.entries.map((e) => e.item.id)).toEqual([p.id, t2.id]);
    expect(groups[1]!.date).toBe('2026-06-10');
  });

  it('excludes trashed and respects the window limit', () => {
    const trashed = task({ status: 'completed', completedAt: 5, trashedAt: 6 });
    expect(inLogbook(trashed)).toBe(false);
    const many = Array.from({ length: 10 }, (_, i) =>
      task({ status: 'completed', completedAt: new Date(2026, 5, 1 + i).getTime() }));
    const groups = logbookGroups(many, [], 3);
    expect(groups.flatMap((g) => g.entries)).toHaveLength(3);
  });
});

describe('Trash', () => {
  it('lists trashed tasks and projects, newest first', () => {
    const t = task({ trashedAt: 100 });
    const p = newProject({ trashedAt: 200, orderKey: 'a0' });
    const live = task({});
    expect(trashItems([t, live], [p]).map((x) => x.id)).toEqual([p.id, t.id]);
  });
});

describe('Project view', () => {
  it('groups by heading, keeps today-completed inline, older behind toggle', () => {
    const pid = 'p1';
    const h = { id: 'h1', projectId: pid, title: 'Phase 1', orderKey: 'a1' };
    const root = task({ projectId: pid, orderKey: 'a0' });
    const under = task({ projectId: pid, headingId: 'h1', orderKey: 'a0' });
    const doneToday = task({
      projectId: pid, status: 'completed',
      completedAt: new Date(2026, 5, 11, 8).getTime(),
    });
    const doneOld = task({
      projectId: pid, status: 'completed',
      completedAt: new Date(2026, 5, 1).getTime(),
    });
    const { sections, loggedToday, loggedOlder } = projectSections(
      [root, under, doneToday, doneOld], [h], pid, TODAY,
    );
    expect(sections[0]!.heading).toBeNull();
    expect(sections[0]!.tasks.map((t) => t.id)).toEqual([root.id]);
    expect(sections[1]!.heading!.id).toBe('h1');
    expect(sections[1]!.tasks.map((t) => t.id)).toEqual([under.id]);
    expect(loggedToday.map((t) => t.id)).toEqual([doneToday.id]);
    expect(loggedOlder.map((t) => t.id)).toEqual([doneOld.id]);
  });

  it('progress counts completed over all live tasks', () => {
    const pid = 'p1';
    const tasks = [
      task({ projectId: pid, status: 'completed', completedAt: 1 }),
      task({ projectId: pid }),
      task({ projectId: pid, trashedAt: 1 }), // ignored
    ];
    expect(projectProgress(tasks, pid)).toBe(0.5);
    expect(projectProgress([], pid)).toBe(0);
  });
});

describe('groupByHome (Anytime/Someday layout)', () => {
  it('standalone first, then projects, then area loose tasks', () => {
    const area = { id: 'ar1', title: 'Home', orderKey: 'a0' };
    const proj = newProject({ id: 'p1', title: 'Renovate', areaId: 'ar1', orderKey: 'a0' });
    const loose = task({ bucket: 'anytime' });
    const inProj = task({ bucket: 'anytime', projectId: 'p1' });
    const inArea = task({ bucket: 'anytime', areaId: 'ar1' });
    const groups = groupByHome([loose, inProj, inArea], [proj], [area]);
    expect(groups.map((g) => g.kind)).toEqual(['standalone', 'project', 'area']);
    expect(groups[1]!.title).toBe('Renovate');
    expect(groups[2]!.title).toBe('Home');
  });
});

describe('sidebarCounts', () => {
  it('counts inbox and today', () => {
    const counts = sidebarCounts([
      task({}),
      task({}),
      task({ startDate: TODAY, bucket: 'anytime' }),
      task({ deadline: '2026-06-01', bucket: 'anytime' }),
      task({ startDate: TODAY, status: 'completed' }),
    ], TODAY);
    expect(counts.inbox).toBe(2);
    expect(counts.today).toBe(2);
  });
});
