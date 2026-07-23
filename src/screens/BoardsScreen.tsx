import { createMemo, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { push } from '../app/navigation';
import { sortByOrderKey } from '../db/ordering';
import { createBoard } from '../db/boardMutations';
import { Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState } from './common';

export function BoardsScreen(): JSX.Element {
  const boards = createLiveQuery(() => db.boards.toArray(), []);
  const cards = createLiveQuery(() => db.cards.toArray(), []);

  const liveBoards = createMemo(() => sortByOrderKey(boards().filter((b) => !b.archived)));
  const cardCount = (boardId: string) => cards().filter((c) => c.boardId === boardId && !c.archived).length;

  const newBoard = () => void createBoard({ title: '' }).then((id) => push({ name: 'board', id }));

  return (
    <ScreenChrome
      title="Boards"
      icon={<Icon name="board" size={26} color="var(--blue)" />}
      trailing={
        <button aria-label="New board" data-testid="new-board" onClick={newBoard} style={{ color: 'var(--blue)', padding: '8px 10px', display: 'flex' }}>
          <Icon name="plus" size={20} />
        </button>
      }
    >
      <Show
        when={liveBoards().length > 0}
        fallback={<EmptyState icon={<Icon name="board" size={40} color="var(--text-tertiary)" />} text="No boards yet — tap + to create your first board." />}
      >
        <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '0 10px', padding: '2px 0' }}>
          <For each={liveBoards()}>
            {(b) => (
              <button
                data-testid="board-row"
                onClick={() => push({ name: 'board', id: b.id })}
                class="no-select"
                style={{ display: 'flex', 'align-items': 'center', gap: '13px', width: '100%', padding: '12px 16px', 'text-align': 'left' }}
              >
                <span style={{ width: '22px', height: '22px', 'border-radius': '6px', background: b.color, flex: 'none' }} />
                <span style={{ flex: '1', 'font-size': '17px', color: 'var(--text)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {b.title || 'New Board'}
                </span>
                <span style={{ color: 'var(--text-tertiary)', 'font-size': '16px', 'font-variant-numeric': 'tabular-nums' }}>
                  {cardCount(b.id) || ''}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div style={{ padding: '14px 16px' }}>
        <button data-testid="new-board-row" onClick={newBoard} style={{ display: 'flex', 'align-items': 'center', gap: '7px', color: 'var(--blue)', 'font-size': '16px', 'font-weight': '500' }}>
          <Icon name="plus" size={17} /> New Board
        </button>
      </div>
    </ScreenChrome>
  );
}
