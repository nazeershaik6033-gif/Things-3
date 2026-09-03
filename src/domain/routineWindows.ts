import type { DateStr, RoutineWindow } from '../db/models';
import { toDateStr } from './dates';
import { sortByOrderKey } from '../db/ordering';

/** Window math for My Routine. A window is a time of day (Morning 08:00) that
 *  stays open until the *next* window begins, so the day is partitioned with
 *  no gaps and no overlaps. Everything here is pure: given the windows and a
 *  `now`, it says which window is live, what span of time it covers, and the
 *  key that span's tick-offs are stored under. */

export const DEFAULT_WINDOWS: Array<Pick<RoutineWindow, 'name' | 'time'>> = [
  { name: 'Morning', time: '08:00' },
  { name: 'Night', time: '20:00' },
];

/** "HH:MM" -> minutes past midnight. Unparseable times sort to midnight rather
 *  than throwing, so one bad row can never blank the screen. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "08:00" -> "8:00 AM". */
export function formatClock(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!m) return time ?? '';
  const raw = Number(m[1]);
  const suffix = raw >= 12 ? 'PM' : 'AM';
  const h = raw % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}

/** Windows in clock order. Ties keep their orderKey order so two windows set
 *  to the same time still render deterministically. */
export function sortedWindows(windows: RoutineWindow[]): RoutineWindow[] {
  return sortByOrderKey(windows).sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

export function windowKeyOf(date: DateStr, windowId: string): string {
  return `${date}#${windowId}`;
}

export interface WindowSpan {
  /** The window that is live right now, regardless of which one is selected. */
  activeId: string;
  /** The window being looked at. */
  selectedId: string;
  /** Set when the selected window hasn't come round yet today: the epoch ms it
   *  opens at. Everything below is then zeroed — there is nothing to show. */
  upcomingAt: number | null;
  /** Span the window covers: from the previous window's start to whichever
   *  comes first, the next window's start or now. */
  start: number;
  end: number;
  /** Storage key for tick-offs, `${date}#${windowId}`. Empty when upcoming. */
  key: string;
  /** When this occurrence of the window opened. */
  openedAt: number;
}

interface Occurrence {
  window: RoutineWindow;
  ts: number;
  date: DateStr;
}

/** Roll every window out across yesterday → tomorrow, then locate, for the
 *  selected window, its most recent opening (at or before now), the opening
 *  before that (the span's start) and the next one (its end, capped at now).
 *
 *  Spanning three days matters at the edges: at 00:30 the live window is
 *  usually *yesterday's* last one, and its span reaches back into yesterday. */
export function routineWindowAt(
  windows: RoutineWindow[],
  selectedId: string | null,
  now: Date,
): WindowSpan | null {
  const sorted = sortedWindows(windows);
  if (!sorted.length) return null;

  const nowTs = now.getTime();
  const occurrences: Occurrence[] = [];
  for (let offset = -1; offset <= 1; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    for (const w of sorted) {
      const t = new Date(day);
      t.setHours(0, 0, 0, 0);
      t.setMinutes(timeToMinutes(w.time));
      occurrences.push({ window: w, ts: t.getTime(), date: toDateStr(t) });
    }
  }
  occurrences.sort((a, b) => a.ts - b.ts);

  let activeIdx = -1;
  for (let i = 0; i < occurrences.length; i++) {
    if (occurrences[i]!.ts <= nowTs) activeIdx = i;
  }
  const activeId = activeIdx >= 0 ? occurrences[activeIdx]!.window.id : sorted[sorted.length - 1]!.id;
  const selectedId_ = selectedId ?? activeId;

  // The live window is shown at its most recent opening whatever day that fell
  // on — just after midnight that is still yesterday's last window, and its
  // span has to reach back there. Any *other* window is shown at its opening
  // today: tapping "Night" over breakfast means tonight, which hasn't happened
  // yet, not the one you already worked through twelve hours ago.
  const today = toDateStr(now);
  let idx = -1;
  for (let i = 0; i < occurrences.length; i++) {
    const o = occurrences[i]!;
    if (o.window.id !== selectedId_ || o.ts > nowTs) continue;
    if (selectedId_ !== activeId && o.date !== today) continue;
    idx = i;
  }
  if (idx < 0) {
    const upcoming = occurrences.find((o) => o.window.id === selectedId_ && o.ts > nowTs);
    return {
      activeId,
      selectedId: selectedId_,
      upcomingAt: upcoming ? upcoming.ts : null,
      start: 0,
      end: 0,
      key: '',
      openedAt: 0,
    };
  }

  const current = occurrences[idx]!;
  const previous = occurrences[idx - 1];
  const next = occurrences[idx + 1];
  return {
    activeId,
    selectedId: selectedId_,
    upcomingAt: null,
    start: previous ? previous.ts : 0,
    end: next ? Math.min(next.ts, nowTs) : nowTs,
    key: windowKeyOf(current.date, selectedId_),
    openedAt: current.ts,
  };
}

/** The date half of a window key. */
export function dateOfWindowKey(key: string): DateStr {
  return key.split('#')[0] ?? '';
}
