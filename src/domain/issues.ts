import type { Task } from '../db/models';

/** Issue import, ported from Super Productivity's issue providers (GitHub
 *  here: its REST API allows browser requests, so no server is needed).
 *  Issues become ordinary to-dos tagged with an `issueRef`; re-syncing adds
 *  new ones, completes the ones closed upstream and refreshes titles —
 *  but never touches what you planned locally (dates, notes, checklist). */

export interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  body: string | null;
  labels: { name: string }[];
  pull_request?: unknown;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Accepts "owner/repo", "github.com/owner/repo" or a full URL. */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export function issueRef(r: RepoRef, n: number): string {
  return `github:${r.owner}/${r.repo}#${n}`;
}

export function repoPrefix(r: RepoRef): string {
  return `github:${r.owner}/${r.repo}#`;
}

export interface IssueSyncPlan {
  create: GhIssue[];
  complete: string[]; // task ids closed upstream
  reopen: string[]; // task ids reopened upstream
  retitle: { id: string; title: string }[];
}

export function planIssueSync(r: RepoRef, issues: GhIssue[], tasks: Task[]): IssueSyncPlan {
  const prefix = repoPrefix(r);
  const byRef = new Map<string, Task>();
  for (const t of tasks) if (t.issueRef?.startsWith(prefix) && t.trashedAt === null) byRef.set(t.issueRef, t);
  const plan: IssueSyncPlan = { create: [], complete: [], reopen: [], retitle: [] };
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const t = byRef.get(issueRef(r, issue.number));
    const title = issueTitle(issue);
    if (!t) {
      if (issue.state === 'open') plan.create.push(issue);
      continue;
    }
    if (issue.state === 'closed' && t.status === 'open') plan.complete.push(t.id);
    if (issue.state === 'open' && t.status === 'completed') plan.reopen.push(t.id);
    if (t.title !== title) plan.retitle.push({ id: t.id, title });
  }
  return plan;
}

export function issueTitle(issue: GhIssue): string {
  return `#${issue.number} ${issue.title}`.trim();
}

/** Notes for a new issue to-do: the link first, then the body (trimmed). */
export function issueNotes(issue: GhIssue): string {
  const body = (issue.body ?? '').trim();
  const clipped = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
  return clipped ? `${issue.html_url}\n\n${clipped}` : issue.html_url;
}
