import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { logbookGroups } from '../domain/smartLists';
import { formatRelative } from '../domain/dates';
import { reopenProject } from '../db/mutations';
import { ListIcon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { ScreenChrome, EmptyState, createScheduler } from './common';
import { push } from '../app/navigation';
import { ExpandableTask } from '../components/TaskCard';
import type { TaskRowContext } from '../components/TaskRow';
import type { Task } from '../db/models';

const PAGE = 50;

export function LogbookScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const [limit, setLimit] = createSignal(PAGE);
  const { schedule, SchedulerHost } = createScheduler();

  const groups = createMemo(() => logbookGroups(tasks(), projects(), limit()));
  const total = createMemo(() => logbookGroups(tasks(), projects()).reduce((n, g) => n + g.entries.length, 0));
  const shown = createMemo(() => groups().reduce((n, g) => n + g.entries.length, 0));
  const taskById = createMemo(() => new Map(tasks().map((t) => [t.id, t])));

  const ctx = createMemo<TaskRowContext>(() => ({
    tags: tags(),
    onSchedule: schedule,
    showWhen: true,
    showEveningBadge: false,
    noSwipe: true,
  }));

  return (
    <>
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
                    <Show
                      when={entry.kind === 'task'}
                      fallback={
                        <div
                          style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '12px',
                            padding: '10px 16px',
                            cursor: 'pointer',
                          }}
                          onClick={() => push({ name: 'project', id: entry.item.id })}
                        >
                          <ProgressPie progress={1} size={19} color="var(--green)" />
                          <span
                            style={{
                              flex: '1',
                              color: 'var(--text-secondary)',
                              overflow: 'hidden',
                              'text-overflow': 'ellipsis',
                              'white-space': 'nowrap',
                            }}
                          >
                            {entry.item.title || '—'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void reopenProject(entry.item.id);
                            }}
                            style={{ color: 'var(--green)', 'font-size': '13px', padding: '4px 8px' }}
                          >
                            Reopen
                          </button>
                        </div>
                      }
                    >
                      <ExpandableTask
                        task={taskById().get(entry.item.id) ?? (entry.item as Task)}
                        ctx={ctx()}
                      />
                    </Show>
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
      <SchedulerHost />
    </>
  );
}
