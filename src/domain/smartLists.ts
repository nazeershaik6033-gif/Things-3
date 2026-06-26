import type { Task, Project, Heading, Area, DateStr } from '../db/models';
import { byOrderKey, sortByOrderKey } from '../db/ordering';
import { addDays, dateStrOf, dayOfMonth, daysBetween, detectTimeOfDay, monthName, weekdayName, yearOf } from './dates';

/** Pure membership predicates + grouping for every built-in list.
 *  `today` always comes from the caller (the reactive currentDate signal). */

export const isLive = (x: { trashedAt: number | null }) => x.trashedAt === null;
export const isOpen = (x: { status: string }) => x.status === 'open';
const liveOpen = (x: Task | Project) => isLive(x) && isOpen(x);

// ---------------------------------------------------------------- inbox ----

export function inInbox(t: Task): boolean {
  return liveOpen(t) && t.bucket === 'inbox';
}

export function inboxTasks(tasks: Task[]): Task[] {
  return sortByOrderKey(tasks.filter(inInbox));
}

// ---------------------------------------------------------------- today ----

export function inToday(t: Task, today: DateStr): boolean {
  if (!liveOpen(t)) return false;
  // Only tasks explicitly scheduled for today — past startDates go to Prior
  if (t.startDate !== null) return t.startDate === today;
  // Tasks with no start date surface in Today when their deadline is due/overdue
  return t.deadline !== null && t.deadline <= today;
}

/** Keyed rows sort by todayOrderKey; rows that drifted in (rollover, deadline)
 *  have no key yet and sort after, by orderKey. '~' > any fractional-index char. */
export function todaySortKey(t: Task): string {
  return t.todayOrderKey ?? `~${t.orderKey}`;
}

export interface TodayLists {
  morning: Task[];
  afternoon: Task[];
  ungrouped: Task[];
  tonight: Task[];
}

export function todayTasks(tasks: Task[], today: DateStr): TodayLists {
  const members = tasks.filter((t) => inToday(t, today));
  members.sort((a, b) => (todaySortKey(a) < todaySortKey(b) ? -1 : 1));
  const morning: Task[] = [];
  const afternoon: Task[] = [];
  const ungrouped: Task[] = [];
  const tonight: Task[] = [];
  for (const t of members) {
    if (t.evening) { tonight.push(t); continue; }
    if (t.reminderTime === 'morning') { morning.push(t); continue; }
    if (t.reminderTime === 'afternoon') { afternoon.push(t); continue; }
    const detected = detectTimeOfDay(t.title);
    if (detected === 'morning') morning.push(t);
    else if (detected === 'afternoon') afternoon.push(t);
    else if (detected === 'evening') tonight.push(t);
    else ungrouped.push(t);
  }
  return { morning, afternoon, ungrouped, tonight };
}

export function isOverdue(t: Task, today: DateStr): boolean {
  return liveOpen(t) && t.deadline !== null && t.deadline < today;
}

// ------------------------------------------------------------- upcoming ----

export function inUpcoming(t: Task, today: DateStr): boolean {
  if (!liveOpen(t)) return false;
  if (t.startDate !== null && t.startDate > today) return true;
  // Future deadline with no earlier start surfaces on its deadline date
  return t.startDate === null && t.deadline !== null && t.deadline > today;
}

export function upcomingDateOf(t: Task, today: DateStr): DateStr {
  if (t.startDate !== null && t.startDate > today) return t.startDate;
  return t.deadline!;
}

export interface UpcomingGroup {
  /** A single day (first 7 days) or a month bucket. */
  kind: 'day' | 'month';
  date: DateStr; // the day, or first visible day of the month
  label: string;
  sublabel: string;
  tasks: Task[];
}

export function upcomingGroups(tasks: Task[], today: DateStr): UpcomingGroup[] {
  const members = tasks.filter((t) => inUpcoming(t, today));
  const byDate = new Map<DateStr, Task[]>();
  for (const t of members) {
    const d = upcomingDateOf(t, today);
    const list = byDate.get(d) ?? [];
    list.push(t);
    byDate.set(d, list);
  }
  for (const list of byDate.values()) list.sort(byOrderKey);

  const groups: UpcomingGroup[] = [];
  // Next 7 individual days always shown (even when empty) like Things
  const weekday = (s: DateStr) =>
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).getDay()]!;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    groups.push({
      kind: 'day',
      date: d,
      label: i === 1 ? 'Tomorrow' : weekday(d),
      sublabel: String(Number(d.slice(8, 10))),
      tasks: byDate.get(d) ?? [],
    });
  }
  // Beyond 7 days: month buckets, only non-empty
  const horizon = addDays(today, 7);
  const monthMap = new Map<string, { date: DateStr; tasks: Task[] }>();
  const laterDates = [...byDate.keys()].filter((d) => d > horizon).sort();
  for (const d of laterDates) {
    const key = d.slice(0, 7);
    const m = monthMap.get(key) ?? { date: d, tasks: [] };
    m.tasks.push(...byDate.get(d)!);
    monthMap.set(key, m);
  }
  for (const [key, m] of [...monthMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    groups.push({
      kind: 'month',
      date: m.date,
      label: monthName(m.date),
      sublabel: yearOf(m.date) === yearOf(today) ? '' : String(yearOf(m.date)),
      tasks: m.tasks,
    });
    void key;
  }
  return groups;
}

