import type { CalendarEvent, DateStr } from '../db/models';
import { addDays, dateStrOf, fromDateStr, toDateStr } from './dates';

/** iCalendar (RFC 5545) parser for read-only calendar display.
 *  Supports single VEVENTs and recurring events (RRULE) for
 *  DAILY / WEEKLY / MONTHLY / YEARLY frequencies within the display window. */

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
      cur = { uid: '', summary: '', dtstartTzid: null, dtstartIsDate: false, dtend: null, dtendTzid: null, dtendIsDate: false, rrule: null, status: null };
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

// ------------------------------------------------------------------ RRULE --

const DOW_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  untilDate: DateStr | null;
  count: number | null;
  byDay: string[];      // e.g. ['MO', 'WE', 'FR']
  byMonthDay: number[]; // e.g. [15]
}

function parseRRule(value: string): RRule | null {
  const p = new Map<string, string>();
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) p.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1));
  }
  const freq = p.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;

  let untilDate: DateStr | null = null;
  const until = p.get('UNTIL');
  if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    if (m) untilDate = `${m[1]}-${m[2]}-${m[3]}`;
  }

  return {
    freq,
    interval: Math.max(1, parseInt(p.get('INTERVAL') ?? '1', 10) || 1),
    untilDate,
    count: p.has('COUNT') ? (parseInt(p.get('COUNT')!, 10) || null) : null,
    byDay: (p.get('BYDAY') ?? '').split(',').filter(Boolean).map((d) => d.toUpperCase().replace(/^[-+]?\d+/, '')),
    byMonthDay: (p.get('BYMONTHDAY') ?? '').split(',').filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 31),
  };
}

/** Expand an RRULE into occurrence dates within [opts.from, opts.to].
 *  startDateStr is the DTSTART calendar date (local YYYY-MM-DD). */
function expandRRuleDates(rule: RRule, startDateStr: DateStr, opts: { from: DateStr; to: DateStr }): DateStr[] {
  const results: DateStr[] = [];
  const maxOccurrences = Math.min(rule.count ?? 10_000, 10_000);
  let occurrenceCount = 0;

  if (rule.freq === 'DAILY') {
    let cur = fromDateStr(startDateStr);
    while (occurrenceCount < maxOccurrences) {
      const ds = toDateStr(cur) as DateStr;
      if (rule.untilDate && ds > rule.untilDate) break;
      if (ds > opts.to) break;
      if (ds >= opts.from) results.push(ds);
      occurrenceCount++;
      cur.setDate(cur.getDate() + rule.interval);
    }
  } else if (rule.freq === 'WEEKLY') {
    const startD = fromDateStr(startDateStr);
    const byday = rule.byDay.length > 0
      ? rule.byDay.map((d) => DOW_MAP[d]).filter((n): n is number => n !== undefined)
      : [startD.getDay()];

    // Align to the Sunday of the start-date's week
    const weekSun = new Date(startD);
    weekSun.setDate(weekSun.getDate() - weekSun.getDay());

    while (occurrenceCount < maxOccurrences) {
      const weekDates = byday
        .map((dow) => {
          const d = new Date(weekSun);
          d.setDate(d.getDate() + dow);
          return toDateStr(d) as DateStr;
        })
        .filter((ds) => ds >= startDateStr)
        .sort();

      let pastWindow = false;
      for (const ds of weekDates) {
        if (rule.untilDate && ds > rule.untilDate) { pastWindow = true; break; }
        if (ds > opts.to) { pastWindow = true; break; }
        if (ds >= opts.from) results.push(ds);
        occurrenceCount++;
        if (occurrenceCount >= maxOccurrences) { pastWindow = true; break; }
      }
      if (pastWindow) break;
      weekSun.setDate(weekSun.getDate() + 7 * rule.interval);
      if ((toDateStr(weekSun) as DateStr) > opts.to) break;
    }
  } else if (rule.freq === 'MONTHLY') {
    let cur = fromDateStr(startDateStr);
    const startDay = cur.getDate();

    while (occurrenceCount < maxOccurrences) {
      const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : [startDay];
      const monthDates = days
        .map((day) => {
          const d = new Date(cur.getFullYear(), cur.getMonth(), day);
          return isNaN(d.getTime()) ? null : (toDateStr(d) as DateStr);
        })
        .filter((ds): ds is DateStr => ds !== null && ds >= startDateStr)
        .sort();

      let pastWindow = false;
      for (const ds of monthDates) {
        if (rule.untilDate && ds > rule.untilDate) { pastWindow = true; break; }
        if (ds > opts.to) { pastWindow = true; break; }
        if (ds >= opts.from) results.push(ds);
        occurrenceCount++;
        if (occurrenceCount >= maxOccurrences) { pastWindow = true; break; }
      }
      if (pastWindow) break;
      cur.setMonth(cur.getMonth() + rule.interval);
      if ((toDateStr(cur) as DateStr) > opts.to) break;
    }
  } else if (rule.freq === 'YEARLY') {
    let cur = fromDateStr(startDateStr);
    while (occurrenceCount < maxOccurrences) {
      const ds = toDateStr(cur) as DateStr;
      if (rule.untilDate && ds > rule.untilDate) break;
      if (ds > opts.to) break;
      if (ds >= opts.from) results.push(ds);
      occurrenceCount++;
      cur.setFullYear(cur.getFullYear() + rule.interval);
    }
  }

  return results;
}

