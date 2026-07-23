import { createMemo, createSignal, For, Show, onCleanup, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { back, push } from '../app/navigation';
import { sortByOrderKey } from '../db/ordering';
import {
  createCard, createList, deleteBoard, deleteList, moveCard, updateBoard, updateList,
  setListOrder, createLabel, updateLabel, deleteLabel, keyAtIndex, LABEL_COLORS,
} from '../db/boardMutations';
import { keyBetween } from '../db/mutations';
import { Icon } from '../ui/Icon';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { MenuRow, EmptyState } from './common';
import { BoardCard } from '../components/BoardCard';
import { createBoardDrag } from '../components/BoardDragController';
import type { BoardLabel, Card } from '../db/models';

const COLUMN_WIDTH = 280;

export function BoardScreen(props: { id: string }): JSX.Element {
  const board = createLiveQuery(async () => (await db.boards.get(props.id)) ?? null, null);
  const lists = createLiveQuery(
    () => db.boardLists.where('boardId').equals(props.id).toArray(),
    [],
  );
  const cards = createLiveQuery(() => db.cards.where('boardId').equals(props.id).toArray(), []);
  const labels = createLiveQuery(() => db.boardLabels.where('boardId').equals(props.id).toArray(), []);

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [labelMgr, setLabelMgr] = createSignal(false);
  const [listMenu, setListMenu] = createSignal<string | null>(null);
  const [composerFor, setComposerFor] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  let boardScrollEl: HTMLDivElement | undefined;
  let dragCleanup: (() => void) | undefined;

  const sortedLists = createMemo(() => sortByOrderKey(lists().filter((l) => !l.archived)));
  const cardsByList = createMemo(() => {
    const map = new Map<string, Card[]>();
    for (const c of cards()) {
      if (c.archived) continue;
      const arr = map.get(c.listId) ?? [];
      arr.push(c);
      map.set(c.listId, arr);
    }
    for (const [k, v] of map) map.set(k, sortByOrderKey(v));
    return map;
  });

  // The board element only exists once the async board query resolves (root is
  // gated by <Show>), so wire the drag controller from the ref callback rather
  // than onMount, which would fire while the element is still absent.
  const setBoardScroll = (el: HTMLDivElement) => {
    boardScrollEl = el;
    dragCleanup?.();
    dragCleanup = createBoardDrag(el, {
      boardScroll: () => boardScrollEl ?? null,
      onDrop: (cardId, listId, index) => {
        const target = (cardsByList().get(listId) ?? []).filter((c) => c.id !== cardId);
        const orderKey = keyAtIndex(target, Math.min(index, target.length));
        void moveCard(cardId, listId, orderKey);
      },
    });
  };
  onCleanup(() => dragCleanup?.());

  const addCard = (listId: string) => {
    const title = draft().trim();
    if (!title) { setComposerFor(null); return; }
    void createCard(props.id, listId, { title });
    setDraft('');
  };

  const moveList = (listId: string, dir: -1 | 1) => {
    const arr = sortedLists();
    const idx = arr.findIndex((l) => l.id === listId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    // Recompute a key that lands the list on the other side of its neighbor.
    const before = dir === 1 ? arr[swapIdx] : arr[swapIdx - 1];
    const after = dir === 1 ? arr[swapIdx + 1] : arr[swapIdx];
    void setListOrder(listId, keyBetween(before?.orderKey ?? null, after?.orderKey ?? null));
    setListMenu(null);
  };

  return (
    <Show when={board()}>
      <header
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '4px',
          padding: `calc(var(--safe-top) + 6px) 6px 6px`,
          'min-height': '44px',
          background: 'var(--bg-list)',
          'border-bottom': `3px solid ${board()!.color}`,
          'z-index': '5',
        }}
      >
        <button onClick={back} aria-label="Back" data-testid="back-button" style={{ color: 'var(--blue)', padding: '8px 8px', display: 'flex' }}>
          <Icon name="chevron-left" size={20} />
        </button>
        <input
          value={board()!.title}
          placeholder="New Board"
          data-testid="board-title"
          onInput={(e) => void updateBoard(props.id, { title: e.currentTarget.value })}
          style={{ flex: '1', 'font-size': '19px', 'font-weight': '700', 'min-width': '0' }}
        />
        <button
          aria-label="Board calendar"
          data-testid="board-calendar"
          onClick={() => push({ name: 'boardCalendar', id: props.id })}
          style={{ color: 'var(--text-secondary)', padding: '8px 8px', display: 'flex' }}
        >
          <Icon name="calendar" size={20} />
        </button>
        <button
          aria-label="Board menu"
          data-testid="board-menu"
          onClick={() => setMenuOpen(true)}
          style={{ color: 'var(--text-secondary)', padding: '8px 8px', display: 'flex' }}
        >
          <Icon name="ellipsis" size={20} />
        </button>
      </header>

      <div
        ref={setBoardScroll}
        data-board-scroll
        style={{
          flex: '1',
          display: 'flex',
          'align-items': 'flex-start',
          gap: '12px',
          padding: '12px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          '-webkit-overflow-scrolling': 'touch',
          background: 'var(--bg)',
        }}
      >
        <For each={sortedLists()}>
          {(list) => (
            <div
              data-board-list
              data-list-id={list.id}
              style={{
                width: `${COLUMN_WIDTH}px`,
                'flex': 'none',
                'max-height': '100%',
                display: 'flex',
                'flex-direction': 'column',
                background: 'var(--bg-list)',
                'border-radius': '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '10px 8px 6px 12px' }}>
                <input
                  value={list.title}
                  placeholder="List name"
                  data-testid="list-title"
                  onInput={(e) => void updateList(list.id, { title: e.currentTarget.value })}
                  style={{ flex: '1', 'font-weight': '600', 'font-size': '15px', 'min-width': '0' }}
                />
                <span style={{ color: 'var(--text-tertiary)', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' }}>
                  {cardsByList().get(list.id)?.length ?? 0}
                </span>
                <button aria-label="List menu" onClick={() => setListMenu(list.id)} style={{ color: 'var(--text-tertiary)', padding: '4px', display: 'flex' }}>
                  <Icon name="ellipsis" size={16} />
                </button>
              </div>

              <div data-list-cards style={{ 'overflow-y': 'auto', padding: '2px 8px 0', 'flex': '1' }}>
                <For each={cardsByList().get(list.id) ?? []}>
                  {(card) => (
                    <BoardCard
                      card={card}
                      labels={labels()}
                      onOpen={() => push({ name: 'card', id: card.id })}
                    />
                  )}
                </For>
              </div>

              <Show
                when={composerFor() === list.id}
                fallback={
                  <button
                    data-testid="add-card"
                    onClick={() => { setComposerFor(list.id); setDraft(''); }}
                    style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--text-secondary)', 'font-size': '14px', padding: '10px 12px' }}
                  >
                    <Icon name="plus" size={15} /> Add a card
                  </button>
                }
              >
                <div style={{ padding: '4px 8px 10px' }}>
                  <textarea
                    autofocus
                    value={draft()}
                    placeholder="Card title…"
                    data-testid="card-composer"
                    onInput={(e) => {
                      setDraft(e.currentTarget.value);
                      e.currentTarget.style.height = 'auto';
                      e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addCard(list.id); }
                      else if (e.key === 'Escape') setComposerFor(null);
                    }}
                    onBlur={() => addCard(list.id)}
                    style={{
                      width: '100%',
                      background: 'var(--bg-card)',
                      'border-radius': '9px',
                      padding: '9px 11px',
                      'font-size': '15px',
                      'box-shadow': '0 1px 2px rgba(0,0,0,0.12)',
                      overflow: 'hidden',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '10px', 'margin-top': '6px', 'align-items': 'center' }}>
                    <button onClick={() => addCard(list.id)} style={{ color: '#fff', background: 'var(--blue)', padding: '6px 14px', 'border-radius': '8px', 'font-weight': '600', 'font-size': '14px' }}>
                      Add
                    </button>
                    <button onClick={() => setComposerFor(null)} style={{ color: 'var(--text-secondary)', padding: '6px', display: 'flex' }}>
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* Add-list column */}
        <button
          data-testid="add-list"
          onClick={() => void createList(props.id, '').then((id) => { setComposerFor(id); setDraft(''); })}
          style={{
            width: `${COLUMN_WIDTH}px`,
            flex: 'none',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '14px',
            'border-radius': '12px',
            background: 'rgba(127,127,127,0.12)',
            color: 'var(--text-secondary)',
            'font-size': '15px',
            'font-weight': '500',
          }}
        >
          <Icon name="plus" size={17} /> Add list
        </button>

        <Show when={sortedLists().length === 0}>
          <div style={{ position: 'absolute', inset: '60px 0 0', 'pointer-events': 'none' }}>
            <EmptyState icon={<Icon name="board" size={40} color="var(--text-tertiary)" />} text="Add a list to start organizing cards." />
          </div>
        </Show>
      </div>

      {/* Board menu */}
      <Show when={menuOpen()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>{board()!.title || 'Board'}</SheetTitle>
          <div style={{ display: 'flex', gap: '10px', padding: '4px 20px 12px', 'flex-wrap': 'wrap' }}>
            <For each={LABEL_COLORS}>
              {(color) => (
                <button
                  aria-label="Board color"
                  onClick={() => void updateBoard(props.id, { color })}
                  style={{
                    width: '30px', height: '30px', 'border-radius': '50%', background: color,
                    border: board()!.color === color ? '3px solid var(--text)' : '3px solid transparent',
                  }}
                />
              )}
            </For>
          </div>
          <MenuRow icon={<Icon name="tag" size={20} color="var(--blue)" />} label="Manage Labels" onClick={() => { setMenuOpen(false); setLabelMgr(true); }} />
          <MenuRow icon={<Icon name="calendar" size={20} color="var(--red)" />} label="Calendar View" onClick={() => { setMenuOpen(false); push({ name: 'boardCalendar', id: props.id }); }} />
          <MenuRow icon={<Icon name="trash" size={20} />} danger label="Delete Board" onClick={() => { void deleteBoard(props.id); setMenuOpen(false); back(); }} />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>

      {/* List menu */}
      <Show when={listMenu()}>
        <Sheet onClose={() => setListMenu(null)} dragAnywhere>
          <SheetTitle>List</SheetTitle>
          <MenuRow icon={<Icon name="chevron-left" size={20} color="var(--blue)" />} label="Move Left" onClick={() => moveList(listMenu()!, -1)} />
          <MenuRow icon={<Icon name="chevron-right" size={20} color="var(--blue)" />} label="Move Right" onClick={() => moveList(listMenu()!, 1)} />
          <MenuRow icon={<Icon name="trash" size={20} />} danger label="Delete List (and its cards)" onClick={() => { void deleteList(listMenu()!); setListMenu(null); }} />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>

      {/* Label manager */}
      <Show when={labelMgr()}>
        <LabelManager boardId={props.id} labels={labels()} onClose={() => setLabelMgr(false)} />
      </Show>
    </Show>
  );
}

function LabelManager(props: { boardId: string; labels: BoardLabel[]; onClose: () => void }): JSX.Element {
  const [title, setTitle] = createSignal('');
  const [color, setColor] = createSignal(LABEL_COLORS[0]!);
  const add = () => {
    void createLabel(props.boardId, title().trim(), color());
    setTitle('');
  };
  return (
    <Sheet onClose={props.onClose}>
      <SheetTitle>Labels</SheetTitle>
      <div style={{ 'max-height': '50dvh', 'overflow-y': 'auto', padding: '0 16px' }}>
        <For each={props.labels}>
          {(label) => (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '6px 0' }}>
              <span style={{ width: '22px', height: '22px', 'border-radius': '6px', background: label.color, flex: 'none' }} />
              <input
                value={label.title}
                placeholder="Label name"
                onInput={(e) => void updateLabel(label.id, { title: e.currentTarget.value })}
                style={{ flex: '1', 'font-size': '15px' }}
              />
              <button aria-label="Delete label" onClick={() => void deleteLabel(label.id)} style={{ color: 'var(--red)', padding: '4px', display: 'flex' }}>
                <Icon name="trash" size={17} />
              </button>
            </div>
          )}
        </For>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', padding: '10px 16px 4px' }}>
        <For each={LABEL_COLORS}>
          {(c) => (
            <button
              aria-label="Label color"
              onClick={() => setColor(c)}
              style={{ width: '26px', height: '26px', 'border-radius': '6px', background: c, border: color() === c ? '3px solid var(--text)' : '3px solid transparent' }}
            />
          )}
        </For>
      </div>
      <div style={{ display: 'flex', gap: '8px', padding: '4px 16px 16px' }}>
        <input
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New label…"
          style={{ flex: '1', padding: '8px 12px', 'border-radius': '9px', background: 'var(--bg-inset)' }}
        />
        <button onClick={add} style={{ color: 'var(--blue)', 'font-weight': '600', padding: '8px 6px' }}>Add</button>
      </div>
    </Sheet>
  );
}
