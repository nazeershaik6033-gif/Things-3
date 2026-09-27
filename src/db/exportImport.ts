import { db } from './db';
import type {
  Task, Project, Heading, Area, Tag, Setting,
  Board, BoardList, BoardLabel, Card, RoutineItem, RoutineLog, DailyTarget,
  RoutineGroup, RoutineSource, RoutineWindow, RoutineCheck, RoutineFeed,
  RoutineMiss, RoutineSeen, RoutineDay,
  Belief, BeliefRating, BeliefEvidence, QuoteFavorite, QuoteNote,
} from './models';

export interface ExportFile {
  app: 'clarity';
  schemaVersion: number;
  exportedAt: number;
  data: {
    tasks: Task[];
    projects: Project[];
    headings: Heading[];
    areas: Area[];
    tags: Tag[];
    settings: Setting[];
    // Every table below arrived after schema 1, so all are optional: an older
    // backup simply has nothing to restore into them.
    boards?: Board[];
    boardLists?: BoardList[];
    boardLabels?: BoardLabel[];
    cards?: Card[];
    /** Added in schema 3. */
    routineItems?: RoutineItem[];
    routineLogs?: RoutineLog[];
    /** Added in schema 4. */
    dailyTargets?: DailyTarget[];
    /** Added in schema 5 — the My Routine section. */
    routineGroups?: RoutineGroup[];
    routineSources?: RoutineSource[];
    routineWindows?: RoutineWindow[];
    routineChecks?: RoutineCheck[];
    routineFeeds?: RoutineFeed[];
    routineMisses?: RoutineMiss[];
    routineSeen?: RoutineSeen[];
    routineDays?: RoutineDay[];
    /** Added in schema 6 — the belief board and the daily quote. */
    beliefs?: Belief[];
    beliefRatings?: BeliefRating[];
    beliefEvidence?: BeliefEvidence[];
    quoteFavorites?: QuoteFavorite[];
    quoteNotes?: QuoteNote[];
  };
}

export const SCHEMA_VERSION = 6;

const TABLES = [
  'tasks', 'projects', 'headings', 'areas', 'tags', 'settings',
  'boards', 'boardLists', 'boardLabels', 'cards',
  'routineItems', 'routineLogs', 'dailyTargets',
  'routineGroups', 'routineSources', 'routineWindows', 'routineChecks',
  'routineFeeds', 'routineMisses', 'routineSeen', 'routineDays',
  'beliefs', 'beliefRatings', 'beliefEvidence', 'quoteFavorites', 'quoteNotes',
] as const;

export async function exportData(): Promise<ExportFile> {
  return {
    app: 'clarity',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    data: {
      tasks: await db.tasks.toArray(),
      projects: await db.projects.toArray(),
      headings: await db.headings.toArray(),
      areas: await db.areas.toArray(),
      tags: await db.tags.toArray(),
      settings: await db.settings.toArray(),
      boards: await db.boards.toArray(),
      boardLists: await db.boardLists.toArray(),
      boardLabels: await db.boardLabels.toArray(),
      cards: await db.cards.toArray(),
      routineItems: await db.routineItems.toArray(),
      routineLogs: await db.routineLogs.toArray(),
      dailyTargets: await db.dailyTargets.toArray(),
      routineGroups: await db.routineGroups.toArray(),
      routineSources: await db.routineSources.toArray(),
      routineWindows: await db.routineWindows.toArray(),
      routineChecks: await db.routineChecks.toArray(),
      routineFeeds: await db.routineFeeds.toArray(),
      routineMisses: await db.routineMisses.toArray(),
      routineSeen: await db.routineSeen.toArray(),
      routineDays: await db.routineDays.toArray(),
      beliefs: await db.beliefs.toArray(),
      beliefRatings: await db.beliefRatings.toArray(),
      beliefEvidence: await db.beliefEvidence.toArray(),
      quoteFavorites: await db.quoteFavorites.toArray(),
      quoteNotes: await db.quoteNotes.toArray(),
    },
  };
}

const MY_ROUTINE_TABLES = [
  'routineGroups', 'routineSources', 'routineWindows', 'routineChecks',
  'routineFeeds', 'routineMisses', 'routineSeen', 'routineDays',
] as const;

const BELIEF_TABLES = [
  'beliefs', 'beliefRatings', 'beliefEvidence', 'quoteFavorites', 'quoteNotes',
] as const;

