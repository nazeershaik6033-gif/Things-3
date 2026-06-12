import { describe, expect, it } from 'vitest';
import {
  POMODORO_DEFAULTS, formatMs, nextPhase, phaseDurationMs,
} from '../../src/domain/pomodoro';

describe('pomodoro phase machine', () => {
  const cfg = POMODORO_DEFAULTS;

  it('classic durations', () => {
    expect(phaseDurationMs('work', cfg)).toBe(25 * 60_000);
    expect(phaseDurationMs('short', cfg)).toBe(5 * 60_000);
    expect(phaseDurationMs('long', cfg)).toBe(15 * 60_000);
  });

  it('cycles work → short break, and long break after the final round', () => {
    expect(nextPhase('work', 1, cfg)).toEqual({ phase: 'short', round: 1 });
    expect(nextPhase('short', 1, cfg)).toEqual({ phase: 'work', round: 2 });
    expect(nextPhase('work', 4, cfg)).toEqual({ phase: 'long', round: 4 });
    expect(nextPhase('long', 4, cfg)).toEqual({ phase: 'work', round: 1 }); // new cycle
  });

  it('a full cycle visits 4 work blocks, 3 short breaks, 1 long break', () => {
    let phase: 'work' | 'short' | 'long' = 'work';
    let round = 1;
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(`${phase}${phase === 'work' ? round : ''}`);
      ({ phase, round } = nextPhase(phase, round, cfg));
    }
    expect(seen).toEqual(['work1', 'short', 'work2', 'short', 'work3', 'short', 'work4', 'long']);
    expect(phase).toBe('work');
    expect(round).toBe(1);
  });

  it('formats remaining time', () => {
    expect(formatMs(25 * 60_000)).toBe('25:00');
    expect(formatMs(61_000)).toBe('1:01');
    expect(formatMs(900)).toBe('0:01');
    expect(formatMs(0)).toBe('0:00');
    expect(formatMs(-5)).toBe('0:00');
  });
});
