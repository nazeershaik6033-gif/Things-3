import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ViewEditor } from '../components/ViewEditor';
import { TemplatesSheet } from '../components/TemplatesSheet';
import { createSavedView } from '../db/workflowMutations';
import { canDoNow } from '../domain/workflow';
import { reviewDue } from './WorkflowScreens';
import type { SavedView } from '../db/models';
import { sortByOrderKey as sortViews } from '../db/ordering';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { push, type BuiltinList } from '../app/navigation';
import { haptic, staggerDelay } from '../app/motion';
import { Icon, ListIcon } from '../ui/Icon';
import { ProgressPie } from '../ui/ProgressPie';
import { ProgressRing } from '../ui/ProgressRing';
import { setSearchOpen, setQuickEntry } from '../app/uiState';
import { sidebarCounts, isLive, isOpen, projectProgress, todayTasks } from '../domain/smartLists';
import { routineProgress } from '../domain/routine';
import { sessionProgress } from '../domain/beliefs';
import {
  checkedIdsIn, feedsBySource, hasFeed, newEntriesFor, seenUrlSet, visibleSources,
} from '../domain/myRoutine';
import { routineWindowAt, sortedWindows } from '../domain/routineWindows';
import { OUTCOME_COLOR, OUTCOME_LABEL, resolveAll, targetFor } from '../domain/target';
import { sortByOrderKey } from '../db/ordering';
import { createArea, createProject } from '../db/mutations';
import { createBoard } from '../db/boardMutations';
import { WidgetDeck, CalendarStrip } from '../components/HomeWidgets';
import { QuoteCard } from '../components/QuoteCard';
import { worklogDays } from '../domain/worklog';
import { formatDuration } from '../domain/timeTracking';
import { liveValue, metGoal } from '../domain/counters';
import { runningSeconds, trackingTaskId } from '../app/timeTracking';
import { createLongPress } from '../gestures/createLongPress';
import { homeLayout, homeTab, setHomeTab } from '../app/homeLayout';
import { BLOCK_ITEMS, type HomeItemId } from '../domain/homeLayout';
import { HomeTabBar } from '../components/HomeTabBar';
import { HomeEditor, MoveSheet } from '../components/HomeEditor';

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
  /** Long-press: offered for rows that are Home items, to move them. */
  onLongPress?: () => void;
  testid?: string;
  bold?: boolean;
  tint?: string;
}): JSX.Element {
  let el!: HTMLButtonElement;
  onMount(() => {
    if (!props.onLongPress) return;
    onCleanup(createLongPress(el, {
      duration: 420,
      onPress: () => {
        haptic('select');
        props.onLongPress!();
        return null;
      },
    }));
  });
  return (
    <button
      ref={el}
      data-testid={props.testid}
      onClick={() => {
        haptic('tick');
        props.onClick();
      }}
      onContextMenu={(e) => {
        // Right-click on a desktop does what a long-press does on a phone
        if (!props.onLongPress) return;
        e.preventDefault();
        props.onLongPress();
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

/** Subtle strip: today's count plus what's up next, so you get the gist
 *  without opening the Today list. Hidden when Today is empty. */
function TodayBanner(props: { count: number; next: string | null }): JSX.Element {
  return (
    <Show when={props.count > 0}>
      <button
        data-testid="today-banner"
        onClick={() => push({ name: 'list', list: 'today' })}
        class="no-select pressable"
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          width: 'calc(100% - 32px)',
          margin: '0 16px 10px',
          padding: '8px 12px',
          'border-radius': '11px',
          background: 'var(--bg-inset)',
          'text-align': 'left',
        }}
      >
        <Icon name="star" size={14} color="var(--yellow)" />
        <span style={{
          flex: '1', 'font-size': '13px', color: 'var(--text-secondary)',
          overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
        }}>
          <span style={{ color: 'var(--text)', 'font-weight': '600' }}>
            {props.count} {props.count === 1 ? 'thing' : 'things'} today
          </span>
          <Show when={props.next}> · Next: {props.next}</Show>
        </span>
      </button>
    </Show>
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

/** A tab's items in order. Consecutive rows share one card; a block (widget
 *  deck, week strip, quote, projects…) breaks the run and stands on its own. */
type Segment = { kind: 'rows'; items: HomeItemId[] } | { kind: 'block'; item: HomeItemId };

function segmentsOf(items: HomeItemId[]): Segment[] {
  const out: Segment[] = [];
  for (const item of items) {
    if (BLOCK_ITEMS.has(item)) {
      out.push({ kind: 'block', item });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'rows') last.items.push(item);
    else out.push({ kind: 'rows', items: [item] });
  }
  return out;
}

function AddMenuRow(props: { icon: JSX.Element; label: string; testid: string; onClick: () => void }): JSX.Element {
  return (
    <button
      data-testid={props.testid}
      class="pressable no-select"
      onClick={() => {
        haptic('tick');
        props.onClick();
      }}
      style={{
        display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', padding: '11px 12px',
        'border-radius': '12px', 'font-size': '16px', color: 'var(--text)', 'text-align': 'left',
      }}
    >
      <span style={{ width: '24px', display: 'grid', 'place-items': 'center' }}>{props.icon}</span>
      {props.label}
    </button>
  );
}

export function HomeScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const routineItems = createLiveQuery(() => db.routineItems.toArray(), []);
  const routineLogs = createLiveQuery(() => db.routineLogs.toArray(), []);
  const targets = createLiveQuery(() => db.dailyTargets.toArray(), []);
  const beliefs = createLiveQuery(() => db.beliefs.toArray(), []);
  const beliefRatings = createLiveQuery(() => db.beliefRatings.toArray(), []);
  const [addOpen, setAddOpen] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [moving, setMoving] = createSignal<HomeItemId | null>(null);
  const [viewEditorOpen, setViewEditorOpen] = createSignal(false);
  const [templatesOpen, setTemplatesOpen] = createSignal(false);
  const savedViews = createLiveQuery(async () => sortViews(await db.savedViews.toArray()), [] as SavedView[]);
  const canDoCount = createMemo(() => canDoNow(tasks(), currentDate()).length);
  const reviewIsDue = createLiveQuery(() => reviewDue(currentDate()), false);

  const counts = createMemo(() => sidebarCounts(tasks(), currentDate()));
  const todaySections = createMemo(() => todayTasks(tasks(), currentDate()));
  const nextTodayTitle = createMemo(() => {
    const s = todaySections();
    const t = s.morning[0] ?? s.ungrouped[0] ?? s.afternoon[0] ?? s.tonight[0];
    return t ? t.title || 'Untitled' : null;
  });
  const liveProjects = createMemo(() => sortByOrderKey(projects().filter((p) => isLive(p) && isOpen(p))));
  const standaloneProjects = createMemo(() => liveProjects().filter((p) => !p.areaId));
  const sortedAreas = createMemo(() => sortByOrderKey(areas()));
  const routine = createMemo(() => routineProgress(routineItems(), routineLogs(), currentDate()));
  const routineSources = createLiveQuery(() => db.routineSources.toArray(), []);
  const routineWindowRows = createLiveQuery(() => db.routineWindows.toArray(), []);
  const routineChecks = createLiveQuery(() => db.routineChecks.toArray(), []);
  const routineFeeds = createLiveQuery(() => db.routineFeeds.toArray(), []);
  const routineSeen = createLiveQuery(() => db.routineSeen.toArray(), []);
  /** Updates waiting in the live My Routine window, on sources not yet ticked. */
  const routineFeedNew = createMemo(() => {
    const span = routineWindowAt(sortedWindows(routineWindowRows()), null, new Date());
    if (!span || span.upcomingAt !== null) return 0;
    const done = checkedIdsIn(routineChecks(), span.key);
    const feeds = feedsBySource(routineFeeds());
    const seen = seenUrlSet(routineSeen());
    let count = 0;
    for (const source of visibleSources(routineSources(), Date.now())) {
      if (done.has(source.id) || !hasFeed(source)) continue;
      count += newEntriesFor(feeds.get(source.id), span.start, span.end, seen).length;
    }
    return count;
  });
  const target = createMemo(() => targetFor(resolveAll(targets(), tasks()), currentDate()));
  const beliefSession = createMemo(() => sessionProgress(beliefs(), beliefRatings(), currentDate()));
  const sprintsDone = createLiveQuery(() => db.sprints.where('status').equals('done').toArray(), []);
  const dayReviews = createLiveQuery(() => db.dayReviews.toArray(), []);
  const counterRows = createLiveQuery(() => db.counters.toArray(), []);
  const counterDays = createLiveQuery(() => db.counterDays.toArray(), []);
  /** Seconds tracked today, including a running timer. */
  const trackedToday = createMemo(() => {
    const today = currentDate();
    const day = worklogDays(tasks(), sprintsDone(), [], { from: today, to: today })[0];
    return (day?.totalSec ?? 0) + (trackingTaskId() ? runningSeconds() : 0);
  });
  const dayFinished = createMemo(() => dayReviews().some((r) => r.date === currentDate()));
  const countersMet = createMemo(() => {
    const live = counterRows().filter((c) => c.active);
    const now = Date.now();
    return {
      total: live.length,
      met: live.filter((c) => metGoal(c, liveValue(c, counterDays(), currentDate(), now))).length,
    };
  });

  const category = createMemo(() => {
    const cats = homeLayout().categories;
    return cats.find((c) => c.id === homeTab()) ?? cats[0]!;
  });

  /** Items that would draw nothing right now are skipped, so the rows on
   *  either side of them join into one card. */
  const shows = (item: HomeItemId): boolean => {
    switch (item) {
      case 'banner': return counts().today > 0;
      case 'views': return savedViews().length > 0;
      case 'projects': return standaloneProjects().length > 0 || sortedAreas().length > 0;
      default: return true;
    }
  };
  const segments = createMemo(() => segmentsOf(category().items.filter(shows)));

  // ── Tabs: remember each tab's scroll position; switching restores it ──
  let scrollEl!: HTMLDivElement;
  const scrollByTab = new Map<string, number>();
  const selectTab = (id: string) => {
    setAddOpen(false);
    if (id === homeTab()) {
      // Tapping the open tab again scrolls it back to the top, like iOS
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    scrollByTab.set(homeTab(), scrollEl.scrollTop);
    setHomeTab(id);
    scrollEl.scrollTop = scrollByTab.get(id) ?? 0;
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && addOpen()) setAddOpen(false);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const moveHandler = (item: HomeItemId) => () => setMoving(item);

  const listRow = (item: HomeItemId, list: BuiltinList, label: string, tint: string, count?: number) => (
    <HomeRow
      testid={`home-${list}`}
      icon={<ListIcon list={list} size={19} />}
      tint={tint}
      label={label}
      count={count}
      onClick={() => push({ name: 'list', list })}
      onLongPress={moveHandler(item)}
    />
  );

  const progressBadge = (testid: string | undefined, done: number, total: number, ratio: number, complete: boolean, color: string) => (
    <span
      data-testid={testid}
      style={{ display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--text-tertiary)', 'font-size': '13px' }}
    >
      {done}/{total}
      <ProgressRing progress={ratio} size={20} thickness={12} color={complete ? 'var(--green)' : color} />
    </span>
  );

  /** One Home row, for every item that is a single destination. */
  const row = (item: HomeItemId): JSX.Element => {
    const lp = moveHandler(item);
    switch (item) {
      case 'inbox': return listRow(item, 'inbox', 'Inbox', 'rgba(47, 124, 246, 0.12)', counts().inbox);
      case 'today': return listRow(item, 'today', 'Today', 'rgba(247, 206, 70, 0.16)', counts().today);
      case 'upcoming': return listRow(item, 'upcoming', 'Upcoming', 'rgba(255, 59, 48, 0.11)');
      case 'prior': return listRow(item, 'prior', 'Prior', 'rgba(182, 120, 224, 0.12)');
      case 'anytime': return listRow(item, 'anytime', 'Anytime', 'rgba(76, 194, 232, 0.14)');
      case 'someday': return listRow(item, 'someday', 'Someday', 'rgba(201, 168, 124, 0.16)');
      case 'logbook': return listRow(item, 'logbook', 'Logbook', 'rgba(83, 184, 85, 0.14)');
      case 'trash': return listRow(item, 'trash', 'Trash', 'rgba(138, 138, 142, 0.14)');
      case 'cando': return (
        <HomeRow
          testid="home-cando"
          tint="rgba(83, 184, 85, 0.14)"
          icon={<span style={{ 'font-size': '16px' }}>🔓</span>}
          label="Can Do Now"
          badge={<span style={{ 'font-size': '13px', color: 'var(--text-tertiary)' }}>{canDoCount() || ''}</span>}
          onClick={() => push({ name: 'cando' })}
          onLongPress={lp}
        />
      );
      case 'planner': return (
        <HomeRow
          testid="home-planner"
          tint="rgba(47, 124, 246, 0.12)"
          icon={<Icon name="clock" size={18} color="var(--blue)" />}
          label="Planner"
          onClick={() => push({ name: 'planner' })}
          onLongPress={lp}
        />
      );
      case 'calendar': return (
        <HomeRow
          testid="home-calendar-row"
          tint="rgba(255, 59, 48, 0.11)"
          icon={<Icon name="calendar" size={18} color="var(--red)" />}
          label="Calendar"
          onClick={() => push({ name: 'calendar' })}
          onLongPress={lp}
        />
      );
      case 'boards': return (
        <HomeRow
          testid="home-boards"
          tint="rgba(47, 124, 246, 0.12)"
          icon={<Icon name="board" size={19} color="var(--blue)" />}
          label="Boards"
          onClick={() => push({ name: 'boards' })}
          onLongPress={lp}
        />
      );
      case 'note': return (
        <HomeRow
          testid="home-note"
          tint="rgba(247, 206, 70, 0.16)"
          icon={<Icon name="notes" size={18} color="var(--yellow-deep)" />}
          label="Daily Note"
          onClick={() => push({ name: 'note', key: currentDate() })}
          onLongPress={lp}
        />
      );
      case 'review': return (
        <HomeRow
          testid="home-review"
          tint="rgba(182, 120, 224, 0.14)"
          icon={<Icon name="restore" size={18} color="var(--purple)" />}
          label="Weekly Review"
          badge={<Show when={reviewIsDue()}><span data-testid="home-review-due" style={{ 'font-size': '12px', 'font-weight': '700', color: 'var(--purple)' }}>Due</span></Show>}
          onClick={() => push({ name: 'review' })}
          onLongPress={lp}
        />
      );
      case 'focus': return (
        <HomeRow
          testid="home-focus"
          tint="rgba(47, 124, 246, 0.12)"
          icon={<Icon name="target" size={19} color="var(--blue)" />}
          label="Daily Focus"
          onClick={() => push({ name: 'focus' })}
          onLongPress={lp}
        />
      );
      case 'target': return (
        <HomeRow
          testid="home-target"
          tint="rgba(47, 124, 246, 0.12)"
          icon={<Icon name="flag" size={18} color="var(--blue)" />}
          label="Today's Target"
          badge={
            <span
              data-testid="home-target-state"
              style={{
                'font-size': '13px',
                'font-weight': '600',
                color: target() ? OUTCOME_COLOR[target()!.outcome] : 'var(--text-tertiary)',
              }}
            >
              {/* Keyed off the resolved outcome, not on whether a verdict
                  was typed: a hit carried by the linked to-do is just as
                  true as one recorded by hand. */}
              {!target()
                ? 'Not set'
                : target()!.outcome === 'pending'
                  ? 'Set'
                  : OUTCOME_LABEL[target()!.outcome]}
            </span>
          }
          onClick={() => push({ name: 'target' })}
          onLongPress={lp}
        />
      );
      case 'habits': return (
        <HomeRow
          testid="home-routine"
          tint="rgba(182, 120, 224, 0.14)"
          icon={<Icon name="repeat" size={18} color="var(--purple)" />}
          label="Habits"
          badge={
            <Show when={routine().total > 0}>
              {progressBadge('home-routine-progress', routine().done, routine().total, routine().ratio, routine().complete, 'var(--purple)')}
            </Show>
          }
          onClick={() => push({ name: 'routine' })}
          onLongPress={lp}
        />
      );
      case 'beliefs': return (
        <HomeRow
          testid="home-beliefs"
          tint="rgba(182, 120, 224, 0.14)"
          icon={<Icon name="sparkle" size={18} color="var(--purple)" />}
          label="Beliefs"
          badge={
            <Show when={beliefSession().total > 0}>
              {progressBadge('home-beliefs-state', beliefSession().rated, beliefSession().total, beliefSession().ratio, beliefSession().complete, 'var(--purple)')}
            </Show>
          }
          onClick={() => push({ name: 'beliefs' })}
          onLongPress={lp}
        />
      );
      case 'myroutine': return (
        <HomeRow
          testid="home-myroutine"
          tint="rgba(247, 206, 70, 0.18)"
          icon={<Icon name="sunrise" size={18} color="var(--yellow-deep)" />}
          label="My Routine"
          badge={
            <Show when={routineFeedNew() > 0}>
              <span
                data-testid="home-myroutine-new"
                style={{
                  'font-size': '11px',
                  'font-weight': '700',
                  color: '#fff',
                  background: 'var(--red)',
                  'border-radius': '999px',
                  padding: '2px 7px',
                }}
              >
                {routineFeedNew()} new
              </span>
            </Show>
          }
          onClick={() => push({ name: 'myroutine' })}
          onLongPress={lp}
        />
      );
      case 'worklog': return (
        <HomeRow
          testid="home-worklog"
          tint="rgba(47, 124, 246, 0.12)"
          icon={<Icon name="clock" size={18} color="var(--blue)" />}
          label="Worklog"
          badge={
            <Show when={trackedToday() >= 60}>
              <span data-testid="home-worklog-today" style={{ 'font-size': '13px', color: 'var(--text-tertiary)', 'font-variant-numeric': 'tabular-nums' }}>
                {formatDuration(trackedToday())} today
              </span>
            </Show>
          }
          onClick={() => push({ name: 'worklog' })}
          onLongPress={lp}
        />
      );
      case 'counters': return (
        <HomeRow
          testid="home-counters"
          tint="rgba(76, 194, 232, 0.14)"
          icon={<Icon name="tally" size={18} color="var(--teal)" />}
          label="Counters"
          badge={
            <Show when={countersMet().total > 0}>
              {progressBadge(undefined, countersMet().met, countersMet().total, countersMet().met / countersMet().total,
                countersMet().met === countersMet().total, 'var(--teal)')}
            </Show>
          }
          onClick={() => push({ name: 'counters' })}
          onLongPress={lp}
        />
      );
      case 'finishDay': return (
        <HomeRow
          testid="home-finish-day"
          tint="rgba(182, 120, 224, 0.14)"
          icon={<Icon name="moon" size={18} color="var(--purple)" />}
          label="Finish Day"
          badge={
            <span data-testid="home-finish-day-state" style={{ 'font-size': '13px', 'font-weight': '600', color: dayFinished() ? 'var(--green)' : 'var(--text-tertiary)' }}>
              {dayFinished() ? 'Done' : ''}
            </span>
          }
          onClick={() => push({ name: 'finishDay' })}
          onLongPress={lp}
        />
      );
      default: return null;
    }
  };

  /** One Home block: a card or strip that isn't a single row. */
  const block = (item: HomeItemId, index: number): JSX.Element => {
    switch (item) {
      case 'banner': return <TodayBanner count={counts().today} next={nextTodayTitle()} />;
      case 'widgets': return <WidgetDeck events={events()} tasks={tasks()} targets={targets()} today={currentDate()} />;
      case 'calendarStrip': return <CalendarStrip events={events()} tasks={tasks()} today={currentDate()} />;
      case 'quote': return <div style={{ 'margin-bottom': '12px' }}><QuoteCard today={currentDate()} /></div>;
      case 'views': return (
        <Board title="Views" index={index}>
          <For each={savedViews()}>
            {(v) => (
              <HomeRow
                testid="home-view"
                tint="rgba(76, 194, 232, 0.14)"
                icon={<Icon name="layers" size={18} color="var(--teal)" />}
                label={v.title}
                onClick={() => push({ name: 'view', id: v.id })}
              />
            )}
          </For>
        </Board>
      );
      case 'projects': return (
        <>
          <Show when={standaloneProjects().length > 0}>
            <Board title="Projects" index={index}>
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
              <Board index={index + 1 + i()}>
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
        </>
      );
      default: return null;
    }
  };

  const closeAdd = (then?: () => void) => {
    setAddOpen(false);
    then?.();
  };

  const headerButton: JSX.CSSProperties = {
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    height: '34px',
    'min-width': '34px',
    padding: '0 12px',
    'border-radius': '999px',
    background: 'var(--bg-inset)',
    color: 'var(--text-secondary)',
    'font-size': '15px',
    'font-weight': '600',
  };

  return (
    <>
      <div ref={scrollEl} class="screen-scroll" data-testid="home-scroll" style={{ background: 'var(--bg)' }}>
        <div style={{ padding: `calc(var(--safe-top) + 10px) 0 0` }}>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '2px 16px 10px 20px' }}>
            <h1
              data-testid="home-title"
              style={{
                flex: '1', 'font-size': 'var(--fs-title)', 'font-weight': '700', 'letter-spacing': '-0.02em',
                overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
              }}
            >
              {editing() ? `Edit ${category().title}` : category().title}
            </h1>
            <button
              data-testid="home-edit"
              class="pressable"
              aria-pressed={editing()}
              onClick={() => {
                haptic('tick');
                setAddOpen(false);
                setEditing((e) => !e);
              }}
              style={{ ...headerButton, ...(editing() ? { background: 'var(--blue)', color: '#fff' } : {}) }}
            >
              {editing() ? 'Done' : 'Edit'}
            </button>
            <button
              aria-label="Settings"
              data-testid="settings-button"
              class="pressable"
              onClick={() => push({ name: 'settings' })}
              style={{ ...headerButton, padding: '0' }}
            >
              <Icon name="settings" size={19} />
            </button>
          </div>

          <Show when={!editing()}>
            <button
              onClick={() => setSearchOpen(true)}
              data-testid="search-bar"
              class="pressable"
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                margin: '0 16px 12px',
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
          </Show>

          {/* Keyed on the tab (and edit mode) so the content is rebuilt and
              rises in on every switch. */}
          <Show when={`${category().id}:${editing()}`} keyed>
            {(_key) => (
              <div class="page-in" data-testid={`home-page-${category().id}`}>
                <Show
                  when={!editing()}
                  fallback={
                    <HomeEditor
                      categoryId={category().id}
                      onSelectTab={(id) => setHomeTab(id)}
                      onDone={() => setEditing(false)}
                    />
                  }
                >
                  <Show
                    when={segments().length > 0}
                    fallback={
                      <div data-testid="home-empty-tab" style={{ padding: '40px 32px', 'text-align': 'center', color: 'var(--text-secondary)', 'font-size': '15px', 'line-height': '1.5' }}>
                        Nothing in this tab yet.
                        <br />
                        Tap <b>Edit</b> to bring items here, or long-press a row on another tab and choose this one.
                      </div>
                    }
                  >
                    <For each={segments()}>
                      {(seg, i) => seg.kind === 'block'
                        ? block(seg.item, i())
                        : (
                          <Board index={i()}>
                            <For each={seg.items}>{(item) => row(item)}</For>
                          </Board>
                        )}
                    </For>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>

      <Show when={addOpen()}>
        <div class="add-menu-veil" data-testid="add-menu-veil" onClick={() => setAddOpen(false)} />
        <div class="add-menu" data-testid="add-menu">
          <AddMenuRow testid="add-todo" icon={<Icon name="checklist" size={20} color="var(--blue)" />} label="New To-Do"
            onClick={() => closeAdd(() => setQuickEntry({ destination: { bucket: 'inbox' } }))} />
          <AddMenuRow testid="add-project" icon={<ProgressPie progress={0.35} size={20} />} label="New Project"
            onClick={() => closeAdd(() => void createProject({ title: '' }).then((id) => push({ name: 'project', id })))} />
          <AddMenuRow testid="add-area" icon={<Icon name="hexagon" size={20} color="var(--teal)" />} label="New Area"
            onClick={() => closeAdd(() => void createArea('').then((id) => push({ name: 'area', id })))} />
          <AddMenuRow testid="add-view" icon={<Icon name="layers" size={20} color="var(--teal)" />} label="New View (filtered list)"
            onClick={() => closeAdd(() => setViewEditorOpen(true))} />
          <AddMenuRow testid="add-template" icon={<Icon name="checklist" size={20} color="var(--purple)" />} label="Project from Template"
            onClick={() => closeAdd(() => setTemplatesOpen(true))} />
          <AddMenuRow testid="add-board" icon={<Icon name="board" size={20} color="var(--blue)" />} label="New Board"
            onClick={() => closeAdd(() => void createBoard({ title: '' }).then((id) => push({ name: 'board', id })))} />
        </div>
      </Show>

      <HomeTabBar
        categories={homeLayout().categories}
        selected={category().id}
        onSelect={selectTab}
        addOpen={addOpen()}
        onAdd={() => setAddOpen((o) => !o)}
      />

      <Show when={moving()}>
        {(item) => <MoveSheet item={item()} onClose={() => setMoving(null)} />}
      </Show>
      <Show when={viewEditorOpen()}>
        <ViewEditor
          onSave={(title, filter, groupBy) => void createSavedView(title, filter, groupBy).then((id) => push({ name: 'view', id }))}
          onClose={() => setViewEditorOpen(false)}
        />
      </Show>
      <Show when={templatesOpen()}>
        <TemplatesSheet onClose={() => setTemplatesOpen(false)} />
      </Show>
    </>
  );
}

export { setQuickEntry };
