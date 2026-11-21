import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/db';
import {
  bankStreakDay, clearMisses, createGroup, createSource, createWindow, deleteGroup,
  deleteSource, deleteWindow, ensureWindows, markSeen, moveSourceToGroup, pruneMisses,
  pruneSeen, renameGroup, reorderGroups, saveFeed, saveFeedError, saveMiss, setChecked,
  shapeSource, snoozeSource, unsnoozeSource, updateWindow,
} from '../../src/db/myRoutineMutations';
import { exportData, importData, validateExport } from '../../src/db/exportImport';
import { sortByOrderKey } from '../../src/db/ordering';
import { checkId, MISS_MAX_AGE_MS } from '../../src/domain/myRoutine';
import { isNavigableUrl } from '../../src/domain/feedParse';
import type { RoutineMiss } from '../../src/db/models';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('windows', () => {
  it('seeds Morning and Night on first use and never again', async () => {
    const first = await ensureWindows();
    expect(first.map((w) => w.name)).toEqual(['Morning', 'Night']);
    await ensureWindows();
    expect(await db.routineWindows.count()).toBe(2);
  });

  it('adds, retimes and removes windows', async () => {
    await ensureWindows();
    const noon = await createWindow('Noon', '12:00');
    expect(await db.routineWindows.count()).toBe(3);

    await updateWindow(noon.id, { time: '13:30', name: 'Lunch' });
    const updated = (await db.routineWindows.get(noon.id))!;
    expect(updated).toMatchObject({ name: 'Lunch', time: '13:30' });

    await deleteWindow(noon.id);
    expect(await db.routineWindows.count()).toBe(2);
  });

  it('refuses to delete the last window — there would be nowhere to tick off', async () => {
    const only = await createWindow('Only', '09:00');
    await deleteWindow(only.id);
    expect(await db.routineWindows.count()).toBe(1);
  });
});

describe('groups', () => {
  it('appends groups in order and gives each a distinct color', async () => {
    const a = await createGroup('Social');
    const b = await createGroup('Sports');
    expect(a.orderKey < b.orderKey).toBe(true);
    expect(a.color).not.toBe(b.color);
  });

  it('renames a group', async () => {
    const g = await createGroup('Sport');
    await renameGroup(g.id, 'Sports');
    expect((await db.routineGroups.get(g.id))!.name).toBe('Sports');
  });

  it('deleting a group keeps its sources, dropping them into Other', async () => {
    const g = await createGroup('Social');
    const s = await createSource({ kind: 'link', raw: 'x.com', name: 'X', groupId: g.id });
    await deleteGroup(g.id);
    expect(await db.routineGroups.count()).toBe(0);
    const kept = (await db.routineSources.get(s.id))!;
    expect(kept.groupId).toBeNull();
  });

  it('reorders groups', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const c = await createGroup('C');
    await reorderGroups(2, 0);
    const order = sortByOrderKey(await db.routineGroups.toArray()).map((g) => g.name);
    expect(order).toEqual(['C', 'A', 'B']);
    expect([a, b, c].every((g) => g.id)).toBe(true);
  });

  it('ignores an out-of-range reorder rather than corrupting the list', async () => {
    await createGroup('A');
    await createGroup('B');
    await reorderGroups(0, 9);
    expect(sortByOrderKey(await db.routineGroups.toArray()).map((g) => g.name)).toEqual(['A', 'B']);
  });
});

