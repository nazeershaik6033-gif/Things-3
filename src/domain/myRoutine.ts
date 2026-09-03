import type {
  DateStr, FeedEntry, RoutineCheck, RoutineDay, RoutineFeed, RoutineGroup,
  RoutineMiss, RoutineMissItem, RoutineSeen, RoutineSource,
} from '../db/models';
import { addDays, dateStrOf } from './dates';
import { sortByOrderKey } from '../db/ordering';
import { dateOfWindowKey } from './routineWindows';

/** Pure logic for My Routine. Nothing here writes or fetches: a source is
 *  "done" because a check row exists for (window occurrence, source), and
 *  "new" because its cached feed holds entries published inside the window
 *  you are looking at. Both are derived, so the day rolls over on its own. */

/** Group accent colors, in the order new groups take them. */
export const GROUP_PALETTE = [
  '#d4564a', '#e8801f', '#e0a020', '#5cb85c', '#2bb5a0',
  '#3aa0e0', '#6a7ef0', '#9b59b6', '#e0517f',
];

/** Stable fallback color for a group that never got one assigned. Hashing the
 *  id keeps a group's stripe the same across reloads and devices. */
export function colorForGroupId(id: string): string {
  let n = 0;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[n % GROUP_PALETTE.length]!;
}

export function groupColor(group: RoutineGroup): string {
  return group.color || colorForGroupId(group.id);
}

/** rgba() form of a hex color, for tints. Non-hex input passes through. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return hex || 'transparent';
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Whether a source can actually be polled. A plain link never can — it is a
 *  bookmark you tick off, which is exactly how Instagram or WhatsApp behave. */
export function hasFeed(source: RoutineSource): boolean {
  if (source.kind === 'youtube') return !!source.channelId;
  if (source.kind === 'telegram') return !!source.handle;
  if (source.kind === 'rss') return !!source.feedUrl;
  return false;
}

export function isSnoozed(source: RoutineSource, now: number): boolean {
  return source.snoozedUntil > now;
}

/** Sources on screen right now: snoozed ones step out until their time is up. */
export function visibleSources(sources: RoutineSource[], now: number): RoutineSource[] {
  return sortByOrderKey(sources.filter((s) => !isSnoozed(s, now)));
}

export interface RoutineSection {
  /** null is the implicit "Other" section for sources with no live group. */
  group: RoutineGroup | null;
  sources: RoutineSource[];
}

/** Sources bucketed into their groups, groups in orderKey order, with anything
 *  orphaned (no group, or a group since deleted) gathered at the end. */
export function sectionsOf(
  groups: RoutineGroup[],
  sources: RoutineSource[],
): RoutineSection[] {
  const ordered = sortByOrderKey(groups);
  const live = new Set(ordered.map((g) => g.id));
  const sections: RoutineSection[] = ordered.map((group) => ({
    group,
    sources: sources.filter((s) => s.groupId === group.id),
  }));
  const orphans = sources.filter((s) => !s.groupId || !live.has(s.groupId));
  if (orphans.length) sections.push({ group: null, sources: orphans });
  return sections;
}

// ------------------------------------------------------------- checking off --

export function checkId(windowKey: string, sourceId: string): string {
  return `${windowKey}:${sourceId}`;
}

/** Source ids ticked off in one window occurrence. */
export function checkedIdsIn(checks: RoutineCheck[], windowKey: string): Set<string> {
  const set = new Set<string>();
  if (!windowKey) return set;
  for (const c of checks) if (c.windowKey === windowKey) set.add(c.sourceId);
  return set;
}

// ------------------------------------------------------------- what's new ----

/** Entries a source published inside the span, newest first, minus anything
 *  already opened. `seen` is keyed by entry url. */
export function newEntriesFor(
  feed: RoutineFeed | undefined,
  start: number,
  end: number,
  seen: Set<string>,
): FeedEntry[] {
  if (!feed || !feed.entries.length) return [];
  return feed.entries
    .filter((e) => e.publishedMs >= start && e.publishedMs <= end && !seen.has(e.url))
    .sort((a, b) => b.publishedMs - a.publishedMs);
}

export function seenUrlSet(seen: RoutineSeen[]): Set<string> {
  return new Set(seen.map((s) => s.url));
}

export function feedsBySource(feeds: RoutineFeed[]): Map<string, RoutineFeed> {
  return new Map(feeds.map((f) => [f.sourceId, f]));
}

// ---------------------------------------------------------------- filtering --

export type RoutineFocus = 'all' | 'todo' | 'new' | 'completed';

/** "New" and "Completed" are momentary: their counts go stale the instant the
 *  window rolls over, and restoring one at launch lands you on an empty
 *  screen. Only the stable two are worth persisting. */
export const STICKY_FOCUS: RoutineFocus[] = ['all', 'todo'];

export interface FocusContext {
  done: Set<string>;
  newCountFor: (source: RoutineSource) => number;
  query: string;
}

