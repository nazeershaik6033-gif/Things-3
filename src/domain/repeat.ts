import type { DateStr, RepeatCfg, RepeatRule } from '../db/models';
import { addDays, daysBetween, fromDateStr, toDateStr, weekdayOf } from './dates';

/** Repeating to-dos, ported from Super Productivity's task-repeat-cfg: daily,
 *  weekly on chosen weekdays, monthly (same date, Nth weekday or last day) and
 *  yearly, every N, optionally until a date, optionally scheduled from the day
 *  you finish rather than on a fixed calendar. Pure date-string math. */

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export function presetRule(preset: RepeatPreset, anchor: DateStr): RepeatRule {
  const base: RepeatRule = {
    freq: 'daily', interval: 1, weekdays: [], monthMode: 'day', anchor, until: null, afterCompletion: false,
  };
  switch (preset) {
    case 'daily': return base;
    case 'weekdays': return { ...base, freq: 'weekly', weekdays: [1, 2, 3, 4, 5] };
    case 'weekly': return { ...base, freq: 'weekly', weekdays: [weekdayOf(anchor)] };
    case 'monthly': return { ...base, freq: 'monthly' };
    case 'yearly': return { ...base, freq: 'yearly' };
  }
}

/** Clamp anything stored or typed into a rule the engine can run. */
export function normalizeRule(r: Partial<RepeatRule> & { anchor: DateStr }): RepeatRule {
  const interval = Math.max(1, Math.min(999, Math.round(Number(r.interval) || 1)));
  const weekdays = [...new Set((r.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return {
    freq: r.freq && ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : 'daily',
    interval,
    weekdays,
    monthMode: r.monthMode === 'nthWeekday' || r.monthMode === 'lastDay' ? r.monthMode : 'day',
    anchor: r.anchor,
    until: r.until && r.until >= r.anchor ? r.until : null,
    afterCompletion: !!r.afterCompletion,
  };
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Monday-free week index: weeks are Sunday-started, counted from the week
 *  that contains `anchor`. */
function weekIndex(anchor: DateStr, d: DateStr): number {
  const anchorSunday = addDays(anchor, -weekdayOf(anchor));
  return Math.floor(daysBetween(anchorSunday, d) / 7);
}

/** Which occurrence of its weekday a date is: 1..5. */
function nthOfMonth(d: DateStr): number {
  return Math.ceil(fromDateStr(d).getDate() / 7);
}

/** The candidate occurrence inside a given month, per the monthly mode. */
function monthlyCandidate(rule: RepeatRule, year: number, month0: number): DateStr {
  const a = fromDateStr(rule.anchor);
  const dim = daysInMonth(year, month0);
  if (rule.monthMode === 'lastDay') return toDateStr(new Date(year, month0, dim));
  if (rule.monthMode === 'nthWeekday') {
    const weekday = a.getDay();
    const nth = nthOfMonth(rule.anchor);
    if (nth >= 5) {
      // "last <weekday>"
      const last = new Date(year, month0, dim);
      const back = (last.getDay() - weekday + 7) % 7;
      return toDateStr(new Date(year, month0, dim - back));
    }
    const first = new Date(year, month0, 1);
    const fwd = (weekday - first.getDay() + 7) % 7;
    return toDateStr(new Date(year, month0, 1 + fwd + (nth - 1) * 7));
  }
  // Same day number, clamped: the 31st repeats on the last day of short months
  return toDateStr(new Date(year, month0, Math.min(a.getDate(), dim)));
}

/** Is `d` an occurrence of a fixed-calendar rule? */
export function isOccurrence(rule: RepeatRule, d: DateStr): boolean {
  if (d < rule.anchor) return false;
  if (rule.until && d > rule.until) return false;
  switch (rule.freq) {
    case 'daily':
      return daysBetween(rule.anchor, d) % rule.interval === 0;
    case 'weekly': {
      const days = rule.weekdays.length ? rule.weekdays : [weekdayOf(rule.anchor)];
      return days.includes(weekdayOf(d)) && weekIndex(rule.anchor, d) % rule.interval === 0;
    }
    case 'monthly': {
      const a = fromDateStr(rule.anchor);
      const x = fromDateStr(d);
      const months = (x.getFullYear() - a.getFullYear()) * 12 + (x.getMonth() - a.getMonth());
      if (months % rule.interval !== 0) return false;
      return monthlyCandidate(rule, x.getFullYear(), x.getMonth()) === d;
    }
    case 'yearly': {
      const a = fromDateStr(rule.anchor);
      const x = fromDateStr(d);
      const years = x.getFullYear() - a.getFullYear();
      if (years % rule.interval !== 0 || x.getMonth() !== a.getMonth()) return false;
      const dim = daysInMonth(x.getFullYear(), x.getMonth());
      return x.getDate() === Math.min(a.getDate(), dim);
    }
  }
}

/** The first occurrence strictly after `after` (fixed calendar), or null when
 *  the rule has run out (`until`). */
export function nextOccurrence(rule: RepeatRule, after: DateStr): DateStr | null {
  const from = after < rule.anchor ? addDays(rule.anchor, -1) : after;
  let result: DateStr | null = null;
  switch (rule.freq) {
    case 'daily': {
      const k = Math.floor(daysBetween(rule.anchor, from) / rule.interval) + 1;
      result = addDays(rule.anchor, Math.max(0, k) * rule.interval);
      break;
    }
    case 'weekly': {
      // At most interval weeks + one week of scanning finds the next hit
      const limit = 7 * (rule.interval + 1);
      for (let i = 1; i <= limit; i++) {
        const d = addDays(from, i);
        if (isOccurrence({ ...rule, until: null }, d)) { result = d; break; }
      }
      break;
    }
    case 'monthly': {
      const a = fromDateStr(rule.anchor);
      const f = fromDateStr(from);
      let months = (f.getFullYear() - a.getFullYear()) * 12 + (f.getMonth() - a.getMonth());
      months = Math.max(0, months - (months % rule.interval));
      for (let i = 0; i < 400 && result === null; i++, months += rule.interval) {
        const y = a.getFullYear() + Math.floor((a.getMonth() + months) / 12);
        const m = (a.getMonth() + months) % 12;
        const c = monthlyCandidate(rule, y, m);
        if (c > from && c >= rule.anchor) result = c;
      }
      break;
    }
    case 'yearly': {
      const a = fromDateStr(rule.anchor);
      const f = fromDateStr(from);
      let years = Math.max(0, f.getFullYear() - a.getFullYear());
      years -= years % rule.interval;
      for (let i = 0; i < 400 && result === null; i++, years += rule.interval) {
        const y = a.getFullYear() + years;
        const c = toDateStr(new Date(y, a.getMonth(), Math.min(a.getDate(), daysInMonth(y, a.getMonth()))));
        if (c > from && c >= rule.anchor) result = c;
      }
      break;
    }
  }
  if (result === null) return null;
  if (rule.until && result > rule.until) return null;
  return result;
}

/** Month/year arithmetic that clamps instead of overflowing: Jan 31 + 1
 *  month is Feb 28, not Mar 3. */
function addMonthsClamped(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  const total = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return toDateStr(new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m))));
}

/** Next date for an after-completion rule: N units after the day you finished. */
export function nextAfterCompletion(rule: RepeatRule, completedOn: DateStr): DateStr | null {
  let d: DateStr;
  switch (rule.freq) {
    case 'daily': d = addDays(completedOn, rule.interval); break;
    case 'weekly': d = addDays(completedOn, rule.interval * 7); break;
    case 'monthly': d = addMonthsClamped(completedOn, rule.interval); break;
    case 'yearly': d = addMonthsClamped(completedOn, rule.interval * 12); break;
  }
  if (rule.until && d > rule.until) return null;
  return d;
}

/** Which occurrence dates to create now. Invariants it keeps:
 *  - no pile-up: of all the occurrences you missed, only the latest is made;
 *  - exactly one occurrence ahead of today exists, so Upcoming shows it;
 *  - after-completion rules only ever get their first instance here — the
 *    rest are made by completing the previous one. */
export function planOccurrences(cfg: Pick<RepeatCfg, 'rule' | 'lastDate' | 'paused'>, today: DateStr): DateStr[] {
  if (cfg.paused) return [];
  const rule = cfg.rule;
  if (rule.afterCompletion) {
    if (cfg.lastDate !== null) return [];
    return rule.until && rule.anchor > rule.until ? [] : [rule.anchor];
  }
  const out: DateStr[] = [];
  const start = cfg.lastDate ?? addDays(rule.anchor, -1);
  if (start < today) {
    let due: DateStr | null = null;
    let cursor = start;
    for (let i = 0; i < 4000; i++) {
      const n = nextOccurrence(rule, cursor);
      if (n === null || n > today) break;
      due = n;
      cursor = n;
    }
    if (due) out.push(due);
  }
  if (cfg.lastDate === null || cfg.lastDate <= today) {
    const ahead = nextOccurrence(rule, out.length ? today : (start > today ? start : today));
    if (ahead && !out.includes(ahead) && (cfg.lastDate === null || ahead > cfg.lastDate)) out.push(ahead);
  }
  return out;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** Human summary: "Every weekday", "Every 2 weeks on Mon, Thu", … */
export function describeRule(rule: RepeatRule): string {
  const n = rule.interval;
  const a = fromDateStr(rule.anchor);
  let text: string;
  const unit = (one: string) => (n === 1 ? `Every ${one}` : `Every ${n} ${one}s`);
  switch (rule.freq) {
    case 'daily':
      text = unit('day');
      break;
    case 'weekly': {
      const days = rule.weekdays.length ? rule.weekdays : [a.getDay()];
      const key = days.join(',');
      if (rule.afterCompletion) text = unit('week');
      else if (n === 1 && key === '1,2,3,4,5') text = 'Every weekday';
      else if (n === 1 && key === '0,6') text = 'Every weekend';
      else if (n === 1 && days.length === 7) text = 'Every day';
      else text = `${unit('week')} on ${days.map((d) => SHORT_DAYS[d]).join(', ')}`;
      break;
    }
    case 'monthly':
      if (rule.afterCompletion) text = unit('month');
      else if (rule.monthMode === 'lastDay') text = `${unit('month')} on the last day`;
      else if (rule.monthMode === 'nthWeekday') {
        const nth = nthOfMonth(rule.anchor);
        const which = nth >= 5 ? 'last' : ordinal(nth);
        text = `${unit('month')} on the ${which} ${SHORT_DAYS[a.getDay()]}`;
      } else text = `${unit('month')} on the ${ordinal(a.getDate())}`;
      break;
    case 'yearly':
      text = rule.afterCompletion ? unit('year') : `${unit('year')} on ${SHORT_MONTHS[a.getMonth()]} ${a.getDate()}`;
      break;
  }
  if (rule.afterCompletion) text += ' after completion';
  if (rule.until) {
    const u = fromDateStr(rule.until);
    text += ` until ${SHORT_MONTHS[u.getMonth()]} ${u.getDate()}`;
  }
  return text;
}

export type OccurrenceState = 'done' | 'skipped' | 'missed' | 'open' | 'upcoming';

/** A repeating to-do's recent record, oldest first: each occurrence by its
 *  day — done, skipped (canceled), missed (still open, day passed), today's
 *  open one, and what's coming. TaskNotes shows this as a completion calendar. */
export function seriesHistory(
  occurrences: { startDate: DateStr | null; status: 'open' | 'completed' | 'canceled'; trashedAt: number | null }[],
  today: DateStr,
  limit = 14,
): { date: DateStr; state: OccurrenceState }[] {
  return occurrences
    .filter((o) => o.startDate && o.trashedAt === null)
    .map((o) => ({
      date: o.startDate!,
      state: (o.status === 'completed' ? 'done'
        : o.status === 'canceled' ? 'skipped'
        : o.startDate! < today ? 'missed'
        : o.startDate === today ? 'open'
        : 'upcoming') as OccurrenceState,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-limit);
}
