import type { Task, Project, Area, Tag } from '../db/models';
import { isLive } from './smartLists';

export type SearchResult =
  | { kind: 'task'; id: string; title: string; subtitle: string }
  | { kind: 'project'; id: string; title: string; subtitle: string }
  | { kind: 'area'; id: string; title: string }
  | { kind: 'tag'; id: string; title: string };

/** Case-insensitive word-prefix match: "gro li" matches "Grocery List". */
export function matches(query: string, text: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const target = text.toLowerCase();
  const targetWords = target.split(/\s+/);
  return words.every(
    (w) => target.includes(w) || targetWords.some((tw) => tw.startsWith(w)),
  );
}

export function search(
  query: string,
  data: { tasks: Task[]; projects: Project[]; areas: Area[]; tags: Tag[] },
  limit = 30,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const results: SearchResult[] = [];
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const areaById = new Map(data.areas.map((a) => [a.id, a]));

  for (const p of data.projects) {
    if (isLive(p) && matches(q, p.title)) {
      const area = p.areaId ? areaById.get(p.areaId) : undefined;
      results.push({ kind: 'project', id: p.id, title: p.title, subtitle: area?.title ?? '' });
    }
  }
  for (const a of data.areas) {
    if (matches(q, a.title)) results.push({ kind: 'area', id: a.id, title: a.title });
  }
  for (const t of data.tags) {
    if (matches(q, t.title)) results.push({ kind: 'tag', id: t.id, title: t.title });
  }
  for (const t of data.tasks) {
    if (!isLive(t)) continue;
    if (matches(q, t.title) || (t.notes && matches(q, t.notes))) {
      const project = t.projectId ? projectById.get(t.projectId) : undefined;
      const area = t.areaId ? areaById.get(t.areaId) : undefined;
      results.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        subtitle: project?.title ?? area?.title ?? (t.status !== 'open' ? 'Logbook' : ''),
      });
    }
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}
