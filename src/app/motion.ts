import { createSignal } from 'solid-js';

/** Motion policy for the whole app. Two things live here: the user's
 *  reduce-motion preference (every spring and entrance animation asks first)
 *  and the haptic tap helper. Everything else is CSS in base.css — animations
 *  stay transform/opacity-only so they run on the compositor. */

const query = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const [reduceMotion, setReduceMotion] = createSignal(query?.matches ?? false);
export { reduceMotion };

export function startMotion(): void {
  if (!query) return;
  const update = () => {
    setReduceMotion(query.matches);
    document.documentElement.dataset.reduceMotion = query.matches ? 'true' : 'false';
  };
  update();
  // Safari < 14 only has the deprecated listener form
  if (typeof query.addEventListener === 'function') query.addEventListener('change', update);
  else query.addListener(update);
}

/** Entrance stagger: nth child of a group appears this many ms after the first.
 *  Capped so a long list never leaves the last row hanging. */
export const STAGGER_MS = 34;
export const STAGGER_CAP = 8;

export function staggerDelay(index: number): string {
  if (reduceMotion()) return '0ms';
  return `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms`;
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
