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
