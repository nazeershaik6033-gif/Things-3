import Dexie, { type EntityTable } from 'dexie';
import type {
  Task, Project, Heading, Area, Tag, Setting, CalendarEvent,
  RoutineItem, RoutineLog,
} from './models';

export class ClarityDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  headings!: EntityTable<Heading, 'id'>;
  areas!: EntityTable<Area, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  calendarEvents!: EntityTable<CalendarEvent, 'id'>;
  routineItems!: EntityTable<RoutineItem, 'id'>;
  routineLogs!: EntityTable<RoutineLog, 'id'>;

  constructor(name = 'clarity') {
    super(name);
    // Migrations are additive: never edit version(1), add version(2) with
    // .upgrade() instead. Each new version needs a fixture test.
    this.version(1).stores({
      tasks: 'id, status, bucket, startDate, deadline, projectId, headingId, areaId, completedAt, trashedAt, *tagIds',
      projects: 'id, status, areaId, completedAt, trashedAt, *tagIds',
      headings: 'id, projectId',
      areas: 'id',
      tags: 'id',
      settings: 'key',
      calendarEvents: 'id, date, calendarUrl',
    });
    // v2: daily routine. Purely additive — no .upgrade() needed, existing rows
    // are untouched and the two new tables simply start empty.
    this.version(2).stores({
      routineItems: 'id, active, orderKey',
      routineLogs: 'id, date, itemId',
    });
  }
}

export let db = new ClarityDB();

/** Test hook: swap in a fresh DB instance (unit tests use fake-indexeddb). */
export function setDB(instance: ClarityDB): void {
  db = instance;
}
