import type {
  DateStr, EMQuadrant, Heading, Project, ProjectTemplate, StageFilter, Task, ViewFilter,
} from '../db/models';
import { addDays, fromDateStr } from './dates';
import { isoWeek } from './calendarMonth';
import { QUADRANTS } from './eisenhower';

/** Phase 4 of the planner work: Kanban stages, dependencies ("waits for"),
 *  saved views, project templates and the week a review belongs to. Pure. */

// ---------------------------------------------------------------- stages --

export const STAGES: { id: StageFilter; label: string; color: string }[] = [
  { id: 'todo', label: 'To Do', color: 'var(--text-tertiary)' },
  { id: 'doing', label: 'In Progress', color: 'var(--blue)' },
  { id: 'waiting', label: 'Waiting', color: 'var(--orange, var(--yellow-deep))' },
];

export function stageOf(t: Task): StageFilter {
  return t.stage ?? 'todo';
}

const live = (t: Task | undefined): t is Task => !!t && t.trashedAt === null;
const open = (t: Task | undefined): t is Task => live(t) && t.status === 'open';

// ---------------------------------------------------------- dependencies --

/** The to-dos `t` still waits for: listed, existing, open. A blocker that was
 *  finished, canceled or deleted no longer blocks. */
export function openBlockers(t: Task, byId: Map<string, Task>): Task[] {
  return (t.blockedBy ?? []).map((id) => byId.get(id)).filter(open);
}

export function isBlocked(t: Task, byId: Map<string, Task>): boolean {
  return openBlockers(t, byId).length > 0;
}

/** Open to-dos that wait for `id` (TaskNotes derives "blocking" the same way:
 *  it's never stored, only read back from the other side). */
export function waitingOn(id: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => open(t) && (t.blockedBy ?? []).includes(id));
}

/** Would making `taskId` wait for `candidateId` create a loop? True if the
 *  candidate already waits (directly or through others) for `taskId`. */
export function wouldCycle(taskId: string, candidateId: string, byId: Map<string, Task>): boolean {
  if (taskId === candidateId) return true;
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.blockedBy ?? []));
  }
  return false;
}

/** What finishing `doneId` frees up: to-dos that waited for it and now wait
 *  for nothing else. Call with the task list *after* the completion. */
export function unlockedBy(doneId: string, tasks: Task[]): Task[] {
  // Treat the finished one as done even if the list predates the write
  const after = tasks.map((t) => (t.id === doneId ? { ...t, status: 'completed' as const } : t));
  const byId = new Map(after.map((t) => [t.id, t]));
  return waitingOn(doneId, after).filter((t) => !isBlocked(t, byId));
}

/** "Can do now": open, not in the Inbox or Someday, not dated in the
 *  future, not waiting on someone, and not blocked by another to-do. */
export function canDoNow(tasks: Task[], today: DateStr): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) =>
    open(t) &&
    t.bucket !== 'inbox' && t.bucket !== 'someday' &&
    (t.startDate === null || t.startDate <= today) &&
    t.stage !== 'waiting' &&
    !isBlocked(t, byId),
  );
}

// ---------------------------------------------------------------- kanban --

export type KanbanGroup = 'stage' | 'heading' | 'quadrant';

export interface KanbanColumn {
  /** Stage id, heading id ('root' for none) or quadrant ('none' for unset). */
  id: string;
  title: string;
  color: string;
  tasks: Task[];
}

/** Columns for a Kanban of to-dos (TaskNotes' Kanban, grouped by a field). */
export function kanbanColumns(tasks: Task[], group: KanbanGroup, headings: Heading[] = []): KanbanColumn[] {
  const sorted = [...tasks].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
  if (group === 'stage') {
    return STAGES.map((s) => ({ id: s.id, title: s.label, color: s.color, tasks: sorted.filter((t) => stageOf(t) === s.id) }));
  }
  if (group === 'quadrant') {
    return [
      ...QUADRANTS.map((q) => ({ id: q.id, title: q.label, color: q.color, tasks: sorted.filter((t) => t.priority === q.id) })),
      { id: 'none', title: 'Unsorted', color: 'var(--text-tertiary)', tasks: sorted.filter((t) => !t.priority) },
    ];
  }
  const hs = [...headings].sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
  return [
    { id: 'root', title: 'No heading', color: 'var(--text-tertiary)', tasks: sorted.filter((t) => !t.headingId) },
    ...hs.map((h) => ({ id: h.id, title: h.title || 'Heading', color: 'var(--blue)', tasks: sorted.filter((t) => t.headingId === h.id) })),
  ];
}

/** The patch that moves a to-do into a column. */
export function columnPatch(group: KanbanGroup, columnId: string): Partial<Task> {
  if (group === 'stage') return { stage: columnId === 'todo' ? null : (columnId as Task['stage']) };
  if (group === 'quadrant') return { priority: columnId === 'none' ? null : (columnId as EMQuadrant) };
  return { headingId: columnId === 'root' ? null : columnId };
}

// ----------------------------------------------------------- saved views --

export function emptyFilter(): ViewFilter {
  return {
    tagIds: [], home: null, stages: [], quadrants: [], energy: null,
    dueWithinDays: null, when: 'any', unblockedOnly: false, search: '',
  };
}

