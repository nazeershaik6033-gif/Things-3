/** Calendar dates ("when", deadlines) are local YYYY-MM-DD strings, never Date
 *  objects — they are calendar concepts, not instants. Timestamps are epoch ms. */
export type DateStr = string;

export type TaskStatus = 'open' | 'completed' | 'canceled';
/** Eisenhower Matrix quadrant for day planning. */
export type EMQuadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';
export type Bucket = 'inbox' | 'anytime' | 'someday';
/** How much concentration a to-do needs (Focus Framework, level 3). */
export type Energy = 'high' | 'low';

export interface ChecklistItem {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string; // markdown source
  status: TaskStatus;
  completedAt: number | null; // set for completed AND canceled
  bucket: Bucket;
  startDate: DateStr | null; // <= today means "in Today"
  evening: boolean;
  deadline: DateStr | null;
  priority: EMQuadrant | null; // Eisenhower quadrant, user-set
  projectId: string | null;
  headingId: string | null; // implies projectId
  areaId: string | null; // loose task directly in an area
  tagIds: string[];
  checklist: ChecklistItem[]; // order = array order
  orderKey: string; // fractional index within container
  todayOrderKey: string | null; // manual order inside Today
  trashedAt: number | null;
  createdAt: number;
  modifiedAt: number;
  // ---- reserved for iteration 2 (always null in v1) ----
  repeatRule: string | null;
  repeatTemplateId: string | null;
  reminderTime: string | null; // "HH:mm" local
  // ---- focus framework (schema v2) ----
  /** The day this to-do was picked as a Most Important Task. MIT-ness is
   *  per day: tomorrow you choose again. */
  mitDate: DateStr | null;
  energy: Energy | null;
  // ---- Super Productivity imports (schema v9) ----
  /** How long you expect this to take, in minutes. null = no estimate. */
  timeEstimateMin: number | null;
  /** Seconds tracked per local day. Keyed by day (not one running total) so
   *  the Worklog can say what you did *when*, and a timer left running past
   *  midnight lands on both days. */
  timeSpent: Record<DateStr, number>;
  /** Link back to an imported issue, e.g. "github:owner/repo#12". */
  issueRef: string | null;
  // ---- Day planner (schema v10) ----
  /** "HH:mm" local time on `startDate` — places the to-do on the timeline.
   *  Meaningless without a startDate. Separate from `reminderTime`, which
   *  holds the Today section slot ("morning"/"afternoon") or a reminder. */
  startTime: string | null;
  /** Planned length of the timeline block, in minutes. null falls back to
   *  the estimate, then to the default block length. */
  durationMin: number | null;
  /** "HH:mm" local time on `deadline`. null = due any time that day. */
  deadlineTime: string | null;
  // ---- Alerts (schema v11) ----
  /** Calendar alerts: minutes before the start time or the deadline.
   *  null = use the default from Settings (for timed to-dos). */
  alerts: TaskAlert[] | null;
  /** Signature of what was last sent to the Calendar, so the app can tell
   *  "in Calendar" from "changed since — send again". */
  alertsSentSig: string | null;
}

export interface TaskAlert {
  anchor: 'start' | 'deadline';
  /** Minutes before the anchor; 0 = at that moment. */
  beforeMin: number;
}

export interface Project {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  completedAt: number | null;
  areaId: string | null;
  deadline: DateStr | null;
  tagIds: string[];
  bucket: 'anytime' | 'someday';
  startDate: DateStr | null;
  orderKey: string;
  trashedAt: number | null;
  createdAt: number;
  modifiedAt: number;
}

export interface Heading {
  id: string;
  projectId: string;
  title: string;
  orderKey: string;
}

export interface Area {
  id: string;
  title: string;
  orderKey: string;
}

export interface Tag {
  id: string;
  title: string;
  orderKey: string;
  parentId: string | null; // reserved for nested tags
}

export interface Setting {
  key: string;
  value: unknown;
}

/** A recurring daily check. Routine items are deliberately NOT tasks: they
 *  never enter Inbox/Today, never reach the Logbook, and have no due date —
 *  they are a habit surface with its own history. */
