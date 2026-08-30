import { describe, expect, it } from 'vitest';
import type {
  RoutineCheck, RoutineDay, RoutineFeed, RoutineGroup, RoutineMiss, RoutineSource,
} from '../../src/db/models';
import {
  captureMissed, checkedIdsIn, checkId, colorForGroupId, completionHistory, computeStreak,
  feedsBySource, formatAge, groupColor, hasFeed, liveMisses, MISS_MAX_AGE_MS, newEntriesFor,
  passesFocus, sectionsOf, streakGrid, totalMissed, visibleSources, windowProgress, withAlpha,
} from '../../src/domain/myRoutine';

const TODAY = '2026-06-11';
const KEY = `${TODAY}#m`;

function source(id: string, partial: Partial<RoutineSource> = {}): RoutineSource {
  return {
    id,
    groupId: null,
    name: id,
    kind: 'link',
    url: `https://${id}.example`,
    channelId: '',
    handle: '',
    feedUrl: '',
    orderKey: id,
    snoozedUntil: 0,
    createdAt: 0,
    modifiedAt: 0,
    ...partial,
  };
}

function group(id: string, name = id, orderKey = id): RoutineGroup {
  return { id, name, color: '', orderKey, createdAt: 0 };
}

function check(sourceId: string, windowKey = KEY, date = TODAY): RoutineCheck {
  return { id: checkId(windowKey, sourceId), windowKey, sourceId, date, checkedAt: 1 };
}

function entry(url: string, publishedMs: number) {
  return { id: url, title: url, url, publishedMs, thumb: '' };
}

function feed(sourceId: string, entries: ReturnType<typeof entry>[]): RoutineFeed {
  return { sourceId, fetchedAt: 0, entries, error: '' };
}

function day(date: string): RoutineDay {
  return { date, bankedAt: 1 };
}

