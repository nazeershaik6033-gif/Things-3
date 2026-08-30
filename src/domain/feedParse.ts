import type { FeedEntry, SourceKind } from '../db/models';

/** Parsing and URL-shaping for routine sources. Everything here is pure —
 *  strings in, structured data out — so it can be tested without a network.
 *  The fetching that feeds these lives in ../net/feeds.ts. */

/** Cap per source: a routine is about what's new, not an archive. */
const ENTRY_CAP = 25;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Add a scheme if missing and confirm the result actually parses. */
export function normalizeUrl(input: string): string {
  let u = String(input ?? '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    new URL(u);
    return u;
  } catch {
    return '';
  }
}

/** True only for a URL a browser will really resolve — a host with a dot and
 *  no stray spaces. Guards against turning a display name like "Diary of a
 *  CEO" into the dead link "https://Diary of a CEO". */
export function isNavigableUrl(u: string): boolean {
  try {
    const x = new URL(String(u));
    return !!x.hostname && x.hostname.includes('.') && !/\s/.test(String(u));
  } catch {
    return false;
  }
}

export function parseYtChannelId(url: string): string {
  const m = String(url ?? '').match(/channel\/(UC[\w-]{20,})/);
  return m ? m[1]! : '';
}

/** Pull a UC… id out of a fetched YouTube page, whichever shape it came in. */
export function scanYtChannelId(raw: string): string {
  const s = String(raw ?? '');
  const m =
    s.match(/"(?:channelId|externalId|browseId)":"(UC[\w-]{20,})"/) ??
    s.match(/itemprop="(?:channelId|identifier)"\s+content="(UC[\w-]{20,})"/) ??
    s.match(/rel="canonical"[^>]*href="[^"]*channel\/(UC[\w-]{20,})/) ??
    s.match(/href="[^"]*channel\/(UC[\w-]{20,})"[^>]*rel="canonical"/) ??
    s.match(/channel\/(UC[\w-]{20,})/);
  return m ? m[1]! : '';
}

/** Turn whatever the user typed into a YouTube URL worth opening or scraping. */
export function ytTargetUrl(input: string): string {
  let s = String(input ?? '').trim();
  if (!s) return '';
  // explicit @handle with no domain
  if (/^@[\w.\-]+$/.test(s)) return `https://www.youtube.com/${s}`;
  // already a YouTube URL — just make sure it has a scheme
  if (/youtube\.com|youtu\.be/i.test(s)) {
    if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
    return s;
  }
  // a bare token is a handle
  if (/^[\w.\-]+$/.test(s)) return `https://www.youtube.com/@${s.replace(/^@/, '')}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  return s;
}

export function telegramHandle(input: string): string {
  const s = String(input ?? '').trim().replace(/^@/, '');
  const m = s.match(/(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{3,})/i);
  if (m) return m[1]!;
  if (/^[A-Za-z0-9_]{3,}$/.test(s)) return s;
  return '';
}

/** Where to send someone when all we have is a name. A YouTube channel is far
 *  better served by YouTube's own search than by a web search. */
export function searchUrlFor(kind: SourceKind, query: string): string {
  // Strip a scheme we may have bolted onto a plain name earlier, so the search
  // is for "Diary of a CEO" rather than "https://Diary of a CEO".
  const q = String(query ?? '').trim().replace(/^https?:\/\//i, '').trim();
  if (!q) return '';
  if (kind === 'youtube') return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

/** Always hand back a link the source row can open. When we cannot build a
 *  real URL from what was typed, fall back to a search for the name so the
 *  row still goes *somewhere* rather than nowhere. */
export function sourceOpenUrl(kind: SourceKind, raw: string, name: string): string {
  if (kind === 'youtube') {
    const u = ytTargetUrl(raw);
    if (isNavigableUrl(u)) return u;
  } else if (kind === 'telegram') {
    const h = telegramHandle(raw);
    if (h) return `https://t.me/${h}`;
  } else {
    const u = normalizeUrl(raw);
    if (isNavigableUrl(u)) return u;
  }
  return searchUrlFor(kind, name || raw);
}