export interface RoutineItem {
  id: string;
  title: string;
  note: string;
  orderKey: string;
  /** Retiring an item keeps its history instead of deleting it. */
  active: boolean;
  createdAt: number;
  modifiedAt: number;
}

/** One tick of one routine item on one day. The id is `${date}:${itemId}`, so
 *  ticking is idempotent and "reset at midnight" needs no job — a new day
 *  simply has no rows yet. */
export interface RoutineLog {
  id: string;
  date: DateStr;
  itemId: string;
  completedAt: number;
}

export interface CalendarEvent {
  id: string;
  date: DateStr; // local date the event occurs on
  start: number | null; // epoch ms, null for all-day
  end: number | null;
  title: string;
  allDay: boolean;
  calendarUrl: string; // source subscription (or 'file' for imports)
}

/** The single thing that would make today count. Exactly one per day: the id
 *  IS the date, so "one target" is a property of the schema rather than a rule
 *  the UI has to police. */
export type TargetOutcome = 'pending' | 'hit' | 'partial' | 'missed';

export interface DailyTarget {
  date: DateStr; // primary key
  text: string;
  /** Optional to-do that carries the target; completing it counts as a hit. */
  taskId: string | null;
  outcome: TargetOutcome;
  /** One line written at review time. */
  reflection: string;
  setAt: number;
  reviewedAt: number | null;
}

// ---- Boards (Trello-style Kanban) ------------------------------------------
// A self-contained section separate from tasks/projects: boards hold lists
// (columns), lists hold cards. Ordering uses the same fractional orderKey
// scheme as tasks; each list is its own orderKey scope for its cards.

export interface Board {
  id: string;
  title: string;
  color: string; // accent color token (e.g. 'var(--blue)')
  orderKey: string;
  archived: boolean;
  createdAt: number;
  modifiedAt: number;
}

export interface BoardList {
  id: string;
  boardId: string;
  title: string;
  orderKey: string; // within the board
  archived: boolean;
}

export interface BoardLabel {
  id: string;
  boardId: string; // board-scoped
  title: string;
  color: string; // color token
}

export interface CardComment {
  id: string;
  text: string;
  createdAt: number;
}

export interface Card {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  description: string; // markdown source
  checklist: ChecklistItem[]; // order = array order
  labelIds: string[]; // -> BoardLabel.id
  cover: string | null; // color token for the cover strip, or null
  due: DateStr | null;
  dueTime: string | null; // "HH:mm" local, optional; drives reminders
  reminded: boolean; // set once a due reminder has fired
  completed: boolean;
  comments: CardComment[]; // newest appended last
  orderKey: string; // fractional index within its list
  archived: boolean;
  createdAt: number;
  modifiedAt: number;
}

// ---- My Routine (catch-up feed) --------------------------------------------
// A separate section from the habit checklist above. Sources are the channels,
// accounts and sites you go through each day; they live in colored groups and
// are checked off inside a time *window* (Morning, Night, …). Sources that
// expose a feed also carry cached entries, which is what "new since the window
// opened" is computed from.

/** What kind of thing a source is — decides how (and whether) it can be fetched. */
export type SourceKind = 'youtube' | 'telegram' | 'rss' | 'link';

export interface RoutineGroup {
  id: string;
  name: string;
  /** Accent color token. Empty string means "derive one from the id". */
  color: string;
  orderKey: string;
  createdAt: number;
}

export interface RoutineSource {
  id: string;
  /** null = the implicit "Other" group at the bottom of the screen. */
  groupId: string | null;
  name: string;
  kind: SourceKind;
  /** Where tapping the source takes you. Always navigable. */
  url: string;
  /** kind-specific fetch handles; empty when not applicable or unresolved. */
  channelId: string; // youtube UC…
  handle: string; // telegram
  feedUrl: string; // rss
  orderKey: string; // within the group
  /** Hidden from the list until this instant (epoch ms). 0 = not snoozed. */
  snoozedUntil: number;
  createdAt: number;
  modifiedAt: number;
}

/** One time-of-day window, e.g. Morning at 08:00. A window runs until the next
 *  window starts, so the set of windows partitions the day with no gaps. */
