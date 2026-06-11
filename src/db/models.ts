/** Calendar dates ("when", deadlines) are local YYYY-MM-DD strings, never Date
 *  objects — they are calendar concepts, not instants. Timestamps are epoch ms. */
export type DateStr = string;

export type TaskStatus = 'open' | 'completed' | 'canceled';
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

export interface CalendarEvent {
  id: string;
  date: DateStr; // local date the event occurs on
  start: number | null; // epoch ms, null for all-day
  end: number | null;
  title: string;
  allDay: boolean;
  calendarUrl: string; // source subscription (or 'file' for imports)
}
