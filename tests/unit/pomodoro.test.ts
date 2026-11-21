import { describe, expect, it } from 'vitest';
import {
  FOCUS_DEFAULTS, MODE_LABEL, clampMinutes, formatHrMin, formatMS, makeRecord,
  plannedMinutes, recordsOnDay, sessionClock, sumSeconds, tiltReading,
  type FocusSession, type FocusState, type SessionRecord,
} from '../../src/domain/pomodoro';

describe('focus timer — formatting', () => {
  it('formats MM:SS from seconds', () => {
    expect(formatMS(0)).toBe('00:00');
    expect(formatMS(5)).toBe('00:05');
    expect(formatMS(65)).toBe('01:05');
    expect(formatMS(25 * 60)).toBe('25:00');
    expect(formatMS(-3)).toBe('00:00');
  });

  it('formats hours+minutes for the records totals', () => {
    expect(formatHrMin(0)).toBe('00 Hr 00 Min');
    expect(formatHrMin(90 * 60)).toBe('01 Hr 30 Min');
    expect(formatHrMin(25 * 60)).toBe('00 Hr 25 Min');
  });

  it('labels each mode', () => {
    expect(MODE_LABEL.focus).toBe('FOCUS');
    expect(MODE_LABEL.break).toBe('BREAK');
    expect(MODE_LABEL.long).toBe('LONG BREAK');
  });
});

describe('focus timer — minutes + presets', () => {
  it('clamps minutes to a sane 1..999 integer range', () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(-10)).toBe(1);
    expect(clampMinutes(25)).toBe(25);
    expect(clampMinutes(25.6)).toBe(26);
    expect(clampMinutes(5000)).toBe(999);
    expect(clampMinutes(Number.NaN)).toBe(1);
  });

  it('reads the selected compass preset for focus, fixed minutes for breaks', () => {
    const s: FocusState = { ...FOCUS_DEFAULTS, presets: [25, 50, 15, 5], breakMin: 5, longMin: 20 };
    expect(plannedMinutes(s, 'focus', 0)).toBe(25);
    expect(plannedMinutes(s, 'focus', 1)).toBe(50);
    expect(plannedMinutes(s, 'break', 3)).toBe(5); // sel ignored for breaks
    expect(plannedMinutes(s, 'long', 2)).toBe(20);
  });
});

describe('focus timer — running clock (ends when you say done)', () => {
  const session: FocusSession = { id: 'a', mode: 'focus', plannedMin: 25, startedAt: 1_000_000, tag: '' };

  it('counts down before the planned time', () => {
    const c = sessionClock(session, session.startedAt + 60_000); // 1 min in
    expect(c.over).toBe(false);
    expect(formatMS(c.shown)).toBe('24:00');
    expect(c.fill).toBeCloseTo(60_000 / (25 * 60_000), 5);
  });

  it('rolls into overtime past the planned time, capping fill at 1', () => {
    const c = sessionClock(session, session.startedAt + 26 * 60_000); // 1 min over
    expect(c.over).toBe(true);
    expect(formatMS(c.shown)).toBe('01:00');
    expect(c.fill).toBe(1);
  });
});

describe('focus timer — records', () => {
  it('logs the real elapsed seconds (min 1s)', () => {
    const session: FocusSession = { id: 'x', mode: 'focus', plannedMin: 25, startedAt: 0, tag: 'WORK' };
    const rec = makeRecord(session, 90_400); // ~90.4s
    expect(rec.sec).toBe(90);
    expect(rec.tag).toBe('WORK');
    expect(makeRecord(session, 200).sec).toBe(1); // never 0
  });

  it('sums and filters records to the local day of `now`', () => {
    const day = new Date(2026, 5, 11, 12, 0, 0).getTime();
    const earlierSameDay = new Date(2026, 5, 11, 8, 0, 0).getTime();
    const yesterday = new Date(2026, 5, 10, 23, 0, 0).getTime();
    const recs: SessionRecord[] = [
      { id: '1', mode: 'focus', tag: '', plannedMin: 25, sec: 1500, startedAt: 0, endedAt: earlierSameDay },
      { id: '2', mode: 'focus', tag: '', plannedMin: 25, sec: 600, startedAt: 0, endedAt: yesterday },
    ];
    const today = recordsOnDay(recs, day);
    expect(today.map((r) => r.id)).toEqual(['1']);
    expect(sumSeconds(today)).toBe(1500);
    expect(sumSeconds(recs)).toBe(2100);
  });
});

describe('focus timer — tilt selection', () => {
  it('ignores a flat phone (roll is meaningless)', () => {
    const r = tiltReading(0, 0, 0);
    expect(r.index).toBeNull();
    expect(r.angle).toBe(0);
  });

  it('picks the top slot when held upright', () => {
    // Upright portrait, tipped slightly forward so gravity has a screen-plane
    // component but no roll → slot 0 (top).
    const r = tiltReading(0, 20, 0);
    expect(r.index).toBe(0);
  });

  it('rolls toward an adjacent slot as the phone tilts sideways', () => {
    // Sustained right-roll should low-pass toward a non-top slot.
    let angle = 0;
    let idx: number | null = 0;
    for (let i = 0; i < 40; i++) {
      const r = tiltReading(angle, 20, 70);
      angle = r.angle;
      if (r.index !== null) idx = r.index;
    }
    expect(idx).not.toBe(0);
    expect([1, 2, 3]).toContain(idx);
  });
});
