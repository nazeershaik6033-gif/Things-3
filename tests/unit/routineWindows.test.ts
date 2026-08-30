import { describe, expect, it } from 'vitest';
import type { RoutineWindow } from '../../src/db/models';
import {
  dateOfWindowKey, formatClock, routineWindowAt, sortedWindows, timeToMinutes, windowKeyOf,
} from '../../src/domain/routineWindows';

/** Tests run with TZ=America/New_York (see vitest.config.ts), so these Date
 *  constructors are local times in that zone. */

function win(id: string, name: string, time: string, orderKey = id): RoutineWindow {
  return { id, name, time, orderKey };
}

const MORNING = win('m', 'Morning', '08:00', 'a0');
const NIGHT = win('n', 'Night', '20:00', 'a1');
const WINDOWS = [MORNING, NIGHT];

/** 2026-06-11 at the given local hour/minute. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 5, 11, hour, minute, 0, 0);
}

describe('time parsing', () => {
  it('reads HH:MM as minutes past midnight', () => {
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('20:30')).toBe(1230);
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('treats an unparseable time as midnight rather than throwing', () => {
    expect(timeToMinutes('')).toBe(0);
    expect(timeToMinutes('nonsense')).toBe(0);
  });

  it('formats a 12-hour clock', () => {
    expect(formatClock('08:00')).toBe('8:00 AM');
    expect(formatClock('20:30')).toBe('8:30 PM');
    expect(formatClock('00:15')).toBe('12:15 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
  });

  it('sorts windows by clock time, not by insertion order', () => {
    const out = sortedWindows([NIGHT, MORNING]);
    expect(out.map((w) => w.id)).toEqual(['m', 'n']);
  });
});

describe('routineWindowAt', () => {
  it('returns null when there are no windows', () => {
    expect(routineWindowAt([], null, at(10))).toBeNull();
  });

  it('picks the morning window mid-morning and spans back to last night', () => {
    const span = routineWindowAt(WINDOWS, null, at(10))!;
    expect(span.activeId).toBe('m');
    expect(span.selectedId).toBe('m');
    expect(span.upcomingAt).toBeNull();
    expect(span.key).toBe('2026-06-11#m');
    expect(new Date(span.start)).toEqual(new Date(2026, 5, 10, 20, 0));
    // The span ends at "now" while the window is still live.
    expect(span.end).toBe(at(10).getTime());
  });

  it('picks the night window in the evening', () => {
    const span = routineWindowAt(WINDOWS, null, at(21))!;
    expect(span.activeId).toBe('n');
    expect(span.key).toBe('2026-06-11#n');
    expect(new Date(span.start)).toEqual(new Date(2026, 5, 11, 8, 0));
  });

  it('after midnight the live window is still last night, spanning back into yesterday', () => {
    const span = routineWindowAt(WINDOWS, null, new Date(2026, 5, 11, 0, 30))!;
    expect(span.activeId).toBe('n');
    // Yesterday's night window, not today's — it has not come round again yet.
    expect(span.key).toBe('2026-06-10#n');
    expect(new Date(span.start)).toEqual(new Date(2026, 5, 10, 8, 0));
  });

  it('after midnight a non-live window that has not opened today reads as upcoming', () => {
    const span = routineWindowAt(WINDOWS, 'm', new Date(2026, 5, 11, 0, 30))!;
    expect(span.activeId).toBe('n');
    expect(span.upcomingAt).toBe(new Date(2026, 5, 11, 8, 0).getTime());
    expect(span.key).toBe('');
  });

  it('marks a window that has not come round yet today as upcoming', () => {
    const span = routineWindowAt(WINDOWS, 'n', at(10))!;
    expect(span.activeId).toBe('m');
    expect(span.selectedId).toBe('n');
    expect(span.upcomingAt).toBe(new Date(2026, 5, 11, 20, 0).getTime());
    expect(span.key).toBe('');
    expect(span.start).toBe(0);
  });

  it('lets you look back at an earlier window that already happened today', () => {
    const span = routineWindowAt(WINDOWS, 'm', at(21))!;
    expect(span.activeId).toBe('n');
    expect(span.selectedId).toBe('m');
    expect(span.upcomingAt).toBeNull();
    expect(span.key).toBe('2026-06-11#m');
    // A closed window ends where the next one opened, not at "now".
    expect(new Date(span.end)).toEqual(new Date(2026, 5, 11, 20, 0));
  });

  it('spans the whole day back to the previous occurrence with a single window', () => {
    const span = routineWindowAt([MORNING], null, at(10))!;
    expect(span.key).toBe('2026-06-11#m');
    expect(new Date(span.start)).toEqual(new Date(2026, 5, 10, 8, 0));
  });

  it('keeps the window keyed by its own date across a rollover', () => {
    const morning = routineWindowAt(WINDOWS, null, at(10))!;
    const night = routineWindowAt(WINDOWS, null, at(21))!;
    expect(morning.key).not.toBe(night.key);
    expect(dateOfWindowKey(morning.key)).toBe('2026-06-11');
  });
});

describe('windowKeyOf', () => {
  it('joins date and window id', () => {
    expect(windowKeyOf('2026-06-11', 'm')).toBe('2026-06-11#m');
    expect(dateOfWindowKey(windowKeyOf('2026-06-11', 'm'))).toBe('2026-06-11');
  });
});
