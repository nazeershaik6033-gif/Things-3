/** Pomodoro phase machine — pure logic, UI-independent. */

export type Phase = 'work' | 'short' | 'long';

export interface PomodoroConfig {
  workMin: number;
  shortMin: number;
  longMin: number;
  /** Work rounds per cycle; the break after the last one is long. */
  rounds: number;
}

export const POMODORO_DEFAULTS: PomodoroConfig = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  rounds: 4,
};

export function phaseDurationMs(phase: Phase, cfg: PomodoroConfig): number {
  const min = phase === 'work' ? cfg.workMin : phase === 'short' ? cfg.shortMin : cfg.longMin;
  return Math.max(1, min) * 60_000;
}

/** What follows the just-finished phase. Round counts completed work blocks
 *  in the current cycle; a long break closes the cycle. */
export function nextPhase(
  finished: Phase,
  round: number,
  cfg: PomodoroConfig,
): { phase: Phase; round: number } {
  if (finished === 'work') {
    return round >= cfg.rounds ? { phase: 'long', round } : { phase: 'short', round };
  }
  return finished === 'long' ? { phase: 'work', round: 1 } : { phase: 'work', round: round + 1 };
}

export const PHASE_LABEL: Record<Phase, string> = {
  work: 'Focus',
  short: 'Short Break',
  long: 'Long Break',
};

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
