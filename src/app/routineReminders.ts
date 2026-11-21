import { db } from '../db/db';
import { routineRemind } from './settings';
import { routineWindowAt, sortedWindows } from '../domain/routineWindows';
import {
  checkedIdsIn, feedsBySource, hasFeed, newEntriesFor, seenUrlSet, visibleSources,
} from '../domain/myRoutine';

/** Local nudges when a routine window opens with something waiting.
 *
 *  Like the board-card reminders, this is foreground-only: a static PWA has no
 *  push server, so a notification fires while the app is alive and the browser
 *  allows it. Each window occurrence fires at most once — the last key we
 *  notified for is remembered, so re-opening the app mid-window stays quiet. */

const SCAN_INTERVAL_MS = 60_000;
const NOTIFIED_KEY = 'clarity-routine-notified';

function supported(): boolean {
  return typeof Notification !== 'undefined';
}

/** Ask for permission. Call from a user gesture (the bell button). */
export async function requestRoutinePermission(): Promise<NotificationPermission> {
  if (!supported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function lastNotified(): string {
  try {
    return localStorage.getItem(NOTIFIED_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberNotified(key: string): void {
  try {
    localStorage.setItem(NOTIFIED_KEY, key);
  } catch {
    /* private mode; we just re-notify next window */
  }
}

async function scan(): Promise<void> {
  if (!supported() || !routineRemind() || Notification.permission !== 'granted') return;

  const windows = sortedWindows(await db.routineWindows.toArray());
  if (!windows.length) return;
  const span = routineWindowAt(windows, null, new Date());
  if (!span || span.upcomingAt !== null || !span.key) return;
  if (lastNotified() === span.key) return;

  const now = Date.now();
  const sources = visibleSources(await db.routineSources.toArray(), now);
  const checked = checkedIdsIn(await db.routineChecks.toArray(), span.key);
  const feeds = feedsBySource(await db.routineFeeds.toArray());
  const seen = seenUrlSet(await db.routineSeen.toArray());

  let count = 0;
  for (const source of sources) {
    if (checked.has(source.id) || !hasFeed(source)) continue;
    count += newEntriesFor(feeds.get(source.id), span.start, span.end, seen).length;
  }
  if (count <= 0) return;

  const name = windows.find((w) => w.id === span.selectedId)?.name ?? 'Routine';
  // Stamp before showing: if the constructor throws on this platform we still
  // must not retry every minute for the rest of the window.
  rememberNotified(span.key);
  try {
    new Notification(`${name} · ${count} new`, {
      body: 'New updates are waiting in My Routine.',
      tag: 'clarity-routine',
    });
  } catch {
    /* some platforms only allow notifications from a service worker */
  }
}

export function startRoutineReminders(): void {
  if (!supported()) return;
  void scan();
  setInterval(() => void scan(), SCAN_INTERVAL_MS);
}
