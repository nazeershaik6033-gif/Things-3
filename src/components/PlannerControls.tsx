import { createSignal, For, Show, type JSX } from 'solid-js';
import type { DateStr, Task, TaskAlert } from '../db/models';
import { setTaskAlerts, setTaskTime } from '../db/mutations';
import { defaultAlert } from '../app/planner';
import { sendAlerts } from '../app/taskAlerts';
import { alertState, describeBefore, effectiveAlerts, hasAlert, toggleAlert } from '../domain/taskAlerts';
import { setRepeatSeriesTime, skipOccurrence } from '../db/superMutations';
import { db } from '../db/db';
import { createReactiveLiveQuery } from '../db/liveQuery';
import { seriesHistory, type OccurrenceState } from '../domain/repeat';
import { currentDate } from '../app/currentDate';
import { undoable } from '../app/undo';
import { haptic } from '../app/motion';
import { formatRelative } from '../domain/dates';
import {
  DEFAULT_BLOCK_MIN, formatClock, formatLength, formatRange, parseHHMM, taskDuration, toHHMM,
} from '../domain/timeline';
import { Icon } from '../ui/Icon';

/** The to-do card's Time chip and panel: when it sits on the timeline, and
 *  for how long. The timeline edits the same three fields by dragging. */

const LENGTHS = [15, 30, 45, 60, 90, 120];

/** "9 – 10:30 AM" for a to-do timed today; with `withDay`, "Fri 9 AM" for
 *  any other day. null when it has no time — or, without `withDay`, when its
 *  time belongs to another day (a to-do rolled into Today from yesterday
 *  keeps yesterday's time, which says nothing about today). */
export function timeLabel(t: Task, today: DateStr, withDay = false): string | null {
  const start = parseHHMM(t.startTime);
  if (start === null || !t.startDate) return null;
  if (t.startDate === today) return formatRange(start, Math.min(1440, start + taskDuration(t)));
  return withDay ? `${formatRelative(t.startDate, today)} ${formatClock(start)}` : null;
}

export function TimeChip(props: { task: Task; active: boolean; onClick: () => void }): JSX.Element {
  const label = () => timeLabel(props.task, currentDate(), true);
  return (
    <button
      data-testid="chip-time"
      aria-pressed={props.active}
      onClick={props.onClick}
      style={{
        display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '4px 10px',
        'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
        'font-variant-numeric': 'tabular-nums',
        background: label() ? 'color-mix(in srgb, var(--blue) 14%, transparent)' : 'var(--bg-inset)',
        color: label() ? 'var(--blue)' : 'var(--text)',
      }}
    >
      <Icon name="clock" size={12} color={label() ? 'currentColor' : 'var(--text-secondary)'} />
      {label() ?? 'Time'}
    </button>
  );
}

