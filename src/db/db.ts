import Dexie, { type EntityTable } from 'dexie';
import type {
  Task, Project, Heading, Area, Tag, Setting, CalendarEvent,
  Board, BoardList, BoardLabel, Card, RoutineItem, RoutineLog, DailyTarget,
  RoutineGroup, RoutineSource, RoutineWindow, RoutineCheck, RoutineFeed,
  RoutineMiss, RoutineSeen, RoutineDay,
  Belief, BeliefRating, BeliefEvidence, QuoteFavorite, QuoteNote,
  Sprint, EnergyLog, HealthDay, RepeatCfg, Counter, CounterDay, DayReview,
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
  beliefs!: EntityTable<Belief, 'id'>;
  beliefRatings!: EntityTable<BeliefRating, 'id'>;
  beliefEvidence!: EntityTable<BeliefEvidence, 'id'>;
  quoteFavorites!: EntityTable<QuoteFavorite, 'id'>;
  quoteNotes!: EntityTable<QuoteNote, 'quoteId'>;
  sprints!: EntityTable<Sprint, 'id'>;
  energyLogs!: EntityTable<EnergyLog, 'id'>;
  healthDays!: EntityTable<HealthDay, 'date'>;
  repeatCfgs!: EntityTable<RepeatCfg, 'id'>;
  counters!: EntityTable<Counter, 'id'>;
  counterDays!: EntityTable<CounterDay, 'id'>;
  dayReviews!: EntityTable<DayReview, 'date'>;

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
    // v6: the belief board and the daily quote. Additive: five new tables,
    // nothing existing touched. quoteNotes is a cache keyed by the quote's own
    // id, so re-asking overwrites instead of appending.
    this.version(6).stores({
      beliefs: 'id, active, orderKey',
      beliefRatings: 'id, beliefId, date',
      beliefEvidence: 'id, beliefId, date',
      quoteFavorites: 'id, savedAt',
      quoteNotes: 'quoteId',
    });
    // v7: Focus Framework — MIT/energy fields on tasks, sprints, energy logs.
    // Additive: two new tables; the upgrade only backfills two task fields.
    this.version(7).stores({
      sprints: 'id, date, status, taskId',
      energyLogs: 'id, date, at',
    }).upgrade(async (tx) => {
      await tx.table('tasks').toCollection().modify((t: Partial<Task>) => {
        if (t.mitDate === undefined) t.mitDate = null;
        if (t.energy === undefined) t.energy = null;
      });
    });
    // v8: Apple Watch sleep + activity, one row per day keyed by date.
    // Additive: one new table, nothing existing touched.
    this.version(8).stores({
      healthDays: 'date, updatedAt',
    });
    // v9: features ported from Super Productivity — time tracking and
    // estimates on tasks, repeating to-dos, counters, the Finish Day review
    // and issue import. Four new tables; the upgrade backfills three task
    // fields and indexes repeatTemplateId (reserved since v1, always null).
    this.version(9).stores({
      tasks: 'id, status, bucket, startDate, deadline, projectId, headingId, areaId, completedAt, trashedAt, *tagIds, repeatTemplateId, issueRef',
      repeatCfgs: 'id, paused',
      counters: 'id, active, orderKey',
      counterDays: 'id, counterId, date',
      dayReviews: 'date',
    }).upgrade(async (tx) => {
      await tx.table('tasks').toCollection().modify((t: Partial<Task>) => {
        if (t.timeEstimateMin === undefined) t.timeEstimateMin = null;
        if (t.timeSpent === undefined) t.timeSpent = {};
        if (t.issueRef === undefined) t.issueRef = null;
      });
    });
    // v10: the day planner — a time of day and a block length on to-dos,
    // plus a time on deadlines. No new tables or indexes (the timeline reads
    // by startDate, already indexed); the upgrade only backfills three fields.
    this.version(10).stores({}).upgrade(async (tx) => {
      await tx.table('tasks').toCollection().modify((t: Partial<Task>) => {
        if (t.startTime === undefined) t.startTime = null;
        if (t.durationMin === undefined) t.durationMin = null;
        if (t.deadlineTime === undefined) t.deadlineTime = null;
      });
    });
    // v11: calendar alerts on to-dos. Additive; backfills two fields.
    this.version(11).stores({}).upgrade(async (tx) => {
      await tx.table('tasks').toCollection().modify((t: Partial<Task>) => {
        if (t.alerts === undefined) t.alerts = null;
        if (t.alertsSentSig === undefined) t.alertsSentSig = null;
      });
    });
  }
}

export let db = new ClarityDB();

/** Test hook: swap in a fresh DB instance (unit tests use fake-indexeddb). */
export function setDB(instance: ClarityDB): void {
  db = instance;
}
