import type { DateStr } from '../db/models';
import { addDays } from './dates';

/** Build a Google Calendar "event template" URL — opens Google Calendar
 *  (app or web) pre-filled; the user taps Save there. This is the only
 *  write path Google allows without OAuth; the secret iCal feed we read
 *  events from is read-only by design. */
export function googleCalendarEventUrl(opts: {
  title?: string;
  date: DateStr;
  /** "HH:mm" local; omitted = all-day */
  time?: string | null;
  durationMin?: number;
  details?: string;
}): string {
  const compact = (d: DateStr) => d.replace(/-/g, '');
  let dates: string;
  if (opts.time) {
    const [h, m] = opts.time.split(':').map(Number);
    const startMin = h! * 60 + m!;
    const endMin = startMin + (opts.durationMin ?? 60);
    const endDate = endMin >= 24 * 60 ? addDays(opts.date, 1) : opts.date;
    const wrapped = endMin % (24 * 60);
    const fmt = (mins: number) =>
      `${String(Math.floor(mins / 60)).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}00`;
    dates = `${compact(opts.date)}T${fmt(startMin)}/${compact(endDate)}T${fmt(wrapped)}`;
  } else {
    // All-day: end date is exclusive
    dates = `${compact(opts.date)}/${compact(addDays(opts.date, 1))}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', dates });
  if (opts.title) params.set('text', opts.title);
  if (opts.details) params.set('details', opts.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
