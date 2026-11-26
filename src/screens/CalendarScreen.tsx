import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { refreshCalendar } from '../app/calendar';
import { push } from '../app/navigation';
import { todayStr, toDateStr, fromDateStr, formatTime, formatRelative } from '../domain/dates';
import type { DateStr } from '../db/models';
import { Icon } from '../ui/Icon';
import { googleCalendarEventUrl } from '../domain/googleCal';
import {
  dayStats, dotCount, entriesOn, isoWeek, monthAgenda, monthWeeks, weekdayLabels, type AgendaEntry,
} from '../domain/calendarMonth';
import { focusPlannerOn, setPlannerDays, showWeekNumbers, weekStart } from '../app/planner';
import { YearView } from '../components/YearView';
import { staggerDelay } from '../app/motion';
import { setExpandedTaskId } from '../app/uiState';
import { ScreenChrome } from './common';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function CalendarScreen(): JSX.Element {
  const today = todayStr();
  const t = fromDateStr(today);
  const [year, setYear] = createSignal(t.getFullYear());
  const [month, setMonth] = createSignal(t.getMonth());
  const [selected, setSelected] = createSignal<DateStr>(today);
  const [status, setStatus] = createSignal('');
  const [refreshing, setRefreshing] = createSignal(false);

  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  // Dated to-dos join the calendar: a month of subscribed events alone is
  // empty for anyone who hasn't linked a feed, and this is a to-do app.
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);

  // Auto-refresh on open (throttled internally to once/hour)
  onMount(() => { void refreshCalendar(); });

  const doRefresh = async () => {
    setRefreshing(true);
    setStatus('Updating…');
    const r = await refreshCalendar(true);
    setStatus(r ? r.message : 'No calendar linked yet — add one in Settings.');
    setRefreshing(false);
  };

  const monthStr = createMemo(() => `${year()}-${String(month() + 1).padStart(2, '0')}`);
  const [view, setView] = createSignal<'month' | 'year'>('month');
  const weeks = createMemo(() => monthWeeks(monthStr(), weekStart()));
  const gridCols = () => (showWeekNumbers() ? '22px repeat(7, 1fr)' : 'repeat(7, 1fr)');
  const stats = createMemo(() => dayStats(events(), tasks(), `${monthStr()}-01`, `${monthStr()}-31`));
  const yearStats = createMemo(() => (view() === 'year' ? dayStats(events(), tasks(), `${year()}-01-01`, `${year()}-12-31`) : new Map()));
  const openPlanner = (date: DateStr, days: 1 | 7) => {
    setPlannerDays(days);
    focusPlannerOn(date);
    push({ name: 'planner' });
  };
  const dayEvents = createMemo(() => entriesOn(events(), tasks(), selected()));
  /** Every day of the month that has something on it, oldest first. */
  const agenda = createMemo(() => monthAgenda(events(), tasks(), monthStr()));
  const monthCount = createMemo(() => agenda().reduce((n, d) => n + d.entries.length, 0));

  /** Land on a screen where the to-do actually lives, then expand it there. */
  const openTask = (id: string) => {
    const t = tasks().find((x) => x.id === id);
    if (!t) return;
    setExpandedTaskId(id);
    if (t.projectId) push({ name: 'project', id: t.projectId });
    else if ((t.startDate ?? t.deadline ?? today) > today) push({ name: 'list', list: 'upcoming' });
    else push({ name: 'list', list: 'today' });
  };

  const entryTime = (e: AgendaEntry) =>
    e.kind === 'task' ? (e.reason === 'deadline' ? 'due' : 'plan')
    : e.start !== null ? formatTime(e.start)
    : 'all-day';

  const EntryRow = (props: { entry: AgendaEntry }): JSX.Element => (
    <div
      class={props.entry.kind === 'task' ? 'pressable' : undefined}
      onClick={() => props.entry.kind === 'task' && openTask(props.entry.id)}
      style={{
        display: 'flex', 'align-items': 'baseline', gap: '10px', padding: '8px 0',
        'border-bottom': '1px solid var(--separator)',
        cursor: props.entry.kind === 'task' ? 'pointer' : 'default',
      }}
    >
      <span style={{
        'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-600)', 'min-width': '54px',
        'font-variant-numeric': 'tabular-nums',
        color: props.entry.kind === 'task' && props.entry.reason === 'deadline'
          ? 'var(--red)' : 'var(--text-secondary)',
      }}>
        {entryTime(props.entry)}
      </span>
      <span style={{ color: 'var(--text)', 'font-size': 'calc(15px * var(--ts))' }}>
        {props.entry.title || 'Untitled'}
      </span>
    </div>
  );

  const changeMonth = (delta: number) => {
    const m = month() + delta;
    const d = new Date(year(), m, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const fmtSelected = () => {
    const d = fromDateStr(selected());
    return `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };

  return (
    <ScreenChrome
      title="Calendar"
      icon={<Icon name="calendar" size={28} color="var(--red)" />}
      trailing={
        <button
          aria-label="Refresh calendar"
          data-testid="calendar-refresh"
          disabled={refreshing()}
          onClick={() => void doRefresh()}
          style={{ color: 'var(--blue)', padding: '8px 12px', 'font-size': 'calc(15px * var(--ts))', opacity: refreshing() ? '0.5' : '1' }}
        >
          <Icon name="restore" size={18} />
        </button>
      }
    >
      {/* Views: Month and Year here; Week and Day open the Planner */}
      <div style={{ display: 'flex', gap: '2px', margin: '0 16px 8px', padding: '2px', 'border-radius': '10px', background: 'var(--bg-inset)', width: 'fit-content' }}>
        {(['day', 'week', 'month', 'year'] as const).map((v) => (
          <button
            data-testid={`cal-view-${v}`}
            aria-pressed={view() === v}
            onClick={() => (v === 'day' ? openPlanner(selected(), 1) : v === 'week' ? openPlanner(selected(), 7) : setView(v))}
            style={{
              padding: '5px 12px', 'border-radius': '8px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
              background: view() === v ? 'var(--bg-card)' : 'transparent',
              color: view() === v ? 'var(--text)' : 'var(--text-secondary)',
              'box-shadow': view() === v ? 'var(--shadow-card)' : 'none',
            }}
          >
            {v[0]!.toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <Show when={view() === 'year'}>
        <YearView
          year={year()}
          today={today}
          stats={yearStats()}
          weekStart={weekStart()}
          onYear={(d) => setYear(year() + d)}
          onMonth={(m) => {
            setMonth(m);
            setView('month');
          }}
        />
      </Show>

      <Show when={view() === 'month'}>
      {/* Month header */}
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '4px 16px 8px' }}>
        <button aria-label="Previous month" data-testid="cal-prev" onClick={() => changeMonth(-1)}
          style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-left" size={18} />
        </button>
        <div data-testid="cal-month-label" style={{ 'font-size': 'calc(17px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text)' }}>
          {MONTHS[month()]} {year()}
        </div>
        <button aria-label="Next month" data-testid="cal-next" onClick={() => changeMonth(1)}
          style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      {/* Weekday header (week start from Settings; optional week numbers) */}
      <div style={{ display: 'grid', 'grid-template-columns': gridCols(), padding: '0 12px' }}>
        <Show when={showWeekNumbers()}><div /></Show>
        <For each={weekdayLabels(weekStart())}>
          {(w) => (
            <div style={{ 'text-align': 'center', 'font-size': 'calc(11px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text-tertiary)', padding: '2px 0 6px' }}>
              {w}
            </div>
          )}
        </For>
      </div>

      {/* Month grid: dots grow with how full the day was; a ring means
          something on it is still open (after the calendar plugin's meters) */}
      <div data-testid="cal-grid" style={{ display: 'grid', 'grid-template-columns': gridCols(), padding: '0 12px', gap: '2px' }}>
        <For each={weeks()}>
          {(row) => (
            <>
              <Show when={showWeekNumbers()}>
                <button
                  data-testid="cal-weeknum"
                  title="Open this week in the Planner"
                  onClick={() => openPlanner(row.find((d) => d) ?? today, 7)}
                  style={{ 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-tertiary)', 'font-variant-numeric': 'tabular-nums', padding: '7px 0 0' }}
                >
                  {isoWeek(row.find((d) => d)!)}
                </button>
              </Show>
              <For each={row}>
                {(date) => (
                  <Show when={date} fallback={<div />}>
                    <button
                      data-testid={date === today ? 'cal-today' : undefined}
                      data-date={date!}
                      onClick={() => setSelected(date!)}
                      style={{
                        display: 'flex',
                        'flex-direction': 'column',
                        'align-items': 'center',
                        padding: '5px 0 3px',
                        'border-radius': '10px',
                        background: selected() === date ? 'var(--blue)' : 'transparent',
                      }}
                    >
                      <span style={{
                        'font-size': 'calc(15px * var(--ts))',
                        'font-variant-numeric': 'tabular-nums',
                        'font-weight': date === today ? 'var(--fw-700)' : 'var(--fw-400)',
                        color: selected() === date ? '#fff' : date === today ? 'var(--blue)' : 'var(--text)',
                      }}>
                        {Number(date!.slice(8))}
                      </span>
                      <span data-testid="cal-dots" data-dots={dotCount(stats().get(date!))} data-open={stats().get(date!)?.open ? '1' : '0'}
                        style={{ display: 'flex', gap: '2px', height: '5px', 'margin-top': '2px' }}>
                        <For each={Array.from({ length: dotCount(stats().get(date!)) })}>
                          {() => <span style={{ width: '4px', height: '4px', 'border-radius': '50%', background: selected() === date ? '#fff' : 'var(--red)' }} />}
                        </For>
                        <Show when={stats().get(date!)?.open && date! >= today}>
                          <span style={{ width: '4px', height: '4px', 'border-radius': '50%', border: `1px solid ${selected() === date ? '#fff' : 'var(--blue)'}`, 'box-sizing': 'border-box' }} />
                        </Show>
                        <Show when={stats().get(date!)?.open && date! < today}>
                          <span style={{ width: '4px', height: '4px', 'border-radius': '50%', border: `1px solid ${selected() === date ? '#fff' : 'var(--red)'}`, 'box-sizing': 'border-box' }} />
                        </Show>
                      </span>
                    </button>
                  </Show>
                )}
              </For>
            </>
          )}
        </For>
      </div>

      {/* The selected day, pinned above the month */}
      <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '14px 16px 4px' }}>
        <span style={{ 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px' }}>
          {fmtSelected()}
        </span>
        <span style={{ 'font-size': 'calc(11px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--blue)', 'letter-spacing': '0.06em' }}>
          SELECTED
        </span>
      </div>
      <div
        data-testid="cal-day-events"
        data-date={selected()}
        style={{
          background: 'var(--bg-inset)',
          'border-radius': '12px',
          margin: '0 12px 14px',
          padding: '6px 14px',
          border: '1.5px solid var(--blue)',
        }}
      >
        <Show
          when={dayEvents().length > 0}
          fallback={
            <div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 0' }}>
              No events this day.
            </div>
          }
        >
          <For each={dayEvents()}>{(e) => <EntryRow entry={e} />}</For>
        </Show>
      </div>

      {/* The whole month, in one list */}
      <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '4px 16px 6px', 'border-bottom': '1px solid var(--separator)', margin: '0 0 10px' }}>
        <span style={{ flex: '1', 'font-weight': 'var(--fw-700)', 'font-size': 'calc(15px * var(--ts))' }}>
          All of {MONTHS[month()]}
        </span>
        <span style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-tertiary)' }}>
          {monthCount()} {monthCount() === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <div data-testid="cal-month-agenda">
        <Show
          when={agenda().length > 0}
          fallback={
            <div style={{ padding: '2px 16px 14px', color: 'var(--text-tertiary)', 'font-size': 'calc(14px * var(--ts))' }}>
              Nothing scheduled this month.
            </div>
          }
        >
          <For each={agenda()}>
            {(day, i) => (
              <div
                class="rise"
                data-testid="agenda-day"
                data-date={day.date}
                style={{
                  margin: '0 12px 10px',
                  padding: '6px 14px',
                  'border-radius': '12px',
                  background: 'var(--bg-list)',
                  border: day.date === selected() ? '1px solid var(--blue)' : '1px solid var(--separator)',
                  'animation-delay': staggerDelay(i()),
                }}
              >
                <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '4px 0 2px' }}>
                  <span style={{ 'font-weight': 'var(--fw-700)', 'font-size': 'calc(14px * var(--ts))' }}>
                    {WEEKDAYS[(fromDateStr(day.date).getDay() + 6) % 7]} {Number(day.date.slice(8))}
                  </span>
                  <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>
                    {formatRelative(day.date, today)}
                  </span>
                </div>
                <For each={day.entries}>{(e) => <EntryRow entry={e} />}</For>
              </div>
            )}
          </For>
        </Show>
      </div>

      </Show>

      <div style={{ padding: '0 16px 10px' }}>
        <button
          data-testid="cal-add-event"
          onClick={() => window.open(googleCalendarEventUrl({ date: selected() }), '_blank')}
          style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-500)' }}
        >
          <Icon name="plus" size={15} />
          Add event in Google Calendar
        </button>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'margin-top': '4px', 'line-height': 'calc(1.45 * var(--lh))' }}>
          Opens Google Calendar pre-filled for this day — save there and it appears
          here on the next refresh. Set the reminder in Google Calendar too.
        </div>
      </div>

      <Show when={status()}>
        <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)', padding: '0 16px 8px' }}>{status()}</div>
      </Show>

      <Show when={events().length === 0}>
        <div style={{ padding: '4px 16px 16px' }}>
          <button
            onClick={() => push({ name: 'settings' })}
            data-testid="cal-link-settings"
            style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-500)' }}
          >
            Link your Google Calendar in Settings →
          </button>
        </div>
      </Show>
    </ScreenChrome>
  );
}
