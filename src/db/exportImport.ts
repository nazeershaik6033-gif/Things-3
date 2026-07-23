import { db } from './db';
import type {
  Task, Project, Heading, Area, Tag, Setting,
  Board, BoardList, BoardLabel, Card,
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
    // Board data is optional so v1 backups still import cleanly.
    boards?: Board[];
    boardLists?: BoardList[];
    boardLabels?: BoardLabel[];
    cards?: Card[];
  };
}

export const SCHEMA_VERSION = 2;

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
    },
  };
}

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
  for (const t of d.tasks) {
    if (typeof t.id !== 'string' || typeof t.title !== 'string') {
      throw new Error('Backup file contains invalid tasks.');
    }
  }
  return f as ExportFile;
}

/** Replace-all import (caller confirms with the user first). */
export async function importData(file: ExportFile): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.projects, db.headings, db.areas, db.tags, db.settings,
      db.boards, db.boardLists, db.boardLabels, db.cards],
    async () => {
      await Promise.all([
        db.tasks.clear(), db.projects.clear(), db.headings.clear(),
        db.areas.clear(), db.tags.clear(), db.settings.clear(),
        db.boards.clear(), db.boardLists.clear(), db.boardLabels.clear(), db.cards.clear(),
      ]);
      await db.tasks.bulkPut(file.data.tasks);
      await db.projects.bulkPut(file.data.projects);
      await db.headings.bulkPut(file.data.headings);
      await db.areas.bulkPut(file.data.areas);
      await db.tags.bulkPut(file.data.tags);
      await db.settings.bulkPut(file.data.settings);
      await db.boards.bulkPut(file.data.boards ?? []);
      await db.boardLists.bulkPut(file.data.boardLists ?? []);
      await db.boardLabels.bulkPut(file.data.boardLabels ?? []);
      await db.cards.bulkPut(file.data.cards ?? []);
    },
  );
}
