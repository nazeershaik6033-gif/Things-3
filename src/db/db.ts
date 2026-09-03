import Dexie, { type EntityTable } from 'dexie';
import type {
  Task, Project, Heading, Area, Tag, Setting, CalendarEvent,
  Board, BoardList, BoardLabel, Card, RoutineItem, RoutineLog, DailyTarget,
  RoutineGroup, RoutineSource, RoutineWindow, RoutineCheck, RoutineFeed,
  RoutineMiss, RoutineSeen, RoutineDay,
} from './models';

export class ClarityDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  headings!: EntityTable<Heading, 'id'>;
  areas!: EntityTable<Area, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  calendarEvents!: EntityTable<CalendarEvent, 'id'>;
  boards!: EntityTable<Board, 'id'>;
  boardLists!: EntityTable<BoardList, 'id'>;
  boardLabels!: EntityTable<BoardLabel, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  routineItems!: EntityTable<RoutineItem, 'id'>;
  routineLogs!: EntityTable<RoutineLog, 'id'>;
  dailyTargets!: EntityTable<DailyTarget, 'date'>;
  routineGroups!: EntityTable<RoutineGroup, 'id'>;
  routineSources!: EntityTable<RoutineSource, 'id'>;
  routineWindows!: EntityTable<RoutineWindow, 'id'>;
  routineChecks!: EntityTable<RoutineCheck, 'id'>;
  routineFeeds!: EntityTable<RoutineFeed, 'sourceId'>;
  routineMisses!: EntityTable<RoutineMiss, 'id'>;
  routineSeen!: EntityTable<RoutineSeen, 'url'>;
  routineDays!: EntityTable<RoutineDay, 'date'>;

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
    // v2: Trello-style boards. Purely additive — new tables only, so no
    // .upgrade() is needed; existing rows are untouched.
    this.version(2).stores({
      boards: 'id, orderKey, archived',
      boardLists: 'id, boardId, archived',
      boardLabels: 'id, boardId',
      cards: 'id, boardId, listId, due, archived',
    });
    // v3: daily routine. Also purely additive. This is a separate version from
    // the boards tables rather than folded into v2: v2 already shipped, so
    // installs in the wild are sitting at it and must see a version bump.
    this.version(3).stores({
      routineItems: 'id, active, orderKey',
      routineLogs: 'id, date, itemId',
    });
    // v4: the daily target. Keyed by date, so writing today's target twice
    // replaces it rather than accumulating — one target a day, by construction.
    this.version(4).stores({
      dailyTargets: 'date, outcome',
    });
    // v5: My Routine — the catch-up feed section. Additive again: eight new
    // tables, nothing existing touched. routineFeeds/routineSeen are caches
    // keyed by their natural key so a refetch replaces rather than appends.
    this.version(5).stores({
      routineGroups: 'id, orderKey',
      routineSources: 'id, groupId, orderKey',
      routineWindows: 'id, orderKey',
      routineChecks: 'id, windowKey, sourceId, date',
      routineFeeds: 'sourceId, fetchedAt',
      routineMisses: 'id, windowKey, snapshotAt',
      routineSeen: 'url, seenAt',
      routineDays: 'date',
    });
  }
}

export let db = new ClarityDB();

/** Test hook: swap in a fresh DB instance (unit tests use fake-indexeddb). */
export function setDB(instance: ClarityDB): void {
  db = instance;
}
