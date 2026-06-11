import { createSignal } from 'solid-js';
import { msUntilNextMidnight, todayStr } from '../domain/dates';
import type { DateStr } from '../db/models';

/** Reactive local date. Every smart-list predicate reads this, so at midnight
 *  (or when the app returns to foreground on a new day) all views recompute —
 *  membership is derived, no data rewrite needed. */

const [currentDate, setCurrentDate] = createSignal<DateStr>(todayStr());
export { currentDate };

function refresh(): void {
  const now = todayStr();
  if (now !== currentDate()) setCurrentDate(now);
}

let midnightTimer: ReturnType<typeof setTimeout> | undefined;

function armMidnightTimer(): void {
  clearTimeout(midnightTimer);
  // +1s of slack so we land safely after midnight
  midnightTimer = setTimeout(() => {
    refresh();
    armMidnightTimer();
  }, msUntilNextMidnight(new Date()) + 1000);
}

export function startDateTicker(): void {
  armMidnightTimer();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh();
      armMidnightTimer(); // iOS suspends timers in background; re-arm
    }
  });
  window.addEventListener('focus', refresh);
  setInterval(refresh, 60_000); // belt and braces
}
