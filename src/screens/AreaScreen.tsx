import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { back, push } from '../app/navigation';
import { graceIds, withGrace } from '../app/uiState';
import { isLive, isOpen, projectProgress, inAnytime, inSomeday, inToday, inUpcoming, inInbox } from '../domain/smartLists';
import { deleteArea, updateArea } from '../db/mutations';
import { keyAtIndex, sortByOrderKey } from '../db/ordering';
import { setTaskOrder } from '../db/mutations';
import { Icon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { ExpandableTask } from '../components/TaskCard';
import { AnimatedRows } from '../components/AnimatedRows';
import { ReorderGroup, type DropInfo } from '../components/ReorderGroup';
import { MagicPlus } from '../components/MagicPlus';
import { ScreenChrome, MenuRow, createScheduler, EmptyState } from './common';
import type { TaskRowContext } from '../components/TaskRow';
import type { Task } from '../db/models';

export function AreaScreen(props: { id: string }): JSX.Element {
  const area = createLiveQuery(async () => (await db.areas.get(props.id)) ?? null, null);
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const { schedule, SchedulerHost } = createScheduler();
  const [menuOpen, setMenuOpen] = createSignal(false);
  let scrollEl: HTMLDivElement | undefined;

  const ctx = createMemo<TaskRowContext>(() => ({ tags: tags(), onSchedule: schedule, showWhen: true }));

  const looseTasks = createMemo<Task[]>(() => {
    graceIds();
    const today = currentDate();
    return sortByOrderKey(
      tasks().filter(
        withGrace((t) =>
          !t.projectId && t.areaId === props.id &&
          (inAnytime(t, today) || inSomeday(t) || inToday(t, today) || inUpcoming(t, today) || inInbox(t)),
        ),
      ),
    );
  });

  const areaProjects = createMemo(() =>
    sortByOrderKey(projects().filter((p) => p.areaId === props.id && isLive(p) && isOpen(p))),
  );

  const handleDrop = (info: DropInfo) => {
    const items = looseTasks().filter((t) => t.id !== info.key);
    void setTaskOrder(info.key, keyAtIndex(items, Math.min(info.index, items.length)));
  };

  return (
    <Show when={area()}>
      <ScreenChrome
        title={area()!.title || 'New Area'}
        titleEl={
          <input
            value={area()!.title}
            placeholder="New Area"
            data-testid="area-title"
            onInput={(e) => void updateArea(props.id, { title: e.currentTarget.value })}
            style={{ width: '100%', 'font-size': 'var(--fs-title)', 'font-weight': '700' }}
          />
        }
        icon={<Icon name="hexagon" size={26} color="var(--teal)" />}
        scrollRef={(el) => (scrollEl = el)}
        trailing={
          <button
            aria-label="Area menu"
            onClick={() => setMenuOpen(true)}
            style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}
          >
            <Icon name="ellipsis" size={20} />
          </button>
        }
      >
        <Show when={areaProjects().length > 0}>
          <For each={areaProjects()}>
            {(p) => (
              <button
                onClick={() => push({ name: 'project', id: p.id })}
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '11px 16px',
                  'font-size': '17px',
                  color: 'var(--text)',
                  'text-align': 'left',
                }}
              >
                <ProgressPie progress={projectProgress(tasks(), p.id)} size={21} />
                <span style={{ flex: '1' }}>{p.title || 'New Project'}</span>
                <Icon name="chevron-right" size={14} color="var(--text-tertiary)" />
              </button>
            )}
          </For>
        </Show>

        <Show
          when={looseTasks().length > 0}
          fallback={
            <Show when={areaProjects().length === 0}>
              <EmptyState icon={<Icon name="hexagon" size={40} color="var(--teal)" />} text="Group projects and to-dos by sphere of life." />
            </Show>
          }
        >
          <ReorderGroup onDrop={handleDrop} scrollParent={() => scrollEl ?? null}>
            <AnimatedRows items={looseTasks()} key={(t) => t.id}>
              {(task) => (
                <div data-reorder-row data-key={task().id} data-section="area">
                  <ExpandableTask task={task()} ctx={ctx()} />
                </div>
              )}
            </AnimatedRows>
          </ReorderGroup>
        </Show>
      </ScreenChrome>

      <MagicPlus
        defaultEntry={() => ({ destination: { areaId: props.id } })}
        listEl={() => scrollEl ?? null}
        entryForDrop={() => ({ destination: { areaId: props.id } })}
      />
      <SchedulerHost />

      <Show when={menuOpen()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>{area()!.title || 'Area'}</SheetTitle>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Delete Area (keep contents)"
            onClick={() => {
              void deleteArea(props.id);
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
