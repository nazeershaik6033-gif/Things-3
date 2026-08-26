import { createMemo, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery, createReactiveLiveQuery } from '../db/liveQuery';
import { push } from '../app/navigation';
import { currentDate } from '../app/currentDate';
import { haptic, staggerDelay } from '../app/motion';
import { formatRelative, daysBetween, weekdayName } from '../domain/dates';
import { Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState } from './common';
import type { Card } from '../db/models';

/** Agenda of the board's cards that have a due date, grouped by day and sorted
 *  chronologically. Days are cards of their own, matching the month calendar,
 *  and overdue days carry the red treatment. */
export function BoardCalendarScreen(props: { id: string }): JSX.Element {
  const board = createLiveQuery(async () => (await db.boards.get(props.id)) ?? null, null);
  const cards = createReactiveLiveQuery(
    () => props.id,
    (id) => db.cards.where('boardId').equals(id).toArray(),
    [] as Card[],
  );

  const groups = createMemo(() => {
    const dated = cards().filter((c) => !c.archived && c.due);
    const byDate = new Map<string, Card[]>();
    for (const c of dated) {
      const arr = byDate.get(c.due!) ?? [];
      arr.push(c);
      byDate.set(c.due!, arr);
    }
    for (const [k, v] of byDate) {
      byDate.set(k, [...v].sort((a, b) => (a.dueTime ?? '').localeCompare(b.dueTime ?? '')));
    }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  });

  const total = createMemo(() => groups().reduce((n, [, c]) => n + c.length, 0));

  return (
    <Show when={board()}>
      <ScreenChrome
        title={`${board()!.title || 'Board'} · Calendar`}
        icon={<Icon name="calendar" size={24} color="var(--red)" />}
        subtitle={total() > 0 ? `${total()} ${total() === 1 ? 'card' : 'cards'} with a due date` : undefined}
      >
        <Show
          when={groups().length > 0}
          fallback={
            <EmptyState
              icon={<Icon name="calendar" size={40} color="var(--text-tertiary)" />}
              text="No cards with due dates yet."
            />
          }
        >
          <For each={groups()}>
            {([date, dayCards], i) => {
              const overdue = () => daysBetween(currentDate(), date) < 0;
              return (
                <div
                  class="rise"
                  data-testid="board-agenda-day"
                  data-date={date}
                  style={{
                    margin: '0 12px 10px',
                    'border-radius': '14px',
                    background: 'var(--bg-list)',
                    border: `1px solid ${overdue() ? 'var(--red)' : 'var(--separator)'}`,
                    overflow: 'hidden',
                    'animation-delay': staggerDelay(i()),
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'baseline',
                      gap: '8px',
                      padding: '9px 14px 7px',
                      background: overdue() ? 'rgba(255, 59, 48, 0.07)' : 'transparent',
                    }}
                  >
                    <span
                      style={{
                        'font-weight': '700',
                        'font-size': '15px',
                        color: overdue() ? 'var(--red)' : 'var(--text)',
                      }}
                    >
                      {weekdayName(date).slice(0, 3)} {Number(date.slice(8))}
                    </span>
                    <span style={{ 'font-size': '13px', color: 'var(--text-tertiary)' }}>
                      {formatRelative(date, currentDate())}
                    </span>
                    <span style={{ flex: '1' }} />
                    <Show when={overdue()}>
                      <span style={{ 'font-size': '11px', 'font-weight': '700', color: 'var(--red)', 'letter-spacing': '0.05em' }}>
                        OVERDUE
                      </span>
                    </Show>
                  </div>
                  <For each={dayCards}>
                    {(card) => (
                      <button
                        onClick={() => {
                          haptic('tick');
                          push({ name: 'card', id: card.id });
                        }}
                        class="no-select pressable"
                        style={{
                          display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
                          padding: '10px 14px', 'text-align': 'left',
                          'border-top': '1px solid var(--separator)',
                        }}
                      >
                        <span style={{ width: '10px', height: '10px', 'border-radius': '3px', background: card.cover ?? board()!.color, flex: 'none' }} />
                        <span
                          style={{
                            flex: '1', 'font-size': '16px',
                            color: card.completed ? 'var(--text-secondary)' : 'var(--text)',
                            'text-decoration': card.completed ? 'line-through' : 'none',
                            overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
                          }}
                        >
                          {card.title || 'Untitled'}
                        </span>
                        <Show when={card.dueTime}>
                          <span style={{ color: 'var(--text-tertiary)', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' }}>
                            {card.dueTime}
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              );
            }}
          </For>
        </Show>
      </ScreenChrome>
    </Show>
  );
}
