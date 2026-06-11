import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  addDays, daysBetween, formatDeadline, formatRelative, fromDateStr,
  isValidDateStr, msUntilNextMidnight, toDateStr, todayStr, dateStrOf,
} from '../../src/domain/dates';

afterEach(() => vi.useRealTimers());

describe('dates', () => {
  it('round-trips local dates', () => {
    expect(toDateStr(new Date(2026, 5, 11))).toBe('2026-06-11');
    expect(fromDateStr('2026-06-11').getTime()).toBe(new Date(2026, 5, 11).getTime());
  });

  it('parses as LOCAL date, not UTC', () => {
    const d = fromDateStr('2026-06-11');
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(11);
  });

  it('validates date strings', () => {
    expect(isValidDateStr('2026-06-11')).toBe(true);
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('garbage')).toBe(false);
    expect(isValidDateStr('2026-6-1')).toBe(false);
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });

  it('daysBetween is DST-safe', () => {
    // US DST spring-forward 2026: March 8
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-10-31')).toBe(-1);
  });

  it('addDays across DST transition days', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('msUntilNextMidnight', () => {
    const now = new Date(2026, 5, 11, 23, 0, 0);
    expect(msUntilNextMidnight(now)).toBe(3_600_000);
    const early = new Date(2026, 5, 11, 0, 0, 1);
    expect(msUntilNextMidnight(early)).toBe(86_400_000 - 1000);
  });

  it('todayStr uses fake timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0));
    expect(todayStr()).toBe('2026-06-11');
  });

  it('formatRelative', () => {
    const today = '2026-06-11'; // a Thursday
    expect(formatRelative('2026-06-11', today)).toBe('Today');
    expect(formatRelative('2026-06-12', today)).toBe('Tomorrow');
    expect(formatRelative('2026-06-13', today)).toBe('Saturday');
    expect(formatRelative('2026-06-21', today)).toBe('Jun 21');
    expect(formatRelative('2027-06-21', today)).toBe('Jun 21, 2027');
  });

  it('formatDeadline', () => {
    const today = '2026-06-11';
    expect(formatDeadline('2026-06-11', today)).toBe('today');
    expect(formatDeadline('2026-06-12', today)).toBe('tomorrow');
    expect(formatDeadline('2026-06-10', today)).toBe('yesterday');
    expect(formatDeadline('2026-06-08', today)).toBe('3 days ago');
    expect(formatDeadline('2026-06-14', today)).toBe('3 days left');
    expect(formatDeadline('2026-07-20', today)).toBe('Jul 20');
  });

  it('dateStrOf converts epoch to local date', () => {
    const epoch = new Date(2026, 5, 11, 23, 59).getTime();
    expect(dateStrOf(epoch)).toBe('2026-06-11');
  });
});
