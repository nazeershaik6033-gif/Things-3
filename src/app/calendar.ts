import { db } from '../db/db';
import { getSetting, setSetting } from '../db/mutations';
import { defaultWindow, parseICS } from '../domain/ics';

/** ICS subscription sync: fetch (direct first, then via the user's CORS
 *  proxy), parse, replace the cache for that URL. Throttled to hourly. */

export const DEFAULT_PROXY = 'https://corsproxy.io/?url=';

export interface CalendarStatus {
  ok: boolean;
  message: string;
}

export async function fetchIcsText(url: string, proxyPrefix: string): Promise<string> {
  try {
    const direct = await fetch(url, { mode: 'cors' });
    if (direct.ok) return await direct.text();
  } catch {
    /* CORS or network failure: fall through to proxy */
  }
  if (!proxyPrefix) throw new Error('Calendar host blocks browser requests and no proxy is set.');
  const res = await fetch(proxyPrefix + encodeURIComponent(url));
  if (!res.ok) throw new Error(`Calendar fetch failed (HTTP ${res.status}).`);
  return await res.text();
}

export async function importIcsText(text: string, sourceUrl: string): Promise<number> {
  const events = parseICS(text, { calendarUrl: sourceUrl, ...defaultWindow(new Date()) });
  await db.transaction('rw', db.calendarEvents, async () => {
    await db.calendarEvents.where('calendarUrl').equals(sourceUrl).delete();
    await db.calendarEvents.bulkPut(events);
  });
  return events.length;
}

export async function refreshCalendar(force = false): Promise<CalendarStatus | null> {
  const url = await getSetting<string>('icsUrl', '');
  if (!url) return null;
  const last = await getSetting<number>('lastIcsFetch', 0);
  if (!force && Date.now() - last < 60 * 60 * 1000) return null;
  const proxy = await getSetting<string>('icsProxy', DEFAULT_PROXY);
  try {
    const text = await fetchIcsText(url, proxy);
    const count = await importIcsText(text, url);
    await setSetting('lastIcsFetch', Date.now());
    return { ok: true, message: `Updated — ${count} events synced.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Calendar update failed.' };
  }
}

export function startCalendarSync(): void {
  void refreshCalendar();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshCalendar();
  });
}
