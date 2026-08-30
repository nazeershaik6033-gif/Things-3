import type { FeedEntry, RoutineSource } from '../db/models';
import {
  parseRssText, parseTelegramHtml, parseYtFeed, parseYtChannelId, scanYtChannelId, ytTargetUrl,
} from '../domain/feedParse';

/** Feed fetching for My Routine.
 *
 *  There is no server: this is a static PWA, so every cross-origin read goes
 *  through a public CORS proxy. Those are best-effort by nature — rate-limited,
 *  occasionally down — so the pool is raced in parallel and the first response
 *  that passes a content check wins. A source whose feed cannot be read still
 *  works as a tick-off row; it just never shows a "new" badge. */

const PROXIES: Array<(url: string) => string> = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

const FETCH_TIMEOUT_MS = 18_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Race every proxy; first body that satisfies `ok` wins. The longest failing
 *  body is kept as a last resort, so a partial read still beats nothing. */
function fetchAcrossProxies(url: string, ok: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let pending = PROXIES.length;
    let best = '';
    let lastErr: unknown = null;
    let settled = false;
    for (const proxy of PROXIES) {
      void (async () => {
        try {
          const res = await fetchWithTimeout(proxy(url), {}, FETCH_TIMEOUT_MS);
          if (!res.ok) throw new Error(`proxy ${res.status}`);
          const text = await res.text();
          if (!text) throw new Error('empty proxy response');
          if (ok(text)) {
            if (!settled) {
              settled = true;
              resolve(text);
            }
            return;
          }
          if (text.length > best.length) best = text;
          throw new Error('proxy body failed validation');
        } catch (e) {
          if (!lastErr) lastErr = e;
        } finally {
          if (--pending === 0 && !settled) {
            settled = true;
            if (best) resolve(best);
            else reject(lastErr instanceof Error ? lastErr : new Error('all proxies failed'));
          }
        }
      })();
    }
  });
}

const looksLikeFeed = (t: string): boolean => /<(?:item|entry)[\s>]/i.test(t);

export async function fetchRss(feedUrl: string): Promise<FeedEntry[]> {
  return parseRssText(await fetchAcrossProxies(feedUrl, looksLikeFeed));
}

export async function fetchYouTube(channelId: string): Promise<FeedEntry[]> {
  const raw = await fetchAcrossProxies(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    (t) => /<entry[\s>]/i.test(t),
  );
  return parseYtFeed(raw);
}

export async function fetchTelegram(handle: string): Promise<FeedEntry[]> {
  const raw = await fetchAcrossProxies(
    `https://t.me/s/${encodeURIComponent(handle)}`,
    (t) => /tgme_widget_message/.test(t),
  );
  return parseTelegramHtml(raw, handle);
}

/** YouTube's resolve_url endpoint maps a handle straight to a channel id as
 *  small JSON, and unlike the channel page it isn't behind the cookie-consent
 *  wall that breaks scraping through proxies. It needs a POST, so only the
 *  proxies that forward method and body are usable. */
const YT_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

async function resolveYtViaApi(pageUrl: string): Promise<string> {
  const target =
    `https://www.youtube.com/youtubei/v1/navigation/resolve_url?key=${YT_INNERTUBE_KEY}&prettyPrint=false`;
  const body = JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
    url: pageUrl,
  });
  const wraps = [
    (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];
  for (const wrap of wraps) {
    try {
      const res = await fetchWithTimeout(
        wrap(target),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        20_000,
      );
      if (!res.ok) continue;
      const txt = await res.text();
      const m =
        txt.match(/"browseId":"(UC[\w-]{20,})"/) ??
        txt.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/);
      if (m) return m[1]!;
    } catch {
      /* try the next wrapper */
    }
  }
  return '';
}

/** Resolve a handle, custom URL or channel URL to its UC… id. Tries the
 *  resolve_url API first, then scrapes the page through each proxy. */
export async function resolveYtChannelId(input: string): Promise<string> {
  const direct = parseYtChannelId(input);
  if (direct) return direct;
  const url = ytTargetUrl(input);
  if (!url) return '';

  const viaApi = await resolveYtViaApi(url);
  if (viaApi) return viaApi;

  for (const proxy of PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy(url), {}, 25_000);
      if (!res.ok) continue;
      const id = scanYtChannelId(await res.text());
      if (id) return id;
    } catch {
      /* try the next proxy */
    }
  }
  return '';
}

/** Fetch whatever this source exposes, or null if it exposes nothing. */
export async function fetchSourceFeed(source: RoutineSource): Promise<FeedEntry[] | null> {
  if (source.kind === 'youtube' && source.channelId) return fetchYouTube(source.channelId);
  if (source.kind === 'telegram' && source.handle) return fetchTelegram(source.handle);
  if (source.kind === 'rss' && source.feedUrl) return fetchRss(source.feedUrl);
  return null;
}

/** Feed URL guesses for a site that isn't itself a feed. */
const FEED_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/index.xml', '/feed.xml', '/rss', '/feeds/posts/default'];

/** Resolve a site URL to a usable RSS/Atom feed, or '' when there is none —
 *  in which case the caller keeps it as a plain link. */
export async function discoverFeed(input: string): Promise<string> {
  const base = input.trim();
  if (!base) return '';
  const candidates = [base];
  try {
    const u = new URL(base);
    for (const path of FEED_PATHS) candidates.push(new URL(path, u.origin).href);
  } catch {
    return '';
  }
  for (const candidate of candidates) {
    try {
      const raw = await fetchAcrossProxies(candidate, looksLikeFeed);
      if (looksLikeFeed(raw)) return candidate;
    } catch {
      /* next candidate */
    }
  }
  return '';
}

export function openExternal(url: string): void {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
