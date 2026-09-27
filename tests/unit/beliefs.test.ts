import { describe, expect, it } from 'vitest';
import type { Belief, BeliefEvidence, BeliefRating } from '../../src/db/models';
import {
  activeBeliefs, beliefMomentum, beliefStreak, beliefsOnDate, beliefTrend,
  boardMomentum, evidenceCounts, evidenceFor, isSessionComplete, latestScore,
  ratingId, ratingsOn, recentBeliefDays, scoreColor, scoreLabel, scoreOn,
  sessionProgress,
} from '../../src/domain/beliefs';

const DAY = 86_400_000;
const TODAY = '2026-09-22';

function belief(id: string, over: Partial<Belief> = {}): Belief {
  return {
    id,
    text: `Belief ${id}`,
    why: '',
    color: 'var(--purple)',
    orderKey: id,
    active: true,
    createdAt: Date.parse('2026-01-01T09:00:00Z'),
    modifiedAt: Date.parse('2026-01-01T09:00:00Z'),
    ...over,
  };
}

function rating(beliefId: string, date: string, score: number): BeliefRating {
  return { id: ratingId(date, beliefId), beliefId, date, score, ratedAt: Date.parse(`${date}T09:00:00Z`) };
}

describe('the board', () => {
  it('lists active beliefs in order and hides retired ones', () => {
    const rows = [belief('b', { orderKey: 'b' }), belief('a', { orderKey: 'a' }), belief('c', { active: false })];
    expect(activeBeliefs(rows).map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('does not hold a belief against days before it existed', () => {
    const fresh = belief('new', { createdAt: Date.parse('2026-09-22T08:00:00Z') });
    expect(beliefsOnDate([fresh], '2026-09-21')).toHaveLength(0);
    expect(beliefsOnDate([fresh], '2026-09-22')).toHaveLength(1);
  });
});

describe('conviction', () => {
  const beliefs = [belief('a'), belief('b')];

  it('reads today’s scores by belief', () => {
    const map = ratingsOn([rating('a', TODAY, 7), rating('b', '2026-09-21', 4)], TODAY);
    expect(map.get('a')).toBe(7);
    expect(map.has('b')).toBe(false);
  });

  it('finds a specific day’s score, or nothing', () => {
    const rows = [rating('a', TODAY, 7)];
    expect(scoreOn(rows, 'a', TODAY)).toBe(7);
    expect(scoreOn(rows, 'a', '2026-09-21')).toBeNull();
  });

  it('carries the last score forward rather than resetting at midnight', () => {
    const rows = [rating('a', '2026-09-18', 5), rating('a', '2026-09-20', 8)];
    expect(latestScore(rows, 'a', TODAY)).toBe(8);
  });

  it('never reads a score from the future', () => {
    const rows = [rating('a', '2026-09-20', 5), rating('a', '2026-09-30', 9)];
    expect(latestScore(rows, 'a', TODAY)).toBe(5);
  });

  it('reports progress and the average of what was rated', () => {
    const p = sessionProgress(beliefs, [rating('a', TODAY, 6)], TODAY);
    expect(p).toMatchObject({ rated: 1, total: 2, complete: false, average: 6 });
    expect(p.ratio).toBe(0.5);
  });

  it('has a ratio of zero, not NaN, with an empty board', () => {
    const p = sessionProgress([], [], TODAY);
    expect(p.ratio).toBe(0);
    expect(p.average).toBeNull();
    expect(p.complete).toBe(false);
  });

  it('counts the day complete only when every belief was rated', () => {
    expect(isSessionComplete(beliefs, [rating('a', TODAY, 6)], TODAY)).toBe(false);
    expect(isSessionComplete(beliefs, [rating('a', TODAY, 6), rating('b', TODAY, 9)], TODAY)).toBe(true);
  });

  it('accepts a score of zero as a rating', () => {
    const p = sessionProgress([belief('a')], [rating('a', TODAY, 0)], TODAY);
    expect(p.rated).toBe(1);
    expect(p.complete).toBe(true);
    expect(p.average).toBe(0);
  });
});

describe('streaks', () => {
  const beliefs = [belief('a')];

  it('counts back from yesterday while today is still unspoken', () => {
    const rows = [rating('a', '2026-09-21', 6), rating('a', '2026-09-20', 6)];
    expect(beliefStreak(beliefs, rows, TODAY)).toBe(2);
  });

  it('includes today once it is done', () => {
    const rows = [rating('a', TODAY, 7), rating('a', '2026-09-21', 6)];
    expect(beliefStreak(beliefs, rows, TODAY)).toBe(2);
  });

  it('stops at the first day that was left unfinished', () => {
    const rows = [rating('a', '2026-09-21', 6), rating('a', '2026-09-19', 6)];
    expect(beliefStreak(beliefs, rows, TODAY)).toBe(1);
  });

  it('is zero with nothing recorded', () => {
    expect(beliefStreak(beliefs, [], TODAY)).toBe(0);
  });
});

describe('history and trend', () => {
  it('returns the window oldest first, gaps included', () => {
    const days = recentBeliefDays([belief('a')], [rating('a', TODAY, 8)], TODAY, 3);
    expect(days.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-21', TODAY]);
    expect(days[0]!.average).toBeNull();
    expect(days[2]!.average).toBe(8);
  });

  it('leaves unrated days null in a trend rather than carrying them forward', () => {
    const trend = beliefTrend([rating('a', '2026-09-20', 4)], 'a', TODAY, 3);
    expect(trend.map((t) => t.score)).toEqual([4, null, null]);
  });

  it('measures momentum from the first to the last rating in the window', () => {
    const rows = [rating('a', '2026-09-15', 3), rating('a', TODAY, 8)];
    expect(beliefMomentum(rows, 'a', TODAY, 14)).toBe(5);
  });

  it('has no momentum from a single reading', () => {
    expect(beliefMomentum([rating('a', TODAY, 8)], 'a', TODAY, 14)).toBeNull();
    expect(beliefMomentum([], 'a', TODAY, 14)).toBeNull();
  });

  it('ignores ratings older than the window', () => {
    const rows = [rating('a', '2026-08-01', 1), rating('a', '2026-09-20', 6), rating('a', TODAY, 7)];
    expect(beliefMomentum(rows, 'a', TODAY, 14)).toBe(1);
  });

  it('averages momentum across the beliefs that have one', () => {
    const rows = [
      rating('a', '2026-09-16', 2), rating('a', TODAY, 6),
      rating('b', '2026-09-16', 5), rating('b', TODAY, 7),
      rating('c', TODAY, 9),
    ];
    expect(boardMomentum([belief('a'), belief('b'), belief('c')], rows, TODAY, 14)).toBe(3);
  });
});

describe('evidence', () => {
  const rows: BeliefEvidence[] = [
    { id: 'e1', beliefId: 'a', date: '2026-09-20', text: 'older', createdAt: Date.now() - DAY },
    { id: 'e2', beliefId: 'a', date: TODAY, text: 'newer', createdAt: Date.now() },
    { id: 'e3', beliefId: 'b', date: TODAY, text: 'other belief', createdAt: Date.now() },
  ];

  it('returns one belief’s evidence, newest first', () => {
    expect(evidenceFor(rows, 'a').map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  it('counts evidence per belief', () => {
    const counts = evidenceCounts(rows);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('missing')).toBeUndefined();
  });
});

describe('reading a score back', () => {
  it('puts every score into words', () => {
    for (let n = 0; n <= 10; n++) expect(scoreLabel(n).length).toBeGreaterThan(3);
    expect(scoreLabel(0)).not.toBe(scoreLabel(10));
  });

  it('colours low conviction differently from high', () => {
    expect(scoreColor(1)).not.toBe(scoreColor(10));
  });
});