export function matchesQuery(source: RoutineSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${source.name} ${source.url}`.toLowerCase().includes(q);
}

export function passesFocus(
  source: RoutineSource,
  focus: RoutineFocus,
  ctx: FocusContext,
): boolean {
  if (!matchesQuery(source, ctx.query)) return false;
  if (focus === 'todo') return !ctx.done.has(source.id);
  if (focus === 'completed') return ctx.done.has(source.id);
  if (focus === 'new') return ctx.newCountFor(source) > 0;
  return true;
}

// ----------------------------------------------------------------- progress --

export interface RoutineProgress {
  done: number;
  total: number;
  /** 0..1, and 0 when there is nothing to do (never NaN). */
  ratio: number;
  complete: boolean;
}

export function windowProgress(
  sources: RoutineSource[],
  done: Set<string>,
): RoutineProgress {
  const total = sources.length;
  const doneCount = sources.filter((s) => done.has(s.id)).length;
  return {
    done: doneCount,
    total,
    ratio: total === 0 ? 0 : doneCount / total,
    complete: total > 0 && doneCount === total,
  };
}

// ------------------------------------------------------------------ streaks --

export interface Streak {
  current: number;
  best: number;
}

/** A day counts once you have cleared a whole window that day. Today not being
 *  finished *yet* must not read as a miss, so the current run is allowed to
 *  end at yesterday. */
export function computeStreak(days: RoutineDay[], today: DateStr): Streak {
  const set = new Set(days.map((d) => d.date));
  if (!set.size) return { current: 0, best: 0 };

  const sorted = [...set].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (addDays(sorted[i - 1]!, 1) === sorted[i]) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }

  let cursor = today;
  if (!set.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!set.has(cursor)) return { current: 0, best };
  }
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best: Math.max(best, current) };
}

export interface DayMark {
  date: DateStr;
  banked: boolean;
}

/** The last `count` days, oldest first — the filled-square grid in stats. */
export function streakGrid(days: RoutineDay[], today: DateStr, count = 35): DayMark[] {
  const set = new Set(days.map((d) => d.date));
  const out: DayMark[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, banked: set.has(date) });
  }
  return out;
}

// ------------------------------------------------------- per-day completion --

export interface DayCompletion {
  date: DateStr;
  done: number;
  /** Distinct sources ticked that day, across every window. */
  sourceIds: string[];
  banked: boolean;
}

/** What you actually got through on each of the last `count` days. Unlike the
 *  streak grid this counts ticks, so a partial day still reads as effort. */
export function completionHistory(
  checks: RoutineCheck[],
  days: RoutineDay[],
  today: DateStr,
  count = 14,
): DayCompletion[] {
  const banked = new Set(days.map((d) => d.date));
  const byDate = new Map<DateStr, Set<string>>();
  for (const c of checks) {
    let set = byDate.get(c.date);
    if (!set) byDate.set(c.date, (set = new Set()));
    set.add(c.sourceId);
  }
  const out: DayCompletion[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(today, -i);
    const ids = byDate.get(date);
    out.push({
      date,
      done: ids ? ids.size : 0,
      sourceIds: ids ? [...ids] : [],
      banked: banked.has(date),
    });
  }
  return out;
}

// ------------------------------------------------------------- missed window --

/** How long an archived catch-up day is kept. */
export const MISS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Entries shown per source in a history block before "+N more" folds the rest.
 *  A 400-item backlog must never render as one wall. */
export const MISS_SOURCE_CAP = 4;

export interface ClosedWindow {
  key: string;
  windowName: string;
  start: number;
  end: number;
}

/** Everything a window went by without you: for each source you did NOT tick,
 *  the entries it published while that window was open and you never opened.
 *  Returns null when nothing was missed, so a cleared window archives nothing.
 *
 *  A source snoozed past the window's end is skipped — you deliberately opted
 *  out of it, and it should not come back as a guilt-trip in History. */
export function captureMissed(
  closed: ClosedWindow,
  sources: RoutineSource[],
  groups: RoutineGroup[],
  feeds: Map<string, RoutineFeed>,
  checkedIds: Set<string>,
  seen: Set<string>,
  id: string,
  now: number,
): RoutineMiss | null {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const items: RoutineMissItem[] = [];
  for (const source of sources) {
    if (checkedIds.has(source.id)) continue;
    if (!hasFeed(source)) continue;
    if (source.snoozedUntil >= closed.end) continue;
    const entries = newEntriesFor(feeds.get(source.id), closed.start, closed.end, seen);
    if (!entries.length) continue;
    items.push({
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      groupName: source.groupId ? (groupName.get(source.groupId) ?? null) : null,
      entries,
    });
  }
  if (!items.length) return null;
  return {
    id,
    windowKey: closed.key,
    windowName: closed.windowName,
    snapshotAt: now,
    start: closed.start,
    end: closed.end,
    items,
  };
}

/** Archived days still worth keeping, newest first. */
export function liveMisses(misses: RoutineMiss[], now: number): RoutineMiss[] {
  const cutoff = now - MISS_MAX_AGE_MS;
  return misses
    .filter((m) => m.snapshotAt > cutoff)
    .sort((a, b) => b.snapshotAt - a.snapshotAt);
}

export function totalMissed(misses: RoutineMiss[]): number {
  return misses.reduce(
    (n, m) => n + m.items.reduce((k, i) => k + i.entries.length, 0),
    0,
  );
}

/** "Today · Jun 11" / "Yesterday · Jun 10" / "Jun 8" */
export function formatMissDate(snapshotAt: number, today: DateStr): string {
  const date = dateStrOf(snapshotAt);
  const label = new Date(snapshotAt).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, -1)) return `Yesterday · ${label}`;
  return label;
}

/** "2h ago" — a routine is about recency, so an absolute date reads wrong for
 *  anything published today. */
export function formatAge(publishedMs: number, now: number): string {
  const diff = Math.max(0, now - publishedMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(publishedMs).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export { dateOfWindowKey };
