import { createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { db } from '../db/db';
import { createLiveQuery, createReactiveLiveQuery } from '../db/liveQuery';
import type { DateStr, SavedView, Task, ViewFilter } from '../db/models';
import { getSetting, setSetting } from '../db/mutations';
import { deleteSavedView, saveDayNote, updateSavedView } from '../db/workflowMutations';
import { currentDate } from '../app/currentDate';
import { back, push } from '../app/navigation';
import { showToast } from '../app/focusState';
import { addDays, formatRelative, fromDateStr, isValidDateStr, monthName, weekdayName } from '../domain/dates';
import { groupByHome } from '../domain/smartLists';
import { sortByOrderKey } from '../db/ordering';
import { QUADRANTS } from '../domain/eisenhower';
import {
  applyView, canDoNow, describeView, mondayOf, STAGES, stageOf, weekKey, weekReview,
} from '../domain/workflow';
import { ExpandableTask } from '../components/TaskCard';
import type { TaskRowContext } from '../components/TaskRow';
import { MarkdownView } from '../components/MarkdownView';
import { ViewEditor } from '../components/ViewEditor';
import { SelectButton } from '../components/Selection';
import { Icon } from '../ui/Icon';
import { ScreenChrome, createScheduler, EmptyState, MenuRow, SectionHeading } from './common';
import { Sheet, SheetTitle } from '../ui/Sheet';

// ------------------------------------------------------------ shared rows --

type Grouping = SavedView['groupBy'];

/** To-dos as editable rows, grouped the way a view asks. */
function GroupedTasks(props: { tasks: Task[]; groupBy: Grouping; empty: string; compact?: boolean }): JSX.Element {
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const { schedule, SchedulerHost } = createScheduler();
  const ctx = createMemo<TaskRowContext>(() => ({ tags: tags(), onSchedule: schedule, showWhen: true, showMit: true }));
  const groups = createMemo<{ key: string; title: string; tasks: Task[] }[]>(() => {
    const ts = props.tasks;
    const today = currentDate();
    switch (props.groupBy) {
      case 'home':
        return groupByHome(ts, projects(), areas()).map((g) => ({ key: `${g.kind}:${g.id}`, title: g.title, tasks: g.tasks }));
      case 'stage':
        return STAGES.map((s) => ({ key: s.id, title: s.label, tasks: sortByOrderKey(ts.filter((t) => stageOf(t) === s.id)) }));
      case 'quadrant':
        return [
          ...QUADRANTS.map((q) => ({ key: q.id, title: q.label, tasks: sortByOrderKey(ts.filter((t) => t.priority === q.id)) })),
          { key: 'none', title: 'Unsorted', tasks: sortByOrderKey(ts.filter((t) => !t.priority)) },
        ];
      case 'when':
        return [
          { key: 'today', title: 'Today', tasks: ts.filter((t) => t.startDate !== null && t.startDate <= today) },
          { key: 'later', title: 'Upcoming', tasks: ts.filter((t) => t.startDate !== null && t.startDate > today) },
          { key: 'any', title: 'Anytime', tasks: ts.filter((t) => t.startDate === null && t.bucket !== 'someday') },
          { key: 'someday', title: 'Someday', tasks: ts.filter((t) => t.bucket === 'someday') },
        ].map((g) => ({ ...g, tasks: sortByOrderKey(g.tasks) }));
      default:
        return [{ key: 'all', title: '', tasks: sortByOrderKey(ts) }];
    }
  });
  return (
    <>
      <Show
        when={props.tasks.length > 0}
        fallback={props.compact
          ? <div style={{ padding: '0 16px 4px', 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-tertiary)' }}>{props.empty}</div>
          : <EmptyState icon={<Icon name="checklist" size={40} color="var(--text-tertiary)" />} text={props.empty} />}
      >
        <For each={groups().filter((g) => g.tasks.length > 0)}>
          {(g) => (
            <>
              <Show when={g.title}>
                <SectionHeading label={g.title} small />
              </Show>
              <For each={g.tasks}>{(t) => <ExpandableTask task={t} ctx={ctx()} />}</For>
            </>
          )}
        </For>
      </Show>
      <SchedulerHost />
    </>
  );
}

// ------------------------------------------------------------- can do now --

/** Everything you could pick up right now: no blocker, not waiting on
 *  someone, not parked in the Inbox or Someday, not dated in the future. */
export function CanDoNowScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const list = createMemo(() => canDoNow(tasks(), currentDate()));
  return (
    <ScreenChrome title="Can Do Now" subtitle={`${list().length} ready · nothing blocked`} icon={<span style={{ 'font-size': 'calc(26px * var(--ts))' }}>🔓</span>} trailing={<SelectButton />}>
      <GroupedTasks tasks={list()} groupBy="home" empty="Nothing is ready — everything open is blocked, waiting or scheduled later." />
    </ScreenChrome>
  );
}

// --------------------------------------------------------------- notes --

const DAY_TEMPLATE = '## Plan\n\n\n## Notes\n\n\n## Wins\n';
const WEEK_TEMPLATE = '## What went well\n\n\n## What didn’t\n\n\n## Top 3 for next week\n1. \n2. \n3. \n';

/** A note that saves as you type (debounced) and reads as markdown. */
function NoteEditor(props: { noteKey: string; template: string; placeholder: string }): JSX.Element {
  const note = createReactiveLiveQuery(() => props.noteKey, async (k) => (await db.dayNotes.get(k)) ?? null, null);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const d = draft();
    if (d !== null) void saveDayNote(props.noteKey, d);
  };
  onCleanup(flush);
  const text = () => draft() ?? note()?.text ?? '';
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <Show
        when={editing() || !text()}
        fallback={
          <div data-testid="note-view" onClick={() => setEditing(true)} style={{ 'min-height': '80px', cursor: 'text', padding: '4px 0' }}>
            <MarkdownView source={text()} />
          </div>
        }
      >
        <textarea
          class="notes-type"
          data-testid="note-text"
          value={text()}
          placeholder={props.placeholder}
          onFocus={() => {
            // Editing first: filling in the template makes the text non-empty,
            // which would otherwise swap the editor out for the preview
            setEditing(true);
            if (!text()) setDraft(props.template);
          }}
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            clearTimeout(timer);
            timer = setTimeout(flush, 500);
          }}
          onBlur={() => {
            flush();
            setEditing(false);
          }}
          rows={12}
          style={{
            width: '100%', 'font-size': 'calc(15px * var(--ts))', 'line-height': 'calc(1.5 * var(--lh))', padding: '10px 12px', 'border-radius': '12px',
            background: 'var(--bg-card)', border: '1px solid var(--separator)', color: 'var(--text)', resize: 'vertical',
          }}
        />
      </Show>
    </div>
  );
}