export interface RoutineWindow {
  id: string;
  name: string;
  time: string; // "HH:MM" local
  orderKey: string;
}

/** A source ticked off inside one window occurrence. `windowKey` is
 *  `${date}#${windowId}`, so ticking in the morning is never wiped by the
 *  evening pass, and a new day simply has no rows yet. */
export interface RoutineCheck {
  id: string; // `${windowKey}:${sourceId}`
  windowKey: string;
  sourceId: string;
  date: DateStr;
  checkedAt: number;
}

/** One item published by a source. */
export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  publishedMs: number;
  thumb: string;
}

/** Cached feed contents, one row per source. Refetched on a timer; never the
 *  source of truth for anything the user typed. */
export interface RoutineFeed {
  sourceId: string; // primary key
  fetchedAt: number;
  entries: FeedEntry[];
  /** Last fetch failure, surfaced in the row so a dead feed is visible. */
  error: string;
}

/** A source's slice of one archived catch-up day. */
export interface RoutineMissItem {
  sourceId: string;
  name: string;
  kind: SourceKind;
  groupName: string | null;
  entries: FeedEntry[];
}

/** Everything a past window went by without you seeing it. Captured when the
 *  window rolls over and kept for a fortnight — the History section. */
export interface RoutineMiss {
  id: string;
  windowKey: string;
  windowName: string;
  snapshotAt: number;
  start: number;
  end: number;
  items: RoutineMissItem[];
}

/** An entry URL you already opened, so it stops counting as new. */
export interface RoutineSeen {
  url: string; // primary key
  seenAt: number;
}

/** A day banked toward the streak: you cleared a whole window that day. */
export interface RoutineDay {
  date: DateStr; // primary key
  bankedAt: number;
}

// ---- Beliefs (the belief system board) --------------------------------------
// A belief is neither a task nor a habit: it is never "done", and what moves is
// how much of you believes it. Conviction is recorded per (day, belief), the
// same shape as RoutineLog, so re-rating replaces rather than accumulates.

/** One statement you are deliberately installing. */
export interface Belief {
  id: string;
  /** The statement itself — first person, present tense. */
  text: string;
  /** Why it matters, or the story it replaces. Shown while you speak it. */
  why: string;
  color: string; // accent color token
  orderKey: string;
  /** Retiring a belief keeps its ratings and evidence instead of deleting them. */
  active: boolean;
  createdAt: number;
  modifiedAt: number;
}

/** Today's conviction in one belief, 0–10. The id is `${date}:${beliefId}`, so
 *  rating twice in a day corrects the score rather than logging it twice. */
export interface BeliefRating {
  id: string;
  beliefId: string;
  date: DateStr;
  score: number;
  ratedAt: number;
}

/** Something that actually happened and argues the belief is true. Evidence is
 *  what moves conviction: repetition alone only rehearses a sentence. */
export interface BeliefEvidence {
  id: string;
  beliefId: string;
  date: DateStr;
  text: string;
  createdAt: number;
}

/** A quote kept from the daily rotation. Keyed by the quote's own stable id. */
export interface QuoteFavorite {
  id: string;
  savedAt: number;
}

/** A cached "go deeper" answer for one quote, so it is written once, read
 *  offline afterwards, and never billed twice. */
export interface QuoteNote {
  quoteId: string;
  text: string;
  /** Which provider wrote it — shown under the note. */
  provider: string;
  createdAt: number;
}

// ---------------------------------------------------- focus (schema v7) ----

export type SprintStatus = 'planned' | 'running' | 'done' | 'abandoned';

/** One focus sprint: a protected block for one clearly defined task. */
export interface Sprint {
  id: string;
  taskId: string | null;
  title: string;
  nextAction: string;
  durationMin: number;
  date: DateStr; // local day it belongs to
  plannedAt: number | null; // epoch ms for a scheduled (later) sprint
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  status: SprintStatus;
  completedNote: string;
  createdAt: number;
}

/** A 1–5 self-rating used to discover your energy pattern. */
export interface EnergyLog {
  id: string;
  at: number; // epoch ms
  date: DateStr;
  minuteOfDay: number; // local 0..1439
  level: number; // 1..5
}

