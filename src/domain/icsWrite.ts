import { routineItems, type FocusProfile } from './focus';

/** Minimal RFC 5545 writer for alarms-as-notifications: iOS Calendar fires
 *  VALARMs natively, even while Clarity (a web app) is closed. Times are
 *  "floating" local times (no TZID/Z) so a daily routine stays at 07:30
 *  wherever you are. */

const CRLF = '\r\n';
const enc = new TextEncoder();

export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold to ≤75 octets per line without splitting a UTF-8 code point. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join(`${CRLF} `);
}

/** "YYYY-MM-DD" + "HH:mm" → floating "YYYYMMDDTHHmm00". */
export function floatingStamp(date: string, hhmm: string): string {
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** Local Date → floating stamp. */
export function floatingFromDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

/** DTSTAMP must be UTC: "YYYYMMDDTHHmmssZ". */
export function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function triggerFor(offsetMin: number): string {
  if (offsetMin === 0) return 'PT0S';
  const sign = offsetMin < 0 ? '-' : '';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
}

export interface IcsEvent {
  uid: string;
  start: string; // floating stamp
  end: string;
  summary: string;
  description: string;
  rrule?: string;
  /** Shown as busy — a protected block (sprints). */
  busy?: boolean;
  alarms: { offsetMin: number; text: string }[];
}

export function buildCalendar(name: string, events: IcsEvent[], stamp = '20260101T000000Z'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clarity//Focus Framework//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${e.start}`,
      `DTEND:${e.end}`,
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`,
    );
    for (const a of e.alarms) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(a.text)}`,
        `TRIGGER:${triggerFor(a.offsetMin)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

function endOf(date: string, hhmm: string, durationMin: number): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(`${date}T00:00:00`);
  d.setHours(h, m + durationMin, 0, 0);
  return floatingFromDate(d);
}

/** The daily routine as a recurring calendar. Deterministic (fixed start
 *  date + stamp) so the pre-built static files are reproducible. */
export function routineCalendar(p: FocusProfile, startDate = '2026-01-01'): string {
  const events: IcsEvent[] = routineItems(p).map((item) => ({
    uid: `clarity-routine-${item.id}@clarity.focus`,
    start: floatingStamp(startDate, item.time),
    end: endOf(startDate, item.time, item.durationMin),
    summary: item.title,
    description: item.notes,
    rrule: 'FREQ=DAILY',
    busy: item.id.startsWith('sprint'),
    alarms: item.alarms.map((offsetMin) => ({
      offsetMin,
      text:
        offsetMin < 0 ? `${item.title} in ${-offsetMin} min — phone away, close tabs.`
        : offsetMin > 0 ? 'Sprint over: record what you did, note the next action, step away.'
        : item.title,
    })),
  }));
  return buildCalendar('Focus Routine', events);
}

/** A single scheduled sprint with a prep alert and an end-of-sprint alert. */
export function sprintCalendar(opts: {
  id: string;
  start: Date;
  durationMin: number;
  title: string;
  nextAction: string;
}): string {
  const end = new Date(opts.start.getTime() + opts.durationMin * 60_000);
  const summary = `🎯 Focus Sprint: ${opts.title || 'Deep work'}`;
  return buildCalendar('Focus Sprint', [{
    uid: `clarity-sprint-${opts.id}@clarity.focus`,
    start: floatingFromDate(opts.start),
    end: floatingFromDate(end),
    summary,
    description:
      (opts.nextAction ? `Next action: ${opts.nextAction}\n` : '') +
      'Phone out of reach · notifications silenced · tabs closed · visible timer.',
    busy: true,
    alarms: [
      { offsetMin: -5, text: `${summary} starts in 5 min — prepare your environment.` },
      { offsetMin: opts.durationMin, text: 'Sprint over: record what you did, note the next action, step away.' },
    ],
  }], utcStamp(new Date()));
}
