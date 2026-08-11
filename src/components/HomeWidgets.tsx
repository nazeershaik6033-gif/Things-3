import { createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { CalendarEvent, DailyTarget, DateStr, Task } from '../db/models';
import { Icon } from '../ui/Icon';
import { push } from '../app/navigation';
import { haptic, staggerDelay } from '../app/motion';
import { addDays, formatCountdown, formatRelative, formatTime, weekdayName } from '../domain/dates';
import { isOverdue } from '../domain/smartLists';
import { markedDays, monthLabel, monthOf, nextEvent } from '../domain/calendarMonth';
import { hitStreak, OUTCOME_COLOR, OUTCOME_LABEL, resolveAll, targetFor } from '../domain/target';

/** A clock that ticks once a minute — the Up Next countdown is the only thing
 *  in the app that needs wall-clock time to keep moving on its own. */
function createMinuteClock(): () => number {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(id));
  return now;
}

function WidgetCard(props: {
  children: JSX.Element;
  onClick: () => void;
  tint: string;
  testid: string;
  delay?: string;
}): JSX.Element {
  return (
    <button
      class="pressable-card rise no-select"
      data-testid={props.testid}
      onClick={() => {
        haptic('select');
        props.onClick();
      }}
      style={{
        flex: '0 0 auto',
        'scroll-snap-align': 'start',
        width: 'min(78%, 300px)',
        'text-align': 'left',
        padding: '14px',
        'border-radius': '16px',
        background: 'var(--bg-list)',
        border: '1px solid var(--separator)',
        'box-shadow': `inset 0 0 0 100px ${props.tint}`,
        'animation-delay': props.delay ?? '0ms',
      }}
    >
      {props.children}
    </button>
  );
}

function WidgetLabel(props: { icon: JSX.Element; text: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        'font-size': '12px',
        'font-weight': '700',
        'letter-spacing': '0.05em',
        'text-transform': 'uppercase',
        color: 'var(--text-secondary)',
      }}
    >
      {props.icon}
      {props.text}
    </div>
  );
}

