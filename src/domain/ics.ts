import type { CalendarEvent, DateStr } from '../db/models';
import {
  addDays, addMonths, addYears, dateStrOf, dayOfMonth, toDateStr, weekdayOf,
} from './dates';

/** Minimal iCalendar (RFC 5545) parser for read-only calendar display.
 *  Supports single VEVENTs: timed (UTC, TZID, floating) and all-day
 *  (VALUE=DATE), including multi-day expansion. Recurring events (RRULE)
 *  are expanded for the common patterns Google Calendar produces —
 *  DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY,
 *  BYMONTHDAY and EXDATE. Rules using other frequencies (SECONDLY etc.)
 *  or that fail to parse are skipped. RDATE is not supported. */

interface RawEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtstartTzid: string | null;
  dtstartIsDate: boolean;
  dtend: string | null;
  dtendTzid: string | null;
  dtendIsDate: boolean;
  rrule: string | null;
  exdates: string[];
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
      cur = { uid: '', summary: '', dtstartTzid: null, dtstartIsDate: false, dtend: null, dtendTzid: null, dtendIsDate: false, rrule: null, exdates: [], status: null };
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
        case 'RRULE': cur.rrule = value; break;
        case 'EXDATE':
          for (const part of value.split(',')) {
            const m = /^(\d{4})(\d{2})(\d{2})/.exec(part.trim());
            if (m) cur.exdates!.push(`${m[1]}-${m[2]}-${m[3]}`);
          }
          break;
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

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface ByDay {
  /** null = every such weekday; otherwise 1st/2nd/.../-1 (last) within the period. */
  ordinal: number | null;
  /** JS weekday index, 0=Sunday. */
  day: number;
}

interface RRule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: DateStr | null;
  byDay: ByDay[] | null;
  byMonthDay: number[] | null;
}

function parseByDay(token: string): ByDay | null {
  const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim().toUpperCase());
  if (!m) return null;
  return { ordinal: m[1] ? parseInt(m[1], 10) : null, day: DAY_CODES.indexOf(m[2]!) };
}

/** Parses a subset of RFC 5545 RRULE covering the patterns Google Calendar
 *  and most other hosts actually emit. Returns null for unsupported shapes
 *  (SECONDLY/MINUTELY/HOURLY, BYSETPOS, etc.) so the caller can skip safely. */
function parseRRule(value: string): RRule | null {
  const map = new Map<string, string>();
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1));
  }
  const freq = map.get('FREQ')?.toUpperCase();
  if (!freq || !FREQS.includes(freq as Freq)) return null;
  const interval = Math.max(1, parseInt(map.get('INTERVAL') ?? '1', 10) || 1);
  const count = map.has('COUNT') ? parseInt(map.get('COUNT')!, 10) : null;
  const until = map.has('UNTIL') ? parseDateValue(map.get('UNTIL')!) : null;
  const byDay = map.has('BYDAY')
    ? map.get('BYDAY')!.split(',').map(parseByDay).filter((b): b is ByDay => b !== null)
    : null;
  const byMonthDay = map.has('BYMONTHDAY')
    ? map.get('BYMONTHDAY')!.split(',').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n))
    : null;
  return { freq: freq as Freq, interval, count, until, byDay: byDay?.length ? byDay : null, byMonthDay: byMonthDay?.length ? byMonthDay : null };
}

/** nth (1-based, or negative from the end) weekday `day` within the month
 *  containing `monthAnchor` (any DateStr in that month). Null if out of range. */
function nthWeekdayOfMonth(monthAnchor: DateStr, day: number, ordinal: number): DateStr | null {
  const month = monthAnchor.slice(0, 7);
  const first = `${month}-01` as DateStr;
  if (ordinal > 0) {
    let d = first;
    while (weekdayOf(d) !== day) d = addDays(d, 1);
    const result = addDays(d, (ordinal - 1) * 7);
    return result.slice(0, 7) === month ? result : null;
  }
  let d = addDays(addMonths(first, 1), -1); // last day of month
  while (weekdayOf(d) !== day) d = addDays(d, -1);
  const result = addDays(d, (ordinal + 1) * 7);
  return result.slice(0, 7) === month ? result : null;
}

/** The nth day-of-month (1-based, or negative from the end) within the
 *  month containing `monthAnchor`. Null if the month is too short. */
function nthDayOfMonth(monthAnchor: DateStr, n: number): DateStr | null {
  const month = monthAnchor.slice(0, 7);
  const first = `${month}-01` as DateStr;
  const d = n > 0 ? addDays(first, n - 1) : addDays(addMonths(first, 1), n);
  return d.slice(0, 7) === month ? d : null;
}

function* dailyDates(start: DateStr, interval: number): Generator<DateStr> {
  let d = start;
  for (;;) {
    yield d;
    d = addDays(d, interval);
  }
}

