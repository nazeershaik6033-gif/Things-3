import { db } from './db';
import type { Op } from './mutations';

/** Undo, layered on the ops write path as `mutations.ts` always intended.
 *
 *  `recordUndo(label, fn)` runs `fn` and keeps every op it wrote. Undoing
 *  puts back, for each row it touched, the row as it was before the action —
 *  but only if the row still looks exactly like the action left it. If
 *  something changed it since (another edit, the repeat engine, a sync),
 *  that row is left alone rather than clobbering newer work, and the undo
 *  reports itself as partial.
 *
 *  This module has no UI; `app/undo.ts` adds the toast and Cmd/Ctrl+Z. */

export interface UndoEntry {
  id: number;
  label: string;
  at: number;
  ops: Op[];
}

export type UndoResult = { label: string; restored: number; skipped: number } | null;

const LIMIT = 30;
const stack: UndoEntry[] = [];
let nextId = 1;
let recorder: Op[] | null = null;
let replaying = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function onUndoChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called by `applyOps` for every committed batch. */
export function noteOps(ops: Op[]): void {
  if (recorder && !replaying) recorder.push(...ops);
}

/** Run `fn` as one undoable action. Nested calls join the outer action. */
export async function recordUndo<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (recorder) return fn();
  const ops: Op[] = [];
  recorder = ops;
  try {
    return await fn();
  } finally {
    recorder = null;
    if (ops.length > 0) {
      stack.push({ id: nextId++, label, at: Date.now(), ops });
      if (stack.length > LIMIT) stack.shift();
      notify();
    }
  }
}

export function peekUndo(): UndoEntry | null {
  return stack[stack.length - 1] ?? null;
}

export function undoDepth(): number {
  return stack.length;
}

/** Drop everything (tests, and after a backup import replaces all data). */
export function clearUndo(): void {
  stack.length = 0;
  notify();
}

/** Key order can differ between an object we built and the same row read
 *  back from IndexedDB, so compare a canonical form. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return x;
  });
}

/** Undo the most recent action, or a specific one by id (a toast's Undo
 *  button names the action it was shown for, so a stale toast can't undo
 *  something newer). */
export async function undo(id?: number): Promise<UndoResult> {
  const idx = id === undefined ? stack.length - 1 : stack.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const [entry] = stack.splice(idx, 1);
  notify();
  if (!entry) return null;

  // Per row: the state before the first op and after the last one.
  const rows = new Map<string, { table: Op['table']; key: string; before: unknown; after: unknown }>();
  for (const op of entry.ops) {
    const k = `${op.table}\u0000${op.key}`;
    const row = rows.get(k);
    if (row) row.after = op.after;
    else rows.set(k, { table: op.table, key: op.key, before: op.before, after: op.after });
  }

  let restored = 0;
  let skipped = 0;
  const tables = [...new Set([...rows.values()].map((r) => r.table))];
  replaying = true;
  try {
    await db.transaction('rw', tables, async () => {
      for (const r of rows.values()) {
        const table = db.table(r.table);
        const current = (await table.get(r.key)) ?? null;
        if (canonical(current) !== canonical(r.after)) {
          skipped++;
          continue;
        }
        if (r.before === null) await table.delete(r.key);
        else await table.put(r.before);
        restored++;
      }
    });
  } finally {
    replaying = false;
  }
  return { label: entry.label, restored, skipped };
}
