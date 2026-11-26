import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { topRoute } from '../app/navigation';
import type { DateStr, RepeatCfg, RepeatRule, Sprint, Task } from '../db/models';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { makeRepeating, setEstimate, setRepeatPaused, stopRepeating } from '../db/superMutations';
import {
  ESTIMATE_PRESETS, estimateRatio, formatClockHMS, formatDuration, liveTaskSeconds, parseDuration,
  remainingEstimateMin, taskTimeByDay,
} from '../domain/timeTracking';
import { describeRule, nextOccurrence, normalizeRule, presetRule, type RepeatPreset } from '../domain/repeat';
import { formatRelative, weekdayOf } from '../domain/dates';
import {
  doneSprints, nowTick, runningSeconds, stopTracking, stretchMinutes, takeBreak, toggleTracking, tracker,
  trackingTaskId,
} from '../app/timeTracking';
import { currentDate } from '../app/currentDate';
import { haptic } from '../app/motion';
import { showToast } from '../app/focusState';
import { Icon } from '../ui/Icon';

/** Time tracking, estimates and repeats on a to-do — the controls ported
 *  from Super Productivity, in Clarity's chip-and-inline-panel idiom. */

const panelStyle = {
  display: 'flex',
  'flex-direction': 'column',
  gap: '10px',
  padding: '10px 4px 8px',
  'border-top': '1px solid var(--separator)',
  'margin-top': '6px',
} as const;

const pill = (active: boolean) => ({
  padding: '6px 12px',
  'border-radius': '999px',
  'font-size': '14px',
  'font-weight': '600',
  background: active ? 'var(--blue)' : 'var(--bg-inset)',
  color: active ? 'var(--text-invert)' : 'var(--text)',
}) as const;

const inputStyle = {
  padding: '9px 12px',
  'border-radius': '10px',
  background: 'var(--bg-inset)',
  color: 'var(--text)',
  'font-size': '16px',
  border: 'none',
  'color-scheme': 'inherit',
} as const;

/** Finished sprints count toward a to-do's time (one shared subscription). */
export function useSprints(): () => Sprint[] {
  return doneSprints;
}

// ------------------------------------------------------------ in the card ----

/** Play/pause chip with the live total, plus the estimate chip. */
export function TimeChips(props: { task: Task; onEstimate: () => void }): JSX.Element {
  const sprints = useSprints();
  const tracking = () => trackingTaskId() === props.task.id;
  const total = () => {
    nowTick();
    return liveTaskSeconds(props.task, sprints(), tracker(), Date.now());
  };
  const ratio = () => estimateRatio(total(), props.task.timeEstimateMin);
  const chip = (active: boolean) => ({
    display: 'inline-flex',
    'align-items': 'center',
    gap: '5px',
    padding: '4px 10px',
    'border-radius': '999px',
    'font-size': '13px',
    'font-weight': '600',
    'font-variant-numeric': 'tabular-nums',
    background: active ? 'var(--blue)' : 'var(--bg-inset)',
    color: active ? 'var(--text-invert)' : 'var(--text)',
  }) as const;
  return (
    <>
      <button
        data-testid="chip-track"
        aria-pressed={tracking()}
        aria-label={tracking() ? 'Stop tracking time' : 'Track time'}
        onClick={() => {
          haptic('tick');
          void toggleTracking(props.task.id);
        }}
        style={chip(tracking())}
      >
        <Icon name={tracking() ? 'pause' : 'resume'} size={11} color={tracking() ? 'currentColor' : 'var(--blue)'} />
        <span data-testid="chip-track-time">
          {tracking() ? formatClockHMS(total()) : total() > 0 ? formatDuration(total()) : 'Track'}
        </span>
      </button>
      <button data-testid="chip-estimate" onClick={props.onEstimate} style={chip(false)}>
        <Icon name="hourglass" size={12} color={ratio() !== null && ratio()! > 1 ? 'var(--red)' : 'var(--text-secondary)'} />
        {props.task.timeEstimateMin ? formatDuration(props.task.timeEstimateMin * 60) : 'Estimate'}
      </button>
    </>
  );
}