/** The Daily Note (the calendar plugin's daily notes): one free-form page
 *  per day, with what happened that day above it. */
export function DayNoteScreen(props: { date: DateStr }): JSX.Element {
  const [date, setDate] = createSignal<DateStr>(isValidDateStr(props.date) ? props.date : currentDate());
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const events = createLiveQuery(() => db.calendarEvents.toArray(), []);
  const done = createMemo(() => tasks().filter((t) => t.status === 'completed' && t.trashedAt === null && t.completedAt !== null &&
    new Date(t.completedAt).toDateString() === fromDateStr(date()).toDateString()));
  const dayEvents = createMemo(() => events().filter((e) => e.date === date()));
  const title = () => `${weekdayName(date())}, ${monthName(date())} ${Number(date().slice(8))}`;
  const go = (n: number) => setDate(addDays(date(), n));
  return (
    <ScreenChrome title={title()} subtitle={`Daily Note · ${formatRelative(date(), currentDate())}`} icon={<Icon name="notes" size={26} color="var(--yellow-deep)" />}>
      <div style={{ display: 'flex', gap: '8px', padding: '0 16px 10px', 'align-items': 'center' }}>
        <button data-testid="note-prev" onClick={() => go(-1)} style={{ color: 'var(--blue)', display: 'flex' }}><Icon name="chevron-left" size={18} /></button>
        <button onClick={() => setDate(currentDate())} style={{ color: 'var(--blue)', 'font-size': 'calc(14px * var(--ts))', 'font-weight': 'var(--fw-600)' }}>Today</button>
        <button data-testid="note-next" onClick={() => go(1)} style={{ color: 'var(--blue)', display: 'flex' }}><Icon name="chevron-right" size={18} /></button>
        <div style={{ flex: '1' }} />
        <span style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-tertiary)' }}>
          {done().length} done · {dayEvents().length} event{dayEvents().length === 1 ? '' : 's'}
        </span>
      </div>
      {/* Keyed by day so switching days starts a fresh editor */}
      <For each={[date()]}>
        {(d) => <NoteEditor noteKey={d} template={DAY_TEMPLATE} placeholder="Tap to write about this day" />}
      </For>
      <Show when={done().length > 0}>
        <SectionHeading label="Done this day" small />
        <div style={{ padding: '0 16px 12px' }}>
          <For each={done()}>{(t) => <div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)', padding: '3px 0' }}>✓ {t.title}</div>}</For>
        </div>
      </Show>
    </ScreenChrome>
  );
}