// -------------------------------------------------------------- anytime ----

export function inAnytime(t: Task, today: DateStr): boolean {
  if (!liveOpen(t)) return false;
  return t.bucket === 'anytime' && (t.startDate === null || t.startDate <= today);
}

// -------------------------------------------------------------- someday ----

export function inSomeday(t: Task): boolean {
  return liveOpen(t) && t.bucket === 'someday' && t.startDate === null;
}

/** Anytime/Someday group rows under their project/area in sidebar order. */
export interface HomeGroup {
  kind: 'standalone' | 'project' | 'area';
  id: string | null;
  title: string;
  tasks: Task[];
}

export function groupByHome(
  members: Task[],
  projects: Project[],
  areas: Area[],
): HomeGroup[] {
  const groups: HomeGroup[] = [];
  const standalone = members.filter((t) => !t.projectId && !t.areaId);
  if (standalone.length) {
    groups.push({ kind: 'standalone', id: null, title: '', tasks: sortByOrderKey(standalone) });
  }
  const liveProjects = sortByOrderKey(projects.filter(liveOpen));
  const liveAreas = sortByOrderKey(areas);
  const areaIndex = new Map(liveAreas.map((a, i) => [a.id, i]));
  // Standalone projects first, then by area in sidebar order (Things layout)
  const orderedProjects = [
    ...liveProjects.filter((p) => !p.areaId),
    ...liveProjects
      .filter((p) => p.areaId && areaIndex.has(p.areaId))
      .sort((a, b) => areaIndex.get(a.areaId!)! - areaIndex.get(b.areaId!)! || byOrderKey(a, b)),
  ];
  for (const p of orderedProjects) {
    const tasks = members.filter((t) => t.projectId === p.id);
    if (tasks.length) groups.push({ kind: 'project', id: p.id, title: p.title, tasks: sortByOrderKey(tasks) });
  }
  for (const a of liveAreas) {
    const tasks = members.filter((t) => !t.projectId && t.areaId === a.id);
    if (tasks.length) groups.push({ kind: 'area', id: a.id, title: a.title, tasks: sortByOrderKey(tasks) });
  }
  return groups;
}

// --------------------------------------------------------------- prior -----

export interface PriorGroup {
  kind: 'day' | 'earlier';
  date: DateStr;
  label: string;
  sublabel: string;
  completedTasks: Task[];
  overdueTasks: Task[];
}

/** Dates within the current month before today, plus an "Earlier" bucket for
 *  open tasks whose startDate is from a prior month. Newest day first. */
export function priorGroups(tasks: Task[], today: DateStr): PriorGroup[] {
  const monthStart = `${today.slice(0, 7)}-01` as DateStr;
  const dayMap = new Map<DateStr, { completed: Task[]; overdue: Task[] }>();

  for (const t of tasks) {
    if (!isLive(t)) continue;
    // Completed/canceled tasks from this month (before today)
    if (t.completedAt !== null) {
      const d = dateStrOf(t.completedAt);
      if (d >= monthStart && d < today) {
        const e = dayMap.get(d) ?? { completed: [], overdue: [] };
        e.completed.push(t);
        dayMap.set(d, e);
      }
    }
    // Open tasks scheduled for a past day this month
    if (isOpen(t) && t.startDate !== null && t.startDate >= monthStart && t.startDate < today) {
      const e = dayMap.get(t.startDate) ?? { completed: [], overdue: [] };
      e.overdue.push(t);
      dayMap.set(t.startDate, e);
    }
  }

  const sorted = ([...dayMap.keys()] as DateStr[]).sort().reverse();
  const groups: PriorGroup[] = sorted.map((d) => {
    const e = dayMap.get(d)!;
    const diff = daysBetween(d, today);
    const label = diff === 1 ? 'Yesterday' : diff < 7 ? weekdayName(d) : `${monthName(d).slice(0, 3)} ${dayOfMonth(d)}`;
    return {
      kind: 'day',
      date: d,
      label,
      sublabel: String(dayOfMonth(d)),
      completedTasks: e.completed.sort((a, b) => b.completedAt! - a.completedAt!),
      overdueTasks: sortByOrderKey(e.overdue),
    };
  });

  // Tasks from before this month still open → "Earlier" bucket
  const earlierOverdue = sortByOrderKey(
    tasks.filter((t) => isLive(t) && isOpen(t) && t.startDate !== null && t.startDate < monthStart),
  );
  if (earlierOverdue.length > 0) {
    groups.push({
      kind: 'earlier',
      date: addDays(monthStart, -1),
      label: 'Earlier',
      sublabel: '',
      completedTasks: [],
      overdueTasks: earlierOverdue,
    });
  }

  return groups;
}

