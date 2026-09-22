import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  addEvidence, archiveBelief, clearConviction, createBelief, deleteBelief,
  deleteEvidence, deleteQuoteNote, reorderBeliefs, restoreBelief, saveQuoteNote,
  setConviction, toggleQuoteFavorite, updateBelief,
} from '../../src/db/beliefMutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import { ratingId } from '../../src/domain/beliefs';
import { sortByOrderKey } from '../../src/db/ordering';

const TODAY = '2026-09-22';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('beliefs', () => {
  it('creates a belief at the end of the board, active, with a colour', async () => {
    const first = await createBelief('I finish what I start.');
    const second = await createBelief('Rest is part of the work.');
    const rows = sortByOrderKey(await db.beliefs.toArray());
    expect(rows.map((b) => b.id)).toEqual([first, second]);
    expect(rows[0]!.active).toBe(true);
    expect(rows[0]!.color).not.toBe(rows[1]!.color);
  });

  it('edits text and why without touching anything else', async () => {
    const id = await createBelief('Draft');
    await updateBelief(id, { text: 'Final', why: 'Because it is true.' });
    const row = await db.beliefs.get(id);
    expect(row).toMatchObject({ text: 'Final', why: 'Because it is true.', active: true });
  });

  it('ignores an edit to a belief that is gone', async () => {
    await updateBelief('missing', { text: 'x' });
    expect(await db.beliefs.count()).toBe(0);
  });

  it('retires a belief but keeps its ratings and evidence', async () => {
    const id = await createBelief('Kept');
    await setConviction(id, TODAY, 7);
    await addEvidence(id, TODAY, 'It happened.');
    await archiveBelief(id);
    expect((await db.beliefs.get(id))!.active).toBe(false);
    expect(await db.beliefRatings.count()).toBe(1);
    expect(await db.beliefEvidence.count()).toBe(1);
    await restoreBelief(id);
    expect((await db.beliefs.get(id))!.active).toBe(true);
  });

  it('deletes a belief along with everything it recorded', async () => {
    const id = await createBelief('Gone');
    const other = await createBelief('Stays');
    await setConviction(id, TODAY, 5);
    await addEvidence(id, TODAY, 'proof');
    await setConviction(other, TODAY, 6);
    await deleteBelief(id);
    expect(await db.beliefs.count()).toBe(1);
    expect(await db.beliefRatings.count()).toBe(1);
    expect(await db.beliefEvidence.count()).toBe(0);
  });

  it('reorders the board', async () => {
    const a = await createBelief('a');
    const b = await createBelief('b');
    const c = await createBelief('c');
    await reorderBeliefs([c, a, b]);
    expect(sortByOrderKey(await db.beliefs.toArray()).map((x) => x.id)).toEqual([c, a, b]);
  });
});

describe('conviction', () => {
  it('writes one row per day and belief, so re-rating corrects the score', async () => {
    const id = await createBelief('b');
    await setConviction(id, TODAY, 4);
    await setConviction(id, TODAY, 8);
    const rows = await db.beliefRatings.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ratingId(TODAY, id), score: 8 });
  });

  it('clamps and rounds whatever it is handed', async () => {
    const id = await createBelief('b');
    await setConviction(id, TODAY, 99);
    expect((await db.beliefRatings.get(ratingId(TODAY, id)))!.score).toBe(10);
    await setConviction(id, TODAY, -4);
    expect((await db.beliefRatings.get(ratingId(TODAY, id)))!.score).toBe(0);
    await setConviction(id, TODAY, 6.6);
    expect((await db.beliefRatings.get(ratingId(TODAY, id)))!.score).toBe(7);
  });

  it('keeps each day separate', async () => {
    const id = await createBelief('b');
    await setConviction(id, '2026-09-21', 3);
    await setConviction(id, TODAY, 9);
    expect(await db.beliefRatings.count()).toBe(2);
  });

  it('clears a rating, and clearing twice is harmless', async () => {
    const id = await createBelief('b');
    await setConviction(id, TODAY, 5);
    await clearConviction(id, TODAY);
    await clearConviction(id, TODAY);
    expect(await db.beliefRatings.count()).toBe(0);
  });
});

describe('evidence', () => {
  it('records a line and refuses an empty one', async () => {
    const id = await createBelief('b');
    expect(await addEvidence(id, TODAY, '   ')).toBeNull();
    const rowId = await addEvidence(id, TODAY, '  Shipped it.  ');
    expect(rowId).not.toBeNull();
    expect((await db.beliefEvidence.get(rowId!))!.text).toBe('Shipped it.');
  });

  it('deletes one line without touching the rest', async () => {
    const id = await createBelief('b');
    const first = await addEvidence(id, TODAY, 'one');
    await addEvidence(id, TODAY, 'two');
    await deleteEvidence(first!);
    expect(await db.beliefEvidence.count()).toBe(1);
  });
});

describe('quotes', () => {
  it('keeps and un-keeps a quote', async () => {
    expect(await toggleQuoteFavorite('cajal-sculptor')).toBe(true);
    expect(await db.quoteFavorites.count()).toBe(1);
    expect(await toggleQuoteFavorite('cajal-sculptor')).toBe(false);
    expect(await db.quoteFavorites.count()).toBe(0);
  });

  it('caches one note per quote, replacing on a re-ask', async () => {
    await saveQuoteNote('cajal-sculptor', 'first answer', 'Gemini 2.5 Flash');
    await saveQuoteNote('cajal-sculptor', 'second answer', 'Gemini 2.5 Flash');
    const rows = await db.quoteNotes.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('second answer');
    await deleteQuoteNote('cajal-sculptor');
    expect(await db.quoteNotes.count()).toBe(0);
  });
});

describe('backup', () => {
  it('carries beliefs, ratings, evidence and quotes through export and import', async () => {
    const id = await createBelief('I keep my word.', 'Because I used not to.');
    await setConviction(id, TODAY, 7);
    await addEvidence(id, TODAY, 'Called back when I said I would.');
    await toggleQuoteFavorite('james-ally');
    await saveQuoteNote('james-ally', 'note text', 'Claude app');

    const file = validateExport(JSON.parse(JSON.stringify(await exportData())));
    expect(file.schemaVersion).toBe(6);
    await Promise.all(db.tables.map((t) => t.clear()));
    await importData(file);

    expect((await db.beliefs.get(id))!.why).toBe('Because I used not to.');
    expect((await db.beliefRatings.get(ratingId(TODAY, id)))!.score).toBe(7);
    expect(await db.beliefEvidence.count()).toBe(1);
    expect(await db.quoteFavorites.count()).toBe(1);
    expect((await db.quoteNotes.get('james-ally'))!.text).toBe('note text');
  });

  it('restores a backup made before the belief board existed', async () => {
    const file = await exportData();
    const older = {
      ...file,
      schemaVersion: 5,
      data: { ...file.data },
    };
    delete (older.data as Record<string, unknown>).beliefs;
    delete (older.data as Record<string, unknown>).beliefRatings;
    delete (older.data as Record<string, unknown>).beliefEvidence;
    delete (older.data as Record<string, unknown>).quoteFavorites;
    delete (older.data as Record<string, unknown>).quoteNotes;
    await importData(validateExport(older));
    expect(await db.beliefs.count()).toBe(0);
  });

  it('rejects a backup whose belief table is not a list', async () => {
    const file = await exportData();
    const broken = { ...file, data: { ...file.data, beliefs: 'nope' } };
    expect(() => validateExport(broken)).toThrow(/malformed/i);
  });
});
