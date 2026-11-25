import { describe, expect, it } from 'vitest';
import { parseClock, parseLength, parseNatural, parseRange } from '../../src/domain/naturalLanguage';
import { alertEvents, alertMoments, alertSignature, alertState, alertsCalendar, effectiveAlerts, tasksWithAlertsOn, toggleAlert } from '../../src/domain/taskAlerts';
import { newTask } from '../../src/db/mutations';

const WED = '2026-11-25'; // a Wednesday

describe('clock words', () => {
  it('reads times, ranges and lengths', () => {
    expect(parseClock('7am')).toBe(420);
    expect(parseClock('7:30pm')).toBe(1170);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('12pm')).toBe(720);
    expect(parseClock('14:00')).toBe(840);
    expect(parseClock('3:30')).toBe(930); // working-hours guess
    expect(parseClock('7')).toBeNull();
    expect(parseClock('3', true)).toBe(900);
    expect(parseClock('9', true)).toBe(540);
    expect(parseRange('9-10:30')).toEqual([540, 630]);
    expect(parseRange('11-1pm')).toEqual([660, 780]);
    expect(parseRange('9am-11am')).toEqual([540, 660]);
    expect(parseRange('2-3pm')).toEqual([840, 900]);
    expect(parseRange('1984-2001')).toBeNull();
    expect(parseLength('1h')).toBe(60);
    expect(parseLength('1h30m')).toBe(90);
    expect(parseLength('1.5h')).toBe(90);
    expect(parseLength('45min')).toBe(45);
    expect(parseLength('90')).toBeNull();
  });
});

describe('parseNatural', () => {
  it('gym tue thu 7am 1h → a weekly repeat with a time', () => {
    const r = parseNatural('Gym tue thu 7am 1h', WED);
    expect(r.title).toBe('Gym');
    expect(r.startTime).toBe('07:00');
    expect(r.durationMin).toBe(60);
    expect(r.repeat).toMatchObject({ freq: 'weekly', weekdays: [2, 4], interval: 1 });
    expect(r.date).toBe('2026-11-26'); // next Thursday is the first one
    expect(r.recognised).toEqual(['7 AM – 8 AM', '↻ every Tue, Thu']);
  });

  it('dates and times in plain words', () => {
    expect(parseNatural('Call Anna tomorrow at 3', WED)).toMatchObject({ title: 'Call Anna', date: '2026-11-26', startTime: '15:00' });
    expect(parseNatural('Review deck fri 9-10:30', WED)).toMatchObject({ title: 'Review deck', date: '2026-11-27', startTime: '09:00', durationMin: 90 });
    expect(parseNatural('Plan next monday', WED)).toMatchObject({ title: 'Plan', date: '2026-11-30' });
    expect(parseNatural('Dinner tonight 7:30pm', WED)).toMatchObject({ title: 'Dinner', date: WED, evening: true, startTime: '19:30' });
    expect(parseNatural('Visa in 2 weeks', WED)).toMatchObject({ title: 'Visa', date: '2026-12-09' });
    expect(parseNatural('Gift dec 24', WED)).toMatchObject({ title: 'Gift', date: '2026-12-24' });
    expect(parseNatural('Taxes 15th of april', WED)).toMatchObject({ title: 'Taxes', date: '2027-04-15' });
    expect(parseNatural('Write report from 2 to 4pm', WED)).toMatchObject({ title: 'Write report', date: WED, startTime: '14:00', durationMin: 120 });
  });

  it('a time with no day means today; a length with no time is an estimate', () => {
    expect(parseNatural('Standup 9:30am', WED)).toMatchObject({ date: WED, startTime: '09:30' });
    expect(parseNatural('Read paper 45 min', WED)).toMatchObject({ title: 'Read paper', estimateMin: 45, startTime: null });
  });

  it('repeats', () => {
    expect(parseNatural('Pay rent every month', WED).repeat).toMatchObject({ freq: 'monthly', anchor: WED });
    expect(parseNatural('Water plants every 3 days', WED).repeat).toMatchObject({ freq: 'daily', interval: 3 });
    expect(parseNatural('Standup every weekday 9:30am for 15m', WED)).toMatchObject({
      title: 'Standup', startTime: '09:30', durationMin: 15, repeat: { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] },
    });
    expect(parseNatural('Review every other friday', WED).repeat).toMatchObject({ interval: 2, weekdays: [5], anchor: '2026-11-27' });
    expect(parseNatural('Daily standup', WED)).toMatchObject({ title: 'standup', repeat: { freq: 'daily' } });
    expect(parseNatural('Clean every mon, wed and fri', WED).repeat).toMatchObject({ weekdays: [1, 3, 5], anchor: WED });
  });

  it('leaves ordinary words and numbers alone', () => {
    expect(parseNatural('Read 1984', WED)).toMatchObject({ title: 'Read 1984', date: null, startTime: null });
    expect(parseNatural('Sat down with Sam', WED)).toMatchObject({ title: 'Sat down with Sam', date: null });
    expect(parseNatural('Buy 3 apples at the store', WED).title).toBe('Buy 3 apples at the store');
    expect(parseNatural('Fix bug', WED)).toMatchObject({ title: 'Fix bug', date: null, repeat: null, recognised: [] });
  });
});

