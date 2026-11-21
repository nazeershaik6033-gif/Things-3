import type {
  ActivityDay, DateStr, EnergyLog, HealthDay, SleepNight, Sprint,
} from '../db/models';
import { toDateStr } from './dates';

/** Apple Watch sleep + activity, as pure functions.
 *
 *  Clarity is a web app, so it cannot read HealthKit. An iOS Shortcut reads
 *  the samples and copies them as text; everything below turns that text into
 *  nights and rings. The Shortcut stays dumb (raw samples + three sums) so all
 *  the arithmetic lives here, where it is tested. */

// ------------------------------------------------------------- parsing ----

export type SampleKind = 'asleep' | 'awake' | 'inbed';

export interface SleepSample {
  start: number; // epoch ms
  end: number;
  kind: SampleKind;
}

/** Sleep-stage labels as Shortcuts prints them (Core, Deep, REM, Asleep,
 *  Awake, In Bed…). Unknown labels are ignored rather than guessed. */
export function sampleKind(label: string): SampleKind | null {
  const v = label.toLowerCase();
  if (/awake/.test(v)) return 'awake';
  if (/in ?bed/.test(v)) return 'inbed';
  if (/asleep|core|deep|rem|light|unspecified|sleep/.test(v)) return 'asleep';
  return null;
}

