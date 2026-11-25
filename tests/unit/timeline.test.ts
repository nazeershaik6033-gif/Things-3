import { describe, expect, it } from 'vitest';
import { newTask } from '../../src/db/mutations';
import type { CalendarEvent, Sprint, Task } from '../../src/db/models';
import {
  DAY_MIN, allDayEvents, applyEdit, dayBlocks, eventBlock, formatClock, formatRange,
  layoutDay, minuteOfDay, nowAndNext, parseHHMM, pushRest, shiftRemaining, spanFromDrag,
  sprintBlock, taskBlock, taskDuration, taskPatchFor, toHHMM, unscheduledFor,
  type TimeBlock,
} from '../../src/domain/timeline';

const D = '2026-11-25';
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`).getTime();

const task = (p: Partial<Task>): Task => newTask({ title: 'T', startDate: D, bucket: 'anytime', ...p });
const block = (key: string, s: number, e: number, editable = true): TimeBlock => ({
  key, kind: 'task', refId: key, date: D, title: key, startMin: s, endMin: e, done: false, editable,
});
const ev = (p: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', date: D, start: at(D, '10:00'), end: at(D, '11:00'), title: 'Standup',
  allDay: false, calendarUrl: 'x', ...p,
} as CalendarEvent);

describe('clock text', () => {
  it('parses and formats HH:mm', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('morning')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
    expect(toHHMM(570)).toBe('09:30');
    expect(toHHMM(-10)).toBe('00:00');
    expect(toHHMM(5000)).toBe('23:59');
  });

  it('reads like the rest of the app', () => {
    expect(formatClock(540)).toBe('9 AM');
    expect(formatClock(810)).toBe('1:30 PM');
    expect(formatClock(0)).toBe('12 AM');
    expect(formatClock(DAY_MIN)).toBe('12 AM');
    expect(formatRange(540, 570)).toBe('9 – 9:30 AM');
    expect(formatRange(690, 780)).toBe('11:30 AM – 1 PM');
  });
});

describe('blocks', () => {
  it('places a timed to-do with its planned length, then estimate, then default', () => {
    expect(taskBlock(task({ startTime: '09:00', durationMin: 90 }), D)).toMatchObject({ startMin: 540, endMin: 630, editable: true });
    expect(taskDuration({ durationMin: null, timeEstimateMin: 45 })).toBe(45);
    expect(taskDuration({ durationMin: null, timeEstimateMin: null })).toBe(30);
    expect(taskDuration({ durationMin: 1, timeEstimateMin: null })).toBe(5);
  });

  it('only places to-dos timed on that exact day', () => {
    expect(taskBlock(task({ startTime: null }), D)).toBeNull();
    expect(taskBlock(task({ startTime: 'morning' }), D)).toBeNull();
    expect(taskBlock(task({ startTime: '09:00', startDate: '2026-11-24' }), D)).toBeNull();
    expect(taskBlock(task({ startTime: '09:00', trashedAt: 1 }), D)).toBeNull();
    expect(taskBlock(task({ startTime: '09:00', status: 'canceled' }), D)).toBeNull();
    const done = taskBlock(task({ startTime: '09:00', status: 'completed' }), D)!;
    expect(done.done).toBe(true);
    expect(done.editable).toBe(false);
  });

  it('clamps a block that would run past midnight', () => {
    expect(taskBlock(task({ startTime: '23:45', durationMin: 60 }), D)).toMatchObject({ startMin: 1425, endMin: DAY_MIN });
  });

  it('clips calendar events to the day and skips all-day ones', () => {
    expect(eventBlock(ev({}), D)).toMatchObject({ startMin: 600, endMin: 660, editable: false, kind: 'event' });
    expect(eventBlock(ev({ end: at('2026-11-26', '02:00'), start: at(D, '22:00') }), D)).toMatchObject({ startMin: 1320, endMin: DAY_MIN });
    expect(eventBlock(ev({ end: null }), D)).toMatchObject({ startMin: 600, endMin: 630 });
    expect(eventBlock(ev({ allDay: true, start: null, end: null }), D)).toBeNull();
    expect(allDayEvents(D, [ev({ allDay: true, start: null, end: null }), ev({})])).toHaveLength(1);
  });

  it('uses wall-clock minutes across the DST change', () => {
    // 2026-11-01 is the US fall-back day: 1:30 AM happens twice. 9 AM is
    // still minute 540, not 600, because the grid is wall-clock.
    expect(minuteOfDay(at('2026-11-01', '09:00'), '2026-11-01')).toBe(540);
    expect(minuteOfDay(at('2026-10-31', '23:00'), '2026-11-01')).toBe(0);
    expect(minuteOfDay(at('2026-11-02', '01:00'), '2026-11-01')).toBe(DAY_MIN);
  });

  it('shows sprints where they were planned or where they happened', () => {
    const base: Sprint = {
      id: 's', taskId: null, title: 'Write', nextAction: '', durationMin: 25, date: D,
      plannedAt: at(D, '14:00'), startedAt: null, endsAt: null, endedAt: null,
      status: 'planned', completedNote: '', createdAt: 0,
    };
    expect(sprintBlock(base, D)).toMatchObject({ startMin: 840, endMin: 865, done: false });
    expect(sprintBlock({ ...base, status: 'done', startedAt: at(D, '15:00'), endedAt: at(D, '15:20') }, D))
      .toMatchObject({ startMin: 900, endMin: 920, done: true });
    expect(sprintBlock({ ...base, status: 'abandoned' }, D)).toBeNull();
    expect(sprintBlock({ ...base, plannedAt: at('2026-11-26', '14:00') }, D)).toBeNull();
  });

  it('collects one day in start order', () => {
    const blocks = dayBlocks(D, [task({ id: 'b', startTime: '11:00' }), task({ id: 'a', startTime: '08:00' })], [ev({})]);
    expect(blocks.map((b) => b.key)).toEqual(['task:a', 'event:e1', 'task:b']);
  });
});

describe('unscheduled tray', () => {
  it("lists Today's untimed to-dos, including ones rolled over with a stale time", () => {
    const tasks = [
      task({ id: 'untimed' }),
      task({ id: 'timed', startTime: '09:00' }),
      task({ id: 'rolled', startDate: '2026-11-20', startTime: '09:00' }),
      task({ id: 'tomorrow', startDate: '2026-11-26' }),
      task({ id: 'done', status: 'completed' }),
      task({ id: 'inbox', startDate: null }),
    ];
    expect(unscheduledFor(D, tasks, D).map((t) => t.id)).toEqual(['untimed', 'rolled']);
    expect(unscheduledFor('2026-11-26', tasks, D).map((t) => t.id)).toEqual(['tomorrow']);
  });
});

describe('layout', () => {
  it('puts overlapping blocks side by side and leaves the rest full width', () => {
    const placed = layoutDay([block('a', 540, 600), block('b', 570, 630), block('c', 600, 660), block('d', 700, 720)]);
    const by = Object.fromEntries(placed.map((p) => [p.block.key, p]));
    expect(by.a).toMatchObject({ col: 0, cols: 2 });
    expect(by.b).toMatchObject({ col: 1, cols: 2 });
    expect(by.c).toMatchObject({ col: 0, cols: 2 }); // reuses a's column
    expect(by.d).toMatchObject({ col: 0, cols: 1 });
  });

  it('treats touching blocks as not overlapping', () => {
    const placed = layoutDay([block('a', 540, 600), block('b', 600, 660)]);
    expect(placed.every((p) => p.cols === 1)).toBe(true);
  });
});

describe('edits', () => {
  it('moves on the snap grid and stays inside the day', () => {
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'move', 22)).toEqual({ startMin: 555, endMin: 615 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'move', -1000)).toEqual({ startMin: 0, endMin: 60 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'move', 5000)).toEqual({ startMin: 1380, endMin: 1440 });
  });

  it('resizes either edge but never below one snap step', () => {
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'resize-end', 31)).toEqual({ startMin: 540, endMin: 630 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'resize-end', -500)).toEqual({ startMin: 540, endMin: 555 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'resize-start', -30)).toEqual({ startMin: 510, endMin: 600 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'resize-start', 500)).toEqual({ startMin: 585, endMin: 600 });
    expect(applyEdit({ startMin: 540, endMin: 600 }, 'resize-end', 7, 5)).toEqual({ startMin: 540, endMin: 605 });
  });

  it('creates a span from a drag in either direction, or a default from a press', () => {
    expect(spanFromDrag(600, 663)).toEqual({ startMin: 600, endMin: 660 });
    expect(spanFromDrag(663, 600)).toEqual({ startMin: 600, endMin: 660 });
    expect(spanFromDrag(604, 604)).toEqual({ startMin: 600, endMin: 630 });
    expect(spanFromDrag(1439, 1439)).toEqual({ startMin: 1425, endMin: 1440 });
  });

  it('builds the patch for a to-do', () => {
    expect(taskPatchFor(D, { startMin: 555, endMin: 615 })).toEqual({ startDate: D, startTime: '09:15', durationMin: 60 });
  });
});

describe('push the rest', () => {
  const day = [block('a', 540, 600), block('b', 600, 630), block('c', 660, 690), block('ev', 600, 660, false)];

  it('pushes the chain it runs into, and gaps absorb the delay', () => {
    // a runs 20 min long: b is pushed to 10:20–10:50, which still fits
    // before c at 11:00, so c stays.
    const moved = pushRest(day, 'a', { startMin: 540, endMin: 620 });
    expect(moved.get('b')).toEqual({ startMin: 620, endMin: 650 });
    expect(moved.has('c')).toBe(false);
    expect(moved.has('ev')).toBe(false); // events never move
  });

  it('cascades when the gap runs out', () => {
    const moved = pushRest(day, 'a', { startMin: 540, endMin: 660 });
    expect(moved.get('b')).toEqual({ startMin: 660, endMin: 690 });
    expect(moved.get('c')).toEqual({ startMin: 690, endMin: 720 });
  });

  it('leaves blocks that already overlapped alone', () => {
    const moved = pushRest([block('a', 540, 600), block('b', 570, 630)], 'a', { startMin: 540, endMin: 620 });
    expect(moved.size).toBe(0);
  });

  it('never pushes past midnight', () => {
    // b would be pushed to 00:00–00:30 tomorrow; it clamps to the end of the
    // day instead, which is where it already is, so nothing is reported.
    const moved = pushRest([block('a', 1380, 1410), block('b', 1410, 1440)], 'a', { startMin: 1380, endMin: 1440 });
    expect(moved.has('b')).toBe(false);
    const moved2 = pushRest([block('a', 1320, 1350), block('b', 1380, 1410)], 'a', { startMin: 1320, endMin: 1430 });
    expect(moved2.get('b')).toEqual({ startMin: 1410, endMin: 1440 });
  });
});

describe('running late', () => {
  it('shifts what is still ahead by the same amount, gaps kept', () => {
    const day = [block('past', 480, 510), block('a', 600, 630), block('b', 700, 720), block('ev', 650, 700, false)];
    const moved = shiftRemaining(day, 540, 15);
    expect([...moved.keys()]).toEqual(['a', 'b']);
    expect(moved.get('b')).toEqual({ startMin: 715, endMin: 735 });
  });
});

describe('now and next', () => {
  it('finds what is on now and the next thing up', () => {
    const day = [block('a', 540, 600), block('b', 570, 630), block('c', 700, 720)];
    const r = nowAndNext(day, 580);
    expect(r.now.map((b) => b.key)).toEqual(['a', 'b']);
    expect(r.next?.key).toBe('c');
    expect(nowAndNext(day, 800).next).toBeNull();
  });
});
