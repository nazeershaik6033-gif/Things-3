import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import type { Sprint, Task } from '../db/models';
import {
  deleteSprint, editRunningSprint, editSprintRecord, updateSprint,
} from '../db/mutations';
import { currentDate } from '../app/currentDate';
import { showToast } from '../app/focusState';
import { deliverFile } from '../app/deliverFile';
import { isMit, MAX_SPRINT, sprintRemainingMs } from '../domain/focus';
import { inToday, todaySortKey } from '../domain/smartLists';
import { sprintCalendar } from '../domain/icsWrite';
import { toDateStr } from '../domain/dates';
import { Sheet, SheetTitle } from '../ui/Sheet';

/** One editor for every sprint state:
 *  - running:  switch task, rewrite the next action, set the time left
 *  - planned:  task, next action, start time, length (+ refresh calendar alert)
 *  - done/abandoned: start, minutes actually focused, task, note — or delete */
export type SprintEditMode = 'running' | 'planned' | 'done';

export function modeFor(s: Sprint): SprintEditMode {
  return s.status === 'running' ? 'running' : s.status === 'planned' ? 'planned' : 'done';
}

const label: JSX.CSSProperties = { 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)', color: 'var(--text-secondary)', margin: '12px 0 6px' };
const field: JSX.CSSProperties = {
  width: '100%', padding: '11px 12px', 'border-radius': '11px', background: 'var(--bg-inset)',
  'font-size': 'calc(16px * var(--ts))', color: 'var(--text)',
};
const chip = (active: boolean): JSX.CSSProperties => ({
  padding: '7px 12px', 'border-radius': '999px', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)',
  background: active ? 'var(--blue)' : 'var(--bg-inset)', color: active ? 'var(--text-invert)' : 'var(--text)',
  'font-variant-numeric': 'tabular-nums',
});

