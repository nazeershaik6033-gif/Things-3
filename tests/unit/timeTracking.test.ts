import { describe, expect, it } from 'vitest';
import { newTask } from '../../src/db/mutations';
import type { Sprint } from '../../src/db/models';
import {
  addTime, breakDue, estimateRatio, formatClockHMS, formatDuration, liveTaskSeconds,
  parseDuration, remainingEstimateMin, splitAcrossDays, taskTimeByDay, totalSeconds,
} from '../../src/domain/timeTracking';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function sprint(partial: Partial<Sprint>): Sprint {
  return {
    id: 's1', taskId: null, title: '', nextAction: '', durationMin: 25, date: '2026-11-23',
    plannedAt: null, startedAt: null, endsAt: null, endedAt: null, status: 'done',
    completedNote: '', createdAt: 0, ...partial,
  };
}

describe('splitAcrossDays', () => {
  it('keeps a same-day span on one day', () => {
    expect(splitAcrossDays(at(2026, 11, 23, 9), at(2026, 11, 23, 10, 30))).toEqual({ '2026-11-23': 5400 });
  });

  it('splits a span that crosses midnight', () => {
    expect(splitAcrossDays(at(2026, 11, 23, 23, 30), at(2026, 11, 24, 0, 45))).toEqual({
      '2026-11-23': 1800,
      '2026-11-24': 2700,
    });
  });

  it('ignores empty and reversed spans', () => {
    expect(splitAcrossDays(5, 5)).toEqual({});
    expect(splitAcrossDays(10, 5)).toEqual({});
  });
});

describe('addTime', () => {
  it('merges and drops days that reach zero', () => {
    expect(addTime({ a: 10, b: 5 }, { a: 5, b: -5, c: 3 })).toEqual({ a: 15, c: 3 });
  });
});

describe('task time with sprints', () => {
  it('adds finished sprints on the task to the tracker time', () => {
    const t = newTask({ id: 't1', timeSpent: { '2026-11-23': 600 } });
    const sprints = [
      sprint({ taskId: 't1', startedAt: at(2026, 11, 23, 9), endedAt: at(2026, 11, 23, 9, 25) }),
      sprint({ id: 's2', taskId: 't1', status: 'abandoned', startedAt: at(2026, 11, 23, 10), endedAt: at(2026, 11, 23, 11) }),
      sprint({ id: 's3', taskId: 'other', startedAt: at(2026, 11, 23, 10), endedAt: at(2026, 11, 23, 11) }),
    ];
    expect(taskTimeByDay(t, sprints)).toEqual({ '2026-11-23': 600 + 1500 });
    expect(totalSeconds(taskTimeByDay(t, sprints))).toBe(2100);
  });

  it('includes the running tracker in the live total', () => {
    const t = newTask({ id: 't1', timeSpent: { '2026-11-23': 60 } });
    expect(liveTaskSeconds(t, [], { taskId: 't1', startedAt: 1000 }, 31_000)).toBe(90);
    expect(liveTaskSeconds(t, [], { taskId: 'x', startedAt: 1000 }, 31_000)).toBe(60);
  });
});

describe('formatting and parsing', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(12 * 60 + 5)).toBe('12m');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatClockHMS(3725)).toBe('1:02:05');
  });

  it('parses the ways people type a duration', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1:15')).toBe(75);
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('estimates and breaks', () => {
  it('ratio of time used', () => {
    expect(estimateRatio(1800, 60)).toBe(0.5);
    expect(estimateRatio(1800, null)).toBeNull();
  });

  it('remaining estimate ignores done tasks and over-runs', () => {
    const tasks = [
      newTask({ timeEstimateMin: 60, timeSpent: { d: 1200 } }), // 40 left
      newTask({ timeEstimateMin: 30, timeSpent: { d: 3600 } }), // over: 0
      newTask({ timeEstimateMin: 45, status: 'completed' }),
      newTask({ timeEstimateMin: null }),
    ];
    expect(remainingEstimateMin(tasks)).toBe(40);
  });

  it('break is due after the configured stretch', () => {
    expect(breakDue(0, 49 * 60_000, 50)).toBe(false);
    expect(breakDue(0, 50 * 60_000, 50)).toBe(true);
    expect(breakDue(null, 1e9, 50)).toBe(false);
    expect(breakDue(0, 1e9, 0)).toBe(false);
  });
});
