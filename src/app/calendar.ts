import { createSignal } from 'solid-js';
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

/** Users often paste the wrong Google Calendar link. Convert the shapes we
 *  can, and flag the ones we can't so the error message can be specific. */
export function normalizeCalendarUrl(raw: string): { url: string; fromEmbed: boolean } {
  let url = raw.trim();
  // Calendar apps hand out webcal:// links — same thing over HTTPS
  if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);
  // Google "Embed" link: extract the calendar id and try the public feed.
  // (Works only for public calendars — private ones need the Secret address.)
  const embed = /calendar\.google\.com\/calendar\/embed/.test(url);
  if (embed) {
    try {
      const src = new URL(url).searchParams.get('src');
      if (src) {
        return {
          url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`,
          fromEmbed: true,
        };
      }
    } catch {
      /* unparseable: fall through */
    }
    return { url, fromEmbed: true };
  }
  return { url, fromEmbed: false };
}

const EMBED_HELP =
  'That looks like Google’s “Embed” link. Please paste the “Secret address ' +
  'in iCal format” instead (it ends in .ics): Google Calendar → Settings → ' +
  'your calendar → Integrate calendar → Secret address in iCal format.';

// ------------------------------------------------- several calendars --

/** Calendars beyond the main one (work, family…), each synced like it.
 *  Events are keyed by their source URL, so each keeps its own colour. */
export interface ExtraCalendar {
  url: string;
  name: string;
}

export const CALENDAR_COLORS = [
  'var(--teal)', 'var(--blue)', 'var(--green)', 'var(--orange, var(--yellow-deep))',
  'var(--purple)', 'var(--red)', 'var(--text-tertiary)',
] as const;

const [calendarColors, setCalendarColorsSignal] = createSignal<Record<string, string>>({});
const [extraCalendars, setExtraCalendarsSignal] = createSignal<ExtraCalendar[]>([]);
const [mainCalendarUrl, setMainCalendarUrl] = createSignal('');
export { calendarColors, extraCalendars };

/** A calendar's colour: chosen in Settings, else by its place in the list
 *  (main teal, then the palette), imported files grey. */
export function calendarColor(url: string): string {
  const chosen = calendarColors()[url];
  if (chosen) return chosen;
  if (url === 'file') return 'var(--text-tertiary)';
  if (url === mainCalendarUrl()) return CALENDAR_COLORS[0];
  const i = extraCalendars().findIndex((c) => c.url === url);
  return CALENDAR_COLORS[(i + 1) % (CALENDAR_COLORS.length - 1)]!;
}

export async function loadCalendarPrefs(): Promise<void> {
  setCalendarColorsSignal(await getSetting<Record<string, string>>('calendarColors', {}));
  setExtraCalendarsSignal(await getSetting<ExtraCalendar[]>('icsExtra', []));
  setMainCalendarUrl(await getSetting<string>('icsUrl', ''));
}

export async function setCalendarColor(url: string, color: string): Promise<void> {
  const next = { ...calendarColors(), [url]: color };
  setCalendarColorsSignal(next);
  await setSetting('calendarColors', next);
}

export async function addExtraCalendar(rawUrl: string, name: string): Promise<CalendarStatus> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, message: 'Paste the calendar’s .ics link first.' };
  if (url === mainCalendarUrl() || extraCalendars().some((c) => c.url === url)) {
    return { ok: false, message: 'That calendar is already added.' };
  }
  const next = [...extraCalendars(), { url, name: name.trim() || `Calendar ${extraCalendars().length + 2}` }];
  setExtraCalendarsSignal(next);
  await setSetting('icsExtra', next);
  return (await refreshCalendar(true)) ?? { ok: true, message: 'Added.' };
}

export async function removeExtraCalendar(url: string): Promise<void> {
  const next = extraCalendars().filter((c) => c.url !== url);
  setExtraCalendarsSignal(next);
  await setSetting('icsExtra', next);
  await db.calendarEvents.where('calendarUrl').equals(url).delete();
}

/** Every subscribed calendar: the main one (Settings' link) and the extras. */
async function subscriptions(): Promise<string[]> {
  const main = await getSetting<string>('icsUrl', '');
  setMainCalendarUrl(main);
  const extra = await getSetting<ExtraCalendar[]>('icsExtra', []);
  return [...(main ? [main] : []), ...extra.map((c) => c.url)];
}

async function syncOne(rawUrl: string, proxy: string): Promise<CalendarStatus & { count: number }> {
  const { url, fromEmbed } = normalizeCalendarUrl(rawUrl);
  try {
    const text = await fetchIcsText(url, proxy);
    const count = await importIcsText(text, rawUrl);
    return { ok: true, message: '', count };
  } catch (e) {
    if (fromEmbed) return { ok: false, message: EMBED_HELP, count: 0 };
    return { ok: false, message: e instanceof Error ? e.message : 'Calendar update failed.', count: 0 };
  }
}

export async function refreshCalendar(force = false): Promise<CalendarStatus | null> {
  const urls = await subscriptions();
  if (urls.length === 0) return null;
  const last = await getSetting<number>('lastIcsFetch', 0);
  if (!force && Date.now() - last < 60 * 60 * 1000) return null;
  // Empty/cleared proxy field must not disable sync — fall back to default
  const proxy = (await getSetting<string>('icsProxy', DEFAULT_PROXY)).trim() || DEFAULT_PROXY;
  const results = await Promise.all(urls.map((u) => syncOne(u, proxy)));
  const failed = results.filter((r) => !r.ok);
  if (failed.length < results.length) await setSetting('lastIcsFetch', Date.now());
  if (failed.length === 0) {
    const count = results.reduce((n, r) => n + r.count, 0);
    return { ok: true, message: `Updated — ${count} events synced${urls.length > 1 ? ` from ${urls.length} calendars` : ''}.` };
  }
  if (results.length === 1) return { ok: false, message: failed[0]!.message };
  return { ok: false, message: `${failed.length} of ${results.length} calendars failed: ${failed[0]!.message}` };
}

export function startCalendarSync(): void {
  void loadCalendarPrefs().then(() => refreshCalendar());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshCalendar();
  });
}
