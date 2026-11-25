import { liveQuery } from 'dexie';
import { createSignal } from 'solid-js';
import { db } from '../db/db';
import { onTaskCompleted } from '../db/mutations';
import { isBlocked, unlockedBy } from '../domain/workflow';
import { showToast } from './focusState';

/** App-wide dependency state: which open to-dos are blocked (rows show a
 *  lock without every screen loading every to-do), and a nudge when
 *  finishing something frees up what was waiting for it. */

const [blockedIds, setBlockedIds] = createSignal<Set<string>>(new Set());
export { blockedIds };

export function startWorkflow(): () => void {
  const sub = liveQuery(async () => {
    const tasks = await db.tasks.toArray();
    if (!tasks.some((t) => (t.blockedBy ?? []).length > 0)) return new Set<string>();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return new Set(tasks.filter((t) => t.status === 'open' && isBlocked(t, byId)).map((t) => t.id));
  }).subscribe({ next: (s) => setBlockedIds(s), error: (e) => console.error('workflow', e) });

  const off = onTaskCompleted(async (task) => {
    const freed = unlockedBy(task.id, await db.tasks.toArray());
    if (freed.length === 1) showToast(`🔓 Ready now: ${freed[0]!.title || 'New To-Do'}`, 3500);
    else if (freed.length > 1) showToast(`🔓 ${freed.length} to-dos are ready now`, 3500);
  });
  return () => {
    sub.unsubscribe();
    off();
  };
}
