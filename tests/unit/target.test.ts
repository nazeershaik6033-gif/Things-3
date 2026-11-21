import { describe, expect, it } from 'vitest';
import type { DailyTarget, Task, TargetOutcome } from '../../src/db/models';
import { newTask } from '../../src/db/mutations';
import {
  hitStreak, isReviewed, pastTargets, recentTargets, resolveAll, resolveOutcome,
  targetFor, targetStats,
} from '../../src/domain/target';

const TODAY = '2026-06-11';

function target(date: string, partial: Partial<DailyTarget> = {}): DailyTarget {
  return {
    date,
    text: `target for ${date}`,
    taskId: null,
    outcome: 'pending',
    reflection: '',
    setAt: 1,
    reviewedAt: partial.outcome && partial.outcome !== 'pending' ? 2 : null,
    ...partial,
  };
}

function task(partial: Partial<Task>): Task {
  return newTask({ orderKey: 'a0', bucket: 'anytime', ...partial });
}

const on = (date: string, outcome: TargetOutcome) => target(date, { outcome });

describe('targetFor', () => {
  it('finds the target belonging to a day', () => {
    const all = [target('2026-06-10'), target(TODAY)];
    expect(targetFor(all, TODAY)!.date).toBe(TODAY);
    expect(targetFor(all, '2026-06-09')).toBeNull();
  });
});

describe('resolveOutcome', () => {
  it('leaves a recorded verdict alone', () => {
    const t = target(TODAY, { outcome: 'missed', taskId: 'x' });
    const tasks = [task({ id: 'x', status: 'completed' })];
    expect(resolveOutcome(t, tasks)).toBe('missed');
  });

  it('counts a finished linked to-do as a hit', () => {
    const t = target(TODAY, { taskId: 'x' });
    expect(resolveOutcome(t, [task({ id: 'x', status: 'completed' })])).toBe('hit');
  });

  it('stays pending while the linked to-do is open', () => {
    const t = target(TODAY, { taskId: 'x' });
    expect(resolveOutcome(t, [task({ id: 'x', status: 'open' })])).toBe('pending');
  });

  it('ignores a linked to-do that was trashed or no longer exists', () => {
    const t = target(TODAY, { taskId: 'x' });
    expect(resolveOutcome(t, [task({ id: 'x', status: 'completed', trashedAt: 1 })])).toBe('pending');
    expect(resolveOutcome(t, [])).toBe('pending');
  });

  it('is pending with no link at all', () => {
    expect(resolveOutcome(target(TODAY), [])).toBe('pending');
  });

  it('resolveAll leaves the stored rows untouched', () => {
    const stored = [target(TODAY, { taskId: 'x' })];
    const tasks = [task({ id: 'x', status: 'completed' })];
    expect(resolveAll(stored, tasks)[0]!.outcome).toBe('hit');
    expect(stored[0]!.outcome).toBe('pending');
  });
});

describe('isReviewed', () => {
  it('is true only once a verdict was recorded by hand', () => {
    expect(isReviewed(target(TODAY))).toBe(false);
    expect(isReviewed(target(TODAY, { outcome: 'hit' }))).toBe(true);
  });
});

describe('hitStreak', () => {
  it('counts consecutive hit days ending today', () => {
    const all = [on('2026-06-09', 'hit'), on('2026-06-10', 'hit'), on(TODAY, 'hit')];
    expect(hitStreak(all, TODAY)).toBe(3);
  });

  it('an unjudged today does not break the streak', () => {
    const all = [on('2026-06-09', 'hit'), on('2026-06-10', 'hit'), target(TODAY)];
    expect(hitStreak(all, TODAY)).toBe(2);
  });

  it('a recorded miss today ends it at zero', () => {
    const all = [on('2026-06-09', 'hit'), on('2026-06-10', 'hit'), on(TODAY, 'missed')];
    expect(hitStreak(all, TODAY)).toBe(0);
  });

  it('a partial today also ends it — it did happen', () => {
    const all = [on('2026-06-10', 'hit'), on(TODAY, 'partial')];
    expect(hitStreak(all, TODAY)).toBe(0);
  });

  it('a day with no target at all breaks the chain', () => {
    const all = [on('2026-06-08', 'hit'), on('2026-06-10', 'hit'), target(TODAY)];
    expect(hitStreak(all, TODAY)).toBe(1);
  });

  it('is zero with no history', () => {
    expect(hitStreak([], TODAY)).toBe(0);
  });

  it('counts a hit derived from a linked to-do', () => {
    const all = resolveAll(
      [on('2026-06-10', 'hit'), target(TODAY, { taskId: 'x' })],
      [task({ id: 'x', status: 'completed' })],
    );
    expect(hitStreak(all, TODAY)).toBe(2);
  });
});

describe('recentTargets', () => {
  it('returns the window oldest-first and marks days with no target', () => {
    const days = recentTargets([on(TODAY, 'hit')], TODAY, 3);
    expect(days.map((d) => d.date)).toEqual(['2026-06-09', '2026-06-10', TODAY]);
    expect(days[0]!.unset).toBe(true);
    expect(days.at(-1)).toMatchObject({ outcome: 'hit', unset: false });
  });
});

describe('targetStats', () => {
  it('counts outcomes and rates hits against judged days only', () => {
    const all = [
      on('2026-06-08', 'hit'),
      on('2026-06-09', 'missed'),
      on('2026-06-10', 'hit'),
      target(TODAY), // set but not yet judged
    ];
    const s = targetStats(all, TODAY, 7);
    expect(s).toMatchObject({ set: 4, hit: 2, missed: 1, partial: 0, pending: 1 });
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  it('reports 0 rather than NaN when nothing has been judged', () => {
    expect(targetStats([target(TODAY)], TODAY, 7).hitRate).toBe(0);
    expect(targetStats([], TODAY, 7)).toMatchObject({ set: 0, hitRate: 0 });
  });

  it('ignores days outside the window', () => {
    const all = [on('2026-05-01', 'hit'), on(TODAY, 'hit')];
    expect(targetStats(all, TODAY, 7).set).toBe(1);
  });
});

describe('pastTargets', () => {
  it('returns earlier days newest first, excluding today', () => {
    const all = [target('2026-06-09'), target(TODAY), target('2026-06-10')];
    expect(pastTargets(all, TODAY).map((t) => t.date)).toEqual(['2026-06-10', '2026-06-09']);
  });
});
