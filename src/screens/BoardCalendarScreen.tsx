import { createMemo, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery, createReactiveLiveQuery } from '../db/liveQuery';
import { push } from '../app/navigation';
import { currentDate } from '../app/currentDate';
import { formatRelative, daysBetween } from '../domain/dates';
import { Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState, SectionHeading } from './common';
import type { Card } from '../db/models';

/** Agenda of the board's cards that have a due date, grouped by day and sorted
 *  chronologically. Overdue cards surface first. */
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
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  });

  return (
    <Show when={board()}>
      <ScreenChrome
        title={`${board()!.title || 'Board'} · Calendar`}
        icon={<Icon name="calendar" size={24} color="var(--red)" />}
      >
        <Show
          when={groups().length > 0}
          fallback={<EmptyState icon={<Icon name="calendar" size={40} color="var(--text-tertiary)" />} text="No cards with due dates yet." />}
        >
          <For each={groups()}>
            {([date, dayCards]) => {
              const overdue = () => daysBetween(currentDate(), date) < 0;
              return (
                <>
                  <SectionHeading
                    label={formatRelative(date, currentDate())}
                    color={overdue() ? 'var(--red)' : 'var(--blue)'}
                  />
                  <div style={{ padding: '0 10px' }}>
                    <For each={dayCards}>
                      {(card) => (
                        <button
                          onClick={() => push({ name: 'card', id: card.id })}
                          class="no-select"
                          style={{
                            display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
                            padding: '11px 12px', 'text-align': 'left',
                            'border-bottom': '1px solid var(--separator)',
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
                            <span style={{ color: 'var(--text-tertiary)', 'font-size': '13px' }}>{card.dueTime}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </>
              );
            }}
          </For>
        </Show>
      </ScreenChrome>
    </Show>
  );
}