export function EstimatePicker(props: { task: Task; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = createSignal(props.task.timeEstimateMin ? String(props.task.timeEstimateMin) : '');
  const apply = (min: number | null) => {
    void setEstimate(props.task.id, min);
    props.onClose();
  };
  return (
    <div data-testid="estimate-picker" style={panelStyle}>
      <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
        <For each={[...ESTIMATE_PRESETS]}>
          {(m) => (
            <button
              data-testid={`estimate-${m}`}
              onClick={() => apply(m)}
              style={pill(props.task.timeEstimateMin === m)}
            >
              {formatDuration(m * 60)}
            </button>
          )}
        </For>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
        <input
          data-testid="estimate-input"
          value={draft()}
          placeholder="e.g. 1h30m"
          inputmode="text"
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const m = parseDuration(draft());
              if (m) apply(m);
            }
          }}
          style={{ ...inputStyle, flex: '1', 'min-width': '0' }}
        />
        <button
          data-testid="estimate-save"
          onClick={() => {
            const m = parseDuration(draft());
            if (m) apply(m);
            else showToast('Try 45m, 1h or 1h30m');
          }}
          style={{ ...pill(true), padding: '9px 14px' }}
        >
          Set
        </button>
        <Show when={props.task.timeEstimateMin}>
          <button onClick={() => apply(null)} style={{ color: 'var(--red)', 'font-size': '14px' }}>Clear</button>
        </Show>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- repeating ----

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PRESETS: { id: RepeatPreset; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];
const UNIT: Record<RepeatRule['freq'], string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