describe('shapeSource', () => {
  it('builds a channel URL once the YouTube id is known', () => {
    const shaped = shapeSource({
      kind: 'youtube', raw: '@mkbhd', name: '', groupId: null, channelId: 'UCabcdefghijklmnopqrstuv',
    });
    expect(shaped.url).toBe('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv');
    expect(shaped.name).toBe('@mkbhd');
  });

  it('extracts a Telegram handle and names the source after it', () => {
    const shaped = shapeSource({ kind: 'telegram', raw: 'https://t.me/durov', name: '', groupId: null });
    expect(shaped.handle).toBe('durov');
    expect(shaped.url).toBe('https://t.me/durov');
    expect(shaped.name).toBe('@durov');
  });

  it('falls back to the hostname when no name is given', () => {
    const shaped = shapeSource({ kind: 'link', raw: 'https://www.instagram.com', name: '', groupId: null });
    expect(shaped.name).toBe('instagram.com');
  });

  it('keeps an explicit name over any guess', () => {
    const shaped = shapeSource({ kind: 'link', raw: 'instagram.com', name: 'Insta', groupId: null });
    expect(shaped.name).toBe('Insta');
  });

  it('never leaves a source without somewhere to open', () => {
    const shaped = shapeSource({ kind: 'link', raw: 'Diary of a CEO', name: 'Diary of a CEO', groupId: null });
    expect(shaped.url).toContain('duckduckgo.com');
  });

  it('never stores a URL a browser cannot navigate to', () => {
    // The regression: a YouTube channel entered by display name was shaped to
    // "https://Diary of a CEO" — non-empty, so the fallback was skipped, and
    // the browser opened a blank in-app tab instead of reporting an error.
    for (const raw of ['Diary of a CEO', 'Lex Fridman', 'The Daily', '   spaced   name  ']) {
      const shaped = shapeSource({ kind: 'youtube', raw, name: raw.trim(), groupId: null });
      expect(isNavigableUrl(shaped.url), `${raw} -> ${shaped.url}`).toBe(true);
      expect(shaped.url).toContain('youtube.com');
    }
  });

  it('still prefers a real channel URL over a search when it has one', () => {
    expect(shapeSource({ kind: 'youtube', raw: '@mkbhd', name: '', groupId: null }).url)
      .toBe('https://www.youtube.com/@mkbhd');
  });
});

