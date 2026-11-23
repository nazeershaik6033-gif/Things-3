import { describe, expect, it } from 'vitest';
import {
  describeRule, isOccurrence, nextAfterCompletion, nextOccurrence, normalizeRule,
  planOccurrences, presetRule,
} from '../../src/domain/repeat';
import type { RepeatRule } from '../../src/db/models';

// 2026-11-23 is a Monday
const MON = '2026-11-23';

function rule(partial: Partial<RepeatRule>): RepeatRule {
  return normalizeRule({ ...presetRule('daily', MON), ...partial });
}

describe('nextOccurrence', () => {
  it('daily every N counts from the anchor', () => {
    const r = rule({ interval: 3 });
    expect(nextOccurrence(r, '2026-11-01')).toBe(MON);
    expect(nextOccurrence(r, MON)).toBe('2026-11-26');
    expect(nextOccurrence(r, '2026-11-27')).toBe('2026-11-29');
  });

  it('weekdays skips the weekend', () => {
    const r = presetRule('weekdays', MON);
    expect(nextOccurrence(r, '2026-11-27')).toBe('2026-11-30'); // Fri -> Mon
    expect(nextOccurrence(r, MON)).toBe('2026-11-24');
  });

  it('every 2 weeks on Mon and Thu keeps the fortnight phase', () => {
    const r = rule({ freq: 'weekly', interval: 2, weekdays: [1, 4] });
    expect(nextOccurrence(r, MON)).toBe('2026-11-26');
    expect(nextOccurrence(r, '2026-11-26')).toBe('2026-12-07');
    expect(isOccurrence(r, '2026-11-30')).toBe(false);
  });

  it('monthly on the 31st clamps to short months', () => {
    const r = rule({ freq: 'monthly', anchor: '2026-01-31' });
    expect(nextOccurrence(r, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(r, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(r, '2026-03-31')).toBe('2026-04-30');
  });

  it('monthly on the Nth weekday and the last weekday', () => {
    // 2026-11-10 is the 2nd Tuesday of November
    const second = rule({ freq: 'monthly', monthMode: 'nthWeekday', anchor: '2026-11-10' });
    expect(nextOccurrence(second, '2026-11-10')).toBe('2026-12-08');
    // 2026-11-24 is the 4th Tuesday; 2026-11-30 is the last Monday (5th)
    const lastMon = rule({ freq: 'monthly', monthMode: 'nthWeekday', anchor: '2026-11-30' });
    expect(nextOccurrence(lastMon, '2026-11-30')).toBe('2026-12-28');
  });

  it('monthly last day', () => {
    const r = rule({ freq: 'monthly', monthMode: 'lastDay', anchor: '2026-01-15' });
    expect(nextOccurrence(r, '2026-01-15')).toBe('2026-01-31');
    expect(nextOccurrence(r, '2026-01-31')).toBe('2026-02-28');
  });

  it('yearly on Feb 29 falls back to Feb 28', () => {
    const r = rule({ freq: 'yearly', anchor: '2028-02-29' });
    expect(nextOccurrence(r, '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(r, '2031-03-01')).toBe('2032-02-29');
  });

  it('stops at until (inclusive)', () => {
    const r = rule({ until: '2026-11-25' });
    expect(nextOccurrence(r, '2026-11-24')).toBe('2026-11-25');
    expect(nextOccurrence(r, '2026-11-25')).toBeNull();
  });
});

describe('nextAfterCompletion', () => {
  it('counts from the day you finished', () => {
    expect(nextAfterCompletion(rule({ interval: 3, afterCompletion: true }), '2026-11-28')).toBe('2026-12-01');
    expect(nextAfterCompletion(rule({ freq: 'monthly', afterCompletion: true }), '2026-01-31')).toBe('2026-02-28');
    expect(nextAfterCompletion(rule({ freq: 'yearly', afterCompletion: true }), '2028-02-29')).toBe('2029-02-28');
  });
});

describe('planOccurrences', () => {
  it('creates today and the next one ahead on first run', () => {
    const r = presetRule('daily', MON);
    expect(planOccurrences({ rule: r, lastDate: null, paused: false }, MON)).toEqual([MON, '2026-11-24']);
  });

  it('a future anchor only creates that one', () => {
    const r = presetRule('weekly', '2026-11-30');
    expect(planOccurrences({ rule: r, lastDate: null, paused: false }, MON)).toEqual(['2026-11-30']);
  });

  it('is a no-op while the next one already exists', () => {
    const r = presetRule('daily', MON);
    expect(planOccurrences({ rule: r, lastDate: '2026-11-24', paused: false }, MON)).toEqual([]);
  });

  it('catches up without piling up: only the latest missed + one ahead', () => {
    const r = presetRule('daily', MON);
    expect(planOccurrences({ rule: r, lastDate: '2026-11-24', paused: false }, '2026-11-30'))
      .toEqual(['2026-11-30', '2026-12-01']);
  });

  it('when the day ahead arrives, makes the next one ahead', () => {
    const r = presetRule('weekdays', MON);
    expect(planOccurrences({ rule: r, lastDate: '2026-11-24', paused: false }, '2026-11-24'))
      .toEqual(['2026-11-25']);
  });

  it('paused and after-completion rules', () => {
    const r = presetRule('daily', MON);
    expect(planOccurrences({ rule: r, lastDate: null, paused: true }, MON)).toEqual([]);
    const ac = { ...r, afterCompletion: true };
    expect(planOccurrences({ rule: ac, lastDate: null, paused: false }, MON)).toEqual([MON]);
    expect(planOccurrences({ rule: ac, lastDate: MON, paused: false }, '2026-12-01')).toEqual([]);
  });
});

describe('describeRule', () => {
  it('reads like a sentence', () => {
    expect(describeRule(presetRule('daily', MON))).toBe('Every day');
    expect(describeRule(presetRule('weekdays', MON))).toBe('Every weekday');
    expect(describeRule(rule({ freq: 'weekly', interval: 2, weekdays: [1, 4] }))).toBe('Every 2 weeks on Mon, Thu');
    expect(describeRule(rule({ freq: 'monthly', anchor: '2026-11-03' }))).toBe('Every month on the 3rd');
    expect(describeRule(rule({ freq: 'monthly', monthMode: 'nthWeekday', anchor: '2026-11-10' }))).toBe('Every month on the 2nd Tue');
    expect(describeRule(rule({ freq: 'yearly', anchor: '2026-03-04' }))).toBe('Every year on Mar 4');
    expect(describeRule(rule({ interval: 3, afterCompletion: true }))).toBe('Every 3 days after completion');
    expect(describeRule(rule({ until: '2026-12-01' }))).toBe('Every day until Dec 1');
  });
});
