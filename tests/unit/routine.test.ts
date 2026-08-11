import { describe, expect, it } from 'vitest';
import type { RoutineItem, RoutineLog } from '../../src/db/models';
import { newRoutineItem } from '../../src/db/mutations';
import {
  activeItems, completedIdsOn, isDayComplete, itemsOnDate, logId, recentDays,
  routineProgress, streakLength,
} from '../../src/domain/routine';

const TODAY = '2026-06-11';

/** createdAt at local noon of `date` so it always lands inside that day. */
function item(id: string, date: string, partial: Partial<RoutineItem> = {}): RoutineItem {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);
  return newRoutineItem({ id, title: id, orderKey: id, createdAt: d.getTime(), ...partial });
}

function log(date: string, itemId: string): RoutineLog {
  return { id: logId(date, itemId), date, itemId, completedAt: 1 };
}

describe('routine items', () => {
  it('lists only active items, in order key order', () => {
    const items = [item('c', TODAY), item('a', TODAY), item('b', TODAY, { active: false })];
    expect(activeItems(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('excludes items created after the day being asked about', () => {
    const items = [item('old', '2026-06-01'), item('new', '2026-06-11')];
    expect(itemsOnDate(items, '2026-06-05').map((i) => i.id)).toEqual(['old']);
    expect(itemsOnDate(items, '2026-06-11').map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('collects the ids completed on a given day', () => {
    const logs = [log(TODAY, 'a'), log('2026-06-10', 'b')];
    expect([...completedIdsOn(logs, TODAY)]).toEqual(['a']);
  });
});

describe('routineProgress', () => {
  const items = [item('a', '2026-06-01'), item('b', '2026-06-01')];

  it('counts done out of due', () => {
    const p = routineProgress(items, [log(TODAY, 'a')], TODAY);
    expect(p).toEqual({ done: 1, total: 2, ratio: 0.5, complete: false });
  });

  it('is complete only when every due item is ticked', () => {
    const p = routineProgress(items, [log(TODAY, 'a'), log(TODAY, 'b')], TODAY);
    expect(p.complete).toBe(true);
  });

  it('reports 0 rather than NaN when nothing is due', () => {
    const p = routineProgress([], [], TODAY);
    expect(p).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
  });

  it('an empty day is not "complete"', () => {
    expect(isDayComplete([], [], TODAY)).toBe(false);
  });
});

describe('streakLength', () => {
  const items = [item('a', '2026-01-01')];
  const done = (...dates: string[]) => dates.map((d) => log(d, 'a'));

  it('counts consecutive complete days ending today', () => {
    expect(streakLength(items, done('2026-06-09', '2026-06-10', TODAY), TODAY)).toBe(3);
  });

  it('does not break just because today is still unfinished', () => {
    expect(streakLength(items, done('2026-06-09', '2026-06-10'), TODAY)).toBe(2);
  });

  it('breaks on a genuine miss', () => {
    expect(streakLength(items, done('2026-06-08', '2026-06-10'), TODAY)).toBe(1);
  });

  it('is zero with no history at all', () => {
    expect(streakLength(items, [], TODAY)).toBe(0);
  });

  it('an item added today cannot retroactively break yesterday', () => {
    const withNew = [...items, item('fresh', TODAY)];
    // 'fresh' didn't exist on the 9th/10th, so those days still count
    expect(streakLength(withNew, done('2026-06-09', '2026-06-10'), TODAY)).toBe(2);
  });
});

describe('recentDays', () => {
  it('returns the window oldest-first, ending today', () => {
    const items = [item('a', '2026-01-01')];
    const days = recentDays(items, [log(TODAY, 'a')], TODAY, 3);
    expect(days.map((d) => d.date)).toEqual(['2026-06-09', '2026-06-10', TODAY]);
    expect(days.at(-1)!.complete).toBe(true);
    expect(days[0]!.ratio).toBe(0);
  });
});
