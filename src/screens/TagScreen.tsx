import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { graceIds, withGrace } from '../app/uiState';
import { isLive, isOpen } from '../domain/smartLists';
import { sortByOrderKey } from '../db/ordering';
import { deleteTag, updateTag } from '../db/mutations';
import { back } from '../app/navigation';
import { Icon } from '../ui/Icon';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { ExpandableTask } from '../components/TaskCard';
import { AnimatedRows } from '../components/AnimatedRows';
import { MagicPlus } from '../components/MagicPlus';
import { ScreenChrome, MenuRow, createScheduler, EmptyState } from './common';
import type { TaskRowContext } from '../components/TaskRow';

export function TagScreen(props: { id: string }): JSX.Element {
  const tag = createLiveQuery(async () => (await db.tags.get(props.id)) ?? null, null);
  const tasks = createLiveQuery(() => db.tasks.where('tagIds').equals(props.id).toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const { schedule, SchedulerHost } = createScheduler();
  const [menuOpen, setMenuOpen] = createSignal(false);

  const ctx = createMemo<TaskRowContext>(() => ({ tags: tags(), onSchedule: schedule, showWhen: true }));

  const visible = createMemo(() => {
    graceIds();
    return sortByOrderKey(tasks().filter(withGrace((t) => isLive(t) && isOpen(t))));
  });

  return (
    <Show when={tag()}>
      <ScreenChrome
        title={tag()!.title}
        titleEl={
          <input
            value={tag()!.title}
            onInput={(e) => void updateTag(props.id, { title: e.currentTarget.value })}
            style={{ width: '100%', 'font-size': 'var(--fs-title)', 'font-weight': '700' }}
          />
        }
        icon={<Icon name="tag" size={26} color="var(--green)" />}
        trailing={
          <button
            aria-label="Tag menu"
            onClick={() => setMenuOpen(true)}
            style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}
          >
            <Icon name="ellipsis" size={20} />
          </button>
        }
      >
        <Show
          when={visible().length > 0}
          fallback={<EmptyState icon={<Icon name="tag" size={40} color="var(--green)" />} text="No open to-dos with this tag." />}
        >
          <AnimatedRows items={visible()} key={(t) => t.id}>
            {(task) => <ExpandableTask task={task} ctx={ctx()} />}
          </AnimatedRows>
        </Show>
      </ScreenChrome>

      <MagicPlus defaultEntry={() => ({ destination: { bucket: 'inbox' } })} />
      <SchedulerHost />

      <Show when={menuOpen()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>{tag()!.title}</SheetTitle>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Delete Tag"
            onClick={() => {
              void deleteTag(props.id);
              setMenuOpen(false);
              back();
            }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </Show>
  );
}
