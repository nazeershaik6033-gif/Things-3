import { nanoid } from 'nanoid';
import { db } from './db';
import type {
  Belief, BeliefEvidence, BeliefRating, DateStr, QuoteFavorite, QuoteNote,
} from './models';
import { applyOps, type Op } from './mutations';
import { keyAtEnd, rebalancedKeys, sortByOrderKey } from './ordering';
import { MAX_SCORE, ratingId } from '../domain/beliefs';

/** Writes for the belief board and the daily quote. Same contract as the rest
 *  of the app: every change goes through applyOps as a before/after pair. */

const BELIEF_COLORS = [
  'var(--purple)', 'var(--blue)', 'var(--teal)', 'var(--green)',
  'var(--yellow-deep)', 'var(--tan)', 'var(--red)',
];

/** Colors cycle by position, so a new belief never lands on the same accent as
 *  the one above it and the board stays readable at a glance. */
export function nextBeliefColor(existing: Belief[]): string {
  return BELIEF_COLORS[existing.length % BELIEF_COLORS.length]!;
}

export function newBelief(partial: Partial<Belief> = {}): Belief {
  const now = Date.now();
  return {
    id: nanoid(),
    text: '',
    why: '',
    color: BELIEF_COLORS[0]!,
    orderKey: '',
    active: true,
    createdAt: now,
    modifiedAt: now,
    ...partial,
  };
}

export async function createBelief(text: string, why = ''): Promise<string> {
  const all = await db.beliefs.toArray();
  const siblings = all.filter((b) => b.active);
  const belief = newBelief({
    text,
    why,
    color: nextBeliefColor(siblings),
    orderKey: keyAtEnd(siblings),
  });
  await applyOps([{ table: 'beliefs', key: belief.id, before: null, after: belief }]);
  return belief.id;
}

export async function updateBelief(id: string, patch: Partial<Belief>): Promise<void> {
  const before = await db.beliefs.get(id);
  if (!before) return;
  const after: Belief = { ...before, ...patch, modifiedAt: Date.now() };
  await applyOps([{ table: 'beliefs', key: id, before, after }]);
}

/** Retire a belief: it leaves today's session but every rating and piece of
 *  evidence it gathered stays, so the history you built keeps its meaning. */
export async function archiveBelief(id: string): Promise<void> {
  await updateBelief(id, { active: false });
}

export async function restoreBelief(id: string): Promise<void> {
  await updateBelief(id, { active: true });
}

/** Remove a belief along with everything it recorded. */
export async function deleteBelief(id: string): Promise<void> {
  const before = await db.beliefs.get(id);
  if (!before) return;
  const ops: Op[] = [{ table: 'beliefs', key: id, before, after: null }];
  for (const r of await db.beliefRatings.where('beliefId').equals(id).toArray()) {
    ops.push({ table: 'beliefRatings', key: r.id, before: r, after: null });
  }
  for (const e of await db.beliefEvidence.where('beliefId').equals(id).toArray()) {
    ops.push({ table: 'beliefEvidence', key: e.id, before: e, after: null });
  }
  await applyOps(ops);
}

export async function reorderBeliefs(idsInNewOrder: string[]): Promise<void> {
  const keys = rebalancedKeys(idsInNewOrder.length);
  const ops: Op[] = [];
  const now = Date.now();
  for (let i = 0; i < idsInNewOrder.length; i++) {
    const before = await db.beliefs.get(idsInNewOrder[i]!);
    if (!before) continue;
    ops.push({
      table: 'beliefs',
      key: before.id,
      before,
      after: { ...before, orderKey: keys[i]!, modifiedAt: now } satisfies Belief,
    });
  }
  await applyOps(ops);
}

/** Record conviction for one belief on one day. Idempotent by construction:
 *  the row id is the (date, belief) pair, so rating again corrects the score. */
export async function setConviction(
  beliefId: string,
  date: DateStr,
  score: number,
): Promise<void> {
  const clamped = Math.max(0, Math.min(MAX_SCORE, Math.round(score)));
  const key = ratingId(date, beliefId);
  const before = (await db.beliefRatings.get(key)) ?? null;
  if (before && before.score === clamped) return;
  const after: BeliefRating = {
    id: key,
    beliefId,
    date,
    score: clamped,
    ratedAt: Date.now(),
  };
  await applyOps([{ table: 'beliefRatings', key, before, after }]);
}

/** Undo today's rating — for the misfire, not for rewriting history. */
export async function clearConviction(beliefId: string, date: DateStr): Promise<void> {
  const key = ratingId(date, beliefId);
  const before = await db.beliefRatings.get(key);
  if (!before) return;
  await applyOps([{ table: 'beliefRatings', key, before, after: null }]);
}

export async function addEvidence(
  beliefId: string,
  date: DateStr,
  text: string,
): Promise<string | null> {
  const body = text.trim();
  if (!body) return null;
  const row: BeliefEvidence = {
    id: nanoid(),
    beliefId,
    date,
    text: body,
    createdAt: Date.now(),
  };
  await applyOps([{ table: 'beliefEvidence', key: row.id, before: null, after: row }]);
  return row.id;
}

export async function deleteEvidence(id: string): Promise<void> {
  const before = await db.beliefEvidence.get(id);
  if (!before) return;
  await applyOps([{ table: 'beliefEvidence', key: id, before, after: null }]);
}

/** Keep or un-keep today's quote. */
export async function toggleQuoteFavorite(quoteId: string): Promise<boolean> {
  const before = (await db.quoteFavorites.get(quoteId)) ?? null;
  if (before) {
    await applyOps([{ table: 'quoteFavorites', key: quoteId, before, after: null }]);
    return false;
  }
  const after: QuoteFavorite = { id: quoteId, savedAt: Date.now() };
  await applyOps([{ table: 'quoteFavorites', key: quoteId, before: null, after }]);
  return true;
}

/** Cache a "go deeper" answer so it is paid for once and readable offline. */
export async function saveQuoteNote(
  quoteId: string,
  text: string,
  provider: string,
): Promise<void> {
  const before = (await db.quoteNotes.get(quoteId)) ?? null;
  const after: QuoteNote = { quoteId, text, provider, createdAt: Date.now() };
  await applyOps([{ table: 'quoteNotes', key: quoteId, before, after }]);
}

export async function deleteQuoteNote(quoteId: string): Promise<void> {
  const before = await db.quoteNotes.get(quoteId);
  if (!before) return;
  await applyOps([{ table: 'quoteNotes', key: quoteId, before, after: null }]);
}

export { sortByOrderKey };
