import { Show, type JSX } from 'solid-js';
import type { CalendarEvent } from '../db/models';
import { createTask } from '../db/mutations';
import { calendarColor, extraCalendars } from '../app/calendar';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { formatRelative } from '../domain/dates';
import { currentDate } from '../app/currentDate';
import { DAY_MIN, formatClock, formatRange, minuteOfDay, toHHMM } from '../domain/timeline';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { Icon } from '../ui/Icon';

/** A calendar event, read-only, with the two ways to act on it (TaskNotes'
 *  "create task from event"): make the event itself a to-do at its time, or
 *  add a prep to-do in the half hour before it. */

const PREP_MIN = 30;

export function EventSheet(props: { event: CalendarEvent; onClose: () => void }): JSX.Element {
  const e = () => props.event;
  const span = () => {
    if (e().allDay || e().start === null) return null;
    const s = minuteOfDay(e().start!, e().date);
    const end = e().end !== null && e().end! > e().start! ? minuteOfDay(e().end!, e().date) : s + 30;
    return { s, end: Math.min(DAY_MIN, Math.max(s + 5, end)) };
  };
  const calName = () =>
    e().calendarUrl === 'file' ? 'Imported file'
    : extraCalendars().find((c) => c.url === e().calendarUrl)?.name ?? 'Calendar';

  const makeTodo = async () => {
    haptic('success');
    const sp = span();
    await undoable('Add to-do', () => createTask({
      title: e().title,
      startDate: e().date,
      bucket: 'anytime',
      startTime: sp ? toHHMM(sp.s) : null,
      durationMin: sp ? sp.end - sp.s : null,
      notes: `From calendar: ${e().title}`,
    }), 'Added as a to-do');
    props.onClose();
  };

  const makePrep = async () => {
    haptic('success');
    const sp = span();
    const start = sp ? Math.max(0, sp.s - PREP_MIN) : null;
    await undoable('Add to-do', () => createTask({
      title: `Prep: ${e().title}`,
      startDate: e().date,
      bucket: 'anytime',
      startTime: start !== null ? toHHMM(start) : null,
      durationMin: start !== null ? sp!.s - start : PREP_MIN,
    }), sp ? `Prep added at ${formatClock(start!)}` : 'Prep to-do added');
    props.onClose();
  };

  const btn = (primary: boolean) => ({
    display: 'flex', 'align-items': 'center', gap: '8px', width: '100%', padding: '12px 14px',
    'border-radius': '12px', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)',
    background: primary ? 'var(--blue)' : 'var(--bg-inset)', color: primary ? '#fff' : 'var(--text)',
  }) as const;

  return (
    <Sheet onClose={props.onClose} dragAnywhere>
      <SheetTitle>Calendar event</SheetTitle>
      <div data-testid="event-sheet" style={{ padding: '0 20px 16px', display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', 'align-items': 'flex-start' }}>
          <span style={{ width: '4px', 'align-self': 'stretch', 'border-radius': '2px', background: calendarColor(e().calendarUrl) }} />
          <div>
            <div style={{ 'font-size': 'calc(18px * var(--ts))', 'font-weight': 'var(--fw-600)' }}>{e().title}</div>
            <div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)', 'margin-top': '2px' }}>
              {formatRelative(e().date, currentDate())} · {span() ? formatRange(span()!.s, span()!.end) : 'all day'} · {calName()}
            </div>
          </div>
        </div>
        <button data-testid="event-to-todo" onClick={() => void makeTodo()} style={btn(true)}>
          <Icon name="checklist" size={17} /> Make it a to-do
        </button>
        <button data-testid="event-prep" onClick={() => void makePrep()} style={btn(false)}>
          <Icon name="clock" size={17} />
          <Show when={span()} fallback={<>Add a prep to-do</>}>Add a prep to-do before it ({PREP_MIN}m)</Show>
        </button>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>
          Events are read-only here — edit them in your calendar app.
        </div>
      </div>
    </Sheet>
  );
}
