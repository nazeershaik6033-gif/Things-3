import { nanoid } from 'nanoid';
import { db } from './db';
import { applyOps, type Op } from './mutations';
import {
  keyAtEnd, keyAtIndex, sortByOrderKey, needsRebalance, rebalancedKeys,
} from './ordering';
import type {
  Board, BoardList, BoardLabel, Card, CardComment, ChecklistItem,
} from './models';

/** Board section writes. Same conventions as ./mutations: every write flows
 *  through applyOps, ordering uses fractional orderKeys, cascades batch into a
 *  single op list so a future undo layer sees one atomic step. */

const DEFAULT_BOARD_COLORS = [
  'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--purple)',
  'var(--tan)', 'var(--yellow-deep)', 'var(--red)',
];

/** Label palette offered in the card editor. */
export const LABEL_COLORS = [
  'var(--green)', 'var(--yellow-deep)', 'var(--red)',
  'var(--purple)', 'var(--blue)', 'var(--teal)', 'var(--tan)',
];

// ---------------------------------------------------------------- boards ----

export function newBoard(partial: Partial<Board> = {}): Board {
  const now = Date.now();
  return {
    id: nanoid(),
    title: '',
    color: DEFAULT_BOARD_COLORS[Math.floor(Math.random() * DEFAULT_BOARD_COLORS.length)]!,
    orderKey: '',
    archived: false,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

async function liveBoards(): Promise<Board[]> {
  return (await db.boards.toArray()).filter((b) => !b.archived);
}

export async function createBoard(partial: Partial<Board> = {}): Promise<string> {
  const b = newBoard(partial);
  if (!b.orderKey) b.orderKey = keyAtEnd(await liveBoards());
  await applyOps([{ table: 'boards', key: b.id, before: null, after: b }]);
  return b.id;
}

export async function updateBoard(id: string, patch: Partial<Board>): Promise<void> {
  const before = await db.boards.get(id);
  if (!before) return;
  const after: Board = { ...before, ...patch, modifiedAt: Date.now() };
  await applyOps([{ table: 'boards', key: id, before, after }]);
}

/** Delete a board and everything scoped to it (lists, cards, labels). */
export async function deleteBoard(id: string): Promise<void> {
  const before = await db.boards.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'boards', key: id, before, after: null }];
  for (const l of await db.boardLists.where('boardId').equals(id).toArray()) {
    ops.push({ table: 'boardLists', key: l.id, before: l, after: null });
  }
  for (const c of await db.cards.where('boardId').equals(id).toArray()) {
    ops.push({ table: 'cards', key: c.id, before: c, after: null });
  }
  for (const lab of await db.boardLabels.where('boardId').equals(id).toArray()) {
    ops.push({ table: 'boardLabels', key: lab.id, before: lab, after: null });
  }
  await applyOps(ops);
}

// ----------------------------------------------------------------- lists ----

async function liveLists(boardId: string): Promise<BoardList[]> {
  return (await db.boardLists.where('boardId').equals(boardId).toArray()).filter((l) => !l.archived);
}

export async function createList(boardId: string, title = ''): Promise<string> {
  const l: BoardList = {
    id: nanoid(),
    boardId,
    title,
    orderKey: keyAtEnd(await liveLists(boardId)),
    archived: false,
  };
  await applyOps([{ table: 'boardLists', key: l.id, before: null, after: l }]);
  return l.id;
}

export async function updateList(id: string, patch: Partial<BoardList>): Promise<void> {
  const before = await db.boardLists.get(id);
  if (!before) return;
  await applyOps([{ table: 'boardLists', key: id, before, after: { ...before, ...patch } }]);
}

/** Delete a list and its cards. */
export async function deleteList(id: string): Promise<void> {
  const before = await db.boardLists.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'boardLists', key: id, before, after: null }];
  for (const c of await db.cards.where('listId').equals(id).toArray()) {
    ops.push({ table: 'cards', key: c.id, before: c, after: null });
  }
  await applyOps(ops);
}

/** Reorder a list among its siblings (used by move-left/right menu actions). */
export async function setListOrder(id: string, orderKey: string): Promise<void> {
  await updateList(id, { orderKey });
}

// ----------------------------------------------------------------- cards ----

