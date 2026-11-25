import type { CalendarEvent, DateStr, Sprint, Task } from '../db/models';
import { dateStrOf } from './dates';

/** The day planner's pure maths: which to-dos, events and sprints sit where on
 *  a day's hour grid, how overlapping blocks share the width, and what a drag
 *  does to them. Everything is in *minutes since local midnight* (0..1440),
 *  so the UI only converts to pixels at the edge and DST never enters it.
 *
 *  Behaviour follows obsidian-day-planner (snap, minimum length, push the
 *  rest) and TaskNotes (scheduled time + duration on the task itself). */

export const DAY_MIN = 1440;
export const DEFAULT_BLOCK_MIN = 30;
export const DEFAULT_SNAP_MIN = 15;

// ------------------------------------------------------------ clock text --

/** "HH:mm" → minutes since midnight, or null if absent/invalid. */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutes since midnight → "HH:mm". Clamped into the day. */
export function toHHMM(min: number): string {
  const v = Math.max(0, Math.min(DAY_MIN - 1, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Same style as `formatTime` elsewhere in the app: "9 AM", "9:30 AM".
 *  1440 (end of day) reads as "12 AM". */
export function formatClock(min: number): string {
  const v = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h24 = Math.floor(v / 60);
  const m = v % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "9:00 – 9:30 AM" style range; drops the first AM/PM when both match. */
export function formatRange(startMin: number, endMin: number): string {
  const a = formatClock(startMin);
  const b = formatClock(endMin);
  const sa = a.slice(-2);
  const sb = b.slice(-2);
  return sa === sb ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

export function formatLength(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---------------------------------------------------------------- blocks --

export type BlockKind = 'task' | 'event' | 'sprint';

export interface TimeBlock {
  /** Unique across kinds: `task:<id>`, `event:<id>`, `sprint:<id>`. */
  key: string;
  kind: BlockKind;
  /** The id of the to-do, event or sprint behind it. */
  refId: string;
  date: DateStr;
  title: string;
  startMin: number;
  /** Exclusive, always > startMin and <= DAY_MIN. */
  endMin: number;
  done: boolean;
  /** Only open to-dos can be dragged; events and sprints are read-only. */
  editable: boolean;
  running?: boolean;
}

/** How long a to-do's block is: its own planned length, else its estimate,
 *  else the default. Always at least 5 minutes. */
export function taskDuration(
  t: Pick<Task, 'durationMin' | 'timeEstimateMin'>,
  fallback = DEFAULT_BLOCK_MIN,
): number {
  const d = t.durationMin ?? t.timeEstimateMin ?? fallback;
  return Math.max(5, Math.min(DAY_MIN, Math.round(d)));
}

/** Placed on `date`'s grid: dated that day, with a valid time, not trashed
 *  or canceled. Completed ones stay (shown ticked) so the day reads true. */
export function isTimedOn(t: Task, date: DateStr): boolean {
  return t.trashedAt === null && t.status !== 'canceled' && t.startDate === date && parseHHMM(t.startTime) !== null;
}

export function taskBlock(t: Task, date: DateStr): TimeBlock | null {
  if (!isTimedOn(t, date)) return null;
  const start = Math.min(parseHHMM(t.startTime)!, DAY_MIN - 5);
  const end = Math.min(DAY_MIN, start + taskDuration(t));
  return {
    key: `task:${t.id}`,
    kind: 'task',
    refId: t.id,
    date,
    title: t.title,
    startMin: start,
    endMin: end,
    done: t.status === 'completed',
    editable: t.status === 'open',
  };
}

/** Minutes since `date`'s local midnight for an instant, clamped to the day:
 *  0 if it falls before that day, 1440 if after. Uses local wall-clock
 *  fields so a DST change inside the day doesn't skew it. */
export function minuteOfDay(epochMs: number, date: DateStr): number {
  const d = dateStrOf(epochMs);
  if (d < date) return 0;
  if (d > date) return DAY_MIN;
  const x = new Date(epochMs);
  return x.getHours() * 60 + x.getMinutes();
}

export function eventBlock(e: CalendarEvent, date: DateStr): TimeBlock | null {
  if (e.allDay || e.start === null || e.date !== date) return null;
  const start = Math.min(minuteOfDay(e.start, date), DAY_MIN - 5);
  const rawEnd = e.end !== null && e.end > e.start ? minuteOfDay(e.end, date) : start + DEFAULT_BLOCK_MIN;
  const end = Math.min(DAY_MIN, Math.max(start + 5, rawEnd));
  return {
    key: `event:${e.id}`,
    kind: 'event',
    refId: e.id,
    date,
    title: e.title,
    startMin: start,
    endMin: end,
    done: false,
    editable: false,
  };
}

/** Focus Sprints are already blocks of time: planned ones where they were
 *  scheduled, running and finished ones where they actually happened. */
export function sprintBlock(s: Sprint, date: DateStr, now = Date.now()): TimeBlock | null {
  let startMs: number | null;
  let endMs: number | null;
  switch (s.status) {
    case 'planned':
      startMs = s.plannedAt;
      endMs = startMs === null ? null : startMs + s.durationMin * 60_000;
      break;
    case 'running':
      startMs = s.startedAt;
      endMs = s.endsAt ?? (startMs === null ? null : Math.max(now, startMs + s.durationMin * 60_000));
      break;
    case 'done':
      startMs = s.startedAt;
      endMs = s.endedAt ?? (startMs === null ? null : startMs + s.durationMin * 60_000);
      break;
    default:
      return null; // abandoned
  }
  if (startMs === null || endMs === null || dateStrOf(startMs) !== date) return null;
  const start = Math.min(minuteOfDay(startMs, date), DAY_MIN - 5);
  const end = Math.min(DAY_MIN, Math.max(start + 5, minuteOfDay(endMs, date)));
  return {
    key: `sprint:${s.id}`,
    kind: 'sprint',
    refId: s.id,
    date,
    title: s.title || s.nextAction || 'Focus sprint',
    startMin: start,
    endMin: end,
    done: s.status === 'done',
    editable: false,
    running: s.status === 'running',
  };
}

const byStart = (a: TimeBlock, b: TimeBlock) =>
  a.startMin - b.startMin || b.endMin - a.endMin || a.key.localeCompare(b.key);

/** Everything on one day's grid, in start order. */
export function dayBlocks(
  date: DateStr,
  tasks: Task[],
  events: CalendarEvent[],
  sprints: Sprint[] = [],
  now = Date.now(),
): TimeBlock[] {
  const out: TimeBlock[] = [];
  for (const t of tasks) {
    const b = taskBlock(t, date);
    if (b) out.push(b);
  }
  for (const e of events) {
    const b = eventBlock(e, date);
    if (b) out.push(b);
  }
  for (const s of sprints) {
    const b = sprintBlock(s, date, now);
    if (b) out.push(b);
  }
  return out.sort(byStart);
}

export function allDayEvents(date: DateStr, events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => e.date === date && (e.allDay || e.start === null));
}

/** To-dos that belong to `date` but have no slot on its grid yet: the
 *  planner's tray. For today that's everything in Today (including items
 *  rolled over from earlier days, whose old time no longer applies); for
 *  any other day it's what's dated that day. */
export function unscheduledFor(date: DateStr, tasks: Task[], today: DateStr): Task[] {
  return tasks.filter((t) => {
    if (t.trashedAt !== null || t.status !== 'open' || !t.startDate) return false;
    if (isTimedOn(t, date)) return false;
    return date === today ? t.startDate <= today : t.startDate === date;
  });
}

// --------------------------------------------------------------- layout --

export interface Placed {
  block: TimeBlock;
  /** Column within its overlap cluster, 0-based. */
  col: number;
  /** Columns the cluster needs; the block takes 1/cols of the width. */
  cols: number;
}

/** Side-by-side layout for overlapping blocks. Blocks that transitively
 *  overlap form a cluster; each takes the first free column, and every block
 *  in a cluster shares the cluster's column count so widths line up. */
export function layoutDay(blocks: TimeBlock[]): Placed[] {
  const sorted = [...blocks].sort(byStart);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, colEnds.length);
    for (const p of cluster) p.cols = cols;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length > 0 && b.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= b.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(b.endMin);
    } else {
      colEnds[col] = b.endMin;
    }
    cluster.push({ block: b, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- edits --

export function snapMin(min: number, step = DEFAULT_SNAP_MIN): number {
  return Math.round(min / step) * step;
}

export type EditMode = 'move' | 'resize-end' | 'resize-start';

export interface Span {
  startMin: number;
  endMin: number;
}

/** Where a block ends up after dragging it `deltaMin` minutes. The moved
 *  edge snaps to the grid; a block never leaves the day and never gets
 *  shorter than one snap step. */
export function applyEdit(span: Span, mode: EditMode, deltaMin: number, step = DEFAULT_SNAP_MIN): Span {
  const len = span.endMin - span.startMin;
  const minLen = Math.min(step, len);
  if (mode === 'move') {
    const start = Math.max(0, Math.min(DAY_MIN - len, snapMin(span.startMin + deltaMin, step)));
    return { startMin: start, endMin: start + len };
  }
  if (mode === 'resize-end') {
    const end = Math.max(span.startMin + minLen, Math.min(DAY_MIN, snapMin(span.endMin + deltaMin, step)));
    return { startMin: span.startMin, endMin: end };
  }
  const start = Math.min(span.endMin - minLen, Math.max(0, snapMin(span.startMin + deltaMin, step)));
  return { startMin: start, endMin: span.endMin };
}

/** A new block from a press-and-drag on empty grid: the two ends snap and
 *  can be dragged either way; a plain press gives the default length. */
export function spanFromDrag(fromMin: number, toMin: number, step = DEFAULT_SNAP_MIN, defaultLen = DEFAULT_BLOCK_MIN): Span {
  const a = snapMin(Math.min(fromMin, toMin), step);
  let b = snapMin(Math.max(fromMin, toMin), step);
  if (b - a < step) b = a + Math.max(step, defaultLen);
  const start = Math.max(0, Math.min(DAY_MIN - step, a));
  return { startMin: start, endMin: Math.min(DAY_MIN, Math.max(start + step, b)) };
}

/** "Push the rest" (obsidian-day-planner's shift mode): after `edited` takes
 *  its new span, any later to-do it now runs into is pushed down to start
 *  where it ends, and so on down the chain. Gaps absorb the delay — only
 *  blocks that would overlap move. Blocks that already overlapped before the
 *  edit are left alone (that overlap was deliberate). Read-only blocks
 *  (events, sprints, done to-dos) never move and never push.
 *
 *  Returns only the blocks that change, keyed by block key. */
export function pushRest(blocks: TimeBlock[], editedKey: string, next: Span): Map<string, Span> {
  const edited = blocks.find((b) => b.key === editedKey);
  const moved = new Map<string, Span>();
  if (!edited) return moved;
  const original = new Map(blocks.map((b) => [b.key, { startMin: b.startMin, endMin: b.endMin }]));
  const overlappedBefore = (a: string, b: string) => {
    const x = original.get(a)!;
    const y = original.get(b)!;
    return x.startMin < y.endMin && y.startMin < x.endMin;
  };
  const later = blocks
    .filter((b) => b.key !== editedKey && b.editable && b.startMin >= edited.startMin)
    .sort(byStart);
  const current = new Map<string, Span>([[editedKey, next]]);
  const chain: string[] = [editedKey];
  for (const b of later) {
    let span: Span = { startMin: b.startMin, endMin: b.endMin };
    for (const pusherKey of chain) {
      if (overlappedBefore(pusherKey, b.key)) continue;
      const p = current.get(pusherKey)!;
      if (p.startMin < span.endMin && p.endMin > span.startMin) {
        const len = span.endMin - span.startMin;
        const start = Math.min(DAY_MIN - len, p.endMin);
        span = { startMin: start, endMin: start + len };
      }
    }
    current.set(b.key, span);
    chain.push(b.key);
    if (span.startMin !== b.startMin) moved.set(b.key, span);
  }
  return moved;
}

/** "Running late": every open to-do still ahead of `fromMin` moves by
 *  `deltaMin`, gaps kept. Blocks already underway or past stay put. */
export function shiftRemaining(blocks: TimeBlock[], fromMin: number, deltaMin: number): Map<string, Span> {
  const out = new Map<string, Span>();
  for (const b of blocks) {
    if (!b.editable || b.startMin < fromMin) continue;
    const len = b.endMin - b.startMin;
    const start = Math.max(0, Math.min(DAY_MIN - len, b.startMin + deltaMin));
    if (start !== b.startMin) out.set(b.key, { startMin: start, endMin: start + len });
  }
  return out;
}

/** The fields to write on a to-do for a span on `date`. */
export function taskPatchFor(date: DateStr, span: Span): Pick<Task, 'startDate' | 'startTime' | 'durationMin'> {
  return { startDate: date, startTime: toHHMM(span.startMin), durationMin: span.endMin - span.startMin };
}

// ------------------------------------------------------------- now/next --

/** What's on right now and what's next, among a day's blocks. */
export function nowAndNext(blocks: TimeBlock[], nowMin: number): { now: TimeBlock[]; next: TimeBlock | null } {
  const live = blocks.filter((b) => !b.done || b.kind === 'event');
  return {
    now: live.filter((b) => b.startMin <= nowMin && nowMin < b.endMin),
    next: live.filter((b) => b.startMin > nowMin).sort(byStart)[0] ?? null,
  };
}
