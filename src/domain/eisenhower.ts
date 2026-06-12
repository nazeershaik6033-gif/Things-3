import type { EMQuadrant, Task } from '../db/models';

/** Eisenhower Matrix: display metadata and Today grouping. */

export interface QuadrantMeta {
  id: EMQuadrant;
  label: string;
  desc: string;
  color: string;
}

export const QUADRANTS: QuadrantMeta[] = [
  { id: 'do',        label: 'Do',        desc: 'Urgent & important',      color: 'var(--red)' },
  { id: 'schedule',  label: 'Schedule',  desc: 'Important, not urgent',   color: 'var(--blue)' },
  { id: 'delegate',  label: 'Delegate',  desc: 'Urgent, not important',   color: 'var(--yellow-deep)' },
  { id: 'eliminate', label: 'Eliminate', desc: 'Neither — let it go',     color: 'var(--text-tertiary)' },
];

export function quadrantMeta(id: EMQuadrant): QuadrantMeta {
  return QUADRANTS.find((q) => q.id === id)!;
}

export interface QuadrantGroups {
  unlabeled: Task[];
  groups: { meta: QuadrantMeta; tasks: Task[] }[];
}

/** Partition preserving input order; quadrants in matrix priority order,
 *  empty ones omitted. Tasks without a label stay on top for triage. */
export function groupByQuadrant(tasks: Task[]): QuadrantGroups {
  const unlabeled = tasks.filter((t) => !t.priority);
  const groups = QUADRANTS
    .map((meta) => ({ meta, tasks: tasks.filter((t) => t.priority === meta.id) }))
    .filter((g) => g.tasks.length > 0);
  return { unlabeled, groups };
}