/** Open to-dos matching every condition the view sets. */
export function applyView(tasks: Task[], f: ViewFilter, projects: Project[], today: DateStr): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const areaOfProject = new Map(projects.map((p) => [p.id, p.areaId]));
  const q = f.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (!open(t)) return false;
    if (f.tagIds.length && !f.tagIds.every((id) => t.tagIds.includes(id))) return false;
    if (f.home) {
      const [kind, id] = [f.home.slice(0, 1), f.home.slice(2)];
      if (kind === 'p' && t.projectId !== id) return false;
      if (kind === 'a' && t.areaId !== id && !(t.projectId && areaOfProject.get(t.projectId) === id)) return false;
    }
    if (f.stages.length && !f.stages.includes(stageOf(t))) return false;
    if (f.quadrants.length && (!t.priority || !f.quadrants.includes(t.priority))) return false;
    if (f.energy && t.energy !== f.energy) return false;
    if (f.dueWithinDays !== null && (!t.deadline || t.deadline > addDays(today, f.dueWithinDays))) return false;
    if (f.when === 'today' && !(t.startDate !== null && t.startDate <= today)) return false;
    if (f.when === 'scheduled' && !(t.startDate !== null && t.startDate > today)) return false;
    if (f.when === 'unscheduled' && (t.startDate !== null || t.bucket === 'someday')) return false;
    if (f.when === 'someday' && t.bucket !== 'someday') return false;
    if (f.unblockedOnly && isBlocked(t, byId)) return false;
    if (q && !`${t.title}\n${t.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Human summary of a filter, for the list under its title. */
export function describeView(f: ViewFilter, names: { tag: (id: string) => string; home: (key: string) => string }): string {
  const parts: string[] = [];
  if (f.home) parts.push(names.home(f.home));
  if (f.tagIds.length) parts.push(f.tagIds.map((id) => `#${names.tag(id)}`).join(' '));
  if (f.stages.length) parts.push(f.stages.map((s) => STAGES.find((x) => x.id === s)!.label).join('/'));
  if (f.quadrants.length) parts.push(f.quadrants.map((q) => QUADRANTS.find((x) => x.id === q)!.label).join('/'));
  if (f.energy) parts.push(f.energy === 'high' ? 'high energy' : 'low energy');
  if (f.dueWithinDays !== null) parts.push(f.dueWithinDays === 0 ? 'due today' : `due within ${f.dueWithinDays}d`);
  if (f.when !== 'any') parts.push(f.when);
  if (f.unblockedOnly) parts.push('not blocked');
  if (f.search.trim()) parts.push(`“${f.search.trim()}”`);
  return parts.join(' · ') || 'All open to-dos';
}

// ------------------------------------------------------------- templates --

/** A project's open and finished to-dos, in project order, as a template.
 *  Dates, times and completion are dropped; dependencies inside the
 *  project are kept as indexes. */
export function templateFromProject(
  p: Project,
  headings: Heading[],
  tasks: Task[],
): Omit<ProjectTemplate, 'id' | 'createdAt'> {
  const hs = [...headings].filter((h) => h.projectId === p.id).sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
  const byOrder = (a: Task, b: Task) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);
  const mine = tasks.filter((t) => t.projectId === p.id && t.trashedAt === null && t.status !== 'canceled');
  const ordered = [
    ...mine.filter((t) => !t.headingId).sort(byOrder),
    ...hs.flatMap((h) => mine.filter((t) => t.headingId === h.id).sort(byOrder)),
  ];
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  return {
    title: p.title,
    notes: p.notes,
    headings: hs.map((h) => h.title),
    tasks: ordered.map((t) => ({
      title: t.title,
      notes: t.notes,
      checklist: t.checklist.map((c) => c.title),
      tagIds: [...t.tagIds],
      timeEstimateMin: t.timeEstimateMin ?? null,
      waitsFor: (t.blockedBy ?? []).map((id) => index.get(id)).filter((i): i is number => i !== undefined),
      heading: t.headingId ? hs.findIndex((h) => h.id === t.headingId) : null,
    })),
  };
}

// ------------------------------------------------------------------ week --

/** "2026-W48" for a date, by ISO week (the year of that week's Thursday). */
export function weekKey(d: DateStr): string {
  const x = fromDateStr(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + 3);
  return `${x.getFullYear()}-W${String(isoWeek(d)).padStart(2, '0')}`;
}

/** Monday of the week `d` is in. */
export function mondayOf(d: DateStr): DateStr {
  return addDays(d, -((fromDateStr(d).getDay() + 6) % 7));
}

export interface WeekReview {
  done: Task[];
  overdue: Task[];
  inbox: number;
  waiting: Task[];
  /** Open projects with no to-do you could pick up now. */
  stuckProjects: Project[];
  comingUp: Task[];
}

/** The numbers and lists a weekly review walks through (TaskNotes' weekly
 *  maintenance workflow, on Clarity's lists). */
export function weekReview(tasks: Task[], projects: Project[], today: DateStr): WeekReview {
  const weekAgo = addDays(today, -7);
  const nextWeek = addDays(today, 7);
  const can = new Set(canDoNow(tasks, today).map((t) => t.id));
  const doneSince = fromDateStr(weekAgo).getTime();
  return {
    done: tasks.filter((t) => live(t) && t.status === 'completed' && (t.completedAt ?? 0) >= doneSince),
    overdue: tasks.filter((t) => open(t) && ((t.deadline !== null && t.deadline < today))),
    inbox: tasks.filter((t) => open(t) && t.bucket === 'inbox').length,
    waiting: tasks.filter((t) => open(t) && t.stage === 'waiting'),
    stuckProjects: projects.filter((p) =>
      p.trashedAt === null && p.status === 'open' && p.bucket !== 'someday' &&
      !tasks.some((t) => t.projectId === p.id && can.has(t.id)),
    ),
    comingUp: tasks.filter((t) => open(t) && (
      (t.startDate !== null && t.startDate > today && t.startDate <= nextWeek) ||
      (t.deadline !== null && t.deadline >= today && t.deadline <= nextWeek)
    )),
  };
}
