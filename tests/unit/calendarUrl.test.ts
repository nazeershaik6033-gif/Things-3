import { describe, expect, it } from 'vitest';
import { normalizeCalendarUrl } from '../../src/app/calendar';

describe('normalizeCalendarUrl', () => {
  it('passes proper ics links through untouched', () => {
    const u = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics';
    expect(normalizeCalendarUrl(u)).toEqual({ url: u, fromEmbed: false });
  });

  it('converts webcal:// to https://', () => {
    expect(normalizeCalendarUrl('webcal://example.com/feed.ics').url).toBe(
      'https://example.com/feed.ics',
    );
  });

  it('converts a Google embed link to the public ical feed', () => {
    const r = normalizeCalendarUrl(
      'https://calendar.google.com/calendar/embed?src=me%40gmail.com&ctz=Asia%2FKolkata',
    );
    expect(r.fromEmbed).toBe(true);
    expect(r.url).toBe(
      'https://calendar.google.com/calendar/ical/me%40gmail.com/public/basic.ics',
    );
  });

  it('flags an embed link without src so the error can explain', () => {
    const r = normalizeCalendarUrl('https://calendar.google.com/calendar/embed?ctz=UTC');
    expect(r.fromEmbed).toBe(true);
  });

  it('trims whitespace', () => {
    expect(normalizeCalendarUrl('  https://x.com/a.ics ').url).toBe('https://x.com/a.ics');
  });
});
