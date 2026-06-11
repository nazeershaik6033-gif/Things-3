import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { search, type SearchResult } from '../domain/search';
import { searchOpen, setSearchOpen, setExpandedTaskId } from '../app/uiState';
import { push, stack, type Route } from '../app/navigation';
import { Icon, ListIcon } from '../ui/Icon';

const QUICK_LISTS: { route: Route; label: string; list: string }[] = [
  { route: { name: 'list', list: 'inbox' }, label: 'Inbox', list: 'inbox' },
  { route: { name: 'list', list: 'today' }, label: 'Today', list: 'today' },
  { route: { name: 'list', list: 'upcoming' }, label: 'Upcoming', list: 'upcoming' },
  { route: { name: 'list', list: 'anytime' }, label: 'Anytime', list: 'anytime' },
  { route: { name: 'list', list: 'someday' }, label: 'Someday', list: 'someday' },
  { route: { name: 'list', list: 'logbook' }, label: 'Logbook', list: 'logbook' },
];

/** Quick Find: full-screen overlay with live results across everything. */
export function SearchOverlay(): JSX.Element {
  return (
    <Show when={searchOpen()}>
      <SearchInner />
    </Show>
  );
}

function SearchInner(): JSX.Element {
  const [query, setQuery] = createSignal('');
  let inputEl!: HTMLInputElement;

  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);

  const results = createMemo(() =>
    search(query(), { tasks: tasks(), projects: projects(), areas: areas(), tags: tags() }),
  );

  onMount(() => inputEl.focus());

  const navigateTo = (result: SearchResult) => {
    setSearchOpen(false);
    switch (result.kind) {
      case 'project': push({ name: 'project', id: result.id }); break;
      case 'area': push({ name: 'area', id: result.id }); break;
      case 'tag': push({ name: 'tag', id: result.id }); break;
      case 'task': {
        const t = tasks().find((x) => x.id === result.id);
        if (!t) return;
        // Open the task where it lives
        if (t.projectId) push({ name: 'project', id: t.projectId });
        else if (t.trashedAt !== null) push({ name: 'list', list: 'trash' });
        else if (t.status !== 'open') push({ name: 'list', list: 'logbook' });
        else if (t.bucket === 'inbox') push({ name: 'list', list: 'inbox' });
        else if (t.areaId) push({ name: 'area', id: t.areaId });
        else if (t.bucket === 'someday') push({ name: 'list', list: 'someday' });
        else push({ name: 'list', list: 'anytime' });
        if (t.status === 'open' && t.trashedAt === null) {
          setTimeout(() => setExpandedTaskId(t.id), 450);
        }
        break;
      }
    }
  };

  const iconFor = (r: SearchResult): JSX.Element => {
    switch (r.kind) {
      case 'project': return <Icon name="pie" size={18} color="var(--blue)" />;
      case 'area': return <Icon name="hexagon" size={18} color="var(--teal)" />;
      case 'tag': return <Icon name="tag" size={18} color="var(--green)" />;
      default: return <Icon name="check" size={16} color="var(--text-tertiary)" />;
    }
  };

  return (
    <Portal>
      <div
        data-testid="search-overlay"
        style={{
          position: 'fixed',
          inset: '0',
          'z-index': '90',
          background: 'var(--bg-list)',
          display: 'flex',
          'flex-direction': 'column',
          animation: 'fade-in 150ms ease-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '10px',
            padding: `calc(var(--safe-top) + 12px) 16px 10px`,
          }}
        >
          <div
            style={{
              flex: '1',
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              background: 'var(--bg-inset)',
              'border-radius': '11px',
              padding: '8px 12px',
            }}
          >
            <Icon name="search" size={16} color="var(--text-secondary)" />
            <input
              ref={inputEl}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Quick Find"
              style={{ flex: '1', 'font-size': '16px' }}
              data-testid="search-input"
            />
          </div>
          <button
            onClick={() => setSearchOpen(false)}
            style={{ color: 'var(--blue)', 'font-size': '16px', 'font-weight': '500' }}
          >
            Cancel
          </button>
        </div>

        <div class="screen-scroll">
          <Show
            when={query().trim()}
            fallback={
              <For each={QUICK_LISTS.filter((q) => {
                const top = stack()[stack().length - 1]!.route;
                return !(top.name === 'list' && top.list === q.list);
              })}>
                {(q) => (
                  <button
                    onClick={() => {
                      setSearchOpen(false);
                      push(q.route);
                    }}
                    style={{ display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '11px 16px', 'font-size': '16px', color: 'var(--text)', 'text-align': 'left' }}
                  >
                    <ListIcon list={q.list} size={20} />
                    {q.label}
                  </button>
                )}
              </For>
            }
          >
            <Show when={results().length > 0} fallback={
              <div style={{ padding: '40px', 'text-align': 'center', color: 'var(--text-tertiary)' }}>No results</div>
            }>
              <For each={results()}>
                {(r) => (
                  <button
                    onClick={() => navigateTo(r)}
                    style={{ display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '10px 16px', color: 'var(--text)', 'text-align': 'left' }}
                  >
                    {iconFor(r)}
                    <span style={{ flex: '1', 'min-width': '0' }}>
                      <span style={{ display: 'block', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'font-size': '16px' }}>
                        {r.title || '—'}
                      </span>
                      <Show when={'subtitle' in r && r.subtitle}>
                        <span style={{ display: 'block', 'font-size': '13px', color: 'var(--text-secondary)' }}>
                          {(r as { subtitle: string }).subtitle}
                        </span>
                      </Show>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
