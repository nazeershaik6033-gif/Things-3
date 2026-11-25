import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import {
  CALENDAR_COLORS, addExtraCalendar, calendarColor, extraCalendars, removeExtraCalendar, setCalendarColor,
} from '../app/calendar';

/** Settings: every calendar the app shows, each with a colour, plus adding
 *  and removing extra subscriptions (Day Planner shows several ICS feeds,
 *  each in its own colour). */
export function CalendarSources(props: { mainUrl: string }): JSX.Element {
  const [url, setUrl] = createSignal('');
  const [name, setName] = createSignal('');
  const [status, setStatus] = createSignal('');
  const hasFile = createLiveQuery(async () => (await db.calendarEvents.where('calendarUrl').equals('file').count()) > 0, false);

  const rows = createMemo(() => [
    ...(props.mainUrl ? [{ url: props.mainUrl, name: 'Main calendar', removable: false }] : []),
    ...extraCalendars().map((c) => ({ url: c.url, name: c.name, removable: true })),
    ...(hasFile() ? [{ url: 'file', name: 'Imported file', removable: false }] : []),
  ]);

  const add = async () => {
    setStatus('Adding…');
    const r = await addExtraCalendar(url(), name());
    setStatus(r.message);
    if (r.ok) {
      setUrl('');
      setName('');
    }
  };

  const input = {
    width: '100%', padding: '10px 12px', 'border-radius': '10px', background: 'var(--bg-inset)',
    color: 'var(--text)', 'font-size': '15px', border: 'none', margin: '4px 0',
  } as const;

  return (
    <div data-testid="calendar-sources" style={{ padding: '6px 0 10px' }}>
      <Show when={rows().length > 0}>
        <div style={{ 'font-size': '13px', 'font-weight': '700', color: 'var(--text-secondary)', padding: '4px 0' }}>Calendars and colours</div>
        <For each={rows()}>
          {(row) => (
            <div data-testid="calendar-source" style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '6px 0', 'flex-wrap': 'wrap' }}>
              <span style={{ width: '10px', height: '10px', 'border-radius': '50%', background: calendarColor(row.url), flex: 'none' }} />
              <span style={{ flex: '1', 'font-size': '15px', 'min-width': '120px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{row.name}</span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <For each={CALENDAR_COLORS}>
                  {(c) => (
                    <button
                      aria-label="Colour"
                      aria-pressed={calendarColor(row.url) === c}
                      onClick={() => void setCalendarColor(row.url, c)}
                      style={{
                        width: '20px', height: '20px', 'border-radius': '50%', background: c,
                        'box-shadow': calendarColor(row.url) === c ? '0 0 0 2px var(--bg-list), 0 0 0 4px var(--text)' : 'none',
                      }}
                    />
                  )}
                </For>
              </div>
              <Show when={row.removable}>
                <button onClick={() => void removeExtraCalendar(row.url)} style={{ color: 'var(--red)', 'font-size': '13px' }}>Remove</button>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <div style={{ 'font-size': '13px', 'font-weight': '700', color: 'var(--text-secondary)', padding: '10px 0 2px' }}>Add another calendar</div>
      <input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Name (Work, Family…)" style={input} data-testid="extra-cal-name" />
      <input value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="Its .ics link" inputmode="url" autocapitalize="off" style={input} data-testid="extra-cal-url" />
      <button onClick={() => void add()} data-testid="extra-cal-add" style={{ color: 'var(--blue)', 'font-weight': '600', 'font-size': '15px', padding: '8px 0' }}>
        Add calendar
      </button>
      <Show when={status()}>
        <div style={{ 'font-size': '13px', color: 'var(--text-secondary)' }}>{status()}</div>
      </Show>
    </div>
  );
}
