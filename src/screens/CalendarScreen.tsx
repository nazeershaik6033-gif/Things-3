import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import type { DateStr } from '../db/models';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { staggerDelay } from '../app/motion';
import { push } from '../app/navigation';
import { formatRelative, formatTime, weekdayName } from '../domain/dates';
import {
  entriesOn, googleCalendarUrl, markedDays, monthAgenda, monthLabel, monthOf,
  type AgendaEntry, type MonthStr,
} from '../domain/calendarMonth';
import { refreshCalendar } from '../app/calendar';
import { MonthCalendar } from '../components/MonthCalendar';
import { Icon } from '../ui/Icon';
import { ScreenChrome } from './common';
import { setExpandedTaskId } from '../app/uiState';

function EntryRow(props: { entry: AgendaEntry; onOpenTask: (id: string) => void }): JSX.Element {
  const e = () => props.entry;
  const timeLabel = () =>
    e().kind === 'task' ? (e().reason === 'deadline' ? 'due' : 'plan')
    : e().start !== null ? formatTime(e().start!)
    : 'all-day';
  return (
    <div
      class={e().kind === 'task' ? 'pressable' : undefined}
      onClick={() => e().kind === 'task' && props.onOpenTask(e().id)}
      style={{
        display: 'flex',
        'align-items': 'baseline',
        gap: '10px',
        padding: '9px 14px',
        cursor: e().kind === 'task' ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          'min-width': '60px',
          'font-size': '12px',
          'font-weight': '600',
          'font-variant-numeric': 'tabular-nums',
          color: e().kind === 'task' && e().reason === 'deadline' ? 'var(--red)' : 'var(--text-secondary)',
        }}
      >
        {timeLabel()}
      </span>
      <span
        style={{
          flex: '1',
          'min-width': '0',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
          color: 'var(--text)',
        }}
      >
        {e().title || 'Untitled'}
      </span>
      <Show when={e().kind === 'task'}>
        <Icon name="check" size={13} color="var(--text-tertiary)" strokeWidth={2.6} />
      </Show>
    </div>
  );
}

function DayCard(props: {
  date: DateStr;
  entries: AgendaEntry[];
  today: DateStr;
  pinned?: boolean;
  onOpenTask: (id: string) => void;
  delay?: string;
}): JSX.Element {
  return (
    <div
      class="rise"
      data-testid={props.pinned ? 'pinned-day' : 'agenda-day'}
      data-date={props.date}
      style={{
        margin: props.pinned ? '2px 10px 14px' : '0 10px 10px',
        'border-radius': 'var(--radius-card)',
        background: 'var(--bg-list)',
        border: props.pinned ? '1.5px solid var(--blue)' : '1px solid var(--separator)',
        'box-shadow': props.pinned ? 'var(--shadow-card)' : 'none',
        overflow: 'hidden',
        'animation-delay': props.delay ?? '0ms',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          padding: '10px 14px 8px',
          background: props.pinned ? 'var(--bg-inset)' : 'transparent',
        }}
      >
        <span style={{ 'font-weight': '700', 'font-size': '15px', color: props.pinned ? 'var(--blue)' : 'var(--text)' }}>
          {weekdayName(props.date).slice(0, 3)}, {props.date.slice(8, 10).replace(/^0/, '')}{' '}
          {monthLabel(monthOf(props.date)).split(' ')[0]}
        </span>
        <span style={{ color: 'var(--text-tertiary)', 'font-size': '13px' }}>
          {formatRelative(props.date, props.today)}
        </span>
        <span style={{ flex: '1' }} />
        <Show when={props.pinned}>
          <span style={{ 'font-size': '11px', 'font-weight': '700', color: 'var(--blue)', 'letter-spacing': '0.06em' }}>
            SELECTED
          </span>
        </Show>
      </div>
      <Show
        when={props.entries.length > 0}
        fallback={
          <div style={{ padding: '4px 14px 14px', color: 'var(--text-tertiary)', 'font-size': '14px' }}>
            Nothing scheduled.
          </div>
        }
      >
        <For each={props.entries}>{(entry) => <EntryRow entry={entry} onOpenTask={props.onOpenTask} />}</For>
        <div style={{ height: '6px' }} />
      </Show>
    </div>
  );
}

/** Month calendar: the grid, the selected day pinned above everything, then
 *  the entire month as one list. Events come from the ICS subscription and are
 *  read-only; to-dos with a date for that month are folded in so the month
 *  actually reflects the plan rather than half of it. */