// ------------------------------------------------- health (schema v8) ----
// Apple Watch sleep + activity, brought in by an iOS Shortcut (Clarity is a
// web app and cannot read HealthKit) or typed in by hand. One row per day.

/** One night of sleep, keyed by the date you woke up. */
export interface SleepNight {
  asleepMin: number;
  /** Sleep onset and final wake, local "HH:mm". */
  onset: string;
  wake: string;
  /** Awake time between onset and wake. */
  awakeMin: number;
  wakeups: number;
}

/** Activity rings for one day. null = not recorded. */
export interface ActivityDay {
  moveKcal: number | null;
  exerciseMin: number | null;
  standHr: number | null;
}

export interface HealthDay {
  date: DateStr; // primary key
  sleep: SleepNight | null;
  activity: ActivityDay | null;
  /** Where the latest write came from. */
  source: 'shortcut' | 'manual';
  updatedAt: number;
}

// ------------------------------- Super Productivity imports (schema v9) ----

/** How often a repeating to-do comes back. */
export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every N days/weeks/months/years. >= 1. */
  interval: number;
  /** weekly only: which weekdays (0 = Sunday … 6 = Saturday). Empty means
   *  "the anchor's weekday". */
  weekdays: number[];
  /** monthly only: same day number, the same Nth weekday ("2nd Tuesday"), or
   *  the last day of the month. */
  monthMode: 'day' | 'nthWeekday' | 'lastDay';
  /** First occurrence, and the phase every interval is counted from. */
  anchor: DateStr;
  /** Inclusive last day an occurrence may fall on. null = forever. */
  until: DateStr | null;
  /** Next one is scheduled from the day you finish the current one rather
   *  than on a fixed calendar ("water the plants 3 days after last time"). */
  afterCompletion: boolean;
}

/** What each new occurrence of a repeating to-do is stamped from. */
export interface RepeatTemplate {
  title: string;
  notes: string;
  checklist: string[];
  tagIds: string[];
  projectId: string | null;
  headingId: string | null;
  areaId: string | null;
  evening: boolean;
  energy: Energy | null;
  timeEstimateMin: number | null;
  /** Days from the occurrence to its deadline. null = no deadline. */
  deadlineOffsetDays: number | null;
  /** Day planner (schema v10). Optional: configs saved before v10 lack them. */
  startTime?: string | null;
  durationMin?: number | null;
  deadlineTime?: string | null;
}

/** A repeating to-do's configuration. Occurrences are ordinary tasks whose
 *  `repeatTemplateId` points here, so every list, the Logbook and the
 *  Worklog treat them exactly like any other to-do. */
export interface RepeatCfg {
  id: string;
  rule: RepeatRule;
  template: RepeatTemplate;
  /** Latest occurrence date an instance has been created for. */
  lastDate: DateStr | null;
  paused: boolean;
  createdAt: number;
  modifiedAt: number;
}

/** A tally you tap (glasses of water) or a stopwatch you run (minutes of
 *  reading), with a daily goal that drives a streak. */
export type CounterKind = 'click' | 'stopwatch';

export interface Counter {
  id: string;
  title: string;
  kind: CounterKind;
  color: string; // accent color token
  /** Daily goal: taps for a click counter, minutes for a stopwatch. 0 = none. */
  goal: number;
  orderKey: string;
  active: boolean;
  /** Stopwatch only: when the current run started (epoch ms). */
  runningSince: number | null;
  createdAt: number;
  modifiedAt: number;
}

/** One counter on one day. The id is `${date}:${counterId}`. `value` is taps
 *  for a click counter and seconds for a stopwatch. */
export interface CounterDay {
  id: string;
  counterId: string;
  date: DateStr;
  value: number;
}

/** The end-of-day review ("Finish Day"): how the day went, in a line. */
export interface DayReview {
  date: DateStr; // primary key
  /** 1 = little impact … 4 = very high impact. */
  impact: number | null;
  note: string;
  /** Snapshot when the day was closed, so the Worklog keeps the numbers even
   *  if to-dos are later edited or deleted. */
  trackedSec: number;
  completedCount: number;
  finishedAt: number;
}
