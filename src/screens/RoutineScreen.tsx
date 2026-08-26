import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { haptic, staggerDelay } from '../app/motion';
import { formatRelative, weekdayName } from '../domain/dates';
import {
  activeItems, completedIdsOn, itemsOnDate, recentDays, routineProgress,
  streakLength, STARTER_ROUTINE,
} from '../domain/routine';
import {
  archiveRoutineItem, createRoutineItem, createRoutineItems, deleteRoutineItem,
  setRoutineDone, updateRoutineItem,
} from '../db/mutations';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { ProgressRing } from '../ui/ProgressRing';
import { ScreenChrome, EmptyState } from './common';

/** The daily routine: a fixed set of checks that starts empty every morning.
 *  Deliberately separate from to-dos — nothing here reaches Inbox, Today or
 *  the Logbook, so a habit you skip never becomes an overdue task. */
export function RoutineScreen(): JSX.Element {
  const items = createLiveQuery(() => db.routineItems.toArray(), []);
  const logs = createLiveQuery(() => db.routineLogs.toArray(), []);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');

  const today = () => currentDate();
  const due = createMemo(() => itemsOnDate(items(), today()));
  const listed = createMemo(() => (editing() ? activeItems(items()) : due()));
  const done = createMemo(() => completedIdsOn(logs(), today()));
  const progress = createMemo(() => routineProgress(items(), logs(), today()));
  const streak = createMemo(() => streakLength(items(), logs(), today()));
  const history = createMemo(() => recentDays(items(), logs(), today(), 7));

  const toggle = (itemId: string) => {
    const next = !done().has(itemId);
    haptic(next ? 'select' : 'tick');
    void setRoutineDone(itemId, today(), next);
  };

  const addItem = () => {
    const title = draft().trim();
    if (!title) return;
    setDraft('');
    void createRoutineItem(title);
  };

  return (
    <ScreenChrome
      title="Daily Routine"
      icon={<Icon name="repeat" size={28} color="var(--purple)" />}
      subtitle={`${weekdayName(today())} · ${formatRelative(today(), today())}`}
      trailing={
        <button
          data-testid="routine-edit"
          onClick={() => setEditing(!editing())}
          style={{ color: 'var(--blue)', padding: '8px 10px', 'font-size': '16px', 'font-weight': editing() ? '600' : '400' }}
        >
          {editing() ? 'Done' : 'Edit'}
        </button>
      }
    >
      <Show when={due().length > 0 || editing()}>
        <div
          class="rise"
          data-testid="routine-hero"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '16px',
            margin: '2px 16px 14px',
            padding: '16px',
            'border-radius': 'var(--radius-card)',
            background: 'var(--bg-inset)',
          }}
        >
          <ProgressRing
            progress={progress().ratio}
            size={72}
            thickness={7}
            color={progress().complete ? 'var(--green)' : 'var(--purple)'}
          >
            <span style={{ 'font-size': '17px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' }}>
              {progress().done}
              <span style={{ color: 'var(--text-tertiary)', 'font-weight': '600' }}>/{progress().total}</span>
            </span>
          </ProgressRing>
          <div style={{ flex: '1', 'min-width': '0' }}>
            <div style={{ 'font-size': '17px', 'font-weight': '600' }}>
              {progress().complete
                ? 'Routine complete'
                : progress().done === 0
                  ? 'Nothing checked yet'
                  : `${progress().total - progress().done} left today`}
            </div>
            <div
              data-testid="routine-streak"
              style={{ display: 'flex', 'align-items': 'center', gap: '5px', 'margin-top': '4px', color: 'var(--text-secondary)', 'font-size': '14px' }}
            >
              <Icon name="flame" size={15} color={streak() > 0 ? 'var(--red)' : 'var(--text-tertiary)'} />
              {streak() === 0 ? 'No streak yet' : `${streak()}-day streak`}
            </div>
            <div style={{ display: 'flex', gap: '5px', 'margin-top': '10px' }}>
              <For each={history()}>
                {(day) => (
                  <div
                    title={day.date}
                    style={{
                      flex: '1',
                      height: '6px',
                      'border-radius': '3px',
                      background: day.complete
                        ? 'var(--green)'
                        : day.ratio > 0
                          ? 'var(--purple)'
                          : 'var(--bg-row-active)',
                      opacity: day.complete || day.ratio === 0 ? '1' : String(0.35 + day.ratio * 0.65),
                    }}
                  />
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show
        when={listed().length > 0}
        fallback={
          <Show when={!editing()}>
            <EmptyState
              icon={<Icon name="repeat" size={44} color="var(--text-tertiary)" />}
              text="Build the handful of checks you want to run every day. They reset each morning and never turn into overdue to-dos."
            />
            <div style={{ display: 'grid', 'place-items': 'center', padding: '0 16px 24px' }}>
              <button
                data-testid="routine-starter"
                onClick={() => void createRoutineItems(STARTER_ROUTINE)}
                style={{
                  padding: '11px 18px',
                  'border-radius': '12px',
                  background: 'var(--blue)',
                  color: 'var(--text-invert)',
                  'font-weight': '600',
                  'font-size': '15px',
                }}
              >
                Start with a suggested routine
              </button>
            </div>
          </Show>
        }
      >
        <div style={{ margin: '0 10px', background: 'var(--bg-list)', 'border-radius': 'var(--radius-card)', overflow: 'hidden' }}>
          <For each={listed()}>
            {(item, i) => (
              <div
                class="rise"
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '12px',
                  padding: '11px 14px',
                  'animation-delay': staggerDelay(i()),
                  'border-bottom': i() < listed().length - 1 ? '1px solid var(--separator)' : 'none',
                }}
              >
                <Show
                  when={!editing()}
                  fallback={<Icon name="grip" size={18} color="var(--text-tertiary)" />}
                >
                  <Checkbox
                    checked={done().has(item.id)}
                    onToggle={() => toggle(item.id)}
                  />
                </Show>
                <Show
                  when={editing()}
                  fallback={
                    <span
                      onClick={() => toggle(item.id)}
                      class="no-select"
                      style={{
                        flex: '1',
                        cursor: 'pointer',
                        color: done().has(item.id) ? 'var(--text-secondary)' : 'var(--text)',
                        'text-decoration': done().has(item.id) ? 'line-through' : 'none',
                        'text-decoration-color': 'var(--text-tertiary)',
                      }}
                    >
                      {item.title}
                    </span>
                  }
                >
                  <input
                    value={item.title}
                    onInput={(e) => void updateRoutineItem(item.id, { title: e.currentTarget.value })}
                    placeholder="Routine check"
                    style={{ flex: '1' }}
                  />
                  <button
                    aria-label={`Retire ${item.title}`}
                    onClick={() => void archiveRoutineItem(item.id)}
                    style={{ color: 'var(--text-secondary)', padding: '6px', display: 'flex' }}
                  >
                    <Icon name="archive" size={18} />
                  </button>
                  <button
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void deleteRoutineItem(item.id)}
                    style={{ color: 'var(--red)', padding: '6px', display: 'flex' }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={editing()}>
        <div style={{ display: 'flex', gap: '8px', margin: '12px 16px 0' }}>
          <input
            data-testid="routine-new"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add a daily check…"
            style={{ flex: '1', padding: '10px 12px', 'border-radius': '11px', background: 'var(--bg-inset)' }}
          />
          <button onClick={addItem} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>
            Add
          </button>
        </div>
        <p style={{ padding: '12px 18px 0', color: 'var(--text-secondary)', 'font-size': '13px', 'line-height': '1.45' }}>
          Retiring a check hides it from today onward but keeps its history, so
          past streaks stay accurate. Deleting removes every tick it recorded.
        </p>
      </Show>
    </ScreenChrome>
  );
}