export function TimePicker(props: { task: Task; onClose: () => void }): JSX.Element {
  const today = currentDate();
  const initialStart = parseHHMM(props.task.startTime) ?? nextQuarter();
  const [date, setDate] = createSignal<DateStr>(props.task.startDate && props.task.startDate >= today ? props.task.startDate : today);
  const [time, setTime] = createSignal(toHHMM(initialStart));
  const [length, setLength] = createSignal(taskDuration(props.task, DEFAULT_BLOCK_MIN));
  const repeating = () => !!props.task.repeatTemplateId;

  const apply = async (startTime: string | null) => {
    haptic('tick');
    const id = props.task.id;
    const cfgId = props.task.repeatTemplateId;
    const d = startTime === null ? (props.task.startDate ?? today) : date();
    await undoable(
      startTime === null ? 'Remove time' : 'Set time',
      async () => {
        await setTaskTime(id, d, startTime, startTime === null ? props.task.durationMin : length());
        if (cfgId) await setRepeatSeriesTime(cfgId, startTime, startTime === null ? null : length(), today);
      },
      startTime === null ? 'Time removed' : undefined,
    );
    props.onClose();
  };

  const inputStyle = {
    padding: '10px 12px', 'border-radius': '10px', background: 'var(--bg-inset)', color: 'var(--text)',
    'font-size': 'calc(16px * var(--ts))', border: 'none', 'color-scheme': 'inherit',
  } as const;

  return (
    <div
      data-testid="time-picker"
      style={{
        display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '10px 4px 6px',
        'border-top': '1px solid var(--separator)', 'margin-top': '6px',
      }}
    >
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="date" value={date()} min={today} data-testid="time-date"
          onInput={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
          style={{ ...inputStyle, flex: '1', 'min-width': '0' }}
        />
        <input
          type="time" value={time()} step={300} data-testid="time-start"
          onInput={(e) => e.currentTarget.value && setTime(e.currentTarget.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
        <For each={LENGTHS}>
          {(m) => (
            <button
              data-testid={`time-len-${m}`}
              aria-pressed={length() === m}
              onClick={() => setLength(m)}
              style={{
                padding: '5px 11px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
                background: length() === m ? 'var(--blue)' : 'var(--bg-inset)',
                color: length() === m ? 'var(--text-invert)' : 'var(--text)',
              }}
            >
              {formatLength(m)}
            </button>
          )}
        </For>
      </div>
      <div style={{ display: 'flex', gap: '14px', 'align-items': 'center' }}>
        <button
          data-testid="time-save"
          onClick={() => void apply(time())}
          style={{
            padding: '9px 16px', 'border-radius': '10px', background: 'var(--blue)', color: '#fff',
            'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)',
          }}
        >
          Set {formatRange(parseHHMM(time()) ?? 0, Math.min(1440, (parseHHMM(time()) ?? 0) + length()))}
        </button>
        <Show when={props.task.startTime}>
          <button data-testid="time-clear" onClick={() => void apply(null)} style={{ color: 'var(--red)', 'font-size': 'calc(15px * var(--ts))' }}>
            Remove
          </button>
        </Show>
        <button onClick={props.onClose} style={{ color: 'var(--text-secondary)', 'font-size': 'calc(15px * var(--ts))' }}>Cancel</button>
      </div>
      <Show when={repeating()}>
        <div style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)' }}>
          Applies to the coming repeats too. To move just one day, drag it on the timeline.
        </div>
      </Show>
    </div>
  );
}

/** The next quarter hour from now, as minutes since midnight. */
function nextQuarter(): number {
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  return Math.min(1425, Math.ceil((m + 1) / 15) * 15);
}

// ---------------------------------------------------------------- alerts --

const START_CHOICES = [0, 5, 15, 30, 60];
const DUE_CHOICES = [0, 60, 1440];

/** Calendar alerts for one to-do: before its start, before its deadline,
 *  and a button that hands them to iOS Calendar. */
export function AlertsPanel(props: { task: Task }): JSX.Element {
  const def = () => defaultAlert();
  const list = () => effectiveAlerts(props.task, def());
  const timed = () => parseHHMM(props.task.startTime) !== null && !!props.task.startDate;
  const state = () => alertState(props.task, def());
  const toggle = (a: TaskAlert) => {
    haptic('tick');
    void setTaskAlerts(props.task.id, toggleAlert(list(), a));
  };
  const chip = (a: TaskAlert) => (
    <button
      data-testid={`alert-${a.anchor}-${a.beforeMin}`}
      aria-pressed={hasAlert(list(), a)}
      onClick={() => toggle(a)}
      style={{
        padding: '5px 10px', 'border-radius': '999px', 'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)',
        background: hasAlert(list(), a) ? 'var(--blue)' : 'var(--bg-inset)',
        color: hasAlert(list(), a) ? 'var(--text-invert)' : 'var(--text)',
      }}
    >
      {describeBefore(a.beforeMin, a.anchor)}
    </button>
  );
  return (
    <div data-testid="alerts-panel" style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-bottom': '10px', 'border-bottom': '1px solid var(--separator)' }}>
      <Show
        when={timed() || props.task.deadline}
        fallback={<div style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-secondary)' }}>Give it a time (the Time chip) or a deadline to set alerts that follow it.</div>}
      >
        <Show when={timed()}>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)' }}>
            Before it starts{props.task.alerts === null && def() !== null ? ' · default' : ''}
          </div>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={START_CHOICES}>{(m) => chip({ anchor: 'start', beforeMin: m })}</For>
          </div>
        </Show>
        <Show when={props.task.deadline}>
          <div style={{ 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', color: 'var(--text-secondary)' }}>
            Before the deadline{props.task.deadlineTime ? '' : ' (9 AM that day)'}
          </div>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={DUE_CHOICES}>{(m) => chip({ anchor: 'deadline', beforeMin: m })}</For>
          </div>
        </Show>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', 'padding-top': '2px' }}>
          <button
            data-testid="alerts-send"
            disabled={list().length === 0}
            onClick={() => void sendAlerts([props.task], 'clarity-alert.ics')}
            style={{
              display: 'inline-flex', 'align-items': 'center', gap: '6px', padding: '8px 14px', 'border-radius': '10px',
              background: list().length === 0 ? 'var(--bg-inset)' : 'var(--blue)',
              color: list().length === 0 ? 'var(--text-tertiary)' : '#fff', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)',
            }}
          >
            <Icon name="bell" size={15} />
            {state() === 'changed' ? 'Send again to Calendar' : 'Send to Calendar'}
          </button>
          <span data-testid="alerts-state" style={{ 'font-size': 'calc(12px * var(--ts))', color: state() === 'sent' ? 'var(--green)' : state() === 'changed' ? 'var(--orange, var(--red))' : 'var(--text-tertiary)' }}>
            {state() === 'sent' ? '✓ In Calendar' : state() === 'changed' ? 'Changed since sent' : ''}
          </span>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- repeats --

const STATE_STYLE: Record<OccurrenceState, { bg: string; label: string }> = {
  done: { bg: 'var(--green)', label: 'done' },
  skipped: { bg: 'var(--text-tertiary)', label: 'skipped' },
  missed: { bg: 'var(--red)', label: 'missed' },
  open: { bg: 'var(--blue)', label: 'today' },
  upcoming: { bg: 'transparent', label: 'coming' },
};

/** Skip this occurrence (with undo) and a strip of the series' recent days. */
export function RepeatExtras(props: { task: Task; onSkipped?: () => void }): JSX.Element {
  const series = createReactiveLiveQuery(
    () => props.task.repeatTemplateId,
    async (id) => (id ? db.tasks.where('repeatTemplateId').equals(id).toArray() : []),
    [] as Task[],
  );
  const history = () => seriesHistory(series(), currentDate());
  const done = () => history().filter((h) => h.state === 'done').length;
  const past = () => history().filter((h) => h.state === 'done' || h.state === 'skipped' || h.state === 'missed').length;
  return (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', 'flex-wrap': 'wrap', padding: '2px 0 6px 31px' }}>
      <Show when={props.task.status === 'open'}>
        <button
          data-testid="chip-skip"
          onClick={() => {
            haptic('tick');
            const id = props.task.id;
            void undoable('Skip', () => skipOccurrence(id, currentDate()), 'Skipped — the next one is planned');
            props.onSkipped?.();
          }}
          style={{
            display: 'inline-flex', 'align-items': 'center', gap: '4px', padding: '4px 10px', 'border-radius': '999px',
            'font-size': 'calc(13px * var(--ts))', 'font-weight': 'var(--fw-600)', background: 'var(--bg-inset)', color: 'var(--text)',
          }}
        >
          <Icon name="chevron-right" size={12} color="var(--purple)" /> Skip this one
        </button>
      </Show>
      <Show when={history().length > 1}>
        <div data-testid="repeat-history" title={`${done()} of the last ${past()} done`} style={{ display: 'flex', 'align-items': 'center', gap: '3px' }}>
          <For each={history()}>
            {(h) => (
              <span
                data-state={h.state}
                title={`${h.date}: ${STATE_STYLE[h.state].label}`}
                style={{
                  width: '9px', height: '9px', 'border-radius': '3px', background: STATE_STYLE[h.state].bg,
                  border: h.state === 'upcoming' ? '1.5px solid var(--text-tertiary)' : 'none',
                }}
              />
            )}
          </For>
          <Show when={past() > 0}>
            <span style={{ 'font-size': 'calc(12px * var(--ts))', color: 'var(--text-tertiary)', 'margin-left': '4px' }}>{done()}/{past()}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
