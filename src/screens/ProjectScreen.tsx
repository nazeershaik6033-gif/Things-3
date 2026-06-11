import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { back } from '../app/navigation';
import { projectSections, projectProgress } from '../domain/smartLists';
import { graceIds, withGrace, type QuickEntryState } from '../app/uiState';
import {
  completeProject, createHeading, deleteHeading, reopenProject,
  trashProject, updateHeading, updateProject,
} from '../db/mutations';
import { keyAtIndex } from '../db/ordering';
import { setTaskOrder, updateTask } from '../db/mutations';
import { Icon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { ExpandableTask } from '../components/TaskCard';
import { AnimatedRows } from '../components/AnimatedRows';
import { ReorderGroup, type DropInfo } from '../components/ReorderGroup';
import { MagicPlus, type MagicPlusDrop } from '../components/MagicPlus';
import { ScreenChrome, EmptyState, MenuRow, createScheduler } from './common';
import { TaskRow, type TaskRowContext } from '../components/TaskRow';
import type { Task } from '../db/models';

export function ProjectScreen(props: { id: string }): JSX.Element {
  const project = createLiveQuery(async () => (await db.projects.get(props.id)) ?? null, null);
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const headings = createLiveQuery(() => db.headings.where('projectId').equals(props.id).toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const { schedule, SchedulerHost } = createScheduler();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [showLogged, setShowLogged] = createSignal(false);
  const [headingMenu, setHeadingMenu] = createSignal<string | null>(null);
  let scrollEl: HTMLDivElement | undefined;

  const ctx = createMemo<TaskRowContext>(() => ({
    tags: tags(),
    onSchedule: schedule,
    showWhen: true,
  }));

  /** Open tasks honoring the grace window so completion lingers in place. */
  const sections = createMemo(() => {
    graceIds();
    const open = tasks().map((t) =>
      graceIds().has(t.id) && t.status !== 'open' ? { ...t, status: 'open' as const } : t,
    );
    return projectSections(open, headings(), props.id, currentDate());
  });

  const progress = createMemo(() => projectProgress(tasks(), props.id));

  const sectionIdOf = (headingId: string | null) => headingId ?? 'root';

  const handleDrop = (info: DropInfo) => {
    const headingId = info.section === 'root' ? null : info.section;
    const section = sections().sections.find((s) => (s.heading?.id ?? null) === headingId);
    if (!section) return;
    const dragged = tasks().find((t) => t.id === info.key);
    if (!dragged) return;
    const items = section.tasks.filter((t) => t.id !== info.key);
    const orderKey = keyAtIndex(items, Math.min(info.index, items.length));
    if ((dragged.headingId ?? null) === headingId) {
      void setTaskOrder(info.key, orderKey);
    } else {
      void updateTask(info.key, { headingId, orderKey });
    }
  };

  const entryForDrop = (drop: MagicPlusDrop): QuickEntryState | null => {
    const headingId = drop.section === 'root' || drop.section === '' ? null : drop.section;
    const section = sections().sections.find((s) => (s.heading?.id ?? null) === headingId);
    let orderKey: string | undefined;
    if (section) {
      const idx = drop.beforeKey
        ? section.tasks.findIndex((t) => t.id === drop.beforeKey)
        : section.tasks.length;
      orderKey = keyAtIndex(section.tasks, idx < 0 ? section.tasks.length : idx);
    }
    return {
      destination: { projectId: props.id, headingId },
      ...(orderKey !== undefined ? { orderKey } : {}),
    };
  };

  const renderRows = (items: Task[], section: string) => (
    <AnimatedRows items={items} key={(t) => t.id}>
      {(task) => (
        <div data-reorder-row data-key={task.id} data-section={section}>
          <ExpandableTask task={task} ctx={ctx()} />
        </div>
      )}
    </AnimatedRows>
  );

  return (
    <Show when={project()}>
      <ScreenChrome
        title={project()!.title || 'New Project'}
        titleEl={
          <input
            value={project()!.title}
            placeholder="New Project"
            data-testid="project-title"
            onInput={(e) => void updateProject(props.id, { title: e.currentTarget.value })}
            style={{ width: '100%', 'font-size': 'var(--fs-title)', 'font-weight': '700' }}
          />
        }
        icon={<ProgressPie progress={progress()} size={26} />}
        scrollRef={(el) => (scrollEl = el)}
        trailing={
          <button
            aria-label="Project menu"
            data-testid="project-menu"
            onClick={() => setMenuOpen(true)}
            style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}
          >
            <Icon name="ellipsis" size={20} />
          </button>
        }
      >
        {/* Editable notes */}
        <div style={{ padding: '0 16px 6px' }}>
          <textarea
            value={project()!.notes}
            placeholder="Notes"
            rows={1}
            onInput={(e) => {
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
              void updateProject(props.id, { notes: e.currentTarget.value });
            }}
            style={{ width: '100%', 'font-size': '15px', color: 'var(--text-secondary)', overflow: 'hidden' }}
          />
        </div>

        <Show
          when={sections().sections.some((s) => s.tasks.length > 0) || headings().length > 0 || sections().loggedToday.length > 0}
          fallback={<EmptyState icon={<ProgressPie progress={0} size={40} />} text="No to-dos yet — add the first step." />}
        >
          <ReorderGroup onDrop={handleDrop} scrollParent={() => scrollEl ?? null}>
            <For each={sections().sections}>
              {(section) => (
                <>
                  <Show when={section.heading}>
                    <div
                      style={{
                        display: 'flex',
                        'align-items': 'center',
                        padding: '18px 16px 4px',
                        'border-bottom': '1px solid var(--separator)',
                        margin: '0 0 4px',
                      }}
                    >
                      <input
                        value={section.heading!.title}
                        placeholder="Heading"
                        onInput={(e) => void updateHeading(section.heading!.id, { title: e.currentTarget.value })}
                        style={{ flex: '1', color: 'var(--blue)', 'font-weight': '600', 'font-size': '16px' }}
                      />
                      <button
                        aria-label="Heading menu"
                        onClick={() => setHeadingMenu(section.heading!.id)}
                        style={{ color: 'var(--text-tertiary)', padding: '4px 6px', display: 'flex' }}
                      >
                        <Icon name="ellipsis" size={17} />
                      </button>
                    </div>
                  </Show>
                  {renderRows(section.tasks, sectionIdOf(section.heading?.id ?? null))}
                </>
              )}
            </For>
          </ReorderGroup>
        </Show>

        {/* Logged items */}
        <Show when={sections().loggedToday.length > 0}>
          <div style={{ 'border-top': '1px solid var(--separator)', 'margin-top': '12px' }}>
            <For each={sections().loggedToday}>
              {(task) => <TaskRow task={task} ctx={{ ...ctx(), noSwipe: true }} />}
            </For>
          </div>
        </Show>
        <Show when={sections().loggedOlder.length > 0}>
          <button
            onClick={() => setShowLogged(!showLogged())}
            style={{ color: 'var(--text-secondary)', 'font-size': '14px', padding: '12px 16px' }}
          >
            {showLogged() ? 'Hide logged items' : `Show ${sections().loggedOlder.length} logged items`}
          </button>
          <Show when={showLogged()}>
            <For each={sections().loggedOlder}>
              {(task) => <TaskRow task={task} ctx={{ ...ctx(), noSwipe: true }} />}
            </For>
          </Show>
        </Show>
      </ScreenChrome>

      <MagicPlus
        defaultEntry={() => ({ destination: { projectId: props.id } })}
        entryForDrop={entryForDrop}
        listEl={() => scrollEl ?? null}
      />
      <SchedulerHost />

      <Show when={menuOpen()}>
        <Sheet onClose={() => setMenuOpen(false)} dragAnywhere>
          <SheetTitle>{project()!.title || 'Project'}</SheetTitle>
          <Show when={project()!.status === 'open'} fallback={
            <MenuRow icon={<Icon name="restore" size={20} />} label="Reopen Project" onClick={() => { void reopenProject(props.id); setMenuOpen(false); }} />
          }>
            <MenuRow
              icon={<Icon name="check" size={20} color="var(--blue)" />}
              label="Complete Project"
              onClick={() => {
                void completeProject(props.id);
                setMenuOpen(false);
                back();
              }}
            />
            <MenuRow
              icon={<Icon name="close" size={20} color="var(--text-secondary)" />}
              label="Cancel Project"
              onClick={() => {
                void completeProject(props.id, true);
                setMenuOpen(false);
                back();
              }}
            />
            <MenuRow
              icon={<Icon name="heading" size={20} color="var(--blue)" />}
              label="Add Heading"
              onClick={() => {
                void createHeading(props.id, '');
                setMenuOpen(false);
              }}
            />
          </Show>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Delete Project"
            onClick={() => {
              void trashProject(props.id);
              setMenuOpen(false);
              back();
            }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>

      <Show when={headingMenu()}>
        <Sheet onClose={() => setHeadingMenu(null)} dragAnywhere>
          <SheetTitle>Heading</SheetTitle>
          <MenuRow
            icon={<Icon name="trash" size={20} />}
            danger
            label="Delete Heading (keep to-dos)"
            onClick={() => {
              void deleteHeading(headingMenu()!);
              setHeadingMenu(null);
            }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </Show>
  );
}
