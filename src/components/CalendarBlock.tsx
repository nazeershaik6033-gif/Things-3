import { For, Show, type JSX } from 'solid-js';
import type { CalendarEvent } from '../db/models';
import { formatTime } from '../domain/dates';

/** Gray rounded block of read-only calendar events atop Today / Upcoming days. */
export function CalendarBlock(props: { events: CalendarEvent[]; compact?: boolean }): JSX.Element {
  return (
    <Show when={props.events.length > 0}>
      <div
        data-testid="calendar-block"
        style={{
          background: 'var(--bg-inset)',
          'border-radius': '12px',
          margin: props.compact ? '4px 0 8px' : '4px 16px 10px',
          padding: '8px 12px',
        }}
      >
        <For each={props.events}>
          {(event) => (
            <div
              style={{
                display: 'flex',
                'align-items': 'baseline',
                gap: '8px',
                padding: '3px 0',
                'font-size': '14px',
              }}
            >
              <span
                style={{
                  color: 'var(--text-secondary)',
                  'font-size': '12px',
                  'font-weight': '600',
                  'min-width': '52px',
                  'font-variant-numeric': 'tabular-nums',
                }}
              >
                {event.allDay ? 'all-day' : event.start !== null ? formatTime(event.start) : ''}
              </span>
              <span
                style={{
                  color: 'var(--text)',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {event.title}
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