export function CalendarScreen(): JSX.Element {
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const [month, setMonth] = createSignal<MonthStr>(monthOf(currentDate()));
  const [selected, setSelected] = createSignal<DateStr | null>(currentDate());
  const [status, setStatus] = createSignal('');

  const agenda = createMemo(() => monthAgenda(events(), tasks(), month()));
  const marked = createMemo(() => markedDays(events(), tasks(), month()));
  const pinnedEntries = createMemo(() =>
    selected() ? entriesOn(events(), tasks(), selected()!) : [],
  );
  const totalEntries = createMemo(() => agenda().reduce((n, d) => n + d.entries.length, 0));

  /** Land somewhere the to-do actually lives, then expand it there. */
  const openTask = (id: string) => {
    const t = tasks().find((x) => x.id === id);
    if (!t) return;
    setExpandedTaskId(id);
    if (t.projectId) push({ name: 'project', id: t.projectId });
    else if ((t.startDate ?? t.deadline ?? currentDate()) > currentDate()) {
      push({ name: 'list', list: 'upcoming' });
    } else push({ name: 'list', list: 'today' });
  };

  const refresh = async () => {
    setStatus('Refreshing…');
    const result = await refreshCalendar(true);
    setStatus(result ? result.message : 'No calendar subscription set — add one in Settings.');
  };

  return (
    <ScreenChrome
      title="Calendar"
      icon={<Icon name="calendar" size={28} color="var(--red)" />}
      subtitle={`${totalEntries()} ${totalEntries() === 1 ? 'entry' : 'entries'} in ${monthLabel(month())}`}
      trailing={
        <button
          aria-label="Refresh calendar"
          data-testid="calendar-refresh"
          onClick={() => void refresh()}
          style={{ color: 'var(--blue)', padding: '8px 10px', display: 'flex' }}
        >
          <Icon name="restore" size={19} />
        </button>
      }
    >
      <MonthCalendar
        month={month()}
        onMonthChange={(m) => {
          setMonth(m);
          // Keep a selection inside the visible month so the pin always matches
          setSelected(m === monthOf(currentDate()) ? currentDate() : `${m}-01`);
        }}
        selected={selected()}
        onSelect={setSelected}
        today={currentDate()}
        marked={marked()}
      />

      <Show when={status()}>
        <div style={{ padding: '2px 18px 10px', color: 'var(--text-secondary)', 'font-size': '13px' }}>
          {status()}
        </div>
      </Show>

      <Show when={selected()}>
        <DayCard
          pinned
          date={selected()!}
          entries={pinnedEntries()}
          today={currentDate()}
          onOpenTask={openTask}
        />
        <a
          href={googleCalendarUrl(selected()!)}
          target="_blank"
          rel="noreferrer"
          data-testid="add-google-event"
          class="pressable"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            margin: '0 16px 4px',
            color: 'var(--blue)',
            'font-size': '16px',
            'font-weight': '500',
            'text-decoration': 'none',
          }}
        >
          <Icon name="plus" size={17} />
          Add event in Google Calendar
        </a>
        <p style={{ padding: '4px 18px 14px', color: 'var(--text-tertiary)', 'font-size': '13px', 'line-height': '1.45' }}>
          Opens Google Calendar prefilled for this day — save it there and it
          appears here after the next refresh. Set the reminder in Google
          Calendar too.
        </p>
      </Show>

      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          padding: '4px 18px 8px',
          'border-bottom': '1px solid var(--separator)',
          margin: '0 0 10px',
        }}
      >
        <span style={{ flex: '1', 'font-weight': '700', 'font-size': '15px' }}>
          All of {monthLabel(month())}
        </span>
      </div>

      <Show
        when={agenda().length > 0}
        fallback={
          <div style={{ padding: '10px 18px 40px', color: 'var(--text-tertiary)', 'font-size': '15px' }}>
            Nothing scheduled this month. Calendar events come from the iCal
            subscription in Settings; dated to-dos show up here automatically.
          </div>
        }
      >
        <For each={agenda()}>
          {(day, i) => (
            <DayCard
              date={day.date}
              entries={day.entries}
              today={currentDate()}
              onOpenTask={openTask}
              delay={staggerDelay(i())}
            />
          )}
        </For>
      </Show>
    </ScreenChrome>
  );
}
