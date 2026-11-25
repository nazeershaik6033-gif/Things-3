import { createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { DEFAULT_SNAP_MIN } from '../domain/timeline';

/** Day planner preferences.
 *
 *  The snap step is a real setting (IndexedDB, in backups). The view choices
 *  — Today as a list or a timeline, how many days the Planner shows, whether
 *  drags push the rest — are per-device conveniences, so they live in
 *  localStorage: a phone and a laptop reasonably want different answers.
 *  Every storage access is guarded; private mode just means defaults. */

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
}

export type TodayView = 'list' | 'timeline';
const TODAY_VIEW_KEY = 'clarity-today-view';
const [todayView, setTodayViewSignal] = createSignal<TodayView>(load(TODAY_VIEW_KEY) === 'timeline' ? 'timeline' : 'list');
export { todayView };
export function setTodayView(v: TodayView): void {
  setTodayViewSignal(v);
  save(TODAY_VIEW_KEY, v);
}

export type PlannerDays = 1 | 3 | 7;
const DAYS_KEY = 'clarity-planner-days';
/** Phones open on 3 days (a week of columns is cramped at 390px); wider
 *  screens open on the full week. An explicit choice sticks either way. */
function defaultDays(): PlannerDays {
  const stored = Number(load(DAYS_KEY));
  if (stored === 1 || stored === 3 || stored === 7) return stored;
  return typeof window !== 'undefined' && window.innerWidth >= 700 ? 7 : 3;
}
const [plannerDays, setPlannerDaysSignal] = createSignal<PlannerDays>(defaultDays());
export { plannerDays };
export function setPlannerDays(n: PlannerDays): void {
  setPlannerDaysSignal(n);
  save(DAYS_KEY, String(n));
}

const PUSH_KEY = 'clarity-planner-push';
const [pushMode, setPushModeSignal] = createSignal(load(PUSH_KEY) === '1');
export { pushMode };
export function setPushMode(on: boolean): void {
  setPushModeSignal(on);
  save(PUSH_KEY, on ? '1' : '0');
}

export const SNAP_CHOICES = [5, 10, 15, 30] as const;
const [snapStep, setSnapSignal] = createSignal<number>(DEFAULT_SNAP_MIN);
export { snapStep };

export async function startPlannerSettings(): Promise<void> {
  const v = await getSetting<number>('plannerSnapMin', DEFAULT_SNAP_MIN);
  setSnapSignal((SNAP_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_SNAP_MIN);
}

export async function setSnapStep(min: number): Promise<void> {
  setSnapSignal(min);
  await setSetting('plannerSnapMin', min);
}

/** Default alert for timed to-dos without their own: minutes before the
 *  start, or null for none. A real setting (in backups). */
export const DEFAULT_ALERT_CHOICES = [null, 0, 5, 10, 15, 30] as const;
const [defaultAlert, setDefaultAlertSignal] = createSignal<number | null>(5);
export { defaultAlert };

export async function startAlertSettings(): Promise<void> {
  const v = await getSetting<number | null>('defaultAlertMin', 5);
  setDefaultAlertSignal(v === null || (DEFAULT_ALERT_CHOICES as readonly (number | null)[]).includes(v) ? v : 5);
}

export async function setDefaultAlert(v: number | null): Promise<void> {
  setDefaultAlertSignal(v);
  await setSetting('defaultAlertMin', v);
}