/** Up Next: the soonest calendar event, with a live countdown. */
function UpNextWidget(props: { events: CalendarEvent[]; today: DateStr; delay: string }): JSX.Element {
  const now = createMinuteClock();
  const event = createMemo(() => nextEvent(props.events, now(), props.today));
  const when = createMemo(() => {
    const e = event();
    if (!e) return '';
    if (e.allDay || e.start === null) {
      return e.date === props.today ? 'all-day today' : `all-day · ${formatRelative(e.date, props.today)}`;
    }
    const countdown = formatCountdown(now(), e.start);
    return countdown ?? `${formatRelative(e.date, props.today)} · ${formatTime(e.start)}`;
  });

  return (
    <WidgetCard
      testid="widget-up-next"
      tint="rgba(47, 124, 246, 0.06)"
      delay={props.delay}
      onClick={() => push({ name: 'calendar' })}
    >
      <WidgetLabel icon={<Icon name="clock" size={13} color="var(--blue)" />} text="Up Next" />
      <Show
        when={event()}
        fallback={
          <div style={{ 'margin-top': '8px' }}>
            <div style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text-secondary)' }}>
              Nothing scheduled
            </div>
            <div style={{ 'margin-top': '3px', 'font-size': '13px', color: 'var(--text-tertiary)' }}>
              Open the calendar to add one
            </div>
          </div>
        }
      >
        <div style={{ 'margin-top': '8px' }}>
          <div
            style={{
              'font-size': '17px',
              'font-weight': '600',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            {event()!.title}
          </div>
          <div
            data-testid="widget-up-next-when"
            style={{ 'margin-top': '3px', 'font-size': '13px', 'font-weight': '600', color: 'var(--blue)' }}
          >
            {when()}
          </div>
          <Show when={!event()!.allDay && event()!.start !== null}>
            <div style={{ 'margin-top': '1px', 'font-size': '12px', color: 'var(--text-tertiary)' }}>
              {weekdayName(event()!.date).slice(0, 3)} · {formatTime(event()!.start!)}
            </div>
          </Show>
        </div>
      </Show>
    </WidgetCard>
  );
}

/** Overdue: how many deadlines have already passed. Stays visible when the
 *  count is zero — a widget that disappears is a widget you stop trusting. */
function OverdueWidget(props: { tasks: Task[]; today: DateStr; delay: string }): JSX.Element {
  const late = createMemo(() => props.tasks.filter((t) => isOverdue(t, props.today)));
  const clear = () => late().length === 0;
  const oldest = createMemo(() =>
    [...late()].sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1))[0] ?? null,
  );

  return (
    <WidgetCard
      testid="widget-overdue"
      tint={clear() ? 'rgba(83, 184, 85, 0.06)' : 'rgba(255, 59, 48, 0.07)'}
      delay={props.delay}
      onClick={() => push({ name: 'list', list: 'today' })}
    >
      <WidgetLabel
        icon={<Icon name="flag" size={13} color={clear() ? 'var(--green)' : 'var(--red)'} />}
        text={clear() ? 'All clear' : 'Overdue'}
      />
      <div style={{ 'margin-top': '8px', display: 'flex', 'align-items': 'baseline', gap: '8px' }}>
        <span
          data-testid="widget-overdue-count"
          style={{
            'font-size': '30px',
            'font-weight': '700',
            'line-height': '1',
            'font-variant-numeric': 'tabular-nums',
            color: clear() ? 'var(--green)' : 'var(--red)',
          }}
        >
          {late().length}
        </span>
        <span style={{ 'font-size': '15px', color: 'var(--text-secondary)' }}>
          {clear() ? 'nothing late' : late().length === 1 ? 'past its deadline' : 'past their deadlines'}
        </span>
      </div>
      <div
        style={{
          'margin-top': '4px',
          'font-size': '13px',
          color: 'var(--text-tertiary)',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        <Show when={oldest()} fallback="Every deadline is still ahead of you">
          Oldest: {oldest()!.title || 'New To-Do'} · {formatRelative(oldest()!.deadline!, props.today)}
        </Show>
      </div>
    </WidgetCard>
  );
}

/** Today's one target — the day's headline, so it leads the deck. Reads as an
 *  invitation before it's set, the target itself during the day, and the
 *  verdict once you've judged it. */
function TargetWidget(props: {
  targets: DailyTarget[];
  tasks: Task[];
  today: DateStr;
  delay: string;
}): JSX.Element {
  const resolved = createMemo(() => resolveAll(props.targets, props.tasks));
  const todays = createMemo(() => targetFor(resolved(), props.today));
  const streak = createMemo(() => hitStreak(resolved(), props.today));
  /** A hit carried by the linked to-do counts as judged for display. */
  const judged = () => todays() !== null && todays()!.outcome !== 'pending';

  return (
    <WidgetCard
      testid="widget-target"
      tint="rgba(47, 124, 246, 0.06)"
      delay={props.delay}
      onClick={() => push({ name: 'target' })}
    >
      <WidgetLabel
        icon={
          <Icon
            name="flag"
            size={13}
            color={todays() ? OUTCOME_COLOR[todays()!.outcome] : 'var(--blue)'}
          />
        }
        text={judged() ? OUTCOME_LABEL[todays()!.outcome] : "Today's target"}
      />
      <Show
        when={todays()}
        fallback={
          <div style={{ 'margin-top': '8px' }}>
            <div style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text-secondary)' }}>
              Not set yet
            </div>
            <div style={{ 'margin-top': '3px', 'font-size': '13px', color: 'var(--text-tertiary)' }}>
              Name the one thing that would make today count
            </div>
          </div>
        }
      >
        <div style={{ 'margin-top': '8px' }}>
          <div
            data-testid="widget-target-text"
            style={{
              'font-size': '17px',
              'font-weight': '600',
              'line-height': '1.3',
              display: '-webkit-box',
              '-webkit-line-clamp': '2',
              '-webkit-box-orient': 'vertical',
              overflow: 'hidden',
            }}
          >
            {todays()!.text}
          </div>
          <div
            style={{
              'margin-top': '5px',
              'font-size': '13px',
              'font-weight': '600',
              color: judged() ? OUTCOME_COLOR[todays()!.outcome] : 'var(--text-tertiary)',
            }}
          >
            {judged()
              ? streak() > 0 ? `${streak()}-day streak` : OUTCOME_LABEL[todays()!.outcome]
              : 'Tap tonight to judge it'}
          </div>
        </div>
      </Show>
    </WidgetCard>
  );
}