const pad = (n: number) => String(n).padStart(2, '0');
function timeOf(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function combine(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(`${date}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function SprintEditSheet(props: { sprint: Sprint; onClose: () => void }): JSX.Element {
  const s = props.sprint;
  const mode = modeFor(s);
  const tasks = createLiveQuery(() => db.tasks.toArray(), [] as Task[]);

  const [taskId, setTaskId] = createSignal<string | null>(s.taskId);
  const [title, setTitle] = createSignal(s.taskId ? '' : s.title);
  const [nextAction, setNextAction] = createSignal(s.nextAction);
  const [note, setNote] = createSignal(s.completedNote);
  const [remaining, setRemaining] = createSignal(Math.max(1, Math.ceil(sprintRemainingMs(s, Date.now()) / 60_000)));
  const [minutes, setMinutes] = createSignal(
    mode === 'done' && s.startedAt !== null && s.endedAt !== null
      ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000))
      : s.durationMin,
  );
  const startMs = mode === 'planned' ? (s.plannedAt ?? Date.now()) : (s.startedAt ?? s.createdAt);
  const [date, setDate] = createSignal(toDateStr(new Date(startMs)));
  const [time, setTime] = createSignal(timeOf(startMs));

  const candidates = createMemo(() => {
    const today = currentDate();
    const open = tasks().filter((t) => inToday(t, today));
    open.sort((a, b) => {
      const d = (isMit(a, today) ? 0 : 1) - (isMit(b, today) ? 0 : 1);
      return d || (todaySortKey(a) < todaySortKey(b) ? -1 : 1);
    });
    const cur = s.taskId ? tasks().find((t) => t.id === s.taskId) : undefined;
    if (cur && !open.some((t) => t.id === cur.id)) open.unshift(cur);
    return open.slice(0, 8);
  });
  const finalTitle = () => tasks().find((t) => t.id === taskId())?.title || title().trim() || 'Deep work';

  const save = async () => {
    if (mode === 'running') {
      await editRunningSprint(s.id, { taskId: taskId(), title: finalTitle(), nextAction: nextAction().trim(), remainingMin: remaining() });
      showToast(`Sprint updated — ${remaining()} min left`);
    } else if (mode === 'planned') {
      const plannedAt = combine(date(), time());
      await updateSprint(s.id, {
        taskId: taskId(), title: finalTitle(), nextAction: nextAction().trim(),
        durationMin: minutes(), plannedAt, date: date(),
      });
      showToast(`Sprint moved to ${time()}${date() !== currentDate() ? ` on ${date()}` : ''}`);
    } else {
      await editSprintRecord(s.id, {
        startedAt: combine(date(), time()), minutes: minutes(),
        taskId: taskId(), title: finalTitle(), completedNote: note().trim(),
      });
      showToast('Sprint log updated');
    }
    props.onClose();
  };

  const refreshAlert = async () => {
    await save();
    await deliverFile('focus-sprint.ics', sprintCalendar({
      id: s.id, start: new Date(combine(date(), time())), durationMin: minutes(),
      title: finalTitle(), nextAction: nextAction(),
    }), 'text/calendar');
  };

  const remove = async () => {
    if (!window.confirm(mode === 'planned' ? 'Cancel this scheduled sprint?' : 'Delete this sprint from your log?')) return;
    await deleteSprint(s.id);
    showToast(mode === 'planned' ? 'Scheduled sprint cancelled' : 'Sprint deleted');
    props.onClose();
  };

  return (
    <Sheet onClose={props.onClose} trackKeyboard>
      <SheetTitle>{mode === 'running' ? 'Edit running sprint' : mode === 'planned' ? 'Edit scheduled sprint' : 'Edit sprint'}</SheetTitle>
      <div data-testid="sprint-edit" style={{ padding: '0 18px 18px', 'max-height': '72vh', overflow: 'auto' }}>
        <div style={label}>Task</div>
        <div style={{ background: 'var(--bg-inset)', 'border-radius': '12px', overflow: 'hidden' }}>
          <For each={candidates()}>
            {(t) => (
              <button
                data-testid="edit-task-option"
                onClick={() => setTaskId(t.id)}
                style={{
                  display: 'block', width: '100%', 'text-align': 'left', padding: '10px 12px', 'font-size': 'calc(15px * var(--ts))',
                  color: 'var(--text)', 'border-bottom': '1px solid var(--separator)',
                  background: taskId() === t.id ? 'color-mix(in srgb, var(--blue) 14%, transparent)' : 'transparent',
                }}
              >
                {isMit(t, currentDate()) ? '★ ' : ''}{t.title || 'New To-Do'}
              </button>
            )}
          </For>
          <input
            data-testid="edit-free-title"
            value={title()}
            placeholder="Or name the focus…"
            onFocus={() => setTaskId(null)}
            onInput={(e) => { setTaskId(null); setTitle(e.currentTarget.value); }}
            style={{ ...field, background: 'transparent' }}
          />
        </div>

        <Show when={mode !== 'done'}>
          <div style={label}>Next action</div>
          <input data-testid="edit-next-action" value={nextAction()} onInput={(e) => setNextAction(e.currentTarget.value)} placeholder="The very next concrete step" style={field} />
        </Show>

        <Show when={mode === 'running'}>
          <div style={label}>Time left</div>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'flex-wrap': 'wrap' }}>
            <button style={chip(false)} onClick={() => setRemaining((r) => Math.max(1, r - 5))}>−5</button>
            <input
              data-testid="edit-remaining"
              type="number" inputmode="numeric" min="1" max={String(MAX_SPRINT)}
              value={remaining()}
              onInput={(e) => setRemaining(Math.min(MAX_SPRINT, Math.max(1, Number(e.currentTarget.value) || 1)))}
              style={{ ...field, width: '84px', 'text-align': 'center' }}
            />
            <button style={chip(false)} onClick={() => setRemaining((r) => Math.min(MAX_SPRINT, r + 5))}>+5</button>
            <span style={{ color: 'var(--text-secondary)', 'font-size': 'calc(14px * var(--ts))' }}>min</span>
          </div>
        </Show>

        <Show when={mode !== 'running'}>
          <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={label}>{mode === 'planned' ? 'Date' : 'Started on'}</div>
              <input data-testid="edit-date" type="date" value={date()} onInput={(e) => setDate(e.currentTarget.value || date())} style={field} />
            </div>
            <div>
              <div style={label}>At</div>
              <input data-testid="edit-time" type="time" value={time()} onInput={(e) => setTime(e.currentTarget.value || time())} style={field} />
            </div>
          </div>
          <div style={label}>{mode === 'planned' ? 'Length' : 'Minutes actually focused'}</div>
          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'align-items': 'center' }}>
            <For each={[25, 45, 60, 90]}>{(m) => <button style={chip(minutes() === m)} onClick={() => setMinutes(m)}>{m}</button>}</For>
            <input
              data-testid="edit-minutes"
              type="number" inputmode="numeric" min="1" max={String(MAX_SPRINT)}
              value={minutes()}
              onInput={(e) => setMinutes(Math.min(MAX_SPRINT, Math.max(1, Number(e.currentTarget.value) || 1)))}
              style={{ ...field, width: '84px', 'text-align': 'center' }}
            />
          </div>
        </Show>

        <Show when={mode === 'done'}>
          <div style={label}>What you completed</div>
          <textarea data-testid="edit-note" rows={2} value={note()} onInput={(e) => setNote(e.currentTarget.value)} style={field} />
        </Show>

        <button
          data-testid="edit-save"
          onClick={() => void save()}
          style={{ width: '100%', padding: '14px', 'border-radius': '13px', background: 'var(--blue)', color: 'var(--text-invert)', 'font-size': 'calc(16px * var(--ts))', 'font-weight': 'var(--fw-600)', margin: '18px 0 8px' }}
        >
          Save
        </button>
        <Show when={mode === 'planned'}>
          <button onClick={() => void refreshAlert()} style={{ width: '100%', padding: '10px', color: 'var(--blue)', 'font-size': 'calc(14px * var(--ts))' }}>
            Save &amp; send an updated calendar alert
          </button>
        </Show>
        <Show when={mode !== 'running'}>
          <button data-testid="edit-delete" onClick={() => void remove()} style={{ width: '100%', padding: '10px', color: 'var(--red)', 'font-size': 'calc(15px * var(--ts))' }}>
            {mode === 'planned' ? 'Cancel this sprint' : 'Delete from log'}
          </button>
        </Show>
      </div>
    </Sheet>
  );
}
