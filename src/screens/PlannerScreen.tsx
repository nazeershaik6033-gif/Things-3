import { createMemo, createSignal, For, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { DateStr } from '../db/models';
import { currentDate } from '../app/currentDate';
import { plannerDays, setPlannerDays, type PlannerDays } from '../app/planner';
import { addDays, monthName, weekdayOf, yearOf } from '../domain/dates';
import { Timeline } from '../components/Timeline';
import { Icon } from '../ui/Icon';
import { ScreenChrome } from './common';

/** The Planner: the timeline across 1, 3 or 7 days, with the same blocks,
 *  drags and tray as Today's timeline. A week starts on Monday, like the
 *  Worklog and the Calendar; 1 and 3 days start wherever you are. */

function weekStart(d: DateStr): DateStr {
  return addDays(d, -((weekdayOf(d) + 6) % 7));
}

export function PlannerScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const sprints = createLiveQuery(() => db.sprints.toArray(), []);
  const [anchor, setAnchor] = createSignal<DateStr>(currentDate());
  let scrollEl: HTMLDivElement | undefined;

  const first = () => (plannerDays() === 7 ? weekStart(anchor()) : anchor());
  const dates = createMemo(() => Array.from({ length: plannerDays() }, (_, i) => addDays(first(), i)));
  const shift = (dir: -1 | 1) => setAnchor(addDays(first(), dir * plannerDays()));

  const title = createMemo(() => {
    const a = dates()[0]!;
    const b = dates()[dates().length - 1]!;
    const y = yearOf(a) !== yearOf(currentDate()) ? ` ${yearOf(a)}` : '';
    return monthName(a) === monthName(b) ? `${monthName(a)}${y}` : `${monthName(a).slice(0, 3)} – ${monthName(b).slice(0, 3)}${y}`;
  });

  const seg = (n: PlannerDays) => (
    <button
      data-testid={`planner-days-${n}`}
      aria-pressed={plannerDays() === n}
      onClick={() => setPlannerDays(n)}
      style={{
        padding: '5px 12px', 'border-radius': '8px', 'font-size': '13px', 'font-weight': '600',
        background: plannerDays() === n ? 'var(--bg-card)' : 'transparent',
        color: plannerDays() === n ? 'var(--text)' : 'var(--text-secondary)',
        'box-shadow': plannerDays() === n ? 'var(--shadow-card)' : 'none',
      }}
    >
      {n === 1 ? 'Day' : n === 3 ? '3 Days' : 'Week'}
    </button>
  );

  return (
    <ScreenChrome
      title="Planner"
      subtitle={title()}
      icon={<Icon name="clock" size={28} color="var(--blue)" />}
      scrollRef={(el) => (scrollEl = el)}
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '0 12px 8px 16px' }}>
        <div style={{ display: 'flex', gap: '2px', padding: '2px', 'border-radius': '10px', background: 'var(--bg-inset)' }}>
          {seg(1)}{seg(3)}{seg(7)}
        </div>
        <div style={{ flex: '1' }} />
        <button aria-label="Earlier" data-testid="planner-prev" onClick={() => shift(-1)} style={{ padding: '6px 8px', color: 'var(--blue)', display: 'flex' }}>
          <Icon name="chevron-left" size={18} />
        </button>
        <button
          data-testid="planner-today"
          onClick={() => setAnchor(currentDate())}
          style={{ padding: '5px 10px', 'border-radius': '8px', 'font-size': '13px', 'font-weight': '600', color: 'var(--blue)', background: 'var(--bg-inset)' }}
        >
          Today
        </button>
        <button aria-label="Later" data-testid="planner-next" onClick={() => shift(1)} style={{ padding: '6px 8px', color: 'var(--blue)', display: 'flex' }}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      {/* Keyed by the first date so a new range re-runs the initial scroll */}
      <For each={[first()]}>
        {() => (
          <Timeline
            dates={dates()}
            tasks={tasks()}
            events={events()}
            sprints={sprints()}
            scrollParent={() => scrollEl ?? null}
            headers
            autoScroll
            onHeaderTap={(d) => {
              setPlannerDays(1);
              setAnchor(d);
            }}
          />
        )}
      </For>
    </ScreenChrome>
  );
}
