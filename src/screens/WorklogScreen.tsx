import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery } from '../db/liveQuery';
import { setTimeOnDay } from '../db/superMutations';
import { currentDate } from '../app/currentDate';
import { deliverFile } from '../app/deliverFile';
import { showToast } from '../app/focusState';
import { addDays, formatRelative, fromDateStr, monthName, weekdayName, yearOf } from '../domain/dates';
import { groupWorklog, timesheetCsv, weekStart, worklogDays, type WorklogDay } from '../domain/worklog';
import { formatDuration, parseDuration, taskTimeByDay } from '../domain/timeTracking';
import { IMPACT_LABELS } from '../domain/finishDay';
import { Icon } from '../ui/Icon';
import { ScreenChrome, EmptyState } from './common';
import { Panel, SectionLabel, StatRow, StatTile, fieldStyle, softButton } from './superCommon';
import { useSprints } from '../components/TimeControls';

/** The Worklog: Super Productivity's timesheet, in Clarity. Months → weeks →
 *  days, each day expandable into the to-dos you worked on, with the time
 *  editable after the fact and a CSV export for time-tracking systems. */

type Range = 'week' | 'month' | 'all';

function shortDate(d: string): string {
  const x = fromDateStr(d);
  return `${monthName(d).slice(0, 3)} ${x.getDate()}`;
}

