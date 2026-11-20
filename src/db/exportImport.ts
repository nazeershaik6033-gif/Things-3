import { db } from './db';
import type { Task, Project, Heading, Area, Tag, Setting, Sprint, EnergyLog } from './models';

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
    /** v2+ (absent in v1 backups) */
    sprints?: Sprint[];
    energyLogs?: EnergyLog[];
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
      sprints: await db.sprints.toArray(),
      energyLogs: await db.energyLogs.toArray(),
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
  if ((d.sprints !== undefined && !Array.isArray(d.sprints)) ||
      (d.energyLogs !== undefined && !Array.isArray(d.energyLogs))) {
    throw new Error('Backup file is malformed.');
  }
  for (const t of d.tasks) {
    if (typeof t.id !== 'string' || typeof t.title !== 'string') {
      throw new Error('Backup file contains invalid tasks.');
    }
  }
  return f as ExportFile;
}

/** Replace-all import (caller confirms with the user first). v1 backups are
 *  upgraded on the way in (focus fields default to null). */
export async function importData(file: ExportFile): Promise<void> {
  const tasks = file.data.tasks.map((t) => ({
    ...t,
    mitDate: t.mitDate ?? null,
    energy: t.energy ?? null,
  }));
  const tables = [db.tasks, db.projects, db.headings, db.areas, db.tags, db.settings, db.sprints, db.energyLogs];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.tasks.bulkPut(tasks);
    await db.projects.bulkPut(file.data.projects);
    await db.headings.bulkPut(file.data.headings);
    await db.areas.bulkPut(file.data.areas);
    await db.tags.bulkPut(file.data.tags);
    await db.settings.bulkPut(file.data.settings);
    await db.sprints.bulkPut(file.data.sprints ?? []);
    await db.energyLogs.bulkPut(file.data.energyLogs ?? []);
  });
}
