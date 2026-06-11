import { describe, expect, it } from 'vitest';
import { parseICS, zonedEpoch } from '../../src/domain/ics';

const OPTS = { calendarUrl: 'https://cal.example/feed.ics', from: '2026-06-01', to: '2026-08-31' };

function wrap(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

describe('ICS parser', () => {
  it('parses a UTC timed event', () => {
    const ics = wrap(
      'BEGIN:VEVENT',
      'UID:abc@example.com',
      'SUMMARY:Team standup',
      'DTSTART:20260611T130000Z',
      'DTEND:20260611T133000Z',
      'END:VEVENT',
    );
    const [e] = parseICS(ics, OPTS);
    expect(e!.title).toBe('Team standup');
    expect(e!.allDay).toBe(false);
    expect(e!.start).toBe(Date.UTC(2026, 5, 11, 13, 0, 0));
    expect(e!.end).toBe(Date.UTC(2026, 5, 11, 13, 30, 0));
  });

  it('parses TZID times via Intl (Google Calendar style)', () => {
    const ics = wrap(
      'BEGIN:VEVENT',
      'UID:tz1',
      'SUMMARY:Dentist',
      'DTSTART;TZID=America/New_York:20260611T090000',
      'DTEND;TZID=America/New_York:20260611T100000',
      'END:VEVENT',
    );
    const [e] = parseICS(ics, OPTS);
    // 9 AM EDT (UTC-4 in June) = 13:00 UTC
    expect(e!.start).toBe(Date.UTC(2026, 5, 11, 13, 0, 0));
  });

  it('zonedEpoch handles winter (EST) too', () => {
    expect(zonedEpoch(2026, 1, 15, 9, 0, 0, 'America/New_York'))
      .toBe(Date.UTC(2026, 0, 15, 14, 0, 0)); // UTC-5
  });

  it('parses all-day events (VALUE=DATE) with exclusive DTEND', () => {
    const ics = wrap(
      'BEGIN:VEVENT',
      'UID:allday1',
      'SUMMARY:Conference',
      'DTSTART;VALUE=DATE:20260615',
      'DTEND;VALUE=DATE:20260617',
      'END:VEVENT',
    );
    const events = parseICS(ics, OPTS);
    // June 15 + 16, NOT 17 (DTEND exclusive)
    expect(events.map((e) => e.date)).toEqual(['2026-06-15', '2026-06-16']);
    expect(events.every((e) => e.allDay)).toBe(true);
  });

  it('single all-day event without DTEND', () => {
    const ics = wrap(
      'BEGIN:VEVENT', 'UID:bday', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20260620', 'END:VEVENT',
    );
    expect(parseICS(ics, OPTS).map((e) => e.date)).toEqual(['2026-06-20']);
  });

  it('unfolds folded lines and unescapes text', () => {
    const ics = wrap(
      'BEGIN:VEVENT',
      'UID:fold1',
      'SUMMARY:Dinner with friends\\, then a movie ab',
      ' out nothing',
      'DTSTART:20260612T180000Z',
      'END:VEVENT',
    );
    const [e] = parseICS(ics, OPTS);
    expect(e!.title).toBe('Dinner with friends, then a movie about nothing');
  });

  it('skips recurring and cancelled events', () => {
    const ics = wrap(
      'BEGIN:VEVENT',
      'UID:rec1', 'SUMMARY:Weekly sync', 'DTSTART:20260611T100000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:can1', 'SUMMARY:Cancelled mtg', 'DTSTART:20260611T110000Z', 'STATUS:CANCELLED',
      'END:VEVENT',
    );
    expect(parseICS(ics, OPTS)).toHaveLength(0);
  });

  it('filters events outside the window', () => {
    const ics = wrap(
      'BEGIN:VEVENT', 'UID:old', 'SUMMARY:Past', 'DTSTART:20250101T100000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:far', 'SUMMARY:Far future', 'DTSTART:20281231T100000Z', 'END:VEVENT',
    );
    expect(parseICS(ics, OPTS)).toHaveLength(0);
  });

  it('sorts by date, all-day first, then by start time', () => {
    const ics = wrap(
      'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Late', 'DTSTART:20260611T200000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2', 'SUMMARY:AllDay', 'DTSTART;VALUE=DATE:20260611', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:3', 'SUMMARY:Early', 'DTSTART:20260611T060000Z', 'END:VEVENT',
    );
    expect(parseICS(ics, OPTS).map((e) => e.title)).toEqual(['AllDay', 'Early', 'Late']);
  });

  it('handles params with quoted colons and LF-only files', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:q1',
      'SUMMARY;X-FOO="weird:value":Quoted param event',
      'DTSTART:20260611T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const [e] = parseICS(ics, OPTS);
    expect(e!.title).toBe('Quoted param event');
  });

  it('tolerates garbage input without throwing', () => {
    expect(parseICS('not an ics file at all', OPTS)).toEqual([]);
    expect(parseICS('', OPTS)).toEqual([]);
  });
});