// -------------------------------------------------------- weekly review --

/** A guided weekly review (TaskNotes' maintenance workflow): what got done,
 *  inbox to zero, overdue, waiting on others, stuck projects, the week
 *  ahead — then a note for the week. */
export function WeeklyReviewScreen(): JSX.Element {
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const r = createMemo(() => weekReview(tasks(), projects(), currentDate()));
  const [showDone, setShowDone] = createSignal(false);
  const week = () => weekKey(currentDate());
  const step = (n: number, label: string, count: number | string, color = 'var(--blue)') => (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '18px 16px 6px' }}>
      <span style={{ width: '22px', height: '22px', 'border-radius': '50%', background: color, color: '#fff', 'font-size': 'calc(12px * var(--ts))', 'font-weight': 'var(--fw-700)', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>{n}</span>
      <span style={{ flex: '1', 'font-weight': 'var(--fw-700)', 'font-size': 'calc(16px * var(--ts))' }}>{label}</span>
      <span style={{ 'font-size': 'calc(13px * var(--ts))', color: 'var(--text-tertiary)' }}>{count}</span>
    </div>
  );
  const finish = async () => {
    await setSetting('lastWeeklyReview', currentDate());
    showToast('Review done — see you next week');
    back();
  };
  return (
    <ScreenChrome title="Weekly Review" subtitle={`Week of ${formatRelative(mondayOf(currentDate()), currentDate())} · ${week()}`} icon={<Icon name="restore" size={26} color="var(--purple)" />}>
      {step(1, 'Celebrate what got done', `${r().done.length} in 7 days`, 'var(--green)')}
      <div style={{ padding: '0 16px' }}>
        <button onClick={() => setShowDone(!showDone())} style={{ color: 'var(--blue)', 'font-size': 'calc(14px * var(--ts))' }}>{showDone() ? 'Hide' : 'Show'} the list</button>
        <Show when={showDone()}>
          <For each={r().done}>{(t) => <div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-secondary)', padding: '3px 0' }}>✓ {t.title}</div>}</For>
        </Show>
      </div>

      {step(2, 'Empty the Inbox', r().inbox === 0 ? 'clear ✓' : `${r().inbox} to sort`)}
      <Show when={r().inbox > 0}>
        <div style={{ padding: '0 16px' }}>
          <button data-testid="review-inbox" onClick={() => push({ name: 'list', list: 'inbox' })} style={{ color: 'var(--blue)', 'font-size': 'calc(15px * var(--ts))', 'font-weight': 'var(--fw-600)' }}>Open the Inbox →</button>
        </div>
      </Show>

      {step(3, 'Deal with what’s overdue', r().overdue.length, 'var(--red)')}
      <GroupedTasks tasks={r().overdue} groupBy="none" empty="Nothing overdue." compact />

      {step(4, 'Chase what you’re waiting on', r().waiting.length, 'var(--orange, var(--yellow-deep))')}
      <GroupedTasks tasks={r().waiting} groupBy="none" empty="Nothing waiting on others." compact />

      {step(5, 'Give stuck projects a next step', r().stuckProjects.length)}
      <div style={{ padding: '0 16px' }}>
        <Show when={r().stuckProjects.length > 0} fallback={<div style={{ 'font-size': 'calc(14px * var(--ts))', color: 'var(--text-tertiary)' }}>Every project has something you can do now.</div>}>
          <For each={r().stuckProjects}>
            {(p) => (
              <button data-testid="review-stuck" onClick={() => push({ name: 'project', id: p.id })} style={{ display: 'block', padding: '6px 0', 'font-size': 'calc(15px * var(--ts))', color: 'var(--text)', 'text-align': 'left' }}>
                {p.title || 'New Project'} <span style={{ color: 'var(--blue)' }}>→</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      {step(6, 'Look at the week ahead', r().comingUp.length)}
      <GroupedTasks tasks={r().comingUp} groupBy="when" empty="Nothing dated in the next 7 days." compact />

      {step(7, 'Write the week down', '', 'var(--purple)')}
      <NoteEditor noteKey={week()} template={WEEK_TEMPLATE} placeholder="Tap to reflect on the week" />

      <div style={{ padding: '6px 16px 20px' }}>
        <button data-testid="review-finish" onClick={() => void finish()} style={{ width: '100%', padding: '13px', 'border-radius': '12px', background: 'var(--blue)', color: '#fff', 'font-size': 'calc(16px * var(--ts))', 'font-weight': 'var(--fw-600)' }}>
          Finish review
        </button>
      </div>
    </ScreenChrome>
  );
}

/** True when the last weekly review was more than 6 days ago (or never). */
export async function reviewDue(today: DateStr): Promise<boolean> {
  const last = await getSetting<string>('lastWeeklyReview', '');
  return !last || addDays(last, 7) <= today;
}

// ------------------------------------------------------------ saved views --

export function SavedViewScreen(props: { id: string }): JSX.Element {
  const view = createLiveQuery(async () => (await db.savedViews.get(props.id)) ?? null, null);
  const tasks = createLiveQuery(() => db.tasks.toArray(), []);
  const projects = createLiveQuery(() => db.projects.toArray(), []);
  const areas = createLiveQuery(() => db.areas.toArray(), []);
  const tags = createLiveQuery(() => db.tags.toArray(), []);
  const [menu, setMenu] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const list = createMemo(() => (view() ? applyView(tasks(), view()!.filter, projects(), currentDate()) : []));
  const summary = () => view() ? describeView(view()!.filter, {
    tag: (id) => tags().find((t) => t.id === id)?.title ?? '?',
    home: (k) => (k.startsWith('p:') ? projects().find((p) => p.id === k.slice(2))?.title : areas().find((a) => a.id === k.slice(2))?.title) ?? '?',
  }) : '';
  return (
    <Show when={view()}>
      <ScreenChrome
        title={view()!.title}
        subtitle={`${list().length} · ${summary()}`}
        icon={<Icon name="layers" size={26} color="var(--teal)" />}
        trailing={<><SelectButton />
          <button aria-label="View menu" data-testid="view-menu" onClick={() => setMenu(true)} style={{ color: 'var(--text-secondary)', padding: '8px 10px', display: 'flex' }}>
            <Icon name="ellipsis" size={20} />
          </button></>
        }
      >
        <GroupedTasks tasks={list()} groupBy={view()!.groupBy} empty="Nothing matches this view right now." />
      </ScreenChrome>
      <Show when={menu()}>
        <Sheet onClose={() => setMenu(false)} dragAnywhere>
          <SheetTitle>{view()!.title}</SheetTitle>
          <MenuRow icon={<Icon name="pencil" size={20} />} label="Edit View" onClick={() => { setMenu(false); setEditing(true); }} />
          <MenuRow icon={<Icon name="trash" size={20} />} danger label="Delete View" onClick={() => { void deleteSavedView(props.id); setMenu(false); back(); }} />
          <div style={{ height: '10px' }} />
        </Sheet>
      </Show>
      <Show when={editing()}>
        <ViewEditor
          initial={view()!}
          onSave={(title: string, filter: ViewFilter, groupBy: Grouping) => void updateSavedView(props.id, { title, filter, groupBy })}
          onClose={() => setEditing(false)}
        />
      </Show>
    </Show>
  );
}
