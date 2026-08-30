import type { CalendarEvent, DailyTarget, DateStr, Task } from '../db/models';
import { nextEvent } from './calendarMonth';
import { isOverdue } from './smartLists';
import { resolveAll, targetFor } from './target';

/** The widget deck at the top of Home is expensive real estate: three cards
 *  that push everything else below the fold. On a quiet day all three say some
 *  version of "nothing here", so the deck folds itself away and leaves a single
 *  line behind. This module decides what that line says and whether there is
 *  anything worth unfolding for. */

export interface OverviewSummary {
  /** A target has been named for today. */
  hasTarget: boolean;
  /** Title of the soonest event still ahead, or null when nothing is booked. */
  nextEventTitle: string | null;
  /** How many deadlines have already passed. */
  overdue: number;
  /** True when at least one card has something of its own to say. */
  hasContent: boolean;
  /** One line standing in for the deck while it is minimised. */
  line: string;
}

const EMPTY_LINE = 'Nothing scheduled';

export function overviewSummary(
  events: CalendarEvent[],
  tasks: Task[],
  targets: DailyTarget[],
  today: DateStr,
  nowMs: number,
): OverviewSummary {
  const target = targetFor(resolveAll(targets, tasks), today);
  const upcoming = nextEvent(events, nowMs, today);
  const overdue = tasks.filter((t) => isOverdue(t, today)).length;

  const parts: string[] = [];
  if (target) parts.push('Target set');
  if (upcoming) parts.push(`Next: ${upcoming.title || 'Untitled'}`);
  if (overdue > 0) parts.push(`${overdue} overdue`);

  return {
    hasTarget: target !== null,
    nextEventTitle: upcoming ? upcoming.title : null,
    overdue,
    hasContent: parts.length > 0,
    line: parts.length > 0 ? parts.join(' · ') : EMPTY_LINE,
  };
}