export function validateExport(json: unknown): ExportFile {
  const f = json as Partial<ExportFile>;
  if (!f || typeof f !== 'object') throw new Error('Not a valid backup file.');
  if (f.app !== 'clarity') throw new Error('This file is not a Clarity backup.');
  if (typeof f.schemaVersion !== 'number' || f.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  const d = f.data;
  if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.projects) ||
      !Array.isArray(d.headings) || !Array.isArray(d.areas) ||
      !Array.isArray(d.tags) || !Array.isArray(d.settings)) {
    throw new Error('Backup file is malformed.');
  }
  // Routine tables arrived in schema 2 — missing is fine, wrong type is not
  if (d.routineItems !== undefined && !Array.isArray(d.routineItems)) {
    throw new Error('Backup file is malformed.');
  }
  if (d.routineLogs !== undefined && !Array.isArray(d.routineLogs)) {
    throw new Error('Backup file is malformed.');
  }
  if (d.dailyTargets !== undefined && !Array.isArray(d.dailyTargets)) {
    throw new Error('Backup file is malformed.');
  }
  // My Routine tables arrived in schema 5 — missing is fine, wrong type is not
  for (const key of MY_ROUTINE_TABLES) {
    if (d[key] !== undefined && !Array.isArray(d[key])) {
      throw new Error('Backup file is malformed.');
    }
  }
  // Belief tables arrived in schema 6 — missing is fine, wrong type is not
  for (const key of BELIEF_TABLES) {
    if (d[key] !== undefined && !Array.isArray(d[key])) {
      throw new Error('Backup file is malformed.');
    }
  }
  for (const t of d.tasks) {
    if (typeof t.id !== 'string' || typeof t.title !== 'string') {
      throw new Error('Backup file contains invalid tasks.');
    }
  }
  return f as ExportFile;
}

/** A row that is done but carries no `completedAt` would sort and group
 *  nowhere; stamp it so it still lands in the Logbook on the day it was last
 *  touched. Older backups and hand-edited files are the realistic sources. */
function withCompletionStamp<T extends { status: string; completedAt: number | null; modifiedAt?: number; createdAt?: number }>(
  row: T,
): T {
  if (row.status === 'open' || typeof row.completedAt === 'number') return row;
  return { ...row, completedAt: row.modifiedAt ?? row.createdAt ?? Date.now() };
}

/** Replace-all import (caller confirms with the user first). */
export async function importData(file: ExportFile): Promise<void> {
  const tables = TABLES.map((name) => db.table(name));
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.tasks.bulkPut(file.data.tasks.map(withCompletionStamp));
    await db.projects.bulkPut(file.data.projects.map(withCompletionStamp));
    await db.headings.bulkPut(file.data.headings);
    await db.areas.bulkPut(file.data.areas);
    await db.tags.bulkPut(file.data.tags);
    await db.settings.bulkPut(file.data.settings);
    await db.boards.bulkPut(file.data.boards ?? []);
    await db.boardLists.bulkPut(file.data.boardLists ?? []);
    await db.boardLabels.bulkPut(file.data.boardLabels ?? []);
    await db.cards.bulkPut(file.data.cards ?? []);
    await db.routineItems.bulkPut(file.data.routineItems ?? []);
    await db.routineLogs.bulkPut(file.data.routineLogs ?? []);
    await db.dailyTargets.bulkPut(file.data.dailyTargets ?? []);
    await db.routineGroups.bulkPut(file.data.routineGroups ?? []);
    await db.routineSources.bulkPut(file.data.routineSources ?? []);
    await db.routineWindows.bulkPut(file.data.routineWindows ?? []);
    await db.routineChecks.bulkPut(file.data.routineChecks ?? []);
    await db.routineFeeds.bulkPut(file.data.routineFeeds ?? []);
    await db.routineMisses.bulkPut(file.data.routineMisses ?? []);
    await db.routineSeen.bulkPut(file.data.routineSeen ?? []);
    await db.routineDays.bulkPut(file.data.routineDays ?? []);
    await db.beliefs.bulkPut(file.data.beliefs ?? []);
    await db.beliefRatings.bulkPut(file.data.beliefRatings ?? []);
    await db.beliefEvidence.bulkPut(file.data.beliefEvidence ?? []);
    await db.quoteFavorites.bulkPut(file.data.quoteFavorites ?? []);
    await db.quoteNotes.bulkPut(file.data.quoteNotes ?? []);
  });
}