describe('sources', () => {
  it('knows which kinds can actually be polled', () => {
    expect(hasFeed(source('a', { kind: 'youtube', channelId: 'UC123' }))).toBe(true);
    expect(hasFeed(source('b', { kind: 'youtube' }))).toBe(false);
    expect(hasFeed(source('c', { kind: 'telegram', handle: 'chan' }))).toBe(true);
    expect(hasFeed(source('d', { kind: 'rss', feedUrl: 'https://x/feed' }))).toBe(true);
    // A plain link is a bookmark you tick off; there is nothing to fetch.
    expect(hasFeed(source('e', { kind: 'link', url: 'https://x' }))).toBe(false);
  });

  it('hides snoozed sources until their time is up', () => {
    const now = 1_000;
    const list = [source('a'), source('b', { snoozedUntil: now + 500 }), source('c', { snoozedUntil: now - 1 })];
    expect(visibleSources(list, now).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('sorts visible sources by order key', () => {
    const list = [source('c', { orderKey: 'a3' }), source('a', { orderKey: 'a1' })];
    expect(visibleSources(list, 0).map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('sections', () => {
  it('buckets sources into groups in order key order', () => {
    const groups = [group('g2', 'Two', 'a2'), group('g1', 'One', 'a1')];
    const sources = [source('a', { groupId: 'g1' }), source('b', { groupId: 'g2' })];
    const out = sectionsOf(groups, sources);
    expect(out.map((s) => s.group?.name)).toEqual(['One', 'Two']);
    expect(out[0]!.sources.map((s) => s.id)).toEqual(['a']);
  });

  it('gathers ungrouped sources into a trailing Other section', () => {
    const out = sectionsOf([group('g1')], [source('a', { groupId: 'g1' }), source('b')]);
    expect(out).toHaveLength(2);
    expect(out[1]!.group).toBeNull();
    expect(out[1]!.sources.map((s) => s.id)).toEqual(['b']);
  });

  it('rescues sources whose group was deleted rather than dropping them', () => {
    const out = sectionsOf([], [source('a', { groupId: 'gone' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.group).toBeNull();
    expect(out[0]!.sources.map((s) => s.id)).toEqual(['a']);
  });

  it('omits Other entirely when every source has a live group', () => {
    const out = sectionsOf([group('g1')], [source('a', { groupId: 'g1' })]);
    expect(out).toHaveLength(1);
  });
});

describe('checking off', () => {
  it('only counts ticks from the window being asked about', () => {
    const checks = [check('a'), check('b', `${TODAY}#n`)];
    expect([...checkedIdsIn(checks, KEY)]).toEqual(['a']);
    expect([...checkedIdsIn(checks, `${TODAY}#n`)]).toEqual(['b']);
  });

  it('returns nothing for an empty window key rather than everything', () => {
    expect(checkedIdsIn([check('a')], '').size).toBe(0);
  });

  it('reports progress and completeness', () => {
    const sources = [source('a'), source('b')];
    expect(windowProgress(sources, new Set(['a']))).toEqual({
      done: 1, total: 2, ratio: 0.5, complete: false,
    });
    expect(windowProgress(sources, new Set(['a', 'b'])).complete).toBe(true);
  });

  it('never reports NaN or completeness with nothing to do', () => {
    expect(windowProgress([], new Set())).toEqual({ done: 0, total: 0, ratio: 0, complete: false });
  });
});

describe('new entries', () => {
  const f = feed('a', [entry('u1', 100), entry('u2', 200), entry('u3', 300)]);

  it('returns entries inside the span, newest first', () => {
    expect(newEntriesFor(f, 100, 250, new Set()).map((e) => e.url)).toEqual(['u2', 'u1']);
  });

  it('excludes entries already opened', () => {
    expect(newEntriesFor(f, 0, 400, new Set(['u2'])).map((e) => e.url)).toEqual(['u3', 'u1']);
  });

  it('is empty for a source with no cached feed', () => {
    expect(newEntriesFor(undefined, 0, 400, new Set())).toEqual([]);
  });

  it('indexes feeds by source', () => {
    expect(feedsBySource([f]).get('a')).toBe(f);
  });
});

describe('focus filters', () => {
  const ctx = (done: string[], news: Record<string, number>, query = '') => ({
    done: new Set(done),
    newCountFor: (s: RoutineSource) => news[s.id] ?? 0,
    query,
  });

  it('todo hides what is already ticked', () => {
    expect(passesFocus(source('a'), 'todo', ctx(['a'], {}))).toBe(false);
    expect(passesFocus(source('b'), 'todo', ctx(['a'], {}))).toBe(true);
  });

  it('completed shows only what is ticked', () => {
    expect(passesFocus(source('a'), 'completed', ctx(['a'], {}))).toBe(true);
    expect(passesFocus(source('b'), 'completed', ctx(['a'], {}))).toBe(false);
  });

  it('new shows only sources with waiting updates', () => {
    expect(passesFocus(source('a'), 'new', ctx([], { a: 3 }))).toBe(true);
    expect(passesFocus(source('b'), 'new', ctx([], { a: 3 }))).toBe(false);
  });

  it('the search query narrows every filter, matching name or url', () => {
    const s = source('a', { name: 'Diary of a CEO', url: 'https://youtube.com/@doac' });
    expect(passesFocus(s, 'all', ctx([], {}, 'diary'))).toBe(true);
    expect(passesFocus(s, 'all', ctx([], {}, 'youtube'))).toBe(true);
    expect(passesFocus(s, 'all', ctx([], {}, 'cricket'))).toBe(false);
    // A query still has to respect the active filter.
    expect(passesFocus(s, 'todo', ctx(['a'], {}, 'diary'))).toBe(false);
  });
});

describe('streaks', () => {
  it('is empty with no banked days', () => {
    expect(computeStreak([], TODAY)).toEqual({ current: 0, best: 0 });
  });

  it('counts consecutive days ending today', () => {
    const days = [day('2026-06-09'), day('2026-06-10'), day(TODAY)];
    expect(computeStreak(days, TODAY)).toEqual({ current: 3, best: 3 });
  });

  it('does not break the run just because today is unfinished', () => {
    const days = [day('2026-06-09'), day('2026-06-10')];
    expect(computeStreak(days, TODAY).current).toBe(2);
  });

  it('breaks once two days have gone by', () => {
    const days = [day('2026-06-08'), day('2026-06-09')];
    expect(computeStreak(days, TODAY)).toEqual({ current: 0, best: 2 });
  });

  it('remembers the best run even after it ends', () => {
    const days = [
      day('2026-06-01'), day('2026-06-02'), day('2026-06-03'), day('2026-06-04'),
      day('2026-06-10'), day(TODAY),
    ];
    expect(computeStreak(days, TODAY)).toEqual({ current: 2, best: 4 });
  });

  it('builds the grid oldest first, marking banked days', () => {
    const grid = streakGrid([day(TODAY), day('2026-06-09')], TODAY, 5);
    expect(grid.map((d) => d.date)).toEqual([
      '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
    ]);
    expect(grid.map((d) => d.banked)).toEqual([false, false, true, false, true]);
  });
});

describe('completion history', () => {
  it('counts distinct sources ticked per day, newest first', () => {
    const checks = [
      check('a', KEY, TODAY),
      check('b', `${TODAY}#n`, TODAY),
      // The same source ticked in two windows on one day is still one source.
      check('a', `${TODAY}#n`, TODAY),
      check('a', '2026-06-10#m', '2026-06-10'),
    ];
    const out = completionHistory(checks, [day(TODAY)], TODAY, 3);
    expect(out.map((d) => d.date)).toEqual(['2026-06-11', '2026-06-10', '2026-06-09']);
    expect(out.map((d) => d.done)).toEqual([2, 1, 0]);
    expect(out.map((d) => d.banked)).toEqual([true, false, false]);
  });
});

describe('capturing a missed window', () => {
  const closed = { key: '2026-06-10#n', windowName: 'Night', start: 100, end: 300 };
  const rss = source('a', { kind: 'rss', feedUrl: 'https://x/feed', name: 'Feed A', groupId: 'g1' });
  const groups = [group('g1', 'News')];
  const feeds = feedsBySource([feed('a', [entry('u1', 150), entry('u2', 250), entry('u3', 900)])]);

  it('archives entries published in the window on sources you did not tick', () => {
    const miss = captureMissed(closed, [rss], groups, feeds, new Set(), new Set(), 'id1', 1_000)!;
    expect(miss.windowName).toBe('Night');
    expect(miss.items).toHaveLength(1);
    expect(miss.items[0]!.groupName).toBe('News');
    // u3 was published after the window closed, so it is not "missed".
    expect(miss.items[0]!.entries.map((e) => e.url)).toEqual(['u2', 'u1']);
  });

  it('archives nothing for a window you cleared', () => {
    expect(captureMissed(closed, [rss], groups, feeds, new Set(['a']), new Set(), 'id1', 1_000)).toBeNull();
  });

  it('ignores sources with nothing to fetch', () => {
    const link = source('b', { kind: 'link' });
    expect(captureMissed(closed, [link], groups, feeds, new Set(), new Set(), 'id1', 1_000)).toBeNull();
  });

  it('skips a source snoozed past the window — opting out is not a guilt trip', () => {
    const snoozed = { ...rss, snoozedUntil: 400 };
    expect(captureMissed(closed, [snoozed], groups, feeds, new Set(), new Set(), 'id1', 1_000)).toBeNull();
  });

  it('leaves out entries already opened', () => {
    const miss = captureMissed(closed, [rss], groups, feeds, new Set(), new Set(['u1']), 'id1', 1_000)!;
    expect(miss.items[0]!.entries.map((e) => e.url)).toEqual(['u2']);
  });
});

describe('history retention', () => {
  const miss = (id: string, snapshotAt: number, count: number): RoutineMiss => ({
    id,
    windowKey: 'k',
    windowName: 'Night',
    snapshotAt,
    start: 0,
    end: 1,
    items: [{
      sourceId: 'a',
      name: 'A',
      kind: 'rss',
      groupName: null,
      entries: Array.from({ length: count }, (_, i) => entry(`u${id}${i}`, i)),
    }],
  });

  it('drops anything older than a fortnight and sorts newest first', () => {
    const now = 1_000_000_000_000;
    const kept = [miss('a', now - 1000, 1), miss('b', now - MISS_MAX_AGE_MS - 1, 1), miss('c', now - 500, 1)];
    expect(liveMisses(kept, now).map((m) => m.id)).toEqual(['c', 'a']);
  });

  it('totals every missed entry across every day', () => {
    expect(totalMissed([miss('a', 1, 3), miss('b', 2, 2)])).toBe(5);
  });
});

describe('presentation helpers', () => {
  it('gives a group a stable color derived from its id when none is set', () => {
    expect(colorForGroupId('abc')).toBe(colorForGroupId('abc'));
    expect(groupColor(group('abc'))).toBe(colorForGroupId('abc'));
    expect(groupColor({ ...group('abc'), color: '#123456' })).toBe('#123456');
  });

  it('converts a hex color to rgba, and passes anything else through', () => {
    expect(withAlpha('#3aa0e0', 0.5)).toBe('rgba(58, 160, 224, 0.5)');
    expect(withAlpha('var(--blue)', 0.5)).toBe('var(--blue)');
  });

  it('describes an entry age relative to now', () => {
    const now = Date.parse('2026-06-11T12:00:00Z');
    expect(formatAge(now, now)).toBe('now');
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d ago');
    // Anything past a week gets an absolute date instead.
    expect(formatAge(now - 30 * 86_400_000, now)).toMatch(/May/);
  });
});
