import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Task } from '../../src/db/models';
import { newTask } from '../../src/db/mutations';
import {
  entriesOn, firstDayOf, googleCalendarUrl, lastDayOf, markedDays, monthAgenda,
  monthLabel, monthOf, monthWeeks, nextEvent, shiftMonth, taskEntries,
  weekdayLabels,
} from '../../src/domain/calendarMonth';

const TODAY = '2026-08-10';

function event(partial: Partial<CalendarEvent> & { date: string }): CalendarEvent {
  return {
    id: partial.id ?? `e-${partial.date}-${partial.title ?? ''}`,
    date: partial.date,
    start: partial.start ?? null,
    end: partial.end ?? null,
    title: partial.title ?? 'Event',
    allDay: partial.allDay ?? partial.start === undefined,
    calendarUrl: 'file',
  };
}

/** Local wall-clock epoch ms, matching how the ICS parser stores starts. */
function at(date: string, hour: number, minute = 0): number {
  return new Date(
    Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
    hour, minute,
  ).getTime();
}

function task(partial: Partial<Task>): Task {
  return newTask({ orderKey: 'a0', ...partial });
}

describe('month arithmetic', () => {
  it('derives bounds and labels', () => {
    expect(monthOf('2026-08-17')).toBe('2026-08');
    expect(firstDayOf('2026-08')).toBe('2026-08-01');
    expect(lastDayOf('2026-08')).toBe('2026-08-31');
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2028-02')).toBe('2028-02-29'); // leap year
    expect(monthLabel('2026-08')).toBe('August 2026');
  });

  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('monthWeeks', () => {
  it('pads the first row and covers every day exactly once', () => {
    const weeks = monthWeeks('2026-08', 1); // Aug 1 2026 is a Saturday
    expect(weeks[0]!.slice(0, 5).every((d) => d === null)).toBe(true);
    expect(weeks[0]![5]).toBe('2026-08-01');
    const days = weeks.flat().filter((d): d is string => d !== null);
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days[30]).toBe('2026-08-31');
  });

  it('honours the week start', () => {
    expect(weekdayLabels(1)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(weekdayLabels(0)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    // Sunday-first shifts Aug 1 one cell later in the row
    expect(monthWeeks('2026-08', 0)[0]![6]).toBe('2026-08-01');
  });

  it('never leaks days from a neighbouring month', () => {
    for (const cell of monthWeeks('2026-08').flat()) {
      if (cell !== null) expect(monthOf(cell)).toBe('2026-08');
    }
  });
});

describe('taskEntries', () => {
  it('places a to-do on its deadline, not also on its start date', () => {
    const entries = taskEntries([
      task({ id: 't', title: 'Ship', startDate: '2026-08-03', deadline: '2026-08-14', bucket: 'anytime' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: '2026-08-14', reason: 'deadline' });
  });

  it('falls back to the start date when there is no deadline', () => {
    const entries = taskEntries([task({ id: 't', startDate: '2026-08-03', bucket: 'anytime' })]);
    expect(entries[0]).toMatchObject({ date: '2026-08-03', reason: 'start' });
  });

  it('ignores completed, trashed and undated to-dos', () => {
    const entries = taskEntries([
      task({ startDate: '2026-08-03', status: 'completed', bucket: 'anytime' }),
      task({ startDate: '2026-08-04', trashedAt: 1, bucket: 'anytime' }),
      task({ bucket: 'anytime' }),
    ]);
    expect(entries).toEqual([]);
  });
});

describe('monthAgenda', () => {
  const events = [
    event({ date: '2026-08-17', title: 'Sam KIMS Appointment', start: at('2026-08-17', 23, 52) }),
    event({ date: '2026-08-17', title: 'Standup', start: at('2026-08-17', 9) }),
    event({ date: '2026-08-17', title: 'Holiday', allDay: true }),
    event({ date: '2026-08-02', title: 'Brunch', start: at('2026-08-02', 11) }),
    event({ date: '2026-09-01', title: 'Next month', allDay: true }),
  ];
  const tasks = [task({ id: 't1', title: 'File taxes', deadline: '2026-08-17', bucket: 'anytime' })];

  it('groups the whole month by day, oldest first', () => {
    const agenda = monthAgenda(events, tasks, '2026-08');
    expect(agenda.map((d) => d.date)).toEqual(['2026-08-02', '2026-08-17']);
  });

  it('orders a day as all-day, then timed by clock, then to-dos', () => {
    const day = monthAgenda(events, tasks, '2026-08').at(-1)!;
    expect(day.entries.map((e) => e.title)).toEqual([
      'Holiday', 'Standup', 'Sam KIMS Appointment', 'File taxes',
    ]);
  });

  it('excludes other months', () => {
    const titles = monthAgenda(events, tasks, '2026-08').flatMap((d) => d.entries.map((e) => e.title));
    expect(titles).not.toContain('Next month');
  });

  it('marks exactly the days that carry something', () => {
    expect([...markedDays(events, tasks, '2026-08')].sort()).toEqual(['2026-08-02', '2026-08-17']);
  });

  it('entriesOn matches the day inside the month agenda', () => {
    expect(entriesOn(events, tasks, '2026-08-17')).toEqual(
      monthAgenda(events, tasks, '2026-08').at(-1)!.entries,
    );
    expect(entriesOn(events, tasks, '2026-08-05')).toEqual([]);
  });
});

describe('nextEvent', () => {
  const events = [
    event({ date: TODAY, title: 'Passed', start: at(TODAY, 8) }),
    event({ date: TODAY, title: 'Later today', start: at(TODAY, 18) }),
    event({ date: '2026-08-12', title: 'Thursday', start: at('2026-08-12', 9) }),
    event({ date: '2026-08-01', title: 'Long gone', start: at('2026-08-01', 9) }),
  ];

  it('skips events that already started', () => {
    expect(nextEvent(events, at(TODAY, 12), TODAY)!.title).toBe('Later today');
  });

  it('rolls over to the next day once today is done', () => {
    expect(nextEvent(events, at(TODAY, 20), TODAY)!.title).toBe('Thursday');
  });

  it('keeps an all-day event for the whole of its day', () => {
    const withAllDay = [...events, event({ date: TODAY, title: 'Festival', allDay: true })];
    expect(nextEvent(withAllDay, at(TODAY, 20), TODAY)!.title).toBe('Festival');
  });

  it('returns null when nothing is ahead', () => {
    expect(nextEvent([], Date.now(), TODAY)).toBeNull();
  });
});

describe('googleCalendarUrl', () => {
  it('prefills the composer for the given day', () => {
    expect(googleCalendarUrl('2026-08-17')).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260817T090000/20260817T100000',
    );
  });
});
