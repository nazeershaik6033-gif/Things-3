import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { push, type BuiltinList } from '../app/navigation';
import { Icon, ListIcon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { Sheet, SheetTitle } from '../ui/Sheet';
import { setSearchOpen, setQuickEntry } from '../app/uiState';
import { sidebarCounts, isLive, isOpen, projectProgress } from '../domain/smartLists';
import { sortByOrderKey } from '../db/ordering';
import { createArea, createProject } from '../db/mutations';
import { MagicPlus } from '../components/MagicPlus';
import { MenuRow } from './common';

function HomeRow(props: {
  icon: JSX.Element;
  label: string;
  count?: number;
  onClick: () => void;
  testid?: string;
  bold?: boolean;
}): JSX.Element {
  return (
    <button
      data-testid={props.testid}
      onClick={props.onClick}
      class="no-select"
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '13px',
        width: '100%',
        padding: '11px 16px',
        'font-size': '17px',
        'font-weight': props.bold ? '600' : '400',
        color: 'var(--text)',
        'text-align': 'left',
      }}
    >
      {props.icon}
      <span style={{ flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
        {props.label}
      </span>
      <Show when={props.count !== undefined && props.count! > 0}>
        <span style={{ color: 'var(--text-tertiary)', 'font-size': '16px', 'font-variant-numeric': 'tabular-nums' }}>
          {props.count}
        </span>
      </Show>
    </button>
  );
}

export function HomeScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const [newListOpen, setNewListOpen] = createSignal(false);

  const counts = createMemo(() => sidebarCounts(tasks(), currentDate()));
  const liveProjects = createMemo(() => sortByOrderKey(projects().filter((p) => isLive(p) && isOpen(p))));
  const standaloneProjects = createMemo(() => liveProjects().filter((p) => !p.areaId));
  const sortedAreas = createMemo(() => sortByOrderKey(areas()));

  const listRow = (list: BuiltinList, label: string, count?: number) => (
    <HomeRow
      testid={`home-${list}`}
      icon={<ListIcon list={list} />}
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
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              margin: '6px 16px 10px',
              padding: '9px 12px',
              width: 'calc(100% - 32px)',
              'border-radius': '11px',
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              'font-size': '16px',
            }}
          >
            <Icon name="search" size={16} />
            Quick Find
          </button>

          <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '0 10px', padding: '2px 0' }}>
            {listRow('inbox', 'Inbox', counts().inbox)}
          </div>

          <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '10px 10px', padding: '2px 0' }}>
            {listRow('today', 'Today', counts().today)}
            {listRow('upcoming', 'Upcoming')}
            {listRow('anytime', 'Anytime')}
            {listRow('someday', 'Someday')}
          </div>

          <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '10px 10px', padding: '2px 0' }}>
            <HomeRow
              testid="home-calendar"
              icon={<Icon name="calendar" size={21} color="var(--red)" />}
              label="Calendar"
              onClick={() => push({ name: 'calendar' })}
            />
            {listRow('logbook', 'Logbook')}
            {listRow('trash', 'Trash')}
          </div>

          <Show when={standaloneProjects().length > 0}>
            <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '10px 10px', padding: '2px 0' }}>
              <For each={standaloneProjects()}>
                {(p) => (
                  <HomeRow
                    icon={<ProgressPie progress={projectProgress(tasks(), p.id)} size={21} />}
                    label={p.title || 'New Project'}
                    onClick={() => push({ name: 'project', id: p.id })}
                  />
                )}
              </For>
            </div>
          </Show>

          <For each={sortedAreas()}>
            {(area) => (
              <div style={{ background: 'var(--bg-list)', 'border-radius': '12px', margin: '10px 10px', padding: '2px 0' }}>
                <HomeRow
                  bold
                  icon={<Icon name="hexagon" size={21} color="var(--teal)" />}
                  label={area.title || 'New Area'}
                  onClick={() => push({ name: 'area', id: area.id })}
                />
                <For each={liveProjects().filter((p) => p.areaId === area.id)}>
                  {(p) => (
                    <div style={{ 'padding-left': '18px' }}>
                      <HomeRow
                        icon={<ProgressPie progress={projectProgress(tasks(), p.id)} size={21} />}
                        label={p.title || 'New Project'}
                        onClick={() => push({ name: 'project', id: p.id })}
                      />
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>

          <div style={{ display: 'flex', 'justify-content': 'space-between', padding: '14px 16px 8px' }}>
            <button
              data-testid="new-list"
              onClick={() => setNewListOpen(true)}
              style={{ display: 'flex', 'align-items': 'center', gap: '7px', color: 'var(--blue)', 'font-size': '16px', 'font-weight': '500' }}
            >
              <Icon name="plus" size={17} />
              New List
            </button>
            <button
              aria-label="Settings"
              data-testid="settings-button"
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
