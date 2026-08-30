/**
 * @vitest-environment happy-dom
 *
 * The parsers use DOMParser, so this file opts into a DOM while the rest of
 * the unit suite stays on the faster node environment.
 */
import { describe, expect, it } from 'vitest';
import {
  domainOf, isNavigableUrl, normalizeUrl, parseRssText, parseTelegramHtml, parseYtChannelId,
  parseYtFeed, scanYtChannelId, sourceOpenUrl, telegramHandle, ytTargetUrl,
} from '../../src/domain/feedParse';

describe('url shaping', () => {
  it('extracts a bare hostname', () => {
    expect(domainOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    expect(domainOf('not a url')).toBe('');
  });

  it('adds a scheme when one is missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('  ')).toBe('');
  });

  it('rejects a display name dressed up as a URL', () => {
    // The bug this guards: "Diary of a CEO" became "https://Diary of a CEO".
    expect(isNavigableUrl('https://Diary of a CEO')).toBe(false);
    expect(isNavigableUrl('https://localhost')).toBe(false);
    expect(isNavigableUrl('https://example.com')).toBe(true);
  });
});

describe('youtube', () => {
  it('reads a channel id straight out of a channel URL', () => {
    expect(parseYtChannelId('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')).toBe(
      'UCabcdefghijklmnopqrstuv',
    );
    expect(parseYtChannelId('https://www.youtube.com/@someone')).toBe('');
  });

  it('scrapes a channel id out of page markup, in any of its shapes', () => {
    expect(scanYtChannelId('{"channelId":"UCabcdefghijklmnopqrstuv"}')).toBe('UCabcdefghijklmnopqrstuv');
    expect(scanYtChannelId('"browseId":"UCabcdefghijklmnopqrstuv"')).toBe('UCabcdefghijklmnopqrstuv');
    expect(scanYtChannelId('<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">'))
      .toBe('UCabcdefghijklmnopqrstuv');
    expect(scanYtChannelId('nothing here')).toBe('');
  });

  it('turns whatever the user typed into a YouTube URL', () => {
    expect(ytTargetUrl('@mkbhd')).toBe('https://www.youtube.com/@mkbhd');
    expect(ytTargetUrl('mkbhd')).toBe('https://www.youtube.com/@mkbhd');
    expect(ytTargetUrl('youtube.com/@mkbhd')).toBe('https://youtube.com/@mkbhd');
    expect(ytTargetUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(ytTargetUrl('')).toBe('');
  });

  it('parses the per-channel Atom feed', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <entry>
          <yt:videoId>vid1</yt:videoId>
          <title>First video</title>
          <published>2026-06-10T10:00:00+00:00</published>
          <media:thumbnail url="https://img/1.jpg"/>
        </entry>
        <entry>
          <yt:videoId>vid2</yt:videoId>
          <title>Second video</title>
          <published>2026-06-11T10:00:00+00:00</published>
        </entry>
      </feed>`;
    const out = parseYtFeed(xml);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'vid1',
      title: 'First video',
      url: 'https://www.youtube.com/watch?v=vid1',
      thumb: 'https://img/1.jpg',
    });
    expect(out[0]!.publishedMs).toBe(Date.parse('2026-06-10T10:00:00Z'));
    // No media:thumbnail — fall back to the standard thumbnail URL.
    expect(out[1]!.thumb).toBe('https://i.ytimg.com/vi/vid2/hqdefault.jpg');
  });

  it('drops entries with no video id', () => {
    expect(parseYtFeed('<feed><entry><title>Broken</title></entry></feed>')).toEqual([]);
  });
});

describe('telegram', () => {
  it('pulls a handle out of every form it is given', () => {
    expect(telegramHandle('@durov')).toBe('durov');
    expect(telegramHandle('durov')).toBe('durov');
    expect(telegramHandle('https://t.me/durov')).toBe('durov');
    expect(telegramHandle('https://t.me/s/durov')).toBe('durov');
    expect(telegramHandle('nope!')).toBe('');
  });

  it('parses the public channel preview', () => {
    const html = `
      <div class="tgme_widget_message" data-post="durov/123">
        <div class="tgme_widget_message_text">Hello there</div>
        <time datetime="2026-06-11T10:00:00+00:00"></time>
      </div>
      <div class="tgme_widget_message" data-post="durov/124">
        <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://img/p.jpg')"></a>
        <time datetime="2026-06-11T11:00:00+00:00"></time>
      </div>`;
    const out = parseTelegramHtml(html, 'durov');
    expect(out).toHaveLength(2);
    // Newest first.
    expect(out[0]!.url).toBe('https://t.me/durov/124');
    expect(out[0]!.thumb).toBe('https://img/p.jpg');
    // A photo post with no caption still gets a readable title.
    expect(out[0]!.title).toBe('Media post');
    expect(out[1]!.title).toBe('Hello there');
  });

  it('drops messages with no timestamp, since they can never be "new"', () => {
    const html = '<div class="tgme_widget_message" data-post="a/1"><div class="tgme_widget_message_text">x</div></div>';
    expect(parseTelegramHtml(html, 'a')).toEqual([]);
  });
});

describe('rss and atom', () => {
  it('parses RSS items, newest first', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Older</title><link>https://x/1</link><pubDate>Wed, 10 Jun 2026 10:00:00 GMT</pubDate></item>
      <item><title>Newer</title><link>https://x/2</link><pubDate>Thu, 11 Jun 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const out = parseRssText(xml);
    expect(out.map((e) => e.title)).toEqual(['Newer', 'Older']);
    expect(out[0]!.url).toBe('https://x/2');
  });

  it('parses Atom entries, preferring the alternate link', () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry>
        <title>Post</title>
        <link rel="edit" href="https://x/edit"/>
        <link rel="alternate" href="https://x/post"/>
        <updated>2026-06-11T10:00:00Z</updated>
      </entry>
    </feed>`;
    const out = parseRssText(xml);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe('https://x/post');
  });

  it('drops entries with no link, which nothing could open', () => {
    expect(parseRssText('<rss><channel><item><title>No link</title></item></channel></rss>')).toEqual([]);
  });

  it('returns nothing for markup that is not a feed', () => {
    expect(parseRssText('<html><body>not a feed</body></html>')).toEqual([]);
  });
});

describe('sourceOpenUrl', () => {
  it('builds a real link for each kind', () => {
    expect(sourceOpenUrl('youtube', '@mkbhd', 'MKBHD')).toBe('https://www.youtube.com/@mkbhd');
    expect(sourceOpenUrl('telegram', '@durov', 'Durov')).toBe('https://t.me/durov');
    expect(sourceOpenUrl('link', 'instagram.com', 'Instagram')).toBe('https://instagram.com');
  });

  it('falls back to a search rather than a dead link when the input is only a name', () => {
    const url = sourceOpenUrl('link', 'Diary of a CEO', 'Diary of a CEO');
    expect(url).toContain('duckduckgo.com');
    expect(isNavigableUrl(url)).toBe(true);
  });

  it('returns empty when there is nothing at all to go on', () => {
    expect(sourceOpenUrl('link', '', '')).toBe('');
  });
});
