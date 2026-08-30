import { nanoid } from 'nanoid';
import { db } from './db';
import type {
  DateStr, FeedEntry, RoutineCheck, RoutineFeed, RoutineGroup, RoutineMiss,
  RoutineSource, RoutineWindow, SourceKind,
} from './models';
import { keyAtEnd, sortByOrderKey } from './ordering';
import { todayStr } from '../domain/dates';
import { checkId, GROUP_PALETTE, MISS_MAX_AGE_MS } from '../domain/myRoutine';
import { DEFAULT_WINDOWS, dateOfWindowKey } from '../domain/routineWindows';
import {
  normalizeUrl, sourceOpenUrl, telegramHandle, ytTargetUrl,
} from '../domain/feedParse';

/** Every My Routine write lives here. Reads happen through liveQuery, so a
 *  mutation only has to put the row — the screen re-renders itself. */

// ------------------------------------------------------------------ windows --

/** Morning and Night, created the first time the screen is opened. Windows are
 *  what make "check off in the morning, again at night" mean anything, so the
 *  section is unusable with none — this is structure, not seeded content. */
export async function ensureWindows(): Promise<RoutineWindow[]> {
  // Read and write in one transaction: the screen calls this on every mount,
  // so two quick visits could otherwise both see an empty table and seed
  // Morning and Night twice over.
  return db.transaction('rw', db.routineWindows, async () => {
    const existing = await db.routineWindows.toArray();
    if (existing.length) return existing;
    const created: RoutineWindow[] = [];
    for (const w of DEFAULT_WINDOWS) {
      created.push({ id: nanoid(), name: w.name, time: w.time, orderKey: keyAtEnd(created) });
    }
    await db.routineWindows.bulkPut(created);
    return created;
  });
}

export async function createWindow(name: string, time: string): Promise<RoutineWindow> {
  const all = await db.routineWindows.toArray();
  const window: RoutineWindow = { id: nanoid(), name, time, orderKey: keyAtEnd(all) };
  await db.routineWindows.put(window);
  return window;
}

export async function updateWindow(
  id: string,
  patch: Partial<Pick<RoutineWindow, 'name' | 'time'>>,
): Promise<void> {
  const existing = await db.routineWindows.get(id);
  if (!existing) return;
  await db.routineWindows.put({ ...existing, ...patch });
}

/** Deleting the last window would leave the screen with nowhere to tick off,
 *  so the caller must keep at least one. */
export async function deleteWindow(id: string): Promise<void> {
  const all = await db.routineWindows.toArray();
  if (all.length <= 1) return;
  await db.routineWindows.delete(id);
}

// ------------------------------------------------------------------- groups --

export async function createGroup(name: string): Promise<RoutineGroup> {
  const all = await db.routineGroups.toArray();
  const group: RoutineGroup = {
    id: nanoid(),
    name,
    color: GROUP_PALETTE[all.length % GROUP_PALETTE.length]!,
    orderKey: keyAtEnd(all),
    createdAt: Date.now(),
  };
  await db.routineGroups.put(group);
  return group;
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const existing = await db.routineGroups.get(id);
  if (!existing) return;
  await db.routineGroups.put({ ...existing, name });
}

export async function setGroupColor(id: string, color: string): Promise<void> {
  const existing = await db.routineGroups.get(id);
  if (!existing) return;
  await db.routineGroups.put({ ...existing, color });
}

/** Deleting a group keeps its sources — they fall into "Other" rather than
 *  vanishing, so a mis-tap never costs you a channel list. */
export async function deleteGroup(id: string): Promise<void> {
  await db.transaction('rw', [db.routineGroups, db.routineSources], async () => {
    const orphans = await db.routineSources.where('groupId').equals(id).toArray();
    await db.routineSources.bulkPut(orphans.map((s) => ({ ...s, groupId: null })));
    await db.routineGroups.delete(id);
  });
}

/** Move the group at `from` to index `to`, renumbering the whole list. Groups
 *  are few, so a straight rewrite is simpler than splicing fractional keys. */
export async function reorderGroups(from: number, to: number): Promise<void> {
  const all = sortByOrderKey(await db.routineGroups.toArray());
  if (from === to || from < 0 || to < 0 || from >= all.length || to >= all.length) return;
  const next = [...all];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const rekeyed: RoutineGroup[] = [];
  for (const g of next) rekeyed.push({ ...g, orderKey: keyAtEnd(rekeyed) });
  await db.routineGroups.bulkPut(rekeyed);
}

// ------------------------------------------------------------------ sources --

export interface SourceDraft {
  kind: SourceKind;
  /** Whatever the user typed: a URL, an @handle, or a bare name. */
  raw: string;
  name: string;
  groupId: string | null;
  /** Pre-resolved where the caller already knows it. */
  channelId?: string;
  feedUrl?: string;
}

/** Fill in the kind-specific fields from the raw input. Kept separate from the
 *  write so the shape can be unit-tested without a database. */
export function shapeSource(draft: SourceDraft): Pick<
  RoutineSource,
  'kind' | 'name' | 'url' | 'channelId' | 'handle' | 'feedUrl'
