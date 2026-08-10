import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  createBoard, updateBoard, deleteBoard,
  createList, updateList, deleteList, setListOrder,
  createCard, updateCard, moveCard, setCardOrder, deleteCard, archiveCard,
  listCards, keyAtIndex,
  createLabel, deleteLabel, toggleCardLabel,
  addComment, deleteComment,
} from '../../src/db/boardMutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import { sortByOrderKey } from '../../src/db/ordering';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

/** Order the given card ids as they'd appear in a list. */
async function orderOf(listId: string): Promise<string[]> {
  return (await listCards(listId)).map((c) => c.id);
}

describe('boards', () => {
  it('createBoard gives an orderKey and appends in order', async () => {
    const a = await createBoard({ title: 'A' });
    const b = await createBoard({ title: 'B' });
    const ba = (await db.boards.get(a))!;
    const bb = (await db.boards.get(b))!;
    expect(ba.orderKey).toBeTruthy();
    expect(ba.orderKey < bb.orderKey).toBe(true);
  });

  it('deleteBoard cascades to lists, cards, and labels', async () => {
    const board = await createBoard({ title: 'B' });
    const label = await createLabel(board, 'L', 'var(--red)');
    const list = await createList(board, 'To Do');
    const card = await createCard(board, list, { title: 'C', labelIds: [label] });
    // A second, unrelated board must survive.
    const other = await createBoard({ title: 'Other' });
    const otherList = await createList(other, 'Keep');

    await deleteBoard(board);
    expect(await db.boards.get(board)).toBeUndefined();
    expect(await db.boardLists.get(list)).toBeUndefined();
    expect(await db.cards.get(card)).toBeUndefined();
    expect(await db.boardLabels.get(label)).toBeUndefined();
    expect(await db.boardLists.get(otherList)).toBeDefined();
  });
});

describe('lists', () => {
  it('createList appends within the board', async () => {
    const board = await createBoard({ title: 'B' });
    const a = await createList(board, 'A');
    const b = await createList(board, 'B');
    const la = (await db.boardLists.get(a))!;
    const lb = (await db.boardLists.get(b))!;
    expect(la.orderKey < lb.orderKey).toBe(true);
  });

  it('deleteList removes its cards', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const card = await createCard(board, list, { title: 'C' });
    await deleteList(list);
    expect(await db.boardLists.get(list)).toBeUndefined();
    expect(await db.cards.get(card)).toBeUndefined();
  });

  it('setListOrder can move a list before another', async () => {
    const board = await createBoard({ title: 'B' });
    const a = await createList(board, 'A');
    const b = await createList(board, 'B');
    const lb = (await db.boardLists.get(b))!;
    // Place A after B by giving it a key beyond B.
    await setListOrder(a, lb.orderKey + 'z');
    const ordered = sortByOrderKey(await db.boardLists.where('boardId').equals(board).toArray());
    expect(ordered.map((l) => l.id)).toEqual([b, a]);
  });
});

describe('cards', () => {
  it('createCard appends within the list', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const c1 = await createCard(board, list, { title: '1' });
    const c2 = await createCard(board, list, { title: '2' });
    expect(await orderOf(list)).toEqual([c1, c2]);
  });

  it('setCardOrder reorders within a list', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const c1 = await createCard(board, list, { title: '1' });
    const c2 = await createCard(board, list, { title: '2' });
    const c3 = await createCard(board, list, { title: '3' });
    // Move c3 to the front.
    const cards = await listCards(list);
    const key = keyAtIndex(cards.filter((c) => c.id !== c3), 0);
    await setCardOrder(c3, key);
    expect(await orderOf(list)).toEqual([c3, c1, c2]);
  });

  it('moveCard changes listId and order', async () => {
    const board = await createBoard({ title: 'B' });
    const todo = await createList(board, 'To Do');
    const done = await createList(board, 'Done');
    const c1 = await createCard(board, todo, { title: '1' });
    const c2 = await createCard(board, todo, { title: '2' });
    const target = (await listCards(done)).filter((c) => c.id !== c1);
    await moveCard(c1, done, keyAtIndex(target, target.length));
    expect((await db.cards.get(c1))!.listId).toBe(done);
    expect(await orderOf(todo)).toEqual([c2]);
    expect(await orderOf(done)).toEqual([c1]);
  });

  it('updateCard re-arms the reminder when the due date changes', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const card = await createCard(board, list, { title: 'C', due: '2026-01-01' });
    await updateCard(card, { reminded: true });
    expect((await db.cards.get(card))!.reminded).toBe(true);
    await updateCard(card, { due: '2026-02-02' });
    expect((await db.cards.get(card))!.reminded).toBe(false);
  });

  it('archiveCard hides a card from its list', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const card = await createCard(board, list, { title: 'C' });
    await archiveCard(card);
    expect(await orderOf(list)).toEqual([]);
  });

  it('deleteCard removes it', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const card = await createCard(board, list, { title: 'C' });
    await deleteCard(card);
    expect(await db.cards.get(card)).toBeUndefined();
  });
});