function* weeklyDates(start: DateStr, interval: number, byDay: ByDay[] | null): Generator<DateStr> {
  const days = (byDay?.length ? byDay.map((b) => b.day) : [weekdayOf(start)]).sort((a, b) => a - b);
  let weekStart = addDays(start, -((weekdayOf(start) + 6) % 7)); // Monday of start's week
  for (;;) {
    for (const day of days) yield addDays(weekStart, (day + 6) % 7);
    weekStart = addDays(weekStart, 7 * interval);
  }
}

function* monthlyDates(start: DateStr, interval: number, byDay: ByDay[] | null, byMonthDay: number[] | null): Generator<DateStr> {
  let monthAnchor = start;
  for (;;) {
    const candidates: DateStr[] = [];
    if (byDay?.length) {
      for (const b of byDay) {
        const d = nthWeekdayOfMonth(monthAnchor, b.day, b.ordinal ?? 1);
        if (d) candidates.push(d);
      }
    } else if (byMonthDay?.length) {
      for (const n of byMonthDay) {
        const d = nthDayOfMonth(monthAnchor, n);
        if (d) candidates.push(d);
      }
    } else {
      const d = nthDayOfMonth(monthAnchor, dayOfMonth(start));
      if (d) candidates.push(d);
    }
    candidates.sort();
    yield* candidates;
    monthAnchor = addMonths(monthAnchor, interval);
  }
}

function* yearlyDates(start: DateStr, interval: number): Generator<DateStr> {
  let d = start;
  for (;;) {
    yield d;
    d = addYears(d, interval);
  }
}

function candidateDates(rule: RRule, start: DateStr): Generator<DateStr> {
  switch (rule.freq) {
    case 'DAILY': return dailyDates(start, rule.interval);
    case 'WEEKLY': return weeklyDates(start, rule.interval, rule.byDay);
    case 'MONTHLY': return monthlyDates(start, rule.interval, rule.byDay, rule.byMonthDay);
    case 'YEARLY': return yearlyDates(start, rule.interval);
  }
}

const RECURRENCE_GUARD = 20_000;

/** Expands an RRULE into occurrence dates within [from, to], honoring
 *  COUNT/UNTIL against the full series (not just the visible window) and
 *  dropping EXDATEs. */
function expandRecurrence(
  rule: RRule, start: DateStr, exdates: Set<string>, from: DateStr, to: DateStr,
): DateStr[] {
  const out: DateStr[] = [];
  let occurrences = 0;
  let guard = 0;
  for (const d of candidateDates(rule, start)) {
    if (d < start) continue; // weekly can yield dates before DTSTART in its first week
    if (rule.until && d > rule.until) break;
    occurrences++;
    if (rule.count !== null && occurrences > rule.count) break;
    if (!exdates.has(d) && d >= from && d <= to) out.push(d);
    if (d > to) break;
    guard++;
    if (guard >= RECURRENCE_GUARD) break;
  }
  return out;
}

/** Expands a recurring VEVENT into its individual occurrences within the window. */
function expandRawEvent(raw: RawEvent, rule: RRule, title: string, opts: ParseOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const exdates = new Set(raw.exdates);
  const anchor = parseDateValue(raw.dtstart);
  if (!anchor) return out;

  if (raw.dtstartIsDate) {
    for (const d of expandRecurrence(rule, anchor, exdates, opts.from, opts.to)) {
      out.push({
        id: `${opts.calendarUrl}#${raw.uid || title}#${d}`,
        date: d, start: null, end: null, title, allDay: true,
        calendarUrl: opts.calendarUrl,
      });
    }
    return out;
  }

  const baseStart = parseDateTime(raw.dtstart, raw.dtstartTzid);
  const baseEnd = raw.dtend ? parseDateTime(raw.dtend, raw.dtendTzid) : null;
  const durationMs = baseStart !== null && baseEnd !== null ? baseEnd - baseStart : null;
  const timePart = raw.dtstart.slice(8); // "T130000Z" or "T130000"
  // Widen the naive-date window by a day so timezone shifts across the
  // boundary don't drop a real occurrence; the precise date is re-checked below.
  const widenedFrom = addDays(opts.from, -1);
  const widenedTo = addDays(opts.to, 1);
  for (const d of expandRecurrence(rule, anchor, exdates, widenedFrom, widenedTo)) {
    const value = `${d.replace(/-/g, '')}${timePart}`;
    const start = parseDateTime(value, raw.dtstartTzid);
    if (start === null) continue;
    const date = dateStrOf(start);
    if (date < opts.from || date > opts.to) continue;
    out.push({
      id: `${opts.calendarUrl}#${raw.uid || title}#${value}`,
      date, start, end: durationMs !== null ? start + durationMs : null, title, allDay: false,
      calendarUrl: opts.calendarUrl,
    });
  }
  return out;
}

export function parseICS(src: string, opts: ParseOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const raw of parseRawEvents(src)) {
    if (raw.status === 'CANCELLED') continue;
    const title = raw.summary || '(No title)';

    if (raw.rrule) {
      const rule = parseRRule(raw.rrule);
      if (!rule) continue; // unsupported recurrence shape: skip for safety
      out.push(...expandRawEvent(raw, rule, title, opts));
      continue;
    }

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
