import {
  createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack,
  type JSX,
} from 'solid-js';
import { nanoid } from 'nanoid';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { currentDate } from '../app/currentDate';
import { haptic } from '../app/motion';
import { aiConfig, routineRemind, setRoutineRemind } from '../app/settings';
import { requestRoutinePermission } from '../app/routineReminders';
import type { FeedEntry, RoutineGroup, RoutineSource } from '../db/models';
import {
  captureMissed, checkedIdsIn, colorForGroupId, completionHistory, computeStreak,
  feedsBySource, formatMissDate, groupColor, hasFeed, liveMisses, MISS_SOURCE_CAP,
  newEntriesFor, passesFocus, seenUrlSet, sectionsOf, STICKY_FOCUS, streakGrid,
  totalMissed, visibleSources, windowProgress, type RoutineFocus,
} from '../domain/myRoutine';
import { formatClock, routineWindowAt, sortedWindows } from '../domain/routineWindows';
import { formatRelative } from '../domain/dates';
import {
  bankStreakDay, clearMisses, createGroup, createSource, createWindow, deleteGroup,
  deleteSource, deleteWindow, ensureWindows, markSeen, moveSourceToGroup, pruneMisses,
  pruneSeen, renameGroup, reorderGroups, saveFeed, saveFeedError, saveMiss, setChecked,
  setGroupColor, shapeSource, snoozeSource, updateSource, updateWindow,
} from '../db/myRoutineMutations';
import { discoverFeed, fetchSourceFeed, openExternal, resolveYtChannelId } from '../net/feeds';
import { resolveOpenUrl } from '../domain/feedParse';
import { aiChat, digestReady, openInClaude, providerLabel } from '../net/ai';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { ProgressRing } from '../ui/ProgressRing';
import { ScreenChrome, EmptyState } from './common';
import {
  CountPill, GroupDot, RoutineBlock, RoutineEntryCard, ToolbarButton, kindIcon,
} from '../components/RoutineBlock';
import {
  DigestSheet, GroupSheet, SourceMenu, SourceSheet, StatsSheet, WindowsSheet,
  type SourceDraftState,
} from '../components/RoutineSheets';

/** My Routine — the channels, accounts and sites you go through each day,
 *  grouped, checked off inside a time window, and remembered when you miss
 *  them. Separate from Habits: nothing here is a to-do, and skipping a day
 *  costs you a streak rather than creating an overdue task. */

/** How long a cached feed stays fresh before the screen refetches it. */
const FEED_TTL_MS = 20 * 60 * 1000;
const COLLAPSED_KEY = 'clarity-routine-collapsed';
const FOCUS_KEY = 'clarity-routine-focus';
const LAST_WINDOW_KEY = 'clarity-routine-lastwindow';

