import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Key } from '@solid-primitives/keyed';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import type { BuiltinList } from '../app/navigation';
import type { Task } from '../db/models';
import {
  inInbox, inToday, inUpcoming, inAnytime, inSomeday,
  todayTasks, upcomingGroups, priorGroups, groupByHome, todaySortKey,
  type PriorGroup,
} from '../domain/smartLists';
import { graceIds } from '../app/uiState';
import { keyAtIndex, sortByOrderKey } from '../db/ordering';
import {
  moveTask, reopenTask, reorderToday, setTaskOrder, updateTask,
} from '../db/mutations';
import { Icon, ListIcon } from '../ui/Icon';
import { Checkbox } from '../ui/Checkbox';
import { ExpandableTask } from '../components/TaskCard';
import { AnimatedRows } from '../components/AnimatedRows';
import { ReorderGroup, type DropInfo } from '../components/ReorderGroup';
import { MagicPlus, type MagicPlusDrop } from '../components/MagicPlus';
import { CalendarBlock } from '../components/CalendarBlock';
import { ScreenChrome, SectionHeading, EmptyState, createScheduler, MenuRow } from './common';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { QUADRANTS } from '../domain/eisenhower';
import { setOverlayOpen } from '../app/pomodoro';
import type { EMQuadrant } from '../db/models';
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

  const [priorityFor, setPriorityFor] = createSignal<string | null>(null);

  const ctx = createMemo<TaskRowContext>(() => ({
    tags: tags(),
    onSchedule: schedule,
    showWhen: props.list !== 'today',
    showEveningBadge: false,
    onPriority: props.list === 'today' ? setPriorityFor : undefined,
  }));

  const setPriority = (quadrant: EMQuadrant | null) => {
    const id = priorityFor();
    if (id) void updateTask(id, { priority: quadrant });
    setPriorityFor(null);
  };

  // Prior groups (for Upcoming view): use ALL tasks (not just filtered visible)
  const priorData = createMemo(() =>
    props.list === 'upcoming' ? priorGroups(tasks(), currentDate()) : [],
  );

  // ---- membership with completion grace ----
  // Tasks in the grace window are treated as still-open BEFORE any domain
  // filtering/grouping, so they linger in place until the grace expires.
  const visible = createMemo<Task[]>(() => {
    const grace = graceIds();
    const all = tasks().map((t) =>
      grace.has(t.id) && t.status !== 'open' ? { ...t, status: 'open' as const } : t,
    );
    const today = currentDate();
    switch (props.list) {
      case 'inbox': return sortByOrderKey(all.filter(inInbox));
      case 'today': return all.filter((t) => inToday(t, today));
      case 'upcoming': return all.filter((t) => inUpcoming(t, today));
      case 'anytime': return all.filter((t) => inAnytime(t, today));
      case 'someday': return all.filter(inSomeday);
      default: return [];
    }
  });

  // Rows render the REAL task (so graced rows show checked + struck through);
  // the patched copies above only drive membership/grouping.
  const taskById = createMemo(() => new Map(tasks().map((t) => [t.id, t])));

  // A real component (not a function call in JSX): items updates flow through
  // the prop getter without recreating the row tree, so an expanded card
  // survives unrelated DB writes.
  const Rows = (p: { items: Task[]; section: string }) => (
    <AnimatedRows items={p.items} key={(t) => t.id} suspend={dragging}>
      {(task) => (
        <div data-reorder-row data-key={task().id} data-section={p.section}>
          <ExpandableTask task={taskById().get(task().id) ?? task()} ctx={ctx()} />
        </div>
      )}
    </AnimatedRows>
  );

  // ---------------------------------------------------------------- today --
  const todaySections = createMemo(() => todayTasks(visible(), currentDate()));
  const todayEvents = createMemo(() => events().filter((e) => e.date === currentDate()));
  const handleTodayDrop = (info: DropInfo) => {
    const sections = todaySections();
    const dragged = visible().find((t) => t.id === info.key);
    if (!dragged) return;
    type Sec = 'morning' | 'afternoon' | 'ungrouped' | 'tonight';
    const sec = info.section as Sec;
    const sectionTasks: Task[] = sections[sec] ?? sections.ungrouped;
    const target = sectionTasks.filter((t) => t.id !== info.key);
    const ids = target.map((t) => t.id);
    ids.splice(Math.min(info.index, ids.length), 0, info.key);
    const wantsEvening = sec === 'tonight';
    const wantsReminder: string | null =
      sec === 'morning' ? 'morning' : sec === 'afternoon' ? 'afternoon' : null;
    void (async () => {
      if (dragged.evening !== wantsEvening || dragged.reminderTime !== wantsReminder) {
        await updateTask(dragged.id, {
          evening: wantsEvening,
          reminderTime: wantsReminder,
          startDate: dragged.startDate ?? currentDate(),
        });
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
      const sec = drop.section;
      return {
        destination: {},
        startDate: currentDate(),
        evening: sec === 'tonight',
      };
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
      <ScreenChrome
        title={TITLES[props.list] ?? props.list}
        icon={icon()}
        scrollRef={(el) => (scrollEl = el)}
        trailing={
          props.list === 'today' ? (
            <button
              aria-label="Pomodoro timer"
              data-testid="pomo-open"
              onClick={() => setOverlayOpen(true)}
              style={{ padding: '8px 12px', 'font-size': '20px', 'line-height': '1' }}
            >
              🍅
            </button>
          ) : undefined
        }
      >
        <Show when={props.list === 'inbox'}>
          <Show when={visible().length > 0} fallback={<EmptyState icon={<ListIcon list="inbox" size={44} />} text="Collect your thoughts here, then organize them later." />}>
            <ReorderGroup onDrop={handleFlatDrop} scrollParent={() => scrollEl ?? null}>
              <Rows items={visible()} section="inbox" />
            </ReorderGroup>
          </Show>
        </Show>

        <Show when={props.list === 'today'}>
          <CalendarBlock events={todayEvents()} />
          <Show
            when={todaySections().morning.length + todaySections().afternoon.length + todaySections().ungrouped.length + todaySections().tonight.length > 0}
            fallback={<EmptyState icon={<ListIcon list="today" size={44} />} text="Take a moment to plan your day, or enjoy the calm." />}
          >
            <ReorderGroup onDrop={handleTodayDrop} scrollParent={() => scrollEl ?? null}>
              <Show when={todaySections().morning.length > 0}>
                <SectionHeading
                  label="Morning"
                  color="var(--text)"
                  trailing={<Icon name="sunrise" size={15} color="var(--yellow)" />}
                />
                <Rows items={todaySections().morning} section="morning" />
              </Show>
              <Rows items={todaySections().ungrouped} section="ungrouped" />
              <Show when={todaySections().afternoon.length > 0}>
                <SectionHeading
                  label="Afternoon"
                  color="var(--text)"
                  trailing={<Icon name="sun" size={15} color="var(--yellow)" />}
                />
                <Rows items={todaySections().afternoon} section="afternoon" />
              </Show>
              <Show when={todaySections().tonight.length > 0}>
                <SectionHeading
                  label="Tonight"
                  color="var(--text)"
                  trailing={<Icon name="moon" size={15} color="var(--purple)" />}
                />
                <Rows items={todaySections().tonight} section="tonight" />
              </Show>
            </ReorderGroup>
          </Show>
        </Show>

        <Show when={props.list === 'upcoming'}>
          <Show when={visible().length > 0 || events().some((e) => e.date > currentDate())} fallback={<EmptyState icon={<ListIcon list="upcoming" size={44} />} text="Scheduled to-dos and deadlines will show up here." />}>
            <Key each={upcomingGroups(visible(), currentDate())} by={(g) => `${g.kind}:${g.kind === 'day' ? g.date : g.date.slice(0, 7)}`}>
              {(group) => (
                <Show when={group().tasks.length > 0 || group().kind === 'day'}>
                  <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '16px 16px 2px', 'border-bottom': '1px solid var(--separator)' }}>
                    <span style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text)', 'min-width': '24px' }}>
                      {group().kind === 'day' ? group().sublabel : ''}
                    </span>
                    <span style={{ 'font-size': '15px', 'font-weight': group().kind === 'month' ? '700' : '500', color: 'var(--text-secondary)' }}>
                      {group().label} {group().kind === 'month' ? group().sublabel : ''}
                    </span>
                  </div>
                  <Show when={group().kind === 'day'}>
                    <div style={{ padding: '0 16px' }}>
                      <CalendarBlock compact events={events().filter((e) => e.date === group().date)} />
                    </div>
                  </Show>
                  <Rows items={group().tasks} section={`date:${group().date}`} />
                </Show>
              )}
            </Key>
          </Show>

          {/* Prior: past dates in the current month */}
          <Show when={priorData().length > 0}>
            <div style={{ padding: '24px 16px 4px', 'border-bottom': '1px solid var(--separator)' }}>
              <span style={{ 'font-size': '16px', 'font-weight': '700', color: 'var(--text-secondary)' }}>
                Prior
              </span>
            </div>
            <For each={priorData()}>
              {(group: PriorGroup) => (
                <div>
                  <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '14px 16px 2px', 'border-bottom': '1px solid var(--separator)' }}>
                    <span style={{ 'font-size': '17px', 'font-weight': '600', color: 'var(--text-secondary)', 'min-width': '24px' }}>
                      {group.kind === 'day' ? group.sublabel : ''}
                    </span>
                    <span style={{ 'font-size': '15px', 'font-weight': '500', color: 'var(--text-secondary)' }}>
                      {group.label}
                    </span>
                  </div>
                  {/* Calendar events for this prior day */}
                  <Show when={group.kind === 'day'}>
                    <div style={{ padding: '0 16px' }}>
                      <CalendarBlock compact events={events().filter((e) => e.date === group.date)} />
                    </div>
                  </Show>
                  {/* Overdue open tasks — use ExpandableTask so they're editable */}
                  <For each={group.overdueTasks}>
                    {(task) => (
                      <div style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', top: '50%', right: '16px', transform: 'translateY(-50%)', 'z-index': '1', display: 'flex', 'align-items': 'center', gap: '4px', 'pointer-events': 'none' }}>
                          <span style={{ 'font-size': '11px', 'font-weight': '600', color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, transparent)', padding: '2px 6px', 'border-radius': '4px' }}>
                            overdue
                          </span>
                        </div>
                        <ExpandableTask task={taskById().get(task.id) ?? task} ctx={ctx()} />
                      </div>
                    )}
                  </For>
                  {/* Completed tasks from this day */}
                  <For each={group.completedTasks}>
                    {(task) => (
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '10px 16px', opacity: '0.7' }}>
                        <Checkbox
                          checked
                          canceled={task.status === 'canceled'}
                          onToggle={() => void reopenTask(task.id)}
                        />
                        <span style={{
                          flex: '1',
                          color: 'var(--text-secondary)',
                          'text-decoration': 'line-through',
                          'text-decoration-color': 'var(--text-tertiary)',
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                          'white-space': 'nowrap',
                        }}>
                          {task.title || '—'}
                        </span>
                        <Show when={task.status === 'canceled'}>
                          <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>canceled</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
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
              <Key each={homeGroups()} by={sectionIdOf}>
                {(group) => (
                  <>
                    <Show when={group().kind !== 'standalone'}>
                      <SectionHeading label={group().title || '—'} small />
                    </Show>
                    <Rows items={group().tasks} section={sectionIdOf(group())} />
                  </>
                )}
              </Key>
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

      <Show when={priorityFor()}>
        <Sheet onClose={() => setPriorityFor(null)} dragAnywhere>
          <SheetTitle>Priority</SheetTitle>
          {QUADRANTS.map((q) => (
            <MenuRow
              icon={
                <span style={{
                  width: '14px', height: '14px', 'border-radius': '4px',
                  background: q.color, display: 'inline-block',
                }} />
              }
              label={`${q.label} — ${q.desc}`}
              onClick={() => setPriority(q.id)}
            />
          ))}
          <MenuRow
            icon={<Icon name="close" size={16} color="var(--text-tertiary)" />}
            label="Clear"
            onClick={() => setPriority(null)}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </>
  );
}

export { todaySortKey };
