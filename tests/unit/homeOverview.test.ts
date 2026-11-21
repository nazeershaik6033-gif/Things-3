import { describe, expect, it } from 'vitest';
import type { CalendarEvent, DailyTarget, Task } from '../../src/db/models';
import { newTask } from '../../src/db/mutations';
import { overviewSummary } from '../../src/domain/homeOverview';

const TODAY = '2026-06-11';
const NOW = Date.parse('2026-06-11T09:00:00Z');

function task(partial: Partial<Task> = {}): Task {
  return newTask({ orderKey: 'a0', bucket: 'anytime', ...partial });
}

function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    date: TODAY,
    start: Date.parse('2026-06-11T14:00:00Z'),
    end: null,
    title: 'Team standup',
    allDay: false,
    calendarUrl: 'file',
    ...partial,
  };
}

function target(partial: Partial<DailyTarget> = {}): DailyTarget {
  return {
    date: TODAY,
    text: 'Finish the migration plan',
    taskId: null,
    outcome: 'pending',
    reflection: '',
    setAt: 1,
    reviewedAt: null,
    ...partial,
  };
}

describe('overviewSummary', () => {
  it('has nothing to say on an empty day', () => {
    const s = overviewSummary([], [], [], TODAY, NOW);
    expect(s.hasContent).toBe(false);
    expect(s.line).toBe('Nothing scheduled');
  });

  it('ignores to-dos that are merely scheduled — only real news counts', () => {
    const tasks = [task({ startDate: TODAY }), task({ deadline: '2026-06-20' })];
    expect(overviewSummary([], tasks, [], TODAY, NOW).hasContent).toBe(false);
  });

  it('counts a target set for today', () => {
    const s = overviewSummary([], [], [target()], TODAY, NOW);
    expect(s.hasTarget).toBe(true);
    expect(s.hasContent).toBe(true);
    expect(s.line).toBe('Target set');
  });

  it('ignores a target belonging to another day', () => {
    const s = overviewSummary([], [], [target({ date: '2026-06-10' })], TODAY, NOW);
    expect(s.hasTarget).toBe(false);
    expect(s.hasContent).toBe(false);
  });

  it('names the soonest event still ahead', () => {
    const events = [
      event({ id: 'later', title: 'Retro', start: Date.parse('2026-06-11T16:00:00Z') }),
      event(),
    ];
    const s = overviewSummary(events, [], [], TODAY, NOW);
    expect(s.nextEventTitle).toBe('Team standup');
    expect(s.line).toBe('Next: Team standup');
  });

  it('drops an event that has already started', () => {
    const past = event({ start: Date.parse('2026-06-11T08:00:00Z') });
    const s = overviewSummary([past], [], [], TODAY, NOW);
    expect(s.nextEventTitle).toBeNull();
    expect(s.hasContent).toBe(false);
  });

  it('counts passed deadlines', () => {
    const tasks = [task({ deadline: '2026-06-10' }), task({ deadline: '2026-06-01' })];
    const s = overviewSummary([], tasks, [], TODAY, NOW);
    expect(s.overdue).toBe(2);
    expect(s.line).toBe('2 overdue');
  });

  it('joins everything it found, in the deck\'s own order', () => {
    const s = overviewSummary(
      [event()],
      [task({ deadline: '2026-06-10' })],
      [target()],
      TODAY,
      NOW,
    );
    expect(s.line).toBe('Target set · Next: Team standup · 1 overdue');
  });

  it('falls back to a placeholder for an untitled event', () => {
    const s = overviewSummary([event({ title: '' })], [], [], TODAY, NOW);
    expect(s.line).toBe('Next: Untitled');
  });
});