interface StoredWindow {
  key: string;
  start: number;
  end: number;
  name: string;
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function loadFocus(): RoutineFocus {
  try {
    const v = localStorage.getItem(FOCUS_KEY) as RoutineFocus | null;
    return v && STICKY_FOCUS.includes(v) ? v : 'all';
  } catch {
    return 'all';
  }
}

export function MyRoutineScreen(): JSX.Element {
  const groups = createLiveQuery(() => db.routineGroups.toArray(), []);
  const sources = createLiveQuery(() => db.routineSources.toArray(), []);
  const windows = createLiveQuery(() => db.routineWindows.toArray(), []);
  const checks = createLiveQuery(() => db.routineChecks.toArray(), []);
  const feedRows = createLiveQuery(() => db.routineFeeds.toArray(), []);
  const seenRows = createLiveQuery(() => db.routineSeen.toArray(), []);
  const missRows = createLiveQuery(() => db.routineMisses.toArray(), []);
  const dayRows = createLiveQuery(() => db.routineDays.toArray(), []);

  // `now` is sampled once per render pass rather than read live: a ticking
  // clock would re-run every memo below every second for no visible gain.
  const [now, setNow] = createSignal(Date.now());
  const [selectedWindow, setSelectedWindow] = createSignal<string | null>(null);
  const [focus, setFocusRaw] = createSignal<RoutineFocus>(loadFocus());
  const [query, setQuery] = createSignal('');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(loadCollapsed());
  const [reordering, setReordering] = createSignal(false);
  const [expandedMiss, setExpandedMiss] = createSignal(new Set<string>());

  const [sourceDraft, setSourceDraft] = createSignal<SourceDraftState | null>(null);
  const [groupDraft, setGroupDraft] = createSignal<{ group: RoutineGroup | null } | null>(null);
  const [sourceMenu, setSourceMenu] = createSignal<RoutineSource | null>(null);
  const [windowsOpen, setWindowsOpen] = createSignal(false);
  const [statsOpen, setStatsOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [toast, setToast] = createSignal('');
  const [digest, setDigest] = createSignal<{ busy: boolean; status: string; text: string; error: string } | null>(null);

  const say = (message: string): void => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? '' : t)), 2600);
  };

  onMount(() => {
    void ensureWindows();
    void pruneMisses();
    void pruneSeen();
    // Keep relative stamps ("2h ago") honest without a per-second clock.
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(timer));
  });

  const orderedWindows = createMemo(() => sortedWindows(windows()));
  const span = createMemo(() => routineWindowAt(orderedWindows(), selectedWindow(), new Date(now())));
  const currentWindow = createMemo(
    () => orderedWindows().find((w) => w.id === span()?.selectedId) ?? orderedWindows()[0],
  );
  const upcoming = createMemo(() => span()?.upcomingAt != null);

  const orderedGroups = createMemo(() => groups());
  const visible = createMemo(() => visibleSources(sources(), now()));
  const feeds = createMemo(() => feedsBySource(feedRows()));
  const seen = createMemo(() => seenUrlSet(seenRows()));
  const done = createMemo(() => checkedIdsIn(checks(), span()?.key ?? ''));

  /** New entries for one source inside the window being viewed. An upcoming
   *  window has no span yet, so nothing counts as new there. */
  const newEntries = (source: RoutineSource): FeedEntry[] => {
    const s = span();
    if (!s || upcoming() || !hasFeed(source)) return [];
    return newEntriesFor(feeds().get(source.id), s.start, s.end, seen());
  };
  const newCountFor = (source: RoutineSource): number => newEntries(source).length;

  const newTotal = createMemo(() => visible().reduce((n, s) => n + newCountFor(s), 0));
  const progress = createMemo(() => windowProgress(visible(), done()));
  const streak = createMemo(() => computeStreak(dayRows(), currentDate()));
  const grid = createMemo(() => streakGrid(dayRows(), currentDate(), 35));
  const misses = createMemo(() => liveMisses(missRows(), now()));
  const dayHistory = createMemo(() => completionHistory(checks(), dayRows(), currentDate(), 14));

  const sections = createMemo(() => sectionsOf(orderedGroups(), visible()));

  const setFocus = (value: RoutineFocus): void => {
    setFocusRaw(value);
    try {
      if (STICKY_FOCUS.includes(value)) localStorage.setItem(FOCUS_KEY, value);
      else localStorage.removeItem(FOCUS_KEY);
    } catch {
      /* private mode; the filter just won't persist */
    }
  };

  const toggleCollapse = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* not worth failing the tap over */
      }
      return next;
    });
  };

  // ---------------------------------------------------------------- effects --

  /** Best-effort refresh of every pollable source, once per mount. Failures are
   *  recorded on the row rather than thrown: one dead feed must not stop the
   *  rest, and a stale cache still beats an empty screen. */
  onMount(() => {
    let live = true;
    void (async () => {
      // Wait a tick for the first liveQuery result rather than reading an
      // empty array; the screen renders immediately either way.
      const all = await db.routineSources.toArray();
      for (const source of all) {
        if (!live) return;
        if (!hasFeed(source)) continue;
        const cached = await db.routineFeeds.get(source.id);
        if (cached && Date.now() - cached.fetchedAt < FEED_TTL_MS) continue;
        try {
          const entries = await fetchSourceFeed(source);
          if (entries && live) await saveFeed(source.id, entries);
        } catch (e) {
          if (live) await saveFeedError(source.id, e instanceof Error ? e.message : 'Could not read this feed');
        }
      }
    })();
    onCleanup(() => {
      live = false;
    });
  });

  /** When the live window rolls over, archive what the previous one went by
   *  without. Runs off the window key so it fires once per rollover, not once
   *  per render. */
  createEffect(() => {
    const s = span();
    if (!s || !s.key) return;
    const key = s.key;
    const name = currentWindow()?.name ?? 'Routine';

    untrack(() => {
      let stored: StoredWindow | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(LAST_WINDOW_KEY) ?? 'null') as StoredWindow | null;
      } catch {
        stored = null;
      }
      if (stored?.key && stored.key !== key) {
        const miss = captureMissed(
          { key: stored.key, windowName: stored.name, start: stored.start, end: stored.end },
          sources(),
          groups(),
          feeds(),
          checkedIdsIn(checks(), stored.key),
          seen(),
          nanoid(),
          Date.now(),
        );
        if (miss) void saveMiss(miss);
      }
      try {
        localStorage.setItem(
          LAST_WINDOW_KEY,
          JSON.stringify({ key, start: s.start, end: s.end, name } satisfies StoredWindow),
        );
      } catch {
        /* rollover archiving is a nicety, not a correctness requirement */
      }
    });
  });

  /** Clearing a whole window banks the day toward the streak. */
  createEffect(() => {
    if (!progress().complete || upcoming()) return;
    const date = currentDate();
    untrack(() => {
      if (dayRows().some((d) => d.date === date)) return;
      haptic('success');
      void bankStreakDay(date);
      say('Routine complete 🔥');
    });
  });

  // ----------------------------------------------------------------- actions --

  const toggleSource = (source: RoutineSource): void => {
    const s = span();
    if (!s?.key) return;
    const next = !done().has(source.id);
    haptic(next ? 'select' : 'tick');
    void setChecked(s.key, source.id, next);
  };

  /** Opening a source is doing it. You tapped through to the channel, so the
   *  row ticks itself and the list you come back to reflects that — no second
   *  trip to the checkbox. Still undoable: tap the checkbox to clear it. */
  const markDone = (source: RoutineSource): void => {
    const s = span();
    if (!s?.key || done().has(source.id)) return;
    void setChecked(s.key, source.id, true);
  };

  const openSource = (source: RoutineSource): void => {
    markDone(source);
    // Resolve at tap time: a row stored before the URL shaping was fixed can
    // hold something a browser cannot navigate to.
    openExternal(resolveOpenUrl(source.kind, source.url, source.name));
  };

  /** `source` is passed for an update in the live window, and omitted from
   *  History: reading something you missed on Tuesday must not tick off
   *  today's window. */
  const openEntry = (entry: FeedEntry, source?: RoutineSource): void => {
    if (source) markDone(source);
    void markSeen([entry.url]);
    openExternal(entry.url);
  };

  /** Resolve the fetch handle a source needs, then write it. YouTube needs its
   *  UC… id and an RSS source may have been given a site rather than a feed;
   *  both resolutions go over the network, so the row is saved first and
   *  patched after — the sheet never waits on a proxy. */
  const saveSource = async (draft: SourceDraftState): Promise<void> => {
    setSaving(true);
    try {
      const id = draft.id;
      if (id) {
        // Re-shape from the raw input rather than patching name and group
        // alone: the sheet lets you change the link, and clearing the resolved
        // channelId/feedUrl here is what makes the resolve step below re-run
        // for the new one.
        const shaped = shapeSource({
          kind: draft.kind, raw: draft.raw, name: draft.name, groupId: draft.groupId,
        });
        await updateSource(id, { ...shaped, groupId: draft.groupId });
      }
      const source = id
        ? (await db.routineSources.get(id))!
        : await createSource({ kind: draft.kind, raw: draft.raw, name: draft.name, groupId: draft.groupId });
      setSourceDraft(null);
      say(id ? 'Saved' : `Added “${source.name}”`);

      if (draft.kind === 'youtube' && !source.channelId) {
        const channelId = await resolveYtChannelId(draft.raw);
        if (channelId) {
          await updateSource(source.id, { channelId, url: `https://www.youtube.com/channel/${channelId}` });
        }
      } else if (draft.kind === 'rss' && !source.feedUrl) {
        const feedUrl = await discoverFeed(draft.raw);
        if (feedUrl) await updateSource(source.id, { feedUrl });
      }

      const fresh = await db.routineSources.get(source.id);
      if (fresh && hasFeed(fresh)) {
        try {
          const entries = await fetchSourceFeed(fresh);
          if (entries) await saveFeed(fresh.id, entries);
        } catch (e) {
          await saveFeedError(fresh.id, e instanceof Error ? e.message : 'Could not read this feed');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleRemind = async (): Promise<void> => {
    if (routineRemind()) {
      await setRoutineRemind(false);
      say('Reminders off');
      return;
    }
    const permission = await requestRoutinePermission();
    if (permission !== 'granted') {
      say('Allow notifications to get routine reminders');
      return;
    }
    await setRoutineRemind(true);
    say('Reminders on — you’ll be nudged when a window opens');
  };

  /** The lines both AI paths work from: what's new right now, falling back to
   *  the recent History so the button is never dead on a cleared window. */
  const digestLines = (): string[] => {
    const out: string[] = [];
    for (const source of visible()) {
      for (const entry of newEntries(source)) out.push(`${source.name}: ${entry.title.slice(0, 160)}`);
    }
    if (!out.length) {
      for (const miss of misses().slice(0, 8)) {
        for (const item of miss.items) {
          for (const entry of item.entries) out.push(`${item.name}: ${entry.title.slice(0, 160)}`);
        }
      }
    }
    return out.slice(0, 60);
  };

  const runDigest = async (): Promise<void> => {
    const config = aiConfig();
    if (!digestReady(config)) {
      say('Add an OpenRouter or Gemini key in Settings → AI');
      return;
    }
    const lines = digestLines();
    if (!lines.length) {
      say('Nothing new to summarize');
      return;
    }
    setDigest({ busy: true, status: '', text: '', error: '' });
    try {
      const text = await aiChat(
        config,
        [
          {
            role: 'system',
            content: 'You turn a list of new posts from feeds someone follows into a short, skimmable briefing.',
          },
          {
            role: 'user',
            content:
              'These are new posts from channels and sites I follow. Group them by theme and give me a concise briefing of 4–8 bullet points on what actually matters, then a final line starting with "Worth your time:" naming the single most important item.\n\n' +
              lines.join('\n'),
          },
        ],
        1200,
        (status) => setDigest((d) => (d ? { ...d, status } : d)),
      );
      setDigest({ busy: false, status: '', text, error: '' });
    } catch (e) {
      setDigest({
        busy: false,
        status: '',
        text: '',
        error: e instanceof Error ? e.message : 'Could not summarize right now',
      });
    }
  };

  const askClaude = async (): Promise<void> => {
    const lines = digestLines();
    if (!lines.length) {
      say('Nothing new to send');
      return;
    }
    const prompt =
      'These are the new posts from the channels and sites I follow today. Group them by theme, tell me concisely what matters, and end with a line starting "Worth your time:" naming the single most important item.\n\n' +
      `----- MY ROUTINE — ${lines.length} UPDATES -----\n${lines.join('\n')}`;
    await openInClaude(prompt);
    say('Prompt copied — opening Claude');
  };

  // -------------------------------------------------------------- group drag --

  const [dragOver, setDragOver] = createSignal(-1);
  let dragState = { active: false, from: 0, startY: 0 };

  /** Press-and-drag a group's handle to reorder. One row is ~80px tall, so the
   *  pointer's travel divided by that gives the index it is over. */
  const startGroupDrag = (index: number, e: MouseEvent | TouchEvent): void => {
    const startY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
    dragState = { active: true, from: index, startY };
    setDragOver(index);
    const count = (): number => orderedGroups().length;

    const move = (ev: MouseEvent | TouchEvent): void => {
      if (!dragState.active) return;
      const y = 'touches' in ev ? ev.touches[0]!.clientY : ev.clientY;
      const step = Math.round((y - dragState.startY) / 80);
      setDragOver(Math.min(Math.max(dragState.from + step, 0), count() - 1));
    };
    const end = (ev: MouseEvent | TouchEvent): void => {
      if (!dragState.active) return;
      dragState.active = false;
      const y = 'changedTouches' in ev && ev.changedTouches[0] ? ev.changedTouches[0].clientY : (ev as MouseEvent).clientY;
      const step = Math.round((y - dragState.startY) / 80);
      const to = Math.min(Math.max(dragState.from + step, 0), count() - 1);
      if (to !== dragState.from) void reorderGroups(dragState.from, to);
      setDragOver(-1);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
    };
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  };

  // ------------------------------------------------------------------ render --

  const sourceRow = (source: RoutineSource): JSX.Element => {
    const entries = createMemo(() => newEntries(source));
    const isDone = createMemo(() => done().has(source.id));
    const feed = createMemo(() => feeds().get(source.id));
    const key = `src:${source.id}`;
    const entriesOpen = createMemo(() => !collapsed().has(key));
    return (
      <div data-testid="routine-source" style={{ padding: '7px 0' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '11px' }}>
          <Checkbox checked={isDone()} onToggle={() => toggleSource(source)} />
          <button
            class="pressable"
            onClick={() => openSource(source)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSourceMenu(source);
            }}
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              flex: '1',
              'min-width': '0',
              'text-align': 'left',
            }}
          >
            <Icon name={kindIcon(source.kind)} size={15} color="var(--text-tertiary)" />
            <span
              style={{
                flex: '1',
                'min-width': '0',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
                'font-size': '15px',
                color: isDone() ? 'var(--text-tertiary)' : 'var(--text)',
                'text-decoration': isDone() ? 'line-through' : 'none',
              }}
            >
              {source.name}
            </span>
          </button>
          <Show when={entries().length > 0}>
            <CountPill label={`${entries().length} new`} tone="new" />
          </Show>
          <Show when={hasFeed(source) && entries().length > 0}>
            <button
              class="pressable"
              onClick={() => toggleCollapse(key)}
              aria-label={entriesOpen() ? 'Hide updates' : 'Show updates'}
              style={{
                display: 'flex',
                color: 'var(--text-tertiary)',
                padding: '4px',
                transform: entriesOpen() ? 'rotate(90deg)' : 'none',
                transition: 'transform 160ms',
              }}
            >
              <Icon name="chevron-right" size={13} />
            </button>
          </Show>
          <button
            class="pressable"
            onClick={() => setSourceMenu(source)}
            aria-label={`Actions for ${source.name}`}
            style={{ display: 'flex', color: 'var(--text-tertiary)', padding: '4px' }}
          >
            <Icon name="ellipsis" size={16} />
          </button>
        </div>
        <Show when={feed()?.error && !entries().length}>
          <div style={{ 'font-size': '11.5px', color: 'var(--text-tertiary)', padding: '2px 0 0 30px' }}>
            Couldn’t read this feed
          </div>
        </Show>
        <Show when={entries().length > 0 && entriesOpen()}>
          <div style={{ display: 'flex', 'flex-direction': 'column', 'padding-left': '30px', 'margin-top': '2px' }}>
            <For each={entries().slice(0, 4)}>
              {(entry) => (
                <RoutineEntryCard
                  entry={entry}
                  kind={source.kind}
                  now={now()}
                  onOpen={() => openEntry(entry, source)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  const sectionHeader = (group: RoutineGroup | null, list: RoutineSource[], index: number): JSX.Element => {
    const key = group ? group.id : '_other';
    const isOpen = (): boolean => !collapsed().has(key);
    const groupNew = (): number => list.reduce((n, s) => n + newCountFor(s), 0);
    return (
      <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
        <button
          class="pressable"
          onClick={() => toggleCollapse(key)}
          aria-label={isOpen() ? 'Collapse group' : 'Expand group'}
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '7px',
            flex: '1',
            'min-width': '0',
            padding: '2px 0',
          }}
        >
          <span
            style={{
              display: 'flex',
              color: 'var(--text-tertiary)',
              flex: 'none',
              transform: isOpen() ? 'rotate(90deg)' : 'none',
              transition: 'transform 160ms',
            }}
          >
            <Icon name="chevron-right" size={12} />
          </span>
          <GroupDot color={group ? groupColor(group) : 'var(--text-tertiary)'} />
          <span
            style={{
              'font-size': '12.5px',
              'font-weight': '700',
              'letter-spacing': '0.05em',
              'text-transform': 'uppercase',
              color: 'var(--text-secondary)',
              flex: '1',
              'min-width': '0',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              'text-align': 'left',
            }}
          >
            {group ? group.name : 'Other'}
          </span>
          <Show when={groupNew() > 0} fallback={<CountPill label={String(list.length)} />}>
            <CountPill label={`${groupNew()} new`} tone="new" />
          </Show>
        </button>
        <Show when={group && reordering()}>
          <button
            class="pressable"
            onMouseDown={(e) => startGroupDrag(index, e)}
            onTouchStart={(e) => startGroupDrag(index, e)}
            aria-label={`Reorder ${group!.name}`}
            style={{ display: 'flex', flex: 'none', color: 'var(--text-tertiary)', padding: '6px', cursor: 'grab' }}
          >
            <Icon name="grip" size={16} />
          </button>
        </Show>
        <Show when={group}>
          <button
            class="pressable"
            onClick={() => setGroupDraft({ group: group! })}
            aria-label={`Rename ${group!.name}`}
            style={{ display: 'flex', flex: 'none', color: 'var(--text-tertiary)', padding: '4px' }}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            class="pressable"
            onClick={() => void deleteGroup(group!.id)}
            aria-label={`Delete ${group!.name}`}
            style={{ display: 'flex', flex: 'none', color: 'var(--red)', padding: '4px' }}
          >
            <Icon name="trash" size={15} />
          </button>
        </Show>
        <button
          class="pressable"
          onClick={() =>
            setSourceDraft({ id: null, kind: 'link', raw: '', name: '', groupId: group ? group.id : null })
          }
          aria-label={group ? `Add to ${group.name}` : 'Add source'}
          data-testid="routine-add-source"
          style={{ display: 'flex', flex: 'none', color: 'var(--blue)', padding: '4px' }}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
    );
  };

  const toggleMissExpand = (key: string): void => {
    setExpandedMiss((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const historySection = (): JSX.Element => {
    const isOpen = (): boolean => collapsed().has('_history');
    const missed = (): number => totalMissed(misses());
    return (
      <div style={{ margin: '10px 16px 0', 'border-top': '1px solid var(--separator)' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '14px 0 4px' }}>
          <button
            class="pressable"
            onClick={() => toggleCollapse('_history')}
            data-testid="routine-history-toggle"
            aria-label={isOpen() ? 'Collapse history' : 'Expand history'}
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '8px',
              flex: '1',
              color: 'var(--text-secondary)',
              'text-align': 'left',
            }}
          >
            <span
              style={{
                display: 'flex',
                transform: isOpen() ? 'rotate(90deg)' : 'none',
                transition: 'transform 160ms',
              }}
            >
              <Icon name="chevron-right" size={15} />
            </span>
            <span
              style={{
                flex: '1',
                'font-size': '12px',
                'font-weight': '700',
                'letter-spacing': '0.05em',
                'text-transform': 'uppercase',
              }}
            >
              History{missed() ? ` · ${missed()} missed` : ''}
            </span>
          </button>
          <Show when={misses().length > 0}>
            <button
              class="pressable"
              onClick={() => void clearMisses()}
              aria-label="Clear history"
              style={{ display: 'flex', color: 'var(--red)', padding: '3px' }}
            >
              <Icon name="trash" size={16} />
            </button>
          </Show>
        </div>

        <Show when={isOpen()}>
          {/* Two records, deliberately: what you got through each day, and what
              slipped past while you weren't looking. */}
          <div data-testid="routine-history">
            <div
              style={{
                'font-size': '11px',
                'font-weight': '700',
                'letter-spacing': '0.05em',
                'text-transform': 'uppercase',
                color: 'var(--text-tertiary)',
                margin: '8px 0 6px',
              }}
            >
              Last 14 days
            </div>
            <div style={{ display: 'flex', gap: '5px', 'overflow-x': 'auto', 'padding-bottom': '10px' }}>
              <For each={[...dayHistory()].reverse()}>
                {(day) => (
                  <div
                    title={`${day.date} · ${day.done} checked`}
                    style={{ flex: 'none', width: '34px', 'text-align': 'center' }}
                  >
                    <div
                      style={{
                        height: '34px',
                        'border-radius': '8px',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'center',
                        'font-size': '12px',
                        'font-weight': '600',
                        'font-variant-numeric': 'tabular-nums',
                        background: day.banked ? 'var(--green)' : day.done ? 'var(--bg-inset)' : 'transparent',
                        border: day.banked ? 'none' : '1px solid var(--separator)',
                        color: day.banked ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {day.done || ''}
                    </div>
                    <div style={{ 'font-size': '9.5px', color: 'var(--text-tertiary)', 'margin-top': '3px' }}>
                      {day.date.slice(8)}
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show
              when={misses().length > 0}
              fallback={
                <div style={{ 'font-size': '12.5px', color: 'var(--text-secondary)', padding: '6px 0 10px', 'line-height': '1.5' }}>
                  Updates you miss are saved here automatically for 14 days, so you can catch up later.
                </div>
              }
            >
              <div style={{ margin: '0 -16px' }}>
                <For each={misses()}>
                  {(miss) => (
                    <RoutineBlock accent={colorForGroupId(miss.id)} testid="routine-miss">
                      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '6px' }}>
                        <span style={{ flex: '1', 'font-size': '13.5px', 'font-weight': '700', color: 'var(--text)' }}>
                          {miss.windowName} · {formatMissDate(miss.snapshotAt, currentDate())}
                        </span>
                        <CountPill
                          label={`${miss.items.reduce((n, i) => n + i.entries.length, 0)} missed`}
                          tone="new"
                        />
                      </div>
                      <For each={miss.items}>
                        {(item, itemIndex) => {
                          const key = `${miss.id}/${item.sourceId}`;
                          const all = createMemo(() =>
                            [...item.entries].sort((a, b) => b.publishedMs - a.publishedMs),
                          );
                          const open = (): boolean => expandedMiss().has(key);
                          const shown = (): FeedEntry[] =>
                            open() ? all() : all().slice(0, MISS_SOURCE_CAP);
                          return (
                            <div
                              style={{
                                padding: '8px 0',
                                'border-top': itemIndex() ? '1px solid var(--separator)' : 'none',
                              }}
                            >
                              <div
                                style={{
                                  'font-size': '11px',
                                  'font-weight': '700',
                                  'letter-spacing': '0.04em',
                                  'text-transform': 'uppercase',
                                  color: 'var(--text-tertiary)',
                                  'margin-bottom': '4px',
                                }}
                              >
                                {item.name}
                                {item.groupName ? ` · ${item.groupName}` : ''}
                              </div>
                              <For each={shown()}>
                                {(entry) => (
                                  <RoutineEntryCard
                                    entry={entry}
                                    kind={item.kind}
                                    compact
                                    now={now()}
                                    onOpen={() => openEntry(entry)}
                                  />
                                )}
                              </For>
                              <Show when={all().length > MISS_SOURCE_CAP}>
                                <button
                                  class="pressable"
                                  onClick={() => toggleMissExpand(key)}
                                  style={{
                                    'align-self': 'flex-start',
                                    'font-size': '12px',
                                    'font-weight': '600',
                                    color: 'var(--blue)',
                                    padding: '5px 2px',
                                  }}
                                >
                                  {open() ? 'Show less' : `+${all().length - MISS_SOURCE_CAP} more`}
                                </button>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </RoutineBlock>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    );
  };

  const focusOptions: Array<[RoutineFocus, string]> = [
    ['all', 'All'],
    ['todo', 'To‑do'],
    ['new', 'New'],
    ['completed', 'Completed'],
  ];

  const focusCount = (value: RoutineFocus): number => {
    if (value === 'todo') return visible().filter((s) => !done().has(s.id)).length;
    if (value === 'new') return visible().filter((s) => newCountFor(s) > 0).length;
    if (value === 'completed') return visible().filter((s) => done().has(s.id)).length;
    return visible().length;
  };

  return (
    <ScreenChrome
      title="My Routine"
      icon={<Icon name="sunrise" size={28} color="var(--yellow-deep)" />}
      subtitle={
        upcoming()
          ? `${currentWindow()?.name ?? 'Routine'} begins at ${formatClock(currentWindow()?.time ?? '')}`
          : `${formatRelative(currentDate(), currentDate())} · ${progress().done}/${progress().total} done${streak().current ? ` · ${streak().current}🔥` : ''}`
      }
      trailing={
        <Show when={progress().total > 0}>
          <span style={{ padding: '8px 10px', display: 'flex' }}>
            <ProgressRing
              progress={progress().ratio}
              size={22}
              thickness={12}
              color={progress().complete ? 'var(--green)' : 'var(--yellow-deep)'}
            />
          </span>
        </Show>
      }
    >
      {/* toolbar */}
      <div style={{ display: 'flex', gap: '8px', padding: '4px 16px', 'overflow-x': 'auto' }}>
        <ToolbarButton
          label="Search"
          active={searchOpen()}
          testid="routine-search"
          onClick={() =>
            setSearchOpen((open) => {
              if (open) setQuery('');
              return !open;
            })
          }
        >
          <Icon name="search" size={17} />
        </ToolbarButton>
        <ToolbarButton
          label="New group"
          testid="routine-new-group"
          onClick={() => setGroupDraft({ group: null })}
        >
          <Icon name="plus" size={17} />
        </ToolbarButton>
        <ToolbarButton
          label={reordering() ? 'Done reordering' : 'Reorder groups'}
          active={reordering()}
          onClick={() => setReordering((r) => !r)}
        >
          <Icon name="grip" size={17} />
        </ToolbarButton>
        <ToolbarButton label="Routine reminders" active={routineRemind()} onClick={() => void toggleRemind()}>
          <Icon name="bell" size={17} />
        </ToolbarButton>
        <ToolbarButton label="Routine stats" testid="routine-stats" onClick={() => setStatsOpen(true)}>
          <Icon name="chart" size={17} />
        </ToolbarButton>
        <ToolbarButton
          label="Summarize what's new"
          badge={newTotal() ? String(newTotal()) : undefined}
          disabled={digest()?.busy}
          onClick={() => void runDigest()}
        >
          <Icon name="sparkle" size={17} />
        </ToolbarButton>
        <ToolbarButton label="Ask Claude about my routine" onClick={() => void askClaude()}>
          <Icon name="send" size={17} />
        </ToolbarButton>
      </div>

      {/* window tabs */}
      <div style={{ display: 'flex', gap: '6px', 'overflow-x': 'auto', padding: '10px 16px 8px' }}>
        <For each={orderedWindows()}>
          {(w) => (
            <button
              class="pressable"
              onClick={() => setSelectedWindow(w.id)}
              data-testid={`routine-window-${w.name.toLowerCase()}`}
              aria-pressed={w.id === span()?.selectedId}
              style={{
                flex: 'none',
                padding: '8px 18px',
                'border-radius': '20px',
                'font-size': '15px',
                'font-weight': '600',
                background: w.id === span()?.selectedId ? 'var(--text)' : 'transparent',
                color: w.id === span()?.selectedId ? 'var(--bg-list)' : 'var(--text-secondary)',
              }}
            >
              {w.name}
              {w.id === span()?.activeId ? ' •' : ''}
            </button>
          )}
        </For>
        <button
          class="pressable"
          onClick={() => setWindowsOpen(true)}
          aria-label="Edit routine windows"
          data-testid="routine-edit-windows"
          style={{ flex: 'none', display: 'flex', 'align-items': 'center', color: 'var(--text-secondary)', padding: '0 8px' }}
        >
          <Icon name="calendar" size={18} />
        </button>
      </div>

      {/* focus filters */}
      <Show when={visible().length > 0}>
        <div style={{ display: 'flex', gap: '6px', 'overflow-x': 'auto', padding: '0 16px 10px' }}>
          <For each={focusOptions}>
            {([value, label]) => (
              <button
                class="pressable"
                onClick={() => setFocus(value)}
                aria-pressed={focus() === value}
                data-testid={`routine-focus-${value}`}
                style={{
                  flex: 'none',
                  display: 'flex',
                  'align-items': 'center',
                  gap: '6px',
                  padding: '6px 13px',
                  'border-radius': '16px',
                  'font-size': '12.5px',
                  'font-weight': '600',
                  border: `1px solid ${focus() === value ? 'var(--text)' : 'var(--separator)'}`,
                  background: focus() === value ? 'var(--text)' : 'transparent',
                  color: focus() === value ? 'var(--bg-list)' : 'var(--text-secondary)',
                }}
              >
                {label}
                <span style={{ 'font-size': '11px', 'font-weight': '700', opacity: '0.75' }}>
                  {focusCount(value)}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={searchOpen()}>
        <div style={{ padding: '0 16px 10px' }}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '9px',
              background: 'var(--bg-inset)',
              border: `1px solid ${query() ? 'var(--blue)' : 'var(--separator)'}`,
              'border-radius': '12px',
              padding: '9px 12px',
            }}
          >
            <Icon name="search" size={17} color={query() ? 'var(--blue)' : 'var(--text-tertiary)'} />
            <input
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search channels & sites"
              autocapitalize="none"
              autocorrect="off"
              spellcheck={false}
              data-testid="routine-search-input"
              style={{
                flex: '1',
                'min-width': '0',
                border: 'none',
                background: 'transparent',
                color: 'var(--text)',
                'font-size': '16px',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </Show>

      <Show when={upcoming()}>
        <div style={{ padding: '14px 20px', 'font-size': '13.5px', color: 'var(--text-secondary)', 'line-height': '1.5' }}>
          This window begins at {formatClock(currentWindow()?.time ?? '')}. New content since your last
          check will appear here then.
        </div>
      </Show>

      {/* Groups render as soon as one exists, even with no sources in it yet:
          the group's own + button is the only way to add the first source, so
          hiding the list behind the empty state would be a dead end. */}
      <Show
        when={visible().length > 0 || orderedGroups().length > 0}
        fallback={
          <EmptyState
            icon={<Icon name="sunrise" size={40} color="var(--text-tertiary)" />}
            text="Group the apps, sites and channels you go through each day, then check them off."
          />
        }
      >
        <For each={sections()}>
          {(section, index) => {
            const filtered = createMemo(() =>
              section.sources.filter((s) =>
                passesFocus(s, focus(), { done: done(), newCountFor, query: query() }),
              ),
            );
            const key = section.group ? section.group.id : '_other';
            const dragging = (): boolean => dragOver() !== -1;
            const hide = (): boolean =>
              (focus() !== 'all' || !!query().trim()) && !dragging() && filtered().length === 0;
            return (
              <Show when={!hide()}>
                <RoutineBlock
                  accent={section.group ? groupColor(section.group) : 'var(--text-tertiary)'}
                  dim={dragging() && dragState.from === index()}
                  dropTarget={dragging() && dragOver() === index() && dragState.from !== index()}
                  testid="routine-group"
                >
                  {sectionHeader(section.group, section.sources, index())}
                  <Show when={!collapsed().has(key) || !!query().trim()}>
                    <div style={{ 'margin-top': '8px', 'border-top': '1px solid var(--separator)', 'padding-top': '4px' }}>
                      <Show
                        when={filtered().length > 0}
                        fallback={
                          <div style={{ 'font-size': '13px', color: 'var(--text-tertiary)', padding: '8px 4px 12px' }}>
                            {focus() === 'all' && !query().trim()
                              ? 'Nothing here yet — tap + to add.'
                              : 'Nothing matches this filter.'}
                          </div>
                        }
                      >
                        <For each={filtered()}>{(source) => sourceRow(source)}</For>
                      </Show>
                    </div>
                  </Show>
                </RoutineBlock>
              </Show>
            );
          }}
        </For>
      </Show>

      {historySection()}
      <div style={{ height: 'calc(28px + var(--safe-bottom))' }} />

      {/* sheets */}
      <Show when={sourceDraft()}>
        <SourceSheet
          draft={sourceDraft()!}
          groups={orderedGroups()}
          busy={saving()}
          onSave={(draft) => void saveSource(draft)}
          onClose={() => setSourceDraft(null)}
        />
      </Show>

      <Show when={groupDraft()}>
        <GroupSheet
          group={groupDraft()!.group}
          onSave={(name, color) => {
            const existing = groupDraft()!.group;
            if (existing) {
              void renameGroup(existing.id, name);
              void setGroupColor(existing.id, color);
            } else {
              void createGroup(name).then((g) => setGroupColor(g.id, color));
            }
            setGroupDraft(null);
          }}
          onClose={() => setGroupDraft(null)}
        />
      </Show>

      <Show when={sourceMenu()}>
        <SourceMenu
          source={sourceMenu()!}
          groups={orderedGroups()}
          onEdit={() => {
            const source = sourceMenu()!;
            setSourceMenu(null);
            setSourceDraft({
              id: source.id,
              kind: source.kind,
              raw: source.feedUrl || source.url,
              name: source.name,
              groupId: source.groupId,
            });
          }}
          onMove={(groupId) => {
            void moveSourceToGroup(sourceMenu()!.id, groupId);
            setSourceMenu(null);
          }}
          onSnooze={(ms) => {
            void snoozeSource(sourceMenu()!.id, ms);
            setSourceMenu(null);
            say('Snoozed');
          }}
          onDelete={() => {
            void deleteSource(sourceMenu()!.id);
            setSourceMenu(null);
          }}
          onClose={() => setSourceMenu(null)}
        />
      </Show>

      <Show when={windowsOpen()}>
        <WindowsSheet
          windows={windows()}
          onAdd={(name, time) => void createWindow(name, time)}
          onUpdate={(id, patch) => void updateWindow(id, patch)}
          onDelete={(id) => void deleteWindow(id)}
          onClose={() => setWindowsOpen(false)}
        />
      </Show>

      <Show when={statsOpen()}>
        <StatsSheet
          streak={streak()}
          grid={grid()}
          windowsCleared={grid().filter((d) => d.banked).length}
          onClose={() => setStatsOpen(false)}
        />
      </Show>

      <Show when={digest()}>
        <DigestSheet
          busy={digest()!.busy}
          status={digest()!.status}
          text={digest()!.text}
          error={digest()!.error}
          providerLabel={providerLabel(aiConfig())}
          onClose={() => setDigest(null)}
        />
      </Show>

      <Show when={toast()}>
        <div
          data-testid="routine-toast"
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(28px + var(--safe-bottom))',
            padding: '10px 18px',
            'border-radius': '999px',
            background: 'var(--text)',
            color: 'var(--bg-list)',
            'font-size': '14px',
            'font-weight': '500',
            'z-index': '40',
            'box-shadow': 'var(--shadow-card)',
            'pointer-events': 'none',
          }}
        >
          {toast()}
        </div>
      </Show>
    </ScreenChrome>
  );
}
