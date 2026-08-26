import { createMemo, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { push } from '../app/navigation';
import { haptic, staggerDelay } from '../app/motion';
import { sortByOrderKey } from '../db/ordering';
import { createBoard } from '../db/boardMutations';
import { Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState } from './common';

/** Boards as a gallery of tiles rather than a list of links: a board is a
 *  place you go, and its accent colour is how you recognise it at a glance. */
export function BoardsScreen(): JSX.Element {
  const boards = createLiveQuery(() => db.boards.toArray(), []);
  const cards = createLiveQuery(() => db.cards.toArray(), []);
  const lists = createLiveQuery(() => db.boardLists.toArray(), []);

  const liveBoards = createMemo(() => sortByOrderKey(boards().filter((b) => !b.archived)));
  const cardCount = (boardId: string) =>
    cards().filter((c) => c.boardId === boardId && !c.archived).length;
  const listCount = (boardId: string) =>
    lists().filter((l) => l.boardId === boardId && !l.archived).length;
  const doneCount = (boardId: string) =>
    cards().filter((c) => c.boardId === boardId && !c.archived && c.completed).length;

  const newBoard = () => {
    haptic('select');
    void createBoard({ title: '' }).then((id) => push({ name: 'board', id }));
  };

  return (
    <ScreenChrome
      title="Boards"
      icon={<Icon name="board" size={26} color="var(--blue)" />}
      subtitle={
        liveBoards().length > 0
          ? `${liveBoards().length} ${liveBoards().length === 1 ? 'board' : 'boards'}`
          : undefined
      }
      trailing={
        <button
          aria-label="New board"
          data-testid="new-board"
          class="pressable"
          onClick={newBoard}
          style={{ color: 'var(--blue)', padding: '8px 10px', display: 'flex' }}
        >
          <Icon name="plus" size={20} />
        </button>
      }
    >
      <Show
        when={liveBoards().length > 0}
        fallback={
          <EmptyState
            icon={<Icon name="board" size={40} color="var(--text-tertiary)" />}
            text="No boards yet — tap + to create your first board."
          />
        }
      >
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '12px',
            padding: '2px 16px 4px',
          }}
        >
          <For each={liveBoards()}>
            {(b, i) => (
              <button
                data-testid="board-row"
                onClick={() => {
                  haptic('tick');
                  push({ name: 'board', id: b.id });
                }}
                class="no-select pressable-card rise"
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'text-align': 'left',
                  'border-radius': '16px',
                  overflow: 'hidden',
                  background: 'var(--bg-list)',
                  border: '1px solid var(--separator)',
                  'animation-delay': staggerDelay(i()),
                }}
              >
                {/* Accent band: the board's colour is its identity */}
                <span style={{ height: '38px', background: b.color, display: 'block' }} />
                <span style={{ padding: '10px 12px 12px', display: 'block' }}>
                  <span
                    style={{
                      display: 'block',
                      'font-size': '16px',
                      'font-weight': '600',
                      color: 'var(--text)',
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    {b.title || 'New Board'}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '8px',
                      'margin-top': '5px',
                      'font-size': '12px',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <span style={{ 'font-variant-numeric': 'tabular-nums' }}>
                      {cardCount(b.id)} {cardCount(b.id) === 1 ? 'card' : 'cards'}
                    </span>
                    <Show when={listCount(b.id) > 0}>
                      <span>·</span>
                      <span style={{ 'font-variant-numeric': 'tabular-nums' }}>
                        {listCount(b.id)} {listCount(b.id) === 1 ? 'list' : 'lists'}
                      </span>
                    </Show>
                  </span>
                  <Show when={cardCount(b.id) > 0}>
                    <span
                      style={{
                        display: 'block',
                        height: '4px',
                        'border-radius': '2px',
                        background: 'var(--bg-inset)',
                        'margin-top': '9px',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          height: '100%',
                          width: `${(doneCount(b.id) / cardCount(b.id)) * 100}%`,
                          background: b.color,
                        }}
                      />
                    </span>
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div style={{ padding: '14px 16px' }}>
        <button
          data-testid="new-board-row"
          class="pressable"
          onClick={newBoard}
          style={{ display: 'flex', 'align-items': 'center', gap: '7px', color: 'var(--blue)', 'font-size': '16px', 'font-weight': '500' }}
        >
          <Icon name="plus" size={17} /> New Board
        </button>
      </div>
    </ScreenChrome>
  );
}