/** "1,234.5 kcal" → 1234.5; "" / garbage → null. */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseTime(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Accepts "start|end|value" lines (what the Shortcut builds) or an array of
 *  {start, end, value} objects. */
export function parseSleepSamples(input: unknown): SleepSample[] {
  const out: SleepSample[] = [];
  const push = (s: unknown, e: unknown, label: unknown) => {
    const start = parseTime(s);
    const end = parseTime(e);
    const kind = typeof label === 'string' ? sampleKind(label) : null;
    if (start !== null && end !== null && kind && end > start) out.push({ start, end, kind });
  };
  if (Array.isArray(input)) {
    for (const o of input) {
      if (typeof o === 'string') {
        const [s, e, v] = o.split('|');
        push(s?.trim(), e?.trim(), v?.trim());
      } else if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        push(r.start ?? r.startDate, r.end ?? r.endDate, r.value ?? r.kind);
      }
    }
  } else if (typeof input === 'string') {
    for (const line of input.split(/\r?\n/)) {
      const [s, e, v] = line.split('|');
      if (s && e && v) push(s.trim(), e.trim(), v.trim());
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// --------------------------------------------------------------- nights ----

/** Merge overlapping intervals (Watch and iPhone both write sleep samples;
 *  counting both would double the night). */
function union(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function hhmm(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A gap this long between samples starts a new sleep period (a nap). */
const NIGHT_GAP_MS = 3 * 3600_000;
/** Brief stirrings shorter than this are not counted as a wake-up. */
const MIN_WAKE_MS = 60_000;

export interface NightResult {
  date: DateStr; // the day you woke up
  night: SleepNight;
}

/** Group samples into sleep periods and keep the main one per wake date.
 *  Asleep time is the union of all "asleep" stages; gaps between asleep
 *  stretches are the wake-ups. Without stage data, "in bed" stands in. */
export function nightsFromSamples(samples: SleepSample[]): NightResult[] {
  if (samples.length === 0) return [];
  const clusters: SleepSample[][] = [];
  let cur: SleepSample[] = [];
  let curEnd = -Infinity;
  for (const s of samples) {
    if (cur.length && s.start - curEnd > NIGHT_GAP_MS) {
      clusters.push(cur);
      cur = [];
      curEnd = -Infinity;
    }
    cur.push(s);
    curEnd = Math.max(curEnd, s.end);
  }
  if (cur.length) clusters.push(cur);

  const best = new Map<DateStr, NightResult>();
  for (const c of clusters) {
    let asleep = c.filter((s) => s.kind === 'asleep');
    if (asleep.length === 0) asleep = c.filter((s) => s.kind === 'inbed');
    if (asleep.length === 0) continue;
    const merged = union(asleep.map((s) => [s.start, s.end]));
    const asleepMs = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
    const onset = merged[0]![0];
    const wake = merged[merged.length - 1]![1];
    let wakeups = 0;
    for (let i = 1; i < merged.length; i++) {
      if (merged[i]![0] - merged[i - 1]![1] >= MIN_WAKE_MS) wakeups++;
    }
    const result: NightResult = {
      date: toDateStr(new Date(wake)),
      night: {
        asleepMin: Math.round(asleepMs / 60_000),
        onset: hhmm(onset),
        wake: hhmm(wake),
        awakeMin: Math.round((wake - onset - asleepMs) / 60_000),
        wakeups,
      },
    };
    const prev = best.get(result.date);
    if (!prev || result.night.asleepMin > prev.night.asleepMin) best.set(result.date, result);
  }
  return [...best.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// -------------------------------------------------------------- payload ----

export interface HealthPayload {
  nights: NightResult[];
  /** Rings "so far" on `date` (the day the Shortcut ran). */
  activity: { date: DateStr; values: ActivityDay } | null;
}

/** Parse what the Clarity Health Shortcut copies to the clipboard. Lenient:
 *  Shortcuts' Dictionary becomes JSON, but values may arrive as strings with
 *  units, and the sleep list may be a newline-joined string or an array. */
export function parseHealthPayload(text: string, now = new Date()): HealthPayload {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The clipboard is empty — run the Clarity Health shortcut first.');
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    obj = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: accept bare sample lines (sleep only)
    const nights = nightsFromSamples(parseSleepSamples(trimmed));
    if (nights.length === 0) throw new Error('That doesn’t look like Clarity Health data.');
    return { nights, activity: null };
  }
  const nights = nightsFromSamples(parseSleepSamples(obj.sleep));
  const dateRaw = typeof obj.date === 'string' ? obj.date.trim().slice(0, 10) : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : toDateStr(now);
  const values: ActivityDay = {
    moveKcal: roundOrNull(parseNum(obj.move)),
    exerciseMin: roundOrNull(parseNum(obj.exercise)),
    standHr: roundOrNull(parseNum(obj.stand)),
  };
  const hasActivity = values.moveKcal !== null || values.exerciseMin !== null || values.standHr !== null;
  if (nights.length === 0 && !hasActivity) {
    throw new Error('No sleep or activity found. Is your Apple Watch syncing to Health?');
  }
  return { nights, activity: hasActivity ? { date, values } : null };
}

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}

/** Rings only grow during a day, so a later sync wins metric by metric. */
export function mergeActivity(prev: ActivityDay | null, next: ActivityDay): ActivityDay {
  const max = (a: number | null | undefined, b: number | null) =>
    a == null ? b : b == null ? a : Math.max(a, b);
  return {
    moveKcal: max(prev?.moveKcal, next.moveKcal),
    exerciseMin: max(prev?.exerciseMin, next.exerciseMin),
    standHr: max(prev?.standHr, next.standHr),
  };
}

/** Manual check-in: hours + minutes asleep, bedtime, wake-ups. */
export function manualNight(input: {
  asleepMin: number;
  onset: string;
  awakeMin?: number;
  wakeups?: number;
}): SleepNight {
  const [h, m] = input.onset.split(':').map(Number) as [number, number];
  const awake = Math.max(0, Math.round(input.awakeMin ?? 0));
  const end = (h * 60 + m + Math.round(input.asleepMin) + awake) % 1440;
  return {
    asleepMin: Math.max(0, Math.round(input.asleepMin)),
    onset: input.onset,
    wake: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`,
    awakeMin: awake,
    wakeups: Math.max(0, Math.round(input.wakeups ?? 0)),
  };
}

// ---------------------------------------------------------------- score ----

export type SleepLabel = 'Very Low' | 'Low' | 'OK' | 'High' | 'Very High';

export interface SleepScore {
  duration: number; // /50
  bedtime: number; // /30
  interruptions: number; // /20
  total: number; // /100
  label: SleepLabel;
}

/** Bands as Apple labels them (watchOS 26.2). */
export function scoreLabel(total: number): SleepLabel {
  if (total <= 40) return 'Very Low';
  if (total <= 60) return 'Low';
  if (total <= 80) return 'OK';
  if (total <= 95) return 'High';
  return 'Very High';
}

/** Minutes between two clock times, the short way round midnight. */
export function clockDiff(a: string, b: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  const d = Math.abs(toMin(a) - toMin(b)) % 1440;
  return Math.min(d, 1440 - d);
}

/** Clarity's sleep score — the same three parts and weights Apple uses
 *  (duration 50, bedtime 30, interruptions 20), against YOUR bedtime target.
 *  Not Apple's number (no app can read that), but built to track it:
 *    duration       0 at ≤3h, full at ≥8h, linear between
 *    bedtime        full within 15 min of target, 0 at ≥2h30 off
 *    interruptions  20 minus one point per 5 min awake */
export function sleepScore(n: SleepNight, targetBed: string): SleepScore {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const duration = Math.floor(clamp((n.asleepMin - 180) / (480 - 180), 0, 1) * 50);
  const off = clockDiff(n.onset, targetBed);
  const bedtime = Math.floor(clamp(1 - (off - 15) / (150 - 15), 0, 1) * 30);
  const interruptions = clamp(20 - Math.floor(n.awakeMin / 5), 0, 20);
  const total = duration + bedtime + interruptions;
  return { duration, bedtime, interruptions, total, label: scoreLabel(total) };
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Signed minutes the onset was later (+) or earlier (−) than the target. */
export function bedtimeOffset(onset: string, targetBed: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  let d = toMin(onset) - toMin(targetBed);
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

// ----------------------------------------------------------- adapt day ----

export const SHORT_NIGHT_MIN = 6 * 60;
export const GOOD_NIGHT_MIN = 7 * 60;

export interface DayAdvice {
  shortNight: boolean;
  sprintMinutes: number;
  mitSuggest: number;
  message: string;
}

/** "Build the conditions for focus before demanding more from yourself."
 *  After a short night, aim smaller and protect tonight instead. */
export function adviseDay(night: SleepNight | null, targetBed: string, normalSprint: number): DayAdvice | null {
  if (!night) return null;
  const score = sleepScore(night, targetBed);
  const shortNight = night.asleepMin < SHORT_NIGHT_MIN || score.total <= 60;
  if (!shortNight) {
    return {
      shortNight: false,
      sprintMinutes: normalSprint,
      mitSuggest: 3,
      message: `${formatDuration(night.asleepMin)} asleep — a good base. Full sprints today.`,
    };
  }
  return {
    shortNight: true,
    sprintMinutes: Math.min(25, normalSprint),
    mitSuggest: 2,
    message:
      `Short night (${formatDuration(night.asleepMin)}). Aim for 1–2 MITs and 25-min sprints — ` +
      `consistency beats longer sessions. Protect lights-out at ${targetBed}.`,
  };
}

// ---------------------------------------------------- activity + goals ----

export interface ActivityGoals {
  moveKcal: number;
  exerciseMin: number;
  standHr: number;
}

export const DEFAULT_GOALS: ActivityGoals = { moveKcal: 400, exerciseMin: 30, standHr: 12 };

export function normalizeGoals(g: Partial<ActivityGoals> | null | undefined): ActivityGoals {
  const ok = (v: unknown, fb: number) => (typeof v === 'number' && v > 0 && v < 10_000 ? Math.round(v) : fb);
  return {
    moveKcal: ok(g?.moveKcal, DEFAULT_GOALS.moveKcal),
    exerciseMin: ok(g?.exerciseMin, DEFAULT_GOALS.exerciseMin),
    standHr: ok(g?.standHr, DEFAULT_GOALS.standHr),
  };
}

export function ringProgress(a: ActivityDay | null, goals: ActivityGoals): { move: number; exercise: number; stand: number } {
  const r = (v: number | null | undefined, g: number) => (v == null ? 0 : Math.max(0, v / g));
  return {
    move: r(a?.moveKcal, goals.moveKcal),
    exercise: r(a?.exerciseMin, goals.exerciseMin),
    stand: r(a?.standHr, goals.standHr),
  };
}

// ------------------------------------------------------------ insights ----

export interface Comparison {
  id: 'sleep' | 'exercise';
  label: string;
  /** Group meeting the bar (e.g. 7h+ nights) vs not. */
  good: { label: string; days: number; focusMin: number; energy: number | null };
  poor: { label: string; days: number; focusMin: number; energy: number | null };
}

export const MIN_DAYS_PER_GROUP = 3;

function focusedMinutesOn(sprints: Sprint[], date: DateStr): number {
  return sprints
    .filter((s) => s.date === date && s.status === 'done' && s.startedAt !== null && s.endedAt !== null)
    .reduce((sum, s) => sum + (s.endedAt! - s.startedAt!) / 60_000, 0);
}

function energyOn(logs: EnergyLog[], date: DateStr): number | null {
  const xs = logs.filter((l) => l.date === date).map((l) => l.level);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function summarize(dates: DateStr[], sprints: Sprint[], logs: EnergyLog[]) {
  const focus = dates.map((d) => focusedMinutesOn(sprints, d));
  const energies = dates.map((d) => energyOn(logs, d)).filter((x): x is number => x !== null);
  return {
    days: dates.length,
    focusMin: dates.length ? Math.round(focus.reduce((a, b) => a + b, 0) / dates.length) : 0,
    energy: energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null,
  };
}

/** How sleep and exercise line up with the same day's focused minutes and
 *  energy. Only reported once both groups have enough days to mean anything;
 *  it's a pattern to notice, not proof of cause. */
export function focusInsights(
  days: HealthDay[],
  sprints: Sprint[],
  logs: EnergyLog[],
  goals: ActivityGoals,
): Comparison[] {
  const out: Comparison[] = [];
  const slept = days.filter((d) => d.sleep);
  const goodSleep = slept.filter((d) => d.sleep!.asleepMin >= GOOD_NIGHT_MIN).map((d) => d.date);
  const poorSleep = slept.filter((d) => d.sleep!.asleepMin < GOOD_NIGHT_MIN).map((d) => d.date);
  if (goodSleep.length >= MIN_DAYS_PER_GROUP && poorSleep.length >= MIN_DAYS_PER_GROUP) {
    out.push({
      id: 'sleep',
      label: 'After 7h+ nights',
      good: { label: '7h+ sleep', ...summarize(goodSleep, sprints, logs) },
      poor: { label: 'under 7h', ...summarize(poorSleep, sprints, logs) },
    });
  }
  const active = days.filter((d) => d.activity?.exerciseMin != null);
  const moved = active.filter((d) => d.activity!.exerciseMin! >= goals.exerciseMin).map((d) => d.date);
  const still = active.filter((d) => d.activity!.exerciseMin! < goals.exerciseMin).map((d) => d.date);
  if (moved.length >= MIN_DAYS_PER_GROUP && still.length >= MIN_DAYS_PER_GROUP) {
    out.push({
      id: 'exercise',
      label: `On days with ${goals.exerciseMin}+ exercise minutes`,
      good: { label: `${goals.exerciseMin}+ min exercise`, ...summarize(moved, sprints, logs) },
      poor: { label: 'less exercise', ...summarize(still, sprints, logs) },
    });
  }
  return out;
}
