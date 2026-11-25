import type { DateStr, RepeatRule } from '../db/models';
import { addDays, addMonths, weekdayOf } from './dates';
import { normalizeRule } from './repeat';

/** Natural-language capture for Quick Entry, after TaskNotes' NLP: plain
 *  words for when, what time, how long and how often.
 *
 *    Gym tue thu 7am 1h            → Tue & Thu every week, 7–8 AM
 *    Call Anna tomorrow at 3       → tomorrow, 3 PM
 *    Review deck fri 9-10:30       → Friday, 9–10:30 AM
 *    Pay rent every month          → repeats monthly
 *    Standup every weekday 9:30am for 15m
 *
 *  It runs after the sigil short syntax (#tag +project @when !due ~est),
 *  which wins where both say something. It is deliberately conservative:
 *  bare numbers stay text, "sat"/"sun" alone stay text (they're words), and
 *  Quick Entry shows what was recognised with a "keep as text" switch. */

export interface NaturalResult {
  title: string;
  date: DateStr | null;
  evening: boolean;
  /** "HH:mm" */
  startTime: string | null;
  /** From a range ("9-10:30") or a duration next to a time ("7am 1h"). */
  durationMin: number | null;
  /** A duration with no time: an estimate. */
  estimateMin: number | null;
  repeat: RepeatRule | null;
  /** Human labels for what was recognised, in order. */
  recognised: string[];
}

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
/** Weekday words that are safe on their own ("sat", "sun" are ordinary words). */
const BARE_DAY_OK = new Set([
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri',
]);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Lower-cased, trailing punctuation off — what the matchers compare. */
function norm(word: string): string {
  return word.toLowerCase().replace(/[.,;!?]+$/, '');
}

function nextWeekday(today: DateStr, wd: number, includeToday = false): DateStr {
  const diff = (wd - weekdayOf(today) + 7) % 7;
  return addDays(today, diff === 0 && !includeToday ? 7 : diff);
}

// ------------------------------------------------------------------ time --

/** "7am", "7:30pm", "14:00", "noon" → minutes; `needsSuffix` refuses bare
 *  "7" (only "at 7" may be bare). */
export function parseClock(s: string, allowBare = false): number | null {
  const w = s.toLowerCase();
  if (w === 'noon' || w === 'midday') return 12 * 60;
  if (w === 'midnight') return 0;
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/.exec(w);
  if (m) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = m[3]!.startsWith('p');
    if (h === 12) h = 0;
    return (pm ? h + 12 : h) * 60 + mi;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(w);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    // "3:30" with no AM/PM: a working-hours guess, like "at 3"
    return (h >= 1 && h <= 7 ? h + 12 : h) * 60 + mi;
  }
  if (allowBare) {
    m = /^(\d{1,2})$/.exec(w);
    if (m) {
      const h = Number(m[1]);
      if (h < 1 || h > 12) return null;
      // "at 3" means the afternoon; "at 9" the morning
      return (h <= 7 ? h + 12 : h === 12 ? 12 : h) * 60;
    }
  }
  return null;
}

/** "9-10:30", "9am-11am", "11-1pm", "14:00-15:30" → [start, end]. */
export function parseRange(s: string): [number, number] | null {
  const m = /^(\d{1,2}(?::\d{2})?)(am|pm|a|p)?[-–](\d{1,2}(?::\d{2})?)(am|pm|a|p)?$/i.exec(s);
  if (!m) return null;
  const [, a, sa, b, sb] = m;
  const clock = (t: string, suffix?: string) => (suffix ? parseClock(t + suffix) : parseClock(t.includes(':') ? t : `${t}:00`));
  let end = clock(b!, sb);
  if (end === null) return null;
  let start: number | null;
  if (sa) start = clock(a!, sa);
  else if (sb) {
    // "11-1pm": the start takes the end's AM/PM unless that puts it after the end
    start = clock(a!, sb);
    if (start !== null && start >= end) start = clock(a!, sb.toLowerCase().startsWith('p') ? 'am' : 'pm');
  } else {
    start = clock(a!);
    if (start !== null && end <= start) end += 12 * 60;
  }
  if (start === null || end <= start || end > 24 * 60) return null;
  return [start, end];
}

