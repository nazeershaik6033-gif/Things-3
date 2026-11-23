import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { getSetting, setSetting } from '../db/mutations';
import { syncIssues } from '../db/superMutations';
import { breakSettings, updateBreakSettings } from '../app/timeTracking';
import { requestReminderPermission } from '../app/reminders';
import { push } from '../app/navigation';
import { showToast } from '../app/focusState';
import { parseRepo } from '../domain/issues';
import { fetchIssues } from '../net/github';
import { formatTime } from '../domain/dates';
import { fieldStyle, softButton } from './superCommon';

/** Settings for the features ported from Super Productivity. Rendered inside
 *  the Settings screen's own <Section> cards. */

const note = {
  'font-size': '12px',
  color: 'var(--text-tertiary)',
  padding: '0 0 10px',
  'line-height': '1.5',
} as const;

function Switch(props: { on: boolean; onToggle: () => void; label: string; testid?: string }): JSX.Element {
  return (
    <button
      data-testid={props.testid}
      aria-pressed={props.on}
      onClick={props.onToggle}
      style={{ display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '11px 0', 'text-align': 'left' }}
    >
      <span style={{ flex: '1', 'font-size': '15px' }}>{props.label}</span>
      <span style={{
        width: '46px', height: '28px', 'border-radius': '999px', position: 'relative', flex: 'none',
        background: props.on ? 'var(--green)' : 'var(--check-border)', transition: 'background 160ms ease',
      }}>
        <span style={{
          position: 'absolute', top: '2px', left: '2px', width: '24px', height: '24px', 'border-radius': '50%',
          background: '#fff', 'box-shadow': '0 1px 3px rgba(0,0,0,0.3)',
          transform: props.on ? 'translateX(18px)' : 'none',
          transition: 'transform 160ms cubic-bezier(0.22, 0.9, 0.28, 1)',
        }} />
      </span>
    </button>
  );
}

export function TimeTrackingSettings(): JSX.Element {
  return (
    <>
      <Switch
        testid="toggle-break-reminder"
        label="Remind me to take breaks"
        on={breakSettings().enabled}
        onToggle={() => {
          const next = !breakSettings().enabled;
          void updateBreakSettings({ enabled: next });
          if (next) void requestReminderPermission();
        }}
      />
      <Show when={breakSettings().enabled}>
        <label style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '0 0 10px', 'font-size': '15px' }}>
          <span style={{ flex: '1' }}>After this many minutes of tracked work</span>
          <input
            data-testid="break-minutes"
            type="number"
            min="5"
            max="240"
            value={breakSettings().afterMin}
            onChange={(e) => void updateBreakSettings({ afterMin: Number(e.currentTarget.value) })}
            style={{ ...fieldStyle, width: '76px', padding: '6px 10px' }}
          />
        </label>
      </Show>
      <div style={note}>
        Tap <b>Track</b> on any to-do to time it; only one runs at a time and it keeps going if you
        lock the phone. Switching to-dos within 5 minutes counts as the same stretch of work; the
        break reminder fires once per stretch. Finished Focus Sprints count toward their to-do too.
      </div>
      <button
        data-testid="open-worklog"
        onClick={() => push({ name: 'worklog' })}
        style={{ color: 'var(--blue)', 'font-size': '15px', 'font-weight': '600', padding: '0 0 12px' }}
      >
        Open Worklog
      </button>
    </>
  );
}

const SYNTAX: [string, string][] = [
  ['#tag', 'add a tag (new tags are created)'],
  ['+proj', 'file into a project (prefix match)'],
  ['@tomorrow', 'today · tonight · mon…sun · 3d · 2w · someday · 2026-12-24'],
  ['!fri', 'deadline (same date words)'],
  ['~45m', 'time estimate: 30m · 1h · 1h30m · 1.5h'],
];