function DayBlock(props: {
  day: WorklogDay;
  projects: Map<string, string>;
  today: string;
  onSetTime: (taskId: string, day: string, sec: number) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(props.day.date === props.today);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const label = () => {
    const rel = formatRelative(props.day.date, props.today);
    return rel === 'Today' || rel === 'Tomorrow' ? rel : `${weekdayName(props.day.date).slice(0, 3)}, ${shortDate(props.day.date)}`;
  };
  return (
    <div style={{ 'border-top': '1px solid var(--separator)' }}>
      <button
        data-testid={`worklog-day-${props.day.date}`}
        class="pressable"
        onClick={() => setOpen(!open())}
        style={{ display: 'flex', 'align-items': 'center', gap: '10px', width: '100%', padding: '11px 14px', 'text-align': 'left' }}
      >
        <Icon name={open() ? 'chevron-down' : 'chevron-right'} size={14} color="var(--text-tertiary)" />
        <span style={{ flex: '1', 'font-size': '15px', 'font-weight': '600' }}>{label()}</span>
        <Show when={props.day.completedCount > 0}>
          <span style={{ 'font-size': '12px', color: 'var(--green)', 'font-weight': '600' }}>
            {props.day.completedCount} done
          </span>
        </Show>
        <span style={{ 'font-size': '14px', 'font-variant-numeric': 'tabular-nums', color: 'var(--text-secondary)', 'min-width': '56px', 'text-align': 'right' }}>
          {props.day.totalSec > 0 ? formatDuration(props.day.totalSec) : '—'}
        </span>
      </button>
      <Show when={open()}>
        <div style={{ padding: '0 14px 10px 38px' }}>
          <Show when={props.day.review}>
            <div data-testid="worklog-review" style={{ 'font-size': '13px', color: 'var(--text-secondary)', padding: '0 0 8px', 'line-height': '1.45' }}>
              <Show when={props.day.review!.impact}>
                <span style={{ color: 'var(--purple)', 'font-weight': '600' }}>
                  {IMPACT_LABELS[(props.day.review!.impact ?? 1) - 1]} impact
                </span>
                {props.day.review!.note ? ' · ' : ''}
              </Show>
              {props.day.review!.note}
            </div>
          </Show>
          <For each={props.day.entries}>
            {(e) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '5px 0', 'font-size': '14px' }}>
                <span style={{ width: '14px', color: 'var(--green)', display: 'inline-flex' }}>
                  <Show when={e.completed}><Icon name="check" size={13} strokeWidth={2.6} /></Show>
                </span>
                <span style={{ flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {e.title}
                  <Show when={e.projectId && props.projects.get(e.projectId!)}>
                    <span style={{ color: 'var(--text-tertiary)' }}> · {props.projects.get(e.projectId!)}</span>
                  </Show>
                </span>
                <Show
                  when={editing() === e.taskId}
                  fallback={
                    <button
                      data-testid="worklog-entry-time"
                      onClick={() => { setDraft(e.sec > 0 ? String(Math.round(e.sec / 60)) : ''); setEditing(e.taskId); }}
                      style={{ 'font-variant-numeric': 'tabular-nums', color: 'var(--text-secondary)', 'text-decoration': 'underline dotted', 'text-underline-offset': '3px' }}
                    >
                      {e.sec > 0 ? formatDuration(e.sec) : '+ time'}
                    </button>
                  }
                >
                  <input
                    data-testid="worklog-entry-input"
                    value={draft()}
                    placeholder="45m"
                    ref={(el) => queueMicrotask(() => el.focus())}
                    onInput={(ev) => setDraft(ev.currentTarget.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); if (ev.key === 'Escape') setEditing(null); }}
                    onBlur={() => {
                      const raw = draft().trim();
                      const min = raw === '' || raw === '0' ? 0 : parseDuration(raw);
                      if (min === null) showToast('Try 45m, 1h or 1h30m');
                      else props.onSetTime(e.taskId, props.day.date, min * 60);
                      setEditing(null);
                    }}
                    style={{ ...fieldStyle, width: '76px', padding: '4px 8px', 'font-size': '14px' }}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function WorklogScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const reviews = createLiveQuery(() => db.dayReviews.toArray(), []);
  const sprints = useSprints();
  const [range, setRange] = createSignal<Range>('week');

  const days = createMemo(() => worklogDays(tasks(), sprints(), reviews()));
  const months = createMemo(() => groupWorklog(days()));
  const projectNames = createMemo(() => new Map(projects().map((p) => [p.id, p.title || 'Project'])));

  const sumFrom = (from: string) => days().filter((d) => d.date >= from && d.date <= currentDate()).reduce((s, d) => s + d.totalSec, 0);
  const todaySec = () => sumFrom(currentDate());
  const weekSec = () => sumFrom(weekStart(currentDate()));
  const monthSec = () => sumFrom(`${currentDate().slice(0, 7)}-01`);

  const exportCsv = async () => {
    const today = currentDate();
    const from = range() === 'week' ? weekStart(today) : range() === 'month' ? `${today.slice(0, 7)}-01` : '0000-01-01';
    const slice = worklogDays(tasks(), sprints(), reviews(), { from, to: today });
    if (slice.every((d) => d.entries.length === 0)) {
      showToast('Nothing tracked in that range yet');
      return;
    }
    const csv = timesheetCsv(slice, tasks(), projects(), tags());
    const res = await deliverFile(`timesheet-${range()}-${today}.csv`, csv, 'text/csv');
    if (res !== 'cancelled') showToast('Timesheet exported');
  };

  /** The shown time is tracker time + finished sprints; a correction sets
   *  the tracker part so the total reads what was typed. */
  const setTime = (taskId: string, day: string, sec: number) => {
    const t = tasks().find((x) => x.id === taskId);
    if (!t) return;
    const own = t.timeSpent?.[day] ?? 0;
    const fromSprints = (taskTimeByDay(t, sprints())[day] ?? 0) - own;
    if (sec < fromSprints) showToast('Focus Sprint time is edited in Daily Focus → Sprint log');
    void setTimeOnDay(taskId, day, Math.max(0, sec - fromSprints));
  };

  const monthLabel = (key: string) => {
    const d = `${key}-01`;
    return `${monthName(d)} ${yearOf(d)}`;
  };

  return (
    <ScreenChrome
      title="Worklog"
      subtitle="Time tracked and to-dos finished, day by day"
      icon={<Icon name="clock" size={26} color="var(--blue)" />}
    >
      <StatRow>
        <StatTile testid="worklog-today" label="Today" value={formatDuration(todaySec())} />
        <StatTile testid="worklog-week" label="This week" value={formatDuration(weekSec())} />
        <StatTile testid="worklog-month" label="This month" value={formatDuration(monthSec())} />
      </StatRow>

      <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', padding: '0 16px 12px', 'flex-wrap': 'wrap' }}>
        <span style={{ 'font-size': '13px', color: 'var(--text-secondary)', 'margin-right': '4px' }}>Timesheet</span>
        <For each={(['week', 'month', 'all'] as Range[])}>
          {(r) => (
            <button
              onClick={() => setRange(r)}
              style={{
                ...softButton,
                padding: '5px 10px',
                'font-size': '13px',
                background: range() === r ? 'var(--blue)' : 'var(--bg-inset)',
                color: range() === r ? 'var(--text-invert)' : 'var(--text)',
              }}
            >
              {r === 'week' ? 'This week' : r === 'month' ? 'This month' : 'All time'}
            </button>
          )}
        </For>
        <button data-testid="worklog-export" onClick={() => void exportCsv()} style={{ ...softButton, display: 'inline-flex', 'align-items': 'center', gap: '5px', color: 'var(--blue)', 'margin-left': 'auto' }}>
          <Icon name="export" size={15} /> CSV
        </button>
      </div>

      <Show
        when={months().length > 0}
        fallback={<EmptyState icon={<Icon name="clock" size={44} />} text="Nothing logged yet. Tap Track on a to-do (or finish a Focus Sprint) and your time shows up here." />}
      >
        <For each={months()}>
          {(m) => (
            <>
              <SectionLabel trailing={<span style={{ 'font-variant-numeric': 'tabular-nums' }}>{formatDuration(m.totalSec)}</span>}>
                {monthLabel(m.key)}
              </SectionLabel>
              <For each={m.weeks}>
                {(w) => (
                  <Panel pad={false}>
                    <div style={{ display: 'flex', padding: '9px 14px', 'font-size': '13px', color: 'var(--text-secondary)', 'font-weight': '600' }}>
                      <span style={{ flex: '1' }}>Week of {shortDate(w.start)} – {shortDate(addDays(w.start, 6))}</span>
                      <span style={{ 'font-variant-numeric': 'tabular-nums' }}>{formatDuration(w.totalSec)}</span>
                    </div>
                    <For each={w.days}>
                      {(d) => <DayBlock day={d} projects={projectNames()} today={currentDate()} onSetTime={setTime} />}
                    </For>
                  </Panel>
                )}
              </For>
            </>
          )}
        </For>
      </Show>
      <div style={{ height: '120px' }} />
    </ScreenChrome>
  );
}
