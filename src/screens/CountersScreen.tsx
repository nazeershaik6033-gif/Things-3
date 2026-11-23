import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { sortByOrderKey } from '../db/ordering';
import {
  bumpCounter, createCounter, deleteCounter, toggleStopwatch, updateCounter,
} from '../db/superMutations';
import type { Counter, CounterDay, CounterKind } from '../db/models';
import { currentDate } from '../app/currentDate';
import { haptic } from '../app/motion';
import { counterStreak, formatCounterValue, goalUnits, liveValue, recentDays } from '../domain/counters';
import { weekdayName } from '../domain/dates';
import { Icon } from '../ui/Icon';
import { ProgressRing } from '../ui/ProgressRing';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { ScreenChrome, EmptyState, MenuRow } from './common';
import { Panel, fieldStyle, primaryButton, softButton } from './superCommon';

/** Counters: Super Productivity's simple counters. A tap counter or a
 *  stopwatch per thing you want more (or less) of, a daily goal, a streak
 *  and a week strip. Separate from Habits on purpose: habits are yes/no,
 *  counters are "how much". */

function CounterCard(props: { counter: Counter; days: CounterDay[]; now: number; onEdit: () => void }): JSX.Element {
  const c = () => props.counter;
  const today = () => currentDate();
  const value = () => liveValue(c(), props.days, today(), props.now);
  const goal = () => goalUnits(c());
  const streak = () => counterStreak(c(), props.days, today(), props.now);
  const strip = () => recentDays(c(), props.days, today(), props.now, 7);
  const running = () => c().kind === 'stopwatch' && c().runningSince !== null;

  return (
    <Panel testid={`counter-${c().id}`}>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '10px 12px 6px 14px' }}>
        <ProgressRing
          progress={goal() > 0 ? Math.min(1, value() / goal()) : value() > 0 ? 1 : 0}
          size={34}
          thickness={12}
          color={c().color}
        />
        <div style={{ flex: '1', 'min-width': '0' }}>
          <div style={{ 'font-size': '16px', 'font-weight': '600', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
            {c().title}
          </div>
          <div style={{ 'font-size': '13px', color: 'var(--text-secondary)', display: 'flex', gap: '8px', 'align-items': 'center' }}>
            <span data-testid="counter-value" style={{ 'font-variant-numeric': 'tabular-nums', color: 'var(--text)', 'font-weight': '600' }}>
              {formatCounterValue(c(), value())}
            </span>
            <Show when={c().goal > 0}>
              <span>/ {c().kind === 'stopwatch' ? `${c().goal}m` : c().goal}</span>
            </Show>
            <Show when={streak() > 0}>
              <span data-testid="counter-streak" style={{ display: 'inline-flex', 'align-items': 'center', gap: '2px', color: 'var(--yellow-deep)', 'font-weight': '600' }}>
                <Icon name="flame" size={12} /> {streak()}
              </span>
            </Show>
          </div>
        </div>
        <button aria-label="Counter options" onClick={props.onEdit} style={{ color: 'var(--text-tertiary)', padding: '6px', display: 'flex' }}>
          <Icon name="ellipsis" size={18} />
        </button>
        <Show
          when={c().kind === 'click'}
          fallback={
            <button
              data-testid="counter-toggle"
              aria-pressed={running()}
              aria-label={running() ? 'Stop' : 'Start'}
              onClick={() => { haptic('tick'); void toggleStopwatch(c().id); }}
              style={{
                width: '44px', height: '44px', 'border-radius': '50%', display: 'grid', 'place-items': 'center',
                background: running() ? c().color : 'var(--bg-inset)', color: running() ? '#fff' : c().color,
              }}
            >
              <Icon name={running() ? 'pause' : 'resume'} size={16} />
            </button>
          }
        >
          <button
            data-testid="counter-minus"
            aria-label="Minus one"
            onClick={() => { haptic('tick'); void bumpCounter(c().id, today(), -1); }}
            style={{ width: '34px', height: '34px', 'border-radius': '50%', 'font-size': '20px', background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            −
          </button>
          <button
            data-testid="counter-plus"
            aria-label="Plus one"
            onClick={() => { haptic('tick'); void bumpCounter(c().id, today(), 1); }}
            style={{ width: '44px', height: '44px', 'border-radius': '50%', 'font-size': '22px', 'font-weight': '600', background: c().color, color: '#fff' }}
          >
            +
          </button>
        </Show>
      </div>
      <div style={{ display: 'flex', gap: '4px', padding: '2px 14px 10px 60px' }}>
        <For each={strip()}>
          {(d) => (
            <div style={{ flex: '1', 'text-align': 'center' }}>
              <div
                title={`${d.date}: ${formatCounterValue(c(), d.value)}`}
                style={{
                  height: '6px', 'border-radius': '3px',
                  background: d.met ? c().color : d.value > 0 ? 'var(--check-border)' : 'var(--bg-inset)',
                }}
              />
              <div style={{ 'font-size': '10px', color: 'var(--text-tertiary)', 'margin-top': '3px' }}>
                {weekdayName(d.date).slice(0, 1)}
              </div>
            </div>
          )}
        </For>
      </div>
    </Panel>
  );
}

export function CountersScreen(): JSX.Element {
  const counters = createLiveQuery(() => db.counters.toArray(), [] as Counter[]);
  const days = createLiveQuery(() => db.counterDays.toArray(), [] as CounterDay[]);
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const [adding, setAdding] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [kind, setKind] = createSignal<CounterKind>('click');
  const [goal, setGoal] = createSignal('');
  const [editing, setEditing] = createSignal<Counter | null>(null);

  const active = () => sortByOrderKey(counters().filter((c) => c.active));

  const add = async () => {
    if (!title().trim()) return;
    await createCounter(title(), kind(), Number(goal()) || 0);
    haptic('success');
    setTitle('');
    setGoal('');
    setAdding(false);
  };

  const kindButton = (k: CounterKind, label: string) => (
    <button
      data-testid={`counter-kind-${k}`}
      onClick={() => setKind(k)}
      style={{ ...softButton, background: kind() === k ? 'var(--blue)' : 'var(--bg-inset)', color: kind() === k ? 'var(--text-invert)' : 'var(--text)' }}
    >
      {label}
    </button>
  );

  return (
    <ScreenChrome
      title="Counters"
      subtitle="Tally it or time it — with a daily goal"
      icon={<Icon name="tally" size={26} color="var(--teal)" />}
      trailing={
        <button data-testid="counter-add" aria-label="New counter" onClick={() => setAdding(!adding())} style={{ color: 'var(--blue)', padding: '8px 10px', display: 'flex' }}>
          <Icon name="plus" size={21} />
        </button>
      }
    >
      <Show when={adding()}>
        <Panel testid="counter-form">
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '10px 12px' }}>
            <input
              data-testid="counter-title"
              value={title()}
              placeholder="Glasses of water, Push-ups, Reading…"
              ref={(el) => queueMicrotask(() => el.focus())}
              onInput={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              style={fieldStyle}
            />
            <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
              {kindButton('click', 'Tap counter')}
              {kindButton('stopwatch', 'Stopwatch')}
              <input
                data-testid="counter-goal"
                type="number"
                min="0"
                value={goal()}
                placeholder={kind() === 'stopwatch' ? 'Goal (min)' : 'Daily goal'}
                onInput={(e) => setGoal(e.currentTarget.value)}
                style={{ ...fieldStyle, width: '120px', padding: '7px 10px' }}
              />
            </div>
            <button data-testid="counter-save" onClick={() => void add()} style={primaryButton}>Add counter</button>
          </div>
        </Panel>
      </Show>

      <Show
        when={active().length > 0}
        fallback={
          <Show when={!adding()}>
            <EmptyState icon={<Icon name="tally" size={44} />} text="Count what matters: glasses of water, pages read, minutes practised. Tap + to add one." />
          </Show>
        }
      >
        <For each={active()}>
          {(c) => <CounterCard counter={c} days={days()} now={now()} onEdit={() => setEditing(c)} />}
        </For>
      </Show>

      <Show when={editing()}>
        <Sheet onClose={() => setEditing(null)} dragAnywhere>
          <SheetTitle>{editing()!.title}</SheetTitle>
          <MenuRow
            icon={<Icon name="pencil" size={19} />}
            label="Rename"
            onClick={() => {
              const name = prompt('Counter name', editing()!.title);
              if (name && name.trim()) void updateCounter(editing()!.id, { title: name.trim() });
              setEditing(null);
            }}
          />
          <MenuRow
            icon={<Icon name="target" size={19} />}
            label={`Daily goal: ${editing()!.goal || 'none'}${editing()!.kind === 'stopwatch' && editing()!.goal ? ' min' : ''}`}
            onClick={() => {
              const g = prompt(editing()!.kind === 'stopwatch' ? 'Daily goal in minutes (0 = none)' : 'Daily goal (0 = none)', String(editing()!.goal));
              if (g !== null && Number.isFinite(Number(g))) void updateCounter(editing()!.id, { goal: Math.max(0, Math.round(Number(g))) });
              setEditing(null);
            }}
          />
          <MenuRow
            icon={<Icon name="trash" size={19} />}
            label="Delete counter and its history"
            danger
            onClick={() => {
              if (confirm('Delete this counter and all its history?')) void deleteCounter(editing()!.id);
              setEditing(null);
            }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
      <div style={{ height: '100px' }} />
    </ScreenChrome>
  );
}
