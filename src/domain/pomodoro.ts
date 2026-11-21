/** Focus Timer — pure logic, UI- and storage-independent.
 *
 *  Ported from Instapaper's "TURN" focus timer into Clarity's own stack: a
 *  compass dial of four minute-presets you pick by tilting the phone (or
 *  tapping), three modes (Focus / Break / Long Break), and — the defining
 *  idea — a session that ENDS WHEN YOU SAY DONE, not when the clock runs out.
 *  The countdown rolls into overtime; finished focus sessions are logged
 *  automatically with an optional tag. Everything here is a pure function so
 *  the tilt math, formatting, and session accounting are unit-testable.
 */

export type Mode = 'focus' | 'break' | 'long';

export const MODE_LABEL: Record<Mode, string> = {
  focus: 'FOCUS',
  break: 'BREAK',
  long: 'LONG BREAK',
};

export type FocusTheme = 'white' | 'black';

/** The four compass slots, in dial order: top, right, bottom, left. */
export type Presets = [number, number, number, number];

/** A finished session, logged for the records view. Only focus sessions log. */
export interface SessionRecord {
  id: string;
  mode: Mode;
  tag: string;
  plannedMin: number;
  /** Actual seconds spent (overtime included). */
  sec: number;
  startedAt: number;
  endedAt: number;
}

/** A session in flight. Time is derived from `startedAt` against the wall
 *  clock, so it survives reloads and backgrounding (iOS suspends JS timers). */
export interface FocusSession {
  id: string;
  mode: Mode;
  plannedMin: number;
  startedAt: number;
  tag: string;
}

/** The whole persisted feature state (one row in the settings table). */
export interface FocusState {
  theme: FocusTheme;
  presets: Presets;
  breakMin: number;
  longMin: number;
  tags: string[];
  records: SessionRecord[];
  session: FocusSession | null;
  /** Remembered tag, pre-selected on the next focus session. */
  lastTag: string;
}

export const FOCUS_DEFAULTS: FocusState = {
  theme: 'white',
  presets: [25, 50, 15, 5],
  breakMin: 5,
  longMin: 15,
  tags: ['WORK', 'READ', 'WRITE'],
  records: [],
  session: null,
  lastTag: '',
};

/** Presets keep their compass position; these label them in settings. */
export const PRESET_LABELS: [string, string, string, string] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];

export const MAX_RECORDS = 1000;

export function clampMinutes(v: number): number {
  const n = Math.round(Number(v) || 0);
  return Math.min(999, Math.max(1, n));
}

const pad2 = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** "MM:SS" for a seconds count (the running clock and per-record duration). */
export function formatMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** "00 Hr 00 Min" for the records totals. */
export function formatHrMin(sec: number): string {
  const m = Math.round(Math.max(0, sec) / 60);
  return `${pad2(Math.floor(m / 60))} Hr ${pad2(m % 60)} Min`;
}

/** "Monday, Jan 05" — the records day-group heading. */
export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: '2-digit',
  });
}

/** Planned minutes for a mode: focus reads the selected compass preset. */
export function plannedMinutes(state: FocusState, mode: Mode, sel: number): number {
  if (mode === 'break') return clampMinutes(state.breakMin);
  if (mode === 'long') return clampMinutes(state.longMin);
  return clampMinutes(state.presets[sel] ?? 25);
}

/** Seconds elapsed in a running session at `now`. */
export function elapsedSec(session: FocusSession, now: number): number {
  return Math.max(0, (now - session.startedAt) / 1000);
}

export interface SessionClock {
  /** Seconds shown on the big display (counts down, then up in overtime). */
  shown: number;
  /** True once the planned time has passed. */
  over: boolean;
  /** 0..1 progress toward the planned time (caps at 1). */
  fill: number;
}

export function sessionClock(session: FocusSession, now: number): SessionClock {
  const elapsed = elapsedSec(session, now);
  const planned = session.plannedMin * 60;
  const remain = Math.ceil(planned - elapsed);
  const over = remain < 0;
  return {
    shown: over ? elapsed - planned : remain,
    over,
    fill: planned <= 0 ? 1 : Math.min(1, elapsed / planned),
  };
}

/** Turn a finished session into a log record (min 1s so nothing reads 00:00). */
export function makeRecord(session: FocusSession, now: number): SessionRecord {
  return {
    id: session.id,
    mode: session.mode,
    tag: session.tag || '',
    plannedMin: session.plannedMin,
    sec: Math.max(1, Math.round((now - session.startedAt) / 1000)),
    startedAt: session.startedAt,
    endedAt: now,
  };
}

export const sumSeconds = (records: SessionRecord[]): number =>
  records.reduce((a, r) => a + (r.sec || 0), 0);

/** Focus records whose `endedAt` falls on the local day containing `now`. */
export function recordsOnDay(records: SessionRecord[], now: number): SessionRecord[] {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return records.filter((r) => r.endedAt >= start);
}

/** Result of one tilt reading: the smoothed compass angle and, when the phone
 *  isn't lying flat, which of the four slots (0..3) now points up. */
export interface TiltReading {
  angle: number;
  index: number | null;
}

/** Project gravity onto the screen plane and low-pass the roll, exactly as the
 *  original TURN dial does, so tilting the phone selects a compass preset.
 *  Returns index=null when the phone is flat (roll is meaningless). */
export function tiltReading(prevAngleDeg: number, betaDeg: number, gammaDeg: number): TiltReading {
  const b = (betaDeg * Math.PI) / 180;
  const g = (gammaDeg * Math.PI) / 180;
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  if (gx * gx + gy * gy < 0.06) return { angle: prevAngleDeg, index: null };
  const phi = (Math.atan2(gx, -gy) * 180) / Math.PI;
  let d = phi - prevAngleDeg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  const angle = prevAngleDeg + d * 0.3;
  const index = (((-Math.round(angle / 90)) % 4) + 4) % 4;
  return { angle, index };
}
