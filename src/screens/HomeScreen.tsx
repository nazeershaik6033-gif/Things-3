import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { push, type BuiltinList } from '../app/navigation';
import { haptic, staggerDelay } from '../app/motion';
import { Icon, ListIcon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { ProgressRing } from '../ui/ProgressRing';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { setSearchOpen, setQuickEntry } from '../app/uiState';
import { sidebarCounts, isLive, isOpen, projectProgress } from '../domain/smartLists';
import { routineProgress } from '../domain/routine';
import { sortByOrderKey } from '../db/ordering';
import { createArea, createProject } from '../db/mutations';
import { MagicPlus } from '../components/MagicPlus';
import { WidgetDeck, CalendarStrip } from '../components/HomeWidgets';
import { MenuRow } from './common';

/** Icon in a tinted rounded tile. The tile is what turns a flat list of links
 *  into something that reads as a board of destinations. */
function IconTile(props: { children: JSX.Element; tint: string }): JSX.Element {
  return (
    <span
      style={{
        width: '30px',
        height: '30px',
        'border-radius': '9px',
        display: 'grid',
        'place-items': 'center',
        background: props.tint,
        flex: 'none',
      }}
    >
      {props.children}
    </span>
  );
}

function HomeRow(props: {
  icon: JSX.Element;
  label: string;
  count?: number;
  badge?: JSX.Element;
  onClick: () => void;
  testid?: string;
  bold?: boolean;
  tint?: string;
}): JSX.Element {
  return (
    <button
      data-testid={props.testid}
      onClick={() => {
        haptic('tick');
        props.onClick();
      }}
      class="no-select pressable"
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        width: '100%',
        padding: '9px 14px',
        'font-size': '17px',
        'font-weight': props.bold ? '600' : '400',
        color: 'var(--text)',
        'text-align': 'left',
      }}
    >
      <Show when={props.tint} fallback={props.icon}>
        <IconTile tint={props.tint!}>{props.icon}</IconTile>
      </Show>
      <span style={{ flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
        {props.label}
      </span>
      {props.badge}
      <Show when={props.count !== undefined && props.count! > 0}>
        <span
          style={{
            'min-width': '22px',
            padding: '2px 7px',
            'border-radius': '999px',
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            'font-size': '13px',
            'font-weight': '600',
            'text-align': 'center',
            'font-variant-numeric': 'tabular-nums',
          }}
        >
          {props.count}
        </span>
      </Show>
    </button>
  );
}

/** One board: a titled card holding a group of destinations. */
function Board(props: { title?: string; index: number; children: JSX.Element }): JSX.Element {
  return (
    <div class="rise" style={{ margin: '0 10px 12px', 'animation-delay': staggerDelay(props.index) }}>
      <Show when={props.title}>
        <div
          style={{
            padding: '2px 8px 6px',
            'font-size': '12px',
            'font-weight': '700',
            'letter-spacing': '0.05em',
            'text-transform': 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          {props.title}
        </div>
      </Show>
      <div
        style={{
          background: 'var(--bg-list)',
          'border-radius': '16px',
          border: '1px solid var(--separator)',
          padding: '4px 0',
          overflow: 'hidden',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function HomeScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const routineItems = createLiveQuery(() => db.routineItems.toArray(), []);
  const routineLogs = createLiveQuery(() => db.routineLogs.toArray(), []);
  const [newListOpen, setNewListOpen] = createSignal(false);

  const counts = createMemo(() => sidebarCounts(tasks(), currentDate()));
  const liveProjects = createMemo(() => sortByOrderKey(projects().filter((p) => isLive(p) && isOpen(p))));
  const standaloneProjects = createMemo(() => liveProjects().filter((p) => !p.areaId));
  const sortedAreas = createMemo(() => sortByOrderKey(areas()));
  const routine = createMemo(() => routineProgress(routineItems(), routineLogs(), currentDate()));

  const listRow = (list: BuiltinList, label: string, tint: string, count?: number) => (
    <HomeRow
      testid={`home-${list}`}
      icon={<ListIcon list={list} size={19} />}
      tint={tint}
      label={label}
      count={count}
      onClick={() => push({ name: 'list', list })}
    />
  );

  return (
    <>
      <div class="screen-scroll" style={{ background: 'var(--bg)' }}>
        <div style={{ padding: `calc(var(--safe-top) + 10px) 0 0` }}>
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="search-bar"
            class="pressable"
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              margin: '6px 16px 12px',
              padding: '10px 12px',
              width: 'calc(100% - 32px)',
              'border-radius': '12px',
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              'font-size': '16px',
            }}
          >
            <Icon name="search" size={16} />
            Quick Find
          </button>

          <WidgetDeck events={events()} tasks={tasks()} today={currentDate()} />

          <CalendarStrip events={events()} tasks={tasks()} today={currentDate()} />

          <div style={{ height: '10px' }} />

          <Board title="Boards" index={0}>
            {listRow('inbox', 'Inbox', 'rgba(47, 124, 246, 0.12)', counts().inbox)}
            {listRow('today', 'Today', 'rgba(247, 206, 70, 0.16)', counts().today)}
            <HomeRow
              testid="home-routine"
              tint="rgba(182, 120, 224, 0.14)"
              icon={<Icon name="repeat" size={18} color="var(--purple)" />}
              label="Daily Routine"
              badge={
                <Show when={routine().total > 0}>
                  <span
                    data-testid="home-routine-progress"
                    style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--text-tertiary)', 'font-size': '13px' }}
                  >
                    {routine().done}/{routine().total}
                    <ProgressRing
                      progress={routine().ratio}
                      size={20}
                      thickness={12}
                      color={routine().complete ? 'var(--green)' : 'var(--purple)'}
                    />
                  </span>
                </Show>
              }
              onClick={() => push({ name: 'routine' })}
            />
            {listRow('upcoming', 'Upcoming', 'rgba(255, 59, 48, 0.11)')}
            {listRow('anytime', 'Anytime', 'rgba(76, 194, 232, 0.14)')}
            {listRow('someday', 'Someday', 'rgba(201, 168, 124, 0.16)')}
          </Board>

          <Board index={1}>
            {listRow('logbook', 'Logbook', 'rgba(83, 184, 85, 0.14)')}
            {listRow('trash', 'Trash', 'rgba(138, 138, 142, 0.14)')}
          </Board>

          <Show when={standaloneProjects().length > 0}>
            <Board title="Projects" index={2}>
              <For each={standaloneProjects()}>
                {(p) => (
                  <HomeRow
                    icon={<ProgressPie progress={projectProgress(tasks(), p.id)} size={21} />}
                    label={p.title || 'New Project'}
                    onClick={() => push({ name: 'project', id: p.id })}
                  />
                )}
              </For>
            </Board>
          </Show>

          <For each={sortedAreas()}>
            {(area, i) => (
              <Board index={3 + i()}>
                <HomeRow
                  bold
                  tint="rgba(76, 194, 232, 0.14)"
                  icon={<Icon name="hexagon" size={18} color="var(--teal)" />}
                  label={area.title || 'New Area'}
                  onClick={() => push({ name: 'area', id: area.id })}
                />
                <For each={liveProjects().filter((p) => p.areaId === area.id)}>
                  {(p) => (
                    <div style={{ 'padding-left': '20px' }}>
                      <HomeRow
                        icon={<ProgressPie progress={projectProgress(tasks(), p.id)} size={21} />}
                        label={p.title || 'New Project'}
                        onClick={() => push({ name: 'project', id: p.id })}
                      />
                    </div>
                  )}
                </For>
              </Board>
            )}
          </For>

          <div style={{ display: 'flex', 'justify-content': 'space-between', padding: '6px 16px 8px' }}>
            <button
              data-testid="new-list"
              class="pressable"
              onClick={() => setNewListOpen(true)}
              style={{ display: 'flex', 'align-items': 'center', gap: '7px', color: 'var(--blue)', 'font-size': '16px', 'font-weight': '500' }}
            >
              <Icon name="plus" size={17} />
              New List
            </button>
            <button
              aria-label="Settings"
              data-testid="settings-button"
              class="pressable"
              onClick={() => push({ name: 'settings' })}
              style={{ color: 'var(--text-secondary)', display: 'flex', padding: '4px' }}
            >
              <Icon name="settings" size={21} />
            </button>
          </div>
        </div>
      </div>

      <MagicPlus defaultEntry={() => ({ destination: { bucket: 'inbox' } })} />

      <Show when={newListOpen()}>
        <Sheet onClose={() => setNewListOpen(false)} dragAnywhere>
          <SheetTitle>New List</SheetTitle>
          <MenuRow
            icon={<ProgressPie progress={0.35} size={20} />}
            label="New Project"
            onClick={() => {
              setNewListOpen(false);
              void createProject({ title: '' }).then((id) => push({ name: 'project', id }));
            }}
          />
          <MenuRow
            icon={<Icon name="hexagon" size={20} color="var(--teal)" />}
            label="New Area"
            onClick={() => {
              setNewListOpen(false);
              void createArea('').then((id) => push({ name: 'area', id }));
            }}
          />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
    </>
  );
}

export { setQuickEntry };