// ----------------------------------------------------------------- parse ---

export interface ParseOptions {
  calendarUrl: string;
  /** Only emit events whose date falls inside [from, to]. */
  from: DateStr;
  to: DateStr;
}

export function parseICS(src: string, opts: ParseOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const raw of parseRawEvents(src)) {
    if (raw.status === 'CANCELLED') continue;
    const title = raw.summary || '(No title)';

    if (raw.rrule) {
      // Recurring event: expand within the display window
      const rule = parseRRule(raw.rrule);
      if (!rule) continue;

      if (raw.dtstartIsDate) {
        const startDateStr = parseDateValue(raw.dtstart);
        if (!startDateStr) continue;
        // Duration for all-day recurring events
        const durationDays = (() => {
          if (!raw.dtend) return 1;
          const endStr = parseDateValue(raw.dtend);
          if (!endStr) return 1;
          const ms = fromDateStr(endStr).getTime() - fromDateStr(startDateStr).getTime();
          return Math.max(1, Math.round(ms / 86_400_000));
        })();

        for (const occDate of expandRRuleDates(rule, startDateStr, opts)) {
          for (let i = 0; i < durationDays; i++) {
            const d = i === 0 ? occDate : addDays(occDate, i);
            if (d >= opts.from && d <= opts.to) {
              out.push({
                id: `${opts.calendarUrl}#${raw.uid || title}#${occDate}+${i}`,
                date: d, start: null, end: null, title, allDay: true,
                calendarUrl: opts.calendarUrl,
              });
            }
          }
        }
      } else {
        // Timed recurring event
        const startMs = parseDateTime(raw.dtstart, raw.dtstartTzid);
        if (startMs === null) continue;
        const endMs = raw.dtend ? parseDateTime(raw.dtend, raw.dtendTzid) : null;
        const durationMs = endMs !== null ? endMs - startMs : 0;
        const startDateStr = dateStrOf(startMs);
        // Time-of-day offset from midnight (local)
        const startLocal = new Date(startMs);
        const midnightMs = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate()).getTime();
        const timeOffset = startMs - midnightMs;

        for (const occDate of expandRRuleDates(rule, startDateStr, opts)) {
          const occMidnight = fromDateStr(occDate).getTime();
          const occStart = occMidnight + timeOffset;
          const occEnd = durationMs > 0 ? occStart + durationMs : null;
          out.push({
            id: `${opts.calendarUrl}#${raw.uid || title}#${occDate}`,
            date: occDate, start: occStart, end: occEnd, title, allDay: false,
            calendarUrl: opts.calendarUrl,
          });
        }
      }
      continue;
    }

    // Non-recurring events (original handling)
    if (raw.dtstartIsDate) {
      const start = parseDateValue(raw.dtstart);
      if (!start) continue;
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

/** Default display window for calendar subscriptions: 60 days back so the
 *  month calendar can show recent past events, 180 forward for browsing. */
export function defaultWindow(now: Date): { from: DateStr; to: DateStr } {
  const today = toDateStr(now);
  return { from: addDays(today, -60), to: addDays(today, 180) };
}

/** Escape text for ICS property values (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Build a downloadable single-event ICS with a display alarm at the event
 *  time. Opening it on iOS offers "Add to Calendar", which then fires a
 *  real notification — the closest a web app can get to system reminders. */
export function buildReminderIcs(opts: {
  title: string;
  notes?: string;
  date: DateStr; // local date
  time: string; // "HH:mm" local
}): string {
  const compact = opts.date.replace(/-/g, '') + 'T' + opts.time.replace(':', '') + '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid = `reminder-${compact}-${Math.random().toString(36).slice(2, 10)}@clarity`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clarity//Reminder//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${compact}`, // floating local time
    `SUMMARY:${escapeText(opts.title || 'Reminder')}`,
    ...(opts.notes ? [`DESCRIPTION:${escapeText(opts.notes)}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(opts.title || 'Reminder')}`,
    'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
