import { createSignal } from 'solid-js';
import {
  POMODORO_DEFAULTS, nextPhase, phaseDurationMs,
  type Phase, type PomodoroConfig,
} from '../domain/pomodoro';
import { getSetting, setSetting } from '../db/mutations';
import { todayStr } from '../domain/dates';

/** Timestamp-based timer state: survives reload and background tabs (iOS
 *  pauses JS when the PWA is hidden, so remaining time is always derived
 *  from the clock, never from tick counting). */

interface TimerState {
  phase: Phase;
  round: number;
  /** Epoch ms when the current phase ends; null = idle. */
  endsAt: number | null;
  /** Remaining ms while paused; null = not paused. */
  pausedRemaining: number | null;
}

const IDLE: TimerState = { phase: 'work', round: 1, endsAt: null, pausedRemaining: null };
const LS_KEY = 'clarity-pomodoro';

const [state, setState] = createSignal<TimerState>(IDLE);
const [config, setConfig] = createSignal<PomodoroConfig>(POMODORO_DEFAULTS);
const [overlayOpen, setOverlayOpen] = createSignal(false);
const [doneToday, setDoneToday] = createSignal(0);
const [soundOn, setSoundOn] = createSignal(true);
/** 1-second heartbeat so time displays re-render. */
const [now, setNow] = createSignal(Date.now());

export { state as pomodoroState, config as pomodoroConfig, overlayOpen, setOverlayOpen, doneToday, soundOn, now };

export function isActive(): boolean {
  const s = state();
  return s.endsAt !== null || s.pausedRemaining !== null;
}

export function isPaused(): boolean {
  return state().pausedRemaining !== null;
}

export function remainingMs(): number {
  const s = state();
  if (s.pausedRemaining !== null) return s.pausedRemaining;
  if (s.endsAt === null) return phaseDurationMs(s.phase, config());
  return Math.max(0, s.endsAt - now());
}

function persist(s: TimerState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

function update(s: TimerState): void {
  setState(s);
  persist(s);
}

export function startPomodoro(): void {
  const s = state();
  update({ ...s, endsAt: Date.now() + remainingMs(), pausedRemaining: null });
}

export function pausePomodoro(): void {
  const s = state();
  if (s.endsAt === null) return;
  update({ ...s, pausedRemaining: Math.max(0, s.endsAt - Date.now()), endsAt: null });
}

export function stopPomodoro(): void {
  update(IDLE);
}

/** Advance to the next phase (manually via Skip, or on natural completion). */
export function skipPhase(autostart = false, completed = false): void {
  const s = state();
  if (completed && s.phase === 'work') {
    void recordDone();
  }
  const nxt = nextPhase(s.phase, s.round, config());
  update({
    phase: nxt.phase,
    round: nxt.round,
    endsAt: autostart ? Date.now() + phaseDurationMs(nxt.phase, config()) : null,
    pausedRemaining: null,
  });
}

async function recordDone(): Promise<void> {
  const today = todayStr();
  const log = await getSetting<{ date: string; count: number }>('pomodoroLog', { date: today, count: 0 });
  const count = (log.date === today ? log.count : 0) + 1;
  await setSetting('pomodoroLog', { date: today, count });
  setDoneToday(count);
}

export async function updatePomodoroConfig(patch: Partial<PomodoroConfig>): Promise<void> {
  const cfg = { ...config(), ...patch };
  setConfig(cfg);
  await setSetting('pomodoro', cfg);
}

export async function setPomodoroSound(on: boolean): Promise<void> {
  setSoundOn(on);
  await setSetting('pomodoroSound', on);
}

function beep(): void {
  if (!soundOn()) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.start();
    osc.stop(ctx.currentTime + 0.9);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio available */
  }
}

export function startPomodoroClock(): void {
  // Restore persisted state and settings
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) setState({ ...IDLE, ...(JSON.parse(raw) as TimerState) });
  } catch {
    /* corrupt/unavailable */
  }
  void getSetting<PomodoroConfig>('pomodoro', POMODORO_DEFAULTS).then((cfg) =>
    setConfig({ ...POMODORO_DEFAULTS, ...cfg }),
  );
  void getSetting<boolean>('pomodoroSound', true).then(setSoundOn);
  void getSetting<{ date: string; count: number }>('pomodoroLog', { date: '', count: 0 }).then((log) =>
    setDoneToday(log.date === todayStr() ? log.count : 0),
  );

  setInterval(() => {
    setNow(Date.now());
    const s = state();
    if (s.endsAt !== null && Date.now() >= s.endsAt) {
      beep();
      skipPhase(true, true); // natural completion: log + auto-start next phase
    }
  }, 1000);
}