describe('alerts', () => {
  const timed = newTask({ id: 'a', title: 'Gym', startDate: WED, startTime: '07:00', durationMin: 60 });

  it('uses the default only for timed to-dos without their own', () => {
    expect(effectiveAlerts(timed, 5)).toEqual([{ anchor: 'start', beforeMin: 5 }]);
    expect(effectiveAlerts(timed, null)).toEqual([]);
    expect(effectiveAlerts({ ...timed, alerts: [] }, 5)).toEqual([]);
    expect(effectiveAlerts(newTask({ startDate: WED }), 5)).toEqual([]);
    // a deadline alert needs a deadline
    expect(effectiveAlerts({ ...timed, alerts: [{ anchor: 'deadline', beforeMin: 60 }] }, 5)).toEqual([]);
  });

  it('toggles and orders alerts', () => {
    let l = toggleAlert([], { anchor: 'start', beforeMin: 0 });
    l = toggleAlert(l, { anchor: 'start', beforeMin: 15 });
    l = toggleAlert(l, { anchor: 'deadline', beforeMin: 60 });
    expect(l).toEqual([{ anchor: 'start', beforeMin: 15 }, { anchor: 'start', beforeMin: 0 }, { anchor: 'deadline', beforeMin: 60 }]);
    expect(toggleAlert(l, { anchor: 'start', beforeMin: 15 })).toHaveLength(2);
  });

  it('builds calendar events with alarms for start and deadline', () => {
    const t = { ...timed, deadline: '2026-11-27', deadlineTime: '18:00', alerts: [{ anchor: 'start' as const, beforeMin: 10 }, { anchor: 'deadline' as const, beforeMin: 60 }] };
    const ev = alertEvents(t, 5);
    expect(ev.map((e) => e.uid)).toEqual(['clarity-task-a-start@clarity.app', 'clarity-task-a-due@clarity.app']);
    expect(ev[0]).toMatchObject({ start: '20261125T070000', end: '20261125T080000', alarms: [{ offsetMin: -10 }] });
    expect(ev[1]).toMatchObject({ start: '20261127T180000', summary: '⚑ Due: Gym', alarms: [{ offsetMin: -60 }] });
    const ics = alertsCalendar([t], 5);
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics).toContain('TRIGGER:-PT1H');
  });

  it('tracks whether the Calendar copy is current', () => {
    expect(alertState(timed, 5)).toBe('pending');
    const sent = { ...timed, alertsSentSig: alertSignature(timed, effectiveAlerts(timed, 5)) };
    expect(alertState(sent, 5)).toBe('sent');
    expect(alertState({ ...sent, startTime: '08:00' }, 5)).toBe('changed');
    expect(alertState({ ...sent, status: 'completed' }, 5)).toBe('none');
  });

  it('picks the to-dos for a day and the moments to nudge', () => {
    const other = newTask({ id: 'b', startDate: '2026-11-26', startTime: '09:00' });
    expect(tasksWithAlertsOn([timed, other], [WED], 5).map((t) => t.id)).toEqual(['a']);
    const m = alertMoments(timed, 5);
    expect(m).toHaveLength(1);
    expect(new Date(m[0]!.at).getHours()).toBe(6);
    expect(new Date(m[0]!.at).getMinutes()).toBe(55);
    expect(m[0]!.text).toBe('In 5 min: Gym');
  });
});
