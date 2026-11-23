import type { GhIssue, RepoRef } from '../domain/issues';

/** GitHub REST client for issue import. api.github.com sends CORS headers,
 *  so this talks to it directly — no proxy sees the token. Unauthenticated
 *  requests work for public repos (60/hour); a fine-grained token with
 *  read-only Issues access lifts that and reaches private repos. */

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export async function fetchIssues(
  r: RepoRef,
  opts: { token?: string; state?: 'open' | 'all'; assignee?: string } = {},
): Promise<GhIssue[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const out: GhIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      state: opts.state ?? 'all',
      per_page: String(PAGE_SIZE),
      page: String(page),
      sort: 'updated',
      direction: 'desc',
    });
    if (opts.assignee) q.set('assignee', opts.assignee);
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/issues?${q}`,
      { headers },
    );
    if (res.status === 404) throw new Error('Repository not found (or private — add a token).');
    if (res.status === 401) throw new Error('GitHub rejected the token.');
    if (res.status === 403) throw new Error('GitHub rate limit reached — add a token or try later.');
    if (!res.ok) throw new Error(`GitHub error ${res.status}.`);
    const batch = (await res.json()) as GhIssue[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}