/** The scroll-snapping deck at the top of Home. */
export function WidgetDeck(props: {
  events: CalendarEvent[];
  tasks: Task[];
  targets: DailyTarget[];
  today: DateStr;
}): JSX.Element {
  return (
    <div
      data-testid="widget-deck"
      style={{
        display: 'flex',
        gap: '10px',
        padding: '2px 16px 4px',
        'overflow-x': 'auto',
        'scroll-snap-type': 'x mandatory',
        'scrollbar-width': 'none',
      }}
    >
      <TargetWidget targets={props.targets} tasks={props.tasks} today={props.today} delay={staggerDelay(0)} />
      <UpNextWidget events={props.events} today={props.today} delay={staggerDelay(1)} />
      <OverdueWidget tasks={props.tasks} today={props.today} delay={staggerDelay(2)} />
    </div>
  );
}

/** The week strip below the widgets: seven days with event dots, opening the
 *  full month calendar. */
export function CalendarStrip(props: {
  events: CalendarEvent[];
  tasks: Task[];
  today: DateStr;
}): JSX.Element {
  const days = createMemo(() => Array.from({ length: 7 }, (_, i) => addDays(props.today, i)));
  const marked = createMemo(() => {
    // A week can straddle two months, so union both months' marks
    const months = new Set(days().map(monthOf));
    const out = new Set<DateStr>();
    for (const m of months) {
      for (const d of markedDays(props.events, props.tasks, m)) out.add(d);
    }
    return out;
  });
  const monthCount = createMemo(
    () => markedDays(props.events, props.tasks, monthOf(props.today)).size,
  );

  return (
    <button
      class="pressable-card rise no-select"
      data-testid="home-calendar"
      onClick={() => {
        haptic('select');
        push({ name: 'calendar' });
      }}
      style={{
        display: 'block',
        width: 'calc(100% - 32px)',
        margin: '10px 16px 4px',
        padding: '12px 12px 10px',
        'border-radius': '16px',
        background: 'var(--bg-list)',
        border: '1px solid var(--separator)',
        'text-align': 'left',
        'animation-delay': staggerDelay(2),
      }}
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '0 4px 10px' }}>
        <Icon name="calendar" size={16} color="var(--red)" />
        <span style={{ 'font-weight': '700', 'font-size': '15px' }}>
          {monthLabel(monthOf(props.today))}
        </span>
        <span style={{ flex: '1' }} />
        <span style={{ 'font-size': '13px', color: 'var(--text-tertiary)' }}>
          {monthCount()} {monthCount() === 1 ? 'day' : 'days'} booked
        </span>
        <Icon name="chevron-right" size={14} color="var(--text-tertiary)" />
      </div>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(7, 1fr)', gap: '2px' }}>
        <For each={days()}>
          {(day) => (
            <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '3px' }}>
              <span style={{ 'font-size': '11px', 'font-weight': '600', color: 'var(--text-tertiary)' }}>
                {weekdayName(day).slice(0, 1)}
              </span>
              <span
                style={{
                  width: '30px',
                  height: '30px',
                  display: 'grid',
                  'place-items': 'center',
                  'border-radius': '10px',
                  'font-size': '15px',
                  'font-variant-numeric': 'tabular-nums',
                  background: day === props.today ? 'var(--blue)' : 'transparent',
                  color: day === props.today ? 'var(--text-invert)' : 'var(--text)',
                  'font-weight': day === props.today ? '700' : '400',
                }}
              >
                {Number(day.slice(8, 10))}
              </span>
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  'border-radius': '50%',
                  background: marked().has(day) ? 'var(--red)' : 'transparent',
                }}
              />
            </div>
          )}
        </For>
      </div>
    </button>
  );
}