export function newCard(boardId: string, listId: string, partial: Partial<Card> = {}): Card {
  const now = Date.now();
  return {
    id: nanoid(),
    boardId,
    listId,
    title: '',
    description: '',
    checklist: [],
    labelIds: [],
    cover: null,
    due: null,
    dueTime: null,
    reminded: false,
    completed: false,
    comments: [],
    orderKey: '',
    archived: false,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

/** Open cards in one list, ordered — its orderKey scope. */
export async function listCards(listId: string): Promise<Card[]> {
  const cards = (await db.cards.where('listId').equals(listId).toArray()).filter((c) => !c.archived);
  return sortByOrderKey(cards);
}

export async function createCard(
  boardId: string,
  listId: string,
  partial: Partial<Card> = {},
): Promise<string> {
  const c = newCard(boardId, listId, partial);
  if (!c.orderKey) c.orderKey = keyAtEnd(await listCards(listId));
  await applyOps([{ table: 'cards', key: c.id, before: null, after: c }]);
  return c.id;
}

export async function updateCard(id: string, patch: Partial<Card>): Promise<void> {
  const before = await db.cards.get(id);
  if (!before) return;
  const after: Card = { ...before, ...patch, modifiedAt: Date.now() };
  // Changing (or clearing) the due date arms the reminder again unless the
  // caller set `reminded` explicitly.
  if ((patch.due !== undefined || patch.dueTime !== undefined) && patch.reminded === undefined) {
    after.reminded = false;
  }
  await applyOps([{ table: 'cards', key: id, before, after }]);
}

/** Move a card to a list at a given order slot; rebalances the scope if keys
 *  have grown too long. */
export async function moveCard(id: string, listId: string, orderKey: string): Promise<void> {
  const before = await db.cards.get(id);
  if (!before) return;
  await applyOps([{
    table: 'cards', key: id, before,
    after: { ...before, listId, orderKey, modifiedAt: Date.now() },
  }]);
  await maybeRebalanceList(listId);
}

export async function setCardOrder(id: string, orderKey: string): Promise<void> {
  const before = await db.cards.get(id);
  if (!before) return;
  await moveCard(id, before.listId, orderKey);
}

async function maybeRebalanceList(listId: string): Promise<void> {
  const cards = await listCards(listId);
  if (!needsRebalance(cards)) return;
  const keys = rebalancedKeys(cards.length);
  const now = Date.now();
  await applyOps(cards.map((c, i) => ({
    table: 'cards', key: c.id, before: c,
    after: { ...c, orderKey: keys[i]!, modifiedAt: now } satisfies Card,
  })));
}

export async function deleteCard(id: string): Promise<void> {
  const before = await db.cards.get(id);
  if (!before) return;
  await applyOps([{ table: 'cards', key: id, before, after: null }]);
}

export async function archiveCard(id: string, archived = true): Promise<void> {
  await updateCard(id, { archived });
}

// --------------------------------------------------------------- comments ----

export async function addComment(cardId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const before = await db.cards.get(cardId);
  if (!before) return;
  const comment: CardComment = { id: nanoid(), text: trimmed, createdAt: Date.now() };
  await updateCard(cardId, { comments: [...before.comments, comment] });
}

export async function deleteComment(cardId: string, commentId: string): Promise<void> {
  const before = await db.cards.get(cardId);
  if (!before) return;
  await updateCard(cardId, { comments: before.comments.filter((c) => c.id !== commentId) });
}

// --------------------------------------------------------------- checklist ---

export async function setCardChecklist(cardId: string, checklist: ChecklistItem[]): Promise<void> {
  await updateCard(cardId, { checklist });
}

// ----------------------------------------------------------------- labels ----

export async function createLabel(boardId: string, title: string, color: string): Promise<string> {
  const l: BoardLabel = { id: nanoid(), boardId, title, color };
  await applyOps([{ table: 'boardLabels', key: l.id, before: null, after: l }]);
  return l.id;
}

export async function updateLabel(id: string, patch: Partial<BoardLabel>): Promise<void> {
  const before = await db.boardLabels.get(id);
  if (!before) return;
  await applyOps([{ table: 'boardLabels', key: id, before, after: { ...before, ...patch } }]);
}

/** Delete a label and remove it from every card that referenced it. */
export async function deleteLabel(id: string): Promise<void> {
  const before = await db.boardLabels.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'boardLabels', key: id, before, after: null }];
  const now = Date.now();
  for (const c of await db.cards.where('boardId').equals(before.boardId).toArray()) {
    if (c.labelIds.includes(id)) {
      ops.push({
        table: 'cards', key: c.id, before: c,
        after: { ...c, labelIds: c.labelIds.filter((x) => x !== id), modifiedAt: now } satisfies Card,
      });
    }
  }
  await applyOps(ops);
}

export async function toggleCardLabel(cardId: string, labelId: string): Promise<void> {
  const before = await db.cards.get(cardId);
  if (!before) return;
  const has = before.labelIds.includes(labelId);
  await updateCard(cardId, {
    labelIds: has ? before.labelIds.filter((x) => x !== labelId) : [...before.labelIds, labelId],
  });
}

export { keyAtIndex };
