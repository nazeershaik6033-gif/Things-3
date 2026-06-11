import type { CalendarEvent, DateStr } from '../db/models';
import { addDays, dateStrOf, toDateStr } from './dates';

/** Minimal iCalendar (RFC 5545) parser for read-only calendar display.
 *  Supports single VEVENTs: timed (UTC, TZID, floating) and all-day
 *  (VALUE=DATE), including multi-day expansion. Recurring events (RRULE)
 *  are skipped in v1 — documented limitation. */

interface RawEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtstartTzid: string | null;
  dtstartIsDate: boolean;
  dtend: string | null;
  dtendTzid: string | null;
  dtendIsDate: boolean;
  hasRrule: boolean;
  status: string | null;
}

/** Unfold continuation lines (CRLF followed by space/tab) per RFC 5545. */
function unfold(src: string): string[] {
  return src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** "NAME;PARAM=x;PARAM2=y:value" → { name, params, value } */
function parseLine(line: string): { name: string; params: Map<string, string>; value: string } | null {
  const colon = findUnquotedColon(line);
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0]!.toUpperCase();
  const params = new Map<string, string>();
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i]!.indexOf('=');
    if (eq > 0) {
      params.set(parts[i]!.slice(0, eq).toUpperCase(), parts[i]!.slice(eq + 1).replace(/^"|"$/g, ''));
    }
  }
  return { name, params, value };
}

function findUnquotedColon(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) return i;
  }
  return -1;
}

function parseRawEvents(src: string): RawEvent[] {
  const events: RawEvent[] = [];
  let cur: Partial<RawEvent> | null = null;
  for (const line of unfold(src)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      cur = { uid: '', summary: '', dtstartTzid: null, dtstartIsDate: false, dtend: null, dtendTzid: null, dtendIsDate: false, hasRrule: false, status: null };
    } else if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (cur && cur.dtstart) events.push(cur as RawEvent);
      cur = null;
    } else if (cur) {
      switch (name) {
        case 'UID': cur.uid = value; break;
        case 'SUMMARY': cur.summary = unescapeText(value); break;
        case 'DTSTART':
          cur.dtstart = value;
          cur.dtstartTzid = params.get('TZID') ?? null;
          cur.dtstartIsDate = params.get('VALUE') === 'DATE' || /^\d{8}$/.test(value);
          break;
        case 'DTEND':
          cur.dtend = value;
          cur.dtendTzid = params.get('TZID') ?? null;
          cur.dtendIsDate = params.get('VALUE') === 'DATE' || /^\d{8}$/.test(value);
          break;
        case 'RRULE': case 'RDATE': cur.hasRrule = true; break;
        case 'STATUS': cur.status = value.toUpperCase(); break;
      }
    }
  }
  return events;
}

/** Epoch ms for a wall-clock time in an IANA timezone (two-pass correction). */
export function zonedEpoch(
  y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string,
): number {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  let epoch = utcGuess;
  for (let pass = 0; pass < 2; pass++) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const parts = new Map(f.formatToParts(epoch).map((p) => [p.type, p.value]));
    const shown = Date.UTC(
      Number(parts.get('year')), Number(parts.get('month')) - 1, Number(parts.get('day')),
      Number(parts.get('hour')) % 24, Number(parts.get('minute')), Number(parts.get('second')),
    );
    epoch += utcGuess - shown;
    if (shown === utcGuess) break;
  }
  return epoch;
}

/** "20260611T120000Z" | "20260611T120000" (+ optional TZID) → epoch ms. */
function parseDateTime(value: string, tzid: string | null): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
  if (tzid) {
    try {
      return zonedEpoch(+y!, +mo!, +d!, +h!, +mi!, +s!, tzid);
    } catch {
      // Unknown TZID: fall through to floating-time interpretation
    }
  }
  // Floating time = local time
  return new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!).getTime();
}

/** "20260611" → local DateStr */
function parseDateValue(value: string): DateStr | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface ParseOptions {
  calendarUrl: string;
  /** Only emit events whose date falls inside [from, to]. */
  from: DateStr;
  to: DateStr;
}

export function parseICS(src: string, opts: ParseOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const raw of parseRawEvents(src)) {
    if (raw.hasRrule) continue; // recurring: unsupported in v1
    if (raw.status === 'CANCELLED') continue;
    const title = raw.summary || '(No title)';
    if (raw.dtstartIsDate) {
      const start = parseDateValue(raw.dtstart);
      if (!start) continue;
      // DTEND for all-day events is EXCLUSIVE per RFC 5545
      const endExclusive = raw.dtend ? parseDateValue(raw.dtend) : null;
      let d = start;
      let guard = 0;
      do {
        if (d >= opts.from && d <= opts.to) {
          out.push({
            id: `${opts.calendarUrl}#${raw.uid || title}#${d}`,
            date: d, start: null, end: null, title, allDay: true,
            calendarUrl: opts.calendarUrl,
          });
        }
        d = addDays(d, 1);
        guard++;
      } while (endExclusive !== null && d < endExclusive && guard < 62);
    } else {
      const start = parseDateTime(raw.dtstart, raw.dtstartTzid);
      if (start === null) continue;
      const end = raw.dtend ? parseDateTime(raw.dtend, raw.dtendTzid) : null;
      const date = dateStrOf(start);
      if (date < opts.from || date > opts.to) continue;
      out.push({
        id: `${opts.calendarUrl}#${raw.uid || title}#${raw.dtstart}`,
        date, start, end, title, allDay: false,
        calendarUrl: opts.calendarUrl,
      });
    }
  }
  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
    : a.allDay !== b.allDay ? (a.allDay ? -1 : 1)
    : (a.start ?? 0) - (b.start ?? 0),
  );
  return out;
}

/** Default display window for calendar subscriptions. */
export function defaultWindow(now: Date): { from: DateStr; to: DateStr } {
  const today = toDateStr(now);
  return { from: today, to: addDays(today, 90) };
}