export function RepeatPicker(props: { task: Task; cfg: RepeatCfg | null; onClose: () => void }): JSX.Element {
  const today = currentDate();
  const initialAnchor: DateStr = props.task.startDate && props.task.startDate >= today ? props.task.startDate : today;
  const [rule, setRule] = createSignal<RepeatRule>(props.cfg?.rule ?? presetRule('daily', initialAnchor));
  const [hasEnd, setHasEnd] = createSignal(!!props.cfg?.rule.until);
  const patch = (p: Partial<RepeatRule>) => setRule(normalizeRule({ ...rule(), ...p }));
  const preset = (id: RepeatPreset) => {
    const r = presetRule(id, rule().anchor);
    setRule({ ...r, until: rule().until, afterCompletion: rule().afterCompletion });
  };
  const activePreset = createMemo((): RepeatPreset | null => {
    const r = rule();
    if (r.interval !== 1) return null;
    if (r.freq === 'daily') return 'daily';
    if (r.freq === 'weekly') return r.weekdays.join(',') === '1,2,3,4,5' ? 'weekdays' : r.weekdays.length <= 1 ? 'weekly' : null;
    return r.freq === 'monthly' && r.monthMode === 'day' ? 'monthly' : r.freq === 'yearly' ? 'yearly' : null;
  });
  const next = createMemo(() => {
    const r = rule();
    if (r.afterCompletion) return null;
    const first = r.anchor >= today ? r.anchor : nextOccurrence(r, today);
    return first ? formatRelative(first, today) : null;
  });

  const save = async () => {
    const r = normalizeRule({ ...rule(), until: hasEnd() ? rule().until ?? rule().anchor : null });
    await makeRepeating(props.task.id, r, today);
    haptic('success');
    showToast(`Repeats ${describeRule(r).replace(/^Every/, 'every')}`);
    props.onClose();
  };

  return (
    <div data-testid="repeat-picker" style={panelStyle}>
      <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
        <For each={PRESETS}>
          {(p) => (
            <button data-testid={`repeat-${p.id}`} onClick={() => preset(p.id)} style={pill(activePreset() === p.id)}>
              {p.label}
            </button>
          )}
        </For>
      </div>

      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '15px' }}>
        <span>Every</span>
        <input
          data-testid="repeat-interval"
          type="number"
          min="1"
          max="999"
          value={rule().interval}
          onInput={(e) => patch({ interval: Number(e.currentTarget.value) })}
          style={{ ...inputStyle, width: '64px', padding: '7px 10px' }}
        />
        <select
          data-testid="repeat-freq"
          value={rule().freq}
          onChange={(e) => {
            const freq = e.currentTarget.value as RepeatRule['freq'];
            patch({ freq, weekdays: freq === 'weekly' && rule().weekdays.length === 0 ? [weekdayOf(rule().anchor)] : rule().weekdays });
          }}
          style={{ ...inputStyle, padding: '7px 10px' }}
        >
          <For each={(['daily', 'weekly', 'monthly', 'yearly'] as const)}>
            {(f) => <option value={f}>{UNIT[f]}{rule().interval === 1 ? '' : 's'}</option>}
          </For>
        </select>
      </div>

      <Show when={rule().freq === 'weekly' && !rule().afterCompletion}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <For each={DAY_LETTERS}>
            {(letter, i) => {
              const on = () => rule().weekdays.includes(i());
              return (
                <button
                  data-testid={`repeat-day-${i()}`}
                  aria-pressed={on()}
                  onClick={() => {
                    const days = on() ? rule().weekdays.filter((d) => d !== i()) : [...rule().weekdays, i()];
                    if (days.length) patch({ weekdays: days });
                  }}
                  style={{
                    width: '34px', height: '34px', 'border-radius': '50%', 'font-size': '13px', 'font-weight': '700',
                    background: on() ? 'var(--blue)' : 'var(--bg-inset)', color: on() ? 'var(--text-invert)' : 'var(--text)',
                  }}
                >
                  {letter}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={rule().freq === 'monthly' && !rule().afterCompletion}>
        <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
          <button data-testid="repeat-month-day" onClick={() => patch({ monthMode: 'day' })} style={pill(rule().monthMode === 'day')}>Same date</button>
          <button data-testid="repeat-month-nth" onClick={() => patch({ monthMode: 'nthWeekday' })} style={pill(rule().monthMode === 'nthWeekday')}>Same weekday</button>
          <button data-testid="repeat-month-last" onClick={() => patch({ monthMode: 'lastDay' })} style={pill(rule().monthMode === 'lastDay')}>Last day</button>
        </div>
      </Show>

      <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '15px' }}>
        <span style={{ width: '52px', color: 'var(--text-secondary)' }}>Starts</span>
        <input
          data-testid="repeat-anchor"
          type="date"
          value={rule().anchor}
          onInput={(e) => e.currentTarget.value && patch({ anchor: e.currentTarget.value, weekdays: rule().freq === 'weekly' && rule().weekdays.length <= 1 ? [weekdayOf(e.currentTarget.value)] : rule().weekdays })}
          style={{ ...inputStyle, flex: '1' }}
        />
      </label>
      <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '15px' }}>
        <span style={{ width: '52px', color: 'var(--text-secondary)' }}>Ends</span>
        <button data-testid="repeat-ends-never" onClick={() => setHasEnd(false)} style={pill(!hasEnd())}>Never</button>
        <button onClick={() => { setHasEnd(true); if (!rule().until) patch({ until: rule().anchor }); }} style={pill(hasEnd())}>On</button>
        <Show when={hasEnd()}>
          <input
            type="date"
            value={rule().until ?? rule().anchor}
            min={rule().anchor}
            onInput={(e) => setRule({ ...rule(), until: e.currentTarget.value || null })}
            style={{ ...inputStyle, flex: '1', 'min-width': '0' }}
          />
        </Show>
      </label>
      <button
        data-testid="repeat-after-completion"
        aria-pressed={rule().afterCompletion}
        onClick={() => patch({ afterCompletion: !rule().afterCompletion })}
        style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '15px', 'text-align': 'left' }}
      >
        <span style={{
          width: '20px', height: '20px', 'border-radius': '6px', display: 'grid', 'place-items': 'center',
          background: rule().afterCompletion ? 'var(--blue)' : 'var(--bg-inset)', color: 'var(--text-invert)',
        }}>
          <Show when={rule().afterCompletion}><Icon name="check" size={14} strokeWidth={3} /></Show>
        </span>
        Count from when I finish it
      </button>

      <div data-testid="repeat-summary" style={{ 'font-size': '13px', color: 'var(--text-secondary)' }}>
        {describeRule({ ...rule(), until: hasEnd() ? rule().until : null })}
        <Show when={next()}> · next {next()}</Show>
      </div>

      <div style={{ display: 'flex', gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
        <button data-testid="repeat-save" onClick={() => void save()} style={{ ...pill(true), padding: '9px 16px' }}>
          {props.cfg ? 'Update' : 'Repeat'}
        </button>
        <Show when={props.cfg}>
          <button
            data-testid="repeat-pause"
            onClick={() => { void setRepeatPaused(props.cfg!.id, !props.cfg!.paused); props.onClose(); }}
            style={{ color: 'var(--text)', 'font-size': '15px' }}
          >
            {props.cfg!.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            data-testid="repeat-stop"
            onClick={() => { void stopRepeating(props.cfg!.id, today); showToast('No longer repeating'); props.onClose(); }}
            style={{ color: 'var(--red)', 'font-size': '15px' }}
          >
            Stop repeating
          </button>
        </Show>
        <button onClick={props.onClose} style={{ color: 'var(--text-secondary)', 'font-size': '15px' }}>Cancel</button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- in a row ----

/** Compact row chip: a live clock while tracked, else spent / estimate. */
export function RowTimeChip(props: { task: Task }): JSX.Element {
  const tracking = () => trackingTaskId() === props.task.id;
  const spent = () => {
    if (tracking()) nowTick();
    return liveTaskSeconds(props.task, doneSprints(), tracker(), Date.now());
  };
  const show = () => tracking() || spent() > 0 || !!props.task.timeEstimateMin;
  return (
    <Show when={show()}>
      <span
        data-testid="row-time-chip"
        style={{
          display: 'inline-flex', 'align-items': 'center', gap: '3px',
          'font-size': 'var(--fs-chip)', 'font-variant-numeric': 'tabular-nums',
          color: tracking() ? 'var(--blue)' : 'var(--text-secondary)', 'font-weight': tracking() ? '700' : '400',
        }}
      >
        <Show when={tracking()} fallback={<Icon name="hourglass" size={11} />}>
          <span class="tracking-dot" />
        </Show>
        {tracking() ? formatClockHMS(spent()) : spent() > 0 ? formatDuration(spent()) : ''}
        <Show when={props.task.timeEstimateMin}>
          {spent() > 0 || tracking() ? ' / ' : ''}{formatDuration(props.task.timeEstimateMin! * 60)}
        </Show>
      </span>
    </Show>
  );
}

// ------------------------------------------------------------ global bar ----

/** Floating pill while a to-do is being tracked: tap the title to open it,
 *  ■ to stop. Shows the unbroken-stretch minutes once a break nears. */
export function TrackerBar(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), [] as Task[]);
  const current = createMemo(() => {
    const id = trackingTaskId();
    return id ? tasks().find((x) => x.id === id) ?? null : null;
  });
  const title = () => current()?.title || 'Untitled';
  const total = () => {
    nowTick();
    const t = current();
    return t ? liveTaskSeconds(t, doneSprints(), tracker(), Date.now()) : runningSeconds();
  };
  return (
    <Show when={trackingTaskId()}>
      <Portal>
        <div
          data-testid="tracker-bar"
          style={{
            position: 'fixed',
            left: '12px',
            // On Home it rides above the floating tab bar
            bottom: topRoute().name === 'home'
              ? 'calc(var(--safe-bottom) + 84px)'
              : 'calc(var(--safe-bottom) + 22px)',
            'max-width': 'calc(100% - 110px)',
            'z-index': '58',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '7px 8px 7px 12px',
            'border-radius': '999px',
            background: 'var(--bg-elevated)',
            'box-shadow': 'var(--shadow-card)',
            color: 'var(--text)',
            'font-size': '13px',
            'font-weight': '600',
            animation: 'fade-in 160ms ease-out',
          }}
        >
          <span class="tracking-dot" />
          <span
            data-testid="tracker-title"
            style={{ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}
          >
            {title()}
          </span>
          <span data-testid="tracker-time" style={{ 'font-variant-numeric': 'tabular-nums', color: 'var(--blue)' }}>
            {formatClockHMS(total())}
          </span>
          <Show when={stretchMinutes() >= 25}>
            <button
              data-testid="tracker-break"
              onClick={() => void takeBreak()}
              aria-label="Take a break"
              style={{ 'font-size': '12px', color: 'var(--green)', padding: '2px 4px' }}
            >
              Break
            </button>
          </Show>
          <button
            data-testid="tracker-stop"
            aria-label="Stop tracking"
            onClick={() => { haptic('tick'); void stopTracking(); }}
            style={{
              width: '26px', height: '26px', 'border-radius': '50%', display: 'grid', 'place-items': 'center',
              background: 'var(--blue)', color: 'var(--text-invert)', flex: 'none',
            }}
          >
            <Icon name="pause" size={12} />
          </button>
        </div>
      </Portal>
    </Show>
  );
}

/** Today's plan at a glance (Super Productivity's work-view header): what is
 *  left of today's estimates, what has been tracked, and the way out to
 *  Finish Day. Hidden until there is something to say. */
export function TodayPlanStrip(props: { tasks: Task[]; onFinish: () => void }): JSX.Element {
  const sprints = useSprints();
  const left = createMemo(() => remainingEstimateMin(props.tasks, sprints()));
  const tracked = () => {
    nowTick();
    const today = currentDate();
    let sec = 0;
    for (const t of props.tasks) sec += taskTimeByDay(t, sprints())[today] ?? 0;
    return sec + (trackingTaskId() && props.tasks.some((t) => t.id === trackingTaskId()) ? runningSeconds() : 0);
  };
  return (
    <Show when={left() > 0 || tracked() >= 60}>
      <div
        data-testid="today-plan-strip"
        style={{
          display: 'flex', 'align-items': 'center', gap: '10px', margin: '0 12px 8px', padding: '8px 12px',
          'border-radius': '12px', background: 'var(--bg-inset)', 'font-size': '13px', color: 'var(--text-secondary)',
        }}
      >
        <Icon name="hourglass" size={14} color="var(--blue)" />
        <span style={{ flex: '1', 'font-variant-numeric': 'tabular-nums' }}>
          <Show when={left() > 0}>
            <span data-testid="today-plan-left" style={{ color: 'var(--text)', 'font-weight': '600' }}>{formatDuration(left() * 60)} left</span>
          </Show>
          <Show when={left() > 0 && tracked() >= 60}> · </Show>
          <Show when={tracked() >= 60}>{formatDuration(tracked())} tracked</Show>
        </span>
        <button data-testid="today-finish-day" onClick={props.onFinish} style={{ color: 'var(--blue)', 'font-weight': '600' }}>
          Finish day
        </button>
      </div>
    </Show>
  );
}
