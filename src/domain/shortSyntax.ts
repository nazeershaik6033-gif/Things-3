import type { DateStr, Project } from '../db/models';
import { addDays, isValidDateStr, weekdayOf } from './dates';
import { parseDuration } from './timeTracking';

/** Short syntax for Quick Entry, ported from Super Productivity's add-task
 *  bar: type the whole to-do in one line and the tokens become fields.
 *
 *    Call Anna #work +Clarity @tomorrow ~30m !fri
 *
 *  #tag       tag (created if new; must start with a letter, so "#2" stays text)
 *  +project   project, matched by prefix ignoring case, spaces and punctuation
 *  @when      today · tonight · tomorrow · someday · anytime · mon…sun · 3d · 2w · YYYY-MM-DD
 *  !deadline  same date words as @
 *  ~duration  time estimate: 30m · 1h · 1h30m · 1.5h · 90
 *
 *  Tokens only count at the start of a word, so "a@b.com" and "C#" are left
 *  alone, and a token that doesn't resolve stays in the title. */

export type ParsedWhen =
  | { type: 'today' }
  | { type: 'evening' }
  | { type: 'date'; date: DateStr }
  | { type: 'someday' }
  | { type: 'anytime' };

export interface ParsedEntry {
  title: string;
  tagTitles: string[];
  projectId: string | null;
  when: ParsedWhen | null;
  deadline: DateStr | null;
  estimateMin: number | null;
}

const DAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** A date word → date. Weekdays mean the next one strictly after today
 *  ("@mon" on a Monday is next week), as in Things. */
export function parseDateWord(word: string, today: DateStr): DateStr | 'tonight' | 'someday' | 'anytime' | null {
  const w = word.toLowerCase();
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tonight' || w === 'evening' || w === 'eve') return 'tonight';
  if (w === 'tomorrow' || w === 'tmr' || w === 'tom') return addDays(today, 1);
  if (w === 'someday') return 'someday';
  if (w === 'anytime') return 'anytime';
  if (w === 'nextweek') return addDays(today, 7 - ((weekdayOf(today) + 6) % 7)); // next Monday
  if (w in DAY_WORDS) {
    const target = DAY_WORDS[w]!;
    const diff = ((target - weekdayOf(today) + 7) % 7) || 7;
    return addDays(today, diff);
  }
  let m: RegExpMatchArray | null;
  if ((m = w.match(/^(\d{1,3})([dw])$/))) return addDays(today, Number(m[1]) * (m[2] === 'w' ? 7 : 1));
  if (isValidDateStr(w)) return w;
  return null;
}

export function matchProject(token: string, projects: Project[]): Project | null {
  const q = normalize(token);
  if (!q) return null;
  const live = projects.filter((p) => p.trashedAt === null && p.status === 'open');
  return (
    live.find((p) => normalize(p.title) === q) ??
    live.find((p) => normalize(p.title).startsWith(q)) ??
    null
  );
}

export function parseShortSyntax(input: string, projects: Project[], today: DateStr): ParsedEntry {
  const out: ParsedEntry = {
    title: '', tagTitles: [], projectId: null, when: null, deadline: null, estimateMin: null,
  };
  const kept: string[] = [];
  for (const word of input.split(/\s+/).filter(Boolean)) {
    const sigil = word[0];
    const body = word.slice(1);
    let consumed = false;
    if (sigil === '#' && /^\p{L}[\p{L}\p{N}_-]*$/u.test(body)) {
      if (!out.tagTitles.some((t) => t.toLowerCase() === body.toLowerCase())) out.tagTitles.push(body);
      consumed = true;
    } else if (sigil === '+' && body) {
      const p = matchProject(body, projects);
      if (p) { out.projectId = p.id; consumed = true; }
    } else if (sigil === '@' && body) {
      const d = parseDateWord(body, today);
      if (d === 'tonight') out.when = { type: 'evening' };
      else if (d === 'someday') out.when = { type: 'someday' };
      else if (d === 'anytime') out.when = { type: 'anytime' };
      else if (d === today) out.when = { type: 'today' };
      else if (d) out.when = { type: 'date', date: d };
      consumed = d !== null;
    } else if (sigil === '!' && body) {
      const d = parseDateWord(body, today);
      if (d && d !== 'tonight' && d !== 'someday' && d !== 'anytime') { out.deadline = d; consumed = true; }
      else if (d === 'tonight') { out.deadline = today; consumed = true; }
    } else if (sigil === '~' && body) {
      const min = parseDuration(body);
      if (min) { out.estimateMin = min; consumed = true; }
    }
    if (!consumed) kept.push(word);
  }
  out.title = kept.join(' ');
  return out;
}

/** True when the text contains anything the parser would act on — lets the
 *  UI show a hint only when it's relevant. */
export function hasShortSyntax(input: string): boolean {
  return /(^|\s)(#\p{L}|\+\S|@\S|!\S|~\d)/u.test(input);
}
