import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Key } from '@solid-primitives/keyed';
import type { CalendarEvent, DateStr, Sprint, Task } from '../db/models';
import { setTaskTime, setTaskTimes } from '../db/mutations';
import { currentDate } from '../app/currentDate';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { showToast } from '../app/focusState';
import { setQuickEntry } from '../app/uiState';
import { toggleComplete } from '../app/completion';
import { defaultAlert, pushMode, setPushMode, snapStep } from '../app/planner';
import { sendAlerts } from '../app/taskAlerts';
import { alertState, effectiveAlerts, tasksWithAlertsOn } from '../domain/taskAlerts';
import { release, tryClaim } from '../gestures/arbiter';
import { dayOfMonth, weekdayName } from '../domain/dates';
import { isMit } from '../domain/focus';
import {
  DAY_MIN, DEFAULT_BLOCK_MIN, allDayEvents, applyEdit, dayBlocks, formatClock, formatRange,
  layoutDay, minuteOfDay, parseHHMM, pushRest, shiftRemaining, snapMin, spanFromDrag, taskDuration,
  toHHMM, unscheduledFor, type EditMode, type Span, type TimeBlock,
} from '../domain/timeline';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { TaskCard } from './TaskCard';

/** The day planner: one or more day columns on an hour grid, with to-dos,
 *  calendar events and Focus Sprints as blocks. Modelled on
 *  obsidian-day-planner's timeline, with iOS Calendar's touch manners:
 *
 *  - press and hold a to-do to lift it, then drag it to a new time (or, with
 *    several days showing, a new day). It stays selected afterwards, with
 *    handles on both edges to change its length;
 *  - press and hold empty space and drag to draw a new block, which opens
 *    Quick Entry for that slot;
 *  - drag a to-do from the Unscheduled tray onto the grid, or tap it and
 *    then tap a time;
 *  - with a mouse, all of that works on a plain drag, no hold needed.
 *
 *  A plain tap never changes anything, so scrolling past is always safe.
 *  Every change goes through undo. */

export const PX_PER_MIN = 1.2; // 72px an hour
const HOUR_PX = 60 * PX_PER_MIN;
const GRID_PX = DAY_MIN * PX_PER_MIN;
const GUTTER = 46;
const HOLD_MS = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;
const EDGE = 44; // autoscroll zone below the pinned header and above the scroller's bottom

type DragState =
  | { kind: 'edit'; key: string; taskId: string; mode: EditMode; fromDate: DateStr; orig: Span; pressMin: number; date: DateStr; span: Span }
  | { kind: 'create'; anchorMin: number; date: DateStr; span: Span }
  | { kind: 'tray'; taskId: string; title: string; len: number; date: DateStr | null; span: Span | null };

interface Geometry {
  scroller: HTMLElement;
  scrollerTop: number;
  scrollerBottom: number;
  gridTopDoc: number;
  cols: { left: number; right: number; date: DateStr }[];
}