> {
  const raw = draft.raw.trim();
  const kind = draft.kind;
  let channelId = draft.channelId ?? '';
  let handle = '';
  let feedUrl = draft.feedUrl ?? '';
  let url = '';

  if (kind === 'youtube') {
    url = channelId ? `https://www.youtube.com/channel/${channelId}` : ytTargetUrl(raw);
  } else if (kind === 'telegram') {
    handle = telegramHandle(raw);
    url = handle ? `https://t.me/${handle}` : sourceOpenUrl(kind, raw, draft.name);
  } else if (kind === 'rss') {
    feedUrl = feedUrl || normalizeUrl(raw) || raw;
    url = sourceOpenUrl('link', feedUrl, draft.name);
  } else {
    url = sourceOpenUrl('link', raw, draft.name);
  }
  if (!url) url = sourceOpenUrl(kind, raw, draft.name);

  // A handle makes a better default name than a bare domain.
  let fallback = '';
  if (kind === 'telegram' && handle) fallback = `@${handle}`;
  else if (kind === 'youtube') {
    const m = raw.match(/@([\w.\-]+)/);
    if (m) fallback = `@${m[1]}`;
  }
  const name = draft.name.trim() || fallback || hostLabel(url) || 'Source';

  return { kind, name, url, channelId, handle, feedUrl };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function createSource(draft: SourceDraft): Promise<RoutineSource> {
  const siblings = await db.routineSources.toArray();
  const now = Date.now();
  const source: RoutineSource = {
    id: nanoid(),
    groupId: draft.groupId,
    orderKey: keyAtEnd(siblings.filter((s) => s.groupId === draft.groupId)),
    snoozedUntil: 0,
    createdAt: now,
    modifiedAt: now,
    ...shapeSource(draft),
  };
  await db.routineSources.put(source);
  return source;
}

export async function updateSource(
  id: string,
  patch: Partial<Omit<RoutineSource, 'id' | 'createdAt'>>,
): Promise<void> {
  const existing = await db.routineSources.get(id);
  if (!existing) return;
  await db.routineSources.put({ ...existing, ...patch, modifiedAt: Date.now() });
}

/** Removing a source takes its cached feed with it — the cache is worthless
 *  without the row, and leaving it behind would leak storage forever. */
export async function deleteSource(id: string): Promise<void> {
  await db.transaction('rw', [db.routineSources, db.routineFeeds, db.routineChecks], async () => {
    await db.routineSources.delete(id);
    await db.routineFeeds.delete(id);
    await db.routineChecks.where('sourceId').equals(id).delete();
  });
}

export async function moveSourceToGroup(id: string, groupId: string | null): Promise<void> {
  const all = await db.routineSources.toArray();
  const source = all.find((s) => s.id === id);
  if (!source) return;
  const siblings = all.filter((s) => s.groupId === groupId && s.id !== id);
  await db.routineSources.put({
    ...source,
    groupId,
    orderKey: keyAtEnd(siblings),
    modifiedAt: Date.now(),
  });
}

export async function snoozeSource(id: string, ms: number): Promise<void> {
  await updateSource(id, { snoozedUntil: Date.now() + ms });
}

export async function unsnoozeSource(id: string): Promise<void> {
  await updateSource(id, { snoozedUntil: 0 });
}

// -------------------------------------------------------------- checking off --

export async function setChecked(
  windowKey: string,
  sourceId: string,
  checked: boolean,
): Promise<void> {
  if (!windowKey) return;
  const id = checkId(windowKey, sourceId);
  if (!checked) {
    await db.routineChecks.delete(id);
    return;
  }
  const check: RoutineCheck = {
    id,
    windowKey,
    sourceId,
    date: dateOfWindowKey(windowKey) || todayStr(),
    checkedAt: Date.now(),
  };
  await db.routineChecks.put(check);
}

/** Bank a day toward the streak. Idempotent: the date is the key. */
export async function bankStreakDay(date: DateStr): Promise<void> {
  const existing = await db.routineDays.get(date);
  if (existing) return;
  await db.routineDays.put({ date, bankedAt: Date.now() });
}

// -------------------------------------------------------------------- feeds --

export async function saveFeed(sourceId: string, entries: FeedEntry[]): Promise<void> {
  const feed: RoutineFeed = { sourceId, fetchedAt: Date.now(), entries, error: '' };
  await db.routineFeeds.put(feed);
}

export async function saveFeedError(sourceId: string, error: string): Promise<void> {
  const existing = await db.routineFeeds.get(sourceId);
  await db.routineFeeds.put({
    sourceId,
    // Keep the last good entries: a stale list beats an empty one.
    fetchedAt: Date.now(),
    entries: existing?.entries ?? [],
    error,
  });
}

export async function markSeen(urls: string[]): Promise<void> {
  const list = urls.filter(Boolean);
  if (!list.length) return;
  const now = Date.now();
  await db.routineSeen.bulkPut(list.map((url) => ({ url, seenAt: now })));
}

/** Seen-urls only matter while an entry can still show as new. Thirty days is
 *  well past any window, so anything older is dead weight. */
export async function pruneSeen(): Promise<void> {
  const cutoff = Date.now() - 30 * 86_400_000;
  await db.routineSeen.where('seenAt').below(cutoff).delete();
}

// ------------------------------------------------------------------ history --

export async function saveMiss(miss: RoutineMiss): Promise<void> {
  await db.routineMisses.put(miss);
}

export async function pruneMisses(): Promise<void> {
  const cutoff = Date.now() - MISS_MAX_AGE_MS;
  await db.routineMisses.where('snapshotAt').below(cutoff).delete();
}

export async function clearMisses(): Promise<void> {
  await db.routineMisses.clear();
}
