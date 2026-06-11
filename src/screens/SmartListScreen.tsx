import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import type { BuiltinList } from '../app/navigation';
import type { Task } from '../db/models';
import {
  inInbox, inToday, inUpcoming, inAnytime, inSomeday,
  todayTasks, upcomingGroups, groupByHome, todaySortKey,
} from '../domain/smartLists';
import { withGrace, graceIds } from '../app/uiState';
import { keyAtIndex, sortByOrderKey } from '../db/ordering';
import {
  moveTask, reorderToday, setTaskOrder, updateTask,
} from '../db/mutations';
import { Icon, ListIcon } from '../ui/Icon';
import { ExpandableTask } from '../components/TaskCard';
import { AnimatedRows } from '../components/AnimatedRows';
import { ReorderGroup, type DropInfo } from '../components/ReorderGroup';
import { MagicPlus, type MagicPlusDrop } from '../components/MagicPlus';
import { CalendarBlock } from '../components/CalendarBlock';
import { ScreenChrome, SectionHeading, EmptyState, createScheduler } from './common';
import type { TaskRowContext } from '../components/TaskRow';
import type { QuickEntryState } from '../app/uiState';

const TITLES: Record<string, string> = {
  inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', anytime: 'Anytime', someday: 'Someday',
};

export function SmartListScreen(props: { list: BuiltinList }): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const { schedule, SchedulerHost } = createScheduler();
  let scrollEl: HTMLDivElement | undefined;
  const [dragging] = createSignal(false);

  const ctx = createMemo<TaskRowContext>(() => ({
    tags: tags(),
    onSchedule: schedule,
    showWhen: props.list !== 'today',
    showEveningBadge: false,
  }));

  // ---- membership with completion grace ----
  const visible = createMemo<Task[]>(() => {
    const all = tasks();
    const today = currentDate();
    graceIds(); // re-evaluate when grace changes
    switch (props.list) {
      case 'inbox': return sortByOrderKey(all.filter(withGrace(inInbox)));
      case 'today': return all.filter(withGrace((t) => inToday(t, today)));
      case 'upcoming': return all.filter(withGrace((t) => inUpcoming(t, today)));
      case 'anytime': return all.filter(withGrace((t) => inAnytime(t, today)));
      case 'someday': return all.filter(withGrace(inSomeday));
      default: return [];
    }
  });

  const renderRows = (items: Task[], section: string) => (
    <AnimatedRows items={items} key={(t) => t.id} suspend={dragging}>
      {(task) => (
        <div data-reorder-row data-key={task.id} data-section={section}>
          <ExpandableTask task={task} ctx={ctx()} />
        </div>
      )}
    </AnimatedRows>
  );

  // ---------------------------------------------------------------- today --
  const todaySections = createMemo(() => todayTasks(visible(), currentDate()));
  const todayEvents = createMemo(() => events().filter((e) => e.date === currentDate()));

  const handleTodayDrop = (info: DropInfo) => {
    const { day, evening } = todaySections();
    const dragged = visible().find((t) => t.id === info.key);
    if (!dragged) return;
    const target = (info.section === 'evening' ? evening : day).filter((t) => t.id !== info.key);
    const ids = target.map((t) => t.id);
    ids.splice(Math.min(info.index, ids.length), 0, info.key);
    const wantsEvening = info.section === 'evening';
    void (async () => {
      if (dragged.evening !== wantsEvening) {
        await updateTask(dragged.id, { evening: wantsEvening, startDate: dragged.startDate ?? currentDate() });
      }
      await reorderToday(ids);
    })();
  };

  // ------------------------------------------------------ inbox (flat) -----
  const handleFlatDrop = (info: DropInfo) => {
    const items = visible().filter((t) => t.id !== info.key);
    void setTaskOrder(info.key, keyAtIndex(items, Math.min(info.index, items.length)));
  };

  // ------------------------------------------- anytime / someday groups ----
  const homeGroups = createMemo(() =>
    groupByHome(visible(), projects(), areas()),
  );

  const sectionIdOf = (g: { kind: string; id: string | null }) =>
    g.kind === 'standalone' ? 'standalone' : `${g.kind === 'project' ? 'p' : 'a'}:${g.id}`;

  const handleGroupedDrop = (info: DropInfo) => {
    const group = homeGroups().find((g) => sectionIdOf(g) === info.section);
    if (!group) return;
    const dragged = visible().find((t) => t.id === info.key);
    if (!dragged) return;
    const items = group.tasks.filter((t) => t.id !== info.key);
    const orderKey = keyAtIndex(items, Math.min(info.index, items.length));
    const sameContainer =
      (group.kind === 'standalone' && !dragged.projectId && !dragged.areaId) ||
      (group.kind === 'project' && dragged.projectId === group.id) ||
      (group.kind === 'area' && !dragged.projectId && dragged.areaId === group.id);
    if (sameContainer) {
      void setTaskOrder(info.key, orderKey);
    } else {
      void moveTask(
        info.key,
        group.kind === 'project' ? { projectId: group.id }
        : group.kind === 'area' ? { areaId: group.id }
        : {},
        orderKey,
      );
    }
  };

  // -------------------------------------------------------- magic plus -----
  const defaultEntry = createMemo<QuickEntryState>(() => {
    switch (props.list) {
      case 'inbox': return { destination: { bucket: 'inbox' } };
      case 'today': return { destination: {}, startDate: currentDate() };
      case 'upcoming': return { destination: {}, startDate: currentDate() };
      case 'anytime': return { destination: { bucket: 'anytime' } };
      case 'someday': return { destination: { bucket: 'someday' } };
      default: return { destination: { bucket: 'inbox' } };
    }
  });

  const entryForDrop = (drop: MagicPlusDrop): QuickEntryState | null => {
    if (props.list === 'inbox') {
      const items = visible();
      const idx = drop.beforeKey ? items.findIndex((t) => t.id === drop.beforeKey) : items.length;
      return { destination: { bucket: 'inbox' }, orderKey: keyAtIndex(items, idx < 0 ? items.length : idx) };
    }
    if (props.list === 'today') {
      return { destination: {}, startDate: currentDate(), evening: drop.section === 'evening' };
    }
    if (props.list === 'anytime' || props.list === 'someday') {
      const group = homeGroups().find((g) => sectionIdOf(g) === drop.section);
      const bucket = props.list as 'anytime' | 'someday';
      if (!group || group.kind === 'standalone') {
        return { destination: { bucket } };
      }
      return {
        destination: group.kind === 'project' ? { projectId: group.id, bucket } : { areaId: group.id, bucket },
      };
    }
    return defaultEntry();
  };

  const icon = () => <ListIcon list={props.list} size={30} />;

  return (
    <>
      <ScreenChrome title={TITLES[props.list] ?? props.list} icon={icon()} scrollRef={(el) => (scrollEl = el)}>
        <Show when={props.list === 'inbox'}>
          <Show when={visible().length > 0} fallback={<EmptyState icon={<ListIcon list="inbox" size={44} />} text="Collect your thoughts here, then organize them later." />}>
            <ReorderGroup onDrop={handleFlatDrop} scrollParent={() => scrollEl ?? null}>
              {renderRows(visible(), 'inbox')}
            </ReorderGroup>
          </Show>
        </Show>

        <Show when={props.list === 'today'}>
          <CalendarBlock events={todayEvents()} />
          <Show
            when={todaySections().day.length + todaySections().evening.length > 0}
            fallback={<EmptyState icon={<ListIcon list="today" size={44} />} text="Take a moment to plan your day, or enjoy the calm." />}
          >
            <ReorderGroup onDrop={handleTodayDrop} scrollParent={() => scrollEl ?? null}>
              {renderRows(todaySections().day, 'day')}
              <Show when={todaySections().evening.length > 0}>
                <SectionHeading
                  label="This Evening"
                  color="var(--text)"
                  trailing={<Icon name="moon" size={15} color="var(--purple)" />}
                />
                {renderRows(todaySections().evening, 'evening')}
              </Show>
            </ReorderGroup>
          </Show>
        </Show>

        <Show when={props.list === 'upcoming'}>
          <Show when={visible().length > 0 || events().some((e) => e.date > currentDate())} fallback={<EmptyState icon={<ListIcon list="upcoming" size={44} />} text="Scheduled to-dos and deadlines will show up here." />}>
            <For each={upcomingGroups(visible(), currentDate())}>
              {(group) => (
                <Show when={group.tasks.length > 0 || group.kind === 'day'}>
                  <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '16px 16px 2px', 'border-bottom': '1px solid var(--separator)' }}>
                    <span style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text)', 'min-width': '24px' }}>
                      {group.kind === 'day' ? group.sublabel : ''}
                    </span>
                    <span style={{ 'font-size': '15px', 'font-weight': group.kind === 'month' ? '700' : '500', color: 'var(--text-secondary)' }}>
                      {group.label} {group.kind === 'month' ? group.sublabel : ''}
                    </span>
                  </div>
                  <Show when={group.kind === 'day'}>
                    <div style={{ padding: '0 16px' }}>
                      <CalendarBlock compact events={events().filter((e) => e.date === group.date)} />
                    </div>
                  </Show>
                  {renderRows(group.tasks, `date:${group.date}`)}
                </Show>
              )}
            </For>
          </Show>
        </Show>

        <Show when={props.list === 'anytime' || props.list === 'someday'}>
          <Show
            when={homeGroups().length > 0}
            fallback={
              <EmptyState
                icon={<ListIcon list={props.list} size={44} />}
                text={props.list === 'anytime' ? 'To-dos you could do anytime will collect here.' : 'Stash ideas for someday — they’ll wait patiently.'}
              />
            }
          >
            <ReorderGroup onDrop={handleGroupedDrop} scrollParent={() => scrollEl ?? null}>
              <For each={homeGroups()}>
                {(group) => (
                  <>
                    <Show when={group.kind !== 'standalone'}>
                      <SectionHeading label={group.title || '—'} small />
                    </Show>
                    {renderRows(group.tasks, sectionIdOf(group))}
                  </>
                )}
              </For>
            </ReorderGroup>
          </Show>
        </Show>
      </ScreenChrome>

      <MagicPlus
        defaultEntry={defaultEntry}
        entryForDrop={entryForDrop}
        listEl={() => scrollEl ?? null}
      />
      <SchedulerHost />
    </>
  );
}

export { todaySortKey };
