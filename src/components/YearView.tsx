import { For, type JSX } from 'solid-js';
import type { DateStr } from '../db/models';
import { monthWeeks, weekdayLabels, type DayStat } from '../domain/calendarMonth';
import { Icon } from '../ui/Icon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The year at a glance (TaskNotes' year view): twelve small months, each
 *  day shaded by how full it was — planned plus done. Tap a month to open it. */
export function YearView(props: {
  year: number;
  today: DateStr;
  stats: Map<DateStr, DayStat>;
  weekStart: 0 | 1;
  onYear: (delta: number) => void;
  onMonth: (monthIndex: number) => void;
}): JSX.Element {
  const shade = (d: DateStr) => {
    const s = props.stats.get(d);
    const n = s ? s.planned + s.done : 0;
    return n === 0 ? 'transparent' : `color-mix(in srgb, var(--red) ${Math.min(80, 18 + n * 12)}%, transparent)`;
  };
  return (
    <div data-testid="cal-year">
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '0 16px 8px' }}>
        <button aria-label="Previous year" onClick={() => props.onYear(-1)} style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-left" size={18} />
        </button>
        <div data-testid="cal-year-label" style={{ 'font-size': '17px', 'font-weight': '600' }}>{props.year}</div>
        <button aria-label="Next year" onClick={() => props.onYear(1)} style={{ color: 'var(--blue)', padding: '8px 14px' }}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px', padding: '0 14px 16px' }}>
        <For each={MONTHS}>
          {(name, i) => {
            const month = `${props.year}-${String(i() + 1).padStart(2, '0')}`;
            return (
              <button data-testid="cal-year-month" onClick={() => props.onMonth(i())} style={{ 'text-align': 'left' }}>
                <div style={{ 'font-size': '13px', 'font-weight': '700', color: month === props.today.slice(0, 7) ? 'var(--red)' : 'var(--text)', padding: '0 0 4px 2px' }}>
                  {name}
                </div>
                <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', gap: '1px' }}>
                  <For each={weekdayLabels(props.weekStart)}>
                    {(w) => <span style={{ 'font-size': '8px', color: 'var(--text-tertiary)', 'text-align': 'center' }}>{w}</span>}
                  </For>
                  <For each={monthWeeks(month, props.weekStart).flat()}>
                    {(d) => (
                      <span style={{
                        'font-size': '9px', 'text-align': 'center', 'line-height': '15px', 'border-radius': '3px',
                        'font-variant-numeric': 'tabular-nums',
                        background: d ? shade(d) : 'transparent',
                        color: d === props.today ? 'var(--red)' : 'var(--text-secondary)',
                        'font-weight': d === props.today ? '800' : '400',
                      }}>
                        {d ? Number(d.slice(8)) : ''}
                      </span>
                    )}
                  </For>
                </div>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
