import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { refreshCalendar } from '../app/calendar';
import { push } from '../app/navigation';
import { todayStr, toDateStr, fromDateStr, formatTime } from '../domain/dates';
import type { CalendarEvent, DateStr } from '../db/models';
import { Icon } from '../ui/Icon';
import { googleCalendarEventUrl } from '../domain/googleCal';
import { ScreenChrome } from './common';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** All visible cells for a month: leading blanks (Mon-first) then days. */
function monthCells(year: number, month: number): (DateStr | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (DateStr | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toDateStr(new Date(year, month, d)));
  return cells;
}

export function CalendarScreen(): JSX.Element {
  const today = todayStr();
  const t = fromDateStr(today);
  const [year, setYear] = createSignal(t.getFullYear());
  const [month, setMonth] = createSignal(t.getMonth());
  const [selected, setSelected] = createSignal<DateStr>(today);
  const [status, setStatus] = createSignal('');
  const [refreshing, setRefreshing] = createSignal(false);

  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);

  // Auto-refresh on open (throttled internally to once/hour)
  onMount(() => { void refreshCalendar(); });

  const doRefresh = async () => {
    setRefreshing(true);
    setStatus('Updating…');
    const r = await refreshCalendar(true);
    setStatus(r ? r.message : 'No calendar linked yet — add one in Settings.');
    setRefreshing(false);
  };

  const byDate = createMemo(() => {
    const map = new Map<DateStr, CalendarEvent[]>();
    for (const e of events()) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  });

  const cells = createMemo(() => monthCells(year(), month()));
  const dayEvents = createMemo(() => byDate().get(selected()) ?? []);

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
          style={{ color: 'var(--blue)', padding: '8px 12px', 'font-size': '15px', opacity: refreshing() ? '0.5' : '1' }}
        >
          <Icon name="restore" size={18} />
        </button>
      }
    >
      {/* Month header */}
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '4px 16px 8px' }}>
        <button aria-label="Previous month" data-testid="cal-prev" onClick={() => changeMonth(-1)}
          style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-left" size={18} />
        </button>
        <div data-testid="cal-month-label" style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text)' }}>
          {MONTHS[month()]} {year()}
        </div>
        <button aria-label="Next month" data-testid="cal-next" onClick={() => changeMonth(1)}
          style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      {/* Weekday header */}
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', padding: '0 12px' }}>
        <For each={WEEKDAYS}>
          {(w) => (
            <div style={{ 'text-align': 'center', 'font-size': '11px', 'font-weight': '600', color: 'var(--text-tertiary)', padding: '2px 0 6px' }}>
              {w.slice(0, 1)}
            </div>
          )}
        </For>
      </div>

      {/* Month grid */}
      <div data-testid="cal-grid" style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', padding: '0 12px', gap: '2px' }}>
        <For each={cells()}>
          {(date) => (
            <Show when={date} fallback={<div />}>
              <button
                data-testid={date === today ? 'cal-today' : undefined}
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
                  'font-size': '15px',
                  'font-variant-numeric': 'tabular-nums',
                  'font-weight': date === today ? '700' : '400',
                  color: selected() === date ? '#fff' : date === today ? 'var(--blue)' : 'var(--text)',
                }}>
                  {Number(date!.slice(8))}
                </span>
                <span style={{
                  width: '5px', height: '5px', 'border-radius': '50%', 'margin-top': '2px',
                  background: (byDate().get(date!)?.length ?? 0) > 0
                    ? (selected() === date ? '#fff' : 'var(--red)')
                    : 'transparent',
                }} />
              </button>
            </Show>
          )}
        </For>
      </div>

      {/* Selected day events */}
      <div style={{ padding: '14px 16px 4px', 'font-size': '13px', 'font-weight': '600', color: 'var(--text-secondary)', 'text-transform': 'uppercase', 'letter-spacing': '0.4px' }}>
        {fmtSelected()}
      </div>
      <div data-testid="cal-day-events" style={{ background: 'var(--bg-inset)', 'border-radius': '12px', margin: '0 12px 12px', padding: '6px 14px' }}>
        <Show
          when={dayEvents().length > 0}
          fallback={
            <div style={{ 'font-size': '14px', color: 'var(--text-tertiary)', padding: '10px 0' }}>
              No events this day.
            </div>
          }
        >
          <For each={dayEvents()}>
            {(e) => (
              <div style={{ display: 'flex', 'align-items': 'baseline', gap: '10px', padding: '8px 0', 'border-bottom': '1px solid var(--separator)' }}>
                <span style={{ color: 'var(--text-secondary)', 'font-size': '12px', 'font-weight': '600', 'min-width': '54px', 'font-variant-numeric': 'tabular-nums' }}>
                  {e.allDay ? 'all-day' : e.start !== null ? formatTime(e.start) : ''}
                </span>
                <span style={{ color: 'var(--text)', 'font-size': '15px' }}>{e.title}</span>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div style={{ padding: '0 16px 10px' }}>
        <button
          data-testid="cal-add-event"
          onClick={() => window.open(googleCalendarEventUrl({ date: selected() }), '_blank')}
          style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px', color: 'var(--blue)', 'font-size': '15px', 'font-weight': '500' }}
        >
          <Icon name="plus" size={15} />
          Add event in Google Calendar
        </button>
        <div style={{ 'font-size': '12px', color: 'var(--text-tertiary)', 'margin-top': '4px', 'line-height': '1.45' }}>
          Opens Google Calendar pre-filled for this day — save there and it appears
          here on the next refresh. Set the reminder in Google Calendar too.
        </div>
      </div>

      <Show when={status()}>
        <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '0 16px 8px' }}>{status()}</div>
      </Show>

      <Show when={events().length === 0}>
        <div style={{ padding: '4px 16px 16px' }}>
          <button
            onClick={() => push({ name: 'settings' })}
            data-testid="cal-link-settings"
            style={{ color: 'var(--blue)', 'font-size': '15px', 'font-weight': '500' }}
          >
            Link your Google Calendar in Settings →
          </button>
        </div>
      </Show>
    </ScreenChrome>
  );
}
