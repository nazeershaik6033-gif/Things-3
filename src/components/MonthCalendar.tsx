import { createMemo, For, Show, type JSX } from 'solid-js';
import type { DateStr } from '../db/models';
import { Icon } from '../ui/Icon';
import { haptic } from '../app/motion';
import {
  monthLabel, monthWeeks, weekdayLabels, type MonthStr,
} from '../domain/calendarMonth';

/** Controlled month grid for the Calendar screen. Distinct from the compact
 *  MonthGrid in Pickers: every day is equally reachable (no past-day dimming —
 *  a calendar is a record as much as a plan) and days carry event dots. */
export function MonthCalendar(props: {
  month: MonthStr;
  onMonthChange: (month: MonthStr) => void;
  selected: DateStr | null;
  onSelect: (date: DateStr) => void;
  today: DateStr;
  marked: Set<DateStr>;
  weekStart?: number;
}): JSX.Element {
  const weekStart = () => props.weekStart ?? 1;
  const weeks = createMemo(() => monthWeeks(props.month, weekStart()));

  const shift = (by: number) => {
    haptic('tick');
    const d = new Date(Number(props.month.slice(0, 4)), Number(props.month.slice(5, 7)) - 1 + by, 1);
    props.onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div data-testid="month-calendar" style={{ padding: '0 12px 6px' }}>
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '0 4px 6px' }}>
        <button
          class="pressable"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          data-testid="month-prev"
          style={{ padding: '8px 12px', color: 'var(--blue)', display: 'flex' }}
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span data-testid="month-label" style={{ 'font-size': '18px', 'font-weight': '700' }}>
          {monthLabel(props.month)}
        </span>
        <button
          class="pressable"
          onClick={() => shift(1)}
          aria-label="Next month"
          data-testid="month-next"
          style={{ padding: '8px 12px', color: 'var(--blue)', display: 'flex' }}
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', 'text-align': 'center' }}>
        <For each={weekdayLabels(weekStart())}>
          {(d) => (
            <span style={{ 'font-size': '12px', 'font-weight': '600', color: 'var(--text-tertiary)', padding: '4px 0 6px' }}>
              {d}
            </span>
          )}
        </For>
        <For each={weeks().flat()}>
          {(day) => (
            <Show when={day} fallback={<span />}>
              <button
                class="pressable"
                data-testid={props.selected === day ? 'day-selected' : undefined}
                data-day={day!}
                onClick={() => {
                  haptic('select');
                  props.onSelect(day!);
                }}
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  gap: '3px',
                  padding: '7px 0 5px',
                }}
              >
                <span
                  style={{
                    width: '34px',
                    height: '34px',
                    display: 'grid',
                    'place-items': 'center',
                    'border-radius': '11px',
                    'font-size': '16px',
                    'font-variant-numeric': 'tabular-nums',
                    background: props.selected === day ? 'var(--blue)' : 'transparent',
                    color:
                      props.selected === day ? 'var(--text-invert)'
                      : day === props.today ? 'var(--blue)'
                      : 'var(--text)',
                    'font-weight': day === props.today || props.selected === day ? '700' : '400',
                  }}
                >
                  {Number(day!.slice(8, 10))}
                </span>
                <span
                  style={{
                    width: '5px',
                    height: '5px',
                    'border-radius': '50%',
                    background:
                      !props.marked.has(day!) ? 'transparent'
                      : props.selected === day ? 'var(--blue)'
                      : 'var(--red)',
                  }}
                />
              </button>
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}
