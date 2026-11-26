import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { Task } from '../db/models';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { setStage, toggleBlocker } from '../db/workflowMutations';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { showToast } from '../app/focusState';
import { isBlocked, openBlockers, STAGES, stageOf, waitingOn } from '../domain/workflow';
import { Icon } from '../ui/Icon';

/** Stage chips (To Do / In Progress / Waiting) for the to-do card. */
export function StageChips(props: { task: Task }): JSX.Element {
  return (
    <div data-testid="stage-chips" style={{ display: 'inline-flex', gap: '2px', padding: '2px', 'border-radius': '999px', background: 'var(--bg-inset)' }}>
      <For each={STAGES}>
        {(s) => {
          const on = () => stageOf(props.task) === s.id;
          return (
            <button
              data-testid={`stage-${s.id}`}
              aria-pressed={on()}
              onClick={() => {
                haptic('tick');
                void setStage(props.task.id, s.id === 'todo' ? null : s.id);
              }}
              style={{
                padding: '3px 9px', 'border-radius': '999px', 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)',
                background: on() ? (s.id === 'todo' ? 'var(--bg-card)' : s.color) : 'transparent',
                color: on() ? (s.id === 'todo' ? 'var(--text)' : '#fff') : 'var(--text-secondary)',
              }}
            >
              {s.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}

/** "Waits for" chip on the card: how many open blockers, or the prompt. */
export function WaitsChip(props: { task: Task; active: boolean; allTasks: Task[]; onClick: () => void }): JSX.Element {
  const byId = createMemo(() => new Map(props.allTasks.map((t) => [t.id, t])));
  const blockers = () => openBlockers(props.task, byId());
  const blocking = () => waitingOn(props.task.id, props.allTasks).length;
  return (
    <button
      data-testid="chip-waits"
      aria-pressed={props.active}
      onClick={props.onClick}
      style={{
        display: 'inline-flex', 'align-items': 'center', gap: '4px', padding: '4px 10px', 'border-radius': '999px',
        'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
        background: blockers().length ? 'color-mix(in srgb, var(--orange, var(--yellow-deep)) 18%, transparent)' : 'var(--bg-inset)',
        color: 'var(--text)',
      }}
    >
      {blockers().length ? '🔒' : '⛓'}
      {blockers().length ? `Waits for ${blockers().length}` : 'Waits for…'}
      <Show when={blocking() > 0}>
        <span style={{ color: 'var(--text-tertiary)', 'font-weight': 'var(--fw-500)' }}>· blocks {blocking()}</span>
      </Show>
    </button>
  );
}

/** Pick which to-dos this one waits for (TaskNotes' "Blocked by" selector):
 *  same project first, then everything open; loops are refused. */
export function WaitsForPicker(props: { task: Task; onClose: () => void }): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const [q, setQ] = createSignal('');
  const byId = createMemo(() => new Map(tasks().map((t) => [t.id, t])));
  const chosen = () => new Set(props.task.blockedBy ?? []);
  const candidates = createMemo(() => {
    const query = q().trim().toLowerCase();
    return tasks()
      .filter((t) => t.id !== props.task.id && t.trashedAt === null && (t.status === 'open' || chosen().has(t.id)))
      .filter((t) => !query || t.title.toLowerCase().includes(query))
      .sort((a, b) => {
        const sa = (chosen().has(a.id) ? 0 : 2) + (a.projectId && a.projectId === props.task.projectId ? 0 : 1);
        const sb = (chosen().has(b.id) ? 0 : 2) + (b.projectId && b.projectId === props.task.projectId ? 0 : 1);
        return sa - sb || a.title.localeCompare(b.title);
      })
      .slice(0, 30);
  });
  const blocking = () => waitingOn(props.task.id, tasks());
  const toggle = async (id: string) => {
    haptic('tick');
    const r = await undoable('Waits for', () => toggleBlocker(props.task.id, id));
    if (r === 'cycle') showToast('That one already waits for this — it would loop');
  };
  return (
    <div data-testid="waits-picker" style={{ padding: '10px 4px 6px', 'border-top': '1px solid var(--separator)', 'margin-top': '6px' }}>
      <div style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)', 'padding-bottom': '6px' }}>
        This waits for… {isBlocked(props.task, byId()) ? '(locked until they’re done)' : ''}
      </div>
      <input
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
        placeholder="Search to-dos"
        data-testid="waits-search"
        style={{ width: '100%', padding: '8px 10px', 'border-radius': '10px', background: 'var(--bg-inset)', color: 'var(--text)', 'font-size': 'calc(15px * var(--ts))', border: 'none' }}
      />
      <div style={{ 'max-height': '220px', 'overflow-y': 'auto', 'margin-top': '6px' }}>
        <For each={candidates()}>
          {(t) => (
            <button
              data-testid="waits-option"
              aria-pressed={chosen().has(t.id)}
              onClick={() => void toggle(t.id)}
              style={{ display: 'flex', 'align-items': 'center', gap: '8px', width: '100%', padding: '8px 4px', 'text-align': 'left', 'font-size': 'calc(15px * var(--ts))' }}
            >
              <span style={{
                width: '18px', height: '18px', 'border-radius': '5px', flex: 'none', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                border: chosen().has(t.id) ? 'none' : '1.5px solid var(--check-border)',
                background: chosen().has(t.id) ? 'var(--blue)' : 'transparent',
              }}>
                <Show when={chosen().has(t.id)}><Icon name="check" size={12} color="#fff" strokeWidth={3} /></Show>
              </span>
              <span style={{
                flex: '1', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
                'text-decoration': t.status !== 'open' ? 'line-through' : 'none', color: t.status !== 'open' ? 'var(--text-tertiary)' : 'var(--text)',
              }}>
                {t.title || 'New To-Do'}
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={blocking().length > 0}>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'padding-top': '6px' }}>
          Blocks: {blocking().map((t) => t.title || 'New To-Do').join(', ')}
        </div>
      </Show>
      <button onClick={props.onClose} style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)', padding: '8px 0 0' }}>Done</button>
    </div>
  );
}
