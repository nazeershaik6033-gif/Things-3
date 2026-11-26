import { createMemo, createRoot, createSignal } from 'solid-js';
import { getSetting, setSetting } from '../db/mutations';
import { SPRING, type SpringOpts } from '../gestures/springs';

/** Motion policy for the whole app.
 *
 *  The user picks a level in Settings → Appearance → Motion:
 *   - rich:   springs that overshoot a little, page rise-ins, cards that spring
 *             back after a press, and a celebration when something is finished
 *   - subtle: the same moves without overshoot, shorter fades, no celebration
 *   - off:    no decorative motion at all; navigation jumps
 *  Until they choose ('auto'), the app follows the system Reduce Motion
 *  switch: off when it is on, rich otherwise.
 *
 *  The resolved level is mirrored to <html data-motion="…"> so CSS can key
 *  every animation off it. Animations stay transform/opacity-only so they run
 *  on the compositor. */

export type MotionLevel = 'rich' | 'subtle' | 'off';
export type MotionPref = 'auto' | MotionLevel;

const query = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const [systemReduce, setSystemReduce] = createSignal(query?.matches ?? false);
const [motionPref, setPrefSignal] = createSignal<MotionPref>('auto');
export { motionPref };

const level = createRoot(() =>
  createMemo<MotionLevel>(() => {
    const pref = motionPref();
    if (pref !== 'auto') return pref;
    return systemReduce() ? 'off' : 'rich';
  }),
);

/** The motion level in force right now. */
export function motionLevel(): MotionLevel {
  return level();
}

/** True when decorative motion should be skipped entirely. Kept as the one
 *  question most code asks. */
export function reduceMotion(): boolean {
  return level() === 'off';
}

function reflect(): void {
  const root = document.documentElement;
  root.dataset.motion = level();
  root.dataset.reduceMotion = level() === 'off' ? 'true' : 'false';
}

export function startMotion(): void {
  reflect();
  void getSetting<MotionPref>('motion', 'auto').then((pref) => {
    if (pref === 'rich' || pref === 'subtle' || pref === 'off' || pref === 'auto') setPrefSignal(pref);
    reflect();
  });
  if (!query) return;
  const update = () => {
    setSystemReduce(query.matches);
    reflect();
  };
  // Safari < 14 only has the deprecated listener form
  if (typeof query.addEventListener === 'function') query.addEventListener('change', update);
  else query.addListener(update);
}

export async function setMotionPref(pref: MotionPref): Promise<void> {
  setPrefSignal(pref);
  reflect();
  await setSetting('motion', pref);
}

/** Spring for sheets and pop-overs coming in: a soft overshoot on rich,
 *  critically damped on subtle. Callers skip the spring entirely when off. */
export function entranceSpring(): SpringOpts {
  return level() === 'rich' ? SPRING.overshoot : SPRING.nav;
}

/** Entrance stagger: nth child of a group appears this many ms after the first.
 *  Capped so a long list never leaves the last row hanging. */
export const STAGGER_MS = 34;
export const STAGGER_CAP = 8;

export function staggerDelay(index: number): string {
  const l = level();
  if (l === 'off') return '0ms';
  const step = l === 'subtle' ? STAGGER_MS / 2 : STAGGER_MS;
  return `${Math.min(index, STAGGER_CAP) * step}ms`;
}

/** Haptic feedback where the platform offers it. iOS Safari ignores this
 *  entirely (no Vibration API), so it is a progressive enhancement only. */
export type HapticKind = 'tick' | 'select' | 'success';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 8,
  select: 12,
  success: [10, 40, 16],
};

export function haptic(kind: HapticKind = 'tick'): void {
  if (reduceMotion()) return;
  navigator.vibrate?.(PATTERNS[kind]);
}