export function Timeline(props: {
  dates: DateStr[];
  tasks: Task[];
  events: CalendarEvent[];
  sprints: Sprint[];
  scrollParent: () => HTMLElement | null;
  /** Day names above the columns (the multi-day Planner). */
  headers?: boolean;
  onHeaderTap?: (date: DateStr) => void;
  /** Scroll to "now" (or the first block) when first shown. */
  autoScroll?: boolean;
}): JSX.Element {
  let rootEl!: HTMLDivElement;
  let gridEl!: HTMLDivElement;
  let stickyEl!: HTMLDivElement;
  const today = () => currentDate();

  // ------------------------------------------------------------ the clock --
  const [nowMs, setNowMs] = createSignal(Date.now());
  const clock = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));
  const nowMin = () => minuteOfDay(nowMs(), today());

  // -------------------------------------------------------------- state --
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [armed, setArmed] = createSignal<string | null>(null);
  const [sheetTask, setSheetTask] = createSignal<string | null>(null);
  const [ghost, setGhost] = createSignal<{ x: number; y: number; title: string } | null>(null);

  const taskById = createMemo(() => new Map(props.tasks.map((t) => [t.id, t])));

  const blocksByDate = createMemo(() => {
    const m = new Map<DateStr, TimeBlock[]>();
    for (const d of props.dates) m.set(d, dayBlocks(d, props.tasks, props.events, props.sprints, nowMs()));
    return m;
  });

  /** Live preview of a drag: the edited block's new place, plus anything
   *  "push the rest" would move with it. */
  const previews = createMemo(() => {
    const d = drag();
    const out = new Map<string, { date: DateStr; span: Span }>();
    if (!d || d.kind !== 'edit') return out;
    out.set(d.key, { date: d.date, span: d.span });
    if (pushMode()) {
      const day = (blocksByDate().get(d.date) ?? []).filter((b) => b.key !== d.key);
      const edited = blocksByDate().get(d.fromDate)?.find((b) => b.key === d.key);
      if (edited) {
        const base = d.date === d.fromDate ? edited : { ...edited, startMin: d.span.startMin, endMin: d.span.endMin };
        for (const [k, span] of pushRest([...day, base], d.key, d.span)) out.set(k, { date: d.date, span });
      }
    }
    return out;
  });

  const placedFor = (date: DateStr) => {
    const pv = previews();
    const list: TimeBlock[] = [];
    for (const d of props.dates) {
      for (const b of blocksByDate().get(d) ?? []) {
        const p = pv.get(b.key);
        if (p) {
          if (p.date === date) list.push({ ...b, date, startMin: p.span.startMin, endMin: p.span.endMin });
        } else if (d === date) {
          list.push(b);
        }
      }
    }
    return layoutDay(list);
  };

  const trayTasks = createMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const d of props.dates) {
      for (const t of unscheduledFor(d, props.tasks, today())) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
    }
    return out;
  });

  const allDay = (date: DateStr) => ({
    events: allDayEvents(date, props.events),
    deadlines: props.tasks.filter((t) => t.deadline === date && t.status === 'open' && t.trashedAt === null),
  });
  const hasAllDay = createMemo(() => props.dates.some((d) => {
    const a = allDay(d);
    return a.events.length + a.deadlines.length > 0;
  }));

  // ------------------------------------------------------------- geometry --
  let geo: Geometry | null = null;
  const measure = (): Geometry | null => {
    const scroller = props.scrollParent();
    if (!scroller) return null;
    const sr = scroller.getBoundingClientRect();
    const gr = gridEl.getBoundingClientRect();
    const cols = [...gridEl.querySelectorAll<HTMLElement>('[data-tl-col]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, date: el.dataset.tlCol! };
    });
    return { scroller, scrollerTop: sr.top, scrollerBottom: sr.bottom, gridTopDoc: gr.top + scroller.scrollTop, cols };
  };
  const minuteAt = (g: Geometry, clientY: number) => (clientY + g.scroller.scrollTop - g.gridTopDoc) / PX_PER_MIN;
  const dateAt = (g: Geometry, clientX: number, clamp: boolean): DateStr | null => {
    for (const c of g.cols) if (clientX >= c.left && clientX < c.right) return c.date;
    if (!clamp || g.cols.length === 0) return null;
    return clientX < g.cols[0]!.left ? g.cols[0]!.date : g.cols[g.cols.length - 1]!.date;
  };

  // --------------------------------------------------------------- drags --
  let last = { x: 0, y: 0 };
  let raf = 0;

  const update = () => {
    const d = drag();
    if (!d || !geo) return;
    const min = minuteAt(geo, last.y);
    const step = snapStep();
    if (d.kind === 'edit') {
      const span = applyEdit(d.orig, d.mode, min - d.pressMin, step);
      const date = d.mode === 'move' ? (dateAt(geo, last.x, true) ?? d.date) : d.fromDate;
      if (span.startMin !== d.span.startMin || span.endMin !== d.span.endMin || date !== d.date) {
        haptic('tick');
        setDrag({ ...d, span, date });
      }
    } else if (d.kind === 'create') {
      const span = spanFromDrag(d.anchorMin, min, step, DEFAULT_BLOCK_MIN);
      if (span.startMin !== d.span.startMin || span.endMin !== d.span.endMin) setDrag({ ...d, span });
    } else {
      setGhost({ x: last.x, y: last.y, title: d.title });
      const date = dateAt(geo, last.x, false);
      // Over the pinned header is "not on the grid": the time under it is hidden
      const belowHeader = last.y >= stickyEl.getBoundingClientRect().bottom;
      const inGrid = date !== null && belowHeader && min >= 0 && min <= DAY_MIN;
      const start = Math.max(0, Math.min(DAY_MIN - d.len, snapMin(min - Math.min(d.len, 60) / 2, step)));
      setDrag({ ...d, date: inGrid ? date : null, span: inGrid ? { startMin: start, endMin: start + d.len } : null });
    }
  };

  /** A tray drag starts inside the pinned header, which is the scroll-up
   *  zone; it only autoscrolls once it has been over the hours. */
  let enteredGrid = false;
  /** When the pointer entered an edge zone: scrolling waits a moment, so
   *  passing through the zone on the way somewhere doesn't scroll. */
  let zoneSince = 0;
  const DWELL_MS = 180;
  const autoscroll = () => {
    raf = 0;
    const d = drag();
    if (!d || !geo) return;
    const { scroller } = geo;
    // The visible hours start below the pinned header, wherever it is now
    const top = Math.max(geo.scrollerTop, stickyEl.getBoundingClientRect().bottom);
    if (last.y >= top) enteredGrid = true;
    let dy = 0;
    if (d.kind === 'tray' && !enteredGrid) dy = 0;
    else if (last.y < top + EDGE) dy = -Math.min(18, Math.ceil((top + EDGE - last.y) / 6));
    else if (last.y > geo.scrollerBottom - EDGE) dy = Math.min(18, Math.ceil((last.y - (geo.scrollerBottom - EDGE)) / 6));
    if (dy === 0) zoneSince = 0;
    else if (zoneSince === 0) zoneSince = performance.now();
    else if (performance.now() - zoneSince >= DWELL_MS) {
      scroller.scrollTop += dy;
      update();
    }
    raf = requestAnimationFrame(autoscroll);
  };

  const blockScroll = (e: TouchEvent) => {
    if (drag() && e.cancelable) e.preventDefault();
  };

  const begin = (state: DragState, e: PointerEvent) => {
    if (!tryClaim('timeline')) return false;
    geo = measure();
    if (!geo) {
      release('timeline');
      return false;
    }
    last = { x: e.clientX, y: e.clientY };
    enteredGrid = false;
    zoneSince = 0;
    document.addEventListener('touchmove', blockScroll, { passive: false });
    // An active drag listens on the window: the element under the finger can
    // re-render or move to another day's column mid-drag.
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', dragUp);
    window.addEventListener('pointercancel', dragCancel);
    try {
      rootEl.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    haptic('tick');
    setDrag(state);
    update();
    raf = requestAnimationFrame(autoscroll);
    return true;
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('pointermove', dragMove);
    window.removeEventListener('pointerup', dragUp);
    window.removeEventListener('pointercancel', dragCancel);
    release('timeline');
    setGhost(null);
    geo = null;
  };

  /** `pv` is the preview as it stood at release (taken before the drag state
   *  is cleared, which empties the live preview). */
  const commit = async (d: DragState, pv: Map<string, { date: DateStr; span: Span }>) => {
    if (d.kind === 'edit') {
      if (d.date === d.fromDate && d.span.startMin === d.orig.startMin && d.span.endMin === d.orig.endMin) return;
      const changes = [{ id: d.taskId, date: d.date, startTime: toHHMM(d.span.startMin), durationMin: d.span.endMin - d.span.startMin }];
      let pushed = 0;
      for (const [key, p] of pv) {
        if (key === d.key || !key.startsWith('task:')) continue;
        changes.push({ id: key.slice(5), date: p.date, startTime: toHHMM(p.span.startMin), durationMin: p.span.endMin - p.span.startMin });
        pushed++;
      }
      const what = d.mode === 'move'
        ? `Moved to ${d.date !== today() && d.date !== d.fromDate ? `${weekdayName(d.date).slice(0, 3)} ` : ''}${formatClock(d.span.startMin)}`
        : formatRange(d.span.startMin, d.span.endMin);
      await undoable(d.mode === 'move' ? 'Move' : 'Resize', () => setTaskTimes(changes),
        pushed > 0 ? `${what} · pushed ${pushed} more` : what);
    } else if (d.kind === 'create') {
      setQuickEntry({
        destination: { bucket: 'anytime' },
        startDate: d.date,
        startTime: toHHMM(d.span.startMin),
        durationMin: d.span.endMin - d.span.startMin,
      });
    } else if (d.date && d.span) {
      await place(d.taskId, d.date, d.span.startMin);
    }
  };

  const place = async (taskId: string, date: DateStr, startMin: number) => {
    const t = taskById().get(taskId);
    if (!t) return;
    const len = taskDuration(t);
    const start = Math.max(0, Math.min(DAY_MIN - len, startMin));
    setArmed(null);
    await undoable('Schedule', () => setTaskTime(taskId, date, toHHMM(start), len), `Scheduled ${formatClock(start)}`);
  };

  // Pending press: becomes a drag after a hold (touch) or a small move (mouse)
  type Pending = { e: PointerEvent; start: () => DragState | null; mouse: boolean; timer?: ReturnType<typeof setTimeout> };
  let pending: Pending | null = null;
  let suppressClick = false;

  const startFrom = (p: Pending, e: PointerEvent) => {
    const state = p.start();
    pending = null;
    if (state && begin(state, e)) suppressClick = true;
  };

  const editState = (key: string, mode: EditMode, e: PointerEvent): DragState | null => {
    const b = findBlock(key);
    if (!b || !b.editable) return null;
    const g = measure();
    if (!g) return null;
    setSelected(key);
    const orig = { startMin: b.startMin, endMin: b.endMin };
    return { kind: 'edit', key, taskId: b.refId, mode, fromDate: b.date, orig, pressMin: minuteAt(g, e.clientY), date: b.date, span: orig };
  };

  const findBlock = (key: string): TimeBlock | undefined => {
    for (const list of blocksByDate().values()) {
      const b = list.find((x) => x.key === key);
      if (b) return b;
    }
    return undefined;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!e.isPrimary || drag() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-tl-nodrag]')) return;
    const mouse = e.pointerType === 'mouse';
    const handle = target.closest<HTMLElement>('[data-tl-handle]');
    const blockEl = target.closest<HTMLElement>('[data-tl-block]');
    const chip = target.closest<HTMLElement>('[data-tl-chip]');
    const col = target.closest<HTMLElement>('[data-tl-col]');

    let start: (() => DragState | null) | null = null;
    let immediate = false;
    if (handle) {
      const key = handle.dataset.tlKey!;
      const mode = handle.dataset.tlHandle === 'start' ? 'resize-start' : 'resize-end';
      start = () => editState(key, mode, e);
      // Handles only exist on the selected block (touch) or on hover (mouse),
      // and don't scroll, so they grab at once.
      immediate = true;
    } else if (blockEl) {
      const key = blockEl.dataset.tlBlock!;
      start = () => editState(key, 'move', e);
      immediate = mouse ? false : selected() === key;
    } else if (chip) {
      const t = taskById().get(chip.dataset.tlChip!);
      if (t) start = () => ({ kind: 'tray', taskId: t.id, title: t.title || 'New To-Do', len: taskDuration(t), date: null, span: null });
    } else if (col) {
      const date = col.dataset.tlCol!;
      start = () => {
        const g = measure();
        if (!g) return null;
        const anchor = minuteAt(g, e.clientY);
        return { kind: 'create', anchorMin: anchor, date, span: spanFromDrag(anchor, anchor, snapStep(), DEFAULT_BLOCK_MIN) };
      };
    }
    if (!start) return;
    pending = { e, start, mouse };
    if (immediate) {
      e.preventDefault();
      startFrom(pending, e);
      return;
    }
    if (!mouse) pending.timer = setTimeout(() => pending && startFrom(pending, pending.e), HOLD_MS);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag()) return; // the window listener has it
    if (!pending || e.pointerId !== pending.e.pointerId) return;
    const moved = Math.hypot(e.clientX - pending.e.clientX, e.clientY - pending.e.clientY);
    if (pending.mouse) {
      if (moved > MOUSE_SLOP) startFrom(pending, e);
    } else if (moved > TOUCH_SLOP) {
      clearTimeout(pending.timer); // moved before the hold: it's a scroll
      pending = null;
    }
  };

  const onPointerUp = () => {
    if (pending) {
      clearTimeout(pending.timer);
      pending = null;
    }
  };

  const onPointerCancel = () => {
    if (pending) {
      clearTimeout(pending.timer);
      pending = null;
    }
  };

  function dragMove(e: PointerEvent): void {
    if (!drag()) return;
    last = { x: e.clientX, y: e.clientY };
    update();
  }

  function dragUp(e: PointerEvent): void {
    if (!drag()) return;
    last = { x: e.clientX, y: e.clientY };
    update();
    const final = drag()!;
    const pv = new Map(previews());
    finish();
    setDrag(null);
    void commit(final, pv);
    setTimeout(() => (suppressClick = false), 0);
  }

  function dragCancel(): void {
    if (!drag()) return;
    finish();
    setDrag(null);
  }

  // ---------------------------------------------------------------- taps --
  const onClick = (e: MouseEvent) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('[data-tl-nodrag]')) return;
    const blockEl = target.closest<HTMLElement>('[data-tl-block]');
    if (blockEl) {
      const b = findBlock(blockEl.dataset.tlBlock!);
      if (!b) return;
      if (b.kind === 'task') setSheetTask(b.refId);
      else showToast(`${b.title || (b.kind === 'event' ? 'Event' : 'Focus sprint')} · ${formatRange(b.startMin, b.endMin)}`);
      return;
    }
    const col = target.closest<HTMLElement>('[data-tl-col]');
    if (col) {
      if (armed()) {
        const g = measure();
        if (g) void place(armed()!, col.dataset.tlCol!, snapMin(minuteAt(g, e.clientY) - 15, snapStep()));
      } else {
        setSelected(null);
      }
    }
  };

  // Capture phase, so a drag's trailing click is swallowed before any
  // child (the tray chip, a checkbox) sees it.
  onMount(() => {
    rootEl.addEventListener('click', onClick, true);
    onCleanup(() => rootEl.removeEventListener('click', onClick, true));
  });

  // ------------------------------------------------------------ keyboard --
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = selected();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (!key || tag === 'INPUT' || tag === 'TEXTAREA' || sheetTask()) return;
      if (e.key === 'Escape') {
        setSelected(null);
        return;
      }
      const b = findBlock(key);
      if (!b?.editable) return;
      if (e.key === 'Enter') {
        setSheetTask(b.refId);
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const delta = (e.key === 'ArrowUp' ? -1 : 1) * snapStep();
      const span = applyEdit(b, e.shiftKey ? 'resize-end' : 'move', delta, snapStep());
      void undoable(e.shiftKey ? 'Resize' : 'Move', () => setTaskTime(b.refId, b.date, toHHMM(span.startMin), span.endMin - span.startMin));
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // ------------------------------------------------------ initial scroll --
  onMount(() => {
    if (!props.autoScroll) return;
    requestAnimationFrame(() => {
      const scroller = props.scrollParent();
      if (!scroller || !gridEl) return;
      const first = props.dates.flatMap((d) => blocksByDate().get(d) ?? [])[0];
      const target = props.dates.includes(today())
        ? Math.max(0, nowMin() - 90)
        : Math.max(0, (first?.startMin ?? 8 * 60) - 30);
      // The pinned header covers the top of the scroller once it sticks
      const offset = gridEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop = Math.max(0, scroller.scrollTop + offset + target * PX_PER_MIN - stickyEl.offsetHeight - 8);
    });
  });

  onCleanup(() => {
    if (drag()) finish();
    if (pending) clearTimeout(pending.timer);
  });

  // --------------------------------------------------------------- alerts --
  const dayAlerts = createMemo(() => {
    const all = tasksWithAlertsOn(props.tasks, props.dates, defaultAlert());
    const pending = all.filter((t) => alertState(t, defaultAlert()) !== 'sent').length;
    return { all, pending };
  });

  // ------------------------------------------------------- running late --
  const lateTargets = createMemo(() => {
    if (!props.dates.includes(today())) return [];
    return (blocksByDate().get(today()) ?? []).filter((b) => b.editable && b.startMin >= nowMin());
  });
  const runLate = (minutes: number) => {
    const moved = shiftRemaining(blocksByDate().get(today()) ?? [], nowMin(), minutes);
    const changes = [...moved].map(([key, span]) => ({
      id: key.slice(5), date: today(), startTime: toHHMM(span.startMin), durationMin: span.endMin - span.startMin,
    }));
    if (changes.length === 0) return;
    void undoable('Shift', () => setTaskTimes(changes), `Shifted ${changes.length} by ${minutes}m`);
  };

  // ---------------------------------------------------------------- view --
  const dayLabel = (d: DateStr) => `${weekdayName(d).slice(0, 3)} ${dayOfMonth(d)}`;
  const multi = () => props.dates.length > 1;

  return (
    <div
      ref={rootEl}
      data-testid="timeline"
      class="no-select"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'relative', 'padding-bottom': '24px' }}
    >
      {/* Everything above the hours stays pinned while the hours scroll under
          it, so the tray is always there to drag from. */}
      <div ref={stickyEl} data-testid="tl-sticky" style={{ position: 'sticky', top: '0', 'z-index': '5', background: 'var(--bg-list)' }}>
      {/* Toolbar: push mode and running late */}
      <div data-tl-nodrag style={{ display: 'flex', gap: '6px', padding: '4px 16px 8px', 'flex-wrap': 'wrap', 'align-items': 'center' }}>
        <button
          data-testid="tl-push"
          aria-pressed={pushMode()}
          onClick={() => setPushMode(!pushMode())}
          title="When a block grows or moves into the next one, push the rest down"
          style={pill(pushMode())}
        >
          <Icon name="layers" size={12} color={pushMode() ? 'currentColor' : 'var(--text-secondary)'} />
          Push rest
        </button>
        <Show when={dayAlerts().all.length > 0}>
          <button
            data-testid="tl-alerts"
            onClick={() => void sendAlerts(dayAlerts().all, props.dates.length === 1 ? `clarity-${props.dates[0]}.ics` : 'clarity-alerts.ics')}
            title="Send these to-dos' alerts to iOS Calendar in one file"
            style={pill(dayAlerts().pending > 0)}
          >
            <Icon name="bell" size={12} color={dayAlerts().pending > 0 ? 'currentColor' : 'var(--green)'} />
            {dayAlerts().pending > 0 ? `Send ${dayAlerts().pending} alert${dayAlerts().pending === 1 ? '' : 's'}` : 'Alerts in Calendar'}
          </button>
        </Show>
        <Show when={lateTargets().length > 0}>
          <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)', 'margin-left': '4px' }}>Running late</span>
          <button data-testid="tl-late-15" onClick={() => runLate(15)} style={pill(false)}>+15m</button>
          <button data-testid="tl-late-30" onClick={() => runLate(30)} style={pill(false)}>+30m</button>
        </Show>
      </div>

      {/* Unscheduled tray */}
      <Show when={trayTasks().length > 0}>
        <div data-testid="tl-tray" style={{ padding: '0 0 8px' }}>
          <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '0 16px 6px' }}>
            <span style={{ 'font-size': '13px', 'font-weight': '700', color: 'var(--text-secondary)' }}>
              Unscheduled · {trayTasks().length}
            </span>
            <span style={{ 'font-size': '12px', color: 'var(--text-tertiary)' }}>
              {armed() ? 'now tap a time on the grid' : 'drag onto the grid, or tap then tap a time'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', 'overflow-x': 'auto', padding: '0 16px 2px', 'touch-action': 'pan-x' }}>
            <For each={trayTasks()}>
              {(t) => (
                <div
                  data-tl-chip={t.id}
                  data-testid="tl-chip"
                  role="button"
                  aria-pressed={armed() === t.id}
                  onClick={() => {
                    if (suppressClick) return;
                    haptic('tick');
                    setArmed(armed() === t.id ? null : t.id);
                  }}
                  style={{
                    display: 'inline-flex', 'align-items': 'center', gap: '6px', 'flex-shrink': '0',
                    padding: '6px 12px', 'border-radius': '999px', 'font-size': '14px', 'font-weight': '500',
                    'max-width': '220px', cursor: 'grab',
                    background: armed() === t.id ? 'var(--blue)' : 'var(--bg-card)',
                    color: armed() === t.id ? 'var(--text-invert)' : 'var(--text)',
                    'box-shadow': 'var(--shadow-card)',
                    opacity: drag()?.kind === 'tray' && (drag() as { taskId: string }).taskId === t.id ? '0.4' : '1',
                  }}
                >
                  <Show when={isMit(t, today())}>
                    <Icon name="star" size={11} color={armed() === t.id ? 'currentColor' : 'var(--yellow-deep)'} />
                  </Show>
                  <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{t.title || 'New To-Do'}</span>
                  <span style={{ 'font-size': '12px', opacity: '0.7', 'font-variant-numeric': 'tabular-nums' }}>{taskDuration(t)}m</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Day headers */}
      <Show when={props.headers}>
        <div data-tl-nodrag style={{
          display: 'flex', 'padding-left': `${GUTTER}px`, 'border-bottom': '1px solid var(--separator)',
        }}>
          <For each={props.dates}>
            {(d) => (
              <button
                data-testid="tl-day-header"
                onClick={() => props.onHeaderTap?.(d)}
                style={{
                  flex: '1', 'min-width': '0', padding: '6px 0', 'font-size': multi() && props.dates.length > 3 ? '12px' : '14px',
                  'font-weight': d === today() ? '700' : '500',
                  color: d === today() ? 'var(--blue)' : 'var(--text-secondary)',
                  overflow: 'hidden', 'white-space': 'nowrap', 'text-overflow': 'ellipsis',
                }}
              >
                {dayLabel(d)}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* All-day row: all-day events and deadlines */}
      <Show when={hasAllDay()}>
        <div style={{ display: 'flex', 'padding-left': `${GUTTER}px`, 'border-bottom': '1px solid var(--separator)' }}>
          <For each={props.dates}>
            {(d) => (
              <div data-testid="tl-allday" style={{ flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '2px', padding: '4px 2px' }}>
                <For each={allDay(d).events}>
                  {(e) => <div style={allDayChip('var(--text-tertiary)')}>{e.title}</div>}
                </For>
                <For each={allDay(d).deadlines}>
                  {(t) => (
                    <div
                      data-tl-nodrag
                      data-testid="tl-deadline"
                      onClick={() => setSheetTask(t.id)}
                      style={{ ...allDayChip('var(--red)'), cursor: 'pointer' }}
                    >
                      ⚑ {t.title}{parseHHMM(t.deadlineTime) !== null ? ` · ${formatClock(parseHHMM(t.deadlineTime)!)}` : ''}
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>

      </div>

      {/* The hour grid */}
      <div ref={gridEl} style={{ position: 'relative', height: `${GRID_PX}px`, display: 'flex', 'padding-left': `${GUTTER}px`, 'margin-top': '8px' }}>
        <For each={Array.from({ length: 24 }, (_, h) => h)}>
          {(h) => (
            <div style={{
              position: 'absolute', left: '0', width: `${GUTTER - 6}px`, top: `${h * HOUR_PX - 7}px`,
              'text-align': 'right', 'font-size': '11px', color: 'var(--text-tertiary)', 'font-variant-numeric': 'tabular-nums',
              'pointer-events': 'none',
            }}>
              {h === 0 ? '' : formatClock(h * 60)}
            </div>
          )}
        </For>
        <For each={props.dates}>
          {(date) => (
            <div
              data-tl-col={date}
              data-testid="tl-col"
              style={{
                position: 'relative', flex: '1', 'min-width': '0', height: '100%',
                'border-left': '1px solid var(--separator)',
                background: `repeating-linear-gradient(to bottom, var(--separator) 0 1px, transparent 1px ${HOUR_PX}px)`,
                'touch-action': 'pan-y',
                cursor: 'cell',
              }}
            >
              {/* Past hours of today are dimmed */}
              <Show when={date === today()}>
                <div style={{
                  position: 'absolute', left: '0', right: '0', top: '0', height: `${nowMin() * PX_PER_MIN}px`,
                  background: 'color-mix(in srgb, var(--text) 3%, transparent)', 'pointer-events': 'none',
                }} />
              </Show>
              <Show when={date < today()}>
                <div style={{ position: 'absolute', inset: '0', background: 'color-mix(in srgb, var(--text) 3%, transparent)', 'pointer-events': 'none' }} />
              </Show>

              {/* Keyed by block, not by object: a drag re-lays the day out on
                  every move, and the element under the finger must survive */}
              <Key each={placedFor(date)} by={(p) => p.block.key}>
                {(p) => (
                  <BlockView
                    block={p().block}
                    col={p().col}
                    cols={p().cols}
                    narrow={props.dates.length > 3}
                    selected={selected() === p().block.key}
                    dragging={drag()?.kind === 'edit' && (drag() as { key: string }).key === p().block.key}
                    task={p().block.kind === 'task' ? taskById().get(p().block.refId) : undefined}
                  />
                )}
              </Key>

              {/* New block being drawn, or a tray to-do hovering here */}
              <Show when={ghostSpan(drag(), date)}>
                {(span) => (
                  <div data-testid="tl-ghost" style={{
                    position: 'absolute', left: '2px', right: '2px', top: `${span().startMin * PX_PER_MIN}px`,
                    height: `${Math.max(16, (span().endMin - span().startMin) * PX_PER_MIN - 2)}px`,
                    'border-radius': '6px', border: '2px dashed var(--blue)',
                    background: 'color-mix(in srgb, var(--blue) 10%, transparent)',
                    'font-size': '12px', 'font-weight': '600', color: 'var(--blue)', padding: '2px 6px',
                    'pointer-events': 'none', 'z-index': '3',
                  }}>
                    {formatRange(span().startMin, span().endMin)}
                  </div>
                )}
              </Show>

              <Show when={date === today()}>
                <div data-testid="tl-now" style={{
                  position: 'absolute', left: '-4px', right: '0', top: `${nowMin() * PX_PER_MIN - 1}px`, height: '2px',
                  background: 'var(--red)', 'pointer-events': 'none', 'z-index': '2',
                }}>
                  <div style={{ position: 'absolute', left: '-1px', top: '-3px', width: '8px', height: '8px', 'border-radius': '50%', background: 'var(--red)' }} />
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={ghost()}>
        {(g) => (
          <Portal>
            <div style={{
              position: 'fixed', left: '0', top: '0', 'z-index': '130', 'pointer-events': 'none',
              transform: `translate3d(${g().x - 40}px, ${g().y - 36}px, 0)`,
              padding: '6px 12px', 'border-radius': '999px', background: 'var(--blue)', color: '#fff',
              'font-size': '14px', 'font-weight': '600', 'box-shadow': 'var(--shadow-card)', 'max-width': '200px',
              overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
            }}>
              {g().title}
            </div>
          </Portal>
        )}
      </Show>

      <Show when={sheetTask() ? taskById().get(sheetTask()!) : undefined}>
        {(t) => (
          <Sheet onClose={() => setSheetTask(null)}>
            <div data-testid="tl-task-sheet" style={{ 'max-height': '78vh', 'overflow-y': 'auto', 'padding-bottom': '8px' }}>
              <TaskCard task={t()} inSheet onCollapse={() => setSheetTask(null)} />
            </div>
          </Sheet>
        )}
      </Show>
    </div>
  );
}

function ghostSpan(d: DragState | null, date: DateStr): Span | null {
  if (!d) return null;
  if (d.kind === 'create' && d.date === date) return d.span;
  if (d.kind === 'tray' && d.date === date) return d.span;
  return null;
}

function BlockView(props: {
  block: TimeBlock;
  col: number;
  cols: number;
  narrow: boolean;
  selected: boolean;
  dragging: boolean;
  task?: Task;
}): JSX.Element {
  const b = () => props.block;
  const height = () => Math.max(16, (b().endMin - b().startMin) * PX_PER_MIN - 2);
  const roomy = () => height() >= 34;
  const accent = () =>
    b().kind === 'event' ? 'var(--text-tertiary)'
    : b().kind === 'sprint' ? 'var(--purple)'
    : props.task && isMit(props.task, currentDate()) ? 'var(--yellow-deep)'
    : 'var(--blue)';
  const handle = (edge: 'start' | 'end') => (
    <div
      data-tl-handle={edge}
      data-tl-key={b().key}
      data-testid={`tl-handle-${edge}`}
      style={{
        position: 'absolute', left: '0', right: '0', height: '14px', [edge === 'start' ? 'top' : 'bottom']: '-6px',
        cursor: 'ns-resize', 'touch-action': 'none', display: 'flex', 'justify-content': 'center', 'align-items': 'center',
        'z-index': '2',
      }}
    >
      <div style={{ width: '22px', height: '5px', 'border-radius': '3px', background: accent(), 'box-shadow': '0 0 0 2px var(--bg-card)' }} />
    </div>
  );
  return (
    <div
      data-tl-block={b().key}
      data-testid="tl-block"
      data-kind={b().kind}
      data-title={b().title}
      class="tl-block"
      style={{
        position: 'absolute',
        top: `${b().startMin * PX_PER_MIN}px`,
        height: `${height()}px`,
        left: `calc(${(props.col / props.cols) * 100}% + 2px)`,
        width: `calc(${100 / props.cols}% - 4px)`,
        'border-radius': '6px',
        'border-left': `3px solid ${accent()}`,
        background: b().kind === 'event'
          ? 'var(--bg-inset)'
          : `color-mix(in srgb, ${accent()} 16%, var(--bg-card))`,
        color: 'var(--text)',
        padding: roomy() ? '3px 6px' : '0 6px',
        'font-size': props.narrow ? '11px' : '13px',
        'line-height': '1.25',
        overflow: props.selected ? 'visible' : 'hidden',
        opacity: b().done ? '0.55' : '1',
        cursor: b().editable ? 'grab' : 'pointer',
        'touch-action': 'pan-y',
        'z-index': props.dragging || props.selected ? '3' : '1',
        'box-shadow': props.dragging ? 'var(--shadow-card)' : props.selected ? `0 0 0 2px ${accent()}` : 'none',
        display: 'flex',
        gap: '5px',
        'align-items': roomy() ? 'flex-start' : 'center',
      }}
    >
      <Show when={props.task && b().kind === 'task' && !props.narrow}>
        <div data-tl-nodrag data-testid="tl-check" style={{ 'flex-shrink': '0', 'margin-top': roomy() ? '1px' : '0', display: 'flex' }}>
          <Checkbox size={15} checked={b().done} onToggle={() => toggleComplete(props.task!)} />
        </div>
      </Show>
      <div style={{ 'min-width': '0', flex: '1', overflow: 'hidden' }}>
        <div style={{
          'font-weight': '600', overflow: 'hidden', 'text-overflow': 'ellipsis',
          'white-space': roomy() && !props.narrow ? 'normal' : 'nowrap',
          'text-decoration': b().done ? 'line-through' : 'none',
          display: '-webkit-box', '-webkit-line-clamp': roomy() ? '2' : '1', '-webkit-box-orient': 'vertical',
        }}>
          {b().title || 'New To-Do'}
        </div>
        <Show when={roomy() && !props.narrow}>
          <div style={{ 'font-size': '11px', color: 'var(--text-secondary)', 'font-variant-numeric': 'tabular-nums', display: 'flex', 'align-items': 'center', gap: '4px' }}>
            {formatRange(b().startMin, b().endMin)}{b().running ? ' · now' : ''}
            <Show when={props.task && !b().done && effectiveAlerts(props.task, defaultAlert()).some((a) => a.anchor === 'start')}>
              <span data-testid="tl-bell" style={{ display: 'inline-flex', color: alertState(props.task!, defaultAlert()) === 'sent' ? 'var(--green)' : 'var(--text-tertiary)' }}>
                <Icon name="bell" size={10} />
              </span>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={props.selected && b().editable}>
        {handle('start')}
        {handle('end')}
      </Show>
    </div>
  );
}

const pill = (active: boolean) => ({
  display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '4px 10px',
  'border-radius': '999px', 'font-size': '13px', 'font-weight': '600',
  background: active ? 'var(--blue)' : 'var(--bg-inset)',
  color: active ? 'var(--text-invert)' : 'var(--text)',
}) as const;

const allDayChip = (color: string) => ({
  'font-size': '11px', 'font-weight': '600', padding: '2px 6px', 'border-radius': '4px',
  background: `color-mix(in srgb, ${color} 14%, transparent)`, color: color === 'var(--text-tertiary)' ? 'var(--text-secondary)' : color,
  overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
}) as const;
