import { createSignal } from 'solid-js';
import type { Task } from '../db/models';
import type { TaskDestination } from '../db/mutations';

/** Completed tasks linger in their list, struck through, for a grace period
 *  before animating away (Things' signature completion feel). The DB write
 *  happens immediately; this is purely a UI-level overlay. */

export const GRACE_MS = 2500;

const [graceIds, setGraceIds] = createSignal<ReadonlySet<string>>(new Set(), { equals: false });
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export { graceIds };

export function addGrace(id: string, ms = GRACE_MS): void {
  clearTimeout(graceTimers.get(id));
  setGraceIds((s) => {
    const next = new Set(s);
    next.add(id);
    return next;
  });
  graceTimers.set(id, setTimeout(() => removeGrace(id), ms));
}

export function removeGrace(id: string): void {
  clearTimeout(graceTimers.get(id));
  graceTimers.delete(id);
  setGraceIds((s) => {
    if (!s.has(id)) return s;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
}

/** Wrap a list predicate so tasks in the grace period still count as open. */
export function withGrace<A extends unknown[]>(
  pred: (t: Task, ...args: A) => boolean,
): (t: Task, ...args: A) => boolean {
  return (t, ...args) => {
    const effective = graceIds().has(t.id) && t.status !== 'open' ? { ...t, status: 'open' as const } : t;
    return pred(effective, ...args);
  };
}

// ---------------------------------------------------------------------------

/** The single inline-expanded task card (Things expands rows in place). */
const [expandedTaskId, setExpandedTaskId] = createSignal<string | null>(null);
export { expandedTaskId, setExpandedTaskId };

/** Quick Entry sheet state; destination defaults to the current list. */
export interface QuickEntryState {
  destination: TaskDestination;
  startDate?: string | null;
  evening?: boolean;
  /** Insert at a specific position (Magic Plus drag). */
  orderKey?: string;
}

const [quickEntry, setQuickEntry] = createSignal<QuickEntryState | null>(null);
export { quickEntry, setQuickEntry };

const [searchOpen, setSearchOpen] = createSignal(false);
export { searchOpen, setSearchOpen };

/** Home's widget deck folds away on a quiet day. 'auto' follows that rule;
 *  once the chevron is tapped the choice is explicit and sticks, because a
 *  section that re-opens itself after you closed it isn't a control. Lives
 *  here rather than in HomeScreen so it survives navigating away and back. */
export type SectionPref = 'auto' | 'open' | 'closed';

const OVERVIEW_KEY = 'clarity-home-overview';

function loadOverviewPref(): SectionPref {
  try {
    const v = localStorage.getItem(OVERVIEW_KEY);
    return v === 'open' || v === 'closed' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

const [overviewPref, setOverviewPrefSignal] = createSignal<SectionPref>(loadOverviewPref());
export { overviewPref };

export function setOverviewPref(pref: SectionPref): void {
  setOverviewPrefSignal(pref);
  try {
    if (pref === 'auto') localStorage.removeItem(OVERVIEW_KEY);
    else localStorage.setItem(OVERVIEW_KEY, pref);
  } catch {
    // Private mode: the preference simply doesn't outlive the session.
  }
}

/** Set when a late to-do is ticked: the sheet asks which day it was finished
 *  before anything is written. Cleared on confirm or dismiss. */
export interface CompletionPrompt {
  taskId: string;
}

const [completionPrompt, setCompletionPrompt] = createSignal<CompletionPrompt | null>(null);
export { completionPrompt, setCompletionPrompt };
