import { createRoot, createSignal, createEffect, on } from 'solid-js';
import { liveQuery } from 'dexie';
import { db } from '../db/db';
import type { Sprint } from '../db/models';
import { getSetting, onTaskCompleted, setSetting } from '../db/mutations';
import { addTrackedTime, runRepeats } from '../db/superMutations';
import { breakDue } from '../domain/timeTracking';
import { showToast } from './focusState';
import { haptic } from './motion';
import { currentDate } from './currentDate';

/** The time tracker (Super Productivity's play button on every task) and its
 *  break reminder. Wall-clock based like the Focus Timer: what persists is
 *  *when* tracking started, so a running timer survives a reload, a locked
 *  phone or a suspended PWA, and the display is always derived from the
 *  clock rather than counted ticks. Only one to-do is tracked at a time. */

export interface TrackerState {
  taskId: string;
  startedAt: number;
}

export interface BreakSettings {
  enabled: boolean;
  /** Minutes of continuous tracked work before the reminder. */
  afterMin: number;
}

interface Persisted {
  tracker: TrackerState | null;
  /** Start of the current stretch of work (survives switching tasks). */
  workStartedAt: number | null;
  /** When tracking last stopped: a short gap doesn't count as a break. */
  lastStopAt: number | null;
  breakNotifiedAt: number | null;
}

const KEY = 'timeTracker';
const BREAK_KEY = 'breakReminder';
/** A pause shorter than this is a task switch, not a break. */
const BREAK_GAP_MS = 5 * 60_000;

export const DEFAULT_BREAK: BreakSettings = { enabled: true, afterMin: 50 };

const [state, setState] = createSignal<Persisted>({
  tracker: null, workStartedAt: null, lastStopAt: null, breakNotifiedAt: null,
});
const [breakSettings, setBreakSignal] = createSignal<BreakSettings>(DEFAULT_BREAK);
/** 1 Hz heartbeat while something is tracked. */
const [nowTick, setNowTick] = createSignal(Date.now());

/** Finished Focus Sprints, shared app-wide: they count toward their to-do's
 *  time, and one subscription beats one per task row. */
const [doneSprints, setDoneSprints] = createSignal<Sprint[]>([]);

export { breakSettings, nowTick, doneSprints };

export function tracker(): TrackerState | null {
  return state().tracker;
}

export function trackingTaskId(): string | null {
  return state().tracker?.taskId ?? null;
}

/** Seconds of the current running span (0 when idle). */
export function runningSeconds(): number {
  const t = state().tracker;
  return t ? Math.max(0, (nowTick() - t.startedAt) / 1000) : 0;
}

function save(next: Persisted): void {
  setState(next);
  void setSetting(KEY, next);
}

async function bankRunning(now: number): Promise<void> {
  const t = state().tracker;
  if (t) await addTrackedTime(t.taskId, t.startedAt, now);
}

export async function startTracking(taskId: string, now = Date.now()): Promise<void> {
  const s = state();
  if (s.tracker?.taskId === taskId) return;
  await bankRunning(now);
  const continuing = s.tracker !== null || (s.lastStopAt !== null && now - s.lastStopAt < BREAK_GAP_MS);
  save({
    tracker: { taskId, startedAt: now },
    workStartedAt: continuing && s.workStartedAt !== null ? s.workStartedAt : now,
    lastStopAt: null,
    breakNotifiedAt: continuing ? s.breakNotifiedAt : null,
  });
  setNowTick(now);
  haptic('tick');
}

export async function stopTracking(now = Date.now()): Promise<void> {
  const s = state();
  if (!s.tracker) return;
  await bankRunning(now);
  save({ ...s, tracker: null, lastStopAt: now });
}

export async function toggleTracking(taskId: string): Promise<void> {
  if (trackingTaskId() === taskId) await stopTracking();
  else await startTracking(taskId);
}

/** "I took a break": stop the clock and reset the stretch. */
export async function takeBreak(): Promise<void> {
  await stopTracking();
  save({ ...state(), workStartedAt: null, lastStopAt: null, breakNotifiedAt: null });
  showToast('Enjoy the break — the stretch starts fresh when you return');
}

export async function updateBreakSettings(patch: Partial<BreakSettings>): Promise<void> {
  const next = { ...breakSettings(), ...patch };
  next.afterMin = Math.max(5, Math.min(240, Math.round(next.afterMin || DEFAULT_BREAK.afterMin)));
  setBreakSignal(next);
  await setSetting(BREAK_KEY, next);
}

/** Minutes of the current unbroken stretch (for the tracker bar). */
export function stretchMinutes(): number {
  const s = state();
  if (!s.tracker || s.workStartedAt === null) return 0;
  return Math.floor((nowTick() - s.workStartedAt) / 60_000);
}

function checkBreak(now: number): void {
  const s = state();
  const cfg = breakSettings();
  if (!cfg.enabled || !s.tracker || s.breakNotifiedAt !== null) return;
  if (!breakDue(s.workStartedAt, now, cfg.afterMin)) return;
  save({ ...s, breakNotifiedAt: now });
  haptic('success');
  showToast(`${cfg.afterMin} minutes of focused work — time for a short break`, 6000);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    try {
      new Notification('Time for a break', { body: `You've worked ${cfg.afterMin} minutes straight. Stand up, look far away, drink water.` });
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
}

let started = false;
export async function startTimeTracking(): Promise<void> {
  if (started) return;
  started = true;
  const saved = await getSetting<Persisted | null>(KEY, null);
  if (saved && typeof saved === 'object') {
    setState({
      tracker: saved.tracker ?? null,
      workStartedAt: saved.workStartedAt ?? null,
      lastStopAt: saved.lastStopAt ?? null,
      breakNotifiedAt: saved.breakNotifiedAt ?? null,
    });
  }
  setBreakSignal({ ...DEFAULT_BREAK, ...(await getSetting<Partial<BreakSettings>>(BREAK_KEY, {})) });
  liveQuery(() => db.sprints.where('status').equals('done').toArray()).subscribe({
    next: (rows) => setDoneSprints(rows),
    error: (e) => console.error('sprints liveQuery error', e),
  });
  setInterval(() => {
    if (!state().tracker) return;
    const now = Date.now();
    setNowTick(now);
    checkBreak(now);
  }, 1000);
  // Finishing the tracked to-do stops the clock on it.
  onTaskCompleted(async (task, completedAt) => {
    if (trackingTaskId() === task.id) await stopTracking(Math.max(completedAt, state().tracker!.startedAt));
  });
}

/** Repeating to-dos: create what is due at boot and again at every rollover. */
export function startRepeats(): void {
  createRoot(() => {
    createEffect(on(currentDate, (d) => { void runRepeats(d); }));
  });
}