// -------------------------------------------------------------- logbook ----

export type LogEntry =
  | { kind: 'task'; item: Task; completedAt: number }
  | { kind: 'project'; item: Project; completedAt: number };

export interface LogbookGroup {
  date: DateStr;
  entries: LogEntry[];
}

export function inLogbook(x: Task | Project): boolean {
  return isLive(x) && (x.status === 'completed' || x.status === 'canceled') && x.completedAt !== null;
}

/** Newest first, grouped by local completion date. Pass a `limit` to window. */
export function logbookGroups(tasks: Task[], projects: Project[], limit?: number): LogbookGroup[] {
  let entries: LogEntry[] = [
    ...tasks.filter(inLogbook).map((t) => ({ kind: 'task' as const, item: t, completedAt: t.completedAt! })),
    ...projects.filter(inLogbook).map((p) => ({ kind: 'project' as const, item: p, completedAt: p.completedAt! })),
  ];
  entries.sort((a, b) => b.completedAt - a.completedAt);
  if (limit !== undefined) entries = entries.slice(0, limit);
  const groups: LogbookGroup[] = [];
  for (const e of entries) {
    const date = dateStrOf(e.completedAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.entries.push(e);
    else groups.push({ date, entries: [e] });
  }
  return groups;
}

// ---------------------------------------------------------------- trash ----

export function trashItems(tasks: Task[], projects: Project[]): (Task | Project)[] {
  const items: ((Task | Project) & { trashedAt: number })[] = [
    ...tasks.filter((t) => t.trashedAt !== null),
    ...projects.filter((p) => p.trashedAt !== null),
  ] as ((Task | Project) & { trashedAt: number })[];
  items.sort((a, b) => b.trashedAt - a.trashedAt);
  return items;
}

// ------------------------------------------------------- project detail ----

export interface ProjectSection {
  heading: Heading | null;
  tasks: Task[];
}

/** Open tasks grouped by heading. Completed-today tasks stay visible inline;
 *  older logged tasks are returned separately for the "Show logged" toggle. */
export function projectSections(
  tasks: Task[],
  headings: Heading[],
  projectId: string,
  today: DateStr,
): { sections: ProjectSection[]; loggedToday: Task[]; loggedOlder: Task[] } {
  const mine = tasks.filter((t) => t.projectId === projectId && isLive(t));
  const open = mine.filter(isOpen);
  const logged = mine
    .filter((t) => !isOpen(t) && t.completedAt !== null)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const loggedToday = logged.filter((t) => dateStrOf(t.completedAt!) === today);
  const loggedOlder = logged.filter((t) => dateStrOf(t.completedAt!) !== today);

  const sections: ProjectSection[] = [
    { heading: null, tasks: sortByOrderKey(open.filter((t) => !t.headingId)) },
  ];
  for (const h of sortByOrderKey(headings.filter((h) => h.projectId === projectId))) {
    sections.push({ heading: h, tasks: sortByOrderKey(open.filter((t) => t.headingId === h.id)) });
  }
  return { sections, loggedToday, loggedOlder };
}

/** Progress pie ratio: completed ÷ all non-trashed tasks. 0 when empty. */
export function projectProgress(tasks: Task[], projectId: string): number {
  const mine = tasks.filter((t) => t.projectId === projectId && isLive(t));
  if (mine.length === 0) return 0;
  const done = mine.filter((t) => !isOpen(t)).length;
  return done / mine.length;
}

// --------------------------------------------------------- sidebar counts --

export interface SidebarCounts {
  inbox: number;
  today: number;
}

export function sidebarCounts(tasks: Task[], today: DateStr): SidebarCounts {
  return {
    inbox: tasks.filter(inInbox).length,
    today: tasks.filter((t) => inToday(t, today)).length,
  };
}
