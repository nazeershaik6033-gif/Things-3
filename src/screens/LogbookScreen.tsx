import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { logbookGroups } from '../domain/smartLists';
import { formatRelative } from '../domain/dates';
import { reopenTask, reopenProject } from '../db/mutations';
import { ListIcon, Icon } from '../ui/Icon';
import { Checkbox } from '../ui/Checkbox';
import { ProgressPie } from '../ui/ProgressPie';
import { ScreenChrome, EmptyState } from './common';
import { push } from '../app/navigation';

const PAGE = 50;

export function LogbookScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const [limit, setLimit] = createSignal(PAGE);

  const groups = createMemo(() => logbookGroups(tasks(), projects(), limit()));
  const total = createMemo(() => logbookGroups(tasks(), projects()).reduce((n, g) => n + g.entries.length, 0));
  const shown = createMemo(() => groups().reduce((n, g) => n + g.entries.length, 0));

  return (
    <ScreenChrome title="Logbook" icon={<ListIcon list="logbook" size={30} />}>
      <Show
        when={groups().length > 0}
        fallback={<EmptyState icon={<ListIcon list="logbook" size={44} />} text="Completed to-dos and projects are logged here." />}
      >
        <For each={groups()}>
          {(group) => (
            <>
              <div
                style={{
                  padding: '16px 16px 4px',
                  'border-bottom': '1px solid var(--separator)',
                  'font-weight': '600',
                  'font-size': '14px',
                  color: 'var(--green)',
                }}
              >
                {formatRelative(group.date, currentDate())}
              </div>
              <For each={group.entries}>
                {(entry) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '12px',
                      padding: '10px 16px',
                    }}
                    onClick={() => {
                      if (entry.kind === 'project') push({ name: 'project', id: entry.item.id });
                    }}
                  >
                    <Show
                      when={entry.kind === 'task'}
                      fallback={<ProgressPie progress={1} size={19} color="var(--green)" />}
                    >
                      <Checkbox
                        checked
                        canceled={entry.item.status === 'canceled'}
                        onToggle={() => {
                          if (entry.kind === 'task') void reopenTask(entry.item.id);
                          else void reopenProject(entry.item.id);
                        }}
                      />
                    </Show>
                    <span
                      style={{
                        flex: '1',
                        color: 'var(--text-secondary)',
                        'text-decoration': entry.item.status === 'canceled' ? 'line-through' : 'none',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {entry.item.title || '—'}
                    </span>
                    <Show when={entry.item.status === 'canceled'}>
                      <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>canceled</span>
                    </Show>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
        <Show when={shown() < total()}>
          <button
            onClick={() => setLimit(limit() + PAGE)}
            style={{ color: 'var(--blue)', padding: '14px 16px', 'font-size': '15px', 'font-weight': '500' }}
          >
            Show more
          </button>
        </Show>
      </Show>
    </ScreenChrome>
  );
}

export { Icon };