/** "1h", "30m", "1h30m", "90min", "1.5h", "2hrs" → minutes. No bare numbers. */
export function parseLength(s: string): number | null {
  const w = s.toLowerCase();
  let m = /^(\d+)h(?:ours?|rs?)?(\d+)m(?:ins?|inutes?)?$/.exec(w);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours)$/.exec(w);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+)(m|min|mins|minute|minutes)$/.exec(w);
  if (m) return Number(m[1]);
  return null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function clockLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

// ---------------------------------------------------------------- parse --

interface Hit { len: number; apply: () => void }

export function parseNatural(input: string, today: DateStr): NaturalResult {
  const words = input.split(/\s+/).filter(Boolean);
  const w = words.map(norm);
  const out: NaturalResult = {
    title: '', date: null, evening: false, startTime: null, durationMin: null, estimateMin: null, repeat: null, recognised: [],
  };
  let start: number | null = null;
  let end: number | null = null;
  let length: number | null = null;
  let repeat: Partial<RepeatRule> | null = null;
  let repeatLabel = '';
  let dateLabel = '';
  const used = new Array(words.length).fill(false);

  /** A run of weekday words joined by "and", "&" or commas, from index i. */
  const dayRun = (i: number, allowShort: boolean): { days: number[]; len: number } => {
    const days: number[] = [];
    let j = i;
    while (j < w.length) {
      const word = w[j]!;
      if (word in DAYS && (allowShort || BARE_DAY_OK.has(word) || days.length > 0)) {
        days.push(DAYS[word]!);
        j++;
        continue;
      }
      if ((word === 'and' || word === '&') && days.length > 0 && j + 1 < w.length && w[j + 1]! in DAYS) {
        j++;
        continue;
      }
      break;
    }
    // A trailing comma on a day ("mon, wed") is fine: norm() dropped it
    return { days, len: j - i };
  };

  const matchers: ((i: number) => Hit | null)[] = [
    // every [other|N] day/week/month/year · every weekday/weekend · every mon and wed
    (i) => {
      if (w[i] !== 'every') return null;
      let j = i + 1;
      let interval = 1;
      if (w[j] === 'other') { interval = 2; j++; }
      else if (/^\d+$/.test(w[j] ?? '')) { interval = Number(w[j]); j++; }
      const unit = (w[j] ?? '').replace(/s$/, '');
      const freq = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : unit === 'month' ? 'monthly' : unit === 'year' ? 'yearly' : null;
      if (freq) {
        return { len: j + 1 - i, apply: () => {
          repeat = { freq, interval, weekdays: [] };
          repeatLabel = interval === 1 ? `every ${unit}` : `every ${interval} ${unit}s`;
        } };
      }
      if (w[j] === 'weekday' || w[j] === 'weekdays') {
        return { len: j + 1 - i, apply: () => { repeat = { freq: 'weekly', interval, weekdays: [1, 2, 3, 4, 5] }; repeatLabel = 'every weekday'; } };
      }
      if (w[j] === 'weekend' || w[j] === 'weekends') {
        return { len: j + 1 - i, apply: () => { repeat = { freq: 'weekly', interval, weekdays: [0, 6] }; repeatLabel = 'every weekend'; } };
      }
      const run = dayRun(j, true);
      if (run.days.length > 0) {
        return { len: j + run.len - i, apply: () => {
          repeat = { freq: 'weekly', interval, weekdays: run.days };
          repeatLabel = `every ${run.days.map((d) => DAY_NAMES[d]).join(', ')}`;
        } };
      }
      return null;
    },
    // daily · weekly · monthly · yearly · weekdays · everyday
    (i) => {
      const k = w[i]!;
      const map: Record<string, [RepeatRule['freq'], number[], string]> = {
        daily: ['daily', [], 'every day'], everyday: ['daily', [], 'every day'],
        weekly: ['weekly', [], 'every week'], monthly: ['monthly', [], 'every month'],
        yearly: ['yearly', [], 'every year'], annually: ['yearly', [], 'every year'],
        weekdays: ['weekly', [1, 2, 3, 4, 5], 'every weekday'],
      };
      const hit = map[k];
      if (!hit) return null;
      return { len: 1, apply: () => { repeat = { freq: hit[0], interval: 1, weekdays: hit[1] }; repeatLabel = hit[2]; } };
    },
    // two or more weekdays in a row: "tue thu", "mon, wed and fri" → weekly
    (i) => {
      const run = dayRun(i, true);
      if (run.days.length < 2) return null;
      return { len: run.len, apply: () => {
        repeat = { freq: 'weekly', interval: 1, weekdays: run.days };
        repeatLabel = `every ${run.days.map((d) => DAY_NAMES[d]).join(', ')}`;
      } };
    },
    // today · tonight · tomorrow · this evening
    (i) => {
      const k = w[i]!;
      if (k === 'today') return { len: 1, apply: () => { out.date = today; dateLabel = 'Today'; } };
      if (k === 'tonight') return { len: 1, apply: () => { out.date = today; out.evening = true; dateLabel = 'Tonight'; } };
      if (k === 'tomorrow' || k === 'tmr' || k === 'tmrw') return { len: 1, apply: () => { out.date = addDays(today, 1); dateLabel = 'Tomorrow'; } };
      if (k === 'this' && w[i + 1] === 'evening') return { len: 2, apply: () => { out.date = today; out.evening = true; dateLabel = 'Tonight'; } };
      return null;
    },
    // next week · next/on/this <day> · <day>
    (i) => {
      const k = w[i]!;
      if (k === 'next' && w[i + 1] === 'week') {
        return { len: 2, apply: () => { out.date = nextWeekday(today, 1); dateLabel = 'Next week'; } };
      }
      const prefixed = (k === 'next' || k === 'on' || k === 'this') && (w[i + 1] ?? '') in DAYS;
      const word = prefixed ? w[i + 1]! : k;
      if (!(word in DAYS) || (!prefixed && !BARE_DAY_OK.has(word))) return null;
      const wd = DAYS[word]!;
      return { len: prefixed ? 2 : 1, apply: () => { out.date = nextWeekday(today, wd); dateLabel = DAY_NAMES[wd]!; } };
    },
    // in 3 days · in 2 weeks · in a month
    (i) => {
      if (w[i] !== 'in') return null;
      const n = w[i + 1] === 'a' || w[i + 1] === 'an' ? 1 : /^\d+$/.test(w[i + 1] ?? '') ? Number(w[i + 1]) : null;
      const unit = (w[i + 2] ?? '').replace(/s$/, '');
      if (n === null || !['day', 'week', 'month'].includes(unit)) return null;
      return { len: 3, apply: () => {
        out.date = unit === 'month' ? addMonths(today, n) : addDays(today, n * (unit === 'week' ? 7 : 1));
        dateLabel = `In ${n} ${unit}${n === 1 ? '' : 's'}`;
      } };
    },
    // dec 24 · 24 dec · december 24th · 24th of december
    (i) => {
      const a = w[i]!;
      const b = w[i + 1] ?? '';
      const c = w[i + 2] ?? '';
      const dayNum = (s: string) => (/^\d{1,2}(st|nd|rd|th)?$/.test(s) ? parseInt(s, 10) : null);
      let month: number | null = null;
      let day: number | null = null;
      let len = 0;
      if (a in MONTHS && dayNum(b)) { month = MONTHS[a]!; day = dayNum(b); len = 2; }
      else if (dayNum(a) && b === 'of' && c in MONTHS) { day = dayNum(a); month = MONTHS[c]!; len = 3; }
      else if (dayNum(a) && b in MONTHS) { day = dayNum(a); month = MONTHS[b]!; len = 2; }
      if (!month || !day || day > 31) return null;
      const y = Number(today.slice(0, 4));
      let date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (Number(date.slice(8)) !== day || date < today) date = `${y + 1}${date.slice(4)}`;
      const m = month;
      const d = day;
      return { len, apply: () => { out.date = date; dateLabel = `${MONTH_NAMES[m - 1]} ${d}`; } };
    },
    // 9-10:30 · from 9 to 10:30am · 9am to 11am
    (i) => {
      const lead = w[i] === 'from' ? 1 : 0;
      const r = parseRange(w[i + lead] ?? '');
      if (r) return { len: 1 + lead, apply: () => { [start, end] = r; } };
      if (w[i + lead + 1] === 'to' || w[i + lead + 1] === '-' || w[i + lead + 1] === '–') {
        const joined = parseRange(`${w[i + lead]}-${w[i + lead + 2] ?? ''}`);
        if (joined) return { len: 3 + lead, apply: () => { [start, end] = joined; } };
      }
      return null;
    },
    // at 3 · at 3:30pm · 7am · 7 am · 14:00 · noon
    (i) => {
      if (w[i] === 'at') {
        const two = w[i + 2] === 'am' || w[i + 2] === 'pm' ? parseClock(`${w[i + 1]}${w[i + 2]}`) : null;
        if (two !== null) return { len: 3, apply: () => { start = two; } };
        const t = parseClock(w[i + 1] ?? '', true);
        if (t !== null) return { len: 2, apply: () => { start = t; } };
        return null;
      }
      if ((w[i + 1] === 'am' || w[i + 1] === 'pm') && /^\d{1,2}(:\d{2})?$/.test(w[i]!)) {
        const t = parseClock(`${w[i]}${w[i + 1]}`);
        if (t !== null) return { len: 2, apply: () => { start = t; } };
      }
      const t = parseClock(w[i]!);
      return t !== null ? { len: 1, apply: () => { start = t; } } : null;
    },
    // 1h · for 45m · 45 min · 2 hours
    (i) => {
      const lead = w[i] === 'for' ? 1 : 0;
      const one = parseLength(w[i + lead] ?? '');
      if (one) return { len: 1 + lead, apply: () => { length = one; } };
      if (/^\d+(\.\d+)?$/.test(w[i + lead] ?? '')) {
        const two = parseLength(`${w[i + lead]}${w[i + lead + 1] ?? ''}`);
        if (two) return { len: 2 + lead, apply: () => { length = two; } };
      }
      return null;
    },
  ];

  for (let i = 0; i < w.length; i++) {
    if (used[i]) continue;
    for (const match of matchers) {
      const hit = match(i);
      if (!hit) continue;
      hit.apply();
      for (let k = i; k < i + hit.len; k++) used[k] = true;
      i += hit.len - 1;
      break;
    }
  }

  out.title = words.filter((_, i) => !used[i]).join(' ').replace(/\s+[-–,]+$/, '').trim();

  if (start !== null) {
    out.startTime = hhmm(start);
    if (end !== null) out.durationMin = (end as number) - (start as number);
    else if (length !== null) out.durationMin = length;
  } else if (length !== null) {
    out.estimateMin = length;
  }

  if (repeat) {
    const r = repeat as Partial<RepeatRule>;
    // First occurrence: the date given, else the first matching day from today
    let anchor = out.date ?? today;
    if (r.freq === 'weekly' && r.weekdays && r.weekdays.length > 0 && !r.weekdays.includes(weekdayOf(anchor))) {
      const days = r.weekdays;
      anchor = days.map((d) => nextWeekday(anchor, d, true)).sort()[0]!;
    }
    if (r.freq === 'weekly' && (!r.weekdays || r.weekdays.length === 0)) r.weekdays = [weekdayOf(anchor)];
    out.repeat = normalizeRule({ ...r, anchor });
    out.date = anchor;
  }

  if (dateLabel && !repeat) out.recognised.push(dateLabel);
  if (start !== null) {
    const s = start as number;
    out.recognised.push(out.durationMin ? `${clockLabel(s)} – ${clockLabel(s + out.durationMin)}` : clockLabel(s));
  }
  if (repeatLabel) out.recognised.push(`↻ ${repeatLabel}`);
  if (out.estimateMin) out.recognised.push(`⌛ ${out.estimateMin}m`);
  if (start !== null && out.date === null) out.date = today;
  return out;
}
