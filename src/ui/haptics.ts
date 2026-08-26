/** Subtle haptic feedback for commit-style interactions.
 *
 *  NOTE: iOS Safari (including standalone PWAs) does not implement the
 *  Vibration API, so every call here is a silent no-op on iPhone. It is wired
 *  up anyway because it costs nothing and Android PWAs do honour it; on iOS
 *  the visual press states carry the feedback instead. */

export type Haptic = 'selection' | 'impact' | 'success';

const PATTERNS: Record<Haptic, number | number[]> = {
  /** Picker rows, toggles, threshold ticks. */
  selection: 8,
  /** Drag pickup, button press-through. */
  impact: 12,
  /** Completing a to-do, saving an entry. */
  success: [10, 40, 14],
};

let enabled = true;

/** Users who dislike vibration (or tests) can switch it off. */
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

export function haptic(kind: Haptic = 'selection'): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* Vibration is best-effort; a throwing implementation must never break a tap. */
  }
}