describe('labels', () => {
  it('toggleCardLabel adds then removes', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const label = await createLabel(board, 'L', 'var(--red)');
    const card = await createCard(board, list, { title: 'C' });
    await toggleCardLabel(card, label);
    expect((await db.cards.get(card))!.labelIds).toEqual([label]);
    await toggleCardLabel(card, label);
    expect((await db.cards.get(card))!.labelIds).toEqual([]);
  });

  it('deleteLabel pulls it from every card', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const label = await createLabel(board, 'L', 'var(--red)');
    const keep = await createLabel(board, 'K', 'var(--green)');
    const card = await createCard(board, list, { title: 'C', labelIds: [label, keep] });
    await deleteLabel(label);
    expect(await db.boardLabels.get(label)).toBeUndefined();
    expect((await db.cards.get(card))!.labelIds).toEqual([keep]);
  });
});

describe('comments', () => {
  it('addComment appends; deleteComment removes', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const card = await createCard(board, list, { title: 'C' });
    await addComment(card, '  hello  ');
    await addComment(card, '   '); // blank ignored
    const withOne = (await db.cards.get(card))!;
    expect(withOne.comments.length).toBe(1);
    expect(withOne.comments[0]!.text).toBe('hello');
    await deleteComment(card, withOne.comments[0]!.id);
    expect((await db.cards.get(card))!.comments.length).toBe(0);
  });
});

describe('rebalancing', () => {
  it('moveCard rebalances when keys grow too long', async () => {
    const board = await createBoard({ title: 'B' });
    const list = await createList(board, 'A');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await createCard(board, list, { title: `c${i}` }));
    await updateCard(ids[0]!, { orderKey: 'a'.repeat(60) });
    await moveCard(ids[1]!, list, 'a'.repeat(61));
    const all = await db.cards.toArray();
    expect(all.every((c) => c.orderKey.length <= 40)).toBe(true);
  });
});

describe('export / import with boards', () => {
  it('roundtrips board data', async () => {
    const board = await createBoard({ title: 'Roadmap' });
    const label = await createLabel(board, 'Bug', 'var(--red)');
    const list = await createList(board, 'To Do');
    await createCard(board, list, { title: 'Fix it', labelIds: [label], due: '2026-05-05' });

    const file = await exportData();
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await db.boards.count()).toBe(0);

    await importData(validateExport(JSON.parse(JSON.stringify(file))));
    expect(await db.boards.count()).toBe(1);
    expect(await db.boardLists.count()).toBe(1);
    expect(await db.boardLabels.count()).toBe(1);
    expect(await db.cards.count()).toBe(1);
  });

  it('accepts a legacy v1 backup without board tables', async () => {
    const legacy = {
      app: 'clarity',
      schemaVersion: 1,
      exportedAt: Date.now(),
      data: { tasks: [], projects: [], headings: [], areas: [], tags: [], settings: [] },
    };
    await importData(validateExport(legacy));
    expect(await db.cards.count()).toBe(0);
  });
});
