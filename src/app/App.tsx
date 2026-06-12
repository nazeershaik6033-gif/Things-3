import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  edgeBack, registerScreen, startNavigation, stack, unregisterScreen,
  type Route, type StackEntry,
} from './navigation';
import { startDateTicker } from './currentDate';
import { startTheme } from './theme';
import { startCalendarSync } from './calendar';
import { createPan } from '../gestures/createPan';
import { closeOpenRow } from '../gestures/arbiter';
import { setExpandedTaskId, expandedTaskId } from './uiState';
import { HomeScreen } from '../screens/HomeScreen';
import { SmartListScreen } from '../screens/SmartListScreen';
import { ProjectScreen } from '../screens/ProjectScreen';
import { AreaScreen } from '../screens/AreaScreen';
import { TagScreen } from '../screens/TagScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { TrashScreen } from '../screens/TrashScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { SearchOverlay } from '../screens/SearchOverlay';
import { QuickEntry } from '../components/QuickEntry';
import { InstallCoachMark } from '../components/InstallCoachMark';
import { ScreenKeyContext } from './screenContext';

function ScreenFor(props: { route: Route }): JSX.Element {
  const r = props.route;
  switch (r.name) {
    case 'home': return <HomeScreen />;
    case 'list':
      if (r.list === 'logbook') return <LogbookScreen />;
      if (r.list === 'trash') return <TrashScreen />;
      return <SmartListScreen list={r.list} />;
    case 'project': return <ProjectScreen id={r.id} />;
    case 'area': return <AreaScreen id={r.id} />;
    case 'tag': return <TagScreen id={r.id} />;
    case 'calendar': return <CalendarScreen />;
    case 'settings': return <SettingsScreen />;
  }
}

function ScreenWrapper(props: { entry: StackEntry }): JSX.Element {
  let el!: HTMLDivElement;
  onMount(() => registerScreen(props.entry.key, el));
  onCleanup(() => unregisterScreen(props.entry.key));
  return (
    <ScreenKeyContext.Provider value={props.entry.key}>
      <div ref={el} class="screen" data-route={props.entry.route.name}>
        <ScreenFor route={props.entry.route} />
      </div>
    </ScreenKeyContext.Provider>
  );
}

export function App(): JSX.Element {
  let root!: HTMLDivElement;

  onMount(() => {
    startTheme();
    startDateTicker();
    startNavigation();
    startCalendarSync();
    void navigator.storage?.persist?.();

    // Left-edge swipe-back, scrubbing the same spring the back button uses
    const cleanup = createPan(root, {
      axis: 'x',
      leftEdge: 28,
      canStart: () => edgeBack.canStart(),
      onStart: () => {
        closeOpenRow();
        setExpandedTaskId(null);
      },
      onMove: (dx) => edgeBack.move(dx),
      onEnd: (vx, _vy, dx) => edgeBack.end(dx, vx),
      onCancel: () => edgeBack.end(0, 0),
    });
    onCleanup(cleanup);

    // Any tap outside an open swipe-row closes it
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-task-card]') && expandedTaskId() !== null) {
        // backdrop handles its own click; this catches scroll starts etc.
      }
      if (!target.closest('.task-row')) closeOpenRow();
    };
    document.addEventListener('pointerdown', onPointerDown);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown));
  });

  return (
    <div ref={root} style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <For each={stack()}>{(entry) => <ScreenWrapper entry={entry} />}</For>
      <SearchOverlay />
      <QuickEntry />
      <InstallCoachMark />
    </div>
  );
}
