import Dexie, { type EntityTable } from 'dexie';
import type {
  Task, Project, Heading, Area, Tag, Setting, CalendarEvent,
} from './models';

export class ClarityDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  headings!: EntityTable<Heading, 'id'>;
  areas!: EntityTable<Area, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  calendarEvents!: EntityTable<CalendarEvent, 'id'>;

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
  }
}

export let db = new ClarityDB();

/** Test hook: swap in a fresh DB instance (unit tests use fake-indexeddb). */
export function setDB(instance: ClarityDB): void {
  db = instance;
}
