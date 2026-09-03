/** Calendar dates ("when", deadlines) are local YYYY-MM-DD strings, never Date
 *  objects — they are calendar concepts, not instants. Timestamps are epoch ms. */
export type DateStr = string;

export type TaskStatus = 'open' | 'completed' | 'canceled';
/** Eisenhower Matrix quadrant for day planning. */
export type EMQuadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';
export type Bucket = 'inbox' | 'anytime' | 'someday';

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