describe('sources', () => {
  it('appends within its own group, so each group orders independently', async () => {
    const g1 = await createGroup('One');
    const g2 = await createGroup('Two');
    const a = await createSource({ kind: 'link', raw: 'a.com', name: 'A', groupId: g1.id });
    const b = await createSource({ kind: 'link', raw: 'b.com', name: 'B', groupId: g1.id });
    const c = await createSource({ kind: 'link', raw: 'c.com', name: 'C', groupId: g2.id });
    expect(a.orderKey < b.orderKey).toBe(true);
    // A fresh group starts its own key scope rather than continuing the last.
    expect(c.orderKey).toBe(a.orderKey);
  });

  it('moving a source re-keys it at the end of its new group', async () => {
    const g1 = await createGroup('One');
    const g2 = await createGroup('Two');
    const s = await createSource({ kind: 'link', raw: 'a.com', name: 'A', groupId: g1.id });
    await createSource({ kind: 'link', raw: 'b.com', name: 'B', groupId: g2.id });
    await moveSourceToGroup(s.id, g2.id);
    const moved = (await db.routineSources.get(s.id))!;
    expect(moved.groupId).toBe(g2.id);
    const inGroup = sortByOrderKey((await db.routineSources.toArray()).filter((x) => x.groupId === g2.id));
    expect(inGroup.map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('snoozing sets and clears a deadline', async () => {
    const s = await createSource({ kind: 'link', raw: 'a.com', name: 'A', groupId: null });
    await snoozeSource(s.id, 60_000);
    expect((await db.routineSources.get(s.id))!.snoozedUntil).toBeGreaterThan(Date.now());
    await unsnoozeSource(s.id);
    expect((await db.routineSources.get(s.id))!.snoozedUntil).toBe(0);
  });

  it('deleting a source takes its cached feed and its ticks with it', async () => {
    const s = await createSource({ kind: 'rss', raw: 'https://x/feed', name: 'X', groupId: null });
    await saveFeed(s.id, [{ id: '1', title: 't', url: 'https://x/1', publishedMs: 1, thumb: '' }]);
    await setChecked('2026-06-11#m', s.id, true);
    await deleteSource(s.id);
    expect(await db.routineSources.get(s.id)).toBeUndefined();
    expect(await db.routineFeeds.get(s.id)).toBeUndefined();
    expect(await db.routineChecks.count()).toBe(0);
  });
});

describe('checking off', () => {
  it('is idempotent, and scoped to one window occurrence', async () => {
    await setChecked('2026-06-11#m', 's1', true);
    await setChecked('2026-06-11#m', 's1', true);
    expect(await db.routineChecks.count()).toBe(1);

    await setChecked('2026-06-11#n', 's1', true);
    expect(await db.routineChecks.count()).toBe(2);

    const row = (await db.routineChecks.get(checkId('2026-06-11#m', 's1')))!;
    expect(row.date).toBe('2026-06-11');
  });

  it('unchecking removes the row, so a new day starts empty by construction', async () => {
    await setChecked('2026-06-11#m', 's1', true);
    await setChecked('2026-06-11#m', 's1', false);
    expect(await db.routineChecks.count()).toBe(0);
  });

  it('ignores a write with no window key rather than storing a stray row', async () => {
    await setChecked('', 's1', true);
    expect(await db.routineChecks.count()).toBe(0);
  });

  it('banks a streak day at most once', async () => {
    await bankStreakDay('2026-06-11');
    await bankStreakDay('2026-06-11');
    expect(await db.routineDays.count()).toBe(1);
  });
});

describe('feeds and seen entries', () => {
  it('a failed refresh keeps the last good entries and records the error', async () => {
    await saveFeed('s1', [{ id: '1', title: 't', url: 'https://x/1', publishedMs: 1, thumb: '' }]);
    await saveFeedError('s1', 'proxy 503');
    const feed = (await db.routineFeeds.get('s1'))!;
    expect(feed.error).toBe('proxy 503');
    // A stale list beats an empty screen.
    expect(feed.entries).toHaveLength(1);
  });

  it('marks entries seen and prunes ones older than a month', async () => {
    await markSeen(['https://x/1', 'https://x/2', '']);
    expect(await db.routineSeen.count()).toBe(2);
    await db.routineSeen.put({ url: 'https://x/old', seenAt: Date.now() - 40 * 86_400_000 });
    await pruneSeen();
    expect(await db.routineSeen.count()).toBe(2);
    expect(await db.routineSeen.get('https://x/old')).toBeUndefined();
  });
});

describe('history', () => {
  const miss = (id: string, snapshotAt: number): RoutineMiss => ({
    id, windowKey: 'k', windowName: 'Night', snapshotAt, start: 0, end: 1, items: [],
  });

  it('prunes archived days past a fortnight and can clear the lot', async () => {
    await saveMiss(miss('fresh', Date.now()));
    await saveMiss(miss('stale', Date.now() - MISS_MAX_AGE_MS - 1000));
    await pruneMisses();
    expect((await db.routineMisses.toArray()).map((m) => m.id)).toEqual(['fresh']);
    await clearMisses();
    expect(await db.routineMisses.count()).toBe(0);
  });
});

describe('backup round trip', () => {
  it('carries the whole My Routine section through export and import', async () => {
    await ensureWindows();
    const group = await createGroup('Social');
    const source = await createSource({ kind: 'link', raw: 'x.com', name: 'X', groupId: group.id });
    await setChecked('2026-06-11#m', source.id, true);
    await saveFeed(source.id, [{ id: '1', title: 't', url: 'https://x/1', publishedMs: 1, thumb: '' }]);
    await markSeen(['https://x/1']);
    await bankStreakDay('2026-06-11');
    await saveMiss({
      id: 'm1', windowKey: 'k', windowName: 'Night', snapshotAt: Date.now(), start: 0, end: 1, items: [],
    });

    const file = validateExport(JSON.parse(JSON.stringify(await exportData())));
    await Promise.all(db.tables.map((t) => t.clear()));
    await importData(file);

    expect(await db.routineWindows.count()).toBe(2);
    expect((await db.routineGroups.get(group.id))!.name).toBe('Social');
    expect((await db.routineSources.get(source.id))!.name).toBe('X');
    expect(await db.routineChecks.count()).toBe(1);
    expect((await db.routineFeeds.get(source.id))!.entries).toHaveLength(1);
    expect(await db.routineSeen.count()).toBe(1);
    expect(await db.routineDays.count()).toBe(1);
    expect(await db.routineMisses.count()).toBe(1);
  });

  it('still accepts an older backup that predates the section', async () => {
    const file = validateExport({
      app: 'clarity',
      schemaVersion: 4,
      exportedAt: Date.now(),
      data: { tasks: [], projects: [], headings: [], areas: [], tags: [], settings: [] },
    });
    await importData(file);
    expect(await db.routineSources.count()).toBe(0);
  });

  it('rejects a backup whose routine tables are the wrong shape', () => {
    expect(() =>
      validateExport({
        app: 'clarity',
        schemaVersion: 5,
        exportedAt: Date.now(),
        data: {
          tasks: [], projects: [], headings: [], areas: [], tags: [], settings: [],
          routineSources: 'nope',
        },
      }),
    ).toThrow(/malformed/);
  });
});
