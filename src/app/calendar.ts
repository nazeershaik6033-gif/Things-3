import { db } from '../db/db';
import { getSetting, setSetting } from '../db/mutations';
import { defaultWindow, parseICS } from '../domain/ics';

/** ICS subscription sync: fetch (direct first, then via the user's CORS
 *  proxy), parse, replace the cache for that URL. Throttled to hourly. */

export const DEFAULT_PROXY = 'https://corsproxy.io/?url=';
/** Tried in order after the user's proxy — calendar hosts (Google included)
 *  block browser CORS, so at least one working proxy is required. */
const FALLBACK_PROXIES = [DEFAULT_PROXY, 'https://api.allorigins.win/raw?url='];

export interface CalendarStatus {
  ok: boolean;
  message: string;
}

/** A response only counts if it actually looks like an ICS feed — proxies
 *  sometimes return HTML error pages with HTTP 200. */
function looksLikeIcs(text: string): boolean {
  return text.includes('BEGIN:VCALENDAR');
}

export async function fetchIcsText(url: string, proxyPrefix: string): Promise<string> {
  try {
    const direct = await fetch(url, { mode: 'cors' });
    if (direct.ok) {
      const text = await direct.text();
      if (looksLikeIcs(text)) return text;
    }
  } catch {
    /* CORS or network failure: fall through to proxies */
  }
  // User's proxy first (if set), then the built-in fallbacks — never give up
  // just because the proxy field is empty.
  const proxies = [...new Set([proxyPrefix, ...FALLBACK_PROXIES].filter(Boolean))];
  let lastError = '';
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy + encodeURIComponent(url));
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      if (looksLikeIcs(text)) return text;
      lastError = 'proxy returned non-calendar data';
    } catch {
      lastError = 'network error';
    }
  }
  throw new Error(
    `Could not reach the calendar (${lastError || 'blocked'}). ` +
    'Check the link is the Secret iCal address, or try again later.',
  );
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
  // Empty/cleared proxy field must not disable sync — fall back to default
  const proxy = (await getSetting<string>('icsProxy', DEFAULT_PROXY)).trim() || DEFAULT_PROXY;
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
