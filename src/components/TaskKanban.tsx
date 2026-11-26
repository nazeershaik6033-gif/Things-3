import { createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { Heading, Tag, Task } from '../db/models';
import { updateTask } from '../db/mutations';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { toggleComplete } from '../app/completion';
import { blockedIds } from '../app/workflow';
import { currentDate } from '../app/currentDate';
import { release, tryClaim } from '../gestures/arbiter';
import { columnPatch, kanbanColumns, type KanbanGroup } from '../domain/workflow';
import { formatDeadline } from '../domain/dates';
import { Checkbox } from '../ui/Checkbox';
import { Sheet } from '../ui/Sheet';
import { TaskCard } from './TaskCard';
import { timeLabel } from './PlannerControls';

/** A Kanban of your actual to-dos (TaskNotes' Kanban view): columns by
 *  stage, heading or Eisenhower quadrant. Hold a card (or drag it with a
 *  mouse) onto another column to move it; tap it to edit. */

const HOLD_MS = 350;

export function TaskKanban(props: {
  tasks: Task[];
  group: KanbanGroup;
  headings?: Heading[];
  tags: Tag[];
}): JSX.Element {
  const columns = createMemo(() => kanbanColumns(props.tasks.filter((t) => t.status === 'open' && t.trashedAt === null), props.group, props.headings));
  const [drag, setDrag] = createSignal<{ id: string; title: string; x: number; y: number; over: string | null } | null>(null);
  const [sheet, setSheet] = createSignal<string | null>(null);
  const byId = createMemo(() => new Map(props.tasks.map((t) => [t.id, t])));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: string; x: number; y: number; mouse: boolean } | null = null;
  let suppressClick = false;

  const columnAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-kb-col]')?.dataset.kbCol ?? null;

  const blockScroll = (e: TouchEvent) => {
    if (drag() && e.cancelable) e.preventDefault();
  };

  const start = (id: string, x: number, y: number) => {
    if (!tryClaim('timeline')) return;
    const t = byId().get(id);
    if (!t) return;
    haptic('tick');
    suppressClick = true;
    document.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    setDrag({ id, title: t.title || 'New To-Do', x, y, over: columnAt(x, y) });
  };

  const end = () => {
    document.removeEventListener('touchmove', blockScroll);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    release('timeline');
    setDrag(null);
    setTimeout(() => (suppressClick = false), 0);
  };

  function onMove(e: PointerEvent): void {
    const d = drag();
    if (d) setDrag({ ...d, x: e.clientX, y: e.clientY, over: columnAt(e.clientX, e.clientY) });
  }

  function onUp(e: PointerEvent): void {
    const d = drag();
    if (!d) return;
    const col = columnAt(e.clientX, e.clientY);
    end();
    const from = columns().find((c) => c.tasks.some((t) => t.id === d.id));
    if (!col || !from || col === from.id) return;
    const to = columns().find((c) => c.id === col)!;
    haptic('success');
    void undoable('Move', () => updateTask(d.id, columnPatch(props.group, col)), `Moved to ${to.title}`);
  }

  function onCancel(): void {
    if (drag()) end();
  }

  const onDown = (e: PointerEvent, id: string) => {
    if (!e.isPrimary || (e.target as HTMLElement).closest('[data-kb-nodrag]')) return;
    pending = { id, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
    if (!pending.mouse) {
      timer = setTimeout(() => {
        if (pending) start(pending.id, pending.x, pending.y);
        pending = null;
      }, HOLD_MS);
    }
  };
  const onPendingMove = (e: PointerEvent) => {
    if (!pending || drag()) return;
    const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.mouse && moved > 4) {
      const p = pending;
      pending = null;
      start(p.id, e.clientX, e.clientY);
    } else if (!pending.mouse && moved > 8) {
      clearTimeout(timer);
      pending = null;
    }
  };
  const onPendingUp = () => {
    clearTimeout(timer);
    pending = null;
  };
  onCleanup(() => {
    clearTimeout(timer);
    if (drag()) end();
  });

  return (
    <div
      data-testid="kanban"
      class="no-select"
      onPointerMove={onPendingMove}
      onPointerUp={onPendingUp}
      onPointerCancel={onPendingUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: 'flex', gap: '10px', 'overflow-x': 'auto', padding: '4px 16px 16px',
        'scroll-snap-type': 'x proximity', 'align-items': 'flex-start',
      }}
    >
      <For each={columns()}>
        {(col) => (
          <div
            data-kb-col={col.id}
            data-testid="kanban-col"
            style={{
              flex: '0 0 auto', width: 'min(78vw, 280px)', 'scroll-snap-align': 'start',
              background: drag()?.over === col.id ? 'color-mix(in srgb, var(--blue) 10%, var(--bg-inset))' : 'var(--bg-inset)',
              'border-radius': '14px', padding: '8px', 'min-height': '120px',
              outline: drag()?.over === col.id ? '2px solid var(--blue)' : 'none',
            }}
          >
            <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', padding: '2px 4px 8px' }}>
              <span style={{ width: '8px', height: '8px', 'border-radius': '50%', background: col.color }} />
              <span style={{ 'font-weight': 'var(--fw-700)', 'font-size': 'calc(14px * var(--ts))', flex: '1' }}>{col.title}</span>
              <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'font-variant-numeric': 'tabular-nums' }}>{col.tasks.length}</span>
            </div>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <For each={col.tasks}>
                {(t) => (
                  <div
                    data-testid="kanban-card"
                    data-title={t.title}
                    onPointerDown={(e) => onDown(e, t.id)}
                    onClick={() => {
                      if (!suppressClick) setSheet(t.id);
                    }}
                    style={{
                      display: 'flex', gap: '8px', 'align-items': 'flex-start', padding: '9px 10px',
                      'border-radius': '10px', background: 'var(--bg-card)', 'box-shadow': 'var(--shadow-card)',
                      cursor: 'grab', 'touch-action': 'pan-x pan-y',
                      opacity: drag()?.id === t.id ? '0.35' : '1',
                    }}
                  >
                    <div data-kb-nodrag style={{ 'padding-top': '1px' }}>
                      <Checkbox size={16} checked={false} onToggle={() => toggleComplete(t)} />
                    </div>
                    <div style={{ flex: '1', 'min-width': '0' }}>
                      <div style={{ 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-500)', 'line-height': 'calc(1.3 * var(--lh))' }}>
                        {blockedIds().has(t.id) ? '🔒 ' : ''}{t.title || 'New To-Do'}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap', 'margin-top': '3px', 'font-size': 'calc(11px * var(--ts))', color: 'var(--text-secondary)' }}>
                        <Show when={timeLabel(t, currentDate(), true)}>
                          <span style={{ color: 'var(--blue)', 'font-weight': 'var(--fw-600)' }}>{timeLabel(t, currentDate(), true)}</span>
                        </Show>
                        <Show when={t.deadline}>
                          <span style={{ color: t.deadline! < currentDate() ? 'var(--red)' : 'var(--text-secondary)' }}>⚑ {formatDeadline(t.deadline!, currentDate())}</span>
                        </Show>
                        <For each={t.tagIds.map((id) => props.tags.find((x) => x.id === id)?.title).filter(Boolean)}>
                          {(name) => <span>#{name}</span>}
                        </For>
                        <Show when={t.checklist.length > 0}>
                          <span>☑ {t.checklist.filter((c) => c.completed).length}/{t.checklist.length}</span>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              <Show when={col.tasks.length === 0}>
                <div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-tertiary)', padding: '10px 4px', 'text-align': 'center' }}>Drop here</div>
              </Show>
            </div>
          </div>
        )}
      </For>

      <Show when={drag()}>
        {(d) => (
          <Portal>
            <div style={{
              position: 'fixed', left: '0', top: '0', 'z-index': '130', 'pointer-events': 'none',
              transform: `translate3d(${d().x - 60}px, ${d().y - 24}px, 0) rotate(-2deg)`,
              padding: '9px 12px', 'border-radius': '10px', background: 'var(--bg-card)', 'box-shadow': 'var(--shadow-sheet)',
              'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)', 'max-width': '240px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
            }}>
              {d().title}
            </div>
          </Portal>
        )}
      </Show>

      <Show when={sheet() ? byId().get(sheet()!) : undefined}>
        {(t) => (
          <Sheet onClose={() => setSheet(null)}>
            <div data-testid="kanban-task-sheet" style={{ 'max-height': '78vh', 'overflow-y': 'auto', 'padding-bottom': '8px' }}>
              <TaskCard task={t()} inSheet onCollapse={() => setSheet(null)} />
            </div>
          </Sheet>
        )}
      </Show>
    </div>
  );
}