/** The URL to actually open for a source, guaranteed navigable or empty.
 *
 *  Read at tap time rather than trusting the stored `url`: rows written before
 *  the shaping bug was fixed hold things like "https://Diary of a CEO", which
 *  a browser cannot navigate to — it opens an empty tab instead of failing
 *  visibly. Recomputing here repairs those rows without a migration. */
export function resolveOpenUrl(kind: SourceKind, url: string, name: string): string {
  if (isNavigableUrl(url)) return url;
  return sourceOpenUrl(kind, url, name);
}

// ------------------------------------------------------------------ parsers --

function textOf(parent: Element, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  return el ? (el.textContent ?? '').trim() : '';
}

/** RSS <item> or Atom <entry> — news, blogs, Reddit, bridges. */
export function parseRssText(raw: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  let nodes = Array.from(doc.getElementsByTagName('item'));
  let atom = false;
  if (!nodes.length) {
    nodes = Array.from(doc.getElementsByTagName('entry'));
    atom = true;
  }
  return nodes
    .slice(0, ENTRY_CAP)
    .map((n): FeedEntry => {
      let link = '';
      if (atom) {
        const links = n.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
          const l = links[i]!;
          if ((l.getAttribute('rel') ?? 'alternate') === 'alternate') {
            link = l.getAttribute('href') ?? '';
            break;
          }
        }
        if (!link && links[0]) link = links[0].getAttribute('href') ?? '';
      } else {
        link = textOf(n, 'link') || textOf(n, 'guid');
      }
      const published =
        textOf(n, 'pubDate') || textOf(n, 'published') || textOf(n, 'updated') || textOf(n, 'date');
      return {
        id: link || textOf(n, 'title'),
        title: (textOf(n, 'title') || 'Untitled').slice(0, 220),
        url: link,
        publishedMs: Date.parse(published) || 0,
        thumb: '',
      };
    })
    .filter((e) => !!e.url)
    .sort((a, b) => b.publishedMs - a.publishedMs);
}

/** YouTube's per-channel Atom feed. Thumbnails fall back to the standard
 *  i.ytimg URL, which exists for every video. */
export function parseYtFeed(raw: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  return Array.from(doc.getElementsByTagName('entry'))
    .slice(0, 20)
    .map((entry): FeedEntry | null => {
      const videoId = textOf(entry, 'yt:videoId') || textOf(entry, 'videoId');
      if (!videoId) return null;
      const tn = entry.getElementsByTagName('media:thumbnail')[0];
      return {
        id: videoId,
        title: textOf(entry, 'title').slice(0, 220),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        publishedMs: Date.parse(textOf(entry, 'published')) || 0,
        thumb: tn?.getAttribute('url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    })
    .filter((e): e is FeedEntry => e !== null);
}

/** The public channel preview served at t.me/s/<handle>. */
export function parseTelegramHtml(raw: string, handle: string): FeedEntry[] {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return Array.from(doc.querySelectorAll('.tgme_widget_message'))
    .map((m): FeedEntry => {
      const post = m.getAttribute('data-post') ?? '';
      const textEl = m.querySelector('.tgme_widget_message_text');
      const time = m.querySelector('time[datetime]');
      const publishedMs = time ? Date.parse(time.getAttribute('datetime') ?? '') || 0 : 0;
      let thumb = '';
      const photo = m.querySelector('.tgme_widget_message_photo_wrap, .tgme_widget_message_video_thumb');
      if (photo) {
        const mt = (photo.getAttribute('style') ?? '').match(/url\(['"]?(.*?)['"]?\)/);
        if (mt) thumb = mt[1]!;
      }
      const title = (textEl ? (textEl.textContent ?? '').trim() : '') || (thumb ? 'Media post' : 'Post');
      return {
        id: post || String(publishedMs),
        title: title.slice(0, 220),
        url: post ? `https://t.me/${post}` : `https://t.me/${handle}`,
        publishedMs,
        thumb,
      };
    })
    .filter((e) => e.publishedMs > 0)
    .sort((a, b) => b.publishedMs - a.publishedMs)
    .slice(0, ENTRY_CAP);
}
