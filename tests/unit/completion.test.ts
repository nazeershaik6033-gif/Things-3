import { describe, expect, it } from 'vitest';
import type { Task } from '../../src/db/models';
import { newTask, completionTimeFor } from '../../src/db/mutations';
import { isLate, suggestedCompletionDate } from '../../src/app/completion';
import { dateStrOf } from '../../src/domain/dates';

const TODAY = '2026-06-11';

function task(partial: Partial<Task>): Task {
  return newTask({ orderKey: 'a0', bucket: 'anytime', ...partial });
}

describe('isLate', () => {
  it('is true for a passed deadline', () => {
    expect(isLate(task({ deadline: '2026-06-10' }), TODAY)).toBe(true);
  });

  it('is true for a start date that has slipped by', () => {
    expect(isLate(task({ startDate: '2026-06-01' }), TODAY)).toBe(true);
  });

  it('is false today, in the future, or with no date at all', () => {
    expect(isLate(task({ deadline: TODAY }), TODAY)).toBe(false);
    expect(isLate(task({ startDate: TODAY }), TODAY)).toBe(false);
    expect(isLate(task({ deadline: '2026-06-20' }), TODAY)).toBe(false);
    expect(isLate(task({}), TODAY)).toBe(false);
  });

  it('prefers the deadline over the start date', () => {
    // Started long ago but not due until next week — not late
    expect(isLate(task({ startDate: '2026-06-01', deadline: '2026-06-20' }), TODAY)).toBe(false);
  });

  it('ignores to-dos that are already closed or trashed', () => {
    expect(isLate(task({ deadline: '2026-06-01', status: 'completed' }), TODAY)).toBe(false);
    expect(isLate(task({ deadline: '2026-06-01', trashedAt: 1 }), TODAY)).toBe(false);
  });
});

describe('suggestedCompletionDate', () => {
  it('offers the day it was due', () => {
    expect(suggestedCompletionDate(task({ deadline: '2026-06-08' }), TODAY)).toBe('2026-06-08');
    expect(suggestedCompletionDate(task({ startDate: '2026-06-09' }), TODAY)).toBe('2026-06-09');
  });

  it('falls back to today for anything not late', () => {
    expect(suggestedCompletionDate(task({ deadline: '2026-06-20' }), TODAY)).toBe(TODAY);
    expect(suggestedCompletionDate(task({}), TODAY)).toBe(TODAY);
  });
});

describe('completionTimeFor', () => {
  it('lands inside the chosen local day', () => {
    const stamp = completionTimeFor('2026-06-08', TODAY);
    expect(dateStrOf(stamp)).toBe('2026-06-08');
    expect(new Date(stamp).getHours()).toBe(12);
  });

  it('keeps the real clock time when the day is today', () => {
    const before = Date.now();
    const stamp = completionTimeFor(TODAY, TODAY);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(dateStrOf(stamp)).toBe(dateStrOf(Date.now()));
  });

  it('stays on the right day across a DST boundary', () => {
    // 2026-03-08 is the US spring-forward date; noon is safely clear of it
    expect(dateStrOf(completionTimeFor('2026-03-08', TODAY))).toBe('2026-03-08');
    expect(dateStrOf(completionTimeFor('2026-11-01', TODAY))).toBe('2026-11-01');
  });
});