export function ShortSyntaxHelp(): JSX.Element {
  return (
    <div style={{ padding: '8px 0 10px' }}>
      <div style={{ 'font-size': '14px', padding: '0 0 8px' }}>
        Type it all in Quick Entry: <code style={{ color: 'var(--blue)' }}>Call Anna #work +clarity @tomorrow ~30m</code>
      </div>
      <For each={SYNTAX}>
        {([tok, desc]) => (
          <div style={{ display: 'flex', gap: '10px', 'font-size': '13px', padding: '2px 0' }}>
            <code style={{ width: '82px', flex: 'none', color: 'var(--blue)', 'font-weight': '600' }}>{tok}</code>
            <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
          </div>
        )}
      </For>
    </div>
  );
}

interface GitHubConfig {
  repo: string;
  projectId: string | null;
  lastSyncAt: number | null;
}

/** The token lives under its own key so the backup export can leave it out. */
export const GITHUB_TOKEN_KEY = 'githubToken';

export function GitHubSettings(): JSX.Element {
  const [cfg, setCfg] = createSignal<GitHubConfig>({ repo: '', projectId: null, lastSyncAt: null });
  const [token, setToken] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const projects = createLiveQuery(() => db.projects.toArray(), []);

  onMount(async () => {
    setCfg({ repo: '', projectId: null, lastSyncAt: null, ...(await getSetting<Partial<GitHubConfig>>('github', {})) });
    setToken(await getSetting<string>(GITHUB_TOKEN_KEY, ''));
  });

  const save = (patch: Partial<GitHubConfig>) => {
    const next = { ...cfg(), ...patch };
    setCfg(next);
    void setSetting('github', next);
  };

  const sync = async () => {
    const r = parseRepo(cfg().repo);
    if (!r) {
      setError('Enter a repository as owner/name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const issues = await fetchIssues(r, { token: token().trim() || undefined });
      const res = await syncIssues(r, issues, cfg().projectId);
      save({ projectId: res.projectId, lastSyncAt: Date.now() });
      showToast(`${res.created} new · ${res.completed} closed · ${res.reopened} reopened`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', padding: '10px 0' }}>
      <input
        data-testid="github-repo"
        value={cfg().repo}
        placeholder="owner/repository"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        onChange={(e) => save({ repo: e.currentTarget.value.trim() })}
        style={fieldStyle}
      />
      <input
        data-testid="github-token"
        type="password"
        value={token()}
        placeholder="Token (optional — private repos, higher limits)"
        autocomplete="off"
        onChange={(e) => {
          setToken(e.currentTarget.value.trim());
          void setSetting(GITHUB_TOKEN_KEY, e.currentTarget.value.trim());
        }}
        style={fieldStyle}
      />
      <select
        data-testid="github-project"
        value={cfg().projectId ?? ''}
        onChange={(e) => save({ projectId: e.currentTarget.value || null })}
        style={fieldStyle}
      >
        <option value="">New project named after the repo</option>
        <For each={projects().filter((p) => p.trashedAt === null && p.status === 'open')}>
          {(p) => <option value={p.id}>{p.title || 'New Project'}</option>}
        </For>
      </select>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
        <button data-testid="github-sync" disabled={busy()} onClick={() => void sync()} style={{ ...softButton, color: 'var(--blue)' }}>
          {busy() ? 'Syncing…' : 'Import & sync issues'}
        </button>
        <Show when={cfg().lastSyncAt}>
          <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>Last sync {formatTime(cfg().lastSyncAt!)}</span>
        </Show>
      </div>
      <Show when={error()}>
        <div data-testid="github-error" style={{ 'font-size': '13px', color: 'var(--red)' }}>{error()}</div>
      </Show>
      <div style={note}>
        Open issues become to-dos (labels become tags); syncing again adds new ones, ticks off
        issues closed on GitHub and reopens ones reopened there. Your own dates, notes and checklists
        are never overwritten. Requests go straight to api.github.com; the token stays on this device
        and is left out of backups. Use a fine-grained token with read-only Issues access.
      </div>
    </div>
  );
}
