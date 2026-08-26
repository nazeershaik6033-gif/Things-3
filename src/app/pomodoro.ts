import { createSignal } from 'solid-js';
import { nanoid } from 'nanoid';
import {
  FOCUS_DEFAULTS, MAX_RECORDS, clampMinutes, makeRecord, recordsOnDay, sumSeconds,
  elapsedSec,
  type FocusState, type FocusTheme, type Mode, type Presets,
} from '../domain/pomodoro';
import { getSetting, setSetting } from '../db/mutations';

/** Focus Timer store. Wall-clock based: a running session survives reload and
 *  background tabs (iOS suspends JS when the PWA is hidden), so the display is
 *  always derived from `startedAt`, never from tick counting. The whole feature
 *  state lives in one settings row, written on every change. */

const KEY = 'focusTimer';

const [focusState, setFocusStateSignal] = createSignal<FocusState>(FOCUS_DEFAULTS);
const [overlayOpen, setOverlayOpen] = createSignal(false);
/** ~2 Hz heartbeat so the running clock re-renders. */
const [now, setNow] = createSignal(Date.now());

export { focusState, overlayOpen, setOverlayOpen, now };

/** Seconds of focus logged today — shown in Settings and the records header. */
export function doneTodaySec(): number {
  const focus = focusState().records.filter((r) => r.mode === 'focus');
  return sumSeconds(recordsOnDay(focus, now()));
}

export function hasActiveSession(): boolean {
  return focusState().session !== null;
}

function persist(s: FocusState): void {
  void setSetting(KEY, s);
}

/** Reducer-style update: every mutation goes through here so it persists. */
function mutate(fn: (s: FocusState) => FocusState): void {
  const next = fn(focusState());
  setFocusStateSignal(next);
  persist(next);
}

// --------------------------------------------------------------- sessions ---

export function startSession(mode: Mode, plannedMin: number, tag: string): void {
  mutate((s) => ({
    ...s,
    session: { id: nanoid(), mode, plannedMin: clampMinutes(plannedMin), startedAt: Date.now(), tag },
  }));
  notifiedFor = null;
  if (mode === 'focus') void acquireWakeLock();
}

/** Finish the current session — logs it (focus sessions surface in records). */
export function finishSession(): void {
  const s = focusState().session;
  if (!s) return;
  const rec = makeRecord(s, Date.now());
  mutate((st) => ({
    ...st,
    session: null,
    lastTag: s.tag || st.lastTag,
    records: [rec, ...st.records].slice(0, MAX_RECORDS),
  }));
  releaseWakeLock();
}

/** Abandon the current session without logging it. */
export function discardSession(): void {
  mutate((s) => ({ ...s, session: null }));
  releaseWakeLock();
}

export function setSessionTag(tag: string): void {
  mutate((s) => (s.session ? { ...s, session: { ...s.session, tag } } : s));
}

// -------------------------------------------------------------- settings ---

export function setTheme(theme: FocusTheme): void {
  mutate((s) => ({ ...s, theme }));
}

export function toggleTheme(): void {
  mutate((s) => ({ ...s, theme: s.theme === 'black' ? 'white' : 'black' }));
}

export function setPreset(i: number, value: number): void {
  mutate((s) => {
    const presets = [...s.presets] as Presets;
    presets[i] = clampMinutes(value);
    return { ...s, presets };
  });
}

export function setBreakMin(value: number): void {
  mutate((s) => ({ ...s, breakMin: clampMinutes(value) }));
}

export function setLongMin(value: number): void {
  mutate((s) => ({ ...s, longMin: clampMinutes(value) }));
}

export function addTag(raw: string): void {
  const tag = raw.trim().toUpperCase();
  if (!tag) return;
  mutate((s) => (s.tags.includes(tag) ? s : { ...s, tags: [...s.tags, tag] }));
}

export function removeTag(tag: string): void {
  mutate((s) => ({ ...s, tags: s.tags.filter((t) => t !== tag) }));
}

export function deleteRecord(id: string): void {
  mutate((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
}

// -------------------------------------------------------------- wake lock ---

/** iOS suspends all page JS (including our countdown/notification timer) the
 *  moment the screen locks, even with the PWA "open" in the background — this
 *  is OS-level power management, not something a web page can override. The
 *  Screen Wake Lock API is the only fully-local way around it: hold the
 *  screen on for the duration of a running focus session so the timer can
 *  actually reach zero and fire its notification on time. Released the
 *  moment the session ends, is discarded, or the tab is hidden. */
let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock(): Promise<void> {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    /* unsupported, denied, or blocked (e.g. low battery mode) — silently skip */
  }
}

function releaseWakeLock(): void {
  const lock = wakeLock;
  wakeLock = null;
  try {
    void lock?.release();
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------- notifications/clock ---

export function requestNotifyPermission(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    /* unsupported */
  }
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

function notify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker?.ready) {
      void navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, {
          body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'focus-timer',
        }))
        .catch(() => {
          try { new Notification(title, { body }); } catch { /* ignore */ }
        });
    } else {
      new Notification(title, { body });
    }
  } catch {
    /* ignore */
  }
}

/** Session id we've already announced "time's up" for, so it fires once. */
let notifiedFor: string | null = null;

export function startFocusClock(): void {
  void getSetting<FocusState | null>(KEY, null).then((saved) => {
    if (saved) setFocusStateSignal({ ...FOCUS_DEFAULTS, ...saved });
    const s = focusState().session;
    // A session finished-by-clock while we were away shouldn't re-announce.
    if (s && elapsedSec(s, Date.now()) >= s.plannedMin * 60) notifiedFor = s.id;
  });

  const tick = (): void => {
    setNow(Date.now());
    const s = focusState().session;
    if (!s || notifiedFor === s.id) return;
    if (elapsedSec(s, Date.now()) >= s.plannedMin * 60) {
      notifiedFor = s.id;
      buzz([130, 90, 130]);
      notify(
        s.mode === 'focus' ? 'Focus time is up' : 'Break is over',
        s.mode === 'focus'
          ? `${s.plannedMin} minutes done — the clock keeps going until you tap Done.`
          : 'Time to get back to it.',
      );
    }
  };

  setInterval(tick, 500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    tick();
    // The wake lock auto-releases on hide; reacquire it if a focus session
    // is still running so the screen stays on until it's actually done.
    const s = focusState().session;
    if (s && s.mode === 'focus') void acquireWakeLock();
  });
}
